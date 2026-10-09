/**
 * CAPTURE DE LA SOURCE D'AVATAR — les règles PURES de l'enregistrement
 * caméra + micro (format, extension, messages, exigences du fournisseur).
 *
 * Extrait, à l'identique, de la partie « Enregistrement caméra » de
 * `lib/avatar/studio.ts` (PR #530, bloquée) : seul ce qui sert à produire
 * et contrôler une source est repris — ni prompteur, ni génération, ni
 * recadrage/LUT du mini-studio.
 *
 * Aucun accès réseau ici : tout est testable sans navigateur.
 */


/**
 * Le format d'enregistrement, parmi ceux que le navigateur sait produire ET
 * que l'import accepte (`/api/avatar/create` : MP4, WebM, MOV). `mp4Requis` :
 * le fournisseur de l'avatar vidéo n'accepte pas le WebM — on ne propose
 * alors que du MP4, ou rien.
 */
export function choisirFormatEnregistrement(
  supporte: (mime: string) => boolean,
  mp4Requis = false,
): string | null {
  const mp4 = ['video/mp4;codecs=avc1,mp4a', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const candidats = mp4Requis ? mp4 : [...webm, ...mp4];
  return candidats.find((m) => supporte(m)) ?? null;
}

/** Le type « nu » d'un mime (`video/webm;codecs=…` → `video/webm`) et son extension. */
export function typeEtExtension(mime: string): { type: string; extension: string } {
  const type = mime.split(';')[0].trim();
  return { type, extension: type === 'video/mp4' ? 'mp4' : type === 'video/quicktime' ? 'mov' : 'webm' };
}

/** Message clair pour un refus d'accès à la caméra — jamais l'erreur brute du navigateur. */
export function messageErreurCamera(nom: string | undefined): string {
  if (nom === 'NotAllowedError' || nom === 'SecurityError') return 'Accès à la caméra refusé. Autorisez la caméra et le micro dans votre navigateur, puis réessayez.';
  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') return 'Aucune caméra détectée. Branchez une caméra ou importez une vidéo.';
  if (nom === 'NotReadableError') return 'La caméra est utilisée par une autre application. Fermez-la, puis réessayez.';
  return 'La caméra n’a pas pu démarrer. Vous pouvez importer une vidéo à la place.';
}

export function formaterDuree(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Les exigences DOCUMENTÉES du fournisseur pour une source d'avatar vidéo
 * (« digital twin ») : 15 à 600 s, grand côté ≥ 640 px (1080p recommandé),
 * MP4 ou WebM, 32 Mo par l'envoi direct de Studiio. Vérifiées AVANT tout
 * envoi : une prise hors règles est refusée ici, jamais chez le fournisseur.
 */
export const EXIGENCES_SOURCE_VIDEO = { dureeMinS: 15, dureeMaxS: 600, grandCoteMinPx: 640, tailleMaxMo: 32 } as const;

/** Débits d'enregistrement : ~3 min de 720p tiennent sous les 32 Mo. */
export const DEBIT_VIDEO_ENREGISTREMENT = 1_200_000;
export const DEBIT_AUDIO_ENREGISTREMENT = 128_000;

export function verifierPriseSource(p: { dureeS: number; largeur: number; hauteur: number; octets: number }): string[] {
  const motifs: string[] = [];
  const e = EXIGENCES_SOURCE_VIDEO;
  if (p.dureeS < e.dureeMinS) motifs.push(`Enregistrez au moins ${e.dureeMinS} secondes (idéalement 2 minutes).`);
  if (p.dureeS > e.dureeMaxS) motifs.push(`${e.dureeMaxS / 60} minutes maximum.`);
  if (p.largeur > 0 && Math.max(p.largeur, p.hauteur) < e.grandCoteMinPx) motifs.push('La résolution de la caméra est trop faible (720p minimum conseillé).');
  if (p.octets > e.tailleMaxMo * 1024 * 1024) motifs.push(`Vidéo trop lourde (${Math.round(p.octets / 1024 / 1024)} Mo, ${e.tailleMaxMo} Mo maximum) : enregistrez une prise plus courte.`);
  return motifs;
}
