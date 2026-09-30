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
  nbCartes: number;
  /** Fin du HOOK dans le plan (s), si connue. */
  finHook?: number | null;
  /** Durée mesurée de chaque voix off (s). */
  voix?: Partial<Record<CleVoix, number>>;
}): OverlaysMontage {
  const { duree, nbCartes } = input;
  const voix = input.voix ?? {};
  if (!(duree > 0)) return { titre: null, cartes: [], cta: null, voix: {} };

  // Titre : pendant le HOOK, lisible (≥ 2,5 s), jamais plus de 4 s — ou la
  // durée de sa voix si elle est plus longue (dans la limite de 25 %).
  const finTitre = Math.min(duree * 0.25, Math.max(2.5, Math.min(4, input.finHook ?? 3), voix.titre ?? 0));
  const titre: [number, number] = [0, r(finTitre)];

  // CTA : les 2–3 dernières secondes (plus si sa voix l'exige, ≤ 25 %).
  const dureeCta = Math.min(duree * 0.25, Math.max(2.5, Math.min(3, voix.cta ?? 2.5), voix.cta ?? 0));
  const cta: [number, number] = [r(duree - dureeCta), r(duree)];

  // Cartes : entre le titre et le CTA, une à la fois, 1,5–3 s chacune, avec
  // un court répit entre deux. Trop peu de place : on en montre moins.
  const cartes: OverlaysMontage['cartes'] = [];
  const debutZone = titre[1] + 0.4;
  const finZone = cta[0] - 0.4;
  const place = finZone - debutZone;
  if (nbCartes > 0 && place >= 1.5) {
    const n = Math.min(nbCartes, Math.floor((place + 0.4) / (1.5 + 0.4)));
    const creneau = place / n;
    const dureeCarte = Math.min(3, Math.max(1.5, creneau - 0.4));
    for (let i = 0; i < n; i++) {
      const debut = debutZone + i * creneau + (creneau - dureeCarte) / 2;
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
