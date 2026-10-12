/**
 * BUG D — « La génération de votre avatar a échoué » affiché alors que le
 * jumeau est prêt et que l'aperçu montre l'avatar.
 *
 * Cause (code, 5835557) : l'identifiant `jumeauGenerationId` d'une génération
 * VIDÉO en échec restait dans le brouillon (seul le 404 l'effaçait). À chaque
 * ouverture, la reprise relisait cette ligne terminale `failed` (lecture en
 * base, aucun appel fournisseur, aucun journal serveur) et affichait son
 * `error_message` — `MESSAGES_AVATAR.echec`, qui accuse l'AVATAR alors que
 * c'est une VIDÉO qui a échoué — même quand une vidéo de jumeau plus récente
 * était déjà posée. Un envoi réussi n'effaçait pas non plus ce bandeau.
 *
 * Tout est mocké : AUCUN fournisseur, AUCUN crédit, AUCUN appel payant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import { MESSAGES_AVATAR } from '@/lib/avatar/fournisseurs';
import { MESSAGE_ECHEC_VIDEO_AVATAR, motifEchecVideoAvatar } from '@/lib/creer/jumeau';

const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);
const traitement = () => rep(200, { success: true, data: { status: 'processing', videoUrl: null } });
/** Le message que les lignes `failed` déjà en base portent (avant ce correctif). */
const ANCIEN_MESSAGE = 'La génération de votre avatar a échoué.';
const ACCUSE_AVATAR = /génération de votre avatar a échoué/;

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (cards: unknown) => cards }));
const MONTAGE = () => new Blob([new Uint8Array(2048)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  const compose = async () => ({ video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) });
  const upload = async () => ({ blob: MONTAGE(), url: 'https://cdn/libre.webm', thumbnailUrl: null, composerVersion: 'v1' });
  return { ...actual, composeVideo: compose, composeAndUpload: upload, uploadRendu: upload, downloadBlob: async () => {} };
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value(this: HTMLMediaElement) {
    if (!this.getAttribute('src')) return;
    Object.defineProperty(this, 'duration', { configurable: true, value: 8 });
    setTimeout(() => this.onloadedmetadata?.(new Event('loadedmetadata')), 0);
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });
if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:montage';
if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin', subtitle: 'Reveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }, { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' }],
};
const GENERATION = '55555555-5555-4555-8555-000000000009';
const URL_JUMEAU = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GENERATION}.mp4`;
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

type Statut = 'processing' | 'completed' | 'failed' | '404' | '401';
let statut: Statut;
let trace: string[];

function installerFetch() {
  trace = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    if (u.startsWith('/api/avatar/status?generationId=')) {
      trace.push('status');
      if (statut === '404') return rep(404, { success: false, error: 'Generation introuvable.' });
      if (statut === '401') return rep(401, { success: false, error: 'Unauthorized' });
      if (statut === 'completed') return rep(200, { success: true, data: { status: 'completed', videoUrl: URL_JUMEAU, error: null } });
      if (statut === 'failed') return rep(200, { success: true, data: { status: 'failed', videoUrl: null, error: ANCIEN_MESSAGE } });
      return traitement();
    }
    if (u === '/api/creer/jumeau/generer' && m === 'POST') { trace.push('generer'); return rep(200, { success: true, data: { generationId: GENERATION, status: 'pending', avatarVersion: 3 } }); }
    if (u === '/api/creer/jumeau') return rep(200, { success: true, data: PRET });
    if (u.includes('/api/credits/balance')) { trace.push('solde'); return rep(200, { ok: true, politique: 'credits', balance: 5000 }); }
    if (u.endsWith('/api/render/jobs') && m === 'POST') { trace.push('reservation'); return rep(200, { ok: true, jobId: 'job-1', uploadUrl: '/api/render/jobs/job-1/upload', uploadMode: 'relais', publicUrl: 'https://studiio.pro/storage/v1/object/public/media/u1/rendus/job-1.webm', cout: 10 }); }
    if (u.includes('/jobs/job-1/upload')) { trace.push('televersement'); return rep(200, {}); }
    if (u.includes('/api/render/jobs/job-1/confirm')) { trace.push('confirmation'); return rep(200, { ok: true, politique: 'credits', balance: 4990 }); }
    if (u.includes('/api/render/jobs/job-1/cancel')) { trace.push('annulation'); return rep(200, { ok: true }); }
    if (u.includes('/api/upload/signed-url')) return rep(200, { success: true, signedUrl: 'https://minio/vignette', publicUrl: 'https://cdn/v.jpg' });
    if (u.includes('/api/posts') && m === 'POST') { trace.push('post'); return rep(200, { success: true, post: { id: 'p1' } }); }
    if (/\/api\/avatar\/(create|sources|generate|did|consentement|validation)/.test(u) && m !== 'GET') { trace.push('entrainement'); return rep(200, { success: true }); }
    if (u.includes('/api/autopilot/config')) return rep(200, { success: true, ready: true, brandingReady: true, config: {} });
    return rep(200, { success: true, ok: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}

const poser = (extra: Record<string, unknown>) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01', ...extra,
  }));
};
const laisser = async (n = 20) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => { window.localStorage.clear(); statut = 'processing'; installerFetch(); });
// Toute boucle de suivi encore vivante s'éteint à sa prochaine lecture.
afterEach(() => { statut = '404'; cleanup(); vi.clearAllMocks(); });


const ANCIENNE = '55555555-5555-4555-8555-00000000000a';
const URL_ANCIEN_JUMEAU_OK = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${ANCIENNE}.mp4`;
const brouillon = () => JSON.parse(window.localStorage.getItem(CLE)!);

