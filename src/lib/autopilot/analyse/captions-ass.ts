/**
 * A_4b — LE DOCUMENT ASS DES SOUS-TITRES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA MÊME FONDATION QU'A_3c2, PAS UN SECOND MOTEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'échappement, l'ordre des octets d'une couleur, le format de temps et le
 * filtre `subtitles` viennent des modules d'A_3c2 — ils sont importés, pas
 * réécrits. Deux implémentations de l'échappement ASS finiraient par
 * diverger, et c'est exactement la moitié qu'on n'aurait pas corrigée qui
 * laisserait passer une injection.
 *
 * ⚠️ MAIS LE CONTENU MÉTIER EST SÉPARÉ. Les textes de marque disent ce que
 * l'écran a écrit ; les sous-titres disent ce qui a été prononcé. Deux
 * documents, deux filtres, deux durées de vie — et aucun risque qu'un
 * réglage de hook déplace un sous-titre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE KARAOKÉ EST RÉEL, ET IL A ÉTÉ MESURÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `\kf` remplit chaque mot pendant qu'il est dit. Mesuré sur le binaire, sur
 * « BOUGE AVEC NOUS » : à 0,4 s le premier mot est à moitié rempli (1193
 * pixels d'accent contre 1241 de base), à 1,4 s il l'est entièrement et le
 * deuxième est à moitié, à 2,6 s le troisième est aux deux tiers. Monotone,
 * sans exception.
 *
 * MODULE PUR : il fabrique le texte du document, il ne l'écrit pas.
 */
import { echapperAss, couleurAss } from '@/lib/creatif/animations-contenu';
import { tempsAss, POLICE_ASS } from './rendu-ass';
import type { StyleCaption, PositionCaption } from '@/lib/creatif/captions';
import {
  decouperEnBlocs, texteBloc, couperEnLignes, type BlocCaption,
} from './captions-segmentation';
import type { MotMonte } from './captions-timeline';

/**
 * ⚠️ LA LARGEUR UTILE, EN CARACTÈRES, PAR TAILLE DE POLICE.
 *
 * Mesurer la police demanderait de la charger ; l'approximation classique
 * — un caractère occupe environ la moitié de la hauteur du corps — suffit
 * ici, parce qu'elle ne sert qu'à choisir OÙ couper en deux lignes. Une
 * erreur d'un caractère décale une coupure, elle ne fait rien déborder :
 * `WrapStyle: 2` laisse libass replier ce qui dépasse malgré tout.
 */
export function caracteresParLigne(largeurCadre: number, taillePx: number): number {
  const largeurGlyphe = Math.max(1, taillePx * 0.5);
  return Math.max(8, Math.floor((largeurCadre * 0.86) / largeurGlyphe));
}

/** Où le bloc se pose, en part de la hauteur du cadre. */
const PART_Y: Record<PositionCaption, number> = {
  haut: 0.16,
  centre: 0.5,
  'centre-bas': 0.74,
  bas: 0.87,
};

export interface CadreCaption {
  largeur: number;
  hauteur: number;
  /** Les marges sûres du profil, en part de la hauteur. */
  margeHautPct: number;
  margeBasPct: number;
}

export interface CouleursCaption {
  texte: string;
  accent: string;
}

const TEINTE_ASS = { noir: '&H000000&', blanc: '&HFFFFFF&' } as const;

function couleurAlphaAss(hex: string, opacite: number): string {
  const a = Math.round((1 - Math.min(1, Math.max(0, opacite))) * 255);
  const base = couleurAss(hex).replace(/^&H|&$/g, '');
  return `&H${a.toString(16).toUpperCase().padStart(2, '0')}${base}`;
}

/**
 * La hauteur du centre du bloc, bornée par les marges sûres.
 *
 * ⚠️ LES PLATEFORMES POSENT LEURS BOUTONS EN BAS ET LEUR NAVIGATION EN HAUT.
 * Un sous-titre calé au ras du bord disparaît sous une légende. Les marges du
 * profil sont donc respectées — sans coder en dur une plateforme, qui
 * changerait sans nous prévenir.
 */
