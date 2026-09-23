/**
 * Faux client Supabase EN MÉMOIRE, qui filtre réellement.
 *
 * Les mocks « chaîne qui renvoie toujours la même ligne » ne peuvent pas
 * prouver un owner-scoping ni une idempotence : ils ignorent les filtres. Ici
 * chaque `eq` / `is` restreint vraiment les lignes, `insert` ajoute une ligne,
 * `delete` la retire — une requête qui oublie `user_id` renvoie donc bel et bien
 * la ligne d'autrui, et le test le voit.
 *
 * Sous-ensemble de l'API PostgREST utilisé par les routes testées, rien de plus.
 */

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Journal des opérations d'écriture, dans l'ordre. */
  writes: { table: string; op: 'insert' | 'update' | 'delete'; values?: Row }[];
  /** Appelé juste avant chaque insert — permet de simuler un clic concurrent. */
  beforeInsert?: (table: string) => void;
  from(table: string): unknown;
}

let seq = 0;

export function createFakeDb(initial: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    writes: [],
    from(table: string) {
      return builder(db, table);
    },
  };
  return db;
}

function builder(db: FakeDb, table: string) {
  const filters: Filter[] = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: Row | null = null;
  let orderBy: { col: string; asc: boolean }[] = [];
  let lim: number | null = null;

  const rows = () => (db.tables[table] ??= []);

  const run = (): { data: Row[]; error: null } => {
    if (op === 'insert') {
      db.beforeInsert?.(table);
      const row: Row = {
        id: `gen-${++seq}`,
        created_at: new Date(Date.UTC(2026, 8, 23, 0, 0, seq)).toISOString(),
        ...payload,
      };
      rows().push(row);
      db.writes.push({ table, op: 'insert', values: { ...payload } });
      return { data: [{ ...row }], error: null };
    }
    let found = rows().filter((r) => filters.every((f) => f(r)));
    if (op === 'update') {
      for (const r of found) Object.assign(r, payload);
      db.writes.push({ table, op: 'update', values: { ...payload } });
      return { data: found.map((r) => ({ ...r })), error: null };
    }
    if (op === 'delete') {
      db.tables[table] = rows().filter((r) => !found.includes(r));
      db.writes.push({ table, op: 'delete' });
      return { data: found.map((r) => ({ ...r })), error: null };
    }
    for (const o of [...orderBy].reverse()) {
      found = [...found].sort((a, b) => {
        const x = String(a[o.col] ?? '');
        const y = String(b[o.col] ?? '');
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (lim !== null) found = found.slice(0, lim);
    return { data: found.map((r) => ({ ...r })), error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    insert: (v: Row) => { op = 'insert'; payload = v; return api; },
    update: (v: Row) => { op = 'update'; payload = v; return api; },
    delete: () => { op = 'delete'; return api; },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return api; },
    is: (col: string, val: unknown) => { filters.push((r) => (r[col] ?? null) === val); return api; },
    order: (col: string, o?: { ascending?: boolean }) => { orderBy.push({ col, asc: o?.ascending !== false }); return api; },
    limit: (n: number) => { lim = n; return api; },
    single: async () => {
      const { data } = run();
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'not single' } };
    },
    maybeSingle: async () => {
      const { data } = run();
      return { data: data[0] ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve().then(run).then(res, rej),
  };
  return api;
}
