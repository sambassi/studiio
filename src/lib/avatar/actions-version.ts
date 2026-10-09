/**
 * ACTIONS SUR UNE VERSION D'AVATAR — ce que l'écran « Mes avatars » demande.
 *
 *   synchroniser → relit l'entraînement chez le fournisseur, écrit sur la
 *                  CANDIDATE seulement ;
 *   apercu       → l'aperçu réel de la candidate + le jeton d'ouverture ;
 *   utiliser     → « Utiliser cette version » : valide la candidate (aperçu
 *                  ouvert, jeton) puis BASCULE, atomiquement ;
 *   garder       → « Garder ma version actuelle » : la candidate est mise de
 *                  côté (historique), l'active ne bouge pas ;
 *   revenir      → retour à une version précédente déjà validée (rollback).
 *
 * Aucune de ces actions ne renvoie un identifiant fournisseur.
 */
import { getAvatarTrainingStatus } from '@/lib/avatar/heygen';
import { apercuDuClone, jetonOuvertureApercu, jetonOuvertureValide } from '@/lib/avatar/apercu';
import {
  versionDuCompte, ecrireVersion, abandonnerVersion, activerVersion, etatVersion, versionActivable,
  type VersionAvatar,
} from '@/lib/avatar/versions';
import { supabaseAdmin } from '@/lib/db/supabase';

export type ActionVersion = 'synchroniser' | 'apercu' | 'utiliser' | 'garder' | 'revenir';
export const ACTIONS_VERSION: readonly ActionVersion[] = ['synchroniser', 'apercu', 'utiliser', 'garder', 'revenir'];

export type ResultatAction =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; statut: number; code: string; message: string };

const refus = (statut: number, code: string, message: string): ResultatAction => ({ ok: false, statut, code, message });

interface Contexte { identite: { id: string; active_version_id: string | null }; version: VersionAvatar }

async function contexte(userId: string, versionId: string): Promise<Contexte | null> {
  const version = await versionDuCompte(userId, versionId);
  if (!version) return null;
  const { data } = await supabaseAdmin
    .from('user_avatars')
    .select('id, user_id, active_version_id, deleted_at')
    .eq('id', version.user_avatar_id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data) return null;
  return { identite: data as { id: string; active_version_id: string | null }, version };
}

/** La forme PUBLIQUE d'une version (jamais d'identifiant fournisseur ni de clé de stockage). */
export function versionPublique(v: VersionAvatar) {
  return {
    id: v.id,
    version: v.version,
    etat: etatVersion(v),
    message: etatVersion(v) === 'echec' ? (v.training_error ?? 'La nouvelle version n’a pas pu être créée.') : null,
    type: v.avatar_type === 'video' ? 'video' : 'photo',
    creeLe: v.created_at,
    valideeLe: v.validated_at,
  };
}

export async function executerActionVersion(
  userId: string,
  action: ActionVersion,
  versionId: string,
  jeton: unknown,
): Promise<ResultatAction> {
  const ctx = await contexte(userId, versionId);
  if (!ctx) return refus(404, 'version_introuvable', 'Version introuvable.');
  const { identite, version } = ctx;
  const estActive = identite.active_version_id === version.id;

  if (action === 'garder') {
    if (estActive) return refus(409, 'version_active', 'Cette version est celle utilisée actuellement.');
    const ok = await abandonnerVersion(userId, identite.id, version.id);
    return ok ? { ok: true, data: { garde: true } } : refus(409, 'deja_traitee', 'Cette version a déjà été traitée.');
  }

  if (action === 'revenir') {
    if (estActive) return { ok: true, data: { activeVersionId: version.id, inchange: true } };
    // Seule une version DÉJÀ validée par l'utilisateur peut revenir sans nouvel aperçu.
    if (!versionActivable(version)) return refus(409, 'version_non_prete', 'Cette version ne peut pas être réutilisée.');
    const r = await activerVersion({ userId, avatarId: identite.id, versionId: version.id, activeAttendue: identite.active_version_id });
    return r.ok ? { ok: true, data: { activeVersionId: version.id } } : refus(409, r.motif, 'La version n’a pas pu être réactivée. Rechargez la page.');
  }

  if (estActive) return refus(409, 'version_active', 'Cette version est celle utilisée actuellement.');
  if (version.abandoned_at) return refus(409, 'version_abandonnee', 'Cette version a été mise de côté.');

  if (action === 'synchroniser') {
    if (!version.provider_avatar_id || etatVersion(version) !== 'entrainement') {
      return { ok: true, data: { version: versionPublique(version) } };
    }
    const t = await getAvatarTrainingStatus(version.provider_avatar_id);
    if (t?.status && t.status !== version.status) {
      const echec = t.status === 'failed';
      const message = echec ? 'La nouvelle version n’a pas pu être créée. Votre avatar actuel reste utilisable.' : null;
      await ecrireVersion(userId, version.id, { status: t.status, ...(echec ? { training_error: message } : {}) });
      return { ok: true, data: { version: versionPublique({ ...version, status: t.status, training_error: message ?? version.training_error }) } };
    }
    return { ok: true, data: { version: versionPublique(version) } };
  }

  // apercu / utiliser : l'aperçu réel de CETTE version.
  if (etatVersion(version) !== 'prete') return refus(409, 'version_non_prete', 'La nouvelle version n’est pas encore prête.');
  let apercu;
  try {
    apercu = await apercuDuClone(userId, identite.id, version.version);
  } catch {
    return refus(500, 'apercu_illisible', 'L’aperçu n’a pas pu être lu.');
  }
  if (apercu.statut !== 'pret') {
    return refus(409, `apercu_${apercu.statut}`, 'L’aperçu de la nouvelle version n’est pas encore disponible.');
  }
  const preuve = { userId, avatarId: identite.id, version: version.version, generationId: apercu.generationId };

  if (action === 'apercu') {
    return { ok: true, data: { url: apercu.url, jeton: jetonOuvertureApercu(preuve), version: versionPublique(version) } };
  }

  // utiliser : la preuve d'ouverture, puis validation de la candidate, puis bascule.
  if (!jetonOuvertureValide(jeton, preuve)) {
    return refus(409, 'apercu_non_ouvert', 'Regardez d’abord l’aperçu de la nouvelle version.');
  }
  if (!version.validated_at) {
    const ok = await ecrireVersion(userId, version.id, { validated_at: new Date().toISOString() });
    if (!ok) return refus(500, 'validation_impossible', 'La nouvelle version n’a pas pu être validée.');
  }
  const r = await activerVersion({ userId, avatarId: identite.id, versionId: version.id, activeAttendue: identite.active_version_id });
  if (!r.ok) {
    return refus(409, r.motif, r.motif === 'concurrent'
      ? 'Votre avatar a changé entre-temps. Rechargez la page.'
      : 'La nouvelle version n’a pas pu être activée. Votre version actuelle reste utilisée.');
  }
  return { ok: true, data: { activeVersionId: version.id, version: version.version } };
}
