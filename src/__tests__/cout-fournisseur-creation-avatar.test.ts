// @vitest-environment node
/**
 * #562 D — CRÉER un avatar / une nouvelle version chez HeyGen (POST /v3/avatars)
 * peut être facturé, SANS tarif public. Un admin reçoit 428 + l'avertissement
 * (jamais un montant) AVANT tout dépôt, toute ligne et tout appel ; le devis
 * se lit sans rien écrire (`GET /api/avatar/devis-creation`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const etat = vi.hoisted(() => ({ admin: true, ecritures: [] as string[], heygen: [] as string[], identites: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'admin@test.fr' } }) }));
vi.mock('@/lib/admin', () => ({ isAdmin: () => true }));
vi.mock('@/lib/facturation/exemption', () => ({ compteExempteDeCredits: async () => etat.admin, exempteDeCredits: () => etat.admin }));
vi.mock('@/lib/avatar/versions', async (orig) => ({
  ...(await orig<typeof import('@/lib/avatar/versions')>()),
  listerIdentites: async () => ({ ok: true, identites: etat.identites }),
}));
vi.mock('@/lib/db/supabase', () => {
  const api: Record<string, unknown> = {};
  const enregistrer = (op: string) => () => { etat.ecritures.push(op); return api; };
  Object.assign(api, {
    select: () => api, eq: () => api, is: () => api, order: () => api, limit: () => api, single: async () => ({ data: null, error: { message: 'x' } }),
    insert: enregistrer('insert'), update: enregistrer('update'), upsert: enregistrer('upsert'), delete: enregistrer('delete'),
    then: (r: (v: unknown) => void) => r({ data: [], error: null }),
  });
  return { supabase: {}, supabaseAdmin: { from: () => api, storage: { from: () => ({ upload: enregistrer('upload'), remove: enregistrer('remove') }) } } };
});
vi.mock('@/lib/avatar/heygen', async (orig) => ({
  ...(await orig<typeof import('@/lib/avatar/heygen')>()),
  uploadAsset: async () => { etat.heygen.push('assets'); return { assetId: 'a' }; },
  createAvatarFromAsset: async () => { etat.heygen.push('avatars'); return { avatarId: 'x' }; },
}));

const { POST } = await import('@/app/api/avatar/create/route');
const { GET } = await import('@/app/api/avatar/devis-creation/route');

const formulaire = (champs: Record<string, string>) => {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(2048)], 'moi.mp4', { type: 'video/mp4' }));
  for (const [k, v] of Object.entries(champs)) fd.append(k, v);
  return new NextRequest('https://studiio.pro/api/avatar/create', { method: 'POST', body: fd });
};

beforeEach(() => { etat.admin = true; etat.ecritures.length = 0; etat.heygen.length = 0; etat.identites = []; });

describe('création d’avatar — coût fournisseur non publié', () => {
  it('⚠️ POST sans confirmation (admin) → 428, avertissement « montant exact non disponible », 0 dépôt, 0 ligne, 0 appel HeyGen', async () => {
    const res = await POST(formulaire({ consent: 'true', name: 'Mon avatar vidéo' }));
    expect(res.status).toBe(428);
    const j = await res.json();
    expect(j).toMatchObject({
      code: 'confirmation_cout_fournisseur',
      typeAvatar: 'video',
      nouvelEntrainement: true,
      avatarExistant: null,
      devis: { operation: 'creation_avatar', prixConnu: false, coutUsd: null, creditsStudiio: 0 },
    });
    expect(j.devis.avertissement).toBe('Coût fournisseur : montant exact non disponible. Cette opération peut être facturée par HeyGen.');
    expect(etat.ecritures).toEqual([]);
    expect(etat.heygen).toEqual([]);
  });

  it('⚠️ un avatar vidéo déjà UTILISABLE est proposé (« Utiliser l’existant ») — jamais recréé en silence', async () => {
    etat.identites = [
      { id: 'a-photo', name: 'Photo', avatar_type: 'photo', version: 1, status: 'completed', provider_avatar_id: 'p', validated_at: '2026-10-01', deleted_at: null },
      { id: 'a-video', name: 'Mon avatar vidéo', avatar_type: 'video', version: 6, status: 'completed', provider_avatar_id: 'v', validated_at: '2026-10-10', deleted_at: null },
    ];
    const j = await (await GET(new NextRequest('https://studiio.pro/api/avatar/devis-creation?type=video'))).json();
    expect(j.avatarExistant).toEqual({ id: 'a-video', nom: 'Mon avatar vidéo', version: 6 });
    expect(etat.ecritures).toEqual([]);
    expect(etat.heygen).toEqual([]);
  });

  it('un avatar non validé n’est PAS « utilisable »', async () => {
    etat.identites = [{ id: 'a-video', name: 'v7', avatar_type: 'video', version: 7, status: 'completed', provider_avatar_id: 'v', validated_at: null, deleted_at: null }];
    const j = await (await GET(new NextRequest('https://studiio.pro/api/avatar/devis-creation?type=video'))).json();
    expect(j.avatarExistant).toBeNull();
  });

  it('compte non admin : le devis ne demande rien, et rien n’est écrit', async () => {
    etat.admin = false;
    const res = await GET(new NextRequest('https://studiio.pro/api/avatar/devis-creation?type=video'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ confirmationRequise: false });
    expect(etat.ecritures).toEqual([]);
  });
});
