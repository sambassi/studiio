// @vitest-environment node
/**
 * CINEMA IA — l'INTERRUPTEUR GENERAL : eteint par defaut, ouvert a tout utilisateur authentifie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }));
vi.mock('next/navigation', () => ({ notFound }));

import { accesCinemaAutorise, cinemaActive } from '@/lib/cinema/garde';
import CinemaLayout from '@/app/dashboard/cinema/layout';
import * as filmsRoute from '@/app/api/cinema/films/route';
import * as filmRoute from '@/app/api/cinema/films/[id]/route';
import * as produireRoute from '@/app/api/cinema/films/[id]/produire/route';
import * as travauxRoute from '@/app/api/cinema/films/[id]/travaux/route';
import * as travailRoute from '@/app/api/cinema/films/[id]/travaux/[travailId]/route';
import * as annulerRoute from '@/app/api/cinema/films/[id]/travaux/[travailId]/annuler/route';
import * as exportRoute from '@/app/api/cinema/films/[id]/travaux/[travailId]/export/route';
import * as mediasRoute from '@/app/api/cinema/films/[id]/medias/route';
import * as mediaPlanRoute from '@/app/api/cinema/films/[id]/medias/[planId]/route';
import * as voixRoute from '@/app/api/cinema/films/[id]/voix/[planId]/route';
import * as refsRoute from '@/app/api/cinema/films/[id]/references/route';
import * as refPersoRoute from '@/app/api/cinema/films/[id]/references/[personnageId]/route';
import * as generationRoute from '@/app/api/cinema/films/[id]/generation/route';
import * as quotaRoute from '@/app/api/cinema/films/[id]/quota/route';

const USER = { id: 'abcdef01-1111-4111-8111-111111111111', email: 'quelquun@example.org' };
const env = (v?: string) => ({ CINEMA_ACTIVE: v }) as unknown as NodeJS.ProcessEnv;

let avant: string | undefined;
beforeEach(() => { avant = process.env.CINEMA_ACTIVE; session.user = null; notFound.mockClear(); });
afterEach(() => { if (avant === undefined) delete process.env.CINEMA_ACTIVE; else process.env.CINEMA_ACTIVE = avant; });

const req = (m = 'GET') => new NextRequest('http://localhost/x', { method: m, body: m === 'GET' ? undefined : '{}', headers: { 'content-type': 'application/json' } });
const P = { params: { id: 'film-x', planId: 's1-p-1', travailId: '00000000-0000-4000-8000-000000000000', personnageId: 'perso-1' } } as never;

describe('interrupteur — la regle', () => {
  it('eteint par defaut : seules « true » et « 1 » l\'allument', () => {
    for (const v of [undefined, '', ' ', 'false', '0', 'yes', 'on', 'truee', '*']) expect(cinemaActive(env(v)), String(v)).toBe(false);
    for (const v of ['true', 'TRUE', ' true ', '1']) expect(cinemaActive(env(v)), v).toBe(true);
  });
  it('allume : tout utilisateur authentifie (pas de role), mais ni anonyme ni identifiant douteux', () => {
    expect(accesCinemaAutorise(USER, env('true'))).toBe(true);
    expect(accesCinemaAutorise({ id: '22222222-2222-4222-8222-222222222222' }, env('true'))).toBe(true);
    for (const u of [null, undefined, {}, { id: null }, { id: '' }, { id: '../x' }, { id: 'a/b' }]) expect(accesCinemaAutorise(u as never, env('true'))).toBe(false);
    expect(accesCinemaAutorise(USER, env(undefined))).toBe(false);
  });
  it('la variable est serveur et n\'est lue par aucune page', () => {
    expect(readFileSync('src/lib/cinema/garde.ts', 'utf8')).not.toMatch(/NEXT_PUBLIC_CINEMA/);
    expect(readFileSync('src/app/dashboard/cinema/page.tsx', 'utf8')).not.toMatch(/CINEMA_ACTIVE/);
  });
  it('l\'ancienne restriction a un compte est supprimee du code', () => {
    // UNE exception, et une seule : `abonnement/regime.ts` reconnait l'administrateur pour
    // sa FACTURATION (cout fournisseur reel, sans credit). L'ACCES a Cinema, lui, ne depend
    // jamais d'un compte admin — c'est ce que cette regle protege.
    const EXCEPTION_FACTURATION = path.join('src/lib/cinema/abonnement/regime.ts');
    const lire = (d: string): Array<[string, string]> => readdirSync(d).flatMap((n) => {
      const c = path.join(d, n);
      return statSync(c).isDirectory() ? lire(c) : /\.(ts|tsx)$/.test(n) ? [[c, readFileSync(c, 'utf8')] as [string, string]] : [];
    });
    const sources = [...lire('src/lib/cinema'), ...lire('src/app/api/cinema'), ...lire('src/app/dashboard/cinema')];
    expect(sources.length).toBeGreaterThan(10);
    for (const [chemin, src] of sources) {
      expect(src, chemin).not.toMatch(/CINEMA_COMPTE_AUTORISE/);
      if (chemin !== EXCEPTION_FACTURATION) expect(src, chemin).not.toMatch(/isAdmin/);
    }
    // Jamais dans les fichiers qui decident de l'ACCES.
    for (const f of ['src/lib/cinema/acces.ts', 'src/lib/cinema/garde.ts', 'src/lib/cinema/routes-aide.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/isAdmin|abonnement\/regime/);
    }
  });
});

describe('interrupteur — la page', () => {
  it('404 tant que le module est eteint ; allume, tout utilisateur connecte entre, pas l\'anonyme', async () => {
    session.user = USER;
    delete process.env.CINEMA_ACTIVE;
    await expect(CinemaLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND');
    process.env.CINEMA_ACTIVE = 'true';
    await expect(CinemaLayout({ children: 'ok' })).resolves.toBeTruthy();
    session.user = null;
    await expect(CinemaLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('interrupteur — TOUTES les routes API', () => {
  const appels: Array<[string, () => Promise<Response>]> = [
    ['films GET', () => filmsRoute.GET()],
    ['films POST', () => filmsRoute.POST(req('POST'))],
    ['film GET', () => filmRoute.GET(req(), P)],
    ['film PATCH', () => filmRoute.PATCH(req('PATCH'), P)],
    ['film DELETE', () => filmRoute.DELETE(req('DELETE'), P)],
    ['produire POST', () => produireRoute.POST(req('POST'), P)],
    ['travaux GET', () => travauxRoute.GET(req(), P)],
    ['travail GET', () => travailRoute.GET(req(), P)],
    ['annuler POST', () => annulerRoute.POST(req('POST'), P)],
    ['export GET', () => exportRoute.GET(req(), P)],
    ['medias POST', () => mediasRoute.POST(req('POST'), P)],
    ['media GET', () => mediaPlanRoute.GET(req(), P)],
    ['voix GET', () => voixRoute.GET(req(), P)],
    ['references POST', () => refsRoute.POST(req('POST'), P)],
    ['reference GET', () => refPersoRoute.GET(req(), P)],
    ['generation POST', () => generationRoute.POST(req('POST'), P)],
    ['quota GET', () => quotaRoute.GET(req(), P)],
    ['quota POST', () => quotaRoute.POST(req('POST'), P)],
  ];

  it('le balayage couvre chaque route.ts : 14 fichiers, 18 handlers, tous derriere sessionCinema', () => {
    const trouves: string[] = [];
    const marche = (d: string) => { for (const n of readdirSync(d)) { const c = path.join(d, n); statSync(c).isDirectory() ? marche(c) : n === 'route.ts' && trouves.push(c); } };
    marche('src/app/api/cinema');
    expect(trouves.length).toBe(14);
    for (const f of trouves) expect(readFileSync(f, 'utf8')).toMatch(/sessionCinema\b/);
    const handlers = trouves.reduce((n, f) => n + (readFileSync(f, 'utf8').match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length, 0);
    expect(handlers).toBe(appels.length);
  });

  it('module eteint : TOUTES les routes repondent 404, meme connecte', async () => {
    session.user = USER;
    delete process.env.CINEMA_ACTIVE;
    for (const [route, appel] of appels) expect((await appel()).status, route).toBe(404);
    process.env.CINEMA_ACTIVE = 'false';
    for (const [route, appel] of appels) expect((await appel()).status, route).toBe(404);
  });

  it('module allume, sans session : jamais de donnees (401, ou 404 pour les fichiers)', async () => {
    process.env.CINEMA_ACTIVE = 'true';
    session.user = null;
    for (const [route, appel] of appels) {
      const r = await appel();
      expect([401, 404], `${route} -> ${r.status}`).toContain(r.status);
    }
  });

  it('module allume, utilisateur standard (aucun role) : pas de 401/403 — la requete est traitee', async () => {
    process.env.CINEMA_ACTIVE = 'true';
    session.user = USER;
    const r = await filmsRoute.GET();
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });
});
