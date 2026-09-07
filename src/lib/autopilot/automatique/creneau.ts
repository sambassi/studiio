/**
 * A_0c — UN SEUL WORKER PAR CRÉNEAU, ET LA BASE EN DÉCIDE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI MANQUAIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `creneauxExistants()` lit les posts déjà produits et compare en JavaScript.
 * C'est un contrôle, pas un verrou. Deux crons qui se croisent lisent tous
 * les deux « créneau libre », puis analysent tous les deux, appellent Sonnet
 * tous les deux, encodent tous les deux, et débitent tous les deux — avant
 * que le premier n'écrive la preuve que l'autre attendait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA RÉCLAMATION EST ATOMIQUE, ET C'EST TOUT L'INTÉRÊT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun `SELECT` suivi d'un `INSERT` : entre les deux, un autre worker passe.
 * C'est un `INSERT … ON CONFLICT … WHERE` qui tranche, en une instruction,
 * et l'index unique `(user_id, slot_key)` qui rend la course impossible.
 *
 * ⚠️ ET LE VERROU EST PRIS AVANT TOUTE DÉPENSE. Le placer après l'analyse ou
 * après le rendu ne servirait à rien : le doublon aurait déjà payé.
 */
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  BUDGET_EXTRACTION_MS, TIMEOUT_MINIO_MS,
} from '@/lib/autopilot/analyse/extraction';
import { TIMEOUT_VISUEL_MS } from '@/lib/autopilot/analyse/visuel';
import { TIMEOUT_CANDIDATS_MS } from '@/lib/autopilot/analyse/candidat';
import {
  PEREMPTION_RENDU_MS, MARGE_PEREMPTION_MS,
} from '@/lib/autopilot/analyse/rendu-contrat';

/**
 * La durée du bail — CALCULÉE, jamais choisie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `maxDuration` NE BORNE RIEN CHEZ NOUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route du cron déclare `maxDuration = 300`, mais le dépôt documente
 * ailleurs que cette valeur est INERTE sur Coolify : c'est une limite de
 * plateforme que Vercel applique et que le serveur Node autonome ignore.
 * Dimensionner le bail sur elle donnerait un chiffre rassurant et faux — un
 * cycle plus long verrait son créneau repris pendant qu'il travaille encore,
 * et le doublon reviendrait par la porte du verrou censé l'interdire.
 *
 * Ce qui borne réellement, ce sont les budgets INTERNES du moteur, chacun
 * déjà calculé et testé ailleurs. Le bail est LEUR SOMME, plus la marge que
 * le dépôt utilise déjà pour la péremption d'un rendu.
 *
 * ⚠️ ET PAS DAVANTAGE. Une première rédaction doublait ce total « par
 * prudence » : 91 minutes. Ce n'était pas de la prudence, c'était une
 * superstition — chaque terme de cette somme EST déjà un pire cas, et les
 * additionner suppose déjà que toutes les étapes atteignent leur maximum
 * dans le même cycle. Doubler ne protégeait rien de plus, et immobilisait
 * pour une heure et demie le créneau d'un processus mort en trente secondes.
 */
export const BAIL_CRENEAU_MS =
  BUDGET_EXTRACTION_MS      // extraction : transfert + ffmpeg
  + TIMEOUT_VISUEL_MS       // lecture des images
  + TIMEOUT_MINIO_MS        // mesure audio : le transfert qui la précède
  + TIMEOUT_CANDIDATS_MS    // les candidats, Sonnet compris
  + PEREMPTION_RENDU_MS     // le pire cas d'un rendu complet, déjà calculé
  + MARGE_PEREMPTION_MS;    // la marge que le dépôt applique déjà, une fois

export const BAIL_CRENEAU_SECONDES = Math.ceil(BAIL_CRENEAU_MS / 1000);

/** Les issues d'une réclamation. Fermées : un `else` ne doit rien inventer. */
export const ISSUES_CRENEAU = [
  'reclame', 'deja_tenu', 'deja_terminee', 'indisponible', 'socle_absent',
] as const;
export type IssueCreneau = (typeof ISSUES_CRENEAU)[number];

