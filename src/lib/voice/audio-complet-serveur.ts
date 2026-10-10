/**
 * « Générer l'audio complet » — ce que la route partage côté serveur :
 * l'empreinte idempotente, le chemin de stockage, la preuve d'existence et
 * le verrou « en vol ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * JAMAIS DEUX DÉBITS POUR LE MÊME AUDIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'empreinte = sha256(compte | voix fournisseur | texte RÉELLEMENT dit).
 * Elle donne à la fois :
 *   - le chemin de l’objet (`audio/audio-complet/<userId>/<24 hex>.mp3`, hors du dossier utilisateur) :
 *     un audio déjà généré est rendu tel quel, sans synthèse ni débit ;
 *   - la référence du débit (`audio-complet:<empreinte>`) : même si l'objet
 *     avait disparu, le socle atomique refuse un second débit de la même
 *     référence ;
 *   - la clé du verrou en mémoire : un double clic partage la MÊME
 *     promesse — une synthèse, un débit au plus.
 */
import { createHash } from 'crypto';
import { clientMinio } from '@/lib/storage/minio-client';

export const BUCKET_AUDIO_COMPLET = 'audio';
export const OPERATION_AUDIO_COMPLET = 'audio-complet';

export function empreinteAudioComplet(userId: string, providerVoiceId: string, spoken: string): string {
  return createHash('sha256').update(`${userId}|${providerVoiceId}|${spoken}`).digest('hex');
}

/**
 * ⚠️ HORS DU DOSSIER DE L'UTILISATEUR. Les envois navigateur (signed-url,
 * multipart, proxy) n'acceptent QUE des chemins `<userId>/…` : sous
 * `audio-complet/<userId>/…`, seul ce serveur peut écrire. Le nettoyage tient
 * ces fichiers pour durables (payés) — un client ne doit pas pouvoir en
 * fabriquer un en imitant le nom.
 */
export const PREFIXE_AUDIO_COMPLET = 'audio-complet';

export function cheminAudioComplet(userId: string, empreinte: string): string {
  return `${PREFIXE_AUDIO_COMPLET}/${userId}/${empreinte.slice(0, 24)}.mp3`;
}

/**
 * L'objet est-il déjà là ? Le serveur regarde lui-même, sur la clé qu'il a
 * lui-même construite. Stockage injoignable ou objet absent → `false` : on
 * régénère, et la référence idempotente empêche tout second débit.
 */
export async function objetAudioCompletExiste(bucket: string, cle: string): Promise<boolean> {
  try {
    const stat = await clientMinio({ timeoutMs: 5_000 }).statObject(bucket, cle);
    return !!stat && Number(stat.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Ce que la route répond : partageable entre deux requêtes concurrentes. */
export interface ResultatAudioComplet {
  status: number;
  corps: Record<string, unknown>;
}

const enVol = new Map<string, Promise<ResultatAudioComplet>>();

/**
 * Une seule génération à la fois par (compte, empreinte) : la seconde
 * requête attend la première et reçoit le même résultat.
 */
export function partagerEnVol(cle: string, travail: () => Promise<ResultatAudioComplet>): Promise<ResultatAudioComplet> {
  const existante = enVol.get(cle);
  if (existante) return existante;
  const promesse = travail().finally(() => { enVol.delete(cle); });
  enVol.set(cle, promesse);
  return promesse;
}

/** Tests : vide les verrous. */
export function reinitialiserAudioComplet() {
  enVol.clear();
}

/**
 * Ce texte, avec cette voix, a-t-il DÉJÀ été payé ?
 *
 * ⚠️ LE FICHIER N'EST PAS UNE PREUVE DE PAIEMENT. Il est déposé AVANT le
 * débit (on ne débite qu'un audio réussi) : un débit refusé dont la
 * suppression échoue, ou un processus coupé entre dépôt et débit, laisserait
 * un fichier impayé. Seule la ligne du journal `credit_transactions` portant
 * la référence idempotente fait foi. Lecture impossible → « non payé » : on
 * tente alors le débit, qui reste idempotent (jamais deux fois).
 */
export async function debitAudioCompletEnregistre(userId: string, reference: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import('@/lib/db/supabase');
    const { data, error } = await supabaseAdmin
      .from('credit_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('reference_id', reference)
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
