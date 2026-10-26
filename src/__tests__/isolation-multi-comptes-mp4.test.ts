/**
 * MP4 DURABLE DE CRÉER — isolation entre comptes fictifs (administrateur + standards) et
 * indépendance du « montage amélioré » vis-à-vis du rôle. Base simulée EN MÉMOIRE qui honore
 * les filtres `.eq(...)` : si le code oubliait de filtrer sur `user_id`, un compte lirait
 * ou modifierait le post d'un autre et ces tests échoueraient.
 *
 * Ce que cela NE prouve PAS : la base, PostgREST et MinIO réels (non simulés ici).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile } from 'fs/promises';

type Ligne = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  tables: { scheduled_posts: [] as Ligne[], rendus: [] as Ligne[] } as Record<string, Ligne[]>,
  majs: [] as Array<{ table: string; id: unknown; user: unknown }>,
  tablesLues: new Set<string>(),
}));
const baux = vi.hoisted(() => ({
  /** Pool de baux simulé (mêmes règles que `rendu_bail_*`) ; `null` = fonctions absentes (migration non appliquée). */
  actif: false,
  pris: new Map<string, string>(),
}));
const spies = vi.hoisted(() => ({
  telechargements: [] as string[],
  controles: 0,
  deverrou: null as null | (() => void),
  bloquer: false,
}));

