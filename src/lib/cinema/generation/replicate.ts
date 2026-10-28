/**
 * CINEMA IA — GENERATION REELLE par Replicate. Image, et image-vers-video.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE FOURNISSEUR DEPENSE DE L'ARGENT REEL
 * ─────────────────────────────────────────────────────────────────────────
 * Il est ETEINT par defaut et ne s'allume qu'avec DEUX conditions reunies :
 *
 *   1. `REPLICATE_API_TOKEN` present (la meme cle que `lib/ai/affiche-reference.ts`,
 *      deja utilisee par l'affiche de reference de l'Autopilote) ;
 *   2. `CINEMA_GENERATION_REELLE=true` — une decision explicite, jamais un defaut.
 *
 * Tant que l'une manque, `actif` vaut `false` et `atelier.ts` refuse AVANT de
 * construire quoi que ce soit : aucun appel, aucun centime.
 *
 * ⚠️ CE QUI N'EST PAS ENCORE FAIT, ET QUI COMPTE : la depense est bornee par le
 * plafond EN DOLLARS du serveur (`CINEMA_PLAFOND_USD`), PAS par les credits de
 * l'utilisateur. Elle est donc facturee au compte Replicate du proprietaire, et
 * non a celui qui genere. Relier cette generation au systeme de credits de
 * Studiio est un chantier a part, a faire avant d'ouvrir l'interrupteur a tous.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MODELES ET TARIFS — lus sur la page OFFICIELLE, avec leur date
 * ─────────────────────────────────────────────────────────────────────────
 * Regle du projet (en-tete de `couts.ts`) : un fournisseur ne s'active qu'avec
 * un tarif lu sur une page officielle, cite avec sa date. Lecture du 27/10/2026
 * sur https://replicate.com/pricing :
 *
 *   - `black-forest-labs/flux-schnell` : « $3.00 / thousand output images »
 *     → 0,003 $ par image.
 *   - image-vers-video : la page ne liste PAS `wan-2.2-i2v-fast`, que ce dépôt
 *     anticipait. Elle liste `wavespeedai/wan-2.1-i2v-480p` a « $0.09 / second of
 *     output video ». C'est donc CE modele qui est branche, au tarif officiel.
 *     Une video de 5 s coute ainsi 0,45 $ : c'est cher, et le plafond par film
 *     (2 $ par defaut) n'en laisse passer que quatre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DIAGNOSTIC « E002 » (2026-10-28) — modele, schema, et correctifs
 * ─────────────────────────────────────────────────────────────────────────
 * Deux animations ont echoue avec un code « E002 » qui n'est documente NULLE PART
 * (ni par Replicate — dont les codes d'erreur officiels font 4 chiffres a partir de
 * 1000 — ni par WaveSpeed, ni dans ce depot). La VERSION EXACTE du modele branche,
 * lue le 28/10/2026 sur le schema officiel servi par la page du modele
 * (`replicate.com/wavespeedai/wan-2.1-i2v-480p/api/schema`) :
 *
 *   id de version : `9fd3e244d9da1d6936c96b37584a941c25af001380334a5c194c1bc4fb413314`
 *   champs d'entree (requis : prompt, image) : prompt, image (format: uri),
 *   aspect_ratio (enum 16:9|9:16, defaut 16:9), fast_mode (enum, defaut Balanced),
 *   seed (integer, nullable, AUCUNE borne declaree dans le schema), sample_guide_scale
 *   (1-10), sample_steps (1-40), sample_shift (0-10), negative_prompt, lora_weights,
 *   lora_scale (0-4), disable_safety_checker.
 *
 * Trois ecarts reels trouves entre ce schema et l'appel envoye (corriges ci-dessous) :
 *   1. `aspect_ratio` n'etait jamais envoye → retombait sur le defaut `16:9` pour
 *      TOUT film, y compris les projets `9:16` (le format le plus courant).
 *   2. Le `seed` par defaut (`graineParDefaut`, `atelier.ts`) est un entier NON
 *      SIGNE 32 bits (`>>> 0`), donc jusqu'a 4294967295 — au-dela de l'intervalle
 *      [0, 2^31-1] que la plupart des bibliotheques d'alea (PyTorch, NumPy legacy,
 *      Cog lui-meme) traitent de maniere garantie. Le schema Replicate ne borne pas
 *      ce champ, donc CE N'EST PAS PROUVE comme la cause de E002 — mais c'est une
 *      incoherence reelle avec « une valeur sure », corrigee par principe.
 *   3. Le prompt video reutilisait la MEME construction que pour une IMAGE fixe
 *      (`mode: 'texte'`) : une description de scene statique, pas un mouvement a
 *      animer, et sans consigne explicite de preserver l'identite de l'image
 *      source. Un nouveau mode `'video'` (`lib/ai/prompt-image.ts`) decrit
 *      l'ANIMATION attendue et demande explicitement de garder le visage, la
 *      coiffure et la tenue de l'image fournie.
 *
 * AUCUNE preuve directe (log de prediction reel) n'a pu etre consultee ici — lecture
 * seule, aucun appel reel autorise pour cette mission. Le libelle exact du message
 * d'erreur (pas seulement « E002 ») reste le chainon manquant pour confirmer laquelle
 * de ces causes a reellement declenche les deux echecs.
 *
 * MODELE ALTERNATIF ENVISAGEABLE (propose, PAS branche, PAS appele) : si `wan-2.1-i2v-480p`
 * reste instable, `bytedance/seedance-1-lite` accepte aussi `image` + `last_frame_image`
 * et, en plus, jusqu'a 4 `reference_images` — utile pour la coherence de personnage — a
 * un tarif lu sur sa page officielle le 27/10/2026 de 0,018 $/s (480p) a 0,036 $/s (720p),
 * soit 2,5 a 5 fois moins cher que le modele actuel (0,09 $/s). Changer de modele est un
 * chantier a part (nouveau schema, nouveaux tests, nouvelle lecture de tarif datee) : non
 * fait dans ce diagnostic.
 */
