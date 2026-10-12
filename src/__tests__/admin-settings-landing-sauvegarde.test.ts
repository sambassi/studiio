// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Admin Settings et Landing : jamais de « succès » sans écriture réelle.
 * La base simulée a les colonnes RÉELLES de `app_settings` en production
 * (key, value, updated_at) : écrire une colonne inconnue (`updated_by`)
 * échoue comme PostgREST (PGRST204), au lieu d'être ignoré.
 */
const COLONNES = new Set(['key', 'value', 'updated_at']);
const etat = vi.hoisted(() => ({
  table: new Map<string, { key: string; value: unknown; updated_at?: string }>(),
  panneEcriture: false,
  panneLecture: false,
  audits: [] as unknown[],
}));

function tableAppSettings() {
  let filtreCle: string | null = null;
  const q: any = {
    select: () => q,
    eq: (_c: string, v: string) => { filtreCle = v; return q; },
    maybeSingle: async () => {
      if (etat.panneLecture) return { data: null, error: { message: 'lecture en panne' } };
      return { data: filtreCle ? etat.table.get(filtreCle) ?? null : null, error: null };
    },
    single: async () => {
      if (etat.panneLecture) return { data: null, error: { message: 'lecture en panne' } };
      const l = filtreCle ? etat.table.get(filtreCle) : undefined;
      return l ? { data: l, error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } };
    },
    then: (ok: any, ko: any) => Promise.resolve(
      etat.panneLecture ? { data: null, error: { message: 'lecture en panne' } } : { data: [...etat.table.values()], error: null },
    ).then(ok, ko),
    upsert: async (lignes: any) => {
      const liste = Array.isArray(lignes) ? lignes : [lignes];
      if (etat.panneEcriture) return { data: null, error: { message: 'écriture en panne' } };
      for (const l of liste) {
        const inconnue = Object.keys(l).find((c) => !COLONNES.has(c));
        if (inconnue) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${inconnue}' column` } };
      }
      for (const l of liste) etat.table.set(l.key, { ...l });
      return { data: null, error: null };
    },
  };
  return q;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => { if (t !== 'app_settings') throw new Error(t); return tableAppSettings(); } },
}));
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => ({ error: null, session: { user: { email: 'admin@studiio.pro' } } }),
  logAdminAction: async (a: unknown) => { etat.audits.push(a); },
}));

import * as settings from '@/app/api/admin/settings/route';
import * as landing from '@/app/api/admin/landing/route';

const patch = (url: string, corps: unknown) => new NextRequest(url, {
  method: 'PATCH', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  etat.table.clear(); etat.panneEcriture = false; etat.panneLecture = false; etat.audits = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('Admin Settings', () => {
  it('sauvegarde → rechargement : la valeur est réellement conservée', async () => {
    const r = await settings.PATCH(patch('http://x/api/admin/settings', { maintenance_message: 'Retour à 14 h', max_videos: 7 }));
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
    const g = await (await settings.GET(new NextRequest('http://x/api/admin/settings'))).json();
    expect(g.settings.maintenance_message).toBe('Retour à 14 h');
    expect(g.settings.max_videos).toBe(7);
    expect(etat.audits).toHaveLength(1);
  });

  it('erreur DB simulée → réponse erreur, aucun faux succès, aucun audit', async () => {
    etat.panneEcriture = true;
    const r = await settings.PATCH(patch('http://x/api/admin/settings', { maintenance_message: 'X' }));
    expect(r.status).toBe(500);
    expect((await r.json()).success).toBe(false);
    expect(etat.table.size).toBe(0);
    expect(etat.audits).toHaveLength(0);
  });

  it('corps vide ou invalide → 400, rien écrit', async () => {
    expect((await settings.PATCH(patch('http://x/api/admin/settings', {}))).status).toBe(400);
    expect((await settings.PATCH(patch('http://x/api/admin/settings', [1]))).status).toBe(400);
    expect(etat.table.size).toBe(0);
  });
});

describe('Landing', () => {
  it('sauvegarde → rechargement : la valeur est réellement conservée, fusion préservée', async () => {
    await landing.PATCH(patch('http://x/api/admin/landing', { hero: { title: 'A' }, faq: [1] }));
    const r = await landing.PATCH(patch('http://x/api/admin/landing', { hero: { title: 'Nouveau titre' } }));
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
    const g = await (await landing.GET()).json();
    expect(g.content).toEqual({ hero: { title: 'Nouveau titre' }, faq: [1] });
  });

  it('erreur DB simulée à l’écriture → réponse erreur, aucun faux succès', async () => {
    await landing.PATCH(patch('http://x/api/admin/landing', { hero: { title: 'A' } }));
    etat.panneEcriture = true; etat.audits = [];
    const r = await landing.PATCH(patch('http://x/api/admin/landing', { hero: { title: 'B' } }));
    expect(r.status).toBe(500);
    expect((await r.json()).success).toBe(false);
    etat.panneEcriture = false;
    expect((await (await landing.GET()).json()).content.hero.title).toBe('A');
    expect(etat.audits).toHaveLength(0);
  });

  it('lecture en échec → erreur, rien écrasé (pas de fusion dans {})', async () => {
    await landing.PATCH(patch('http://x/api/admin/landing', { hero: { title: 'A' }, faq: [1] }));
    etat.panneLecture = true;
    const r = await landing.PATCH(patch('http://x/api/admin/landing', { hero: { title: 'B' } }));
    expect(r.status).toBe(500);
    etat.panneLecture = false;
    expect((await (await landing.GET()).json()).content).toEqual({ hero: { title: 'A' }, faq: [1] });
  });
});
