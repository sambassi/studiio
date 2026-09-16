import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * /dashboard/avatar — quick wins UX + PROGRESSION TEMPS RÉEL HONNÊTE (chantier 2).
 *
 * Ce que la page ne fait PLUS : un pourcentage fournisseur dérivé du temps
 * (`90 * (1 - Math.exp(-t/45))`). Ce qu'elle fait : l'envoi montre les octets
 * RÉELLEMENT transférés (XHR) ; l'entraînement montre une barre INDÉTERMINÉE
 * (le fournisseur ne rend qu'un statut) et un « Progression du workflow »
 * compté sur les étapes réellement connues, nommé à part ; la durée écoulée
 * ne part que d'un horodatage serveur ; les messages sont des `Notification`
 * avec une action principale ; la vidéo de consentement a sa `Consigne`.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => <div data-ma-voix-panel>Ma voix</div> }));

import AvatarPage from '../app/dashboard/avatar/page';
import { installerXhrDeTest, type XhrDeTest } from './aides/xhr-de-test';

const A = '11111111-1111-4111-8111-000000000001';
const RACINE = process.cwd();
const PAGE = join(RACINE, 'src/app/dashboard/avatar/page.tsx');
const PANNEAU = join(RACINE, 'src/components/avatar/AvatarVideoDid.tsx');

type Ligne = Record<string, unknown> | null;
const serveur = {
  avatar: null as Ligne,
  etape: 'consentement_a_demander',
  texte: null as string | null,
  nom: null as string | null,
  expireLe: null as string | null,
  apercu: { statut: 'aucun' } as Record<string, unknown>,
  /** Réponse de POST /api/avatar/generate (HeyGen) : par défaut, la voix manque. */
  generate: { success: false, error: 'Voix indisponible', code: 'voix_indisponible' } as Record<string, unknown>,
};
const appels: Array<{ url: string; method: string; body?: unknown }> = [];

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method, body: init?.body });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    const ligne = () => (serveur.avatar ? { ...serveur.avatar, etape_did: serveur.etape, provider_consent_text: serveur.texte, consent_name: serveur.nom, consent_expire_le: serveur.expireLe } : null);
    if (u === '/api/avatar/create' && method === 'GET') return json(200, { success: true, data: { avatar: ligne(), voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: true, nomProfil: 'Henri Bassi' } });
    if (u === '/api/avatar/create' && method === 'POST') {
      const fd = init?.body as FormData;
      const did = fd.get('provider') === 'did';
      serveur.avatar = { id: A, name: 'Mon avatar', status: did ? 'source_ready' : 'training', avatar_type: did ? 'video' : 'photo', provider: did ? 'did' : 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: '2026-09-16T10:00:00Z', etat: did ? 'source_prete' : 'entrainement', version: 1, validated_at: null };
      return json(200, { success: true, data: { avatar: ligne() } });
    }
    if (u === '/api/avatar/did/consentement' && method === 'POST') {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { nom?: string; renouveler?: boolean };
      serveur.nom = corps.nom ?? null; serveur.texte = `Je soussigné(e), ${serveur.nom}, confirme. pomme vélo nuage`; serveur.etape = 'consentement_texte_pret';
      serveur.expireLe = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      return json(200, { success: true, data: { texte: serveur.texte, nom: serveur.nom, etape: serveur.etape, deja: false, expireLe: serveur.expireLe } });
    }
    if (u === '/api/avatar/did/consentement/video') { serveur.etape = 'consentement_en_verification'; return json(200, { success: true, data: { etape: serveur.etape } }); }
    if (u.startsWith('/api/avatar/did/consentement')) return json(200, { success: true, data: { etape: serveur.etape, texte: serveur.texte, nom: serveur.nom, expireLe: serveur.expireLe, erreur: null, reutilisable: null } });
    if (u === '/api/avatar/did/creer') { serveur.etape = 'creation_en_cours'; serveur.avatar = { ...serveur.avatar, status: 'processing', etat: 'entrainement' }; return json(200, { success: true, data: { etape: serveur.etape, avatarId: A, version: 1 } }); }
    if (u === '/api/avatar/generate') return json(serveur.generate.success ? 200 : 409, serveur.generate);
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 1, etat: serveur.avatar?.etat, apercu: serveur.apercu } });
    if (u.startsWith('/api/avatar/status')) return json(200, { success: true, data: { generationId: 'g1', status: 'processing', videoUrl: null } });
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
}

