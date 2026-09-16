import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * /dashboard/avatar — LOT UX « même logique que Créer » (statut global à
 * gauche, aperçu à droite jamais coupé, fil d'étapes cliquable, mobile).
 *
 * Ce que la page montre :
 *   - un bloc de STATUT en tête de la colonne de travail, en un mot, dérivé de
 *     l'état serveur (Aucun avatar / Consentement à donner / En entraînement /
 *     À valider / Prêt / Erreur) avec une phrase « quoi faire » ;
 *   - AUCUN second CTA principal dans ce bloc (cahier #409 : un seul à la
 *     fois) — seulement un lien secondaire « Utiliser dans Créer » quand prêt ;
 *   - l'aperçu (colonne droite) borné en largeur à ce que la hauteur d'écran
 *     permet (ratio conservé), et rendu EN TÊTE sur mobile (`order-first`) ;
 *   - le fil d'étapes : « Source » redevient atteignable quand un avatar
 *     existe, et y aller = changer de source (le geste existant) ;
 *   - la suppression reste en deux clics.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => <div data-ma-voix-panel>Ma voix</div> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/avatar',
  useSearchParams: () => new URLSearchParams(),
}));

import AvatarPage from '../app/dashboard/avatar/page';
import { installerXhrDeTest, type XhrDeTest } from './aides/xhr-de-test';

const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000001';
const URL_APERCU = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/g.mp4';

type Ligne = Record<string, unknown> | null;
const serveur = {
  avatar: null as Ligne,
  etape: 'consentement_a_demander',
  apercu: { statut: 'aucun' } as Record<string, unknown>,
};
const appels: Array<{ url: string; method: string }> = [];

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    const ligne = () => (serveur.avatar ? { ...serveur.avatar, etape_did: serveur.etape, provider_consent_text: null, consent_name: null, consent_expire_le: null } : null);
    if (u === '/api/avatar/create' && method === 'GET') return json(200, { success: true, data: { avatar: ligne(), voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: true, nomProfil: 'Henri' } });
    if (u === '/api/avatar' && method === 'DELETE') { serveur.avatar = null; return json(200, { success: true, data: { sourceRetiree: true } }); }
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 1, etat: serveur.avatar?.etat, apercu: serveur.apercu } });
    if (u === '/api/avatar/did/consentement' && method === 'GET') return json(200, { success: true, data: { etape: serveur.etape } });
    if (u.startsWith('/api/avatar/status')) return json(200, { success: true, data: { generationId: G, status: 'processing', videoUrl: null, error: null } });
    return json(404, { success: false, error: `route inattendue ${method} ${u}` });
  }) as unknown as typeof fetch;
}

type EtatAvatar = 'entrainement' | 'entraine_non_valide' | 'valide' | 'echec';
const STATUT_HEYGEN: Record<EtatAvatar, string> = { entrainement: 'training', entraine_non_valide: 'completed', valide: 'completed', echec: 'failed' };
const avatarHeygen = (etat: EtatAvatar, extra: Record<string, unknown> = {}) => {
  serveur.avatar = { id: A, name: 'Mon avatar', status: STATUT_HEYGEN[etat], avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: '2026-09-16T10:00:00Z', etat, version: 1, validated_at: etat === 'valide' ? '2026-09-16T11:00:00Z' : null, ...extra };
};
const avatarDid = (etape: string) => {
  serveur.avatar = { id: A, name: 'Mon avatar vidéo', status: 'source_ready', avatar_type: 'video', provider: 'did', created_at: '2026-09-15T00:00:00Z', etat: 'source_prete', version: 1, validated_at: null };
  serveur.etape = etape;
};

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const tourner = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };
const monter = async () => { cleanup(); render(<AvatarPage />); await waitFor(() => expect(q('[data-avatar-statut]')).not.toBeNull()); await tourner(); };
const statut = () => q('[data-avatar-statut]')?.getAttribute('data-avatar-statut');
const libelle = () => q('[data-avatar-statut-libelle]')?.textContent?.trim();

let xhr: XhrDeTest;
beforeEach(() => {
  xhr = installerXhrDeTest();
  appels.length = 0; window.localStorage.clear();
  serveur.avatar = null; serveur.etape = 'consentement_a_demander'; serveur.apercu = { statut: 'aucun' };
  stubApi();
});
afterEach(() => { cleanup(); xhr.restaurer(); vi.useRealTimers(); });

