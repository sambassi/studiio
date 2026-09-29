/**
 * Fausse base PostgREST pour les tests Stripe : tables en mémoire, sous-ensemble
 * du constructeur supabase-js réellement utilisé (select / eq / is / insert /
 * update / upsert / delete / single / rpc), index unique
 * `credit_transactions (user_id, reference_id)` et contrat `stripe_events`.
 */

type Ligne = Record<string, any>;
type Erreur = { code?: string; message: string } | null;

export interface FausseBase {
  tables: Record<string, Ligne[]>;
  /** Erreur forcée par `table:action` (ex. `users:update`). */
  pannes: Record<string, Erreur>;
  /** Appelé juste avant chaque `update` sur `users` (simulation de course). */
  avantUpdateUsers?: () => void;
  /** Les RPC `stripe_event_*` répondent « fonction absente ». */
  rpcAbsentes: boolean;
  /** Réponse forcée de `stripe_event_claim`. */
  reclamationForcee?: string;
  appelsRpc: Array<{ nom: string; args: any }>;
}

export function nouvelleBase(): FausseBase {
  return {
    tables: {
      users: [], subscriptions: [], plans: [], credit_packs: [],
      credit_transactions: [], stripe_events: [],
    },
    pannes: {},
    rpcAbsentes: false,
    appelsRpc: [],
  };
}

function requete(base: FausseBase, table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  let charge: any = null;
  let options: any = null;
  let retour = false;
  let unique = false;

  const lignes = () => (base.tables[table] ??= []);

  const executer = async (): Promise<{ data: any; error: Erreur }> => {
    const panne = base.pannes[`${table}:${action}`];
    if (panne) return { data: null, error: panne };

    if (action === 'select') {
      const res = lignes().filter((l) => filtres.every((f) => f(l)));
      if (unique) {
        return res.length === 1
          ? { data: { ...res[0] }, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'not single' } };
      }
      return { data: res.map((l) => ({ ...l })), error: null };
    }
    if (action === 'insert') {
      const rows = Array.isArray(charge) ? charge : [charge];
      for (const r of rows) {
        if (table === 'credit_transactions' && r.reference_id != null) {
          const doublon = lignes().some((l) => l.user_id === r.user_id && l.reference_id === r.reference_id);
          if (doublon) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        lignes().push({ ...r });
      }
      return { data: null, error: null };
    }
    if (action === 'update') {
      if (table === 'users') base.avantUpdateUsers?.();
      const touchees = lignes().filter((l) => filtres.every((f) => f(l)));
      for (const l of touchees) Object.assign(l, charge);
      return { data: retour ? touchees.map((l) => ({ ...l })) : null, error: null };
    }
    if (action === 'upsert') {
      const cle = options?.onConflict ?? 'id';
      const existante = lignes().find((l) => l[cle] === charge[cle]);
      if (existante) Object.assign(existante, charge);
      else lignes().push({ ...charge });
      return { data: null, error: null };
    }
    // delete
    const garder = lignes().filter((l) => !filtres.every((f) => f(l)));
    base.tables[table] = garder;
    return { data: null, error: null };
  };

  const api: any = {
    select: () => { if (action === 'select') return api; retour = true; return api; },
    eq: (k: string, v: any) => { filtres.push((l) => l[k] === v); return api; },
    is: (k: string, v: any) => { filtres.push((l) => (l[k] ?? null) === v); return api; },
    order: () => api,
    limit: () => api,
    insert: (r: any) => { action = 'insert'; charge = r; return api; },
    update: (p: any) => { action = 'update'; charge = p; return api; },
    upsert: (r: any, o?: any) => { action = 'upsert'; charge = r; options = o; return api; },
    delete: () => { action = 'delete'; return api; },
    single: () => { unique = true; return executer(); },
    then: (ok: any, ko?: any) => executer().then(ok, ko),
  };
  return api;
}

function rpc(base: FausseBase, nom: string, args: any): Promise<{ data: any; error: Erreur }> {
  base.appelsRpc.push({ nom, args });
  const panne = base.pannes[`rpc:${nom}`];
  if (panne) return Promise.resolve({ data: null, error: panne });
  if (nom === 'crediter_credits_stripe') return Promise.resolve(crediter(base, args));
  if (base.rpcAbsentes) {
    return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } });
  }
  const evs = base.tables.stripe_events;
  const maintenant = Date.now();
  if (nom === 'stripe_event_claim') {
    if (base.reclamationForcee) return Promise.resolve({ data: base.reclamationForcee, error: null });
    const ev = evs.find((e) => e.event_id === args.p_event_id);
    if (!ev) {
      evs.push({ event_id: args.p_event_id, type: args.p_type, status: 'processing', attempts: 1, lease_until: maintenant + args.p_lease_seconds * 1000 });
      return Promise.resolve({ data: 'claimed', error: null });
    }
    if (ev.status === 'processed') return Promise.resolve({ data: 'already_processed', error: null });
    if (ev.status === 'processing' && ev.lease_until > maintenant) return Promise.resolve({ data: 'in_progress', error: null });
    ev.status = 'processing';
    ev.attempts += 1;
    ev.lease_until = maintenant + args.p_lease_seconds * 1000;
    return Promise.resolve({ data: 'claimed', error: null });
  }
  if (nom === 'stripe_event_complete') {
    const ev = evs.find((e) => e.event_id === args.p_event_id);
    if (ev) { ev.status = 'processed'; ev.lease_until = null; }
    return Promise.resolve({ data: null, error: null });
  }
  if (nom === 'stripe_event_fail') {
    const ev = evs.find((e) => e.event_id === args.p_event_id);
    if (ev) { ev.status = 'failed'; ev.last_error = args.p_error; ev.lease_until = null; }
    return Promise.resolve({ data: null, error: null });
  }
  return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `rpc inconnue ${nom}` } });
}

/** Réplique de `crediter_credits_stripe` (#471) : mêmes refus, même idempotence. */
function crediter(base: FausseBase, a: any): { data: any; error: Erreur } {
  const refus = (motif: string) => ({ data: [{ ok: false, solde: 0, deja_credite: false, motif }], error: null });
  if (typeof a.p_reference !== 'string' || !/^stripe:./.test(a.p_reference)) return refus('reference_invalide');
  if (!Number.isInteger(a.p_montant) || a.p_montant <= 0 || a.p_montant > 100000) return refus('montant_invalide');
  if (!['purchase', 'subscription', 'bonus', 'refund'].includes(a.p_type)) return refus('type_invalide');
  if (!['ajouter', 'fixer'].includes(a.p_mode)) return refus('mode_invalide');
  const u = base.tables.users.find((l) => l.id === a.p_user_id);
  if (!u) return refus('utilisateur_inconnu');
  const tx = base.tables.credit_transactions;
  if (tx.some((t) => t.user_id === a.p_user_id && t.reference_id === a.p_reference)) {
    return { data: [{ ok: true, solde: u.credits ?? 0, deja_credite: true, motif: null }], error: null };
  }
  u.credits = a.p_mode === 'ajouter' ? (u.credits ?? 0) + a.p_montant : a.p_montant;
  tx.push({ user_id: a.p_user_id, amount: a.p_montant, type: a.p_type, reference_id: a.p_reference, description: a.p_description });
  return { data: [{ ok: true, solde: u.credits, deja_credite: false, motif: null }], error: null };
}

export function clientFactice(base: () => FausseBase) {
  return {
    from: (t: string) => requete(base(), t),
    rpc: (nom: string, args: any) => rpc(base(), nom, args),
  };
}
