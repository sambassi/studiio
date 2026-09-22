import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * `draftRushKeys()` — la source d'exemption des rushes de brouillon, et son
 * câblage dans le cron de nettoyage et l'assistant.
 *
 * ⚠️ CONTRAT DE SÛRETÉ : illisible (table absente ou base injoignable) ⇒
 * `null`, jamais un ensemble vide. Un ensemble vide se lirait « aucun rush à
 * protéger » et laisserait le cron supprimer ; `null` le fait répondre 503 et
 * ne rien supprimer de plus qu'aujourd'hui.
 */

interface Gt { field: string; value: string }
const gts: Gt[] = [];
let rows: unknown[] | null = [];
let dbError: unknown = null;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'creer_draft_rushes') throw new Error(`table inattendue: ${table}`);
      const api: Record<string, unknown> = {
        select: () => api,
        gt: (field: string, value: string) => { gts.push({ field, value }); return api; },
        then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: dbError }).then(onOk, onErr),
      };
      return api;
    },
  },
}));

const { draftRushKeys, DRAFT_RUSH_TTL_MS } = await import('@/lib/storage/cleanup');

beforeEach(() => {
  gts.length = 0;
  rows = [];
  dbError = null;
});

describe('draftRushKeys — contrat de lecture', () => {
  it('table absente OU base illisible → null (jamais un Set vide)', async () => {
    dbError = { code: 'PGRST205', message: 'Could not find the table public.creer_draft_rushes in the schema cache' };
    expect(await draftRushKeys()).toBeNull();
    dbError = { message: 'connexion perdue' };
    expect(await draftRushKeys()).toBeNull();
  });

  it('des entrées récentes → un Set de leurs clés', async () => {
    rows = [
      { object_key: 'media/u1/library/a.mp4' },
      { object_key: 'media/u2/library/b.mp4' },
    ];
    const set = await draftRushKeys();
    expect(set).toBeInstanceOf(Set);
    expect(set).not.toBeNull();
    expect(set!.has('media/u1/library/a.mp4')).toBe(true);
    expect(set!.has('media/u2/library/b.mp4')).toBe(true);
    expect(set!.size).toBe(2);
  });

  it('aucune entrée récente → un Set vide (et non null) : la lecture a réussi', async () => {
    rows = [];
    const set = await draftRushKeys();
    expect(set).toBeInstanceOf(Set);
    expect(set!.size).toBe(0);
  });

  it('ignore une valeur non-chaîne sans casser', async () => {
    rows = [{ object_key: null }, { object_key: 'media/u1/library/ok.mp4' }, {}];
    const set = await draftRushKeys();
    expect(set!.size).toBe(1);
    expect(set!.has('media/u1/library/ok.mp4')).toBe(true);
  });

  it('exclut les entrées de plus de 30 jours par un filtre `updated_at > now()-30j`', async () => {
    const avant = Date.now();
    await draftRushKeys();
    const apres = Date.now();
    expect(gts).toHaveLength(1);
    expect(gts[0].field).toBe('updated_at');
    const seuil = Date.parse(gts[0].value);
    // Le seuil est « il y a 30 jours », à la milliseconde de l'appel près.
    expect(seuil).toBeGreaterThanOrEqual(avant - DRAFT_RUSH_TTL_MS - 5);
    expect(seuil).toBeLessThanOrEqual(apres - DRAFT_RUSH_TTL_MS + 5);
  });
});

// ── Câblage, prouvé sur le texte source (le comportement du cron complet est
//    vérifié dans cleanup-media-brouillons.test.ts) ──────────────────────────
const cron = readFileSync(
  resolve(__dirname, '../app/api/cron/cleanup-media/route.ts'), 'utf-8',
);
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8',
);

describe('Le cron consulte les brouillons et s\'arrête si illisible', () => {
  it('il lit draftRushKeys et rend 503 quand la lecture échoue', () => {
    expect(cron).toContain('const brouillonsLus = await draftRushKeys();');
    expect(cron).toContain('if (!brouillonsLus)');
    expect(cron).toContain('status: 503');
  });
  it('processFile exempte une clé de brouillon', () => {
    expect(cron).toContain('clesBrouillon.has(cle)');
    expect(cron).toContain('exemptesBrouillons++');
  });
  it('le compteur est exposé dans la réponse pour vérification en prod', () => {
    expect(cron).toContain('brouillons: exemptesBrouillons');
    expect(cron).toContain('clesBrouillon: clesBrouillon.size');
  });
});

describe("L'assistant protège le rush importé", () => {
  it('applyRush appelle POST /api/creer/rush/keep', () => {
    expect(wizard).toContain("fetch('/api/creer/rush/keep'");
    expect(wizard).toContain('JSON.stringify({ url })');
  });
});
