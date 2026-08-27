/**
 * Débit atomique et idempotent — la façade TypeScript de `debiter_credits`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE CLIENT NE PEUT PLUS FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `/api/credits/deduct` acceptait `cost` depuis le navigateur, sans borne et
 * sans lien avec un travail réellement effectué. Ici, rien de tout cela ne
 * traverse : la fonction ne prend ni montant, ni identité. Le prix vient de
 * `public.tarifs_rendu`, l'identité de la session, et la référence est
 * construite par le serveur à partir d'une ressource dont il a vérifié la
 * propriété.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE SONDE, ET PAS UN APPEL SEC
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La migration s'applique à la main sur le serveur (le dépôt n'a pas de
 * runner, cf. `CLAUDE.md`). Entre le déploiement du code et l'exécution de la
 * migration, la fonction n'existe pas. Sans sonde, tout débit répondrait 500
 * pendant cette fenêtre. Avec elle, on sait le dire — et l'appelant décide.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Champs qu'un client n'a jamais le droit de proposer a `/api/credits/deduct`.
 *
 * Vit ici et non dans le fichier de route : un fichier de route Next ne peut
 * exporter que ses gestionnaires — tout autre export fait echouer la
 * verification de types des routes. Et sorti de la route, la liste devient
 * parcourable par les tests, ce qui rend une reouverture accidentelle
 * bruyante.
 */
export const CHAMPS_INTERDITS = [
  'cost', 'amount', 'credits', 'user_id', 'userId', 'reference', 'reference_id',
] as const;

export interface ResultatDebit {
  ok: boolean;
  /** Solde APRÈS l'opération. */
  solde: number;
  /** Vrai si ce débit avait déjà eu lieu : le rejeu n'a rien retiré. */
  dejaDebite: boolean;
  motif: MotifRefus | null;
}

export type MotifRefus =
  | 'reference_absente'
  | 'format_inconnu'
  | 'utilisateur_inconnu'
  | 'solde_insuffisant'
  /** La migration n'est pas encore appliquée sur ce serveur. */
  | 'socle_absent';

/**
 * Référence idempotente d'un rendu.
 *
 * Construite par le SERVEUR à partir de l'identifiant d'une ressource dont il
 * vient de vérifier la propriété — jamais reçue telle quelle du navigateur.
 * Un jeton arbitraire accepté du client permettrait de rejouer une référence
 * déjà payée pour obtenir un second rendu gratuit.
 */
export function referenceRendu(postId: string): string {
  return `rendu:${postId}`;
}

/** Codes PostgREST qui signifient « la fonction n'existe pas ». */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  // 42883 = undefined_function ; PGRST202 = pas dans le cache de schéma.
  return code === '42883' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

/**
 * Débite un rendu, une seule fois.
 *
 * Toute la décision est prise dans une seule instruction SQL : le solde est
 * décrémenté relativement, sous condition `credits >= coût`, et le journal
 * est écrit dans la même transaction. Il n'existe aucun état intermédiaire
 * où le solde aurait bougé sans trace, ni l'inverse.
 */
export async function debiterRenduAtomique(
  userId: string,
  format: 'reel' | 'tv',
  reference: string,
): Promise<ResultatDebit> {
  const { data, error } = await supabaseAdmin.rpc('debiter_credits', {
    p_user_id: userId,
    p_format: format,
    p_reference: reference,
  });

  if (error) {
    if (socleAbsent(error)) {
      console.warn(
        '[credits] `debiter_credits` introuvable — migration '
        + '2026-08-27-credits-atomiques.sql non appliquée sur ce serveur.',
      );
      return { ok: false, solde: 0, dejaDebite: false, motif: 'socle_absent' };
    }
    throw new Error(error.message || 'debit impossible');
  }

  // PostgREST rend une fonction `returns table` sous forme de tableau.
  const ligne = (Array.isArray(data) ? data[0] : data) as {
    ok: boolean; solde: number; deja_debite: boolean; motif: MotifRefus | null;
  } | undefined;

  if (!ligne) throw new Error('debit sans reponse');

  return {
    ok: !!ligne.ok,
    solde: Number(ligne.solde ?? 0),
    dejaDebite: !!ligne.deja_debite,
    motif: ligne.motif ?? null,
  };
}
