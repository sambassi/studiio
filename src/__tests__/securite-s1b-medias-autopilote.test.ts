// @vitest-environment node
/**
 * S1b — SÉCURITÉ des médias de l'Autopilote (rouges avant le correctif, verts après).
 *
 *  1. URL « notre stockage » NON CANONIQUES (`..`, `%2e%2e`, `%2E%2e`, `.%2e`,
 *     `%252e`, `.%2f`, `\`, segment `.`) : refusées par localiserEntreesRendu
 *     (Chromium normaliserait les segments et sortirait du relais).
 *  2. `posterUrls` d'un AUTRE compte : lâchées comme un rush refusé.
 *  3. Chaînes dangereuses sur CHAQUE champ de localiserEntreesRendu.
 *  4. Origine de confiance : plus d'exemption du contrôle d'IP pour la
 *     localisation des médias externes (DNS privé, IP interne, redirection).
 *
 * Aucun réseau réel : faux DNS, fetch sûr réduit à sa politique, ou serveurs
 * locaux en boucle (127.0.0.1) via `connexionVers`.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { writeFile } from 'fs/promises';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.test';
process.env.NEXTAUTH_URL = 'https://studiio.test';
process.env.PUBLIC_STORAGE_URL = 'https://storage.exemple.test';
process.env.SUPABASE_LEGACY_STORAGE_URL = '';
const APP = 'https://studiio.test';
const CDN = 'https://storage.exemple.test';
const UID = 'u1';

const DNS: Record<string, string> = { 'storage.exemple.test': '10.0.0.5', 'studiio.test': '10.0.0.6', 'prive.example': '10.0.0.7' };
const fauxDns = async (h: string) => [{ address: DNS[h] ?? '93.184.216.34', family: 4 }];

const appelsFetch: Array<{ url: string; verdict: string }> = [];
vi.mock('@/lib/securite/fetch-sur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/securite/fetch-sur')>();
  return {
    ...actual,
    telechargerSur: async (url: string, destination: string, opts: import('@/lib/securite/fetch-sur').OptionsFetchSur = {}) => {
      // Serveurs locaux : le VRAI fetch sûr (transport épinglé sur 127.0.0.1).
      if (opts.connexionVers) return actual.telechargerSur(url, destination, opts);
      try {
        await actual.verifierCibleSure(url, { ...opts, resoudre: fauxDns });
      } catch (e) {
        appelsFetch.push({ url, verdict: `REFUS:${(e as { motif?: string }).motif ?? (e as Error).name}` });
        throw e;
      }
      appelsFetch.push({ url, verdict: 'TELECHARGE' });
      await writeFile(destination, 'x');
      return { url, octets: 1, typeContenu: null };
    },
  };
});
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({ statObject: async () => { throw new Error('absent'); }, putObject: async () => undefined }),
  signeurInterne: () => null,
}));

let lastDesign: Record<string, unknown> | null = null;
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: async (arg: { design: Record<string, unknown> }) => {
    lastDesign = arg.design;
    return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
  },
}));
const pickPosterUrl = vi.fn(async (..._a: unknown[]) => 'https://images.pexels.com/photos/9/auto.jpeg');
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 6,
  pickPosterUrl: (...a: unknown[]) => pickPosterUrl(...a),
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));
const genererAfficheReference = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/ai/affiche-reference', () => ({
  genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...a),
}));
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: async () => true }));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));
let insertions: Array<Record<string, unknown>> = [];
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    select: () => { const q: Record<string, unknown> = { eq: () => q, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  const storage = { from: (b: string) => ({ getPublicUrl: (c: string) => ({ data: { publicUrl: `${APP}/storage/v1/object/public/${b}/${c}` } }) }) };
  return { supabaseAdmin: { from, storage }, supabase: { from, storage } };
});

import { localiserEntreesRendu, type DepotMedias } from '@/lib/securite/medias-externes';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { produireUnMontage } from '@/lib/autopilot/produire';

const deposes: string[] = [];
const depot: DepotMedias = {
  existe: async () => false,
  deposer: async (b, c) => { deposes.push(`${b}/${c}`); },
  urlPublique: (b, c) => `${APP}/storage/v1/object/public/${b}/${c}`,
};

const CHAMPS: Record<string, (c: string) => Partial<CreerSimpleRenderInput>> = {
  posterUrl: (c) => ({ posterUrl: c }),
  'sequenceBackgrounds.intro': (c) => ({ sequenceBackgrounds: { intro: c } }),
  videoUrl: (c) => ({ videoUrl: c }),
  'rushs[].url': (c) => ({ rushs: [{ url: c }] as never }),
  'montage[].url': (c) => ({ montage: [{ url: c, debut: 0, fin: 2 }] as never }),
  'montage[image].url': (c) => ({ montage: [{ url: c, kind: 'image', debut: 0, fin: 2 }] as never }),
  musicUrl: (c) => ({ musicUrl: c }),
  voiceUrl: (c) => ({ voiceUrl: c }),
  'sequenceVoiceUrls.titre': (c) => ({ sequenceVoiceUrls: { titre: c } }),
};

async function refus(d: Partial<CreerSimpleRenderInput>, reseau?: import('@/lib/securite/fetch-sur').OptionsFetchSur): Promise<string> {
  try {
    const sortie = await localiserEntreesRendu({ title: 'T', ...d } as CreerSimpleRenderInput, { depot, ...(reseau ? { reseau } : {}) });
    return `ACCEPTEE:${JSON.stringify(sortie)}`;
  } catch (e) {
    return (e as Error).name === 'RefusSsrf' ? 'RefusSsrf' : `AUTRE:${(e as Error).name}:${(e as Error).message}`;
  }
}

beforeEach(() => { appelsFetch.length = 0; deposes.length = 0; insertions = []; lastDesign = null; vi.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────
const TRAVERSEES = (o: string): Record<string, string> => ({
  'point-point': `${o}/storage/v1/object/public/media/x/../../../../../api/secret.jpg`,
  'pct2e-min': `${o}/storage/v1/object/public/media/x/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/api/secret.jpg`,
  'pct2E-mixte': `${o}/storage/v1/object/public/media/x/%2E%2e/%2e%2E/%2E./.%2E/..%2e/api/secret.jpg`,
  'double-encodage': `${o}/storage/v1/object/public/media/x/%252e%252e/%252e%252e/api/secret.jpg`,
  'point-pct2f': `${o}/storage/v1/object/public/media/x/.%2f..%2f..%2f..%2fapi%2fsecret.jpg`,
  antislash: `${o}/storage/v1/object/public/media/x\\..\\..\\..\\api\\secret.jpg`,
  'segment-point': `${o}/storage/v1/object/public/media/${UID}/./x.jpg`,
  'relais-relatif-traversee': '/storage/v1/object/public/media/x/../../../../../proxy?src=http%3A%2F%2F169.254.169.254%2F',
  'relais-relatif-pct2e': '/storage/v1/object/public/media/x/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/api/secret.jpg',
});

describe('S1b-1 — URL « notre stockage » non canoniques : refusées, jamais transmises', () => {
  for (const origine of [APP, CDN]) {
    for (const [nom, url] of Object.entries(TRAVERSEES(origine))) {
      for (const [champ, f] of Object.entries(CHAMPS)) {
        it(`${new URL(origine).host} ${nom} → ${champ}`, async () => {
          expect(await refus(f(url))).toBe('RefusSsrf');
          expect(appelsFetch.filter((a) => a.verdict === 'TELECHARGE')).toEqual([]);
          expect(deposes).toEqual([]);
        });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
const P = 'http%3A%2F%2F169.254.169.254%2F';
const CHARGES: Record<string, string> = {
  proxy_relatif: `proxy?src=${P}&time=0`,
  proxy_point: `./proxy?src=${P}&time=0`,
  proxy_racine: `/proxy?src=${P}&time=0`,
  blanc_tete: ' https://10.0.0.1/x',
  blanc_queue: 'https://images.pexels.com/a.jpg ',
  tab_schema: 'ht\ttps://10.0.0.1/x',
  tab_public: 'https://images.pex\tels.com/a.jpg',
  antislash: 'https:\\\\10.0.0.1\\x',
  proto_relatif: '//10.0.0.1/x',
  sans_barres: 'https:10.0.0.1/x',
  sans_barres_public: 'https:images.pexels.com/a.jpg',
  file: 'file:///etc/passwd',
  data: 'data:image/png;base64,iVBORw0KGgo=',
  javascript: 'javascript:alert(1)',
  blob: 'blob:http://localhost:3000/abc',
  texte_relatif: 'quelque/chose.mp4',
  canonique_prive: 'https://10.0.0.1/x',
};

describe('S1b-3 — chaînes dangereuses : refusées sur CHAQUE champ', () => {
  for (const [nom, charge] of Object.entries(CHARGES)) {
    for (const [champ, f] of Object.entries(CHAMPS)) {
      it(`${nom} → ${champ}`, async () => {
        expect(await refus(f(charge))).toBe('RefusSsrf');
        expect(appelsFetch.filter((a) => a.verdict === 'TELECHARGE')).toEqual([]);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
describe('S1b-4 — origine de confiance : le contrôle d’IP n’est plus sauté', () => {
  for (const [nom, url] of Object.entries({
    'CDN configuré → DNS privé': `${CDN}/api/interne/quoi.jpg`,
    'application → DNS privé': `${APP}/api/interne/quoi.mp4`,
  })) {
    for (const [champ, f] of Object.entries(CHAMPS)) {
      it(`${nom} → ${champ}`, async () => {
        expect(await refus(f(url))).toBe('RefusSsrf');
        expect(appelsFetch.map((a) => a.verdict)).toEqual(['REFUS:ip-interdite']);
      });
    }
  }
});

describe('S1b-4 — serveurs locaux : origine de confiance interne et redirections (vrai fetch sûr)', () => {
  let srvPublic: http.Server;
  let srvPrive: http.Server;
  let portPublic = 0;
  let portPrive = 0;
  const priv = { hits: 0 };
  const envAvant = process.env.PUBLIC_STORAGE_URL;
  const ecouter = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
  beforeAll(async () => {
    srvPrive = http.createServer((_q, res) => { priv.hits += 1; res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end('SECRET'); });
    portPrive = await ecouter(srvPrive);
    srvPublic = http.createServer((req, res) => {
      const c = req.url ?? '/';
      if (c.startsWith('/redir-prive')) { res.writeHead(302, { Location: 'http://prive.example/secret.jpg' }); res.end(); return; }
      if (c.startsWith('/redir-confiance')) { res.writeHead(302, { Location: `http://127.0.0.1:${portPrive}/api/interne.jpg` }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end('IMAGE');
    });
    portPublic = await ecouter(srvPublic);
    // Le CDN « de confiance » est INTERNE (cas d'une MinIO exposée en réseau privé).
    process.env.PUBLIC_STORAGE_URL = `http://127.0.0.1:${portPrive}`;
  });
  afterAll(async () => {
    process.env.PUBLIC_STORAGE_URL = envAvant;
    await Promise.all([srvPublic, srvPrive].map((s) => new Promise((r) => s.close(r))));
  });
  beforeEach(() => { priv.hits = 0; });
  const reseau = () => ({
    resoudre: async (h: string) => [{ address: h === 'prive.example' ? '10.0.0.7' : '93.184.216.34', family: 4 }],
    connexionVers: (ip: string) => ({ host: '127.0.0.1', port: ip.startsWith('93.184.216.') ? portPublic : portPrive }),
    timeoutMs: 5_000,
  });

  it('origine de confiance interne, chemin hors stockage : refusée, aucune requête', async () => {
    expect(await refus({ posterUrl: `http://127.0.0.1:${portPrive}/api/interne.jpg` }, reseau())).toBe('RefusSsrf');
    expect(priv.hits).toBe(0);
  });

  it('redirection publique → origine de confiance interne : refusée, aucune requête', async () => {
    expect(await refus({ posterUrl: 'http://cdn.example/redir-confiance.jpg' }, reseau())).toBe('RefusSsrf');
    expect(priv.hits).toBe(0);
  });

  it('redirection publique → hôte résolvant en privé : refusée, aucune requête', async () => {
    expect(await refus({ musicUrl: 'http://cdn.example/redir-prive.mp3' }, reseau())).toBe('RefusSsrf');
    expect(priv.hits).toBe(0);
  });

  it('témoin : média public servi en direct → copié', async () => {
    const r = await refus({ posterUrl: 'http://cdn.example/ok.jpg' }, reseau());
    expect(r).toMatch(/^ACCEPTEE:.*media\/externes\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────
const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [], voiceEnabled: false, ...p,
});
async function produire(c: AutopilotConfig) {
  const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  await produireUnMontage({ userId: UID, config: c, post, rang: 0, now: T0, jobId: 'job-1' });
}
const AUTRE = `${APP}/storage/v1/object/public/media/u2/photos/elle.jpg`;
const AUTRE_CDN = `${CDN}/storage/v1/object/public/media/u2/photos/elle.jpg`;
const AUTRE_HOTE = 'https://alias.studiio.example/storage/v1/object/public/media/u2/photos/elle.jpg';
const MIENNE = `${APP}/storage/v1/object/public/media/${UID}/photos/moi.jpg`;

describe('S1b-2 — posterUrls d’un AUTRE compte : lâchées comme un rush refusé', () => {
  for (const [nom, autre] of Object.entries({ app: AUTRE, cdn: AUTRE_CDN, 'autre-hote': AUTRE_HOTE })) {
    it(`custom (${nom}) : seule photo d’un autre compte → jamais montée (repli automatique)`, async () => {
      await produire(cfg({ posterMode: 'custom', posterUrls: [autre] }));
      expect(lastDesign?.posterUrl).not.toBe(autre);
      expect(JSON.stringify(lastDesign)).not.toContain('u2/photos');
    });

    it(`custom (${nom}) : photo d’un autre compte + la mienne → la mienne`, async () => {
      await produire(cfg({ posterMode: 'custom', posterUrls: [autre, MIENNE] }));
      expect(lastDesign?.posterUrl).toBe(MIENNE);
    });

    it(`référence IA (${nom}) : la photo d’un autre compte n’est jamais envoyée au fournisseur ni montée`, async () => {
      genererAfficheReference.mockResolvedValue({ ok: false, motif: 'x' });
      await produire(cfg({ posterMode: 'reference', posterUrls: [autre] }));
      expect(genererAfficheReference).not.toHaveBeenCalled();
      expect(JSON.stringify(lastDesign)).not.toContain('u2/photos');
    });
  }

  it('traversée dans posterUrls : jamais montée', async () => {
    const t = `${APP}/storage/v1/object/public/media/${UID}/../../../../../api/x.jpg`;
    await produire(cfg({ posterMode: 'custom', posterUrls: [t] }));
    expect(lastDesign?.posterUrl).not.toBe(t);
  });
});
