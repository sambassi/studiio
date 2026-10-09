/**
 * LANCER UNE VERSION CANDIDATE — remplacement d'un avatar, ou première
 * version d'un nouvel avatar. N'écrit JAMAIS dans la version active.
 *
 * Ordre (chaque étape n'avance que si la précédente a réussi) :
 *   1. ligne `avatar_versions` candidate (`creerVersionCandidate`) ;
 *   2. octets de la source PRÉPARÉE (déjà en stockage privé, clé du compte) ;
 *   3. fournisseur : dépôt de l'asset, puis création — dans le GROUPE
 *      existant pour un remplacement de jumeau vidéo (nouveau look, l'ancien
 *      reste utilisable) ;
 *   4. résultat écrit sur la CANDIDATE seulement.
 *
 * Un refus du fournisseur est écrit sur la candidate (« À corriger ») avec un
 * message Studiio. L'avatar actif n'est jamais touché : Créer et l'Autopilote
 * continuent de l'utiliser.
 */
import { Readable } from 'stream';
import { uploadAsset, createAvatarFromAsset, HeyGenError, type AvatarKind } from '@/lib/avatar/heygen';
import { ouvrirSourceAvatar, cleSourceAvatarDuCompte } from '@/lib/avatar/source';
import { creerVersionCandidate, ecrireVersion, type VersionAvatar } from '@/lib/avatar/versions';

/** Messages d'échec d'une version, sans jamais nommer le fournisseur. */
export function messageEchecVersion(code: string | undefined): string {
  if (code === 'resource_limit_reached') {
    return 'Votre emplacement d’avatar est déjà utilisé : la nouvelle version n’a pas pu être créée. Votre avatar actuel reste utilisable.';
  }
  if (code === 'invalid_parameter' || code === 'invalid_file' || code === 'bad_request') {
    return 'La vidéo n’a pas été acceptée. Vérifiez le cadrage (un seul visage, de face, visible du début à la fin) et le son.';
  }
  return 'La nouvelle version n’a pas pu être créée. Votre avatar actuel reste utilisable.';
}

async function lireOctets(userId: string, cle: string): Promise<{ octets: Buffer; type: string }> {
  const s = await ouvrirSourceAvatar(userId, cle);
  if (!s || s.taille <= 0) throw new Error('source absente');
  const morceaux: Buffer[] = [];
  for await (const m of Readable.from(s.flux)) morceaux.push(Buffer.from(m as Uint8Array));
  return { octets: Buffer.concat(morceaux), type: s.type };
}

export type ResultatCandidate =
  | { ok: true; version: VersionAvatar; etat: 'entrainement' | 'echec'; message?: string; groupeId?: string | null }
  | { ok: false; motif: 'source_invalide' | 'candidate_en_cours' | 'introuvable' | 'base' | 'groupe_absent'; message: string };

export async function lancerVersionCandidate(args: {
  userId: string;
  avatarId: string;
  kind: AvatarKind;
  nom: string;
  cleSource: string;
  cleOriginal: string | null;
  /**
   * `remplacer` : nouvelle version d'une identité EXISTANTE — pour un jumeau
   * vidéo, OBLIGATOIREMENT dans son groupe (`groupeExistant`), jamais un
   * nouveau groupe. `nouveau` : nouvelle identité, nouveau groupe (l'appelant
   * a vérifié qu'un emplacement est libre).
   */
  mode: 'remplacer' | 'nouveau';
  /** Groupe fournisseur de l'identité (remplacement d'un jumeau vidéo). */
  groupeExistant: string | null;
  consentement: { consent_text: string; consent_version: string; consent_at: string; subject_type: string };
}): Promise<ResultatCandidate> {
  // La source ET l'original doivent être des sources DE CE COMPTE.
  if (!cleSourceAvatarDuCompte(args.cleSource, args.userId)) {
    return { ok: false, motif: 'source_invalide', message: 'Source invalide.' };
  }
  if (args.cleOriginal !== null && !cleSourceAvatarDuCompte(args.cleOriginal, args.userId)) {
    return { ok: false, motif: 'source_invalide', message: 'Source originale invalide.' };
  }
  // Défense en profondeur : un remplacement vidéo sans groupe créerait un
  // nouveau groupe (= un emplacement de plus) — refusé avant toute écriture.
  if (args.mode === 'remplacer' && args.kind === 'video' && !args.groupeExistant) {
    return { ok: false, motif: 'groupe_absent', message: 'Cet avatar vidéo ne peut pas recevoir de nouvelle version.' };
  }
  if (args.mode === 'nouveau' && args.groupeExistant) {
    return { ok: false, motif: 'groupe_absent', message: 'Un nouvel avatar ne rejoint pas le groupe d’un autre.' };
  }
  const c = await creerVersionCandidate({
    userId: args.userId, avatarId: args.avatarId, provider: 'heygen', avatarType: args.kind,
    sourceKey: args.cleSource, originalKey: args.cleOriginal, consentement: args.consentement,
  });
  if (!c.ok) {
    const message = c.motif === 'candidate_en_cours'
      ? 'Une nouvelle version est déjà en préparation pour cet avatar.'
      : c.motif === 'introuvable' ? 'Avatar introuvable.' : 'La nouvelle version n’a pas pu être enregistrée.';
    return { ok: false, motif: c.motif, message };
  }

  try {
    const { octets, type } = await lireOctets(args.userId, args.cleSource);
    const nomFichier = args.kind === 'video' ? 'source.mp4' : 'source.jpg';
    const asset = await uploadAsset(new Blob([new Uint8Array(octets)], { type }), nomFichier);
    const cree = await createAvatarFromAsset(asset.assetId, args.nom, args.kind, args.groupeExistant);
    await ecrireVersion(args.userId, c.version.id, {
      provider_avatar_id: cree.avatarId,
      provider_asset_id: asset.assetId,
      status: cree.status,
      training_error: null,
    });
    return { ok: true, version: { ...c.version, provider_avatar_id: cree.avatarId, status: cree.status }, etat: 'entrainement', groupeId: cree.avatarGroupId ?? null };
  } catch (e) {
    const code = e instanceof HeyGenError ? e.code : undefined;
    // Brut aux journaux seulement ; l'écran lit un message Studiio.
    console.error('[Avatar][candidate] refus :', e instanceof Error ? e.message : e);
    const message = messageEchecVersion(code);
    await ecrireVersion(args.userId, c.version.id, { status: 'failed', training_error: message });
    return { ok: true, version: { ...c.version, status: 'failed', training_error: message }, etat: 'echec', message };
  }
}
