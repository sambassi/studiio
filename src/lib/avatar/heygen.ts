/**
 * Client HeyGen — avatar video parlant ("Mon avatar qui parle").
 *
 * ⚠️ VERSION D'API : ce client utilise **v3** (`https://api.heygen.com/v3/...`).
 * Le cahier des charges demandait v2 (`/v2/video/generate`), mais la
 * documentation HeyGen annonce la fin du support v1/v2 au **31 octobre 2026**.
 * Construire sur v2 aujourd'hui imposerait une migration dans les 3 mois.
 * Les endpoints v3 utilises ici sont documentes sur developers.heygen.com.
 *
 * Flux complet :
 *   1. uploadAsset()      POST /v3/assets            → asset_id
 *   2. createPhotoAvatar() POST /v3/avatars          → avatar_id (entrainement async)
 *   3. generateAvatarVideo() POST /v3/videos         → video_id
 *   4. getVideoStatus()   GET  /v3/videos/{video_id} → status + video_url
 *
 * Ce module ne fait AUCUN acces base ni stockage : il parle uniquement a
 * HeyGen. La persistance et les credits sont geres par les routes API.
 */

const HEYGEN_BASE = 'https://api.heygen.com';

/** Toutes les erreurs HeyGen remontent sous cette forme pour un mapping HTTP propre. */
export class HeyGenError extends Error {
  /** Code HTTP a renvoyer au client de l'app. */
  readonly httpStatus: number;
  /** Code technique HeyGen si disponible (ex. 'quota_exceeded'). */
  readonly code?: string;

  constructor(message: string, httpStatus = 502, code?: string) {
    super(message);
    this.name = 'HeyGenError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new HeyGenError(
      "La generation d'avatar n'est pas configuree sur ce serveur (HEYGEN_API_KEY manquante).",
      503,
      'missing_api_key',
    );
  }
  return key;
}

/**
 * Extrait le message d'erreur reel renvoye par HeyGen.
 * La forme varie selon l'endpoint : { message }, { error: "..." },
 * { error: { message } }, { msg }... On ratisse large.
 */
function extractHeyGenMessage(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body.slice(0, 500) || undefined;

  const b = body as Record<string, any>;
  const candidates = [
    b.message,
    b.msg,
    typeof b.error === 'string' ? b.error : undefined,
    b.error?.message,
    b.error?.detail,
    b.detail,
    b.data?.error,
    b.data?.message,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 500);
  }
  // Rien d'exploitable : on renvoie le JSON tronque plutot que rien du tout.
  try {
    const dump = JSON.stringify(body);
    return dump && dump !== '{}' ? dump.slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Traduit une reponse HeyGen en HeyGenError.
 *
 * Le message REEL de HeyGen est propage jusqu'a l'UI : sans lui, un 400 est
 * indiagnosticable (on ne sait pas si c'est la voix, l'avatar ou le texte).
 * Le corps complet est en plus journalise cote serveur par heygenFetch.
 */
function mapHeyGenFailure(status: number, body: unknown): HeyGenError {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const lowered = raw.toLowerCase();
  const code =
    (body as { code?: string; error?: { code?: string } })?.code ??
    (body as { error?: { code?: string } })?.error?.code;
  const detail = extractHeyGenMessage(body);
  const suffix = detail ? ` — HeyGen : ${detail}` : '';

  if (status === 401 || status === 403) {
    return new HeyGenError(
      `Cle API HeyGen refusee. Verifier HEYGEN_API_KEY cote serveur.${suffix}`,
      503,
      code ?? 'unauthorized',
    );
  }
  if (status === 429 || lowered.includes('quota') || lowered.includes('rate limit')) {
    return new HeyGenError(
      `Quota HeyGen atteint. Reessayer plus tard ou augmenter le forfait HeyGen.${suffix}`,
      503,
      code ?? 'quota_exceeded',
    );
  }
  if (status === 400 || status === 422) {
    return new HeyGenError(
      `HeyGen a refuse la demande.${suffix}`,
      400,
      code ?? 'invalid_request',
    );
  }
  return new HeyGenError(
    `HeyGen a repondu ${status}.${suffix}`,
    502,
    code ?? 'upstream_error',
  );
}

/** Appel JSON generique vers HeyGen, avec timeout et erreurs normalisees. */
async function heygenFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${HEYGEN_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'x-api-key': apiKey(), ...(rest.headers ?? {}) },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new HeyGenError(
      aborted ? 'HeyGen ne repond pas (timeout).' : 'HeyGen est injoignable.',
      504,
      aborted ? 'timeout' : 'network_error',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    // Journal serveur : corps COMPLET, non tronque. C'est la seule trace qui
    // permet de diagnostiquer un 400 HeyGen.
    console.error('[Avatar][HeyGen]', rest.method ?? 'GET', path, res.status, text);
    throw mapHeyGenFailure(res.status, parsed);
  }

  // HeyGen encapsule tout dans `data`. Certains endpoints renvoient aussi un
  // `error` non nul avec un HTTP 200 — on le traite comme un echec.
  const envelope = parsed as { data?: T; error?: unknown } | null;
  if (envelope && envelope.error) {
    console.error('[Avatar][HeyGen]', rest.method ?? 'GET', path, '200-with-error', text);
    throw mapHeyGenFailure(200, envelope.error);
  }
  return (envelope?.data ?? parsed) as T;
}

