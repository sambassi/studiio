/**
 * CINEMA IA — FORMULES ET QUOTAS : ce que l'abonnement couvre, et ce qu'il refuse.
 * La reservation atomique est prouvee sur un vrai PostgreSQL
 * (`tests-pg/cinema-abonnements.pg.test.ts`) ; ici, la DECISION.
 */
import { describe, it, expect } from 'vitest';
import {
  validerFormule, formuleNonIncluse, depuisLigne, versLigne, type FormuleCinema,
} from '@/lib/cinema/abonnement/formules';
import {
  decider, periodeQuota, resumeQuota, dureeLisible, CONSOMMATION_VIDE, type Consommation, type DemandeQuota,
} from '@/lib/cinema/abonnement/quotas';

/** L'exemple de la demande. Ce sont des valeurs DE TEST, pas des quotas choisis. */
const FORMULE: FormuleCinema = {
  planKey: 'pro', inclus: true, filmsParMois: 30, secondesParMois: 1800, dureeMaxFilmS: 360,
  qualites: ['standard'], fonctionnalites: ['image_ia', 'animation_video'], budgetUsdParMois: 10,
  renouvellement: 'periode_abonnement',
};

const film = (s: number, o: Partial<DemandeQuota> = {}): DemandeQuota => ({
  filmDejaCompte: false, secondesAjoutees: s, dureeFilmS: s, qualite: 'standard',
  fonctionnalite: 'image_ia', usdEstime: 0.1, ...o,
});

/** Joue des reservations successives, comme le ferait la base. */
function enchainer(n: number, d: DemandeQuota, f = FORMULE) {
  let c: Consommation = CONSOMMATION_VIDE;
  let acceptees = 0;
  let dernier = '';
  for (let i = 0; i < n; i++) {
    const r = decider({ regime: 'abonnement', formule: f, consommation: c, demande: d });
    if (!r.ok) { dernier = r.motif; break; }
    if (r.regime === 'abonnement') c = r.apres;
    acceptees++;
  }
  return { acceptees, dernier, c };
}

describe('validation d’une formule : rien n’est complete en silence', () => {
  it('la formule de test est valide', () => {
    expect(validerFormule(FORMULE)).toEqual({ ok: true, formule: FORMULE });
  });

  it('un champ manquant est une erreur, jamais une valeur par defaut', () => {
    const { budgetUsdParMois: _b, ...sansBudget } = FORMULE;
    const r = validerFormule(sansBudget);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.join(' ')).toMatch(/budget/);
  });

  it('bornes : negatif, decimal ou demesure refuses', () => {
    for (const p of [{ filmsParMois: -1 }, { filmsParMois: 2.5 }, { filmsParMois: 1001 },
      { budgetUsdParMois: 5000 }, { secondesParMois: 400000 }, { budgetUsdParMois: NaN }]) {
      expect(validerFormule({ ...FORMULE, ...p }).ok, JSON.stringify(p)).toBe(false);
    }
  });

  it('valeurs inconnues refusees (qualite, fonctionnalite, renouvellement, cle)', () => {
    expect(validerFormule({ ...FORMULE, qualites: ['4k'] }).ok).toBe(false);
    expect(validerFormule({ ...FORMULE, fonctionnalites: ['mouvements_camera'] }).ok).toBe(false);
    expect(validerFormule({ ...FORMULE, renouvellement: 'annuel' }).ok).toBe(false);
    expect(validerFormule({ ...FORMULE, planKey: 'Pro; drop' }).ok).toBe(false);
  });

  it('une formule INCLUSE doit etre coherente ; une formule non incluse peut etre a zero', () => {
    expect(validerFormule({ ...FORMULE, dureeMaxFilmS: 2000 }).ok).toBe(false);
    expect(validerFormule({ ...FORMULE, filmsParMois: 0 }).ok).toBe(false);
    expect(validerFormule({ ...FORMULE, qualites: [] }).ok).toBe(false);
    expect(validerFormule(formuleNonIncluse('free')).ok).toBe(true);
  });

  it('aller-retour avec la ligne SQL ; une ligne corrompue n’ouvre RIEN', () => {
    expect(depuisLigne(versLigne(FORMULE))).toEqual(FORMULE);
    expect(depuisLigne({ ...versLigne(FORMULE), films_par_mois: -5 })).toBeNull();
    expect(depuisLigne({ ...versLigne(FORMULE), budget_usd_par_mois: '10.0000' })).toEqual(FORMULE);
  });
});

