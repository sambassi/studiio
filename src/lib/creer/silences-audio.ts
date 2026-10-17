/**
 * M3-a PR2 — SILENCES MESURÉS sur trames de 50 ms (module PUR).
 *
 * Appelé là où le son est DÉJÀ décodé (aucun second décodage, aucun appel) :
 *   - serveur : PCM s16le mono 8 kHz écrit par le MÊME passage ffmpeg que les
 *     images (`analyse-rush-serveur.ts`, `mesurerSourceLue`) ;
 *   - navigateur : buffer `decodeAudioData` déjà en mémoire (`analyse-rush.ts`,
 *     `energieAudio`).
 *
 * Règle de l'agent Audio (`m3a-audio/verite-terrain-audio.md`) : un silence
 * franc est une suite de trames de 50 ms qui dure ≥ 300 ms et dont TOUTES les
 * trames sont sous `min(-45 dBFS, p90 des trames actives − 25 dB)`.
 *
 * Ce que cela prouve, honnêtement : qu'à cet endroit on ne coupe pas dans un
 * son. JAMAIS qu'une phrase est finie (il faudrait une transcription).
 * Libellé : « coupe dans un silence », jamais « fin de phrase ».
 *
 * Coût : un passage linéaire sur les échantillons + une autocorrélation sur
 * l'enveloppe des trames (≤ 3 600 trames pour 180 s). Mémoire : le seul
 * tableau des trames.
 */

export const SEUILS_SILENCES = {
  /** Durée d'une trame (s). */
  trameS: 0.05,
  /** Silence franc : durée minimale (s). */
  silenceMinS: 0.3,
  /** Plafond absolu du seuil de silence (dBFS). */
  plafondDb: -45,
  /** Seuil relatif : p90 des trames actives moins cet écart (dB). */
  ecartP90Db: 25,
  /** Trame « active » (prise en compte pour le p90) au-dessus de ce niveau (dBFS). */
  actifDb: -60,
  /** Part sonore (trames hors silence franc) au-delà de laquelle le son est continu. */
  partSonoreMax: 0.8,
  /** Pulsation musicale : pic d'autocorrélation d'enveloppe au-delà… */
  pulsationPic: 0.5,
  /** …sur au moins cette part des fenêtres sonores de 4 s… */
  pulsationPart: 0.5,
  /** …à une période stable (écart absolu médian des périodes, s). */
  pulsationStableS: 0.1,
  /** Niveau d'une trame vide (dBFS). */
  plancherDb: -120,
} as const;

export interface MesureSilences {
  /** Silences francs [début, fin] en secondes (vide = aucun). */
  silences: Array<[number, number]>;
  /** Seuil utilisé (dBFS). */
  seuilDb: number;
  /** Part des trames hors silence franc (0..1). */
  partSonore: number;
  /** Son continu (part sonore > 80 %) ou pulsation musicale : la parole n'est pas localisable. */
  sonContinu: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * RMS (dBFS) par trame de `trameS` secondes. `lire(i)` rend l'échantillon i
 * dans -1..1. Une trame vide ou nulle vaut `plancherDb`.
 */
export function tramesRms(n: number, lire: (i: number) => number, hz: number, trameS: number = SEUILS_SILENCES.trameS): Float32Array {
  // Bornes de trame recalculées à chaque trame (22 050 Hz : 1 102,5 échantillons
  // par trame) : aucune dérive de l'horodatage sur un long rush.
  const parTrame = Math.max(1, hz * trameS);
  const nb = Math.floor(n / parTrame + 1e-9);
  const out = new Float32Array(nb);
  for (let k = 0, i = 0; k < nb; k++) {
    let s = 0;
    const fin = Math.min(n, Math.round((k + 1) * parTrame));
    const debut = i;
    for (; i < fin; i++) { const v = lire(i); s += v * v; }
    const r = fin > debut ? Math.sqrt(s / (fin - debut)) : 0;
    out[k] = r > 0 ? Math.max(SEUILS_SILENCES.plancherDb, 20 * Math.log10(r)) : SEUILS_SILENCES.plancherDb;
  }
  return out;
}

/** Trames depuis des échantillons flottants (navigateur : `AudioBuffer.getChannelData`). */
export function tramesDepuisEchantillons(samples: ArrayLike<number>, hz: number): Float32Array {
  return tramesRms(samples.length, (i) => samples[i], hz);
}

/** Trames depuis du PCM s16le mono (serveur : sortie ffmpeg). */
export function tramesDepuisPcm(pcm: Uint8Array, hz: number): Float32Array {
  const n = Math.floor(pcm.byteLength / 2);
  if (pcm.byteOffset % 2 === 0) {
    const v = new Int16Array(pcm.buffer, pcm.byteOffset, n);
    return tramesRms(n, (i) => v[i] / 32768, hz);
  }
  const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return tramesRms(n, (i) => dv.getInt16(i * 2, true) / 32768, hz);
}

/** Seuil de silence franc : `min(-45, p90 des trames actives − 25)`. */
export function seuilSilence(trames: ArrayLike<number>): number {
  const S = SEUILS_SILENCES;
  const actifs: number[] = [];
  for (let i = 0; i < trames.length; i++) if (trames[i] > S.actifDb) actifs.push(trames[i]);
  if (!actifs.length) return S.plafondDb;
  actifs.sort((a, b) => a - b);
  const p90 = actifs[Math.floor(0.9 * (actifs.length - 1))];
  return Math.min(S.plafondDb, p90 - S.ecartP90Db);
}

/** Silences francs : suites de trames TOUTES sous le seuil, d'au moins 300 ms. */
export function silencesFrancs(trames: ArrayLike<number>, seuil: number = seuilSilence(trames), trameS: number = SEUILS_SILENCES.trameS): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const minTrames = Math.ceil(SEUILS_SILENCES.silenceMinS / trameS - 1e-9);
  let k = -1;
  for (let i = 0; i <= trames.length; i++) {
    const sous = i < trames.length && trames[i] < seuil;
    if (sous && k < 0) k = i;
    if (!sous && k >= 0) {
      if (i - k >= minTrames) out.push([r2(k * trameS), r2(i * trameS)]);
      k = -1;
    }
  }
  return out;
}

