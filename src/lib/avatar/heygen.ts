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

/**
 * POST /v3/assets — envoie l'image (multipart, champ `file`, max 32 Mo cote HeyGen).
 */
export async function uploadAsset(
  file: Blob,
  filename: string,
): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file, filename);

  const data = await heygenFetch<{ asset_id?: string; id?: string; url?: string }>(
    '/v3/assets',
    { method: 'POST', body: form, timeoutMs: 120_000 },
  );

  const assetId = data?.asset_id ?? data?.id;
  if (!assetId) {
    throw new HeyGenError("HeyGen n'a pas retourne d'identifiant d'asset.", 502, 'no_asset_id');
  }
  return { assetId, url: data?.url };
}

// ── 2. Creation de l'avatar photo ─────────────────────────────────────────

export interface CreatedAvatar {
  avatarId: string;
  /** 'processing' | 'completed' | 'failed' selon HeyGen. */
  status: string;
  avatarGroupId?: string;
}

/**
 * POST /v3/avatars — cree un avatar photo a partir d'un asset deja uploade.
 * L'entrainement est asynchrone : le statut initial est generalement 'processing'.
 */
export async function createPhotoAvatar(
  assetId: string,
  name: string,
): Promise<CreatedAvatar> {
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
      type: 'photo',
      name,
      file: { type: 'asset_id', asset_id: assetId },
    }),
    timeoutMs: 60_000,
  });

  // La forme de reponse varie (avatar_item vs champs a plat) : on tolere les deux.
  const avatarId = data?.avatar_item?.id ?? data?.avatar_id;
  if (!avatarId) {
    throw new HeyGenError("HeyGen n'a pas retourne d'identifiant d'avatar.", 502, 'no_avatar_id');
  }
  return {
    avatarId,
    status: data?.avatar_item?.status ?? data?.status ?? 'processing',
    avatarGroupId: data?.avatar_group?.id ?? data?.avatar_group_id,
  };
}

/**
 * GET /v3/avatars/{id} — statut d'entrainement de l'avatar.
 *
 * Cet endpoint n'est pas formellement documente pour les avatars photo. S'il
 * echoue, on renvoie `null` : l'appelant considere alors l'avatar comme
 * utilisable et laissera la generation video echouer avec un message clair si
 * l'entrainement n'est pas termine. On ne bloque jamais l'utilisateur sur une
 * incertitude de documentation.
 */
export async function getAvatarStatus(avatarId: string): Promise<string | null> {
  try {
    const data = await heygenFetch<{
      status?: string;
      avatar_item?: { status?: string };
    }>(`/v3/avatars/${encodeURIComponent(avatarId)}`, { method: 'GET', timeoutMs: 15_000 });
    return data?.avatar_item?.status ?? data?.status ?? null;
  } catch {
    return null;
  }
}

// ── 3. Generation de la video parlante ────────────────────────────────────

export type AvatarAspectRatio = '9:16' | '16:9' | '1:1';

export interface GenerateVideoParams {
  avatarId: string;
  /** Texte prononce par l'avatar. */
  script: string;
  /** Voix HeyGen. Optionnel : HeyGen choisit une voix par defaut si absent. */
  voiceId?: string;
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

  const body: Record<string, unknown> = {
    type: 'avatar',
    avatar_id: avatarId,
    script,
    aspect_ratio: aspectRatio,
    resolution: '720p',
    output_format: 'mp4',
  };
  // Une voix est TOUJOURS envoyee quand on en a une : HeyGen refuse un
  // voice_id vide, et l'omettre ne garantit pas une voix par defaut.
  if (voiceId) body.voice_id = voiceId;

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
 * GET /v3/voices — liste des voix.
 *
 * Retourne [] en cas d'echec (non bloquant pour l'affichage), mais journalise
 * la raison : une liste vide est justement ce qui menait a envoyer une
 * generation sans voix, et donc au 400 de HeyGen.
 */
export async function listVoices(): Promise<HeyGenVoice[]> {
  try {
    const data = await heygenFetch<{
      voices?: Array<{
        voice_id?: string;
        id?: string;
        name?: string;
        display_name?: string;
        language?: string;
        gender?: string;
      }>;
    }>('/v3/voices?limit=200', { method: 'GET', timeoutMs: 20_000 });

    // Selon la version, la liste est sous `voices` ou directement un tableau.
    const list = Array.isArray(data?.voices)
      ? data.voices
      : Array.isArray(data)
        ? (data as unknown as Array<Record<string, string>>)
        : [];

    const voices = list
      .map((v) => ({
        voiceId: v.voice_id ?? v.id ?? '',
        name: v.display_name ?? v.name ?? 'Voix',
        language: v.language,
        gender: v.gender,
      }))
      .filter((v) => v.voiceId);

    if (voices.length === 0) {
      console.error('[Avatar][HeyGen] /v3/voices a renvoye 0 voix exploitable');
    }
    return voices;
  } catch (err) {
    console.error(
      '[Avatar][HeyGen] Chargement des voix impossible:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Une voix francaise si possible, sinon anglaise, sinon la premiere venue. */
export function pickDefaultVoice(voices: HeyGenVoice[]): HeyGenVoice | undefined {
  if (voices.length === 0) return undefined;
  const isLang = (v: HeyGenVoice, prefix: string) =>
    (v.language || '').toLowerCase().startsWith(prefix);
  return (
    voices.find((v) => isLang(v, 'fr')) ??
    voices.find((v) => isLang(v, 'en')) ??
    voices[0]
  );
}

/**
 * Resout la voix a utiliser cote serveur.
 * Garantit qu'on n'envoie JAMAIS un voice_id vide a HeyGen : soit une voix
 * valide, soit `undefined` (champ omis) si la liste est indisponible.
 */
export async function resolveVoiceId(requested?: string): Promise<string | undefined> {
  if (requested && requested.trim()) return requested.trim();
  const voices = await listVoices();
  const fallback = pickDefaultVoice(voices);
  if (fallback) {
    console.log('[Avatar][HeyGen] Voix par defaut retenue:', fallback.voiceId, fallback.name);
  }
  return fallback?.voiceId;
}
