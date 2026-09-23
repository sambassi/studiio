/**
 * JUMEAU — progression honnête, polling borné, aperçu qui se montre.
 *
 * L'audit (Terminal 2, base 80cf6f8) a prouvé :
 *   - « bloqué à 5 % » : `setRenderProgress(5)` posé au lancement, puis plus
 *     rien pendant les 5 à 30 min du fournisseur — aucune API ne donne de
 *     pourcentage (`/api/avatar/status` : processing | completed | failed) ;
 *   - polling : un 404 bouclait 20 min, une coupure réseau tuait l'attente
 *     au premier `fetch` rejeté, et le client abandonnait à 20 min quand le
 *     serveur tranche (échec + remboursement) à 30 min ;
 *   - aperçu : un montage prêt restait caché si l'onglet n'était pas « Tout »,
 *     et une vidéo de jumeau reprise restait masquée par l'ancien montage.
 *
 * Tout est mocké : AUCUN fournisseur, AUCUN crédit, AUCUN appel payant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import {
  attendreStatutJumeau, genererEtAttendreVideoJumeau, etapesJumeau, ErreurAttenteJumeau,
  JUMEAU_ATTENTE_MAX_MS, JUMEAU_ECHECS_MAX, JUMEAU_POLL_MS, PHASES_JUMEAU, type PhaseJumeau,
} from '@/lib/creer/jumeau';
import { STALE_AFTER_MS } from '@/lib/avatar/statut';

const GEN = 'g-1';
const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);
const traitement = () => rep(200, { success: true, data: { status: 'processing', videoUrl: null } });
const termine = () => rep(200, { success: true, data: { status: 'completed', videoUrl: '/media/u/avatar/g-1.mp4', error: null } });

/** Un fetch scripté : chaque élément est une réponse, ou 'reseau' (fetch rejeté). */
function fetchScripte(script: Array<Response | 'reseau'>) {
  let i = 0;
  const appels: string[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push(`${init?.method ?? 'GET'} ${u}`);
    if (u === '/api/creer/jumeau/generer') return rep(200, { success: true, data: { generationId: GEN, status: 'pending', avatarVersion: 3 } });
    const r = script[Math.min(i++, script.length - 1)];
    if (r === 'reseau') throw new TypeError('Failed to fetch');
    return r;
  });
  return { f: f as unknown as typeof fetch, appels, status: () => appels.filter((a) => a.includes('/api/avatar/status')).length };
}

