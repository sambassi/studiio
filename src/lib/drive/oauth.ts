import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Connexion Google Drive — OAuth et jetons.
 *
 * Drive passe par le MEME projet Google que la connexion YouTube
 * (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), mais avec sa propre portee et
 * son propre stockage : ce n'est pas un reseau social, il n'a ni compte a
 * publier ni page a lier.
 *
 * ⚠️ Le `state` est SIGNE. Le connecteur social historique transporte le
 * `userId` en clair (`userId:timestamp:random`) et le callback le reprend tel
 * quel : appeler ce callback avec l'identifiant d'un tiers rattache le compte
 * de l'appelant a la victime. Un correctif est en cours ailleurs sur ce
 * connecteur-la ; il n'y a aucune raison d'introduire le meme defaut ici.
 */

/** Portee minimale : l'application ne voit QUE les fichiers qu'elle a crees. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Au-dela, un `state` est considere perime. */
const STATE_TTL_MS = 15 * 60 * 1000;

function stateSecret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

export function appUrl(): string {
  return (
    process.env.NEXTAUTH_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export function redirectUri(): string {
  return `${appUrl()}/api/drive/callback`;
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * `state` signe : `<userId>.<timestamp>.<aleatoire>.<signature>`.
 *
 * Rend `null` sans secret : mieux vaut refuser la connexion que d'emettre un
 * state que personne ne peut verifier.
 */
export function signState(userId: string): string | null {
  const key = stateSecret();
  if (!key || !userId) return null;
  const payload = `${userId}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  return `${payload}.${sign(payload, key)}`;
}

export type VerifiedState =
  | { ok: true; userId: string }
  | { ok: false; reason: 'absent' | 'malforme' | 'signature' | 'perime' | 'secret' };

/** Verifie le `state` et rend l'utilisateur qu'il designe. */
export function verifyState(state: string | null | undefined): VerifiedState {
  if (!state) return { ok: false, reason: 'absent' };
  const key = stateSecret();
  if (!key) return { ok: false, reason: 'secret' };

  const parts = state.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malforme' };
  const [userId, ts, alea, signature] = parts;
  if (!userId || !ts || !alea || !signature) return { ok: false, reason: 'malforme' };

  const attendue = sign(`${userId}.${ts}.${alea}`, key);
  const a = Buffer.from(signature);
  const b = Buffer.from(attendue);
  // Comparaison a temps constant : une comparaison ordinaire fuit la
  // signature attendue, octet par octet, par le temps de reponse.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature' };
  }

  const emis = Number(ts);
  if (!Number.isFinite(emis) || Date.now() - emis > STATE_TTL_MS) {
    return { ok: false, reason: 'perime' };
  }
  return { ok: true, userId };
}

/** URL de consentement Google, ou `null` si l'application n'est pas configuree. */
export function buildAuthUrl(state: string): string | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // `offline` + `consent` : sans les deux, Google ne renvoie AUCUN jeton de
    // rafraichissement a la deuxieme connexion, et l'envoi cesserait de
    // fonctionner une heure plus tard sans que rien ne l'explique.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface DriveTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string | null;
}

/** Echange le code d'autorisation contre des jetons. */
export async function exchangeCode(code: string): Promise<DriveTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Échange du code refusé par Google (${res.status})${data?.error ? ` : ${data.error}` : ''}`,
    );
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    expiresAt: typeof data.expires_in === 'number'
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
    scopes: typeof data.scope === 'string' ? data.scope : null,
  };
}

/** Adresse du compte relie — pour que l'utilisateur sache VERS QUEL Drive il envoie. */
export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}

/**
 * Sonde de disponibilite de la table, memoisee — meme dispositif que la liste
 * de suppression des emails et que les voix clonees.
 */
let storeProbe: { ready: boolean; at: number } | null = null;
const STORE_PROBE_TTL_MS = 60_000;

