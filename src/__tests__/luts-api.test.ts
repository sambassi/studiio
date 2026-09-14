// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LUTS_MAX } from '@/lib/luts/bibliotheque';
import { MAX_LUT_BYTES } from '@/lib/luts/types';

/**
 * A2 — l'API de la bibliothèque de LUT, appelée pour de vrai.
 *
 * La base est doublée en mémoire (table + fonction `lut_assets_ajouter` +
 * stockage) : elle reproduit le CONTRAT de la migration — unicité
 * (user_id, empreinte), plafond, filtrage par compte — pas sa concurrence.
 * L'atomicité réelle est prouvée sur PostgreSQL (tests-pg/lut-assets.pg.test.ts).
 *
 * Ce que ces tests protègent :
 * - 401 sans session ; 400 / 413 / 422 / 409 avec leur motif ;
 * - le poids est refusé AVANT `arrayBuffer()` ;
 * - un doublon est la même ressource logique, l'objet écrit une fois par clé ;
 * - autrui → 404 sur GET / PATCH / DELETE, jamais 403, MinIO jamais interrogé ;
 * - fiche supprimée d'abord, objet ensuite, jamais l'objet d'autrui ;
 * - objet écrit mais fiche refusée → objet conservé, aucune suppression.
 */

// ── La base doublée ─────────────────────────────────────────────────────
interface Ligne {
  id: string; user_id: string; empreinte: string; cle: string; nom: string; titre: string | null;
  kind: string; origine: string; taille: number; octets: number;
  domain_min: number[]; domain_max: number[]; importee_le: string;
}
const etat = vi.hoisted(() => ({
  lignes: [] as Ligne[],
  objets: new Map<string, { octets: Uint8Array; type: string }>(),
  journal: [] as string[],
  socleAbsent: false,
  uploadCasse: false,
  removeCasse: false,
  rpcCasse: false,
}));

vi.mock('@/lib/db/supabase', () => {
  type Filtre = Record<string, unknown>;
  const filtrer = (f: Filtre) => etat.lignes.filter((l) => Object.entries(f).every(([k, v]) => (l as never)[k] === v));
  const erreurSocle = { code: '42P01', message: 'relation "lut_assets" does not exist' };
  const from = (table: string) => {
    if (table !== 'lut_assets') throw new Error(`table inattendue ${table}`);
    const chaine = (op: 'select' | 'update' | 'delete', patch?: Partial<Ligne>) => {
      const f: Filtre = {};
      const api = {
        eq(k: string, v: unknown) { f[k] = v; return api; },
        order() { return api; },
        limit(n: number) { return Promise.resolve(fin(n)); },
        select() { return api; },
        maybeSingle() { const r = fin(1); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
        then(res: (v: unknown) => void, rej: (e: unknown) => void) { Promise.resolve(fin()).then(res, rej); },
      };
      const fin = (limite?: number) => {
        if (etat.socleAbsent) return { data: null as Ligne[] | null, error: erreurSocle };
        etat.journal.push(`${op}:${JSON.stringify(f)}`);
        let vues = filtrer(f);
        if (op === 'update') vues.forEach((l) => Object.assign(l, patch));
        if (op === 'delete') etat.lignes = etat.lignes.filter((l) => !vues.includes(l));
        if (limite) vues = vues.slice(0, limite);
        return { data: vues.map((l) => ({ ...l })), error: null };
      };
      return api;
    };
    return {
      select: () => chaine('select'),
      update: (patch: Partial<Ligne>) => chaine('update', patch),
      delete: () => chaine('delete'),
    };
  };
  const rpc = async (nom: string, a: Record<string, unknown>) => {
    if (nom !== 'lut_assets_ajouter') throw new Error(`rpc inattendue ${nom}`);
    if (etat.socleAbsent) return { data: null, error: { code: 'PGRST202', message: 'function not in schema cache' } };
    if (etat.rpcCasse) return { data: null, error: { code: 'XX000', message: 'panne' } };
    etat.journal.push(`rpc:${a.p_empreinte}`);
    const u = a.p_user_id as string;
    const deja = etat.lignes.find((l) => l.user_id === u && l.empreinte === a.p_empreinte);
    if (deja) return { data: [{ issue: 'existante', id: deja.id }], error: null };
    // Le plafond est celui de la BASE, pas un paramètre : la doublure refuse
    // qu'on lui en transmette un, comme la vraie fonction (signature sans p_max).
    if ('p_max' in a) return { data: null, error: { code: 'PGRST202', message: 'no function matches' } };
    if (etat.lignes.filter((l) => l.user_id === u).length >= 40) {
      return { data: [{ issue: 'pleine', id: null }], error: null };
    }
    const ligne: Ligne = {
      id: `id-${etat.lignes.length + 1}`, user_id: u, empreinte: a.p_empreinte as string,
      cle: a.p_cle as string, nom: a.p_nom as string, titre: a.p_titre as string | null,
      kind: a.p_kind as string, origine: a.p_origine as string, taille: a.p_taille as number,
      octets: a.p_octets as number, domain_min: a.p_domain_min as number[],
      domain_max: a.p_domain_max as number[], importee_le: new Date().toISOString(),
    };
    etat.lignes.push(ligne);
    return { data: [{ issue: 'creee', id: ligne.id }], error: null };
  };
  const storage = {
    from: (bucket: string) => ({
      async upload(cle: string, octets: Uint8Array, opts: { contentType: string; upsert: boolean }) {
        etat.journal.push(`upload:${bucket}/${cle}`);
        if (etat.uploadCasse) return { data: null, error: { message: 'minio injoignable' } };
        if (!opts.upsert) throw new Error('upsert attendu');
        etat.objets.set(`${bucket}/${cle}`, { octets, type: opts.contentType });
        return { data: { path: cle }, error: null };
      },
      async remove(cles: string[]) {
        etat.journal.push(`remove:${bucket}/${cles.join(',')}`);
        if (etat.removeCasse) return { data: null, error: { message: 'panne' } };
        cles.forEach((c) => etat.objets.delete(`${bucket}/${c}`));
        return { data: cles, error: null };
      },
    }),
  };
  return { supabase: {}, supabaseAdmin: { from, rpc, storage } };
});

vi.mock('@/lib/storage/minio-client', () => ({
  lecteurMinio: () => ({
    async getObject(bucket: string, cle: string) {
      etat.journal.push(`get:${bucket}/${cle}`);
      const o = etat.objets.get(`${bucket}/${cle}`);
      if (!o) throw Object.assign(new Error('Not found'), { code: 'NoSuchKey' });
      const { Readable } = await import('node:stream');
      return Readable.from([Buffer.from(o.octets)]);
    },
  }),
}));

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante, DEV_AUTH_BYPASS: false }));

