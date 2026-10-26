/**
 * LOT 4 — FICHE DE SCÈNES HORODATÉES (contrat commun Créer / Autopilote).
 *
 * Ce que dit une analyse de contenu (vision, transcription) d'un rush, PAR
 * SEGMENT de temps, et sa traduction vers `AnalyseRush.descriptions` — le
 * champ que `planMontage` sait DÉJÀ lire (mots communs avec le sujet de la
 * vidéo ⇒ pertinence relevée, jamais baissée). Aucun nouveau moteur.
 *
 * ⚠️ RIEN ICI NE PRODUIT DE FICHE. Aucun appel réseau, aucun fournisseur,
 * aucun crédit. Une fiche réelle devra être produite par la chaîne existante
 * (`analyse-ia-rush.ts` : interrupteurs éteints par défaut, administrateur,
 * consentement, plafond `COUT_MAX_RUSH_USD`) ; tant qu'elle ne l'est pas, les
 * appelants ne passent rien et le montage est celui d'aujourd'hui.
 *
 * ÉTEINT PAR DÉFAUT (`FICHE_SCENES_ACTIVE`) : même avec des fiches passées,
 * les analyses sont rendues telles quelles (même référence), octet pour octet.
 *
 * Module PUR : aucune dépendance navigateur ni serveur.
 */
import type { AnalyseRush, DescriptionPlan } from '@/lib/creer/smart-montage';

/**
 * Mêmes vocabulaires que les fiches de contenu (confiance, nombre de personnes), RECOPIÉS
 * sans les importer : les modules M2 (`fiche-contenu*`, `analyse-ia-rush`) ne nourrissent
 * jamais le plan (gardes `analyse-ia-rush-routes-m2b`, `fiche-contenu-client-m2a`).
 */
export type ConfianceScene = 'elevee' | 'moyenne' | 'faible';
export type PersonnesScene = 'aucune' | 'une' | 'plusieurs' | 'inconnu';

export const VERSION_FICHE_SCENES = 1 as const;

/** Interrupteur UNIQUE, Créer (montage automatique) et Autopilote. `false` : aucune fiche n'est lue. */
export const FICHE_SCENES_ACTIVE = false;

/** Échelle de plan, si l'analyse la donne. Jamais déduite localement (64×36 ne le permet pas). */
export type CadragePlan = 'large' | 'moyen' | 'serre';

/** D'où vient la scène. `fictif` : jeux de test, jamais produit en production. */
export type SourceScene = 'vision' | 'transcription' | 'vision+transcription' | 'fictif';

export interface SceneHorodatee {
  /** Bornes dans le rush (s). */
  debut: number;
  fin: number;
  /** Action courte (« danse collective », « coach explique un mouvement »), `null` si inconnue. */
  action: string | null;
  /** Présence de personnes (même vocabulaire que la fiche v2). */
  personnes: PersonnesScene | null;
  cadrage: CadragePlan | null;
  /** Sujet ou dialogue résumé en mots-clés — jamais le texte de la parole (règle de la fiche v2). */
  sujet: string | null;
  confiance: ConfianceScene;
  source: SourceScene;
}

export interface FicheScenes {
  version: typeof VERSION_FICHE_SCENES;
  /** URL du rush décrit — une fiche ne s'applique qu'à SON rush. */
  url: string;
  scenes: SceneHorodatee[];
}

/**
 * Descriptions horodatées pour `planMontage`, à partir d'une fiche :
 *  - confiance `faible` : écartée (jamais une pertinence sur une description douteuse) ;
 *  - bornes ramenées dans [0, durée], segments vides ou inversés écartés ;
 *  - texte = action + sujet (les seuls mots que le moteur compare au sujet de la vidéo) —
 *    personnes et cadrage restent dans la fiche, le moteur ne les lit pas.
 * Pur.
 */
export function descriptionsDepuisFiche(fiche: FicheScenes, duree: number): DescriptionPlan[] {
  if (fiche?.version !== VERSION_FICHE_SCENES || !Array.isArray(fiche.scenes) || !(duree > 0)) return [];
  const out: DescriptionPlan[] = [];
  for (const s of fiche.scenes) {
    if (!s || s.confiance === 'faible') continue;
    if (!Number.isFinite(s.debut) || !Number.isFinite(s.fin)) continue;
    const debut = Math.max(0, s.debut);
    const fin = Math.min(duree, s.fin);
    if (!(fin > debut)) continue;
    const texte = [s.action, s.sujet].filter((x): x is string => typeof x === 'string' && x.trim().length > 0).join(' ').trim();
    if (!texte) continue;
    out.push({ debut: Math.round(debut * 1000) / 1000, fin: Math.round(fin * 1000) / 1000, texte });
  }
  return out.sort((a, b) => a.debut - b.debut);
}

/**
 * Les analyses que `planMontage` reçoit, enrichies des descriptions de leur fiche.
 * Éteint (`actif` faux), sans fiche, ou fiche d'un autre rush : la MÊME référence est
 * rendue — rien ne change. Les descriptions déjà présentes sont conservées. Pur.
 */
export function analysesAvecScenes(
  analyses: AnalyseRush[],
  fiches: Readonly<Record<string, FicheScenes>> | null | undefined,
  actif: boolean = FICHE_SCENES_ACTIVE,
): AnalyseRush[] {
  if (!actif || !fiches) return analyses;
  let change = false;
  const out = analyses.map((a) => {
    const fiche = fiches[a.url];
    if (!fiche || fiche.url !== a.url) return a;
    const descriptions = descriptionsDepuisFiche(fiche, a.duree);
    if (!descriptions.length) return a;
    change = true;
    return { ...a, descriptions: [...(a.descriptions ?? []), ...descriptions] };
  });
  return change ? out : analyses;
}
