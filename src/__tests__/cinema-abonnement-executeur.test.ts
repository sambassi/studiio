// @vitest-environment node
/**
 * CINEMA IA — L'EXECUTEUR DES GENERATIONS face aux trois regimes de facturation.
 *
 * L'executeur tourne pour de vrai (depot de films en memoire, suivi, ecritures gardees).
 * Seules les FRONTIERES sont simulees : le fournisseur (via l'atelier), les credits, le
 * plafond de depense, le quota en base. Chaque test compte ce qui a ete appele, et avec quoi.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const e = vi.hoisted(() => ({
  regime: { type: 'credits' } as Record<string, unknown>,
  evaluation: null as Record<string, unknown> | null,
  quotaOk: true as boolean,
  issue: 'succes' as 'succes' | 'jamaisEnvoye' | 'incertain' | 'echec',
  appelsFournisseur: 0,
  /** Simule ce qui se passe AILLEURS pendant l'appel fournisseur (ex. reconciliation). */
  pendantAppel: null as null | (() => Promise<void>),
  /** Ce que le fournisseur recoit / voit AVANT d'accepter la demande. */
  avantAcceptation: null as null | (() => Promise<void>),
  cleRecue: null as string | null,
  depotCourant: null as null | { lire(id: string, u: string): Promise<{ film: { generations?: Array<{ externe?: unknown }> } } | null> },
  reserverDepense: vi.fn(),
  confirmerDepense: vi.fn(),
  reserverCredits: vi.fn(),
  rembourserCredits: vi.fn(),
  reserverQuota: vi.fn(),
  confirmerQuota: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));
vi.mock('@/lib/cinema/stockage/cles', async (orig) => ({
  ...(await orig<typeof import('@/lib/cinema/stockage/cles')>()),
  cleMedia: (_u: string, _f: string, url: string) => `cle/${url}`,
}));
vi.mock('@/lib/cinema/generation/plafond-compte', () => ({
  reserverDepenseReplicate: (...a: unknown[]) => e.reserverDepense(...a),
  confirmerDepenseReplicate: (...a: unknown[]) => e.confirmerDepense(...a),
}));
vi.mock('@/lib/cinema/generation/credits', () => ({
  reserverCredits: (...a: unknown[]) => e.reserverCredits(...a),
  rembourserCredits: (...a: unknown[]) => e.rembourserCredits(...a),
}));
vi.mock('@/lib/cinema/abonnement/regime', () => ({
  regimeCinema: async () => e.regime,
  evaluerQuota: async () => e.evaluation,
}));
vi.mock('@/lib/cinema/abonnement/depot', () => ({
  reserverQuota: (...a: unknown[]) => e.reserverQuota(...a),
  confirmerQuota: (...a: unknown[]) => e.confirmerQuota(...a),
}));
vi.mock('@/lib/cinema/generation/atelier', () => ({
  // Le contrat reel de l'atelier : le paiement d'abord, l'appel fournisseur ensuite.
  genererMediaPlan: async (film: { coutGenerationUsd?: number }, planId: string, o: {
    payer?: () => Promise<{ ok: boolean; motif?: string; message?: string }>;
    suivi?: { cleIdempotence: string; surAcceptation(id: string): Promise<void> };
  }) => {
    if (o.payer) {
      const p = await o.payer();
      if (!p.ok) return { ok: false, erreur: p.message, refusPaiement: p.motif };
    }
    e.appelsFournisseur++;
    e.cleRecue = o.suivi?.cleIdempotence ?? null;
    if (e.avantAcceptation) await e.avantAcceptation();
    if (o.suivi) await o.suivi.surAcceptation('ext-123');
    if (e.pendantAppel) await e.pendantAppel();
    if (e.issue === 'jamaisEnvoye') return { ok: false, erreur: 'refuse localement', depenseUsd: 0, jamaisEnvoye: true };
    if (e.issue === 'incertain') return { ok: false, erreur: 'delai depasse', depenseUsd: 0.04, incertain: true };
    if (e.issue === 'echec') return { ok: false, erreur: 'refus fournisseur', depenseUsd: 0.04 };
    const media = { url: `/cinema/f/medias/${planId}-g.png`, genre: 'image', largeur: 10, hauteur: 10, dureeS: null, octets: 10, origine: 'genere' };
    return { ok: true, media, film: { ...film, coutGenerationUsd: (film.coutGenerationUsd ?? 0) + 0.04 } };
  },
}));

