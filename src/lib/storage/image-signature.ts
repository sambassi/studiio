/**
 * Detection du type d'une image par ses octets de tete (« magic bytes »).
 *
 * Pure : aucune dependance, aucun acces reseau ou disque. Sert a refuser
 * tout ce qui n'est pas une vraie image AVANT de l'ecrire dans le stockage
 * et de facturer l'utilisateur — un fournisseur peut renvoyer une page HTML
 * d'erreur, du JSON, ou un GIF, avec un `Content-Type` trompeur.
 *
 * Seuls trois formats sont acceptes, ceux que l'editeur sait afficher et que
 * les modeles image de Replicate produisent (`output_format` png/jpg/webp).
 */

/**
 * Taille maximale d'une affiche IA acceptee en stockage (10 Mio). Vit ici et
 * non dans la route : un fichier `route.ts` ne peut exporter que ses
 * handlers, et cette borne est une propriete de l'image, pas de l'API.
 */
export const MAX_AFFICHE_IA_BYTES = 10 * 1024 * 1024;

export type SignatureImage = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function commencePar(bytes: Uint8Array, motif: number[], depuis = 0): boolean {
  if (bytes.length < depuis + motif.length) return false;
  for (let i = 0; i < motif.length; i++) {
    if (bytes[depuis + i] !== motif[i]) return false;
  }
  return true;
}

/**
 * Renvoie le mime et l'extension d'une image PNG, JPEG ou WEBP, ou `null`
 * pour tout autre contenu (GIF, SVG, HTML, texte, vide…).
 */
export function detecterSignatureImage(bytes: Uint8Array): SignatureImage | null {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  if (commencePar(bytes, PNG)) return { mime: 'image/png', ext: 'png' };
  if (commencePar(bytes, JPEG)) return { mime: 'image/jpeg', ext: 'jpg' };
  // WEBP : "RIFF" <4 octets de taille> "WEBP"
  if (commencePar(bytes, RIFF) && commencePar(bytes, WEBP, 8)) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}
