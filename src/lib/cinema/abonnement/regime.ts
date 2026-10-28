/**
 * CINEMA IA — QUI PAIE UNE GENERATION REELLE, ET COMMENT. Decide COTE SERVEUR uniquement.
 *
 *   - `credits`    : le comportement d'AVANT, inchange. C'est le regime de tout compte tant
 *                    que `CINEMA_ABONNEMENTS` n'est pas allume, et de tout compte dont la
 *                    formule n'inclut pas Cinema (ou n'est pas configuree).
 *   - `cout_reel`  : administrateur. Reconnu par l'email RELU EN BASE depuis l'identifiant
 *                    de session (`isAdmin`), jamais par une indication du navigateur. Ni
 *                    credit, ni quota, ni marge : le cout fournisseur reel, sous les plafonds
 *                    de depense par film, par compte et global, qui restent appliques.
 *   - `abonnement` : la formule active inclut Cinema. La generation est couverte — elle n'est
 *                    JAMAIS facturee en credits en plus — ou REFUSEE si elle ne tient pas
 *                    dans le quota. Aucune bascule automatique vers les credits.
 *   - `refus`      : la situation n'est pas lisible (base indisponible). Rien n'est lance :
 *                    retomber sur les credits ferait payer deux fois un abonne.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import type { Film } from '@/lib/cinema/types';
import { dureeFilm } from '@/lib/cinema/types';
import { lireFormules, lireConsommation, type LectureFormules } from '@/lib/cinema/abonnement/depot';
import type { FonctionnaliteCinema, FormuleCinema } from '@/lib/cinema/abonnement/formules';
import {
  decider, periodeQuota, resumeQuota, type DecisionQuota, type Periode, type ResumeQuota,
} from '@/lib/cinema/abonnement/quotas';

/** Interrupteur general, FERME par defaut : eteint, rien ne change pour personne. */
export function abonnementsCinemaActifs(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CINEMA_ABONNEMENTS?.trim().toLowerCase() === 'true';
}

export type RegimeCinema =
  | { type: 'credits' }
  | { type: 'cout_reel' }
  | { type: 'abonnement'; planKey: string; formule: FormuleCinema; periode: Periode | null }
  | { type: 'refus'; message: string };

export interface LigneAbonnement { plan: string; status: string; current_period_end: string | null }

/** Les lectures, injectables pour les tests. `null` = illisible. */
export interface SourcesRegime {
  email(userId: string): Promise<string | null>;
  abonnements(userId: string): Promise<LigneAbonnement[] | null>;
  formules(): Promise<LectureFormules>;
  estAdmin(email: string | null): Promise<boolean>;
}

export const SOURCES_BASE: SourcesRegime = {
  async email(userId) {
    const { data, error } = await supabaseAdmin.from('users').select('email').eq('id', userId);
    if (error) return null;
    const e = ((data ?? []) as Array<{ email?: unknown }>)[0]?.email;
    return typeof e === 'string' ? e : null;
  },
  async abonnements(userId) {
    const { data, error } = await supabaseAdmin.from('subscriptions')
      .select('plan, status, current_period_end').eq('user_id', userId);
    return error ? null : ((data ?? []) as LigneAbonnement[]);
  },
  formules: lireFormules,
  // Import differe : `lib/admin` charge la configuration d'authentification, inutile tant
  // que l'interrupteur est ferme. La liste des admins reste UNIQUE (`lib/admin.ts`).
  async estAdmin(email) { return (await import('@/lib/admin')).isAdmin(email); },
};

/** Seuls ces statuts ouvrent un quota. `past_due` (paiement en echec) n'en ouvre pas. */
const STATUTS_QUOTA = new Set(['active', 'trialing']);
const RANG: Record<string, number> = { starter: 1, pro: 2, enterprise: 3 };

const ILLISIBLE = 'Votre abonnement n’a pas pu etre verifie : rien n’a ete lance ni debite. Reessayez dans un instant.';