const { executerGeneration, solderGenerationsInterrompues } = await import('@/lib/cinema/generation/executeur-generation');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { depotFilmsMemoire, modifierFilm } = await import('@/lib/cinema/stockage/depot-films');
const { reserverGeneration } = await import('@/lib/cinema/generation/suivi');
const { ID_REPLICATE_IMAGE } = await import('@/lib/cinema/generation/replicate');

const U = '11111111-1111-4111-8111-111111111111';
const PERIODE = { debut: '2026-11-03T08:00:00.000Z', fin: '2026-12-03T08:00:00.000Z' };
const ABONNEMENT = { type: 'abonnement', planKey: 'pro', formule: {}, periode: PERIODE };
const EVALUATION_OK = {
  ok: true, periode: PERIODE, dureeFilmS: 42,
  decision: { ok: true, regime: 'abonnement', limites: { maxFilms: 30, maxSecondes: 1800, maxUsd: 10 } },
};

/** Budget de projet confirme par defaut (1 $), sauf `budget: null`. */
async function lancer(fournisseurId = ID_REPLICATE_IMAGE, o: { budget?: number | null; dejaEngage?: number } = {}) {
  const depot = depotFilmsMemoire();
  const base = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde.', personnages: [{ nom: 'Nina', description: 'x' }], idFilm: 'film-abo', titre: 't' }), proprietaire: U };
  const budget = o.budget === undefined ? 1 : o.budget;
  const film = {
    ...base, coutGenerationUsd: o.dejaEngage ?? 0,
    ...(budget === null ? null : { budgetApprouve: { usd: budget, perimetre: 'images' as const, devisUsd: budget, approuveLe: 'x' } }),
  };
  await depot.creer(film, U);
  e.depotCourant = depot as never;
  const planId = film.scenes[0].plans[0].id;
  const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'image', mode: 'reelle' });
  if (!r.ok) throw new Error('reservation');
  const ctx = {
    films: depot, dossierTravail: mkdtempSync(join(tmpdir(), 'cinema-abo-')),
    objets: { telechargerVers: async () => true, deposerFichier: async () => {}, supprimer: async () => {} },
  } as never;
  const statut = await executerGeneration({ ctx, userId: U, filmId: film.id, generation: r.generation, fournisseurId, plafondUsd: 2 });
  const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === r.generation.id)!;
  return { statut, g, generationId: r.generation.id, depot, filmId: film.id };
}

beforeEach(() => {
  e.regime = { type: 'credits' }; e.evaluation = EVALUATION_OK; e.quotaOk = true; e.issue = 'succes'; e.appelsFournisseur = 0; e.pendantAppel = null; e.avantAcceptation = null; e.cleRecue = null;
  e.reserverDepense.mockReset().mockResolvedValue({ ok: true, reference: 'dep-1', montantUsd: 0.003 });
  e.confirmerDepense.mockReset().mockResolvedValue({ ok: true });
  e.reserverCredits.mockReset().mockResolvedValue({ ok: true, reservation: { cout: 5, reference: 'cr-1' } });
  e.rembourserCredits.mockReset().mockResolvedValue({ ok: true });
  e.reserverQuota.mockReset().mockImplementation(async () => (e.quotaOk ? { ok: true, dejaReservee: false } : { ok: false, motif: 'minutes_epuisees' }));
  e.confirmerQuota.mockReset().mockResolvedValue({ ok: true, motif: null });
});

describe('regime CREDITS (interrupteur ferme, ou formule sans Cinema) : rien ne change', () => {
  it('credits pris, plafond de depense applique, aucun quota touche', async () => {
    const { statut } = await lancer();
    expect(statut).toBe('reussie');
    expect(e.reserverCredits).toHaveBeenCalledTimes(1);
    expect(e.reserverDepense).toHaveBeenCalledTimes(1);
    expect(e.reserverQuota).not.toHaveBeenCalled();
    expect(e.confirmerQuota).not.toHaveBeenCalled();
  });
});

