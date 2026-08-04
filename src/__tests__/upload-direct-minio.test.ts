import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Envoi direct vers MinIO, et progression.
 *
 * ⚠️ LE BUG N'ÉTAIT PAS UNE LIMITE DE TAILLE, C'ÉTAIT UN RELAIS.
 *
 * L'application recevait le fichier en `PUT` puis le retransmettait à MinIO.
 * Sur 30–75 Mo, Traefik coupait la connexion pendant ce relais : l'app
 * journalisait `Error: aborted` et le navigateur recevait un 502. Les petits
 * fichiers passaient, ce qui faisait ressembler la panne à une limite de
 * taille alors que c'était une limite de DURÉE.
 *
 * La correction ne raccourcit rien : elle SUPPRIME le relais. Le navigateur
 * écrit directement dans MinIO avec une URL présignée, et l'application ne
 * voit plus passer un seul octet du fichier.
 *
 * Second défaut, indépendant : `fetch` n'expose aucun événement d'envoi. Une
 * minute d'écran figé sur « Uploader… » ne se distingue pas d'un envoi mort.
 * Seul `XMLHttpRequest` a `upload.onprogress`.
 */

const route = readFileSync(
  resolve(__dirname, '../app/api/upload/signed-url/route.ts'), 'utf-8',
);
const helper = readFileSync(resolve(__dirname, '../lib/storage/uploadFile.ts'), 'utf-8');
const library = readFileSync(resolve(__dirname, '../components/shared/MediaLibrary.tsx'), 'utf-8');
const relais = readFileSync(
  resolve(__dirname, '../app/api/storage/upload/route.ts'), 'utf-8',
);

describe('La route choisit son mode, et retombe proprement', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.STORAGE_PROVIDER = 's3';
    process.env.MINIO_SECRET_KEY = 'secret-de-test';
    delete process.env.MINIO_PUBLIC_ENDPOINT;
  });
  afterEach(() => { process.env = { ...ENV }; });

  /** Appelle la route avec une session simulée. */
  async function appeler(): Promise<Record<string, unknown>> {
    vi.doMock('@/lib/auth/config', () => ({
      auth: async () => ({ user: { id: 'u-test' } }),
    }));
    vi.doMock('@/lib/db/supabase', () => ({ supabaseAdmin: { storage: { from: () => ({}) } } }));
    const { POST } = await import('@/app/api/upload/signed-url/route');
    const req = new Request('http://localhost/api/upload/signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'rush.mp4', contentType: 'video/mp4', purpose: 'library' }),
    });
    const res = await POST(req as never);
    return await res.json();
  }

  it('sans `MINIO_PUBLIC_ENDPOINT` : le relais, comme aujourd hui', () => {
    // Default-safe : tant que l'endpoint public n'est pas déployé, rien ne
    // change. C'est ce qui permet de livrer ce correctif avant l'infra.
    expect(route).toContain("const endPoint = process.env.MINIO_PUBLIC_ENDPOINT;");
    expect(route).toContain('if (!endPoint) return null;');
    expect(route).toContain("mode: 'proxy',");
  });

  it('avec l endpoint : une URL présignée sur l hôte PUBLIC', async () => {
    process.env.MINIO_PUBLIC_ENDPOINT = 's3.studiio.pro';
    const json = await appeler();
    expect(json.success).toBe(true);
    expect(json.mode).toBe('direct');
    expect(String(json.signedUrl)).toContain('https://s3.studiio.pro/');
    expect(String(json.signedUrl)).toContain('media/u-test/library/');
    // Une présignée porte sa signature dans la requête.
    expect(String(json.signedUrl)).toContain('X-Amz-Signature');
  });

  it('sans l endpoint : le relais applicatif', async () => {
    const json = await appeler();
    expect(json.mode).toBe('proxy');
    expect(String(json.signedUrl)).toContain('/api/storage/upload?bucket=media');
  });

  it('l hôte INTERNE ne fuit jamais vers le navigateur', async () => {
    // `studiio-minio:9000` n'est pas résolvable dehors : une présignée signée
    // avec lui serait injouable, et le nom de l'hôte interne n'a rien à faire
    // dans une réponse publique.
    process.env.MINIO_PUBLIC_ENDPOINT = 's3.studiio.pro';
    const json = await appeler();
    expect(JSON.stringify(json)).not.toContain('studiio-minio');
  });

  it('une signature ratée ne bloque pas l envoi', async () => {
    // Sans clé secrète, le client public n'est pas construit : on repasse par
    // le relais plutôt que de rendre une erreur.
    process.env.MINIO_PUBLIC_ENDPOINT = 's3.studiio.pro';
    delete process.env.MINIO_SECRET_KEY;
    delete process.env.MINIO_ROOT_PASSWORD;
    const json = await appeler();
    expect(json.mode).toBe('proxy');
    expect(json.success).toBe(true);
  });

  it('la signature est signée AVEC le nom public, pas le client du serveur', () => {
    // La signature porte l'hôte : signer avec le client interne produirait
    // une URL rejetée par MinIO.
    expect(route).toContain('function clientPublic()');
    expect(route).toContain('port: useSSL ? 443 : 80');
  });

  it('la région est FIXÉE — sinon le SDK part la demander au réseau', () => {
    // Sans région, `presignedPutObject` fait un aller-retour vers l'hôte
    // public avant de signer. S'il échoue, le repli renvoie tout le monde
    // vers le relais et le correctif a l'air de ne pas marcher.
    expect(route).toContain("region: process.env.MINIO_REGION || 'us-east-1'");
  });
});

