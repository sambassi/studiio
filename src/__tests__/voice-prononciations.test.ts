import { describe, it, expect } from 'vitest';
import {
  scriptParle, scripts, ajouterPrononciation, modifierPrononciation, supprimerPrononciation, lirePrononciations,
  prononciationValide, MAX_PRONONCIATIONS, MAX_LONGUEUR_PRONONCIATION, type Prononciation,
} from '@/lib/voice/prononciations';

/**
 * DISPLAY_SCRIPT vs SPOKEN_SCRIPT — la fonction commune, pure et
 * déterministe, et les opérations de liste.
 */

const P: Prononciation[] = [
  { affiche: 'Afroboost', prononce: 'Afro-boust' },
  { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' },
];

describe('scriptParle — le texte affiché reste, le texte dit change', () => {
  it('⚠️ l’exemple du cahier des charges', () => {
    const display = 'Bienvenue au cours Afroboost à Neuchâtel.';
    expect(scriptParle(display, P)).toBe('Bienvenue au cours Afro-boust à Neu-cha-tel.');
    expect(scripts(display, P)).toEqual({ display, spoken: 'Bienvenue au cours Afro-boust à Neu-cha-tel.' });
  });

  it('⚠️ DISPLAY_SCRIPT n’est jamais modifié : même chaîne en entrée après appel ; sans prononciation, même référence', () => {
    const display = 'Afroboost, Afroboost.';
    const avant = display;
    scriptParle(display, P);
    expect(display).toBe(avant);
    expect(scriptParle(display, [])).toBe(display);
    expect(scriptParle('', P)).toBe('');
  });

  it('mot entier seulement : ni préfixe ni suffixe ; ponctuation et apostrophes = frontières', () => {
    expect(scriptParle('Afroboosté et superAfroboost', P)).toBe('Afroboosté et superAfroboost');
    expect(scriptParle('(Afroboost) Afroboost! l’Afroboost', P)).toBe('(Afro-boust) Afro-boust! l’Afro-boust');
  });

  it('insensible à la casse ; les accents NE sont PAS repliés (Neuchatel ≠ Neuchâtel)', () => {
    expect(scriptParle('AFROBOOST afroboost Afroboost', P)).toBe('Afro-boust Afro-boust Afro-boust');
    expect(scriptParle('Neuchatel', P)).toBe('Neuchatel');
    expect(scriptParle('NEUCHÂTEL', P)).toBe('Neu-cha-tel');
  });

  it('⚠️ une seule passe : la forme dite n’est jamais re-remplacée', () => {
    const chaine = [{ affiche: 'A', prononce: 'B' }, { affiche: 'B', prononce: 'C' }];
    expect(scriptParle('A B', chaine)).toBe('B C');
    expect(scriptParle('Afroboost', [{ affiche: 'Afroboost', prononce: 'Afro Afroboost' }])).toBe('Afro Afroboost');
  });

  it('le plus long d’abord, déterministe quel que soit l’ordre d’enregistrement ; espaces multiples tolérés', () => {
    const a = [{ affiche: 'Afroboost', prononce: 'X' }, { affiche: 'Cours Afroboost', prononce: 'Y' }];
    const b = [...a].reverse();
    expect(scriptParle('Le Cours Afroboost et Afroboost', a)).toBe('Le Y et X');
    expect(scriptParle('Le Cours Afroboost et Afroboost', b)).toBe('Le Y et X');
    expect(scriptParle('Cours   Afroboost', a)).toBe('Y');
  });

  it('⚠️ aucune regex utilisateur : les métacaractères sont littéraux', () => {
    const p = [{ affiche: 'C++', prononce: 'C plus plus' }, { affiche: '.*', prononce: 'étoile' }, { affiche: '(a|b)', prononce: 'ab' }];
    expect(scriptParle('J’aime C++ et .* et (a|b) mais pas ab.', p)).toBe('J’aime C plus plus et étoile et ab mais pas ab.');
    expect(scriptParle('C++Afroboost', p)).toBe('C++Afroboost');
  });

  it('Unicode : mots accentués, apostrophes typographiques, chiffres comme lettres', () => {
    expect(scriptParle('Élan élan ÉLAN', [{ affiche: 'élan', prononce: 'é-lan' }])).toBe('é-lan é-lan é-lan');
    expect(scriptParle('B2B et B2B2', [{ affiche: 'B2B', prononce: 'bi-tou-bi' }])).toBe('bi-tou-bi et B2B2');
    expect(scriptParle('café', [{ affiche: 'caf', prononce: 'X' }])).toBe('café');
  });
});

describe('opérations de liste — ajouter, modifier, supprimer, lire', () => {
  it('ajout : normalisé ; vide, trop long, identique, doublon (sans casse), trop nombreuses → refus', () => {
    expect(ajouterPrononciation([], { affiche: '  Afroboost ', prononce: 'Afro-boust' })).toEqual({ ok: true, liste: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] });
    expect(ajouterPrononciation([], { affiche: '', prononce: 'x' })).toEqual({ ok: false, motif: 'vide' });
    expect(ajouterPrononciation([], { affiche: 'x', prononce: '   ' })).toEqual({ ok: false, motif: 'vide' });
    expect(ajouterPrononciation([], { affiche: 'a'.repeat(MAX_LONGUEUR_PRONONCIATION + 1), prononce: 'x' })).toEqual({ ok: false, motif: 'trop_long' });
    expect(ajouterPrononciation([], { affiche: 'Afroboost', prononce: 'afroboost ' })).toEqual({ ok: false, motif: 'identique' });
    expect(ajouterPrononciation(P, { affiche: 'AFROBOOST', prononce: 'autre' })).toEqual({ ok: false, motif: 'doublon' });
    const pleine = Array.from({ length: MAX_PRONONCIATIONS }, (_, i) => ({ affiche: `mot${i}`, prononce: `dit${i}` }));
    expect(ajouterPrononciation(pleine, { affiche: 'encore', prononce: 'x' })).toEqual({ ok: false, motif: 'trop_nombreuses' });
    expect(ajouterPrononciation([], null)).toEqual({ ok: false, motif: 'vide' });
  });

  it('modification : par texte affiché actuel (sans casse) ; introuvable ; collision → doublon ; changement de mot autorisé', () => {
    expect(modifierPrononciation(P, 'afroboost', { affiche: 'Afroboost', prononce: 'A-fro-boust' })).toEqual({ ok: true, liste: [{ affiche: 'Afroboost', prononce: 'A-fro-boust' }, P[1]] });
    expect(modifierPrononciation(P, 'Inconnu', { affiche: 'x', prononce: 'y' })).toEqual({ ok: false, motif: 'introuvable' });
    expect(modifierPrononciation(P, 'Afroboost', { affiche: 'neuchâtel', prononce: 'z' })).toEqual({ ok: false, motif: 'doublon' });
    expect(modifierPrononciation(P, 'Afroboost', { affiche: 'Afroboost', prononce: '' })).toEqual({ ok: false, motif: 'vide' });
    const r = modifierPrononciation(P, 'Afroboost', { affiche: 'Afro Boost', prononce: 'Afro-boust' });
    expect(r.ok && r.liste[0]).toEqual({ affiche: 'Afro Boost', prononce: 'Afro-boust' });
  });

  it('suppression : par texte affiché ; introuvable sinon ; la liste d’origine n’est pas mutée', () => {
    const copie = [...P];
    expect(supprimerPrononciation(P, 'NEUCHÂTEL')).toEqual({ ok: true, liste: [P[0]] });
    expect(supprimerPrononciation(P, 'rien')).toEqual({ ok: false, motif: 'introuvable' });
    expect(P).toEqual(copie);
  });

  it('lecture tolérante : entrées invalides ignorées, doublons dédupliqués, bornée, jamais d’exception', () => {
    expect(lirePrononciations(null)).toEqual([]);
    expect(lirePrononciations('x')).toEqual([]);
    expect(lirePrononciations([{ affiche: 'A', prononce: 'B' }, 'bruit', { affiche: 'a', prononce: 'C' }, { affiche: '', prononce: 'x' }, { affiche: 'D', prononce: 'D' }])).toEqual([{ affiche: 'A', prononce: 'B' }]);
    const trop = Array.from({ length: MAX_PRONONCIATIONS + 5 }, (_, i) => ({ affiche: `m${i}`, prononce: `d${i}` }));
    expect(lirePrononciations(trop)).toHaveLength(MAX_PRONONCIATIONS);
    expect(prononciationValide({ affiche: `A${String.fromCharCode(0)}B`, prononce: 'x' })).toEqual({ ok: true, valeur: { affiche: 'A B', prononce: 'x' } });
  });
});
