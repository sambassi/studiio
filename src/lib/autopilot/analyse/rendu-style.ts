/**
 * LOT 2B ETAPE 2 — DU PROFIL CREATIF AUX FILTRES DU RENDU.
 *
 * ---------------------------------------------------------------------------
 * CE MODULE N'EST QU'UN TRADUCTEUR
 * ---------------------------------------------------------------------------
 *
 * Il recoit un profil DEJA normalise par `profil-creatif` — donc deja borne,
 * deja valide contre les catalogues — et rend des fragments de chaine de
 * filtres. Il ne decide rien, ne borne rien de sa propre initiative, et
 * n'ouvre aucun fichier. C'est la meme division du travail que
 * `rectangleCrop` : le calcul se fait ici, en TypeScript, ou il se teste sans
 * lancer ffmpeg.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE PROFIL N'A AUCUN DROIT SUR LE PLAN
 * ---------------------------------------------------------------------------
 *
 * `m3g-v2` decide quels passages sont retenus, dans quel ordre, et combien de
 * temps chacun dure. Rien ici ne touche a cela :
 *
 *   • les fragments par clip s'inserent DANS une branche existante, apres
 *     `fps=`, avant `format=` — ils ne changent ni `trim`, ni `crop`, ni
 *     `scale`, ni l'ordre du `concat` ;
 *   • aucun fragment ne modifie la duree d'une branche, donc la duree totale
 *     du montage est celle du plan, a la milliseconde pres. C'est vital :
 *     `resultatConforme` compare la duree MESUREE a `plan.dureeTotaleSecondes`
 *     et refuse le fichier en cas d'ecart ;
 *   • l'audio n'est jamais touche. Le graphe audio du Lot 2A traverse ce
 *     module sans une modification, donc aucune derive A/V n'est possible.
 *
 * C'est pourquoi une transition est ici un FONDU INTERNE A CHAQUE CLIP, et
 * non un `xfade`. Un `xfade` fait se chevaucher deux plans : il raccourcit le
 * montage de (n-1) x duree, ce qui reecrit le plan et fait echouer la mesure.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LOOK_PRESET N'EST PAS UNE LUT
 * ---------------------------------------------------------------------------
 *
 * `LUTS_AUTORISEES` porte `ressourceServeur: null` pour ses cinq entrees :
 * AUCUN fichier `.cube` n'est livre a ce jour. Charger `lut3d` demanderait un
 * fichier qui n'existe pas, et le fabriquer ici serait inventer une table de
 * correspondance en la faisant passer pour un etalonnage.
 *
 * Ce module rend donc un LOOK_PRESET : une correction deterministe et bornee
 * (`eq` + `colorbalance`) dont les constantes sont ecrites ci-dessous et
 * lisibles. Le jour ou un `.cube` valide sera livre, `ressourceServeur`
 * cessera d'etre `null` et `filtreLook` prefererera `lut3d` — le contrat, les
 * identifiants et l'empreinte de rendu n'auront pas a bouger. La difference
 * doit rester dite : un LOOK_PRESET approche une intention colorimetrique,
 * une LUT_FILE la reproduit.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUN TEXTE, AUCUNE POLICE
 * ---------------------------------------------------------------------------
 *
 * Les 52 familles de `POLICES_AUTORISEES` ont `licence: null` et
 * `ressourceServeur: null`. Brancher `drawtext` supposerait un fichier de
 * fonte choisi au hasard sur la machine, et sa redistribution dans un MP4
 * publie. Tant que la licence n'est pas etablie, ce module n'emet AUCUN
 * `drawtext` — le CTA visuel se limite a sa forme graphique.
 */
import {
  type ProfilCreatifAutopilote, type AncreTexte, type PositionLogo,
} from './profil-creatif';

// ---------------------------------------------------------------------------
// Le contexte que le moteur fournit
// ---------------------------------------------------------------------------

/** Un clip du plan, vu par le style : sa seule duree. */
export interface ClipStyle {
  dureeSecondes: number;
}

/** Le logo, DEJA descendu et DEJA sonde par le moteur. */
export interface LogoLocal {
  chemin: string;
  largeur: number;
  hauteur: number;
}

