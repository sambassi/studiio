import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * PRÉPARER MA VIDÉO — l'éditeur, de bout en bout : envoi de l'original
 * (progression réelle), refus immédiat, Recadrer / Couper / Améliorer,
 * « Prévisualiser » (préparation serveur), aperçu PRÉPARÉ, « Modifier »,
 * « Utiliser cette vidéo ». Réseau simulé ; aucun fournisseur.
 */

const envoi = vi.hoisted(() => ({
  reponse: null as unknown,
  appels: [] as Array<{ url: string; fichier: unknown }>,
  progression: null as null | ((p: { charges: number; total: number; pourcentage: number }) => void),
  liberer: null as null | (() => void),
}));

vi.mock('@/lib/http/envoiAvecProgression', async () => {
  const reel = await vi.importActual<Record<string, unknown>>('@/lib/http/envoiAvecProgression');
  return {
    ...reel,
    envoyerFormulaire: vi.fn((url: string, corps: FormData, o: { onProgression?: (p: unknown) => void }) => {
      envoi.appels.push({ url, fichier: corps.get('file') });
      envoi.progression = o.onProgression as never;
      return new Promise((resolve) => { envoi.liberer = () => resolve(envoi.reponse); });
    }),
  };
});

import PreparationSource from '../components/avatar/studio/PreparationSource';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const CLE_O = `${U}/avatar/source-1-0123456789abcdef0123456789abcdef.webm`;
const CLE_T1 = `${U}/avatar/source-2-0123456789abcdef0123456789abcdef.mp4`;
const CLE_T2 = `${U}/avatar/source-3-0123456789abcdef0123456789abcdef.mp4`;
const INFOS_O = {
  conteneur: 'matroska,webm', codecVideo: 'vp9', codecAudio: 'opus', largeur: 1920, hauteur: 1080, rotation: 0,
  largeurEffective: 1920, hauteurEffective: 1080, dureeS: 60, fps: 30, debitBps: null, tailleOctets: 9000,
};
const INFOS_T = { ...INFOS_O, conteneur: 'mov,mp4', codecVideo: 'h264', codecAudio: 'aac', largeurEffective: 1080, hauteurEffective: 1920, dureeS: 40 };
const OK = { ok: true, motifs: [], avertissements: [] };

const fetchs: Array<{ url: string; corps: unknown }> = [];
let reponsesTraiter: Array<{ status: number; body: unknown }> = [];

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const fichier = new File([new Uint8Array(10)], 'prise.webm', { type: 'video/webm' });

beforeEach(() => {
  envoi.appels.length = 0;
  envoi.reponse = { ok: true, status: 200, json: { success: true, data: { cleOriginal: CLE_O, infos: INFOS_O, preflight: OK } } };
  fetchs.length = 0;
  reponsesTraiter = [];
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:locale';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    fetchs.push({ url: String(url), corps: init?.body ? JSON.parse(String(init.body)) : null });
    const r = reponsesTraiter.shift() ?? { status: 500, body: { success: false, error: 'x' } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  // Une image SOMBRE, lue par le canvas de l'amélioration automatique.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(35) }) }),
  });
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => { cleanup(); });

async function monter() {
  const onPret = vi.fn();
  const onAnnuler = vi.fn();
  render(<PreparationSource fichier={fichier} onPret={onPret} onAnnuler={onAnnuler} />);
  return { onPret, onAnnuler };
}
async function envoyer() {
  await act(async () => { envoi.liberer?.(); });
}

