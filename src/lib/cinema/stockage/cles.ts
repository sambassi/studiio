/**
 * CINEMA IA — les CLES des objets durables. Module pur, sans E/S.
 *
 * Tout ce que Cinema IA garde dans MinIO vit sous un seul prefixe :
 *
 *     <proprietaire>/cinema/<film>/…
 *
 * dans le compartiment `media`. Ce n'est pas un choix de rangement, c'est la
 * PREUVE DE PROPRIETE : le relais de stockage existant
 * (`/storage/v1/object/public/...`, `lib/storage/politique-relais.ts`) ne sert
 * une cle de compte qu'a son proprietaire (session), a un administrateur, ou
 * a qui porte un jeton signe par le serveur. Un film d'autrui n'est pas
 * lisible, et aucun fichier de Cinema IA ne se trouve dans `public/`.
 *
 * Le navigateur ne fournit JAMAIS une cle : il nomme un film et un plan, le
 * serveur fabrique la cle ici. C'est la meme doctrine que les vignettes
 * d'analyse (aucune cle a valider parce qu'aucune cle ne peut entrer).
 */
import { cleDuCompteStrict, cleObjetValide } from '@/lib/storage/acces-objet';
import { idFilmValide, mediaCinemaValide, referenceCinemaValide } from '@/lib/cinema/acces';

/** Le compartiment des objets Cinema IA — un compartiment deja autorise. */
export const BUCKET_CINEMA = 'media';

/** Un identifiant de compte sert de segment de chemin : il doit etre un seul segment propre. */
const MOTIF_PROPRIETAIRE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function proprietaireValide(id: unknown): id is string {
  return typeof id === 'string' && MOTIF_PROPRIETAIRE.test(id);
}

const MOTIF_SCENE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const MOTIF_EMPREINTE = /^[0-9a-f]{8}$/;
/** Nom de fichier de media : celui que `importerMedia` fabrique (`<plan>-<hex>.<ext>`). */
const MOTIF_NOM_MEDIA = /^s[0-9]+-p-[0-9]+-[0-9a-f]{8}\.(jpg|jpeg|png|webp|mp4|mov|webm|m4v)$/;

/** Prefixe d'un film : `<proprietaire>/cinema/<film>/`. `null` si une partie est refusee. */
export function prefixeFilm(proprietaire: string, filmId: string): string | null {
  if (!proprietaireValide(proprietaire) || !idFilmValide(filmId)) return null;
  return `${proprietaire}/cinema/${filmId}/`;
}

/** Ferme la porte : une cle fabriquee ici appartient bien a son compte, sans prefixe partage. */
function sceller(cle: string, proprietaire: string): string | null {
  if (!cleObjetValide(cle)) return null;
  if (!cleDuCompteStrict(cle, proprietaire)) return null;
  return cle;
}

/**
 * La cle d'un media de plan, depuis son chemin LOGIQUE (`cinema/<film>/medias/<nom>`,
 * celui que `film.scenes[].plans[].media.url` porte et que `mediaCinemaValide`
 * controle). Le chemin logique ne change pas : seul l'endroit ou il vit change.
 */
export function cleMedia(proprietaire: string, filmId: string, urlLogique: string): string | null {
  const prefixe = prefixeFilm(proprietaire, filmId);
  if (!prefixe || !mediaCinemaValide(urlLogique)) return null;
  const relatif = urlLogique.replace(/^\//, '');
  const attendu = `cinema/${filmId}/medias/`;
  if (!relatif.startsWith(attendu)) return null;
  const nom = relatif.slice(attendu.length);
  // Un seul segment, de la forme exacte que le serveur fabrique.
  if (!MOTIF_NOM_MEDIA.test(nom)) return null;
  return sceller(`${proprietaire}/${relatif}`, proprietaire);
}

/** L'image de reference d'un personnage, depuis son chemin logique (`cinema/<film>/references/<nom>`). */
export function cleReference(proprietaire: string, filmId: string, urlLogique: string): string | null {
  if (!prefixeFilm(proprietaire, filmId) || !referenceCinemaValide(urlLogique)) return null;
  if (!urlLogique.startsWith(`cinema/${filmId}/references/`)) return null;
  return sceller(`${proprietaire}/${urlLogique}`, proprietaire);
}

/** La voix d'UN plan, nommee par ce qu'elle dit et qui la dit : un texte modifie change de cle. */
export function cleVoix(proprietaire: string, filmId: string, planId: string, empreinteVoix: string): string | null {
  const prefixe = prefixeFilm(proprietaire, filmId);
  if (!prefixe || !/^s[0-9]+-p-[0-9]+$/.test(planId) || !MOTIF_EMPREINTE.test(empreinteVoix)) return null;
  return sceller(`${prefixe}voix/${planId}-${empreinteVoix}.mp3`, proprietaire);
}

/** Le MP4 d'UNE scene, nomme par l'empreinte de ce qui l'a produit. */
export function cleScene(proprietaire: string, filmId: string, sceneId: string, empreinte: string): string | null {
  const prefixe = prefixeFilm(proprietaire, filmId);
  if (!prefixe || !MOTIF_SCENE.test(sceneId) || !MOTIF_EMPREINTE.test(empreinte)) return null;
  return sceller(`${prefixe}scenes/${sceneId}-${empreinte}.mp4`, proprietaire);
}

/** Le MP4 du film recolle, nomme par l'empreinte de l'ensemble des scenes. */
export function cleFilmMp4(proprietaire: string, filmId: string, empreinteFilm: string): string | null {
  const prefixe = prefixeFilm(proprietaire, filmId);
  if (!prefixe || !MOTIF_EMPREINTE.test(empreinteFilm)) return null;
  return sceller(`${prefixe}exports/film-${empreinteFilm}.mp4`, proprietaire);
}
