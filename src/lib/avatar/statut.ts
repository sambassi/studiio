/**
 * AVANCER UNE GÉNÉRATION D'AVATAR — la logique de poll + rapatriement, SANS
 * HTTP, pour qu'elle serve à DEUX appelants qui n'ont pas de navigateur en
 * commun :
 *
 *   - `GET /api/avatar/status` (Créer) — le navigateur rappelle en boucle ;
 *   - le finaliseur de l'Autopilote — un cron, aucun navigateur : il fait
 *     AVANCER lui-même la génération jusqu'à la vidéo re-hébergée, puis monte.
 *
 * ⚠️ LE COMPORTEMENT EST CELUI, INCHANGÉ, DE LA ROUTE STATUS (Créer marche,
 * on le garde) : on interroge le FOURNISSEUR (D-ID ou HeyGen, selon
 * `avatar_generations.provider`) AVANT le garde « périmé » ; une scène
 * réellement terminée est FINALISÉE (re-hébergée sur MinIO) quel que soit son
 * âge ; le garde 30 min ne frappe qu'une génération encore en cours ; l'échec
 * fournisseur rembourse une seule fois (`credits_refunded`, pose atomique).
 *
 * Une erreur TRANSITOIRE du fournisseur (`DidError` / `HeyGenError`) est
 * RELANCÉE : l'appelant décide — la route répond un 4xx que le navigateur
 * rejoue, le finaliseur laisse la génération en attente pour la passe
 * suivante. On ne marque JAMAIS `failed` sur un simple couac réseau.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { addCredits } from '@/lib/credits/system';
import { getVideoStatus, downloadVideo } from '@/lib/avatar/heygen';
import { lireScene, telechargerResultat } from '@/lib/providers/did/client';
import { FOURNISSEUR_DID } from '@/lib/avatar/did';
import { cleAudioAvatar, retirerObjetPriveAvatar } from '@/lib/avatar/source';
import { MESSAGES_AVATAR, messageUtilisateurSur } from '@/lib/avatar/fournisseurs';
import { calculerCoutGeneration, compteAdmin, enregistrerCoutGeneration } from '@/lib/avatar/couts';

/** Au-delà, une génération encore EN COURS est considérée perdue et remboursée. */
export const STALE_AFTER_MS = 30 * 60 * 1000; // 30 min

type ResultatPoll =
  | { status: 'processing'; videoUrl: null }
  | { status: 'completed'; videoUrl: string }
  | { status: 'failed'; videoUrl: null; error: string; rembourse: boolean };

/**
 * `avatarVersion` : la version du clone ÉPINGLÉE à la génération
 * (`avatar_generations.avatar_version`), présente seulement quand la base la
 * connaît. Une information, jamais une décision : le poll est inchangé.
 */
export type ResultatStatutGeneration =
  | { status: 'introuvable' }
  | (ResultatPoll & { avatarVersion?: number });

interface LigneGeneration {
  id: string;
  user_id: string;
  status: string;
  provider: string | null;
  provider_video_id: string | null;
  video_url: string | null;
  error_message: string | null;
  credits_charged: number;
  credits_refunded: boolean;
  created_at: string;
  /** Le texte DIT (sert au coût de la voix). */
  script?: string | null;
}

/**
 * Fait avancer UNE génération d'un cran (un poll), et la finalise si le
 * fournisseur a terminé. Propriété vérifiée par `userId`. Peut lever
 * `DidError` / `HeyGenError` (transitoire) : l'appelant réessaiera.
 */
export async function avancerStatutGeneration(
  userId: string,
  generationId: string,
): Promise<ResultatStatutGeneration> {
  const { data: gen } = await supabaseAdmin
    .from('avatar_generations')
    .select('*')
    .eq('id', generationId)
    .eq('user_id', userId) // propriété vérifiée côté requête
    .single();

  if (!gen) return { status: 'introuvable' };
  const r = await avancerLigne(userId, gen as LigneGeneration);
  const version = (gen as { avatar_version?: unknown }).avatar_version;
  return typeof version === 'number' ? { ...r, avatarVersion: version } : r;
}

