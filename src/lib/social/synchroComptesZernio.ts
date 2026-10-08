import { supabaseAdmin } from '@/lib/db/supabase';
import {
  getAccountHealth, isZernioPlatform, listAccounts, zernioConfigured,
  type ZernioAccount, type ZernioAccountHealth,
} from '@/lib/social/zernio';

/**
 * Resynchronise les comptes d'un utilisateur À PARTIR DE ZERNIO.
 *
 * ⚠️ `zernio_accounts.status = 'connected'` NE PROUVE RIEN. La ligne est écrite
 * au retour de connexion, puis plus jamais vérifiée : un jeton expiré ou
 * révoqué chez Meta laissait le compte « Connecté » dans Studiio, et chaque
 * publication échouait en `403 ACCOUNT_DISCONNECTED`.
 *
 * ⚠️ UNE RECONNEXION PEUT CRÉER UN NOUVEL `accountId`. La doc Zernio ne
 * garantit pas sa conservation et demande de relire `GET /v1/accounts`. En
 * production (2026-10-08), Facebook avait ainsi deux lignes : l'ancienne
 * (`disconnected`) et la nouvelle (`connected`).
 *
 * Règle : Zernio fait foi. Chaque compte qu'il rend est écrit avec l'état
 * qu'il donne (actif + santé) ; chaque ligne qu'il ne rend plus passe
 * `disconnected`. Si Zernio est injoignable, la base n'est PAS touchée :
 * mieux vaut un état ancien qu'un compte déconnecté à tort.
 */

export type EtatCompte = 'connected' | 'disconnected';

/** L'état d'un compte selon Zernio. Pure. Santé absente = on ne sait pas : seul `isActive` compte. */
export function etatDepuisZernio(compte: Pick<ZernioAccount, 'isActive'>, sante: ZernioAccountHealth | null): EtatCompte {
  if (compte.isActive === false) return 'disconnected';
  if (sante) {
    if (sante.tokenStatus?.valid === false) return 'disconnected';
    if (sante.permissions?.canPost === false) return 'disconnected';
  }
  return 'connected';
}

export interface ResultatSynchro {
  ok: boolean;
  comptes: Array<{ accountId: string; platform: string; username: string | null; status: EtatCompte }>;
}

const DERNIERE: Map<string, number> = new Map();
/** Une synchronisation par utilisateur et par minute au plus (chargements de page répétés). */
const INTERVALLE_MS = 60_000;

export async function synchroniserComptesZernio(
  userId: string,
  profileId: string | null | undefined,
  options: { forcer?: boolean } = {},
): Promise<ResultatSynchro> {
  if (!profileId || !zernioConfigured()) return { ok: false, comptes: [] };
  const maintenant = Date.now();
  if (!options.forcer && maintenant - (DERNIERE.get(userId) ?? 0) < INTERVALLE_MS) return { ok: false, comptes: [] };
  DERNIERE.set(userId, maintenant);

  let distants: ZernioAccount[];
  try {
    distants = (await listAccounts(profileId)).filter((a) => isZernioPlatform(a.platform));
  } catch (err) {
    console.error('[Zernio/Synchro] liste des comptes impossible :', err instanceof Error ? err.message : err);
    return { ok: false, comptes: [] };
  }

  const comptes: ResultatSynchro['comptes'] = [];
  for (const a of distants) {
    let sante: ZernioAccountHealth | null = null;
    try {
      sante = await getAccountHealth(a._id);
    } catch (err) {
      console.warn(`[Zernio/Synchro] sante de ${a.platform} illisible :`, err instanceof Error ? err.message : err);
    }
    const status = etatDepuisZernio(a, sante);
    comptes.push({ accountId: a._id, platform: a.platform, username: a.username ?? null, status });
    if (status === 'disconnected') {
      console.warn(`[Zernio/Synchro] ${a.platform} a reconnecter (actif=${a.isActive}, jeton=${sante?.tokenStatus?.valid}, canPost=${sante?.permissions?.canPost}, manquants=${(sante?.permissions?.missingRequired ?? []).join(',') || '-'})`);
    }
  }

  const ecrit = new Date().toISOString();
  if (comptes.length > 0) {
    const { error } = await supabaseAdmin.from('zernio_accounts').upsert(
      comptes.map((c) => ({
        user_id: userId, profile_id: profileId, account_id: c.accountId,
        platform: c.platform, username: c.username, status: c.status, updated_at: ecrit,
      })),
      { onConflict: 'account_id' },
    );
    if (error) {
      console.error('[Zernio/Synchro] ecriture des comptes :', error.message);
      return { ok: false, comptes };
    }
  }

  // Les lignes que Zernio ne rend plus (ancien accountId après reconnexion,
  // compte supprimé) : plus jamais ciblées.
  const vivants = comptes.map((c) => c.accountId);
  const { data } = await supabaseAdmin
    .from('zernio_accounts').select('account_id, status').eq('user_id', userId);
  const obsoletes = ((data ?? []) as Array<{ account_id: string; status: string }>)
    .filter((l) => l.status !== 'disconnected' && !vivants.includes(l.account_id))
    .map((l) => l.account_id);
  for (const id of obsoletes) {
    await supabaseAdmin.from('zernio_accounts')
      .update({ status: 'disconnected', updated_at: ecrit })
      .eq('user_id', userId).eq('account_id', id);
  }
  if (obsoletes.length) console.warn(`[Zernio/Synchro] ${obsoletes.length} compte(s) absent(s) de Zernio passe(s) disconnected`);

  return { ok: true, comptes };
}

/** Pour les tests : oublie le dernier passage. */
export function _oublierSynchro(): void { DERNIERE.clear(); }
