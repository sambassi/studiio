import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

/**
 * /api/admin/** — non-regression du controle d'acces administrateur.
 *
 * Chaque gestionnaire exporte sous `src/app/api/admin` est APPELE (jamais
 * grepé : voir tasks/lessons.md, « Sur un chemin de securite, grepper le
 * source ne prouve rien ») avec :
 *   - aucune session            → 401 (ou 403 pour les routes a garde inline) ;
 *   - une session non admin     → 403 ;
 *   - une session sans e-mail   → 403.
 *
 * Seule la session NextAuth est simulee : `requireAdmin` et `isAdmin` restent
 * les vrais, pour prouver que chaque route est reellement branchee dessus.
 *
 * Temoins de fuite : la base, Stripe, l'envoi d'e-mail, les credits, la
 * publication et les alertes de service sont remplaces par des espions. Un
 * refus qui les aurait touches — ou qui aurait lu le corps de la requete —
 * fait echouer le test.
 *
 * Un inventaire du disque garantit qu'une nouvelle route admin ne peut pas
 * etre ajoutee sans entrer dans ce tableau.
 */

const authMock = vi.fn();

// ── Espions de effets de bord ────────────────────────────────────────
const sideEffects: string[] = [];

/** Objet chainable qui enregistre tout acces et se resout sur un resultat vide. */
function recorder(label: string, thenable = false): unknown {
  return new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === 'then') {
        return thenable
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: null, count: 0 })
          : undefined;
      }
      const path = `${label}.${String(prop)}`;
      sideEffects.push(path);
      return recorder(path, true);
    },
    apply() {
      return recorder(label, true);
    },
  });
}

const spyModule = (label: string, names: string[]) =>
  Object.fromEntries(
    names.map((n) => [n, vi.fn((..._args: unknown[]) => { sideEffects.push(`${label}.${n}`); return undefined; })]),
  );

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock(), DEV_AUTH_BYPASS: false }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: recorder('supabaseAdmin'),
  supabase: recorder('supabase'),
}));
vi.mock('@/lib/stripe/client', () => ({ stripe: recorder('stripe') }));
vi.mock('@/lib/email/resend', () => spyModule('resend', ['sendEmail']));
vi.mock('@/lib/credits/system', () => spyModule('credits', ['addCredits', 'deductCredits']));
vi.mock('@/lib/pricing/fetch', () => spyModule('pricing', ['invalidatePricingCache']));
vi.mock('@/lib/social/publishing', () =>
  spyModule('publishing', ['publicationOuverte', 'definirPublicationOuverte']),
);
vi.mock('@/lib/service-alerts', () =>
  spyModule('serviceAlerts', ['getActiveAlerts', 'getAllAlerts', 'dismissServiceAlert', 'dismissServiceAlerts']),
);

// ── Inventaire des gestionnaires ─────────────────────────────────────
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Handler = (req: unknown, ctx?: unknown) => Promise<Response>;

/**
 * Statut attendu sans session. `requireAdmin` renvoie 401 ; les routes qui
 * recopient la liste des administrateurs en ligne (pricing/*, feature-flags)
 * refusent en 403 des l'absence d'e-mail. Les deux sont des refus valides :
 * figer la valeur actuelle rend visible tout changement de garde.
 */
interface Case {
  route: string; // chemin relatif a src/app/api/admin, sans /route.ts
  method: Method;
  anonymous: 401 | 403;
  load: () => Promise<Record<string, unknown>>;
}

const R = (route: string, method: Method, anonymous: 401 | 403, load: Case['load']): Case => ({
  route, method, anonymous, load,
});

