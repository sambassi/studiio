import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

/**
 * CÂBLAGE DE LA GRILLE TARIFAIRE — les ÉCRANS annoncent le prix de la grille.
 *
 * `useTarifs()` est doublé (grille contrôlée) : le libellé suit la grille,
 * et la grille par défaut redonne les libellés d'avant. Le serveur reste
 * l'autorité du débit (voir `tarifs-cablage.test.ts`). Aucun fournisseur.
 */

const grille = vi.hoisted(() => ({ prix: {} as Record<string, number>, exempte: false }));
vi.mock('@/lib/tarifs/client', async (original) => ({
  ...(await original<typeof import('@/lib/tarifs/client')>()),
  useTarifs: () => ({ prix: grille.prix, exempte: grille.exempte, charge: true }),
}));
vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import { TARIFS_DEFAUT } from '@/lib/tarifs/catalogue';
import AiImageTools, { AI_TOOLS } from '@/components/creer/AiImageTools';
import AudioCompletSection from '@/components/voice/AudioCompletSection';
import AfficheIA from '@/components/creer/AfficheIA';
import AvatarPage from '../app/dashboard/avatar/page';
import { cleTarifEcranMonAvatar, libelleBoutonGenererAvatar } from '@/lib/avatar/prix';

const A = '11111111-1111-4111-8111-000000000001';
const avatarValide = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-07T00:00:00Z', etat: 'valide', version: 3, validated_at: '2026-10-07T10:00:00Z', provider: 'heygen' };
const QUALITES = [
  { qualite: 'standard', libelle: 'Standard', ouverte: true },
  { qualite: 'qualite', libelle: 'Qualité', ouverte: true, recommandee: true },
  { qualite: 'premium', libelle: 'Premium', ouverte: true, meilleure: true },
];

beforeEach(() => {
  grille.prix = { ...TARIFS_DEFAUT }; grille.exempte = false;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/dashboard/avatar');
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as unknown as Response);
    if (u === '/api/avatar/create') return json({ success: true, data: { avatar: avatarValide, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', qualites: QUALITES, qualiteParDefaut: 'qualite' } });
    return json({ success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); });

const boutonGenerer = () => [...document.querySelectorAll('button')].find((b) => /Générer la vidéo/.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

describe('Mon avatar — le bouton annonce le prix de la qualité choisie', () => {
  it('grille par défaut : « Générer la vidéo (40 crédits) », inchangé', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(boutonGenerer()?.textContent).toContain('Générer la vidéo (40 crédits)'));
  });

  it('grille III 10 / IV 25 / V 40 : le libellé suit le sélecteur de qualité', async () => {
    grille.prix = { ...TARIFS_DEFAUT, 'avatar.avatar_iii': 10, 'avatar.avatar_iv': 25, 'avatar.avatar_v': 40 };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-qualite-choix]')).not.toBeNull());
    const choix = document.querySelector('[data-avatar-qualite-choix]') as HTMLSelectElement;
    await waitFor(() => expect(boutonGenerer()?.textContent).toContain('(25 crédits)'));
    fireEvent.change(choix, { target: { value: 'standard' } });
    expect(boutonGenerer()?.textContent).toContain('(10 crédits)');
    fireEvent.change(choix, { target: { value: 'premium' } });
    expect(boutonGenerer()?.textContent).toContain('(40 crédits)');
  });

  it('administrateur : prix public affiché, coût 0', async () => {
    grille.prix = { ...TARIFS_DEFAUT, 'avatar.avatar_iv': 50 };
    grille.exempte = true;
    render(<AvatarPage />);
    await waitFor(() => expect(boutonGenerer()?.textContent).toContain('Générer la vidéo — prix public 50 crédits · votre coût : 0'));
  });

  it('règle partagée : sans qualité → Avatar IV ; voix clonée → tarif du jumeau', () => {
    expect(cleTarifEcranMonAvatar({ viaVoixClonee: false })).toBe('avatar.avatar_iv');
    expect(cleTarifEcranMonAvatar({ viaVoixClonee: false, qualiteEnvoyee: 'standard' })).toBe('avatar.avatar_iii');
    expect(cleTarifEcranMonAvatar({ viaVoixClonee: true, qualiteEnvoyee: 'premium' })).toBe('avatar.jumeau');
    expect(libelleBoutonGenererAvatar(1, false)).toBe('Générer la vidéo (1 crédit)');
  });
});

describe('Outils IA — chaque bouton annonce le prix de la grille', () => {
  const rendre = () => render(<AiImageTools imageUrl="https://cdn.test/a.png" onImageResult={vi.fn()} showToast={vi.fn()} actions={AI_TOOLS.map((t) => t.action)} />);
  const bouton = (a: string) => document.querySelector(`[data-ai-action="${a}"]`) as HTMLButtonElement;

  it('grille par défaut : 2/3/5/3/15/5/3/5/1, inchangé', () => {
    rendre();
    const attendus: Record<string, number> = { 'remove-bg': 2, 'magic-eraser': 3, 'magic-edit': 5, 'upscale': 3, 'image-to-video': 15, 'generate-bg': 5, 'magic-layers': 3, 'style-transfer': 5, 'ocr': 1 };
    for (const [a, n] of Object.entries(attendus)) expect(bouton(a).textContent, a).toContain(`${n} cr.`);
  });

  it('OCR passé à 2 et image-vers-vidéo à 20 : les libellés suivent', () => {
    grille.prix = { ...TARIFS_DEFAUT, 'ai.ocr': 2, 'ai.image_to_video': 20 };
    rendre();
    expect(bouton('ocr').textContent).toContain('2 cr.');
    expect(bouton('image-to-video').textContent).toContain('20 cr.');
    expect(bouton('ocr').getAttribute('title')).toBe('Capture de texte — 2 crédits');
  });
});

describe('Affiche IA — « N crédits par image »', () => {
  it('suit `ai.generate_background`', () => {
    grille.prix = { ...TARIFS_DEFAUT, 'ai.generate_background': 7 };
    render(<AfficheIA onUtiliser={vi.fn()} />);
    expect(screen.getByText('7 crédits par image')).toBeTruthy();
  });
});

describe('Audio complet — libellé et explication suivent la grille', () => {
  const saisir = (n: number) => fireEvent.change(document.querySelector('[data-audio-complet-texte]') as HTMLTextAreaElement, { target: { value: 'a'.repeat(n) } });
  const boutonAudio = () => document.querySelector('[data-audio-complet-generer]') as HTMLButtonElement;

  it('grille par défaut : « 1 crédit par tranche… », 2500 caractères → 3 crédits', () => {
    render(<AudioCompletSection disponible />);
    expect(document.querySelector('[data-audio-complet]')!.textContent).toContain('1 crédit par tranche de 1000 caractères entamée.');
    saisir(2500);
    expect(boutonAudio().textContent).toBe('Générer l’audio complet — 3 crédits');
  });

  it('2 crédits / tranche : 2500 caractères → 6 crédits', () => {
    grille.prix = { ...TARIFS_DEFAUT, 'audio.full_1000_chars': 2 };
    render(<AudioCompletSection disponible />);
    expect(document.querySelector('[data-audio-complet]')!.textContent).toContain('2 crédits par tranche de 1000 caractères entamée.');
    saisir(2500);
    expect(boutonAudio().textContent).toBe('Générer l’audio complet — 6 crédits');
  });

  it('administrateur : libellé administrateur conservé', () => {
    grille.exempte = true;
    render(<AudioCompletSection disponible />);
    saisir(10);
    expect(boutonAudio().textContent).toBe('Générer l’audio complet — 0 crédit (administrateur)');
  });
});