const avatarDid = (etape: string, extra: Record<string, unknown> = {}) => {
  serveur.avatar = { id: A, name: 'Mon avatar vidéo', status: 'source_ready', avatar_type: 'video', provider: 'did', created_at: '2026-09-15T00:00:00Z', etat: 'source_prete', version: 1, validated_at: null, ...extra };
  serveur.etape = etape;
};
const texte = () => document.body.textContent ?? '';
const tourner = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };

let xhr: XhrDeTest;
beforeEach(() => {
  xhr = installerXhrDeTest();
  appels.length = 0; window.localStorage.clear();
  serveur.avatar = null; serveur.etape = 'consentement_a_demander'; serveur.texte = null; serveur.nom = null; serveur.expireLe = null; serveur.apercu = { statut: 'aucun' };
  serveur.generate = { success: false, error: 'Voix indisponible', code: 'voix_indisponible' };
  stubApi();
});
afterEach(() => { cleanup(); xhr.restaurer(); });

describe('A. Le code source ne dérive plus aucune progression fournisseur du temps', () => {
  const sources = [PAGE, PANNEAU].map((p) => ({ p, s: readFileSync(p, 'utf8') }));

  it('⚠️ ni Math.exp, ni pourcentage calculé à partir de la durée écoulée, ni setProgress nourri par l’horloge', () => {
    for (const { p, s } of sources) {
      expect(s, `${p} : Math.exp`).not.toMatch(/Math\.exp\s*\(/);
      expect(s, `${p} : courbe asymptotique`).not.toMatch(/\d+\s*\*\s*\(\s*1\s*-\s*Math\./);
      expect(s, `${p} : progression dérivée du temps`).not.toMatch(/setProgress\([^)]*(elapsed|Date\.now|performance\.now|ecoule)/);
      expect(s, `${p} : variable de progression temporelle`).not.toMatch(/elapsedSec|fakeProgress|progressionSimulee/);
    }
  });

  it('⚠️ la seule source de `progress` est la réponse du serveur (`json.data.progress`), ou null', () => {
    const s = sources[0].s;
    const lignes = s.split('\n').filter((l) => /setProgress\(/.test(l)).map((l) => l.trim());
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) expect(l, l).toMatch(/^setProgress\((null|Math\.min\(99, Math\.max\(0, realProgress\)\))\);$/);
  });

  it('les messages utilisateur du périmètre touché ne nomment plus le fournisseur (hors phrase légale du consentement)', () => {
    // Hors commentaires : aucune chaîne affichée ne dit « HeyGen » comme acteur du récit utilisateur.
    const sansCommentaires = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const page = sansCommentaires(sources[0].s);
    expect(page).not.toMatch(/HeyGen (prépare|entraîne|génère|crée)/);
    expect(page).not.toMatch(/(chez|par|vers) HeyGen/);
    expect(page).not.toMatch(/>[^<{]*HeyGen[^<}]*</);
    expect(sansCommentaires(sources[1].s)).not.toMatch(/chez notre fournisseur|motif du fournisseur|>[^<{]*HeyGen[^<}]*</);
  });
});

describe('B. L’entraînement : barre indéterminée, workflow compté à part, durée écoulée d’un horodatage serveur', () => {
  it('⚠️ HeyGen en entraînement : aria-busy sans aria-valuenow, aucun « % » fournisseur, « Progression du workflow : 60 % », durée écoulée depuis consent_at', async () => {
    serveur.avatar = { id: A, name: 'Mon avatar', status: 'training', avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: new Date(Date.now() - 90_000).toISOString(), etat: 'entrainement', version: 1, validated_at: null };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-progress-status="en_cours"]')).not.toBeNull());
    const suivi = document.querySelector('[data-progress-status="en_cours"]') as HTMLElement;
    expect(suivi.getAttribute('data-progress-determinee')).toBe('non');
    const barre = suivi.querySelector('[role="progressbar"]') as HTMLElement;
    expect(barre.getAttribute('aria-busy')).toBe('true');
    expect(barre.hasAttribute('aria-valuenow')).toBe(false);
    expect(suivi.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect(suivi.querySelector('[data-progress-workflow]')?.getAttribute('data-progress-workflow')).toBe('60');
    expect(suivi.textContent).toContain('Progression du workflow');
    expect(suivi.textContent).toContain('Entraînement en cours — progression exacte indisponible.');
    expect(suivi.querySelector('[data-progress-ecoulee]')?.textContent).toBe('Durée écoulée : 01:30');
    expect(texte()).not.toMatch(/HeyGen/);
  });

  it('⚠️ sans horodatage serveur, aucune durée écoulée n’est affichée (rien n’est fabriqué côté navigateur)', async () => {
    serveur.avatar = { id: A, name: 'Mon avatar', status: 'training', avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: null, etat: 'entrainement', version: 1, validated_at: null };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-progress-status="en_cours"]')).not.toBeNull());
    expect(document.querySelector('[data-progress-ecoulee]')).toBeNull();
  });

  it('⚠️ D-ID en entraînement : même barre indéterminée, étapes Source/Consentement/Création ✓ Entraînement ● Prêt ○, pas de durée écoulée (aucun horodatage fiable)', async () => {
    avatarDid('creation_en_cours', { status: 'processing', etat: 'entrainement' });
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-entrainement] [data-progress-status="en_cours"]')).not.toBeNull());
    const suivi = document.querySelector('[data-avatar-did-entrainement] [data-progress-status="en_cours"]') as HTMLElement;
    expect(suivi.getAttribute('data-progress-determinee')).toBe('non');
    expect(suivi.querySelector('[data-progress-ecoulee]')).toBeNull();
    expect([...suivi.querySelectorAll('[data-progress-etape-etat]')].map((e) => e.getAttribute('data-progress-etape-etat'))).toEqual(['terminee', 'terminee', 'terminee', 'courante', 'a_venir']);
    expect(suivi.querySelector('[data-progress-workflow]')?.getAttribute('data-progress-workflow')).toBe('60');
    // Pas de « Votre avatar est en préparation » sans clic : c'est la notification du lancement, pas un état.
    expect(texte()).not.toContain('Votre avatar est en préparation.');
  });
});

