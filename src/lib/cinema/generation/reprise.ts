/**
 * CINEMA IA — REPRISE D'UNE GENERATION INTERROMPUE PAR UN ARRET DU SERVEUR.
 *
 * Le fournisseur ne s'arrete pas avec nous : une demande acceptee peut finir — et etre
 * FACTUREE — pendant que le serveur redemarre. Sans reprise, ce film paye etait perdu.
 *
 * Ce module RELIT la demande chez le fournisseur grace a l'identifiant ecrit des
 * l'acceptation (`SoumissionExterne.idExterne`). Il ne RESOUMET JAMAIS rien : aucun nouvel
 * appel payant, quelle que soit l'issue.
 *
 *   - termine         → media recupere, controle comme une generation (`importerResultat-
 *                       Fournisseur`), LIVRE sous ecriture gardee (aucun credit pris, plan
 *                       inchange, une seule fois) ; depense et quota `confirmee` (facture) ;
 *   - echec           → `liberee` SEULEMENT si le fournisseur s'engage par ecrit a ne pas
 *                       facturer (`nonFacture`), sinon `confirmee` ;
 *   - en cours / injoignable → rien n'est conclu, on retentera ;
 *   - sans identifiant, introuvable, expiree → la depense reste `incertaine` : on ne
 *     l'annonce JAMAIS remboursee sans preuve, et on le dit.
 *
 * Deux reprises simultanees : un BAIL (jeton + echeance) sur la generation, pose par une
 * ecriture gardee ; seule la reprise qui le detient peut conclure.
 */
import { randomUUID } from 'crypto';
import type { ContexteCinema } from '@/lib/cinema/contexte';
import { avecDossierTemporaire } from '@/lib/cinema/dossier-temporaire';
import { cleMedia } from '@/lib/cinema/stockage/cles';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { remplacerMedia } from '@/lib/cinema/medias';
import { typeContenuDepuisCle } from '@/lib/storage/acces-objet';
import { fournisseurGeneration, type EtatExterne, type FournisseurGenerationIA } from '@/lib/cinema/generation/fournisseur';
import { importerResultatFournisseur } from '@/lib/cinema/generation/atelier';
import { confirmerDepenseReplicate, type StatutDepense } from '@/lib/cinema/generation/plafond-compte';
import { confirmerQuota } from '@/lib/cinema/abonnement/depot';
import {
  appliquerPatchGeneration, generationsDuFilm, MESSAGE_LIVRE_APRES_INTERRUPTION,
  MESSAGE_NON_LIVRE_CREDITS, MESSAGE_NON_LIVRE_REMPLACE,
} from '@/lib/cinema/generation/suivi';
import type { EtatReprise, Film, GenerationSuivie } from '@/lib/cinema/types';

/** Duree du bail d'une reprise : au-dela, une autre peut reprendre la main. */
export const BAIL_REPRISE_S = 300;
/** Au-dela, le fournisseur ne conserve plus le resultat (Higgsfield : 7 jours). */
export const DUREE_REPRISE_MAX_MS = 7 * 24 * 3600 * 1000;

const FINAUX: ReadonlySet<EtatReprise> = new Set<EtatReprise>([
  'livree', 'non_livree', 'echec_non_facture', 'echec_facture', 'introuvable', 'expiree',
]);

export const MESSAGES_REPRISE = {
  verification: 'Generation interrompue : son resultat est en cours de verification. Aucun nouvel appel n’est lance.',
  sansIdentifiant: 'Generation interrompue avant confirmation : elle ne peut pas etre verifiee. Son cout eventuel reste compte jusqu’a verification ; aucun nouvel appel n’a ete lance.',
  introuvable: 'Generation interrompue : le resultat est introuvable. Son cout eventuel reste compte jusqu’a verification ; aucun nouvel appel n’a ete lance.',
  expiree: 'Generation interrompue : le resultat n’est plus disponible. Son cout eventuel reste compte jusqu’a verification.',
  echecNonFacture: 'La generation a echoue apres l’interruption, sans etre facturee : rien n’est compte.',
  echecFacture: 'La generation a echoue apres l’interruption ; son cout reste compte.',
  mediaInvalide: 'Le resultat recupere apres l’interruption est illisible : il n’a pas ete livre ; son cout reste compte.',
} as const;

export interface DependancesReprise {
  fournisseur?: (id: string) => FournisseurGenerationIA | null;
  confirmerDepense?: typeof confirmerDepenseReplicate;
  confirmerQuota?: typeof confirmerQuota;
  maintenant?: () => number;
}

const arrondi = (x: number) => Math.round(x * 10_000) / 10_000;

