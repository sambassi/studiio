/**
 * MONTAGE AMÉLIORÉ — ACTIF par défaut pour tout utilisateur connecté.
 * Pas de session : éteint. Arrêt d'urgence (`STUDIIO_MONTAGE_AMELIORE_ENABLED=false`) : éteint pour tous.
 * Plus aucune liste de comptes : une variable `…_COMPTES` qui traînerait ne réserve ni n'éteint plus rien.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// ── Base simulée (compteExempteDeCredits relit users.role / users.email) ──────────
const base = vi.hoisted(() => ({ ligne: null as null | { role?: unknown; email?: unknown }, erreur: false }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (base.erreur ? { data: null, error: { message: 'down' } } : { data: base.ligne, error: null }) }) }) }) },
}));
const session = vi.hoisted(() => ({ id: undefined as string | undefined, boom: false }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => { if (session.boom) throw new Error('auth down'); return session.id ? { user: { id: session.id } } : null; } }));

const spy = vi.hoisted(() => ({ plans: [] as unknown[][] }));
vi.mock('@/lib/creer/smart-montage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/creer/smart-montage')>('@/lib/creer/smart-montage');
  return { ...actual, planMontage: (...a: unknown[]) => { spy.plans.push(a); return (actual.planMontage as (...x: unknown[]) => unknown)(...a); } };
});

import { montageAmelioreActifPourCompte, montageAmelioreServeurActif } from '@/lib/creer/montage-ameliore-config';
import { GET } from '@/app/api/creer/montage-ameliore/route';
import { preparerPlanMontage } from '@/lib/creer/preparer-plan-montage';
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';

/** Environnement de production : aucune variable — le montage amélioré est actif. */
const ACTIF: Record<string, string | undefined> = {};
beforeEach(() => { base.ligne = null; base.erreur = false; session.id = undefined; session.boom = false; spy.plans.length = 0; });