describe('A. Messages — la vidéo a échoué, pas l’avatar', () => {
  it('⚠️ serveur : les messages d’échec de génération nomment la VIDÉO avec l’avatar', () => {
    expect(MESSAGES_AVATAR.echec).toBe(MESSAGE_ECHEC_VIDEO_AVATAR);
    expect(MESSAGE_ECHEC_VIDEO_AVATAR).toBe('La génération de la vidéo avec votre avatar a échoué.');
    expect(MESSAGES_AVATAR.echecRembourse.startsWith(MESSAGE_ECHEC_VIDEO_AVATAR)).toBe(true);
    expect(MESSAGES_AVATAR.echecAvantLancement.startsWith(MESSAGE_ECHEC_VIDEO_AVATAR)).toBe(true);
    for (const m of Object.values(MESSAGES_AVATAR)) expect(m).not.toMatch(ACCUSE_AVATAR);
  });
  it('motif : l’ancien et le nouveau libellé ne sont jamais répétés, le reste (crédits, délai) est gardé', () => {
    expect(motifEchecVideoAvatar(ANCIEN_MESSAGE)).toBeNull();
    expect(motifEchecVideoAvatar(MESSAGE_ECHEC_VIDEO_AVATAR)).toBeNull();
    expect(motifEchecVideoAvatar('La génération de votre avatar a échoué. Vos crédits Studiio ont été recrédités.')).toBe('Vos crédits Studiio ont été recrédités.');
    expect(motifEchecVideoAvatar('La generation a depasse le delai maximum (30 minutes).')).toBe('La generation a depasse le delai maximum (30 minutes).');
    expect(motifEchecVideoAvatar(null)).toBeNull();
  });
});

