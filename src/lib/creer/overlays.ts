/**
 * SURIMPRESSIONS (Smart Montage V3) — pour les profils dynamiques, la vidéo
 * NE S'ARRÊTE PLUS pour afficher le titre, les cartes ou le CTA : le rush
 * joue en continu et les textes passent PAR-DESSUS.
 *
 *   titre   : pendant le HOOK (≈ 2,5–4 s depuis 0)
 *   cartes  : une statistique à la fois, 1,5–3 s, dans BUILD / PEAK / FOCUS
 *   CTA     : sur les 2–3 dernières secondes, rush derrière
 *
 * Les cartes n'ajoutent AUCUNE durée : elles vivent dans les phases. Les voix
 * off par séquence sont recalées sur ces fenêtres, l'une après l'autre, sans
 * se chevaucher. Module PUR : testable, partagé par le rendu et les métadonnées.
 */

import { TEXTES_PROFILS, type NomProfilMontage } from '@/lib/creer/smart-montage-regles';

export type CleVoix = 'titre' | 'cartes' | 'video' | 'cta';

export interface OverlaysMontage {
  titre: [number, number] | null;
  cartes: Array<{ index: number; debut: number; fin: number }>;
  cta: [number, number] | null;
  /** Départ (s) de chaque voix off de séquence, dans la vidéo continue. */
  voix: Partial<Record<CleVoix, number>>;
}

const r = (n: number) => Math.round(n * 1000) / 1000;

/** Profils dont les textes passent en surimpression sur le rush. */
export function profilEnSurimpression(profil: string | null | undefined): boolean {
  return profil === 'CARDIO_DANCE' || profil === 'EVENT_IMMERSIVE';
}

export function planOverlays(input: {
  /** Durée de la vidéo continue (le plan de montage). */
  duree: number;
  /**
   * Profil de montage : ses règles de TEXTES (`TEXTES_PROFILS`, partagées
   * Créer / Autopilote). Absent : les durées d'avant (cartes 1,5–3 s).
   */
  profil?: NomProfilMontage | null;
  nbCartes: number;
  /** Fin du HOOK dans le plan (s), si connue. */
  finHook?: number | null;
  /** Durée mesurée de chaque voix off (s). */
  voix?: Partial<Record<CleVoix, number>>;
}): OverlaysMontage {
  const { duree, nbCartes } = input;
  const voix = input.voix ?? {};
  if (!(duree > 0)) return { titre: null, cartes: [], cta: null, voix: {} };
  const regles = input.profil ? TEXTES_PROFILS[input.profil] : null;
  // Moins de 30 s : les durées minimales se réduisent en proportion.
  const echelle = Math.min(1, duree / 30);
  const carteMin = regles ? Math.max(1.5, regles.cartes.dureeMin * echelle) : 1.5;
  const carteMax = regles ? regles.cartes.dureeMax : 3;
  const titreMax = regles ? regles.accroche.dureeMax : 4;

  // Titre : pendant le HOOK, lisible (≥ 2,5 s), jamais plus de `titreMax` —
  // ou la durée de sa voix si elle est plus longue (dans la limite de 25 %).
  const premiere = regles?.premiereCarte ?? null;
  const finTitre = premiere
    // #504 (danse) : l'accroche se resserre sur ≈ 0–2 s pour que la première
    // carte arrive entre 1,8 et 2,5 s — sauf voix de titre plus longue.
    ? Math.max(Math.min(premiere[1] - 0.4, Math.max(premiere[0] - 0.2, input.finHook ?? premiere[0])), Math.min(duree * 0.25, voix.titre ?? 0))
    : Math.min(duree * 0.25, Math.max(2.5, Math.min(titreMax, input.finHook ?? 3), voix.titre ?? 0));
  const titre: [number, number] = [0, r(finTitre)];

  // CTA : les 2–3 dernières secondes (plus si sa voix l'exige, ≤ 25 %).
  const dureeCta = Math.min(duree * 0.25, Math.max(2.5, Math.min(3, voix.cta ?? 2.5), voix.cta ?? 0));
  const cta: [number, number] = [r(duree - dureeCta), r(duree)];

  // Cartes : entre le titre et le CTA, une à la fois (`carteMin`–`carteMax`),
  // avec un court répit entre deux. Trop peu de place : on en montre moins.
  const cartes: OverlaysMontage['cartes'] = [];
  const debutZone = premiere ? Math.max(premiere[0], titre[1] + 0.2) : titre[1] + 0.4;
  const finZone = cta[0] - 0.4;
  const place = finZone - debutZone;
  if (nbCartes > 0 && place >= carteMin) {
    const n = Math.min(nbCartes, Math.floor((place + 0.4) / (carteMin + 0.4)));
    const creneau = place / n;
    const dureeCarte = Math.min(carteMax, Math.max(carteMin, creneau - 0.4));
    for (let i = 0; i < n; i++) {
      // Danse : la première carte s'ouvre au début de la zone (≈ 2 s), pas au milieu de son créneau.
      const debut = debutZone + i * creneau + (premiere ? 0 : (creneau - dureeCarte) / 2);
      cartes.push({ index: i, debut: r(debut), fin: r(debut + dureeCarte) });
    }
  }

  // Voix : l'une après l'autre, chacune à sa fenêtre, jamais avant la fin de
  // la précédente (deux voix superposées seraient inaudibles).
  const departs: Partial<Record<CleVoix, number>> = {};
  let libre = 0;
  const poser = (cle: CleVoix, souhait: number) => {
    const s = voix[cle];
    if (!s) return;
    const depart = Math.max(souhait, libre);
    departs[cle] = r(depart);
    libre = depart + s + 0.2;
  };
  poser('titre', 0);
  poser('cartes', cartes[0]?.debut ?? titre[1]);
  poser('video', libre);
  poser('cta', cta[0]);

  return { titre, cartes, cta, voix: departs };
}

/** Relit des surimpressions stockées en métadonnées ; `null` si mal formées. */
export function overlaysDepuisMetadata(v: unknown): OverlaysMontage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const paire = (x: unknown): [number, number] | null =>
    Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [x[0], x[1]] : null;
  const cartes = Array.isArray(o.cartes)
    ? o.cartes.filter((c): c is { index: number; debut: number; fin: number } =>
      !!c && typeof c === 'object' && ['index', 'debut', 'fin'].every((k) => typeof (c as Record<string, unknown>)[k] === 'number'))
    : [];
  const voix: Partial<Record<CleVoix, number>> = {};
  if (o.voix && typeof o.voix === 'object') {
    for (const k of ['titre', 'cartes', 'video', 'cta'] as const) {
      const n = (o.voix as Record<string, unknown>)[k];
      if (typeof n === 'number' && Number.isFinite(n)) voix[k] = n;
    }
  }
  return { titre: paire(o.titre), cartes, cta: paire(o.cta), voix };
}
