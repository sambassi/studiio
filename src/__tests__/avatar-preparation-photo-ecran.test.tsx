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
    const corps = JSON.parse(String(init?.body)) as { cleOriginal: string; lissage: number };
    appels.push(corps);
    const cleTraitee = corps.lissage === 0 ? corps.cleOriginal : T(String(corps.lissage));
    return { ok: true, json: async () => ({ success: true, data: { cleOriginal: corps.cleOriginal, cleTraitee, lissage: corps.lissage } }) } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const src = (cle: string) => `/api/avatar/sources/apercu?cle=${encodeURIComponent(cle)}`;

const regler = (container: HTMLElement, v: number) => fireEvent.change(container.querySelector('[data-curseur-lissage-entree]')!, { target: { value: String(v) } });

describe('Améliorer ma photo', () => {
  it('⚠️ curseur 0–100 %, 25 % d’emblée, valeur affichée ; les repères règlent la valeur', async () => {
    const { container } = render(<PreparationPhoto fichier={new File(['x'], 'moi.jpg', { type: 'image/jpeg' })} onAnnuler={() => {}} onPret={() => {}} />);
    await waitFor(() => expect(container.querySelector('[data-preparation-photo="edition"]')).not.toBeNull());
    const entree = container.querySelector('[data-curseur-lissage-entree]') as HTMLInputElement;
    expect([entree.min, entree.max, entree.value]).toEqual(['0', '100', '25']);
    expect(container.querySelector('[data-curseur-lissage-valeur]')!.textContent).toBe('Lissage : 25 % — Naturel');
    regler(container, 40);
    expect(container.querySelector('[data-curseur-lissage-valeur]')!.textContent).toBe('Lissage : 40 %');
    fireEvent.click(container.querySelector('[data-curseur-lissage-repere="75"]')!);
    expect(container.querySelector('[data-curseur-lissage-valeur]')!.textContent).toBe('Lissage : 75 % — Lissé');
  });

  for (const lissage of [0, 10, 25, 50, 75, 100]) {
    it(`⚠️ ${lissage} % : rendu RÉEL par le serveur, avant/après, puis les deux clés rendues au parcours`, async () => {
      const pret = vi.fn();
      const { container } = render(<PreparationPhoto fichier={new File(['x'], 'moi.jpg', { type: 'image/jpeg' })} onAnnuler={() => {}} onPret={pret} />);
      await waitFor(() => expect(container.querySelector('[data-preparation-photo="edition"]')).not.toBeNull());
      regler(container, lissage);
      await act(async () => { fireEvent.click(container.querySelector('[data-preparation-photo-previsualiser]')!); });
      expect(appels).toEqual([{ cleOriginal: O, lissage }]);
      const cle = lissage === 0 ? O : T(String(lissage));
      expect(container.querySelector('[data-preparation-photo-image]')!.getAttribute('src')).toBe(src(cle));
      // Avant : l'ORIGINAL, conservé.
      fireEvent.click(container.querySelector('[data-preparation-photo-voir="original"]')!);
      expect(container.querySelector('[data-preparation-photo-image="originale"]')!.getAttribute('src')).toBe(src(O));
      fireEvent.click(container.querySelector('[data-preparation-photo-utiliser]')!);
      expect(pret).toHaveBeenCalledWith(expect.objectContaining({ cleOriginal: O, cleTraitee: cle, lissage }));
    });
  }

  it('⚠️ Réinitialiser : la photo utilisée redevient l’ORIGINAL (0 %), sans aucun traitement', async () => {
    const pret = vi.fn();
    const { container } = render(<PreparationPhoto fichier={new File(['x'], 'moi.jpg', { type: 'image/jpeg' })} onAnnuler={() => {}} onPret={pret} />);
    await waitFor(() => expect(container.querySelector('[data-preparation-photo-previsualiser]')).not.toBeNull());
    regler(container, 80);
    await act(async () => { fireEvent.click(container.querySelector('[data-preparation-photo-previsualiser]')!); });
    fireEvent.click(container.querySelector('[data-preparation-photo-reinitialiser]')!);
    expect(container.querySelector('[data-preparation-photo-image="utilisee"]')!.getAttribute('src')).toBe(src(O));
    fireEvent.click(container.querySelector('[data-preparation-photo-utiliser]')!);
    expect(pret).toHaveBeenCalledWith(expect.objectContaining({ cleOriginal: O, cleTraitee: O, lissage: 0 }));
    expect(appels).toHaveLength(1);
  });
});