import Replicate from 'replicate';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import {
  enregistrerFournisseur, type DemandeImageGeneration, type DemandeVideoGeneration,
  type FournisseurGenerationIA, type ResultatGenerationIA,
} from '@/lib/cinema/generation/fournisseur';
import type { FormatFilm } from '@/lib/cinema/types';

export const ID_REPLICATE_IMAGE = 'replicate-flux-schnell';
export const ID_REPLICATE_VIDEO = 'replicate-wan-i2v';

/** Modeles EXACTS, tels qu'ils sont tarifes sur la page officielle. */
export const MODELE_IMAGE = 'black-forest-labs/flux-schnell';
export const MODELE_VIDEO = 'wavespeedai/wan-2.1-i2v-480p';

/** Date de lecture des tarifs officiels — citee dans `couts.ts`. */
export const LECTURE_TARIFS = '2026-10-27';

/** Un appel ne tient pas la place indefiniment : au-dela, on annule. */
const DELAI_IMAGE_MS = 120_000;
const DELAI_VIDEO_MS = 600_000;
/** Duree bornee d'un plan video : le tarif est AU SECONDE. */
export const DUREE_VIDEO_MIN_S = 1;
export const DUREE_VIDEO_MAX_S = 5;

/** La generation reelle est-elle autorisee ? Les DEUX conditions, a chaque lecture. */
export function generationReelleActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const decision = env.CINEMA_GENERATION_REELLE?.trim().toLowerCase();
  if (decision !== 'true' && decision !== '1') return false;
  return !!env.REPLICATE_API_TOKEN?.trim();
}

/** Rapport d'aspect attendu par les modeles, depuis le format du film (`9:16` ou `16:9`). */
function rapport(format: FormatFilm): string {
  return format === '16:9' ? '16:9' : '9:16';
}

