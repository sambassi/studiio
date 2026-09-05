import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  fontVariablesCss, googleFontsUrlMany, fontStack, FONT_CATALOG, findFont,
} from '@/lib/fonts/catalog';

/**
 * Polices du rendu serveur — Phase 3.
 *
 * ⚠️ IL MANQUAIT DEUX CHOSES, PAS UNE — et la première est la moins visible.
 *
 * `fontStack('Anton')` produit `var(--font-anton), 'Anton', sans-serif`. Or
 * une variable CSS **indéfinie rend la déclaration entière invalide** au
 * moment du calcul : Chromium n'essaie même pas le repli `'Anton'`, il
 * retombe sur `sans-serif`. Vérifié dans un Chromium réel — `getComputedStyle`
 * rendait `sans-serif`, et `'Anton'` avait disparu.
 *
 * Autrement dit, **charger les polices n'aurait servi à rien** tant que les
 * variables n'étaient pas définies : la famille n'atteignait jamais le moteur
 * de rendu. C'est le genre de cause qu'on ne trouve qu'en rendant, et qu'on
 * corrigerait à l'envers en cherchant d'abord « pourquoi la police ne se
 * charge pas ».
 */

// ⚠️ `catalog-data.ts`, ET NON `catalog.ts`, DEPUIS LA SÉPARATION DE LA
// FRONTIÈRE SERVEUR/CLIENT. `fontStack` et l'explication des variables CSS
// vivent désormais dans le module PUR : `catalog.ts` garde la directive
// `'use client'` et le chargement navigateur, et re-exporte les données.
// Ce que ce test fixe — la même pile CSS des deux côtés, et la cause écrite là
// où on la cherchera — est inchangé ; seul le fichier qui la porte a bougé.
const catalogue = readFileSync(resolve(__dirname, '../lib/fonts/catalog-data.ts'), 'utf-8');
const crochet = readFileSync(resolve(__dirname, '../../remotion/useMontageFonts.ts'), 'utf-8');
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
const layout = readFileSync(resolve(__dirname, '../app/layout.tsx'), 'utf-8');

describe('Les variables CSS — la moitié invisible du correctif', () => {
  it('chaque famille à variable en déclare une', () => {
    const css = fontVariablesCss();
    for (const f of FONT_CATALOG.filter((x) => x.cssVar)) {
      expect(css, f.family).toContain(`${f.cssVar}: '${f.family}';`);
    }
  });

  it('la déclaration est un bloc `:root` exploitable', () => {
    const css = fontVariablesCss();
    expect(css.startsWith(':root {')).toBe(true);
    expect(css.trim().endsWith('}')).toBe(true);
  });

  it('elle couvre les variables posées par next/font', () => {
    // Les deux moteurs doivent définir les MÊMES variables, sinon
    // `fontStack` rend une chose ici et une autre là.
    const css = fontVariablesCss();
    for (const v of ['--font-inter', '--font-anton', '--font-bebas']) {
      if (layout.includes(v)) expect(css, v).toContain(v);
    }
  });

  it('une famille sans variable n en fabrique pas', () => {
    // `fontStack` rend alors directement la famille citée.
    const sansVar = FONT_CATALOG.find((f) => !f.cssVar)!;
    expect(fontVariablesCss()).not.toContain(`'${sansVar.family}';\n`.replace('\n', ''));
    expect(fontStack(sansVar.family)).toBe(`'${sansVar.family}', sans-serif`);
  });
});