describe('décision serveur : actif par défaut, pour tous', () => {
  it('aucune variable : ACTIF pour tout utilisateur connecté, sans rôle ni identifiant particulier', async () => {
    base.ligne = { role: 'user', email: 'client@example.com' };
    expect(montageAmelioreServeurActif({})).toBe(true);
    expect(await montageAmelioreActifPourCompte('u2', { env: {} })).toBe(true);
    base.ligne = { role: 'admin', email: 'autre@x.fr' };
    expect(await montageAmelioreActifPourCompte('u1', { env: {} })).toBe(true);
    expect(await montageAmelioreActifPourCompte('nouvel-utilisateur-jamais-vu', { env: {} })).toBe(true);
    // La base des comptes n'est jamais lue pour cette décision.
    expect(await montageAmelioreActifPourCompte('u3', { env: { AUTRE: 'x' } })).toBe(true);
  });

  it('arrêt d’urgence : « false », « 0 », « off », « no », « non », casse et espaces indifférents ⇒ éteint pour TOUS', async () => {
    base.ligne = { role: 'admin', email: 'x@y.z' };
    for (const v of ['false', 'FALSE', ' false ', '0', 'off', 'OFF', 'no', 'non', 'No']) {
      const env = { STUDIIO_MONTAGE_AMELIORE_ENABLED: v };
      expect(montageAmelioreServeurActif(env)).toBe(false);
      expect(await montageAmelioreActifPourCompte('u1', { env })).toBe(false);
    }
  });

  it('toute autre valeur laisse le montage amélioré ACTIF (jamais éteint par accident)', async () => {
    for (const v of ['true', 'TRUE', '1', 'on', 'oui', '', '  ', 'nimporte']) {
      const env = { STUDIIO_MONTAGE_AMELIORE_ENABLED: v };
      expect(montageAmelioreServeurActif(env)).toBe(true);
      expect(await montageAmelioreActifPourCompte('u1', { env })).toBe(true);
    }
  });

  it('aucun utilisateur connu (identifiant absent ou vide) : éteint', async () => {
    expect(await montageAmelioreActifPourCompte(undefined, { env: {} })).toBe(false);
    expect(await montageAmelioreActifPourCompte(null, { env: {} })).toBe(false);
    expect(await montageAmelioreActifPourCompte('', { env: {} })).toBe(false);
  });

  it('plus de liste de comptes : une variable `…_COMPTES` résiduelle ne réserve rien et n’éteint rien', async () => {
    for (const liste of ['u1', '', 'autre-compte', ' , ,']) {
      const env = { STUDIIO_MONTAGE_AMELIORE_COMPTES: liste };
      expect(await montageAmelioreActifPourCompte('u1', { env })).toBe(true);
      expect(await montageAmelioreActifPourCompte('compte-non-liste', { env })).toBe(true);
    }
    expect(readFileSync('src/lib/creer/montage-ameliore-config.ts', 'utf8')).not.toMatch(/env\[?\.?STUDIIO_MONTAGE_AMELIORE_COMPTES/);
  });

  it('route : tout compte connecté reçoit { ameliore: true } ; l’arrêt d’urgence le passe à false', async () => {
    const on = process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED;
    try {
      delete process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED;
      session.id = 'u2';
      expect((await (await GET()).json())).toEqual({ ameliore: true });
      session.id = 'u1';
      expect((await (await GET()).json())).toEqual({ ameliore: true });
      process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED = 'false';
      expect((await (await GET()).json())).toEqual({ ameliore: false });
    } finally {
      if (on === undefined) delete process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED; else process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED = on;
    }
  });
});

describe('route /api/creer/montage-ameliore', () => {
  const lire = async () => { const r = await GET(); return { corps: await r.json(), cache: r.headers.get('Cache-Control') }; };
  it('sans session ou panne d\'auth : { ameliore: false } ; connecté : true, jamais en cache ; arrêt d\'urgence : false', async () => {
    const env = process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED;
    try {
      delete process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED;
      expect((await lire()).corps).toEqual({ ameliore: false }); // pas de session
      session.id = 'u2'; session.boom = true;
      expect((await lire()).corps).toEqual({ ameliore: false }); // erreur d'auth
      session.boom = false;
      const r = await lire();
      expect(r.corps).toEqual({ ameliore: true }); // utilisateur connecté, aucune variable
      expect(r.cache).toBe('private, no-store');
      process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED = 'false';
      expect((await lire()).corps).toEqual({ ameliore: false }); // arrêt d'urgence
    } finally { if (env === undefined) delete process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED; else process.env.STUDIIO_MONTAGE_AMELIORE_ENABLED = env; }
  });
});

// ── Créer : le plan automatique ────────────────────────────────────────────
function rush(url: string, duree: number, nettete: number): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 1) echantillons.push({ t, mouvement: 0.1, luminosite: 0.5, nettete, audio: 0.02, empreinte: Array.from({ length: 64 }, (_, i) => ((i * 7 + t * 13 + url.length * 31) % 100) / 100) });
  return { url, duree, echantillons, pisteAudio: true };
}
const entree = (urls: string[]) => ({
  rushs: urls.map((url) => ({ url })), cibleEcran: 30, debutVideo: 0, methode: 'A', contexte: { theme: null, titre: null, sousTitre: null, objectif: null, cartes: [] },
}) as unknown as Parameters<typeof preparerPlanMontage>[0];