describe('30 minutes reparties librement', () => {
  it('30 films d’1 minute, pas un de plus', () => {
    const r = enchainer(31, film(60));
    expect(r).toMatchObject({ acceptees: 30, dernier: 'films_epuises' });
  });

  it('10 films de 3 minutes, puis les minutes sont epuisees', () => {
    const r = enchainer(11, film(180));
    expect(r).toMatchObject({ acceptees: 10, dernier: 'minutes_epuisees' });
  });

  it('5 films de 6 minutes ; un film de 7 minutes est refuse par la duree maximale', () => {
    expect(enchainer(6, film(360))).toMatchObject({ acceptees: 5, dernier: 'minutes_epuisees' });
    const r = decider({ regime: 'abonnement', formule: FORMULE, consommation: CONSOMMATION_VIDE, demande: film(420) });
    expect(r).toMatchObject({ ok: false, motif: 'film_trop_long' });
  });

  it('une regeneration d’un film deja compte ne prend ni film ni minute, mais du budget', () => {
    const r = enchainer(200, film(0, { filmDejaCompte: true, dureeFilmS: 120, usdEstime: 0.42 }));
    expect(r.dernier).toBe('budget_fournisseur_atteint');
    expect(r.acceptees).toBe(23); // 23 x 0,42 = 9,66 $ ; la 24e depasserait 10 $
    expect(r.c).toMatchObject({ films: 0, secondes: 0, tentatives: 23 });
  });
});

describe('droits et estimation', () => {
  it('non inclus, ou aucune formule : refus', () => {
    for (const f of [null, formuleNonIncluse('free')]) {
      expect(decider({ regime: 'abonnement', formule: f, consommation: CONSOMMATION_VIDE, demande: film(60) }))
        .toMatchObject({ ok: false, motif: 'non_inclus' });
    }
  });

  it('qualite ou fonctionnalite hors formule : refus', () => {
    const base = { regime: 'abonnement' as const, formule: FORMULE, consommation: CONSOMMATION_VIDE };
    expect(decider({ ...base, demande: film(60, { qualite: 'cinema' }) })).toMatchObject({ motif: 'qualite_non_incluse' });
    expect(decider({ ...base, demande: film(60, { fonctionnalite: 'voix' }) })).toMatchObject({ motif: 'fonctionnalite_non_incluse' });
  });

  it('estimation manquante, nulle ou invalide : refus, ADMIN COMPRIS', () => {
    for (const regime of ['abonnement', 'cout_reel'] as const) {
      for (const usd of [0, -1, NaN, Infinity]) {
        expect(decider({ regime, formule: FORMULE, consommation: CONSOMMATION_VIDE, demande: film(60, { usdEstime: usd }) }))
          .toMatchObject({ ok: false, motif: 'estimation_invalide' });
      }
    }
  });

  it('admin : cout reel, ni quota ni formule — les plafonds de depense restent ailleurs', () => {
    const plein: Consommation = { films: 30, secondes: 1800, usdEngages: 10, tentatives: 99 };
    expect(decider({ regime: 'cout_reel', formule: null, consommation: plein, demande: film(3000) }))
      .toEqual({ ok: true, regime: 'cout_reel' });
  });

  it('la decision rend les LIMITES que la base appliquera atomiquement', () => {
    const r = decider({ regime: 'abonnement', formule: FORMULE, consommation: CONSOMMATION_VIDE, demande: film(60) });
    expect(r).toMatchObject({ ok: true, limites: { maxFilms: 30, maxSecondes: 1800, maxUsd: 10 } });
  });
});

describe('periode de quota', () => {
  const t = new Date('2026-11-15T10:00:00Z');

  it('mois civil : du 1er au 1er suivant', () => {
    expect(periodeQuota('mois_civil', null, t)).toEqual({
      debut: '2026-11-01T00:00:00.000Z', fin: '2026-12-01T00:00:00.000Z',
    });
    expect(periodeQuota('mois_civil', null, new Date('2026-12-31T23:59:59Z'))!.fin).toBe('2027-01-01T00:00:00.000Z');
  });

  it('periode d’abonnement : celle de Stripe, jamais devinee', () => {
    const sub = { debut: '2026-11-03T08:00:00Z', fin: '2026-12-03T08:00:00Z' };
    expect(periodeQuota('periode_abonnement', sub, t)).toEqual({
      debut: '2026-11-03T08:00:00.000Z', fin: '2026-12-03T08:00:00.000Z',
    });
    expect(periodeQuota('periode_abonnement', null, t)).toBeNull();
    expect(periodeQuota('periode_abonnement', { debut: sub.debut, fin: null }, t)).toBeNull();
    // Periode echue (renouvellement pas encore recu) : on ne prolonge pas en silence.
    expect(periodeQuota('periode_abonnement', sub, new Date('2026-12-05T00:00:00Z'))).toBeNull();
  });
});

describe('ce que l’utilisateur voit', () => {
  it('films et minutes restants, jamais le montant du budget', () => {
    const r = resumeQuota(FORMULE, { films: 4, secondes: 750, usdEngages: 2.5, tentatives: 9 });
    expect(r).toEqual({
      inclus: true, filmsRestants: 26, secondesRestantes: 1050, dureeRestante: '17 min 30 s',
      dureeMaxFilmS: 360, partBudgetEngagee: 0.25,
    });
  });

  it('non inclus : tout a zero', () => {
    expect(resumeQuota(null, CONSOMMATION_VIDE).inclus).toBe(false);
  });

  it('durees lisibles', () => {
    expect(dureeLisible(45)).toBe('45 s');
    expect(dureeLisible(120)).toBe('2 min');
    expect(dureeLisible(1830)).toBe('30 min 30 s');
  });
});
