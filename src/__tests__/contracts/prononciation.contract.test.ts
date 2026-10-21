/**
 * CONTRAT C-PRONUNCIATION — une prononciation identique au texte d'origine
 * (après normalisation : casse, espaces, insécables, Unicode) n'est JAMAIS
 * suggérée, enregistrée ni appliquée. Validé par #564.
 */
import { describe, it, expect } from 'vitest';
import {
  ajouterPrononciation, modifierPrononciation, lirePrononciations, prononciationIdentique, prononciationValide, scriptParle,
} from '@/lib/voice/prononciations';
import { nettoyerSuggestion, suggererPrononciationLocale, suggestionUtile } from '@/lib/voice/suggestion-prononciation';

const PAIRES_IDENTIQUES: Array<[string, string]> = [
  ['lien en bio', 'lien en bio'],
  ['lien en bio', '  LIEN  EN BIO '],
  ['lien en bio', 'lien en bio'],
  ['Afroboost', 'afroboost'],
  ['Neuchâtel', 'Neuchâtel'],
];

describe('C-PRONUNCIATION — jamais identique', () => {
  it.each(PAIRES_IDENTIQUES)('« %s » / « %s » : identique, refusé à l’enregistrement', (a, p) => {
    expect(prononciationIdentique(a, p)).toBe(true);
    expect(prononciationValide({ affiche: a, prononce: p })).toEqual({ ok: false, motif: 'identique' });
    expect(ajouterPrononciation([], { affiche: a, prononce: p })).toEqual({ ok: false, motif: 'identique' });
    expect(modifierPrononciation([{ affiche: a, prononce: 'autre chose' }], a, { affiche: a, prononce: p })).toEqual({ ok: false, motif: 'identique' });
  });

  it.each(PAIRES_IDENTIQUES)('suggestion « %s » → « %s » : jamais proposée (UI et modèle)', (a, p) => {
    expect(suggestionUtile(a, p)).toBeNull();
    expect(nettoyerSuggestion(p, a)).toBeNull();
    expect(nettoyerSuggestion(`« ${p} »\nexplication`, a)).toBeNull();
  });

  it('suggestion locale : quand elle rend le même texte, elle est marquée incertaine et ne passe pas le filtre', () => {
    for (const a of ['lien en bio', 'Bonjour', 'Afroboost']) {
      const s = suggererPrononciationLocale(a);
      if (prononciationIdentique(a, s.suggestion)) {
        expect(s.incertain).toBe(true);
        expect(suggestionUtile(a, s.suggestion)).toBeNull();
      }
    }
  });

  it('une forme DIFFÉRENTE reste acceptée (le garde-fou ne bloque pas les vraies corrections)', () => {
    expect(suggestionUtile('Worcestershire', 'Wousteur-chire')).toBe('Wousteur-chire');
    expect(suggestionUtile('3 séances', 'trois séances')).toBe('trois séances');
    // Nom propre / marque : la respelling proche reste une vraie correction.
    expect(suggestionUtile('Afroboost', 'Afro-Boust')).toBe('Afro-Boust');
    // Expression ordinaire : une micro-variation (« bioo ») n'en est pas une.
    expect(suggestionUtile('lien en bio', 'lien en bioo')).toBeNull();
    expect(prononciationValide({ affiche: 'ADN', prononce: 'A D N' })).toMatchObject({ ok: true });
  });

  it('relecture : une entrée identique déjà stockée n’est jamais appliquée au script', () => {
    const stockees = [{ affiche: 'Afroboost', prononce: 'Afro-Boust' }, { affiche: 'lien en bio', prononce: 'LIEN EN BIO' }];
    expect(lirePrononciations(stockees)).toEqual([{ affiche: 'Afroboost', prononce: 'Afro-Boust' }]);
    expect(scriptParle('Afroboost, lien en bio', lirePrononciations(stockees))).toBe('Afro-Boust, lien en bio');
  });
});
