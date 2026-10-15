/**
 * MÉDIAS EXTERNES → NOTRE STOCKAGE, AVANT TOUT RENDU (fermeture du TOCTOU).
 *
 * Valider une URL puis la confier à Remotion (`OffthreadVideo`, `Img`,
 * `Audio`), à `@remotion/media-parser` ou à ffmpeg ne suffit pas : chacun la
 * relit LUI-MÊME, suit les redirections et refait sa résolution DNS — la
 * validation a eu lieu, mais pas sur la requête qui part vraiment.
 *
 * Ici, tout média qui n'est pas DÉJÀ dans notre stockage (origines
 * configurées : application, CDN, Supabase historique) est téléchargé UNE
 * fois par le fetch sûr (`fetch-sur.ts` : DNS épinglé, adresses privées
 * refusées, redirections revalidées, plafond d'octets), déposé dans notre
 * stockage (`media/externes/<sha1(url)>.<ext>`, réutilisé ensuite), et c'est
 * CETTE URL — servie par notre relais public, qui ne redirige jamais — que
 * reçoivent le rendu et les sondes. Le moteur de rendu ne contacte donc plus
 * jamais un hôte choisi par un utilisateur.
 *
 * Un média déjà chez nous passe tel quel (aucun octet copié).
 */
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { cibleStockageParChemin, extraireCibleStockage, originesStockageConfigurees } from '@/lib/storage/acces-objet';
import { RefusSsrf, telechargerSur, type OptionsFetchSur } from '@/lib/securite/fetch-sur';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

export const BUCKET_EXTERNES = 'media';

/** L'URL désigne-t-elle NOTRE stockage (origine configurée + relais public) ? */
export function estNotreStockage(url: unknown, origines: readonly string[] = originesStockageConfigurees()): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && extraireCibleStockage(url, { origines }) !== null;
}

/**
 * ⚠️ UNE COPIE EXTERNE N'EST JAMAIS UN OBJET DE NOTRE STOCKAGE. La copie est
 * déposée dans `media/externes/…`, lisible par TOUT compte, et son appelant
 * n'a pas de compte à opposer : un chemin d'objet de stockage — atteint par
 * un hôte non configuré (staging, alias, IP, point final, `http`) ou par une
 * redirection — est refusé ici, à CHAQUE saut, avant toute requête vers lui.
 * Les lecteurs au nom d'un compte (`classerUrlLecture`) jugent ces chemins
 * eux-mêmes, propriété comprise, et ne les envoient jamais ici.
 */
function horsStockage(u: URL): boolean {
  return cibleStockageParChemin(u.href) === null;
}

export type GenreMedia = 'video' | 'image' | 'audio';

const EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|mp3|m4a|wav|ogg|oga|aac|flac|jpe?g|png|webp|avif|gif)$/i;
const DEFAUT_EXT: Record<GenreMedia, string> = { video: '.mp4', image: '.jpg', audio: '.mp3' };

/** Clé de cache déterministe d'une URL externe. Pure. */
export function cleMediaExterne(url: string, genre: GenreMedia = 'video'): string {
  const h = createHash('sha1').update(url).digest('hex');
  let ext = DEFAUT_EXT[genre];
  try {
    const m = EXTENSIONS.exec(new URL(url).pathname);
    if (m) ext = `.${m[1].toLowerCase()}`;
  } catch { /* URL refusée plus loin */ }
  return `externes/${h}${ext}`;
}

/** Ce dont la localisation a besoin du stockage — injectable pour les tests. */
export interface DepotMedias {
  existe(bucket: string, cle: string): Promise<boolean>;
  deposer(bucket: string, cle: string, fichier: string, taille: number): Promise<void>;
  urlPublique(bucket: string, cle: string): string;
}