/** Une generation interrompue, reelle, dont la soumission est connue et pas encore conclue. */
export function aReprendre(film: Pick<Film, 'generations'>, maintenant = Date.now()): GenerationSuivie[] {
  return generationsDuFilm(film, maintenant).filter((g) => g.statut === 'interrompue' && g.mode === 'reelle'
    && !!g.externe && !FINAUX.has(g.reprise?.etat as EtatReprise) && bailLibre(g, maintenant));
}

function bailLibre(g: GenerationSuivie, maintenant: number): boolean {
  if (g.reprise?.etat !== 'en_cours' || !g.reprise.bailJusqua) return true;
  const fin = Date.parse(g.reprise.bailJusqua);
  return !Number.isFinite(fin) || maintenant > fin;
}

export type IssueReprise = { id: string; etat: EtatReprise | 'non_prise' };

export async function reprendreGenerationsInterrompues(
  ctx: Pick<ContexteCinema, 'films' | 'objets' | 'dossierTravail'>, filmId: string, userId: string,
  dep: DependancesReprise = {},
): Promise<IssueReprise[]> {
  const lu = await ctx.films.lire(filmId, userId).catch(() => null);
  if (!lu) return [];
  const issues: IssueReprise[] = [];
  for (const g of aReprendre(lu.film, (dep.maintenant ?? Date.now)())) {
    issues.push({ id: g.id, etat: await reprendreUne(ctx, filmId, userId, g.id, dep) });
  }
  return issues;
}

