/**
 * M3-a PR3 — LE PLAN DE MONTAGE DE CRÉER, calculé à UN seul endroit.
 *
 * Le bloc « Smart Montage » de l'export (AssistantWizard, `runRenderInterne`)
 * décide des extraits : `planMontage` (méthode A, ou B pour l'essai admin),
 * puis le profil, le rapport, le raccourci éventuel et les surimpressions.
 * Ce module en est la partie PURE, DÉPLACÉE (pas recopiée) : l'export
 * l'appelle toujours, l'aperçu rapide aussi quand l'interrupteur
 * `STUDIIO_APERCU_PLAN_ENABLED` est posé pour un admin.
 *
 * Les acquisitions (analyse des rushes, rythme de la musique) restent chez
 * l'appelant : elles sont asynchrones, mémoïsées (`analyserRushMemo`,
 * `analyserMusiqueNavigateur`) et portent la progression de l'écran.
 *
 * ⚠️ CLÉ DE VALIDITÉ = empreinte DÉRIVÉE de l'entrée entière
 * (`renderSignature`, même doctrine que la signature de rendu) : tout champ
 * ajouté à `EntreePlanMontage` entre dans la clé sans que personne ait à y
 * penser. L'export ne réutilise le plan de l'aperçu que si la clé est la
 * même, que le plan est COMPLET (toutes les analyses lues) ET que les
 * analyses et le rythme sont les MÊMES objets (mêmes mesures, par identité
 * dans les mémos). Sinon : recalcul, exactement comme avant PR3.
 *
 * La réponse au raccourci n'est PAS une entrée du plan : le plan est calculé
 * AVANT la question, l'export la repose toujours (bloquant), l'aperçu ne fait
 * que l'annoncer. Elle n'est donc jamais mise en cache.
 */
import { planMontage, dureePlan, profilMontageDuContexte, mesuresSegments, optionsModePassages, type AnalyseRush, type ProfilMontage } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan } from '@/lib/creer/smart-montage-regles';
import { rythmeSurFenetre, type RythmeMusique } from '@/lib/creer/rythme-musique';
import { raccourciNecessaire, type Raccourci } from '@/lib/creer/raccourci';
import { planOverlays, profilEnSurimpression, type OverlaysMontage } from '@/lib/creer/overlays';
import { renderSignature } from '@/lib/creer/renderSignature';
import type { RushSegment } from '@/lib/creer/multi-rush';

/**
 * Version du calcul (analyse non bornée de l'export + règles du plan). À
 * incrémenter si l'analyse ou les règles changent de sens : tout plan mis en
 * cache devient alors périmé.
 */
export const VERSION_PLAN_MONTAGE = 3;
// v2 (#613) : unicité par timecode dans les plans propres des rushes + rush du fond du CTA évité en fin.
// v3 (#613) : marge d'une image entre extraits, restes de matière libre en plans courts, plans prolongés
// sur la matière libre jusqu'à la cible, coupes de la source localisées au dixième de seconde.

/** Toutes les entrées réelles du plan, du raccourci et des surimpressions. */
export interface EntreePlanMontage {
  version: number;
  /** L'analyse de l'export : rush ENTIER (jamais la version bornée du panneau). */
  analyse: 'complete';
  /** Rushes durables, dans l'ordre (URL + durée retenue si connue). */
  rushs: Array<{ url: string; secondes: number | null }>;
  /** Durée demandée de la séquence Vidéo (s). */
  cibleEcran: number;
  ordre: string[];
  durees: { intro: number; cards: number; video: number; cta: number };
  /** Début de la séquence Vidéo dans le montage (cale la fenêtre du rythme). */
  debutVideo: number;
  musique: string | null;
  contexte: {
    theme: string | null;
    titre: string | null;
    sousTitre: string | null;
    objectif: string | null;
    cartes: Array<{ title: string | null; description: string | null }>;
  };
  methode: 'A' | 'B';
  nbCartes: number;
  voixDeTextes: boolean;
  format: string;
  /**
   * #613 — rush montré JUSTE APRÈS la séquence Vidéo (fond en mouvement du
   * CTA, `fondsRushTexte`) : le dernier plan de la Vidéo n'en vient pas.
   * `null` : aucun.
   */
  rushApres: string | null;
  /**
   * Profil de montage IMPOSÉ par un style vidéo (`@/lib/styles-video`).
   * ABSENT (pas `null`) sans style : la clé du plan et le profil déduit du
   * thème restent exactement ceux d'avant.
   */
  profilImpose?: Exclude<ProfilMontage, 'STANDARD'>;
}

