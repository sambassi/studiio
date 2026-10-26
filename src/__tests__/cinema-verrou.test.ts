// @vitest-environment node
/**
 * CINEMA IA — le VERROU D'ACCES : ferme par defaut, un seul compte, page ET routes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }));
vi.mock('next/navigation', () => ({ notFound }));

import { accesCinemaAutorise, compteAutorise } from '@/lib/cinema/garde';
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

const MOI = 'abcdef01-1111-4111-8111-111111111111';
const AUTRE_ADMIN = '33333333-3333-4333-8333-333333333333';
const STANDARD = '22222222-2222-4222-8222-222222222222';
const EMAIL_ADMIN = 'contact.artboost@gmail.com';
const EMAIL_STANDARD = 'quelquun@example.org';

let avant: string | undefined;
beforeEach(() => { avant = process.env.CINEMA_COMPTE_AUTORISE; session.user = null; notFound.mockClear(); });
afterEach(() => { if (avant === undefined) delete process.env.CINEMA_COMPTE_AUTORISE; else process.env.CINEMA_COMPTE_AUTORISE = avant; });

const req = (m = 'GET') => new NextRequest('http://localhost/x', { method: m, body: m === 'GET' ? undefined : '{}', headers: { 'content-type': 'application/json' } });
const P = { params: { id: 'film-x', planId: 's1-p-1', travailId: '00000000-0000-4000-8000-000000000000', personnageId: 'perso-1' } } as never;

describe('verrou — la regle', () => {
  it('ferme par defaut : variable absente, vide, ou mal formee', () => {
    for (const v of [undefined, '', '   ', '../x', 'a/b', 'x'.repeat(80), '*']) {
      const env = { CINEMA_COMPTE_AUTORISE: v } as unknown as NodeJS.ProcessEnv;
      expect(compteAutorise(env)).toBeNull();
      expect(accesCinemaAutorise({ id: MOI, email: EMAIL_ADMIN }, env)).toBe(false);
    }
  });
  const env = { CINEMA_COMPTE_AUTORISE: MOI } as unknown as NodeJS.ProcessEnv;
  it('ouvre pour ce compte, administrateur, et personne d\'autre', () => {
    expect(accesCinemaAutorise({ id: MOI, email: EMAIL_ADMIN }, env)).toBe(true);
    expect(accesCinemaAutorise({ id: AUTRE_ADMIN, email: 'bassicustomshoes@gmail.com' }, env)).toBe(false);
    expect(accesCinemaAutorise({ id: STANDARD, email: EMAIL_STANDARD }, env)).toBe(false);
    // Le bon identifiant sans etre administrateur : refuse (les deux conditions).
    expect(accesCinemaAutorise({ id: MOI, email: EMAIL_STANDARD }, env)).toBe(false);
    expect(accesCinemaAutorise({ id: MOI.toUpperCase(), email: EMAIL_ADMIN }, env)).toBe(false);
    expect(accesCinemaAutorise({ id: MOI + ' ', email: EMAIL_ADMIN }, env)).toBe(false);
    expect(accesCinemaAutorise({ id: null, email: EMAIL_ADMIN }, env)).toBe(false);
    expect(accesCinemaAutorise(null, env)).toBe(false);
    expect(accesCinemaAutorise({ id: { toString: () => MOI } as never, email: EMAIL_ADMIN }, env)).toBe(false);
  });
  it('la variable n\'est jamais publique', () => {
    const src = readFileSync('src/lib/cinema/garde.ts', 'utf8');
    expect(src).not.toMatch(/NEXT_PUBLIC_CINEMA/);
    for (const f of ['src/app/dashboard/cinema/page.tsx']) expect(readFileSync(f, 'utf8')).not.toMatch(/CINEMA_COMPTE_AUTORISE/);
  });
});

describe('verrou — la page', () => {
  it('404 pour tous sauf le compte autorise (et 404 sans configuration)', async () => {
    session.user = { id: MOI, email: EMAIL_ADMIN };
    delete process.env.CINEMA_COMPTE_AUTORISE;
    await expect(CinemaLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND');
    process.env.CINEMA_COMPTE_AUTORISE = MOI;
    await expect(CinemaLayout({ children: 'ok' })).resolves.toBeTruthy();
    session.user = { id: AUTRE_ADMIN, email: 'bassicustomshoes@gmail.com' };
    await expect(CinemaLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND');
    session.user = { id: STANDARD, email: EMAIL_STANDARD };
    await expect(CinemaLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND');
    session.user = null;
    await expect(CinemaLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('verrou — TOUTES les routes API', () => {
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
  ];

  it('le balayage couvre chaque fichier route.ts du dossier', () => {
    const trouves: string[] = [];
    const marche = (d: string) => { for (const n of readdirSync(d)) { const c = path.join(d, n); statSync(c).isDirectory() ? marche(c) : n === 'route.ts' && trouves.push(c); } };
    marche('src/app/api/cinema');
    expect(trouves.length).toBe(13);
    for (const f of trouves) expect(readFileSync(f, 'utf8')).toMatch(/sessionCinema\(\)|sessionCinema\b/);
    // Autant de handlers appeles ci-dessus que de handlers exportes.
    const handlers = trouves.reduce((n, f) => n + (readFileSync(f, 'utf8').match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length, 0);
    expect(handlers).toBe(appels.length);
  });

  const cas: Array<[string, { id: string; email: string } | null, string | undefined, number[]]> = [
    ['sans configuration (compte ok)', { id: MOI, email: EMAIL_ADMIN }, undefined, [404]],
    ['un autre administrateur', { id: AUTRE_ADMIN, email: 'bassicustomshoes@gmail.com' }, MOI, [404]],
    ['un utilisateur standard', { id: STANDARD, email: EMAIL_STANDARD }, MOI, [404]],
    ['sans session', null, MOI, [401, 404]],
  ];
  for (const [nom, user, cfg, statuts] of cas) {
    it(`${nom} : aucune route ne repond autre chose que ${statuts.join('/')}`, async () => {
      session.user = user;
      if (cfg) process.env.CINEMA_COMPTE_AUTORISE = cfg; else delete process.env.CINEMA_COMPTE_AUTORISE;
      for (const [route, appel] of appels) {
        const r = await appel();
        expect(statuts, `${route} -> ${r.status}`).toContain(r.status);
        const corps = await r.text();
        expect(corps).not.toContain(MOI);
      }
    });
  }
});
