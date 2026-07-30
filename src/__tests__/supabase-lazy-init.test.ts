import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Le build ne doit jamais dependre des cles Supabase.
 *
 * `next build` charge tous les modules serveur pendant l'etape « Collecting
 * page data ». Si un module construit son client Supabase AU CHARGEMENT,
 * `createClient('')` leve « supabaseUrl is required » et le build entier
 * echoue — sans qu'aucune requete n'ait ete faite. C'est ce qui cassait le
 * build des worktrees (pas de `.env.local`), sur `/api/admin/*` notamment.
 *
 * Ces tests verrouillent le contrat : importer ces modules sans aucune cle
 * Supabase ne doit RIEN lever. L'erreur ne doit apparaitre qu'a la premiere
 * utilisation reelle du client.
 */

const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Le setup global (`src/__tests__/setup.ts`) injecte des cles factices :
  // on les retire pour reproduire l'environnement d'un build sans secrets.
  for (const key of SUPABASE_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of SUPABASE_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

describe('Initialisation paresseuse des clients Supabase', () => {
  it('importe lib/db/supabase sans cle de service, sans lever', async () => {
    await expect(import('@/lib/db/supabase')).resolves.toBeDefined();
  });

  it('importe lib/email/notifications sans cle de service, sans lever', async () => {
    // Atteint depuis lib/auth/config.ts, donc depuis presque toutes les routes.
    await expect(import('@/lib/email/notifications')).resolves.toBeDefined();
  });

  it('leve un message clair seulement a la premiere utilisation de supabaseAdmin', async () => {
    const { supabaseAdmin } = await import('@/lib/db/supabase');
    expect(() => supabaseAdmin.from('users')).toThrow(/SUPABASE_SERVICE_KEY/);
  });

  it('construit bien le client quand les cles sont presentes', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

    const { supabaseAdmin } = await import('@/lib/db/supabase');
    expect(typeof supabaseAdmin.from).toBe('function');
  });
});