async function depotParDefaut(): Promise<DepotMedias> {
  const { clientMinio } = await import('@/lib/storage/minio-client');
  const { supabaseAdmin } = await import('@/lib/db/supabase');
  return {
    existe: (b, c) => clientMinio({ timeoutMs: 10_000 }).statObject(b, c).then(() => true, () => false),
    // ⚠️ Le flux a TOUJOURS un écouteur d'erreur et est détruit après l'envoi :
    // si `putObject` échoue avant de le lire, le fichier temporaire est déjà
    // effacé quand le flux s'ouvre — sans écouteur, l'ENOENT devient une
    // exception non rattrapée qui fait tomber le processus Node.
    deposer: (b, c, f, taille) => deposerFichierMinio(clientMinio(), b, c, f, taille),
    urlPublique: (b, c) => supabaseAdmin.storage.from(b).getPublicUrl(c).data.publicUrl,
  };
}

export interface OptionsLocalisation {
  genre?: GenreMedia;
  depot?: DepotMedias;
  /** Options du fetch sûr (délais, plafond ; injections de test). */
  reseau?: OptionsFetchSur;
  origines?: readonly string[];
}

const enCours = new Map<string, Promise<string>>();

/**
 * Dépose un fichier local dans MinIO.
 *
 * ⚠️ Le flux a TOUJOURS un écouteur d'erreur et est détruit après l'envoi :
 * si `putObject` échoue avant de le lire, le fichier temporaire est déjà
 * effacé quand le flux s'ouvre — sans écouteur, l'ENOENT devient une
 * exception non rattrapée qui fait tomber le processus Node.
 */
export async function deposerFichierMinio(
  client: { putObject: (b: string, c: string, flux: NodeJS.ReadableStream, taille: number) => Promise<unknown> },
  bucket: string, cle: string, fichier: string, taille: number,
): Promise<void> {
  const flux = createReadStream(fichier);
  flux.on('error', () => undefined);
  try { await client.putObject(bucket, cle, flux, taille); } finally { flux.destroy(); }
}

/**
 * URL de NOTRE stockage pour ce média : lui-même s'il y est déjà, sinon sa
 * copie (créée par le fetch sûr, ou retrouvée en cache).
 *
 * Rejette `RefusSsrf` (cible interdite : RIEN n'a été demandé à la cible) ou
 * `EchecFetchSur` (réseau) — jamais l'URL d'origine en repli : un repli
 * rendrait au moteur de rendu exactement ce qu'on lui retire.
 */
export async function localiserMedia(url: string, opts: OptionsLocalisation = {}): Promise<string> {
  const origines = opts.origines ?? originesStockageConfigurees();
  if (estNotreStockage(url, origines)) return url;
  const genre = opts.genre ?? 'video';
  const cle = cleMediaExterne(url, genre);
  const deja = enCours.get(cle);
  if (deja) return deja;
  const travail = (async () => {
    const depot = opts.depot ?? await depotParDefaut();
    if (await depot.existe(BUCKET_EXTERNES, cle)) return depot.urlPublique(BUCKET_EXTERNES, cle);
    // Nom UNIQUE par appel : deux copies du même média ne se partagent jamais
    // (ni ne s'effacent) le même fichier temporaire.
    const local = path.join(os.tmpdir(), `studiio-externe-${randomUUID()}-${path.basename(cle)}`);
    try {
      // 10 min : un rush externe peut peser plusieurs centaines de Mo.
      await telechargerSur(url, local, {
        timeoutMs: 600_000,
        ...(opts.reseau ?? {}),
        originesDeConfiance: opts.reseau?.originesDeConfiance ?? origines,
        autorisee: (u) => horsStockage(u) && (opts.reseau?.autorisee ? opts.reseau.autorisee(u) : true),
      });
      const { size } = await stat(local);
      await depot.deposer(BUCKET_EXTERNES, cle, local, size);
    } finally {
      await unlink(local).catch(() => undefined);
    }
    return depot.urlPublique(BUCKET_EXTERNES, cle);
  })().finally(() => enCours.delete(cle));
  enCours.set(cle, travail);
  return travail;
}

// ─────────────────────────────────────────────────────────────────────────
// Entrée du rendu « Créer simple » (Autopilote)
// ─────────────────────────────────────────────────────────────────────────

