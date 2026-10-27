/**
 * CINEMA IA — EXECUTION D'UNE GENERATION, HORS DE LA REQUETE HTTP.
 *
 * La route ne fait plus que valider, RESERVER la generation (`suivi.ts`) et
 * repondre 202 en quelques millisecondes. Tout le reste — plafonds, debit des
 * credits AU DERNIER MOMENT, appel fournisseur, depot du media, remboursement
 * en cas d'echec, journal des depenses — vit ici, dans le processus Node de
 * longue duree (meme principe que `travaux/lanceur.ts`).
 *
 * La logique financiere est celle de la route d'avant, deplacee telle quelle :
 *   1. plafond de depense PAR COMPTE et GLOBAL reserve avant tout debit ;
 *   2. credits debites atomiquement juste avant l'appel payant ;
 *   3. echec apres paiement → credits rendus (idempotent) et depense
 *      confirmee / liberee / incertaine selon ce qui est prouve ;
 *   4. succes → depense confirmee, media depose, film mis a jour.
 * S'y ajoute : chaque etape est ECRITE sur la generation suivie, pour qu'un
 * rechargement, ou une interruption du serveur, ne perde jamais l'information.
 */
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { fichierDuMedia, remplacerMedia } from '@/lib/cinema/medias';
import type { ContexteCinema } from '@/lib/cinema/contexte';
import { avecDossierTemporaire } from '@/lib/cinema/routes-aide';
import { cleMedia } from '@/lib/cinema/stockage/cles';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { typeContenuDepuisCle } from '@/lib/storage/acces-objet';
import { reserverCredits, rembourserCredits, type Reservation } from '@/lib/cinema/generation/credits';
import { devisGeneration } from '@/lib/cinema/generation/couts';
import { reserverDepenseReplicate, confirmerDepenseReplicate, type StatutDepense } from '@/lib/cinema/generation/plafond-compte';
import { aRembourser, appliquerPatchGeneration, noterGeneration } from '@/lib/cinema/generation/suivi';
import type { GenerationSuivie, StatutGeneration } from '@/lib/cinema/types';

// Imports pour leur SEULE presence : ils enregistrent les fournisseurs dans le registre.
import '@/lib/cinema/generation/simule';
import '@/lib/cinema/generation/replicate';

export interface ParametresGeneration {
  ctx: Pick<ContexteCinema, 'films' | 'objets' | 'dossierTravail'>;
  userId: string;
  filmId: string;
  generation: GenerationSuivie;
  fournisseurId: string;
  plafondUsd: number;
}

const arrondi = (x: number) => Math.round(x * 10_000) / 10_000;