describe('regime ADMINISTRATEUR : cout fournisseur reel, rien d’autre', () => {
  beforeEach(() => { e.regime = { type: 'cout_reel' }; });

  it('aucun credit, aucun quota — mais le plafond de depense s’applique et la depense est confirmee', async () => {
    const { statut } = await lancer();
    expect(statut).toBe('reussie');
    expect(e.reserverCredits).not.toHaveBeenCalled();
    expect(e.reserverQuota).not.toHaveBeenCalled();
    expect(e.reserverDepense).toHaveBeenCalledTimes(1);
    expect(e.confirmerDepense).toHaveBeenCalledWith(U, 'dep-1', 'confirmee');
  });

  it('plafond de depense atteint : refuse, fournisseur jamais appele', async () => {
    e.reserverDepense.mockResolvedValue({ ok: false, motif: 'plafond_compte_depasse', message: 'plafond atteint' });
    const { statut, g } = await lancer();
    expect(statut).toBe('echouee');
    expect(g.erreur).toBe('plafond atteint');
    expect(e.appelsFournisseur).toBe(0);
  });

  it('prix inconnu : refuse AVANT toute reservation — l’admin ne paie jamais a l’aveugle', async () => {
    const { statut, g } = await lancer('fournisseur-sans-tarif');
    expect(statut).toBe('echouee');
    expect(g.erreur).toMatch(/estime/);
    expect(e.reserverDepense).not.toHaveBeenCalled();
    expect(e.appelsFournisseur).toBe(0);
  });
});

describe('regime ABONNEMENT : couvert ou refuse, jamais facture en credits en plus', () => {
  beforeEach(() => { e.regime = ABONNEMENT; });

  it('succes : quota reserve (reference de la generation, duree du projet), confirme, AUCUN credit', async () => {
    const { statut, generationId } = await lancer();
    expect(statut).toBe('reussie');
    expect(e.reserverCredits).not.toHaveBeenCalled();
    expect(e.reserverQuota).toHaveBeenCalledWith(expect.objectContaining({
      userId: U, reference: `cinema-quota:${generationId}`, filmId: 'film-abo', dureeFilmS: 42,
      periodeDebut: PERIODE.debut, periodeFin: PERIODE.fin, maxFilms: 30, maxSecondes: 1800, maxUsd: 10,
    }));
    expect(e.confirmerQuota).toHaveBeenCalledWith(U, `cinema-quota:${generationId}`, 'confirmee');
  });

  it('la base refuse (quota epuise) : message clair, depense liberee, rien d’appele, AUCUNE bascule vers les credits', async () => {
    e.quotaOk = false;
    const { statut, g } = await lancer();
    expect(statut).toBe('echouee');
    expect(g.erreur).toMatch(/minutes incluses/);
    expect(e.appelsFournisseur).toBe(0);
    expect(e.reserverCredits).not.toHaveBeenCalled();
    expect(e.confirmerDepense).toHaveBeenCalledWith(U, 'dep-1', 'liberee');
    expect(e.confirmerQuota).not.toHaveBeenCalled();
  });

  it('l’evaluation refuse (qualite, duree max, periode) : la base n’est meme pas sollicitee', async () => {
    e.evaluation = { ok: false, message: 'Ce film depasse la duree maximale autorisee par votre abonnement.', resume: null };
    const { g } = await lancer();
    expect(g.erreur).toMatch(/duree maximale/);
    expect(e.reserverQuota).not.toHaveBeenCalled();
    expect(e.confirmerDepense).toHaveBeenCalledWith(U, 'dep-1', 'liberee');
  });

  it.each([
    ['jamaisEnvoye', 'liberee'],
    ['incertain', 'incertaine'],
    ['echec', 'confirmee'],
  ] as const)('echec fournisseur « %s » : quota ET depense passent au MEME statut (%s), aucun credit rembourse ni pris', async (issue, statutAttendu) => {
    e.issue = issue;
    const { statut, generationId } = await lancer();
    expect(statut).toBe('echouee');
    expect(e.confirmerDepense).toHaveBeenCalledWith(U, 'dep-1', statutAttendu);
    expect(e.confirmerQuota).toHaveBeenCalledWith(U, `cinema-quota:${generationId}`, statutAttendu);
    expect(e.reserverCredits).not.toHaveBeenCalled();
    expect(e.rembourserCredits).not.toHaveBeenCalled();
  });

  it('abonnement illisible : refuse, rien n’est reserve ni pris', async () => {
    e.regime = { type: 'refus', message: 'Votre abonnement n’a pas pu etre verifie' };
    const { statut, g } = await lancer();
    expect(statut).toBe('echouee');
    expect(g.erreur).toMatch(/pas pu etre verifie/);
    for (const f of [e.reserverDepense, e.reserverCredits, e.reserverQuota]) expect(f).not.toHaveBeenCalled();
  });
});

