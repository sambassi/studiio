/**
 * Adaptateur supabase-js → SQL, sur un pool de connexions PostgreSQL réelles.
 *
 * Le code applicatif parle à PostgREST par supabase-js. Le harnais n'a pas
 * de PostgREST : ce module traduit le sous-ensemble du constructeur de
 * requêtes utilisé par les modules testés (`from/select/insert/update/
 * upsert/eq/is/in/order/limit/single`, `rpc`) en SQL exécuté sur une
 * connexion PRISE DANS UN POOL — chaque instruction sur sa propre
 * connexion, comme PostgREST. Les erreurs remontent avec leur `code`
 * SQLSTATE, comme PostgREST les rend (23505, 23503…) ; un `.single()` sans
 * ligne rend `PGRST116`, comme PostgREST. Aucune logique métier n'y vit.
 *
 * Emploi, dans un test : `vi.mock('@/lib/db/supabase', () => clientSql())`
 * puis `ouvrirPool()` dans `beforeAll` et `fermerPool()` dans `afterAll`.
 */
import { Pool, types } from 'pg';
import { urlBase } from './harness';

// PostgREST rend les horodatages en texte ; `pg` fabrique des `Date`. Les
// contrats applicatifs (`texteOuNull`) attendent du texte : on le garde brut.
types.setTypeParser(1184, (v) => v);
types.setTypeParser(1114, (v) => v);

type Ligne = Record<string, unknown>;
interface Filtre { col: string; op: 'eq' | 'is' | 'in'; val: unknown }
export interface ErreurSql { code?: string; message: string }

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

let pool: Pool | null = null;
export function ouvrirPool(max = 8): void { pool = new Pool({ connectionString: urlBase(), max }); }
export async function fermerPool(): Promise<void> { await pool?.end(); pool = null; }

async function executer(sql: string, params: unknown[]): Promise<{ data: Ligne[] | null; error: ErreurSql | null }> {
  if (!pool) throw new Error('ouvrirPool() avant toute requête');
  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, params);
    return { data: rows as Ligne[], error: null };
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { data: null, error: { code: err.code, message: err.message } };
  } finally {
    client.release();
  }
}

function construire(table: string) {
  const filtres: Filtre[] = [];
  let colonnes = '*';
  let ordre: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let insertion: Ligne | null = null;
  let conflit: string | null = null;
  let patch: Ligne | null = null;

  const exec = () => {
    const params: unknown[] = [];
    const where = filtres.length === 0 ? '' : ' where ' + filtres.map((f) => {
      if (f.op === 'is') return `${q(f.col)} is ${f.val === null ? 'null' : 'not null'}`;
      params.push(f.val);
      return f.op === 'in' ? `${q(f.col)} = any($${params.length})` : `${q(f.col)} = $${params.length}`;
    }).join(' and ');
    let sql: string;
    if (insertion) {
      const cles = Object.keys(insertion);
      const valeurs = cles.map((k) => {
        const v = insertion![k];
        // Un objet/tableau part en jsonb, comme PostgREST sérialise un corps JSON.
        return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
      });
      sql = `insert into public.${q(table)} (${cles.map(q).join(', ')}) values (${cles.map((_, i) => `$${i + 1}`).join(', ')})`;
      if (conflit) {
        const maj = cles.filter((k) => k !== conflit).map((k) => `${q(k)} = excluded.${q(k)}`).join(', ');
        sql += ` on conflict (${q(conflit)}) do update set ${maj || `${q(conflit)} = excluded.${q(conflit)}`}`;
      }
      sql += ` returning ${colonnes}`;
      return executer(sql, valeurs);
    }
    if (patch) {
      const cles = Object.keys(patch);
      const set = cles.map((k, i) => `${q(k)} = $${params.length + i + 1}`).join(', ');
      params.push(...cles.map((k) => {
        const v = patch![k];
        return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
      }));
      return executer(`update public.${q(table)} set ${set}${where} returning ${colonnes}`, params);
    }
    return executer(
      `select ${colonnes} from public.${q(table)}${where}`
        + (ordre ? ` order by ${q(ordre.col)} ${ordre.asc ? 'asc' : 'desc'}` : '')
        + (limite !== null ? ` limit ${limite}` : ''),
      params,
    );
  };

  const api = {
    select(c?: string) { colonnes = c && c !== '*' ? c.split(',').map((x) => q(x.trim())).join(', ') : '*'; return api; },
    insert(v: Ligne) { insertion = v; return api; },
    upsert(v: Ligne, o?: { onConflict?: string }) { insertion = v; conflit = o?.onConflict ?? null; return api; },
    update(p: Ligne) { patch = p; return api; },
    eq(col: string, val: unknown) { filtres.push({ col, op: 'eq', val }); return api; },
    is(col: string, val: unknown) { filtres.push({ col, op: 'is', val }); return api; },
    in(col: string, val: unknown[]) { filtres.push({ col, op: 'in', val }); return api; },
    order(col: string, o?: { ascending?: boolean }) { ordre = { col, asc: o?.ascending !== false }; return api; },
    async limit(n: number) { limite = n; return exec(); },
    async single() {
      const r = await exec();
      if (r.error) return { data: null, error: r.error };
      const rows = r.data ?? [];
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned (${rows.length})` } };
    },
    async maybeSingle() {
      // PostgREST : 0 ligne → `data: null` SANS erreur ; plusieurs → PGRST116.
      const r = await exec();
      if (r.error) return { data: null, error: r.error };
      const rows = r.data ?? [];
      if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: `multiple rows returned (${rows.length})` } };
      return { data: rows[0] ?? null, error: null };
    },
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return exec().then(resolve, reject); },
  };
  return api;
}

async function rpc(fn: string, params: Record<string, unknown>) {
  const cles = Object.keys(params);
  return executer(
    `select * from public.${q(fn)}(${cles.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')})`,
    cles.map((k) => params[k]),
  );
}

/** Ce que `vi.mock('@/lib/db/supabase', ...)` doit rendre. */
export function clientSql() {
  const client = { from: construire, rpc };
  return { supabase: client, supabaseAdmin: client };
}
