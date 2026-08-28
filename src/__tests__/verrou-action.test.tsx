/**
 * Le verrou d'action, sur des valeurs.
 *
 * Ce que ces tests fixent : un `useState` ne peut PAS jouer ce rôle. C'est
 * la raison d'être du module, et elle est vérifiée ici plutôt que déduite —
 * le dernier test prend et relit dans le même tour, ce qu'un état React ne
 * permet pas.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVerrous, VERROU } from '@/lib/creer/verrouAction';

describe('useVerrous', () => {
  it('le premier preneur passe, le second est refusé', () => {
    const { result } = renderHook(() => useVerrous());
    let a = false; let b = false;
    act(() => {
      a = result.current.prendre('x');
      b = result.current.prendre('x');
    });
    expect(a).toBe(true);
    expect(b).toBe(false);
  });

  it('prendre et relire se font dans le MÊME tour', () => {
    // C'est tout l'intérêt du `ref` : `setState` n'aurait pas encore été
    // appliqué ici, et le second appel serait passé.
    const { result } = renderHook(() => useVerrous());
    act(() => {
      expect(result.current.prendre('y')).toBe(true);
      expect(result.current.prendre('y')).toBe(false);
      expect(result.current.prendre('y')).toBe(false);
    });
  });

  it('rendre libère, et une reprise volontaire est de nouveau possible', () => {
    const { result } = renderHook(() => useVerrous());
    act(() => { result.current.prendre('z'); });
    act(() => { result.current.rendre('z'); });
    let repris = false;
    act(() => { repris = result.current.prendre('z'); });
    expect(repris).toBe(true);
  });

  it('les clés sont indépendantes : deux actions différentes coexistent', () => {
    const { result } = renderHook(() => useVerrous());
    act(() => {
      expect(result.current.prendre(VERROU.regenerer)).toBe(true);
      expect(result.current.prendre(VERROU.exporter)).toBe(true);
      expect(result.current.prendre(VERROU.regenerer)).toBe(false);
    });
  });

  it('`actif` reflète l état pour l affichage', () => {
    const { result } = renderHook(() => useVerrous());
    expect(result.current.actif('a')).toBe(false);
    act(() => { result.current.prendre('a'); });
    expect(result.current.actif('a')).toBe(true);
    act(() => { result.current.rendre('a'); });
    expect(result.current.actif('a')).toBe(false);
  });

  it('rendre un verrou jamais pris ne casse rien', () => {
    const { result } = renderHook(() => useVerrous());
    act(() => { result.current.rendre('jamais-pris'); });
    expect(result.current.actif('jamais-pris')).toBe(false);
  });

  it('les clés sont nommées une seule fois, pour ne pas diverger', () => {
    const valeurs = Object.values(VERROU);
    expect(new Set(valeurs).size).toBe(valeurs.length);
    expect(valeurs.every((v) => v.startsWith('rendu:'))).toBe(true);
  });
});
