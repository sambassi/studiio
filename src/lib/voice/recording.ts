/**
 * Regles de l'enregistrement micro destine au clonage.
 *
 * Fonctions PURES, sans React ni `MediaRecorder` : elles se verifient sur des
 * valeurs, alors que le composant qui les utilise ne peut pas etre exerce en
 * jsdom — il n'y a ni micro ni `MediaRecorder`.
 */

/** En deca, ElevenLabs clone quand meme, mais le resultat est mediocre. */
export const MIN_RECORDING_SECONDS = 30;

/**
 * Au-dela, on arrete tout seul.
 *
 * ElevenLabs recommande une a deux minutes : plus long n'ameliore pas le
 * clone et grossit inutilement l'envoi, que la route plafonne a 10 Mo.
 */
export const MAX_RECORDING_SECONDS = 120;

/** Duree a partir de laquelle l'echantillon est confortable. */
export const GOOD_RECORDING_SECONDS = 60;

/**
 * Types que `MediaRecorder` sait produire, par ordre de preference.
 *
 * Opus dans un conteneur WebM est ce que produit Chrome ; Safari ne connait
 * que MP4. Les deux sont acceptes par la route de clonage — sans ce second
 * choix, la fonctionnalite serait morte sur Safari.
 */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
];

/**
 * Premier type reellement supporte par le navigateur.
 *
 * Renvoie `undefined` quand aucun ne l'est : `MediaRecorder` choisit alors son
 * type par defaut, ce qui vaut mieux que de lui en imposer un qu'il refuse et
 * qui ferait echouer la construction.
 */
export function pickRecorderMimeType(
  isSupported?: (type: string) => boolean,
): string | undefined {
  if (typeof isSupported !== 'function') return undefined;
  return RECORDER_MIME_CANDIDATES.find((type) => {
    try {
      return isSupported(type);
    } catch {
      return false;
    }
  });
}

/**
 * Chrono `m:ss`, jamais negatif.
 *
 * Une seule implementation, partagee avec le lecteur audio : deux copies d'un
 * meme formatage finissent toujours par diverger d'un cas limite.
 */
export { formatTime as formatDuration } from '@/lib/audio/waveform';

export type RecordingQuality = 'trop-court' | 'acceptable' | 'bon';

/**
 * Qualite attendue du clone pour cette duree.
 *
 * « trop-court » n'interdit rien : la route accepte l'envoi, et l'utilisateur
 * reste maitre de son choix. C'est un avertissement, pas un verrou — bloquer
 * a 29 secondes serait arbitraire.
 */
export function recordingQuality(seconds: number): RecordingQuality {
  if (!Number.isFinite(seconds) || seconds < MIN_RECORDING_SECONDS) return 'trop-court';
  if (seconds < GOOD_RECORDING_SECONDS) return 'acceptable';
  return 'bon';
}

/** Message affiche sous le chrono. */
export function recordingAdvice(seconds: number): string {
  switch (recordingQuality(seconds)) {
    case 'trop-court':
      return `Continuez — ${MIN_RECORDING_SECONDS} secondes au minimum pour un clone fidèle.`;
    case 'acceptable':
      return 'C’est utilisable. Une minute donnerait un meilleur résultat.';
    default:
      return 'Durée idéale.';
  }
}

/**
 * Message a montrer quand le micro n'a pas pu s'ouvrir.
 *
 * Les noms d'erreur de `getUserMedia` sont normalises : les distinguer evite
 * de dire « autorisez le micro » a quelqu'un qui n'en a tout simplement pas.
 */
export function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Micro refusé. Autorisez l’accès au micro dans votre navigateur, puis réessayez.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Aucun micro détecté. Branchez un micro, puis réessayez.';
    case 'NotReadableError':
      return 'Le micro est déjà utilisé par une autre application.';
    default:
      return 'Impossible d’ouvrir le micro sur cet appareil.';
  }
}