describe('C. L’envoi de la source : le pourcentage est celui des octets partis (XHR), rien d’autre', () => {
  it('⚠️ 5 o / 10 o → « 50 % », aria-valuenow=50 ; à 10/10 → 100 % et « Envoi terminé » ; puis l’avatar apparaît', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /À partir d’une photo/ })).toBeTruthy());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fichier = new File([new Uint8Array(10)], 'moi.jpg', { type: 'image/jpeg' });
    await act(async () => { fireEvent.change(input, { target: { files: [fichier] } }); });
    fireEvent.click(screen.getByRole('checkbox'));
    xhr.retenir = true;
    xhr.etapes = [{ loaded: 5, total: 10 }];
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Créer mon avatar/ })); });
    await tourner();
    const suivi = document.querySelector('[data-progress-status="en_cours"]') as HTMLElement;
    expect(suivi, 'le suivi de l’envoi').not.toBeNull();
    expect(suivi.getAttribute('data-progress-determinee')).toBe('oui');
    expect(suivi.querySelector('[data-progress-pourcentage]')?.textContent).toBe('50 %');
    expect(suivi.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(suivi.querySelector('[data-progress-detail]')?.textContent).toBe('5 o / 10 o');
    expect(xhr.envois).toHaveLength(1);
    expect(xhr.envois[0].url).toBe('/api/avatar/create');
    expect(appels.filter((a) => a.url === '/api/avatar/create' && a.method === 'POST')).toHaveLength(0);
    await act(async () => { xhr.liberer(); });
    await waitFor(() => expect(texte()).toContain('Entraînement de votre avatar'));
    expect(texte()).not.toContain('Envoi de votre');
    expect(appels.filter((a) => a.url === '/api/avatar/create' && a.method === 'POST')).toHaveLength(1);
  });

  it('⚠️ sans `lengthComputable`, le pourcentage reste à 0 % (0 octet confirmé) — rien n’est inventé', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /À partir d’une photo/ })).toBeTruthy());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'moi.jpg', { type: 'image/jpeg' })] } }); });
    fireEvent.click(screen.getByRole('checkbox'));
    xhr.retenir = true;
    xhr.etapes = [{ loaded: 5, total: 0, lengthComputable: false }];
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Créer mon avatar/ })); });
    await tourner();
    expect(document.querySelector('[data-progress-pourcentage]')?.textContent).toBe('0 %');
    expect(document.querySelector('[data-progress-detail]')?.textContent).toBe('0 o / 10 o');
    await act(async () => { xhr.liberer(); });
  });
});

