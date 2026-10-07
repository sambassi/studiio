/**
 * MEDIAS REQUIS D'UN RENDU — jamais de sequence noire en silence.
 *
 * L'apercu (DOM) peut afficher une video que le compositeur (canvas) ne
 * parvient pas a charger : la sequence etait alors retiree, ou peinte en
 * noir, et le MP4 partait « termine ». Regle produit : un media NECESSAIRE
 * qui ne se charge pas BLOQUE le rendu, avec un message clair, AVANT toute
 * reservation de credits.
 *
 * Ce module est volontairement sans dependance au compositeur : il est
 * appele par l'ecran AVANT d'ouvrir la tentative (`verifierMediasRequis`),
 * et par le compositeur lui-meme (`MediaIndisponibleError`) quand un media
 * passe la sonde mais ne se decode pas.
 */

/** Message montre a l'utilisateur : aucun nom de fournisseur, aucune URL. */
export const MESSAGE_VIDEO_INDISPONIBLE =
  'La vidéo de la séquence « Vidéo » n’a pas pu être chargée pour le rendu. '
  + 'Rien n’a été débité. Réessayez dans un instant, ou remplacez cette vidéo.';

/** Erreur levee quand un media necessaire au rendu est inaccessible. */
export class MediaIndisponibleError extends Error {
  readonly code = 'media_indisponible' as const;
  constructor(
    /** Sequence concernee. */
    readonly sequence: 'video',
    /** Cause technique, pour les journaux — jamais affichee telle quelle. */
    readonly cause: string,
    message: string = MESSAGE_VIDEO_INDISPONIBLE,
  ) {
    super(message);
    this.name = 'MediaIndisponibleError';
  }
}

/**
 * Exigence « la sequence Video est obligatoire », attachee a un objet
 * d'options SANS en devenir un champ : les options visuelles d'un rendu
 * restent identiques champ pour champ entre Creer et « Regenerer », et la
 * signature de reutilisation de l'apercu n'est pas touchee.
 *
 * OPT-IN : un objet non marque garde le comportement historique du
 * compositeur (video illisible = duree redistribuee sur titre et CTA).
 * Marque : une video demandee dont AUCUNE source ne se charge leve
 * `MediaIndisponibleError` avant le moindre enregistrement.
 */
const VIDEO_EXIGEE = new WeakSet<object>();
export function exigerVideo<T extends object>(options: T): T {
  VIDEO_EXIGEE.add(options);
  return options;
}
export function videoExigee(options: object | null | undefined): boolean {
  return !!options && VIDEO_EXIGEE.has(options);
}

export function estMediaIndisponible(err: unknown): err is MediaIndisponibleError {
  return err instanceof MediaIndisponibleError
    || (!!err && typeof err === 'object' && (err as { code?: unknown }).code === 'media_indisponible');
}

function origineCourante(): string | null {
  try {
    return typeof location !== 'undefined' && location.origin && location.origin !== 'null'
      ? location.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * URL absolue d'un media. Une URL relative (`/storage/v1/object/public/…`,
 * forme que le stockage de l'application renvoie) est resolue contre
 * l'origine de la page : c'est elle que le navigateur demandera, et c'est
 * donc elle qu'il faut sonder. `blob:` / `data:` / absolues : inchangees.
 */
export function resoudreUrlMedia(src: string, origine: string | null = origineCourante()): string {
  if (!src || /^(blob|data):/i.test(src)) return src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
  if (!origine) return src;
  try {
    return new URL(src, origine + '/').toString();
  } catch {
    return src;
  }
}

/** La ressource est-elle servie par l'origine de la page ? */
export function estMemeOrigine(src: string, origine: string | null = origineCourante()): boolean {
  if (!src || /^(blob|data):/i.test(src)) return true;
  if (src.startsWith('/') && !src.startsWith('//')) return true;
  if (!origine) return false;
  try {
    return new URL(src).origin === origine;
  } catch {
    return false;
  }
}

/** Le strict necessaire des options du compositeur pour ce controle. */
export interface OptionsMediasRequis {
  videoUrl?: string | null;
  videoDuration?: number;
  rushs?: readonly { url: string }[] | null;
  montage?: readonly { url: string }[] | null;
}

/**
 * Les sources de la sequence « Video » demandees au rendu. Vide quand la
 * sequence est masquee (duree nulle) ou sans video.
 */
export function sourcesVideoRequises(o: OptionsMediasRequis): string[] {
  if (!o.videoUrl || !((o.videoDuration ?? 10) > 0)) return [];
  const liste = [o.videoUrl, ...(o.montage ?? []).map((m) => m?.url), ...(o.rushs ?? []).map((r) => r?.url)]
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  return Array.from(new Set(liste));
}

export interface DepsVerification {
  fetch?: typeof fetch;
  origine?: string | null;
}

/**
 * Sonde, SANS rien telecharger (HEAD), les videos de la sequence « Video »
 * servies par NOTRE origine — la video du jumeau, les rushes televerses.
 *
 * Bloque (leve `MediaIndisponibleError`) si AUCUNE source de la sequence
 * n'est accessible. Un rush isole illisible parmi plusieurs reste saute par
 * le compositeur, comme avant : la sequence n'est alors pas noire.
 *
 * Les sources d'une autre origine ne sont pas sondees ici (un HEAD
 * cross-origin sans CORS echouerait a tort) : le compositeur les verifie au
 * chargement. Une erreur RESEAU sur la sonde ne bloque pas non plus — seule
 * une reponse explicite du serveur (404, 403, 5xx…) fait foi.
 */
export async function verifierMediasRequis(
  o: OptionsMediasRequis,
  deps: DepsVerification = {},
): Promise<void> {
  const sources = sourcesVideoRequises(o);
  if (sources.length === 0) return;
  const origine = deps.origine === undefined ? origineCourante() : deps.origine;
  const f = deps.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!f) return;

  const echecs: string[] = [];
  let accessibles = 0;
  for (const src of sources) {
    if (/^(blob|data):/i.test(src) || !estMemeOrigine(src, origine)) { accessibles++; continue; }
    const url = resoudreUrlMedia(src, origine);
    let res: Response;
    try {
      res = await f(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    } catch {
      accessibles++; // reseau : pas une preuve d'absence, le compositeur tranchera
      continue;
    }
    // 405/501 : le serveur ne sait pas repondre a HEAD — pas une absence.
    if (res.ok || res.status === 405 || res.status === 501) {
      const longueur = res.headers?.get?.('content-length');
      if (res.ok && longueur != null && longueur !== '' && Number(longueur) === 0) {
        echecs.push(`${url.slice(0, 120)} → fichier vide`);
        continue;
      }
      accessibles++;
    } else {
      echecs.push(`${url.slice(0, 120)} → HTTP ${res.status}`);
    }
  }

  if (accessibles === 0 && echecs.length > 0) {
    const cause = echecs.join(' ; ');
    console.error('[Rendu] MEDIA_INDISPONIBLE sequence=video', cause);
    throw new MediaIndisponibleError('video', cause);
  }
  if (echecs.length > 0) {
    console.warn('[Rendu] Rush(s) inaccessible(s), sautes par le montage :', echecs.join(' ; '));
  }
}