/** La premiere URL exploitable d'une sortie Replicate (chaine, tableau, ou objet a `url()`). */
function extraireUrl(sortie: unknown): string | null {
  if (typeof sortie === 'string') return sortie;
  if (Array.isArray(sortie)) {
    for (const e of sortie) { const u = extraireUrl(e); if (u) return u; }
    return null;
  }
  if (sortie && typeof sortie === 'object') {
    const o = sortie as { url?: unknown };
    if (typeof o.url === 'function') {
      try { return String((o.url as () => unknown)()); } catch { return null; }
    }
    if (typeof o.url === 'string') return o.url;
  }
  return null;
}

type ResultatAppel = { ok: true; url: string } | { ok: false; erreur: string; jamaisEnvoye?: boolean; incertain?: boolean };

/**
 * Appelle le modele et rend l'URL du resultat, ou un motif d'echec lisible.
 *
 * ⚠️ `incertain: true` EST POSE UNIQUEMENT QUAND NOTRE DELAI EXPIRE. A ce moment, notre
 * requete est abandonnee, mais rien ne dit que le fournisseur a lui-meme annule la
 * prediction : elle peut continuer, et etre facturee, sans que nous le sachions. C'est le
 * SEUL cas ou l'issue financiere reste incertaine — toute autre erreur (token absent,
 * reponse HTTP d'erreur, media illisible) est un echec COMPREHENSIBLE, pas un echec
 * EN SUSPENS.
 */
async function appeler(
  modele: string, entree: Record<string, unknown>, delaiMs: number,
): Promise<ResultatAppel> {
  const cle = process.env.REPLICATE_API_TOKEN?.trim();
  // Jamais envoye : le client Replicate n'a meme pas ete construit.
  if (!cle) return { ok: false, erreur: 'REPLICATE_API_TOKEN absent', jamaisEnvoye: true };

  const replicate = new Replicate({ auth: cle });
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delaiMs);
  let sortie: unknown;
  try {
    sortie = await replicate.run(modele as `${string}/${string}`, {
      input: entree,
      // MEME correctif que `lib/ai/affiche-reference.ts` (#425) : en mode `block`,
      // le SDK rend `null` au bout de ~60 s sur une prediction encore vivante.
      wait: { mode: 'poll' },
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      return { ok: false, erreur: `delai depasse (${Math.round(delaiMs / 1000)} s) — prediction annulee`, incertain: true };
    }
    return { ok: false, erreur: e instanceof Error ? e.message.slice(0, 140) : 'generation refusee par le fournisseur' };
  } finally {
    clearTimeout(minuteur);
  }

  const url = extraireUrl(sortie);
  if (!url && ctrl.signal.aborted) return { ok: false, erreur: 'delai depasse — prediction annulee', incertain: true };
  if (!url) return { ok: false, erreur: 'le fournisseur a repondu, mais sans media exploitable' };
  return { ok: true, url };
}

/** Rapatrie le media dans un fichier LOCAL : le reste de la chaine ne travaille que sur disque. */
async function rapatrier(url: string, extension: string): Promise<{ ok: true; fichier: string } | { ok: false; erreur: string }> {
  let octets: Buffer;
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, erreur: `rapatriement impossible (HTTP ${r.status})` };
    octets = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message.slice(0, 140) : 'rapatriement impossible' };
  }
  if (octets.length < 1024) return { ok: false, erreur: 'media rapatrie trop petit pour etre valide' };
  const fichier = path.join(os.tmpdir(), `cinema-replicate-${randomBytes(6).toString('hex')}.${extension}`);
  await writeFile(fichier, octets);
  return { ok: true, fichier };
}