describe('B. Rechargement — un ANCIEN job en échec', () => {
  it('⚠️ jumeau prêt + vidéo de jumeau déjà posée + ancien job failed → AUCUN message d’échec, identifiant oublié, rien lancé', async () => {
    statut = 'failed';
    poser({ step: 0, jumeauMode: 'aucun', jumeauGenerationId: GENERATION, rushUrl: URL_ANCIEN_JUMEAU_OK });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(trace).toContain('status'));
    await laisser(10);
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
    expect(document.body.textContent).not.toMatch(ACCUSE_AVATAR);
    expect(document.body.textContent).not.toMatch(/a échoué|n’a pas abouti/);
    expect(trace).not.toContain('generer');
    expect(trace).not.toContain('entrainement');
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(brouillon().jumeauGenerationId).toBeUndefined();
    expect(brouillon().rushUrl).toBe(URL_ANCIEN_JUMEAU_OK);
  });

  it('⚠️ job failed sans vidéo en place → message EXACT « vidéo avec votre avatar », jamais « avatar a échoué », identifiant oublié (pas de boucle)', async () => {
    statut = 'failed';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(document.querySelector('[data-jumeau-erreur]')).not.toBeNull());
    const bandeau = document.querySelector('[data-jumeau-erreur]') as HTMLElement;
    expect(bandeau.textContent).toContain('La génération de la vidéo avec votre avatar a échoué.');
    expect(document.body.textContent).not.toMatch(ACCUSE_AVATAR);
    expect(document.querySelector('[data-jumeau-erreur-motif]')).toBeNull();
    expect(screen.getByRole('button', { name: /^Réessayer$/ })).toBeTruthy();
    expect(trace.filter((t) => t === 'status')).toHaveLength(1);
    expect(trace).not.toContain('generer');
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(brouillon().jumeauGenerationId).toBeUndefined();

    // Nouvelle ouverture : le même ancien échec ne revient pas.
    cleanup();
    trace.length = 0;
    render(<AssistantWizard />);
    await laisser();
    expect(trace).not.toContain('status');
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
  });
});

describe('C. « Réessayer » — UNE génération vidéo, aucun entraînement, débit au plus une fois', () => {
  it('⚠️ double clic → exactement un POST /generer, aucun appel d’entraînement d’avatar ; succès → bandeau retiré, état rechargé cohérent', async () => {
    statut = 'failed';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Réessayer$/ })).not.toBeNull());
    statut = 'processing';
    const bouton = screen.getByRole('button', { name: /^Réessayer$/ });
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton); });
    await laisser(5);
    expect(trace.filter((t) => t === 'generer')).toHaveLength(1);
    statut = 'completed';
    await waitFor(() => expect(document.querySelector('[data-jumeau-notice]')).not.toBeNull(), { timeout: 9000 });
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
    expect(trace.filter((t) => t === 'generer')).toHaveLength(1);
    expect(trace).not.toContain('entrainement');
    // Aucun débit côté navigateur : ni réservation de rendu, ni confirmation.
    expect(trace.filter((t) => ['reservation', 'confirmation'].includes(t))).toEqual([]);
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const b = brouillon();
    expect(b.jumeauGenerationId).toBeUndefined();
    expect(b.rushUrl).toBe(URL_JUMEAU);

    // Rechargement après le succès : prêt, rien à reprendre, aucun échec.
    cleanup();
    trace.length = 0;
    render(<AssistantWizard />);
    await laisser();
    // Seule lecture permise : la vérification de version du rush posé
    // (`versionAncienneDuRush`, lecture en base) — aucune reprise, aucun lancement.
    await laisser(10);
    expect(trace.filter((t) => t === 'status').length).toBeLessThanOrEqual(1);
    expect(trace).not.toContain('generer');
    expect(document.querySelector('[data-jumeau-reprise]')).toBeNull();
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
    expect(document.body.textContent).not.toMatch(ACCUSE_AVATAR);
  }, 20000);
});

describe('D. Envoi réussi — l’ancien bandeau d’échec disparaît', () => {
  it('⚠️ bandeau d’un ancien échec, puis envoi avec le jumeau qui aboutit → plus aucun message d’échec', async () => {
    statut = 'failed';
    poser({ step: 4, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser(2);
    await waitFor(() => expect(document.querySelector('[data-jumeau-erreur]')).not.toBeNull());
    statut = 'completed';
    for (let i = 0; i < 4 && !document.querySelector('[data-batch-mode="unique"]'); i += 1) {
      const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
      if (!suivant) break;
      await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
    }
    const envoyer = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0];
    await act(async () => { fireEvent.click(envoyer); });
    await waitFor(() => expect(trace).toContain('post'), { timeout: 9000 });
    expect(trace.filter((t) => t === 'generer')).toHaveLength(1);
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
    expect(document.body.textContent).not.toMatch(ACCUSE_AVATAR);
  }, 20000);
});