export function yCaption(
  cadre: CadreCaption, position: PositionCaption, hauteurBloc: number,
): number {
  const haut = (cadre.margeHautPct / 100) * cadre.hauteur + hauteurBloc / 2;
  const bas = cadre.hauteur - (cadre.margeBasPct / 100) * cadre.hauteur - hauteurBloc / 2;
  const vise = PART_Y[position] * cadre.hauteur;
  return Math.round(Math.min(Math.max(vise, haut), Math.max(haut, bas)));
}

/** Ce qu'on écrit devant le texte pour l'apparition du bloc. */
function balisesApparition(style: StyleCaption, dureeMs: number): string {
  switch (style.apparition) {
    case 'fondu':
      return `{\\fad(${Math.min(220, dureeMs)},0)}`;
    case 'pop':
      // ⚠️ UNE SEULE PULSATION, TRÈS COURTE. Un rebond de sous-titre à chaque
      // bloc rend une vidéo de trente secondes épuisante à lire.
      return '{\\fscx88\\fscy88\\t(0,110,\\fscx100\\fscy100)}';
    case 'montee':
      // `\move` déplace le bloc de quelques pixels : la lecture ne bouge que
      // le temps de l'arrivée.
      return '';
    default:
      return '';
  }
}

/**
 * Le corps d'un bloc — le texte, avec ses balises de mise en valeur.
 *
 * Exportée pour être testée : c'est ici que le mot actif et le karaoké se
 * décident, et une relecture ne vaut pas une mesure.
 */
export function corpsBloc(
  bloc: BlocCaption, style: StyleCaption, couleurs: CouleursCaption,
  indiceActif: number, lignes: readonly string[],
): string {
  const accent = couleurAss(couleurs.accent);
  const normal = couleurAss(couleurs.texte);

  if (style.surbrillance === 'karaoke') {
    /* ⚠️ `\kf` PREND DES CENTIÈMES, ET IL REMPLIT DANS L'ORDRE DES MOTS.
       La durée de chaque mot est celle que la transcription a mesurée : on ne
       répartit pas uniformément quand le vrai minutage existe. */
    return bloc.mots.map((m, i) => {
      const cs = Math.max(1, Math.round((m.finSecondes - m.debutSecondes) * 100));
      const texte = echapperAss(
        style.casse === 'majuscules' ? m.texte.toLocaleUpperCase('fr') : m.texte,
      );
      return `{\\kf${cs}}${texte}${i < bloc.mots.length - 1 ? ' ' : ''}`;
    }).join('');
  }

  if (style.surbrillance === 'aucune') {
    return lignes.map((l) => echapperAss(l)).join('\\N');
  }

  /* ── MOT ACTIF ──────────────────────────────────────────────────────
     ⚠️ LE BLOC ENTIER RESTE LISIBLE, ET C'EST TOUT L'INTÉRÊT. Le lecteur voit
     ce qui vient ; seule l'intensité se déplace. N'afficher que le mot dit
     obligerait à deviner la phrase. */
  const morceaux: string[] = [];
  bloc.mots.forEach((m, i) => {
    const texte = echapperAss(
      style.casse === 'majuscules' ? m.texte.toLocaleUpperCase('fr') : m.texte,
    );
    if (i === indiceActif) {
      morceaux.push(style.surbrillance === 'mot-actif-fond'
        // Un pavé d'accent DERRIÈRE le mot : `\3c` peint le contour, qui fait
        // office de fond quand il est assez épais.
        ? `{\\c${normal}\\3c${accent}\\bord6}${texte}{\\r}`
        : `{\\c${accent}}${texte}{\\c${normal}}`);
    } else {
      morceaux.push(texte);
    }
    if (i < bloc.mots.length - 1) morceaux.push(' ');
  });
  return morceaux.join('');
}

export interface DocumentCaptions {
  contenu: string;
  blocs: number;
}

/**
 * Le document complet des sous-titres.
 *
 * Rend `null` quand il n'y a rien à dire : un fichier vide ferait échouer
 * `subtitles`, et un sous-titre vide n'a rien à faire à l'écran.
 */
