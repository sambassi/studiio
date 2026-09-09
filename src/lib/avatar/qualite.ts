/**
 * A_8c — CE QU'UNE VIDEO DE REFERENCE DOIT VALOIR, ET CE QU'ON NE SAIT PAS JUGER.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEUX MOITIES, ET LA SECONDE COMPTE AUTANT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * CE QU'ON MESURE : duree, dimensions, images par seconde, presence d'une
 * piste sonore, lisibilite du fichier. Ce sont des faits, `ffprobe` les rend,
 * et un refus fonde dessus est defendable.
 *
 * CE QU'ON NE MESURE PAS : la lumiere, le cadrage, le nombre de personnes dans
 * le champ, le naturel d'un geste. Aucun moteur du depot ne sait le faire.
 * Ces points partent donc en CONSEILS, jamais en verdicts — annoncer
 * « eclairage ✓ » sans rien avoir regarde serait une mesure inventee, et
 * l'utilisateur y croirait.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI CES SEUILS-LA
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Les bornes DURES viennent du contrat du fournisseur audite le 2026-09-09 :
 * un footage de Digital Twin doit durer entre 15 et 600 secondes. En dehors,
 * ce n'est pas une preference de Studiio, c'est un refus certain — autant le
 * dire tout de suite plutot qu'apres le televersement.
 *
 * La recommandation de 2 a 5 minutes, elle, est un CONSEIL : trente secondes
 * passent techniquement, et donneront un clone plus pauvre. Un avertissement
 * le dit sans bloquer.
 */

/** Ce que la sonde a reellement lu. Aucun champ n'est devine. */
export interface MesureSourceAvatar {
  dureeSecondes: number | null;
  largeur: number | null;
  hauteur: number | null;
  fps: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  aAudio: boolean;
  /** `portrait`, `paysage` ou `carre` — APRES prise en compte de la rotation. */
  orientation: 'portrait' | 'paysage' | 'carre' | null;
  rotationDegres: number;
  octets: number;
  lisible: boolean;
}

export type GraviteQualite = 'succes' | 'avertissement' | 'erreur';

export interface CritereQualite {
  cle: 'duree' | 'resolution' | 'fps' | 'audio' | 'fichier';
  libelle: string;
  gravite: GraviteQualite;
  /** Ce que la personne lit. En francais, jamais une sortie d'outil. */
  message: string;
}

export interface VerdictQualite {
  /** `false` des qu'un critere est en erreur : la suite est impossible. */
  acceptable: boolean;
  criteres: readonly CritereQualite[];
  erreurs: readonly string[];
  avertissements: readonly string[];
}

/* ── Les bornes ─────────────────────────────────────────────────────────── */

/** Bornes DURES du fournisseur : hors de la, le refus est certain. */
export const DUREE_MIN_SECONDES = 15;
export const DUREE_MAX_SECONDES = 600;
/** La fenetre recommandee — un conseil, jamais un refus. */
export const DUREE_RECOMMANDEE_MIN_SECONDES = 120;
export const DUREE_RECOMMANDEE_MAX_SECONDES = 300;

/** Le petit cote de l'image. 720 accepte, 1080 recommande. */
export const PETIT_COTE_MIN = 720;
export const PETIT_COTE_RECOMMANDE = 1080;

/** En dessous, le mouvement des levres n'a plus assez d'images pour exister. */
export const FPS_MIN = 24;