/** Execute UNE generation reservee. Ne leve jamais : l'issue est ecrite sur la generation. */
export async function executerGeneration(p: ParametresGeneration): Promise<StatutGeneration> {
  const { ctx, userId, filmId, generation, fournisseurId, plafondUsd } = p;
  const { planId, operation, mode } = generation;

  let reservation: Reservation | null = null;
  let depenseReservee: { reference: string; montantUsd: number } | null = null;

  const payer = mode !== 'reelle' ? undefined : async () => {
    const devisTentative = devisGeneration(fournisseurId, [{ planId, operations: [operation] }]);
    if (devisTentative.totalUsd !== null && devisTentative.totalUsd > 0) {
      const depense = await reserverDepenseReplicate(userId, devisTentative.totalUsd, operation);
      if (!depense.ok) return { ok: false as const, motif: depense.motif, message: depense.message };
      depenseReservee = { reference: depense.reference, montantUsd: depense.montantUsd };
    }
    const prise = await reserverCredits(userId, operation);
    if (!prise.ok) {
      if (depenseReservee) await confirmerDepenseReplicate(userId, depenseReservee.reference, 'liberee').catch(() => null);
      return { ok: false as const, motif: prise.motif, message: prise.message };
    }
    reservation = prise.reservation;
    // ⚠️ ECRIT AVANT L'APPEL PAYANT : si le processus meurt pendant l'appel, la generation
    // sera lue `interrompue` et ces credits seront rendus (reference = idempotence).
    if (prise.reservation.cout > 0) {
      await noterGeneration(ctx.films, filmId, userId, generation.id, {
        creditsPris: prise.reservation.cout, referenceCredits: prise.reservation.reference,
      });
    }
    return { ok: true as const };
  };

  try {
    const lu = await ctx.films.lire(filmId, userId);
    if (!lu) {
      await noterGeneration(ctx.films, filmId, userId, generation.id, { statut: 'echouee', erreur: 'film introuvable' });
      return 'echouee';
    }
    const film = lu.film;

    const resultat = await avecDossierTemporaire(ctx, async (racinePublique) => {
      const source = film.scenes.flatMap((x) => x.plans).find((pl) => pl.id === planId)?.media;
      if (source && source.genre === 'image') {
        const c = cleMedia(userId, film.id, source.url);
        if (c) await ctx.objets.telechargerVers(c, fichierDuMedia(racinePublique, source.url));
      }
      const r = await genererMediaPlan(film, planId, { fournisseurId, operation, racinePublique, plafondUsd, payer });
      if (!r.ok) return r;
      const cle = cleMedia(userId, film.id, r.media.url);
      if (!cle) return { ok: false as const, erreur: 'chemin de media refuse' };
      await ctx.objets.deposerFichier(cle, fichierDuMedia(racinePublique, r.media.url), typeContenuDepuisCle(cle));
      return r;
    });

    const res = reservation as Reservation | null;
    const dep = depenseReservee as { reference: string; montantUsd: number } | null;

    if (!resultat.ok) {
      // Paiement refuse : rien n'a ete appele ni preleve.
      if ('refusPaiement' in resultat && resultat.refusPaiement) {
        await noterGeneration(ctx.films, filmId, userId, generation.id, { statut: 'echouee', erreur: resultat.erreur });
        return 'echouee';
      }
      const engageUsd = ('depenseUsd' in resultat ? resultat.depenseUsd : 0) ?? 0;
      if (dep) {
        const statutDepense: StatutDepense = ('jamaisEnvoye' in resultat && resultat.jamaisEnvoye) ? 'liberee'
          : ('incertain' in resultat && resultat.incertain) ? 'incertaine' : 'confirmee';
        await confirmerDepenseReplicate(userId, dep.reference, statutDepense).catch(() => null);
      }
      let creditsRembourses: boolean | undefined;
      if (res && res.cout > 0) {
        const issue = await rembourserCredits(userId, res, operation);
        creditsRembourses = issue.ok;
        if (!issue.ok) console.error(`[Cinema] remboursement non prouve pour le film ${filmId} — motif : ${issue.motif ?? 'inconnu'}`);
      }
      await modifierFilm(ctx.films, filmId, userId, (f) => appliquerPatchGeneration({
        ...f,
        coutGenerationUsd: engageUsd > 0 ? arrondi((f.coutGenerationUsd ?? 0) + engageUsd) : f.coutGenerationUsd,
      }, generation.id, {
        statut: 'echouee', erreur: resultat.erreur,
        ...(res && res.cout > 0 ? { creditsPris: res.cout, creditsRembourses } : null),
      })).catch(() => null);
      return 'echouee';
    }

    if (dep) await confirmerDepenseReplicate(userId, dep.reference, 'confirmee').catch(() => null);

    const depense = arrondi((resultat.film.coutGenerationUsd ?? 0) - (film.coutGenerationUsd ?? 0));
    const refsUtilisees = new Map(resultat.film.scenes.flatMap((x) => x.plans).map((pl) => [pl.id, pl.referencesUtilisees] as const));
    const suivant = await modifierFilm(ctx.films, filmId, userId, (f) => {
      const avecMedia = remplacerMedia(f, planId, resultat.media);
      return appliquerPatchGeneration({
        ...avecMedia,
        coutGenerationUsd: arrondi((f.coutGenerationUsd ?? 0) + depense),
        scenes: avecMedia.scenes.map((x) => ({ ...x, plans: x.plans.map((pl) => pl.id !== planId ? pl : { ...pl, referencesUtilisees: refsUtilisees.get(pl.id) }) })),
      }, generation.id, { statut: 'reussie', erreur: null });
    }).catch(() => null);
    if (!suivant) {
      // Le film a disparu entre-temps : le media est jete, la depense reste comptee.
      const cle = cleMedia(userId, filmId, resultat.media.url);
      if (cle) await ctx.objets.supprimer(cle).catch(() => {});
      await noterGeneration(ctx.films, filmId, userId, generation.id, { statut: 'echouee', erreur: 'film modifie ou supprime pendant la generation' });
      return 'echouee';
    }
    return 'reussie';
  } catch (e) {
    // Ne doit pas arriver (chaque etape rend une valeur) — mais si cela arrive, l'etat
    // ne doit JAMAIS rester « en cours » : on le dit, et on rend ce qui a ete pris.
    console.error('[Cinema/Generation] execution interrompue —', e instanceof Error ? (e.stack ?? e.message) : e);
    const res = reservation as Reservation | null;
    let creditsRembourses: boolean | undefined;
    if (res && res.cout > 0) creditsRembourses = (await rembourserCredits(userId, res, operation).catch(() => ({ ok: false }))).ok;
    await noterGeneration(ctx.films, filmId, userId, generation.id, {
      statut: 'echouee', erreur: 'erreur interne pendant la generation',
      ...(res && res.cout > 0 ? { creditsPris: res.cout, creditsRembourses } : null),
    });
    return 'echouee';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Lancement en arriere-plan
// ─────────────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __cinemaGenerations?: Map<string, Promise<StatutGeneration>> };
const enCours = (): Map<string, Promise<StatutGeneration>> => (g.__cinemaGenerations ??= new Map());

/** Lance l'execution SANS l'attendre. Une meme generation n'est jamais lancee deux fois. */
export function lancerGeneration(p: ParametresGeneration): Promise<StatutGeneration> {
  const deja = enCours().get(p.generation.id);
  if (deja) return deja;
  const promesse = executerGeneration(p).finally(() => { enCours().delete(p.generation.id); });
  enCours().set(p.generation.id, promesse);
  return promesse;
}

/** Attend toutes les generations en cours (tests, arret propre). */
export async function attendreGenerations(): Promise<void> {
  await Promise.all([...enCours().values()]);
}

/**
 * Rend les credits des generations INTERROMPUES (serveur redemarre pendant l'appel).
 * Idempotent : la reference du remboursement derive de celle du debit.
 */
export async function solderGenerationsInterrompues(
  ctx: Pick<ContexteCinema, 'films'>, filmId: string, userId: string, film: Pick<import('@/lib/cinema/types').Film, 'generations'>,
): Promise<void> {
  for (const gen of aRembourser(film)) {
    const issue = await rembourserCredits(userId, { cout: gen.creditsPris ?? 0, reference: gen.referenceCredits as string }, gen.operation)
      .catch(() => ({ ok: false }));
    await noterGeneration(ctx.films, filmId, userId, gen.id, { statut: 'interrompue', creditsRembourses: issue.ok, erreur: gen.erreur ?? 'generation interrompue' });
  }
}