export function entreePlanMontage<K extends string>(e: {
  rushs: ReadonlyArray<{ url: string; secondes?: number | null }>;
  ordre: ReadonlyArray<K>;
  /** Durée d'une séquence (s) — `dureeDeSequence` de l'écran / du rendu. */
  duree: (k: K) => number;
  musique: string | null;
  theme: string | null | undefined;
  titre: string | null | undefined;
  sousTitre: string | null | undefined;
  objectif: string | null;
  cartes: ReadonlyArray<{ title?: string | null; description?: string | null }> | null | undefined;
  methode: 'A' | 'B';
  voixDeTextes: boolean;
  format: string;
  /** #613 — URL du rush du fond en mouvement du CTA (`fondsRushTexte`), s'il y en a un. */
  rushApres?: string | null;
  /** Profil imposé par le style vidéo choisi ; `null`/absent = déduit du thème (avant). */
  profil?: Exclude<ProfilMontage, 'STANDARD'> | null;
}): EntreePlanMontage {
  const ordre: string[] = [...e.ordre];
  const duree = e.duree as unknown as (k: string) => number;
  const debutVideo = ordre.slice(0, Math.max(0, ordre.indexOf('video'))).reduce((t, k) => t + duree(k), 0);
  return {
    version: VERSION_PLAN_MONTAGE,
    analyse: 'complete',
    rushs: e.rushs.map((r) => ({ url: r.url, secondes: typeof r.secondes === 'number' && Number.isFinite(r.secondes) ? r.secondes : null })),
    cibleEcran: duree('video'),
    ordre,
    durees: { intro: duree('intro'), cards: duree('cards'), video: duree('video'), cta: duree('cta') },
    debutVideo,
    musique: e.musique ?? null,
    contexte: {
      theme: e.theme ?? null,
      titre: e.titre ?? null,
      sousTitre: e.sousTitre ?? null,
      objectif: e.objectif ?? null,
      cartes: (e.cartes ?? []).map((c) => ({ title: c.title ?? null, description: c.description ?? null })),
    },
    methode: e.methode,
    nbCartes: (e.cartes ?? []).length,
    voixDeTextes: e.voixDeTextes,
    format: e.format,
    rushApres: e.rushApres ?? null,
    ...(e.profil ? { profilImpose: e.profil } : {}),
  };
}

/** Empreinte stable de l'entrée — dérivée de l'objet, jamais d'une liste écrite à la main. */
export function clePlanMontage(entree: EntreePlanMontage): string {
  return `plan:${renderSignature(entree)}`;
}

export interface PreparationPlan {
  cle: string;
  entree: EntreePlanMontage;
  /** Analyses lues, une par rush (`null` = illisible), dans l'ordre. */
  analysesBrutes: ReadonlyArray<AnalyseRush | null>;
  /** Analyses exploitables (celles que `planMontage` reçoit). */
  analyses: AnalyseRush[];
  rythme: RythmeMusique | null;
  rythmeVideo: RythmeMusique | null;
  plan: RushSegment[] | null;
  profil: ReturnType<typeof profilMontageDuContexte>['profil'];
  rapport: ReturnType<typeof rapportPlan> | null;
  /** Toutes les analyses ont été lues : seul un plan complet est réutilisable. */
  complet: boolean;
  /** La matière manque : la question que l'export POSERA (jamais posée ici). */
  raccourci: Raccourci | null;
  /** Durée de la séquence Vidéo si l'utilisateur accepte le raccourci. */
  dureeVideo: number;
  /** Le plan vient de l'aperçu (clé et mesures identiques) : pas recalculé. */
  reutilise: boolean;
}

/** Le plan déjà calculé est-il valable pour CETTE entrée et CES mesures ? */
export function planReutilisable(
  memo: PreparationPlan | null | undefined,
  cle: string,
  analysesBrutes: ReadonlyArray<AnalyseRush | null>,
  rythme: RythmeMusique | null,
): memo is PreparationPlan {
  if (!memo || !memo.complet || !memo.plan || memo.cle !== cle) return false;
  if (memo.rythme !== rythme) return false;
  if (memo.analysesBrutes.length !== analysesBrutes.length) return false;
  return memo.analysesBrutes.every((a, i) => a === analysesBrutes[i]);
}

