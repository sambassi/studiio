import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * « Utiliser mon jumeau » DANS le wizard Créer : le bloc vit dans l'étape
 * Sujet, désactivé par défaut ; l'ordre du wizard ne change pas ; le
 * brouillon porte `useDigitalTwin` ; le garde précède toute composition.
 */

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c', id: 'aaaaaaaa-1111-4111-8111-111111111111' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';

const appels: string[] = [];
const jumeau = { data: { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 2, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: false, messageMoteur: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' } };

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    appels.push(u);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, status: 200, json: async () => ({ success: true, ...jumeau }) } as unknown as Response;
    if (u.includes('/api/autopilot/config')) return { ok: true, status: 200, json: async () => ({ success: true, ready: true, brandingReady: true, config: {} }) } as unknown as Response;
    return { ok: true, status: 200, json: async () => ({ ok: true, success: true, sessions: [], luts: [], items: [], voices: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { window.localStorage.clear(); appels.length = 0; stubApi(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const settle = async () => { await act(async () => { vi.advanceTimersByTime(600); }); };

describe('Créer — Jumeau numérique dans l’étape Sujet', () => {
  it('⚠️ le bloc est dans « Sujet », désactivé par défaut, l’ordre du wizard est intact ; une fois activé, le brouillon porte useDigitalTwin:true', async () => {
    render(<AssistantWizard />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    await settle();
    // L'ordre du wizard n'a pas bougé.
    expect(document.body.textContent).toContain('Sujet');
    const panneau = document.querySelector('[data-jumeau-panel]');
    expect(panneau).not.toBeNull();
    expect(panneau!.textContent).toContain('Jumeau numérique');
    expect(panneau!.textContent).toContain('Utiliser mon jumeau');
    await settle();
    expect(appels.some((u) => u === '/api/creer/jumeau')).toBe(true);
    const sw = screen.getByRole('switch', { name: 'Utiliser mon jumeau' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    await settle();
    expect((screen.getByRole('switch', { name: 'Utiliser mon jumeau' }) as HTMLInputElement).checked).toBe(true);
    // Le brouillon porte l'intention — et seulement l'intention.
    const cle = Object.keys(window.localStorage).find((k) => k.includes('creer') && k.includes('draft'));
    expect(cle).toBeDefined();
    const brouillon = JSON.parse(window.localStorage.getItem(cle!)!);
    expect(brouillon.useDigitalTwin).toBe(true);
    expect(JSON.stringify(brouillon)).not.toMatch(/providerAvatarId|providerVoiceId|hg-|pvid/);
  });

  it('⚠️ le garde précède setSending, le solde, et toute composition dans runRenderInterne', () => {
    const src = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    const debut = src.indexOf('const runRenderInterne = async');
    const corps = src.slice(debut);
    const iGarde = corps.indexOf('gardeJumeauAvantRendu(');
    // La forme CODE (en début de ligne), pas la mention dans un commentaire.
    const iSending = corps.search(/\n\s+setSending\(true\);/);
    const iSolde = corps.indexOf('/api/credits/balance');
    expect(iGarde).toBeGreaterThan(0);
    expect(iGarde).toBeLessThan(iSending);
    if (iSolde > 0) expect(iGarde).toBeLessThan(iSolde);
    // Le garde reçoit l'intention et les textes des séquences, jamais un identifiant.
    expect(corps.slice(iGarde, iGarde + 400)).toMatch(/useDigitalTwin,/);
    expect(corps.slice(iGarde, iGarde + 400)).toMatch(/sequenceVoices/);
  });
});
