// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AVATAR-1B — une nouvelle version REMPLACE sans effacer.
 *
 * La transition est pure et testée seule ; l'écriture est un compare-and-set
 * sur `version`, doublé ici par une base en mémoire qui applique VRAIMENT les
 * filtres (`id`, `user_id`, `deleted_at is null`, `version`) : deux envois
 * simultanés ne fabriquent pas deux « version 2 », et une ligne d'autrui
 * n'est jamais touchée.
 */

interface Ligne {
  id: string; user_id: string; status: string; version: number; deleted_at: string | null;
  provider_avatar_id: string | null; provider_asset_id: string | null; training_error: string | null;
  validated_at: string | null; source_object_key: string | null; consent_version: string | null;
  consent_text: string; created_at: string;
}

const base = vi.hoisted(() => ({ lignes: [] as Ligne[], journal: [] as string[] }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'user_avatars') throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let patch: Partial<Ligne> | null = null;
    let colonnes: string[] | null = null;
    const api = {
      update(p: Partial<Ligne>) { patch = p; base.journal.push(`update:${Object.keys(p).sort().join(',')}`); return api; },
      select(c?: string) { colonnes = c ? c.split(',').map((s) => s.trim()) : null; return api; },
      eq(k: keyof Ligne, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: keyof Ligne, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      async maybeSingle() {
        const touchees = base.lignes.filter((l) => filtres.every((f) => f(l)));
        if (patch) for (const l of touchees) Object.assign(l, patch);
        const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, (l as never)[c]])) : { ...l });
        if (touchees.length > 1) return { data: null, error: { message: 'plusieurs lignes' } };
        return { data: touchees.length === 1 ? projeter(touchees[0]) : null, error: null };
      },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

import { patchNouvelleVersion, commencerNouvelleVersionAvatar } from '@/lib/avatar/version';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-000000000001';

const ligne = (over: Partial<Ligne> = {}): Ligne => ({
  id: A, user_id: U, status: 'completed', version: 1, deleted_at: null,
  provider_avatar_id: 'hg-1', provider_asset_id: 'as-1', training_error: null,
  validated_at: '2026-09-15T00:00:00Z', source_object_key: `${U}/avatar/source-1.mp4`,
  consent_version: 'a8c-2026-09-09', consent_text: 'Je certifie…', created_at: '2026-09-01T00:00:00Z',
  ...over,
});

beforeEach(() => { base.lignes = [ligne()]; base.journal.length = 0; });

describe('patchNouvelleVersion — la transition, pure', () => {
  it('version + 1, statut source_ready, champs fournisseur et validation remis à zéro — et rien d’autre', () => {
    const p = patchNouvelleVersion({ version: 3, deleted_at: null });
    expect(p).toEqual({
      version: 4, status: ETAT_SOURCE_PRETE, validated_at: null,
      provider_avatar_id: null, provider_asset_id: null, training_error: null,
    });
    // Ce qui est conservé n'apparaît pas : consentement, source, identité.
    expect(Object.keys(p!)).not.toContain('consent_text');
    expect(Object.keys(p!)).not.toContain('source_object_key');
    expect(Object.keys(p!)).not.toContain('user_id');
  });

  it('⚠️ un clone supprimé ne se remplace pas ; une version malformée ne s’incrémente pas', () => {
    expect(patchNouvelleVersion({ version: 1, deleted_at: '2026-09-15T00:00:00Z' })).toBeNull();
    expect(patchNouvelleVersion({ version: 0, deleted_at: null })).toBeNull();
    expect(patchNouvelleVersion({ version: 1.5, deleted_at: null })).toBeNull();
    expect(patchNouvelleVersion({ version: NaN, deleted_at: null })).toBeNull();
  });
});

