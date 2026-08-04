/**
 * Regles du lecteur audio a ondes.
 *
 * Fonctions PURES : le composant qui les utilise ne peut pas etre exerce en
 * jsdom — il n'y a ni lecture audio, ni `AudioContext`, ni boite englobante
 * mesurable. Tout ce qui merite d'etre juste vit donc ici.
 */

/** Nombre de barres dessinees par defaut. */
export const BAR_COUNT = 48;

/** Vitesses proposees, dans l'ordre du cycle. */
export const PLAYBACK_RATES = [1, 1.5, 2] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/** Vitesse suivante du cycle — revient a 1x apres la derniere. */
export function nextPlaybackRate(current: number): PlaybackRate {
  const i = PLAYBACK_RATES.indexOf(current as PlaybackRate);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

/** Etiquette de la pastille : « 1× », « 1.5× », « 2× ». */
export function rateLabel(rate: number): string {
  return `${rate}×`;
}

/** Chrono `M:SS`, jamais negatif ni `NaN`. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Onde decorative, STABLE pour une meme graine.
 *
 * Un `Math.random()` redessinerait une onde differente a chaque rendu — la
 * forme sauterait a chaque `timeupdate`, quatre fois par seconde. La graine
 * derive de la source et de la duree : la meme piste rend toujours la meme
 * onde.
 *
 * Les hauteurs restent entre 0,15 et 1 : une barre a zero laisserait un trou
 * dans l'onde, qu'on lirait comme un silence alors qu'il n'y en a pas.
 */
export function pseudoWaveform(seed: number, count: number = BAR_COUNT): number[] {
  const n = Math.max(1, Math.floor(count));
  // Generateur congruentiel : deterministe, sans dependance.
  let etat = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  const suivant = () => {
    etat = (etat * 16807) % 2147483647;
    return etat / 2147483647;
  };
  const barres: number[] = [];
  for (let i = 0; i < n; i += 1) {
    // Une enveloppe en cloche evite l'onde « rectangulaire » : une vraie voix
    // demarre et finit plus bas qu'en son milieu.
    const enveloppe = 0.55 + 0.45 * Math.sin((Math.PI * i) / (n - 1 || 1));
    barres.push(Math.min(1, Math.max(0.15, suivant() * enveloppe + 0.15)));
  }
  return barres;
}

/** Graine derivee d'une chaine — meme URL, meme onde. */
export function seedFromString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Vraies amplitudes : un echantillon PCM reduit a `count` barres.
 *
 * On prend le MAXIMUM absolu de chaque tranche, et non la moyenne : la moyenne
 * d'un signal audio centre sur zero tend vers zero, et l'onde serait plate.
 *
 * Le resultat est normalise sur son propre maximum — un enregistrement fait a
 * voix basse doit remplir la hauteur disponible, comme un autre.
 */
export function barsFromSamples(samples: Float32Array | number[], count: number = BAR_COUNT): number[] {
  const n = Math.max(1, Math.floor(count));
  const total = samples.length;
  if (total === 0) return new Array(n).fill(0.15);

  const taille = total / n;
  const bruts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const debut = Math.floor(i * taille);
    const fin = Math.min(total, Math.floor((i + 1) * taille));
    let crete = 0;
    for (let j = debut; j < fin; j += 1) {
      const v = Math.abs(samples[j]);
      if (v > crete) crete = v;
    }
    bruts.push(crete);
  }

  const max = Math.max(...bruts);
  if (max <= 0) return new Array(n).fill(0.15);
  return bruts.map((v) => Math.max(0.15, v / max));
}

/**
 * Position visee dans l'onde, en fraction de 0 a 1.
 *
 * Bornee : un glissement qui sort du cadre — ce qui arrive des qu'on tire au
 * dela du bord — donnerait sinon un `currentTime` negatif, que le navigateur
 * refuse en levant une exception.
 */
export function ratioFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!rect.width || !Number.isFinite(clientX)) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

/** Une barre est-elle deja lue ? */
export function barPlayed(index: number, count: number, progress: number): boolean {
  if (count <= 0) return false;
  return index / count < Math.min(1, Math.max(0, progress));
}
