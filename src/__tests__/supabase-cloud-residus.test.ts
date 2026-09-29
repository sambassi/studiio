/**
 * Résidus Supabase Cloud — ce qui ne doit plus dépendre du projet cloud.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` désigne encore le projet Supabase CLOUD (plan
 * gratuit, coupable à tout moment). Ces tests verrouillent :
 *
 *   1. l'origine Supabase historique n'est plus qu'une origine de LECTURE des
 *      anciens contenus, avec un interrupteur serveur explicite
 *      (`SUPABASE_LEGACY_STORAGE_URL`) et JAMAIS `SUPABASE_URL` (PostgREST
 *      interne) ;
 *   2. `/api/proxy-media` : un chemin relatif se résout contre l'APPLICATION,
 *      jamais contre Supabase ; l'hôte PostgREST interne n'est jamais admis ;
 *   3. les emails de notification lisent la base via `supabaseAdmin`
 *      (PostgREST auto-hébergé), plus via un client cloud dédié ;
 *   4. `lib/db/supabase` n'exporte plus de client navigateur « anon » ;
 *   5. l'optimiseur d'images n'accepte plus `*.supabase.co` ;
 *   6. aucun code applicatif ne lit le LITTÉRAL
 *      `process.env.NEXT_PUBLIC_SUPABASE_URL` (Next le fige au build, et le
 *      Dockerfile y pose `placeholder.supabase.co`).
 *
 * Aucun réseau : `fetch` est simulé, la base est simulée.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createRequire } from 'module';

import {
  origineSupabaseHistorique,
  originesStockageConfigurees,
} from '@/lib/storage/acces-objet';

const CLOUD = 'https://lhuqdmlkhezdwzwlpfqo.supabase.co';
const APP = 'https://studiio.pro';
const POSTGREST = 'http://studiio-postgrest:3000';

// ───────────────────────────────────────────────────────────────────────────

describe('origineSupabaseHistorique', () => {
  it('repli sur NEXT_PUBLIC_SUPABASE_URL tant que la variable serveur est absente (default safe)', () => {
    expect(origineSupabaseHistorique({ NEXT_PUBLIC_SUPABASE_URL: `${CLOUD}/` })).toBe(CLOUD);
  });

  it('SUPABASE_LEGACY_STORAGE_URL fait autorité dès qu elle est définie', () => {
    expect(origineSupabaseHistorique({
      SUPABASE_LEGACY_STORAGE_URL: 'https://autre.supabase.co',
      NEXT_PUBLIC_SUPABASE_URL: CLOUD,
    })).toBe('https://autre.supabase.co');
  });

  it('SUPABASE_LEGACY_STORAGE_URL vide = interrupteur de coupure', () => {
    expect(origineSupabaseHistorique({
      SUPABASE_LEGACY_STORAGE_URL: '',
      NEXT_PUBLIC_SUPABASE_URL: CLOUD,
    })).toBeNull();
  });

  it('JAMAIS SUPABASE_URL (PostgREST interne)', () => {
    expect(origineSupabaseHistorique({ SUPABASE_URL: POSTGREST })).toBeNull();
  });

  it('NEXT_PUBLIC_SUPABASE_URL supprimée → aucune origine historique', () => {
    expect(origineSupabaseHistorique({})).toBeNull();
  });
});

describe('originesStockageConfigurees — origine historique', () => {
  it('garde le comportement d avant avec NEXT_PUBLIC_SUPABASE_URL seule', () => {
    expect(originesStockageConfigurees({ NEXT_PUBLIC_APP_URL: APP, NEXT_PUBLIC_SUPABASE_URL: CLOUD }))
      .toEqual([APP, CLOUD]);
  });

  it('coupure explicite : l origine cloud disparaît', () => {
    expect(originesStockageConfigurees({
      NEXT_PUBLIC_APP_URL: APP,
      NEXT_PUBLIC_SUPABASE_URL: CLOUD,
      SUPABASE_LEGACY_STORAGE_URL: '',
    })).toEqual([APP]);
  });

  it('n admet jamais le PostgREST interne', () => {
    expect(originesStockageConfigurees({ NEXT_PUBLIC_APP_URL: APP, SUPABASE_URL: POSTGREST }))
      .toEqual([APP]);
  });
});

// ───────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1' } })),
}));

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_LEGACY_STORAGE_URL',
  'NEXT_PUBLIC_APP_URL', 'NEXTAUTH_URL',
] as const;

describe('/api/proxy-media — origines', () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    fetchMock = vi.fn(async () => new Response('ok', {
      status: 200, headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  async function appeler(url: string) {
    const { GET } = await import('@/app/api/proxy-media/route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(`${APP}/api/proxy-media?url=${encodeURIComponent(url)}`);
    return GET(req);
  }

  it('chemin relatif → résolu contre l APPLICATION (relais MinIO)', async () => {
    process.env.NEXT_PUBLIC_APP_URL = APP;
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD;
    const res = await appeler('/storage/v1/object/public/media/u1/image/a.png');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0]))
      .toBe(`${APP}/storage/v1/object/public/media/u1/image/a.png`);
  });

  it('chemin relatif SANS origine applicative → refusé, jamais envoyé à Supabase', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD;
    const res = await appeler('/storage/v1/object/public/media/u1/image/a.png');
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ancien contenu Supabase Cloud → toujours lisible (default safe)', async () => {
    process.env.NEXT_PUBLIC_APP_URL = APP;
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD;
    const res = await appeler(`${CLOUD}/storage/v1/object/public/media/u1/image/a.png`);
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('lhuqdmlkhezdwzwlpfqo.supabase.co');
  });

  it('ancien contenu Supabase Cloud après coupure explicite → 403, aucun appel', async () => {
    process.env.NEXT_PUBLIC_APP_URL = APP;
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD;
    process.env.SUPABASE_LEGACY_STORAGE_URL = '';
    const res = await appeler(`${CLOUD}/storage/v1/object/public/media/u1/image/a.png`);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('le PostgREST interne (SUPABASE_URL) n est JAMAIS un hôte admis', async () => {
    process.env.NEXT_PUBLIC_APP_URL = APP;
    process.env.SUPABASE_URL = POSTGREST;
    const res = await appeler(`${POSTGREST}/storage/v1/object/public/media/u1/image/a.png`);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('notifications — la base passe par supabaseAdmin', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/db/supabase');
    vi.doUnmock('@supabase/supabase-js');
    vi.doUnmock('@/lib/email/resend');
    vi.resetModules();
  });

  it('notifyCreditsAdded lit users via supabaseAdmin, sans client cloud dédié', async () => {
    vi.resetModules();
    const single = vi.fn()
      .mockResolvedValueOnce({ data: { email: 'a@b.c' }, error: null })
      .mockResolvedValueOnce({ data: { name: 'A', credits: 10 }, error: null });
    const chaine = { select: () => chaine, eq: () => chaine, single };
    const from = vi.fn(() => chaine);
    const createClient = vi.fn();
    const sendEmailSilent = vi.fn(async () => undefined);
    vi.doMock('@/lib/db/supabase', () => ({ supabaseAdmin: { from } }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    vi.doMock('@/lib/email/resend', () => ({ sendEmailSilent }));

    const { notifyCreditsAdded } = await import('@/lib/email/notifications');
    await notifyCreditsAdded('u1', 5, 'bonus');

    expect(from).toHaveBeenCalledWith('users');
    expect(createClient).not.toHaveBeenCalled();
    expect(sendEmailSilent).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('lib/db/supabase — plus de client navigateur', () => {
  it('n exporte plus `supabase` (anon) ni ses helpers', async () => {
    const mod = await import('@/lib/db/supabase') as Record<string, unknown>;
    expect(mod.supabase).toBeUndefined();
    expect(mod.getUser).toBeUndefined();
    expect(mod.getUserCredits).toBeUndefined();
    expect(mod.updateUserCredits).toBeUndefined();
    expect(mod.supabaseAdmin).toBeDefined();
  });
});

describe('next.config.js — optimiseur d images', () => {
  it('n admet plus *.supabase.co, et garde ses autres réglages', () => {
    const require_ = createRequire(import.meta.url);
    const config = require_(join(process.cwd(), 'next.config.js'));
    const hotes = (config.images?.remotePatterns ?? []).map((p: { hostname: string }) => p.hostname);
    expect(hotes.some((h: string) => h.includes('supabase'))).toBe(false);
    expect(hotes).toContain('lh3.googleusercontent.com');
    expect(config.experimental.serverComponentsExternalPackages).toEqual(
      expect.arrayContaining(['minio', 'msedge-tts']),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────

function fichiersSource(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === '__tests__' || nom === 'node_modules') continue;
      out.push(...fichiersSource(chemin));
    } else if (/\.(ts|tsx|js|mjs)$/.test(nom)) {
      out.push(chemin);
    }
  }
  return out;
}

describe('garde — aucun litteral process.env.NEXT_PUBLIC_SUPABASE_*', () => {
  it('le code applicatif ne lit plus la variable figée au build', () => {
    const racine = resolve(process.cwd(), 'src');
    const fautifs = fichiersSource(racine).filter((f) => {
      const code = readFileSync(f, 'utf-8')
        // Les commentaires peuvent citer la variable ; seul le code compte.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return /process\.env\.NEXT_PUBLIC_SUPABASE_URL/.test(code);
    });
    // Seule exception tolérée : le repli de `supabaseAdmin` quand
    // `SUPABASE_URL` manque. En production `SUPABASE_URL` est posée (PostgREST)
    // et le repli ne vaut que `placeholder.supabase.co` ; il ne sert qu'au
    // développement local, dont `.env.example` ne liste que les
    // `NEXT_PUBLIC_*`. Le retirer casserait ces environnements (default safe).
    const TOLERES = ['lib/db/supabase.ts'];
    expect(fautifs.map((f) => f.slice(racine.length + 1)).filter((f) => !TOLERES.includes(f)))
      .toEqual([]);
  });
});
