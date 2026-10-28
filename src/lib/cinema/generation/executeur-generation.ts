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
import {
  aReconcilier, depenseAReconcilier, appliquerPatchGeneration, appliquerPatchTerminal, noterGeneration,
  renouvelerBailGeneration, statutEffectif, BAIL_GENERATION_S,
} from '@/lib/cinema/generation/suivi';
import type { Film, GenerationSuivie, StatutGeneration } from '@/lib/cinema/types';
import { regimeCinema, evaluerQuota } from '@/lib/cinema/abonnement/regime';
import { reserverQuota, confirmerQuota } from '@/lib/cinema/abonnement/depot';
import { messageRefus } from '@/lib/cinema/abonnement/quotas';
import { refusBudgetProjet } from '@/lib/cinema/abonnement/devis';

// Imports pour leur SEULE presence : ils enregistrent les fournisseurs dans le registre.
import '@/lib/cinema/generation/simule';
import '@/lib/cinema/generation/replicate';
// Declare, et eteint par ses trois conditions (`higgsfieldActif`) : sa seule presence dans
// le registre ne l'allume pas, et `garde.ts` ne le choisit que sur `CINEMA_FOURNISSEUR`.
import '@/lib/cinema/generation/higgsfield';

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
  /** Quota d'abonnement reserve pour CETTE generation (regime `abonnement` seulement). */
  let quotaReserve: string | null = null;
  let filmLu: Film | null = null;

  const payer = mode !== 'reelle' ? undefined : async () => {
    // Le regime est decide ICI, cote serveur, au dernier moment (`abonnement/regime.ts`).
    // Interrupteur `CINEMA_ABONNEMENTS` ferme : toujours `credits`, le chemin d'avant.
    const regime = await regimeCinema(userId);
    if (regime.type === 'refus') return { ok: false as const, motif: 'abonnement_illisible', message: regime.message };

    const devisTentative = devisGeneration(fournisseurId, [{ planId, operations: [operation] }]);
    const usd = devisTentative.totalUsd;
    const estimable = usd !== null && Number.isFinite(usd) && usd > 0;
    // Hors credits, aucun appel sans prix connu : ni l'admin ni l'abonne ne paient a l'aveugle.
    if (regime.type !== 'credits' && !estimable) {
      return { ok: false as const, motif: 'estimation_invalide', message: messageRefus('estimation_invalide') };
    }
    // Hors credits : aucune generation payante sans BUDGET DE PROJET approuve, et ce budget
    // borne la depense CUMULEE du film pendant toute la production (`abonnement/devis.ts`).
    if (regime.type !== 'credits') {
      const refus = refusBudgetProjet(filmLu, usd as number);
      if (refus) return { ok: false as const, motif: 'budget_projet', message: refus };
    }
    if (estimable) {
      // Plafonds de depense par compte et global : pour TOUS les regimes, admin compris.
      const depense = await reserverDepenseReplicate(userId, usd, operation);
      if (!depense.ok) return { ok: false as const, motif: depense.motif, message: depense.message };
      depenseReservee = { reference: depense.reference, montantUsd: depense.montantUsd };
    }
    const libererDepense = async () => {
      const d = depenseReservee as { reference: string } | null;
      if (d) await confirmerDepenseReplicate(userId, d.reference, 'liberee').catch(() => null);
    };
    // ⚠️ ECRIT AVANT L'APPEL PAYANT : une interruption doit pouvoir passer la depense et le
    // quota en `incertaine` (`solderGenerationsInterrompues`) — jamais les rendre.
    const noterReferences = async (referenceQuota?: string) => {
      const d = depenseReservee as { reference: string } | null;
      if (!d && !referenceQuota) return;
      await noterGeneration(ctx.films, filmId, userId, generation.id, {
        ...(d ? { referenceDepense: d.reference } : null), ...(referenceQuota ? { referenceQuota } : null),
      });
    };

    // Administrateur : le cout fournisseur reel, rien d'autre — ni credit, ni marge, ni quota.
    if (regime.type === 'cout_reel') { await noterReferences(); return { ok: true as const }; }

    if (regime.type === 'abonnement') {
      const film = filmLu as Film | null;
      if (!film) { await libererDepense(); return { ok: false as const, motif: 'film_absent', message: 'film introuvable' }; }
      const e = await evaluerQuota({ regime, userId, film, operation, usdEstime: usd as number });
      if (!e.ok) { await libererDepense(); return { ok: false as const, motif: 'quota', message: e.message }; }
      const reference = `cinema-quota:${generation.id}`;
      // L'AUTORITE : verrou en base, verification et increment dans la meme transaction.
      // Deux generations simultanees (ou un double clic) ne peuvent pas depasser le quota.
      const r = await reserverQuota({
        userId, periodeDebut: e.periode.debut, periodeFin: e.periode.fin, reference, filmId: film.id,
        dureeFilmS: e.dureeFilmS, usd: usd as number,
        maxFilms: e.decision.limites.maxFilms, maxSecondes: e.decision.limites.maxSecondes, maxUsd: e.decision.limites.maxUsd,
      });
      if (!r.ok) { await libererDepense(); return { ok: false as const, motif: 'quota', message: messageRefus(r.motif) }; }
      quotaReserve = reference;
      await noterReferences(reference);
      // Couverte par l'abonnement : AUCUN credit n'est pris en plus.
      return { ok: true as const };
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
      const d = depenseReservee as { reference: string } | null;
      await noterGeneration(ctx.films, filmId, userId, generation.id, {
        creditsPris: prise.reservation.cout, referenceCredits: prise.reservation.reference,
        ...(d ? { referenceDepense: d.reference } : null),
      });
    } else {
      await noterReferences();
    }
    return { ok: true as const };
  };

  // ⚠️ BATTEMENT DE COEUR — CORRECTIF SECURITE (voir `suivi.ts`, `statutEffectif`).
  // Renouvelle le bail PENDANT tout l'appel, au meme rythme que `travaux/executeur.ts`
  // (bailS / 3) : tant que ce processus est vivant, une generation video lente ne peut
  // jamais etre declaree interrompue — et donc remboursee — a sa place. Un battement
  // manque n'est pas une erreur : le suivant, ou l'ecriture finale gardee plus bas,
  // tranchera. `unref()` : ce minuteur ne doit jamais empecher le processus de sortir.
  const battement = setInterval(() => {
    renouvelerBailGeneration(ctx.films, filmId, userId, generation.id).catch(() => {});
  }, Math.max(1000, Math.floor((BAIL_GENERATION_S * 1000) / 3)));
  battement.unref?.();

  try {
    const lu = await ctx.films.lire(filmId, userId);
    if (!lu) {
      await noterGeneration(ctx.films, filmId, userId, generation.id, { statut: 'echouee', erreur: 'film introuvable' });
      return 'echouee';
    }
    const film = lu.film;
    filmLu = film;

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
        await conclureTerminal(ctx, filmId, userId, generation.id, { statut: 'echouee', erreur: resultat.erreur });
        return await statutFinal(ctx, filmId, userId, generation.id, 'echouee');
      }
      const engageUsd = ('depenseUsd' in resultat ? resultat.depenseUsd : 0) ?? 0;
      // `nonFacture` : issue que le fournisseur s'engage a ne pas facturer (`failed`,
      // `nsfw`, annulation avant traitement chez Higgsfield) — meme effet financier que
      // « jamais envoye », la reservation est liberee plutot que comptee. Un DELAI EXPIRE
      // n'est jamais une preuve : il rend `incertain`, donc `incertaine`.
      const statutDepense: StatutDepense = (('jamaisEnvoye' in resultat && resultat.jamaisEnvoye)
        || ('nonFacture' in resultat && resultat.nonFacture)) ? 'liberee'
        : ('incertain' in resultat && resultat.incertain) ? 'incertaine' : 'confirmee';
      if (dep) await confirmerDepenseReplicate(userId, dep.reference, statutDepense).catch(() => null);
      // Le quota suit EXACTEMENT la depense : libere seulement sur preuve de non-facturation,
      // compte s'il y a doute. Un echec d'ecriture laisse la reservation engagee — comptee,
      // jamais rendue a tort.
      const refQuotaEchec = quotaReserve as string | null;
      if (refQuotaEchec) await confirmerQuota(userId, refQuotaEchec, statutDepense).catch(() => false);
      // ⚠️ LE REMBOURSEMENT EST IDEMPOTENT (reference derivee du debit, `rembourserCredits`) :
      // le rejouer ici, meme si `solderGenerationsInterrompues` l'a deja fait entre-temps pour
      // la MEME generation, ne credite jamais deux fois.
      let creditsRembourses: boolean | undefined;
      if (res && res.cout > 0) {
        const issue = await rembourserCredits(userId, res, operation);
        creditsRembourses = issue.ok;
        if (!issue.ok) console.error(`[Cinema] remboursement non prouve pour le film ${filmId} — motif : ${issue.motif ?? 'inconnu'}`);
      }
      // ⚠️ ECRITURE GARDEE (CORRECTIF SECURITE) : si une reconciliation a deja declare cette
      // generation `interrompue` pendant cet appel (bail expire a tort, ou executeur juge mort
      // par erreur), ce resultat tardif ne doit PAS ecraser cet etat — la preuve du
      // remboursement deja applique serait sinon remplacee par un simple `echouee`.
      await conclureTerminal(ctx, filmId, userId, generation.id, {
        statut: 'echouee', erreur: resultat.erreur,
        ...(res && res.cout > 0 ? { creditsPris: res.cout, creditsRembourses } : null),
      }, (f) => ({
        ...f,
        coutGenerationUsd: engageUsd > 0 ? arrondi((f.coutGenerationUsd ?? 0) + engageUsd) : f.coutGenerationUsd,
      }));
      return await statutFinal(ctx, filmId, userId, generation.id, 'echouee');
    }

    if (dep) await confirmerDepenseReplicate(userId, dep.reference, 'confirmee').catch(() => null);
    const refQuota = quotaReserve as string | null;
    if (refQuota) await confirmerQuota(userId, refQuota, 'confirmee').catch(() => false);

    const depense = arrondi((resultat.film.coutGenerationUsd ?? 0) - (film.coutGenerationUsd ?? 0));
    const refsUtilisees = new Map(resultat.film.scenes.flatMap((x) => x.plans).map((pl) => [pl.id, pl.referencesUtilisees] as const));
    // ⚠️ ECRITURE GARDEE (CORRECTIF SECURITE) : le coeur du correctif. Un resultat REUSSI
    // qui arrive apres qu'une reconciliation a declare la generation `interrompue` (et
    // rembourse les credits) ne doit JAMAIS etre attache au film — l'utilisateur recevrait
    // alors la video ET ses credits rembourses, pendant que le compte Replicate du
    // proprietaire a bien ete facture. Le media est jete dans ce cas, jamais livre « gratuit ».
    const suivant = await appliquerPatchTerminal(ctx.films, filmId, userId, generation.id, { statut: 'reussie', erreur: null }, (f) => {
      const avecMedia = remplacerMedia(f, planId, resultat.media);
      return {
        ...avecMedia,
        coutGenerationUsd: arrondi((f.coutGenerationUsd ?? 0) + depense),
        scenes: avecMedia.scenes.map((x) => ({ ...x, plans: x.plans.map((pl) => pl.id !== planId ? pl : { ...pl, referencesUtilisees: refsUtilisees.get(pl.id) }) })),
      };
    }).catch(() => null);
    if (!suivant) {
      // Le media produit est jete dans TOUS les cas ou l'ecriture n'a pas ete appliquee :
      // film disparu, OU generation deja tranchee ailleurs (voir le commentaire ci-dessus).
      const cle = cleMedia(userId, filmId, resultat.media.url);
      if (cle) await ctx.objets.supprimer(cle).catch(() => {});
      // La depense Replicate reste comptee independamment de l'issue du media : le
      // fournisseur a bien ete facture, que le resultat soit livre ou jete.
      if (depense > 0) {
        await modifierFilm(ctx.films, filmId, userId, (f) => ({
          ...f, coutGenerationUsd: arrondi((f.coutGenerationUsd ?? 0) + depense),
        })).catch(() => null);
      }
      const actuel = await statutFinal(ctx, filmId, userId, generation.id, 'echouee');
      if (actuel !== 'echouee') return actuel; // deja interrompue (ou autre) ailleurs : on ne la reecrit pas
      await noterGeneration(ctx.films, filmId, userId, generation.id, { statut: 'echouee', erreur: 'film modifie, supprime, ou generation deja tranchee pendant le traitement' });
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
    await conclureTerminal(ctx, filmId, userId, generation.id, {
      statut: 'echouee', erreur: 'erreur interne pendant la generation',
      ...(res && res.cout > 0 ? { creditsPris: res.cout, creditsRembourses } : null),
    });
    return 'echouee';
  } finally {
    clearInterval(battement);
  }
}