export interface CibleStyle {
  largeur: number;
  hauteur: number;
}

export interface ContexteStyle {
  cible: CibleStyle;
  clips: readonly ClipStyle[];
  dureeTotaleSecondes: number;
  /** `null` quand aucun logo n'est configure, ou qu'il a ete refuse. */
  logo: LogoLocal | null;
  /**
   * L'indice de la PREMIERE entree ffmpeg que ce module peut ajouter.
   *
   * ⚠️ FOURNI PAR LE MOTEUR, JAMAIS DEDUIT DU NOMBRE DE CLIPS. La musique du
   * Lot 2A occupe deja l'indice qui suit les clips : le deduire ici ferait
   * lire la musique comme logo des qu'une musique est presente — une
   * incrustation qui prend l'entree du voisin ne leve aucune erreur, elle
   * affiche simplement le mauvais flux.
   */
  indicePremiereEntree: number;
}

/**
 * Ce que le moteur injecte dans son graphe.
 *
 * `fragmentsParClip[i]` s'insere dans la branche du clip `i`. `post` va de
 * `[vconcat]` a `[vout]` ; vide, le `concat` ecrit directement `[vout]` et le
 * graphe est celui d'avant ce lot, au caractere pres.
 */
export interface StyleRendu {
  fragmentsParClip: readonly string[];
  entrees: readonly string[];
  post: string;
  /**
   * Transitions du catalogue que ce lot ne rend pas encore. Elles sont
   * acceptees par le contrat et rendues comme `cut` — jamais silencieusement :
   * cette liste remonte au moteur, qui la trace dans `usage`.
   */
  transitionsNonRendues: readonly string[];
}

/** Le style qui ne fait rien : le graphe historique, au caractere pres. */
export const STYLE_NEUTRE: StyleRendu = Object.freeze({
  fragmentsParClip: Object.freeze([]) as readonly string[],
  entrees: Object.freeze([]) as readonly string[],
  post: '',
  transitionsNonRendues: Object.freeze([]) as readonly string[],
});

// ---------------------------------------------------------------------------
// LOOK_PRESET — les constantes, ecrites et lisibles
// ---------------------------------------------------------------------------

/**
 * Un look, a intensite 1.
 *
 * `contraste` et `saturation` sont MULTIPLICATIFS (neutre = 1) ; `luminosite`
 * et les termes de `colorbalance` sont ADDITIFS (neutre = 0). C'est cette
 * distinction qui permet de melanger vers le neutre sans cas particulier.
 */
export interface LookPreset {
  contraste: number;
  saturation: number;
  luminosite: number;
  /** Tons moyens puis hautes lumieres, en rouge et bleu. Plage -1..1. */
  rm: number; bm: number; rh: number; bh: number;
}

const LOOK_NEUTRE: LookPreset = {
  contraste: 1, saturation: 1, luminosite: 0, rm: 0, bm: 0, rh: 0, bh: 0,
};

/**
 * ⚠️ `neutral` EST L'IDENTITE, PAS UN LOOK DOUX. Un `neutral` qui corrigerait
 * « juste un peu » ferait mentir son nom et, pire, rendrait impossible de
 * revenir a l'image du rush.
 */
export const LOOKS_RENDUS: Readonly<Record<string, LookPreset>> = Object.freeze({
  neutral: LOOK_NEUTRE,
  clean: { contraste: 1.06, saturation: 0.97, luminosite: 0.012, rm: 0, bm: 0, rh: 0, bh: 0 },
  vibrant: { contraste: 1.10, saturation: 1.30, luminosite: 0, rm: 0, bm: 0, rh: 0, bh: 0 },
  'cinema-warm': {
    contraste: 1.14, saturation: 1.04, luminosite: 0,
    rm: 0.10, bm: -0.08, rh: 0.06, bh: -0.05,
  },
  'cinema-cool': {
    contraste: 1.12, saturation: 0.96, luminosite: 0,
    rm: -0.08, bm: 0.12, rh: -0.04, bh: 0.08,
  },
});

