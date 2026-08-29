/**
 * Ce que l'écran DIT d'une analyse — les mots, les unités, les phrases.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX RÈGLES QUI GOUVERNENT TOUT CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **Aucun pourcentage.** Le serveur connaît trois ÉTAPES — `extraction`,
 *    `visuel`, `transcription` — et rien entre elles. Un « 67 % » affiché
 *    ici serait inventé de toutes pièces : il ne viendrait d'aucune mesure,
 *    n'avancerait pas au rythme du travail, et se figerait au milieu d'une
 *    étape longue. Une phrase qui nomme l'étape en cours dit strictement ce
 *    qu'on sait, et ne ment jamais sur le temps restant.
 *
 * 2. **Aucun résultat fabriqué.** Une section vide ne s'affiche pas. Un
 *    `resume` absent n'est pas « Analyse en cours de rédaction », une
 *    `qualite` vide n'est pas « Bonne ». Les lots M3-B4 et M3-B5 apporteront
 *    ces données ; d'ici là l'écran dit qu'elles viendront, ce qui est vrai,
 *    plutôt que d'afficher un contenu plausible, ce qui serait faux.
 *
 * Ce module ne connaît ni React ni le réseau : il transforme des valeurs en
 * chaînes, et se teste sans monter quoi que ce soit.
 */
import type { RushAnalysisStep } from './contrat';

// ─────────────────────────────────────────────────────────────────────────
// Les étapes — des phrases, jamais des pourcentages
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ce qui se passe pendant chaque étape, dit à quelqu'un qui n'a pas écrit le
 * code. « extraction » ne veut rien dire pour un coach de fitness ; « on lit
 * les informations techniques du fichier » si.
 */
export const LIBELLE_ETAPE: Record<RushAnalysisStep, string> = {
  extraction: 'Extraction des informations techniques…',
  visuel: 'Lecture des images…',
  transcription: 'Transcription de la parole…',
};

/** La phrase d'une analyse en cours. Sans étape connue, on reste vague — et honnête. */
export function phraseEnCours(etape: RushAnalysisStep | null): string {
  return etape ? LIBELLE_ETAPE[etape] : 'Analyse en cours…';
}

// ─────────────────────────────────────────────────────────────────────────
// Les échecs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Le motif technique → une phrase compréhensible.
 *
 * Les clés sont celles que la route écrit réellement dans `motif_echec` :
 * les six motifs du moteur, les quatre motifs de la route, et
 * `analyse_interrompue` posé par la reprise M3-B2.1. Afficher `motifEchec`
 * brut à l'écran reviendrait à montrer un identifiant de code source à
 * quelqu'un qui voulait savoir si son fichier est utilisable.
 */
const MESSAGES_ECHEC: Record<string, string> = {
  format_illisible: 'Ce fichier n’est pas une vidéo exploitable.',
  objet_introuvable: 'Le fichier de ce rush n’est plus dans le stockage.',
  cle_hors_perimetre: 'Ce fichier n’appartient pas à votre espace.',
  timeout: 'La mesure a dépassé son délai — le fichier est peut-être très lourd.',
  extraction_impossible: 'L’analyse n’a pas abouti.',
  stockage_injoignable: 'Le stockage était momentanément injoignable.',
  moteur_absent: 'L’analyse n’est pas installée sur ce serveur.',
  moteur_en_erreur: 'L’analyse s’est arrêtée sur une erreur.',
  resultat_moteur_invalide: 'La mesure a rendu un résultat inexploitable.',
  resultat_moteur_refuse: 'La mesure a rendu une valeur refusée par le contrôle interne.',
  analyse_interrompue: 'L’analyse a été interrompue avant la fin (redémarrage du serveur).',
};

/**
 * `resultat_moteur_refuse:vignettes` et ses variantes portent le champ fautif
 * après un `:`. On lit la partie qui a un sens pour l'utilisateur — le reste
 * est un détail de diagnostic qui n'a rien à faire à l'écran.
 */
function motifCourt(motif: string): string {
  const i = motif.indexOf(':');
  return i === -1 ? motif : motif.slice(0, i);
}

export function messageEchec(motif: string | null): string {
  if (!motif) return 'L’analyse n’a pas abouti.';
  return MESSAGES_ECHEC[motifCourt(motif)] ?? 'L’analyse n’a pas abouti.';
}

/**
 * Les échecs qu'il est HONNÊTE de proposer de relancer.
 *
 * La règle : relancer se propose quand la même mesure, sur le même fichier,
 * pourrait donner un autre résultat SANS que rien ne change de notre côté.
 * Un fichier illisible restera illisible ; un stockage injoignable peut être
 * joignable dans dix secondes.
 *
 * Un motif inconnu est relançable : on ne sait pas, et un cul-de-sac serait
 * un plus mauvais défaut qu'un essai inutile.
 */