describe('BUDGET DU PROJET : confirme avant, controle pendant', () => {
  it.each([['cout_reel'], ['abonnement']] as const)('%s sans budget confirme : refuse AVANT toute reservation', async (type) => {
    e.regime = type === 'cout_reel' ? { type } : ABONNEMENT;
    const { statut, g } = await lancer(ID_REPLICATE_IMAGE, { budget: null });
    expect(statut).toBe('echouee');
    expect(g.erreur).toMatch(/budget de ce projet/);
    for (const f of [e.reserverDepense, e.reserverQuota, e.reserverCredits]) expect(f).not.toHaveBeenCalled();
    expect(e.appelsFournisseur).toBe(0);
  });

  it('budget confirme mais deja consomme : refuse, rien n’est reserve', async () => {
    e.regime = { type: 'cout_reel' };
    const { statut, g } = await lancer(ID_REPLICATE_IMAGE, { budget: 0.1, dejaEngage: 0.0999 });
    expect(statut).toBe('echouee');
    expect(g.erreur).toMatch(/budget approuve/);
    expect(e.reserverDepense).not.toHaveBeenCalled();
  });

  it('regime credits : aucun budget de projet exige — comportement d’avant', async () => {
    expect((await lancer(ID_REPLICATE_IMAGE, { budget: null })).statut).toBe('reussie');
  });
});

describe('REFERENCES ecrites AVANT l’appel payant', () => {
  it('abonnement : depense et quota notes sur la generation', async () => {
    e.regime = ABONNEMENT;
    let vues: unknown = null;
    e.pendantAppel = async () => { vues = 'appel'; };
    const { g, generationId } = await lancer();
    expect(vues).toBe('appel');
    expect(g).toMatchObject({ referenceDepense: 'dep-1', referenceQuota: `cinema-quota:${generationId}` });
  });

  it('credits : la reference de depense est notee avec les credits', async () => {
    const { g } = await lancer();
    expect(g).toMatchObject({ referenceDepense: 'dep-1', referenceCredits: 'cr-1', creditsPris: 5 });
  });
});