/** Trois decimales : assez fin pour l'oeil, assez court pour un graphe lisible. */
const DECIMALES_FILTRE = 3;

function nb(v: number): string {
  const r = Number(v.toFixed(DECIMALES_FILTRE));
  return (Object.is(r, -0) ? 0 : r).toFixed(DECIMALES_FILTRE);
}

/** Un parametre multiplicatif ramene vers 1 par l'intensite. */
function melangeMul(v: number, intensite: number): number {
  return 1 + (v - 1) * intensite;
}

/** Un parametre additif ramene vers 0 par l'intensite. */
function melangeAdd(v: number, intensite: number): number {
  return v * intensite;
}

/** Un nombre est-il assez proche de sa valeur neutre pour ne rien ecrire ? */
function estNeutre(v: number, neutre: number): boolean {
  return Math.abs(v - neutre) < 5e-4;
}

/**
 * Le fragment colorimetrique, ou `''`.
 *
 * `''` DES QUE LE RESULTAT EST L'IDENTITE : look inactif, look `neutral`,
 * intensite nulle, ou preset inconnu. Un `eq` a valeurs neutres couterait un
 * passage de filtre pour ne rien changer, et surtout ferait diverger le
 * graphe du graphe historique sans raison visible.
 */
export function filtreLook(profil: ProfilCreatifAutopilote): string {
  const { active, lutId, intensite } = profil.lut;
  if (!active || lutId === null || intensite <= 0) return '';
  const base = LOOKS_RENDUS[lutId];
  if (base === undefined) return '';

  const contraste = melangeMul(base.contraste, intensite);
  const saturation = melangeMul(base.saturation, intensite);
  const luminosite = melangeAdd(base.luminosite, intensite);
  const rm = melangeAdd(base.rm, intensite);
  const bm = melangeAdd(base.bm, intensite);
  const rh = melangeAdd(base.rh, intensite);
  const bh = melangeAdd(base.bh, intensite);

  const morceaux: string[] = [];
  const eq: string[] = [];
  if (!estNeutre(contraste, 1)) eq.push(`contrast=${nb(contraste)}`);
  if (!estNeutre(saturation, 1)) eq.push(`saturation=${nb(saturation)}`);
  if (!estNeutre(luminosite, 0)) eq.push(`brightness=${nb(luminosite)}`);
  if (eq.length > 0) morceaux.push(`eq=${eq.join(':')}`);

  const cb: string[] = [];
  if (!estNeutre(rm, 0)) cb.push(`rm=${nb(rm)}`);
  if (!estNeutre(bm, 0)) cb.push(`bm=${nb(bm)}`);
  if (!estNeutre(rh, 0)) cb.push(`rh=${nb(rh)}`);
  if (!estNeutre(bh, 0)) cb.push(`bh=${nb(bh)}`);
  if (cb.length > 0) morceaux.push(`colorbalance=${cb.join(':')}`);

  return morceaux.join(',');
}

// ---------------------------------------------------------------------------
// Transitions — a duree constante, sans exception
// ---------------------------------------------------------------------------

/**
 * Les transitions que ce lot sait rendre SANS toucher a la duree.
 *
 * Un fondu au noir (`crossfade`) ou au blanc (`flash`) s'applique a
 * l'interieur d'un clip : la coupe reste ou `m3g-v2` l'a mise, la branche
 * garde sa duree, le `concat` reste identique.
 *
 * ⚠️ CE N'EST PAS UN FONDU ENCHAINE OPTIQUE. `crossfade` fait ici disparaitre
 * la fin d'un plan puis apparaitre le debut du suivant ; un vrai
 * chevauchement des deux images demanderait `xfade`, donc un montage plus
 * court que son plan. Le nom vient du catalogue, la mise en oeuvre est dite
 * ici pour que personne ne croie a un chevauchement.
 */
export const TRANSITIONS_RENDUES = ['cut', 'crossfade', 'flash'] as const;

