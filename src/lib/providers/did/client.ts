/**
 * Client D-ID — V3 Instant Avatar (« Express Avatar ») et scènes.
 *
 * Contrat lu sur docs.d-id.com le 2026-09-15 (pages de référence) :
 *
 *   POST   /consents                 { language }                → { id, text }
 *   POST   /consents/{id}            { name, source_url }         → { id }  (vidéo de consentement)
 *   GET    /consents/{id}                                         → { status: validating|created|done|error, error? }
 *   POST   /scenes/avatars           { source_url, consent_id, name } → { id, status }
 *   GET    /scenes/avatars/{id}                                   → { status: draft|created|started|training-started|validating|done|error|rejected, error? }
 *   DELETE /scenes/avatars/{id}                                   → 204
 *   POST   /scenes                   { avatar_id, script: { type: 'audio', audio_url }, name } → { id, status }
 *   GET    /scenes/{id}                                           → { status: created|started|done|error|rejected, result_url?, error? }
 *
 * `source_url` doit être HTTPS et se terminer par .mp4/.mov/.mpeg. Le corps
 * d'erreur D-ID est `{ kind, description }`.
 *
 * TOUT passe par ici, côté serveur : la clé ne sort jamais (ni navigateur,
 * ni journaux, ni messages). Timeouts explicites. Erreurs normalisées en
 * `DidError { message, httpStatus, code }`. Aucun repli vers un autre
 * fournisseur.
 *
 * Authentification : HTTP Basic. La clé Studio D-ID a la forme
 * `API_USERNAME:API_PASSWORD` ; l'en-tête Basic porte base64(username:password).
 * Une clé qui contient déjà `:` est encodée ici ; une clé sans `:` est
 * considérée déjà encodée (base64 n'a pas de `:`) et passée telle quelle.
 */

export const DID_API_BASE = 'https://api.d-id.com';

export class DidError extends Error {
  constructor(message: string, public httpStatus: number, public code: string) {
    super(message);
    this.name = 'DidError';
  }
}

export function cleDid(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DID_API_KEY?.trim() || null;
}

/** Le moteur D-ID n'existe pour l'application que si le drapeau ET la clé sont là. */
export function didVideoAvatarDisponible(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DID_VIDEO_AVATAR_ACTIVE === '1' && cleDid(env) !== null;
}

/** Le drapeau est levé mais la clé manque : l'écran doit le dire, pas planter. */
export function didVideoAvatarConfigure(env: NodeJS.ProcessEnv = process.env): boolean {
  return cleDid(env) !== null;
}

export function enteteAutorisationDid(cle: string): string {
  const encodee = cle.includes(':') ? Buffer.from(cle, 'utf8').toString('base64') : cle;
  return `Basic ${encodee}`;
}

export interface DepsDid { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; /** Plafond par appel (tests) ; sinon le délai propre à chaque opération. */ timeoutMs?: number }