const { GET: LISTER, POST } = await import('@/app/api/creatif/luts/route');
const { GET: LIRE, PATCH, DELETE } = await import('@/app/api/creatif/luts/[empreinte]/route');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const BASE = 'https://studiio.pro/api/creatif/luts';

const IDENTITY_2 = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
/** Un cube de 2 dont une valeur change : une autre LUT. */
const AUTRE = IDENTITY_2.replace('1 1 1\n', '0.5 0.5 0.5\n');
const cubeN = (n: number) => `LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n${(n / 1000).toFixed(3)} 1 1\n`;

function requetePost(texte: string | ArrayBuffer, nomFichier = 'look.cube', champs: Record<string, string> = {}) {
  const form = new FormData();
  form.set('fichier', new File([texte], nomFichier, { type: 'application/octet-stream' }));
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  return new Request(BASE, { method: 'POST', body: form });
}
const post = (texte: string | ArrayBuffer, nom?: string, champs?: Record<string, string>) =>
  POST(requetePost(texte, nom, champs) as never);
const ctx = (empreinte: string) => ({ params: { empreinte } });
const lire = (e: string) => LIRE(new Request(`${BASE}/${e}`) as never, ctx(e));
const renommer = (e: string, corps: unknown) =>
  PATCH(new Request(`${BASE}/${e}`, { method: 'PATCH', body: typeof corps === 'string' ? corps : JSON.stringify(corps) }) as never, ctx(e));
const supprimer = (e: string) => DELETE(new Request(`${BASE}/${e}`, { method: 'DELETE' }) as never, ctx(e));

async function importer(texte: string | ArrayBuffer = IDENTITY_2, nom?: string, champs?: Record<string, string>) {
  const res = await post(texte, nom, champs);
  const corps = await res.json() as { ok: boolean; issue?: string; lut?: { empreinte: string; cle: string; nom: string; kind: string; origine: string }; motif?: string };
  return { statut: res.status, ...corps };
}

beforeEach(() => {
  etat.lignes = [];
  etat.objets.clear();
  etat.journal.length = 0;
  etat.socleAbsent = false;
  etat.uploadCasse = false;
  etat.removeCasse = false;
  etat.rpcCasse = false;
  session.courante = { user: { id: A } };
});

