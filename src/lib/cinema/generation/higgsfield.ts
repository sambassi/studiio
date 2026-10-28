/**
 * CINEMA IA — CONNECTEUR HIGGSFIELD. Image, et image-vers-video.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ETEINT PAR DEFAUT, ET ETEINT PAR TROIS CONDITIONS, PAS UNE
 * ─────────────────────────────────────────────────────────────────────────
 * Ce fournisseur depenserait de l'argent reel. Il ne s'allume que si les
 * TROIS conditions sont reunies :
 *
 *   1. `CINEMA_FOURNISSEUR=higgsfield` — un choix EXPLICITE. Sans cette
 *      variable, le fournisseur reel reste Replicate, exactement comme
 *      aujourd'hui : ce module n'enleve rien et ne remplace rien ;
 *   2. `CINEMA_GENERATION_REELLE=true` — le meme interrupteur que Replicate,
 *      inchange ;
 *   3. `HIGGSFIELD_API_KEY_ID` ET `HIGGSFIELD_API_KEY_SECRET` presents (cles
 *      SERVEUR, jamais `NEXT_PUBLIC_*`).
 *
 * Tant qu'une seule manque, `actif` vaut `false` et `atelier.ts` refuse AVANT
 * de construire quoi que ce soit : aucun appel, aucun centime.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ESTIMATION EST OBLIGATOIRE, ET ELLE PEUT REFUSER
 * ─────────────────────────────────────────────────────────────────────────
 * Higgsfield publie un endpoint d'estimation : `POST /estimate/<modele>`, avec
 * le MEME corps que la generation, qui rend `{"usd": "0.094"}` — et la
 * documentation dit que cette valeur, pour le compte authentifie, fait foi
 * (`docs.higgsfield.ai/docs/concepts/billing-and-retention`, lu le 2026-10-28).
 *
 * Elle est appelee AVANT chaque generation, et le prix rendu est compare au
 * BUDGET PAR UNITE declare dans `generation/couts.ts`. Trois refus, dans cet
 * ordre, tous AVANT la moindre soumission payante :
 *
 *   1. budget par unite inconnu (`usdParUnite: null`) → refus ;
 *   2. estimation illisible (erreur HTTP, corps inattendu) → refus ;
 *   3. estimation SUPERIEURE au budget declare → refus, avec les deux
 *      chiffres dans le message.
 *
 * Deux proprietes utiles tombent de la :
 *
 *   - le chiffre affiche et debite n'est plus une lecture de page marketing,
 *     c'est le prix du compte ;
 *   - l'estimation prend le MEME corps que la generation, donc une erreur de
 *     schema (champ inconnu, valeur hors bornes) remonte en 422 SUR
 *     L'ESTIMATION, c'est-a-dire avant qu'un centime soit engage. C'est un
 *     pre-vol gratuit, pas seulement un devis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MODELES ET SCHEMAS — lus sur la documentation OFFICIELLE, avec leur date
 * ─────────────────────────────────────────────────────────────────────────
 * Lecture du 2026-10-28.
 *
 * IMAGE — `POST /higgsfield-ai/soul/v2/standard` (chemin du quickstart
 * officiel). Corps : `prompt` (requis). `aspect_ratio` est documente sur la
 * variante v1 (`/higgsfield-ai/soul/standard`, `openapi.json`) avec `9:16` et
 * `16:9` parmi les valeurs acceptees ; il est envoye ici parce qu'un film
 * Cinema IA a un format, et qu'un defaut `4:3` silencieux serait le meme bug
 * que l'`aspect_ratio` oublie de Replicate (diagnostic E002). ⚠️ LE SCHEMA DE
 * LA v2 N'EST PAS PUBLIE dans `openapi.json` : si l'API refusait ce champ,
 * c'est l'ESTIMATION qui le dirait, en 422, gratuitement — voir plus haut.
 *
 * VIDEO — `POST /kling-video/v2.5-turbo/standard/image-to-video`, schema lu
 * dans `openapi.json` : `prompt` (requis), `image_url` (requis, URI),
 * `duration` (entier, 5 ou 10 SEULEMENT, defaut 5), `cfg_scale` (0 a 1,
 * defaut 0.5), `negative_prompt`. Ce modele ne prend NI resolution NI
 * aspect_ratio : le cadrage vient de l'image source, donc un film 9:16 rend
 * une video 9:16 sans rien demander — c'est precisement le piege E002 qui ne
 * peut pas se reproduire ici.
 *
 * ⚠️ POURQUOI PAS « HAPPY HORSE », QUI EST POURTANT LE MODELE IMAGE-VERS-VIDEO
 * LE PLUS CAPABLE (duree 2 a 15 s, 720p/1080p) : son tarif n'est publie sur
 * AUCUNE page officielle lisible sans compte. Le tableau de tarifs du blog
 * officiel ne liste que Kling, Seedance, PixVerse, MiniMax, LTX, Wan, DoP et
 * les modeles d'image. Appliquer a Happy Horse le prix de Kling serait
 * exactement l'erreur que ce depot s'interdit depuis `couts.ts` : il est donc
 * DECLARE avec un budget `null` dans le catalogue (donc refuse par le
 * plafond), et il attend qu'on lise son prix dans la console Higgsfield.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI PROTEGE L'ARGENT, EN PLUS DU BUDGET
 * ─────────────────────────────────────────────────────────────────────────
 *   - `Idempotency-Key` sur chaque soumission (documente par Higgsfield) :
 *     le SEUL reessai fait ici — apres un echec reseau ou un 5xx sur la
 *     soumission — rejoue la MEME cle, donc ne peut pas creer une seconde
 *     generation facturee. C'est la reponse directe au double-debit observe
 *     en production cote Replicate.
 *   - `failed` et `nsfw` ne sont PAS factures par Higgsfield (« Failed and
 *     NSFW requests are not charged; any reserved amount is refunded »,
 *     meme page, meme date) : ces deux issues rendent `nonFacture: true`, ce
 *     qui libere la reservation de depense au lieu de la compter.
 *   - les fichiers Higgsfield vivent 7 jours : le resultat est rapatrie en
 *     LOCAL immediatement, puis passe par les MEMES controles qu'un import
 *     manuel (`atelier.ts` → `medias.importerMedia`).
 *   - `status_url` vient de la REPONSE du fournisseur : il n'est suivi que
 *     s'il pointe sur `api.higgsfield.ai` (sinon une reponse alteree nous
 *     ferait interroger n'importe quel hote). L'annulation n'utilise PAS le
 *     `cancel_url` rendu : son chemin est reconstruit depuis un `request_id`
 *     valide, sur l'hote officiel.
 *   - a l'expiration de l'attente, la demande est annulee si elle est encore
 *     en file (202 = non facturee) ; sinon la depense reste `incertain`.
 */
