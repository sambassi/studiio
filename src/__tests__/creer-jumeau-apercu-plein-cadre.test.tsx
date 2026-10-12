/**
 * APERÇU DE CRÉER = MÊME FICHIER PLEIN CADRE QUE L'EXPORT (#555).
 *
 * L'export remplaçait déjà un jumeau à bandes incrustées par sa version
 * plein cadre dérivée ; l'aperçu en direct de Créer lisait encore l'original
 * et montrait les bandes. Ici : l'aperçu passe par le MÊME résolveur et le
 * MÊME cache que l'export (une requête par jumeau et par format), garde
 * l'original dans l'état, et retombe sur l'original en cas d'échec sans
 * jamais bloquer l'éditeur. Ni fournisseur, ni crédit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';

const etat = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }));
const espions = vi.hoisted(() => ({ heygen: vi.fn(), did: vi.fn(), credits: vi.fn() }));

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});
// MinIO doublé : la route réelle ne lit rien de vrai.
vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async statObject() { return { size: 4096, metaData: {} }; }
    async getObject() { return Readable.from([Buffer.alloc(4096, 7)]); }
    async getPartialObject(_b: string, _c: string, _d: number, l: number) { return Readable.from([Buffer.alloc(l, 7)]); }
    async presignedGetObject(b: string, c: string) { return `http://minio.interne/${b}/${c}`; }
    async putObject() { return {}; }
  }
  return { Client };
});
vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));
const espionner = (espion: (k: string) => void) => async (orig: () => Promise<Record<string, unknown>>) => {
  const vrai = await orig();
  const out: Record<string, unknown> = { ...vrai };
  for (const [k, v] of Object.entries(vrai)) if (typeof v === 'function' && !/^[A-Z]/.test(k)) out[k] = (...a: unknown[]) => { espion(k); return (v as (...x: unknown[]) => unknown)(...a); };
  return out;
};
vi.mock('@/lib/avatar/heygen', (orig) => espionner(espions.heygen)(orig as never));
vi.mock('@/lib/providers/did/client', (orig) => espionner(espions.did)(orig as never));
vi.mock('@/lib/credits/system', (orig) => espionner(espions.credits)(orig as never));

process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.AUTH_SECRET = 'secret-de-test-apercu-plein-cadre-0123456789';
process.env.MINIO_SECRET_KEY = 'secret-minio-test';

import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import ApercuMedia from '@/components/creer/ApercuMedia';
import {
  pleinCadreDesJumeaux, resoudreJumeauPleinCadre, oublierMemoPleinCadre, API_PLEIN_CADRE,
} from '@/lib/creer/jumeau-plein-cadre-client';

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const GEN = 'c0ffee00-3333-4333-8333-333333333333';
const ORIGINE = 'https://studiio.pro';
const url = (cle: string) => `${ORIGINE}/storage/v1/object/public/media/${cle}`;
const JUMEAU = url(`${A}/avatar/${GEN}.mp4`);
const DERIVEE_916 = url(`${A}/jumeaux-recadres/9x16/avatar/${GEN}.mp4`);
const DERIVEE_11 = url(`${A}/jumeaux-recadres/1x1/avatar/${GEN}.mp4`);

const generated = {
  title: 'T', subtitle: '', cards: [{ id: 'a', icon: 'Flame', title: 'A', description: '', value: '1' }], cta: 'GO', ctaSub: '',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
type P = Parameters<typeof Preview>[0];
const props = (sur: Record<string, unknown> = {}) => ({
  generated, format: '9:16', displayScale: 0.25, gradientOpacity: 0.5, watermark: 'W', text: TEXT,
  onFocusChange: () => {}, rushUrl: JUMEAU, activeOrder: ['video', 'intro', 'cards', 'cta'], focus: 'video',
  gradStart: '#7C3AED', gradEnd: '#EC4899', accent: '#7C3AED', ...sur,
}) as unknown as P;
const videoSrc = () => document.querySelector('video')?.getAttribute('src') ?? null;

/** Route plein cadre doublée : rend la dérivée du format demandé. */
function routeDerivee(par: Record<string, string> = { '9:16': DERIVEE_916, '1080:1920': DERIVEE_916, '1:1': DERIVEE_11, '1080:1080': DERIVEE_11 }) {
  return vi.fn(async (_p: string, init?: RequestInit) => {
    const { url: u, format } = JSON.parse(String(init?.body));
    const rendue = u === JUMEAU ? par[format] ?? u : u;
    return new Response(JSON.stringify({ success: true, data: { url: rendue, pleinCadre: rendue !== u } }), { status: 200 });
  });
}
const appelsRoute = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => c[0] === API_PLEIN_CADRE).length;

