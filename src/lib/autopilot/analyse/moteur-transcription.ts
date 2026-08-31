/**
 * M3-D2 — LE CHARGEUR DU FOURNISSEUR DE TRANSCRIPTION.
 *
 * Calqué sur `moteur-candidat.ts`, dont il reprend la raison d'être : c'est
 * ce module — et non `transcription.ts` — qui importe l'adaptateur.
 *
 * Deux effets, tous deux nécessaires :
 *
 *   1. `transcription-groq.ts` importe `TIMEOUT_TRANSCRIPTION_MS` et le type
 *      du fournisseur DEPUIS `transcription.ts`. Brancher l'adaptateur
 *      là-bas fabriquerait un cycle.
 *   2. C'est ce qui fait ENTRER l'adaptateur dans le paquet serveur. La
 *      panne muette de M3-B4 — le fichier présent dans l'image sans que le
 *      traceur de Next le voie — ne se reproduira pas ici.
 */
import {
  definirFournisseurTranscription, fournisseurTranscriptionInjecte,
  type FournisseurTranscription,
} from './transcription';

/**
 * Le fournisseur, tel qu'il s'écrit en base à la clôture.
 *
 * ⚠️ Le nom vient d'une CONSTANTE, jamais d'un champ de la réponse : un
 * service qui se nommerait lui-même choisirait ce qu'on écrit à son sujet.
 */
export const FOURNISSEUR_TRANSCRIPTION_NOM = 'groq' as const;

/**
 * Charge le fournisseur, ou rend `null` s'il n'y a rien à charger.
 *
 * Trois façons de rendre `null` : le module de l'adaptateur est absent, le
 * drapeau M3-D2 n'est pas posé, ou l'adaptateur ne rend pas de fonction. Dans
 * les trois cas l'étape n'a pas lieu, et la route le dit — sans jamais
 * inventer une transcription réussie et vide.
 *
 * ⚠️ AUCUN `catch` AUTOUR DE LA CONSTRUCTION, ET C'EST DÉLIBÉRÉ.
 * `fournisseurTranscriptionGroq()` lève `ConfigurationTranscriptionInvalide`
 * quand le drapeau est posé mais que la clé ou le modèle manque. Avaler cette
 * erreur la transformerait en « aucun fournisseur configuré » — exactement
 * l'inverse de ce qu'on veut dire : quelqu'un a DEMANDÉ M3-D2, et il ne peut
 * pas se faire.
 */
export async function chargerFournisseurTranscription(): Promise<FournisseurTranscription | null> {
  // A. Le fournisseur posé par un test gagne toujours, et sans rien charger.
  const injecte = fournisseurTranscriptionInjecte();
  if (injecte) return injecte;

  let adaptateur: Record<string, unknown>;
  try {
    adaptateur = await import('@/lib/autopilot/analyse/transcription-groq') as Record<string, unknown>;
  } catch {
    return null;
  }

  const actif = adaptateur.transcriptionGroqActive;
  // B. Drapeau absent, `false`, `"1"`, `"oui"`… — M3-D2 n'est pas demandé.
  //    Aucune clé n'est lue, aucun réseau n'est touché, aucun octet extrait.
  if (typeof actif !== 'function' || !actif()) return null;

  const construire = adaptateur.fournisseurTranscriptionGroq;
  if (typeof construire !== 'function') return null;

  const fournisseur = (construire as () => unknown)();
  if (typeof fournisseur !== 'function') return null;

  // Branché pour les appels suivants du même processus, et rendu tout de
  // suite : le chargement est ainsi payé une fois, pas à chaque requête.
  definirFournisseurTranscription(fournisseur as FournisseurTranscription);
  return fournisseur as FournisseurTranscription;
}
