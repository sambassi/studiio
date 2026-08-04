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

export interface VoiceFit {
  status: VoiceFitStatus;
  /** Ecart signe en secondes : positif si la voix depasse. */
  deltaSec: number;
  /** Duree cible pour que la sequence colle a la voix, en secondes entieres. */
  suggestedSeqSec: number;
}

/** Arrondi d'affichage : une decimale, sans `-0`. */
function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
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
    return { status: 'unknown', deltaSec: 0, suggestedSeqSec: seqSec };
  }
  if (!Number.isFinite(seqSec) || seqSec <= 0) {
    return { status: 'unknown', deltaSec: 0, suggestedSeqSec: Math.max(1, Math.ceil(audioSec)) };
  }

  const delta = round1(audioSec - seqSec);
  // Une sequence se regle en secondes entieres dans l'editeur : on arrondit au
  // superieur pour ne jamais retomber sous la voix a cause de l'arrondi.
  const suggested = Math.max(1, Math.ceil(audioSec));

  if (Math.abs(delta) <= tolerance) {
    return { status: 'ok', deltaSec: delta, suggestedSeqSec: suggested };
  }
  return {
    status: delta > 0 ? 'over' : 'under',
    deltaSec: delta,
    suggestedSeqSec: suggested,
  };
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

/**
 * Marge ajoutee a la voix pour fixer la duree de sa sequence.
 *
 * Sans elle, la sequence changerait a l'instant precis ou le dernier mot se
 * termine : la coupure s'entend. Un tiers de seconde suffit a la rendre
 * naturelle sans creer de silence percu.
 */
export const VOICE_SEQUENCE_MARGIN_S = 0.3;

/**
 * Duree de sequence pour une voix donnee.
 *
 * Arrondie a la seconde SUPERIEURE : les durees se reglent en secondes
 * entieres dans l'editeur, et arrondir au plus proche pourrait retomber sous
 * la voix — la fin du texte serait coupee, ce que toute cette mecanique
 * cherche justement a eviter.
 */
export function voiceSequenceSeconds(
  audioSec: number,
  margin: number = VOICE_SEQUENCE_MARGIN_S,
): number {
  if (!Number.isFinite(audioSec) || audioSec <= 0) return 0;
  return Math.max(1, Math.ceil(audioSec + Math.max(0, margin)));
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
      return `Voix ${s(audioSec)} > séquence ${s(seqSec)} : allonger de ${s(Math.abs(fit.deltaSec))}`;
    case 'under':
      return `Voix ${s(audioSec)} < séquence ${s(seqSec)} : raccourcir de ${s(Math.abs(fit.deltaSec))}`;
    default:
      return '';
  }
}