beforeEach(() => {
  oublierMemoPleinCadre();
  etat.session = null;
  espions.heygen.mockClear(); espions.did.mockClear(); espions.credits.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('aperçu Créer : le jumeau à bandes est montré PLEIN CADRE', () => {
  it('A. jumeau à bandes + Créer 9:16 → la <video> de l’aperçu lit la dérivée (plus de bandes)', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    render(<Preview {...props()} />);
    await waitFor(() => expect(videoSrc()).toBe(DERIVEE_916));
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ url: JUMEAU, format: '9:16' });
  });

  it('B + C. l’export reçoit la MÊME dérivée que l’aperçu, sans seconde requête', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    render(<Preview {...props()} />);
    await waitFor(() => expect(videoSrc()).toBe(DERIVEE_916));
    const options = await pleinCadreDesJumeaux({ width: 1080, height: 1920, videoUrl: JUMEAU, rushs: [{ url: JUMEAU, secondes: 5 }] } as never) as { videoUrl: string; rushs: Array<{ url: string }> };
    expect(options.videoUrl).toBe(DERIVEE_916);
    expect(options.rushs[0].url).toBe(DERIVEE_916);
    expect(videoSrc()).toBe(options.videoUrl);
    expect(appelsRoute(f)).toBe(1);
  });

  it('C (sens inverse). export d’abord → l’aperçu réutilise la dérivée de l’export, aucune requête', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    const options = await pleinCadreDesJumeaux({ width: 1080, height: 1920, videoUrl: JUMEAU } as never) as { videoUrl: string };
    render(<Preview {...props()} />);
    expect(videoSrc()).toBe(options.videoUrl);
    expect(appelsRoute(f)).toBe(1);
  });

  it('l’état garde l’ORIGINAL : seule la source affichée change (rush list / brouillon intacts)', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    const p = props();
    render(<Preview {...p} />);
    await waitFor(() => expect(videoSrc()).toBe(DERIVEE_916));
    expect((p as unknown as { rushUrl: string }).rushUrl).toBe(JUMEAU);
  });

  it('re-rendus : UNE requête par (jumeau, format) ; changer de format → exactement une de plus', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    const { rerender } = render(<Preview {...props()} />);
    await waitFor(() => expect(videoSrc()).toBe(DERIVEE_916));
    for (let i = 0; i < 12; i++) rerender(<Preview {...props({ gradStart: i % 2 ? '#112233' : '#445566' })} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(appelsRoute(f)).toBe(1);
    rerender(<Preview {...props({ format: '1:1' })} />);
    await waitFor(() => expect(videoSrc()).toBe(DERIVEE_11));
    for (let i = 0; i < 5; i++) rerender(<Preview {...props({ format: '1:1', accent: i % 2 ? '#112233' : '#445566' })} />);
    expect(appelsRoute(f)).toBe(2);
    rerender(<Preview {...props({ format: '9:16' })} />);
    expect(videoSrc()).toBe(DERIVEE_916);
    expect(appelsRoute(f)).toBe(2);
  });

  it('D. jumeau PROPRE → l’original, une seule requête au plus, rien de dérivé', async () => {
    const f = routeDerivee({}); vi.stubGlobal('fetch', f);
    const { rerender } = render(<Preview {...props()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    for (let i = 0; i < 5; i++) rerender(<Preview {...props({ accent: i % 2 ? '#112233' : '#445566' })} />);
    expect(videoSrc()).toBe(JUMEAU);
    expect(await resoudreJumeauPleinCadre(JUMEAU, '1080:1920')).toBe(JUMEAU);
    expect(appelsRoute(f)).toBe(1);
  });

  it('média non-jumeau (rush ordinaire) → aucune requête', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    render(<Preview {...props({ rushUrl: url(`${A}/rush.mp4`) })} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(videoSrc()).toBe(url(`${A}/rush.mp4`));
    expect(f).not.toHaveBeenCalled();
  });

  it('E. jumeau d’un AUTRE compte → la VRAIE route répond 404, l’aperçu garde l’original', async () => {
    const { POST } = await import('@/app/api/creer/jumeau/plein-cadre/route');
    etat.session = { user: { id: B } };
    const statuts: number[] = [];
    const f = vi.fn(async (_p: string, init?: RequestInit) => {
      const r = await POST(new Request(`${ORIGINE}${API_PLEIN_CADRE}`, { method: 'POST', body: String(init?.body) }) as never);
      statuts.push(r.status);
      return r;
    });
    vi.stubGlobal('fetch', f);
    render(<Preview {...props()} />);
    await waitFor(() => expect(statuts).toEqual([404]));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(videoSrc()).toBe(JUMEAU);
    expect(document.body.innerHTML).not.toContain('jumeaux-recadres');
  });

  it('F. panne réseau → l’original, l’éditeur reste interactif, pas de rafale de requêtes', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', f);
    const { rerender } = render(<Preview {...props()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(videoSrc()).toBe(JUMEAU);
    // Interactif : un changement d'édition est rendu normalement.
    rerender(<Preview {...props({ focus: 'all' })} />);
    rerender(<Preview {...props({ focus: 'video' })} />);
    for (let i = 0; i < 5; i++) rerender(<Preview {...props({ accent: i % 2 ? '#112233' : '#445566' })} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(videoSrc()).toBe(JUMEAU);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('F (concurrence) : aperçu en vol puis export, route en échec → l’export reçoit l’original, ne lève JAMAIS', async () => {
    let liberer: (r: Response) => void = () => {};
    const f = vi.fn(() => new Promise<Response>((r) => { liberer = r; }));
    vi.stubGlobal('fetch', f);
    render(<Preview {...props()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const exportEnCours = pleinCadreDesJumeaux({ width: 1080, height: 1920, videoUrl: JUMEAU } as never) as Promise<{ videoUrl: string }>;
    liberer(new Response('{}', { status: 500 }));
    await expect(exportEnCours).resolves.toMatchObject({ videoUrl: JUMEAU });
    expect(f).toHaveBeenCalledTimes(1);
    expect(videoSrc()).toBe(JUMEAU);
  });

  it('F (refus HTTP 500) → l’original', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', f);
    render(<Preview {...props()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(videoSrc()).toBe(JUMEAU);
  });

  it('« Aperçu du média » (liste) : le jumeau sélectionné est aussi montré plein cadre', async () => {
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    render(<ApercuMedia media={{ type: 'video', url: JUMEAU, libelle: 'Mon jumeau' } as never} format="9:16" etat="ajoute" />);
    await waitFor(() => expect(document.querySelector('[data-apercu-media-video]')?.getAttribute('src')).toBe(DERIVEE_916));
    expect(appelsRoute(f)).toBe(1);
  });

  it('G + H. ni HeyGen, ni D-ID, ni crédits', async () => {
    etat.session = { user: { id: A } };
    const f = routeDerivee(); vi.stubGlobal('fetch', f);
    render(<Preview {...props()} />);
    await waitFor(() => expect(videoSrc()).toBe(DERIVEE_916));
    await pleinCadreDesJumeaux({ width: 1080, height: 1920, videoUrl: JUMEAU } as never);
    expect(espions.heygen).not.toHaveBeenCalled();
    expect(espions.did).not.toHaveBeenCalled();
    expect(espions.credits).not.toHaveBeenCalled();
  });
});