/**
 * Pulsation musicale : autocorrélation de l'enveloppe (fenêtres de 4 s, pas de
 * 1 s, périodes 0,3–1,5 s). Vrai si la plupart des fenêtres sonores ont un pic
 * > 0,5 à une période stable.
 */
export function pulsationMusicale(trames: ArrayLike<number>, seuil: number, trameS: number = SEUILS_SILENCES.trameS): boolean {
  const S = SEUILS_SILENCES;
  const W = Math.round(4 / trameS); const pasF = Math.round(1 / trameS);
  const lagMin = Math.round(0.3 / trameS); const lagMax = Math.round(1.5 / trameS);
  if (trames.length < W) return false;
  const env = new Float64Array(trames.length);
  for (let i = 0; i < trames.length; i++) env[i] = Math.pow(10, trames[i] / 20);
  let sonores = 0;
  const periodes: number[] = [];
  const e = new Float64Array(W);
  for (let o = 0; o + W <= trames.length; o += pasF) {
    let actives = 0; let moy = 0;
    for (let j = 0; j < W; j++) { if (trames[o + j] >= seuil) actives += 1; moy += env[o + j]; }
    if (actives < W * 0.8) continue; // fenêtre coupée par des silences : la parole s'y lit, pas une pulsation
    sonores += 1;
    moy /= W;
    let a0 = 0;
    for (let j = 0; j < W; j++) { e[j] = env[o + j] - moy; a0 += e[j] * e[j]; }
    if (a0 <= 1e-20) continue;
    let pic = -1; let lagPic = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0;
      for (let j = 0; j + lag < W; j++) s += e[j] * e[j + lag];
      const c = s / a0;
      if (c > pic) { pic = c; lagPic = lag; }
    }
    if (pic > S.pulsationPic) periodes.push(lagPic * trameS);
  }
  if (!sonores || periodes.length < Math.max(2, S.pulsationPart * sonores)) return false;
  const tri = [...periodes].sort((a, b) => a - b);
  const med = tri[Math.floor(tri.length / 2)];
  const ecarts = tri.map((p) => Math.abs(p - med)).sort((a, b) => a - b);
  return ecarts[Math.floor(ecarts.length / 2)] <= S.pulsationStableS + 1e-9;
}

/** Mesure complète sur des trames déjà calculées. Pure. */
export function mesurerSilences(trames: ArrayLike<number>, trameS: number = SEUILS_SILENCES.trameS): MesureSilences {
  const seuilDb = seuilSilence(trames);
  const silences = silencesFrancs(trames, seuilDb, trameS);
  const enSilence = silences.reduce((t, [a, b]) => t + Math.round((b - a) / trameS), 0);
  const partSonore = trames.length ? Math.max(0, 1 - enSilence / trames.length) : 0;
  const sonContinu = trames.length > 0 && (partSonore > SEUILS_SILENCES.partSonoreMax || pulsationMusicale(trames, seuilDb, trameS));
  return { silences, seuilDb: r2(seuilDb), partSonore: r2(partSonore), sonContinu };
}

/** Serveur : silences depuis le PCM s16le mono déjà écrit par ffmpeg. */
export function silencesDepuisPcm(pcm: Uint8Array, hz: number): MesureSilences {
  return mesurerSilences(tramesDepuisPcm(pcm, hz));
}

/** Navigateur : silences depuis le canal déjà décodé (`decodeAudioData`). */
export function silencesDepuisEchantillons(samples: ArrayLike<number>, hz: number): MesureSilences {
  return mesurerSilences(tramesDepuisEchantillons(samples, hz));
}

/**
 * Piste audio d'après le journal ffmpeg du passage DÉJÀ fait (`-loglevel
 * info` liste les flux d'entrée) : `true` si un flux audio est listé,
 * `false` si les flux sont listés sans audio, `null` si on ne sait pas.
 */
export function pisteAudioDepuisJournal(journal: string): boolean | null {
  if (/Stream #\d+:\d+[^\n]*: Audio:/.test(journal)) return true;
  if (/Stream #\d+:\d+[^\n]*: Video:/.test(journal)) return false;
  return null;
}