/** Arrondi lisible d'une duree en minutes et secondes. */
function dureeLisible(secondes: number): string {
  const s = Math.round(secondes);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

/**
 * Le verdict, a partir d'une mesure — FONCTION PURE.
 *
 * Aucun acces au disque, au reseau ni a l'horloge : c'est la moitie qui se
 * teste exhaustivement, et elle doit le rester.
 */
export function verdictQualiteSource(m: MesureSourceAvatar): VerdictQualite {
  const criteres: CritereQualite[] = [];

  // ── Le fichier ────────────────────────────────────────────────────────
  //
  // ⚠️ EN PREMIER, ET SEUL SI ILLISIBLE. Un `.txt` renomme `.mp4` n'a ni
  // duree ni dimensions : enchainer les autres criteres afficherait cinq
  // croix pour un seul probleme, et noierait la cause.
  if (!m.lisible) {
    criteres.push({
      cle: 'fichier',
      libelle: 'Fichier',
      gravite: 'erreur',
      message: 'Cette vidéo est illisible. Vérifiez le fichier et réessayez.',
    });
    return {
      acceptable: false,
      criteres,
      erreurs: [criteres[0].message],
      avertissements: [],
    };
  }
  criteres.push({
    cle: 'fichier', libelle: 'Fichier', gravite: 'succes', message: 'Lisible',
  });

  // ── La duree ──────────────────────────────────────────────────────────
  const d = m.dureeSecondes;
  if (d === null || d <= 0) {
    criteres.push({
      cle: 'duree',
      libelle: 'Durée',
      gravite: 'erreur',
      message: 'La durée de cette vidéo n’a pas pu être mesurée.',
    });
  } else if (d < DUREE_MIN_SECONDES) {
    criteres.push({
      cle: 'duree',
      libelle: 'Durée',
      gravite: 'erreur',
      message: `Cette vidéo est trop courte (${dureeLisible(d)}). `
        + `Il en faut au moins ${DUREE_MIN_SECONDES} secondes.`,
    });
  } else if (d > DUREE_MAX_SECONDES) {
    criteres.push({
      cle: 'duree',
      libelle: 'Durée',
      gravite: 'erreur',
      message: `Cette vidéo est trop longue (${dureeLisible(d)}). `
        + `Le maximum est de ${dureeLisible(DUREE_MAX_SECONDES)}.`,
    });
  } else if (d < DUREE_RECOMMANDEE_MIN_SECONDES) {
    criteres.push({
      cle: 'duree',
      libelle: 'Durée',
      gravite: 'avertissement',
      message: `${dureeLisible(d)} — c’est suffisant, mais pour un clone plus `
        + 'réaliste nous recommandons 2 à 5 minutes.',
    });
  } else {
    criteres.push({
      cle: 'duree', libelle: 'Durée', gravite: 'succes', message: dureeLisible(d),
    });
  }

  // ── La resolution ─────────────────────────────────────────────────────
  //
  // ⚠️ LE PETIT COTE, JAMAIS LA LARGEUR. Une vidéo verticale 1080 x 1920 a
  // « seulement » 1080 de large et vaut pourtant 1080p : comparer la largeur
  // refuserait exactement le format que Studiio produit le plus.
  const petitCote = m.largeur !== null && m.hauteur !== null
    ? Math.min(m.largeur, m.hauteur) : null;
  if (petitCote === null) {
    criteres.push({
      cle: 'resolution',
      libelle: 'Résolution',
      gravite: 'erreur',
      message: 'Les dimensions de cette vidéo n’ont pas pu être mesurées.',
    });
  } else if (petitCote < PETIT_COTE_MIN) {
    criteres.push({
      cle: 'resolution',
      libelle: 'Résolution',
      gravite: 'erreur',
      message: `Cette vidéo est trop petite (${m.largeur} × ${m.hauteur}). `
        + `Il faut au moins ${PETIT_COTE_MIN} pixels sur le petit côté.`,
    });
  } else if (petitCote < PETIT_COTE_RECOMMANDE) {
    criteres.push({
      cle: 'resolution',
      libelle: 'Résolution',
      gravite: 'avertissement',
      message: `${m.largeur} × ${m.hauteur} — correct. En ${PETIT_COTE_RECOMMANDE}p `
        + 'le visage serait plus net.',
    });
  } else {
    criteres.push({
      cle: 'resolution',
      libelle: 'Résolution',
      gravite: 'succes',
      message: `${m.largeur} × ${m.hauteur}`,
    });
  }

  // ── Les images par seconde ────────────────────────────────────────────
  if (m.fps === null || m.fps <= 0) {
    criteres.push({
      cle: 'fps',
      libelle: 'Images par seconde',
      gravite: 'avertissement',
      message: 'La cadence n’a pas pu être mesurée.',
    });
  } else if (m.fps < FPS_MIN) {
    criteres.push({
      cle: 'fps',
      libelle: 'Images par seconde',
      gravite: 'avertissement',
      message: `${Math.round(m.fps)} images/s — en dessous de ${FPS_MIN}, `
        + 'le mouvement des lèvres perd en précision.',
    });
  } else {
    criteres.push({
      cle: 'fps',
      libelle: 'Images par seconde',
      gravite: 'succes',
      message: `${Math.round(m.fps)} images/s`,
    });
  }

  // ── Le son ────────────────────────────────────────────────────────────
  //
  // ⚠️ UNE ERREUR, PAS UN AVERTISSEMENT. Un clone qui parle s'entraine sur
  // quelqu'un qui parle : sans piste sonore, il n'y a rien a apprendre du
  // mouvement de la bouche.
  criteres.push(m.aAudio
    ? { cle: 'audio', libelle: 'Son', gravite: 'succes', message: 'Détecté' }
    : {
      cle: 'audio',
      libelle: 'Son',
      gravite: 'erreur',
      message: 'Cette vidéo ne contient pas de son. Filmez-vous en parlant.',
    });

  const erreurs = criteres.filter((c) => c.gravite === 'erreur').map((c) => c.message);
  const avertissements = criteres
    .filter((c) => c.gravite === 'avertissement').map((c) => c.message);

  return { acceptable: erreurs.length === 0, criteres, erreurs, avertissements };
}

/**
 * LES CONSEILS QUE STUDIIO NE SAIT PAS VERIFIER.
 *
 * ⚠️ SEPARES DES CRITERES, ET DELIBEREMENT. Les melanger ferait passer une
 * recommandation pour un controle : quelqu'un lirait « cadrage ✓ » alors que
 * personne n'a regarde son cadrage.
 */
export const CONSEILS_CAPTURE: readonly string[] = [
  'Filmez-vous idéalement 2 à 5 minutes',
  'Caméra stable, posée',
  'Lumière face à vous, douce',
  'Visage net, buste visible',
  'Regardez l’objectif',
  'Parlez naturellement',
  'Alternez sourire et expression neutre',
  'Bougez un peu la tête, faites quelques gestes',
  'Fond stable, personne d’autre dans le cadre',
  'Évitez les filtres de beauté',
];
