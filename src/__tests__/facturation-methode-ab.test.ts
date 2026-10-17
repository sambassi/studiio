/**
 * M3-a PR2 — la méthode A / B ne touche PAS la facturation : le serveur ne la
 * lit jamais. Un champ `methode` / `selection` glissé par le client est ignoré ;
 * la politique vient du rôle en base, à la réservation comme à la confirmation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'secret-de-test';

const authMock = vi.fn();
const inserts: Array<{ table: string; valeurs: Record<string, unknown> }> = [];
const rpcAppels: Array<{ nom: string; args: Record<string, unknown> }> = [];
let ligneUser: Record<string, unknown> = { role: 'user', email: 'u@v.w' };
let rendu: Record<string, unknown> | null = null;

vi.mock('@/lib/storage/minio-client', () => ({
  signeurPublic: () => null,
  clientMinio: () => ({ async statObject() { return { size: 120_000, metaData: { 'content-type': 'video/webm' } }; } }),
}));
function makeQuery(table: string) {
  const api: Record<string, unknown> = {
    select: () => api, eq: () => api, update: () => api,
    insert: (valeurs: Record<string, unknown>) => { inserts.push({ table, valeurs }); return api; },
    maybeSingle: async () => ({ data: table === 'tarifs_rendu' ? { credits: 10 } : table === 'users' ? ligneUser : rendu, error: null }),
    single: async () => {
      const d = inserts.at(-1)?.valeurs ?? {};
      return { data: { id: d.id, bucket: d.bucket, cle_objet: d.cle_objet, cout: d.cout, format: d.format, operation: d.operation, politique: d.politique }, error: null };
    },
  };
  return api;
}
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    rpc: async (nom: string, args: Record<string, unknown>) => {
      rpcAppels.push({ nom, args });
      return { data: [{ ok: true, etat: 'confirmed', solde: 90, deja_confirme: false, motif: null }], error: null };
    },
    storage: { from: () => ({ createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `https://minio.test/put/${p}`, token: '' }, error: null }) }) },
  },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST: CREER } = await import('@/app/api/render/jobs/route');
const { POST: CONFIRMER } = await import('@/app/api/render/jobs/[id]/confirm/route');
const creer = async (body: unknown) => { const r = await CREER({ json: async () => body } as never); return { status: r.status, body: await r.json() }; };
const confirmer = async () => { const r = await CONFIRMER({} as never, { params: { id: 'job-1' } } as never); return { status: r.status, body: await r.json() }; };

beforeEach(() => {
  inserts.length = 0; rpcAppels.length = 0;
  authMock.mockReset(); authMock.mockResolvedValue({ user: { id: 'moi' } });
});

describe('10. POST /api/render/jobs : la méthode du client ne change rien', () => {
  const corps = { operation: 'bureau', format: 'reel', methode: 'B', selection: 'passages' };
  it('compte user : politique credits, coût = tarif serveur, champs méthode ignorés (non écrits)', async () => {
    ligneUser = { role: 'user', email: 'u@v.w' };
    const r = await creer(corps);
    expect(r.status).toBe(200);
    const ligne = inserts.find((x) => x.table === 'rendus')!.valeurs;
    expect(ligne).toMatchObject({ operation: 'bureau', format: 'reel', cout: 10, politique: 'credits', user_id: 'moi' });
    expect('methode' in ligne || 'selection' in ligne).toBe(false);
    // Même réservation qu'avec le corps exact { operation, format }.
    inserts.length = 0;
    await creer({ operation: 'bureau', format: 'reel' });
    const sans = inserts.find((x) => x.table === 'rendus')!.valeurs;
    expect({ ...sans, id: 0, cle_objet: 0 }).toEqual({ ...ligne, id: 0, cle_objet: 0 });
  });
  it('compte admin : partner_cost_only, que la méthode soit A, B ou absente', async () => {
    ligneUser = { role: 'admin', email: 'a@b.c' };
    for (const m of ['A', 'B', undefined]) {
      inserts.length = 0;
      await creer({ operation: 'bureau', format: 'reel', ...(m ? { methode: m } : {}) });
      expect(inserts.find((x) => x.table === 'rendus')!.valeurs.politique).toBe('partner_cost_only');
    }
  });
});

describe('11. Confirmation admin : sans débit', () => {
  it('confirmer_rendu_sans_debit appelé, confirmer_rendu jamais, balance null', async () => {
    ligneUser = { role: 'admin', email: 'a@b.c' };
    rendu = { id: 'job-1', user_id: 'moi', operation: 'bureau', format: 'reel', cout: 10, bucket: 'media', cle_objet: 'moi/rendus/job-1.webm', etat: 'reserved', politique: 'partner_cost_only' };
    const r = await confirmer();
    expect(r.status).toBe(200);
    expect(r.body.balance).toBeNull();
    expect(rpcAppels.map((x) => x.nom)).toContain('confirmer_rendu_sans_debit');
    expect(rpcAppels.map((x) => x.nom)).not.toContain('confirmer_rendu');
  });
  it('les routes de facturation ne connaissent pas la méthode (aucune lecture de `methode` / `selection`)', () => {
    for (const f of ['src/app/api/render/jobs/route.ts', 'src/app/api/render/jobs/[id]/confirm/route.ts', 'src/lib/rendus/service.ts', 'src/lib/rendus/confirmation.ts', 'src/lib/rendus/client.ts']) {
      const t = readFileSync(f, 'utf8');
      expect(/methode|selection\s*:|passages/.test(t), f).toBe(false);
    }
  });
});