// ── 1. Upload de l'image source ───────────────────────────────────────────

export interface UploadedAsset {
  assetId: string;
  url?: string;
}

/** Limite documentee de POST /v3/assets. Au-dela, HeyGen impose l'upload direct. */
export const HEYGEN_ASSET_MAX_BYTES = 32 * 1024 * 1024;

/**
 * POST /v3/assets — envoie le fichier source (multipart, champ `file`).
 * Formats acceptes par HeyGen : PNG, JPEG, MP4, WebM. Taille max : 32 Mo.
 */
export async function uploadAsset(
  file: Blob,
  filename: string,
): Promise<UploadedAsset> {
  console.log(
    `[Avatar][HeyGen] POST /v3/assets — fichier="${filename}" type=${file.type || 'inconnu'} taille=${Math.round(file.size / 1024)} Ko`,
  );

  const form = new FormData();
  form.append('file', file, filename);

  const data = await heygenFetch<{ asset_id?: string; id?: string; url?: string }>(
    '/v3/assets',
    { method: 'POST', body: form, timeoutMs: 300_000 },
  );

  const assetId = data?.asset_id ?? data?.id;
  if (!assetId) {
    throw new HeyGenError("HeyGen n'a pas retourne d'identifiant d'asset.", 502, 'no_asset_id');
  }
  console.log(`[Avatar][HeyGen] Asset uploade — asset_id=${assetId}`);
  return { assetId, url: data?.url };
}

// ── 2. Creation de l'avatar photo ─────────────────────────────────────────

export interface CreatedAvatar {
  avatarId: string;
  /** 'processing' | 'pending_consent' | 'completed' | 'failed' selon HeyGen. */
  status: string;
  avatarGroupId?: string;
}

/** Nature de l'avatar cote Studiio → valeur du champ `type` chez HeyGen. */
export type AvatarKind = 'photo' | 'video';

const HEYGEN_AVATAR_TYPE: Record<AvatarKind, string> = {
  photo: 'photo',
  // Un avatar entraine a partir de vraies images video. Rendu nettement plus
  // realiste qu'une talking photo, mais entrainement asynchrone plus long.
  video: 'digital_twin',
};

/**
 * POST /v3/avatars — cree un avatar a partir d'un asset deja uploade.
 *
 * Le MEME endpoint sert aux deux natures d'avatar, seul le champ `type`
 * change : 'photo' (image fixe) ou 'digital_twin' (footage video).
 * L'entrainement est asynchrone dans les deux cas.
 */
export async function createAvatarFromAsset(
  assetId: string,
  name: string,
  kind: AvatarKind,
): Promise<CreatedAvatar> {
  const heygenType = HEYGEN_AVATAR_TYPE[kind];
  console.log(
    `[Avatar][HeyGen] POST /v3/avatars — type=${heygenType} (${kind}) asset_id=${assetId} name="${name}"`,
  );

  const data = await heygenFetch<{
    avatar_item?: { id?: string; status?: string };
    avatar_group?: { id?: string; status?: string };
    avatar_id?: string;
    avatar_group_id?: string;
    status?: string;
  }>('/v3/avatars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: heygenType,
      name,
      file: { type: 'asset_id', asset_id: assetId },
    }),
    // L'entrainement d'un digital twin demarre plus lentement que celui d'une
    // talking photo : la reponse de creation peut tarder.
    timeoutMs: kind === 'video' ? 180_000 : 60_000,
  });

  // La forme de reponse varie (avatar_item vs champs a plat) : on tolere les deux.
  const avatarId = data?.avatar_item?.id ?? data?.avatar_id;
  if (!avatarId) {
    throw new HeyGenError("HeyGen n'a pas retourne d'identifiant d'avatar.", 502, 'no_avatar_id');
  }
  const status = data?.avatar_item?.status ?? data?.status ?? 'processing';
  console.log(`[Avatar][HeyGen] Avatar ${kind} cree — id=${avatarId} statut=${status}`);

  return {
    avatarId,
    status,
    avatarGroupId: data?.avatar_group?.id ?? data?.avatar_group_id,
  };
}

