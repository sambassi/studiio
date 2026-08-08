/**
 * Zernio — l'agrégateur de publication réseaux, côté SERVEUR uniquement.
 *
 * ⚠️ UNE SEULE CLÉ POUR TOUS LES UTILISATEURS. `ZERNIO_API_KEY` appartient à
 * Studiio ; c'est le `profileId` qui sépare les clients. Elle ne doit donc
 * JAMAIS partir au navigateur — pas de `NEXT_PUBLIC_`, et aucun appel Zernio
 * depuis un composant client. Ce module n'est importable que par des routes
 * serveur.
 *
 * ⚠️ ET LE PROFIL EST FACTURÉ. On n'en crée un qu'au moment où l'utilisateur
 * active l'option payante, jamais à l'inscription : provisionner d'avance
 * ferait payer Studiio pour des comptes qui ne publieront jamais.
 *
 * Contrats vérifiés sur la spécification OpenAPI publique de Zernio
 * (`https://docs.zernio.com`, base `https://zernio.com/api/v1`) — pas
 * reconstitués de mémoire. Les points qui ne se devinent pas :
 *
 * - Le média N'ACCEPTE PAS une URL publique arbitraire. Il faut demander une
 *   URL présignée (`POST /media/presign`), y téléverser le fichier en `PUT`,
 *   puis référencer le `publicUrl` rendu. Une URL de notre stockage passée
 *   directement est refusée.
 * - Le retour de connexion porte déjà `accountId` et `username` en paramètres
 *   d'URL : le compte peut être enregistré sans attendre le webhook.
 */

const BASE = 'https://zernio.com/api/v1';

/** Délai maximal d'un appel — un agrégateur lent ne doit pas geler un cycle. */
const TIMEOUT_MS = 20_000;

/** Les plateformes que Studiio expose. Zernio en accepte davantage. */
export const ZERNIO_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'youtube'] as const;
export type ZernioPlatform = typeof ZERNIO_PLATFORMS[number];

export function isZernioPlatform(v: unknown): v is ZernioPlatform {
  return typeof v === 'string' && (ZERNIO_PLATFORMS as readonly string[]).includes(v);
}

/**
 * Échec d'un appel Zernio, avec son code HTTP.
 *
 * ⚠️ DEUX CODES SE TRAITENT À PART, et c'est pourquoi ils sont portés ici
 * plutôt que noyés dans un message :
 *
 * - `429` — quota. `retryAfter` porte le délai annoncé ; réessayer avant ne
 *   fait qu'aggraver.
 * - `402` — la facturation Zernio est suspendue. Réessayer ne servira JAMAIS
 *   tant qu'un humain n'a rien fait : il faut alerter, pas boucler.
 */
export class ZernioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ZernioError';
  }

  /** Réessayer plus tard a-t-il une chance d'aboutir ? */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** La facturation Zernio est-elle suspendue ? Aucun réessai ne l'y changera. */
  get paymentRequired(): boolean {
    return this.status === 402;
  }
}

function apiKey(): string {
  const cle = process.env.ZERNIO_API_KEY?.trim();
  if (!cle) {
    throw new ZernioError('ZERNIO_API_KEY absente — publication réseaux indisponible.', 503);
  }
  return cle;
}

/** Zernio est-il configuré sur ce serveur ? */
export function zernioConfigured(): boolean {
  return !!process.env.ZERNIO_API_KEY?.trim();
}