/**
 * Celles du catalogue qui exigeraient deux flux simultanes (`slide`, `whip`,
 * `zoom`) ou un parametre variable dans le temps (`blur`). Elles restent
 * acceptees par le contrat et sont rendues comme `cut` — le rendu est alors
 * exactement celui d'avant, jamais un effet approximatif non demande.
 */
export const TRANSITIONS_NON_RENDUES = ['zoom', 'slide', 'whip', 'blur'] as const;

/** La couleur du fondu, par transition. */
const COULEUR_FONDU: Readonly<Record<string, string>> = Object.freeze({
  crossfade: 'black',
  flash: 'white',
});

/**
 * La duree d'un fondu, en secondes, BORNEE PAR LE CLIP.
 *
 * ⚠️ JAMAIS PLUS DE LA MOITIE DU CLIP. Deux fondus de 0,3 s sur un plan de
 * 0,4 s se recouvriraient : l'image serait noire d'un bout a l'autre, et le
 * plan retenu par `m3g-v2` aurait disparu de l'ecran sans disparaitre du
 * montage.
 */
export function dureeFondu(dureeMs: number, dureeClipSecondes: number): number {
  const demande = Math.max(0, dureeMs) / 1000;
  const plafond = Math.max(0, dureeClipSecondes) / 2;
  return Math.min(demande, plafond);
}

/**
 * Le fragment de transition du clip `indice`, ou `''`.
 *
 * Le premier clip n'a pas de fondu d'entree et le dernier pas de fondu de
 * sortie : le montage ne commence ni ne finit sur du noir que personne n'a
 * demande. Les fondus ne vivent qu'AUX JONCTIONS.
 */
export function filtreTransition(
  profil: ProfilCreatifAutopilote,
  indice: number, total: number, dureeClipSecondes: number,
): string {
  const t = profil.transitions;
  if (!t.active) return '';
  const couleur = COULEUR_FONDU[t.transitionId];
  if (couleur === undefined) return '';
  const d = dureeFondu(t.dureeMs, dureeClipSecondes);
  if (d <= 0) return '';

  const morceaux: string[] = [];
  if (indice > 0) {
    morceaux.push(`fade=t=in:st=0:d=${nb(d)}:color=${couleur}`);
  }
  if (indice < total - 1) {
    const depart = Math.max(0, dureeClipSecondes - d);
    morceaux.push(`fade=t=out:st=${nb(depart)}:d=${nb(d)}:color=${couleur}`);
  }
  return morceaux.join(',');
}

// ---------------------------------------------------------------------------
// Geometrie — calculee ici, jamais par une expression ffmpeg
// ---------------------------------------------------------------------------

/** Au pair le plus proche, borne par le bas : `yuv420p` refuse l'impair. */
function pair(v: number, minimum = 2): number {
  const n = Math.round(v / 2) * 2;
  return Math.max(minimum, n);
}

function borner(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, v));
}

export interface Rectangle {
  x: number; y: number; largeur: number; hauteur: number;
}

/** Les marges sures, en pixels entiers. */
export function margesPixels(
  profil: ProfilCreatifAutopilote, cible: CibleStyle,
): { haut: number; bas: number; gauche: number; droite: number } {
  const m = profil.margesSures;
  return {
    haut: Math.round(cible.hauteur * m.hautPct / 100),
    bas: Math.round(cible.hauteur * m.basPct / 100),
    gauche: Math.round(cible.largeur * m.gauchePct / 100),
    droite: Math.round(cible.largeur * m.droitePct / 100),
  };
}

/**
 * Le rectangle du logo, en pixels entiers, DANS le cadre.
 *
 * La hauteur derive du rapport de l'image SONDEE : sans elle, une position
 * « bas » devrait s'ecrire `H-h-marge` et laisser ffmpeg calculer `h`. Le
 * depot a deja tranche cette question pour `crop` — le calcul se fait ici,
 * ou un test le verifie sans lancer un encodeur.
 */
