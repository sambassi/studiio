/**
 * A_6a — UNE VOIX CLONÉE APPARTIENT À QUELQU'UN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE LA LISTE PROTÉGEAIT DÉJÀ, ET CE QUE LA SYNTHÈSE NE PROTÉGEAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `GET /api/tts/elevenlabs` sépare correctement les deux mondes : les voix du
 * compte viennent de `user_voices`, et le catalogue partagé écarte les
 * catégories `cloned` et `professional`. Personne ne VOIT la voix clonée d'un
 * autre.
 *
 * `POST`, lui, vérifiait la FORME de l'identifiant — `[A-Za-z0-9_-]{8,64}` —
 * et rien d'autre. Un identifiant obtenu autrement (un journal, une capture,
 * un export) suffisait donc à faire parler la voix de quelqu'un d'autre. Ne
 * pas l'afficher n'est pas la même chose que le refuser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ET LE CONSENTEMENT EST RELU À CHAQUE SYNTHÈSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `user_voices.consent_at` est posé au clonage. Le vérifier ICI — et non une
 * seule fois, à la création — est ce qui fait qu'une ligne écrite par une
 * version future, ou modifiée à la main, ne peut pas faire parler une voix
 * sans preuve datée.
 *
 * ⚠️ AUCUNE EXCEPTION. Il n'y a pas de mode « juste pour tester », pas de
 * drapeau d'administration, pas de repli silencieux vers une voix voisine.
 * Une voix hors périmètre est refusée, et le message ne dit pas si elle
 * existe ailleurs.
 */
import { listUserVoices } from './store';

export const MOTIFS_VOIX = [
  'voix_absente',
  'voix_hors_perimetre',
  'voix_sans_consentement',
] as const;
export type MotifVoix = (typeof MOTIFS_VOIX)[number];

/**
 * ⚠️ LE MÊME MESSAGE POUR « PAS À TOI » ET « N'EXISTE PAS ».
 *
 * Distinguer les deux ferait de cette route un révélateur : essayer une liste
 * d'identifiants dirait lesquels existent. C'est la doctrine déjà appliquée
 * aux musiques et aux rendus.
 */
export const MESSAGES_VOIX: Record<MotifVoix, string> = {
  voix_absente: 'Cette voix n’est pas disponible.',
  voix_hors_perimetre: 'Cette voix n’est pas disponible.',
  voix_sans_consentement:
    'Cette voix ne porte pas d’autorisation d’utilisation. Refais le clonage pour la confirmer.',
};

export type IssueVoix =
  | { ok: true; providerVoiceId: string; clonee: boolean }
  | { ok: false; motif: MotifVoix };

/** La forme d'un `voice_id` ElevenLabs. Rien d'exotique n'entre dans une URL. */
export const FORME_VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Cette voix peut-elle être employée par CE compte ?
 *
 * Deux chemins, et deux seulement :
 *
 *   • une voix CLONÉE — elle doit être dans `user_voices` du compte, avec sa
 *     preuve de consentement ;
 *   • une voix du CATALOGUE partagé — elle n'appartient à personne, et le
 *     catalogue en écarte déjà les voix clonées.
 *
 * `catalogue` est passé en paramètre plutôt qu'importé : la route le met déjà
 * en cache, et le relire ici aurait fait deux caches pour une même liste.
 */
export async function resoudreVoixElevenLabs(
  userId: string,
  identifiantNu: string,
  catalogue: () => Promise<readonly { id: string }[]>,
): Promise<IssueVoix> {
  if (!userId) return { ok: false, motif: 'voix_hors_perimetre' };
  if (!FORME_VOICE_ID.test(identifiantNu)) return { ok: false, motif: 'voix_absente' };

  /* ⚠️ LE COMPTE D'ABORD. Interroger le catalogue distant pour une voix qui
     est de toute façon celle du compte coûterait un aller-retour réseau à
     chaque synthèse. */
  const miennes = await listUserVoices(userId);
  const mienne = miennes.find((v) => v.provider_voice_id === identifiantNu);
  if (mienne) {
    const consentement = (mienne as { consent_at?: unknown }).consent_at;
    if (typeof consentement !== 'string' || consentement.length === 0) {
      return { ok: false, motif: 'voix_sans_consentement' };
    }
    return { ok: true, providerVoiceId: identifiantNu, clonee: true };
  }

  const partagees = await catalogue();
  const partagee = partagees.some((v) => v.id.endsWith(identifiantNu));
  if (partagee) return { ok: true, providerVoiceId: identifiantNu, clonee: false };

  /* ⚠️ NI DANS SES VOIX, NI DANS LE CATALOGUE. C'est soit une voix clonée qui
     appartient à quelqu'un d'autre, soit rien du tout — et on répond la même
     chose dans les deux cas. */
  return { ok: false, motif: 'voix_hors_perimetre' };
}