async function appel<T>(
  chemin: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(`${BASE}${chemin}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : null),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controleur.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const texte = await res.text().catch(() => '');
      const retry = Number(res.headers.get('retry-after'));
      throw new ZernioError(
        `Zernio ${options.method ?? 'GET'} ${chemin} → ${res.status} ${texte.slice(0, 300)}`,
        res.status,
        Number.isFinite(retry) ? retry : undefined,
      );
    }
    return await res.json() as T;
  } catch (err) {
    if (err instanceof ZernioError) throw err;
    // Délai dépassé, DNS, coupure : réessayable, comme un 5xx.
    throw new ZernioError(
      `Zernio ${chemin} injoignable : ${err instanceof Error ? err.message : String(err)}`,
      503,
    );
  } finally {
    clearTimeout(minuteur);
  }
}

// ── Profils ──────────────────────────────────────────────────────────────

export interface ZernioProfile {
  _id: string;
  name: string;
}

/**
 * Crée le profil d'un utilisateur — la frontière entre deux clients.
 *
 * ⚠️ `name` EST UNIQUE PAR ÉQUIPE, d'où l'identifiant Studiio plutôt que le
 * nom affiché : deux utilisateurs peuvent s'appeler pareil, jamais avoir le
 * même identifiant. C'est aussi ce qui rend la création RATTRAPABLE — un
 * appel qui expire puis un 409 au réessai se résout en relisant le profil par
 * son nom, sans en créer un second (donc sans payer deux fois).
 */
export async function createProfile(name: string, description?: string): Promise<ZernioProfile> {
  const r = await appel<{ profile?: ZernioProfile } & Partial<ZernioProfile>>('/profiles', {
    method: 'POST',
    body: { name, description },
  });
  const profil = r.profile ?? (r as ZernioProfile);
  if (!profil?._id) throw new ZernioError('Zernio : profil créé sans identifiant.', 502);
  return profil;
}

/** Retrouve un profil par son nom — le rattrapage d'une création ambiguë. */
export async function findProfileByName(name: string): Promise<ZernioProfile | null> {
  const r = await appel<{ profiles?: ZernioProfile[] }>('/profiles', { query: { name } });
  return r.profiles?.find((p) => p.name === name) ?? null;
}

// ── Connexion d'un compte ────────────────────────────────────────────────

/**
 * URL d'autorisation vers laquelle rediriger le NAVIGATEUR de l'utilisateur.
 *
 * Mode standard (pas `headless`) : Zernio héberge la sélection du compte puis
 * revient sur `redirectUrl` en y ajoutant
 * `connected={platform}&profileId=…&accountId=…&username=…`. C'est cette
 * page de retour qui enregistre le compte — le webhook ne fait que confirmer.
 */
export async function getConnectUrl(
  platform: ZernioPlatform,
  profileId: string,
  redirectUrl: string,
): Promise<string> {
  const r = await appel<{ authUrl?: string }>(`/connect/${platform}`, {
    query: { profileId, redirect_url: redirectUrl },
  });
  if (!r.authUrl) throw new ZernioError('Zernio : aucune URL d’autorisation rendue.', 502);
  return r.authUrl;
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  status?: string;
}

export async function listAccounts(profileId: string): Promise<ZernioAccount[]> {
  const r = await appel<{ accounts?: ZernioAccount[] }>('/accounts', { query: { profileId } });
  return r.accounts ?? [];
}

// ── Média ────────────────────────────────────────────────────────────────

/**
 * Téléverse un fichier chez Zernio et rend l'URL à référencer dans un post.
 *
 * ⚠️ CE DÉTOUR N'EST PAS FACULTATIF. Zernio refuse une URL arbitraire : il
 * faut demander une URL présignée, y déposer le fichier, puis utiliser le
 * `publicUrl` rendu. Envoyer directement l'URL de notre stockage produit un
 * post refusé — et le message d'erreur ne dit pas pourquoi.
 *
 * L'URL présignée vaut une heure, le fichier temporaire sept jours : on
 * téléverse donc AU MOMENT de publier, jamais à l'avance.
 */
export async function uploadMedia(
  fichierUrl: string,
  filename: string,
  contentType = 'video/mp4',
): Promise<string> {
  const presign = await appel<{ uploadUrl: string; publicUrl: string }>('/media/presign', {
    method: 'POST',
    body: { filename, contentType },
  });

  const source = await fetch(fichierUrl, { cache: 'no-store' });
  if (!source.ok) {
    throw new ZernioError(`Média introuvable (${source.status}) : ${fichierUrl}`, 422);
  }
  const octets = await source.arrayBuffer();

  // ⚠️ PAS D'EN-TETE `Authorization` ICI. L'URL présignée porte déjà son
  // autorisation ; y ajouter la nôtre fait échouer la signature du stockage.
  const depot = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: octets,
  });
  if (!depot.ok) {
    throw new ZernioError(`Téléversement du média refusé (${depot.status}).`, 502);
  }
  return presign.publicUrl;
}

// ── Publication ──────────────────────────────────────────────────────────

export interface ZernioPostCible {
  platform: string;
  accountId: string;
}

export interface ZernioPostInput {
  content: string;
  platforms: ZernioPostCible[];
  /** URL rendue par `uploadMedia`, jamais une URL de notre stockage. */
  mediaUrl?: string;
  /** ISO. Avec `timezone`, programme le post. */
  scheduledFor?: string;
  timezone?: string;
  publishNow?: boolean;
  /** Correlation : on y range l'identifiant du post Studiio. */
  metadata?: Record<string, unknown>;
}

export interface ZernioPostResult {
  _id: string;
  status?: string;
}

/**
 * Crée un post.
 *
 * Ni `scheduledFor` ni `publishNow` ⇒ Zernio le range en BROUILLON. C'est un
 * comportement de sa part, pas une erreur de la nôtre : on ne transmet donc
 * que ce que l'appelant a réellement demandé.
 */
export async function createPost(input: ZernioPostInput): Promise<ZernioPostResult> {
  const r = await appel<{ post?: ZernioPostResult } & Partial<ZernioPostResult>>('/posts', {
    method: 'POST',
    body: {
      content: input.content,
      platforms: input.platforms,
      ...(input.mediaUrl ? { mediaItems: [{ type: 'video', url: input.mediaUrl }] } : null),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : null),
      ...(input.timezone ? { timezone: input.timezone } : null),
      ...(input.publishNow ? { publishNow: true } : null),
      ...(input.metadata ? { metadata: input.metadata } : null),
    },
  });
  const post = r.post ?? (r as ZernioPostResult);
  if (!post?._id) throw new ZernioError('Zernio : post créé sans identifiant.', 502);
  return post;
}
