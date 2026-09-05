/**
 * LE CATALOGUE DE POLICES — LES DONNEES, ET RIEN QUE LES DONNEES.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE SEPAREMENT DE `catalog.ts`
 * ---------------------------------------------------------------------------
 *
 * `catalog.ts` porte `'use client'` : il contient le chargement des polices
 * dans le navigateur — `document.fonts`, `FontFace`, l'insertion d'une balise
 * `<link>`. C'est legitime, et cela doit le rester.
 *
 * Mais un module marque `'use client'` ne rend pas ses valeurs a un module
 * SERVEUR : Next lui remet une reference client. Le symptome n'apparait qu'a
 * la construction, et il est deroutant :
 *
 *     Attempted to call map() from the server but map is on the client.
 *
 * C'est ce qui a casse `npm run build` sur `/api/autopilot/montages/[id]/rendu`
 * quand `catalogues-creatifs.ts` a commence a evaluer `FONT_CATALOG.map(...)`
 * AU CHARGEMENT DU MODULE. Les appels PARESSEUX passaient encore — `findFont`
 * dans `textStyle.ts` n'est appele qu'a l'execution — mais c'etait un sursis,
 * pas une garantie.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ UNE SEULE SOURCE, DEUX LECTEURS
 * ---------------------------------------------------------------------------
 *
 *                        catalog-data.ts   (ce fichier — PUR)
 *                               |
 *                 +-------------+-------------+
 *                 |                           |
 *           catalog.ts                 catalogues-creatifs.ts
 *           'use client'                textStyle.ts, moteur
 *
 * `FONT_CATALOG` n'est declare QU'ICI. Recopier les cinquante-deux familles
 * pour dispenser le serveur d'un import aurait produit deux listes qui
 * divergent le jour ou l'une accueille une famille et pas l'autre — et ce
 * jour-la, l'ecran proposerait une police que le rendu ne connait pas. Un test
 * verifie qu'aucune seconde declaration n'apparait.
 *
 * ⚠️ CE FICHIER NE DOIT JAMAIS TOUCHER AU DOM. Pas de `document`, pas de
 * `window`, pas de `navigator`, pas de `FontFace`, pas de `'use client'`. Un
 * test le verifie, parce que la regression se voit a la construction et non
 * aux tests unitaires.
 *
 * Catalogue de polices — LA source unique.
 *
 * L'apercu (DOM) et le compositeur (canvas) doivent charger exactement les
 * memes familles, avec exactement les memes graisses. Deux listes finiraient
 * par diverger, et la video ne ressemblerait plus a ce que l'utilisateur a
 * valide a l'ecran.
 *
 * Les GRAISSES sont declarees famille par famille : c'est ce qui permet de ne
 * telecharger que ce qui existe, et de VERIFIER le chargement sur les seules
 * graisses qu'une famille publie — controler le 900 d'une Pacifico qui n'a que
 * le 400 faisait conclure a tort a un echec.
 *
 * ⚠️ Le vrai piege est ailleurs, et il est silencieux : `document.fonts.load()`
 * appele juste apres avoir insere la balise `<link>` ne trouve encore AUCUNE
 * `@font-face` — la feuille n'est pas analysee — et resout donc sur un tableau
 * vide, immediatement. Pire, `document.fonts.check()` renvoie `true` par
 * specification quand rien ne correspond (le texte se rendra, en police
 * systeme). Un chargement qui ne charge rien se declarait ainsi reussi en
 * quelques millisecondes, et le canvas dessinait en Helvetica pendant que
 * l'apercu, lui, affichait la bonne police. Il faut attendre le `load` de la
 * balise AVANT de demander les polices, et se fier aux `FontFace` reellement
 * renvoyees, jamais a `check()`.
 
 */

export type FontGroup = 'display' | 'text' | 'script';

export interface FontDef {
  family: string;
  /** Graisses REELLEMENT publiees par Google pour cette famille. */
  weights: number[];
  group: FontGroup;
  /**
   * Variable CSS posee par `next/font` dans `layout.tsx`, quand la famille en
   * a une. Ces six-la sont deja dans la page : elles s'affichent sans aucun
   * telechargement, et leur pile CSS ne doit pas changer — c'est le rendu
   * d'avant ce catalogue.
   */
  cssVar?: string;
}

