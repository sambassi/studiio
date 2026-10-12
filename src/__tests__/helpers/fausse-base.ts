/**
 * Fausse base PostgREST EN MÉMOIRE — juste ce que les tests de facturation
 * fournisseurs exécutent : select/insert/update/upsert/delete, filtres eq / is
 * / in / like / gte, order, limit, single / maybeSingle, count head, et les
 * deux contraintes d'unicité qui comptent ici (clé `app_settings.key`, index
 * « jumeau en vol » d'`avatar_generations`). Rien n'imite un comportement que
 * le code ne déclenche pas.
 */
type Ligne = Record<string, unknown>;
type Filtre = (l: Ligne) => boolean;

export function creerFausseBase() {
  const tables = new Map<string, Ligne[]>();
  let seq = 0;
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };

  function conflit(nom: string, l: Ligne): boolean {
    const t = table(nom);
    if (nom === 'app_settings') return t.some((x) => x.key === l.key);
    if (nom === 'avatar_generations' && (l.status === 'pending' || l.status === 'processing')) {
      return t.some((x) => (x.status === 'pending' || x.status === 'processing')
        && ['user_id', 'user_avatar_id', 'avatar_version', 'voice_id', 'aspect_ratio', 'script'].every((k) => x[k] === l[k]));
    }
    return false;
  }

  function from(nom: string) {
    const filtres: Filtre[] = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let charge: Ligne | Ligne[] | null = null;
    let renvoyer = false;
    let tete = false;
    let limite = Infinity;
    let tri: { col: string; asc: boolean } | null = null;

    const executer = (): { data: unknown; error: unknown; count?: number } => {
      const t = table(nom);
      if (op === 'insert') {
        const lignes = (Array.isArray(charge) ? charge : [charge!]).map((l) => ({ id: l.id ?? `${nom}-${++seq}`, created_at: new Date().toISOString(), credits_refunded: false, ...l }));
        for (const l of lignes) {
          if (conflit(nom, l)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        t.push(...lignes);
        return { data: renvoyer ? lignes.map((l) => ({ ...l })) : null, error: null };
      }
      if (op === 'upsert') {
        const l = charge as Ligne;
        const i = t.findIndex((x) => x.key === l.key);
        if (i >= 0) t[i] = { ...t[i], ...l }; else t.push({ ...l });
        return { data: null, error: null };
      }
      const touchees = t.filter((l) => filtres.every((f) => f(l)));
      if (op === 'update') {
        for (const l of touchees) Object.assign(l, charge);
        return { data: renvoyer ? touchees.map((l) => ({ ...l })) : null, error: null };
      }
      if (op === 'delete') {
        tables.set(nom, t.filter((l) => !touchees.includes(l)));
        return { data: null, error: null };
      }
      let rangs = [...touchees];
      if (tri) rangs.sort((a, b) => (String(a[tri!.col]) < String(b[tri!.col]) ? -1 : 1) * (tri!.asc ? 1 : -1));
      rangs = rangs.slice(0, limite).map((l) => ({ ...l }));
      return tete ? { data: null, error: null, count: touchees.length } : { data: rangs, error: null, count: touchees.length };
    };

    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => { renvoyer = true; if (o?.head) tete = true; return q; },
      insert: (l: Ligne | Ligne[]) => { op = 'insert'; charge = l; return q; },
      update: (p: Ligne) => { op = 'update'; charge = p; return q; },
      upsert: (l: Ligne) => { op = 'upsert'; charge = l; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return q; },
      is: (c: string, v: unknown) => { filtres.push((l) => (l[c] ?? null) === v); return q; },
      in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(l[c])); return q; },
      like: (c: string, motif: string) => { const p = motif.replace(/%$/, ''); filtres.push((l) => typeof l[c] === 'string' && (l[c] as string).startsWith(p)); return q; },
      gte: (c: string, v: unknown) => { filtres.push((l) => String(l[c]) >= String(v)); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { tri = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limite = n; return q; },
      single: async () => { const r = executer(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { code: 'PGRST116', message: 'no rows' }) }; },
      maybeSingle: async () => { const r = executer(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(executer).then(ok, ko),
    };
    return q;
  }

  return {
    tables,
    table,
    supabaseAdmin: { from, storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/media/${p}` } }) }) } },
    vider: () => { tables.clear(); seq = 0; },
  };
}

/** Instance partagée : un `vi.mock` (hissé) la récupère par `await import`. */
export const fausseBase = creerFausseBase();
