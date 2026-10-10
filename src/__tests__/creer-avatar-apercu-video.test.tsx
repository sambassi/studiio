/**
 * « Faire apparaître mon avatar » — l'APERÇU DU STYLE, séquence « Vidéo ».
 *
 * À l'envoi, la vidéo du jumeau REMPLACE le rush dans la séquence « Vidéo »
 * (`runRenderInterne`). L'aperçu montrait pourtant le rush (ou le média stock
 * ajouté) : l'avatar n'y paraissait jamais. Désormais, avatar choisi →
 * l'aperçu montre la SOURCE EXISTANTE de l'avatar (lecture seule, aucun
 * fournisseur) avec « Votre avatar apparaîtra ici » ; avatar non prêt → le
 * message de configuration ; avatar non choisi → l'aperçu d'avant, inchangé.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, ensureFontsLoaded: async () => [], preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (cards: unknown) => cards }));
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value() {} });
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

import AssistantWizard, { Preview } from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';
import { apercuAvatarDepuisListe, type ApercuAvatarCreer } from '../lib/creer/apercu-avatar';

// ── Aperçu seul ──────────────────────────────────────────────────────────

const generated = {
  title: 'Routine matin',
  subtitle: 'Sous-titre',
  cards: [{ id: 'a', icon: 'Flame', title: 'Matin', description: '', value: '70%' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
const base = {
  generated,
  format: '9:16' as const,
  displayScale: 0.25,
  gradStart: '#7C3AED',
  gradEnd: '#EC4899',
  gradientOpacity: 0.5,
  accent: '#7C3AED',
  watermark: 'Studiio.pro',
  text: TEXT,
  onFocusChange: () => {},
  activeOrder: ['intro', 'cards', 'video', 'cta'],
  focus: 'video' as const,
};
const RUSH = 'https://exemple.test/rush.mp4';
const SOURCE = '/api/avatars/versions/ver-1/source';
const PRET_VIDEO: ApercuAvatarCreer = { etat: 'pret', nom: 'Bassi', version: 3, type: 'video', url: SOURCE };
const PRET_PHOTO: ApercuAvatarCreer = { etat: 'pret', nom: 'Bassi', version: 3, type: 'photo', url: SOURCE };

const videoRush = () => Array.from(document.querySelectorAll('video')).find((v) => v.getAttribute('src') === RUSH) ?? null;
const media = () => document.querySelector('[data-apercu-avatar-media]');
const indice = () => document.querySelector('[data-apercu-avatar-indice]');
const config = () => document.querySelector('[data-apercu-avatar-config]');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Aperçu du style — séquence Vidéo', () => {
  it('1 · avatar non choisi : le rush, et lui seul — le rendu d’avant', () => {
    render(<Preview {...base} rushUrl={RUSH} />);
    expect(videoRush()).not.toBeNull();
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(document.querySelector('[data-apercu-avatar]')).toBeNull();
    // Même DOM qu'avec `avatarApercu={null}` explicite.
    const avant = document.body.innerHTML;
    cleanup();
    render(<Preview {...base} rushUrl={RUSH} avatarApercu={null} />);
    expect(document.body.innerHTML).toBe(avant);
  });

  it('2 · avatar choisi et prêt : la source de l’avatar + « Votre avatar apparaîtra ici » (vidéo ou photo)', () => {
    render(<Preview {...base} rushUrl={RUSH} avatarApercu={PRET_VIDEO} />);
    expect(media()?.tagName).toBe('VIDEO');
    expect(media()?.getAttribute('src')).toBe(SOURCE);
    expect(indice()?.textContent).toContain('Votre avatar apparaîtra ici');
    cleanup();
    render(<Preview {...base} avatarApercu={PRET_PHOTO} />);
    expect(media()?.tagName).toBe('IMG');
    expect(media()?.getAttribute('src')).toBe(SOURCE);
    expect(indice()?.textContent).toContain('Votre avatar apparaîtra ici');
  });

  it('3 · avatar choisi mais pas prêt : message de configuration vers Mon avatar, aucun média', () => {
    render(<Preview {...base} rushUrl={RUSH} avatarApercu={{ etat: 'absent' }} />);
    expect(config()).not.toBeNull();
    expect(config()!.textContent).toContain('Gérer mon avatar');
    expect(config()!.querySelector('a')!.getAttribute('href')).toBe('/dashboard/avatar');
    expect(media()).toBeNull();
    expect(videoRush()).toBeNull();
  });

  it('4/5 · bascule ON → OFF → ON : le rush revient, puis l’avatar revient', () => {
    const { rerender } = render(<Preview {...base} rushUrl={RUSH} avatarApercu={PRET_VIDEO} />);
    expect(media()).not.toBeNull();
    expect(videoRush()).toBeNull();
    rerender(<Preview {...base} rushUrl={RUSH} avatarApercu={null} />);
    expect(media()).toBeNull();
    expect(videoRush()).not.toBeNull();
    rerender(<Preview {...base} rushUrl={RUSH} avatarApercu={PRET_VIDEO} />);
    expect(media()?.getAttribute('src')).toBe(SOURCE);
    expect(videoRush()).toBeNull();
  });

  it('7 · un rush ou un média stock ajouté ne remplace pas l’avatar', () => {
    const { rerender } = render(<Preview {...base} avatarApercu={PRET_VIDEO} />);
    rerender(<Preview {...base} rushUrl="https://images.pexels.com/video-files/1/stock.mp4" avatarApercu={PRET_VIDEO} />);
    expect(media()?.getAttribute('src')).toBe(SOURCE);
    expect(document.querySelectorAll('video')).toHaveLength(1);
  });

  it('l’indication est une aide d’édition : jamais photographiée (capturing)', () => {
    render(<Preview {...base} avatarApercu={PRET_VIDEO} capturing />);
    expect(media()).not.toBeNull();
    expect(indice()).toBeNull();
  });
});

describe('apercuAvatarDepuisListe', () => {
  const liste = [
    { id: 'a1', nom: 'Défaut', parDefaut: true, utilisable: true, type: 'photo', versionActive: { id: 'v-a1', version: 2, type: 'photo', source: true } },
    { id: 'a2', nom: 'Studio', parDefaut: false, utilisable: true, type: 'video', versionActive: { id: 'v-a2', version: 5, type: 'video', source: true } },
    { id: 'a3', nom: 'Brouillon', parDefaut: false, utilisable: false, type: 'video', versionActive: null },
  ];
  it('l’avatar choisi, sinon le défaut ; jamais un avatar inutilisable', () => {
    expect(apercuAvatarDepuisListe(liste, 'a2')).toEqual({ etat: 'pret', nom: 'Studio', version: 5, type: 'video', url: '/api/avatars/versions/v-a2/source' });
    expect(apercuAvatarDepuisListe(liste, null)).toMatchObject({ etat: 'pret', nom: 'Défaut', url: '/api/avatars/versions/v-a1/source' });
    expect(apercuAvatarDepuisListe(liste, 'a3')).toMatchObject({ nom: 'Défaut' });
  });
  it('aucun avatar utilisable, ou liste illisible → absent', () => {
    expect(apercuAvatarDepuisListe([liste[2]], null)).toEqual({ etat: 'absent' });
    expect(apercuAvatarDepuisListe(null, null)).toEqual({ etat: 'absent' });
  });
  it('version sans source conservée → prêt, sans média', () => {
    expect(apercuAvatarDepuisListe([{ ...liste[0], versionActive: { id: 'v', version: 1, source: false } }], null)).toMatchObject({ etat: 'pret', url: null });
  });
});

// ── Dans le wizard ───────────────────────────────────────────────────────

const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);
const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin', subtitle: 'Reveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }],
};
const RUSH_WIZARD = 'https://studiio.pro/storage/v1/object/public/media/u1/rushes/rush.mp4';
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a1', version: 3, nom: 'Bassi', valideLe: '2026-09-03', fournisseur: 'heygen' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };
const AVATAR_PRET = { id: 'a1', nom: 'Bassi', parDefaut: true, utilisable: true, type: 'video', versionActive: { id: 'ver-1', version: 3, type: 'video', source: true } };
let avatars: unknown[] = [AVATAR_PRET];

let appels: string[];
function installerFetch() {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    appels.push(u);
    if (u === '/api/avatars') return rep(200, { success: true, data: { avatars, qualites: [] } });
    if (u.startsWith('/api/creer/jumeau')) return rep(200, { success: true, data: PRET });
    if (u.includes('/api/autopilot/config')) return rep(200, { success: true, ready: true, brandingReady: true, config: {} });
    return rep(200, { success: true, ok: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}
const poser = (extra: Record<string, unknown>) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1, customTopic: 'yoga du matin', generated: CONTENU,
    scheduledDate: '2026-09-01', rushUrl: RUSH_WIZARD, rushName: 'rush.mp4',
    sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: true }, { key: 'cta', enabled: true }],
    ...extra,
  }));
};
const laisser = async (n = 20) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const ongletVideo = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim() === 'Vidéo')!;
const FOURNISSEURS = /heygen|d-id|elevenlabs|\/api\/avatar\/generate|\/api\/creer\/jumeau\/generer|\/api\/avatar\/did/i;

describe('Créer — avatar choisi, onglet « Vidéo » de l’aperçu du style (régression)', () => {
  beforeEach(() => { window.localStorage.clear(); avatars = [AVATAR_PRET]; installerFetch(); });

  it('⚠️ mode avatar + rush posé : l’aperçu montre l’AVATAR, pas le rush ; aucune requête fournisseur', async () => {
    poser({ jumeauMode: 'avatar' });
    render(<AssistantWizard />);
    await laisser();
    await act(async () => { fireEvent.click(ongletVideo()); });
    await laisser();
    await waitFor(() => expect(media()?.getAttribute('src')).toBe(SOURCE));
    expect(indice()?.textContent).toContain('Votre avatar apparaîtra ici');
    expect(Array.from(document.querySelectorAll('video')).some((v) => v.getAttribute('src') === RUSH_WIZARD)).toBe(false);
    expect(appels).toContain('/api/avatars');
    // 6 · rien vers un fournisseur ni vers une route de génération.
    expect(appels.filter((u) => FOURNISSEURS.test(u))).toEqual([]);
  });

  it('mode aucun : le rush, comme avant — /api/avatars n’est même pas lu', async () => {
    poser({ jumeauMode: 'aucun' });
    render(<AssistantWizard />);
    await laisser();
    await act(async () => { fireEvent.click(ongletVideo()); });
    await laisser();
    expect(Array.from(document.querySelectorAll('video')).some((v) => v.getAttribute('src') === RUSH_WIZARD)).toBe(true);
    expect(document.querySelector('[data-apercu-avatar]')).toBeNull();
    expect(appels).not.toContain('/api/avatars');
  });

  it('mode avatar sans rush : l’onglet « Vidéo » est ouvert (l’envoi l’active d’office) et montre l’avatar', async () => {
    poser({ jumeauMode: 'avatar', rushUrl: null, rushName: null, sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: false }, { key: 'cta', enabled: true }] });
    render(<AssistantWizard />);
    await laisser();
    expect(ongletVideo().disabled).toBe(false);
    await act(async () => { fireEvent.click(ongletVideo()); });
    await laisser();
    await waitFor(() => expect(media()?.getAttribute('src')).toBe(SOURCE));
  });

  it('mode avatar, aucun avatar utilisable : message de configuration, aucune génération', async () => {
    avatars = [{ ...AVATAR_PRET, utilisable: false, versionActive: null }];
    poser({ jumeauMode: 'avatar' });
    render(<AssistantWizard />);
    await laisser();
    await act(async () => { fireEvent.click(ongletVideo()); });
    await laisser();
    await waitFor(() => expect(config()).not.toBeNull());
    expect(media()).toBeNull();
    expect(appels.filter((u) => FOURNISSEURS.test(u))).toEqual([]);
  });
});