/**
 * Applique un patch TERMINAL de facon GARDEE (`appliquerPatchTerminal`) : jamais par-dessus
 * un etat deja tranche ailleurs. Best-effort (n'a jamais fait echouer l'appelant).
 */
async function conclureTerminal(
  ctx: Pick<ContexteCinema, 'films'>, filmId: string, userId: string, id: string,
  patch: Parameters<typeof appliquerPatchTerminal>[4], surFilm?: (f: Film) => Film,
): Promise<void> {
  await appliquerPatchTerminal(ctx.films, filmId, userId, id, patch, surFilm).catch(() => null);
}

/**
 * Le statut REEL d'une generation apres une tentative d'ecriture terminale — qu'elle ait
 * ete appliquee ou non (deja tranchee ailleurs). `repli` est rendu si la generation est
 * introuvable (film disparu). Sert a ce que l'appelant ne declare JAMAIS un statut qu'il
 * n'a pas reellement obtenu.
 */
async function statutFinal(
  ctx: Pick<ContexteCinema, 'films'>, filmId: string, userId: string, id: string, repli: StatutGeneration,
): Promise<StatutGeneration> {
  const relu = await ctx.films.lire(filmId, userId).catch(() => null);
  const g = relu?.film.generations?.find((x) => x.id === id);
  return g ? statutEffectif(g) : repli;
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
 * Rend les credits des generations INTERROMPUES (serveur redemarre pendant l'appel, ou
 * bail realistement expire). Idempotent : la reference du remboursement derive de celle
 * du debit.
 *
 * ⚠️ CORRECTIF SECURITE : NE DECIDE JAMAIS sur l'instantane `film` recu (potentiellement
 * perime des l'instant ou cette fonction est appelee). Il ne sert qu'a eviter une lecture
 * pour le cas courant — « rien a faire ». Des qu'un candidat existe, tout est RE-VERIFIE
 * sur une lecture FRAICHE avant le remboursement, et l'ECRITURE est GARDEE (atomique,
 * rejouee sur conflit) : si l'executeur a conclu `reussie`/`echouee` entre-temps, cette
 * fonction ne l'ecrase jamais — et inversement, l'executeur qui conclut APRES cette
 * ecriture trouvera la generation deja `interrompue` et jettera son resultat au lieu de
 * l'attacher (voir `executerGeneration`).
 */
