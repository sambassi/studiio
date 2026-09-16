import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, cleanup, act } from '@testing-library/react';

/**
 * RÉGRESSION (production, 2026-09-16) — un aperçu D-ID était `done` chez le
 * fournisseur, `processing` en base, et après rechargement de
 * /dashboard/avatar l'écran restait sur « Votre aperçu est en cours de
 * génération… » : `loadApercu` rendait `en_cours` + generationId, mais rien
 * ne reprenait le suivi (`poll`), que seul le clic « Générer mon aperçu »
 * lançait. Un GET manuel de /api/avatar/status débloquait tout.
 *
 * Attendu : au montage, un aperçu `en_cours` est SUIVI automatiquement —
 * GET /api/avatar/status jusqu'à `completed` (→ prêt) ou `failed` (→ échec) —
 * sans clic, sans nouveau POST d'aperçu, sans double boucle, et rien après un
 * état terminal ni après le démontage.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const G = 'a8ee81e9-15b5-485c-a911-2f36affb66b2';
const URL_APERCU = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/${G}.mp4`;

/** L'état SERVEUR : la génération existe déjà en base, son statut fournisseur évolue. */
const serveur = {
  provider: 'did' as 'did' | 'heygen',
  /** Le seul cas où un POST d'aperçu est légitime : le clic de la personne. */
  lancementAutorise: false,
  aucune: false,
  generation: { status: 'processing' as 'processing' | 'completed' | 'failed', videoUrl: null as string | null, error: null as string | null },
};
const appels: Array<{ url: string; method: string }> = [];

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: init?.method ?? 'GET' });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    const avatar = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', provider: serveur.provider, etape_did: 'pret', created_at: '2026-09-15T00:00:00Z', etat: 'entraine_non_valide', version: 1, validated_at: null };
    if (u === '/api/avatar/create') return json(200, { success: true, data: { avatar, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: true, nomProfil: 'Henri Bassi' } });
    // `/api/avatar/apercu` DÉRIVE de la génération en base — comme le vrai `apercuDuClone`.
    if (u === '/api/avatar/apercu') {
      if (serveur.aucune) return json(200, { success: true, data: { avatarId: A, version: 1, etat: 'entraine_non_valide', apercu: { statut: 'aucun' } } });
      const g = serveur.generation;
      const apercu = g.status === 'completed' && g.videoUrl ? { statut: 'pret', generationId: G, url: g.videoUrl }
        : g.status === 'failed' ? { statut: 'echec', generationId: G, erreur: g.error }
          : { statut: 'en_cours', generationId: G };
      return json(200, { success: true, data: { avatarId: A, version: 1, etat: 'entraine_non_valide', apercu } });
    }
    if (u.startsWith('/api/avatar/status?generationId=')) {
      expect(u).toBe(`/api/avatar/status?generationId=${G}`);
      const g = serveur.generation;
      return json(200, { success: true, data: { generationId: G, status: g.status, videoUrl: g.videoUrl, error: g.error } });
    }
    if (u === '/api/avatar/did/apercu' || u === '/api/avatar/generate') {
      if (!serveur.lancementAutorise) throw new Error(`NOUVELLE GÉNÉRATION INTERDITE : ${init?.method} ${u}`);
      serveur.generation = { status: 'processing', videoUrl: null, error: null };
      return json(200, { success: true, data: { generationId: G, display: 'x', spoken: 'x' } });
    }
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
}

