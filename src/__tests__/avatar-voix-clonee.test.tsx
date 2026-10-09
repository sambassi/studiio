import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * MON AVATAR — « MA VOIX » (voix clonée) DANS LE SÉLECTEUR DE GÉNÉRATION.
 *
 * Réutilise le moteur du jumeau de Créer, tel quel :
 *   - lecture : GET /api/creer/jumeau (la voix que le serveur utilisera) +
 *     GET /api/voice/clone (les voix du compte) ;
 *   - génération : POST /api/creer/jumeau/generer (synthèse avec MA voix,
 *     avatar animé sur cet audio), suivie par GET /api/avatar/status.
 * Une voix HeyGen continue de passer par POST /api/avatar/generate.
 *
 * Tout est simulé : AUCUN fournisseur, AUCUNE génération réelle.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const A = '11111111-1111-4111-8111-000000000001';
const BASSI = 'uv-bassi-0000-4000-8000-000000000001';
const AUTRE = 'uv-autre-0000-4000-8000-000000000002';
const URL_JUMEAU = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/jumeau.mp4';
const URL_HEYGEN = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/heygen.mp4';

const avatarValide = { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-06T00:00:00Z', etat: 'valide', version: 3, validated_at: '2026-10-06T10:00:00Z', provider: 'heygen' };
const jumeauPret = (voixId = BASSI) => ({ pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null, jumeau: { avatar: { id: A, version: 3, nom: 'Mon avatar vidéo', valideLe: '2026-10-06', fournisseur: 'heygen' }, voix: { id: voixId, nom: 'bassi' }, prononciations: 0 } });

const serveur = {
  clonees: [] as Array<{ id: string; accountVoiceId: string; name: string }>,
  jumeau: jumeauPret() as Record<string, unknown>,
  /** Ce que rend GET /api/creer/jumeau AU MOMENT de générer (null = identique). */
  jumeauAuLancement: null as Record<string, unknown> | null,
};
const appels: Array<{ url: string; method: string; corps: unknown }> = [];
let lancements = 0;

beforeEach(() => {
  appels.length = 0;
  lancements = 0;
  serveur.clonees = [{ id: 'elevenlabs-bassi', accountVoiceId: BASSI, name: 'bassi' }];
  serveur.jumeau = jumeauPret();
  serveur.jumeauAuLancement = null;
  window.localStorage.clear();
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method, corps: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    if (u === '/api/avatar/create') return json(200, { success: true, data: { avatar: avatarValide, voices: [{ voiceId: 'hg1', name: 'Yosef', language: 'French' }, { voiceId: 'hg2', name: 'Léa', language: 'French' }], defaultVoiceId: 'hg1' } });
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 3, etat: 'valide', apercu: { statut: 'aucun' }, renduRecent: null } });
    if (u.startsWith('/api/creer/jumeau?') || u === '/api/creer/jumeau') {
      lancements += 1;
      const etat = lancements > 1 && serveur.jumeauAuLancement ? serveur.jumeauAuLancement : serveur.jumeau;
      return json(200, { success: true, data: etat });
    }
    if (u === '/api/voice/clone') return json(200, { success: true, voices: serveur.clonees });
    if (u === '/api/creer/jumeau/generer') return json(200, { success: true, data: { generationId: 'gen-jumeau', status: 'processing', avatarVersion: 3 } });
    if (u === '/api/avatar/generate') return json(200, { success: true, data: { generationId: 'gen-heygen' } });
    if (u.startsWith('/api/avatar/status?generationId=gen-jumeau')) return json(200, { success: true, data: { status: 'completed', videoUrl: URL_JUMEAU, avatarVersion: 3 } });
    if (u.startsWith('/api/avatar/status?generationId=gen-heygen')) return json(200, { success: true, data: { status: 'completed', videoUrl: URL_HEYGEN } });
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); });

