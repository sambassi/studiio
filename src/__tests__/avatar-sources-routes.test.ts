// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `/api/avatar/sources/*` — déposer l'original, préparer, relire.
 *
 * Ce que ces tests prouvent (stockage, ffprobe et ffmpeg simulés) :
 *   - 401 sans session ; le compte vient de la session, jamais du corps ;
 *   - dépôt : type et poids contrôlés ; une vidéo inutilisable (sans son…)
 *     est refusée (422) SANS être stockée ; une bonne est stockée sous une
 *     clé construite par le serveur ;
 *   - préparation : clé d'autrui / vidéo générée / photo → 404, sans accès
 *     au stockage ; paramètres BORNÉS avant ffmpeg ; résultat non conforme
 *     → 422, rien stocké ; conforme → NOUVELLE clé ;
 *   - ⚠️ l'original n'est JAMAIS retiré : aucun `remove`, dans aucun cas ;
 *   - aperçu : 404 uniforme hors du compte, `Range` honoré (206 / 416).
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const NONCE = '0123456789abcdef0123456789abcdef';
const CLE_ORIGINAL = `${U}/avatar/source-1700000000000-${NONCE}.webm`;

const etat = vi.hoisted(() => ({
  session: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as { user: { id: string } } | null,
  envois: [] as Array<{ cle: string; type: string; octets: number }>,
  retraits: [] as string[],
  stats: [] as string[],
  lectures: [] as Array<{ cle: string; debut?: number; longueur?: number }>,
  objets: new Map<string, number>(),
  sondes: [] as unknown[],
  traitements: [] as Array<{ p: unknown }>,
  erreurSonde: null as null | { code?: string },
  echecUpload: false,
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));

vi.mock('@/lib/db/supabase', () => ({
  supabase: {},
  supabaseAdmin: {
    from: () => { throw new Error('aucune table ne doit être lue'); },
    storage: {
      from: () => ({
        upload: async (cle: string, octets: Buffer, o: { contentType: string }) => {
          if (etat.echecUpload) return { data: null, error: { message: 'plein' } };
          etat.envois.push({ cle, type: o.contentType, octets: octets.length });
          return { data: { path: cle }, error: null };
        },
        remove: async (cles: string[]) => { etat.retraits.push(...cles); return { data: [], error: null }; },
      }),
    },
  },
}));

vi.mock('@/lib/storage/minio-client', async () => {
  const { Readable } = await import('node:stream');
  return {
    clientMinio: () => ({
      statObject: async (_b: string, cle: string) => {
        etat.stats.push(cle);
        const t = etat.objets.get(cle);
        if (t === undefined) throw Object.assign(new Error('NotFound'), { code: 'NotFound' });
        return { size: t };
      },
    }),
    lecteurMinio: () => ({
      getObject: async (_b: string, cle: string) => {
        etat.lectures.push({ cle });
        return Readable.from([Buffer.alloc(etat.objets.get(cle) ?? 0, 1)]);
      },
      getPartialObject: async (_b: string, cle: string, debut: number, longueur: number) => {
        etat.lectures.push({ cle, debut, longueur });
        return Readable.from([Buffer.alloc(longueur, 2)]);
      },
    }),
  };
});

const BONNES = {
  conteneur: 'matroska,webm', codecVideo: 'vp9', codecAudio: 'opus', largeur: 1280, hauteur: 720, rotation: 0,
  largeurEffective: 1280, hauteurEffective: 720, dureeS: 60, fps: 30, debitBps: 2_000_000, tailleOctets: 1000,
};
const PREPAREES = { ...BONNES, conteneur: 'mov,mp4,m4a,3gp,3g2,mj2', codecVideo: 'h264', codecAudio: 'aac' };

vi.mock('@/lib/avatar/preparation-source', async () => {
  const reel = await vi.importActual<Record<string, unknown>>('@/lib/avatar/preparation-source');
  return {
    ...reel,
    infosVideo: vi.fn(async (chemin: string) => {
      if (etat.erreurSonde) throw Object.assign(new Error('sonde'), etat.erreurSonde);
      const suivante = etat.sondes.shift();
      if (suivante) return suivante;
      return chemin.endsWith('preparee.mp4') ? PREPAREES : BONNES;
    }),
    // Le « ffmpeg » simulé écrit une sortie, comme le vrai.
    traiterVideo: vi.fn(async (_e: string, sortie: string, p: unknown) => {
      etat.traitements.push({ p });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(sortie, Buffer.alloc(512, 3));
    }),
  };
});

const { POST: deposer } = await import('@/app/api/avatar/sources/route');
const { POST: traiter } = await import('@/app/api/avatar/sources/traiter/route');
const { GET: apercu } = await import('@/app/api/avatar/sources/apercu/route');

beforeEach(() => {
  etat.session = { user: { id: U } };
  etat.envois.length = 0; etat.retraits.length = 0; etat.stats.length = 0; etat.lectures.length = 0;
  etat.objets = new Map([[CLE_ORIGINAL, 4096]]);
  etat.sondes = []; etat.traitements.length = 0; etat.erreurSonde = null; etat.echecUpload = false;
});

function requeteDepot(fichier: File | null) {
  const fd = new FormData();
  if (fichier) fd.append('file', fichier);
  return new NextRequest('http://localhost/api/avatar/sources', { method: 'POST', body: fd });
}
const video = (type = 'video/webm', taille = 2048) => new File([new Uint8Array(taille)], 'prise.webm', { type });
const requeteTraiter = (corps: unknown) => new NextRequest('http://localhost/api/avatar/sources/traiter', {
  method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' },
});
const requeteApercu = (cle: string, range?: string) => new NextRequest(
  `http://localhost/api/avatar/sources/apercu?cle=${encodeURIComponent(cle)}`, { headers: range ? { range } : {} },
);

describe('POST /api/avatar/sources — l’original', () => {
  it('401 sans session, avant toute lecture', async () => {
    etat.session = null;
    const r = await deposer(requeteDepot(video()));
    expect(r.status).toBe(401);
    expect(etat.envois).toEqual([]);
  });

  it('type refusé (415), vide (400), trop lourd (413) : rien stocké', async () => {
    expect((await deposer(requeteDepot(video('image/png')))).status).toBe(415);
    expect((await deposer(requeteDepot(video('video/webm', 0)))).status).toBe(400);
    expect((await deposer(requeteDepot(video('video/mp4', 32 * 1024 * 1024 + 1)))).status).toBe(413);
    expect((await deposer(requeteDepot(null))).status).toBe(400);
    expect(etat.envois).toEqual([]);
  });

  it('⚠️ vidéo sans son : 422 avec motifs, et RIEN n’est stocké', async () => {
    etat.sondes = [{ ...BONNES, codecAudio: null }];
    const r = await deposer(requeteDepot(video()));
    const j = await r.json();
    expect(r.status).toBe(422);
    expect(j.data.preflight.ok).toBe(false);
    expect(j.data.preflight.motifs[0]).toMatch(/pas de son/);
    expect(etat.envois).toEqual([]);
  });

  it('fichier illisible : 422 ; ffprobe absent : 503 ; jamais stocké', async () => {
    etat.erreurSonde = {};
    expect((await deposer(requeteDepot(video()))).status).toBe(422);
    etat.erreurSonde = { code: 'ENOENT' };
    expect((await deposer(requeteDepot(video()))).status).toBe(503);
    expect(etat.envois).toEqual([]);
  });

  it('⚠️ bonne vidéo : stockée sous une clé CONSTRUITE pour la session ; trop longue = avertissement, pas refus', async () => {
    etat.sondes = [{ ...BONNES, dureeS: 700 }];
    const r = await deposer(requeteDepot(video()));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.success).toBe(true);
    expect(j.data.cleOriginal).toMatch(new RegExp(`^${U}/avatar/source-\\d+-[0-9a-f]{32}\\.webm$`));
    expect(j.data.preflight).toMatchObject({ ok: true });
    expect(j.data.preflight.avertissements[0]).toMatch(/Couper/);
    expect(j.data.infos.dureeS).toBe(700);
    expect(etat.envois).toEqual([{ cle: j.data.cleOriginal, type: 'video/webm', octets: 2048 }]);
    expect(etat.retraits).toEqual([]);
  });
});

