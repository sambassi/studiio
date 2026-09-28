/**
 * `DepotsStore` sur PostgREST — table `pawapay_deposits` et RPC
 * `crediter_depot_pawapay` (migrations/2026-09-28-pawapay-deposits.sql).
 *
 * Le client est injecté (en production : `supabaseAdmin`, rôle serveur) pour
 * que la correspondance contrat ↔ colonnes soit testable sans réseau.
 *
 * Toute erreur PostgREST LÈVE : `confirmerDepot` ne l'avale pas, l'appelant
 * répond 5xx et le prochain passage réessaie.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PACKS_PAWAPAY, estPackId } from './tarifs';
import type { DemandeCredit, DepotAttendu, DepotsStore, StatutDepotLocal } from './types';

export const TABLE_DEPOTS = 'pawapay_deposits';
export const RPC_CREDIT = 'crediter_depot_pawapay';

// `montant::text` : le numeric exact arrive en CHAÎNE, jamais en nombre JSON.
const COLONNES = 'deposit_id,user_id,pack,credits,montant::text,devise,pays,statut,cree_le,verifie_le';

export interface LigneDepot {
  deposit_id: string;
  user_id: string;
  pack: string;
  credits: number;
  montant: string;
  devise: string;
  pays: string | null;
  statut: StatutDepotLocal;
  cree_le: string;
  verifie_le: string | null;
}

/** Horodatage PostgREST (`…+00:00`) → ISO `…Z`, comme le reste du contrat. */
function iso(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

export function ligneVersDepot(l: LigneDepot): DepotAttendu {
  return {
    depositId: l.deposit_id,
    userId: l.user_id,
    pack: l.pack,
    credits: l.credits,
    montant: String(l.montant),
    devise: l.devise,
    statut: l.statut,
    ...(l.pays ? { pays: l.pays } : {}),
    creeLe: iso(l.cree_le),
    verifieLe: l.verifie_le ? iso(l.verifie_le) : null,
  };
}

function echec(operation: string, error: { message?: string; code?: string }): Error {
  return new Error(`[PAWAPAY_STORE] ${operation} : ${error.code ?? ''} ${error.message ?? 'erreur inconnue'}`.trim());
}

export function creerStorePostgrest(client: SupabaseClient): DepotsStore {
  return {
    async enregistrer(d) {
      const { error } = await client.from(TABLE_DEPOTS).insert({
        deposit_id: d.depositId,
        user_id: d.userId,
        pack: d.pack,
        credits: d.credits,
        montant_chf_centimes: estPackId(d.pack) ? PACKS_PAWAPAY[d.pack].prixCentimesChf : null,
        montant: d.montant,
        devise: d.devise,
        pays: d.pays ?? null,
        statut: d.statut,
        cree_le: d.creeLe,
        verifie_le: d.verifieLe ?? null,
      });
      if (error) throw echec(`enregistrer ${d.depositId}`, error);
    },

    async lire(depositId) {
      const { data, error } = await client
        .from(TABLE_DEPOTS)
        .select(COLONNES)
        .eq('deposit_id', depositId)
        .maybeSingle();
      if (error) throw echec(`lire ${depositId}`, error);
      return data ? ligneVersDepot(data as unknown as LigneDepot) : null;
    },

    async listerEnAttente({ creeAvant, creeApres, limite }) {
      if (limite <= 0) return [];
      let requete = client
        .from(TABLE_DEPOTS)
        .select(COLONNES)
        .eq('statut', 'en_attente')
        .lte('cree_le', creeAvant);
      if (creeApres !== undefined) requete = requete.gte('cree_le', creeApres);
      // ORDER BY verifie_le ASC NULLS FIRST, cree_le ASC — explicite : par
      // défaut Postgres place les NULL en fin de tri ascendant, ce qui
      // servirait les jamais-vérifiés en dernier.
      const { data, error } = await requete
        .order('verifie_le', { ascending: true, nullsFirst: true })
        .order('cree_le', { ascending: true })
        .limit(limite);
      if (error) throw echec('listerEnAttente', error);
      return ((data ?? []) as unknown as LigneDepot[]).map(ligneVersDepot);
    },

    async noterVerification(depositId, quand) {
      const { error } = await client
        .from(TABLE_DEPOTS)
        .update({ verifie_le: quand })
        .eq('deposit_id', depositId);
      if (error) throw echec(`noterVerification ${depositId}`, error);
    },

    async crediterSiNonCredite(demande: DemandeCredit) {
      const { data, error } = await client.rpc(RPC_CREDIT, {
        p_deposit_id: demande.depositId,
        p_user_id: demande.userId,
        p_credits: demande.credits,
        p_reference: demande.referenceId,
      });
      if (error) throw echec(`crediter ${demande.depositId}`, error);
      if (data === 'credite' || data === 'deja_credite') return data;
      throw new Error(`[PAWAPAY_STORE] crediter ${demande.depositId} : réponse inattendue ${JSON.stringify(data)}`);
    },

    async marquerEchec(depositId) {
      const { error } = await client
        .from(TABLE_DEPOTS)
        .update({ statut: 'echec' })
        .eq('deposit_id', depositId)
        .neq('statut', 'credite');
      if (error) throw echec(`marquerEchec ${depositId}`, error);
    },
  };
}
