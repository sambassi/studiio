/**
 * SMART MONTAGE — RÈGLES PARTAGÉES (source de vérité unique).
 *
 * Utilisées par :
 *   - le moteur de plan (`smart-montage.ts` → `planMontage`) ;
 *   - la préparation des entrées de CRÉER (`AssistantWizard`) ET de
 *     l'AUTOPILOTE (`produire.ts`) — même fonction, même profil ;
 *   - le conseiller éditorial (`conseiller/montage.ts`) ;
 *   - le rapport de plan écrit dans les métadonnées des deux parcours.
 *
 * Aucune de ces règles n'est recopiée ailleurs : un réglage change ici
 * change partout. Module PUR (aucune dépendance navigateur ni serveur).
 */
import type { ContexteMontage } from '@/lib/creer/smart-montage';
import { FORCE_PERCUSSION_FORTE, FORCE_PERCUSSION_SECONDAIRE } from '@/lib/creer/rythme-musique';

// ── Ressemblance de deux images (empreinte 8×8) ─────────────────────────
export const ecartEmpreinte = (a: number[], b: number[]) => {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]);
  return d / n;
};

/** Écart d'empreinte à partir duquel deux images sont « totalement différentes ». */
export const ECHELLE_DIFFERENCE = 0.25;

/** VISUAL_SIMILARITY : 1 = même image, 0 = rien à voir. */
export function similariteVisuelle(a: number[] | null | undefined, b: number[] | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round(Math.max(0, 1 - ecartEmpreinte(a, b) / ECHELLE_DIFFERENCE) * 100) / 100;
}

/**
 * MÊME SCÈNE : deux morceaux du MÊME rush, proches dans la prise, dont les
 * images se ressemblent encore. Mesure, pas reconnaissance de la scène.
 */
export const MEME_SCENE = { ecartS: 4, empreinte: 0.15 } as const;

export interface FenetreSource { cle: string; depuis: number; jusqua: number; empreinte: number[] | null }

export function memeScene(a: FenetreSource, b: FenetreSource): boolean {
  if (a.cle !== b.cle || !a.empreinte || !b.empreinte) return false;
  const ecart = Math.max(0, Math.max(a.depuis, b.depuis) - Math.min(a.jusqua, b.jusqua));
  return ecart < MEME_SCENE.ecartS && ecartEmpreinte(a.empreinte, b.empreinte) < MEME_SCENE.empreinte;
}

// ── ANTI-RÉPÉTITION « FLASH » (#502) ────────────────────────────────────
/** Fenêtre (s, timeline de la vidéo) où une reprise se remarque immédiatement. */
export const FENETRE_FLASH_S = 3;
/** Similarité visuelle (0..1) au-delà de laquelle deux plans sont quasi identiques. */
export const SIMILARITE_FLASH = 0.85;
/**
 * Un plan qui PROLONGE le précédent (même rush, reprise là où il s'arrêtait)
 * est un plan continu coupé — pas une répétition (cas DANSE (8), 0,97–1,83 s).
 */
export function prolonge(prec: FenetreSource, suivant: FenetreSource): boolean {
  return prec.cle === suivant.cle && Math.abs(suivant.depuis - prec.jusqua) <= 0.25;
}

/** Deux extraits qui reprennent EXACTEMENT la même matière (timecodes qui se chevauchent). */
export function memeTimecode(a: FenetreSource, b: FenetreSource): boolean {
  return a.cle === b.cle && Math.min(a.jusqua, b.jusqua) - Math.max(a.depuis, b.depuis) > 0.05;
}

// ── Couleur ─────────────────────────────────────────────────────────────
/** Saturation moyenne sous laquelle une image est en noir et blanc (mesuré : N&B ≈ 0,014, couleur terne ≥ 0,036). */
export const SEUIL_NOIR_BLANC = 0.025;
export const estNoirEtBlanc = (saturation: number | null | undefined) => typeof saturation === 'number' && saturation < SEUIL_NOIR_BLANC;

/** Énergie (0..1, relative à toute la matière) sous laquelle un plan est « calme ». */
export const SEUIL_ENERGIE_CALME = 0.4;

/** Écart de luminosité moyenne (0..1) d'un plan au suivant : changement d'ambiance. */
export const ECART_AMBIANCE = 0.18;

// ── Profils : ce qui s'ajoute aux règles de durée (`REGLES_PROFILS`) ─────
export type NomProfilMontage = 'CARDIO_DANCE' | 'LIFESTYLE_BRAND' | 'TUTORIAL_EDUCATION' | 'EVENT_IMMERSIVE' | 'STANDARD';