/**
 * Ordre d'affichage dans le selecteur. « Titres » d'abord : c'est ce qu'on
 * cherche pour une affiche.
 */
export const FONT_GROUP_LABELS: Record<FontGroup, string> = {
  display: 'Titres',
  text: 'Texte',
  script: 'Script',
};

export const FONT_CATALOG: FontDef[] = [
  // ── Titres / display ────────────────────────────────────────────────
  { family: 'Anton', weights: [400], group: 'display', cssVar: '--font-anton' },
  { family: 'Bebas Neue', weights: [400], group: 'display', cssVar: '--font-bebas' },
  { family: 'Syne', weights: [400, 500, 600, 700, 800], group: 'display', cssVar: '--font-syne' },
  { family: 'Archivo Black', weights: [400], group: 'display' },
  { family: 'Oswald', weights: [200, 300, 400, 500, 600, 700], group: 'display' },
  { family: 'Teko', weights: [300, 400, 500, 600, 700], group: 'display' },
  { family: 'Righteous', weights: [400], group: 'display' },
  { family: 'Bungee', weights: [400], group: 'display' },
  { family: 'Alfa Slab One', weights: [400], group: 'display' },
  { family: 'Titan One', weights: [400], group: 'display' },
  { family: 'Fjalla One', weights: [400], group: 'display' },
  { family: 'Staatliches', weights: [400], group: 'display' },
  { family: 'Chivo', weights: [300, 400, 700, 900], group: 'display' },
  { family: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900], group: 'display' },
  { family: 'Abril Fatface', weights: [400], group: 'display' },
  { family: 'Bodoni Moda', weights: [400, 500, 600, 700, 800, 900], group: 'display' },
  { family: 'Cinzel', weights: [400, 500, 600, 700, 800, 900], group: 'display' },
  { family: 'Anton SC', weights: [400], group: 'display' },
  { family: 'Rubik Mono One', weights: [400], group: 'display' },
  { family: 'Passion One', weights: [400, 700, 900], group: 'display' },

  // ── Texte courant ───────────────────────────────────────────────────
  { family: 'Inter', weights: [400, 500, 600, 700, 800, 900], group: 'text', cssVar: '--font-inter' },
  { family: 'Poppins', weights: [400, 500, 600, 700, 800, 900], group: 'text', cssVar: '--font-poppins' },
  { family: 'Space Grotesk', weights: [400, 500, 600, 700], group: 'text', cssVar: '--font-space' },
  { family: 'Roboto', weights: [400, 500, 700, 900], group: 'text' },
  { family: 'Lato', weights: [400, 700, 900], group: 'text' },
  { family: 'Open Sans', weights: [400, 500, 600, 700, 800], group: 'text' },
  { family: 'Montserrat', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Raleway', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Nunito', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Work Sans', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'DM Sans', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Manrope', weights: [400, 500, 600, 700, 800], group: 'text' },
  { family: 'Rubik', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Karla', weights: [400, 500, 600, 700, 800], group: 'text' },
  { family: 'Figtree', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Source Sans 3', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Merriweather', weights: [400, 700, 900], group: 'text' },
  { family: 'Lora', weights: [400, 500, 600, 700], group: 'text' },
  { family: 'Roboto Condensed', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Barlow', weights: [400, 500, 600, 700, 800, 900], group: 'text' },

  // ── Scriptes / manuscrites ──────────────────────────────────────────
  { family: 'Pacifico', weights: [400], group: 'script' },
  { family: 'Dancing Script', weights: [400, 500, 600, 700], group: 'script' },
  { family: 'Caveat', weights: [400, 500, 600, 700], group: 'script' },
  { family: 'Permanent Marker', weights: [400], group: 'script' },
  { family: 'Satisfy', weights: [400], group: 'script' },
  { family: 'Great Vibes', weights: [400], group: 'script' },
  { family: 'Lobster', weights: [400], group: 'script' },
  { family: 'Sacramento', weights: [400], group: 'script' },
  { family: 'Shadows Into Light', weights: [400], group: 'script' },
  { family: 'Indie Flower', weights: [400], group: 'script' },
  { family: 'Kalam', weights: [300, 400, 700], group: 'script' },
  { family: 'Courgette', weights: [400], group: 'script' },
];

const BY_FAMILY = new Map(FONT_CATALOG.map((f) => [f.family, f]));

export function findFont(family: string | undefined | null): FontDef | undefined {
  return family ? BY_FAMILY.get(family) : undefined;
}

/** Le selecteur, groupe par usage — memes donnees, autre forme. */
export const FONT_GROUPS: Array<{ group: FontGroup; label: string; fonts: string[] }> = (
  ['display', 'text', 'script'] as FontGroup[]
).map((group) => ({
  group,
  label: FONT_GROUP_LABELS[group],
  fonts: FONT_CATALOG.filter((f) => f.group === group).map((f) => f.family),
}));

/**
 * Pile CSS d'une famille.
 *
 * La variable `next/font` en tete quand elle existe : ces six familles sont
 * deja dans la page, elles s'affichent sans le moindre telechargement. Le nom
 * brut ensuite — c'est sous ce nom que la feuille Google Fonts injectee
 * enregistre la famille, et c'est aussi le seul nom que `ctx.font` comprend
 * cote canvas.
 */
export function fontStack(family: string): string {
  const def = findFont(family);
  const quoted = `'${family}'`;
  return def?.cssVar ? `var(${def.cssVar}), ${quoted}, sans-serif` : `${quoted}, sans-serif`;
}

/**
 * URL de la feuille Google Fonts d'une famille, avec SES graisses.
 *
 * L'API tolere les graisses surnumeraires — elle les rabat sur les plus
 * proches — et ne repond 400 que si AUCUNE des graisses demandees n'existe.
 * Ne demander que les graisses publiees allege donc la feuille et permet de
 * verifier le chargement sur les bonnes, sans etre en soi un correctif.
 */
export function googleFontsUrl(family: string, weights: number[]): string {
  const name = family.trim().replace(/\s+/g, '+');
  const list = [...new Set(weights)].sort((a, b) => a - b).join(';');
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${list}&display=swap`;
}

/**
 * Déclarations CSS des variables de police, pour un moteur qui n'a PAS
 * `next/font`.
 *
 * ⚠️ Sans elles, `fontStack()` ne rend rien du tout côté serveur — et c'est
 * bien pire qu'une police manquante.
 *
 * `fontStack('Anton')` produit `var(--font-anton), 'Anton', sans-serif`. Or
 * une variable CSS **indéfinie** rend la déclaration entière invalide au
 * moment du calcul : le navigateur n'essaie même pas le repli `'Anton'`, il
 * retombe sur `sans-serif`. Vérifié dans Chromium — `getComputedStyle` rend
 * `sans-serif`, et `'Anton'` a disparu.
 *
 * Charger la police n'aurait donc servi à rien : la famille n'atteignait
 * jamais le moteur de rendu. Définir les variables est la première moitié du
 * correctif ; charger les fichiers est la seconde.
 *
 * Rendre ces variables ici — et non dans la composition — garde `fontStack()`
 * comme source unique : la même pile CSS fonctionne verbatim des deux côtés.
 */
export function fontVariablesCss(): string {
  const lignes = FONT_CATALOG
    .filter((f) => f.cssVar)
    .map((f) => `  ${f.cssVar}: '${f.family}';`);
  return `:root {\n${lignes.join('\n')}\n}`;
}

/**
 * Feuille Google Fonts couvrant PLUSIEURS familles en une requête.
 *
 * Une balise par famille multiplierait les allers-retours réseau au démarrage
 * de chaque rendu — et un rendu serveur en fait un par image jusqu'à ce que
 * les polices soient prêtes.
 *
 * Les familles inconnues du catalogue sont ignorées : demander une famille
 * inexistante fait répondre 400 à l'API, et la feuille entière échoue — donc
 * TOUTES les polices, pas seulement la fautive.
 */
export function googleFontsUrlMany(families: Array<string | undefined | null>): string | null {
  const defs = [...new Set(families.filter((f): f is string => !!f))]
    .map((f) => findFont(f))
    .filter((d): d is FontDef => !!d);
  if (defs.length === 0) return null;
  const parts = defs.map((d) => {
    const nom = d.family.trim().replace(/\s+/g, '+');
    const poids = [...new Set(d.weights)].sort((a, b) => a - b).join(';');
    return `family=${nom}:wght@${poids}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}
