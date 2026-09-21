/**
 * Telechargement d'un media du stockage Studiio vers un fichier local.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE REFUSE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'ancienne version acceptait N'IMPORTE QUELLE URL : une adresse relative
 * etait collee a l'origine de l'application, tout le reste partait en
 * `fetch()` nu — vers Internet, vers `studiio-minio:9000`, vers `127.0.0.1`.
 * Et elle lisait l'objet ENTIER en memoire (reponse entiere, accumulation de
 * flux) avant de l'ecrire sur disque, ce que son propre commentaire promettait
 * de ne pas faire.
 *
 * Ici, la seule chose qu'on telecharge est UNE CIBLE DE STOCKAGE STUDIIO :
 *   - l'URL est reduite a `{ bucket, cle }` par `extraireCibleStockage`, qui
 *     ne connait que le relais public et les origines configurees ;
 *   - la cible passe `cibleRecevable` (compartiment de la liste blanche, cle
 *     bien formee, namespaces prives fermes) ;
 *   - la cle appartient au compte appelant, ou porte un prefixe partage que
 *     l'APPELANT declare explicitement.
 *
 * Le refus est uniforme (`acces_refuse`) : un code distinct par motif dirait
 * a qui sonde « cet objet existe » — la meme regle que le relais public.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX TRANSPORTS, ET LA REGLE QUI CHOISIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   MinIO direct — URL relative, ou URL absolue sur l'origine de
 *     l'application (`NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL`). Le serveur est
 *     a cote de MinIO : passer par Traefik → Next.js → MinIO serait un detour
 *     par soi-meme, et c'est ce detour qui bouclait en production.
 *
 *   HTTP — URL absolue sur une AUTRE origine configuree : un CDN devant le
 *     stockage (`PUBLIC_STORAGE_URL` sur un hote distinct), ou le Supabase
 *     historique (`NEXT_PUBLIC_SUPABASE_URL`). Redirections suivies a la main,
 *     trois sauts au plus, chaque destination revalidee comme une cible neuve.
 *
 * Dans les deux cas : la taille est plafonnee AVANT de lire (stat / Content-
 * Length) ET pendant (compteur d'octets qui coupe le flux), rien n'est tenu en
 * memoire, le fichier partiel est efface a la moindre erreur, et aucun message
 * d'erreur ne porte l'URL, la cle ni l'hote.
 */

import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as FluxWeb } from 'stream/web';

import {
  PREFIXE_RELAIS_PUBLIC,
  cibleRecevable,
  cleDuCompteStrict,
  extraireCibleStockage,
  originesStockageConfigurees,
  typeContenuDepuisCle,
  TYPE_OCTETS,
  type CibleStockage,
} from '@/lib/storage/acces-objet';
import { clientMinio, lecteurMinio, RAISON_TIMEOUT_MINIO } from '@/lib/storage/minio-client';
import { TAILLE_MAXIMALE } from '@/lib/rendus/cible-upload';

/**
 * Le prefixe du relais public, sous son nom historique.
 *
 * ⚠️ LIGNE EPINGLEE PAR UN TEST : `securite-namespace-analyse.test.ts`
 * recense les consommateurs de ce prefixe et verifie ce texte exact dans ce
 * fichier. Il est aligne sur `PREFIXE_RELAIS_PUBLIC` — la verification de
 * type ci-dessous echoue a la compilation si les deux divergent.
 */
const STORAGE_PROXY_PREFIX = '/storage/v1/object/public/';
const _memePrefixe: typeof PREFIXE_RELAIS_PUBLIC = STORAGE_PROXY_PREFIX;
void _memePrefixe;

/** Plafond de telechargement : le meme que celui du relais d'envoi. */
export const MAX_MEDIA_DOWNLOAD_BYTES: number = TAILLE_MAXIMALE;

/** Delai par defaut pour l'ensemble du telechargement, en millisecondes. */
export const DELAI_TELECHARGEMENT_MS = 120_000;

export type CodeTelechargement =
  | 'cible_invalide'
  | 'acces_refuse'
  | 'introuvable'
  | 'trop_volumineux'
  | 'delai'
  | 'reseau'
  | 'stockage';

/**
 * Les messages, FIXES : un par code, sans interpolation. Ils finissent dans
 * un journal et dans des reponses HTTP ; ni URL, ni cle, ni hote n'y va.
 */
const MESSAGES: Record<CodeTelechargement, string> = {
  cible_invalide: 'cible de telechargement invalide',
  acces_refuse: 'acces au media refuse',
  introuvable: 'media introuvable',
  trop_volumineux: 'media trop volumineux',
  delai: 'delai de telechargement depasse',
  reseau: 'erreur reseau pendant le telechargement',
  stockage: 'erreur du stockage pendant le telechargement',
};

export class ErreurTelechargement extends Error {
  readonly code: CodeTelechargement;
  constructor(code: CodeTelechargement) {
    super(MESSAGES[code]);
    this.name = 'ErreurTelechargement';
    this.code = code;
  }
}

