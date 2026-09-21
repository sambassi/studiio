/**
 * Correspondance entre la duree d'une voix off et celle de sa sequence.
 *
 * Fonction PURE, sans React ni DOM : c'est la regle metier de l'indicateur du
 * panneau des voix par sequence, isolee pour etre testable seule.
 *
 * L'existant ne signalait qu'un cas — la voix qui deborde — et sans chiffre.
 * Le cas inverse (une voix nettement plus courte que sa sequence, donc du
 * silence a l'ecran) n'etait pas signale du tout.
 */

/** Tolerance par defaut : en deca, l'ecart ne s'entend pas. */
export const VOICE_FIT_TOLERANCE_S = 0.3;

export type VoiceFitStatus =
  /** Pas d'audio, ou duree inconnue : rien a dire. */
  | 'unknown'
  /** L'ecart est sous la tolerance. */
  | 'ok'
  /** La voix depasse : il faut allonger la sequence (ou raccourcir le texte). */
  | 'over'
  /** La voix est plus courte : la sequence peut etre raccourcie. */
  | 'under';

/**
 * Gravite de l'ecart, pour l'affichage.
 *
 * Seule la voix qui DEBORDE coupe l'audio a l'export : c'est le seul cas qui
 * merite un avertissement. Une voix un peu plus courte laisse du silence a
 * l'ecran — une information, pas une erreur : l'utilisateur peut vouloir ce
 * temps de lecture.
 */
export type VoiceFitSeverity = 'ok' | 'info' | 'warning';

export interface VoiceFit {
  status: VoiceFitStatus;
  severity: VoiceFitSeverity;
  /** Ecart signe en secondes : positif si la voix depasse. */
  deltaSec: number;
  /**
   * Duree cible pour que la sequence colle a la voix, au dixieme de seconde.
   * C'est EXACTEMENT ce que l'action « Adapter la duree a la voix » applique
   * (`voiceSequenceSeconds`) : une seule regle, sinon l'indicateur finit par
   * signaler comme une erreur le reglage que l'editeur a lui-meme pose.
   */
  suggestedSeqSec: number;
}

/** Arrondi d'affichage : une decimale, sans `-0`. */
function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
}

/**
 * Marge ajoutee a la voix pour fixer la duree de sa sequence.
 *
 * Sans elle, la sequence changerait a l'instant precis ou le dernier mot se
 * termine : la coupure s'entend. Un tiers de seconde suffit a la rendre
 * naturelle sans creer de silence percu.
 */
export const VOICE_SEQUENCE_MARGIN_S = 0.3;

/**
 * Duree de sequence pour une voix donnee, au DIXIEME de seconde.
 *
 * Arrondie au dixieme SUPERIEUR : arrondir au plus proche pourrait retomber
 * sous la voix — la fin du texte serait coupee, ce que toute cette mecanique
 * cherche justement a eviter. Au dixieme et non a la seconde : arrondir a la
 * seconde ajoutait jusqu'a 1,3 s de silence, que l'indicateur signalait
 * ensuite comme « a raccourcir »... vers la valeur deja en place.
 */
export function voiceSequenceSeconds(
  audioSec: number,
  margin: number = VOICE_SEQUENCE_MARGIN_S,
): number {
  if (!Number.isFinite(audioSec) || audioSec <= 0) return 0;
  const cible = audioSec + Math.max(0, margin);
  // `- 1e-9` : 4,0 + 0,3 vaut 4,300000000000001 en flottant ; sans l'epsilon
  // le plafond au dixieme rendrait 4,4.
  return Math.max(1, Math.ceil(cible * 10 - 1e-9) / 10);
}

/**
 * Compare la duree d'un audio a celle de sa sequence.
 *
 * `audioSec` a `undefined` ou <= 0 (voix absente, ou duree jamais sondee)
 * renvoie `unknown` : l'indicateur reste alors muet, comme aujourd'hui.
 */