export function rectangleLogo(
  profil: ProfilCreatifAutopilote, cible: CibleStyle, logo: LogoLocal,
): Rectangle {
  const marges = margesPixels(profil, cible);
  const largeurUtile = Math.max(2, cible.largeur - marges.gauche - marges.droite);
  const hauteurUtile = Math.max(2, cible.hauteur - marges.haut - marges.bas);

  let largeur = pair(cible.largeur * profil.marque.taillePct / 100);
  largeur = Math.min(largeur, pair(largeurUtile));
  const rapport = logo.largeur > 0 ? logo.hauteur / logo.largeur : 1;
  let hauteur = pair(largeur * rapport);
  if (hauteur > hauteurUtile) {
    hauteur = pair(hauteurUtile);
    largeur = pair(rapport > 0 ? hauteur / rapport : largeur);
  }

  const position: PositionLogo = profil.marque.position;
  const gauche = marges.gauche;
  const droite = cible.largeur - marges.droite - largeur;
  const haut = marges.haut;
  const bas = cible.hauteur - marges.bas - hauteur;
  const centreX = Math.round((cible.largeur - largeur) / 2);
  const centreY = Math.round((cible.hauteur - hauteur) / 2);

  let x = gauche;
  let y = haut;
  if (position === 'haut-droite') { x = droite; y = haut; }
  else if (position === 'bas-gauche') { x = gauche; y = bas; }
  else if (position === 'bas-droite') { x = droite; y = bas; }
  else if (position === 'centre') { x = centreX; y = centreY; }

  return {
    largeur, hauteur,
    x: borner(Math.round(x), 0, Math.max(0, cible.largeur - largeur)),
    y: borner(Math.round(y), 0, Math.max(0, cible.hauteur - hauteur)),
  };
}

/** La hauteur du bandeau de CTA, en part de la hauteur du cadre. */
export const CTA_HAUTEUR_PCT = 12;

/** Le rectangle du CTA visuel, ancre par `ctaVisuel.position`. */
export function rectangleCta(
  profil: ProfilCreatifAutopilote, cible: CibleStyle,
): Rectangle {
  const marges = margesPixels(profil, cible);
  const largeur = Math.max(2, cible.largeur - marges.gauche - marges.droite);
  const hauteurUtile = Math.max(2, cible.hauteur - marges.haut - marges.bas);
  const hauteur = Math.max(2, Math.min(
    hauteurUtile, Math.round(cible.hauteur * CTA_HAUTEUR_PCT / 100),
  ));
  const ancre: AncreTexte = profil.ctaVisuel.position;
  let y = cible.hauteur - marges.bas - hauteur;
  if (ancre === 'haut') y = marges.haut;
  else if (ancre === 'centre') y = Math.round((cible.hauteur - hauteur) / 2);
  return {
    largeur, hauteur,
    x: borner(marges.gauche, 0, Math.max(0, cible.largeur - largeur)),
    y: borner(Math.round(y), 0, Math.max(0, cible.hauteur - hauteur)),
  };
}

// ---------------------------------------------------------------------------
// Couleurs
// ---------------------------------------------------------------------------

/**
 * Une couleur acceptable pour ffmpeg, ou `null`.
 *
 * ⚠️ RE-VERIFIEE ICI, MEME APRES `normaliserHex`. Ce module ecrit dans une
 * chaine de filtres ou `:` separe les options et `,` les filtres : une valeur
 * qui traverserait la normalisation par une voie future — un profil relu d'un
 * `jsonb` sans repasser par le lecteur — pourrait ajouter une option, voire
 * un filtre. La verification est ici parce que c'est ici que le risque existe.
 */
export function couleurFfmpeg(v: string | null): string | null {
  if (typeof v !== 'string') return null;
  return /^#[0-9A-F]{6}$/.test(v) ? v : null;
}

/** La couleur du CTA : accent, puis primaire. Aucune couleur inventee. */
export function couleurCta(profil: ProfilCreatifAutopilote): string | null {
  return couleurFfmpeg(profil.couleurs.accent)
    ?? couleurFfmpeg(profil.couleurs.primaire);
}

// ---------------------------------------------------------------------------
// L'assemblage
// ---------------------------------------------------------------------------