describe('D. La vidéo de consentement : consigne + checklist, envoi XHR avec le vrai %, notifications avec action', () => {
  it('⚠️ phrase prête : la Consigne « Enregistrez-vous en lisant exactement cette phrase. » avec 7 points ; l’envoi montre 25 % puis part à la vérification', async () => {
    avatarDid('consentement_a_demander');
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-nom]')).not.toBeNull());
    fireEvent.change(document.querySelector('[data-avatar-did-nom]') as HTMLInputElement, { target: { value: 'Henri Bassi' } });
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-did-action="phrase"]') as HTMLButtonElement); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did="consentement_texte_pret"]')).not.toBeNull());
    const consigne = document.querySelector('[data-consigne]') as HTMLElement;
    expect(consigne.querySelector('[data-consigne-titre]')?.textContent).toBe('Enregistrez-vous en lisant exactement cette phrase.');
    expect(consigne.textContent).toContain('Valable 30 minutes.');
    // Repliée par défaut ; ouverte, elle liste les 7 points.
    expect(consigne.querySelector('[data-checklist]')).toBeNull();
    fireEvent.click(consigne.querySelector('[data-consigne-repli]') as HTMLButtonElement);
    const points = [...consigne.querySelectorAll('[data-checklist-point]')].map((e) => e.textContent?.trim());
    expect(points).toEqual(['visage bien visible', 'face caméra', 'bonne lumière', 'voix claire', 'phrase lue exactement, votre nom compris', 'vidéo courte', 'fond calme']);

    const input = document.querySelector('[data-avatar-did] input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(100)], 'c.mp4', { type: 'video/mp4' })] } }); });
    xhr.retenir = true;
    xhr.etapes = [{ loaded: 25, total: 100 }];
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-did-action="video"]') as HTMLButtonElement); });
    await tourner();
    const suivi = document.querySelector('[data-avatar-did] [data-progress-status="en_cours"]') as HTMLElement;
    expect(suivi).not.toBeNull();
    expect(suivi.textContent).toContain('Envoi de votre vidéo de consentement');
    expect(suivi.querySelector('[data-progress-pourcentage]')?.textContent).toBe('25 %');
    expect(suivi.querySelector('[data-progress-detail]')?.textContent).toBe('25 o / 100 o');
    expect(xhr.envois.map((e) => e.url)).toEqual(['/api/avatar/did/consentement/video']);
    expect((xhr.envois[0].corps.get('file') as File).name).toBe('c.mp4');
    await act(async () => { xhr.liberer(); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did-verification]')).not.toBeNull());
    expect(document.querySelector('[data-avatar-did] [data-progress-status="en_cours"]')).toBeNull();
  });

  it('⚠️ panne réseau pendant l’envoi : notification d’erreur, aucun appel serveur, le bouton redevient disponible', async () => {
    avatarDid('consentement_texte_pret', { consent_name: 'Henri Bassi' });
    serveur.texte = 'Je soussigné(e), Henri Bassi, confirme. pomme vélo nuage'; serveur.nom = 'Henri Bassi'; serveur.expireLe = new Date(Date.now() + 600_000).toISOString();
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-action="video"]')).not.toBeNull());
    const input = document.querySelector('[data-avatar-did] input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'c.mp4', { type: 'video/mp4' })] } }); });
    xhr.panne = true;
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-did-action="video"]') as HTMLButtonElement); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did-erreur] [data-notification="erreur"]')).not.toBeNull());
    expect(texte()).toContain('Connexion impossible. Réessayez.');
    expect(appels.filter((a) => a.url === '/api/avatar/did/consentement/video')).toHaveLength(0);
    expect((document.querySelector('[data-avatar-did-action="video"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('⚠️ consentement refusé : titre exact, 5 points, motif technique replié, « Réenregistrer » ouvre le sélecteur, « Voir les consignes » déplie la Consigne', async () => {
    avatarDid('consentement_refuse', { consent_name: 'Henri Bassi', provider_consent_status: 'error' });
    serveur.texte = 'Je soussigné(e), Henri Bassi, confirme. pomme vélo nuage'; serveur.nom = 'Henri Bassi'; serveur.expireLe = new Date(Date.now() + 600_000).toISOString();
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-refus] [data-notification="erreur"]')).not.toBeNull());
    const notif = document.querySelector('[data-avatar-did-refus] [data-notification="erreur"]') as HTMLElement;
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe("Votre vidéo de consentement n'a pas été acceptée.");
    expect(notif.querySelectorAll('[data-notification-detail] li')).toHaveLength(5);
    expect(notif.textContent).toContain('vous lisez la phrase exactement, y compris votre nom');
    expect(notif.textContent).not.toMatch(/fournisseur|D-ID/);
    const principale = notif.querySelector('[data-notification-action="principale"]') as HTMLButtonElement;
    expect(principale.textContent).toContain('Réenregistrer');
    const input = document.querySelector('[data-avatar-did] input[type="file"]') as HTMLInputElement;
    const clic = vi.spyOn(input, 'click');
    fireEvent.click(principale);
    expect(clic).toHaveBeenCalledTimes(1);
    const secondaire = notif.querySelector('[data-notification-action="secondaire"]') as HTMLButtonElement;
    expect(secondaire.textContent).toContain('Voir les consignes');
    expect(document.querySelector('[data-consigne] [data-checklist]')).toBeNull();
    fireEvent.click(secondaire);
    expect(document.querySelector('[data-consigne] [data-checklist]')).not.toBeNull();
  });

  it('⚠️ phrase expirée : avertissement « Votre phrase de consentement a expiré. », « Obtenir une nouvelle phrase » renvoie renouveler:true, l’envoi reste bloqué', async () => {
    avatarDid('consentement_texte_pret', { consent_name: 'Henri Bassi' });
    serveur.texte = 'Je soussigné(e), Henri Bassi, confirme. pomme vélo nuage'; serveur.nom = 'Henri Bassi'; serveur.expireLe = new Date(Date.now() - 1000).toISOString();
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-expiree] [data-notification="avertissement"]')).not.toBeNull());
    const notif = document.querySelector('[data-avatar-did-expiree] [data-notification="avertissement"]') as HTMLElement;
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe('Votre phrase de consentement a expiré.');
    expect((document.querySelector('[data-avatar-did-action="video"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(notif.querySelector('[data-notification-action="principale"]') as HTMLButtonElement); });
    const demande = appels.find((a) => a.url === '/api/avatar/did/consentement' && a.method === 'POST');
    expect(demande).toBeTruthy();
    expect(JSON.parse(String(demande!.body))).toEqual({ nom: 'Henri Bassi', renouveler: true });
    await waitFor(() => expect(document.querySelector('[data-avatar-did-expiree]')).toBeNull());
  });

  it('⚠️ consentement accepté : succès « Consentement accepté. », « Créer mon avatar » appelle /api/avatar/did/creer une fois, puis « Votre avatar est en préparation. »', async () => {
    avatarDid('consentement_accepte', { consent_name: 'Henri Bassi', provider_consent_status: 'done' });
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-accepte] [data-notification="succes"]')).not.toBeNull());
    const notif = document.querySelector('[data-avatar-did-accepte] [data-notification="succes"]') as HTMLElement;
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe('Consentement accepté.');
    const creer = notif.querySelector('[data-notification-action="principale"]') as HTMLButtonElement;
    expect(creer.textContent).toContain('Créer mon avatar');
    await act(async () => { fireEvent.click(creer); fireEvent.click(creer); });
    await waitFor(() => expect(document.querySelector('[data-avatar-did-entrainement]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/did/creer')).toHaveLength(1);
    const info = document.querySelector('[data-avatar-did-entrainement] [data-notification="info"]') as HTMLElement;
    expect(info.querySelector('[data-notification-titre]')?.textContent).toBe('Votre avatar est en préparation.');
  });

  it('⚠️ entraînement D-ID échoué : « L’entraînement de votre avatar n’a pas abouti. », motif replié, « Changer de source » (une seule sortie) revient à l’import', async () => {
    avatarDid('echec', { status: 'failed', etat: 'echec', training_error: 'face not detected' });
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-did-echec] [data-notification="erreur"]')).not.toBeNull());
    const notif = document.querySelector('[data-avatar-did-echec] [data-notification="erreur"]') as HTMLElement;
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe("L'entraînement de votre avatar n'a pas abouti.");
    expect(notif.querySelector('[data-notification-motif]')?.textContent).toContain('face not detected');
    const action = notif.querySelector('[data-notification-action="principale"]') as HTMLButtonElement;
    expect(action.textContent).toContain('Changer de source');
    expect(screen.getAllByRole('button', { name: /Changer de source/ })).toHaveLength(1);
    fireEvent.click(action);
    await waitFor(() => expect(screen.getByRole('button', { name: /À partir d’une vidéo/ })).toBeTruthy());
    expect(document.querySelector('[data-avatar-did-echec]')).toBeNull();
  });
});

