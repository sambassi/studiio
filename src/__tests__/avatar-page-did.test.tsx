import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, act } from '@testing-library/react';

/**
 * /dashboard/avatar — l'avatar VIDÉO (D-ID) à l'écran.
 *
 * « À partir d'une vidéo » ne s'ouvre que si le serveur le dit
 * (`didVideoActif`) ; l'import envoie `provider=did` ; puis le panneau D-ID
 * suit l'ÉTAPE dérivée par le serveur : phrase de consentement (celle de
 * D-ID, affichée telle quelle), vidéo de consentement, vérification, création,
 * entraînement, prêt. La validation reste le flux existant ; l'aperçu d'un
 * avatar D-ID part vers `/api/avatar/did/apercu`. Aucun bouton pendant une
 * requête ; aucune vidéo inventée ; la génération HeyGen n'est pas offerte.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const A = '11111111-1111-4111-8111-000000000001';
const serveur = { didVideoActif: true, avatar: null as Record<string, unknown> | null, etape: 'consentement_a_demander', texte: null as string | null, apercu: { statut: 'aucun' } as Record<string, unknown> };
const appels: Array<{ url: string; method: string; body?: unknown }> = [];

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: init?.method ?? 'GET', body: init?.body });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    const ligne = () => (serveur.avatar ? { ...serveur.avatar, etape_did: serveur.etape, provider_consent_text: serveur.texte } : null);
    if (u === '/api/avatar/create' && (init?.method ?? 'GET') === 'GET') return json(200, { success: true, data: { avatar: ligne(), voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: serveur.didVideoActif } });
    if (u === '/api/avatar/create' && init?.method === 'POST') {
      serveur.avatar = { id: A, name: 'Mon avatar vidéo', status: 'source_ready', avatar_type: 'video', provider: 'did', created_at: '2026-09-15T00:00:00Z', etat: 'source_prete', version: 1, validated_at: null };
      serveur.etape = 'consentement_a_demander';
      return json(200, { success: true, data: { avatar: ligne() } });
    }
    if (u === '/api/avatar/did/consentement' && init?.method === 'POST') { serveur.texte = 'pomme vélo nuage'; serveur.etape = 'consentement_texte_pret'; return json(200, { success: true, data: { texte: 'pomme vélo nuage', etape: serveur.etape, deja: false } }); }
    if (u === '/api/avatar/did/consentement') return json(200, { success: true, data: { etape: serveur.etape, texte: serveur.texte, erreur: null } });
    if (u === '/api/avatar/did/consentement/video') { serveur.etape = 'consentement_en_verification'; return json(200, { success: true, data: { etape: serveur.etape } }); }
    if (u === '/api/avatar/did/creer') { serveur.etape = 'creation_en_cours'; serveur.avatar = { ...serveur.avatar, status: 'processing', etat: 'entrainement' }; return json(200, { success: true, data: { etape: serveur.etape, avatarId: A, version: 1 } }); }
    if (u === '/api/avatar/did/apercu') { serveur.apercu = { statut: 'en_cours', generationId: 'g1' }; return json(200, { success: true, data: { generationId: 'g1', display: 'x', spoken: 'x' } }); }
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 1, etat: serveur.avatar?.etat, apercu: serveur.apercu } });
    if (u.startsWith('/api/avatar/status')) return json(200, { success: true, data: { generationId: 'g1', status: 'processing', videoUrl: null } });
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
}

beforeEach(() => { appels.length = 0; window.localStorage.clear(); serveur.didVideoActif = true; serveur.avatar = null; serveur.etape = 'consentement_a_demander'; serveur.texte = null; serveur.apercu = { statut: 'aucun' }; stubApi(); });
afterEach(() => { cleanup(); });

const carteVideo = () => screen.getByRole('button', { name: /À partir d’une vidéo/ }) as HTMLButtonElement;

describe('/dashboard/avatar — « À partir d’une vidéo » (D-ID)', () => {
  it('⚠️ drapeau fermé : la carte reste « Bientôt disponible », désactivée ; aucun appel D-ID', async () => {
    serveur.didVideoActif = false;
    render(<AvatarPage />);
    await waitFor(() => expect(carteVideo()).toBeTruthy());
    expect(carteVideo().disabled).toBe(true);
    expect(document.body.textContent).toContain('Bientôt disponible');
    expect(appels.some((a) => a.url.includes('/api/avatar/did'))).toBe(false);
  });

  it('⚠️ drapeau ouvert : carte active, conseils (au moins 1 minute…), consentement nommant D-ID, MP4/MOV seulement, l’envoi porte provider=did', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(carteVideo().disabled).toBe(false));
    expect(document.body.textContent).not.toContain('Bientôt disponible');
    fireEvent.click(carteVideo());
    await waitFor(() => expect(document.querySelector('[data-avatar-did-conseils]')).not.toBeNull());
    const t = document.body.textContent!;
    expect(t).toContain('Au moins 1 minute');
    expect(t).toContain('regardez régulièrement la caméra');
    expect(t).toContain('Lumière stable');
    expect(t).toContain('Évitez le montage');
    expect(t).toContain("j'autorise Studiio et D-ID");
    expect(t).not.toContain('Studiio et HeyGen');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('video/mp4,video/quicktime');
    const fichier = new File([new Uint8Array(10)], 'moi.mp4', { type: 'video/mp4' });
    await act(async () => { fireEvent.change(input, { target: { files: [fichier] } }); });
    fireEvent.click(screen.getByRole('checkbox'));
    const bouton = screen.getByRole('button', { name: /Importer ma vidéo/ });
    await act(async () => { fireEvent.click(bouton); });
    const envoi = appels.find((a) => a.url === '/api/avatar/create' && a.method === 'POST');
    expect(envoi).toBeTruthy();
    expect((envoi!.body as FormData).get('provider')).toBe('did');
    await waitFor(() => expect(document.querySelector('[data-avatar-did="consentement_a_demander"]')).not.toBeNull());
  });

  it('⚠️ WebM refusé à l’écran pour l’avatar vidéo, avant tout envoi', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(carteVideo().disabled).toBe(false));
    fireEvent.click(carteVideo());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'x.webm', { type: 'video/webm' })] } }); });
    expect(document.body.textContent).toContain('Utilisez MP4 ou MOV');
    expect(appels.some((a) => a.method === 'POST')).toBe(false);
  });

  it('⚠️ le panneau D-ID suit l’étape : phrase → vidéo de consentement → vérification → créer → entraînement ; chaque bouton appelle SA route, une fois', async () => {
    serveur.avatar = { id: A, name: 'Mon avatar vidéo', status: 'source_ready', avatar_type: 'video', provider: 'did', created_at: '2026-09-15T00:00:00Z', etat: 'source_prete', version: 1, validated_at: null };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did="consentement_a_demander"]')).not.toBeNull());
    // Pas de bloc « HeyGen entraîne… », pas de formulaire de génération HeyGen.
    expect(document.body.textContent).not.toContain('HeyGen prépare');
    expect(document.querySelector('[data-avatar-did-generation="indisponible"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Ce que dit votre avatar');

    const phrase = document.querySelector('[data-avatar-did-action="phrase"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(phrase); fireEvent.click(phrase); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did="consentement_texte_pret"]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/did/consentement' && a.method === 'POST')).toHaveLength(1);
    expect(document.querySelector('[data-avatar-did-phrase]')!.textContent).toContain('pomme vélo nuage');

    const envoyer = document.querySelector('[data-avatar-did-action="video"]') as HTMLButtonElement;
    expect(envoyer.disabled).toBe(true);
    const input = document.querySelector('[data-avatar-did] input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'c.mp4', { type: 'video/mp4' })] } }); });
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-did-action="video"]') as HTMLButtonElement); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did-verification]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/did/consentement/video')).toHaveLength(1);
    expect(document.body.textContent).toContain('Vérification du consentement');

    // Le serveur accepte : la page relit et propose « Créer mon avatar ».
    serveur.etape = 'consentement_accepte';
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // On force une relecture (le poll réel attend 8 s) en rejouant le chargement.
    cleanup(); render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-action="creer"]')).not.toBeNull());
    expect(document.body.textContent).toContain('Consentement accepté');
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-did-action="creer"]') as HTMLButtonElement); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did-entrainement]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/did/creer')).toHaveLength(1);
    // Le pipeline : Téléchargement ✓ Vérification ✓ Création ✓ Entraînement ✓ Prêt ✗
    const atteintes = [...document.querySelectorAll('[data-avatar-did-etape]')].map((e) => `${e.getAttribute('data-avatar-did-etape')}=${e.getAttribute('data-atteinte')}`);
    expect(atteintes).toEqual(['telechargement=1', 'verification=1', 'creation=1', 'entrainement=1', 'pret=0']);
  });

  it('⚠️ prêt : « Mon avatar vidéo est prêt » + le bloc de validation existant ; « Générer mon aperçu » appelle /api/avatar/did/apercu, pas HeyGen ; rien n’est validé tout seul', async () => {
    serveur.avatar = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', provider: 'did', created_at: '2026-09-15T00:00:00Z', etat: 'entraine_non_valide', version: 1, validated_at: null };
    serveur.etape = 'pret';
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-pret]')).not.toBeNull());
    expect(document.body.textContent).toContain('Mon avatar vidéo est prêt');
    await waitFor(() => expect(document.querySelector('[data-avatar-apercu="generer"]')).not.toBeNull());
    expect(document.querySelector('[data-avatar-apercu="valider"]')).toBeNull();
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-apercu="generer"]') as HTMLButtonElement); });
    await waitFor(() => expect(appels.some((a) => a.url === '/api/avatar/did/apercu' && a.method === 'POST')).toBe(true));
    expect(appels.some((a) => a.url === '/api/avatar/generate')).toBe(false);
    await waitFor(() => expect(document.querySelector('[data-avatar-apercu="en-cours"]')).not.toBeNull());
    expect(document.querySelector('[data-avatar-validation="valide"]')).toBeNull();
  });

  it('avatar photo HeyGen : aucun panneau D-ID, le formulaire de génération HeyGen est toujours là', async () => {
    serveur.avatar = { id: A, name: 'Mon avatar', status: 'completed', avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-15T00:00:00Z', etat: 'valide', version: 1, validated_at: '2026-09-15T00:00:00Z' };
    serveur.etape = 'valide';
    render(<AvatarPage />);
    await waitFor(() => expect(document.body.textContent).toContain('Ce que dit votre avatar'));
    expect(document.querySelector('[data-avatar-did]')).toBeNull();
  });
});