export async function solderGenerationsInterrompues(
  ctx: Pick<ContexteCinema, 'films'>, filmId: string, userId: string, film: Pick<Film, 'generations'>,
): Promise<void> {
  if (!aReconcilier(film).length) return; // rien a faire sur cet instantane : pas la peine de relire
  const frais = await ctx.films.lire(filmId, userId).catch(() => null);
  if (!frais) return;
  const creditsDus = (g: GenerationSuivie) => (g.creditsPris ?? 0) > 0 && !!g.referenceCredits && g.creditsRembourses !== true;
  for (const gen of aReconcilier(frais.film)) {
    // ⚠️ ORDRE CRITIQUE (CORRECTIF SECURITE) : on REVENDIQUE D'ABORD, de facon ATOMIQUE
    // (ecriture gardee, rejouee sur conflit par `modifierFilm`), le droit de conclure cette
    // generation comme interrompue — et seulement SI cette revendication reussit, on
    // rembourse. Inverser l'ordre (rembourser PUIS ecrire) rembourserait a tort une
    // generation que l'executeur vient de livrer avec succes ENTRE les deux : le
    // remboursement, lui, n'est pas annulable apres coup.
    const revendique = await modifierFilm(ctx.films, filmId, userId, (f) => {
      const g = (f.generations ?? []).find((x) => x.id === gen.id);
      if (!g) return null;
      if (g.statut === 'interrompue') {
        // Deja revendiquee (appel concurrent anterieur, ou tentative precedente dont le
        // remboursement avait echoue) : pas de nouvelle ecriture ici, juste l'autorisation
        // de retenter le remboursement plus bas (la boucle `aRembourser` ne retient que
        // les generations pas encore `creditsRembourses === true`).
        return creditsDus(g) || depenseAReconcilier(g) ? f : null;
      }
      // Conclue ailleurs ENTRE la lecture fraiche ci-dessus et cette ecriture (l'executeur
      // a fini, ou a renouvele son bail) : cette reconciliation ne doit RIEN ecraser, et ne
      // doit SURTOUT PAS rembourser ce qui vient d'etre livre.
      if (g.statut !== 'en_cours' || statutEffectif(g) !== 'interrompue') return null;
      return appliquerPatchGeneration(f, gen.id, {
        statut: 'interrompue', erreur: g.erreur ?? 'generation interrompue', bailJusqua: null,
      });
    }).catch(() => null);
    if (!revendique) continue; // deja remboursee, ou conclue ailleurs : ne JAMAIS rembourser dans ce cas

    if (creditsDus(gen)) {
      const issue = await rembourserCredits(userId, { cout: gen.creditsPris ?? 0, reference: gen.referenceCredits as string }, gen.operation)
        .catch(() => ({ ok: false }));
      await modifierFilm(ctx.films, filmId, userId, (f) => {
        const g = (f.generations ?? []).find((x) => x.id === gen.id);
        if (!g || g.statut !== 'interrompue') return null; // ecrit juste au-dessus : ne devrait pas arriver
        return appliquerPatchGeneration(f, gen.id, { creditsRembourses: issue.ok });
      }).catch(() => null);
    }

    // ⚠️ DEPENSE ET QUOTA : `incertaine`, JAMAIS `liberee`. L'appel a pu partir et etre
    // facture : rien ne prouve le contraire. La depense reste comptee (plafond du compte)
    // et le quota aussi, jusqu'a une preuve — l'executeur qui conclurait plus tard les
    // reclasse lui-meme (`confirmee`, ou `liberee` sur preuve de non-facturation). Une
    // issue deja definitive (`deja_finalisee`) n'est jamais ecrasee.
    if (depenseAReconcilier(gen)) {
      const regles: boolean[] = [];
      if (gen.referenceDepense) {
        const r = await confirmerDepenseReplicate(userId, gen.referenceDepense, 'incertaine').catch(() => null);
        regles.push(!!r && (r.ok || r.motif === 'deja_finalisee' || r.motif === 'reference_absente'));
      }
      if (gen.referenceQuota) {
        const r = await confirmerQuota(userId, gen.referenceQuota, 'incertaine').catch(() => ({ ok: false, motif: 'transport' }));
        regles.push(r.ok || r.motif === 'deja_finalisee' || r.motif === 'reference_absente');
      }
      // Base injoignable : on retentera au prochain passage, rien n'est marque a tort.
      if (regles.every(Boolean)) {
        await modifierFilm(ctx.films, filmId, userId, (f) => {
          const g = (f.generations ?? []).find((x) => x.id === gen.id);
          if (!g || g.statut !== 'interrompue') return null;
          return appliquerPatchGeneration(f, gen.id, { depenseReconciliee: true });
        }).catch(() => null);
      }
    }
  }
}