const ECHECS_DEFINITIFS = new Set([
  'format_illisible',
  'objet_introuvable',
  'cle_hors_perimetre',
  'moteur_absent',
  'resultat_moteur_invalide',
  'resultat_moteur_refuse',
]);

export function relanceCoherente(motif: string | null): boolean {
  if (!motif) return true;
  return !ECHECS_DEFINITIFS.has(motifCourt(motif));
}

// ─────────────────────────────────────────────────────────────────────────
// Les unités
// ─────────────────────────────────────────────────────────────────────────

/** Une décimale au plus, virgule française, et pas de « 12,0 ». */
function nombre(n: number, decimales = 0): string {
  const s = decimales > 0 ? n.toFixed(decimales).replace(/\.?0+$/, '') : String(Math.round(n));
  return s.replace('.', ',');
}

export function formaterDuree(secondes: number | null): string | null {
  if (secondes === null || !Number.isFinite(secondes) || secondes <= 0) return null;
  const total = Math.round(secondes);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

export function formaterOctets(octets: number | null): string | null {
  if (octets === null || !Number.isFinite(octets) || octets <= 0) return null;
  if (octets < 1024) return `${Math.round(octets)} o`;
  if (octets < 1024 ** 2) return `${nombre(octets / 1024, 1)} Ko`;
  if (octets < 1024 ** 3) return `${nombre(octets / 1024 ** 2, 1)} Mo`;
  return `${nombre(octets / 1024 ** 3, 2)} Go`;
}

/**
 * Le nom courant d'une résolution, déduit du PLUS PETIT côté.
 *
 * Un rush vertical fait 1080×1920 : prendre la largeur en ferait du « 1080p »,
 * prendre la hauteur en ferait du « 1920p », qui n'existe pas. C'est le petit
 * côté qui nomme la définition, dans les deux orientations.
 */
export function nomResolution(largeur: number | null, hauteur: number | null): string | null {
  if (!largeur || !hauteur) return null;
  const petit = Math.min(largeur, hauteur);
  if (petit >= 2160) return '4K UHD';
  if (petit >= 1440) return '1440p (QHD)';
  if (petit >= 1080) return '1080p (Full HD)';
  if (petit >= 720) return '720p (HD)';
  if (petit >= 480) return '480p';
  return `${petit}p`;
}

// ─────────────────────────────────────────────────────────────────────────
// Le tableau des mesures
// ─────────────────────────────────────────────────────────────────────────

export interface LigneTechnique {
  cle: string;
  libelle: string;
  valeur: string;
}

function entier(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function decimal(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Ce que la mesure a réellement produit, mis en lignes lisibles.
 *
 * ⚠️ **Rien n'est inventé, et rien n'est comblé.** Une clé absente de
 * `technique` ne produit pas de ligne : le repli `ffmpeg -i` ne connaît ni la
 * taille du fichier ni le fps exact, et afficher « — » à leur place ferait
 * croire à une mesure qui vaut zéro. Une ligne manquante se lit comme « pas
 * mesuré », ce qui est la vérité.
 *
 * Les clés lues sont exactement celles qu'écrit
 * `src/lib/autopilot/analyse/extraction.ts` : `sonde`, `conteneur`,
 * `codecVideo`, `largeur`, `hauteur`, `fps`, `bitrate`, `rotation`, `aAudio`,
 * `codecAudio`, `canauxAudio`, `frequenceAudio`, `tailleOctets`.
 *
 * `extraction.ts` y écrit AUSSI `vignettesAttendues`, `vignettesProduites` et
 * `vignettesEchouees`. Elles ne sont VOLONTAIREMENT pas lues ici : ce sont des
 * compteurs de supervision, destinés au journal et aux requêtes de suivi, pas
 * une mesure du rush. Les afficher à côté du codec et du fps ferait passer un
 * incident d'outillage pour une caractéristique de la vidéo.
 */
export function formaterTechnique(
  technique: Record<string, unknown>,
  dureeSecondes: number | null,
): { mesures: LigneTechnique[]; details: LigneTechnique[] } {
  const mesures: LigneTechnique[] = [];
  const details: LigneTechnique[] = [];
  const pousser = (
    liste: LigneTechnique[], cle: string, libelle: string, valeur: string | null,
  ) => { if (valeur) liste.push({ cle, libelle, valeur }); };

  pousser(mesures, 'duree', 'Durée', formaterDuree(dureeSecondes));

  const largeur = entier(technique.largeur);
  const hauteur = entier(technique.hauteur);
  pousser(mesures, 'dimensions', 'Dimensions', largeur && hauteur ? `${largeur} × ${hauteur}` : null);
  pousser(mesures, 'resolution', 'Résolution', nomResolution(largeur, hauteur));

  const fps = decimal(technique.fps);
  pousser(mesures, 'fps', 'Images par seconde', fps ? `${nombre(fps, 2)} img/s` : null);

  pousser(mesures, 'codecVideo', 'Codec vidéo', texte(technique.codecVideo));

  // La PRÉSENCE d'audio est une information à part entière — c'est elle qui
  // dit si une voix pourra être transcrite. Elle s'affiche même quand elle
  // vaut « non », contrairement aux mesures absentes.
  if (typeof technique.aAudio === 'boolean') {
    mesures.push({
      cle: 'aAudio',
      libelle: 'Piste audio',
      valeur: technique.aAudio ? 'Oui' : 'Aucune',
    });
  }
  pousser(mesures, 'codecAudio', 'Codec audio', texte(technique.codecAudio));

  const canaux = entier(technique.canauxAudio);
  pousser(
    mesures, 'canauxAudio', 'Canaux',
    canaux === null ? null : canaux === 1 ? 'Mono' : canaux === 2 ? 'Stéréo' : `${canaux} canaux`,
  );

  const frequence = entier(technique.frequenceAudio);
  pousser(
    mesures, 'frequenceAudio', 'Fréquence',
    frequence === null ? null : `${nombre(frequence / 1000, 1)} kHz`,
  );

  const bitrate = entier(technique.bitrate);
  pousser(
    mesures, 'bitrate', 'Débit',
    bitrate === null ? null
      : bitrate >= 1_000_000 ? `${nombre(bitrate / 1_000_000, 1)} Mb/s`
        : `${nombre(bitrate / 1000)} kb/s`,
  );

  // `rotation: 0` est une vraie mesure — « pas de rotation » — mais ne dit
  // rien à personne. Seule une rotation non nulle mérite une ligne.
  const rotation = Number(technique.rotation);
  if (Number.isFinite(rotation) && rotation !== 0) {
    mesures.push({ cle: 'rotation', libelle: 'Rotation', valeur: `${Math.round(rotation)}°` });
  }

  pousser(mesures, 'tailleOctets', 'Taille du fichier', formaterOctets(entier(technique.tailleOctets)));

  // ── Les détails : vrais, utiles au diagnostic, secondaires à l'usage ──
  pousser(details, 'conteneur', 'Conteneur', texte(technique.conteneur));
  const sonde = texte(technique.sonde);
  pousser(
    details, 'sonde', 'Sonde utilisée',
    sonde === null ? null : sonde === 'ffprobe' ? 'ffprobe (mesure de référence)'
      : sonde === 'ffmpeg' ? 'ffmpeg (repli)' : sonde,
  );

  return { mesures, details };
}

// ─────────────────────────────────────────────────────────────────────────
// Les analyses qui n'existent pas encore
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ce que les étapes d'interprétation ont réellement produit.
 *
 * Trois champs, et pas un de plus : ce sont les seuls dont la FORME est
 * arrêtée aujourd'hui. `parole` et `qualite` sont des objets libres que
 * M3-B5 remplira ; en tirer un affichage maintenant reviendrait à deviner
 * leurs clés, et à afficher du JSON le jour où la devinette est fausse. On
 * lit `parole.texte` parce que c'est le seul champ qu'une transcription ne
 * peut pas ne pas avoir, et on ignore le reste tant qu'il n'existe pas.
 */
export interface ContenuInterprete {
  resume: string | null;
  /** Les textes lus À L'IMAGE. Seules les chaînes sont retenues. */
  textes: string[];
  paroleTexte: string | null;
}

export function extraireContenuInterprete(a: {
  resume: string | null;
  textesVisibles: unknown[];
  parole: Record<string, unknown>;
}): ContenuInterprete {
  const textes = a.textesVisibles
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim());
  const brut = a.parole.texte;
  const paroleTexte = typeof brut === 'string' && brut.trim() ? brut.trim() : null;
  return { resume: a.resume, textes, paroleTexte };
}

/**
 * Vrai quand rien n'a été interprété — donc quand l'écran doit DIRE que ces
 * analyses viendront plus tard, au lieu d'afficher une section vide qui
 * ressemblerait à un résultat nul.
 */
export function contenuInterpreteVide(c: ContenuInterprete): boolean {
  return !c.resume && c.textes.length === 0 && !c.paroleTexte;
}