import os from 'os';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import {
  enregistrerFournisseur, type DemandeImageGeneration, type DemandeVideoGeneration,
  type FournisseurGenerationIA, type ResultatGenerationIA,
} from '@/lib/cinema/generation/fournisseur';
import { coutUniteGeneration } from '@/lib/cinema/generation/couts';
import type { FormatFilm } from '@/lib/cinema/types';

export const ID_HIGGSFIELD_IMAGE = 'higgsfield-soul2';
export const ID_HIGGSFIELD_VIDEO = 'higgsfield-kling25-i2v';
/** Declare, mais sans tarif verifie : refuse par le plafond tant que son prix n'est pas lu. */
export const ID_HIGGSFIELD_VIDEO_HAPPYHORSE = 'higgsfield-happyhorse-i2v';

export const BASE_HIGGSFIELD = 'https://api.higgsfield.ai';
export const HOTE_HIGGSFIELD = 'api.higgsfield.ai';

/** Chemins EXACTS, tels que la documentation officielle les ecrit. */
export const MODELE_IMAGE_HF = 'higgsfield-ai/soul/v2/standard';
export const MODELE_VIDEO_HF = 'kling-video/v2.5-turbo/standard/image-to-video';

/** Date de lecture de la documentation et des tarifs officiels — citee dans `couts.ts`. */
export const LECTURE_HF = '2026-10-28';