describe('A. attendreStatutJumeau — le contrat réel de /api/avatar/status', () => {
  const dodos: number[] = [];
  const dormir = async (ms: number) => { dodos.push(ms); };
  beforeEach(() => { dodos.length = 0; });

  it('⚠️ 404 → terminal « introuvable », UNE seule lecture, aucune relance', async () => {
    const s = fetchScripte([rep(404, { success: false, error: 'Generation introuvable.' })]);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: dormir }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurAttenteJumeau);
    expect((e as ErreurAttenteJumeau).code).toBe('introuvable');
    expect(s.status()).toBe(1);
    expect(dodos).toEqual([]);
  });

  it('401 → terminal « session » (la génération continue : identifiant à garder)', async () => {
    const s = fetchScripte([rep(401, { success: false, error: 'Unauthorized' })]);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: dormir }).catch((x) => x);
    expect((e as ErreurAttenteJumeau).code).toBe('session');
    expect(s.status()).toBe(1);
  });

  it('⚠️ erreur réseau temporaire → relue, puis completed : l’URL est rendue (plus d’exception brute « Failed to fetch »)', async () => {
    const s = fetchScripte(['reseau', 'reseau', traitement(), termine()]);
    const phases: PhaseJumeau[] = [];
    const r = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: dormir, onPhase: (p) => phases.push(p) });
    expect(r).toEqual({ url: '/media/u/avatar/g-1.mp4' });
    expect(s.status()).toBe(4);
    expect(phases).toEqual(['traitement', 'stockage']);
  });

  it('⚠️ relances BORNÉES : réseau coupé en continu → arrêt « connexion » après JUMEAU_ECHECS_MAX lectures, attente plafonnée à 30 s', async () => {
    const s = fetchScripte(['reseau']);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: dormir }).catch((x) => x);
    expect((e as ErreurAttenteJumeau).code).toBe('connexion');
    expect((e as Error).message).toMatch(/continue côté serveur/);
    expect(s.status()).toBe(JUMEAU_ECHECS_MAX);
    expect(Math.max(...dodos)).toBeLessThanOrEqual(30_000);
  });

  it('5xx / JSON illisible : même borne ; une réponse valide remet le compteur à zéro', async () => {
    const mauvais = () => rep(502, null);
    const illisible = { ok: false, status: 502, json: async () => { throw new SyntaxError('html'); } } as unknown as Response;
    const n = JUMEAU_ECHECS_MAX - 1;
    const s = fetchScripte([...Array(n).fill(mauvais()), traitement(), ...Array(n - 1).fill(mauvais()), illisible, termine()]);
    const r = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: dormir });
    expect(r.url).toBe('/media/u/avatar/g-1.mp4');
    const toujoursKo = fetchScripte([mauvais()]);
    expect(((await attendreStatutJumeau({ generationId: GEN, fetchImpl: toujoursKo.f, attendreMs: dormir }).catch((x) => x)) as ErreurAttenteJumeau).code).toBe('connexion');
    expect(toujoursKo.status()).toBe(JUMEAU_ECHECS_MAX);
  });

  it('⚠️ completed ARRÊTE le polling ; failed ARRÊTE le polling avec le message serveur', async () => {
    const ok = fetchScripte([traitement(), traitement(), termine(), traitement()]);
    await attendreStatutJumeau({ generationId: GEN, fetchImpl: ok.f, attendreMs: dormir });
    expect(ok.status()).toBe(3);
    const ko = fetchScripte([traitement(), rep(200, { success: true, data: { status: 'failed', videoUrl: null, error: 'HeyGen a signale un echec. Credits rembourses.' } }), traitement()]);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: ko.f, attendreMs: dormir }).catch((x) => x);
    expect((e as ErreurAttenteJumeau).code).toBe('echec');
    expect((e as Error).message).toMatch(/Credits rembourses/);
    expect(ko.status()).toBe(2);
  });

  it('⚠️ délai client ALIGNÉ sur le serveur : > 30 min (STALE_AFTER_MS), le verdict serveur passe toujours avant', async () => {
    expect(JUMEAU_ATTENTE_MAX_MS).toBeGreaterThan(STALE_AFTER_MS);
    expect(JUMEAU_ATTENTE_MAX_MS - STALE_AFTER_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    // Horloge simulée : chaque dodo avance le temps. Toujours `processing`.
    let t = 0;
    const s = fetchScripte([traitement()]);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: async (ms) => { t += ms; }, maintenant: () => t }).catch((x) => x);
    expect((e as ErreurAttenteJumeau).code).toBe('delai');
    expect(t).toBeGreaterThanOrEqual(STALE_AFTER_MS);
    expect(s.status()).toBe(Math.ceil(JUMEAU_ATTENTE_MAX_MS / JUMEAU_POLL_MS));
    // Et quand le serveur tranche à 30 min, c'est SON message qui arrive.
    t = 0;
    const serveur = fetchScripte([...Array(STALE_AFTER_MS / JUMEAU_POLL_MS).fill(traitement()), rep(200, { success: true, data: { status: 'failed', videoUrl: null, error: 'La generation a depasse le delai maximum (30 minutes). Credits rembourses.' } })]);
    const v = await attendreStatutJumeau({ generationId: GEN, fetchImpl: serveur.f, attendreMs: async (ms) => { t += ms; }, maintenant: () => t }).catch((x) => x);
    expect((v as ErreurAttenteJumeau).code).toBe('echec');
    expect((v as Error).message).toMatch(/30 minutes/);
  });

  it('⚠️ genererEtAttendre : UN seul lancement même si le suivi a des ratés — aucune relance du fournisseur payant', async () => {
    const s = fetchScripte(['reseau', rep(503, null), traitement(), termine()]);
    const phases: PhaseJumeau[] = [];
    await genererEtAttendreVideoJumeau({ textes: ['Bonjour'], aspectRatio: '9:16', fetchImpl: s.f, attendreMs: dormir, onPhase: (p) => phases.push(p) });
    expect(s.appels.filter((a) => a === 'POST /api/creer/jumeau/generer')).toHaveLength(1);
    expect(phases).toEqual(['envoi', 'traitement', 'stockage']);
  });
});

