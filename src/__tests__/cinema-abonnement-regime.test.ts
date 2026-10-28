// @vitest-environment node
/**
 * CINEMA IA — QUI PAIE, decide cote serveur : regime, periode, devis du projet.
 * Abonnements FICTIFS uniquement ; aucune base, aucun fournisseur.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('aucune base dans ces tests'); } } }));

const { regimeCinema, evaluerQuota, abonnementsCinemaActifs, dureeProjetS, MESSAGE_PERIODE } = await import('@/lib/cinema/abonnement/regime');
const { devisProjet, quotaAbonne } = await import('@/lib/cinema/abonnement/devis');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO } = await import('@/lib/cinema/generation/replicate');
const { tarifGeneration } = await import('@/lib/cinema/generation/couts');
import type { FormuleCinema } from '@/lib/cinema/abonnement/formules';
import type { LigneAbonnement, SourcesRegime, RegimeCinema } from '@/lib/cinema/abonnement/regime';

const ON = { CINEMA_ABONNEMENTS: 'true' } as unknown as NodeJS.ProcessEnv;
const MAINTENANT = new Date('2026-11-15T10:00:00Z');

const formule = (planKey: string, o: Partial<FormuleCinema> = {}): FormuleCinema => ({
  planKey, inclus: true, filmsParMois: 30, secondesParMois: 1800, dureeMaxFilmS: 360,
  qualites: ['standard'], fonctionnalites: ['image_ia', 'animation_video'], budgetUsdParMois: 10,
  renouvellement: 'periode_abonnement', ...o,
});

function sources(o: {
  email?: string | null; admin?: boolean; abonnements?: LigneAbonnement[] | null;
  formules?: FormuleCinema[] | 'absente' | 'erreur';
} = {}): SourcesRegime {
  return {
    email: async () => (o.email === undefined ? 'client@test.local' : o.email),
    estAdmin: async (email) => o.admin === true && email === 'admin@studiio.pro',
    abonnements: async () => (o.abonnements === undefined ? [] : o.abonnements),
    formules: async () => {
      if (o.formules === 'absente') return { disponible: false, raison: 'migration_absente', message: 'x' };
      if (o.formules === 'erreur') return { disponible: false, raison: 'erreur', message: 'x' };
      return { disponible: true, formules: new Map((o.formules ?? []).map((f) => [f.planKey, f])), invalides: [] };
    },
  };
}
const regime = (o: Parameters<typeof sources>[0], env = ON) => regimeCinema('u1', { sources: sources(o), env, maintenant: MAINTENANT });
const PRO_ACTIF: LigneAbonnement = { plan: 'pro', status: 'active', current_period_end: '2026-12-03T08:00:00Z' };

describe('interrupteur : FERME par defaut, rien ne change', () => {
  it('sans CINEMA_ABONNEMENTS : credits, sans meme lire la base', async () => {
    const src = sources({ formules: [formule('pro')], abonnements: [PRO_ACTIF] });
    const espion = vi.spyOn(src, 'formules');
    expect(await regimeCinema('u1', { sources: src, env: {} as NodeJS.ProcessEnv })).toEqual({ type: 'credits' });
    expect(espion).not.toHaveBeenCalled();
    expect(abonnementsCinemaActifs({ CINEMA_ABONNEMENTS: 'oui' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('administrateur : reconnu par l’email EN BASE, jamais par le navigateur', () => {
  it('email admin relu en base : cout reel, meme sans aucune formule', async () => {
    expect(await regime({ email: 'admin@studiio.pro', admin: true })).toEqual({ type: 'cout_reel' });
  });
  it('email illisible : jamais admin par defaut', async () => {
    expect((await regime({ email: null, admin: true })).type).toBe('credits');
  });
});

describe('sans configuration : le paiement en credits d’aujourd’hui', () => {
  it('migration absente, aucune formule, ou formule non incluse : credits', async () => {
    expect(await regime({ formules: 'absente' })).toEqual({ type: 'credits' });
    expect(await regime({ formules: [] })).toEqual({ type: 'credits' });
    expect(await regime({ formules: [formule('pro', { inclus: false })], abonnements: [PRO_ACTIF] })).toEqual({ type: 'credits' });
    // Pro configure, mais le compte est Starter : sa formule a lui n'existe pas.
    expect(await regime({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, plan: 'starter' }] })).toEqual({ type: 'credits' });
  });

  it('etat INCONNU (base en erreur) : refus — jamais des credits pour ce qui est peut-etre inclus', async () => {
    expect((await regime({ formules: 'erreur' })).type).toBe('refus');
    expect((await regime({ formules: [formule('pro')], abonnements: null })).type).toBe('refus');
  });
});

describe('abonnement : la periode Stripe reelle, et seulement elle', () => {
  it('Pro actif, formule incluse : abonnement sur la periode Stripe', async () => {
    expect(await regime({ formules: [formule('pro')], abonnements: [PRO_ACTIF] })).toMatchObject({
      type: 'abonnement', planKey: 'pro',
      periode: { debut: '2026-11-03T08:00:00.000Z', fin: '2026-12-03T08:00:00.000Z' },
    });
  });

  it('essai gratuit (trialing) : droits ouverts ; paiement en echec (past_due) : non', async () => {
    expect((await regime({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, status: 'trialing' }] })).type).toBe('abonnement');
    expect((await regime({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, status: 'past_due' }] })).type).toBe('credits');
  });

  it('annule ou expire : retour a la formule gratuite (credits si elle n’inclut rien)', async () => {
    for (const status of ['canceled', 'expired', 'unpaid', 'incomplete']) {
      expect((await regime({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, status }] })).type, status).toBe('credits');
    }
  });

  it('changement de formule : la MEILLEURE ligne active compte, une ancienne annulee est ignoree', async () => {
    const r = await regime({
      formules: [formule('starter', { filmsParMois: 5 }), formule('pro')],
      abonnements: [{ plan: 'starter', status: 'canceled', current_period_end: '2026-11-20T00:00:00Z' }, PRO_ACTIF],
    });
    expect(r).toMatchObject({ type: 'abonnement', planKey: 'pro', formule: { filmsParMois: 30 } });
  });

  it('renouvellement pas encore recu (fin passee) : periode NON verifiable — aucun nouveau quota', async () => {
    const r = await regime({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, current_period_end: '2026-11-14T00:00:00Z' }] });
    expect(r).toMatchObject({ type: 'abonnement', periode: null });
  });

  it('renouvellement recu (nouvelle fin) : nouvelle periode, donc compteurs neufs', async () => {
    const avant = await regime({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, current_period_end: '2026-11-20T00:00:00Z' }] });
    const apres = await regimeCinema('u1', {
      sources: sources({ formules: [formule('pro')], abonnements: [{ ...PRO_ACTIF, current_period_end: '2026-12-20T00:00:00Z' }] }),
      env: ON, maintenant: new Date('2026-11-25T00:00:00Z'),
    });
    expect((avant as { periode: { debut: string } }).periode.debut).toBe('2026-10-20T00:00:00.000Z');
    expect((apres as { periode: { debut: string } }).periode.debut).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('evaluation d’une generation (lecture seule)', () => {
  const film = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde. Le jour se leve.', personnages: [], idFilm: 'f1', titre: 't' }), qualite: 'standard' as const };
  const reg = (o: Partial<Extract<RegimeCinema, { type: 'abonnement' }>> = {}) => ({
    type: 'abonnement' as const, planKey: 'pro', formule: formule('pro'),
    periode: { debut: '2026-11-03T08:00:00.000Z', fin: '2026-12-03T08:00:00.000Z' }, ...o,
  });
  const conso = (o = {}) => async () => ({ films: 2, secondes: 100, usdEngages: 1, tentatives: 4, film: { compte: false, secondes: 0 }, ...o });

  it('tient dans le quota : rend les limites et la duree du projet', async () => {
    const r = await evaluerQuota({ regime: reg(), userId: 'u1', film, operation: 'image', usdEstime: 0.003, lire: conso() });
    expect(r).toMatchObject({ ok: true, dureeFilmS: dureeProjetS(film), decision: { limites: { maxFilms: 30 } } });
  });

  it('periode non verifiable : refus explicite, la base n’est pas lue', async () => {
    const lire = vi.fn(conso());
    const r = await evaluerQuota({ regime: reg({ periode: null }), userId: 'u1', film, operation: 'image', usdEstime: 0.003, lire });
    expect(r).toEqual({ ok: false, message: MESSAGE_PERIODE, resume: null });
    expect(lire).not.toHaveBeenCalled();
  });

  it('compteurs illisibles : refus, jamais « compteur vide »', async () => {
    const r = await evaluerQuota({ regime: reg(), userId: 'u1', film, operation: 'image', usdEstime: 0.003, lire: async () => null });
    expect(r.ok).toBe(false);
  });

  it('qualite non incluse : refus avec le motif', async () => {
    const r = await evaluerQuota({ regime: reg(), userId: 'u1', film: { ...film, qualite: 'cinema' }, operation: 'image', usdEstime: 0.003, lire: conso() });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/qualite/) });
  });
});

describe('devis du projet', () => {
  const film = preparerFilm({ histoire: 'Nina entre. Marco la regarde. Le jour se leve.', personnages: [], idFilm: 'f2', titre: 't' });
  const plans = film.scenes.flatMap((s) => s.plans);
  const prixImage = tarifGeneration(ID_REPLICATE_IMAGE, 'image')!.usdParUnite!;

  it('distingue images manquantes et animations, avec leur cout fournisseur', () => {
    const d = devisProjet(film, ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO);
    expect(d.imagesManquantes).toBe(plans.length);
    expect(d.animationsPossibles).toBe(plans.length);
    expect(d.imagesUsd).toBeCloseTo(prixImage * plans.length, 6);
    expect(d.totalUsd).toBeCloseTo((d.imagesUsd ?? 0) + (d.animationsUsd ?? 0), 4);
  });

  it('un tarif inconnu rend un total INCONNU, jamais partiel', () => {
    expect(devisProjet(film, 'fournisseur-sans-tarif', ID_REPLICATE_VIDEO).totalUsd).toBeNull();
  });

  it('ce que voit l’abonne : films et minutes, couverture — aucun montant, aucun supplement', () => {
    const d = devisProjet(film, ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO);
    const q = quotaAbonne({
      formule: formule('pro'), film: { ...film, qualite: 'standard' }, devis: d, usdPremiereImage: prixImage,
      consommation: { films: 29, secondes: 1790, usdEngages: 9.999, tentatives: 50, film: { compte: false, secondes: 0 } },
    });
    expect(q).toMatchObject({ filmsUtilises: 29, filmsInclus: 30, secondesIncluses: 1800, supplement: null, budgetApprouve: null });
    // Budget restant 0,001 $ : les images du projet le depassent de loin — signale (> 1), sans dollars.
    expect(q.partBudgetProjet.images).toBeGreaterThan(1);
    // 10 s restantes : un nouveau film plus long est refuse, avec la raison.
    expect(q.disponible).toBe(false);
    expect(q.message).toMatch(/minutes incluses|budget/);
    expect(JSON.stringify(q)).not.toMatch(/Usd|usd/);
  });
});

describe('devis GLOBAL et approbation du budget du projet', async () => {
  const { approuverBudget, refusBudgetProjet, MESSAGE_BUDGET_NON_APPROUVE, MESSAGE_BUDGET_ATTEINT } = await import('@/lib/cinema/abonnement/devis');
  const film = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde. Le jour se leve. Nina sourit.', personnages: [], idFilm: 'f3', titre: 't' }), qualite: 'standard' as const };
  const plans = film.scenes.flatMap((s) => s.plans);
  const devis = devisProjet(film, ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO);
  const conso = { films: 0, secondes: 0, usdEngages: 0, tentatives: 0, film: { compte: false, secondes: 0 } };
  const abonnement = { formule: formule('pro'), consommation: conso, usdPremiereImage: tarifGeneration(ID_REPLICATE_IMAGE, 'image')!.usdParUnite };

  it('le devis porte scenes, plans, duree, qualite, modeles et prix unitaires', () => {
    expect(devis).toMatchObject({ scenes: film.scenes.length, plans: plans.length, qualite: 'standard', dejaEngageUsd: 0 });
    expect(devis.dureeProjetS).toBe(dureeProjetS(film));
    expect(devis.modeles).toEqual([
      { operation: 'image', fournisseurId: ID_REPLICATE_IMAGE, usdParUnite: tarifGeneration(ID_REPLICATE_IMAGE, 'image')!.usdParUnite },
      { operation: 'video', fournisseurId: ID_REPLICATE_VIDEO, usdParUnite: tarifGeneration(ID_REPLICATE_VIDEO, 'video')!.usdParUnite },
    ]);
    expect(devis.perimetres).toEqual({ images: devis.imagesUsd, complet: devis.totalUsd });
  });

  it('tarif inconnu : approbation REFUSEE, jamais un total partiel', () => {
    const d = devisProjet(film, ID_REPLICATE_IMAGE, 'fournisseur-sans-tarif');
    expect(approuverBudget({ regime: 'cout_reel', film, perimetre: 'complet', devis: d, plafondFilmUsd: 100 }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/tarif inconnu/) });
  });

  it('le cumul (deja engage + devis) ne depasse jamais le plafond par film', () => {
    const r = approuverBudget({ regime: 'cout_reel', film, perimetre: 'complet', devis, plafondFilmUsd: (devis.totalUsd as number) - 0.01 });
    expect(r.ok).toBe(false);
    const avecPasse = devisProjet({ ...film, coutGenerationUsd: 0.5 }, ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO);
    const ok = approuverBudget({ regime: 'cout_reel', film, perimetre: 'images', devis: avecPasse, plafondFilmUsd: 2 });
    expect(ok).toMatchObject({ ok: true, budget: { perimetre: 'images', devisUsd: avecPasse.imagesUsd } });
    if (ok.ok) expect(ok.budget.usd).toBeCloseTo(0.5 + (avecPasse.imagesUsd as number), 4);
  });

  it('abonne : refuse au-dela du budget restant de la formule, accepte en dessous', () => {
    const plein = { ...abonnement, consommation: { ...conso, usdEngages: 9.9999 } };
    expect(approuverBudget({ regime: 'abonnement', film, perimetre: 'images', devis, plafondFilmUsd: 2, abonnement: plein }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/budget de generation restant/) });
    expect(approuverBudget({ regime: 'abonnement', film, perimetre: 'images', devis, plafondFilmUsd: 2, abonnement }).ok).toBe(true);
  });

  it('abonne : refuse si le film ou les minutes ne sont plus disponibles', () => {
    const epuise = { ...abonnement, consommation: { ...conso, films: 30 } };
    expect(approuverBudget({ regime: 'abonnement', film, perimetre: 'images', devis, plafondFilmUsd: 2, abonnement: epuise }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/films inclus/) });
  });

  it('rien a generer : refuse', () => {
    const sansRien = { ...devis, perimetres: { images: 0, complet: 0 } };
    expect(approuverBudget({ regime: 'cout_reel', film, perimetre: 'images', devis: sansRien, plafondFilmUsd: 2 }).ok).toBe(false);
  });

  it('pendant la production : le budget approuve borne la depense CUMULEE', () => {
    const budget = { usd: 0.1, perimetre: 'images' as const, devisUsd: 0.1, approuveLe: 'x' };
    expect(refusBudgetProjet({ coutGenerationUsd: 0 }, 0.003)).toBe(MESSAGE_BUDGET_NON_APPROUVE);
    expect(refusBudgetProjet({ budgetApprouve: budget, coutGenerationUsd: 0.09 }, 0.003)).toBeNull();
    expect(refusBudgetProjet({ budgetApprouve: budget, coutGenerationUsd: 0.099 }, 0.003)).toBe(MESSAGE_BUDGET_ATTEINT);
  });
});
