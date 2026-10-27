/**
 * MEDIAS DES PLANS — ce que le film montre vraiment.
 *
 * Lot 2 : un plan n'est plus seulement une carte dessinee, il peut porter une
 * IMAGE ou une VIDEO importee. Ce module est le seul a decider ce qu'est un
 * media acceptable, et il le fait en le MESURANT, jamais en le croyant :
 *
 *  - l'extension et le type MIME annonces par le client ne prouvent rien ;
 *    c'est `ffprobe` qui dit si le fichier est une image, une video, et avec
 *    quelles dimensions. Un `.mp4` qui n'en est pas est refuse a l'import,
 *    pas trois minutes plus tard au milieu d'un rendu Remotion ;
 *  - les dimensions mesurees servent au CADRAGE : le montage remplit le cadre
 *    sans jamais etirer l'image (`cover`), et `cadrage()` dit de combien il
 *    rogne, pour qu'un test puisse le verifier au lieu de le supposer ;
 *  - un media DECLARE mais ABSENT du disque est une erreur annoncee
 *    (`mediasManquants`), jamais une carte de secours posee en silence.
 */
import { stat } from 'fs/promises';
import path from 'path';
import type { Film, GenreMedia, MediaPlan } from '@/lib/cinema/types';
import { idPlanValide, mediaCinemaValide } from '@/lib/cinema/acces';

export type { GenreMedia, MediaPlan };
/**
 * ⚠️ `cadrage` et `dureePlanAvecMedia` vivent dans `types.ts`, pas ici, et
 * ne sont que RE-EXPORTES. Ce module touche au disque (`fs`, `ffprobe`) ;
 * le montage et la composition Remotion, eux, sont compiles pour le
 * NAVIGATEUR. Les y importer depuis ce fichier embarquait `fs` dans le
 * bundle webpack de Remotion, qui echouait sur « Can't resolve 'url' ».
 * Une fonction pure partagee avec le rendu appartient au type, pas au
 * module serveur.
 */
export { cadrage, dureePlanAvecMedia } from '@/lib/cinema/types';
export type { Cadrage } from '@/lib/cinema/types';

/** Extensions acceptees a l'import. La mesure tranche ensuite. */
export const EXTENSIONS_IMAGE = ['.jpg', '.jpeg', '.png', '.webp'] as const;
export const EXTENSIONS_VIDEO = ['.mp4', '.mov', '.webm', '.m4v'] as const;

/** Taille maximale d'un media importe (octets). */
export const TAILLE_MAX_MEDIA = 200 * 1024 * 1024;

/**
 * SIGNATURES des formats acceptes — lues sur les premiers octets, AVANT
 * d'ecrire quoi que ce soit.
 *
 * Un `.mp4` dont le contenu est en realite une liste de lecture (HLS,
 * `concat`) est un fichier texte : il n'a aucune de ces signatures, et il
 * n'atteint donc jamais ffprobe. C'est la premiere des deux defenses contre
 * un media qui ferait sortir une requete du serveur ; la seconde est le
 * verrou de protocole pose sur ffprobe lui-meme.
 */
export function signatureConnue(donnees: Uint8Array): GenreMedia | null {
  const a = (i: number) => donnees[i];
  const texte = (debut: number, mot: string) =>
    mot.split('').every((c, k) => a(debut + k) === c.charCodeAt(0));
  if (donnees.length < 12) return null;
  // PNG
  if (a(0) === 0x89 && texte(1, 'PNG')) return 'image';
  // JPEG
  if (a(0) === 0xff && a(1) === 0xd8 && a(2) === 0xff) return 'image';
  // RIFF .... WEBP
  if (texte(0, 'RIFF') && texte(8, 'WEBP')) return 'image';
  // ISO-BMFF (mp4, mov, m4v) : la taille, puis `ftyp`
  if (texte(4, 'ftyp')) return 'video';
  // Matroska / WebM
  if (a(0) === 0x1a && a(1) === 0x45 && a(2) === 0xdf && a(3) === 0xa3) return 'video';
  return null;
}

/**
 * Conteneurs que ffprobe a le droit de reconnaitre. Un format hors de cette
 * liste est refuse meme s'il est parfaitement lisible : `hls`, `concat` et
 * consorts savent aller chercher autre chose, ailleurs.
 */
export const CONTENEURS_AUTORISES = new Set([
  'mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm',
  'image2', 'png_pipe', 'jpeg_pipe', 'mjpeg', 'webp_pipe', 'webp',
]);

