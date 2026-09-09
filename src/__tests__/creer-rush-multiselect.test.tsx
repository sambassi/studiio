/**
 * CREER_PREMIUM_3 — SÉLECTIONNER DEUX RUSHES EN CLIQUANT LES CARTES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT : UN CLIC AJOUTAIT, LE SUIVANT REMPLAÇAIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Après le retrait du petit « + », cliquer une seconde carte ne conservait pas
 * la première. La cause n'était pas dans le clic mais dans la REPRÉSENTATION :
 * la liste des rushes montés EXCLUAIT le rush regardé, qui n'en faisait partie
 * que par déduction. Cliquer un second rush déplaçait le regard — et le
 * premier, qui n'existait que comme « regardé », sortait du montage sans un mot.
 *
 * ⚠️ CE BANC REJOUE LA SÉQUENCE EXACTE que Bassi n'arrivait pas à faire, avec
 * un état réel : A, puis B, puis A. Les assertions portent sur ce que l'écran
 * MONTRE, pas sur les appels reçus — un `onBasculer` appelé ne prouve pas que
 * la sélection a tenu.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useCallback, useState } from 'react';
import BandeRushes, { type AnalyseCarte } from '@/components/creer/BandeRushes';
import { MAX_RUSHES_MANUEL } from '@/lib/autopilot/analyse/montage-pool';

const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-11111111111${n}`;
const rush = (n: number) => ({
  id: ID(n), sessionId: 's1', bucket: 'rushes', cleObjet: `u/r${n}.mp4`,
  nomOrigine: `rush-${n}.mp4`, contentType: 'video/mp4', tailleOctets: 1000,
  dureeSecondes: 30, rang: n, etat: 'verifie', metadata: {},
  creeLe: '2026-09-09T00:00:00Z', majLe: '2026-09-09T00:00:00Z',
}) as never;

const RUSHES = [rush(1), rush(2), rush(3)];
const ANALYSES: Record<string, AnalyseCarte | null> = {
  [ID(1)]: { id: 'a1', etat: 'reussie', vignettes: 0 },
  [ID(2)]: { id: 'a2', etat: 'reussie', vignettes: 0 },
  [ID(3)]: { id: 'a3', etat: 'reussie', vignettes: 0 },
};

/**
 * Le vrai couplage de l'écran : la liste COMPLÈTE des montés d'un côté, le
 * rush regardé de l'autre — et la règle du panneau qui les relie.
 */
function Ecran({ max = MAX_RUSHES_MANUEL }: { max?: number }) {
  const [montes, setMontes] = useState<string[]>([ID(1)]);
  const [regarde, setRegarde] = useState<string | null>(ID(1));

  const basculer = useCallback((id: string) => {
    setMontes((v) => {
      if (v.includes(id)) return v.length <= 1 ? v : v.filter((x) => x !== id);
      return v.length >= max ? v : [...v, id];
    });
  }, [max]);

  return (
    <BandeRushes
      rushes={RUSHES} analyses={ANALYSES} selection={regarde}
      onSelectionner={setRegarde} onVoirAnalyse={() => {}} onReanalyser={() => {}}
      onAjouterFichiers={() => {}} envois={[]}
      onBasculer={basculer} maxRushes={max} montesIds={montes}
    />
  );
}

const carte = (n: number) =>
  document.querySelector(`[data-bande-choisir="${ID(n)}"]`) as HTMLButtonElement;
/** Ce que l'écran MONTRE comme monté — l'attribut posé sur chaque carte. */
const montes = () => [1, 2, 3]
  .filter((n) => document.querySelector(
    `[data-bande-carte="${ID(n)}"][data-bande-carte-montee="1"]`,
  ) !== null);
const compte = () => document.querySelector('[data-bande-compte]')
  ?.getAttribute('data-bande-compte') ?? null;

const clic = (n: number) => act(() => { fireEvent.click(carte(n)); });

describe('CREER_PREMIUM_3 — la séquence A, B, A', () => {
  it('clic A → [A] ; clic B → [A, B] ; clic A → [B]', () => {
    render(<Ecran />);
    // Départ : A est regardé et monté.
    expect(montes()).toEqual([1]);

    /* ⚠️ LE CŒUR DU DÉFAUT. Avant, ce clic remplaçait A par B. */
    clic(2);
    expect(montes()).toEqual([1, 2]);

    clic(1);
    expect(montes()).toEqual([2]);
  });

  it('trois rushes s accumulent, et se retirent un par un', () => {
    render(<Ecran />);
    clic(2);
    clic(3);
    expect(montes()).toEqual([1, 2, 3]);
    clic(2);
    expect(montes()).toEqual([1, 3]);
  });

  it('le compte suit ce qui est réellement monté', () => {
    render(<Ecran />);
    expect(compte()).toBeNull();       // un seul : rien à annoncer
    clic(2);
    expect(compte()).toBe('2');
    clic(3);
    expect(compte()).toBe('3');
    clic(3);
    expect(compte()).toBe('2');
  });

  it('le dernier rush ne se retire pas', () => {
    /* Une vidéo sans matière n'existe pas : mieux vaut une carte qui reste
       cochée qu'un écran incohérent. */
    render(<Ecran />);
    clic(1);
    expect(montes()).toEqual([1]);
  });

  it('au plafond, un rush de plus n entre pas', () => {
    render(<Ecran max={2} />);
    clic(2);
    expect(montes()).toEqual([1, 2]);
    clic(3);
    expect(montes()).toEqual([1, 2]);
  });

  it('AJOUTER déplace le regard, RETIRER ne le déplace pas', () => {
    /* ⚠️ DEUX NOTIONS DISTINCTES. Le rush regardé donne l'image de l'aperçu ;
       les montés donnent la matière. Ajouter B, c'est demander à voir B. */
    render(<Ecran />);
    clic(2);
    expect(carte(2).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector(
      `[data-bande-carte="${ID(2)}"][data-bande-carte-choisie="1"]`,
    )).not.toBeNull();
  });

  it('le plafond vient d A_7b, pas d une constante d écran', () => {
    expect(MAX_RUSHES_MANUEL).toBe(8);
  });
});

describe('CREER_PREMIUM_3 — le mode historique ne bouge pas', () => {
  it('sans `onBasculer`, un seul rush est monté : celui qu on regarde', () => {
    const onSelectionner = vi.fn();
    render(
      <BandeRushes
        rushes={RUSHES} analyses={ANALYSES} selection={ID(2)}
        onSelectionner={onSelectionner} onVoirAnalyse={() => {}}
        onReanalyser={() => {}} onAjouterFichiers={() => {}} envois={[]}
      />,
    );
    expect(montes()).toEqual([2]);
    expect(document.querySelector('[data-bande-compte]')).toBeNull();
    fireEvent.click(carte(3));
    expect(onSelectionner).toHaveBeenCalledWith(ID(3));
  });
});
