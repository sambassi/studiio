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
 *   - le chemin de l'objet (`audio/<userId>/voice/audio-complet-<24 hex>.mp3`) :
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

export function cheminAudioComplet(userId: string, empreinte: string): string {
  return `${userId}/voice/audio-complet-${empreinte.slice(0, 24)}.mp3`;
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
