/**
 * PRÉPARER UNE PHOTO SOURCE — les règles PURES (aucun réseau, aucun binaire).
 *
 * Même principe que la vidéo (`preparation-source-regles.ts`), même filtre :
 * « Embellir le visage » = `bilateral` de ffmpeg (lissage des zones
 * uniformes, contours nets), AUCUNE transformation géométrique. Le traitement
 * tourne sur le serveur Studiio, avec le ffmpeg déjà utilisé pour la vidéo :
 * aucun fournisseur, aucun frais.
 *
 * NON DESTRUCTIF : l'original importé reste tel quel en stockage ; la photo
 * embellie est un SECOND objet. « Aucun » = l'original lui-même, sans
 * ré-encodage.
 *
 * Orientation : un téléphone enregistre souvent l'image couchée, avec une
 * étiquette EXIF « à tourner ». ffmpeg (selon sa version) l'applique ou non ;
 * on lit donc l'étiquette NOUS-MÊMES, on désactive la rotation automatique
 * (`-noautorotate`) et on pose la rotation explicite — la photo embellie a
 * toujours le sens que montre le navigateur, quelle que soit la version de
 * ffmpeg. La sortie n'a plus d'EXIF (ni lieu, ni appareil, ni orientation).
 */
import { filtreEmbellissement, estNiveauEmbellissement, type NiveauEmbellissement } from '@/lib/avatar/preparation-source-regles';

/** Types de photo acceptés → extension de stockage. */
export const TYPES_PHOTO_ACCEPTES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** 10 Mo — la limite déjà annoncée à l'import d'une photo. */
export const TAILLE_MAX_PHOTO_OCTETS = 10 * 1024 * 1024;

/** Le niveau demandé, ramené aux valeurs connues ; tout le reste = `aucun`. */
export function bornerEmbellissementPhoto(v: unknown): NiveauEmbellissement {
  return estNiveauEmbellissement(v) ? v : 'aucun';
}

/**
 * L'orientation EXIF (1–8) d'un JPEG, `1` si absente ou illisible. Lecture
 * BORNÉE : on ne suit que les segments JPEG jusqu'au premier APP1 « Exif »,
 * sans jamais lire hors du tampon.
 */
export function orientationExif(octets: Uint8Array): number {
  const u16 = (o: number, le: boolean) => (le ? octets[o] | (octets[o + 1] << 8) : (octets[o] << 8) | octets[o + 1]);
  const u32 = (o: number, le: boolean) => (le
    ? (octets[o] | (octets[o + 1] << 8) | (octets[o + 2] << 16) | (octets[o + 3] << 24)) >>> 0
    : ((octets[o] << 24) | (octets[o + 1] << 16) | (octets[o + 2] << 8) | octets[o + 3]) >>> 0);
  if (octets.length < 4 || octets[0] !== 0xff || octets[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 <= octets.length) {
    if (octets[p] !== 0xff) return 1;
    const marqueur = octets[p + 1];
    if (marqueur === 0xda || marqueur === 0xd9) return 1; // début de l'image : plus d'en-têtes
    const longueur = u16(p + 2, false);
    if (longueur < 2 || p + 2 + longueur > octets.length) return 1;
    if (marqueur === 0xe1 && longueur >= 16
      && octets[p + 4] === 0x45 && octets[p + 5] === 0x78 && octets[p + 6] === 0x69 && octets[p + 7] === 0x66) {
      const t = p + 10; // début de l'en-tête TIFF
      const le = octets[t] === 0x49 && octets[t + 1] === 0x49;
      if (!le && !(octets[t] === 0x4d && octets[t + 1] === 0x4d)) return 1;
      const ifd = t + u32(t + 4, le);
      const fin = p + 2 + longueur;
      if (ifd + 2 > fin) return 1;
      const n = u16(ifd, le);
      for (let i = 0; i < n; i += 1) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > fin) return 1;
        if (u16(e, le) === 0x0112) {
          const v = u16(e + 8, le);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    p += 2 + longueur;
  }
  return 1;
}

/** L'orientation EXIF → les filtres ffmpeg qui la redressent (rotations / miroirs, sans déformation). */
export function filtresOrientation(o: number): string[] {
  switch (o) {
    case 2: return ['hflip'];
    case 3: return ['hflip', 'vflip'];
    case 4: return ['vflip'];
    case 5: return ['transpose=0'];
    case 6: return ['transpose=1'];
    case 7: return ['transpose=3'];
    case 8: return ['transpose=2'];
    default: return [];
  }
}

/** Démultiplexeurs d'IMAGE seulement, fichier local seulement (même garde que la vidéo). */
export const PROTECTIONS_ENTREE_PHOTO = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'image2,jpeg_pipe,png_pipe,webp_pipe',
] as const;

/**
 * Les arguments ffmpeg d'une photo embellie : redressement EXIF, PUIS le
 * filtre bilatéral, sortie JPEG de haute qualité, sans métadonnées. Rien
 * d'autre — ni recadrage, ni mise à l'échelle, ni déformation.
 */
export function argumentsFfmpegPhoto(entree: string, sortie: string, niveau: NiveauEmbellissement, orientation: number): string[] {
  const embellir = filtreEmbellissement(niveau);
  const filtres = [...filtresOrientation(orientation), ...(embellir ? [embellir] : []), 'format=yuvj444p'];
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-noautorotate',
    '-f', 'image2', '-pattern_type', 'none',
    '-i', entree,
    '-map_metadata', '-1',
    '-vf', filtres.join(','),
    '-frames:v', '1',
    '-c:v', 'mjpeg', '-q:v', '2',
    sortie,
  ];
}
