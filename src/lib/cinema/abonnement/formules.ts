/**
 * CINEMA IA — CE QU'UNE FORMULE D'ABONNEMENT INCLUT.
 *
 * Une formule Cinema se rattache a une formule EXISTANTE (`plans.key` : free, starter,
 * pro, enterprise). Elle ne porte PAS de prix : le prix mensuel en CHF reste celui de
 * `plans`, edite depuis Administration > Tarifs, ou chaque changement cree un prix
 * Stripe. Le dupliquer ici ferait coexister deux prix pour la meme formule.
 *
 * SIX GRANDEURS A NE JAMAIS CONFONDRE :
 *   - `filmsParMois`      : nombre de FILMS distincts commences dans la periode ;
 *   - `secondesParMois`   : duree de FILM FINAL (ce que l'utilisateur voit) ;
 *   - `dureeMaxFilmS`     : borne d'UN film ;
 *   - `budgetUsdParMois`  : cout FOURNISSEUR engage (generations reelles, tentatives et
 *                           regenerations comprises) — en USD, devise du fournisseur ;
 *   - les tentatives      : comptees a part (journal), jamais deduites des minutes ;
 *   - le prix en CHF      : dans `plans`, pas ici.
 *
 * ⚠️ AUCUNE VALEUR PAR DEFAUT N'EST CHOISIE ICI. Sans formule enregistree, Cinema n'est
 * PAS inclus dans l'abonnement (`FORMULE_NON_INCLUSE`) : le comportement actuel — chaque
 * generation reelle payee en credits — reste exactement celui d'aujourd'hui.
 */
import type { NiveauQualite } from '@/lib/cinema/types';

export type Renouvellement = 'periode_abonnement' | 'mois_civil';

export const QUALITES_CINEMA: readonly NiveauQualite[] = ['brouillon', 'standard', 'cinema'];

/**
 * Fonctionnalites REELLEMENT presentes dans Cinema IA aujourd'hui. Les choix de genre,
 * de style cinematique, de styles de sequences et de mouvements de camera n'existent pas
 * encore dans le code : ils s'ajouteront a cette liste le jour ou ils existeront, pas avant
 * (une option administrable qui ne commande rien serait un mensonge a l'ecran).
 */
export const FONCTIONNALITES_CINEMA = ['image_ia', 'animation_video', 'voix'] as const;
export type FonctionnaliteCinema = typeof FONCTIONNALITES_CINEMA[number];

export interface FormuleCinema {
  planKey: string;
  /** Cinema IA fait-il partie de cette formule ? `false` = rien d'inclus. */
  inclus: boolean;
  filmsParMois: number;
  secondesParMois: number;
  dureeMaxFilmS: number;
  qualites: NiveauQualite[];
  fonctionnalites: FonctionnaliteCinema[];
  budgetUsdParMois: number;
  renouvellement: Renouvellement;
}

/** Bornes de saisie : une faute de frappe ne doit jamais ouvrir un budget illimite. */
export const BORNES = {
  filmsParMois: 1000,
  secondesParMois: 100 * 3600,
  dureeMaxFilmS: 3 * 3600,
  budgetUsdParMois: 1000,
} as const;

export function formuleNonIncluse(planKey: string): FormuleCinema {
  return {
    planKey, inclus: false, filmsParMois: 0, secondesParMois: 0, dureeMaxFilmS: 0,
    qualites: [], fonctionnalites: [], budgetUsdParMois: 0, renouvellement: 'periode_abonnement',
  };
}

const CLE_PLAN = /^[a-z][a-z0-9_-]{0,31}$/;