describe('RECONCILIATION des generations interrompues', () => {
  /** Une generation laissee `en_cours` avec un bail expire : le serveur est mort pendant l'appel. */
  async function interrompue(patch: Record<string, unknown>) {
    const depot = depotFilmsMemoire();
    const film = { ...preparerFilm({ histoire: 'Nina entre.', personnages: [], idFilm: 'film-int', titre: 't' }), proprietaire: U };
    await depot.creer(film, U);
    const r = await reserverGeneration(depot, film.id, U, { planId: film.scenes[0].plans[0].id, operation: 'image', mode: 'reelle' });
    if (!r.ok) throw new Error('reservation');
    await modifierFilm(depot, film.id, U, (f) => ({
      ...f, generations: f.generations!.map((g) => ({ ...g, ...patch, bailJusqua: '2020-01-01T00:00:00Z' })),
    }));
    const solder = async () => solderGenerationsInterrompues({ films: depot } as never, film.id, U, (await depot.lire(film.id, U))!.film);
    const lire = async () => (await depot.lire(film.id, U))!.film.generations![0];
    return { solder, lire };
  }

  it('abonnement : depense ET quota passent en INCERTAINE (jamais liberee), une seule fois', async () => {
    const { solder, lire } = await interrompue({ referenceDepense: 'dep-9', referenceQuota: 'cinema-quota:g9' });
    await solder();
    expect(e.confirmerDepense).toHaveBeenCalledWith(U, 'dep-9', 'incertaine');
    expect(e.confirmerQuota).toHaveBeenCalledWith(U, 'cinema-quota:g9', 'incertaine');
    for (const [, , statut] of [...e.confirmerDepense.mock.calls, ...e.confirmerQuota.mock.calls]) expect(statut).not.toBe('liberee');
    expect(e.rembourserCredits).not.toHaveBeenCalled();
    expect(await lire()).toMatchObject({ statut: 'interrompue', depenseReconciliee: true });
    await solder();
    expect(e.confirmerDepense).toHaveBeenCalledTimes(1);
    expect(e.confirmerQuota).toHaveBeenCalledTimes(1);
  });

  it('credits : rembourses UNE fois, et la depense marquee incertaine', async () => {
    const { solder, lire } = await interrompue({ referenceDepense: 'dep-9', creditsPris: 5, referenceCredits: 'cr-9' });
    await solder(); await solder();
    expect(e.rembourserCredits).toHaveBeenCalledTimes(1);
    expect(e.confirmerDepense).toHaveBeenCalledTimes(1);
    expect(await lire()).toMatchObject({ creditsRembourses: true, depenseReconciliee: true });
  });

  it('base injoignable : rien n’est marque, on retente au passage suivant', async () => {
    const { solder, lire } = await interrompue({ referenceQuota: 'cinema-quota:g9' });
    e.confirmerQuota.mockResolvedValueOnce({ ok: false, motif: 'transport' });
    await solder();
    expect((await lire()).depenseReconciliee).not.toBe(true);
    await solder();
    expect(e.confirmerQuota).toHaveBeenCalledTimes(2);
    expect((await lire()).depenseReconciliee).toBe(true);
  });

  it('issue deja definitive (l’executeur a conclu) : jamais ecrasee, consideree soldee', async () => {
    const { solder, lire } = await interrompue({ referenceQuota: 'cinema-quota:g9' });
    e.confirmerQuota.mockResolvedValueOnce({ ok: false, motif: 'deja_finalisee' });
    await solder();
    expect((await lire()).depenseReconciliee).toBe(true);
  });

  /**
   * Un resultat qui arrive APRES que la reconciliation a declare la generation interrompue.
   * `remplacer` : un autre media a ete pose sur le plan entre-temps.
   */
  async function resultatTardif(o: { remplacer?: boolean } = {}) {
    let depotRef: ReturnType<typeof depotFilmsMemoire> | null = null;
    e.pendantAppel = async () => {
      const d = depotRef!;
      await modifierFilm(d, 'film-abo', U, (x) => ({
        ...x,
        generations: x.generations!.map((g) => ({ ...g, bailJusqua: '2020-01-01T00:00:00Z' })),
        scenes: !o.remplacer ? x.scenes : x.scenes.map((sc, i) => (i !== 0 ? sc : { ...sc, plans: sc.plans.map((pl, j) => (j !== 0 ? pl : {
          ...pl, media: { url: '/cinema/film-abo/medias/importe.png', genre: 'image' as const, largeur: 10, hauteur: 10, dureeS: null, octets: 10, origine: 'import' as const },
        })) })),
      }));
      await solderGenerationsInterrompues({ films: d } as never, 'film-abo', U, (await d.lire('film-abo', U))!.film);
    };
    const depot = depotFilmsMemoire();
    depotRef = depot;
    const film = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde.', personnages: [], idFilm: 'film-abo', titre: 't' }), proprietaire: U,
      budgetApprouve: { usd: 1, perimetre: 'images' as const, devisUsd: 1, approuveLe: 'x' } };
    await depot.creer(film, U);
    const r = await reserverGeneration(depot, film.id, U, { planId: film.scenes[0].plans[0].id, operation: 'image', mode: 'reelle' });
    if (!r.ok) throw new Error('reservation');
    const supprimes: string[] = [];
    const ctx = { films: depot, dossierTravail: mkdtempSync(join(tmpdir(), 'cinema-abo-')),
      objets: { telechargerVers: async () => true, deposerFichier: async () => {}, supprimer: async (k: string) => { supprimes.push(k); } } } as never;
    const statut = await executerGeneration({ ctx, userId: U, filmId: film.id, generation: r.generation, fournisseurId: ID_REPLICATE_IMAGE, plafondUsd: 2 });
    const f = (await depot.lire(film.id, U))!.film;
    return { statut, f, g: f.generations![0], ref: `cinema-quota:${r.generation.id}`, supprimes };
  }

  it('ARRIVE APRES INTERRUPTION, aucun credit pris (abonnement) : LIVRE, facture une seule fois', async () => {
    e.regime = ABONNEMENT;
    const { statut, f, g, ref, supprimes } = await resultatTardif();
    expect(statut).toBe('reussie');
    expect(g.statut).toBe('reussie');
    expect(g.erreur).toMatch(/livre, sans nouveau cout/);
    expect(f.scenes[0].plans[0].media?.url).toMatch(/-g\.png$/);
    expect(supprimes).toEqual([]);
    // Reconciliation : incertaine ; executeur : confirmee (l'appel a bien ete facture).
    expect(e.confirmerQuota.mock.calls.map((c) => c[2])).toEqual(['incertaine', 'confirmee']);
    expect(e.confirmerDepense.mock.calls.map((c) => c[2])).toEqual(['incertaine', 'confirmee']);
    expect(e.confirmerQuota.mock.calls[0][1]).toBe(ref);
    expect(e.reserverCredits).not.toHaveBeenCalled();
    expect(e.rembourserCredits).not.toHaveBeenCalled();
    // Livre une fois : une nouvelle reconciliation ne la reprend plus.
    await solderGenerationsInterrompues({ films: { lire: async () => ({ film: f, version: 1 }) } } as never, 'film-abo', U, f);
    expect(e.confirmerQuota).toHaveBeenCalledTimes(2);
  });

  it('administrateur : meme livraison, toujours sans credit', async () => {
    e.regime = { type: 'cout_reel' };
    const { statut, f } = await resultatTardif();
    expect(statut).toBe('reussie');
    expect(f.scenes[0].plans[0].media?.url).toMatch(/-g\.png$/);
  });

  it('CREDITS rendus par la reconciliation : JAMAIS livre (pas de media gratuit), et l’utilisateur est prevenu', async () => {
    const { statut, f, g, supprimes } = await resultatTardif();
    expect(statut).toBe('interrompue');
    expect(e.rembourserCredits).toHaveBeenCalledTimes(1);
    expect(f.scenes[0].plans[0].media).toBeNull();
    expect(supprimes).toHaveLength(1);
    expect(g.erreur).toMatch(/credits ont ete rendus/);
  });

  it('plan modifie entre-temps : le media plus recent n’est jamais ecrase', async () => {
    e.regime = ABONNEMENT;
    const { statut, f, g, supprimes } = await resultatTardif({ remplacer: true });
    expect(statut).toBe('interrompue');
    expect(f.scenes[0].plans[0].media?.url).toBe('/cinema/film-abo/medias/importe.png');
    expect(supprimes).toHaveLength(1);
    expect(g.erreur).toMatch(/deja ete modifie/);
  });
});

