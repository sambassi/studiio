/**
 * APERÇU DU STYLE — ce que la séquence « Vidéo » montre quand « Faire
 * apparaître mon avatar » est choisi.
 *
 * À l'envoi, la vidéo du jumeau REMPLACE le rush dans la séquence « Vidéo »
 * (`runRenderInterne` : `plateau.rushUrl = posee.url`). Avant l'envoi, cette
 * vidéo n'existe pas encore — et la produire pour un simple aperçu serait une
 * génération payante chez le fournisseur. L'aperçu montre donc l'avatar avec
 * ce qui EXISTE DÉJÀ : la source de sa version active (photo ou vidéo qui a
 * créé l'avatar), lue par `GET /api/avatars/versions/:id/source` — base et
 * stockage seulement, AUCUN fournisseur (HeyGen, D-ID, ElevenLabs), aucun
 * crédit.
 *
 * Lecture : `GET /api/avatars` (la liste publique « Mes avatars », celle du
 * sélecteur d'avatar). Rien n'est écrit, rien n'est lancé.
 */

export type ApercuAvatarCreer =
  /** Lecture en cours : la place est réservée, rien n'est inventé. */
  | { etat: 'chargement' }
  /** Aucun avatar utilisable (ou la liste est illisible) : il faut le configurer. */
  | { etat: 'absent' }
  /**
   * Avatar utilisable. `url` : la source de sa version active, `null` si la
   * version n'en conserve pas (l'aperçu montre alors le nom seul).
   */
  | { etat: 'pret'; nom: string; version: number | null; type: 'photo' | 'video'; url: string | null };

interface AvatarListe {
  id: string;
  nom?: string;
  parDefaut?: boolean;
  type?: string;
  utilisable?: boolean;
  versionActive?: { id?: string; version?: number; type?: string; source?: boolean } | null;
}

/** Les avatars du compte, tels que `GET /api/avatars` les rend. `null` si illisible. */
export async function lireAvatarsPourApercu(fetchImpl: typeof fetch = fetch): Promise<AvatarListe[] | null> {
  try {
    const r = await fetchImpl('/api/avatars', { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j?.success || !Array.isArray(j?.data?.avatars)) return null;
    return j.data.avatars as AvatarListe[];
  } catch {
    return null;
  }
}

/**
 * L'avatar que le rendu utilisera : celui choisi pour le projet s'il est
 * utilisable, sinon l'avatar par défaut du compte, sinon le premier
 * utilisable — la même retombée que le sélecteur (« un avatar choisi qui
 * n'est plus utilisable retombe sur le défaut »).
 */
export function apercuAvatarDepuisListe(avatars: AvatarListe[] | null, avatarId: string | null | undefined): ApercuAvatarCreer {
  if (!avatars) return { etat: 'absent' };
  const utilisables = avatars.filter((a) => a && a.utilisable && a.versionActive);
  const choisi = (avatarId ? utilisables.find((a) => a.id === avatarId) : undefined)
    ?? utilisables.find((a) => a.parDefaut)
    ?? utilisables[0];
  if (!choisi || !choisi.versionActive) return { etat: 'absent' };
  const v = choisi.versionActive;
  const type: 'photo' | 'video' = (v.type ?? choisi.type) === 'video' ? 'video' : 'photo';
  const url = v.source && typeof v.id === 'string' && v.id.length > 0
    ? `/api/avatars/versions/${encodeURIComponent(v.id)}/source`
    : null;
  return {
    etat: 'pret',
    nom: choisi.nom || 'Mon avatar',
    version: typeof v.version === 'number' ? v.version : null,
    type,
    url,
  };
}
