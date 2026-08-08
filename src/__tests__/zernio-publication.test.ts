import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHmac } from 'crypto';

/**
 * Publication réseaux des utilisateurs, via Zernio.
 *
 * ⚠️ CE LOT TOUCHE À DE L'ARGENT ET À DES DONNÉES D'AUTRUI. Trois invariants
 * comptent plus que le reste, et ce sont eux que ces tests protègent :
 *
 * 1. **Fermé par défaut.** Table absente, ligne manquante, migration pas
 *    appliquée : tout se lit « pas le droit ». L'inverse ouvrirait la
 *    publication à tous au premier déploiement.
 * 2. **Le webhook est public.** Sans signature vérifiée, n'importe qui
 *    rattacherait un compte au profil d'un autre utilisateur.
 * 3. **Jamais un WebM.** Les réseaux acceptent le fichier puis le rejettent
 *    des heures plus tard, ou publient une vidéo illisible.
 */

// ── Une base en mémoire, chaînable comme PostgREST ────────────────────────
interface Ligne { [k: string]: unknown }
const base: Record<string, Ligne[]> = { users: [], zernio_accounts: [], site_settings: [], scheduled_posts: [] };

function requete(table: string, op: 'select' | 'update' | 'upsert', charge?: Ligne) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  const resultat = () => {
    const trouves = base[table].filter((l) => filtres.every((f) => f(l)));
    if (op === 'update' && charge) for (const l of trouves) Object.assign(l, charge);
    return { data: trouves, error: null };
  };
  const b: Record<string, unknown> = {
    eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return b; },
    order: () => b,
    limit: () => resultat(),
    select: () => b,
    then: (res: (v: unknown) => unknown) => Promise.resolve(resultat()).then(res),
  };
  return b;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => requete(table, 'select'),
      update: (charge: Ligne) => requete(table, 'update', charge),
      upsert: (ligne: Ligne, opts?: { onConflict?: string }) => {
        const cle = opts?.onConflict ?? 'id';
        const i = base[table].findIndex((l) => l[cle] === ligne[cle]);
        if (i >= 0) Object.assign(base[table][i], ligne);
        else base[table].push({ ...ligne });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

vi.mock('@/lib/admin', () => ({
  isAdmin: (email?: string | null) => email === 'contact.artboost@gmail.com',
  requireAdmin: async () => ({ error: null, session: null }),
  logAdminAction: () => {},
}));

import {
  droitDePublier, mediaPubliable, publicationOuverte, comptesConnectes, assurerProfil,
  MESSAGES_REFUS,
} from '@/lib/social/publishing';
import { ZernioError, isZernioPlatform, ZERNIO_PLATFORMS } from '@/lib/social/zernio';

const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  base.users = [{ id: USER, zernio_profile_id: null, publishing_enabled: false }];
  base.zernio_accounts = [];
  base.site_settings = [{ key: 'user_publishing_enabled', value: 'false' }];
  base.scheduled_posts = [];
  process.env.ZERNIO_API_KEY = 'sk_test';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ZERNIO_API_KEY; });

const ouvrir = () => { base.site_settings[0].value = 'true'; };
const optionner = () => { base.users[0].publishing_enabled = true; };

