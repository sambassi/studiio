/**
 * M3-a PR2 — silences mesurés sur trames de 50 ms (`silences-audio.ts`).
 * PCM synthétique (silence numérique, bruit, souffle, musique pulsée, piste
 * vide) + trames RÉELLES des 2 rushes personnels à 8 / 16 / 22,05 / 48 kHz
 * (fixture sans son reconstructible), comparées à la vérité de l'agent Audio.
 */
import { describe, it, expect } from 'vitest';
import {
  tramesDepuisPcm, tramesDepuisEchantillons, mesurerSilences, silencesFrancs, seuilSilence, pulsationMusicale,
  silencesDepuisPcm, silencesDepuisEchantillons, pisteAudioDepuisJournal, SEUILS_SILENCES,
} from '@/lib/creer/silences-audio';
import { mesuresSonFines } from '@/lib/creer/analyse-rush-serveur';
import fx from './fixtures/silences-trames-reelles.json';

const HZ = 8000;
/** Générateur déterministe (LCG) : aucun aléa entre deux exécutions. */
function lcg(graine: number) { let x = graine >>> 0; return () => ((x = (1664525 * x + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
type Morceau = [number, 'zero' | 'parole' | 'bruit-50' | 'souffle-40' | 'musique'];
function signal(morceaux: Morceau[], hz = HZ): Float32Array {
  const n = morceaux.reduce((t, [d]) => t + Math.round(d * hz), 0);
  const out = new Float32Array(n);
  const alea = lcg(7);
  let o = 0;
  for (const [d, k] of morceaux) {
    const m = Math.round(d * hz);
    for (let i = 0; i < m; i++) {
      const t = i / hz;
      let v = 0;
      if (k === 'parole') v = 0.14 * Math.sin(2 * Math.PI * 210 * t) * (0.55 + 0.45 * Math.sin(2 * Math.PI * (3.1 + 0.7 * Math.sin(t)) * t));
      else if (k === 'bruit-50') v = alea() * 0.00316 * Math.sqrt(3);
      else if (k === 'souffle-40') v = alea() * 0.01 * Math.sqrt(3);
      else if (k === 'musique') v = (t % 0.4 < 0.1 ? 0.25 : 0.02) * Math.sin(2 * Math.PI * 440 * t);
      out[o + i] = v;
    }
    o += m;
  }
  return out;
}
const enPcm = (f: Float32Array) => {
  const b = new Uint8Array(f.length * 2); const dv = new DataView(b.buffer);
  f.forEach((v, i) => dv.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true));
  return b;
};

describe('PR2 — trames de 50 ms et silences francs (synthétique)', () => {
  it('silence numérique ≥ 0,3 s = silence franc ; creux de 0,25 s ignoré', () => {
    const m = silencesDepuisEchantillons(signal([[1, 'zero'], [2, 'parole'], [0.6, 'zero'], [2, 'parole'], [0.25, 'zero'], [2, 'parole'], [1, 'zero']]), HZ);
    expect(m.silences).toEqual([[0, 1], [3, 3.6], [7.85, 8.85]]);
    expect(m.sonContinu).toBe(false);
  });

  it('bruit de fond à -50 dBFS entre deux phrases : silence (seuil min(-45, p90 − 25))', () => {
    const tr = tramesDepuisEchantillons(signal([[2, 'parole'], [0.5, 'bruit-50'], [2, 'parole']]), HZ);
    expect(seuilSilence(tr)).toBeLessThanOrEqual(-45);
    expect(silencesFrancs(tr)).toEqual([[2, 2.5]]);
  });

  it('souffle à -40 dBFS (respiration audible) : PAS un silence', () => {
    expect(silencesDepuisEchantillons(signal([[2, 'parole'], [0.4, 'souffle-40'], [2, 'parole']]), HZ).silences).toEqual([]);
  });

  it('musique pulsée à 150 BPM : son continu (pulsation), même avec 30 % de silence', () => {
    const tr = tramesDepuisEchantillons(signal([[10, 'musique'], [4, 'zero']]), HZ);
    const m = mesurerSilences(tr);
    expect(m.partSonore).toBeLessThanOrEqual(SEUILS_SILENCES.partSonoreMax);
    expect(pulsationMusicale(tr, m.seuilDb)).toBe(true);
    expect(m.sonContinu).toBe(true);
  });

  it('parole entrecoupée de pauses : pas de pulsation, son non continu', () => {
    const m = silencesDepuisEchantillons(signal([[2, 'parole'], [1, 'zero'], [2, 'parole'], [0.9, 'zero'], [2, 'parole'], [1, 'zero'], [2, 'parole']]), HZ);
    expect(m.silences.length).toBe(3);
    expect(m.sonContinu).toBe(false);
    // Les mêmes phrases presque sans pause (part sonore > 80 %) : son continu, rien n'est déduit.
    expect(silencesDepuisEchantillons(signal([[3, 'parole'], [0.4, 'zero'], [3, 'parole'], [0.4, 'zero'], [3, 'parole']]), HZ).sonContinu).toBe(true);
  });

  it('piste vide ou muette : aucun son, silences cohérents, jamais d\'exception', () => {
    expect(mesurerSilences(new Float32Array(0))).toEqual({ silences: [], seuilDb: -45, partSonore: 0, sonContinu: false });
    expect(silencesDepuisPcm(new Uint8Array(0), HZ).silences).toEqual([]);
    expect(silencesDepuisEchantillons(new Float32Array(HZ * 2), HZ).silences).toEqual([[0, 2]]);
  });

  it('PCM s16le (serveur) ≡ flottants (navigateur) sur le même signal', () => {
    const f = signal([[1, 'zero'], [2, 'parole'], [0.6, 'zero'], [2, 'parole']]);
    expect(silencesDepuisPcm(enPcm(f), HZ).silences).toEqual(silencesDepuisEchantillons(f, HZ).silences);
    // PCM non aligné (décalage impair) : même résultat.
    const b = enPcm(f); const decale = new Uint8Array(b.length + 1); decale.set(b, 1);
    expect(silencesDepuisPcm(decale.subarray(1), HZ).silences).toEqual(silencesDepuisEchantillons(f, HZ).silences);
  });

  it('coût borné : < 50 ms pour un rush analysé de 180 s à 8 kHz (pire cas serveur)', () => {
    const f = signal(Array.from({ length: 60 }, (_, i) => [3, i % 2 ? 'zero' : 'parole'] as Morceau));
    const pcm = enPcm(f);
    expect(f.length).toBe(180 * HZ);
    silencesDepuisPcm(pcm, HZ); // échauffement JIT
    const t0 = performance.now();
    const m = silencesDepuisPcm(pcm, HZ);
    const ms = performance.now() - t0;
    expect(m.silences.length).toBe(30);
    expect(ms).toBeLessThan(50);
  });
});

/** Vérité de l'agent Audio (`verite-terrain-audio.json`), rush converted_1791985445290. */
const PAUSES_AGENT: Array<[number, number]> = [[11.65, 12.4], [14.45, 15.25], [15.6, 16.5], [18.65, 19.75]];
const RESPIRATION: [number, number] = [17.65, 17.95];
const R = (fx as unknown as { rushes: Record<string, Record<string, number[]>> }).rushes;

describe('PR2 — rushes réels : 8 kHz (serveur) vs 16 kHz (seuils de l\'agent) vs navigateur', () => {
  const r1 = R.converted_1791985445290; const r2 = R.converted_1792081208949;
  const s8 = mesurerSilences(r1['8000']);

  it('rush 1 : les 4 pauses franches retrouvées (une par pause, contenue à ±50 ms), respiration de 17,65 s exclue', () => {
    const interieures = s8.silences.filter(([x, y]) => x > 1 && y < 31);
    expect(interieures.length).toBe(4);
    PAUSES_AGENT.forEach(([x, y], i) => {
      const [a, b] = interieures[i];
      expect(a).toBeGreaterThanOrEqual(x - 0.05);
      expect(b).toBeLessThanOrEqual(y + 0.05);
      expect(b - a).toBeGreaterThanOrEqual(0.3);
    });
    expect(s8.silences.some(([x, y]) => x < RESPIRATION[1] && y > RESPIRATION[0])).toBe(false);
    // Silence numérique avant et après l'orateur (titre et écran CTA de l'ancien montage).
    expect(s8.silences[0]).toEqual([0, 10.25]);
    expect(s8.silences.at(-1)).toEqual([20.1, 32]);
    expect(s8.sonContinu).toBe(false);
  });

  it('parité : 16 kHz, 22,05 kHz et 48 kHz donnent les mêmes silences que 8 kHz à ±50 ms', () => {
    for (const hz of ['16000', '22050', '48000']) {
      const s = mesurerSilences(r1[hz]).silences;
      expect(s.length, hz).toBe(s8.silences.length);
      s.forEach(([a, b], i) => {
        expect(Math.abs(a - s8.silences[i][0]), `${hz} début ${i}`).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(Math.abs(b - s8.silences[i][1]), `${hz} fin ${i}`).toBeLessThanOrEqual(0.05 + 1e-9);
      });
    }
  });

  it('rush 2 (fond continu puis musique) : AUCUNE pause, son continu, à toutes les fréquences', () => {
    for (const hz of ['8000', '16000', '22050', '48000']) {
      const m = mesurerSilences(r2[hz]);
      expect(m.silences, hz).toEqual([]);
      expect(m.sonContinu, hz).toBe(true);
    }
  });

  it('trames réelles recalculées depuis le PCM : même nombre de trames (50 ms) que la durée', () => {
    expect(r1['8000'].length).toBe(Math.floor(32.019 / 0.05));
    expect(tramesDepuisPcm(new Uint8Array(HZ * 2), HZ).length).toBe(20);
  });
});

describe('PR2 — sonde de piste depuis le journal ffmpeg du passage existant', () => {
  const avecSon = 'Input #0, mov,mp4\n  Stream #0:0[0x1](und): Video: h264 (High)\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, mono\n';
  const sansSon = 'Input #0, mov,mp4\n  Stream #0:0[0x1](und): Video: h264 (High)\n';
  it('journal : piste listée / absente / inconnue', () => {
    expect(pisteAudioDepuisJournal(avecSon)).toBe(true);
    expect(pisteAudioDepuisJournal(sansSon)).toBe(false);
    expect(pisteAudioDepuisJournal('')).toBe(null);
  });
  it('serveur : décodage impossible ⇒ `null`, jamais `false` ni un silence', () => {
    expect(mesuresSonFines(new Uint8Array(0), avecSon)).toEqual({ pisteAudio: null });
    expect(mesuresSonFines(new Uint8Array(0), sansSon)).toEqual({ pisteAudio: false });
    expect(mesuresSonFines(new Uint8Array(0), '')).toEqual({ pisteAudio: null });
    const m = mesuresSonFines(enPcm(signal([[1, 'zero'], [2, 'parole']])), avecSon);
    expect(m).toEqual({ pisteAudio: true, silences: [[0, 1]], sonContinu: false });
  });
});
