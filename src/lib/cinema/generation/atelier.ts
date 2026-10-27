/**
 * GENERATION IA — un plan a la fois, toujours derriere le plafond.
 *
 * L'enchainement, dans cet ordre et pas un autre :
 *
 *   1. le fournisseur doit etre DECLARE et ACTIF — un fournisseur eteint
 *      (tout vrai fournisseur payant, aujourd'hui) est refuse ICI, avant la
 *      moindre construction de prompt ;
 *   2. le DEVIS de l'operation est calcule (`generation/couts.ts`) ;
 *   3. le PLAFOND est verifie — un cout inconnu ou un depassement refuse
 *      AVANT tout appel au fournisseur, jamais apres ;
 *   4. le fournisseur produit un fichier LOCAL ;
 *   5. ce fichier passe par `medias.importerMedia`, EXACTEMENT comme un
 *      import manuel (lot 2) : signature, extension, ffprobe, cadrage — rien
 *      n'est differencie parce que l'origine est « genere » plutot
 *      qu'« import ».
 *
 * Ce module ne persiste rien (`store.enregistrerFilm` reste a l'appelant,
 * comme pour `medias.importerMedia`) et ne touche a AUCUN credit Studiio :
 * le plafond protege une depense FOURNISSEUR hypothetique, independante du
 * systeme de credits (`lib/credits/*`), auquel ce lot ne touche pas.
 */
import { readFile, rm } from 'fs/promises';
import { construirePromptImage } from '@/lib/ai/prompt-image';
import { referenceActive } from '@/lib/cinema/personnages';
import { fichierDuMedia, importerMedia, remplacerMedia } from '@/lib/cinema/medias';
import {
  devisGeneration, PLAFOND_USD_PAR_FILM_DEFAUT, verifierPlafond, type VerificationPlafond,
} from '@/lib/cinema/generation/couts';
import {
  fournisseurGeneration, type ApparencePersonnageGeneration, type OperationGenerationIA,
} from '@/lib/cinema/generation/fournisseur';
import type { Film, MediaPlan, PlanCinema } from '@/lib/cinema/types';

// Side-effect : enregistre le fournisseur simule dans le registre partage.
// Importe ICI (et non seulement par la route) pour que tout appelant de
// `genererMediaPlan` — route, banc de test, futur script — trouve le
// registre deja peuple, sans dependre de l'ordre d'import ailleurs.
import '@/lib/cinema/generation/simule';

export interface OptionsGenerationPlan {
  fournisseurId: string;
  operation: OperationGenerationIA;
  racinePublique: string;
  /** Plafond de depense POUR CE FILM. Defaut : `PLAFOND_USD_PAR_FILM_DEFAUT`. */
  plafondUsd?: number;
  /** Graine de reproductibilite. Defaut : derivee de l'id du plan (stable). */
  graine?: number;
}

export type ResultatGenerationPlan =
  | { ok: true; film: Film; media: MediaPlan }
  | { ok: false; erreur: string; verification?: VerificationPlafond };

/** Les apparences des personnages PRESENTS dans un plan, dans la forme qu'un fournisseur recoit. */
export function apparencesDuPlan(film: Film, plan: Pick<PlanCinema, 'personnages'>): ApparencePersonnageGeneration[] {
  return plan.personnages
    .map((id) => film.personnages.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const ref = referenceActive(p);
      return { id: p.id, nom: p.nom, description: ref?.description ?? '', urlImage: ref?.urlImage ?? null };
    });
}

/** Graine stable : deux appels sur le MEME plan, sans graine fournie, redemandent la meme chose. */
function graineParDefaut(planId: string): number {
  let h = 0;
  for (let i = 0; i < planId.length; i++) h = (h * 31 + planId.charCodeAt(i)) >>> 0;
  return h;
}