/** Les DEUX seules durees acceptees par le schema officiel du modele video. */
export const DUREES_VIDEO_HF: readonly number[] = [5, 10];

const DELAI_IMAGE_MS = 120_000;
const DELAI_VIDEO_MS = 600_000;
/** Une estimation est une simple question de prix : elle ne doit pas retenir la chaine. */
const DELAI_ESTIMATION_MS = 20_000;
/** Attente entre deux lectures de statut : courte au debut, puis plus espacee. */
const ATTENTE_MIN_MS = 2_000;
const ATTENTE_MAX_MS = 10_000;
/** Un telechargement bloque ne doit pas geler le travail du film indefiniment. */
const DELAI_RAPATRIEMENT_MS = 120_000;
/** Un plan anime de 10 s pese quelques Mo : au-dela, la reponse n'est pas un media attendu. */
export const TAILLE_MAX_RAPATRIEMENT = 200 * 1024 * 1024;
/** `request_id` est documente comme un UUID : toute autre forme n'est jamais placee dans un chemin. */
const ID_REQUETE_SUR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les cles sont-elles presentes ? (condition 3 sur 3) */
export function higgsfieldConfigure(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.HIGGSFIELD_API_KEY_ID?.trim() && !!env.HIGGSFIELD_API_KEY_SECRET?.trim();
}

/** Le fournisseur REEL choisi par le serveur est-il Higgsfield ? (condition 1 sur 3) */
export function higgsfieldChoisi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CINEMA_FOURNISSEUR?.trim().toLowerCase() === 'higgsfield';
}

/**
 * LES TROIS CONDITIONS, relues a CHAQUE usage : l'interrupteur agit sans
 * redemarrage, comme pour Replicate.
 */
export function higgsfieldActif(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!higgsfieldChoisi(env)) return false;
  const decision = env.CINEMA_GENERATION_REELLE?.trim().toLowerCase();
  if (decision !== 'true' && decision !== '1') return false;
  return higgsfieldConfigure(env);
}

function enTetes(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    Authorization: `Key ${env.HIGGSFIELD_API_KEY_ID?.trim()}:${env.HIGGSFIELD_API_KEY_SECRET?.trim()}`,
    'Content-Type': 'application/json',
  };
}

/** Rapport d'aspect, depuis le format du film — meme correspondance que l'image Replicate. */
function rapport(format: FormatFilm): string {
  return format === '16:9' ? '16:9' : '9:16';
}

/** La duree la plus proche PARMI celles que le modele accepte, jamais une valeur inventee. */
export function dureeVideoAutorisee(dureeS: number): number {
  const triees = [...DUREES_VIDEO_HF].sort((a, b) => a - b);
  for (const d of triees) if (dureeS <= d) return d;
  return triees[triees.length - 1];
}

/** Une URL rendue par le fournisseur n'est suivie que si elle pointe bien chez lui. */
export function urlHiggsfieldSure(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== HOTE_HIGGSFIELD) return null;
    return u.toString();
  } catch { return null; }
}

/** Une URL de telechargement (stockage du fournisseur) : https obligatoire, hote libre. */
function urlHttpsSure(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try { const u = new URL(url); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}

type Echec = { ok: false; erreur: string; jamaisEnvoye?: boolean; incertain?: boolean; nonFacture?: boolean };

async function appelJson(
  url: string, init: RequestInit, delaiMs: number,
): Promise<{ ok: true; statut: number; corps: unknown } | { ok: false; erreur: string; expire?: boolean }> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delaiMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    let corps: unknown = null;
    try { corps = await r.json(); } catch { corps = null; }
    return { ok: true, statut: r.status, corps };
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, erreur: `delai depasse (${Math.round(delaiMs / 1000)} s)`, expire: true };
    return { ok: false, erreur: e instanceof Error ? e.message.slice(0, 140) : 'appel impossible' };
  } finally {
    clearTimeout(minuteur);
  }
}