describe('Préparer ma vidéo — éditeur', () => {
  it('⚠️ envoi → recadrer / couper / améliorer → préparer → aperçu PRÉPARÉ → modifier → utiliser', async () => {
    const { onPret } = await monter();
    // L'original part tel quel, avec la progression RÉELLE de l'envoi.
    expect(q('[data-preparation-source="envoi"]')).not.toBeNull();
    expect(envoi.appels).toEqual([{ url: '/api/avatar/sources', fichier }]);
    act(() => { envoi.progression?.({ charges: 512 * 1024, total: 1024 * 1024, pourcentage: 50 }); });
    expect(q('[data-preparation-progression]')!.textContent).toMatch(/50 %/);
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-editeur]')).not.toBeNull());
    expect(q<HTMLVideoElement>('[data-preparation-video="locale"]')!.getAttribute('src')).toBe('blob:locale');

    // Recadrer : ovale de cadrage, 9:16, pivoter à droite, centrer.
    expect(q('[data-preparation-ovale]')!.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(q('[data-preparation-ratio="9:16"]')!);
    fireEvent.click(q('[data-preparation-pivoter="droite"]')!);
    fireEvent.keyDown(q('[data-preparation-cadre]')!, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.click(q('[data-preparation-centrer]')!);

    // Couper : deux poignées au clavier (Maj = 10 s).
    fireEvent.click(q('[data-preparation-section="couper"]')!);
    fireEvent.keyDown(q('[data-preparation-poignee="debut"]')!, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(q('[data-preparation-poignee="fin"]')!, { key: 'ArrowLeft', shiftKey: true });
    expect(q('[data-preparation-coupe]')!.textContent).toMatch(/Début 0:10 · Fin 0:50 · 0:40 retenues/);
    expect(q('[data-preparation-poignee="debut"]')!.getAttribute('aria-valuenow')).toBe('10');

    // Améliorer : correction calculée sur une image sombre ; avant/après.
    fireEvent.click(q('[data-preparation-section="ameliorer"]')!);
    fireEvent.click(q('[data-preparation-auto]')!);
    expect(q<HTMLVideoElement>('[data-preparation-video="locale"]')!.style.filter).toMatch(/brightness\(1\.\d+\)/);
    fireEvent.click(q('[data-preparation-comparer]')!);
    expect(q('[data-preparation-comparaison]')).not.toBeNull();
    expect(q<HTMLVideoElement>('[data-preparation-video="locale"]')!.style.filter).toBe('none');

    // Prévisualiser : la préparation est faite par le SERVEUR.
    reponsesTraiter = [{ status: 200, body: { success: true, data: { cleOriginal: CLE_O, cleTraitee: CLE_T1, infos: INFOS_T, preflight: OK } } }];
    await act(async () => { fireEvent.click(q('[data-preparation-previsualiser]')!); });
    expect(fetchs).toHaveLength(1);
    expect(fetchs[0].url).toBe('/api/avatar/sources/traiter');
    const corps = fetchs[0].corps as { cleOriginal: string; parametres: Record<string, any> };
    expect(corps.cleOriginal).toBe(CLE_O);
    expect(corps.parametres).toMatchObject({ debutS: 10, finS: 50, rotation: 90 });
    // 9:16 dans une image tournée (1080 × 1920) : l'image entière → pas de recadrage.
    expect(corps.parametres.recadrage).toBeNull();
    expect(corps.parametres.amelioration.active).toBe(true);
    expect(corps.parametres.amelioration.luminosite).toBeGreaterThan(0);
    expect(corps.parametres.amelioration.luminosite).toBeLessThanOrEqual(0.08);

    // Le résultat : la vidéo PRÉPARÉE, relue par la route privée.
    await waitFor(() => expect(q('[data-preparation-resultat]')).not.toBeNull());
    expect(q('[data-preparation-video="preparee"]')!.getAttribute('src')).toBe(`/api/avatar/sources/apercu?cle=${encodeURIComponent(CLE_T1)}`);
    expect(q('[data-preparation-duree]')!.textContent).toBe('0:40');
    expect(q('[data-preparation-resolution]')!.textContent).toBe('1080 × 1920');
    expect(q('[data-preparation-qualite]')!.getAttribute('data-preparation-qualite')).toBe('bon');
    expect(q('[data-preparation-qualite]')!.textContent).toBe('Bon');
    expect(onPret).not.toHaveBeenCalled();

    // Modifier : retour à l'éditeur, réglages conservés ; nouvelle préparation.
    fireEvent.click(q('[data-preparation-modifier]')!);
    expect(q('[data-preparation-editeur]')).not.toBeNull();
    reponsesTraiter = [{ status: 200, body: { success: true, data: { cleOriginal: CLE_O, cleTraitee: CLE_T2, infos: INFOS_T, preflight: { ok: true, motifs: [], avertissements: ['Résolution correcte'] } } } }];
    await act(async () => { fireEvent.click(q('[data-preparation-previsualiser]')!); });
    expect((fetchs[1].corps as { parametres: { debutS: number } }).parametres.debutS).toBe(10);
    await waitFor(() => expect(q('[data-preparation-qualite="acceptable"]')).not.toBeNull());

    fireEvent.click(q('[data-preparation-utiliser]')!);
    expect(onPret).toHaveBeenCalledWith(expect.objectContaining({ cleOriginal: CLE_O, cleTraitee: CLE_T2, infos: INFOS_T }));
    // Le lissage proposé d'emblée (25 %) part avec les paramètres.
    expect((onPret.mock.calls[0][0] as { parametres: { amelioration: { lissage: number } } }).parametres.amelioration.lissage).toBe(25);
    // Aucun autre appel : ni fournisseur, ni création d'avatar.
    expect(fetchs.map((f) => f.url)).toEqual(['/api/avatar/sources/traiter', '/api/avatar/sources/traiter']);
  });

  it('recadrage réel : 1:1 dans une image 16:9 → recadrage envoyé, carré', async () => {
    await monter();
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-editeur]')).not.toBeNull());
    fireEvent.click(q('[data-preparation-ratio="1:1"]')!);
    reponsesTraiter = [{ status: 200, body: { success: true, data: { cleOriginal: CLE_O, cleTraitee: CLE_T1, infos: INFOS_T, preflight: OK } } }];
    await act(async () => { fireEvent.click(q('[data-preparation-previsualiser]')!); });
    const r = (fetchs[0].corps as { parametres: { recadrage: { x: number; largeur: number; hauteur: number } } }).parametres.recadrage;
    expect(r.hauteur).toBe(1);
    expect(r.largeur * 1920).toBeCloseTo(1080, 0);
    expect(r.x).toBeCloseTo((1 - r.largeur) / 2, 3);
  });

  it('⚠️ refus à l’envoi (pas de son) : motifs affichés AUSSITÔT, aucun traitement, « Choisir une autre vidéo »', async () => {
    envoi.reponse = { ok: false, status: 422, json: { success: false, error: 'x', data: { infos: INFOS_O, preflight: { ok: false, motifs: ['La vidéo n’a pas de son : votre voix est indispensable pour créer votre avatar.'], avertissements: [] } } } };
    const { onAnnuler } = await monter();
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-refus]')).not.toBeNull());
    expect(q('[data-preparation-refus]')!.textContent).toMatch(/pas de son/);
    expect(q('[data-preparation-editeur]')).toBeNull();
    fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => /autre vidéo/.test(b.textContent ?? ''))!);
    expect(onAnnuler).toHaveBeenCalled();
    expect(fetchs).toEqual([]);
  });

  it('⚠️ coupe trop courte : « Prévisualiser » désactivé, message clair', async () => {
    await monter();
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-editeur]')).not.toBeNull());
    fireEvent.click(q('[data-preparation-section="couper"]')!);
    for (let i = 0; i < 5; i++) fireEvent.keyDown(q('[data-preparation-poignee="debut"]')!, { key: 'ArrowRight', shiftKey: true });
    expect(q('[data-preparation-coupe-invalide]')!.textContent).toMatch(/au moins 15 secondes/);
    expect(q<HTMLButtonElement>('[data-preparation-previsualiser]')!.disabled).toBe(true);
  });

  it('⚠️ préparation refusée (422) : retour à l’éditeur avec les motifs, rien n’est utilisé', async () => {
    const { onPret } = await monter();
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-editeur]')).not.toBeNull());
    reponsesTraiter = [{ status: 422, body: { success: false, error: 'La vidéo préparée ne respecte pas les règles.', data: { motifs: ['Résolution trop faible (480 × 270) : 640 px minimum sur le grand côté, 1080p recommandé.'] } } }];
    await act(async () => { fireEvent.click(q('[data-preparation-previsualiser]')!); });
    await waitFor(() => expect(q('[data-preparation-echec]')).not.toBeNull());
    expect(q('[data-preparation-echec]')!.textContent).toMatch(/640 px minimum/);
    expect(q('[data-preparation-resultat]')).toBeNull();
    expect(onPret).not.toHaveBeenCalled();
  });

  it('erreur d’envoi : message + « Réessayer » relance l’envoi', async () => {
    envoi.reponse = { ok: false, status: 500, json: { success: false, error: 'Votre vidéo n’a pas pu être enregistrée. Réessayez.' } };
    await monter();
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-erreur]')).not.toBeNull());
    expect(q('[data-preparation-erreur]')!.textContent).toMatch(/pas pu être enregistrée/);
    envoi.reponse = { ok: true, status: 200, json: { success: true, data: { cleOriginal: CLE_O, infos: INFOS_O, preflight: OK } } };
    fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Réessayer')!);
    await envoyer();
    await waitFor(() => expect(q('[data-preparation-editeur]')).not.toBeNull());
    expect(envoi.appels).toHaveLength(2);
  });
});
