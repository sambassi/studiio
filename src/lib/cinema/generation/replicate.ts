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

/** Appelle le modele et rend l'URL du resultat, ou un motif d'echec lisible. */
async function appeler(
  modele: string, entree: Record<string, unknown>, delaiMs: number,
): Promise<{ ok: true; url: string } | { ok: false; erreur: string }> {
  const cle = process.env.REPLICATE_API_TOKEN?.trim();
  if (!cle) return { ok: false, erreur: 'REPLICATE_API_TOKEN absent' };

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
    if (ctrl.signal.aborted) return { ok: false, erreur: `delai depasse (${Math.round(delaiMs / 1000)} s) — prediction annulee` };
    return { ok: false, erreur: e instanceof Error ? e.message.slice(0, 140) : 'generation refusee par le fournisseur' };
  } finally {
    clearTimeout(minuteur);
  }

  const url = extraireUrl(sortie);
  if (!url && ctrl.signal.aborted) return { ok: false, erreur: 'delai depasse — prediction annulee' };
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
  if (!r.ok) return { ok: false, erreur: `Replicate (image) : ${r.erreur}` };
  const f = await rapatrier(r.url, 'webp');
  if (!f.ok) return { ok: false, erreur: `Replicate (image) : ${f.erreur}` };
  return { ok: true, fichier: f.fichier, nomSuggere: `replicate-${demande.graine}.webp` };
}

async function genererVideo(demande: DemandeVideoGeneration): Promise<ResultatGenerationIA> {
  // L'image source est un fichier LOCAL : le modele veut une donnee, on lui passe un data URI.
  let image: string;
  try {
    const { readFile } = await import('fs/promises');
    const octets = await readFile(demande.fichierImageSource);
    image = `data:image/png;base64,${octets.toString('base64')}`;
  } catch (e) {
    return { ok: false, erreur: `Replicate (video) : image source illisible (${e instanceof Error ? e.message.slice(0, 80) : 'inconnu'})` };
  }
  // ⚠️ `prompt` EST OBLIGATOIRE : ce modele image-vers-video refuse (422) une prediction
  // sans texte decrivant le mouvement, meme avec une image. `num_frames` N'EST PAS un
  // champ de cette variante 480p (elle differe de la 720p qui l'accepte) : l'envoyer la
  // fait refuser aussi. La duree REELLE de la video produite est mesuree sur le fichier
  // rapatrie, jamais devinee depuis un parametre d'entree.
  if (!demande.prompt || !demande.prompt.trim()) {
    return { ok: false, erreur: 'Replicate (video) : prompt manquant — le fournisseur refuse une image seule' };
  }
  const r = await appeler(MODELE_VIDEO, { image, prompt: demande.prompt, seed: demande.graine }, DELAI_VIDEO_MS);
  if (!r.ok) return { ok: false, erreur: `Replicate (video) : ${r.erreur}` };
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