const CASES: Case[] = [
  R('cleanup-duplicates', 'GET', 401, () => import('@/app/api/admin/cleanup-duplicates/route')),
  R('cleanup-orphans', 'POST', 401, () => import('@/app/api/admin/cleanup-orphans/route')),
  R('email/test', 'POST', 401, () => import('@/app/api/admin/email/test/route')),
  R('landing', 'PATCH', 401, () => import('@/app/api/admin/landing/route')),
  R('logs', 'GET', 401, () => import('@/app/api/admin/logs/route')),
  R('notifications', 'GET', 401, () => import('@/app/api/admin/notifications/route')),
  R('notifications', 'PATCH', 401, () => import('@/app/api/admin/notifications/route')),
  R('payments/export', 'GET', 401, () => import('@/app/api/admin/payments/export/route')),
  R('payments', 'GET', 401, () => import('@/app/api/admin/payments/route')),
  R('pricing/seed', 'POST', 403, () => import('@/app/api/admin/pricing/seed/route')),
  R('pricing/update-pack', 'POST', 403, () => import('@/app/api/admin/pricing/update-pack/route')),
  R('pricing/update-plan', 'POST', 403, () => import('@/app/api/admin/pricing/update-plan/route')),
  R('publishing', 'GET', 401, () => import('@/app/api/admin/publishing/route')),
  R('publishing', 'PATCH', 401, () => import('@/app/api/admin/publishing/route')),
  R('service-health', 'GET', 401, () => import('@/app/api/admin/service-health/route')),
  R('service-health', 'POST', 401, () => import('@/app/api/admin/service-health/route')),
  R('settings/feature-flags', 'POST', 403, () => import('@/app/api/admin/settings/feature-flags/route')),
  R('settings', 'GET', 401, () => import('@/app/api/admin/settings/route')),
  R('settings', 'PATCH', 401, () => import('@/app/api/admin/settings/route')),
  R('stats/activity', 'GET', 401, () => import('@/app/api/admin/stats/activity/route')),
  R('stats/revenue', 'GET', 401, () => import('@/app/api/admin/stats/revenue/route')),
  R('stats', 'GET', 401, () => import('@/app/api/admin/stats/route')),
  R('subscriptions', 'GET', 401, () => import('@/app/api/admin/subscriptions/route')),
  R('subscriptions', 'PATCH', 401, () => import('@/app/api/admin/subscriptions/route')),
  R('terms', 'GET', 401, () => import('@/app/api/admin/terms/route')),
  R('terms', 'PATCH', 401, () => import('@/app/api/admin/terms/route')),
  R('users/[id]/ban', 'POST', 401, () => import('@/app/api/admin/users/[id]/ban/route')),
  R('users/[id]/ban', 'DELETE', 401, () => import('@/app/api/admin/users/[id]/ban/route')),
  R('users/[id]/credits', 'POST', 401, () => import('@/app/api/admin/users/[id]/credits/route')),
  R('users/[id]', 'GET', 401, () => import('@/app/api/admin/users/[id]/route')),
  R('users/[id]', 'PATCH', 401, () => import('@/app/api/admin/users/[id]/route')),
  R('users/[id]', 'DELETE', 401, () => import('@/app/api/admin/users/[id]/route')),
  R('users', 'GET', 401, () => import('@/app/api/admin/users/route')),
  R('users', 'PATCH', 401, () => import('@/app/api/admin/users/route')),
  R('videos', 'GET', 401, () => import('@/app/api/admin/videos/route')),
  R('videos', 'DELETE', 401, () => import('@/app/api/admin/videos/route')),
];

/**
 * Gestionnaires sous /api/admin qui NE sont PAS proteges aujourd'hui.
 * Signales dans le rapport, non corriges (hors perimetre T1-02).
 *
 * - GET /api/admin/landing : aucune garde. Il est appele sans session par la
 *   page d'accueil (src/app/page.tsx) et l'inscription (src/app/auth/signup),
 *   donc public par usage — mais il vit sous le prefixe admin.
 */
const KNOWN_OPEN: Array<{ route: string; method: Method; load: Case['load'] }> = [
  { route: 'landing', method: 'GET', load: () => import('@/app/api/admin/landing/route') },
];

// ── Requete factice ──────────────────────────────────────────────────
const ADMIN_EMAIL = 'contact.artboost@gmail.com';

const asAnonymous = () => authMock.mockResolvedValue(null);
const asUser = () =>
  authMock.mockResolvedValue({ user: { id: 'user-1', email: 'quelquun@exemple.test' } });
const asUserWithoutEmail = () => authMock.mockResolvedValue({ user: { id: 'user-1' } });