describe('POST /api/avatar/sources/traiter — la version préparée', () => {
  it('401 sans session', async () => {
    etat.session = null;
    expect((await traiter(requeteTraiter({ cleOriginal: CLE_ORIGINAL }))).status).toBe(401);
  });

  it('⚠️ clé d’autrui, vidéo générée, photo, traversée : 404 uniforme, AUCUN accès au stockage', async () => {
    for (const cle of [
      `${AUTRUI}/avatar/source-1700000000000-${NONCE}.webm`,
      `${U}/avatar/11111111-1111-4111-8111-000000000009.mp4`,
      `${U}/avatar/source-1700000000000-${NONCE}.jpg`,
      `${U}/avatar/../${AUTRUI}/avatar/source-1.mp4`,
      42,
    ]) {
      const r = await traiter(requeteTraiter({ cleOriginal: cle }));
      expect(r.status).toBe(404);
    }
    expect(etat.stats).toEqual([]);
    expect(etat.lectures).toEqual([]);
    expect(etat.traitements).toEqual([]);
  });

  it('objet absent : 404', async () => {
    etat.objets.clear();
    expect((await traiter(requeteTraiter({ cleOriginal: CLE_ORIGINAL }))).status).toBe(404);
  });

  it('⚠️ paramètres BORNÉS avant ffmpeg ; résultat stocké sous une NOUVELLE clé ; original intact', async () => {
    const r = await traiter(requeteTraiter({
      cleOriginal: CLE_ORIGINAL,
      parametres: { debutS: -10, finS: 5000, rotation: 33, amelioration: { active: true, luminosite: 4, contraste: 0, saturation: 9, nettete: 7, debruitage: true } },
    }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(etat.traitements).toHaveLength(1);
    expect(etat.traitements[0].p).toMatchObject({
      debutS: 0, finS: 60, rotation: 0,
      amelioration: { active: true, luminosite: 0.08, contraste: 0.9, saturation: 1.15, nettete: 0.6, debruitage: true },
    });
    expect(j.data.cleOriginal).toBe(CLE_ORIGINAL);
    expect(j.data.cleTraitee).toMatch(new RegExp(`^${U}/avatar/source-\\d+-[0-9a-f]{32}\\.mp4$`));
    expect(j.data.cleTraitee).not.toBe(CLE_ORIGINAL);
    expect(j.data.preflight.ok).toBe(true);
    expect(etat.envois).toEqual([{ cle: j.data.cleTraitee, type: 'video/mp4', octets: 512 }]);
    expect(etat.retraits).toEqual([]);
  });

  it('⚠️ résultat non conforme : 422 avec motifs, RIEN stocké, original intact', async () => {
    etat.sondes = [BONNES, { ...PREPAREES, codecAudio: null }];
    const r = await traiter(requeteTraiter({ cleOriginal: CLE_ORIGINAL, parametres: {} }));
    const j = await r.json();
    expect(r.status).toBe(422);
    expect(j.data.motifs[0]).toMatch(/pas de son/);
    expect(etat.envois).toEqual([]);
    expect(etat.retraits).toEqual([]);
  });

  it('stockage en échec : 500, original intact', async () => {
    etat.echecUpload = true;
    expect((await traiter(requeteTraiter({ cleOriginal: CLE_ORIGINAL }))).status).toBe(500);
    expect(etat.retraits).toEqual([]);
  });

  it('⚠️ le code des routes ne contient aucun retrait', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['route.ts', 'traiter/route.ts', 'apercu/route.ts']) {
      expect(readFileSync(`src/app/api/avatar/sources/${f}`, 'utf8')).not.toMatch(/\.remove\(/);
    }
  });
});

describe('GET /api/avatar/sources/apercu', () => {
  it('401 sans session', async () => {
    etat.session = null;
    expect((await apercu(requeteApercu(CLE_ORIGINAL))).status).toBe(401);
  });

  it('⚠️ hors du compte : 404 uniforme, sans consulter le stockage', async () => {
    for (const cle of [`${AUTRUI}/avatar/source-1700000000000-${NONCE}.webm`, `${U}/avatar/11111111-1111-4111-8111-000000000009.mp4`, '']) {
      expect((await apercu(requeteApercu(cle))).status).toBe(404);
    }
    expect(etat.stats).toEqual([]);
  });

  it('objet absent : 404', async () => {
    etat.objets.clear();
    expect((await apercu(requeteApercu(CLE_ORIGINAL))).status).toBe(404);
  });

  it('200 : type par la clé, longueur, en-têtes de sécurité', async () => {
    const r = await apercu(requeteApercu(CLE_ORIGINAL));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('video/webm');
    expect(r.headers.get('content-length')).toBe('4096');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toMatch(/private, no-store/);
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect((await r.arrayBuffer()).byteLength).toBe(4096);
  });

  it('206 : le morceau demandé ; 416 hors du fichier', async () => {
    const r = await apercu(requeteApercu(CLE_ORIGINAL, 'bytes=100-199'));
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 100-199/4096');
    expect(r.headers.get('content-length')).toBe('100');
    expect(etat.lectures.at(-1)).toEqual({ cle: CLE_ORIGINAL, debut: 100, longueur: 100 });
    const hors = await apercu(requeteApercu(CLE_ORIGINAL, 'bytes=9999-'));
    expect(hors.status).toBe(416);
    expect(hors.headers.get('content-range')).toBe('bytes */4096');
  });
});