describe('Créer — plan automatique (le drapeau `ameliore` reste explicite côté moteur)', () => {
  const NET = rush('https://x/n.mp4', 3, 0.7);
  const FLOU = rush('https://x/f.mp4', 40, 0.1);
  const NET2 = rush('https://x/n2.mp4', 40, 0.7);
  it('standard : options du moteur EXACTEMENT celles de la production (ni netteteCommune ni protectionParole)', () => {
    for (const acquis of [{}, { ameliore: false }]) {
      spy.plans.length = 0;
      preparerPlanMontage(entree([NET.url, FLOU.url]), { analysesBrutes: [NET, FLOU], rythme: null, ...acquis });
      const options = spy.plans[0][2] as Record<string, unknown>;
      expect(Object.keys(options).sort()).toEqual(['contexte', 'rushApres', 'rythme', 'uniciteParTimecode']);
    }
  });
  it('standard : rush flou NON écarté, aucun avertissement ajouté en plan vide', () => {
    const p = preparerPlanMontage(entree([NET.url, FLOU.url]), { analysesBrutes: [NET, FLOU], rythme: null });
    expect(p.plan).not.toBeNull(); // production : le flou est monté
    expect(p.plan!.some((s) => s.url === FLOU.url)).toBe(true);
    expect(p.raccourci?.message ?? '').not.toContain('flou');
  });
  it('montage amélioré : exclusion des flous, protection de la parole, avertissement de durée', () => {
    spy.plans.length = 0;
    const p = preparerPlanMontage(entree([NET.url, FLOU.url]), { analysesBrutes: [NET, FLOU], rythme: null, ameliore: true });
    expect(spy.plans[0][2]).toMatchObject({ netteteCommune: true, protectionParole: true });
    expect(p.plan).toBeNull();
    expect(p.raccourci?.message).toContain('1 rush trop flou écarté');
    const ok = preparerPlanMontage(entree([NET2.url, FLOU.url]), { analysesBrutes: [NET2, FLOU], rythme: null, ameliore: true });
    expect((ok.plan ?? []).some((s) => s.url === FLOU.url)).toBe(false);
  });
  it('un plan calculé sans le montage amélioré n’est pas rejoué avec lui (et inversement)', () => {
    const e = entree([NET2.url, FLOU.url]);
    const a = { analysesBrutes: [NET2, FLOU], rythme: null };
    const standard = preparerPlanMontage(e, a);
    expect(preparerPlanMontage(e, { ...a, ameliore: true }, standard).reutilise).toBe(false);
    expect(preparerPlanMontage(e, a, standard).reutilise).toBe(true);
    const admin = preparerPlanMontage(e, { ...a, ameliore: true });
    expect(preparerPlanMontage(e, a, admin).reutilise).toBe(false);
  });
  it('la méthode B n’est pas concernée', () => {
    spy.plans.length = 0;
    preparerPlanMontage({ ...entree([NET2.url, FLOU.url]), methode: 'B' } as never, { analysesBrutes: [NET2, FLOU], rythme: null, ameliore: true });
    expect(spy.plans[0][2]).not.toHaveProperty('netteteCommune');
    expect(spy.plans[0][2]).not.toHaveProperty('protectionParole');
  });
});

// ── Traitements serveur et navigateur : la décision vient du serveur ────────
const src = (p: string) => readFileSync(p, 'utf8');
describe('garde de câblage', () => {
  const produire = src('src/lib/autopilot/produire.ts');
  it('Autopilote : une décision par montage, relue en base, appliquée aux trois appels du moteur, au repli et au contrôle MP4', () => {
    expect(produire).toContain('const ameliore = await montageAmelioreActifPourCompte(userId);');
    expect(produire.match(/\.\.\.\(ameliore \? \{ netteteCommune: true, protectionParole: protectionParoleRushs \} : \{\}\)/g)?.length).toBe(3);
    expect(produire).toContain('if (ameliore && !planMontageRushs && !multiSources && !jumeauActif && rushUrl) {');
    expect(produire).toContain('controleMp4Actif: ameliore');
    expect(produire).not.toMatch(/netteteCommune: true,\n/);
  });
  it('rendu Autopilote : aucun contrôle sans autorisation explicite', () => {
    const r = src('src/lib/autopilot/render.ts');
    expect(r).toContain('if (input.controleMp4Actif === true) {');
  });
  it('MP4 durable de Créer : contrôle seulement pour un compte autorisé, décidé par le serveur', () => {
    expect(src('src/lib/rendus/mp4-durable-serveur.ts')).toContain('if (await montageAmelioreActifPourCompte(userId)) {');
  });
  it('navigateur : la décision vient de la route serveur ; aucun réglage local ne l’active', () => {
    const w = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(w).toContain("fetch('/api/creer/montage-ameliore'");
    expect(w).toContain('ameliore: ameliorePlan');
    expect(w).toContain('const flous = ameliorePlan ? rushsNettementFlous(analyses) : new Set<string>();');
    expect(w).not.toMatch(/localStorage[^;\n]*ameliore|searchParams[^;\n]*ameliore|NEXT_PUBLIC_STUDIIO_MONTAGE_AMELIORE/i);
  });
  it('multi-sources : aucun défaut amélioré', () => {
    expect(src('src/lib/autopilot/plan-multi-sources.ts')).not.toMatch(/netteteCommune|protectionParole/);
  });
  it('aucune fonction payante : pas de fournisseur, pas de crédit dans la décision ; fiches de scènes éteintes', () => {
    const c = src('src/lib/creer/montage-ameliore-config.ts') + src('src/app/api/creer/montage-ameliore/route.ts');
    expect(c).not.toMatch(/anthropic|groq|stripe|credit_transactions|debit/i);
    expect(src('src/lib/creer/fiche-scenes.ts')).toContain('export const FICHE_SCENES_ACTIVE = false;');
  });
});