export async function regimeCinema(
  userId: string,
  o: { sources?: SourcesRegime; env?: NodeJS.ProcessEnv; maintenant?: Date } = {},
): Promise<RegimeCinema> {
  if (!abonnementsCinemaActifs(o.env)) return { type: 'credits' };
  const src = o.sources ?? SOURCES_BASE;

  // Un email illisible n'est JAMAIS un administrateur : pas de passe-droit par defaut.
  if (await src.estAdmin(await src.email(userId))) return { type: 'cout_reel' };

  const lecture = await src.formules();
  if (!lecture.disponible) {
    // Table absente = aucune formule configuree = comportement actuel. Toute autre erreur
    // est un ETAT INCONNU : on ne fait pas payer en credits ce qui est peut-etre inclus.
    return lecture.raison === 'migration_absente' ? { type: 'credits' } : { type: 'refus', message: ILLISIBLE };
  }
  if (lecture.formules.size === 0) return { type: 'credits' };

  const lignes = await src.abonnements(userId);
  if (lignes === null) return { type: 'refus', message: ILLISIBLE };

  // Le meilleur abonnement qui OUVRE des droits ; sans lui, la formule gratuite.
  let actif: LigneAbonnement | null = null;
  for (const l of lignes) {
    if (!STATUTS_QUOTA.has(l.status) || !(l.plan in RANG)) continue;
    if (!actif || RANG[l.plan] > RANG[actif.plan]) actif = l;
  }
  const planKey = actif?.plan ?? 'free';
  const formule = lecture.formules.get(planKey);
  if (!formule || !formule.inclus) return { type: 'credits' };

  const periode = periodeQuota(formule.renouvellement, actif ? { fin: actif.current_period_end } : null, o.maintenant ?? new Date());
  return { type: 'abonnement', planKey, formule, periode };
}

export const fonctionnaliteDe = (operation: 'image' | 'video'): FonctionnaliteCinema =>
  (operation === 'image' ? 'image_ia' : 'animation_video');

/** Duree du projet en secondes ENTIERES, arrondie au-dessus : on ne sous-compte jamais. */
export const dureeProjetS = (film: Pick<Film, 'scenes'>): number => Math.ceil(dureeFilm(film));

export const MESSAGE_PERIODE = 'La periode de votre abonnement n’a pas pu etre verifiee : aucun nouveau quota n’est accorde. '
  + 'Reessayez apres le renouvellement, ou contactez le support.';

export type EvaluationQuota =
  | { ok: false; message: string; resume: ResumeQuota | null }
  | { ok: true; decision: Extract<DecisionQuota, { ok: true; regime: 'abonnement' }>; periode: Periode; resume: ResumeQuota; dureeFilmS: number };

/**
 * L'operation tient-elle dans le quota ? Lecture SEULE : l'autorite reste la reservation
 * atomique en base. Sert au refus immediat (route) et au controle qualitatif (executeur).
 */
export async function evaluerQuota(args: {
  regime: Extract<RegimeCinema, { type: 'abonnement' }>;
  userId: string;
  film: Pick<Film, 'id' | 'scenes' | 'qualite'>;
  operation: 'image' | 'video';
  usdEstime: number;
  lire?: typeof lireConsommation;
}): Promise<EvaluationQuota> {
  const { regime, film } = args;
  if (!regime.periode) return { ok: false, message: MESSAGE_PERIODE, resume: null };
  const conso = await (args.lire ?? lireConsommation)(args.userId, regime.periode.debut, film.id);
  if (!conso) return { ok: false, message: ILLISIBLE, resume: null };
  const resume = resumeQuota(regime.formule, conso);
  const dureeFilmS = dureeProjetS(film);
  const d = decider({
    regime: 'abonnement', formule: regime.formule, consommation: conso,
    demande: {
      filmDejaCompte: conso.film.compte, secondesDejaReservees: conso.film.secondes, dureeFilmS,
      qualite: film.qualite, fonctionnalite: fonctionnaliteDe(args.operation), usdEstime: args.usdEstime,
    },
  });
  if (!d.ok) return { ok: false, message: d.message, resume };
  if (d.regime !== 'abonnement') return { ok: false, message: ILLISIBLE, resume };
  return { ok: true, decision: d, periode: regime.periode, resume, dureeFilmS };
}