async function genererImage(demande: DemandeImageGeneration): Promise<ResultatGenerationIA> {
  const r = await appeler(MODELE_IMAGE, {
    // Le prompt ANGLAIS deja construit par le systeme existant : rien a reconstruire ici.
    prompt: demande.promptConstruit || demande.promptPlan,
    aspect_ratio: rapport(demande.format),
    output_format: 'webp',
    // Reproductibilite : la meme graine rend la meme image.
    seed: demande.graine,
    num_outputs: 1,
  }, DELAI_IMAGE_MS);
  if (!r.ok) return { ok: false, erreur: `Replicate (image) : ${r.erreur}`, jamaisEnvoye: r.jamaisEnvoye, incertain: r.incertain };
  const f = await rapatrier(r.url, 'webp');
  if (!f.ok) return { ok: false, erreur: `Replicate (image) : ${f.erreur}` };
  return { ok: true, fichier: f.fichier, nomSuggere: `replicate-${demande.graine}.webp` };
}

async function genererVideo(demande: DemandeVideoGeneration): Promise<ResultatGenerationIA> {
  // ⚠️ ACCESSIBILITE VERIFIEE AVANT TOUT APPEL (diagnostic E002, 2026-10-28) : `sonderMedia`
  // (ffprobe local, deja utilise par `medias.ts` pour l'import manuel) confirme que le
  // fichier est REELLEMENT une image decodable, et donne ses dimensions reelles — jamais
  // devinees depuis l'extension ou les seuls octets de tete. Un fichier tronque, corrompu,
  // ou qui n'est pas une image est refuse ICI, avant tout centime depense.
  try {
    const { sonderMedia } = await import('@/lib/cinema/medias');
    const sonde = await sonderMedia(demande.fichierImageSource);
    if (!sonde || sonde.genre !== 'image') {
      return {
        ok: false, erreur: 'Replicate (video) : image source illisible ou inaccessible (sonde ffprobe)',
        jamaisEnvoye: true,
      };
    }
  } catch (e) {
    return {
      ok: false, erreur: `Replicate (video) : verification de l'image source impossible (${e instanceof Error ? e.message.slice(0, 80) : 'inconnu'})`,
      jamaisEnvoye: true,
    };
  }
  // L'image source est un fichier LOCAL : le modele veut une donnee, on lui passe un data URI.
  //
  // ⚠️ LE TYPE DECLARE DOIT ETRE CELUI DES OCTETS, PAS UNE SUPPOSITION. `genererImage`
  // produit du WEBP (`output_format: 'webp'`, plus haut), mais cette image etait ici
  // annoncee `image/png` sans jamais etre regardee — une incoherence reelle entre le
  // contenu et son en-tete. Meme principe que `lib/storage/image-signature.ts`, deja
  // applique a `lib/ai/affiche-reference.ts` : detecter le format reel, jamais le deviner.
  //
  // ⚠️ TAILLE (diagnostic E002, 2026-10-28) : la documentation OFFICIELLE de Replicate pour
  // les fichiers d'entree (`replicate.com/docs/topics/predictions/input-files`) dit qu'un
  // data URI inline « is only recommended if the file is less than 1MB » — au-dela, elle
  // recommande un VRAI upload (URL signee), comme le fait deja `lib/ai/affiche-reference.ts`
  // (`input_image: signerSiNotreStockage(...)`) pour un autre modele. Aucune limite stricte
  // n'est documentee au-dela de cette recommandation : la taille REELLE est donc mesuree et
  // jointe a toute erreur distante, plutot que devinee — une piste plus concrete que le seed
  // pour diagnostiquer un futur E002, non prouvee ici par manque d'acces aux logs.
  let image: string;
  let octetsImage = 0;
  try {
    const { readFile } = await import('fs/promises');
    const { detecterSignatureImage } = await import('@/lib/storage/image-signature');
    const octets = await readFile(demande.fichierImageSource);
    octetsImage = octets.length;
    const signature = detecterSignatureImage(octets);
    if (!signature) {
      return {
        ok: false, erreur: 'Replicate (video) : image source dans un format non reconnu (ni PNG, ni JPEG, ni WEBP)',
        jamaisEnvoye: true,
      };
    }
    image = `data:${signature.mime};base64,${octets.toString('base64')}`;
  } catch (e) {
    return {
      ok: false, erreur: `Replicate (video) : image source illisible (${e instanceof Error ? e.message.slice(0, 80) : 'inconnu'})`,
      jamaisEnvoye: true,
    };
  }
  // ⚠️ `prompt` EST OBLIGATOIRE : ce modele image-vers-video refuse (422) une prediction
  // sans texte decrivant le mouvement, meme avec une image. `num_frames` N'EST PAS un
  // champ de cette variante 480p (elle differe de la 720p qui l'accepte) : l'envoyer la
  // fait refuser aussi. La duree REELLE de la video produite est mesuree sur le fichier
  // rapatrie, jamais devinee depuis un parametre d'entree.
  if (!demande.prompt || !demande.prompt.trim()) {
    return { ok: false, erreur: 'Replicate (video) : prompt manquant — le fournisseur refuse une image seule', jamaisEnvoye: true };
  }
  // ⚠️ SANS CE CHAMP, LE MODELE RETOMBE SUR SON DEFAUT OFFICIEL (`16:9`) QUEL QUE SOIT LE
  // FORMAT REEL DU FILM (diagnostic E002, 2026-10-28) : un projet `9:16` — le format vertical
  // le plus courant sur Studiio — recevait silencieusement une video horizontale, deformee
  // au montage. Les deux seules valeurs acceptees par le schema officiel sont EXACTEMENT
  // celles que `rapport()` produit deja pour l'image.
  const r = await appeler(MODELE_VIDEO, { image, prompt: demande.prompt, seed: demande.graine, aspect_ratio: rapport(demande.format) }, DELAI_VIDEO_MS);
  if (!r.ok) {
    // La taille de l'image envoyee est jointe ICI, pas devinee apres coup : au-dela de 1 Mo,
    // Replicate ne recommande plus le data URI inline (voir le commentaire plus haut).
    const tailleMo = Math.round((octetsImage / 1_000_000) * 100) / 100;
    return {
      ok: false, erreur: `Replicate (video) : ${r.erreur} (image envoyee : ${tailleMo} Mo)`,
      jamaisEnvoye: r.jamaisEnvoye, incertain: r.incertain,
    };
  }
  const f = await rapatrier(r.url, 'mp4');
  if (!f.ok) return { ok: false, erreur: `Replicate (video) : ${f.erreur}` };
  return { ok: true, fichier: f.fichier, nomSuggere: `replicate-${demande.graine}.mp4` };
}

/** Image reelle. `actif` lu a CHAQUE usage : l'interrupteur agit sans redemarrage. */
export const FOURNISSEUR_REPLICATE_IMAGE: FournisseurGenerationIA = {
  id: ID_REPLICATE_IMAGE,
  libelle: `Image (Replicate, ${MODELE_IMAGE})`,
  get actif(): boolean { return generationReelleActive(); },
  genererImage,
  async genererVideo() { return { ok: false, erreur: 'ce fournisseur ne fait que des images' }; },
};

/** Image-vers-video reelle. */
export const FOURNISSEUR_REPLICATE_VIDEO: FournisseurGenerationIA = {
  id: ID_REPLICATE_VIDEO,
  libelle: `Video image-vers-video (Replicate, ${MODELE_VIDEO})`,
  get actif(): boolean { return generationReelleActive(); },
  async genererImage() { return { ok: false, erreur: 'ce fournisseur ne fait que des videos' }; },
  genererVideo,
};

enregistrerFournisseur(FOURNISSEUR_REPLICATE_IMAGE);
enregistrerFournisseur(FOURNISSEUR_REPLICATE_VIDEO);
