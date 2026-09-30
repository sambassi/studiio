/**
 * RYTHME DE LA MUSIQUE — analyse LOCALE, gratuite, sans fournisseur.
 *
 * Entrée : le signal mono (Float32, -1..1) et sa fréquence. Sortie :
 *   - `bpm` estimé (autocorrélation de l'enveloppe d'attaques, 70–180) ;
 *   - `beats` : la grille des temps, calée sur les attaques réelles ;
 *   - `forts` : les temps qui tombent sur une attaque nette (percussion) ;
 *   - `drop` : l'instant de la plus forte montée d'énergie (si nette).
 *
 * Utilisé par le Smart Montage pour placer les coupes près des temps forts
 * — sans couper mécaniquement sur chaque temps. Même fonction pour le
 * navigateur (Créer) et le serveur (Autopilote).
 */

export interface RythmeMusique {
  bpm: number | null;
  beats: number[];
  forts: number[];
  drop: number | null;
}

const HOP_S = 0.02; // 20 ms

/** Enveloppe d'attaques : hausse de log-énergie, redressée. Pure. */
export function enveloppeAttaques(signal: Float32Array, hz: number): Float32Array {
  const hop = Math.max(1, Math.round(HOP_S * hz));
  const n = Math.floor(signal.length / hop);
  const energie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += signal[j] * signal[j];
    energie[i] = Math.log(1e-6 + s / hop);
  }
  const env = new Float32Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, energie[i] - energie[i - 1]);
  return env;
}

export function analyserRythme(signal: Float32Array, hz: number): RythmeMusique {
  const env = enveloppeAttaques(signal, hz);
  const n = env.length;
  if (n < 50) return { bpm: null, beats: [], forts: [], drop: null };

  // ── Tempo : autocorrélation de l'enveloppe, 70–180 BPM ──
  const lagMin = Math.round(60 / 180 / HOP_S);
  const lagMax = Math.round(60 / 70 / HOP_S);
  let meilleurLag = 0; let meilleur = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    s /= n - lag;
    if (s > meilleur) { meilleur = s; meilleurLag = lag; }
  }
  const periode = meilleurLag * HOP_S;
  const bpm = meilleurLag ? Math.round(60 / periode) : null;

  // ── Attaques nettes : pics au-dessus d'un seuil adaptatif ──
  const fenetre = Math.round(1 / HOP_S);
  const attaques: Array<{ t: number; force: number }> = [];
  for (let i = 1; i < n - 1; i++) {
    if (env[i] <= env[i - 1] || env[i] < env[i + 1]) continue;
    let s = 0; let s2 = 0; let c = 0;
    for (let j = Math.max(0, i - fenetre); j < Math.min(n, i + fenetre); j++) { s += env[j]; s2 += env[j] * env[j]; c++; }
    const moy = s / c; const et = Math.sqrt(Math.max(0, s2 / c - moy * moy));
    if (env[i] > moy + 1.5 * et && env[i] > 0.05) attaques.push({ t: i * HOP_S, force: env[i] });
  }

  // ── Grille de temps calée sur les attaques ──
  const beats: number[] = [];
  const forts: number[] = [];
  if (periode > 0 && attaques.length) {
    // Phase : celle qui aligne le plus d'attaques sur la grille.
    let meilleurePhase = 0; let meilleurScore = -1;
    for (let k = 0; k < 20; k++) {
      const phase = (k / 20) * periode;
      let score = 0;
      for (const a of attaques) {
        const d = Math.abs(((a.t - phase) % periode + periode) % periode);
        if (Math.min(d, periode - d) < 0.05) score += a.force;
      }
      if (score > meilleurScore) { meilleurScore = score; meilleurePhase = phase; }
    }
    const duree = n * HOP_S;
    const forceMediane = [...attaques].map((a) => a.force).sort((a, b) => a - b)[Math.floor(attaques.length / 2)];
    for (let t = meilleurePhase; t < duree; t += periode) {
      const r = Math.round(t * 1000) / 1000;
      beats.push(r);
      const proche = attaques.find((a) => Math.abs(a.t - t) < 0.06);
      if (proche && proche.force >= forceMediane) forts.push(r);
    }
  }

  // ── Drop : plus forte hausse d'énergie moyenne (fenêtres de 2 s) ──
  const pas2 = Math.round(2 / HOP_S);
  const hop = Math.max(1, Math.round(HOP_S * hz));
  const rms: number[] = [];
  for (let i = 0; i + pas2 <= n; i += pas2) {
    let s = 0;
    for (let j = i * hop; j < (i + pas2) * hop && j < signal.length; j++) s += signal[j] * signal[j];
    rms.push(Math.sqrt(s / (pas2 * hop)));
  }
  let drop: number | null = null; let saut = 0;
  for (let i = 2; i < rms.length; i++) {
    const hausse = rms[i] - (rms[i - 1] + rms[i - 2]) / 2;
    if (hausse > saut) { saut = hausse; drop = i * 2; }
  }
  const moyRms = rms.reduce((a, b) => a + b, 0) / Math.max(1, rms.length);
  if (saut < moyRms * 0.35) drop = null; // pas de montée nette : pas de drop annoncé

  return { bpm, beats, forts, drop };
}

/** Recale un rythme sur une fenêtre de la musique [debut, debut+duree]. Pure. */
export function rythmeSurFenetre(r: RythmeMusique, debut: number, duree: number): RythmeMusique {
  const dans = (t: number) => t >= debut && t <= debut + duree;
  const decale = (t: number) => Math.round((t - debut) * 1000) / 1000;
  return {
    bpm: r.bpm,
    beats: r.beats.filter(dans).map(decale),
    forts: r.forts.filter(dans).map(decale),
    drop: r.drop !== null && dans(r.drop) ? decale(r.drop) : null,
  };
}
