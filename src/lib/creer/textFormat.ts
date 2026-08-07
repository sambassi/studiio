/**
 * Casse, alignement et décoration du texte — LE contrat partagé.
 *
 * ⚠️ CE MODULE EXISTE POUR QUE L'APERÇU NE MENTE PAS. Le dépôt a deux moteurs
 * de rendu : les composants React partagés (`SequenceTitle`, `SequenceCta`),
 * lus par l'aperçu ET par la composition Remotion, et le compositeur CANVAS
 * (`video-composer.ts`), qui produit l'export de « Créer simple ». Un même
 * réglage écrit deux fois — une en CSS, une en `ctx.fillText` — finit toujours
 * par diverger, et la divergence ne se voit qu'en comparant une vidéo livrée à
 * l'écran qui l'a produite. Les règles vivent donc ICI, en fonctions pures, et
 * les deux moteurs les appliquent.
 *
 * ⚠️ MODULE FEUILLE : aucune importation. Il est lu par le navigateur, par
 * Remotion sous Chromium et par les tests.
 *
 * ── CE QUI EST GARANTI, ET CE QUI NE L'EST PAS ─────────────────────────
 *
 * La CASSE et l'ALIGNEMENT sont identiques au caractère près : les deux
 * moteurs appellent la même fonction.
 *
 * Le SOULIGNÉ et le BARRÉ ne peuvent pas l'être au pixel près : CSS place son
 * trait sur une métrique de la police, le canvas n'a pas accès à cette
 * métrique et doit le tracer. Ce qui est garanti, c'est que les deux dérivent
 * leur épaisseur et leur décalage des MÊMES ratios ci-dessous — donc qu'ils
 * restent proportionnels et visuellement accordés à toute taille.
 */

export const TEXT_CASES = ['none', 'uppercase', 'lowercase'] as const;
export type TextCase = typeof TEXT_CASES[number];

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = typeof TEXT_ALIGNS[number];

/** Épaisseur du trait de décoration, en fraction de la taille de police. */
export const DECORATION_THICKNESS_RATIO = 0.06;

/** Décalage du souligné SOUS la ligne de base, en fraction de la taille. */
export const UNDERLINE_OFFSET_RATIO = 0.14;

/**
 * Hauteur du barré au-dessus de la ligne de base, en fraction de la taille.
 *
 * 0,3 et non 0,5 : le barré doit traverser la hauteur d'x, pas le milieu du
 * cadratin. À 0,5 il passait au-dessus des minuscules.
 */
export const STRIKE_OFFSET_RATIO = 0.3;

/**
 * La casse demandée, appliquée.
 *
 * ⚠️ `'none'` REND LE TEXTE INCHANGÉ, ET C'EST LE DÉFAUT DU CONTRAT — mais PAS
 * celui des appelants historiques. Le titre et le CTA sont en capitales depuis
 * toujours (`textTransform: 'uppercase'` en dur des deux côtés) : c'est à
 * l'appelant de passer `'uppercase'` tant que l'utilisateur n'a rien choisi,
 * pas à cette fonction de le deviner. Voir `DEFAULT_TEXT_CASE`.
 *
 * `toLocaleUpperCase` et non `toUpperCase` : en turc, le « i » majuscule est
 * « İ », et la version non localisée rendrait « I ».
 */
export function applyTextCase(text: string, casse: TextCase | undefined): string {
  if (casse === 'uppercase') return text.toLocaleUpperCase();
  if (casse === 'lowercase') return text.toLocaleLowerCase();
  return text;
}