export async function genererMediaPlan(film: Film, planId: string, options: OptionsGenerationPlan): Promise<ResultatGenerationPlan> {
  const plafondUsd = options.plafondUsd ?? PLAFOND_USD_PAR_FILM_DEFAUT;

  // ── 1. Fournisseur declare et ACTIF — sinon, rien d'autre ne se calcule.
  const fournisseur = fournisseurGeneration(options.fournisseurId);
  if (!fournisseur) return { ok: false, erreur: `fournisseur inconnu : ${options.fournisseurId}` };
  if (!fournisseur.actif) {
    return { ok: false, erreur: `fournisseur « ${fournisseur.libelle} » non branche : aucune generation payante n'est autorisee dans ce lot` };
  }

  const plan = film.scenes.flatMap((s) => s.plans).find((p) => p.id === planId);
  if (!plan) return { ok: false, erreur: 'plan inconnu' };

  // Une video se genere DEPUIS une image : celle deja presente sur le plan.
  // Pas d'enchainement automatique image+video en un seul appel — deux
  // appels explicites, deux devis distincts, deux lignes dans le plafond.
  if (options.operation === 'video' && (!plan.media || plan.media.genre !== 'image')) {
    return { ok: false, erreur: 'une video se genere depuis une image : generez d’abord une image pour ce plan' };
  }

  // ── 2. Devis de CETTE operation ────────────────────────────────────────
  const devis = devisGeneration(fournisseur.id, [{ planId, operations: [options.operation] }]);

  // ── 3. Plafond — AVANT tout appel fournisseur ──────────────────────────
  const verification = verifierPlafond({
    dejaDepenseUsd: film.coutGenerationUsd ?? 0,
    coutProposeUsd: devis.totalUsd,
    plafondUsd,
  });
  if (!verification.autorise) return { ok: false, erreur: verification.motif ?? 'generation refusee', verification };

  const graine = options.graine ?? graineParDefaut(planId);

  // ── 4. Le fournisseur produit un fichier LOCAL ─────────────────────────
  let fichierTemporaire: string;
  let nomSuggere: string;
  if (options.operation === 'image') {
    const personnages = apparencesDuPlan(film, plan);
    const aReference = personnages.some((p) => p.urlImage);
    const texteSource = personnages.length
      ? `${personnages.map((p) => `${p.nom} (${p.description || 'apparence non decrite'})`).join(', ')}. ${plan.description}`
      : plan.description;
    const { promptFinal } = construirePromptImage(texteSource, { mode: aReference ? 'reference' : 'texte' });

    const resultat = await fournisseur.genererImage({
      promptPlan: plan.description,
      promptConstruit: promptFinal,
      personnages,
      format: film.format,
      graine,
    });
    if (!resultat.ok) return { ok: false, erreur: resultat.erreur };
    fichierTemporaire = resultat.fichier;
    nomSuggere = resultat.nomSuggere;
  } else {
    // Garanti present et de genre 'image' par le controle plus haut.
    const imageSource = fichierDuMedia(options.racinePublique, plan.media!.url);
    const resultat = await fournisseur.genererVideo({
      fichierImageSource: imageSource,
      dureeS: plan.dureeS,
      format: film.format,
      graine,
    });
    if (!resultat.ok) return { ok: false, erreur: resultat.erreur };
    fichierTemporaire = resultat.fichier;
    nomSuggere = resultat.nomSuggere;
  }

  // ── 5. Le resultat passe par le MEME controle qu'un import manuel ──────
  let donnees: Buffer;
  try {
    donnees = await readFile(fichierTemporaire);
  } catch {
    return { ok: false, erreur: 'le fournisseur n’a pas produit de fichier lisible' };
  }

  const importe = await importerMedia({
    film, planId, nomOrigine: nomSuggere, donnees,
    racinePublique: options.racinePublique, origine: 'genere',
  });
  await rm(fichierTemporaire, { force: true }).catch(() => {});
  if (!importe.ok) return { ok: false, erreur: importe.erreur };

  // ── Tracabilite (mission 2) : QUEL fournisseur, QUELLES references ─────
  //
  // `referencesUtilisees` pose la VERSION de reference active de chaque
  // personnage present AU MOMENT de cette generation — c'est elle qui
  // permet, plus tard, de dire si deux plans du meme personnage ont ete
  // generes depuis la MEME apparence ou depuis deux versions differentes
  // (`generation/coherence.ts`). Sans cette trace, un changement de
  // reference entre deux generations serait invisible.
  const mediaTrace: MediaPlan = { ...importe.media, fournisseurGeneration: fournisseur.id };
  const filmAvecMedia = remplacerMedia(importe.film, planId, mediaTrace);
  // Aligne POSITIONNELLEMENT sur `plan.personnages` : `coherence.ts` lit
  // `referencesUtilisees[plan.personnages.indexOf(id)]`, donc un personnage
  // SANS reference active garde sa place (chaine vide), il n'est jamais
  // simplement omis — l'omettre decalerait tous les personnages suivants.
  const referencesUtilisees = plan.personnages.map((pid) => {
    const perso = filmAvecMedia.personnages.find((pp) => pp.id === pid);
    return perso ? referenceActive(perso)?.id ?? '' : '';
  });

  const filmFacture: Film = {
    ...filmAvecMedia,
    coutGenerationUsd: Math.round(((film.coutGenerationUsd ?? 0) + (devis.totalUsd ?? 0)) * 10_000) / 10_000,
    scenes: filmAvecMedia.scenes.map((s) => ({
      ...s,
      plans: s.plans.map((p) => (p.id !== planId ? p : { ...p, referencesUtilisees })),
    })),
  };

  return { ok: true, film: filmFacture, media: mediaTrace };
}