/**
 * Traduit le profil EFFECTIF en fragments de graphe.
 *
 * Rend `STYLE_NEUTRE` — donc le graphe d'avant ce lot, au caractere pres —
 * des que rien de rendable n'est demande. Un profil qui ne porte que de la
 * typographie tombe dans ce cas : son empreinte de rendu differe (le style a
 * ete choisi), son graphe non (rien n'est encore rendable). C'est un rendu
 * recalcule pour rien, jamais un rendu faux.
 */
export function construireStyle(
  profil: ProfilCreatifAutopilote | null | undefined,
  ctx: ContexteStyle,
): StyleRendu {
  if (!profil) return STYLE_NEUTRE;

  const look = filtreLook(profil);
  const total = ctx.clips.length;
  const fragments = ctx.clips.map((c, i) => {
    const transition = filtreTransition(profil, i, total, c.dureeSecondes);
    return [look, transition].filter((f) => f.length > 0).join(',');
  });

  const transitionsNonRendues: string[] = [];
  if (profil.transitions.active
    && (TRANSITIONS_NON_RENDUES as readonly string[]).includes(profil.transitions.transitionId)) {
    transitionsNonRendues.push(profil.transitions.transitionId);
  }

  // ── Le post-traitement, applique une fois sur le montage assemble ──────
  const entrees: string[] = [];
  const etapes: string[] = [];
  let courant = '[vconcat]';
  let indiceEntree = ctx.indicePremiereEntree;

  if (profil.marque.logoActif && ctx.logo !== null) {
    const r = rectangleLogo(profil, ctx.cible, ctx.logo);
    // `-f image2` ferme la detection de demuxeur comme `-f mp4` le fait pour
    // les sources : un fichier maquille ne peut pas se faire passer pour
    // autre chose. Le chemin est LOCAL et fabrique par le moteur.
    entrees.push('-f', 'image2', '-i', ctx.logo.chemin);
    const opacite = nb(profil.marque.opacite);
    etapes.push(
      `[${indiceEntree}:v]format=rgba,scale=${r.largeur}:${r.hauteur},`
      + `colorchannelmixer=aa=${opacite}[stylelogo]`,
    );
    // `eof_action=repeat` : l'image n'a qu'une trame, elle doit tenir tout le
    // film. Sans cela l'incrustation disparaitrait apres la premiere image.
    etapes.push(
      `${courant}[stylelogo]overlay=x=${r.x}:y=${r.y}:`
      + `eof_action=repeat:format=auto[styleap${indiceEntree}]`,
    );
    courant = `[styleap${indiceEntree}]`;
    indiceEntree += 1;
  }

  const teinte = couleurCta(profil);
  if (profil.ctaVisuel.actif && teinte !== null) {
    const r = rectangleCta(profil, ctx.cible);
    const duree = Math.min(profil.ctaVisuel.dureeSecondes, ctx.dureeTotaleSecondes);
    const depart = Math.max(0, ctx.dureeTotaleSecondes - duree);
    // `enable` ne porte que des nombres calcules par le serveur — la meme
    // discipline que `afade=t=out:st=...` du Lot 2A.
    etapes.push(
      `${courant}drawbox=x=${r.x}:y=${r.y}:w=${r.largeur}:h=${r.hauteur}:`
      + `color=${teinte}@1:t=fill:enable='gte(t\\,${nb(depart)})'[stylecta]`,
    );
    courant = '[stylecta]';
  }

  if (etapes.length === 0) {
    return {
      fragmentsParClip: fragments,
      entrees: [],
      post: '',
      transitionsNonRendues,
    };
  }

  // La derniere etape doit ecrire `[vout]` : c'est ce que `-map` attend.
  const dernier = etapes.length - 1;
  etapes[dernier] = etapes[dernier].replace(new RegExp(`${escapeRegExp(courant)}$`), '[vout]');

  return {
    fragmentsParClip: fragments,
    entrees,
    post: etapes.join(';'),
    transitionsNonRendues,
  };
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Le style demande-t-il quoi que ce soit au graphe ? */
export function styleModifieLeGraphe(style: StyleRendu): boolean {
  return style.post.length > 0
    || style.fragmentsParClip.some((f) => f.length > 0);
}
