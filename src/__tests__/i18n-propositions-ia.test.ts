// Propositions IA : jamais publiques, aperçu réservé à l'administrateur, approbation (unitaire et en lot) qui les publie.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const base = vi.hoisted(() => ({
  store: new Map<string, string>(),
  echecLecture: false,
  echecEcriture: false,
  ecritures: 0,
  admin: true,
  audit: [] as unknown[],
}));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'app_settings') throw new Error(`table inattendue ${table}`);
      return {
        select: () => ({
          eq: (_c: string, cle: string) => ({
            // Comme PostgREST : un TABLEAU (vide si aucune ligne) ; `maybeSingle` renverrait une erreur 406 à vide.
            limit: async () => (base.echecLecture ? { data: null, error: { message: 'panne' } } : { data: base.store.has(cle) ? [{ value: base.store.get(cle) }] : [], error: null }),
            maybeSingle: async () => ({ data: null, error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' } }),
          }),
        }),
        upsert: async (ligne: { key: string; value: string }) => {
          if (base.echecEcriture) return { error: { message: 'panne' } };
          base.store.set(ligne.key, ligne.value); base.ecritures += 1; return { error: null };
        },
      };
    },
  },
}));
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => (base.admin ? { error: null, session: { user: { id: 'u1', email: 'admin@studiio.test' } } } : { error: NextResponse.json({ success: false }, { status: 403 }), session: null }),
  logAdminAction: async (a: unknown) => { base.audit.push(a); },
}));

import { GET as lirePublic, viderMemo } from '@/app/api/i18n/[locale]/route';
import { GET as lireAdmin, PATCH as modifier } from '@/app/api/admin/traductions/route';
import propLn from '../../messages/propositions/ln.json';

const json = (m: string, url: string, corps?: unknown) => new NextRequest(`http://localhost${url}`, { method: m, body: corps === undefined ? undefined : JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const lectureAdmin = async () => (await (await lireAdmin(json('GET', '/api/admin/traductions?locale=ln'))).json());
const CLES = Object.keys(propLn as Record<string, string>);

beforeEach(() => { base.store.clear(); base.echecLecture = false; base.echecEcriture = false; base.ecritures = 0; base.admin = true; base.audit = []; viderMemo(); });

describe('propositions IA (ln)', () => {
  it('le jeu de propositions existe et chaque proposition est une ligne « proposee_ia » NON comptée comme traduite', async () => {
    expect(CLES.length).toBeGreaterThan(10);
    const j = await lectureAdmin();
    const l = j.lignes.find((x: { cle: string }) => x.cle === CLES[0]);
    expect(l.statut).toBe('proposee_ia');
    expect(l.texte).toBe('');                       // rien n'est affiché à l'utilisateur
    expect(l.proposition).toBe((propLn as Record<string, string>)[CLES[0]]);
    expect(j.compteurs.propositionsIA).toBe(j.lignes.filter((x: { statut: string }) => x.statut === 'proposee_ia').length);
  });
  it('la route publique ne renvoie JAMAIS une proposition (ni sans ni avec ?apercu=1 pour un non-admin)', async () => {
    let r = await lirePublic(json('GET', '/api/i18n/ln'), { params: { locale: 'ln' } });
    expect((await r.json()).corrections).toEqual({});
    base.admin = false; viderMemo();
    r = await lirePublic(json('GET', '/api/i18n/ln?apercu=1'), { params: { locale: 'ln' } });
    expect((await r.json()).corrections).toEqual({});
  });
  it("l'aperçu ?apercu=1 n'est servi qu'à un administrateur, sans cache", async () => {
    const r = await lirePublic(json('GET', '/api/i18n/ln?apercu=1'), { params: { locale: 'ln' } });
    const j = await r.json();
    expect(j.apercu).toBe(true);
    expect(j.corrections[CLES[0]]).toBe((propLn as Record<string, string>)[CLES[0]]);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it("approbation unitaire (texte + valider) : la proposition devient publique et « Validée »", async () => {
    const t = (propLn as Record<string, string>)[CLES[0]];
    const r = await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLES[0], texte: t, valider: true }));
    expect((await r.json()).ligne.statut).toBe('validee');
    viderMemo();
    const pub = await lirePublic(json('GET', '/api/i18n/ln'), { params: { locale: 'ln' } });
    expect((await pub.json()).corrections[CLES[0]]).toBe(t);
  });
  it('approbation en lot : une seule écriture, seules les propositions sont approuvées', async () => {
    const lot = [CLES[1], CLES[2], 'common.close', 'cle.inconnue'];   // common.close est déjà traduite en ln : ignorée
    const r = await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', approuver: lot }));
    const j = await r.json();
    expect(j.success).toBe(true); expect(j.approuvees).toBe(2); expect(base.ecritures).toBe(1);
    expect(j.lignes.find((x: { cle: string }) => x.cle === CLES[1]).statut).toBe('validee');
    expect(base.audit.some((a) => (a as { action: string }).action === 'i18n_approbation_ia')).toBe(true);
    viderMemo();
    const pub = (await (await lirePublic(json('GET', '/api/i18n/ln'), { params: { locale: 'ln' } })).json()).corrections;
    expect(Object.keys(pub).sort()).toEqual([CLES[1], CLES[2]].sort());
  });
  it("l'approbation en lot exige un administrateur et une liste valide ; rien n'est écrit si la lecture échoue", async () => {
    base.admin = false;
    expect((await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', approuver: [CLES[0]] }))).status).toBe(403);
    base.admin = true;
    expect((await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', approuver: [] }))).status).toBe(400);
    base.echecLecture = true;
    expect((await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', approuver: [CLES[0]] }))).status).toBe(503);
    expect(base.ecritures).toBe(0);
  });
});
