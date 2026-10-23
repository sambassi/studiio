// @vitest-environment node
/**
 * Envoi DECOUPE du montage paye (Creer / Calendrier / Apercu / Bureau).
 *
 * Prod 02fedad : WebM de 62 Mo envoye en UN `PUT` vers s3.studiio.pro ->
 * `net::ERR_TIMED_OUT`, « L'envoi du montage a echoue ». Ces tests prouvent :
 *
 *   A. la logique serveur (`traiterActionDecoupe`) sur un S3 factice ;
 *   B. le client (`envoyerMontageDecoupe`) : reprise par morceau, coupure
 *      sur inactivite, echec definitif -> abandon, repli si indisponible ;
 *   C. de bout en bout sur un VRAI MinIO local (si `MINIO_TEST_ENDPOINT`),
 *      60 Mo : taille + sha256 identiques, un debit, un post ; echec ->
 *      aucun debit, aucun post, envoi abandonne ; reessai -> pas de doublon.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { traiterActionDecoupe, type DependancesDecoupe } from '@/lib/rendus/depot-multipart';
import { envoyerMontageDecoupe, EchecEnvoi } from '@/lib/rendus/envoi-montage';
import type { ClientEnvoiDecoupe, PartieDeposee } from '@/lib/storage/minio-client';

const MIO = 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────
// S3 factice, compatible multipart (en memoire)
// ─────────────────────────────────────────────────────────────────────────
function s3Factice() {
  const objets = new Map<string, { data: Buffer; type: string }>();
  const envois = new Map<string, { cle: string; type: string; parts: Map<number, Buffer> }>();
  let n = 0;
  const client: ClientEnvoiDecoupe = {
    async initier(_b, cle, type) { const id = `up${++n}`; envois.set(id, { cle, type, parts: new Map() }); return id; },
    async lister(_b, cle, id) {
      const e = envois.get(id);
      if (!e || e.cle !== cle) throw new Error('NoSuchUpload');
      return [...e.parts].map(([part, d]): PartieDeposee => ({ part, etag: createHash('md5').update(d).digest('hex'), size: d.length }));
    },
    async terminer(_b, cle, id, parties) {
      const e = envois.get(id);
      if (!e || e.cle !== cle) throw new Error('NoSuchUpload');
      objets.set(cle, { data: Buffer.concat(parties.map((p) => e.parts.get(p.part)!)), type: e.type });
      envois.delete(id);
    },
    async abandonner(_b, _c, id) { envois.delete(id); },
    async statObject(_b, cle) { const o = objets.get(cle); if (!o) throw new Error('Not Found'); return { size: o.data.length, metaData: { 'content-type': o.type } }; },
    async removeObject(_b, cle) { objets.delete(cle); },
    async ecrireTexte(_b, cle, t) { objets.set(cle, { data: Buffer.from(t), type: 'application/json' }); },
    async lireTexte(_b, cle) { return objets.get(cle)?.data.toString() ?? null; },
  };
  const signeur = {
    async signerPartie(_b: string, cle: string, id: string, part: number) {
      return `https://s3.test/${cle}?uploadId=${id}&partNumber=${part}&X-Amz-Signature=secret`;
    },
  };
  /** Ce que ferait MinIO d'un PUT de morceau sur l'URL signee. */
  const deposer = async (url: string, corps: Blob) => {
    const u = new URL(url);
    const e = envois.get(u.searchParams.get('uploadId')!);
    if (!e) throw new Error('NoSuchUpload');
    e.parts.set(Number(u.searchParams.get('partNumber')), Buffer.from(await corps.arrayBuffer()));
  };
  return { client, signeur, objets, envois, deposer };
}

const LIGNE = { id: 'j1', bucket: 'media', cle_objet: 'moi/rendus/j1.webm', etat: 'reserved' };

/** Branche `fetch` : `/api/render/jobs/j1/upload` -> logique serveur. */
function brancher(s3: ReturnType<typeof s3Factice>, ligne = { ...LIGNE }, deps?: Partial<DependancesDecoupe>) {
  const appels: Array<Record<string, unknown>> = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/render/jobs/j1/upload') && init?.method === 'POST') {
      const corps = JSON.parse(String(init.body || '{}'));
      appels.push(corps);
      const r = await traiterActionDecoupe(ligne, corps.action, corps, {
        client: s3.client, signeur: s3.signeur, urlSure: () => true, ...deps,
      });
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    throw new Error(`fetch inattendu ${u}`);
  }) as unknown as typeof fetch;
  return appels;
}

const vraiFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = vraiFetch; vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────
// A. Serveur
// ─────────────────────────────────────────────────────────────────────────
describe('A. traiterActionDecoupe — le depot, rien que le depot', () => {
  it('ouvre l envoi sur le DEPOT de la ligne, jamais sur la cle du rendu', async () => {
    const s3 = s3Factice();
    const r = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 20 * MIO, contentType: 'video/webm' }, { client: s3.client, signeur: s3.signeur });
    expect(r.status).toBe(200);
    expect([...s3.envois.values()][0].cle).toBe('moi/rendus/j1.depot.webm');
  });

  it('refuse hors `reserved` (409), sans endpoint public (501 unsupported), type et taille', async () => {
    const s3 = s3Factice();
    const d = { client: s3.client, signeur: s3.signeur };
    expect((await traiterActionDecoupe({ ...LIGNE, etat: 'confirmed' }, 'multipart-initiate', { taille: 9 * MIO }, d)).status).toBe(409);
    const sans = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 9 * MIO }, { client: s3.client, signeur: null });
    expect(sans.status).toBe(501);
    expect(sans.body.unsupported).toBe(true);
    expect((await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 9 * MIO, contentType: 'text/html' }, d)).status).toBe(415);
    expect((await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 600 * MIO }, d)).status).toBe(413);
    expect(s3.envois.size).toBe(0);
  });

  it('UN envoi par tentative : second initiate de meme taille -> meme uploadId ; autre taille -> l ancien est abandonne', async () => {
    const s3 = s3Factice();
    const d = { client: s3.client, signeur: s3.signeur };
    const a = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 20 * MIO }, d);
    const b = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 20 * MIO }, d);
    expect(b.body.uploadId).toBe(a.body.uploadId);
    expect(s3.envois.size).toBe(1);
    const c = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 30 * MIO }, d);
    expect(c.body.uploadId).not.toBe(a.body.uploadId);
    expect(s3.envois.size).toBe(1); // l'ancien est abandonne
    expect(s3.envois.has(String(a.body.uploadId))).toBe(false);
    // L'ancien uploadId n'est plus signable.
    expect((await traiterActionDecoupe(LIGNE, 'multipart-sign', { uploadId: a.body.uploadId, partNumber: 1 }, d)).status).toBe(409);
  });

  it('uploadId etranger -> 409 sur sign / complete / abort ; partNumber au-dela de ceil(taille / 5 Mio) -> 400', async () => {
    const s3 = s3Factice();
    const d = { client: s3.client, signeur: s3.signeur };
    const { body } = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 17 * MIO }, d);
    // Un envoi ouvert ailleurs (autre tentative, ou a la main) n'est pas le sien.
    const etranger = await s3.client.initier('media', 'moi/rendus/j1.depot.webm', 'video/webm');
    for (const action of ['multipart-sign', 'multipart-complete', 'multipart-abort'] as const) {
      const r = await traiterActionDecoupe(LIGNE, action, { uploadId: etranger, partNumber: 1, taille: 17 * MIO }, d);
      expect(r.status, action).toBe(409);
      expect(r.body.motif).toBe('envoi_inconnu');
    }
    // 17 Mio -> 4 morceaux de 5 Mio au plus.
    expect((await traiterActionDecoupe(LIGNE, 'multipart-sign', { uploadId: body.uploadId, partNumber: 4 }, d)).status).toBe(200);
    expect((await traiterActionDecoupe(LIGNE, 'multipart-sign', { uploadId: body.uploadId, partNumber: 5 }, d)).status).toBe(400);
    expect((await traiterActionDecoupe(LIGNE, 'multipart-sign', { uploadId: body.uploadId, partNumber: 10_000 }, d)).status).toBe(400);
    // L'assemblage se juge sur la taille DECLAREE, pas sur celle annoncee ensuite.
    expect((await traiterActionDecoupe(LIGNE, 'multipart-complete', { uploadId: body.uploadId, taille: 9 * MIO }, d)).status).toBe(400);
  });

  it('la garde de sortie s applique aux URL de morceaux', async () => {
    const s3 = s3Factice();
    const d = { client: s3.client, signeur: s3.signeur };
    const { body } = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 9 * MIO }, d);
    const r = await traiterActionDecoupe(LIGNE, 'multipart-sign', { uploadId: body.uploadId, partNumber: 1 }, { ...d, urlSure: () => false });
    expect(r.status).toBe(503);
    expect(r.body.url).toBeUndefined();
  });

  it('assemblage : morceau manquant ou taille fausse -> 422, envoi abandonne, aucun objet', async () => {
    const s3 = s3Factice();
    const d = { client: s3.client, signeur: s3.signeur };
    const { body } = await traiterActionDecoupe(LIGNE, 'multipart-initiate', { taille: 18 * MIO }, d);
    const id = String(body.uploadId);
    for (const n of [1, 3]) {
      const s = await traiterActionDecoupe(LIGNE, 'multipart-sign', { uploadId: id, partNumber: n }, d);
      await s3.deposer(String(s.body.url), new Blob([new Uint8Array(n === 3 ? 2 * MIO : 8 * MIO)]));
    }
    const r = await traiterActionDecoupe(LIGNE, 'multipart-complete', { uploadId: id, taille: 18 * MIO }, d);
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('incomplet');
    expect(s3.envois.size).toBe(0);
    expect(s3.objets.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B. Client
// ─────────────────────────────────────────────────────────────────────────
function blobAleatoire(octets: number): { blob: Blob; sha: string } {
  const data = randomBytes(octets);
  return { blob: new Blob([data], { type: 'video/webm' }), sha: createHash('sha256').update(data).digest('hex') };
}

describe('B. envoyerMontageDecoupe — reprise et honnetete', () => {
  it('un morceau qui echoue puis un qui reste muet (inactivite) sont re-essayes ; le fichier est identique', async () => {
    const s3 = s3Factice();
    const appels = brancher(s3);
    const { blob, sha } = blobAleatoire(30 * MIO);
    const essais = new Map<number, number>();
    const progres: number[] = [];
    const r = await envoyerMontageDecoupe('j1', blob, {
      attente: () => 0, inactiviteMs: 150, onProgress: (p) => progres.push(p),
      transport: async (url, corps, onOctets, signal) => {
        const n = Number(new URL(url).searchParams.get('partNumber'));
        const k = (essais.get(n) ?? 0) + 1;
        essais.set(n, k);
        if (n === 2 && k === 1) throw new EchecEnvoi('morceau : connexion perdue');
        if (n === 3 && k === 1) {
          // Muet : ne rend jamais la main tant qu'on ne le coupe pas.
          await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new EchecEnvoi('morceau : interrompu'))));
        }
        await s3.deposer(url, corps);
        onOctets(corps.size);
      },
    });
    expect(r).toEqual({ ok: true, taille: 30 * MIO, morceaux: 6 });
    expect(essais.get(2)).toBe(2);
    expect(essais.get(3)).toBe(2);
    const obj = s3.objets.get('moi/rendus/j1.depot.webm')!;
    expect(createHash('sha256').update(obj.data).digest('hex')).toBe(sha);
    // Une signature par ESSAI : jamais une URL expiree reutilisee.
    expect(appels.filter((a) => a.action === 'multipart-sign')).toHaveLength(8);
    expect(progres.at(-1)).toBe(100);
    expect(Math.max(...progres.slice(0, -1))).toBeLessThanOrEqual(99);
  });

  it('apres un morceau echoue (coupure du proxy a 60 s), un seul morceau en vol a la fois', async () => {
    const s3 = s3Factice();
    brancher(s3);
    const { blob, sha } = blobAleatoire(30 * MIO);
    let enCours = 0;
    let maxAvant = 0;
    let echoue = false;
    const apresEchec: number[] = [];
    const r = await envoyerMontageDecoupe('j1', blob, {
      attente: () => 0,
      transport: async (url, corps, onOctets) => {
        enCours += 1;
        if (echoue) apresEchec.push(enCours); else maxAvant = Math.max(maxAvant, enCours);
        try {
          await new Promise((res) => setTimeout(res, 5));
          if (!echoue && new URL(url).searchParams.get('partNumber') === '1') {
            echoue = true;
            throw new EchecEnvoi('morceau : connexion perdue');
          }
          await s3.deposer(url, corps);
          onOctets(corps.size);
        } finally { enCours -= 1; }
      },
    });
    expect(r).toEqual({ ok: true, taille: 30 * MIO, morceaux: 6 });
    expect(maxAvant).toBe(3);
    expect(apresEchec.length).toBeGreaterThan(0);
    expect(Math.max(...apresEchec)).toBe(1);
    expect(createHash('sha256').update(s3.objets.get('moi/rendus/j1.depot.webm')!.data).digest('hex')).toBe(sha);
  });

  it('echec definitif d un morceau -> EchecEnvoi, envoi decoupe abandonne, aucun objet', async () => {
    const s3 = s3Factice();
    const appels = brancher(s3);
    const { blob } = blobAleatoire(20 * MIO);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(envoyerMontageDecoupe('j1', blob, {
      attente: () => 0,
      transport: async (url, corps) => {
        if (new URL(url).searchParams.get('partNumber') === '2') throw new EchecEnvoi('morceau : connexion perdue');
        await s3.deposer(url, corps);
      },
    })).rejects.toBeInstanceOf(EchecEnvoi);
    expect(appels.at(-1)?.action).toBe('multipart-abort');
    expect(s3.envois.size).toBe(0);
    expect(s3.objets.size).toBe(0);
    // Aucune URL signee ni identifiant d'envoi dans les journaux.
    const journal = JSON.stringify(warn.mock.calls);
    expect(journal).not.toMatch(/X-Amz|uploadId=|up\d/);
  });

  it('serveur sans endpoint public -> `indisponible`, rien d ouvert (le client garde l envoi historique)', async () => {
    const s3 = s3Factice();
    brancher(s3, { ...LIGNE }, { signeur: null });
    const { blob } = blobAleatoire(10 * MIO);
    expect(await envoyerMontageDecoupe('j1', blob, { transport: async () => { throw new Error('jamais'); } }))
      .toEqual({ ok: false, indisponible: true });
  });

  it('tentative close pendant l envoi -> arret sans re-essais inutiles', async () => {
    const s3 = s3Factice();
    const ligne = { ...LIGNE };
    brancher(s3, ligne);
    const { blob } = blobAleatoire(20 * MIO);
    let puts = 0;
    await expect(envoyerMontageDecoupe('j1', blob, {
      attente: () => 0, parallelisme: 1,
      transport: async (url, corps) => { puts += 1; await s3.deposer(url, corps); ligne.etat = 'cancelled'; },
    })).rejects.toBeInstanceOf(EchecEnvoi);
    expect(puts).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// C. Bout en bout sur un VRAI MinIO local
// ─────────────────────────────────────────────────────────────────────────
const ENDPOINT = process.env.MINIO_TEST_ENDPOINT; // ex. 127.0.0.1:9100
const decrireMinio = ENDPOINT ? describe : describe.skip;

decrireMinio('C. bout en bout — MinIO local, 60 Mo, rendreEtFacturer', () => {
  const [hote, port] = String(ENDPOINT).split(':');
  const USER = 'u-test';
  const toutesLesCles: string[] = [];
  let minio: import('minio').Client;

  beforeAll(async () => {
    Object.assign(process.env, {
      MINIO_ENDPOINT: hote, MINIO_PORT: port, MINIO_USE_SSL: 'false',
      MINIO_PUBLIC_ENDPOINT: hote, MINIO_PUBLIC_PORT: port, MINIO_PUBLIC_USE_SSL: 'false',
      MINIO_ACCESS_KEY: process.env.MINIO_TEST_USER, MINIO_SECRET_KEY: process.env.MINIO_TEST_PASSWORD,
    });
    const { Client } = await import('minio');
    minio = new Client({
      endPoint: hote, port: Number(port), useSSL: false, region: 'us-east-1',
      accessKey: String(process.env.MINIO_TEST_USER), secretKey: String(process.env.MINIO_TEST_PASSWORD),
    });
    if (!(await minio.bucketExists('media'))) await minio.makeBucket('media', 'us-east-1');
  });

  /**
   * Le serveur, en miniature : la VRAIE logique de decoupe, la VRAIE
   * promotion du depot et la VRAIE preuve (`verifierObjet`). Le debit est
   * compte la ou `confirmer_rendu` le ferait : seulement si la preuve passe.
   */
  async function serveur(options: { couperMorceau?: number; couperToujours?: boolean } = {}) {
    const { clientEnvoiDecoupe, signeurPartiesPublic } = await import('@/lib/storage/minio-client');
    const { promouvoirDepot } = await import('@/lib/rendus/depot');
    const { verifierObjet } = await import('@/lib/storage/verifier-objet');
    const etat = { tentatives: new Map<string, { id: string; bucket: string; cle_objet: string; etat: string }>(), debits: 0, annulations: 0, n: 0, morceauxEnvoyes: [] as number[] };
    const coupes = new Map<number, number>();
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (u === '/api/render/jobs' && init?.method === 'POST') {
        const id = `job-${Date.now()}-${++etat.n}`;
        etat.tentatives.set(id, { id, bucket: 'media', cle_objet: `${USER}/rendus/${id}.webm`, etat: 'reserved' });
        toutesLesCles.push(`${USER}/rendus/${id}.webm`);
        return json({ ok: true, jobId: id, uploadUrl: `/api/render/jobs/${id}/upload`, uploadMode: 'relais', publicUrl: `/storage/v1/object/public/media/${USER}/rendus/${id}.webm`, cout: 10 });
      }
      const m = /^\/api\/render\/jobs\/([^/]+)\/(upload|confirm|cancel)$/.exec(u);
      if (m) {
        const t = etat.tentatives.get(m[1])!;
        if (m[2] === 'upload') {
          const corps = JSON.parse(String(init?.body || '{}'));
          const r = await traiterActionDecoupe(t, corps.action, corps, {
            client: clientEnvoiDecoupe(), signeur: signeurPartiesPublic(), urlSure: () => true,
          });
          return json(r.body, r.status);
        }
        if (m[2] === 'cancel') {
          if (t.etat === 'reserved') { t.etat = 'cancelled'; etat.annulations += 1; }
          return json({ ok: true, etat: t.etat });
        }
        // confirm
        if (t.etat === 'confirmed') return json({ ok: true, etat: 'confirmed', dejaConfirme: true });
        await promouvoirDepot(t.bucket, t.cle_objet);
        const preuve = await verifierObjet(t.bucket, t.cle_objet, USER);
        if (!preuve.ok) { t.etat = 'failed'; return json({ ok: false, motif: preuve.motif }, 422); }
        t.etat = 'confirmed';
        etat.debits += 1;
        return json({ ok: true, etat: 'confirmed', taille: preuve.taille });
      }
      // Morceaux : vers le vrai MinIO, avec pannes injectees.
      if (u.startsWith(`http://${ENDPOINT}/`)) {
        const n = Number(new URL(u).searchParams.get('partNumber'));
        const k = (coupes.get(n) ?? 0) + 1;
        coupes.set(n, k);
        if (n === options.couperMorceau && (options.couperToujours || k === 1)) {
          throw new TypeError('net::ERR_TIMED_OUT (simule)');
        }
        etat.morceauxEnvoyes.push(n);
        return vraiFetch(u, init);
      }
      throw new Error(`fetch inattendu ${u}`);
    }) as typeof fetch;
    return etat;
  }

  async function sha256Objet(cle: string): Promise<{ sha: string; taille: number }> {
    const flux = await minio.getObject('media', cle);
    const h = createHash('sha256');
    let taille = 0;
    for await (const c of flux) { h.update(c as Buffer); taille += (c as Buffer).length; }
    return { sha: h.digest('hex'), taille };
  }

  /**
   * Envois decoupes encore ouverts sur les depots de TOUTES les tentatives.
   * ⚠️ MinIO ne liste les envois incomplets que pour une cle EXACTE (pas
   * par prefixe) : on interroge donc chaque depot.
   */
  async function envoisIncomplets(): Promise<number> {
    let n = 0;
    for (const cle of toutesLesCles) {
      const depot = cle.replace(/\.webm$/, '.depot.webm');
      await new Promise<void>((res, rej) => {
        const s = minio.listIncompleteUploads('media', depot, false);
        s.on('data', (u: { key: string }) => { if (u.key === depot) n += 1; });
        s.on('end', () => res()); s.on('error', rej);
      });
    }
    return n;
  }

  it('reussite : 60 Mo, un morceau coupe puis repris — taille et sha256 identiques, un debit, un post', async () => {
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const etat = await serveur({ couperMorceau: 4 });
    const { blob, sha } = blobAleatoire(60 * MIO);
    const etapes: string[] = [];
    const posts: string[] = [];
    const t0 = Date.now();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const l = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer: async () => blob, etape: (e) => etapes.push(e) });
    const duree = Date.now() - t0;
    if (l.ok) posts.push(String(l.url));
    expect(l.ok).toBe(true);
    const t = [...etat.tentatives.values()][0];
    const obj = await sha256Objet(t.cle_objet);
    console.info(`[preuve 60 Mo] taille=${obj.taille} sha256=${obj.sha} attendu=${sha} duree=${duree} ms`);
    expect(obj).toEqual({ sha, taille: 60 * MIO });
    expect(etat.debits).toBe(1);
    expect(posts).toHaveLength(1);
    expect(etat.annulations).toBe(0);
    expect(etapes.some((e) => /Envoi du montage… \d+ %/.test(e))).toBe(true);
    // Le depot a ete promu puis efface : aucun reliquat.
    await expect(minio.statObject('media', t.cle_objet.replace('.webm', '.depot.webm'))).rejects.toBeTruthy();
    // Le temoin d'envoi (uploadId + taille declaree) est efface a l'assemblage.
    await expect(minio.statObject('media', t.cle_objet.replace('.webm', '.depot.webm.envoi.json'))).rejects.toBeTruthy();
    expect(await envoisIncomplets()).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/X-Amz-Signature|uploadId=/);
  }, 120_000);

  it('echec definitif puis reessai : 0 debit / 0 post au premier, puis exactement 1 et 1 — aucun doublon', async () => {
    const { rendreEtFacturer, messagePour } = await import('@/lib/rendus/client');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const etat = await serveur({ couperMorceau: 2, couperToujours: true });
    const { blob, sha } = blobAleatoire(60 * MIO);
    const posts: string[] = [];
    const l1 = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer: async () => blob });
    if (l1.ok) posts.push(String(l1.url));
    expect(l1.ok).toBe(false);
    expect(messagePour(l1.motif)).toBe('L’envoi du montage a échoué. Rien n’a été débité.');
    expect(etat.debits).toBe(0);
    expect(posts).toHaveLength(0);
    expect(etat.annulations).toBe(1);
    expect(await envoisIncomplets()).toBe(0);
    const t1 = [...etat.tentatives.values()][0];
    await expect(minio.statObject('media', t1.cle_objet)).rejects.toBeTruthy();

    // Reessai (le reseau est revenu) : nouvelle tentative, un seul debit.
    const etat2 = await serveur();
    const l2 = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer: async () => blob });
    if (l2.ok) posts.push(String(l2.url));
    expect(l2.ok).toBe(true);
    expect(etat2.debits).toBe(1);
    expect(posts).toHaveLength(1);
    const t2 = [...etat2.tentatives.values()][0];
    expect((await sha256Objet(t2.cle_objet)).sha).toBe(sha);
  }, 180_000);

  it('REPRISE sans recomposition : envoi coupe -> rien debite, montage garde ; « Réessayer l envoi » ne renvoie que les morceaux manquants', async () => {
    const { rendreEtFacturer, envoiEnAttente } = await import('@/lib/rendus/client');
    const { composerEtFacturer } = await import('@/lib/rendus/composer');
    void composerEtFacturer;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pannes = { couperMorceau: 6, couperToujours: true };
    const etat = await serveur(pannes);
    const { blob, sha } = blobAleatoire(60 * MIO);
    const vignette = new Blob(['jpeg'], { type: 'image/jpeg' });
    const composer = vi.fn(async () => ({ video: blob, annexe: vignette }));
    const posts: string[] = [];

    const l1 = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer, cleReprise: 'sig-A' });
    expect(l1).toMatchObject({ ok: false, motif: 'televersement', reprenable: true });
    expect(composer).toHaveBeenCalledTimes(1);
    expect(etat.debits).toBe(0);
    expect(etat.annulations).toBe(0); // tentative gardee ouverte, sans debit
    expect(posts).toHaveLength(0);
    expect(envoiEnAttente()).toBe(true);
    expect(await envoisIncomplets()).toBe(1); // morceaux deposes conserves
    const deja = new Set(etat.morceauxEnvoyes);
    expect(deja.size).toBe(11); // 12 morceaux de 5 Mio, le 6e jamais passe

    // Le reseau revient ; l'utilisateur clique « Réessayer l'envoi ».
    pannes.couperToujours = false;
    pannes.couperMorceau = 0;
    etat.morceauxEnvoyes.length = 0;
    const l2 = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer, cleReprise: 'sig-A' });
    if (l2.ok) posts.push(String(l2.url));
    expect(l2.ok).toBe(true);
    expect(composer).toHaveBeenCalledTimes(1); // le compositeur n'est PAS rappele
    expect(l2.annexe).toBe(vignette);          // la vignette revient avec le montage
    expect(etat.morceauxEnvoyes).toEqual([6]); // seul le morceau manquant repart
    expect(etat.debits).toBe(1);
    expect(posts).toHaveLength(1);
    expect(etat.tentatives.size).toBe(1);      // meme tentative, aucun doublon
    expect(envoiEnAttente()).toBe(false);
    const t = [...etat.tentatives.values()][0];
    expect(await sha256Objet(t.cle_objet)).toEqual({ sha, taille: 60 * MIO });
    expect(await envoisIncomplets()).toBe(0);
  }, 180_000);

  it('REPRISE apres tentative close entre-temps : nouvelle tentative, toujours sans recomposer, un seul debit', async () => {
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pannes = { couperMorceau: 2, couperToujours: true };
    const etat = await serveur(pannes);
    const { blob, sha } = blobAleatoire(20 * MIO);
    const composer = vi.fn(async () => blob);
    const l1 = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer, cleReprise: 'sig-B' });
    expect(l1.reprenable).toBe(true);
    // La tentative est fermee cote serveur (expiration, autre onglet…).
    [...etat.tentatives.values()][0].etat = 'cancelled';
    pannes.couperToujours = false;
    pannes.couperMorceau = 0;
    const l2 = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer, cleReprise: 'sig-B' });
    expect(l2.ok).toBe(true);
    expect(composer).toHaveBeenCalledTimes(1);
    expect(etat.tentatives.size).toBe(2);
    expect(etat.debits).toBe(1);
    const t2 = [...etat.tentatives.values()][1];
    expect((await sha256Objet(t2.cle_objet)).sha).toBe(sha);
    expect(await envoisIncomplets()).toBe(0);
  }, 180_000);

  /**
   * Le proxy de `s3.studiio.pro` ferme toute requete au-dela de 60 s sans
   * reponse (mesure le 23/10). Reproduit ici a l'echelle 1/20 : 3 s de
   * coupure, 2 Mio/s de debit montant PARTAGE entre les connexions.
   */
  it('proxy qui coupe a 3 s, debit 2 Mio/s : PUT unique et 3 x 8 Mio echouent ; 5 Mio adaptatif passe, fichier identique', async () => {
    const http = await import('http');
    const COUPURE_MS = 3_000;
    const DEBIT = 2 * MIO;
    let libre = Date.now();
    const proxy = http.createServer((req, res) => {
      const amont = http.request({ host: hote, port: Number(port), method: req.method, path: req.url, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res);
      });
      amont.on('error', () => res.destroy());
      const coupe = setTimeout(() => { amont.destroy(); req.socket.destroy(); }, COUPURE_MS);
      res.on('close', () => clearTimeout(coupe));
      req.on('data', (c: Buffer) => {
        req.pause();
        libre = Math.max(Date.now(), libre) + (c.length / DEBIT) * 1000;
        setTimeout(() => { amont.write(c); req.resume(); }, libre - Date.now());
      });
      req.on('end', () => { setTimeout(() => amont.end(), Math.max(0, libre - Date.now())); });
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
    const portProxy = (proxy.address() as { port: number }).port;
    const portPublic = process.env.MINIO_PUBLIC_PORT;
    process.env.MINIO_PUBLIC_PORT = String(portProxy);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { clientEnvoiDecoupe, signeurPartiesPublic, signeurPublic } = await import('@/lib/storage/minio-client');
      const { blob, sha } = blobAleatoire(20 * MIO);

      // Avant #619 : un seul PUT de 20 Mio -> 10 s > 3 s, coupe.
      const urlUnique = await signeurPublic()!.presignedPutObject('media', `${USER}/rendus/unique.webm`, 300);
      await expect(vraiFetch(urlUnique, { method: 'PUT', body: blob })).rejects.toBeTruthy();

      const lancer = (id: string, options: Parameters<typeof envoyerMontageDecoupe>[2]) => {
        const t = { id, bucket: 'media', cle_objet: `${USER}/rendus/${id}.webm`, etat: 'reserved' };
        toutesLesCles.push(t.cle_objet);
        globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
          const u = String(url);
          if (u.startsWith('/api/')) {
            const corps = JSON.parse(String(init?.body || '{}'));
            const r = await traiterActionDecoupe(t, corps.action, corps, {
              client: clientEnvoiDecoupe(), signeur: signeurPartiesPublic(), urlSure: () => true,
            });
            return new Response(JSON.stringify(r.body), { status: r.status });
          }
          return vraiFetch(u, init);
        }) as typeof fetch;
        return envoyerMontageDecoupe(id, blob, { attente: () => 200, ...options });
      };

      // Premiere version de #619 : 3 morceaux de 8 Mio en parallele -> toujours coupes.
      libre = Date.now();
      await expect(lancer('proxy-8mio', { tailleMorceau: 8 * MIO, parallelisme: 3 })).rejects.toBeInstanceOf(EchecEnvoi);

      // Correction : 5 Mio, et un seul morceau en vol des le premier echec.
      libre = Date.now();
      const t0 = Date.now();
      const r = await lancer('proxy-5mio', {});
      console.info(`[preuve proxy] 20 Mio en ${Date.now() - t0} ms, ${r.ok ? r.morceaux : 0} morceaux`);
      expect(r).toEqual({ ok: true, taille: 20 * MIO, morceaux: 4 });
      expect(await sha256Objet(`${USER}/rendus/proxy-5mio.depot.webm`)).toEqual({ sha, taille: 20 * MIO });
      expect(await envoisIncomplets()).toBe(0);
    } finally {
      process.env.MINIO_PUBLIC_PORT = portPublic;
      await new Promise((r) => proxy.close(r));
    }
  }, 180_000);

  it('un AUTRE contenu efface le montage en attente (jamais d envoi d un montage perime)', async () => {
    const { rendreEtFacturer, envoiEnAttente } = await import('@/lib/rendus/client');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pannes = { couperMorceau: 1, couperToujours: true };
    const etat = await serveur(pannes);
    const ancien = blobAleatoire(20 * MIO);
    await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer: async () => ancien.blob, cleReprise: 'sig-C' });
    expect(envoiEnAttente()).toBe(true);
    pannes.couperToujours = false;
    pannes.couperMorceau = 0;
    const neuf = blobAleatoire(20 * MIO);
    const composer = vi.fn(async () => neuf.blob);
    const l = await rendreEtFacturer({ operation: 'calendrier', format: 'reel', composer, cleReprise: 'sig-D' });
    expect(l.ok).toBe(true);
    expect(composer).toHaveBeenCalledTimes(1);
    expect(etat.annulations).toBe(1); // l'ancienne tentative est close
    const t = [...etat.tentatives.values()][1];
    expect((await sha256Objet(t.cle_objet)).sha).toBe(neuf.sha);
    expect(await envoisIncomplets()).toBe(0);
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────────────────
// D. Branchement dans Créer (source)
// ─────────────────────────────────────────────────────────────────────────
describe('D. Créer — « Réessayer l’envoi » branché sur la reprise', () => {
  it('les deux chemins factures passent la signature du contenu ; bouton discret, jamais sur une serie', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const w = readFileSync(join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(w.match(/cleReprise: signature,/g)?.length).toBe(2);
    expect(w).toContain('data-reprise-envoi');
    expect(w).toContain('Réessayer l’envoi');
    expect(w.match(/reprenable[^\n]*&& total === 1\) setRepriseEnvoi\(destination\)/g)?.length).toBe(2);
    // Un nouveau lancement efface l'offre de reprise avant tout.
    expect(w).toMatch(/if \(!prendre\(VERROU\.serie\)\) return;\n\s*setRepriseEnvoi\(null\);/);
  });
});
