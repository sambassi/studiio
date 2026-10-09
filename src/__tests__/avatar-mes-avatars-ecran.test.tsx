import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

/**
 * « MES AVATARS », LE SÉLECTEUR D'AVATAR ET LE PARCOURS D'UNE NOUVELLE SOURCE.
 * Réseau simulé ; aucun fournisseur. Ce que l'utilisateur lit et ce qui part
 * au serveur — jamais un identifiant fournisseur.
 */

vi.mock('@/components/avatar/studio/EnregistreurSource', () => ({
  default: (p: { onUtiliser: (f: File) => void }) => (
    <button data-faux-enregistreur onClick={() => p.onUtiliser(new File(['x'], 'cam.webm', { type: 'video/webm' }))}>enregistrer</button>
  ),
}));
vi.mock('@/components/avatar/studio/PreparationSource', () => ({
  default: (p: { onPret: (r: unknown) => void }) => (
    <button data-fausse-preparation onClick={() => p.onPret({ cleOriginal: 'O', cleTraitee: 'T', infos: {} })}>prête</button>
  ),
}));

import MesAvatars, { statutCarte, type AvatarPublic } from '../components/avatar/MesAvatars';
import SelecteurAvatar from '../components/avatar/SelecteurAvatar';
import FluxSourceAvatar from '../components/avatar/FluxSourceAvatar';

const v = (version: number, etat: string, over: Record<string, unknown> = {}) => ({ id: `v${version}`, version, etat, message: null, type: 'video', creeLe: '2026-10-09', valideeLe: etat === 'prete' ? null : '2026-10-06', ...over });
const avatar = (over: Partial<AvatarPublic> = {}): AvatarPublic => ({
  id: 'a1', nom: 'Bassi principal', parDefaut: true, type: 'video', utilisable: true,
  versionActive: v(3, 'prete', { valideeLe: '2026-10-06' }) as never, candidate: null, historique: [], ...over,
});

let reponses: Record<string, unknown> = {};
const appels: Array<{ url: string; corps: unknown }> = [];