describe('L URL de LECTURE ne bouge pas', () => {
  it('elle passe toujours par la route de l application', () => {
    // La faire pointer sur l'endpoint public supposerait la lecture anonyme
    // ouverte sur le compartiment. Si elle ne l'est pas, TOUS les fichiers
    // déposés deviendraient illisibles — un bug pire que celui corrigé, et
    // invisible avant qu'un utilisateur ne rouvre son montage.
    expect(route).toContain('const publicUrl = `/storage/v1/object/public/${bucket}/${storagePath}`;');
  });

  it('la bascule reste possible sans toucher au code', () => {
    // `PUBLIC_STORAGE_URL` existe déjà pour ça.
    const client = readFileSync(resolve(__dirname, '../lib/storage/s3-client.ts'), 'utf-8');
    expect(client).toContain('process.env.PUBLIC_STORAGE_URL');
  });
});

describe('Le helper : XHR, parce que `fetch` ne sait pas', () => {
  it('il utilise XHR et son événement d envoi', () => {
    expect(helper).toContain('new XMLHttpRequest()');
    expect(helper).toContain('xhr.upload.onprogress');
    // `fetch` n'expose rien de l'envoi : c'est la raison d'être du fichier.
    expect(helper).toContain("n'expose AUCUN événement de progression");
  });

  it('les identifiants ne partent QUE vers le relais', () => {
    // Une URL présignée porte sa propre signature ; y ajouter un cookie de
    // session ferait échouer la vérification, et le CORS sur le chemin
    // Supabase historique.
    expect(helper).toContain("withCredentials: mode === 'proxy'");
  });

  it('une taille inconnue n affiche pas « Infinity % »', () => {
    expect(helper).toContain('if (!e.lengthComputable || e.total <= 0) return;');
  });

  it('la barre atteint bien 100 %', () => {
    // Le dernier `onprogress` peut manquer : une barre figée à 98 % laisse
    // croire à un envoi incomplet.
    const bloc = helper.slice(helper.indexOf('xhr.onload = () => {'));
    expect(bloc).toContain('options.onProgress?.(100);');
  });

  it('le statut figure TOUJOURS dans le message d erreur', () => {
    expect(helper).toContain('function messageEchec(status: number)');
    expect(helper).toContain('Upload échoué (HTTP ${status})');
  });

  it('le 502 est nommé pour ce qu il est', () => {
    // C'est le symptôme exact du bug : la connexion coupée en cours de route.
    expect(helper).toContain('la connexion a été coupée avant la fin');
  });
});

describe('La Médiathèque — le point du bug', () => {
  it('elle passe par le helper partagé', () => {
    expect(library).toContain("from '@/lib/storage/uploadFile'");
    expect(library).toContain('await uploadFile(file, {');
    // Plus de PUT écrit à la main.
    expect(library).not.toContain("await fetch(data.signedUrl, {");
  });

  it('elle affiche une barre ET le pourcentage', () => {
    expect(library).toContain('const [progress, setProgress] = useState(0);');
    expect(library).toContain('onProgress: setProgress,');
    expect(library).toContain('`Envoi ${progress} %`');
    expect(library).toContain('style={{ width: `${progress}%` }}');
  });

  it('le message trompeur « Supabase PUT » a disparu', () => {
    // Le stockage est MinIO depuis la migration : ce message envoyait
    // chercher la panne au mauvais endroit.
    expect(library).not.toContain('Supabase PUT');
  });
});

describe('Le relais reste en place', () => {
  it('rien n a été retiré du chemin historique', () => {
    // C'est lui qui sert tant que l'endpoint public n'est pas déployé — et le
    // repli si une signature échoue.
    expect(relais).toContain('export async function PUT');
    expect(relais).toContain('Path scope mismatch');
  });
});