describe('1. Authentification', () => {
  it('401 sans session, sur les cinq opérations', async () => {
    session.courante = null;
    expect((await LISTER()).status).toBe(401);
    expect((await post(IDENTITY_2)).status).toBe(401);
    expect((await lire('a'.repeat(64))).status).toBe(401);
    expect((await renommer('a'.repeat(64), { nom: 'x' })).status).toBe(401);
    expect((await supprimer('a'.repeat(64))).status).toBe(401);
    expect(etat.journal).toEqual([]);
  });
});

describe('2. Import', () => {
  it('importe un .cube : 201, fiche conforme, objet privé écrit sous la clé du compte', async () => {
    const r = await importer(IDENTITY_2, 'Mon look.cube');
    expect(r.statut).toBe(201);
    expect(r.issue).toBe('creee');
    expect(r.lut!.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(r.lut!.cle).toBe(`${A}/lut/${r.lut!.empreinte}.cube`);
    expect(r.lut!.nom).toBe('Mon look');
    expect(r.lut!.kind).toBe('3d');
    expect(r.lut!.origine).toBe('cube');
    const objet = etat.objets.get(`media/${r.lut!.cle}`)!;
    expect(objet).toBeDefined();
    expect(objet.type).toBe('text/plain');
    // Ce qui est stocké est la forme CANONIQUE, pas le fichier reçu.
    expect(Buffer.from(objet.octets).toString('utf8')).toContain('1.000000 1.000000 1.000000');
    expect(JSON.stringify(r)).not.toMatch(/https?:\/\//);
  });

  it('honore un nom fourni, borné et nettoyé ; note l’origine png', async () => {
    const r = await importer(IDENTITY_2, 'x.cube', { nom: '  Teal\n& Orange  ', origine: 'png' });
    expect(r.lut!.nom).toBe('Teal & Orange');
    expect(r.lut!.origine).toBe('png');
    const r2 = await importer(AUTRE, 'y.cube', { origine: 'jpg' });
    expect(r2.lut!.origine).toBe('cube');
  });

  it('400 sans fichier ou sur un corps qui n’est pas un formulaire', async () => {
    const vide = new FormData();
    expect((await POST(new Request(BASE, { method: 'POST', body: vide }) as never)).status).toBe(400);
    expect((await POST(new Request(BASE, { method: 'POST', body: 'pas un formulaire' }) as never)).status).toBe(400);
  });

  it('⚠️ > 8 Mio → 413 AVANT toute lecture du contenu et sans écriture', async () => {
    // Un vrai fichier d'un octet de trop, au contenu INVALIDE : si le poids
    // n'était pas jugé en premier, la réponse serait 422 « cube_invalide ».
    // Et le corps n'est jamais chargé : `arrayBuffer` n'est pas appelé.
    const gros = 'x'.repeat(MAX_LUT_BYTES + 1);
    const arrayBuffer = vi.spyOn(Blob.prototype, 'arrayBuffer');
    try {
      const res = await post(gros, 'gros.cube');
      expect(res.status).toBe(413);
      expect((await res.json()).motif).toBe('trop_volumineux');
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(etat.journal).toEqual([]);
    } finally {
      arrayBuffer.mockRestore();
    }
  });

  it('422 avec le motif précis pour une LUT invalide, sans écriture', async () => {
    for (const [texte, motif] of [
      ['LUT_3D_SIZE 2\n0 0 0\n', 'cube_invalide'],
      ['LUT_3D_SIZE 66\n0 0 0\n', 'taille_hors_bornes'],
      ['LUT_1D_SIZE 65537\n0 0 0\n', 'taille_hors_bornes'],
      ['   ', 'fichier_vide'],
    ] as const) {
      const r = await importer(texte);
      expect(r.statut, texte).toBe(422);
      expect(r.motif, texte).toBe(motif);
    }
    const r = await importer(new Uint8Array([0x4c, 0x55, 0x54, 0, 1, 2]).buffer);
    expect(r.statut).toBe(422);
    expect(r.motif).toBe('binaire');
    expect(etat.journal).toEqual([]);
    expect(etat.objets.size).toBe(0);
  });

  it('une 1D est importée, avec sa nature', async () => {
    const r = await importer('LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1\n');
    expect(r.statut).toBe(201);
    expect(r.lut!.kind).toBe('1d');
  });

  it('⚠️ doublon : même ressource logique, 200 « existante », objet écrit sur la même clé', async () => {
    const un = await importer(IDENTITY_2, 'a.cube', { nom: 'Premier' });
    const deux = await importer(`# commentaire\n${IDENTITY_2}`, 'b.cube', { nom: 'Second' });
    expect(deux.statut).toBe(200);
    expect(deux.issue).toBe('existante');
    expect(deux.lut!.empreinte).toBe(un.lut!.empreinte);
    // Le nom d'origine est conservé : le renommage a son propre geste.
    expect(deux.lut!.nom).toBe('Premier');
    expect(etat.lignes).toHaveLength(1);
    expect(etat.journal.filter((j) => j.startsWith('upload:'))).toHaveLength(2);
    expect(etat.journal.filter((j) => j.startsWith('remove:'))).toHaveLength(0);
    expect(etat.objets.size).toBe(1);
  });

  it('⚠️ à 40, un import supplémentaire est refusé 409 ; un doublon passe encore', async () => {
    for (let i = 1; i <= LUTS_MAX; i++) expect((await importer(cubeN(i))).statut).toBe(201);
    const refus = await importer(cubeN(999));
    expect(refus.statut).toBe(409);
    expect(refus.motif).toBe('bibliotheque_pleine');
    expect(etat.lignes).toHaveLength(LUTS_MAX);
    expect((await importer(cubeN(3))).issue).toBe('existante');
  });

  it('⚠️ objet écrit mais fiche refusée : l’objet reste, rien n’est supprimé, la réponse est sûre', async () => {
    for (let i = 1; i <= LUTS_MAX; i++) await importer(cubeN(i));
    const avant = etat.objets.size;
    const r = await importer(cubeN(999));
    expect(r.statut).toBe(409);
    expect(etat.objets.size).toBe(avant + 1);
    expect(etat.journal.filter((j) => j.startsWith('remove:'))).toHaveLength(0);
    expect(JSON.stringify(r)).not.toMatch(/https?:\/\/|\/lut\//);
  });

  it('échec du stockage → 500 sans fiche ; échec de la base → 500, objet conservé', async () => {
    etat.uploadCasse = true;
    const r1 = await importer(IDENTITY_2);
    expect(r1.statut).toBe(500);
    expect(etat.lignes).toHaveLength(0);

    etat.uploadCasse = false;
    etat.rpcCasse = true;
    const r2 = await importer(IDENTITY_2);
    expect(r2.statut).toBe(500);
    expect(etat.objets.size).toBe(1);
    expect(etat.journal.filter((j) => j.startsWith('remove:'))).toHaveLength(0);
  });

  it('503 « socle_absent » tant que la migration n’est pas appliquée', async () => {
    etat.socleAbsent = true;
    expect((await LISTER()).status).toBe(503);
    expect((await importer(IDENTITY_2)).statut).toBe(503);
  });
});

describe('3. Liste', () => {
  it('ne rend que les LUT du compte, private/no-store', async () => {
    await importer(IDENTITY_2);
    session.courante = { user: { id: B } };
    await importer(AUTRE);
    const res = await LISTER();
    const corps = await res.json() as { luts: { cle: string }[]; limite: number };
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(corps.luts).toHaveLength(1);
    expect(corps.luts[0].cle.startsWith(`${B}/lut/`)).toBe(true);
    expect(corps.limite).toBe(LUTS_MAX);
  });
});

describe('4. Lecture des octets', () => {
  it('le propriétaire lit son .cube, no-store, sans URL', async () => {
    const { lut } = await importer(IDENTITY_2, 'x.cube', { nom: 'Teal "Orange"' });
    const res = await lire(lut!.empreinte);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    // Le guillemet du nom ne peut pas casser l'en-tête.
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Teal Orange.cube"');
    const texte = await res.text();
    expect(texte).toContain('LUT_3D_SIZE 2');
    expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(texte)));
  });

  it('⚠️ autrui → 404, jamais 403, MinIO jamais interrogé', async () => {
    const { lut } = await importer(IDENTITY_2);
    session.courante = { user: { id: B } };
    const depuis = etat.journal.length;
    const res = await lire(lut!.empreinte);
    expect(res.status).toBe(404);
    expect(etat.journal.some((j) => j.startsWith('get:'))).toBe(false);
    // Le filtre par compte est dans LA REQUÊTE, pas seulement dans la relecture
    // A1 (qui rejette aussi une clé d'autrui) : deux gardes, chacune vérifiée.
    const requetes = etat.journal.slice(depuis).filter((j) => j.startsWith('select:'));
    expect(requetes.length).toBeGreaterThan(0);
    expect(requetes.every((j) => j.includes(`"user_id":"${B}"`))).toBe(true);
  });

  it('empreinte mal formée → 422 ; inconnue → 404', async () => {
    expect((await lire('pas-une-empreinte')).status).toBe(422);
    expect((await lire('A'.repeat(64))).status).toBe(422);
    expect((await lire('f'.repeat(64))).status).toBe(404);
  });

  it('fiche présente mais objet absent → 404, journalisé', async () => {
    const { lut } = await importer(IDENTITY_2);
    etat.objets.clear();
    expect((await lire(lut!.empreinte)).status).toBe(404);
  });
});

describe('5. Renommage', () => {
  it('le propriétaire renomme ; nom nettoyé et borné', async () => {
    const { lut } = await importer(IDENTITY_2);
    const res = await renommer(lut!.empreinte, { nom: '  Nouveau\tnom  ' });
    expect(res.status).toBe(200);
    expect((await res.json()).lut.nom).toBe('Nouveau nom');
    const long = await renommer(lut!.empreinte, { nom: 'x'.repeat(500) });
    expect((await long.json()).lut.nom).toHaveLength(100);
  });

  it('nom vide → 422 ; corps invalide → 400', async () => {
    const { lut } = await importer(IDENTITY_2);
    expect((await renommer(lut!.empreinte, { nom: '   ' })).status).toBe(422);
    expect((await renommer(lut!.empreinte, {})).status).toBe(422);
    expect((await renommer(lut!.empreinte, '{pas du json')).status).toBe(400);
  });

  it('⚠️ PATCH croisé → 404, et la fiche d’autrui n’a pas bougé', async () => {
    const { lut } = await importer(IDENTITY_2, 'x.cube', { nom: 'Original' });
    session.courante = { user: { id: B } };
    expect((await renommer(lut!.empreinte, { nom: 'Pirate' })).status).toBe(404);
    expect(etat.lignes[0].nom).toBe('Original');
    expect(etat.journal.filter((j) => j.startsWith('update:')).every((j) => j.includes(`"user_id":"${B}"`))).toBe(true);
  });
});

describe('6. Suppression', () => {
  it('le propriétaire supprime : la fiche d’abord, puis l’objet', async () => {
    const { lut } = await importer(IDENTITY_2);
    const res = await supprimer(lut!.empreinte);
    expect(res.status).toBe(200);
    expect(etat.lignes).toHaveLength(0);
    expect(etat.objets.size).toBe(0);
    const iDelete = etat.journal.findIndex((j) => j.startsWith('delete:'));
    const iRemove = etat.journal.findIndex((j) => j.startsWith('remove:'));
    expect(iDelete).toBeGreaterThanOrEqual(0);
    expect(iRemove).toBeGreaterThan(iDelete);
  });

  it('⚠️ DELETE croisé → 404 ; ni la fiche ni l’objet d’autrui ne bougent', async () => {
    const { lut } = await importer(IDENTITY_2);
    session.courante = { user: { id: B } };
    expect((await supprimer(lut!.empreinte)).status).toBe(404);
    expect(etat.lignes).toHaveLength(1);
    expect(etat.objets.size).toBe(1);
    expect(etat.journal.some((j) => j.startsWith('remove:'))).toBe(false);
    expect(etat.journal.filter((j) => j.startsWith('delete:')).every((j) => j.includes(`"user_id":"${B}"`))).toBe(true);
  });

  it('⚠️ deux comptes, même empreinte : supprimer chez A ne touche pas l’objet de B', async () => {
    const { lut } = await importer(IDENTITY_2);
    session.courante = { user: { id: B } };
    await importer(IDENTITY_2);
    expect(etat.objets.size).toBe(2);
    session.courante = { user: { id: A } };
    await supprimer(lut!.empreinte);
    expect(etat.objets.has(`media/${A}/lut/${lut!.empreinte}.cube`)).toBe(false);
    expect(etat.objets.has(`media/${B}/lut/${lut!.empreinte}.cube`)).toBe(true);
    expect(etat.lignes).toHaveLength(1);
    expect(etat.lignes[0].user_id).toBe(B);
  });

  it('objet impossible à effacer : la fiche est quand même partie, 200, orphelin journalisé', async () => {
    const { lut } = await importer(IDENTITY_2);
    etat.removeCasse = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await supprimer(lut!.empreinte)).status).toBe(200);
    expect(etat.lignes).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('inconnue → 404', async () => {
    expect((await supprimer('f'.repeat(64))).status).toBe(404);
  });
});
