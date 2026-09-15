/**
 * La FORME d'une clé de source d'avatar — et rien d'autre.
 *
 * Module PUR : aucune base, aucun stockage, aucune session, aucun aléa. Il
 * existe pour que le relais public de stockage et la route privée de lecture
 * reconnaissent une source avec la MÊME règle que celle qui la construit
 * (`@/lib/avatar/source`), sans tirer Supabase ni MinIO dans un relais qui
 * n'en a pas besoin — et sans jamais recopier le motif.
 *
 * Une source est un visage. Deux formes de nom coexistent :
 *
 *   source-<horodatage>.<ext>            HISTORIQUE — écrite par le POST
 *                                        d'avant AVATAR-2A (`Date.now()`)
 *   source-<horodatage>-<nonce>.<ext>    AVATAR-2A — le nonce (32 hexa,
 *                                        `crypto.randomBytes(16)`) rend deux
 *                                        clés de la même milliseconde
 *                                        distinctes : aucune requête ne peut
 *                                        écraser ni retirer celle d'une autre
 *
 * Une vidéo générée, sous le même dossier, est `<generationId>.mp4` : le NOM
 * suffit à la distinguer, et c'est ce que ce module sait faire.
 *
 * Deux autres objets PRIVÉS vivent sous le même dossier depuis le fournisseur
 * D-ID, et sont fermés au relais public au même titre qu'une source :
 *
 *   consent-<horodatage>-<nonce>.<ext>   la vidéo de CONSENTEMENT lue à la
 *                                        caméra (un visage, une voix)
 *   audio-<generationId>.mp3             l'audio de MA voix pour un aperçu
 *                                        (donnée biométrique, jamais publique)
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

/** Longueur du nonce en hexadécimal : 16 octets → 32 caractères. */
export const LONGUEUR_NONCE_SOURCE = 32;

/** `source-<horodatage>[-<nonce>].<ext>` — le NOM d'une source, et de rien d'autre. */
export const NOM_SOURCE_AVATAR = new RegExp(
  `^source-(\\d{1,16})(?:-([0-9a-f]{${LONGUEUR_NONCE_SOURCE}}))?\\.(${EXTENSIONS})$`,
);

/** Le type MIME d'une source d'après sa clé ; `null` si ce n'est pas une source. */
export function typeSourceAvatar(cle: string): string | null {
  const nom = cle.slice(cle.lastIndexOf('/') + 1);
  const m = NOM_SOURCE_AVATAR.exec(nom);
  return m ? TYPES_SOURCE_AUTORISES[m[3]] : null;
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
 * `<quelque chose>/avatar/source-…`, exactement trois segments. C'est la
 * question que pose le relais public, qui ne connaît pas de compte : une
 * source n'est jamais publique, à qui qu'elle appartienne.
 */
export function estCleSourceAvatar(cle: unknown): cle is string {
  return nomSousDossierAvatar(cle, NOM_SOURCE_AVATAR);
}

/** Vidéo de consentement fournisseur : `consent-<horodatage>-<nonce>.<ext>` — formats vidéo seulement. */
export const EXTENSIONS_CONSENTEMENT = ['mp4', 'mov'] as const;
export const NOM_CONSENTEMENT_AVATAR = new RegExp(
  `^consent-(\\d{1,16})-([0-9a-f]{${LONGUEUR_NONCE_SOURCE}})\\.(${EXTENSIONS_CONSENTEMENT.join('|')})$`,
);
export function estCleConsentementAvatar(cle: unknown): cle is string {
  return nomSousDossierAvatar(cle, NOM_CONSENTEMENT_AVATAR);
}

/** Audio d'une génération (ma voix) : `audio-<generationId>.mp3`. */
export const NOM_AUDIO_AVATAR = /^audio-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.mp3$/i;
export function estCleAudioAvatar(cle: unknown): cle is string {
  return nomSousDossierAvatar(cle, NOM_AUDIO_AVATAR);
}

/**
 * Cette clé nomme-t-elle un objet PRIVÉ du dossier avatar — source,
 * consentement ou audio ? C'est la question que pose le relais public : ces
 * trois-là ne se servent jamais sans session, à qui qu'ils appartiennent.
 * Une vidéo générée (`<uuid>.mp4`) n'en fait pas partie.
 */
export function estClePriveeAvatar(cle: unknown): cle is string {
  return estCleSourceAvatar(cle) || estCleConsentementAvatar(cle) || estCleAudioAvatar(cle);
}

/** `<quelque chose>/avatar/<nom>`, exactement trois segments, le nom pris dans un motif fermé. */
function nomSousDossierAvatar(cle: unknown, motif: RegExp): cle is string {
  if (typeof cle !== 'string') return false;
  const segments = cle.split('/');
  if (segments.length !== 3) return false;
  if (segments[0].length === 0) return false;
  if (segments[1] !== SEGMENT_SOURCE_AVATAR) return false;
  return motif.test(segments[2]);
}