/** Le message d'erreur du fournisseur, sans jamais parser sa forme pour en tirer une decision. */
function detail(corps: unknown, statut: number): string {
  if (corps && typeof corps === 'object') {
    const d = (corps as { detail?: unknown }).detail;
    if (typeof d === 'string' && d) return `${statut} — ${d.slice(0, 120)}`;
    if (Array.isArray(d) && d.length) return `${statut} — ${JSON.stringify(d).slice(0, 160)}`;
  }
  return `HTTP ${statut}`;
}

/**
 * LE PRIX DU COMPTE, AVANT TOUT ENGAGEMENT. `null` = inconnu, ce qui vaut
 * refus chez l'appelant — jamais zero, jamais « on verra ».
 */
export async function estimerUsd(
  modele: string, corps: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; usd: number } | { ok: false; erreur: string }> {
  const r = await appelJson(`${BASE_HIGGSFIELD}/estimate/${modele}`, {
    method: 'POST', headers: enTetes(env), body: JSON.stringify(corps),
  }, DELAI_ESTIMATION_MS);
  if (!r.ok) return { ok: false, erreur: `estimation impossible (${r.erreur})` };
  if (r.statut < 200 || r.statut >= 300) return { ok: false, erreur: `estimation refusee (${detail(r.corps, r.statut)})` };
  const brut = (r.corps as { usd?: unknown } | null)?.usd;
  // Le champ est documente comme une CHAINE (`{"usd": "0.094"}`) : un nombre est accepte
  // aussi, mais rien d'autre — une forme inattendue est un prix inconnu, pas un prix nul.
  const usd = typeof brut === 'string' ? Number(brut) : typeof brut === 'number' ? brut : NaN;
  if (!Number.isFinite(usd) || usd < 0) return { ok: false, erreur: 'estimation illisible (champ « usd » inattendu)' };
  return { ok: true, usd };
}

/**
 * LE GARDE-FOU DE PRIX, pour UNE operation : estimation obligatoire, comparee
 * au budget par unite declare dans `couts.ts`.
 *
 * `jamaisEnvoye: true` sur chaque refus : seule une question de PRIX est
 * partie, aucune generation n'a ete soumise, donc rien ne peut etre facture.
 */
async function autoriserParEstimation(
  fournisseurId: string, operation: 'image' | 'video', modele: string, corps: Record<string, unknown>,
): Promise<{ ok: true; usd: number } | Echec> {
  const budget = coutUniteGeneration(fournisseurId, operation);
  if (budget === null) {
    return { ok: false, erreur: 'Higgsfield : budget par unite non verifie pour ce modele — generation refusee', jamaisEnvoye: true };
  }
  const estimation = await estimerUsd(modele, corps);
  if (!estimation.ok) return { ok: false, erreur: `Higgsfield : ${estimation.erreur}`, jamaisEnvoye: true };
  if (estimation.usd > budget) {
    return {
      ok: false, jamaisEnvoye: true,
      erreur: `Higgsfield : cout estime ${estimation.usd.toFixed(4)} $ superieur au budget autorise ${budget.toFixed(4)} $ pour cette operation`,
    };
  }
  return { ok: true, usd: estimation.usd };
}

/**
 * L'IMAGE SOURCE DOIT ETRE JOIGNABLE PAR LE FOURNISSEUR : il prend une URL,
 * pas des octets. Elle est televersee dans le stockage temporaire de
 * Higgsfield (`retention=temporary` dans ses propres en-tetes), ce qui evite
 * d'exposer publiquement notre MinIO pour la duree d'un appel.
 *
 * ⚠️ AUCUNE CLE N'EST ENVOYEE A L'URL PRESIGNEE (la documentation l'interdit
 * explicitement) : seuls les en-tetes rendus par le fournisseur y vont.
 */