/**
 * Avatar photo (talking photo). Conserve pour ne rien changer au flux existant.
 */
export async function createPhotoAvatar(
  assetId: string,
  name: string,
): Promise<CreatedAvatar> {
  return createAvatarFromAsset(assetId, name, 'photo');
}

/** Avatar video (digital twin) — entraine a partir d'un footage. */
export async function createVideoAvatar(
  assetId: string,
  name: string,
): Promise<CreatedAvatar> {
  return createAvatarFromAsset(assetId, name, 'video');
}

export interface AvatarTrainingStatus {
  /** 'processing' | 'pending_consent' | 'completed' | 'failed' */
  status: string;
  /** Renseigne uniquement quand status vaut 'failed'. */
  error?: string;
  /** Voix par defaut associee a l'avatar, si HeyGen en propose une. */
  defaultVoiceId?: string;
}

/**
 * GET /v3/avatars/looks/{look_id} — statut d'entrainement.
 *
 * L'identifiant rendu par la creation est un « look », d'ou ce chemin. Une
 * version anterieure interrogeait /v3/avatars/{id}, qui echouait en silence :
 * le statut etait donc toujours inconnu, pour la photo comme pour la video.
 *
 * Renvoie `null` si l'appel echoue : l'appelant considere alors l'avatar comme
 * potentiellement utilisable et laisse HeyGen trancher a la generation, avec
 * son message reel. On ne bloque jamais l'utilisateur sur une incertitude.
 */