const http = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Tous les médias d'une entrée de rendu, avec leur genre. Pure. */
export function mediasEntreeRendu(d: CreerSimpleRenderInput): Array<{ url: string; genre: GenreMedia }> {
  const out: Array<{ url: string; genre: GenreMedia }> = [];
  const ajouter = (u: unknown, genre: GenreMedia) => { if (http(u)) out.push({ url: u, genre }); };
  ajouter(d.posterUrl, 'image');
  for (const v of Object.values(d.sequenceBackgrounds ?? {})) ajouter(v, 'image');
  ajouter(d.videoUrl, 'video');
  for (const r of d.rushs ?? []) ajouter(r?.url, 'video');
  for (const s of d.montage ?? []) ajouter(s?.url, s?.kind === 'image' ? 'image' : 'video');
  ajouter(d.musicUrl, 'audio');
  ajouter(d.voiceUrl, 'audio');
  // La voix de la séquence « Vidéo » peut être la VIDÉO de l'avatar (même fichier).
  for (const v of Object.values(d.sequenceVoiceUrls ?? {})) ajouter(v, 'audio');
  return out;
}

/**
 * L'entrée de rendu dont TOUS les médias désignent notre stockage. Un même
 * fichier n'est localisé qu'une fois, quel que soit le nombre de champs qui le
 * portent (rush + plan, avatar image + voix).
 */
