import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * « Utiliser mon jumeau » DANS le wizard Créer : le bloc vit dans l'étape
 * Sujet, 'aucun' par défaut ; l'ordre du wizard ne change pas ; le brouillon
 * porte `jumeauMode` (et l'historique `useDigitalTwin` dérivé) ; « ma voix
 * clonée » pose `ttsVoiceId` ; le garde précède toute composition et reçoit
 * le MODE ; le coût avatar ne s'ajoute qu'en mode avatar.
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
const JUMEAU_DEFAUT: { data: Record<string, unknown> } = { data: { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 2, nom: 'Bassi', valideLe: '2026-09-03', fournisseur: 'did' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: false, messageMoteur: 'Votre avatar (créé à partir d’une vidéo) est prêt, mais le fournisseur d’avatar vidéo D-ID n’est pas configuré sur ce serveur (DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY). Aucun crédit n’est débité. Votre voix reste utilisable pour la narration.' } };

let jumeau = JUMEAU_DEFAUT;

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    appels.push(u);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, status: 200, json: async () => ({ success: true, ...jumeau }) } as unknown as Response;
    if (u === '/api/voice/clone') return { ok: true, status: 200, json: async () => ({ success: true, voices: [{ id: 'elevenlabs-zzz', accountVoiceId: 'autre', name: 'Bassi' }, { id: 'elevenlabs-abc', accountVoiceId: 'v', name: 'Bassi' }] }) } as unknown as Response;
    if (u.includes('/api/autopilot/config')) return { ok: true, status: 200, json: async () => ({ success: true, ready: true, brandingReady: true, config: {} }) } as unknown as Response;
    return { ok: true, status: 200, json: async () => ({ ok: true, success: true, sessions: [], luts: [], items: [], voices: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { window.localStorage.clear(); appels.length = 0; jumeau = JUMEAU_DEFAUT; stubApi(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const settle = async () => { await act(async () => { vi.advanceTimersByTime(600); }); };

describe('Créer — Jumeau numérique dans l’étape Sujet', () => {
  it('⚠️ le bloc est dans « Sujet », mode aucun par défaut, l’ordre du wizard est intact ; « ma voix clonée » pose ttsVoiceId=elevenlabs-abc et le brouillon porte jumeauMode:voix (useDigitalTwin:false) ; avatar D-ID sans moteur → case inerte qui nomme la dépendance', async () => {
    render(<AssistantWizard />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    await settle();
    // L'ordre du wizard n'a pas bougé.
    expect(document.body.textContent).toContain('Sujet');
    const panneau = document.querySelector('[data-jumeau-panel]');
    expect(panneau).not.toBeNull();
    expect(panneau!.textContent).toContain('Jumeau numérique');
    expect(panneau!.getAttribute('data-jumeau-mode')).toBe('aucun');
    await settle();
    expect(appels.some((u) => u === '/api/creer/jumeau')).toBe(true);
    expect(appels.some((u) => u === '/api/voice/clone')).toBe(true);
    await settle();
    expect(panneau!.textContent).toContain('créé à partir d’une vidéo (D-ID)');
    expect(panneau!.textContent).toContain('Utiliser ma voix clonée');
    expect(panneau!.textContent).toContain('Faire apparaître mon avatar parlant');
    expect(document.querySelector('[data-jumeau-dira]')).not.toBeNull();
    const avatar = document.querySelector('[data-jumeau-choix="avatar"]') as HTMLInputElement;
    expect(avatar.disabled).toBe(true);
    expect(document.querySelector('[data-jumeau-moteur="indisponible"]')!.textContent).toContain('DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY');
    const voix = document.querySelector('[data-jumeau-choix="voix"]') as HTMLInputElement;
    expect(voix.disabled).toBe(false);
    expect(voix.checked).toBe(false);
    fireEvent.click(voix);
    await settle();
    expect((document.querySelector('[data-jumeau-choix="voix"]') as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('[data-jumeau-panel]')!.getAttribute('data-jumeau-mode')).toBe('voix');
    // Le brouillon porte l'intention ET la voix posée — jamais un identifiant fournisseur nu.
    const cle = Object.keys(window.localStorage).find((k) => k.includes('creer') && k.includes('draft'));
    expect(cle).toBeDefined();
    const brouillon = JSON.parse(window.localStorage.getItem(cle!)!);
    expect(brouillon.jumeauMode).toBe('voix');
    expect(brouillon.useDigitalTwin).toBe(false);
    expect(brouillon.ttsVoiceId).toBe('elevenlabs-abc');
    expect(JSON.stringify(brouillon)).not.toMatch(/providerAvatarId|providerVoiceId|hg-|pvid|elevenlabs-zzz/);
  });

  it('⚠️ moteur disponible pour cet avatar : « avatar parlant » activable ; le brouillon porte jumeauMode:avatar et l’historique useDigitalTwin:true ; un ancien brouillon useDigitalTwin:true est restauré en mode avatar', async () => {
    jumeau = { ...jumeau, data: { ...jumeau.data, moteurDisponible: true, messageMoteur: null } };
    render(<AssistantWizard />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    await settle(); await settle();
    const avatar = document.querySelector('[data-jumeau-choix="avatar"]') as HTMLInputElement;
    expect(avatar.disabled).toBe(false);
    fireEvent.click(avatar);
    await settle();
    expect(document.querySelector('[data-jumeau-panel]')!.getAttribute('data-jumeau-mode')).toBe('avatar');
    const cle = Object.keys(window.localStorage).find((k) => k.includes('creer') && k.includes('draft'))!;
    const brouillon = JSON.parse(window.localStorage.getItem(cle)!);
    expect(brouillon.jumeauMode).toBe('avatar');
    expect(brouillon.useDigitalTwin).toBe(true);
    // Rétro-compat : un brouillon d'avant `jumeauMode`.
    cleanup();
    window.localStorage.setItem(cle, JSON.stringify({ ...brouillon, jumeauMode: undefined, useDigitalTwin: true }));
    render(<AssistantWizard />);
    await settle(); await settle();
    await waitFor(() => expect(document.querySelector('[data-jumeau-panel]')?.getAttribute('data-jumeau-mode')).toBe('avatar'));
    expect((document.querySelector('[data-jumeau-choix="avatar"]') as HTMLInputElement).checked).toBe(true);
  });

  it('⚠️ avec l’option, la vidéo du jumeau est produite APRÈS le solde et AVANT toute composition, posée par applyRush, et le montage continue dans le même passage — un seul clic', () => {
    const src = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    const corps = src.slice(src.indexOf('const runRenderInterne = async'));
    const sansCommentaires = (t: string) => t.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    const code = sansCommentaires(corps);
    const iGarde = code.indexOf('gardeJumeauAvantRendu(');
    const iSolde = code.indexOf('/api/credits/balance');
    const iMoteur = code.indexOf('genererEtAttendreVideoJumeau(');
    const iRush = code.indexOf('posee = await applyRush(video.url');
    const iBoucle = code.indexOf('for (let b = 0; b < total; b += 1)');
    const iCompose = code.search(/= await composerEtFacturer\(|await rendreEtFacturer\(\{/);
    expect(iGarde).toBeGreaterThan(0);
    expect(iSolde).toBeGreaterThan(iGarde);
    expect(iMoteur).toBeGreaterThan(iSolde);
    expect(iRush).toBeGreaterThan(iMoteur);
    expect(iBoucle).toBeGreaterThan(iRush);
    expect(iCompose).toBeGreaterThan(iBoucle);
    // Le solde est verifie sur le total, jumeau compris.
    expect(code).toMatch(/batchCost\(cost, total\) \+ \(jumeauMode === 'avatar' \? AVATAR_VIDEO_COST : 0\)/);
    // Le mode voix ne produit rien ici : seul le mode avatar entre dans le bloc jumeau.
    expect(code.slice(iMoteur - 300, iMoteur)).toMatch(/if \(jumeauMode === 'avatar'\) \{/);
    // Le bloc jumeau : ce qu'applyRush a pose devient le plateau du passage, puis
    // l'intention est levee. AUCUN `return` sur le chemin nominal : le montage suit.
    const bloc = code.slice(iMoteur, iBoucle);
    expect(bloc).toMatch(/setJumeauMode\('aucun'\)/);
    expect(bloc).toMatch(/rushUrl: posee\.url/);
    expect(bloc).toMatch(/videoDuration: posee\.secondes/);
    // Les deux seules sorties : l'echec du moteur, et un rush remplace entre-temps.
    expect(bloc.match(/\breturn;/g)).toHaveLength(2);
    // (Seule ligne tolérée avant `setError` : l'oubli d'une génération 404,
    // introuvable — la garder ferait boucler la reprise à chaque ouverture.)
    expect(bloc).toMatch(/catch \(e\) \{\s*(if \(e instanceof ErreurAttenteJumeau && e\.code === 'introuvable'\) setJumeauGenerationId\(null\);\s*)?setError\([^;]*\);\s*return;\s*\}/);
    expect(bloc).not.toMatch(/composerEtFacturer|rendreEtFacturer|composeAndUpload|setJumeauNotice\([^)]*lancez/);
    // Le montage lit le plateau du passage, jamais l'etat React pose a l'instant.
    const montage = code.slice(iBoucle, code.indexOf('const reset = () => {'));
    expect(montage).toMatch(/videoUrl: duree\('video'\) > 0 \? plateau\.rushUrl/);
    expect(montage).toMatch(/sequenceOrder: ordre,/);
    expect(montage).not.toMatch(/seqDuration\(|sequenceOrder: activeOrder|[^.]rushUrl \|\| undefined/);
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
    // Le garde est la seule chose faite avant `setSending` : aucune generation avant lui.
    expect(corps.slice(0, iSending)).not.toContain('genererEtAttendreVideoJumeau(');
    // Le garde reçoit l'intention et les textes des séquences, jamais un identifiant.
    expect(corps.slice(iGarde, iGarde + 200)).toMatch(/mode: jumeauMode, textes: textesJumeau/);
    expect(corps.slice(iGarde - 400, iGarde)).toMatch(/const textesJumeau = Object\.values\(sequenceVoices\)/);
  });
});
