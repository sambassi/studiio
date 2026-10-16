// @vitest-environment node
/**
 * M2-b — Routes et non-régression : session obligatoire, propriétaire = session,
 * déclenchement explicite seulement, et AUCUN branchement vers le rendu,
 * `planMontage`, l'aperçu, le CTA, l'export ou le fichier final.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PUB = '/storage/v1/object/public';
const RUSH_A = `${PUB}/media/${A}/library/converted_1791985445290.mp4`;

const requete = (methode: string, corps?: unknown, url = 'https://studiio.pro/api/x') => new Request(url, {
  method: methode, headers: { 'content-type': 'application/json' }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
}) as never;

let fetchEspion: ReturnType<typeof vi.fn>;
beforeEach(() => {
  authMock.mockReset();
  fetchEspion = vi.fn(async () => { throw new Error('fetch interdit'); });
  vi.stubGlobal('fetch', fetchEspion);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('POST /api/creer/fiches-contenu/approfondir', () => {
  it('sans session → 401 ; sans url → 400', async () => {
    const { POST } = await import('@/app/api/creer/fiches-contenu/approfondir/route');
    authMock.mockResolvedValue(null);
    expect((await POST(requete('POST', { url: RUSH_A }))).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: A, email: 'contact.artboost@gmail.com' } });
    expect((await POST(requete('POST', {}))).status).toBe(400);
  });
  it('interrupteurs éteints (défaut) → 404 « eteint », zéro fetch', async () => {
    vi.stubEnv('STUDIIO_VISION_RUSH_ENABLED', '');
    vi.stubEnv('STUDIIO_TRANSCRIPTION_RUSH_ENABLED', '');
    const { POST } = await import('@/app/api/creer/fiches-contenu/approfondir/route');
    authMock.mockResolvedValue({ user: { id: A, email: 'contact.artboost@gmail.com' } });
    const r = await POST(requete('POST', { url: RUSH_A }));
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ statut: 'eteint' });
    expect(fetchEspion).not.toHaveBeenCalled();
  });
  it('allumé mais compte non admin → 403, zéro fetch', async () => {
    vi.stubEnv('STUDIIO_VISION_RUSH_ENABLED', 'true');
    vi.stubEnv('STUDIIO_VISION_RUSH_MODEL', 'claude-haiku-5-5');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const { POST } = await import('@/app/api/creer/fiches-contenu/approfondir/route');
    authMock.mockResolvedValue({ user: { id: A, email: 'autre@example.com' } });
    const r = await POST(requete('POST', { url: RUSH_A }));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ statut: 'non_admin' });
    expect(fetchEspion).not.toHaveBeenCalled();
  });
});

describe('/api/creer/consentement-ia', () => {
  it('sans session → 401 ; accord implicite ou sur une autre version → 400', async () => {
    const { POST, GET } = await import('@/app/api/creer/consentement-ia/route');
    authMock.mockResolvedValue(null);
    expect((await POST(requete('POST', { accepte: true, version: 1 }))).status).toBe(401);
    expect((await GET(requete('GET'))).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: A } });
    for (const corps of [{}, { accepte: 'oui', version: 1 }, { accepte: true }, { accepte: true, version: 99 }]) {
      expect((await POST(requete('POST', corps))).status, JSON.stringify(corps)).toBe(400);
    }
  });
  it('le texte existe en fr / en / de et nomme fournisseurs, données, hors UE, conservation, révocation', async () => {
    const { TEXTES_CONSENTEMENT_IA } = await import('@/lib/creer/consentement-ia');
    const mots = {
      fr: ['Anthropic', 'Groq', 'images', 'son', 'Union européenne', 'Conservation', 'retirer'],
      en: ['Anthropic', 'Groq', 'images', 'sound', 'European Union', 'Retention', 'withdraw'],
      de: ['Anthropic', 'Groq', 'Bilder', 'Ton', 'Europäischen Union', 'Speicherdauer', 'widerrufen'],
    } as const;
    for (const [l, liste] of Object.entries(mots)) {
      const t = JSON.stringify(TEXTES_CONSENTEMENT_IA[l as 'fr']);
      for (const m of liste) expect(t, `${l}:${m}`).toContain(m);
    }
  });
});

describe('aucun branchement vers rendu / planMontage / export / fichier final', () => {
  const racine = (r: string) => join(process.cwd(), r);
  const sources = (rel: string): string[] => {
    const c = racine(rel);
    if (!existsSync(c)) return [];
    if (statSync(c).isFile()) return /\.tsx?$/.test(rel) ? [rel] : [];
    if (/node_modules|\.next|__tests__/.test(rel)) return [];
    return readdirSync(c).flatMap((e) => sources(join(rel, e)));
  };
  it('seuls les modules M2-b et leurs routes importent l’analyse IA ou la fiche v2', () => {
    const importeurs = sources('src')
      .filter((f) => /['"]@\/lib\/creer\/(analyse-ia-rush|fiche-contenu-v2|consentement-ia)['"]/.test(readFileSync(racine(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .sort();
    // M2-c : consommateurs en LECTURE SEULE de la v2 (validateur pur, `lireFicheV2`
    // en cache) — jamais le lancement d'une analyse ni le consentement.
    const lecteursM2c = [
      'src/components/creer/QualiteRushs.tsx',
      'src/lib/autopilot/produire.ts',
      'src/lib/creer/fiche-contenu-client.ts',
      'src/lib/creer/pertinence-rushs.ts',
    ];
    expect(importeurs).toEqual([
      'src/app/api/creer/consentement-ia/route.ts',
      'src/app/api/creer/fiches-contenu/approfondir/route.ts',
      ...lecteursM2c,
      'src/lib/creer/analyse-ia-rush.ts',
    ].sort());
    for (const f of lecteursM2c) {
      const src = readFileSync(racine(f), 'utf8');
      expect(src, f).not.toMatch(/lancerAnalyseIA|consentement-ia|enregistrerConsentementIA|method: 'POST'/);
    }
  });
  it('la route M2-a des fiches et la décision de montage ne lisent que la v1', () => {
    const route = readFileSync(racine('src/app/api/creer/fiches-contenu/route.ts'), 'utf8');
    expect(route).not.toMatch(/v2|approfondir|analyse-ia/);
    const fiche = readFileSync(racine('src/lib/creer/fiche-contenu.ts'), 'utf8');
    expect(fiche).toMatch(/export const VERSION_FICHE_CONTENU = 1 as const;/);
  });
});
