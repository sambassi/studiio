import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * « AMÉLIORER MA PHOTO » — l'écran. Envoi et traitement simulés ; aucun
 * fournisseur. L'original reste la référence : Avant, Réinitialiser.
 */
const O = 'aaaaaaaa-1111-4111-8111-111111111111/avatar/source-1-original.jpg';
const T = (n: string) => `aaaaaaaa-1111-4111-8111-111111111111/avatar/source-2-${n}.jpg`;

vi.mock('@/lib/http/envoiAvecProgression', () => ({
  detailEnvoi: () => '',
  envoyerFormulaire: async (_u: string, _c: FormData, o: { onProgression?: (p: unknown) => void }) => {
    o.onProgression?.({ charges: 5, total: 10, pourcentage: 50 });
    return { ok: true, status: 200, json: { success: true, data: { cleOriginal: O } } };
  },
}));

import PreparationPhoto from '../components/avatar/studio/PreparationPhoto';

const appels: Array<Record<string, unknown>> = [];
beforeEach(() => {
  appels.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    const corps = JSON.parse(String(init?.body)) as { cleOriginal: string; embellissement: string };
    appels.push(corps);
    const cleTraitee = corps.embellissement === 'aucun' ? corps.cleOriginal : T(corps.embellissement);
    return { ok: true, json: async () => ({ success: true, data: { cleOriginal: corps.cleOriginal, cleTraitee, embellissement: corps.embellissement } }) } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const src = (cle: string) => `/api/avatar/sources/apercu?cle=${encodeURIComponent(cle)}`;

describe('Améliorer ma photo', () => {
  for (const niveau of ['aucun', 'naturel', 'doux', 'lisse'] as const) {
    it(`⚠️ « ${niveau} » : rendu RÉEL par le serveur, avant/après, puis les deux clés rendues au parcours`, async () => {
      const pret = vi.fn();
      const { container } = render(<PreparationPhoto fichier={new File(['x'], 'moi.jpg', { type: 'image/jpeg' })} onAnnuler={() => {}} onPret={pret} />);
      await waitFor(() => expect(container.querySelector('[data-preparation-photo="edition"]')).not.toBeNull());
      // « Naturel » proposé d'emblée.
      expect(container.querySelector('[data-preparation-embellissement="naturel"]')!.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(container.querySelector(`[data-preparation-embellissement="${niveau}"]`)!);
      await act(async () => { fireEvent.click(container.querySelector('[data-preparation-photo-previsualiser]')!); });
      expect(appels).toEqual([{ cleOriginal: O, embellissement: niveau }]);
      const cle = niveau === 'aucun' ? O : T(niveau);
      expect(container.querySelector('[data-preparation-photo-image]')!.getAttribute('src')).toBe(src(cle));
      // Avant : l'ORIGINAL, conservé.
      fireEvent.click(container.querySelector('[data-preparation-photo-voir="original"]')!);
      expect(container.querySelector('[data-preparation-photo-image="originale"]')!.getAttribute('src')).toBe(src(O));
      fireEvent.click(container.querySelector('[data-preparation-photo-utiliser]')!);
      expect(pret).toHaveBeenCalledWith(expect.objectContaining({ cleOriginal: O, cleTraitee: cle, embellissement: niveau }));
    });
  }

  it('⚠️ Réinitialiser : la photo utilisée redevient l’ORIGINAL, sans aucun traitement', async () => {
    const pret = vi.fn();
    const { container } = render(<PreparationPhoto fichier={new File(['x'], 'moi.jpg', { type: 'image/jpeg' })} onAnnuler={() => {}} onPret={pret} />);
    await waitFor(() => expect(container.querySelector('[data-preparation-photo-previsualiser]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-preparation-embellissement="lisse"]')!);
    await act(async () => { fireEvent.click(container.querySelector('[data-preparation-photo-previsualiser]')!); });
    fireEvent.click(container.querySelector('[data-preparation-photo-reinitialiser]')!);
    expect(container.querySelector('[data-preparation-photo-image="utilisee"]')!.getAttribute('src')).toBe(src(O));
    fireEvent.click(container.querySelector('[data-preparation-photo-utiliser]')!);
    expect(pret).toHaveBeenCalledWith(expect.objectContaining({ cleOriginal: O, cleTraitee: O, embellissement: 'aucun' }));
    expect(appels).toHaveLength(1);
  });
});