async function reprendreUne(
  ctx: Pick<ContexteCinema, 'films' | 'objets' | 'dossierTravail'>, filmId: string, userId: string, id: string,
  dep: DependancesReprise,
): Promise<EtatReprise | 'non_prise'> {
  const maintenant = dep.maintenant ?? Date.now;
  const jeton = randomUUID();

  // ── 1. Le BAIL : une seule reprise a la fois, par ecriture gardee ──────────
  let g: GenerationSuivie | null = null;
  const pris = await modifierFilm(ctx.films, filmId, userId, (f) => {
    g = null;
    const x = (f.generations ?? []).find((y) => y.id === id);
    const t = maintenant();
    if (!x || x.statut !== 'interrompue' || !x.externe || FINAUX.has(x.reprise?.etat as EtatReprise) || !bailLibre(x, t)) return null;
    const reprise = {
      etat: 'en_cours' as const, tentatives: (x.reprise?.tentatives ?? 0) + 1, derniereLe: new Date(t).toISOString(),
      jeton, bailJusqua: new Date(t + BAIL_REPRISE_S * 1000).toISOString(),
    };
    g = { ...x, reprise };
    return appliquerPatchGeneration(f, id, { reprise });
  }).catch(() => null);
  const gen = g as GenerationSuivie | null;
  if (!pris || !gen || !gen.externe) return 'non_prise';
  const externe = gen.externe;

  /** Conclut (ou relache) SOUS le bail : rien n'est ecrit si une autre reprise l'a repris. */
  const conclure = async (etat: EtatReprise, message: string, surFilm?: (f: Film) => Film, statut?: 'reussie') => {
    await modifierFilm(ctx.films, filmId, userId, (f) => {
      const x = (f.generations ?? []).find((y) => y.id === id);
      if (!x || x.statut !== 'interrompue' || x.reprise?.jeton !== jeton) return null;
      const base = surFilm ? surFilm(f) : f;
      return appliquerPatchGeneration(base, id, {
        erreur: message, ...(statut ? { statut } : null),
        reprise: { etat, tentatives: x.reprise.tentatives, derniereLe: new Date(maintenant()).toISOString(), jeton: null, bailJusqua: null },
      });
    }).catch(() => null);
    return etat;
  };
  const ajouterCout = (f: Film): Film => (externe.coutEstimeUsd > 0
    ? { ...f, coutGenerationUsd: arrondi((f.coutGenerationUsd ?? 0) + externe.coutEstimeUsd) } : f);
  const solder = async (statut: StatutDepense) => {
    if (gen.referenceDepense) await (dep.confirmerDepense ?? confirmerDepenseReplicate)(userId, gen.referenceDepense, statut).catch(() => null);
    if (gen.referenceQuota) await (dep.confirmerQuota ?? confirmerQuota)(userId, gen.referenceQuota, statut).catch(() => null);
  };

  // ── 2. Ce qui ne peut pas etre verifie reste `incertaine`, et c'est dit ──────
  if (!externe.idExterne) return conclure('introuvable', MESSAGES_REPRISE.sansIdentifiant);
  const soumis = Date.parse(externe.soumisLe);
  if (Number.isFinite(soumis) && maintenant() - soumis > DUREE_REPRISE_MAX_MS) return conclure('expiree', MESSAGES_REPRISE.expiree);
  const fournisseur = (dep.fournisseur ?? fournisseurGeneration)(externe.fournisseurId);
  if (!fournisseur?.consulter) return conclure('introuvable', MESSAGES_REPRISE.introuvable);

  // ── 3. LECTURE SEULE chez le fournisseur ─────────────────────────────────────
  const etat: EtatExterne = await fournisseur.consulter(externe.idExterne, gen.operation)
    .catch((e) => ({ etat: 'injoignable' as const, erreur: e instanceof Error ? e.message : 'lecture impossible' }));

  switch (etat.etat) {
    case 'en_cours':
    case 'injoignable':
      return conclure('a_verifier', MESSAGES_REPRISE.verification);
    case 'introuvable':
      return conclure('introuvable', MESSAGES_REPRISE.introuvable);
    case 'echec':
      // `liberee` SEULEMENT sur engagement ecrit du fournisseur ; sinon facture.
      await solder(etat.nonFacture ? 'liberee' : 'confirmee');
      return etat.nonFacture
        ? conclure('echec_non_facture', MESSAGES_REPRISE.echecNonFacture)
        : conclure('echec_facture', MESSAGES_REPRISE.echecFacture, ajouterCout);
    case 'termine':
      break;
  }

  // ── 4. Le media EXISTE : il a ete facture ────────────────────────────────────
  await solder('confirmee');
  const fichier = (etat as Extract<EtatExterne, { etat: 'termine' }>).fichier;
  const nomSuggere = (etat as Extract<EtatExterne, { etat: 'termine' }>).nomSuggere;
  const frais = await ctx.films.lire(filmId, userId).catch(() => null);
  if (!frais) return 'non_prise';

  return avecDossierTemporaire(ctx, async (racinePublique) => {
    const r = await importerResultatFournisseur({
      film: frais.film, planId: gen.planId, fichier, nomSuggere, racinePublique,
      fournisseurId: externe.fournisseurId, coutUsd: externe.coutEstimeUsd,
      // La direction ENVOYEE (figee a la soumission), jamais celle du film d'aujourd'hui.
      direction: externe.direction ?? null,
    });
    if (!r.ok) return conclure('non_livree', MESSAGES_REPRISE.mediaInvalide, ajouterCout);
    const cle = cleMedia(userId, filmId, r.media.url);
    if (!cle) return conclure('non_livree', MESSAGES_REPRISE.mediaInvalide, ajouterCout);
    const { fichierDuMedia } = await import('@/lib/cinema/medias');
    await ctx.objets.deposerFichier(cle, fichierDuMedia(racinePublique, r.media.url), typeContenuDepuisCle(cle));

    // ── 5. LIVRAISON GARDEE : meme regle qu'un resultat tardif (`suivi.ts`) ───────
    const refs = r.film.scenes.flatMap((s) => s.plans).find((p) => p.id === gen.planId)?.referencesUtilisees;
    let raison: 'credits' | 'remplace' | 'bail' | null = null;
    const livre = await modifierFilm(ctx.films, filmId, userId, (f) => {
      raison = null;
      const x = (f.generations ?? []).find((y) => y.id === id);
      if (!x || x.statut !== 'interrompue' || x.reprise?.jeton !== jeton) { raison = 'bail'; return null; }
      if ((x.creditsPris ?? 0) > 0) { raison = 'credits'; return null; }
      const plan = f.scenes.flatMap((s) => s.plans).find((p) => p.id === gen.planId);
      if (!plan || (plan.media?.url ?? null) !== externe.mediaAvantUrl) { raison = 'remplace'; return null; }
      const avecMedia = remplacerMedia(ajouterCout(f), gen.planId, r.media);
      const film = {
        ...avecMedia,
        scenes: avecMedia.scenes.map((s) => ({ ...s, plans: s.plans.map((p) => (p.id !== gen.planId ? p : { ...p, referencesUtilisees: refs })) })),
      };
      return appliquerPatchGeneration(film, id, {
        statut: 'reussie', erreur: MESSAGE_LIVRE_APRES_INTERRUPTION,
        reprise: { etat: 'livree', tentatives: x.reprise.tentatives, derniereLe: new Date(maintenant()).toISOString(), jeton: null, bailJusqua: null },
      });
    }).catch(() => null);
    if (livre) return 'livree';

    // Non livre : le media est retire du stockage, la raison est DITE, le cout compte.
    await ctx.objets.supprimer(cle).catch(() => {});
    if (raison === 'bail' || raison === null) return 'non_prise';
    return conclure('non_livree', raison === 'credits' ? MESSAGE_NON_LIVRE_CREDITS : MESSAGE_NON_LIVRE_REMPLACE, ajouterCout);
  });
}
