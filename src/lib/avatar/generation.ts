import { supabaseAdmin } from '@/lib/db/supabase';
import { INTENTION_APERCU, type IntentionGeneration } from '@/lib/avatar/contrat';

/**
 * A_8f (correctif Gap-1) — LA RESERVATION D'UNE GENERATION, AVANT LE FOURNISSEUR.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI LA LIGNE EST ECRITE AVANT L'APPEL, ET PLUS APRES
 * ═════════════════════════════════════════════════════════════════════════
 *
 * La route inserait la generation APRES le retour du fournisseur, avec son
 * identifiant de video. Pour un apercu, cet ordre est exactement le mauvais :
 * deux requetes qui lisent « aucun apercu » au meme instant partent toutes
 * les deux chez le fournisseur, et l'index unique n'a plus rien a arbitrer
 * quand il voit enfin les lignes.
 *
 * La reservation est donc la PREMIERE ecriture : une ligne `pending`, sans
 * identifiant de video, qui porte deja l'intention et la version. Pour un
 * apercu, l'index partiel `avatar_generations_apercu_unique` ne laisse passer
 * qu'une ligne non echouee par (avatar, version) — le perdant recoit un
 * conflit et ne paie ni credit ni appel.
 *
 * ⚠️ UN VERROU EN MEMOIRE NE REMPLACERAIT PAS CECI. Il ne tiendrait qu'un
 * processus ; le produit tourne derriere un orchestrateur qui peut en avoir
 * plusieurs. C'est la base qui arbitre, ou personne.
 *
 * ⚠️ UNE RESERVATION QUI N'ABOUTIT PAS EST MARQUEE `failed`, JAMAIS EFFACEE.
 * L'echec libere la place dans l'index (il est exclu du predicat) et reste
 * lisible dans l'historique : on saura qu'une tentative a eu lieu.
 */

export interface ReservationGeneration {
  userId: string;
  avatarId: string;
  version: number;
  intention: IntentionGeneration;
  script: string;
  voiceId: string | null;
  aspectRatio: string;
}

export type IssueReservation =
  | { ok: true; id: string }
  /** L'index unique a tranche : un autre apercu non echoue existe pour cette version. */
  | { ok: false; motif: 'apercu_deja_reserve' }
  | { ok: false; motif: 'ecriture_impossible' };

/** PostgreSQL 23505 — violation d'unicite, telle que PostgREST la relaie. */
function conflitUnicite(erreur: { code?: unknown; message?: unknown } | null): boolean {
  if (!erreur) return false;
  if (erreur.code === '23505') return true;
  return typeof erreur.message === 'string'
    && /duplicate key|unique constraint|avatar_generations_apercu_unique/i.test(erreur.message);
}

/**
 * Existe-t-il deja un apercu en cours ou termine pour cette version ?
 *
 * ⚠️ CETTE LECTURE NE PROTEGE RIEN — l'index unique s'en charge. Elle sert a
 * refuser avec un motif lisible AVANT d'ecrire, dans le cas ordinaire ou la
 * reponse est deja connue. Deux requetes simultanees la passent toutes les
 * deux ; c'est l'insertion qui departage.
 */
export async function apercuOccupe(
  userId: string, avatarId: string, version: number,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('avatar_generations')
    .select('id')
    .eq('user_id', userId)
    .eq('user_avatar_id', avatarId)
    .eq('intention', INTENTION_APERCU)
    .eq('avatar_version', version)
    .neq('status', 'failed')
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

export async function reserverGeneration(r: ReservationGeneration): Promise<IssueReservation> {
  const { data, error } = await supabaseAdmin
    .from('avatar_generations')
    .insert({
      user_id: r.userId,
      user_avatar_id: r.avatarId,
      /* ⚠️ TOUJOURS ECRITE — y compris pour une generation normale. La colonne
         existait depuis A_8b sans qu'aucune route ne la renseigne : une video
         ne savait pas quelle version du clone l'avait produite. */
      avatar_version: r.version,
      intention: r.intention,
      provider_video_id: null,
      script: r.script,
      voice_id: r.voiceId,
      aspect_ratio: r.aspectRatio,
      status: 'pending',
      credits_charged: 0,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (conflitUnicite(error)) return { ok: false, motif: 'apercu_deja_reserve' };
    console.error('[Avatar] Reservation de generation impossible :', error);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** La generation est partie chez le fournisseur : la ligne apprend son identifiant. */
export async function confirmerGeneration(
  id: string, patch: { providerVideoId: string; status: string; creditsCharged: number },
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('avatar_generations')
    .update({
      provider_video_id: patch.providerVideoId,
      status: patch.status,
      credits_charged: patch.creditsCharged,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return !error;
}

/**
 * La reservation n'a pas abouti — refus de credit, fournisseur en erreur,
 * exception. La ligne devient `failed`, ce qui libere la place d'apercu.
 */
export async function echouerGeneration(id: string, message: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('avatar_generations')
      .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
      .eq('id', id);
  } catch (e) {
    // Une reservation `pending` orpheline n'est pas perdue : la route de
    // statut la fait echouer apres le delai maximum, et libere la place.
    console.error(`[Avatar] Impossible de marquer la generation ${id} en echec :`, e);
  }
}