export function compareVoiceToSequence(
  audioSec: number | undefined | null,
  seqSec: number,
  tolerance: number = VOICE_FIT_TOLERANCE_S,
): VoiceFit {
  if (typeof audioSec !== 'number' || !Number.isFinite(audioSec) || audioSec <= 0) {
    return { status: 'unknown', severity: 'ok', deltaSec: 0, suggestedSeqSec: seqSec };
  }
  if (!Number.isFinite(seqSec) || seqSec <= 0) {
    return { status: 'unknown', severity: 'ok', deltaSec: 0, suggestedSeqSec: voiceSequenceSeconds(audioSec) };
  }

  const delta = round1(audioSec - seqSec);
  const suggested = voiceSequenceSeconds(audioSec);

  // OK si la voix tient (avec sa marge) et que la sequence ne depasse pas la
  // cible de plus que la tolerance : une sequence reglee par « Adapter » est
  // OK par construction.
  if (delta <= 0 && seqSec - suggested <= tolerance) {
    return { status: 'ok', severity: 'ok', deltaSec: delta, suggestedSeqSec: suggested };
  }
  if (delta > 0 && delta <= tolerance) {
    // Un depassement sous la tolerance ne s'entend pas.
    return { status: 'ok', severity: 'ok', deltaSec: delta, suggestedSeqSec: suggested };
  }
  return delta > 0
    ? { status: 'over', severity: 'warning', deltaSec: delta, suggestedSeqSec: suggested }
    : { status: 'under', severity: 'info', deltaSec: delta, suggestedSeqSec: suggested };
}

/**
 * Debit de lecture retenu pour l'estimation, en caracteres par seconde.
 *
 * Ordre de grandeur d'une voix de synthese en francais a vitesse normale. Ce
 * n'est qu'une ESTIMATION : la valeur reelle depend de la voix, de la
 * ponctuation et des nombres. Elle sert a prevenir avant de generer, pas a
 * caler la sequence — pour ca, seule la duree mesuree de l'audio fait foi.
 */
export const SPEECH_CHARS_PER_SECOND = 14;

/**
 * Duree approximative de lecture d'un texte, en secondes.
 *
 * Rend 0 sur un texte vide : l'appelant n'affiche alors rien, plutot qu'un
 * « ≈ 0 s » qui n'apprend rien.
 */
export function estimateSpeechSeconds(
  text: string | null | undefined,
  charsPerSecond: number = SPEECH_CHARS_PER_SECOND,
): number {
  const propre = typeof text === 'string' ? text.trim() : '';
  if (!propre) return 0;
  const debit = Number.isFinite(charsPerSecond) && charsPerSecond > 0
    ? charsPerSecond
    : SPEECH_CHARS_PER_SECOND;
  return round1(propre.length / debit);
}

/** Etiquette « ≈ 4,3 s », ou chaine vide si le texte ne dit rien. */
export function estimateLabel(text: string | null | undefined): string {
  const s = estimateSpeechSeconds(text);
  return s > 0 ? `≈ ${s.toString().replace('.', ',')} s` : '';
}

/**
 * Phrase affichee sous la sequence. Dit ce qu'il faut FAIRE, avec l'ecart
 * chiffre — « la voix est trop longue » n'aide pas, « +2,2 s » si.
 */
export function voiceFitMessage(fit: VoiceFit, audioSec: number, seqSec: number): string {
  const s = (n: number) => `${round1(n).toString().replace('.', ',')} s`;
  switch (fit.status) {
    case 'ok':
      return `Voix ${s(audioSec)} — la séquence est à la bonne durée`;
    case 'over':
      // Le seul cas qui coupe l'audio a l'export : on le dit tel quel, et on
      // nomme la cible que l'action « Adapter » appliquera.
      return `Voix ${s(audioSec)} > séquence ${s(seqSec)} : la fin sera coupée de ${s(Math.abs(fit.deltaSec))} — adapter à ${s(fit.suggestedSeqSec)}`;
    case 'under':
      return `Voix ${s(audioSec)} < séquence ${s(seqSec)} : ${s(Math.abs(fit.deltaSec))} de silence en fin de séquence — adapter à ${s(fit.suggestedSeqSec)}`;
    default:
      return '';
  }
}

/** Libelle de l'action qui applique `suggestedSeqSec`. */
export const VOICE_FIT_APPLY_LABEL = 'Adapter la durée à la voix';