describe('E. La voix manquante : une notification avec la sortie, pas une erreur sèche', () => {
  it('⚠️ « Votre voix personnelle est nécessaire pour l’aperçu. » + « Configurer ma voix » fait défiler jusqu’au panneau Ma voix et lui donne le focus', async () => {
    serveur.avatar = { id: A, name: 'Mon avatar', status: 'completed', avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', etat: 'entraine_non_valide', version: 1, validated_at: null };
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-apercu="generer"]')).not.toBeNull());
    await act(async () => { fireEvent.click(document.querySelector('[data-avatar-apercu="generer"]') as HTMLButtonElement); });
    await waitFor(() => expect(document.querySelector('[data-notification="avertissement"]')).not.toBeNull());
    const notif = document.querySelector('[data-notification="avertissement"]') as HTMLElement;
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe("Votre voix personnelle est nécessaire pour l'aperçu.");
    expect(document.querySelector('[data-notification="erreur"]')).toBeNull();
    const zone = document.querySelector('[data-avatar-ma-voix]') as HTMLElement;
    const defiler = vi.fn();
    zone.scrollIntoView = defiler;
    const focus = vi.spyOn(zone, 'focus');
    const action = notif.querySelector('[data-notification-action="principale"]') as HTMLButtonElement;
    expect(action.textContent).toContain('Configurer ma voix');
    fireEvent.click(action);
    expect(defiler).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(zone.querySelector('[data-ma-voix-panel]')).not.toBeNull();
  });
});