/**
 * Le plan, à partir des mesures. `memo` (aperçu) n'est relu que s'il est
 * valable ; `null` (interrupteur éteint) : calcul à chaque appel, comme avant.
 */
export function preparerPlanMontage(
  entree: EntreePlanMontage,
  acquis: { analysesBrutes: ReadonlyArray<AnalyseRush | null>; rythme: RythmeMusique | null },
  memo: PreparationPlan | null = null,
): PreparationPlan {
  const cle = clePlanMontage(entree);
  const analyses = acquis.analysesBrutes.filter((a): a is AnalyseRush => !!a);
  const complet = acquis.analysesBrutes.length === entree.rushs.length && analyses.length === acquis.analysesBrutes.length;
  const cibleEcran = entree.cibleEcran;
  const contexteMontage = contexteMontageDepuis({
    theme: entree.contexte.theme,
    titre: entree.contexte.titre,
    sousTitre: entree.contexte.sousTitre,
    objectif: entree.contexte.objectif,
    cartes: entree.contexte.cartes,
  });
  const rythmeVideo = acquis.rythme ? rythmeSurFenetre(acquis.rythme, entree.debutVideo, cibleEcran) : null;
  const reutilise = planReutilisable(memo, cle, acquis.analysesBrutes, acquis.rythme);
  let plan: RushSegment[] | null;
  if (reutilise) plan = memo!.plan!.map((s) => ({ ...s }));
  // M3-a PR2 : méthode B (essai admin) = SEULE différence, l'option de sélection.
  else if (entree.methode === 'B') plan = planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage, ...optionsModePassages(analyses), ...(entree.profilImpose ? { profil: entree.profilImpose } : {}) });
  // #613 : Créer monte dans les PLANS PROPRES (ni coupe de la source ni image figée), unicité au timecode.
  else plan = planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage, uniciteParTimecode: true, rushApres: entree.rushApres, ...(entree.profilImpose ? { profil: entree.profilImpose } : {}) });
  const profil = entree.profilImpose ?? profilMontageDuContexte(contexteMontage).profil;
  let rapport: ReturnType<typeof rapportPlan> | null = null;
  if (plan) {
    const ms = mesuresSegments(plan, analyses);
    rapport = ms ? rapportPlan(profil, ms, rythmeVideo) : null;
  }
  let raccourci: Raccourci | null = null;
  let dureeVideo = cibleEcran;
  if (plan && dureePlan(plan) < cibleEcran - 0.05) {
    raccourci = raccourciNecessaire(cibleEcran, dureePlan(plan), new Set(plan.map((x) => x.url)).size);
    dureeVideo = dureePlan(plan);
  }
  return {
    cle, entree, analysesBrutes: [...acquis.analysesBrutes], analyses, rythme: acquis.rythme, rythmeVideo,
    plan, profil, rapport, complet, raccourci, dureeVideo, reutilise,
  };
}

/**
 * Surimpressions du plan : profil dynamique et aucune voix de séquence
 * titre / cartes / CTA. MÊME calcul pour l'export et l'aperçu.
 */
export function surimpressionsDuPlan(e: {
  plan: ReadonlyArray<RushSegment> | null;
  profil: ReturnType<typeof profilMontageDuContexte>['profil'] | null;
  nbCartes: number;
  voixDeTextes: boolean;
}): OverlaysMontage | null {
  if (!e.plan || !e.profil || !profilEnSurimpression(e.profil) || e.voixDeTextes) return null;
  return planOverlays({
    duree: dureePlan(e.plan),
    nbCartes: e.nbCartes,
    finHook: e.plan.filter((x) => x.phase === 'HOOK').at(-1)?.fin ?? null,
    profil: e.profil,
  });
}

/**
 * Séquences de l'aperçu rapide = la ligne de temps de l'export : Vidéo à la
 * durée du plan (raccourci compris) ; en surimpression, titre / cartes / CTA
 * à 0 s (ils passent sur la vidéo).
 */
export function etapesDuPlan<K extends string>(
  ordre: ReadonlyArray<K>,
  duree: (k: K) => number,
  prep: Pick<PreparationPlan, 'dureeVideo'>,
  surimpression: boolean,
): Array<{ key: string; seconds: number }> {
  return ordre.map((k) => ({
    key: k,
    seconds: k === 'video' ? prep.dureeVideo : surimpression ? 0 : duree(k),
  }));
}
