import { supabaseAdmin } from '@/lib/db/supabase';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

/**
 * A_8f (correctif Gap-2) — COMMENCER UNE NOUVELLE VERSION DU CLONE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * L'INVARIANT QUE CE MODULE TIENT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * La validation appartient a UNE version. « J'accepte que ceci parle a ma
 * place » a ete dit devant un modele precis ; reentrainer produit une autre
 * personne numerique, que personne n'a encore regardee. Il est donc
 * IMPOSSIBLE d'obtenir `version = N + 1` avec le `validated_at` de `N`.
 *
 * Avant ce lot, `user_avatars.version` n'etait incremente par aucun code :
 * remplacer sa video inserait une nouvelle ligne (version 1, non validee par
 * construction), et le reentrainement n'existait pas encore. Le jour ou il
 * existera, il passera PAR ICI — et nulle part ailleurs. Un test le tient.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ UNE SEULE MUTATION, PAS DEUX
 * ═════════════════════════════════════════════════════════════════════════
 *
 * L'incrément et la remise a zero partent dans le MEME `update`. Deux
 * ecritures separees laisseraient, entre les deux, une version N+1 encore
 * validee — exactement la fenetre que l'invariant interdit.
 *
 * Et l'ecriture est CONDITIONNELLE : `where version = versionAttendue`. Deux
 * demandes simultanees ne produisent pas N+2 en silence ; la seconde repond
 * `version_concurrente`, et son appelant relit avant de decider.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE LA NOUVELLE VERSION EMPORTE, ET CE QU'ELLE LAISSE
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   validated_at        → NULL, SYSTEMATIQUEMENT — pas seulement si l'ancienne
 *                         validation existait.
 *   provider_avatar_id  → NULL. L'identifiant de la version N designe un
 *                         modele entraine sur l'ancienne source ; le laisser
 *                         ferait interroger — et faire parler — l'ancien clone
 *                         au nom du nouveau.
 *   status              → `source_ready` : l'etat local d'A_8c, celui d'une
 *                         source prete qu'aucun fournisseur ne connait.
 *   training_error      → NULL : il decrivait l'ancien entrainement.
 *
 * Ce qu'elle NE touche PAS : `avatar_generations`. Les videos deja produites
 * gardent leur `avatar_version` et leur rattachement ; l'historique n'est
 * jamais reecrit.
 */

export interface AvatarVersionnable {
  version?: unknown;
  validated_at?: unknown;
  provider_avatar_id?: unknown;
}

/** Le correctif exact d'une nouvelle version, calcule sans base ni horloge. */
export function patchNouvelleVersion(avatar: AvatarVersionnable): {
  version: number;
  validated_at: null;
  provider_avatar_id: null;
  provider_asset_id: null;
  training_error: null;
  status: typeof ETAT_SOURCE_PRETE;
} | null {
  const v = avatar.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return null;
  return {
    version: v + 1,
    validated_at: null,
    provider_avatar_id: null,
    provider_asset_id: null,
    training_error: null,
    status: ETAT_SOURCE_PRETE,
  };
}

export type IssueNouvelleVersion =
  | { ok: true; avatar: Record<string, unknown> }
  | { ok: false; motif: 'introuvable' | 'version_concurrente' | 'version_invalide' };

/**
 * Ouvre la version suivante du clone d'un compte.
 *
 * `versionAttendue` est la version que l'appelant a LUE : si la ligne a bouge
 * entre-temps, rien n'est ecrit. `complement` porte ce que le geste apporte
 * en plus — une nouvelle `source_object_key`, par exemple — sans jamais
 * pouvoir rouvrir ce que la version referme.
 */
export async function commencerNouvelleVersionAvatar(entree: {
  userId: string;
  avatarId: string;
  versionAttendue: number;
  complement?: Record<string, unknown>;
}): Promise<IssueNouvelleVersion> {
  const { userId, avatarId, versionAttendue, complement } = entree;
  const patch = patchNouvelleVersion({ version: versionAttendue });
  if (!patch || !userId || !avatarId) return { ok: false, motif: 'version_invalide' };

  /* ⚠️ LE COMPLEMENT NE PEUT PAS CONTREDIRE LA VERSION. Il est etale AVANT
     le correctif : `validated_at`, `provider_avatar_id`, `version` et `status`
     sont toujours ceux de la nouvelle version, quoi que l'appelant passe. */
  const ecriture = { ...(complement ?? {}), ...patch };

  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .update(ecriture)
    .eq('id', avatarId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('version', versionAttendue)
    .select()
    .single();

  if (!error && data) return { ok: true, avatar: data as Record<string, unknown> };

  /* Aucune ligne touchee : soit elle n'est pas a ce compte (ou supprimee),
     soit sa version n'est plus celle attendue. On relit pour le dire. */
  const { data: actuelle } = await supabaseAdmin
    .from('user_avatars')
    .select('id, version')
    .eq('id', avatarId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!actuelle) return { ok: false, motif: 'introuvable' };
  return { ok: false, motif: 'version_concurrente' };
}
