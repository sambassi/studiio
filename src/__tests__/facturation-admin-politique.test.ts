// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ADMIN = 0 CRÉDIT STUDIIO, PARTOUT (#541).
 * Rôle `admin` OU e-mail administrateur : même réponse pour les rendus
 * (`politiqueDeLUtilisateur`) et pour les débits avatar / IA / Autopilote /
 * audio complet (`deductCredits`). Aucun fournisseur n'est concerné.
 */

const compte = vi.hoisted(() => ({ ligne: null as Record<string, unknown> | null, rpc: [] as unknown[] }));

vi.mock('@/lib/db/supabase', () => {
  const api = {
    select() { return api; },
    eq() { return api; },
    async maybeSingle() { return { data: compte.ligne, error: null }; },
    async single() { return { data: compte.ligne, error: compte.ligne ? null : { message: 'no rows' } }; },
  };
  const client = {
    from: () => api,
    rpc: async (...a: unknown[]) => { compte.rpc.push(a); return { data: { ok: true, solde: 0, deja_debite: false }, error: null }; },
  };
  return { supabase: client, supabaseAdmin: client };
});

const { politiqueDeLUtilisateur } = await import('@/lib/facturation/politique');
const { deductCredits, getUserCredits } = await import('@/lib/credits/system');

beforeEach(() => { compte.ligne = null; compte.rpc.length = 0; });

describe('Politique des rendus', () => {
  it('rôle admin → partner_cost_only (inchangé)', async () => {
    compte.ligne = { role: 'admin', email: 'x@exemple.com' };
    expect((await politiqueDeLUtilisateur('u')).politique).toBe('partner_cost_only');
  });
  it('⚠️ e-mail administrateur sans rôle → partner_cost_only (avant : payait ses rendus)', async () => {
    compte.ligne = { role: 'user', email: 'contact.artboost@gmail.com' };
    expect((await politiqueDeLUtilisateur('u')).politique).toBe('partner_cost_only');
  });
  it('utilisateur normal → credits', async () => {
    compte.ligne = { role: 'user', email: 'x@exemple.com' };
    expect((await politiqueDeLUtilisateur('u')).politique).toBe('credits');
  });
});

describe('deductCredits (avatar, IA image, Autopilote, audio complet)', () => {
  it('⚠️ rôle admin sans e-mail admin → aucun appel au débit (avant : débité)', async () => {
    compte.ligne = { role: 'admin', email: 'x@exemple.com', credits: 5 };
    expect(await deductCredits('u', 40, 'avatar', 'jumeau:g1')).toBe(true);
    expect(compte.rpc).toHaveLength(0);
    expect(await getUserCredits('u')).toBeGreaterThan(1_000_000);
  });
  it('e-mail admin → aucun appel au débit (inchangé)', async () => {
    compte.ligne = { role: 'user', email: 'bassicustomshoes@gmail.com', credits: 5 };
    expect(await deductCredits('u', 40, 'avatar')).toBe(true);
    expect(compte.rpc).toHaveLength(0);
  });
  it('utilisateur normal → débit atomique avec sa référence', async () => {
    compte.ligne = { role: 'user', email: 'x@exemple.com', credits: 100 };
    await deductCredits('u', 3, 'audio-complet', 'audio-complet:abc');
    expect(compte.rpc).toHaveLength(1);
    expect(JSON.stringify(compte.rpc[0])).toContain('audio-complet:abc');
  });
});