export async function getAvatarTrainingStatus(
  avatarId: string,
): Promise<AvatarTrainingStatus | null> {
  try {
    const data = await heygenFetch<{
      status?: string;
      error?: string;
      default_voice_id?: string;
      avatar_item?: { status?: string; error?: string; default_voice_id?: string };
    }>(`/v3/avatars/looks/${encodeURIComponent(avatarId)}`, {
      method: 'GET',
      timeoutMs: 15_000,
    });

    const item = data?.avatar_item ?? data;
    const status = item?.status;
    if (!status) {
      console.warn(`[Avatar][HeyGen] Statut d'entrainement absent pour ${avatarId}`);
      return null;
    }
    console.log(`[Avatar][HeyGen] Entrainement ${avatarId} — statut=${status}`);
    return {
      status,
      error: item?.error,
      defaultVoiceId: item?.default_voice_id,
    };
  } catch (err) {
    console.warn(
      `[Avatar][HeyGen] Statut d'entrainement illisible pour ${avatarId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Compatibilite : ancienne signature, ne renvoie que la chaine de statut. */
export async function getAvatarStatus(avatarId: string): Promise<string | null> {
  const res = await getAvatarTrainingStatus(avatarId);
  return res?.status ?? null;
}

// ── 3. Generation de la video parlante ────────────────────────────────────

export type AvatarAspectRatio = '9:16' | '16:9' | '1:1';

export interface GenerateVideoParams {
  avatarId: string;
  /** Texte prononce par l'avatar. */
  script: string;
  /**
   * Voix HeyGen — OBLIGATOIRE. Un avatar photo n'a pas de voix par defaut :
   * sans cet identifiant HeyGen renvoie 400 "voice_id is required".
   * Utiliser resolveVoiceId() qui garantit une valeur.
   */
  voiceId: string;
  aspectRatio?: AvatarAspectRatio;
}

/**
 * POST /v3/videos — lance la generation. Retourne immediatement un video_id ;
 * le rendu se poursuit cote HeyGen (voir getVideoStatus).
 */
export async function generateAvatarVideo(
  params: GenerateVideoParams,
): Promise<{ videoId: string; status: string }> {
  const { avatarId, script, voiceId, aspectRatio = '9:16' } = params;

  if (!voiceId || !voiceId.trim()) {
    // Garde-fou : on prefere une erreur explicite a un 400 HeyGen garanti.
    throw new HeyGenError(
      "Aucune voix disponible pour la generation. Verifier la cle HeyGen ou definir HEYGEN_FALLBACK_VOICE_ID.",
      503,
      'no_voice_available',
    );
  }

  const body: Record<string, unknown> = {
    type: 'avatar',
    avatar_id: avatarId,
    script,
    // Toujours present : un avatar photo n'a pas de voix par defaut.
    voice_id: voiceId,
    aspect_ratio: aspectRatio,
    resolution: '720p',
    output_format: 'mp4',
  };

  // Trace de la requete sortante : couplee au log d'erreur de heygenFetch,
  // elle permet de voir exactement quel champ HeyGen rejette.
  console.log(
    '[Avatar][HeyGen] POST /v3/videos payload',
    JSON.stringify({ ...body, script: `${script.slice(0, 60)}… (${script.length} car.)` }),
  );

  const data = await heygenFetch<{ video_id?: string; id?: string; status?: string }>(
    '/v3/videos',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    },
  );

  const videoId = data?.video_id ?? data?.id;
  if (!videoId) {
    throw new HeyGenError("HeyGen n'a pas retourne d'identifiant de video.", 502, 'no_video_id');
  }
  return { videoId, status: data?.status ?? 'pending' };
}

// ── 4. Statut de la video ─────────────────────────────────────────────────

export type HeyGenVideoStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface VideoStatus {
  status: HeyGenVideoStatus;
  videoUrl?: string;
  durationSeconds?: number;
  failureMessage?: string;
}

/** GET /v3/videos/{video_id} — un seul poll. La boucle est geree par l'appelant. */
export async function getVideoStatus(videoId: string): Promise<VideoStatus> {
  const data = await heygenFetch<{
    status?: string;
    video_url?: string;
    duration?: number;
    failure_code?: string;
    failure_message?: string;
  }>(`/v3/videos/${encodeURIComponent(videoId)}`, { method: 'GET', timeoutMs: 20_000 });

  const raw = (data?.status ?? 'processing').toLowerCase();
  const status: HeyGenVideoStatus =
    raw === 'completed' || raw === 'success' || raw === 'done'
      ? 'completed'
      : raw === 'failed' || raw === 'error'
        ? 'failed'
        : raw === 'pending'
          ? 'pending'
          : 'processing';

  return {
    status,
    videoUrl: data?.video_url,
    durationSeconds: typeof data?.duration === 'number' ? data.duration : undefined,
    failureMessage: data?.failure_message ?? data?.failure_code,
  };
}

/** Telecharge le MP4 fini depuis HeyGen pour le re-heberger sur notre stockage. */
export async function downloadVideo(videoUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(videoUrl, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) {
      throw new HeyGenError(
        `Telechargement de la video HeyGen impossible (${res.status}).`,
        502,
        'download_failed',
      );
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof HeyGenError) throw err;
    throw new HeyGenError('Telechargement de la video HeyGen interrompu.', 504, 'download_timeout');
  } finally {
    clearTimeout(timer);
  }
}

// ── Voix disponibles ──────────────────────────────────────────────────────

export interface HeyGenVoice {
  voiceId: string;
  name: string;
  language?: string;
  gender?: string;
}

/**
 * Voix de dernier recours.
 *
 * ⚠️ Cet identifiant provient d'un EXEMPLE de la documentation HeyGen
 * (developers.heygen.com, flux photo-to-video). Il n'a pas ete verifie sur le
 * compte de production : il sert uniquement a ne jamais partir sans voix.
 * Pour le fiabiliser, relever un vrai voice_id du compte via GET /v2/voices et
 * le poser dans la variable d'environnement HEYGEN_FALLBACK_VOICE_ID, qui a
 * priorite sur cette constante.
 */
const DOCUMENTED_FALLBACK_VOICE_ID = '1bd001e7e50f421d891986aad5e3e5d2';

/**
 * Endpoints de listing des voix, essayes dans l'ordre.
 *
 * v2 d'abord : c'est l'endpoint documente et stable (support jusqu'au
 * 31/10/2026), et c'est celui qui repond sur les cles API actuelles. v3 en
 * second, au cas ou le compte n'exposerait que la nouvelle API.
 */
const VOICE_ENDPOINTS = ['/v2/voices', '/v3/voices'];

/** Extrait un tableau de voix quelle que soit la forme de l'enveloppe. */
function extractVoiceArray(body: unknown): Array<Record<string, any>> {
  if (!body) return [];
  if (Array.isArray(body)) return body as Array<Record<string, any>>;
  const b = body as Record<string, any>;
  for (const candidate of [b.voices, b.data?.voices, b.data?.list, b.data?.items, b.data, b.list, b.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/**
 * Liste les voix HeyGen.
 *
 * Chaque tentative journalise l'URL exacte, le statut HTTP et le corps de la
 * reponse (tronque) : c'est ce qui manquait pour comprendre pourquoi le
 * fallback de voix ne produisait aucun voice_id.
 */
export async function listVoices(): Promise<HeyGenVoice[]> {
  for (const path of VOICE_ENDPOINTS) {
    const url = `${HEYGEN_BASE}${path}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { 'X-Api-Key': apiKey() },
          signal: controller.signal,
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      console.log(
        `[Avatar][HeyGen] GET ${url} -> ${res.status} | corps: ${text.slice(0, 800)}`,
      );

      if (!res.ok) continue;

      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        console.error(`[Avatar][HeyGen] ${url} : reponse non-JSON`);
        continue;
      }

      const voices = extractVoiceArray(parsed)
        .map((v) => ({
          voiceId: String(v.voice_id ?? v.id ?? ''),
          name: String(v.display_name ?? v.name ?? 'Voix'),
          language: v.language ? String(v.language) : undefined,
          gender: v.gender ? String(v.gender) : undefined,
        }))
        .filter((v) => v.voiceId);

      if (voices.length > 0) {
        console.log(`[Avatar][HeyGen] ${url} : ${voices.length} voix exploitables`);
        return voices;
      }
      console.error(`[Avatar][HeyGen] ${url} : 0 voix exploitable dans la reponse`);
    } catch (err) {
      console.error(
        `[Avatar][HeyGen] ${url} : appel impossible —`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.error('[Avatar][HeyGen] Aucun endpoint de voix exploitable');
  return [];
}

/**
 * Une voix francaise si possible, sinon anglaise, sinon la premiere venue.
 * Le champ `language` est parfois un libelle ("French", "fr-FR", "Francais") :
 * on teste les deux ecritures.
 */
export function pickDefaultVoice(voices: HeyGenVoice[]): HeyGenVoice | undefined {
  if (voices.length === 0) return undefined;
  const lang = (v: HeyGenVoice) => (v.language || '').toLowerCase();
  const isFrench = (v: HeyGenVoice) => lang(v).startsWith('fr') || lang(v).includes('french');
  const isEnglish = (v: HeyGenVoice) => lang(v).startsWith('en') || lang(v).includes('english');
  return voices.find(isFrench) ?? voices.find(isEnglish) ?? voices[0];
}

/**
 * Resout la voix a utiliser, avec garantie de resultat.
 *
 * Un avatar photo HeyGen n'a AUCUNE voix par defaut : sans voice_id, la
 * generation echoue systematiquement en 400
 * ("voice_id is required: this avatar has no default voice configured").
 * Cette fonction ne rend donc jamais `undefined`.
 *
 * Ordre : voix demandee → liste HeyGen (FR prioritaire) → env
 * HEYGEN_FALLBACK_VOICE_ID → constante issue de la doc HeyGen.
 */
export async function resolveVoiceId(requested?: string): Promise<string> {
  if (requested && requested.trim()) {
    const v = requested.trim();
    console.log('[Avatar][HeyGen] Voix demandee par le client:', v);
    return v;
  }

  const voices = await listVoices();
  const picked = pickDefaultVoice(voices);
  if (picked) {
    console.log(
      `[Avatar][HeyGen] Voix par defaut retenue: ${picked.voiceId} (${picked.name}, ${picked.language ?? 'langue inconnue'})`,
    );
    return picked.voiceId;
  }

  const envFallback = process.env.HEYGEN_FALLBACK_VOICE_ID?.trim();
  if (envFallback) {
    console.warn('[Avatar][HeyGen] Liste de voix indisponible — repli sur HEYGEN_FALLBACK_VOICE_ID');
    return envFallback;
  }

  console.warn(
    '[Avatar][HeyGen] Liste de voix indisponible et HEYGEN_FALLBACK_VOICE_ID non definie — repli sur la voix documentee',
  );
  return DOCUMENTED_FALLBACK_VOICE_ID;
}