/** Le poll lui-même, sur une ligne déjà lue et dont la propriété est vérifiée. */
async function avancerLigne(userId: string, g: LigneGeneration): Promise<ResultatPoll> {

  // États terminaux : rien à ré-interroger.
  if (g.status === 'completed') {
    return g.video_url
      ? { status: 'completed', videoUrl: g.video_url }
      : { status: 'failed', videoUrl: null, error: messageUtilisateurSur(g.error_message, 'Vidéo absente.'), rembourse: false };
  }
  if (g.status === 'failed') {
    return { status: 'failed', videoUrl: null, error: messageUtilisateurSur(g.error_message, 'Génération en échec.'), rembourse: false };
  }

  if (!g.provider_video_id) {
    return { status: 'processing', videoUrl: null };
  }

  // ⚠️ ON INTERROGE LE FOURNISSEUR AVANT LE GARDE STALE (voir en-tête).
  const viaDid = g.provider === FOURNISSEUR_DID;
  const remote = viaDid ? await lireScene(g.provider_video_id) : await getVideoStatus(g.provider_video_id);

  if (remote.status === 'failed') {
    // Fournisseur INVISIBLE : l'erreur brute va aux journaux et à l'admin
    // (`provider_error`) ; l'utilisateur lit un message Studiio.
    const brut = remote.failureMessage || `${g.provider ?? 'heygen'} : échec signalé sans détail`;
    console.error(`[Avatar][${g.provider ?? 'heygen'}] génération ${g.id} en échec :`, brut);
    const admin = await compteAdmin(userId);
    const visible = g.credits_charged > 0 && !admin ? MESSAGES_AVATAR.echecRembourse : MESSAGES_AVATAR.echec;
    const rembourse = await failAndRefund(g, visible);
    await enregistrerCoutGeneration(g.id, calculerCoutGeneration({ provider: viaDid ? 'did' : 'heygen', admin, secondes: 0, caracteres: (g.script ?? '').length, creditsDebites: 0 }), brut);
    if (viaDid) await retirerObjetPriveAvatar(userId, cleAudioAvatar(userId, g.id));
    return { status: 'failed', videoUrl: null, error: visible, rembourse };
  }

  if (remote.status !== 'completed' || !remote.videoUrl) {
    // Confirmé ABSENT côté fournisseur : c'est SEULEMENT ici que le garde
    // stale s'applique — une génération qui traîne depuis plus de 30 min est
    // perdue → échec + remboursement.
    const ageMs = Date.now() - new Date(g.created_at).getTime();
    if (ageMs > STALE_AFTER_MS) {
      const rembourse = await failAndRefund(g, 'La generation a depasse le delai maximum (30 minutes).');
      if (viaDid) await retirerObjetPriveAvatar(userId, cleAudioAvatar(userId, g.id));
      return {
        status: 'failed',
        videoUrl: null,
        error: `La generation a depasse le delai maximum (30 minutes).${g.credits_charged > 0 ? ' Credits rembourses.' : ''}`,
        rembourse,
      };
    }
    if (g.status !== 'processing') {
      await supabaseAdmin
        .from('avatar_generations')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', g.id);
    }
    return { status: 'processing', videoUrl: null };
  }

  // Terminé : rapatriement sur NOTRE stockage (l'URL fournisseur expire).
  // Échec du rapatriement = PAS un succès : l'adresse du fournisseur expire,
  // la vidéo disparaîtrait du montage. Le job reste « en cours » et le
  // prochain passage réessaie ; au-delà du délai, il échoue et est remboursé.
  let finalUrl: string | null = null;
  try {
    const buffer = viaDid ? await telechargerResultat(remote.videoUrl) : await downloadVideo(remote.videoUrl);
    // Fichier VÉRIFIÉ avant d'être un résultat : un téléchargement vide n'est
    // pas une vidéo (nouvel essai au prochain passage).
    if (!buffer || buffer.length === 0) throw new Error('vidéo téléchargée vide');
    const storagePath = `${userId}/avatar/${g.id}.mp4`;
    const { error: upErr } = await supabaseAdmin.storage
      .from('media')
      .upload(storagePath, buffer, { contentType: 'video/mp4', upsert: true });
    if (upErr) {
      console.warn('[Avatar] Rapatriement vidéo échoué (stockage), nouvel essai au prochain passage:', upErr.message);
    } else {
      const { data: pub } = supabaseAdmin.storage.from('media').getPublicUrl(storagePath);
      finalUrl = pub?.publicUrl ?? null;
    }
  } catch (e) {
    console.warn('[Avatar] Rapatriement vidéo échoué, nouvel essai au prochain passage:', e);
  }
  if (!finalUrl) {
    // Rapatriement impossible au-delà du délai : échec franc et remboursé,
    // jamais un « succès » pointant vers une adresse qui va expirer.
    if (Date.now() - new Date(g.created_at).getTime() > STALE_AFTER_MS) {
      const rembourse = await failAndRefund(g, 'La vidéo a été générée mais n’a pas pu être enregistrée.');
      if (viaDid) await retirerObjetPriveAvatar(userId, cleAudioAvatar(userId, g.id));
      return {
        status: 'failed',
        videoUrl: null,
        error: `La vidéo a été générée mais n’a pas pu être enregistrée.${g.credits_charged > 0 ? ' Credits rembourses.' : ''}`,
        rembourse,
      };
    }
    return { status: 'processing', videoUrl: null };
  }

  await supabaseAdmin
    .from('avatar_generations')
    .update({
      status: 'completed',
      video_url: finalUrl,
      duration_seconds: ('durationSeconds' in remote ? remote.durationSeconds : null) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', g.id);
  // Coût réel de CETTE génération (admin : 0 crédit Studiio, coût externe mesuré).
  const secondes = ('durationSeconds' in remote ? remote.durationSeconds : null) ?? null;
  await enregistrerCoutGeneration(g.id, calculerCoutGeneration({
    provider: viaDid ? 'did' : 'heygen', admin: await compteAdmin(userId), secondes, caracteres: (g.script ?? '').length, creditsDebites: g.credits_charged,
  }));
  // D-ID : l'audio de ma voix ne sert plus — on ne garde pas une donnée
  // biométrique sans raison.
  if (viaDid) await retirerObjetPriveAvatar(userId, cleAudioAvatar(userId, g.id));

  return { status: 'completed', videoUrl: finalUrl };
}

/**
 * Marque une génération en échec et rembourse les crédits UNE seule fois.
 * Rend `true` si CE appel a effectué le remboursement (pose atomique du
 * drapeau `credits_refunded` : des polls concurrents n'en laissent passer
 * qu'un). Sans crédits à rembourser, marque juste `failed` et rend `false`.
 */
export async function failAndRefund(
  gen: { id: string; user_id: string; credits_charged: number; credits_refunded: boolean },
  reason: string,
): Promise<boolean> {
  const shouldRefund = !gen.credits_refunded && gen.credits_charged > 0;

  if (shouldRefund) {
    const { data: claimed } = await supabaseAdmin
      .from('avatar_generations')
      .update({
        status: 'failed',
        error_message: reason,
        credits_refunded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gen.id)
      .eq('credits_refunded', false)
      .select();

    if (claimed && claimed.length > 0) {
      try {
        await addCredits(gen.user_id, gen.credits_charged, 'refund');
        console.log(`[Avatar] ${gen.credits_charged} crédits remboursés à ${gen.user_id}`);
        return true;
      } catch (e) {
        console.error('[Avatar] REMBOURSEMENT ÉCHOUÉ pour', gen.user_id, e);
      }
    }
    return false;
  }

  await supabaseAdmin
    .from('avatar_generations')
    .update({ status: 'failed', error_message: reason, updated_at: new Date().toISOString() })
    .eq('id', gen.id);
  return false;
}