describe('commencerNouvelleVersionAvatar — compare-and-set sur la version', () => {
  it('avance la ligne vivante du compte, avec le complément (nouvelle source), sans toucher au consentement', async () => {
    const r = await commencerNouvelleVersionAvatar({
      userId: U, avatarId: A, versionAttendue: 1,
      complement: { source_object_key: `${U}/avatar/source-2.mp4` },
    });
    expect(r).toEqual({ ok: true, avatar: {
      id: A, user_id: U, status: ETAT_SOURCE_PRETE, version: 2, deleted_at: null,
      source_object_key: `${U}/avatar/source-2.mp4`,
    } });
    const l = base.lignes[0];
    expect(l.provider_avatar_id).toBeNull();
    expect(l.validated_at).toBeNull();
    expect(l.consent_text).toBe('Je certifie…');
    expect(l.created_at).toBe('2026-09-01T00:00:00Z');
  });

  it('⚠️ le complément ne peut pas contredire le patch (version, statut, fournisseur)', async () => {
    await commencerNouvelleVersionAvatar({
      userId: U, avatarId: A, versionAttendue: 1,
      complement: { version: 9, status: 'completed', provider_avatar_id: 'faux' } as never,
    });
    expect(base.lignes[0].version).toBe(2);
    expect(base.lignes[0].status).toBe(ETAT_SOURCE_PRETE);
    expect(base.lignes[0].provider_avatar_id).toBeNull();
  });

  it('⚠️ version concurrente : la seconde écriture ne touche rien et le dit', async () => {
    const [a, b] = await Promise.all([
      commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 1 }),
      commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 1 }),
    ]);
    const reussites = [a, b].filter((r) => r.ok);
    const refus = [a, b].filter((r) => !r.ok);
    expect(reussites).toHaveLength(1);
    expect(refus).toEqual([{ ok: false, motif: 'version_concurrente' }]);
    expect(base.lignes[0].version).toBe(2);
  });

  it('une version attendue périmée → version_concurrente, sans écrire', async () => {
    base.lignes = [ligne({ version: 3 })];
    expect(await commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 2 }))
      .toEqual({ ok: false, motif: 'version_concurrente' });
    expect(base.lignes[0].version).toBe(3);
    expect(base.lignes[0].provider_avatar_id).toBe('hg-1');
  });

  it('⚠️ la ligne d’un autre compte : introuvable, jamais modifiée', async () => {
    expect(await commencerNouvelleVersionAvatar({ userId: AUTRUI, avatarId: A, versionAttendue: 1 }))
      .toEqual({ ok: false, motif: 'introuvable' });
    expect(base.lignes[0].version).toBe(1);
    expect(base.lignes[0].provider_avatar_id).toBe('hg-1');
  });

  it('⚠️ un clone supprimé (deleted_at) : introuvable, jamais ressuscité', async () => {
    base.lignes = [ligne({ deleted_at: '2026-09-15T00:00:00Z' })];
    expect(await commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 1 }))
      .toEqual({ ok: false, motif: 'introuvable' });
    expect(base.lignes[0].version).toBe(1);
    expect(base.lignes[0].deleted_at).not.toBeNull();
  });

  describe('⚠️ complement.source_object_key — vérifié DANS le helper, avant toute requête', () => {
    const tenter = (source_object_key: string) =>
      commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 1, complement: { source_object_key } });

    it('la source de ce compte est acceptée et écrite', async () => {
      const r = await tenter(`${U}/avatar/source-2.mp4`);
      expect(r.ok).toBe(true);
      expect(base.lignes[0].source_object_key).toBe(`${U}/avatar/source-2.mp4`);
      expect(base.journal.filter((j) => j.startsWith('update:'))).toHaveLength(1);
    });

    it('sans source_object_key : le contrat actuel reste permis (rien n’est exigé)', async () => {
      const r = await commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 1, complement: { consent_version: 'v2' } });
      expect(r.ok).toBe(true);
      expect(base.lignes[0].source_object_key).toBe(`${U}/avatar/source-1.mp4`);
      expect(base.lignes[0].consent_version).toBe('v2');
    });

    for (const [libelle, cle] of [
      ['la source d’un AUTRE compte', `${AUTRUI}/avatar/source-2.mp4`],
      ['une vidéo GÉNÉRÉE du compte', `${U}/avatar/11111111-1111-4111-8111-000000000009.mp4`],
      ['un autre namespace du compte', `${U}/lut/source-2.mp4`],
      ['un préfixe partagé', 'converted/source-2.mp4'],
      ['une traversée', `${U}/avatar/../${AUTRUI}/avatar/source-2.mp4`],
      ['une clé malformée', `${U}/avatar/source-.mp4`],
      ['une chaîne vide', ''],
    ] as const) {
      it(`${libelle} → source_invalide, AUCUNE écriture`, async () => {
        expect(await tenter(cle)).toEqual({ ok: false, motif: 'source_invalide' });
        expect(base.journal).toEqual([]);
        expect(base.lignes[0].version).toBe(1);
        expect(base.lignes[0].source_object_key).toBe(`${U}/avatar/source-1.mp4`);
        expect(base.lignes[0].provider_avatar_id).toBe('hg-1');
      });
    }
  });

  it('version attendue invalide : refus AVANT toute requête', async () => {
    expect(await commencerNouvelleVersionAvatar({ userId: U, avatarId: A, versionAttendue: 0 }))
      .toEqual({ ok: false, motif: 'version_invalide' });
    expect(base.journal).toEqual([]);
  });
});
