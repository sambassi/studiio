/**
 * LE BLANC AU DÉBUT D'UNE MUSIQUE — MESURÉ, PUIS COUPÉ POUR LE RENDU.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Beaucoup de fichiers exportés d'un DAW commencent par un blanc — quelques
 * dixièmes, parfois deux secondes. À l'écoute du montage, la vidéo démarre
 * et le son n'arrive pas : on croit à une panne d'encodage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI UNE VRAIE COUPE, ET NON UN `-ss` À L'ENTRÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * MESURÉ, PAS SUPPOSÉ (ffmpeg 8.1, 2026-09-07). Sur un fichier « 2 s de
 * silence + 3 s de son », `-stream_loop -1 -ss 2 -i` rend une piste où le
 * silence REVIENT à chaque tour :
 *
 *   silence_start: 1.99 | silence_start: 5.99 | silence_start: 9.99 …
 *
 * La boucle rejoue le fichier depuis son début, pas depuis le point de
 * recherche. Le même fichier COUPÉ AVANT d'être bouclé donne zéro silence
 * détecté. C'est donc une passe ffmpeg de plus, sur un fichier audio seul —
 * quelques centaines de kilo-octets, une fraction de seconde — et non une
 * option d'entrée qui aurait l'air de marcher sur la première écoute.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST JAMAIS COUPÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • le fichier SOURCE de l'utilisateur, jamais touché — la coupe vit dans
 *     le dossier temporaire du rendu et meurt avec lui ;
 *   • une pause INTERNE, un break, un silence artistique au milieu ;
 *   • le silence de FIN ;
 *   • une intro calme, un fondu d'entrée, une ambiance basse : le seuil est
 *     posé à −50 dB, très près du silence numérique, précisément pour ne pas
 *     confondre « doux » et « rien ». À −35 dB — le seuil qui convient aux
 *     rushes parlés — une nappe d'intro serait prise pour du vide.
 *
 * Seul est coupé le silence CONTINU qui commence exactement à 0:00.
 */

/** Le seuil sous lequel on parle de silence, pour une MUSIQUE. */
export const SEUIL_SILENCE_MUSIQUE_DB = -50;

/** En deçà, ce n'est pas un blanc gênant : c'est une attaque. */
export const SILENCE_INITIAL_MIN_MS = 300;

/**
 * Ce qu'on garde AVANT la première note.
 *
 * ⚠️ COUPER AU SAMPLE PRÈS MANGE L'ATTAQUE. `silencedetect` place la fin du
 * silence au premier échantillon qui dépasse le seuil ; une percussion monte
 * en quelques millisecondes, et son tout début est déjà au-dessus. On rend
 * donc ces quelques millisecondes.
 */
export const MUSIQUE_TRIM_PREROLL_MS = 50;

/** Le silence doit commencer au tout début — cette marge dit « au début ». */
const DEBUT_TOLERANCE_SECONDES = 0.05;

/**
 * Le blanc initial lu dans la sortie de `silencedetect`, en secondes.
 *
 * Fonction PURE : elle lit un texte, elle ne lance rien. C'est ce qui permet
 * de la tester sur des sorties réelles sans ffmpeg.
 *
 * Rend `0` dès qu'un doute existe — pas de blanc au tout début, blanc trop
 * court, sortie illisible. Ne rien couper est toujours le repli sûr : on
 * garde alors le comportement d'avant ce lot.
 */
export function silenceInitialSecondes(stderr: string): number {
  const debuts = [...stderr.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]));
  const fins = [...stderr.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]));
  if (debuts.length === 0 || fins.length === 0) return 0;

  const premierDebut = debuts[0];
  if (!Number.isFinite(premierDebut)) return 0;
  // ⚠️ « AU DÉBUT » VEUT DIRE AU DÉBUT. Un silence qui commence à 12 s est
  // une pause interne : la couper décalerait tout le morceau.
  if (premierDebut > DEBUT_TOLERANCE_SECONDES) return 0;

  const premiereFin = fins[0];
  if (!Number.isFinite(premiereFin) || premiereFin <= 0) return 0;
  // La fin du premier silence DOIT suivre son début : une sortie où l'ordre
  // est inversé n'est pas une mesure, c'est un bruit de parsing.
  if (premiereFin < Math.max(0, premierDebut)) return 0;

  const preroll = MUSIQUE_TRIM_PREROLL_MS / 1000;
  const coupe = premiereFin - preroll;
  if (coupe * 1000 < SILENCE_INITIAL_MIN_MS) return 0;
  // Trois décimales : la même précision que le reste du pipeline.
  return Math.round(Math.max(0, coupe) * 1000) / 1000;
}

/**
 * Les arguments de MESURE. Rien n'est écrit : `-f null -` jette la sortie.
 */
export function argumentsMesureSilence(fichier: string): readonly string[] {
  return [
    '-hide_banner', '-nostdin',
    '-i', fichier,
    // Seul le son est décodé, et une seule piste : une pochette d'album
    // n'a rien à voir avec la mesure.
    '-vn', '-sn', '-dn', '-map', '0:a:0',
    '-af', `silencedetect=n=${SEUIL_SILENCE_MUSIQUE_DB}dB:d=${SILENCE_INITIAL_MIN_MS / 1000}`,
    '-f', 'null', '-',
  ];
}

/**
 * Les arguments de COUPE, vers un nouveau fichier.
 *
 * ⚠️ `atrim` EN FILTRE, PAS `-ss` EN ENTRÉE. Le filtre coupe à l'échantillon
 * près sur le flux décodé ; `-ss` avec `-c copy` s'aligne sur l'image-clé la
 * plus proche et se trompe de plusieurs dixièmes — mesuré sur le banc, où
 * une coupe demandée à 2,000 s rendait un fichier de 2,000 s au lieu de
 * 3,000 s. `asetpts` remet l'horloge à zéro : sans lui, la piste garderait
 * son décalage d'origine et le blanc reviendrait par la fenêtre.
 */
export function argumentsCoupeSilence(
  source: string, destination: string, debutSecondes: number,
): readonly string[] {
  return [
    '-hide_banner', '-nostdin', '-y',
    '-i', source,
    '-vn', '-sn', '-dn', '-map', '0:a:0',
    '-af', `atrim=start=${debutSecondes.toFixed(3)},asetpts=PTS-STARTPTS`,
    // Le PCM ne recompresse rien : le fichier vit le temps du rendu, et une
    // seconde génération MP3 abîmerait le son pour économiser un fichier
    // temporaire.
    '-c:a', 'pcm_s16le',
    destination,
  ];
}
