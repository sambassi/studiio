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
  genererMediaPlan: async (film: { coutGenerationUsd?: number }, planId: string, o: { payer?: () => Promise<{ ok: boolean; motif?: string; message?: string }> }) => {
    if (o.payer) {
      const p = await o.payer();
      if (!p.ok) return { ok: false, erreur: p.message, refusPaiement: p.motif };
    }
    e.appelsFournisseur++;
    if (e.issue === 'jamaisEnvoye') return { ok: false, erreur: 'refuse localement', depenseUsd: 0, jamaisEnvoye: true };
    if (e.issue === 'incertain') return { ok: false, erreur: 'delai depasse', depenseUsd: 0.04, incertain: true };
    if (e.issue === 'echec') return { ok: false, erreur: 'refus fournisseur', depenseUsd: 0.04 };
    const media = { url: `/cinema/f/medias/${planId}-g.png`, genre: 'image', largeur: 10, hauteur: 10, dureeS: null, octets: 10, origine: 'genere' };
    return { ok: true, media, film: { ...film, coutGenerationUsd: (film.coutGenerationUsd ?? 0) + 0.04 } };
  },
}));

const { executerGeneration } = await import('@/lib/cinema/generation/executeur-generation');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { depotFilmsMemoire } = await import('@/lib/cinema/stockage/depot-films');
const { reserverGeneration } = await import('@/lib/cinema/generation/suivi');
const { ID_REPLICATE_IMAGE } = await import('@/lib/cinema/generation/replicate');

const U = '11111111-1111-4111-8111-111111111111';
const PERIODE = { debut: '2026-11-03T08:00:00.000Z', fin: '2026-12-03T08:00:00.000Z' };
const ABONNEMENT = { type: 'abonnement', planKey: 'pro', formule: {}, periode: PERIODE };
const EVALUATION_OK = {
  ok: true, periode: PERIODE, dureeFilmS: 42,
  decision: { ok: true, regime: 'abonnement', limites: { maxFilms: 30, maxSecondes: 1800, maxUsd: 10 } },
};

async function lancer(fournisseurId = ID_REPLICATE_IMAGE) {
  const depot = depotFilmsMemoire();
  const film = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde.', personnages: [{ nom: 'Nina', description: 'x' }], idFilm: 'film-abo', titre: 't' }), proprietaire: U };
  await depot.creer(film, U);
  const planId = film.scenes[0].plans[0].id;
  const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'image', mode: 'reelle' });
  if (!r.ok) throw new Error('reservation');
  const ctx = {
    films: depot, dossierTravail: mkdtempSync(join(tmpdir(), 'cinema-abo-')),
    objets: { telechargerVers: async () => true, deposerFichier: async () => {}, supprimer: async () => {} },
  } as never;
  const statut = await executerGeneration({ ctx, userId: U, filmId: film.id, generation: r.generation, fournisseurId, plafondUsd: 2 });
  const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === r.generation.id)!;
  return { statut, g, generationId: r.generation.id };
}

beforeEach(() => {
  e.regime = { type: 'credits' }; e.evaluation = EVALUATION_OK; e.quotaOk = true; e.issue = 'succes'; e.appelsFournisseur = 0;
  e.reserverDepense.mockReset().mockResolvedValue({ ok: true, reference: 'dep-1', montantUsd: 0.003 });
  e.confirmerDepense.mockReset().mockResolvedValue({ ok: true });
  e.reserverCredits.mockReset().mockResolvedValue({ ok: true, reservation: { cout: 5, reference: 'cr-1' } });
  e.rembourserCredits.mockReset().mockResolvedValue({ ok: true });
  e.reserverQuota.mockReset().mockImplementation(async () => (e.quotaOk ? { ok: true, dejaReservee: false } : { ok: false, motif: 'minutes_epuisees' }));
  e.confirmerQuota.mockReset().mockResolvedValue(true);
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