async function televerserImage(
  fichier: string, env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; url: string } | { ok: false; erreur: string }> {
  let octets: Buffer;
  let mime: string;
  try {
    const { readFile } = await import('fs/promises');
    const { detecterSignatureImage } = await import('@/lib/storage/image-signature');
    octets = await readFile(fichier);
    const signature = detecterSignatureImage(octets);
    // Le type declare doit etre celui des OCTETS, jamais une supposition tiree de
    // l'extension — meme regle que le correctif applique a l'appel Replicate.
    if (!signature) return { ok: false, erreur: 'image source dans un format non reconnu (ni PNG, ni JPEG, ni WEBP)' };
    mime = signature.mime;
  } catch (e) {
    return { ok: false, erreur: `image source illisible (${e instanceof Error ? e.message.slice(0, 80) : 'inconnu'})` };
  }

  const r = await appelJson(`${BASE_HIGGSFIELD}/files/generate-upload-url`, {
    method: 'POST', headers: enTetes(env), body: JSON.stringify({ content_type: mime }),
  }, DELAI_ESTIMATION_MS);
  if (!r.ok) return { ok: false, erreur: `preparation du televersement impossible (${r.erreur})` };
  if (r.statut < 200 || r.statut >= 300) return { ok: false, erreur: `televersement refuse (${detail(r.corps, r.statut)})` };

  const corps = (r.corps ?? {}) as { upload_url?: unknown; public_url?: unknown; upload_headers?: unknown };
  const cible = urlHttpsSure(corps.upload_url);
  const publique = urlHttpsSure(corps.public_url);
  if (!cible || !publique) return { ok: false, erreur: 'televersement : URL rendue par le fournisseur inexploitable' };

  const enTetesDepot: Record<string, string> = { 'Content-Type': mime };
  if (corps.upload_headers && typeof corps.upload_headers === 'object') {
    for (const [k, v] of Object.entries(corps.upload_headers as Record<string, unknown>)) {
      if (typeof v === 'string') enTetesDepot[k] = v;
    }
  }
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_IMAGE_MS);
  try {
    const depot = await fetch(cible, {
      method: 'PUT', headers: enTetesDepot, body: new Uint8Array(octets), signal: ctrl.signal,
    });
    if (!depot.ok) return { ok: false, erreur: `televersement de l'image refuse (HTTP ${depot.status})` };
  } catch (e) {
    return { ok: false, erreur: `televersement de l'image impossible (${e instanceof Error ? e.message.slice(0, 80) : 'inconnu'})` };
  } finally {
    clearTimeout(minuteur);
  }
  return { ok: true, url: publique };
}

type Soumission = { ok: true; statusUrl: string; requestId: string } | Echec;

/**
 * SOUMISSION, AVEC UN SEUL REESSAI ET LA MEME CLE D'IDEMPOTENCE.
 *
 * Un echec reseau ou un 5xx laisse l'issue AMBIGUE : la requete a pu arriver.
 * La documentation Higgsfield repond exactement a ce cas — rejouer la MEME
 * requete avec la MEME `Idempotency-Key`, ce qui ne cree pas de doublon. Un
 * second echec rend `incertain: true` : la depense reste comptee jusqu'a
 * reconciliation, jamais sous-estimee.
 */