export interface RegleCoherence {
  /** Pénalité d'un plan noir et blanc quand la matière est surtout en couleur. */
  noirBlancDansCouleur: number;
  /** Pénalité d'un plan calme dans HOOK / BUILD / PEAK (profil énergique). */
  planCalmeEnMontee: number;
  /** Pénalité d'un changement brusque d'ambiance lumineuse. */
  ruptureAmbiance: number;
  /** Pénalité d'un passage couleur ↔ noir et blanc d'un plan au suivant (regroupe les plans N&B). */
  ruptureCouleur: number;
  /** Pénalité d'un plan qui RESSEMBLE à un plan déjà monté (× similarité). */
  ressemblance: number;
  /** Pénalité d'un retour sur une même scène. */
  memeScene: number;
  /**
   * Pénalité d'un 3e plan de suite du même rush. Profils énergiques : 0,35,
   * nouveau rush d'abord sans forcer un plan incohérent. Autres : 10, soit
   * l'ancienne interdiction (comportement inchangé).
   */
  troisiemeMemeRush: number;
  /** Durée (s) au-delà de laquelle une série de plans noir et blanc est pénalisée (0 = jamais). */
  serieNoirBlancMaxS: number;
  /** Pénalité d'un plan qui prolonge une série noir et blanc au-delà de `serieNoirBlancMaxS`. */
  serieNoirBlanc: number;
  /**
   * Poids du MATCH carte / image : pendant une carte « énergique », les plans
   * à fort mouvement sont favorisés, les plans calmes pénalisés (0 = aucun).
   */
  matchCarte: number;
  /**
   * Poids du CTA DYNAMIQUE (#499) : le dernier plan, sous le CTA, privilégie
   * la couleur et le mouvement MESURÉS (énergie, saturation) ; un plan calme
   * ou noir et blanc au milieu de la couleur est pénalisé, et peut être
   * remplacé par un plan couleur déjà monté repris à un AUTRE timecode.
   * Aucune reconnaissance de contenu (groupe, sourires, studio) : mesures
   * seulement. 0 = comportement d'avant.
   */
  ctaDynamique: number;
}

export const COHERENCE_PROFILS: Record<NomProfilMontage, RegleCoherence> = {
  // Danse (#496) : le noir et blanc ne sert que faute de couleur utilisable,
  // jamais en alternance, jamais en longue série.
  CARDIO_DANCE: { noirBlancDansCouleur: 1.2, planCalmeEnMontee: 0.25, ruptureAmbiance: 0.15, ruptureCouleur: 0.8, ressemblance: 0.5, memeScene: 0.45, troisiemeMemeRush: 0.35, serieNoirBlancMaxS: 2, serieNoirBlanc: 0.8, matchCarte: 0.5, ctaDynamique: 1 },
  EVENT_IMMERSIVE: { noirBlancDansCouleur: 0.4, planCalmeEnMontee: 0.2, ruptureAmbiance: 0.15, ruptureCouleur: 0.4, ressemblance: 0.5, memeScene: 0.45, troisiemeMemeRush: 0.35, serieNoirBlancMaxS: 0, serieNoirBlanc: 0, matchCarte: 0.4, ctaDynamique: 0 },
  LIFESTYLE_BRAND: { noirBlancDansCouleur: 0.3, planCalmeEnMontee: 0, ruptureAmbiance: 0.2, ruptureCouleur: 0.3, ressemblance: 0.4, memeScene: 0.35, troisiemeMemeRush: 10, serieNoirBlancMaxS: 0, serieNoirBlanc: 0, matchCarte: 0, ctaDynamique: 0 },
  TUTORIAL_EDUCATION: { noirBlancDansCouleur: 0.2, planCalmeEnMontee: 0, ruptureAmbiance: 0.1, ruptureCouleur: 0.1, ressemblance: 0.2, memeScene: 0.15, troisiemeMemeRush: 10, serieNoirBlancMaxS: 0, serieNoirBlanc: 0, matchCarte: 0, ctaDynamique: 0 },
  STANDARD: { noirBlancDansCouleur: 0.2, planCalmeEnMontee: 0, ruptureAmbiance: 0.1, ruptureCouleur: 0.2, ressemblance: 0.3, memeScene: 0.3, troisiemeMemeRush: 10, serieNoirBlancMaxS: 0, serieNoirBlanc: 0, matchCarte: 0, ctaDynamique: 0 },
};

/** Règles de TEXTES par profil — communes à Créer et à l'Autopilote. */
export interface RegleTextes {
  accroche: { positions: Array<'haut' | 'bas'>; dureeMax: number };
  cartes: { position: string; dureeMin: number; dureeMax: number };
  cta: { position: string; dureeMin: number };
}

