/**
 * Les deux crons de l'Autopilote (`/api/cron/autopilot`, `/api/cron/autopilot-jumeau`)
 * rendent des vidéos, débitent des crédits et peuvent lancer des générations
 * D-ID payantes. `securite-cron-secret.test.ts` ne couvre que publish,
 * cleanup-media et cleanup-db ; les tests Autopilote existants n'exercent que
 * le chemin où le secret est bon.
 *
 * Invariant protégé ici : secret absent, en-tête absent ou Bearer faux → 401,
 * AVANT la moindre action (base, rendu, jumeau, crédits, email, réseau).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Chaque dépendance agissante est un espion : aucune ne doit être appelée. ──
const espions = vi.hoisted(() => ({ from: [] as string[], storage: 0, rpc: 0 }));

vi.mock('@/lib/db/supabase', () => {
  const chaine = (): any =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
        }
        return () => chaine();
      },
      apply() {
        return chaine();
      },
    });
  const client = {
    from: (t: string) => {
      espions.from.push(t);
      return chaine();
    },
    get storage() {
      espions.storage++;
      return chaine();
    },
    rpc: () => {
      espions.rpc++;
      return chaine();
    },
  };
  return { supabaseAdmin: client, supabase: client };
});

vi.mock('@/lib/autopilot/jumeau-async', () => ({
  finaliserJumeauxPrets: vi.fn(async () => ({ examines: 0, rendus: 0, encore: 0, echecs: 0 })),
  lancerJumeauMontage: vi.fn(),
  creneauxJumeauEnAttente: vi.fn(async () => new Set()),
}));
vi.mock('@/lib/autopilot/produire', () => ({
  produireUnMontage: vi.fn(),
  sujetsRecents: vi.fn(async () => []),
  creneauxExistants: vi.fn(async () => new Set()),
  COST_PER_VIDEO: 10,
}));
vi.mock('@/lib/credits/system', () => ({ getUserCredits: vi.fn(async () => 0) }));
vi.mock('@/lib/email/resend', () => ({ sendEmailSilent: vi.fn(), sendEmail: vi.fn() }));
vi.mock('@/lib/notifications/store', () => ({ notifyOnce: vi.fn(), NOTIFICATION_KINDS: {} }));

import { finaliserJumeauxPrets, lancerJumeauMontage } from '@/lib/autopilot/jumeau-async';
import { produireUnMontage } from '@/lib/autopilot/produire';
import { getUserCredits } from '@/lib/credits/system';
import { sendEmailSilent } from '@/lib/email/resend';
import { notifyOnce } from '@/lib/notifications/store';

const fetchEspion = vi.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  espions.from.length = 0;
  espions.storage = 0;
  espions.rpc = 0;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchEspion);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ROUTES = [
  { nom: '/api/cron/autopilot', charger: () => import('@/app/api/cron/autopilot/route') },
  { nom: '/api/cron/autopilot-jumeau', charger: () => import('@/app/api/cron/autopilot-jumeau/route') },
] as const;

function requete(nom: string, authorization?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new NextRequest(`http://localhost${nom}`, { headers });
}

function aucuneAction() {
  expect(espions.from).toEqual([]);
  expect(espions.storage).toBe(0);
  expect(espions.rpc).toBe(0);
  expect(finaliserJumeauxPrets).not.toHaveBeenCalled();
  expect(lancerJumeauMontage).not.toHaveBeenCalled();
  expect(produireUnMontage).not.toHaveBeenCalled();
  expect(getUserCredits).not.toHaveBeenCalled();
  expect(sendEmailSilent).not.toHaveBeenCalled();
  expect(notifyOnce).not.toHaveBeenCalled();
  expect(fetchEspion).not.toHaveBeenCalled();
}

async function attendre401(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
}

describe.each(ROUTES)('$nom — refus sans autorisation', ({ nom, charger }) => {
  it('CRON_SECRET absent → 401, même avec « Bearer undefined »', async () => {
    vi.stubEnv('CRON_SECRET', undefined as unknown as string);
    delete process.env.CRON_SECRET;
    const { GET } = await charger();

    await attendre401(await GET(requete(nom, 'Bearer undefined')));
    await attendre401(await GET(requete(nom, 'Bearer ')));
    aucuneAction();
  });

  it('en-tête Authorization absent → 401', async () => {
    vi.stubEnv('CRON_SECRET', 'secret-de-test');
    const { GET } = await charger();

    await attendre401(await GET(requete(nom)));
    aucuneAction();
  });

  it('Bearer incorrect → 401', async () => {
    vi.stubEnv('CRON_SECRET', 'secret-de-test');
    const { GET } = await charger();

    for (const faux of ['Bearer mauvais', 'Bearer secret-de-tes', 'bearer secret-de-test', 'secret-de-test', 'Basic secret-de-test']) {
      await attendre401(await GET(requete(nom, faux)));
    }
    aucuneAction();
  });
});

// Témoin : prouve que les espions voient bien une action quand le secret est bon
// (sinon les assertions « rien n'a été appelé » ci-dessus seraient vides de sens).
describe('/api/cron/autopilot-jumeau — témoin avec le bon secret', () => {
  it('Bearer exact → la finalisation (mockée) est appelée', async () => {
    vi.stubEnv('CRON_SECRET', 'secret-de-test');
    const { GET } = await import('@/app/api/cron/autopilot-jumeau/route');

    const res = await GET(requete('/api/cron/autopilot-jumeau', 'Bearer secret-de-test'));
    expect(res.status).toBe(200);
    expect(finaliserJumeauxPrets).toHaveBeenCalledTimes(1);
  });
});
