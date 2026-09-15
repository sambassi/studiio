/**
 * La FORME d'une clé de source d'avatar — et rien d'autre.
 *
 * Module PUR : aucune base, aucun stockage, aucune session. Il existe pour
 * que le relais public de stockage et la route privée de lecture reconnaissent
 * une source avec la MÊME règle que celle qui la construit
 * (`@/lib/avatar/source`), sans tirer Supabase ni MinIO dans un relais qui
 * n'en a pas besoin — et sans jamais recopier le motif.
 *
 * Une source est un visage. Sa clé, écrite par `/api/avatar/create`, est
 * `<userId>/avatar/source-<horodatage>.<ext>` ; une vidéo générée, sous le
 * même dossier, est `<userId>/avatar/<generationId>.mp4`. Le NOM suffit à les
 * distinguer : c'est ce que ce module sait faire.
 */

export const SEGMENT_SOURCE_AVATAR = 'avatar';

/** Les formats qu'une source peut avoir — ceux que le fournisseur accepte. */
export const TYPES_SOURCE_AUTORISES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const EXTENSIONS = Object.keys(TYPES_SOURCE_AUTORISES).join('|');

/** `source-<horodatage>.<ext>` — le NOM d'une source, et de rien d'autre. */
export const NOM_SOURCE_AVATAR = new RegExp(`^source-(\\d{1,16})\\.(${EXTENSIONS})$`);

/** Le type MIME d'une source d'après sa clé ; `null` si ce n'est pas une source. */
export function typeSourceAvatar(cle: string): string | null {
  const nom = cle.slice(cle.lastIndexOf('/') + 1);
  const m = NOM_SOURCE_AVATAR.exec(nom);
  return m ? TYPES_SOURCE_AUTORISES[m[2]] : null;
}

/** L'extension normalisée d'un nom de fichier, si c'est un format de source. */
export function extensionSourceAvatar(nomFichier: string): string | null {
  const point = nomFichier.lastIndexOf('.');
  if (point < 0) return null;
  const ext = nomFichier.slice(point + 1).toLowerCase();
  return ext in TYPES_SOURCE_AUTORISES ? ext : null;
}

/**
 * Cette clé — quel que soit son compte — nomme-t-elle une source d'avatar ?
 * `<quelque chose>/avatar/source-<horodatage>.<ext>`, exactement trois
 * segments. C'est la question que pose le relais public, qui ne connaît pas
 * de compte : une source n'est jamais publique, à qui qu'elle appartienne.
 */
export function estCleSourceAvatar(cle: unknown): cle is string {
  if (typeof cle !== 'string') return false;
  const segments = cle.split('/');
  if (segments.length !== 3) return false;
  if (segments[0].length === 0) return false;
  if (segments[1] !== SEGMENT_SOURCE_AVATAR) return false;
  return NOM_SOURCE_AVATAR.test(segments[2]);
}