beforeEach(() => {
  appels.length = 0;
  reponses = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const corps = init?.body instanceof FormData ? Object.fromEntries((init.body as FormData).entries()) : init?.body ? JSON.parse(String(init.body)) : null;
    appels.push({ url, corps });
    const r = reponses[url] ?? { success: true, data: {} };
    return { ok: (r as { success?: boolean }).success !== false, json: async () => r } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const liste = (avatars: AvatarPublic[], capacite = { nouvelAvatarPhoto: true, nouvelAvatarVideo: false, emplacementsVideoLibres: 0 }) => {
  reponses['/api/avatars'] = { success: true, data: { avatars, capacite, qualites: [] } };
};

describe('Statut d’une carte', () => {
  it('candidate en préparation / prête / en échec / aucune', () => {
    expect(statutCarte(avatar())).toEqual({ libelle: 'Utilisable', ton: 'ok' });
    expect(statutCarte(avatar({ candidate: v(4, 'entrainement') as never })).libelle).toBe('Nouvelle version en préparation');
    expect(statutCarte(avatar({ candidate: v(4, 'prete') as never })).libelle).toBe('Nouvelle version prête');
    expect(statutCarte(avatar({ candidate: v(4, 'echec') as never })).ton).toBe('erreur');
  });
});

describe('Mes avatars', () => {
  it('⚠️ pendant la préparation : « Version actuellement utilisée : v3 » et « Nouvelle version en préparation »', async () => {
    liste([avatar({ candidate: v(4, 'entrainement') as never })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-version-active]')?.textContent).toBe('Version actuellement utilisée : v3'));
    expect(container.querySelector('[data-candidate="en-preparation"]')?.textContent).toMatch(/Votre version v3 reste utilisée/);
    expect(container.querySelector('[data-badge-defaut]')).not.toBeNull();
    // Le serveur est relancé pour suivre la candidate.
    await waitFor(() => expect(appels.some((a) => a.url === '/api/avatars/versions/v4' && (a.corps as { action: string }).action === 'synchroniser')).toBe(true));
  });

  it('⚠️ échec : « La nouvelle version n’a pas pu être créée » avec Réessayer / Modifier la vidéo / Abandonner', async () => {
    liste([avatar({ candidate: v(4, 'echec', { message: 'Votre avatar actuel reste utilisable.' }) as never })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-candidate="echec"]')).not.toBeNull());
    expect(container.textContent).toMatch(/La nouvelle version n’a pas pu être créée/);
    for (const a of ['reessayer', 'modifier-video', 'abandonner']) expect(container.querySelector(`[data-action="${a}"]`)).not.toBeNull();
    fireEvent.click(container.querySelector('[data-action="abandonner"]')!);
    await waitFor(() => expect(appels.some((a) => a.url === '/api/avatars/versions/v4' && (a.corps as { action: string }).action === 'garder')).toBe(true));
  });

  it('⚠️ prête : « Utiliser cette version » reste fermé tant que l’aperçu n’a pas été ouvert ; puis envoie le jeton', async () => {
    liste([avatar({ candidate: v(4, 'prete') as never })]);
    reponses['/api/avatars/versions/v4'] = { success: true, data: { url: '/x.mp4', jeton: 'J', version: {} } };
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelector('[data-candidate="prete"]')).not.toBeNull());
    expect(container.textContent).toMatch(/Votre nouvel avatar est prêt/);
    const utiliser = container.querySelector('[data-action="utiliser-version"]') as HTMLButtonElement;
    expect(utiliser.disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-action="apercu"]')!);
    await waitFor(() => expect(container.querySelector('[data-apercu-candidate]')).not.toBeNull());
    expect(utiliser.disabled).toBe(false);
    fireEvent.click(utiliser);
    await waitFor(() => expect(appels.some((a) => (a.corps as { action?: string; jeton?: string })?.action === 'utiliser' && (a.corps as { jeton: string }).jeton === 'J')).toBe(true));
    expect(container.querySelector('[data-action="garder"]')?.textContent).toMatch(/Garder ma version actuelle/);
  });

  it('plusieurs identités : « Utiliser » sur celle qui n’est pas par défaut ; Gérer montre « Revenir à cette version »', async () => {
    liste([avatar(), avatar({ id: 'a2', nom: 'Bassi studio', parDefaut: false, historique: [v(1, 'prete', { valideeLe: '2026-10-01' }) as never] })]);
    const { container } = render(<MesAvatars />);
    await waitFor(() => expect(container.querySelectorAll('[data-carte-avatar]')).toHaveLength(2));
    const deuxieme = container.querySelector('[data-carte-avatar="a2"]')!;
    fireEvent.click(deuxieme.querySelector('[data-action="utiliser"]')!);
    await waitFor(() => expect(appels.some((a) => a.url === '/api/avatars/defaut' && (a.corps as { avatarId: string }).avatarId === 'a2')).toBe(true));
    fireEvent.click(deuxieme.querySelector('[data-action="gerer"]')!);
    expect(deuxieme.querySelector('[data-action="revenir"]')).not.toBeNull();
  });
});

describe('Parcours d’une nouvelle source', () => {
  it('⚠️ remplacer en vidéo : Enregistrer maintenant → préparation → consentement → envoi d’une CANDIDATE (clés préparées, identité logique)', async () => {
    reponses['/api/avatar/create'] = { success: true, data: { candidate: {} } };
    const fin = vi.fn();
    const { container } = render(<FluxSourceAvatar mode="remplacer" avatar={{ id: 'a1', nom: 'Bassi principal', type: 'video' }} capacite={{ nouvelAvatarPhoto: true, nouvelAvatarVideo: false }} onFermer={() => {}} onTermine={fin} />);
    expect(container.querySelector('[data-flux-rassurance]')?.textContent).toMatch(/reste utilisé/);
    fireEvent.click(container.querySelector('[data-flux-enregistrer]')!);
    fireEvent.click(container.querySelector('[data-faux-enregistreur]')!);
    fireEvent.click(container.querySelector('[data-fausse-preparation]')!);
    const envoyer = container.querySelector('[data-flux-envoyer]') as HTMLButtonElement;
    expect(envoyer.disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-flux-consentement]')!);
    fireEvent.click(envoyer);
    await waitFor(() => expect(fin).toHaveBeenCalled());
    const corps = appels.find((a) => a.url === '/api/avatar/create')!.corps as Record<string, string>;
    expect(corps).toMatchObject({ mode: 'remplacer', avatarId: 'a1', cleSource: 'T', cleOriginal: 'O', consent: 'true' });
    expect(corps.file).toBeUndefined();
  });

  it('⚠️ nouvel avatar avec l’emplacement vidéo plein : vidéo désactivée et dite AVANT tout envoi', () => {
    const { container } = render(<FluxSourceAvatar mode="nouveau" avatar={null} capacite={{ nouvelAvatarPhoto: true, nouvelAvatarVideo: false }} onFermer={() => {}} onTermine={() => {}} />);
    expect((container.querySelector('[data-flux-type="video"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-emplacement-plein]')?.textContent).toMatch(/emplacement d’avatar vidéo est déjà utilisé/);
    expect(appels).toEqual([]);
  });
});

describe('Sélecteur d’avatar (Créer, Autopilote)', () => {
  it('⚠️ ne propose que les avatars utilisables, renvoie l’identité LOGIQUE ; invisible avec un seul avatar', async () => {
    liste([avatar(), avatar({ id: 'a2', nom: 'Bassi studio', parDefaut: false }), avatar({ id: 'a3', nom: 'Brouillon', parDefaut: false, utilisable: false, versionActive: null })]);
    const onChange = vi.fn();
    const { container } = render(<SelecteurAvatar avatarId={null} onChange={onChange} />);
    await waitFor(() => expect(container.querySelector('[data-selecteur-avatar-choix]')).not.toBeNull());
    const options = Array.from(container.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Avatar par défaut', 'Bassi principal · v3 (par défaut)', 'Bassi studio · v3']);
    fireEvent.change(container.querySelector('select')!, { target: { value: 'a2' } });
    expect(onChange).toHaveBeenCalledWith('a2');
    cleanup();
    liste([avatar()]);
    const seul = render(<SelecteurAvatar avatarId={null} onChange={() => {}} />);
    await waitFor(() => expect(appels.filter((a) => a.url === '/api/avatars').length).toBeGreaterThan(1));
    expect(seul.container.querySelector('[data-selecteur-avatar]')).toBeNull();
  });
});