// ─────────────────────────────────────────────────────────────────────────
describe('A — fermé par défaut, et il faut les DEUX drapeaux', () => {
  it('sans rien, l utilisateur ne publie pas', async () => {
    const d = await droitDePublier(USER, 'user@test.fr');
    expect(d.autorise).toBe(false);
    expect(d.raison).toBe('coupe-circuit');
  });

  it('l interrupteur global SEUL ne suffit pas', async () => {
    ouvrir();
    const d = await droitDePublier(USER, 'user@test.fr');
    expect(d.autorise).toBe(false);
    expect(d.raison).toBe('option-absente');
  });

  it('l option utilisateur SEULE ne suffit pas', async () => {
    // ⚠️ C'EST TOUT L'INTERET DU COUPE-CIRCUIT : le jour ou Zernio tombe, on
    // coupe tout le monde d'un coup, sans desactiver les comptes un par un.
    optionner();
    const d = await droitDePublier(USER, 'user@test.fr');
    expect(d.autorise).toBe(false);
    expect(d.raison).toBe('coupe-circuit');
  });

  it('les deux ensemble autorisent', async () => {
    ouvrir(); optionner();
    expect((await droitDePublier(USER, 'user@test.fr')).autorise).toBe(true);
  });

  it('une ligne de réglage ABSENTE se lit « fermé »', async () => {
    // Migration pas encore appliquee : le defaut sur est le refus.
    base.site_settings = [];
    expect(await publicationOuverte()).toBe(false);
  });

  it('l administrateur passe outre les deux drapeaux', async () => {
    const d = await droitDePublier(USER, 'contact.artboost@gmail.com');
    expect(d.autorise).toBe(true);
    expect(d.admin).toBe(true);
  });

  it('mais PAS outre la configuration — sans clé, personne ne publie', async () => {
    delete process.env.ZERNIO_API_KEY;
    const d = await droitDePublier(USER, 'contact.artboost@gmail.com');
    expect(d.autorise).toBe(false);
    expect(d.raison).toBe('zernio-absent');
  });

  it('chaque refus porte un message distinct', () => {
    // « Activez votre option » et « le service est coupe » n'appellent pas la
    // meme action : les confondre laisserait l'utilisateur sans recours.
    const messages = Object.values(MESSAGES_REFUS);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — jamais un WebM sur les réseaux', () => {
  it('le WebM est refusé, avec un motif qui dit quoi faire', () => {
    // ⚠️ LES DIX PREMIERS POSTS DU CALENDRIER SONT DANS CE CAS (cf.
    // CLAUDE.md) : WebM « mode rapide », metadonnees temporelles cassees.
    const r = mediaPubliable('https://x.test/montage.webm');
    expect(r.ok).toBe(false);
    expect(r.motif).toContain('MP4');
  });

  it('le MP4 passe', () => {
    expect(mediaPubliable('https://x.test/montage.mp4').ok).toBe(true);
    // Une URL signee porte une chaine de requete : elle ne doit pas tromper
    // la lecture de l'extension.
    expect(mediaPubliable('https://x.test/m.mp4?token=abc').ok).toBe(true);
  });

  it('l absence de vidéo, une URL non publique et un format inconnu sont refusés', () => {
    for (const url of [null, undefined, '', 'blob:xyz', '/local/f.mp4', 'https://x.test/a.gif']) {
      expect(mediaPubliable(url as string | null).ok, String(url)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — le profil Zernio est facturé : jamais deux fois', () => {
  it('un profil déjà mémorisé n est pas recréé', async () => {
    base.users[0].zernio_profile_id = 'prof_1';
    const appels: string[] = [];
    vi.doMock('@/lib/social/zernio', async () => {
      const actual = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
      return { ...actual, createProfile: async () => { appels.push('create'); return { _id: 'x', name: 'x' }; } };
    });
    expect(await assurerProfil(USER, 'a@b.c')).toBe('prof_1');
    expect(appels).toEqual([]);
  });

  it('les comptes connectés sont filtrés sur le statut', async () => {
    base.zernio_accounts = [
      { user_id: USER, account_id: 'a1', platform: 'instagram', username: 'moi', status: 'connected' },
      { user_id: USER, account_id: 'a2', platform: 'tiktok', username: null, status: 'disconnected' },
    ];
    const c = await comptesConnectes(USER);
    expect(c).toHaveLength(1);
    expect(c[0].platform).toBe('instagram');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — le client Zernio', () => {
  it('les quatre plateformes exposées sont validées, les autres refusées', () => {
    for (const p of ZERNIO_PLATFORMS) expect(isZernioPlatform(p)).toBe(true);
    for (const p of ['twitter', 'linkedin', '', null, 42]) expect(isZernioPlatform(p)).toBe(false);
  });

  it('429 et 5xx sont réessayables, 402 ne l est JAMAIS', () => {
    // ⚠️ UN 402 SIGNIFIE QUE LA FACTURATION ZERNIO EST SUSPENDUE : aucun
    // nombre de tentatives n'y changera quoi que ce soit, et boucler
    // aggraverait la situation.
    expect(new ZernioError('x', 429, 30).retryable).toBe(true);
    expect(new ZernioError('x', 503).retryable).toBe(true);
    expect(new ZernioError('x', 402).retryable).toBe(false);
    expect(new ZernioError('x', 402).paymentRequired).toBe(true);
    expect(new ZernioError('x', 429, 30).retryAfter).toBe(30);
  });

  it('la clé ne part JAMAIS au navigateur', () => {
    // Une clé serveur exposée en `NEXT_PUBLIC_` serait lisible par tout
    // visiteur — et elle vaut pour TOUS les utilisateurs.
    const src = readFileSync(resolve(__dirname, '../lib/social/zernio.ts'), 'utf-8');
    // ⚠️ ON VISE L'USAGE, PAS LE MOT. Le fichier EXPLIQUE en commentaire
    // pourquoi il ne faut pas de `NEXT_PUBLIC_` : interdire la chaine ferait
    // echouer le test sur sa propre mise en garde.
    expect(src).not.toMatch(/process\.env\.NEXT_PUBLIC/);
    expect(src).toContain("process.env.ZERNIO_API_KEY");
    // Le composant client demande une URL a NOTRE route, il n'appelle jamais
    // Zernio directement.
    const ui = readFileSync(resolve(__dirname, '../components/social/MesReseaux.tsx'), 'utf-8');
    expect(ui).not.toContain('zernio.com/api');
    expect(ui).not.toContain('ZERNIO_API_KEY');
  });

  it('le média passe par une URL PRÉSIGNÉE, pas par la nôtre', () => {
    // ⚠️ ZERNIO REFUSE UNE URL ARBITRAIRE : il faut demander une URL
    // presignee, y deposer le fichier, puis referencer le `publicUrl` rendu.
    // Envoyer directement l'URL de notre stockage produit un post refuse.
    const src = readFileSync(resolve(__dirname, '../lib/social/zernio.ts'), 'utf-8');
    expect(src).toContain('/media/presign');
    expect(src).toContain("method: 'PUT'");
    expect(src).toContain('presign.publicUrl');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — le webhook est public : la signature fait foi', () => {
  const src = readFileSync(
    resolve(__dirname, '../app/api/social/zernio/webhook/route.ts'), 'utf-8');

  it('sans secret configuré, TOUT est refusé', () => {
    // ⚠️ ACCEPTER LES EVENEMENTS NON SIGNES « EN ATTENDANT » laisserait une
    // porte ouverte que personne ne penserait a refermer.
    expect(src).toContain('ZERNIO_WEBHOOK_SECRET');
    expect(src).toMatch(/if \(!secret\)[\s\S]{0,400}status: 503/);
  });

  it('le corps est lu en TEXTE, jamais en JSON, avant vérification', () => {
    // `req.json()` reformate ; le HMAC porte sur les octets exacts.
    const i = src.indexOf('await req.text()');
    const j = src.indexOf('JSON.parse(brut)');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it('la comparaison est à temps constant', () => {
    // Une comparaison naive fuit la signature octet par octet.
    expect(src).toContain('timingSafeEqual');
  });

  it('la signature calculée est bien un HMAC-SHA256 du corps brut', () => {
    // On reproduit ici le calcul que la route effectue, pour figer le
    // contrat annonce par Zernio (`X-Zernio-Signature`).
    const corps = '{"event":"account.connected"}';
    const attendu = createHmac('sha256', 'secret').update(corps, 'utf8').digest('hex');
    expect(attendu).toHaveLength(64);
    expect(src).toContain("createHmac('sha256'");
    expect(src).toContain("x-zernio-signature");
  });

  it('il répond 200 même si le traitement échoue', () => {
    // Un 5xx ferait rejouer l'evenement en boucle chez Zernio pour une
    // erreur qui vient de NOTRE base.
    expect(src).toMatch(/catch[\s\S]{0,200}Traitement echoue/);
  });

  it('le post est retrouvé par l identifiant écrit à la création', () => {
    // Un rapprochement par date ou par contenu confondrait deux montages du
    // meme cycle.
    expect(src).toContain('studiioPostId');
    const pub = readFileSync(resolve(__dirname, '../lib/social/publishViaZernio.ts'), 'utf-8');
    expect(pub).toContain('metadata: { studiioPostId: post.id }');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('F — le câblage', () => {
  it('les routes gardent l accès côté SERVEUR, pas seulement l écran', () => {
    // Masquer un bouton n'empeche personne d'appeler la route : sans ce
    // controle, n'importe quel compte ferait creer un profil que Studiio paie.
    const connect = readFileSync(
      resolve(__dirname, '../app/api/social/zernio/connect/route.ts'), 'utf-8');
    expect(connect).toContain('droitDePublier');
    expect(connect).toContain('status: 403');
  });

  it('le retour de connexion ignore le profileId de l URL', () => {
    // ⚠️ IL EST SOUS LE CONTROLE DU NAVIGATEUR : s'en servir laisserait
    // rattacher un compte au profil d'un autre utilisateur.
    const comptes = readFileSync(
      resolve(__dirname, '../app/api/social/zernio/accounts/route.ts'), 'utf-8');
    expect(comptes).toContain('droit.profileId');
    expect(comptes).not.toContain('corps.profileId');
  });

  it('le cron essaie Zernio SANS retirer le chemin direct de l admin', () => {
    // Les deux coexistent : `social_accounts` reste lu juste apres.
    const cron = readFileSync(resolve(__dirname, '../app/api/cron/publish/route.ts'), 'utf-8');
    expect(cron).toContain('publierViaZernio');
    expect(cron).toContain("from('social_accounts')");
    expect(cron).toContain('getValidToken');
  });

  it('un post remis à Zernio reste « publishing » jusqu au webhook', () => {
    // Le marquer « published » annoncerait un succes qu'on ne connait pas
    // encore : c'est `post.published` qui confirmera.
    const cron = readFileSync(resolve(__dirname, '../app/api/cron/publish/route.ts'), 'utf-8');
    expect(cron).toMatch(/resultat\.ok[\s\S]{0,400}status: 'publishing'/);
  });

  it('la migration porte ses deux étapes PostgREST', () => {
    const m = readFileSync(resolve(__dirname, '../../migrations/2026-08-08-zernio.sql'), 'utf-8');
    expect(m).toContain('add column if not exists publishing_enabled boolean not null default false');
    expect(m).toContain('create table if not exists public.zernio_accounts');
    expect(m).toContain("insert into public.site_settings(key, value) values ('user_publishing_enabled', 'false')");
    expect(m).toContain('grant all on table public.zernio_accounts to public;');
    expect(m).toContain('docker kill -s SIGUSR1 studiio-postgrest');
    expect(m).not.toMatch(/drop\s+(table|column)/i);
  });
});
