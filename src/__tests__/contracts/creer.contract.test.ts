/**
 * CONTRAT — CRÉER (LOCKED). Envoi, CTA du brief, cartes : ce que voit l'utilisateur.
 */
import { describe, it, expect } from 'vitest';
import { dateRequiseManquante, envoiPossible, dateRestauree } from '@/lib/creer/envoi';
import { avecCtaDuBrief, bilanCartesSurimpression, erreurCartesSurimpression } from '@/lib/creer/validation-rendu';

describe('CRÉER — Envoi', () => {
  it('brouillon : jamais de date exigée, toujours envoyable', () => {
    expect(dateRequiseManquante('brouillon', '')).toBe(false);
    expect(envoiPossible({ intention: 'brouillon', date: '', reseaux: 0 })).toBe(true);
  });
  it('programmer : date ET réseau obligatoires', () => {
    expect(dateRequiseManquante('programmer', '')).toBe(true);
    expect(envoiPossible({ intention: 'programmer', date: '', reseaux: 1 })).toBe(false);
    expect(envoiPossible({ intention: 'programmer', date: '2026-10-10', reseaux: 0 })).toBe(false);
    expect(envoiPossible({ intention: 'programmer', date: '2026-10-10', reseaux: 1 })).toBe(true);
  });
  it('Modifier : la date du post est conservée telle quelle', () => {
    expect(dateRestauree('2020-01-01', true)).toBe('2020-01-01');
  });
});

describe('CRÉER — CTA du brief', () => {
  const contenu = { cta: 'LE SPORT LE PLUS COMPLET', ctaSub: 'LIEN EN BIO' };
  it('le CTA saisi par l’utilisateur est rendu tel quel, la headline gardée', () => {
    expect(avecCtaDuBrief(contenu, { cta: 'Réservez sur afroboost.com.' })).toEqual({ cta: 'LE SPORT LE PLUS COMPLET', ctaSub: 'Réservez sur afroboost.com.' });
  });
  it('brief sans CTA : contenu inchangé', () => {
    expect(avecCtaDuBrief(contenu, { cta: '  ' })).toBe(contenu);
    expect(avecCtaDuBrief(contenu, null)).toBe(contenu);
  });
});

describe('CRÉER — cartes', () => {
  it('carte sans titre ou sans valeur → arrêt clair, rien débité', () => {
    const b = bilanCartesSurimpression([{ title: 'A', value: '1' }, { title: '', value: '2' }], [{ index: 0 }, { index: 1 }]);
    expect(b.incompletes).toEqual([2]);
    expect(erreurCartesSurimpression(b)).toMatch(/Rien n’a été composé ni débité/);
  });
  it('cartes complètes → aucun arrêt', () => {
    const b = bilanCartesSurimpression([{ title: 'A', value: '1' }], [{ index: 0 }]);
    expect(erreurCartesSurimpression(b)).toBeNull();
  });
});