const TEXTES_DYNAMIQUES: RegleTextes = {
  accroche: { positions: ['haut', 'bas'], dureeMax: 3 },
  cartes: { position: 'bas-gauche', dureeMin: 3, dureeMax: 4 },
  cta: { position: 'centre', dureeMin: 2.5 },
};

export const TEXTES_PROFILS: Record<NomProfilMontage, RegleTextes> = {
  CARDIO_DANCE: TEXTES_DYNAMIQUES,
  EVENT_IMMERSIVE: TEXTES_DYNAMIQUES,
  LIFESTYLE_BRAND: { ...TEXTES_DYNAMIQUES, cartes: { position: 'bas-gauche', dureeMin: 3, dureeMax: 4 } },
  TUTORIAL_EDUCATION: { accroche: { positions: ['haut'], dureeMax: 4 }, cartes: { position: 'centre', dureeMin: 3, dureeMax: 5 }, cta: { position: 'centre', dureeMin: 3 } },
  STANDARD: { accroche: { positions: ['haut'], dureeMax: 4 }, cartes: { position: 'centre', dureeMin: 1.5, dureeMax: 3 }, cta: { position: 'centre', dureeMin: 2.5 } },
};

// ── Match carte / image (proxy MESURÉ : le mouvement, pas la sémantique) ──
const MOTS_ENERGIQUES = /cardio|muscl|energ|endurance|puissan|force|calor|brul|intens|explos|souffle|tonus|vitesse|rythme|sport|danse|sueur|transpir|actif/;

