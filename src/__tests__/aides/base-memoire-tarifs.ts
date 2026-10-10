/**
 * Doublure EN MÉMOIRE de `supabaseAdmin` pour les tests de tarifs.
 *
 * Couvre exactement les chaînes utilisées par `lib/tarifs/serveur`,
 * `lib/facturation/exemption` et les routes `/api/tarifs` :
 *   select → eq → maybeSingle | order → limit | (await direct)
 *   update → eq · upsert · insert
 * `base.pannes[table] = true` fait échouer toute requête sur la table.
 * `base.lectures[table]` compte les lectures (concurrence, cache).
 */

type Ligne = Record<string, unknown>;

export interface BaseMemoire {
  tables: Record<string, Ligne[]>;
  pannes: Record<string, boolean>;
  lectures: Record<string, number>;
  ecritures: number;
}

export const base: BaseMemoire = { tables: {}, pannes: {}, lectures: {}, ecritures: 0 };

export function reinitialiserBase(): void {
  base.tables = {
    app_settings: [],
    tarifs_rendu: [
      { format: 'reel', credits: 10 },
      { format: 'tv', credits: 15 },
    ],
    audit_log: [],
    users: [],
  };
  base.pannes = {};
  base.lectures = {};
  base.ecritures = 0;
}
reinitialiserBase();

const erreur = (table: string) => ({ data: null, error: { message: `panne ${table}` } });

/**
 * Colonnes RÉELLES de la production (lecture seule du 2026-10-10,
 * `information_schema.columns`). Écrire une autre colonne échoue comme dans
 * PostgREST (PGRST204) — c'est ce qui a révélé `updated_by`, absente de
 * `app_settings` en prod alors que la vieille migration la déclarait.
 */
export const COLONNES_PROD: Record<string, readonly string[]> = {
  app_settings: ['key', 'value', 'updated_at'],
  tarifs_rendu: ['format', 'credits', 'updated_at'],
  audit_log: ['id', 'admin_email', 'action', 'target_type', 'target_id', 'details', 'created_at'],
};

function colonneInconnue(table: string, lignes: Ligne[]) {
  const permises = COLONNES_PROD[table];
  if (!permises) return null;
  for (const l of lignes) for (const k of Object.keys(l)) {
    if (!permises.includes(k)) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${k}' column of '${table}' in the schema cache` } };
  }
  return null;
}

function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  let ordre: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;

  const lignes = () => {
    let r = (base.tables[table] ?? []).filter((l) => filtres.every(([k, v]) => l[k] === v));
    if (ordre) {
      const { col, asc } = ordre;
      r = [...r].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (limite !== null) r = r.slice(0, limite);
    return r.map((l) => structuredClone(l));
  };

  const lire = () => {
    base.lectures[table] = (base.lectures[table] ?? 0) + 1;
    if (base.pannes[table]) return erreur(table);
    return { data: lignes(), error: null };
  };

  const selection = {
    eq(k: string, v: unknown) { filtres.push([k, v]); return selection; },
    order(col: string, o?: { ascending?: boolean }) { ordre = { col, asc: o?.ascending !== false }; return selection; },
    limit(n: number) { limite = n; return selection; },
    async maybeSingle() {
      const r = lire();
      if (r.error) return r;
      return { data: r.data![0] ?? null, error: null };
    },
    then<T>(ok: (v: unknown) => T, ko?: (e: unknown) => T) { return Promise.resolve(lire()).then(ok, ko); },
  };

  return {
    select(_cols?: string) { return selection; },
    update(valeurs: Ligne) {
      const f: Array<[string, unknown]> = [];
      const exec = () => {
        if (base.pannes[table]) return erreur(table);
        const inconnue = colonneInconnue(table, [valeurs]);
        if (inconnue) return inconnue;
        base.ecritures += 1;
        for (const l of base.tables[table] ?? []) if (f.every(([k, v]) => l[k] === v)) Object.assign(l, structuredClone(valeurs));
        return { data: null, error: null };
      };
      const chaine = {
        eq(k: string, v: unknown) { f.push([k, v]); return chaine; },
        then<T>(ok: (v: unknown) => T, ko?: (e: unknown) => T) { return Promise.resolve(exec()).then(ok, ko); },
      };
      return chaine;
    },
    async upsert(valeur: Ligne) {
      if (base.pannes[table]) return erreur(table);
      const inconnue = colonneInconnue(table, [valeur]);
      if (inconnue) return inconnue;
      base.ecritures += 1;
      const t = (base.tables[table] ??= []);
      const i = t.findIndex((l) => l.key === valeur.key);
      if (i >= 0) t[i] = structuredClone(valeur); else t.push(structuredClone(valeur));
      return { data: null, error: null };
    },
    async insert(valeurs: Ligne | Ligne[]) {
      if (base.pannes[table]) return erreur(table);
      const inconnue = colonneInconnue(table, Array.isArray(valeurs) ? valeurs : [valeurs]);
      if (inconnue) return inconnue;
      base.ecritures += 1;
      const t = (base.tables[table] ??= []);
      const liste = Array.isArray(valeurs) ? valeurs : [valeurs];
      for (const v of liste) t.push({ created_at: new Date(Date.now() + t.length).toISOString(), ...structuredClone(v) });
      return { data: null, error: null };
    },
  };
}

export const supabaseAdminMemoire = { from: (table: string) => requete(table) };