export async function driveStoreReady(): Promise<boolean> {
  const now = Date.now();
  if (storeProbe?.ready) return true;
  if (storeProbe && now - storeProbe.at < STORE_PROBE_TTL_MS) return false;
  let ready = false;
  try {
    const { error } = await supabaseAdmin.from('user_drive').select('id').limit(1);
    ready = !error;
    if (error) {
      console.error(
        `[Drive] Table user_drive indisponible (${error.message}) — connexion DESACTIVEE. `
        + 'Appliquer migrations/2026-08-04-user-drive.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Drive] Sonde user_drive impossible :', err);
  }
  storeProbe = { ready, at: now };
  return ready;
}

export interface DriveAccount {
  user_id: string;
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string | null;
  connected: boolean;
}

/** Compte Drive de l'utilisateur, ou `null`. Ne leve jamais. */
export async function getDriveAccount(userId: string): Promise<DriveAccount | null> {
  if (!userId || !(await driveStoreReady())) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('user_drive')
      .select('*')
      .eq('user_id', userId)
      .limit(1);
    if (error || !data?.length) return null;
    const row = data[0] as DriveAccount;
    return row.connected ? row : null;
  } catch (err) {
    console.error('[Drive] Lecture user_drive impossible :', err);
    return null;
  }
}

/** Range les jetons. Un `refresh_token` absent ne doit JAMAIS effacer l'ancien. */
export async function saveDriveAccount(
  userId: string,
  tokens: DriveTokens,
  accountEmail: string | null,
): Promise<boolean> {
  try {
    const existant = await getDriveAccount(userId);
    const { error } = await supabaseAdmin
      .from('user_drive')
      .upsert(
        {
          user_id: userId,
          account_email: accountEmail ?? existant?.account_email ?? null,
          access_token: tokens.accessToken,
          // Google ne renvoie le jeton de rafraichissement qu'au PREMIER
          // consentement : l'ecraser par `null` a la reconnexion couperait
          // l'envoi une heure plus tard.
          refresh_token: tokens.refreshToken ?? existant?.refresh_token ?? null,
          expires_at: tokens.expiresAt,
          scopes: tokens.scopes ?? existant?.scopes ?? null,
          connected: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      console.error('[Drive] Ecriture user_drive echouee :', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Drive] Ecriture user_drive impossible :', err);
    return false;
  }
}

/** Coupe la connexion. Le jeton reste revocable cote Google par l'utilisateur. */
export async function disconnectDrive(userId: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('user_drive').delete().eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}

/** Marge avant expiration — la meme que le rafraichissement des jetons sociaux. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Jeton d'acces valide, rafraichi si besoin.
 *
 * Rend `null` quand la connexion est inexploitable : jeton expire ET aucun
 * jeton de rafraichissement, ou refus de Google. L'appelant doit alors
 * demander une reconnexion plutot que de tenter un envoi voue au 401.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const compte = await getDriveAccount(userId);
  if (!compte) return null;

  const expire = compte.expires_at ? Date.parse(compte.expires_at) : NaN;
  const bientot = Number.isFinite(expire) && expire - Date.now() < REFRESH_BUFFER_MS;
  if (!bientot) return compte.access_token;

  if (!compte.refresh_token) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: compte.refresh_token,
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
      console.error('[Drive] Rafraîchissement refusé :', res.status, data?.error);
      return null;
    }
    await saveDriveAccount(
      userId,
      {
        accessToken: String(data.access_token),
        // Un rafraichissement ne renvoie pas de nouveau `refresh_token` :
        // `saveDriveAccount` conserve l'ancien.
        refreshToken: null,
        expiresAt: typeof data.expires_in === 'number'
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : null,
        scopes: typeof data.scope === 'string' ? data.scope : null,
      },
      null,
    );
    return String(data.access_token);
  } catch (err) {
    console.error('[Drive] Rafraîchissement impossible :', err);
    return null;
  }
}