const statusCalls = () => appels.filter((a) => a.url.startsWith('/api/avatar/status')).length;
const nouvellesGenerations = () => appels.filter((a) => a.url === '/api/avatar/did/apercu' || a.url === '/api/avatar/generate').length;
/** Laisse passer le montage, les effets et les réponses en vol (sans avancer les timers). */
const tourner = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  appels.length = 0; window.localStorage.clear();
  serveur.provider = 'did'; serveur.generation = { status: 'processing', videoUrl: null, error: null }; serveur.lancementAutorise = false; serveur.aucune = false;
  stubApi();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('/dashboard/avatar — reprise du suivi d’un aperçu en cours après rechargement', () => {
  it('⚠️ LE BUG : page fraîchement montée, aperçu `en_cours` en base → GET /api/avatar/status part TOUT SEUL, sans clic, sans nouveau POST aperçu', async () => {
    render(<AvatarPage />);
    await tourner();
    expect(document.querySelector('[data-avatar-apercu="en-cours"]')).not.toBeNull();
    expect(appels.some((a) => a.url === '/api/avatar/apercu')).toBe(true);
    expect(statusCalls()).toBe(1);
    expect(nouvellesGenerations()).toBe(0);
  });

  it('⚠️ processing → nouveau poll programmé (5 s), un seul timer ; puis completed + videoUrl → aperçu PRÊT, polling arrêté', async () => {
    render(<AvatarPage />);
    await tourner();
    expect(statusCalls()).toBe(1);
    // Un seul timer : à 5 s, exactement un poll de plus.
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    expect(statusCalls()).toBe(2);
    // Le fournisseur a fini : le poll suivant voit completed.
    serveur.generation = { status: 'completed', videoUrl: URL_APERCU, error: null };
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    expect(statusCalls()).toBe(3);
    await tourner(10); expect(document.querySelector('[data-avatar-apercu="voir"]')).not.toBeNull();
    expect(document.querySelector('[data-avatar-apercu="en-cours"]')).toBeNull();
    // Plus aucun poll après l'état terminal.
    await act(async () => { vi.advanceTimersByTime(30000); });
    await tourner();
    expect(statusCalls()).toBe(3);
    expect(nouvellesGenerations()).toBe(0);
  });

  it('⚠️ failed → état échec avec le motif, polling arrêté, aucune relance automatique', async () => {
    render(<AvatarPage />);
    await tourner();
    serveur.generation = { status: 'failed', videoUrl: null, error: "Le fournisseur n'a pas pu animer votre avatar." };
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    await tourner(10); expect(document.body.textContent).toContain("Le fournisseur n'a pas pu animer votre avatar.");
    expect(document.querySelector('[data-avatar-apercu="generer"]')).not.toBeNull(); // relancer reste un CHOIX humain
    const n = statusCalls();
    await act(async () => { vi.advanceTimersByTime(30000); });
    await tourner();
    expect(statusCalls()).toBe(n);
    expect(nouvellesGenerations()).toBe(0);
  });

  it('⚠️ déjà completed ou déjà failed au chargement → aucun polling inutile', async () => {
    serveur.generation = { status: 'completed', videoUrl: URL_APERCU, error: null };
    render(<AvatarPage />);
    await tourner();
    await tourner(10); expect(document.querySelector('[data-avatar-apercu="voir"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(20000); });
    expect(statusCalls()).toBe(0);
    cleanup(); appels.length = 0;
    serveur.generation = { status: 'failed', videoUrl: null, error: 'x' };
    render(<AvatarPage />);
    await tourner();
    await act(async () => { vi.advanceTimersByTime(20000); });
    expect(statusCalls()).toBe(0);
    expect(nouvellesGenerations()).toBe(0);
  });

  it('⚠️ StrictMode (double montage) et relectures répétées → UNE seule boucle de poll', async () => {
    render(<StrictMode><AvatarPage /></StrictMode>);
    await tourner();
    expect(statusCalls()).toBe(1);
    // Le poll d'entraînement de la page relit l'avatar toutes les 10 s → nouvel objet `apercu` identique : pas de seconde boucle.
    await act(async () => { vi.advanceTimersByTime(10000); });
    await tourner();
    // 10 s : un poll aperçu à 5 s (+ celui-ci reprogrammé à 10 s), jamais deux par tick.
    expect(statusCalls()).toBeLessThanOrEqual(3);
    const avant = statusCalls();
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    expect(statusCalls() - avant).toBeLessThanOrEqual(1);
    expect(nouvellesGenerations()).toBe(0);
  });

  it('⚠️ démontage pendant le suivi : le timer est nettoyé, aucun poll ni setState ensuite', async () => {
    const avertissements = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<AvatarPage />);
    await tourner();
    expect(statusCalls()).toBe(1);
    unmount();
    await act(async () => { vi.advanceTimersByTime(60000); });
    await tourner();
    expect(statusCalls()).toBe(1);
    expect(avertissements.mock.calls.map((c) => String(c[0])).filter((m) => /unmounted|not mounted/i.test(m))).toEqual([]);
    avertissements.mockRestore();
  });

  it('⚠️ lancement par le CLIC (flux normal) : un seul POST aperçu, puis UNE boucle de poll — le suivi automatique ne double pas celle du clic', async () => {
    serveur.aucune = true; serveur.lancementAutorise = true;
    render(<AvatarPage />);
    await tourner();
    expect(document.querySelector('[data-avatar-apercu="generer"]')).not.toBeNull();
    serveur.aucune = false;
    await act(async () => { (document.querySelector('[data-avatar-apercu="generer"]') as HTMLButtonElement).click(); });
    await tourner();
    expect(nouvellesGenerations()).toBe(1);
    expect(statusCalls()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    expect(statusCalls()).toBe(2);
    expect(nouvellesGenerations()).toBe(1);
  });

  it('avatar HeyGen : même reprise (le suivi ne dépend pas du fournisseur)', async () => {
    serveur.provider = 'heygen';
    render(<AvatarPage />);
    await tourner();
    expect(statusCalls()).toBe(1);
    serveur.generation = { status: 'completed', videoUrl: URL_APERCU, error: null };
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    await tourner(10); expect(document.querySelector('[data-avatar-apercu="voir"]')).not.toBeNull();
    expect(nouvellesGenerations()).toBe(0);
  });
});