const select = () => document.querySelector('[data-avatar-voix]') as HTMLSelectElement;
const bouton = () => document.querySelector('[data-avatar-generer] button, [data-avatar-generation] .button-primary') as HTMLButtonElement;
const ecrire = (texte: string) => fireEvent.change(document.querySelector('[data-avatar-generation] textarea')!, { target: { value: texte } });
const monter = async () => {
  render(<AvatarPage />);
  await waitFor(() => expect(select()).not.toBeNull());
};
const attendreClonees = () => waitFor(() => expect(document.querySelector(`[data-voix-clonee="${BASSI}"]`)).not.toBeNull());
const posts = () => appels.filter((a) => a.method === 'POST').map((a) => a.url);

describe('Mon avatar — « Ma voix » dans le sélecteur', () => {
  it('⚠️ 1-2. bassi apparaît en premier, dans « Ma voix », marquée « Voix clonée » — les voix HeyGen restent dans « Voix disponibles »', async () => {
    await monter();
    await attendreClonees();
    const groupes = [...select().querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
    expect(groupes).toEqual(['Ma voix', 'Voix disponibles']);
    const bassi = select().querySelector(`[data-voix-clonee="${BASSI}"]`) as HTMLOptionElement;
    expect(bassi.textContent).toBe('bassi — Voix clonée');
    expect(bassi.disabled).toBe(false);
    expect(bassi.value).toBe(`clone:${BASSI}`);
    const heygen = [...select().querySelectorAll('optgroup[label="Voix disponibles"] option')].map((o) => (o as HTMLOptionElement).value);
    expect(heygen).toEqual(['hg1', 'hg2']);
    // La voix par défaut reste celle d'avant : rien ne change sans choix.
    expect(select().value).toBe('hg1');
  });

  it('⚠️ 3. bassi choisie : la génération passe par le moteur du jumeau de Créer (/api/creer/jumeau/generer), JAMAIS par /api/avatar/generate', async () => {
    await monter();
    await attendreClonees();
    fireEvent.change(select(), { target: { value: `clone:${BASSI}` } });
    expect(document.querySelector('[data-voix-clonee-badge]')?.textContent).toContain('Voix clonée');
    ecrire('Bonjour, je suis Bassi.');
    await act(async () => { fireEvent.click(bouton()); });
    await waitFor(() => expect(document.querySelector(`video[src="${URL_JUMEAU}"]`)).not.toBeNull());
    expect(posts()).toEqual(['/api/creer/jumeau/generer']);
    const corps = appels.find((a) => a.url === '/api/creer/jumeau/generer')!.corps as Record<string, unknown>;
    expect(corps).toEqual({ textes: ['Bonjour, je suis Bassi.'], aspectRatio: '9:16', avatarId: A });
    // Aucun identifiant de voix n'est envoyé : le serveur résout MA voix lui-même.
    expect(JSON.stringify(corps)).not.toContain(BASSI);
  });

  it('⚠️ 4. une voix HeyGen continue de passer par /api/avatar/generate, avec son voice_id', async () => {
    await monter();
    await attendreClonees();
    fireEvent.change(select(), { target: { value: 'hg2' } });
    ecrire('Texte HeyGen.');
    await act(async () => { fireEvent.click(bouton()); });
    await waitFor(() => expect(document.querySelector(`video[src="${URL_HEYGEN}"]`)).not.toBeNull());
    expect(posts()).toEqual(['/api/avatar/generate']);
    expect(appels.find((a) => a.url === '/api/avatar/generate')!.corps).toEqual({ avatarId: A, script: 'Texte HeyGen.', voiceId: 'hg2', aspectRatio: '9:16' });
  });

  it('⚠️ 5. aucune voix clonée : pas de section « Ma voix », la liste est celle d’avant', async () => {
    serveur.clonees = [];
    await monter();
    await waitFor(() => expect(appels.some((a) => a.url === '/api/voice/clone')).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(select().querySelectorAll('optgroup')).toHaveLength(0);
    expect([...select().querySelectorAll('option')].map((o) => o.value)).toEqual(['hg1', 'hg2']);
  });

  it('⚠️ 6a. la voix du jumeau a changé entre le choix et le clic : erreur claire, AUCUNE génération, aucune autre voix', async () => {
    await monter();
    await attendreClonees();
    fireEvent.change(select(), { target: { value: `clone:${BASSI}` } });
    ecrire('Bonjour.');
    serveur.jumeauAuLancement = jumeauPret(AUTRE);
    await act(async () => { fireEvent.click(bouton()); });
    await waitFor(() => expect(document.body.textContent).toContain('La voix utilisée par votre jumeau a changé.'));
    expect(posts()).toEqual([]);
    // Le choix affiché n'est pas remplacé en silence.
    expect(select().value).toBe(`clone:${BASSI}`);
  });

  it('⚠️ 6b. jumeau indisponible au lancement (voix supprimée) : message du serveur, aucune génération, la sélection reste modifiable', async () => {
    await monter();
    await attendreClonees();
    fireEvent.change(select(), { target: { value: `clone:${BASSI}` } });
    ecrire('Bonjour.');
    serveur.jumeauAuLancement = { pret: false, motif: 'voix_absente', message: 'Ajoutez ou sélectionnez votre voix personnelle avant d’utiliser votre jumeau.', moteurDisponible: true, messageMoteur: null, jumeau: null };
    await act(async () => { fireEvent.click(bouton()); });
    await waitFor(() => expect(document.body.textContent).toContain('Ajoutez ou sélectionnez votre voix personnelle'));
    expect(posts()).toEqual([]);
    // L'option est désormais marquée indisponible, le bouton fermé ; une voix HeyGen se choisit et fonctionne.
    expect(document.querySelector('[data-voix-clonee-indisponible]')).not.toBeNull();
    expect(bouton().disabled).toBe(true);
    fireEvent.change(select(), { target: { value: 'hg1' } });
    expect(bouton().disabled).toBe(false);
  });

  it('⚠️ 6c. plusieurs voix clonées : seule celle du jumeau est sélectionnable, les autres sont dites indisponibles ici', async () => {
    serveur.clonees = [{ id: 'e1', accountVoiceId: BASSI, name: 'bassi' }, { id: 'e2', accountVoiceId: AUTRE, name: 'bassi studio' }];
    await monter();
    await attendreClonees();
    const options = [...select().querySelectorAll('optgroup[label="Ma voix"] option')] as HTMLOptionElement[];
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([['bassi — Voix clonée', false], ['bassi studio — Voix clonée (indisponible ici)', true]]);
  });

  it('⚠️ 7. aucun appel hors des routes Studiio : jamais un fournisseur depuis le navigateur', async () => {
    await monter();
    await attendreClonees();
    fireEvent.change(select(), { target: { value: `clone:${BASSI}` } });
    ecrire('Bonjour.');
    await act(async () => { fireEvent.click(bouton()); });
    await waitFor(() => expect(document.querySelector(`video[src="${URL_JUMEAU}"]`)).not.toBeNull());
    expect(appels.every((a) => a.url.startsWith('/api/'))).toBe(true);
    expect(appels.some((a) => /heygen|elevenlabs/i.test(a.url))).toBe(false);
  });

  it('⚠️ 10. coût inchangé : le bouton dit toujours 40 crédits, quelle que soit la voix ; aucun appel de crédits côté navigateur', async () => {
    await monter();
    await attendreClonees();
    expect(bouton().textContent).toContain('(40 crédits)');
    fireEvent.change(select(), { target: { value: `clone:${BASSI}` } });
    expect(bouton().textContent).toContain('(40 crédits)');
    expect(appels.some((a) => a.url.startsWith('/api/credits'))).toBe(false);
  });
});
