/**
 * MONTAGE AUTOPILOTE AVEC AVATAR — la décision UNIQUE, PURE (aucun réseau),
 * partagée par le moteur (`produire.ts`, branche jumeau + autres sources), la
 * démo du banc et l'APERÇU (`planCompletAutopilote` : « Plan avant
 * génération », « Aperçu de mon montage »).
 *
 * Mêmes entrées → même plan : pertinence des médias stock pour le scénario,
 * narration (titre, cartes) posée sur la parole, durée (parole + séquence de
 * clôture jusqu'à la cible), fenêtres des textes (CTA sur la clôture jusqu'à
 * la dernière image). La seule différence entre l'aperçu et le rendu est la
 * PAROLE : estimée avant génération, mesurée sur la vidéo de l'avatar après.
 *
 * La voix n'est jamais accélérée ni coupée : la durée cible s'atteint en
 * AJOUTANT des plans après la parole (`dureeAvecCloture`), jamais en touchant
 * à la voix.
 */
import { planMultiSources, dureeAvecCloture, type EntreePlanMultiSources, type ResultatPlanMultiSources } from '@/lib/autopilot/plan-multi-sources';
import { narrationDesSurimpressions, pertinencesPourPlan, scenarioPertinence } from '@/lib/autopilot/pertinence-medias';
import { planOverlays, type OverlaysMontage } from '@/lib/creer/overlays';
import { profilMontageDuContexte, type ContexteMontage } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis } from '@/lib/creer/smart-montage-regles';

/** Ce que la vidéo DIT — de quoi juger la pertinence des médias et poser la narration. */
export interface ContexteTextesAutopilote {
  /** Libellés des thèmes (`sujetsCourants`). */
  sujets: ReadonlyArray<string | null | undefined>;
  /** Le titre (le sujet du montage, `post.title`). */
  titre: string;
  sousTitre?: string | null;
  objectif?: string | null;
  message?: string | null;
  cta?: string | null;
  cartes: ReadonlyArray<{ title?: string | null; description?: string | null; value?: string | null }>;
}

/**
 * Le contexte de l'ÉCRAN : l'échantillon que « Produire maintenant » produit
 * (`buildAutopilotSample`) et le brief — les mêmes champs que `produire.ts`.
 */
export function contexteDeLEchantillon(
  sample: { topic: string; subtitle?: string | null; cartesDuMontage: ContexteTextesAutopilote['cartes'] },
  sujets: ReadonlyArray<string>,
  brief: { objectif?: string | null; message?: string | null; cta?: string | null } | null | undefined,
): ContexteTextesAutopilote {
  return {
    sujets, titre: sample.topic, sousTitre: sample.subtitle ?? null,
    objectif: brief?.objectif ?? null, message: brief?.message ?? null, cta: brief?.cta ?? null,
    cartes: sample.cartesDuMontage,
  };
}

/** Le contexte du smart montage (profil des textes) — la MÊME préparation que Créer. */
export function contexteMontageAutopilote(c: ContexteTextesAutopilote): ContexteMontage {
  return contexteMontageDepuis({
    theme: c.titre,
    titre: c.titre,
    sousTitre: c.sousTitre ?? null,
    objectif: [c.objectif, c.message].filter(Boolean).join(' ') || null,
    cartes: c.cartes.map((x) => ({ title: x.title ?? null, description: x.description ?? null })),
  });
}

/** Pertinence des médias stock retenus pour CE scénario (hors sujet jamais pioché). */
export function pertinencesAutopilote(
  stock: ReadonlyArray<{ url: string; description?: string | null; sourceUrl?: string | null }>,
  c: ContexteTextesAutopilote,
): NonNullable<EntreePlanMultiSources['pertinences']> {
  const scenario = scenarioPertinence({
    sujets: [...c.sujets, c.objectif ?? null],
    textes: [c.titre, c.sousTitre ?? null, c.message ?? null, c.cta ?? null,
      ...c.cartes.flatMap((x) => [x.title ?? null, x.description ?? null])],
  });
  return pertinencesPourPlan(stock, scenario);
}

export interface EntreeMontageAvatar extends Omit<EntreePlanMultiSources, 'avatar' | 'cible' | 'narration' | 'dureeVisee'> {
  /** Vidéo de l'avatar et sa parole (s) — mesurée au rendu, estimée à l'aperçu. */
  avatar: { url: string; secondes: number };
  /** Durée cible du brief (s) ; `null` : la parole seule, comme avant. */
  dureeVisee: number | null | undefined;
  /** Profil des textes (`profilMontageDuContexte`). */
  profil: ReturnType<typeof profilMontageDuContexte>['profil'];
  /** Titre et cartes RÉELLEMENT rendus (narration). */
  titre: string;
  cartes: ReadonlyArray<{ title?: string | null; description?: string | null }>;
}

export interface MontageAvatar {
  res: ResultatPlanMultiSources;
  /** Fenêtres des textes en surimpression (voix de l'avatar continue, à 0) ; `null` sans plan. */
  overlays: OverlaysMontage | null;
  narration: Array<{ debut: number; fin: number; texte: string }>;
}

/**
 * LE PLAN AVEC AVATAR : narration sur la durée visée, plan multi-sources
 * (parole + clôture), puis les fenêtres des textes — CTA sur la clôture
 * quand elle existe, sinon sur les dernières secondes (règle d'avant).
 */
export function planMontageAvatar(e: EntreeMontageAvatar): MontageAvatar {
  const P = e.avatar.secondes;
  const visee = dureeAvecCloture(P, e.dureeVisee);
  // La narration (titre, cartes) : un plan de coupe posé pendant une carte
  // préfère le média qui montre ce qu'elle dit.
  const narration = narrationDesSurimpressions(planOverlays({
    duree: visee, profil: e.profil, nbCartes: e.cartes.length,
    finHook: Math.min(4, Math.max(2, P * 0.2)), voix: { video: visee },
    ...(visee > P ? { debutCta: P } : {}),
  }), { titre: e.titre, cartes: e.cartes });
  const { profil: _p, titre: _t, cartes: _c, dureeVisee, ...reste } = e;
  const res = planMultiSources({ ...reste, avatar: e.avatar, cible: P, narration, dureeVisee });
  if (!res.plan.length) return { res, overlays: null, narration };
  const o = planOverlays({
    duree: res.duree,
    profil: e.profil,
    nbCartes: e.cartes.length,
    // Fin RÉELLE du plan d'ouverture : le titre tient jusqu'à la coupe.
    finHook: res.plan[0]?.fin ?? null,
    voix: { video: res.duree },
    ...(res.debutCloture !== null ? { debutCta: res.debutCloture } : {}),
  });
  // La voix de l'avatar est CONTINUE et part à 0, avec son image.
  return { res, overlays: { ...o, voix: { video: 0 } }, narration };
}
