/**
 * L'APERÇU RÉEL d'un clone — s'il en existe un — et la preuve qu'on l'a ouvert.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'EST UN APERÇU, ET CE QU'IL N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un aperçu est une VRAIE génération HeyGen (`avatar_generations`,
 * `intention = 'apercu'`), sur le texte fixe `SCRIPT_APERCU`, rattachée à UNE
 * version du clone (`avatar_version`), terminée (`status = 'completed'`) et
 * re-hébergée par `/api/avatar/status` sous
 * `media/<userId>/avatar/<generationId>.mp4`. Rien d'autre n'est un aperçu :
 * ni une image, ni une vidéo d'une autre version, ni une génération
 * « normale », ni une URL fournisseur expirable, ni quoi que ce soit que la
 * base ne connaisse pas. Tant qu'il n'existe pas, la réponse est `aucun`, et
 * c'est la bonne réponse.
 *
 * Deux lecteurs — l'écran et la route de validation — lisent ICI, au même
 * endroit : jamais un bouton « Valider » au-dessus d'un vide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PREUVE D'OUVERTURE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Valider suppose d'avoir regardé. Le navigateur n'envoie pas un booléen : il
 * obtient un JETON en demandant explicitement l'ouverture de l'aperçu
 * (`POST /api/avatar/apercu/ouverture`), et ce jeton — HMAC de
 * (compte, avatar, version, génération) — est exigé à la validation. Il ne
 * s'obtient que pour un aperçu PRÊT de la version COURANTE ; une nouvelle
 * version le rend caduc. Ce n'est pas une preuve qu'on a regardé jusqu'au
 * bout ; c'est la preuve d'un geste délibéré vers la vidéo, la plus simple
 * qui ne se contourne pas en cochant une case.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/db/supabase';
import { INTENTION_APERCU } from '@/lib/avatar/contrat';
import { basesUrlPubliqueStockage } from '@/lib/avatar/source';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Apercu =
  | { statut: 'aucun' }
  | { statut: 'en_cours'; generationId: string }
  | { statut: 'echec'; generationId: string; erreur: string | null }
  /** Une génération terminée dont l'URL n'est pas notre vidéo re-hébergée : pas un aperçu exploitable. */
  | { statut: 'indisponible'; generationId: string }
  | { statut: 'pret'; generationId: string; url: string };

/**
 * L'URL d'un aperçu RÉEL : la vidéo générée de CE compte pour CETTE
 * génération, re-hébergée par `/api/avatar/status` sous une base publique
 * configurée (`getPublicUrl`). Tout le reste — URL fournisseur, autre compte,
 * autre génération, chemin forgé — n'est pas un aperçu.
 */
export function estUrlApercuReelle(url: unknown, userId: string, generationId: string, env: NodeJS.ProcessEnv = process.env): url is string {
  if (typeof url !== 'string' || !UUID.test(userId) || !UUID.test(generationId)) return false;
  if (/[?#%\s]/.test(url)) return false;
  const cle = `${userId}/avatar/${generationId}.mp4`;
  return basesUrlPubliqueStockage(env).some((base) => url === `${base}/media/${cle}`);
}

export async function apercuDuClone(userId: string, avatarId: string, version: unknown): Promise<Apercu> {
  if (!UUID.test(userId) || !UUID.test(avatarId)) return { statut: 'aucun' };
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { statut: 'aucun' };
  const { data, error } = await supabaseAdmin
    .from('avatar_generations')
    .select('id, status, video_url, error_message')
    .eq('user_id', userId)
    .eq('user_avatar_id', avatarId)
    .eq('intention', INTENTION_APERCU)
    .eq('avatar_version', version)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`avatar_generations: aperçu illisible (${error.message})`);
  const g = data?.[0] as { id: string; status: string; video_url: string | null; error_message: string | null } | undefined;
  if (!g) return { statut: 'aucun' };
  if (g.status === 'failed') return { statut: 'echec', generationId: g.id, erreur: g.error_message };
  if (g.status !== 'completed') return { statut: 'en_cours', generationId: g.id };
  if (!estUrlApercuReelle(g.video_url, userId, g.id)) return { statut: 'indisponible', generationId: g.id };
  return { statut: 'pret', generationId: g.id, url: g.video_url };
}

// ─────────────────────────────────────────────────────────────────────────
// Le jeton d'ouverture
// ─────────────────────────────────────────────────────────────────────────

function cleSecrete(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.AVATAR_APERCU_SECRET || env.AUTH_SECRET || '').trim();
  if (!secret) throw new Error('AUTH_SECRET manquant : impossible de signer un jeton d’ouverture');
  return secret;
}

export function jetonOuvertureApercu(
  args: { userId: string; avatarId: string; version: number; generationId: string }, env: NodeJS.ProcessEnv = process.env,
): string {
  const message = `apercu:${args.userId}:${args.avatarId}:${args.version}:${args.generationId}`;
  return createHmac('sha256', cleSecrete(env)).update(message).digest('base64url');
}

export function jetonOuvertureValide(
  jeton: unknown, args: { userId: string; avatarId: string; version: number; generationId: string }, env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof jeton !== 'string' || jeton.length === 0 || jeton.length > 128) return false;
  let attendu: string;
  try { attendu = jetonOuvertureApercu(args, env); } catch { return false; }
  const a = Buffer.from(jeton);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}