export interface OptionsTelechargement {
  /** Le compte pour lequel on telecharge : la cle doit lui appartenir. */
  userId: string;
  /**
   * Prefixes partages toleres EXPLICITEMENT par l'appelant (`['converted/']`).
   * Sans cette liste, seule une cle `<userId>/…` passe.
   */
  prefixesPartages?: readonly string[];
  /** Plafond en octets. Defaut : `MAX_MEDIA_DOWNLOAD_BYTES`. */
  maxBytes?: number;
  /** Delai total, en millisecondes. Defaut : `DELAI_TELECHARGEMENT_MS`. */
  timeoutMs?: number;
  /** Origines acceptees. Defaut : `originesStockageConfigurees()`. */
  origines?: readonly string[];
}

export interface ResultatTelechargement {
  sizeBytes: number;
  contentType: string;
}

/** Nombre maximal de redirections suivies sur le transport HTTP. */
const SAUTS_MAX = 3;

/**
 * Telecharge une cible de stockage Studiio dans `destPath`.
 *
 * Rejette avec `ErreurTelechargement` — et uniquement elle — dont `code`
 * dit quoi. Le fichier de destination n'existe jamais apres un echec.
 */
export async function downloadMediaToFile(
  url: string,
  destPath: string,
  options: OptionsTelechargement,
): Promise<ResultatTelechargement> {
  const origines = options.origines ?? originesStockageConfigurees();
  const maxBytes = options.maxBytes ?? MAX_MEDIA_DOWNLOAD_BYTES;
  const timeoutMs = options.timeoutMs ?? DELAI_TELECHARGEMENT_MS;

  // 1. Une cible de stockage, ou rien.
  const cible = extraireCibleStockage(url, { origines });
  if (!cible) throw new ErreurTelechargement('cible_invalide');

  // 2. Recevable, et possedee. Refus uniforme.
  if (!cibleRecevable(cible.bucket, cible.cle)) throw new ErreurTelechargement('acces_refuse');
  if (!cleAccessible(cible.cle, options.userId, options.prefixesPartages)) {
    throw new ErreurTelechargement('acces_refuse');
  }

  // 3. Le transport.
  const transport = choisirTransport(url);
  try {
    const resultat = transport === 'minio'
      ? await telechargerViaMinio(cible, destPath, maxBytes, timeoutMs)
      : await telechargerViaHttp(url, cible, destPath, {
        maxBytes, timeoutMs, origines, userId: options.userId,
        prefixesPartages: options.prefixesPartages,
      });
    console.log('[fetchMedia]', { bucket: cible.bucket, transport, sizeBytes: resultat.sizeBytes });
    return resultat;
  } catch (erreur) {
    await unlink(destPath).catch(() => undefined);
    const typee = erreur instanceof ErreurTelechargement ? erreur : traduireErreur(erreur);
    console.log('[fetchMedia]', { bucket: cible.bucket, transport, code: typee.code });
    throw typee;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Propriete et transport
// ─────────────────────────────────────────────────────────────────────────

function cleAccessible(
  cle: string,
  userId: unknown,
  prefixesPartages: readonly string[] | undefined,
): boolean {
  if (typeof userId !== 'string' || userId.length === 0) return false;
  if (cleDuCompteStrict(cle, userId)) return true;
  return (prefixesPartages ?? []).some((p) => p.length > 0 && cle.startsWith(p));
}

/** Les origines de l'APPLICATION elle-meme — celles ou MinIO est a cote. */
function originesApplication(env: NodeJS.ProcessEnv = process.env): string[] {
  const origines: string[] = [];
  for (const valeur of [env.NEXT_PUBLIC_APP_URL, env.NEXTAUTH_URL]) {
    if (!valeur) continue;
    try {
      origines.push(new URL(valeur).origin);
    } catch {
      // Variable mal remplie : elle ne designe aucune origine.
    }
  }
  return origines;
}

/**
 * La regle de choix, en une ligne : relative → MinIO ; origine de
 * l'application → MinIO ; toute autre origine (deja validee) → HTTP.
 */
function choisirTransport(url: string): 'minio' | 'http' {
  if (url.startsWith(STORAGE_PROXY_PREFIX)) return 'minio';
  try {
    return originesApplication().includes(new URL(url).origin) ? 'minio' : 'http';
  } catch {
    // Impossible ici : `extraireCibleStockage` a deja accepte cette URL.
    return 'http';
  }
}

/** Le type sous lequel on rend le fichier : l'extension d'abord, puis l'annonce. */
function typeContenu(cle: string, annonce: string | null | undefined): string {
  const parExtension = typeContenuDepuisCle(cle);
  if (parExtension !== TYPE_OCTETS) return parExtension;
  const propre = (annonce || '').split(';')[0].trim().toLowerCase();
  return propre || TYPE_OCTETS;
}

// ─────────────────────────────────────────────────────────────────────────
// Le compteur d'octets — la defense en profondeur des deux transports
// ─────────────────────────────────────────────────────────────────────────

/**
 * Laisse passer les octets et coupe au-dela du plafond. Le plafond a deja ete
 * verifie sur la taille annoncee ; ce compteur est la pour le jour ou
 * l'annonce ment, ou manque.
 */
class CompteurBorne extends Transform {
  octets = 0;
  constructor(private readonly plafond: number) {
    super();
  }
  _transform(morceau: Buffer, _enc: BufferEncoding, suite: (e?: Error | null, d?: Buffer) => void) {
    this.octets += morceau.length;
    if (this.octets > this.plafond) {
      suite(new ErreurTelechargement('trop_volumineux'));
      return;
    }
    suite(null, morceau);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Transport MinIO
// ─────────────────────────────────────────────────────────────────────────

async function telechargerViaMinio(
  cible: CibleStockage,
  destPath: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResultatTelechargement> {
  const borne = { timeoutMs };
  const stat = await clientMinio(borne).statObject(cible.bucket, cible.cle);
  if (typeof stat.size === 'number' && stat.size > maxBytes) {
    throw new ErreurTelechargement('trop_volumineux');
  }

  const flux = await lecteurMinio(borne).getObject(cible.bucket, cible.cle);
  const compteur = new CompteurBorne(maxBytes);
  await pipeline(flux, compteur, createWriteStream(destPath));

  return {
    sizeBytes: compteur.octets,
    contentType: typeContenu(cible.cle, stat.metaData?.['content-type']),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Transport HTTP
// ─────────────────────────────────────────────────────────────────────────

interface ContexteHttp {
  maxBytes: number;
  timeoutMs: number;
  origines: readonly string[];
  userId: string;
  prefixesPartages: readonly string[] | undefined;
}

async function telechargerViaHttp(
  urlInitiale: string,
  cibleInitiale: CibleStockage,
  destPath: string,
  ctx: ContexteHttp,
): Promise<ResultatTelechargement> {
  const controleur = new AbortController();
  const echeance = setTimeout(() => controleur.abort(), ctx.timeoutMs);
  if (typeof echeance.unref === 'function') echeance.unref();

  try {
    let courante = urlInitiale;
    let cible = cibleInitiale;
    let reponse: Response | null = null;

    for (let saut = 0; ; saut++) {
      const res = await fetch(courante, { redirect: 'manual', signal: controleur.signal });

      if (res.status >= 300 && res.status < 400) {
        // On ne consomme pas le corps d'une redirection.
        await res.body?.cancel().catch(() => undefined);
        if (saut >= SAUTS_MAX) throw new ErreurTelechargement('reseau');
        const location = res.headers.get('location');
        if (!location) throw new ErreurTelechargement('reseau');

        let suivante: URL;
        try {
          suivante = new URL(location, courante);
        } catch {
          throw new ErreurTelechargement('acces_refuse');
        }
        // La destination est une cible NEUVE : elle repasse tout le controle.
        const cibleSuivante = extraireCibleStockage(suivante.href, { origines: ctx.origines });
        if (!cibleSuivante
          || !cibleRecevable(cibleSuivante.bucket, cibleSuivante.cle)
          || !cleAccessible(cibleSuivante.cle, ctx.userId, ctx.prefixesPartages)) {
          throw new ErreurTelechargement('acces_refuse');
        }
        courante = suivante.href;
        cible = cibleSuivante;
        continue;
      }

      if (res.status === 404) throw new ErreurTelechargement('introuvable');
      if (!res.ok) throw new ErreurTelechargement('reseau');
      reponse = res;
      break;
    }

    const annonce = Number(reponse.headers.get('content-length'));
    if (Number.isFinite(annonce) && annonce > ctx.maxBytes) {
      await reponse.body?.cancel().catch(() => undefined);
      throw new ErreurTelechargement('trop_volumineux');
    }
    if (!reponse.body) throw new ErreurTelechargement('reseau');

    const compteur = new CompteurBorne(ctx.maxBytes);
    const source = Readable.fromWeb(reponse.body as unknown as FluxWeb<Uint8Array>);
    try {
      await pipeline(source, compteur, createWriteStream(destPath), { signal: controleur.signal });
    } catch (erreur) {
      // Un depassement coupe aussi la connexion : on ne finit pas de recevoir
      // ce qu'on a refuse.
      if (erreur instanceof ErreurTelechargement) controleur.abort();
      throw erreur;
    }

    return {
      sizeBytes: compteur.octets,
      contentType: typeContenu(cible.cle, reponse.headers.get('content-type')),
    };
  } finally {
    clearTimeout(echeance);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Traduction des erreurs brutes — jamais leur message
// ─────────────────────────────────────────────────────────────────────────

function traduireErreur(erreur: unknown): ErreurTelechargement {
  const e = (erreur ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  const nom = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';

  if (nom === 'AbortError' || code === 'ABORT_ERR') return new ErreurTelechargement('delai');
  if (message.startsWith(RAISON_TIMEOUT_MINIO)) return new ErreurTelechargement('delai');
  if (code === 'NotFound' || code === 'NoSuchKey' || code === 'NoSuchBucket') {
    return new ErreurTelechargement('introuvable');
  }
  // `fetch failed`, DNS, connexion refusee : le reseau, pas le stockage.
  if (nom === 'TypeError' || code.startsWith('E')) return new ErreurTelechargement('reseau');
  return new ErreurTelechargement('stockage');
}