export function conteneurAutorise(formatName: string | null | undefined): boolean {
  if (!formatName) return false;
  const jetons = String(formatName).split(',').map((j) => j.trim()).filter(Boolean);
  return jetons.length > 0 && jetons.every((j) => CONTENEURS_AUTORISES.has(j));
}

export function extensionAcceptee(nom: string): { ok: true; genre: GenreMedia; ext: string } | { ok: false } {
  const ext = path.extname(nom).toLowerCase();
  if ((EXTENSIONS_IMAGE as readonly string[]).includes(ext)) return { ok: true, genre: 'image', ext };
  if ((EXTENSIONS_VIDEO as readonly string[]).includes(ext)) return { ok: true, genre: 'video', ext };
  return { ok: false };
}

/**
 * Ce que `ffprobe` dit du fichier. `null` s'il n'y voit pas un media lisible
 * — et c'est un refus, pas un avertissement.
 */
export async function sonderMedia(fichier: string): Promise<{ genre: GenreMedia; largeur: number; hauteur: number; dureeS: number | null } | null> {
  const { executer } = await import('@/lib/cinema/rendu-local');
  const { cheminFfprobe } = await import('@/lib/ffmpeg/binaires');
  const { stdout, code } = await executer(cheminFfprobe(), [
    '-v', 'error',
    // ⚠️ VERROU DE PROTOCOLE. Par defaut ffprobe sait parler http, tcp,
    // concat… et une « video » qui est en fait une liste de lecture lui fait
    // aller chercher une URL CHOISIE PAR L'APPELANT, depuis le serveur. Ici
    // il n'a le droit de lire qu'un fichier local, point.
    '-protocol_whitelist', 'file',
    '-show_entries', 'format=duration,format_name',
    '-show_entries', 'stream=codec_type,codec_name,width,height,nb_frames,duration',
    '-of', 'json', fichier,
  ], { timeoutMs: 30_000 });
  if (code !== 0) return null;

  try {
    const json = JSON.parse(stdout);
    const flux = (json?.streams ?? []).find((f: { codec_type?: string }) => f.codec_type === 'video');
    if (!flux?.width || !flux?.height) return null;

    // Une image fixe passe aussi par ffprobe : elle se reconnait a son
    // conteneur (`image2`, `png_pipe`, `jpeg_pipe`) ou a sa frame unique.
    const conteneur = String(json?.format?.format_name ?? '');
    // Un conteneur hors liste est refuse meme s'il est lisible.
    if (!conteneurAutorise(conteneur)) return null;
    const uneSeuleFrame = String(flux.nb_frames ?? '') === '1';
    const estImage = /image2|_pipe/.test(conteneur) || uneSeuleFrame;

    const bruteDuree = Number(json?.format?.duration ?? flux.duration);
    const dureeS = estImage || !Number.isFinite(bruteDuree) ? null : Math.round(bruteDuree * 100) / 100;
    // Une video sans duree lisible n'est pas montable : on ne sait pas quand
    // elle finit, donc on ne sait pas quand figer sa derniere image.
    if (!estImage && dureeS === null) return null;

    return { genre: estImage ? 'image' : 'video', largeur: flux.width, hauteur: flux.height, dureeS };
  } catch {
    return null;
  }
}