export function documentCaptions(
  mots: readonly MotMonte[], style: StyleCaption,
  cadre: CadreCaption, couleurs: CouleursCaption,
): DocumentCaptions | null {
  const blocs = decouperEnBlocs(mots, style.motsParBloc);
  if (blocs.length === 0) return null;

  const taillePx = Math.max(10, Math.round((cadre.hauteur * style.taillePct) / 100));
  const parLigne = caracteresParLigne(cadre.largeur, taillePx);
  const h = style.habillage;
  const boite = h.fond !== null;
  const contour = boite
    ? Math.max(1, Math.round(h.fond!.marge))
    : Math.max(0, Math.round(h.contour?.largeur ?? 0));
  const couleurContour = boite
    ? couleurAlphaAss(h.fond!.teinte === 'noir' ? '#000000' : '#ffffff', h.fond!.opacite)
    : TEINTE_ASS[h.contour?.teinte ?? 'noir'];
  const ombre = boite ? 0 : Math.max(0, Math.round(h.ombre?.decalage ?? 0));
  const couleurOmbre = couleurAlphaAss(
    (h.ombre?.teinte ?? 'noir') === 'noir' ? '#000000' : '#ffffff', h.ombre?.opacite ?? 0,
  );

  const lignes: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    // `2` : libass replie tout seul ce qui déborderait malgré notre découpe.
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${Math.round(cadre.largeur)}`,
    `PlayResY: ${Math.round(cadre.hauteur)}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,'
      + ' OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,'
      + ' ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,'
      + ' Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: C0', POLICE_ASS[style.police], String(taillePx),
      /* ⚠️ EN KARAOKÉ, `PrimaryColour` EST LA COULEUR *DÉJÀ DITE*, et
         `SecondaryColour` celle qui attend. C'est l'inverse de l'intuition,
         et l'inverser rendrait un remplissage à contresens. */
      style.surbrillance === 'karaoke' ? couleurAss(couleurs.accent) : couleurAss(couleurs.texte),
      couleurAss(couleurs.texte),
      couleurContour, couleurOmbre,
      style.graisse === 'grasse' ? '-1' : '0', '0', '0', '0',
      '100', '100', '0', '0',
      boite ? '3' : '1', String(contour), String(ombre),
      // 5 = centré dans les deux sens : `\pos` désigne le CENTRE du bloc.
      '5', '0', '0', '0', '1',
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const x = Math.round(cadre.largeur / 2);

  for (const bloc of blocs) {
    const texte = texteBloc(bloc, style.casse);
    const deuxLignes = couperEnLignes(texte, style.lignesMax, parLigne);
    const hauteurBloc = Math.round(taillePx * 1.25 * deuxLignes.length);
    const y = yCaption(cadre, style.position, hauteurBloc);
    const pos = `{\\pos(${x},${y})}`;

    if (style.surbrillance === 'mot-actif' || style.surbrillance === 'mot-actif-fond') {
      /* ⚠️ UN ÉVÉNEMENT PAR MOT, ET LE BLOC ENTIER À CHAQUE FOIS. La mise en
         page est celle du texte final dès la première image : c'est la même
         règle qu'A_3c2, et sans elle le bloc se recentre à chaque mot. */
      bloc.mots.forEach((m, i) => {
        const debut = i === 0 ? bloc.debutSecondes : m.debutSecondes;
        const fin = i === bloc.mots.length - 1 ? bloc.finSecondes : bloc.mots[i + 1].debutSecondes;
        if (!(fin > debut)) return;
        const entree = i === 0
          ? balisesApparition(style, Math.round((fin - debut) * 1000)) : '';
        lignes.push(`Dialogue: 0,${tempsAss(debut)},${tempsAss(fin)},C0,,0,0,0,,`
          + `${pos}${entree}${corpsBloc(bloc, style, couleurs, i, deuxLignes)}`);
      });
      continue;
    }

    const entree = balisesApparition(
      style, Math.round((bloc.finSecondes - bloc.debutSecondes) * 1000),
    );
    lignes.push(`Dialogue: 0,${tempsAss(bloc.debutSecondes)},${tempsAss(bloc.finSecondes)},`
      + `C0,,0,0,0,,${pos}${entree}${corpsBloc(bloc, style, couleurs, -1, deuxLignes)}`);
  }

  return { contenu: `${lignes.join('\n')}\n`, blocs: blocs.length };
}