vi.mock('@/lib/db/supabase', () => {
  const requete = (table: string) => {
    bd.tablesLues.add(table);
    const filtres: Array<[string, unknown]> = [];
    let patch: Ligne | null = null;
    const lignes = () => (bd.tables[table] ?? []).filter((l) => filtres.every(([k, v]) => l[k] === v));
    const q: Record<string, unknown> = {
      select: () => q,
      update: (p: Ligne) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { filtres.push([k, v]); return q; },
      maybeSingle: async () => ({ data: lignes()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => {
        if (patch) {
          for (const l of lignes()) {
            Object.assign(l, patch);
            bd.majs.push({ table, id: l.id, user: l.user_id });
          }
        }
        return Promise.resolve({ data: null, error: null }).then(ok);
      },
    };
    return q;
  };
  return {
    supabaseAdmin: {
      rpc: async (fn: string, p: Record<string, unknown>) => {
        if (!baux.actif) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
        const job = String(p.p_job);
        if (fn === 'rendu_bail_prendre') {
          if (baux.pris.has(job)) return { data: [{ pris: false, motif: 'doublon', actifs: baux.pris.size }], error: null };
          if (baux.pris.size >= Number(p.p_max)) return { data: [{ pris: false, motif: 'occupe', actifs: baux.pris.size }], error: null };
          baux.pris.set(job, String(p.p_user));
          return { data: [{ pris: true, motif: null, actifs: baux.pris.size }], error: null };
        }
        if (fn === 'rendu_bail_liberer') { const ok = baux.pris.get(job) === p.p_user; if (ok) baux.pris.delete(job); return { data: [{ ok }], error: null }; }
        return { data: [{ ok: baux.pris.has(job) }], error: null };
      },
      from: requete,
      storage: { from: (b: string) => ({
        getPublicUrl: (cle: string) => ({ data: { publicUrl: `/storage/v1/object/public/${b}/${cle}` } }),
        upload: async () => ({ error: null }),
      }) },
    },
  };
});
vi.mock('@/lib/storage/minio-client', () => ({ clientMinio: () => ({}) }));
vi.mock('@/lib/storage/verifier-objet', () => ({ verifierObjet: async () => ({ ok: false }) }));
vi.mock('@/lib/storage/fetch-media', () => ({
  downloadMediaToFile: async (url: string, _p: string, o: { userId: string }) => { spies.telechargements.push(`${o.userId}|${url}`); },
}));
vi.mock('@/lib/ffmpeg/binaires', () => ({ cheminFfmpeg: () => 'ffmpeg' }));
vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({
  transcodeWebmToMp4WithLadder: async (_f: string, _in: string, sortie: string) => {
    if (spies.bloquer) await new Promise<void>((r) => { spies.deverrou = r; });
    const octets = Buffer.alloc(2048);
    octets.write('ftyp', 4);
    await writeFile(sortie, octets);
  },
}));
vi.mock('@/lib/render/controle-qualite-mp4', async () => {
  const actual = await vi.importActual<typeof import('@/lib/render/controle-qualite-mp4')>('@/lib/render/controle-qualite-mp4');
  return { ...actual, controlerMp4: async () => { spies.controles += 1; return { niveau: 'ok', problemes: [] }; } };
});

import { produireMp4DuPost } from '@/lib/rendus/mp4-durable-serveur';
import { montageAmelioreActifPourCompte } from '@/lib/creer/montage-ameliore-config';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const webm = (user: string, n: number) => `/storage/v1/object/public/media/${user}/rendus/${uuid(n)}.webm`;

/** Un post et son rendu confirmé, pour un compte. */
function poser(user: string, postId: string, n: number) {
  const url = webm(user, n);
  bd.tables.scheduled_posts.push({ id: postId, user_id: user, media_url: url, metadata: { renderedVideoUrl: url, sequences: { total: 20 }, videoFormat: '9:16' } });
  bd.tables.rendus.push({ id: uuid(n), user_id: user, etat: 'confirmed', cle_objet: `${user}/rendus/${uuid(n)}.webm` });
}
const meta = (postId: string) => bd.tables.scheduled_posts.find((p) => p.id === postId)!.metadata as Record<string, unknown>;

const ENV0 = { ...process.env };
beforeEach(() => {
  bd.tables.scheduled_posts = []; bd.tables.rendus = []; bd.majs = []; bd.tablesLues = new Set();
  baux.actif = false; baux.pris = new Map();
  spies.telechargements = []; spies.controles = 0; spies.deverrou = null; spies.bloquer = false;
  delete process.env.STORAGE_PROVIDER;
  delete process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED;
  delete process.env.STUDIIO_MONTAGE_AMELIORE_COMPTES;
  poser('admin-1', 'post-admin', 1);
  poser('user-b', 'post-b', 2);
  poser('user-c', 'post-c', 3);
});
afterEach(() => { process.env = { ...ENV0 }; });

describe('isolation : un compte ne touche jamais le post, le rendu ou le MP4 d’un autre', () => {
  it('un compte standard ne peut pas convertir le post d’un autre : introuvable, rien téléchargé, rien écrit', async () => {
    const avant = JSON.stringify(bd.tables);
    const r = await produireMp4DuPost('user-b', 'post-admin');
    expect(r).toEqual({ ok: false, motif: 'post_introuvable' });
    expect(spies.telechargements).toEqual([]);
    expect(bd.majs).toEqual([]);
    expect(JSON.stringify(bd.tables)).toBe(avant);
    expect(await produireMp4DuPost('admin-1', 'post-b')).toEqual({ ok: false, motif: 'post_introuvable' });
  });

  it('un post de B qui pointerait sur le rendu de l’administrateur n’obtient rien (clé d’un autre compte)', async () => {
    const lignePost = bd.tables.scheduled_posts.find((p) => p.id === 'post-b')!;
    lignePost.metadata = { renderedVideoUrl: webm('admin-1', 1) };
    const r = await produireMp4DuPost('user-b', 'post-b');
    expect(r).toEqual({ ok: false, motif: 'non_applicable' });
    expect(spies.telechargements).toEqual([]);
    expect(bd.majs).toEqual([]);
  });

  it('un rendu confirmé d’un autre compte ne valide pas le post de B (la lecture du rendu filtre aussi sur le compte)', async () => {
    bd.tables.rendus = bd.tables.rendus.filter((r) => r.user_id !== 'user-b');
    expect(await produireMp4DuPost('user-b', 'post-b')).toEqual({ ok: false, motif: 'non_confirme' });
    expect(spies.telechargements).toEqual([]);
  });

  it('chaque compte convertit SON post : seul ce post est mis à jour, les autres restent identiques', async () => {
    const avantAdmin = JSON.stringify(bd.tables.scheduled_posts.find((p) => p.id === 'post-admin'));
    const avantC = JSON.stringify(bd.tables.scheduled_posts.find((p) => p.id === 'post-c'));
    const r = await produireMp4DuPost('user-b', 'post-b');
    expect(r.ok).toBe(true);
    expect(bd.majs).toEqual([{ table: 'scheduled_posts', id: 'post-b', user: 'user-b' }]);
    expect(String(meta('post-b').renderedVideoUrl)).toContain(`/user-b/rendus/${uuid(2)}.mp4`);
    expect(JSON.stringify(bd.tables.scheduled_posts.find((p) => p.id === 'post-admin'))).toBe(avantAdmin);
    expect(JSON.stringify(bd.tables.scheduled_posts.find((p) => p.id === 'post-c'))).toBe(avantC);
    expect(spies.telechargements.every((t) => t.startsWith('user-b|'))).toBe(true);
  });
});

describe('montage amélioré activé publiquement : aucun rôle requis', () => {
  it('interrupteur seul : un compte standard est contrôlé comme un administrateur ; la base des comptes n’est jamais lue', async () => {
    process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED = 'true';
    expect((await produireMp4DuPost('user-b', 'post-b')).ok).toBe(true);
    expect(spies.controles).toBe(1);
    expect((await produireMp4DuPost('admin-1', 'post-admin')).ok).toBe(true);
    expect(spies.controles).toBe(2);
    expect(bd.tablesLues.has('users')).toBe(false);
    expect(await montageAmelioreActifPourCompte('nouvel-utilisateur-jamais-vu')).toBe(true);
  });

  it('interrupteur éteint : MP4 produit pour tous, aucun contrôle ajouté (comportement de la production)', async () => {
    expect((await produireMp4DuPost('user-b', 'post-b')).ok).toBe(true);
    expect((await produireMp4DuPost('admin-1', 'post-admin')).ok).toBe(true);
    expect(spies.controles).toBe(0);
  });

  it('liste blanche temporaire : seul le compte listé est contrôlé ; le standard garde le comportement de la production', async () => {
    process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED = 'true';
    process.env.STUDIIO_MONTAGE_AMELIORE_COMPTES = 'admin-1';
    expect((await produireMp4DuPost('user-b', 'post-b')).ok).toBe(true);
    expect(spies.controles).toBe(0);
    expect((await produireMp4DuPost('admin-1', 'post-admin')).ok).toBe(true);
    expect(spies.controles).toBe(1);
  });
});

describe('rendus simultanés : un compte n’en gêne pas un autre, la machine reste bornée', () => {
  it('deux conversions du MÊME compte : la seconde est refusée (« occupe ») ; l’autre compte passe', async () => {
    spies.bloquer = true;
    const premiere = produireMp4DuPost('user-b', 'post-b');
    await vi.waitFor(() => expect(spies.deverrou).not.toBeNull());
    expect(await produireMp4DuPost('user-b', 'post-b')).toEqual({ ok: false, motif: 'occupe' });
    spies.bloquer = false;
    expect((await produireMp4DuPost('user-c', 'post-c')).ok).toBe(true);
    spies.deverrou!();
    expect((await premiere).ok).toBe(true);
  });

  it('plafond machine : avec deux conversions en cours, un troisième compte est refusé, puis admis une fois libérée', async () => {
    spies.bloquer = true;
    const libs: Array<() => void> = [];
    const lancer = (u: string, p: string) => { const r = produireMp4DuPost(u, p); return r; };
    const a = lancer('admin-1', 'post-admin');
    await vi.waitFor(() => expect(spies.deverrou).not.toBeNull());
    libs.push(spies.deverrou!); spies.deverrou = null;
    const b = lancer('user-b', 'post-b');
    await vi.waitFor(() => expect(spies.deverrou).not.toBeNull());
    libs.push(spies.deverrou!);
    spies.bloquer = false;
    expect(await produireMp4DuPost('user-c', 'post-c')).toEqual({ ok: false, motif: 'occupe' });
    libs.forEach((l) => l());
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect((await produireMp4DuPost('user-c', 'post-c')).ok).toBe(true);
  });
});

describe('plafond COMMUN des rendus lourds (pool PostgreSQL partagé avec l’Autopilote)', () => {
  it('un rendu Autopilote tient sa place (plafond 1) : une conversion de Créer passe (réserve interactive), une seconde est refusée « occupe » avant tout téléchargement', async () => {
    baux.actif = true;
    baux.pris.set('autopilote-x-2026-10-27-0900', 'user-b'); // rendu Autopilote en cours
    spies.bloquer = true;
    const premiere = produireMp4DuPost('admin-1', 'post-admin');
    await vi.waitFor(() => expect(spies.deverrou).not.toBeNull());
    expect(baux.pris.size).toBe(2);
    spies.bloquer = false;
    const avant = spies.telechargements.length;
    expect(await produireMp4DuPost('user-c', 'post-c')).toEqual({ ok: false, motif: 'occupe' });
    expect(spies.telechargements.length).toBe(avant); // refusé AVANT tout téléchargement
    expect(baux.pris.size).toBe(2);
    spies.deverrou!();
    expect((await premiere).ok).toBe(true);
    expect(baux.pris.size).toBe(1); // le bail est rendu ; il ne reste que l'Autopilote
  });

  it('reprise : une fois la place rendue, la conversion refusée passe, sans double conversion ni double mise à jour', async () => {
    baux.actif = true;
    baux.pris.set('a1', 'x'); baux.pris.set('a2', 'x'); // pool plein (1 + réserve 1)
    expect(await produireMp4DuPost('user-c', 'post-c')).toEqual({ ok: false, motif: 'occupe' });
    expect(bd.majs).toEqual([]);
    baux.pris.delete('a2');
    expect((await produireMp4DuPost('user-c', 'post-c')).ok).toBe(true);
    expect(bd.majs).toEqual([{ table: 'scheduled_posts', id: 'post-c', user: 'user-c' }]);
    expect(baux.pris.size).toBe(1);
  });

  it('même fichier converti deux fois en même temps : une seule conversion (« occupe » pour la seconde), bail rendu à la fin', async () => {
    baux.actif = true;
    spies.bloquer = true;
    const a = produireMp4DuPost('user-b', 'post-b');
    await vi.waitFor(() => expect(spies.deverrou).not.toBeNull());
    spies.bloquer = false;
    expect(await produireMp4DuPost('user-b', 'post-b')).toEqual({ ok: false, motif: 'occupe' });
    spies.deverrou!();
    expect((await a).ok).toBe(true);
    expect(baux.pris.size).toBe(0);
  });

  it('base des baux en panne : la conversion Créer est refusée proprement (occupe), rien téléchargé ni mis à jour', async () => {
    baux.actif = true;
    const rpcOriginal = (await import('@/lib/db/supabase')).supabaseAdmin as unknown as { rpc: unknown };
    const sauvegarde = rpcOriginal.rpc;
    rpcOriginal.rpc = async () => { throw new Error('ECONNREFUSED'); };
    try {
      expect(await produireMp4DuPost('user-b', 'post-b')).toEqual({ ok: false, motif: 'occupe' });
    } finally { rpcOriginal.rpc = sauvegarde; }
    expect(spies.telechargements).toEqual([]);
    expect(bd.majs).toEqual([]);
  });
});