describe('googleFontsUrlMany — une seule requête', () => {
  it('réunit plusieurs familles dans une URL', () => {
    const url = googleFontsUrlMany(['Anton', 'Inter'])!;
    expect(url).toContain('family=Anton:wght@400');
    expect(url).toContain('family=Inter:wght@');
    expect(url.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
  });

  it('les espaces deviennent des `+`', () => {
    expect(googleFontsUrlMany(['Bebas Neue'])).toContain('family=Bebas+Neue');
  });

  it('elle ne demande que les graisses PUBLIÉES', () => {
    // Une graisse inexistante ferait répondre 400, et la feuille entière
    // échouerait — donc toutes les polices, pas seulement la fautive.
    const anton = findFont('Anton')!;
    expect(anton.weights).toEqual([400]);
    expect(googleFontsUrlMany(['Anton'])).toContain('Anton:wght@400&');
  });

  it('une famille inconnue est IGNORÉE, pas transmise', () => {
    // La transmettre ferait échouer la feuille entière.
    const url = googleFontsUrlMany(['Anton', 'Police Inventée'])!;
    expect(url).toContain('Anton');
    expect(url).not.toContain('Invent');
  });

  it('dédoublonne', () => {
    const url = googleFontsUrlMany(['Anton', 'Anton'])!;
    expect(url.match(/family=Anton/g)).toHaveLength(1);
  });

  it('rend null quand il n y a rien à charger', () => {
    expect(googleFontsUrlMany([])).toBeNull();
    expect(googleFontsUrlMany([null, undefined, ''])).toBeNull();
    expect(googleFontsUrlMany(['Rien Du Tout'])).toBeNull();
  });
});

describe('Le chargement retient le rendu', () => {
  it('aucune image ne sort avant que les polices soient prêtes', () => {
    // Sans cela, les premières frames sortiraient en police de repli et le
    // texte changerait de forme en cours de vidéo.
    expect(crochet).toContain('delayRender(');
    expect(crochet).toContain('continueRender(jeton)');
  });

  it('il attend le TÉLÉCHARGEMENT, pas seulement l analyse de la feuille', () => {
    expect(crochet).toContain('document.fonts.ready');
  });

  it('un échec réseau ne fait pas pendre le rendu', () => {
    // Mieux vaut une police de repli qu'un rendu bloqué indéfiniment.
    expect(crochet).toContain('link.onerror');
    expect(crochet).toContain('repli systeme');
  });

  it('les variables sont posées MÊME sans famille personnalisée', () => {
    // Les valeurs par défaut du design passent aussi par `fontStack`.
    const bloc = crochet.slice(crochet.indexOf('const style = document.createElement'));
    expect(bloc.indexOf('document.head.appendChild(style)'))
      .toBeLessThan(bloc.indexOf('if (!href)'));
  });

  it('seules les familles du montage sont chargées', () => {
    // Le catalogue en compte plus de cinquante : les charger toutes à chaque
    // rendu serait du réseau pur perdu.
    expect(FONT_CATALOG.length).toBeGreaterThan(40);
    expect(composition).toContain("useMontageFonts(['Inter', props.titleFont, props.subtitleFont, props.ctaFont])");
  });
});

describe('Les deux moteurs lisent la MÊME pile', () => {
  it('les piles passent par `fontStack`, jamais par une famille en dur', () => {
    // Depuis la Phase 4, titre et CTA sont des composants PARTAGES : c'est
    // eux qui appellent `fontStack`, et l'appel vaut donc pour les deux
    // moteurs a la fois.
    const titre = readFileSync(resolve(__dirname, '../components/creer/SequenceTitle.tsx'), 'utf-8');
    const cta = readFileSync(resolve(__dirname, '../components/creer/SequenceCta.tsx'), 'utf-8');
    expect(titre).toContain('fontStack(typography.font)');
    expect(cta).toContain('fontStack(typography.font)');
    expect(composition).toContain("fontFamily: fontStack('Inter')");
    // Plus aucune pile écrite à la main.
    expect(composition).not.toContain("fontFamily: 'Inter, sans-serif'");
    expect(composition).not.toContain('Helvetica, Arial');
  });

  it('le sous-titre retombe sur la police du titre, pas sur le système', () => {
    const titre = readFileSync(resolve(__dirname, '../components/creer/SequenceTitle.tsx'), 'utf-8');
    expect(titre).toContain('subtitleTypography.font || typography.font');
  });

  it('`fontStack` reste inchangée — le chemin navigateur ne bouge pas', () => {
    expect(catalogue).toContain("return def?.cssVar ? `var(${def.cssVar}), ${quoted}, sans-serif` : `${quoted}, sans-serif`;");
  });

  it('la cause est écrite là où on la cherchera', () => {
    expect(catalogue).toContain('rend la déclaration entière invalide');
    expect(crochet).toContain('DEUX MANQUES, PAS UN');
  });
});

describe('Le catalogue reste la source unique', () => {
  it('les polices proposées à l écran ont toutes une définition', () => {
    for (const f of FONT_CATALOG) {
      expect(findFont(f.family), f.family).toBeDefined();
      expect(f.weights.length, f.family).toBeGreaterThan(0);
    }
  });

  it('toutes sont des familles Google Fonts — donc chargeables côté serveur', () => {
    // C'est ce qui permet de couvrir le catalogue entier par une seule
    // feuille, sans dépendre d'un module par police.
    const url = googleFontsUrlMany(FONT_CATALOG.map((f) => f.family));
    expect(url).not.toBeNull();
    expect(url!.match(/family=/g)!.length).toBe(FONT_CATALOG.length);
  });
});