function makeRequest(method: Method) {
  const url = 'https://studiio.test/api/admin/x?id=video-1&limit=50&dryRun=false&all=true';
  const body = {
    id: 'user-9', key: 'k', value: true, enabled: true, amount: 100, reason: 'x',
    to: 'cible@exemple.test', subject: 's', html: '<p>x</p>', role: 'admin', is_admin: true,
    email: ADMIN_EMAIL,
  };
  const json = vi.fn(async () => body);
  const text = vi.fn(async () => JSON.stringify(body));
  const req = {
    method,
    url,
    nextUrl: new URL(url),
    headers: new Headers({
      'content-type': 'application/json',
      'x-admin': 'true',
      'x-user-email': ADMIN_EMAIL,
      authorization: 'Bearer admin',
    }),
    json,
    text,
  };
  return { req, bodyRead: () => json.mock.calls.length + text.mock.calls.length };
}

const ctx = { params: { id: 'user-9' } };

async function call(c: { route: string; method: Method; load: Case['load'] }) {
  const mod = await c.load();
  const handler = mod[c.method] as Handler | undefined;
  expect(handler, `${c.method} ${c.route} n'est pas exporte`).toBeTypeOf('function');
  const { req, bodyRead } = makeRequest(c.method);
  const res = await handler!(req, ctx);
  let text = '';
  try { text = await res.text(); } catch { /* corps absent */ }
  return { status: res.status, text, bodyRead: bodyRead() };
}

beforeEach(() => {
  authMock.mockReset();
  sideEffects.length = 0;
});

const label = (c: { route: string; method: Method }) => `${c.method} /api/admin/${c.route}`;

// ═══════════════════════════════════════════════════════════════════
describe('inventaire — chaque gestionnaire admin est couvert', () => {
  const root = resolve(__dirname, '../app/api/admin');

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /^route\.(ts|tsx|js)$/.test(name) ? [full] : [];
    });
  }

  it('le tableau des cas correspond exactement aux exports HTTP sur le disque', () => {
    const onDisk = walk(root)
      .flatMap((file) => {
        const route = relative(root, file).split(sep).slice(0, -1).join('/');
        const src = readFileSync(file, 'utf-8');
        const methods = [...src.matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/gm)]
          .map((m) => m[1]);
        const reexports = [...src.matchAll(/^export\s+(?:const|\{)[^\n]*\b(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/gm)]
          .map((m) => m[1]);
        return [...methods, ...reexports].map((m) => `${m} ${route}`);
      })
      .sort();
    const covered = [...CASES, ...KNOWN_OPEN].map((c) => `${c.method} ${c.route}`).sort();
    expect(covered).toEqual(onDisk);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe.each(CASES)('$method /api/admin/$route', (c) => {
  it(`sans session : ${c.anonymous}, sans effet de bord`, async () => {
    asAnonymous();
    const r = await call(c);
    expect(r.status, label(c)).toBe(c.anonymous);
    expect(sideEffects, label(c)).toEqual([]);
    expect(r.bodyRead, `${label(c)} a lu le corps avant de refuser`).toBe(0);
  });

  it('session non administrateur : 403, sans effet de bord', async () => {
    asUser();
    const r = await call(c);
    expect(r.status, label(c)).toBe(403);
    expect(sideEffects, label(c)).toEqual([]);
    expect(r.bodyRead, `${label(c)} a lu le corps avant de refuser`).toBe(0);
    // Le corps et les en-tetes clament « admin » : ils ne font pas autorite.
    expect(r.text).not.toContain('user-9');
  });

  it('session sans e-mail : 403', async () => {
    asUserWithoutEmail();
    const r = await call(c);
    expect(r.status, label(c)).toBe(403);
    expect(sideEffects, label(c)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('routes admin ouvertes connues (signalees, non corrigees)', () => {
  it.each(KNOWN_OPEN)('$method /api/admin/$route repond sans session (ni 401 ni 403)', async (c) => {
    // Si ce test echoue parce que la route renvoie desormais 401/403, la
    // retirer de KNOWN_OPEN et l'ajouter a CASES.
    asAnonymous();
    const r = await call(c);
    expect([401, 403]).not.toContain(r.status);
    // Lecture seule : aucune ecriture en base declenchee par un anonyme.
    expect(sideEffects.filter((s) => /\.(insert|update|upsert|delete|rpc)$/.test(s))).toEqual([]);
  });
});
