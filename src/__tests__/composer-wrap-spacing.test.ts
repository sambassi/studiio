import { describe, it, expect } from 'vitest';
import { wrapText, measureSpacedText } from '../lib/video-composer';

/**
 * Le retour à la ligne du compositeur, face à l'interlettrage.
 *
 * Ces tests exécutent le VRAI `wrapText` — pas une réimplémentation. Le
 * `ctx` est une doublure dont `measureText` est déterministe (largeur fixe
 * par caractère), ce qui permet de calculer à la main la largeur que le tracé
 * produira et de vérifier qu'aucune ligne ne dépasse.
 *
 * Ce qu'ils protègent : `wrapText` décidait la coupe sur la largeur NUE
 * alors que `fillTextWithSpacing` ajoutait ensuite l'espacement caractère par
 * caractère. Le compositeur croyait donc les lignes plus courtes qu'elles ne
 * seraient et les laissait sortir du cadre — pendant que l'aperçu CSS, lui,
 * revenait à la ligne au bon endroit. Même texte, deux mises en page.
 */

/** `measureText` déterministe : chaque caractère vaut `CHAR_W`. */
const CHAR_W = 10;
function fakeCtx(): CanvasRenderingContext2D {
  return {
    measureText: (t: string) => ({ width: Array.from(t).length * CHAR_W }),
    textAlign: 'left' as CanvasTextAlign,
  } as unknown as CanvasRenderingContext2D;
}

/** Largeur réellement tracée par `fillTextWithSpacing` (espaces ENTRE les glyphes). */
const rendered = (line: string, spacing: number) =>
  Array.from(line).length * CHAR_W + Math.max(0, Array.from(line).length - 1) * spacing;

const TEXT = 'ALPHA BRAVO CHARLIE DELTA ECHO FOXTROT';

describe('wrapText — la coupe tient compte de l’interlettrage', () => {
  it('sans interlettrage, le comportement est inchangé', () => {
    const ctx = fakeCtx();
    // Rétro-compat : c'est le cas de TOUS les appels qui ne passent rien.
    expect(wrapText(ctx, TEXT, 200)).toEqual(wrapText(ctx, TEXT, 200, 0));
    for (const line of wrapText(ctx, TEXT, 200)) {
      expect(rendered(line, 0)).toBeLessThanOrEqual(200);
    }
  });

  it('aucune ligne ne dépasse le cadre, quel que soit l’espacement', () => {
    const ctx = fakeCtx();
    const maxWidth = 300;
    let multiWordLines = 0;
    for (const spacing of [0, 0.5, 2, 5, 12, 40]) {
      for (const line of wrapText(ctx, TEXT, maxWidth, spacing)) {
        // Un mot SEUL trop large ne peut pas être coupé — ni ici, ni par le
        // navigateur dans l'aperçu. Les deux débordent donc à l'identique :
        // c'est une limite partagée, pas une dérive. Toute ligne de deux mots
        // ou plus, elle, doit tenir.
        if (line.includes(' ')) {
          multiWordLines++;
          expect(rendered(line, spacing)).toBeLessThanOrEqual(maxWidth);
        }
      }
    }
    // Garde-fou : sans lui, un `wrapText` qui renverrait un mot par ligne
    // passerait ce test sans rien vérifier.
    expect(multiWordLines).toBeGreaterThan(5);
  });

  it('un mot trop large déborde IDENTIQUEMENT dans l’aperçu et l’export', () => {
    // La règle est « pas de dérive », pas « le canvas fait mieux que CSS ».
    const ctx = fakeCtx();
    expect(wrapText(ctx, 'ALPHA ANTICONSTITUTIONNELLEMENT', 120, 6)).toEqual([
      'ALPHA',
      'ANTICONSTITUTIONNELLEMENT',
    ]);
  });

  it('c’est bien l’espacement qui change la coupe', () => {
    const ctx = fakeCtx();
    const sans = wrapText(ctx, TEXT, 300, 0);
    const avec = wrapText(ctx, TEXT, 300, 12);
    // Sinon le test précédent passerait aussi avec un `wrapText` qui ignore
    // l'espacement mais tombe par chance sous la limite.
    expect(avec).not.toEqual(sans);
    expect(avec.length).toBeGreaterThan(sans.length);
  });

  it('reproduit LA MÊME coupe que l’aperçu CSS', () => {
    // CSS ajoute l'interlettrage après CHAQUE caractère — le dernier compris —
    // et cette avance finale compte dans la largeur qui déclenche le retour à
    // la ligne. Sans ce cran d'écart, le compositeur couperait plus tard que
    // l'aperçu sur les lignes qui frôlent la limite : même texte, deux mises
    // en page. C'est la preuve de non-dérive demandée.
    const ctx = fakeCtx();
    const maxWidth = 300;
    const spacing = 7;
    /** Mise en page d'un navigateur : largeur = glyphes + spacing par caractère. */
    const cssWrap = (text: string) => {
      const out: string[] = [];
      let cur = '';
      for (const word of text.split(' ')) {
        const test = cur ? `${cur} ${word}` : word;
        const w = Array.from(test).length * (CHAR_W + spacing);
        if (w > maxWidth && cur) {
          out.push(cur);
          cur = word;
        } else {
          cur = test;
        }
      }
      if (cur) out.push(cur);
      return out;
    };
    expect(wrapText(ctx, TEXT, maxWidth, spacing)).toEqual(cssWrap(TEXT));
  });

  it('respecte les retours à la ligne explicites', () => {
    const ctx = fakeCtx();
    expect(wrapText(ctx, 'UN\nDEUX', 1000, 5)).toEqual(['UN', 'DEUX']);
  });

  it('ne boucle pas sur un mot plus large que le cadre', () => {
    // Un mot seul dépasse forcément : `wrapText` doit le garder sur sa ligne
    // plutôt que de tenter une coupe impossible.
    const ctx = fakeCtx();
    const lines = wrapText(ctx, 'ANTICONSTITUTIONNELLEMENT', 50, 5);
    expect(lines).toEqual(['ANTICONSTITUTIONNELLEMENT']);
  });
});

describe('measureSpacedText — la mesure qu’utilise le tracé', () => {
  it('mesure les espaces ENTRE les caractères, pas après le dernier', () => {
    const ctx = fakeCtx();
    expect(measureSpacedText(ctx, 'ABCD', 3)).toBe(4 * CHAR_W + 3 * 3);
  });

  it('sans espacement, retombe sur la mesure native', () => {
    const ctx = fakeCtx();
    expect(measureSpacedText(ctx, 'ABCD', 0)).toBe(ctx.measureText('ABCD').width);
  });

  it('ne renvoie pas de largeur négative sur une chaîne vide', () => {
    // `(0 - 1) * spacing` donnerait une largeur négative, et un centrage
    // décalé vers la droite.
    expect(measureSpacedText(fakeCtx(), '', 8)).toBe(0);
  });

  it('un seul caractère n’a aucun espacement à porter', () => {
    expect(measureSpacedText(fakeCtx(), 'A', 8)).toBe(CHAR_W);
  });
});