async function didFetch<T>(
  chemin: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number },
  deps: DepsDid = {},
): Promise<T> {
  const env = deps.env ?? process.env;
  const f = deps.fetch ?? fetch;
  const cle = cleDid(env);
  if (!cle) throw new DidError("Le fournisseur d'avatar vidéo n'est pas configuré sur ce serveur.", 503, 'did_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? init.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await f(`${DID_API_BASE}${chemin}`, {
      method: init.method,
      headers: {
        Authorization: enteteAutorisationDid(cle),
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    throw new DidError("Le fournisseur d'avatar vidéo n'a pas répondu à temps.", 504, 'did_timeout');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const texte = await res.text();
  let corps: Record<string, unknown> = {};
  try { corps = texte ? (JSON.parse(texte) as Record<string, unknown>) : {}; } catch { corps = {}; }
  if (!res.ok) throw erreurNormalisee(res.status, corps);
  return corps as T;
}

function erreurNormalisee(statut: number, corps: Record<string, unknown>): DidError {
  const kind = typeof corps.kind === 'string' ? corps.kind : 'unknown';
  const description = typeof corps.description === 'string' ? corps.description : '';
  if (statut === 401 || statut === 403) return new DidError("Clé D-ID refusée. Vérifier DID_API_KEY côté serveur.", 502, 'did_unauthorized');
  if (statut === 402) return new DidError('Crédits D-ID insuffisants côté fournisseur.', 402, 'did_insufficient_credits');
  if (statut === 404) return new DidError('Ressource D-ID introuvable.', 404, 'did_not_found');
  if (statut === 400 || statut === 422) {
    return new DidError(`Le fournisseur a refusé la demande${description ? ` : ${description}` : ''}.`, 400, `did_${kind.toLowerCase()}`);
  }
  if (statut >= 500) return new DidError('Le fournisseur d’avatar vidéo est momentanément indisponible.', 502, 'did_unavailable');
  return new DidError(`Erreur fournisseur (${statut}).`, 502, `did_http_${statut}`);
}

const HTTPS_VIDEO = /^https:\/\/.+\.(mp4|MP4|mov|MOV|mpeg|MPEG)(\?.*)?$/;
const HTTPS = /^https:\/\/.+/;

// ── Consentement ───────────────────────────────────────────────────────────

export type StatutConsentementDid = 'created' | 'validating' | 'done' | 'error';

export async function creerConsentement(langue = 'French', deps?: DepsDid): Promise<{ id: string; texte: string }> {
  const r = await didFetch<{ id?: string; text?: string }>('/consents', { method: 'POST', body: { language: langue } }, deps);
  if (!r.id || typeof r.text !== 'string' || r.text.trim().length === 0) {
    throw new DidError('Réponse D-ID incomplète (consentement sans identifiant ou sans texte).', 502, 'did_bad_response');
  }
  return { id: r.id, texte: r.text.trim() };
}

export async function deposerVideoConsentement(
  args: { consentId: string; nom: string; sourceUrl: string }, deps?: DepsDid,
): Promise<{ id: string }> {
  if (!HTTPS_VIDEO.test(args.sourceUrl)) throw new DidError('URL de vidéo de consentement invalide.', 400, 'did_bad_source_url');
  const r = await didFetch<{ id?: string }>(
    `/consents/${encodeURIComponent(args.consentId)}`,
    { method: 'POST', body: { name: args.nom, source_url: args.sourceUrl }, timeoutMs: 60_000 },
    deps,
  );
  return { id: r?.id ?? args.consentId };
}

export async function lireConsentement(consentId: string, deps?: DepsDid): Promise<{ statut: StatutConsentementDid; erreur: string | null }> {
  const r = await didFetch<{ status?: string; error?: { description?: string } | string }>(
    `/consents/${encodeURIComponent(consentId)}`, { method: 'GET' }, deps,
  );
  const statut = (['created', 'validating', 'done', 'error'] as const).find((s) => s === r.status) ?? 'validating';
  return { statut, erreur: descriptionErreur(r.error) };
}

// ── Avatar ─────────────────────────────────────────────────────────────────

export type StatutAvatarDid = 'draft' | 'created' | 'started' | 'training-started' | 'validating' | 'done' | 'error' | 'rejected';
const STATUTS_AVATAR: readonly StatutAvatarDid[] = ['draft', 'created', 'started', 'training-started', 'validating', 'done', 'error', 'rejected'];

export async function creerAvatarDid(
  args: { sourceUrl: string; consentId: string; nom: string }, deps?: DepsDid,
): Promise<{ id: string; statut: StatutAvatarDid }> {
  if (!HTTPS_VIDEO.test(args.sourceUrl)) throw new DidError('URL de vidéo source invalide.', 400, 'did_bad_source_url');
  const r = await didFetch<{ id?: string; status?: string }>(
    '/scenes/avatars',
    { method: 'POST', body: { source_url: args.sourceUrl, consent_id: args.consentId, name: args.nom }, timeoutMs: 60_000 },
    deps,
  );
  if (!r.id) throw new DidError("Réponse D-ID incomplète (avatar sans identifiant).", 502, 'did_bad_response');
  return { id: r.id, statut: STATUTS_AVATAR.find((s) => s === r.status) ?? 'created' };
}

export async function lireAvatarDid(avatarId: string, deps?: DepsDid): Promise<{ statut: StatutAvatarDid; erreur: string | null }> {
  const r = await didFetch<{ status?: string; error?: { description?: string } | string }>(
    `/scenes/avatars/${encodeURIComponent(avatarId)}`, { method: 'GET' }, deps,
  );
  return { statut: STATUTS_AVATAR.find((s) => s === r.status) ?? 'created', erreur: descriptionErreur(r.error) };
}

/** 204 → true ; 404 → true aussi (déjà absent : l'intention est tenue). Toute autre erreur remonte. */
export async function supprimerAvatarDid(avatarId: string, deps?: DepsDid): Promise<boolean> {
  try {
    await didFetch<void>(`/scenes/avatars/${encodeURIComponent(avatarId)}`, { method: 'DELETE' }, deps);
    return true;
  } catch (e) {
    if (e instanceof DidError && e.code === 'did_not_found') return true;
    throw e;
  }
}

// ── Scène (vidéo) : audio EXTERNE, jamais un script texte ──────────────────

export type StatutSceneDid = 'created' | 'started' | 'done' | 'error' | 'rejected';

export async function creerSceneAudio(
  args: { avatarId: string; audioUrl: string; nom: string }, deps?: DepsDid,
): Promise<{ id: string; statut: StatutSceneDid }> {
  if (!HTTPS.test(args.audioUrl)) throw new DidError("URL d'audio invalide.", 400, 'did_bad_audio_url');
  const body = { avatar_id: args.avatarId, script: { type: 'audio', audio_url: args.audioUrl }, name: args.nom };
  const r = await didFetch<{ id?: string; status?: string }>('/scenes', { method: 'POST', body, timeoutMs: 60_000 }, deps);
  if (!r.id) throw new DidError('Réponse D-ID incomplète (scène sans identifiant).', 502, 'did_bad_response');
  return { id: r.id, statut: (['created', 'started', 'done', 'error', 'rejected'] as const).find((s) => s === r.status) ?? 'created' };
}

/** Même forme que `getVideoStatus` (HeyGen) : `completed` + URL, `failed` + message, ou en cours. */
export async function lireScene(
  sceneId: string, deps?: DepsDid,
): Promise<{ status: 'completed' | 'failed' | 'processing'; videoUrl: string | null; failureMessage: string | null }> {
  const r = await didFetch<{ status?: string; result_url?: string; error?: { description?: string } | string }>(
    `/scenes/${encodeURIComponent(sceneId)}`, { method: 'GET' }, deps,
  );
  if (r.status === 'done' && typeof r.result_url === 'string' && HTTPS.test(r.result_url)) {
    return { status: 'completed', videoUrl: r.result_url, failureMessage: null };
  }
  if (r.status === 'error' || r.status === 'rejected') {
    return { status: 'failed', videoUrl: null, failureMessage: descriptionErreur(r.error) ?? `D-ID a signalé un échec (${r.status}).` };
  }
  return { status: 'processing', videoUrl: null, failureMessage: null };
}

/** Télécharge le résultat D-ID (`result_url`, temporaire) : type vidéo exigé, jamais vide. */
export async function telechargerResultat(url: string, deps?: DepsDid): Promise<Buffer> {
  if (!HTTPS.test(url)) throw new DidError('URL de résultat invalide.', 400, 'did_bad_result_url');
  const f = deps?.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await f(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new DidError(`Téléchargement de la vidéo D-ID impossible (${res.status}).`, 502, 'did_download_failed');
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('video/') && !type.includes('mp4') && !type.includes('octet-stream')) {
      throw new DidError(`Le résultat D-ID n'est pas une vidéo (${type || 'type inconnu'}).`, 502, 'did_bad_result_type');
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new DidError('Le résultat D-ID est vide.', 502, 'did_empty_result');
    return buffer;
  } catch (e) {
    if (e instanceof DidError) throw e;
    throw new DidError('Téléchargement de la vidéo D-ID interrompu.', 504, 'did_download_timeout');
  } finally {
    clearTimeout(timer);
  }
}

function descriptionErreur(e: unknown): string | null {
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (e && typeof e === 'object' && typeof (e as { description?: unknown }).description === 'string') {
    return (e as { description: string }).description;
  }
  return null;
}