/**
 * La casse, en valeur CSS `text-transform`.
 *
 * ⚠️ LE NAVIGATEUR TRANSFORME A L'AFFICHAGE, LE CANVAS DANS LA CHAINE. Les
 * deux aboutissent au meme trace : `text-transform` agit AVANT la mise en
 * lignes, donc le navigateur coupe sur les glyphes transformes — exactement
 * ce que fait `applyTextCase` avant `wrapText`.
 *
 * On garde donc le TEXTE INTACT dans le DOM : ce qui s'y trouve reste
 * selectionnable, lisible par un lecteur d'ecran et fidele a ce que
 * l'utilisateur a saisi. Transformer la chaine cote React n'aurait rien
 * apporte au rendu et aurait tout retire a l'accessibilite.
 */
export function cssTextTransform(casse: TextCase | undefined): 'none' | 'uppercase' | 'lowercase' {
  return casse ?? 'none';
}

/**
 * La casse historique du titre et du CTA.
 *
 * Elle vaut `'uppercase'` : les deux moteurs l'écrivaient en dur. Toute
 * configuration qui ne dit rien doit donc continuer à sortir en capitales.
 */
export const DEFAULT_TEXT_CASE: TextCase = 'uppercase';

/** Valeur reçue de la base ou de l'écran, ou le repli demandé. */
export function sanitizeTextCase(brut: unknown, parDefaut: TextCase = 'none'): TextCase {
  return TEXT_CASES.includes(brut as TextCase) ? (brut as TextCase) : parDefaut;
}

export function sanitizeTextAlign(brut: unknown, parDefaut: TextAlign = 'left'): TextAlign {
  return TEXT_ALIGNS.includes(brut as TextAlign) ? (brut as TextAlign) : parDefaut;
}

/**
 * La valeur `text-decoration` d'un couple souligné/barré, ou `undefined`.
 *
 * `undefined` et non `'none'` : une propriété absente laisse l'héritage CSS
 * tranquille, alors que `'none'` l'écrase. Sur un texte qui n'a rien demandé,
 * les deux se voient pareil — mais le premier ne touche à rien.
 */
export function cssTextDecoration(
  underline: boolean | undefined,
  strike: boolean | undefined,
): string | undefined {
  const traits: string[] = [];
  if (underline) traits.push('underline');
  if (strike) traits.push('line-through');
  return traits.length > 0 ? traits.join(' ') : undefined;
}

/** Un trait de décoration à tracer : sa position verticale et son épaisseur. */
export interface DecorationLine {
  /** Décalage vertical depuis la LIGNE DE BASE, vers le bas si positif. */
  offset: number;
  thickness: number;
}

/**
 * Les traits à tracer pour un texte, en pixels, à partir de la taille de police.
 *
 * Le compositeur canvas s'en sert pour dessiner ce que CSS pose tout seul.
 * Rendre une LISTE plutôt que deux valeurs : souligné et barré peuvent être
 * demandés ensemble, et l'appelant n'a alors qu'à boucler.
 */
export function decorationLines(
  fontSize: number,
  underline: boolean | undefined,
  strike: boolean | undefined,
): DecorationLine[] {
  const thickness = Math.max(1, fontSize * DECORATION_THICKNESS_RATIO);
  const out: DecorationLine[] = [];
  if (underline) out.push({ offset: fontSize * UNDERLINE_OFFSET_RATIO, thickness });
  if (strike) out.push({ offset: -fontSize * STRIKE_OFFSET_RATIO, thickness });
  return out;
}

/**
 * Abscisse du BORD GAUCHE d'un texte, selon son alignement.
 *
 * ⚠️ LE CANVAS ET CSS NE PARLENT PAS DE LA MÊME CHOSE. `ctx.textAlign` décale
 * le tracé autour d'un point d'ancrage ; CSS répartit le texte dans une boîte
 * de largeur connue. Pour tracer un trait de décoration il faut, dans les deux
 * cas, le bord gauche RÉEL — d'où cette conversion, écrite une fois.
 */
export function textLeftEdge(
  anchorX: number,
  textWidth: number,
  align: TextAlign,
): number {
  if (align === 'center') return anchorX - textWidth / 2;
  if (align === 'right') return anchorX - textWidth;
  return anchorX;
}