describe('SOUMISSION SUIVIE : ecrite avant l’appel, completee a l’acceptation', () => {
  it.each([['credits'], ['cout_reel'], ['abonnement']] as const)('%s : cle, cout estime et media de depart ecrits AVANT, identifiant APRES', async (type) => {
    e.regime = type === 'credits' ? { type } : type === 'cout_reel' ? { type } : ABONNEMENT;
    let avant: Record<string, unknown> | undefined;
    e.avantAcceptation = async () => {
      // Ce qu'un redemarrage a CET instant (appel parti, pas encore accepte) retrouverait.
      avant = (await e.depotCourant!.lire('film-abo', U))!.film.generations![0].externe as never;
    };
    const { g } = await lancer();
    expect(avant).toMatchObject({ fournisseurId: ID_REPLICATE_IMAGE, mediaAvantUrl: null });
    expect(avant!.cleIdempotence).toBe(e.cleRecue);
    expect(avant!.idExterne).toBeUndefined();
    expect(g.externe).toMatchObject({ idExterne: 'ext-123', cleIdempotence: e.cleRecue });
    expect(g.externe!.coutEstimeUsd).toBeGreaterThan(0);
    expect(typeof g.externe!.accepteLe).toBe('string');
  });

  it('generation simulee : aucune soumission suivie (rien n’est facturable)', async () => {
    const depot = depotFilmsMemoire();
    const film = { ...preparerFilm({ histoire: 'Nina entre.', personnages: [], idFilm: 'film-sim', titre: 't' }), proprietaire: U };
    await depot.creer(film, U);
    const r = await reserverGeneration(depot, film.id, U, { planId: film.scenes[0].plans[0].id, operation: 'image', mode: 'simulee' });
    if (!r.ok) throw new Error('reservation');
    const ctx = { films: depot, dossierTravail: mkdtempSync(join(tmpdir(), 'cinema-abo-')),
      objets: { telechargerVers: async () => true, deposerFichier: async () => {}, supprimer: async () => {} } } as never;
    await executerGeneration({ ctx, userId: U, filmId: film.id, generation: r.generation, fournisseurId: ID_REPLICATE_IMAGE, plafondUsd: 2 });
    expect(e.cleRecue).toBeNull();
    expect((await depot.lire(film.id, U))!.film.generations![0].externe).toBeUndefined();
  });
});