function entier(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

/**
 * Valide une saisie d'administration. TOUS les champs sont exiges : rien n'est complete
 * en silence. Rend la liste COMPLETE des erreurs, pour les afficher d'un coup.
 */
export function validerFormule(brut: unknown): { ok: true; formule: FormuleCinema } | { ok: false; erreurs: string[] } {
  const e: string[] = [];
  const b = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;

  const planKey = typeof b.planKey === 'string' && CLE_PLAN.test(b.planKey) ? b.planKey : null;
  if (!planKey) e.push('formule inconnue');
  if (typeof b.inclus !== 'boolean') e.push('« inclus » doit etre oui ou non');

  const films = entier(b.filmsParMois, BORNES.filmsParMois);
  if (films === null) e.push(`films par mois : entier de 0 a ${BORNES.filmsParMois}`);
  const secondes = entier(b.secondesParMois, BORNES.secondesParMois);
  if (secondes === null) e.push('duree mensuelle : entier de secondes, 100 h au plus');
  const dureeMax = entier(b.dureeMaxFilmS, BORNES.dureeMaxFilmS);
  if (dureeMax === null) e.push('duree maximale d’un film : entier de secondes, 3 h au plus');

  const budget = typeof b.budgetUsdParMois === 'number' && Number.isFinite(b.budgetUsdParMois)
    && b.budgetUsdParMois >= 0 && b.budgetUsdParMois <= BORNES.budgetUsdParMois
    ? Math.round(b.budgetUsdParMois * 10_000) / 10_000 : null;
  if (budget === null) e.push(`budget fournisseur : de 0 a ${BORNES.budgetUsdParMois} $`);

  const qualites = Array.isArray(b.qualites) && b.qualites.every((q) => QUALITES_CINEMA.includes(q as NiveauQualite))
    ? [...new Set(b.qualites as NiveauQualite[])] : null;
  if (!qualites) e.push('qualites : valeurs inconnues');
  const fonctionnalites = Array.isArray(b.fonctionnalites)
    && b.fonctionnalites.every((f) => (FONCTIONNALITES_CINEMA as readonly string[]).includes(f as string))
    ? [...new Set(b.fonctionnalites as FonctionnaliteCinema[])] : null;
  if (!fonctionnalites) e.push('fonctionnalites : valeurs inconnues');

  const renouvellement = b.renouvellement === 'periode_abonnement' || b.renouvellement === 'mois_civil'
    ? b.renouvellement : null;
  if (!renouvellement) e.push('renouvellement : periode de l’abonnement ou mois civil');

  if (b.inclus === true && e.length === 0) {
    if (films === 0) e.push('formule incluse sans aucun film');
    if (secondes === 0) e.push('formule incluse sans aucune minute');
    if (dureeMax === 0) e.push('formule incluse avec une duree maximale nulle');
    if (qualites!.length === 0) e.push('formule incluse sans aucune qualite autorisee');
    if (dureeMax! > secondes!) e.push('la duree maximale d’un film depasse la duree mensuelle');
  }

  if (e.length) return { ok: false, erreurs: e };
  return {
    ok: true,
    formule: {
      planKey: planKey!, inclus: b.inclus as boolean, filmsParMois: films!, secondesParMois: secondes!,
      dureeMaxFilmS: dureeMax!, qualites: qualites!, fonctionnalites: fonctionnalites!,
      budgetUsdParMois: budget!, renouvellement: renouvellement!,
    },
  };
}

/** Ligne SQL `cinema_formules` ↔ formule. */
export interface LigneFormule {
  plan_key: string; inclus: boolean; films_par_mois: number; secondes_par_mois: number;
  duree_max_film_s: number; qualites: string[]; fonctionnalites: string[];
  budget_usd_par_mois: number | string; renouvellement: string;
}

export function depuisLigne(l: LigneFormule): FormuleCinema | null {
  const r = validerFormule({
    planKey: l.plan_key, inclus: l.inclus, filmsParMois: l.films_par_mois, secondesParMois: l.secondes_par_mois,
    dureeMaxFilmS: l.duree_max_film_s, qualites: l.qualites, fonctionnalites: l.fonctionnalites,
    budgetUsdParMois: Number(l.budget_usd_par_mois), renouvellement: l.renouvellement,
  });
  // Une ligne devenue invalide (saisie directe en base) n'ouvre RIEN : elle vaut non incluse.
  return r.ok ? r.formule : null;
}

export function versLigne(f: FormuleCinema): LigneFormule {
  return {
    plan_key: f.planKey, inclus: f.inclus, films_par_mois: f.filmsParMois, secondes_par_mois: f.secondesParMois,
    duree_max_film_s: f.dureeMaxFilmS, qualites: f.qualites, fonctionnalites: f.fonctionnalites,
    budget_usd_par_mois: f.budgetUsdParMois, renouvellement: f.renouvellement,
  };
}
