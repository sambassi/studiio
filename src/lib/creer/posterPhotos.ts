/**
 * Photos proposées comme affiche — validation et repli de vignette.
 *
 * ⚠️ LES DEUX BUGS SIGNALÉS N'EN FONT QU'UN.
 *
 * `/api/pexels` construit ses entrées par enchaînement optionnel, SANS repli
 * final :
 *
 *     url: p.src?.large2x || p.src?.large        // Pexels
 *     url: p.urls?.regular || p.urls?.full       // Unsplash
 *
 * Une photo dont le fournisseur ne renvoie pas ces tailles arrive donc avec
 * `url: undefined`, et l'écran rangeait la réponse telle quelle. Deux
 * symptômes en découlent, qu'on prenait pour deux pannes :
 *
 * 1. La vignette s'affiche cassée — `src={undefined}` ne charge rien.
 * 2. Le glisser « ne marche pas » sur CES photos-là : le dépôt pose la chaîne
 *    « undefined » comme affiche, l'aperçu ne change pas, et on conclut que
 *    le geste a échoué.
 *
 * D'où deux filets, et pas un : on écarte à la RÉCEPTION ce qui n'a pas
 * d'URL exploitable, et on gère à l'AFFICHAGE l'image qui casse quand même —
 * une URL peut être valide et le fichier avoir disparu.
 */

export interface PosterPhotoLike {
  id: string | number;
  url?: unknown;
  medium?: unknown;
  small?: unknown;
  photographer?: unknown;
  source?: unknown;
}

export interface PosterPhotoValide {
  id: string | number;
  /** URL pleine résolution — celle qui devient l'affiche. */
  url: string;
  medium?: string;
  small?: string;
  photographer?: string;
  source?: string;
}

/**
 * Hotes qu'une photo ne doit jamais porter.
 *
 * Ces URL viennent d'un fournisseur externe : elles sont recopiees dans un
 * `src`, puis persistees dans les metadonnees d'un post. Une adresse locale
 * ou privee y ferait pointer l'affiche vers une machine du reseau de qui
 * ouvre la page — chez lui, pas chez nous.
 */
const HOTE_INTERNE = /^(localhost|.*\.local|.*\.internal|.*\.lan)$/i;
const IP_PRIVEE =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$|\[?fc|\[?fd)/i;

/**
 * Une URL exploitable comme image : HTTPS PUBLIC, et rien d'autre.
 *
 * `http://` etait accepte, et c'etait un reste d'avant HTTPS : studiio.pro
 * est servi en HTTPS, et Chrome bloque toute image en clair — la vignette
 * n'apparaissait pas, sans un mot dans l'interface pour le dire. Le filtre
 * la retire desormais de la grille plutot que de proposer un choix qui ne
 * s'affichera jamais.
 *
 * Les adresses locales et privees sont refusees pour la meme raison qu'a
 * l'ecriture : une adresse interne n'a rien a faire dans un navigateur, et
 * elle designerait le reseau du visiteur.
 */
export function urlUtilisable(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const brut = value.trim();
  if (!/^https:\/\/\S+$/i.test(brut)) return false;
  let u: URL;
  try { u = new URL(brut); } catch { return false; }
  if (HOTE_INTERNE.test(u.hostname)) return false;
  if (IP_PRIVEE.test(u.hostname)) return false;
  // Un hote sans point n'est pas un nom public.
  return u.hostname.includes('.');
}

/**
 * Tailles d'affichage, de la plus légère à la plus lourde.
 *
 * La vignette part du plus petit : charger douze images pleine résolution
 * pour une grille de 4 colonnes gaspille la bande passante de l'utilisateur.
 * La pleine résolution reste réservée à l'affiche elle-même.
 */
export function taillesVignette(photo: PosterPhotoValide): string[] {
  return [photo.small, photo.medium, photo.url].filter(urlUtilisable);
}

/**
 * Vignette à afficher, en sautant les tailles déjà connues comme cassées.
 *
 * Rend `null` quand toutes ont échoué : l'appelant masque alors la photo au
 * lieu de laisser une image brisée dans la grille.
 */
export function vignetteAffichable(
  photo: PosterPhotoValide,
  cassees: ReadonlySet<string>,
): string | null {
  return taillesVignette(photo).find((u) => !cassees.has(u)) ?? null;
}

/**
 * Une photo est-elle encore proposable ?
 *
 * Non seulement sa vignette doit s'afficher, mais son URL PLEINE doit être
 * saine : c'est elle qui deviendra le fond. Proposer une photo dont la
 * vignette marche et dont l'affiche est morte serait pire que de l'écarter.
 */
export function photoUtilisable(
  photo: PosterPhotoValide,
  cassees: ReadonlySet<string>,
): boolean {
  return !cassees.has(photo.url) && vignetteAffichable(photo, cassees) !== null;
}

/**
 * Écarte à la réception ce qui n'a pas d'URL exploitable, et dédoublonne.
 *
 * Le dédoublonnage est sur l'URL et non sur l'`id` : deux fournisseurs
 * peuvent renvoyer le même cliché sous deux identifiants, et le lot exige des
 * affiches réellement distinctes.
 */
export function sanitizePhotos(raw: unknown): PosterPhotoValide[] {
  if (!Array.isArray(raw)) return [];
  const vues = new Set<string>();
  const out: PosterPhotoValide[] = [];
  for (const brut of raw) {
    if (!brut || typeof brut !== 'object') continue;
    const p = brut as PosterPhotoLike;
    if (!urlUtilisable(p.url)) continue;
    const url = p.url.trim();
    if (vues.has(url)) continue;
    vues.add(url);
    out.push({
      id: typeof p.id === 'string' || typeof p.id === 'number' ? p.id : url,
      url,
      medium: urlUtilisable(p.medium) ? p.medium.trim() : undefined,
      small: urlUtilisable(p.small) ? p.small.trim() : undefined,
      photographer: typeof p.photographer === 'string' ? p.photographer : undefined,
      source: typeof p.source === 'string' ? p.source : undefined,
    });
  }
  return out;
}