/** Une carte « énergique » appelle des plans dynamiques dessous. Lexical, pur. */
export function carteEnergique(titre: string | null | undefined): boolean {
  return MOTS_ENERGIQUES.test((titre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
}

/**
 * TEXT_IMAGE_MATCH : énergie moyenne (0..1, pondérée par le temps) des plans
 * VISIBLES pendant chaque carte — tous, pas seulement le premier.
 */
export function matchCartesImages(
  segs: ReadonlyArray<Pick<MesureSegment, 'debut' | 'fin' | 'energie'>>,
  fenetres: ReadonlyArray<{ index: number; debut: number; fin: number }>,
  titres: ReadonlyArray<string | null | undefined>,
): Array<{ index: number; titre: string; energique: boolean; energie: number | null; plans: number }> {
  return fenetres.map((f) => {
    let poids = 0; let somme = 0; let plans = 0;
    for (const s of segs) {
      const recouvre = Math.min(s.fin, f.fin) - Math.max(s.debut, f.debut);
      if (recouvre <= 0 || typeof s.energie !== 'number') continue;
      poids += recouvre; somme += recouvre * s.energie; plans += 1;
    }
    const titre = titres[f.index] ?? '';
    return { index: f.index, titre, energique: carteEnergique(titre), energie: poids ? Math.round((somme / poids) * 100) / 100 : null, plans };
  });
}

// ── Entrées : UNE fonction pour Créer et l'Autopilote ───────────────────
/**
 * Contexte du montage à partir de ce que l'utilisateur a choisi. Créer et
 * l'Autopilote l'appellent avec les mêmes champs : même thème + mêmes
 * textes = même profil, mêmes pertinences.
 */
export function contexteMontageDepuis(e: {
  theme?: string | null;
  titre?: string | null;
  sousTitre?: string | null;
  objectif?: string | null;
  cartes?: Array<{ title?: string | null; description?: string | null }> | null;
}): ContexteMontage {
  const sujet = [e.titre, e.sousTitre].filter((x) => x && x.trim()).join(' ');
  const texte = (e.cartes ?? []).map((c) => `${c.title ?? ''} ${c.description ?? ''}`.trim()).filter(Boolean).join(' ');
  const titres = (e.cartes ?? []).map((c) => c.title ?? '');
  return {
    theme: e.theme?.trim() || e.titre?.trim() || null,
    sujet: sujet || null,
    objectif: e.objectif?.trim() || null,
    texte: texte || null,
    ...(titres.length ? { cartes: titres } : {}),
  };
}

// ── Rapport d'un plan (les MÊMES mesures pour Créer et l'Autopilote) ────
export interface RapportPlan {
  profil: string;
  CUTS_TOTAL: number;
  BEAT_CUT_COUNT: number | null;
  BEAT_SYNC_RATIO: number | null;
  AVG_BEAT_OFFSET_MS: number | null;
  MAX_BEAT_OFFSET_MS: number | null;
  DUPLICATE_SEGMENTS: number;
  SAME_SCENE_PAIRS: number | null;
  VISUAL_REUSE_FALLBACK: number;
  VISUAL_SIMILARITY_MAX: number | null;
  VISUAL_COHERENCE_SCORE: number | null;
  COLOR_STYLE_BREAKS: number | null;
  ENERGY_BREAKS: number | null;
  SCENE_STYLE_BREAKS: number | null;
  SHOTS_OVER_2S: number;
  /** Plus longue série continue de plans noir et blanc (s). */
  LONGEST_BW_SEQUENCE_S: number | null;
  /** Écart de chaque coupe à la PERCUSSION FORTE réelle la plus proche. */
  CUTS_LE_80MS: number | null;
  CUTS_80_120MS: number | null;
  CUTS_GT_120MS: number | null;
  /**
   * Coupes situées là où le morceau A des percussions fortes (jusqu'à la
   * dernière) — ailleurs, aucune coupe ne peut tomber sur une percussion forte.
   */
  CUTS_IN_STRONG_ZONE: number | null;
  CUTS_IN_STRONG_ZONE_LE_80MS: number | null;
  /** #502 — dans `FENETRE_FLASH_S` : même source + timecode chevauchant. */
  RECENT_DUPLICATE_EXACT_COUNT: number;
  /** #502 — dans `FENETRE_FLASH_S` : quasi identiques (≥ `SIMILARITE_FLASH`), hors plan continu. */
  RECENT_DUPLICATE_SIMILAR_COUNT: number | null;
  /** Écart à la percussion RÉELLE la plus proche, forte ou secondaire (#499). */
  CUTS_PERCUSSION_LE_80MS: number | null;
  CUTS_PERCUSSION_80_120MS: number | null;
  CUTS_PERCUSSION_GT_120MS: number | null;
}

export interface MesureSegment {
  cle: string;
  depuis: number;
  jusqua: number;
  debut: number;
  fin: number;
  phase?: string | null;
  empreinte: number[] | null;
  saturation: number | null;
  luminosite: number | null;
  /** Mouvement 0..1 (référence d'un plan franchement actif). */
  energie: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function rapportPlan(
  profil: string,
  segs: ReadonlyArray<MesureSegment>,
  rythme?: { beats: number[]; forts: number[]; impacts?: Array<{ t: number; force: number }> } | null,
): RapportPlan {
  const coupes = segs.slice(0, -1).map((s) => s.fin);
  const beats = rythme?.beats ?? [];
  const forts = rythme?.forts ?? [];
  const temps = beats.length ? Array.from(new Set([...beats, ...forts])).sort((a, b) => a - b) : [];
  const decalages = temps.length ? coupes.map((c) => Math.min(...temps.map((b) => Math.abs(b - c)))) : [];
  const surBeat = decalages.filter((d) => d <= 0.08).length;
  let doublons = 0; let scenes = 0; let simMax: number | null = null;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (memeTimecode(segs[i], segs[j])) doublons += 1;
      else if (memeScene(segs[i], segs[j])) scenes += 1;
      const s = similariteVisuelle(segs[i].empreinte, segs[j].empreinte);
      if (s !== null) simMax = Math.max(simMax ?? 0, s);
    }
  }
  const sats = segs.map((s) => s.saturation);
  const couleurMesuree = sats.every((s) => typeof s === 'number');
  const nb = sats.map((s) => estNoirEtBlanc(s));
  const majoriteCouleur = nb.filter((x) => !x).length >= nb.length / 2;
  const ruptCouleur = couleurMesuree ? nb.slice(1).filter((v, i) => v !== nb[i]).length : null;
  const dynamique = profil === 'CARDIO_DANCE' || profil === 'EVENT_IMMERSIVE';
  const energies = segs.map((s) => s.energie);
  const ruptEnergie = energies.every((e) => typeof e === 'number')
    ? segs.filter((s, i) => dynamique && i > 0 && ['HOOK', 'BUILD', 'PEAK'].includes(s.phase ?? '') && (s.energie as number) < SEUIL_ENERGIE_CALME).length
    : null;
  const lums = segs.map((s) => s.luminosite);
  const ruptScene = lums.every((l) => typeof l === 'number')
    ? lums.slice(1).filter((l, i) => Math.abs((l as number) - (lums[i] as number)) > ECART_AMBIANCE).length
    : null;
  // Cohérence : part des plans qui ne rompent ni la couleur dominante, ni l'énergie.
  const coherence = couleurMesuree && ruptEnergie !== null
    ? r2(segs.filter((s, i) => !(majoriteCouleur && nb[i]) && !(dynamique && ['HOOK', 'BUILD', 'PEAK'].includes(s.phase ?? '') && (s.energie as number) < SEUIL_ENERGIE_CALME)).length / Math.max(1, segs.length))
    : null;
  return {
    profil,
    CUTS_TOTAL: coupes.length,
    BEAT_CUT_COUNT: temps.length ? surBeat : null,
    BEAT_SYNC_RATIO: temps.length && coupes.length ? r2(surBeat / coupes.length) : null,
    AVG_BEAT_OFFSET_MS: decalages.length ? Math.round((decalages.reduce((a, b) => a + b, 0) / decalages.length) * 1000) : null,
    MAX_BEAT_OFFSET_MS: decalages.length ? Math.round(Math.max(...decalages) * 1000) : null,
    DUPLICATE_SEGMENTS: doublons,
    ...(() => {
      let exact = 0; let similaires = 0; let mesurable = true;
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          if (segs[j].debut - segs[i].fin >= FENETRE_FLASH_S) break;
          if (j === i + 1 && prolonge(segs[i], segs[j])) continue;
          if (memeTimecode(segs[i], segs[j])) { exact += 1; continue; }
          const s = similariteVisuelle(segs[i].empreinte, segs[j].empreinte);
          if (s === null) mesurable = false;
          else if (s >= SIMILARITE_FLASH) similaires += 1;
        }
      }
      return { RECENT_DUPLICATE_EXACT_COUNT: exact, RECENT_DUPLICATE_SIMILAR_COUNT: mesurable ? similaires : null };
    })(),
    SAME_SCENE_PAIRS: segs.every((s) => s.empreinte) ? scenes : null,
    VISUAL_REUSE_FALLBACK: 0,
    VISUAL_SIMILARITY_MAX: simMax,
    VISUAL_COHERENCE_SCORE: coherence,
    COLOR_STYLE_BREAKS: ruptCouleur,
    ENERGY_BREAKS: ruptEnergie,
    SCENE_STYLE_BREAKS: ruptScene,
    SHOTS_OVER_2S: segs.filter((s) => s.fin - s.debut > 2.05 && s.phase !== 'CTA').length,
    LONGEST_BW_SEQUENCE_S: couleurMesuree
      ? r2(segs.reduce((acc, s, i) => {
        const run = nb[i] ? acc.run + (s.fin - s.debut) : 0;
        return { run, max: Math.max(acc.max, run) };
      }, { run: 0, max: 0 }).max)
      : null,
    ...(() => {
      const vide = {
        CUTS_LE_80MS: null, CUTS_80_120MS: null, CUTS_GT_120MS: null, CUTS_IN_STRONG_ZONE: null, CUTS_IN_STRONG_ZONE_LE_80MS: null,
        CUTS_PERCUSSION_LE_80MS: null, CUTS_PERCUSSION_80_120MS: null, CUTS_PERCUSSION_GT_120MS: null,
      };
      const fortes = (rythme?.impacts ?? []).filter((i) => i.force >= FORCE_PERCUSSION_FORTE).map((i) => i.t);
      const reelles = (rythme?.impacts ?? []).filter((i) => i.force >= FORCE_PERCUSSION_SECONDAIRE).map((i) => i.t);
      if (!fortes.length || !coupes.length) return vide;
      const ecart = (l: number[]) => (c: number) => Math.min(...l.map((t) => Math.abs(t - c)));
      const ecarts = coupes.map(ecart(fortes));
      const ecartsReels = coupes.map(ecart(reelles));
      const le = (e: number) => e <= 0.08 + 1e-9;
      const mi = (e: number) => e > 0.08 + 1e-9 && e <= 0.12 + 1e-9;
      const gt = (e: number) => e > 0.12 + 1e-9;
      const zone = ecarts.filter((_, i) => coupes[i] <= Math.max(...fortes) + 0.12);
      return {
        CUTS_LE_80MS: ecarts.filter(le).length,
        CUTS_80_120MS: ecarts.filter(mi).length,
        CUTS_GT_120MS: ecarts.filter(gt).length,
        CUTS_IN_STRONG_ZONE: zone.length,
        CUTS_IN_STRONG_ZONE_LE_80MS: zone.filter(le).length,
        CUTS_PERCUSSION_LE_80MS: ecartsReels.filter(le).length,
        CUTS_PERCUSSION_80_120MS: ecartsReels.filter(mi).length,
        CUTS_PERCUSSION_GT_120MS: ecartsReels.filter(gt).length,
      };
    })(),
  };
}