describe('A. Le statut global — en tête de la colonne de travail, dérivé du serveur', () => {
  it('sans avatar → « Aucun avatar », phrase « quoi faire », aucun CTA principal dans le bloc', async () => {
    await monter();
    expect(statut()).toBe('aucun');
    expect(libelle()).toBe('Aucun avatar');
    expect(q('[data-avatar-statut-texte]')?.textContent).toMatch(/Commencez par choisir/);
    expect(q('[data-avatar-statut] .button-primary')).toBeNull();
    // Le bloc est le PREMIER enfant de la colonne de travail.
    expect(q('[data-avatar-colonne="etape"]')?.firstElementChild?.getAttribute('data-avatar-statut')).toBe('aucun');
  });

  it('entraînement HeyGen → « En entraînement » ; échec → « Erreur » ; à valider → « À valider »', async () => {
    avatarHeygen('entrainement'); await monter();
    expect(libelle()).toBe('En entraînement'); expect(statut()).toBe('entrainement');
    avatarHeygen('echec'); await monter();
    expect(libelle()).toBe('Erreur'); expect(statut()).toBe('erreur');
    avatarHeygen('entraine_non_valide'); await monter();
    expect(libelle()).toBe('À valider'); expect(statut()).toBe('a_valider');
  });

  it('consentement D-ID à demander → « Consentement à donner »', async () => {
    avatarDid('consentement_a_demander'); await monter();
    expect(statut()).toBe('consentement');
    expect(libelle()).toBe('Consentement à donner');
  });

  it('validé → « Prêt » + lien secondaire « Utiliser dans Créer » (pas un bouton principal) ; le badge d’en-tête dit aussi « Prêt »', async () => {
    avatarHeygen('valide'); await monter();
    expect(statut()).toBe('pret'); expect(libelle()).toBe('Prêt');
    const lien = q<HTMLAnchorElement>('[data-avatar-action="utiliser-creer"]');
    expect(lien?.tagName).toBe('A');
    expect(lien?.getAttribute('href')).toBe('/dashboard/creer');
    expect(lien?.classList.contains('button-primary')).toBe(false);
    expect(q('[data-entete] [data-entete-statut]')?.textContent?.trim()).toBe('Prêt');
    // Un seul CTA principal sur la page (celui de la génération à la demande).
    expect(qa('.button-primary').length).toBeLessThanOrEqual(1);
  });

  it('aperçu prêt → toujours « À valider », et le lien « Utiliser dans Créer » n’apparaît pas avant la validation', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU }; await monter();
    expect(statut()).toBe('a_valider');
    expect(q('[data-avatar-action="utiliser-creer"]')).toBeNull();
  });
});

describe('B. L’aperçu — à droite, borné à l’écran, jamais coupé ; en tête sur mobile', () => {
  it('le cadre porte le ratio et une largeur max calculée sur la hauteur d’écran (9:16 et 1:1)', async () => {
    await monter();
    // Sans avatar, choix « photo » → ratio 1:1.
    const cadre1 = q('[data-avatar-apercu-cadre]');
    expect(cadre1?.getAttribute('data-avatar-apercu-cadre')).toBe('1 / 1');
    expect(cadre1?.className).toContain('lg:max-w-[calc(100vh-11rem)]');
    // Aperçu de validation → 9:16.
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'en_cours', generationId: G }; await monter();
    const cadre2 = q('[data-avatar-apercu-cadre]');
    expect(cadre2?.getAttribute('data-avatar-apercu-cadre')).toBe('9 / 16');
    expect(cadre2?.className).toContain('lg:max-w-[calc((100vh-11rem)*9/16)]');
    expect(cadre2?.className).toContain('mx-auto');
    // La zone d'aperçu conserve son ratio (aspect-ratio), rien n'est rogné.
    expect(q('[data-avatar-colonne="apercu"] [data-apercu-media], [data-avatar-colonne="apercu"] [style*="aspect-ratio"]')).not.toBeNull();
  });

  it('la colonne d’aperçu passe en tête sur mobile et revient à droite sur grand écran', async () => {
    await monter();
    const col = q('[data-avatar-colonne="apercu"]');
    expect(col?.className).toContain('order-first');
    expect(col?.className).toContain('lg:order-none');
    expect(col?.className).toContain('lg:sticky');
  });
});

describe('C. Le fil d’étapes — « Source » redevient atteignable, y aller = changer de source', () => {
  it('sans avatar : rien n’est cliquable ; avec avatar : « Source » est un bouton, le clic revient à l’import', async () => {
    await monter();
    expect(q('[data-fil-etapes] [data-etape="source"]')?.getAttribute('role')).toBeNull();
    avatarHeygen('entrainement'); await monter();
    const source = q('[data-fil-etapes] [data-etape="source"]');
    expect(source?.getAttribute('role')).toBe('button');
    expect(source?.getAttribute('aria-label')).toMatch(/Source/);
    fireEvent.click(source!);
    await tourner();
    // Retour à l'import : le statut redevient « Aucun avatar », le choix de source est visible, aucune requête destructive.
    expect(statut()).toBe('aucun');
    expect(q('input[type="file"]')).not.toBeNull();
    expect(appels.some((a) => a.method === 'DELETE')).toBe(false);
    // Les étapes suivantes ne sont jamais cliquables.
    ['consentement', 'entrainement', 'apercu', 'validation'].forEach((cle) => expect(q(`[data-fil-etapes] [data-etape="${cle}"]`)?.getAttribute('role')).toBeNull());
  });
});

describe('D. La suppression — deux clics, puis « Aucun avatar »', () => {
  it('armer, confirmer → DELETE une fois, statut « Aucun avatar »', async () => {
    avatarHeygen('valide'); await monter();
    expect(q('[data-avatar-supprimer="confirmer"]')).toBeNull();
    fireEvent.click(q('[data-avatar-supprimer="armer"]')!);
    await tourner();
    expect(appels.filter((a) => a.method === 'DELETE').length).toBe(0);
    fireEvent.click(q('[data-avatar-supprimer="confirmer"]')!);
    await waitFor(() => expect(statut()).toBe('aucun'));
    expect(appels.filter((a) => a.method === 'DELETE').length).toBe(1);
  });
});