describe('B. Les étapes réelles, sans pourcentage inventé', () => {
  it('Préparation → Envoi → Traitement → Stockage → Rendu → Prêt, dans l’ordre où elles se produisent', () => {
    expect(PHASES_JUMEAU.map((p) => p.libelle)).toEqual(['Préparation', 'Envoi', 'Traitement', 'Stockage', 'Rendu', 'Prêt']);
    expect(etapesJumeau('traitement').map((e) => e.etat)).toEqual(['terminee', 'terminee', 'courante', 'a_venir', 'a_venir', 'a_venir']);
    expect(etapesJumeau('pret').every((e) => e.etat === 'terminee')).toBe(true);
    expect(etapesJumeau('envoi', true)[1].etat).toBe('echouee');
  });

  it('⚠️ le 5 % fixe a disparu du code ; seul l’étape « Rendu » (frames mesurées) porte un pourcentage', () => {
    const src = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/setRenderProgress\(5\)/);
    expect(code).toMatch(/jumeauPhase\.phase === 'rendu' \? \{ pourcentage: renderProgress \} : \{\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// C. Dans l'assistant — même harnais que creer-jumeau-un-clic / reprise.
// ─────────────────────────────────────────────────────────────────────────
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
      if (statut === 'failed') return rep(200, { success: true, data: { status: 'failed', videoUrl: null, error: 'Le fournisseur a échoué.' } });
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
const ongletActif = () => (screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? '').trim();

beforeEach(() => { window.localStorage.clear(); statut = 'processing'; installerFetch(); });
// Toute boucle de suivi encore vivante s'éteint à sa prochaine lecture.
afterEach(() => { statut = '404'; cleanup(); vi.clearAllMocks(); });

describe('C. Envoi avec le jumeau — étapes réelles pendant le rendu fournisseur', () => {
  it('⚠️ processing sans pourcentage : barre INDÉTERMINÉE, étape « Traitement », jamais « 5 % » ; completed → polling arrêté, montage livré, un seul lancement', async () => {
    poser({ step: 4, jumeauMode: 'avatar' });
    render(<AssistantWizard />);
    await laisser(2);
    for (let i = 0; i < 4 && !document.querySelector('[data-batch-mode="unique"]'); i += 1) {
      const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
      if (!suivant) break;
      await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
    }
    const envoyer = screen.queryAllByRole('button', { name: /Composer et envoyer/i })[0];
    await act(async () => { fireEvent.click(envoyer); });
    await waitFor(() => expect(trace).toContain('status'));
    await laisser(5);

    const suivi = document.querySelector('[data-jumeau-suivi="envoi"] [data-progress-status="en_cours"]') as HTMLElement;
    expect(suivi).not.toBeNull();
    expect(suivi.getAttribute('data-progress-determinee')).toBe('non');
    expect(suivi.querySelector('[data-progress-barre]')?.getAttribute('data-progress-barre')).toBe('indeterminee');
    expect(suivi.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    expect(suivi.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect([...suivi.querySelectorAll('[data-progress-etape-etat]')].map((e) => e.getAttribute('data-progress-etape-etat')))
      .toEqual(['terminee', 'terminee', 'courante', 'a_venir', 'a_venir', 'a_venir']);
    expect(suivi.textContent).toContain('Traitement');
    expect(document.body.textContent).not.toMatch(/(^|\D)5\s?%/);
    expect(trace).not.toContain('reservation');

    // Le fournisseur termine : la PROCHAINE lecture (5 s) le voit, et plus aucune après.
    statut = 'completed';
    await waitFor(() => expect(trace).toContain('post'), { timeout: 9000 });
    const lectures = trace.filter((t) => t === 'status').length;
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(trace.filter((t) => t === 'status').length).toBe(lectures);
    expect(trace.filter((t) => t === 'generer')).toHaveLength(1);
    expect(trace.filter((t) => t === 'reservation')).toHaveLength(1);
    expect(document.querySelector('[data-jumeau-suivi]')).toBeNull();
  }, 20000);
});

describe('D. Aperçu — le résultat prêt se montre, sans clic', () => {
  it('⚠️ « Voir le rendu » depuis l’onglet « Titre » : le montage prêt bascule sur « Tout » et JOUE dans le cadre', async () => {
    poser({ step: 0 });
    render(<AssistantWizard />);
    await laisser();
    await act(async () => { fireEvent.click(screen.getAllByRole('tab', { name: /Titre/ })[0]); });
    expect(ongletActif()).toMatch(/Titre/);
    const bouton = document.querySelector('[data-play-rendu]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(bouton); });
    await waitFor(() => expect(document.querySelector('[data-play-lecteur]')).not.toBeNull(), { timeout: 5000 });
    expect(ongletActif()).toMatch(/Tout/);
  });
});

describe('E. Après un rechargement — le job existant est repris, jamais relancé', () => {
  it('⚠️ job déjà completed : vidéo posée, onglet « Vidéo » affiché, AUCUN lancement, AUCUN débit', async () => {
    statut = 'completed';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(document.querySelector('[data-jumeau-notice]')).not.toBeNull());
    await waitFor(() => expect(ongletActif()).toMatch(/Vidéo/));
    expect(trace.filter((t) => t === 'status')).toHaveLength(1);
    expect(trace).not.toContain('generer');
    expect(trace.filter((t) => ['reservation', 'confirmation', 'post'].includes(t))).toEqual([]);
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const b = JSON.parse(window.localStorage.getItem(CLE)!);
    expect(b.rushUrl).toBe(URL_JUMEAU);
    expect(b.jumeauGenerationId).toBeUndefined();
  });

  it('⚠️ job 404 : motif affiché, identifiant OUBLIÉ (plus de boucle à chaque ouverture), aucun lancement automatique', async () => {
    statut = '404';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(document.querySelector('[data-jumeau-erreur]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-erreur-motif]')?.textContent).toMatch(/introuvable/);
    expect(trace.filter((t) => t === 'status')).toHaveLength(1);
    expect(trace).not.toContain('generer');
    expect(document.querySelector('[data-jumeau-reprendre]')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(JSON.parse(window.localStorage.getItem(CLE)!).jumeauGenerationId).toBeUndefined();
  });

  it('⚠️ suivi coupé (session) : « Reprendre le suivi » relit le MÊME job — jamais une seconde génération payante', async () => {
    statut = '401';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(document.querySelector('[data-jumeau-reprendre]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /^Réessayer$/ })).toBeNull();
    statut = 'completed';
    await act(async () => { fireEvent.click(document.querySelector('[data-jumeau-reprendre]') as HTMLElement); });
    await waitFor(() => expect(document.querySelector('[data-jumeau-notice]')).not.toBeNull());
    expect(trace.filter((t) => t === 'status')).toHaveLength(2);
    expect(trace).not.toContain('generer');
  });
});