async function soumettre(
  modele: string, corps: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env,
): Promise<Soumission> {
  const cle = randomUUID();
  const init: RequestInit = {
    method: 'POST',
    headers: { ...enTetes(env), 'Idempotency-Key': cle },
    body: JSON.stringify(corps),
  };

  let dernier = '';
  for (let tentative = 0; tentative < 2; tentative++) {
    const r = await appelJson(`${BASE_HIGGSFIELD}/${modele}`, init, DELAI_ESTIMATION_MS * 3);
    if (r.ok && r.statut >= 200 && r.statut < 300) {
      const c = (r.corps ?? {}) as { status_url?: unknown; request_id?: unknown };
      const statusUrl = urlHiggsfieldSure(c.status_url);
      const requestId = typeof c.request_id === 'string' ? c.request_id : '';
      // La requete EST partie et a ete acceptee : si nous ne savons plus la suivre, la
      // depense est possible — donc `incertain`, jamais `jamaisEnvoye`.
      if (!statusUrl || !requestId) {
        return { ok: false, erreur: 'Higgsfield a accepte la demande sans rendre de suivi exploitable', incertain: true };
      }
      return { ok: true, statusUrl, requestId };
    }
    if (r.ok) {
      // Reponse d'erreur CLAIRE du fournisseur : rien n'a ete mis en file.
      // 403 (solde insuffisant), 422 (schema), 400 (entree refusee), 429 (file pleine,
      // « rejected requests create nothing and incur no charge ») : aucun de ces cas
      // n'engage un centime, et aucun ne se reessaie a l'identique.
      const retardable = r.statut >= 500 || r.statut === 503;
      if (!retardable) {
        return { ok: false, erreur: `Higgsfield : demande refusee (${detail(r.corps, r.statut)})`, jamaisEnvoye: true };
      }
      dernier = detail(r.corps, r.statut);
    } else {
      dernier = r.erreur;
    }
  }
  return { ok: false, erreur: `Higgsfield : soumission sans reponse exploitable (${dernier})`, incertain: true };
}

type Issue =
  | { ok: true; url: string }
  | Echec;

/**
 * ATTENTE DU RESULTAT — polling du `status_url` rendu par le fournisseur.
 *
 * Statuts officiels : `queued`, `in_progress` (non terminaux), `completed`,
 * `failed`, `nsfw`, `canceled` (terminaux). Les deux issues que Higgsfield
 * declare NON FACTUREES (`failed`, `nsfw`) portent `nonFacture: true`.
 */
/**
 * ANNULATION OFFICIELLE — `POST /requests/{id}/cancel` (lu le 2026-10-28) :
 * `202` = annulee avant traitement, donc non facturee ; `400` = deja demarree,
 * plus annulable. Seul un 202 libere la depense : tout autre cas la laisse
 * comptee, jamais sous-estimee.
 */
async function annuler(requestId: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!ID_REQUETE_SUR.test(requestId)) return false;
  const r = await appelJson(`${BASE_HIGGSFIELD}/requests/${requestId}/cancel`, {
    method: 'POST', headers: enTetes(env),
  }, DELAI_ESTIMATION_MS);
  return r.ok && r.statut === 202;
}

async function attendre(
  statusUrl: string, requestId: string, genre: 'image' | 'video', delaiMs: number, env: NodeJS.ProcessEnv = process.env,
): Promise<Issue> {
  const echeance = Date.now() + delaiMs;
  let attente = ATTENTE_MIN_MS;

  while (Date.now() < echeance) {
    const r = await appelJson(statusUrl, { method: 'GET', headers: enTetes(env) }, DELAI_ESTIMATION_MS);
    if (r.ok && r.statut >= 200 && r.statut < 300) {
      const corps = (r.corps ?? {}) as Record<string, unknown>;
      const statut = typeof corps.status === 'string' ? corps.status : '';

      if (statut === 'completed') {
        const url = genre === 'image'
          ? urlHttpsSure((Array.isArray(corps.images) ? (corps.images[0] as { url?: unknown } | undefined)?.url : null))
          : urlHttpsSure((corps.video as { url?: unknown } | null | undefined)?.url);
        if (!url) return { ok: false, erreur: 'Higgsfield : generation terminee, mais sans media exploitable' };
        return { ok: true, url };
      }
      if (statut === 'failed' || statut === 'nsfw') {
        const motif = typeof corps.error === 'string' && corps.error ? corps.error.slice(0, 120) : statut;
        // Non facture par le fournisseur : la reservation de depense sera liberee.
        return { ok: false, erreur: `Higgsfield : generation ${statut} (${motif})`, nonFacture: true };
      }
      if (statut === 'canceled') {
        return { ok: false, erreur: 'Higgsfield : generation annulee avant traitement', nonFacture: true };
      }
    }
    // Une lecture de statut qui echoue n'est jamais un echec de generation : on reessaie
    // jusqu'a l'echeance (la documentation recommande explicitement de rejouer un GET).
    await new Promise((r2) => setTimeout(r2, attente));
    attente = Math.min(ATTENTE_MAX_MS, Math.round(attente * 1.5));
  }
  // L'echeance a expire : on tente d'arreter la demande encore en file. Si elle a deja
  // demarre, elle peut continuer et etre facturee sans nous — d'ou `incertain`.
  const s = Math.round(delaiMs / 1000);
  if (await annuler(requestId, env)) {
    return { ok: false, erreur: `Higgsfield : delai depasse (${s} s), demande annulee avant traitement`, nonFacture: true };
  }
  return { ok: false, erreur: `Higgsfield : delai depasse (${s} s) sans resultat`, incertain: true };
}