/** Le chemin absolu d'un media de plan, a partir de la racine `public/`. */
export function fichierDuMedia(racinePublique: string, url: string): string {
  return path.join(racinePublique, url.replace(/^\//, ''));
}

/**
 * Les plans dont le media est DECLARE mais introuvable.
 *
 * Appele AVANT tout rendu : produire un film avec un media manquant doit
 * echouer en nommant le plan, pas se rattraper sur une carte dessinee qui
 * ferait croire que le montage est celui qu'on voulait.
 */
export async function mediasManquants(
  film: Pick<Film, 'scenes'>,
  racinePublique: string,
): Promise<Array<{ sceneId: string; planId: string; url: string; motif: string }>> {
  const manquants: Array<{ sceneId: string; planId: string; url: string; motif: string }> = [];
  for (const scene of film.scenes) {
    for (const plan of scene.plans) {
      const media = plan.media;
      if (!media) continue;
      if (!mediaCinemaValide(media.url)) {
        manquants.push({ sceneId: scene.id, planId: plan.id, url: media.url, motif: 'chemin refuse' });
        continue;
      }
      try {
        const info = await stat(fichierDuMedia(racinePublique, media.url));
        if (!info.isFile() || info.size === 0) {
          manquants.push({ sceneId: scene.id, planId: plan.id, url: media.url, motif: 'fichier vide' });
        }
      } catch {
        manquants.push({ sceneId: scene.id, planId: plan.id, url: media.url, motif: 'fichier introuvable' });
      }
    }
  }
  return manquants;
}

/**
 * IMPORTER un media et l'attacher a un plan.
 *
 * Un seul chemin pour l'interface (route HTTP) et pour le banc : si le banc
 * importait autrement que l'application, il validerait une mecanique que
 * personne n'utilise.
 *
 * Ordre volontaire : ecrire, MESURER, puis seulement attacher. Un fichier que
 * ffprobe ne lit pas est efface et refuse — il ne reste pas sur le disque a
 * attendre de faire echouer un rendu.
 *
 * ⚠️ Le nom du fichier ecrit ne vient JAMAIS du client : il est compose de
 * l'identifiant du plan et d'un tirage aleatoire. Seule l'EXTENSION est
 * reprise, et uniquement si elle fait partie de la liste acceptee.
 */
export async function importerMedia(args: {
  film: Film;
  planId: string;
  nomOrigine: string;
  donnees: Buffer | Uint8Array;
  racinePublique: string;
  origine?: 'import' | 'genere';
}): Promise<{ ok: true; film: Film; media: MediaPlan } | { ok: false; erreur: string }> {
  const { mkdir, writeFile, rm } = await import('fs/promises');
  const { randomBytes } = await import('crypto');

  // Forme de l'id AVANT toute recherche : voir le commentaire de
  // `idPlanValide` (acces.ts) sur pourquoi ce controle est structurel et ne
  // doit pas dependre uniquement de « aucun plan de ce nom n'existe ».
  if (!idPlanValide(args.planId)) return { ok: false, erreur: 'identifiant de plan refuse' };

  const plan = args.film.scenes.flatMap((s) => s.plans).find((p) => p.id === args.planId);
  if (!plan) return { ok: false, erreur: 'plan inconnu' };

  const ext = extensionAcceptee(args.nomOrigine);
  if (!ext.ok) return { ok: false, erreur: 'extension refusee (jpg, png, webp, mp4, mov, webm, m4v)' };
  if (args.donnees.byteLength === 0) return { ok: false, erreur: 'fichier vide' };
  if (args.donnees.byteLength > TAILLE_MAX_MEDIA) return { ok: false, erreur: 'fichier trop volumineux (200 Mo maximum)' };

  // Les octets d'abord : rien n'est ECRIT sur le disque avant que le fichier
  // ne ressemble a ce qu'il pretend etre.
  const signature = signatureConnue(args.donnees);
  if (!signature) return { ok: false, erreur: 'contenu non reconnu : ni image ni video' };
  if (signature !== ext.genre) {
    return { ok: false, erreur: `le contenu est ${signature}, l'extension annonce ${ext.genre}` };
  }

  const relatif = path.posix.join('cinema', args.film.id, 'medias', `${args.planId}-${randomBytes(4).toString('hex')}${ext.ext}`);
  if (!mediaCinemaValide(relatif)) return { ok: false, erreur: 'chemin de media refuse' };

  const fichier = fichierDuMedia(args.racinePublique, relatif);
  await mkdir(path.dirname(fichier), { recursive: true });
  await writeFile(fichier, args.donnees);

  const mesure = await sonderMedia(fichier);
  if (!mesure) {
    await rm(fichier, { force: true }).catch(() => {});
    return { ok: false, erreur: 'fichier illisible : ni image ni video exploitable' };
  }
  if (mesure.genre !== ext.genre) {
    await rm(fichier, { force: true }).catch(() => {});
    return { ok: false, erreur: `le contenu est ${mesure.genre}, l'extension annonce ${ext.genre}` };
  }

  const media: MediaPlan = {
    url: relatif,
    genre: mesure.genre,
    largeur: mesure.largeur,
    hauteur: mesure.hauteur,
    dureeS: mesure.dureeS,
    octets: args.donnees.byteLength,
    origine: args.origine ?? 'import',
    sonActif: false,
  };

  return { ok: true, media, film: remplacerMedia(args.film, args.planId, media) };
}

/** Pose (ou retire) le media d'un plan, sans toucher au reste du film. */
export function remplacerMedia(film: Film, planId: string, media: MediaPlan | null): Film {
  return {
    ...film,
    scenes: film.scenes.map((scene) => ({
      ...scene,
      plans: scene.plans.map((plan) => (plan.id === planId ? { ...plan, media } : plan)),
    })),
  };
}

/** Garder ou couper le son d'un media deja attache. */
export function reglerSonMedia(film: Film, planId: string, sonActif: boolean): Film {
  const plan = film.scenes.flatMap((s) => s.plans).find((p) => p.id === planId);
  if (!plan?.media) return film;
  return remplacerMedia(film, planId, { ...plan.media, sonActif });
}
