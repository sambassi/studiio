/**
 * Devis d'une CRÉATION / nouvelle version d'avatar pour un compte : le devis
 * (prix HeyGen non publié → jamais de montant) et l'avatar déjà utilisable du
 * même type, s'il existe — pour proposer « Utiliser l'existant » plutôt que
 * de réentraîner. Lecture seule.
 */
import { listerIdentites } from '@/lib/avatar/versions';
import { etatAvatar } from '@/lib/avatar/contrat';
import { devisCreationAvatar, type DevisFournisseur } from '@/lib/fournisseurs/devis-fournisseur';

export interface ContexteCreation {
  typeAvatar: 'video' | 'photo';
  nouvelEntrainement: true;
  avatarExistant: { id: string; nom: string | null; version: number } | null;
}

export async function devisCreationPourCompte(userId: string, type: 'video' | 'photo'): Promise<{ devis: DevisFournisseur; contexte: ContexteCreation }> {
  const l = await listerIdentites(userId).catch(() => null);
  const utilisable = l && l.ok
    ? l.identites.find((i) => (i.avatar_type === 'video' ? 'video' : 'photo') === type && etatAvatar({ ...i, deleted_at: null }) === 'valide') ?? null
    : null;
  return {
    devis: devisCreationAvatar({ avatarType: type, creditsStudiio: 0 }),
    contexte: {
      typeAvatar: type,
      nouvelEntrainement: true,
      avatarExistant: utilisable ? { id: utilisable.id, nom: utilisable.name, version: utilisable.version } : null,
    },
  };
}
