/**
 * LE SOUS-TEXTE ETEINT — `''` est une valeur, jamais une absence.
 *
 * `drawCTA` resolvait la petite ligne du CTA avec un `||` : une chaine vide —
 * c'est-a-dire « l'utilisateur a eteint ce texte » — y retombait sur un
 * litteral, et la video peignait « CHAT POUR PLUS D'INFOS » que personne
 * n'avait demande. L'apercu, lui, respectait deja l'extinction
 * (`SequenceCta.tsx:106` : `{subText && …}`), tout comme le rendu Remotion et
 * le resolveur canonique (`textesCanoniques.ts`, `e.valeur !== undefined`).
 * Le compositeur canvas etait le dernier moteur a dire l'inverse des autres.
 *
 * ── DEUX REGLES, PAS UNE ────────────────────────────────────────────────
 *
 * `??` ne suffit pas. `wrapText(ctx, '')` renvoie `['']` et non `[]` : une
 * ligne fantome de hauteur pleine subsiste, et l'entrefer `mt1` etait ajoute
 * sans condition. Le bloc etant ancre par le BAS, le gros texte flottait
 * au-dessus de son ancre avec ~50 px de vide sous lui. Eteindre le texte sans
 * refermer la place, c'est corriger a moitie.
 *
 * Ces tests executent le VRAI `drawCTA` sur un faux contexte 2D qui ENREGISTRE
 * les `fillText` reellement emis — la methode de `video-composer-transitions`.
 * On n'y rejoue aucune formule : on interroge la trace.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { drawCTA } from '@/lib/video-composer';

const W = 1080, H = 1920, CHAR_W = 10;
const DEFAUT_HISTORIQUE = "CHAT POUR PLUS D'INFOS";
const source = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

interface Trace { texte: string; y: number }

/** Faux contexte 2D : il n'imite rien, il enregistre ce qui est peint. */
function contexteEnregistreur() {
  const peints: Trace[] = [];
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    measureText: (t: string) => ({ width: Array.from(t).length * CHAR_W }),
    fillText: (t: string, _x: number, y: number) => { peints.push({ texte: t, y }); },
    strokeText: () => {},
    save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {}, scale: () => {}, setTransform: () => {},
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, rect: () => {}, roundRect: () => {}, clip: () => {},
    fill: () => {}, stroke: () => {}, setLineDash: () => {},
    fillRect: () => {}, clearRect: () => {}, strokeRect: () => {}, drawImage: () => {},
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => null,
  };
  // `font`, `fillStyle`, `textBaseline`, `shadow*`… sont ecrites puis relues
  // par `drawCTA` : le proxy les laisse vivre sans qu'aucune soit observee.
  const ctx = new Proxy(base, {
    get: (t, p) => (p in t ? (t as never)[p] : etat[p as string]),
    set: (_t, p, v) => { etat[p as string] = v; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, peints };
}

const GROS = 'JE ME LANCE';

/**
 * Peint une frame de CTA et rend la trace.
 *
 * @param ctaSubTextDesign la cle CANONIQUE — `undefined` = absente, `''` = eteinte
 * @param ctaTextParam     l'ANCIENNE cle, meme convention
 */
function peindre(ctaSubTextDesign: string | undefined, ctaTextParam: string | undefined) {
  const { ctx, peints } = contexteEnregistreur();
  drawCTA(
    ctx, W, H, '#7C3AED',
    ctaTextParam as string,
    'PARAM-NEUTRALISE', // `ctaSubTextParam`, `void`e depuis toujours
    undefined,          // salesPhrase
    'FILIGRANE-PARAM',  // `watermark` : repli du GROS texte
    null, 1,
    // La cle est POSEE seulement si elle existe : `{ ctaSubTextDesign: undefined }`
    // et une cle absente doivent rester deux choses differentes.
    {
      ctaMainText: GROS,
      ...(ctaSubTextDesign !== undefined ? { ctaSubTextDesign } : null),
    } as never,
  );
  return { peints, textes: peints.map((p) => p.texte) };
}

const yDe = (r: { peints: Trace[] }, texte: string) => r.peints.find((p) => p.texte === texte)!.y;

describe('sous-texte du CTA — une chaine vide eteint', () => {
  it('1. la cle canonique a `\'\'` : rien n\'est peint, et surtout pas le defaut', () => {
    // Egalite STRICTE de la trace : elle verrouille deux choses d'un coup —
    // le litteral n'est pas peint, ET aucun `fillText('')` residuel ne reste.
    expect(peindre('', '').textes).toEqual([GROS]);
  });

  it('2. l\'ANCIENNE cle a `\'\'` eteint aussi — l\'Assistant ecrit les deux', () => {
    // `AssistantWizard` envoie la meme valeur dans les deux echelons : vider
    // le champ met `''` partout, et le second ne doit pas ressusciter le defaut.
    expect(peindre(undefined, '').textes).toEqual([GROS]);
    expect(peindre('', '').textes).toEqual([GROS]);
  });

  it('3. cle canonique ABSENTE : le repli sur l\'ancienne est inchange', () => {
    expect(peindre(undefined, 'REPLI HISTORIQUE').textes).toEqual([GROS, 'REPLI HISTORIQUE']);
  });

  it('4. toutes les cles absentes : le defaut historique est toujours peint', () => {
    expect(peindre(undefined, undefined).textes).toEqual([GROS, DEFAUT_HISTORIQUE]);
    // Ce litteral vit AUSSI comme defaut de destructuration de `composeVideo`.
    // Les deux sont des replis historiques : aucun ne doit disparaitre.
    expect(source).toContain(`ctaText = 'CHAT POUR PLUS D\\'INFOS'`);
  });

  it('5. une valeur non vide traverse a l\'identique, et gagne sur l\'ancienne', () => {
    const r = peindre('LIEN EN BIO', 'NE DOIT PAS REMONTER');
    expect(r.textes).toEqual([GROS, 'LIEN EN BIO']);
  });
});

describe('sous-texte eteint — la place se referme', () => {
  it('4b. le gros texte DESCEND de la hauteur liberee, exactement', () => {
    const avec = peindre('LIEN EN BIO', '');
    const sans = peindre('', '');

    // Le bloc est ancre par le BAS : eteindre la petite ligne doit faire
    // descendre le gros texte, pas le laisser flotter au-dessus de son ancre.
    expect(yDe(sans, GROS)).toBeGreaterThan(yDe(avec, GROS));

    // Et de la hauteur de ligne PLUS l'entrefer — ni plus, ni moins. Un `??`
    // pose seul echouerait ici : la ligne fantome de `wrapText('')` garderait
    // la place, et l'ecart serait nul.
    const subFontSize = Math.round(W * 0.028);
    const mt1 = Math.max(1, Math.round(W * (4 / 320)));
    expect(yDe(sans, GROS) - yDe(avec, GROS)).toBeCloseTo(subFontSize * 1.2 + mt1, 0);
  });
});

describe('sous-texte du CTA — le gros texte et le filigrane sont hors d\'atteinte', () => {
  const CAS: ReadonlyArray<readonly [string, string | undefined, string | undefined]> = [
    ['canonique vide', '', ''],
    ['ancienne cle vide', undefined, ''],
    ['repli historique', undefined, 'REPLI HISTORIQUE'],
    ['aucune cle', undefined, undefined],
    ['valeur non vide', 'LIEN EN BIO', ''],
  ];

  it.each(CAS)('6. le gros texte est intact — %s', (_nom, design, param) => {
    expect(peindre(design, param).textes[0]).toBe(GROS);
  });

  it('6b. la cascade du GROS texte garde son `||` : le correctif ne vise que le sous-texte', () => {
    expect(source).toContain(
      "const effectiveCtaText = design?.ctaMainText || watermark || 'AFROBOOST';",
    );
  });

  it('6c. le filigrane n\'est jamais peint ici, et sa resolution est intacte', () => {
    for (const [, design, param] of CAS) {
      expect(peindre(design, param).textes).not.toContain('Afroboost.com');
    }
    expect(source).toContain("siteText?.text || 'Afroboost.com'");
  });
});