/**
 * Rapatrie le media dans un fichier LOCAL — jumeau volontaire de la fonction
 * du connecteur Replicate (`generation/replicate.ts`), gardee ici plutot que
 * partagee pour qu'AUCUN changement sur ce connecteur ne puisse modifier le
 * comportement de l'autre, qui reste le fournisseur par defaut.
 */
async function rapatrier(url: string, extension: string): Promise<{ ok: true; fichier: string } | { ok: false; erreur: string }> {
  let octets: Buffer;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_RAPATRIEMENT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, erreur: `rapatriement impossible (HTTP ${r.status})` };
    const annonce = Number(r.headers?.get?.('content-length'));
    if (Number.isFinite(annonce) && annonce > TAILLE_MAX_RAPATRIEMENT) {
      ctrl.abort();
      return { ok: false, erreur: 'media rapatrie trop volumineux' };
    }
    if (!r.body) return { ok: false, erreur: 'rapatriement : reponse sans contenu lisible' };
    // La limite est appliquee PENDANT la reception : un `Content-Length` absent ou faux ne
    // doit jamais laisser charger en memoire plus que le plafond.
    const lecteur = r.body.getReader();
    const morceaux: Uint8Array[] = [];
    let recu = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      recu += value.byteLength;
      if (recu > TAILLE_MAX_RAPATRIEMENT) {
        await lecteur.cancel().catch(() => {});
        ctrl.abort();
        return { ok: false, erreur: 'media rapatrie trop volumineux' };
      }
      morceaux.push(value);
    }
    octets = Buffer.concat(morceaux, recu);
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, erreur: `rapatriement : delai depasse (${DELAI_RAPATRIEMENT_MS / 1000} s)` };
    return { ok: false, erreur: e instanceof Error ? e.message.slice(0, 140) : 'rapatriement impossible' };
  } finally {
    clearTimeout(minuteur);
  }
  if (octets.length < 1024) return { ok: false, erreur: 'media rapatrie trop petit pour etre valide' };
  const fichier = path.join(os.tmpdir(), `cinema-higgsfield-${randomBytes(6).toString('hex')}.${extension}`);
  await writeFile(fichier, octets);
  return { ok: true, fichier };
}

async function genererImage(demande: DemandeImageGeneration): Promise<ResultatGenerationIA> {
  const corps: Record<string, unknown> = {
    // Le prompt ANGLAIS deja construit par le systeme existant : rien a reconstruire ici.
    prompt: demande.promptConstruit || demande.promptPlan,
    aspect_ratio: rapport(demande.format),
  };

  const autorise = await autoriserParEstimation(ID_HIGGSFIELD_IMAGE, 'image', MODELE_IMAGE_HF, corps);
  if (!autorise.ok) return autorise;

  const envoi = await soumettre(MODELE_IMAGE_HF, corps);
  if (!envoi.ok) return envoi;

  const issue = await attendre(envoi.statusUrl, envoi.requestId, 'image', DELAI_IMAGE_MS);
  if (!issue.ok) return issue;

  const f = await rapatrier(issue.url, 'jpg');
  if (!f.ok) return { ok: false, erreur: `Higgsfield (image) : ${f.erreur}` };
  return { ok: true, fichier: f.fichier, nomSuggere: `higgsfield-${demande.graine}.jpg` };
}