export interface Reclamation {
  issue: IssueCreneau;
  /** Le droit de conclure. `null` dès qu'on n'a pas obtenu le créneau. */
  jeton: string | null;
  renduId: string | null;
}

/**
 * Un jeton imprévisible, fabriqué côté serveur.
 *
 * ⚠️ NI `Math.random`, NI L'HORLOGE. Le jeton est le droit de conclure un
 * créneau : deux workers qui en devineraient un troisième pourraient
 * s'annuler l'un l'autre. 32 octets tirés du générateur cryptographique
 * coûtent quelques microsecondes et ferment la question.
 */
export function nouveauJeton(): string {
  return randomBytes(24).toString('base64url');
}

const socleAbsent = (e: { code?: string; message?: string } | null): boolean => {
  if (!e) return false;
  const code = e.code ?? '';
  const message = (e.message ?? '').toLowerCase();
  return code === 'PGRST202' || code === '42883' || code === '42P01'
    || message.includes('could not find the function')
    || message.includes('schema cache');
};

/**
 * Réclame le créneau. Rend `reclame` UNE SEULE FOIS pour un même créneau.
 *
 * ⚠️ `socle_absent` REFUSE DE PRODUIRE, il n'autorise pas. Tant que la
 * migration n'est pas appliquée, la fonction n'existe pas — et un repli qui
 * dirait « pas de verrou, vas-y » réintroduirait exactement le défaut qu'on
 * ferme, en silence et le jour du déploiement. On préfère ne rien produire.
 */
export async function reclamerCreneau(
  userId: string, slotKey: string, jeton: string,
): Promise<Reclamation> {
  const { data, error } = await supabaseAdmin.rpc('reclamer_creneau_autopilote', {
    p_user_id: userId,
    p_slot_key: slotKey,
    p_jeton: jeton,
    p_bail_secondes: BAIL_CRENEAU_SECONDES,
  });

  if (error) {
    if (socleAbsent(error)) {
      console.warn('[autopilote][creneau] `reclamer_creneau_autopilote` introuvable — '
        + 'migration 2026-09-07-autopilot-generation-slots.sql non appliquée.');
      return { issue: 'socle_absent', jeton: null, renduId: null };
    }
    throw new Error(error.message || 'réclamation de créneau impossible');
  }

  const ligne = (Array.isArray(data) ? data[0] : data) as {
    issue?: string; jeton?: string | null; rendu_id?: string | null;
  } | undefined;
  const issue = (ISSUES_CRENEAU as readonly string[]).includes(ligne?.issue ?? '')
    ? ligne!.issue as IssueCreneau
    : 'indisponible';
  return {
    issue,
    jeton: issue === 'reclame' ? (ligne?.jeton ?? jeton) : null,
    renduId: ligne?.rendu_id ?? null,
  };
}

/**
 * Conclut le créneau — seulement si le jeton est encore le bon.
 *
 * Rend `false` quand le bail avait expiré et que quelqu'un d'autre a repris :
 * l'appelant a travaillé pour rien, mais il n'écrase pas le travail du
 * suivant. C'est le seul comportement qui ne perd jamais une vidéo.
 */
export async function conclureCreneau(
  userId: string, slotKey: string, jeton: string,
  statut: 'terminee' | 'echouee',
  o: { renduId?: string | null; motifEchec?: string | null } = {},
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('conclure_creneau_autopilote', {
    p_user_id: userId,
    p_slot_key: slotKey,
    p_jeton: jeton,
    p_statut: statut,
    p_rendu_id: o.renduId ?? null,
    p_motif_echec: o.motifEchec ?? null,
  });
  if (error) {
    if (socleAbsent(error)) return false;
    throw new Error(error.message || 'conclusion de créneau impossible');
  }
  const ligne = (Array.isArray(data) ? data[0] : data) as { issue?: string } | undefined;
  return ligne?.issue === 'conclu';
}
