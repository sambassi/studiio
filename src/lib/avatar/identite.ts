/**
 * L'IDENTITÉ AVATAR — une seule, la même dans Mon avatar, Créer et l'Autopilote.
 *
 * Trois choses distinctes, jamais confondues à l'écran :
 *
 *   « Avatar actif · vN »            la ligne `user_avatars` vivante validée, à
 *                                    sa version courante — celle que
 *                                    `resoudreJumeauDuCompte` relit avant
 *                                    CHAQUE génération (Créer, Autopilote) ;
 *   « Source de l'avatar »           la photo / vidéo importée qui a servi à
 *                                    le créer (`/api/avatar/source`) ;
 *   « Rendu récent avec cet avatar » une vidéo GÉNÉRÉE avec la version
 *                                    active (`avatar_generations`).
 *
 * Module PUR (aucun accès base, aucun appel fournisseur) : partagé par le
 * serveur et les écrans.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const versionValide = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** « Avatar actif · v3 » — l'identité utilisée pour les nouvelles générations. */
export function libelleAvatarActif(version: number): string {
  return `Avatar actif · v${version}`;
}

/** « Créé avec Avatar v2 » — l'identité d'un rendu déjà produit. */
export function libelleCreeAvecVersion(version: number): string {
  return `Créé avec Avatar v${version}`;
}

export const TITRE_SOURCE_AVATAR = 'Source de l’avatar';
export const TITRE_RENDU_RECENT = 'Rendu récent avec cet avatar';
export const AUCUN_RENDU_RECENT = 'Aucun rendu récent disponible.';
export const AVERTISSEMENT_ANCIENNE_VERSION = 'Cette vidéo utilise une ancienne version de votre avatar.';

/**
 * L'identifiant de la génération d'avatar qu'un rush désigne, ou `null`.
 *
 * Une vidéo de jumeau est re-hébergée sous `<userId>/avatar/<generationId>.mp4`
 * (`avancerStatutGeneration`). Tout autre rush — fichier importé, rush
 * Pexels, montage — rend `null` : ce n'est pas une génération d'avatar.
 */
export function generationDepuisRush(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /\/avatar\/([0-9a-f-]{36})\.mp4$/i.exec(url.split(/[?#]/)[0]);
  return m && UUID.test(m[1]) ? m[1] : null;
}

/**
 * La génération appartient-elle à une AUTRE version que la version active ?
 * Une version inconnue (génération antérieure au versionnement, lecture
 * impossible) n'est PAS déclarée périmée : on n'avertit que sur une preuve.
 */
export function versionPerimee(versionGeneration: unknown, versionActive: unknown): boolean {
  return versionValide(versionGeneration) && versionValide(versionActive) && versionGeneration !== versionActive;
}

export interface LigneRendu {
  id: string;
  user_avatar_id: string | null;
  avatar_version: number | null;
  status: string;
  video_url: string | null;
  created_at: string;
}

export interface RenduRecent {
  generationId: string;
  url: string;
  version: number;
  creeLe: string;
}

/**
 * Le rendu récent de l'avatar ACTIF : la génération terminée la plus récente
 * de CET avatar à CETTE version, dont la vidéo est bien la nôtre
 * (`estUrlReelle`). Jamais une génération d'une ancienne version, jamais une
 * génération en cours ou en échec, jamais une URL fournisseur — sinon `null`.
 */
export function choisirRenduRecent(
  lignes: readonly LigneRendu[],
  actif: { avatarId: string; version: number },
  estUrlReelle: (url: unknown, generationId: string) => boolean,
): RenduRecent | null {
  if (!versionValide(actif.version)) return null;
  const candidats = lignes
    .filter((g) => g.user_avatar_id === actif.avatarId && g.avatar_version === actif.version && g.status === 'completed')
    .filter((g) => estUrlReelle(g.video_url, g.id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const g = candidats[0];
  return g ? { generationId: g.id, url: g.video_url as string, version: actif.version, creeLe: g.created_at } : null;
}
