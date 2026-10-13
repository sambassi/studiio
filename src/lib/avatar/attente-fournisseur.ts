/**
 * GÉNÉRATION EN ATTENTE DU FOURNISSEUR — quand le solde de STUDIIO chez le
 * prestataire avatar est épuisé, ce n'est pas l'échec de l'utilisateur.
 *
 * ⚠️ AUCUN NOUVEAU STATUT, AUCUNE MIGRATION. Un statut `waiting_provider`
 * sortirait la ligne de l'index unique partiel des générations EN VOL
 * (`status in ('pending','processing')`) et rouvrirait la porte au double job.
 * La génération reste donc `pending`, SANS identifiant fournisseur (elle reste
 * dans l'index : une demande identique reçoit `dejaEnCours`), et porte un
 * marqueur dans `provider_error` (colonne réservée à l'admin) :
 *
 *     waiting_provider:<reprises>:<cadrage>|<cause brute du fournisseur>
 *
 *   - `reprises` : 0 = en attente, jamais reprise ; 1 = la reprise UNIQUE a
 *     été prise (pose atomique 0 → 1 : le navigateur et le cron ne relancent
 *     pas tous les deux) ;
 *   - `cadrage` : `remplir` ou `-` — le réglage de la demande d'origine, que
 *     la reprise doit rejouer à l'identique.
 *
 * Les crédits Studiio de l'utilisateur ne sont jamais perdus : la reprise
 * réutilise la MÊME référence de débit (`jumeau:<generationId>`, idempotente),
 * et l'échec définitif rembourse au plus une fois (`rembourserGenerationUneFois`).
 */
import { supabaseAdmin } from '@/lib/db/supabase';

export const PREFIXE_ATTENTE = 'waiting_provider:';
/** Au-delà, l'attente est close : échec, crédits recrédités, admin déjà alerté. */
export const ATTENTE_MAX_MS = 6 * 60 * 60 * 1000;

/** Message UTILISATEUR — jamais le nom du fournisseur ni l'erreur brute. */
export const MESSAGE_ATTENTE_FOURNISSEUR =
  'Ta génération est momentanément en attente. Elle reprendra automatiquement. Aucun crédit Studiio ne sera perdu.';

export interface MarqueurAttente {
  reprises: 0 | 1;
  cadrage: 'remplir' | undefined;
  /** Refus BRUT du fournisseur — l'admin voit la vraie cause, jamais l'utilisateur. */
  cause?: string;
}

export function marqueurAttente(m: MarqueurAttente): string {
  const cause = m.cause ? `|${m.cause.replace(/\s+/g, ' ').slice(0, 300)}` : '';
  return `${PREFIXE_ATTENTE}${m.reprises}:${m.cadrage ?? '-'}${cause}`;
}

export function lireMarqueurAttente(v: string | null | undefined): MarqueurAttente | null {
  if (typeof v !== 'string') return null;
  const r = /^waiting_provider:([01]):(remplir|-)(?:\|([\s\S]*))?$/.exec(v);
  if (!r) return null;
  return { reprises: r[1] === '1' ? 1 : 0, cadrage: r[2] === 'remplir' ? 'remplir' : undefined, ...(r[3] ? { cause: r[3] } : {}) };
}

/** La ligne est-elle une génération en attente du fournisseur ? */
export function estEnAttenteFournisseur(g: { status?: string | null; provider_video_id?: string | null; provider_error?: string | null }): boolean {
  return g.status === 'pending' && !g.provider_video_id && lireMarqueurAttente(g.provider_error) !== null;
}

/**
 * Met (ou remet) la génération en attente : `pending`, sans identifiant
 * fournisseur, marqueur posé. Rien n'est remboursé ici — le débit éventuel
 * reste attaché à la génération et servira à la reprise.
 */
export async function mettreEnAttente(generationId: string, m: MarqueurAttente): Promise<void> {
  const { error } = await supabaseAdmin
    .from('avatar_generations')
    .update({ status: 'pending', provider_video_id: null, provider_error: marqueurAttente(m), error_message: null, updated_at: new Date().toISOString() })
    .eq('id', generationId);
  if (error) throw new Error(`mise en attente ${generationId} : ${error.message}`);
}

/**
 * Prend la reprise UNIQUE (0 → 1), atomiquement. `false` si un autre appelant
 * l'a déjà prise ou si la ligne n'est plus en attente : on ne relance pas.
 */
export async function prendreReprise(generationId: string, m: MarqueurAttente): Promise<boolean> {
  if (m.reprises !== 0) return false;
  const { data, error } = await supabaseAdmin
    .from('avatar_generations')
    .update({ provider_error: marqueurAttente({ ...m, reprises: 1 }), updated_at: new Date().toISOString() })
    .eq('id', generationId)
    .eq('status', 'pending')
    .is('provider_video_id', null)
    .eq('provider_error', marqueurAttente(m))
    .select('id');
  if (error) return false;
  return Array.isArray(data) && data.length === 1;
}