async function genererVideo(demande: DemandeVideoGeneration): Promise<ResultatGenerationIA> {
  // ⚠️ L'IMAGE SOURCE EST VERIFIEE AVANT TOUT — meme controle que le connecteur Replicate
  // depuis le diagnostic E002 : `sonderMedia` (ffprobe local) confirme que le fichier est
  // REELLEMENT une image decodable. Un fichier tronque est refuse ICI, avant tout appel.
  try {
    const { sonderMedia } = await import('@/lib/cinema/medias');
    const sonde = await sonderMedia(demande.fichierImageSource);
    if (!sonde || sonde.genre !== 'image') {
      return { ok: false, erreur: 'Higgsfield (video) : image source illisible ou inaccessible (sonde ffprobe)', jamaisEnvoye: true };
    }
  } catch (e) {
    return {
      ok: false, jamaisEnvoye: true,
      erreur: `Higgsfield (video) : verification de l'image source impossible (${e instanceof Error ? e.message.slice(0, 80) : 'inconnu'})`,
    };
  }

  // ⚠️ `prompt` EST OBLIGATOIRE dans le schema officiel : une image seule est refusee (422).
  if (!demande.prompt || !demande.prompt.trim()) {
    return { ok: false, erreur: 'Higgsfield (video) : prompt manquant — le fournisseur refuse une image seule', jamaisEnvoye: true };
  }

  // LE TELEVERSEMENT D'ABORD, L'ESTIMATION ENSUITE, AVEC LE CORPS EXACT QUI SERA SOUMIS.
  // Le televersement ne coute rien (stockage temporaire du fournisseur) et il est le seul
  // moyen d'estimer le prix sur le MEME corps que la generation : c'est ce qui fait de
  // l'estimation un vrai pre-vol de schema, et pas seulement une question de prix.
  const duree = dureeVideoAutorisee(demande.dureeS);
  const depot = await televerserImage(demande.fichierImageSource);
  if (!depot.ok) return { ok: false, erreur: `Higgsfield (video) : ${depot.erreur}`, jamaisEnvoye: true };

  const corps: Record<string, unknown> = { prompt: demande.prompt, image_url: depot.url, duration: duree };
  const autorise = await autoriserParEstimation(ID_HIGGSFIELD_VIDEO, 'video', MODELE_VIDEO_HF, corps);
  if (!autorise.ok) return autorise;

  const envoi = await soumettre(MODELE_VIDEO_HF, corps);
  if (!envoi.ok) return envoi;

  const issue = await attendre(envoi.statusUrl, envoi.requestId, 'video', DELAI_VIDEO_MS);
  if (!issue.ok) return issue;

  const f = await rapatrier(issue.url, 'mp4');
  if (!f.ok) return { ok: false, erreur: `Higgsfield (video) : ${f.erreur}` };
  return { ok: true, fichier: f.fichier, nomSuggere: `higgsfield-${demande.graine}.mp4` };
}

/** Image reelle. `actif` lu a CHAQUE usage : les trois conditions sont relues. */
export const FOURNISSEUR_HIGGSFIELD_IMAGE: FournisseurGenerationIA = {
  id: ID_HIGGSFIELD_IMAGE,
  libelle: 'Image (Soul 2)',
  get actif(): boolean { return higgsfieldActif(); },
  genererImage,
  async genererVideo() { return { ok: false, erreur: 'ce fournisseur ne fait que des images' }; },
};

/** Image-vers-video reelle. */
export const FOURNISSEUR_HIGGSFIELD_VIDEO: FournisseurGenerationIA = {
  id: ID_HIGGSFIELD_VIDEO,
  libelle: 'Video image-vers-video (Kling 2.5 turbo standard)',
  get actif(): boolean { return higgsfieldActif(); },
  async genererImage() { return { ok: false, erreur: 'ce fournisseur ne fait que des videos' }; },
  genererVideo,
};

enregistrerFournisseur(FOURNISSEUR_HIGGSFIELD_IMAGE);
enregistrerFournisseur(FOURNISSEUR_HIGGSFIELD_VIDEO);