export async function localiserEntreesRendu(
  d: CreerSimpleRenderInput,
  opts: Omit<OptionsLocalisation, 'genre'> = {},
): Promise<CreerSimpleRenderInput> {
  const medias = mediasEntreeRendu(d);
  const genreDe = new Map<string, GenreMedia>();
  for (const m of medias) {
    // Vidéo prioritaire : la vidéo de l'avatar sert aussi de piste de voix.
    if (!genreDe.has(m.url) || m.genre === 'video') genreDe.set(m.url, m.genre);
  }
  const locales = new Map<string, string>();
  for (const [url, genre] of genreDe) locales.set(url, await localiserMedia(url, { ...opts, genre }));
  const l = <T>(u: T): T => (http(u) ? (locales.get(u) ?? u) as T : u);
  const carte = (o: Record<string, string | null> | undefined) =>
    o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, l(v)])) : o;
  return {
    ...d,
    ...(d.posterUrl !== undefined ? { posterUrl: l(d.posterUrl) } : {}),
    ...(d.sequenceBackgrounds ? { sequenceBackgrounds: carte(d.sequenceBackgrounds) } : {}),
    ...(d.videoUrl !== undefined ? { videoUrl: l(d.videoUrl) } : {}),
    ...(d.rushs ? { rushs: d.rushs.map((r) => ({ ...r, url: l(r.url) })) } : {}),
    ...(d.montage ? { montage: d.montage.map((s) => ({ ...s, url: l(s.url) })) } : {}),
    ...(d.musicUrl !== undefined ? { musicUrl: l(d.musicUrl) } : {}),
    ...(d.voiceUrl !== undefined ? { voiceUrl: l(d.voiceUrl) } : {}),
    ...(d.sequenceVoiceUrls ? { sequenceVoiceUrls: carte(d.sequenceVoiceUrls) } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Propriétés LIBRES (`/api/render` : `inputProps` venus du navigateur)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Clés qui portent du TEXTE affiché, jamais un média : une URL écrite dans un
 * titre ou un CTA (« https://monsite.fr ») reste du texte. Comprend les clés
 * texte des compositions (`remotion/types.ts` : `titleText`, `themeTitle`,
 * `tagLine`, `videoMode`, `objective`, `anchor`… et toute clé `*Text`), dont
 * aucune n'est chargée comme média. Seule une valeur CHAÎNE est exemptée : un
 * objet rangé sous une telle clé est inspecté comme le reste.
 */
const CLES_TEXTE = /^(title|subtitle|titre|sousTitre|text|texte|.*text|label|description|value|caption|cta.*|watermark.*|icon.*|name|nom|.*font.*|.*color.*|.*couleur.*|hashtags?|link|lien|website|sourceUrl|themeTitle|themeSubtitle|tagLine|videoMode|objective|anchor)$/i;

/** Schémas que le moteur de rendu ne doit JAMAIS recevoir (liste fermée). */
const SCHEMAS_INTERDITS = new Set([
  'file', 'data', 'blob', 'javascript', 'vbscript', 'ftp', 'ws', 'wss', 'filesystem', 'about',
  'view-source', 'chrome', 'chrome-extension', 'gopher', 'jar', 'ldap', 'dict', 'smb',
]);

/**
 * Classe une chaîne libre COMME REMOTION LA LIRA : `getAbsoluteSrc` fait
 * `new URL(src, window.origin)`, dont l'analyse WHATWG retire C0/espace en
 * tête et en fin, supprime tab/CR/LF partout et accepte `\\` comme `/`.
 * Un simple `/^https?:\/\//` laisserait passer ` https://10.0.0.1`,
 * `ht\ttps://…`, `https:10.0.0.1`, `//hôte` ou `/proxy?src=…`.
 *
 * Rend l'URL http(s) CANONIQUE à localiser, `null` pour du texte ordinaire ;
 * rejette `RefusSsrf` pour un chemin relatif ou un schéma interdit.
 */
/** Origine fictive servant à résoudre les références relatives (comme Chromium). */
const BASE_RELATIVE = 'http://localhost:3000/';

function classerChaineLibre(brute: string): string | null {
  // eslint-disable-next-line no-control-regex
  const n = brute.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
  if (/^https?:/i.test(n)) {
    let u: URL;
    try { u = new URL(n); } catch { throw new RefusSsrf('url-invalide'); }
    // Forme déjà canonique : transmise telle quelle (mêmes clés de cache qu'avant).
    return n === brute && http(brute) ? brute : u.href;
  }
  if (/^[/\\]/.test(n)) throw new RefusSsrf('url-invalide');
  // Un nom de schéma suivi d'un BLANC (« Data: 5 chiffres », « File: x ») est
  // du texte : WHATWG en ferait `file:///%20x`, qui ne désigne rien.
  const schema = /^([a-z][a-z0-9+.-]*):(?![\u0000-\u0020])/i.exec(n);
  if (schema && SCHEMAS_INTERDITS.has(schema[1].toLowerCase())) throw new RefusSsrf('schema');
  // Référence RELATIVE sans « / » en tête (`proxy?src=…`, `./proxy`,
  // `%2e%2e/proxy`…) : Chromium la résout vers le serveur local de Remotion,
  // dont `/proxy` télécharge sans filtre IP. Base RACINE : ce qui atteint
  // /proxy depuis une base plus profonde l'atteint aussi depuis la racine.
  let rel: URL | null = null;
  try { rel = new URL(n, BASE_RELATIVE); } catch { rel = null; }
  if (rel && rel.origin === new URL(BASE_RELATIVE).origin) {
    // Décodage par octet, tolérant : « 95% » reste du texte au lieu d'échouer.
    const chemin = rel.pathname.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    if (chemin.toLowerCase().startsWith('/proxy')) throw new RefusSsrf('url-invalide');
  }
  return null;
}

/**
 * Remplace toute URL http(s) d'un objet arbitraire (hors clés de texte) par
 * sa copie dans notre stockage. Chemins relatifs et schémas dangereux sont
 * refusés ; au-delà de la profondeur 8, tout ce qui pourrait porter une URL
 * est refusé (fermé par défaut). Rejette au premier refus.
 */
export async function localiserProprietesLibres<T>(props: T, opts: Omit<OptionsLocalisation, 'genre'> = {}, profondeur = 0): Promise<T> {
  if (profondeur > 8) {
    if (props === null || props === undefined || typeof props === 'number' || typeof props === 'boolean') return props;
    throw new RefusSsrf('url-invalide');
  }
  if (typeof props === 'string') {
    const url = classerChaineLibre(props);
    if (url === null) return props;
    const genre: GenreMedia = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i.test(url) ? 'image'
      : /\.(mp3|m4a|wav|ogg|aac|flac)(\?|#|$)/i.test(url) ? 'audio' : 'video';
    return await localiserMedia(url, { ...opts, genre }) as T;
  }
  if (Array.isArray(props)) {
    const out: unknown[] = [];
    for (const v of props) out.push(await localiserProprietesLibres(v, opts, profondeur + 1));
    return out as T;
  }
  if (props && typeof props === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      out[k] = CLES_TEXTE.test(k) && typeof v === 'string' ? v : await localiserProprietesLibres(v, opts, profondeur + 1);
    }
    return out as T;
  }
  return props;
}
