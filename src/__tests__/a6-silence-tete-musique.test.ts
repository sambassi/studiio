/**
 * A6 — la musique démarre AUDIBLE : silence de tête du fichier sauté.
 *
 * Caractérisation d'abord : sans musique, sans blanc de tête, ou mesure en
 * échec, le design (donc les props Remotion) et la commande ffmpeg hybride
 * sont IDENTIQUES à ceux d'avant. Puis : 2,27 s décalé, > 5 s borné, boucle,
 * ducking du jumeau (A2) préservé. Mesures ffmpeg RÉELLES sur des fichiers
 * synthétisés localement (aucun réseau).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  lireSilenceDeTete, departMusiquePourSilence, facteurFonduEntreeMusique, passesMusiqueEnBoucle,
  FONDU_ENTREE_MUSIQUE_S, SILENCE_TETE_MAX_S,
} from '@/lib/render/silence-tete-pur';
import { mesurerSilenceDeTete, avecDepartMusique } from '@/lib/render/silence-tete';
import { argumentsHybride, type EntreeHybride } from '@/lib/render/hybride/filtre';
import { facteurMusiqueJumeau, DUCK_MUSIQUE_JUMEAU } from '../../remotion/audio';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FF: string = require('ffmpeg-static');
// Le binaire ffmpeg-static peut manquer (CI) : la mesure réelle est alors sautée, comme les autres tests « vrai ffmpeg ».
const ffmpegPresent = typeof FF === 'string' && existsSync(FF);

const JOURNAL_ADOU = `[silencedetect @ 0x6] silence_start: 0
[silencedetect @ 0x6] silence_end: 2.2629 | silence_duration: 2.2629
[silencedetect @ 0x6] silence_start: 2.33571
[silencedetect @ 0x6] silence_end: 2.40644 | silence_duration: 0.0707256`;

describe('lecture du journal silencedetect (pure)', () => {
  it('adou.mp3 réel : 2,263 s de blanc de tête', () => {
    expect(lireSilenceDeTete(JOURNAL_ADOU)).toBeCloseTo(2.2629, 4);
  });
  it('aucun blanc : 0', () => { expect(lireSilenceDeTete('size=N/A time=00:00:05.50')).toBe(0); });
  it('premier blanc au milieu (pas en tête) : 0', () => {
    expect(lireSilenceDeTete('silence_start: 1.2\nsilence_end: 1.5 | silence_duration: 0.3')).toBe(0);
  });
  it('blanc jusqu au bout de la fenêtre lue : la fenêtre', () => {
    expect(lireSilenceDeTete('silence_start: 0', 5.5)).toBe(5.5);
  });
});

describe('départ de la musique (pure)', () => {
  it('0 s de blanc → aucun décalage', () => { expect(departMusiquePourSilence(0)).toBe(0); });
  it('blanc inaudible (< 0,05 s) → aucun décalage', () => { expect(departMusiquePourSilence(0.03)).toBe(0); });
  it('mesure absente / en échec → aucun décalage', () => {
    expect(departMusiquePourSilence(null)).toBe(0);
    expect(departMusiquePourSilence(undefined)).toBe(0);
    expect(departMusiquePourSilence(Number.NaN)).toBe(0);
  });
  it('2,27 s → départ reculé de la durée du fondu (aucun son réel coupé)', () => {
    expect(departMusiquePourSilence(2.2629)).toBeCloseTo(2.2629 - FONDU_ENTREE_MUSIQUE_S, 3);
  });
  it('> maximum → borné à 5 s (moins le fondu)', () => {
    expect(departMusiquePourSilence(9)).toBeCloseTo(SILENCE_TETE_MAX_S - FONDU_ENTREE_MUSIQUE_S, 3);
  });
  it('fondu d entrée : 1 partout sans décalage ; rampe de 0,15 s sinon', () => {
    for (const t of [0, 0.05, 0.1, 1, 10]) expect(facteurFonduEntreeMusique(t, undefined)).toBe(1);
    for (const t of [0, 0.05, 0.1, 1, 10]) expect(facteurFonduEntreeMusique(t, 0)).toBe(1);
    expect(facteurFonduEntreeMusique(0, 2.1)).toBe(0);
    expect(facteurFonduEntreeMusique(0.075, 2.1)).toBeCloseTo(0.5, 5);
    expect(facteurFonduEntreeMusique(0.15, 2.1)).toBe(1);
    expect(facteurFonduEntreeMusique(5, 2.1)).toBe(1);
  });
});

describe('design du rendu serveur : identique sans blanc', () => {
  const base = { title: 'T', musicUrl: 'https://s.test/m.mp3', musicVolume: 0.4 };
  it('sans musique : même objet, aucune mesure', async () => {
    const mesurer = vi.fn(async () => 2);
    const d = { title: 'T', musicUrl: null };
    expect(await avecDepartMusique(d, 'u', mesurer)).toBe(d);
    expect(mesurer).not.toHaveBeenCalled();
  });
  it('blanc 0 s : même objet (props Remotion inchangées)', async () => {
    expect(await avecDepartMusique(base, 'u', async () => 0)).toBe(base);
  });
  it('détection en erreur : même objet, le rendu continue', async () => {
    expect(await avecDepartMusique(base, 'u', async () => { throw new Error('ffmpeg'); })).toBe(base);
  });
  it('2,27 s : musicStartSeconds posé, le reste intact', async () => {
    const r = await avecDepartMusique(base, 'u', async () => 2.113);
    expect(r).toEqual({ ...base, musicStartSeconds: 2.113 });
  });
  it('départ déjà fixé : respecté, aucune mesure', async () => {
    const mesurer = vi.fn(async () => 2);
    const d = { ...base, musicStartSeconds: 0 };
    expect(await avecDepartMusique(d, 'u', mesurer)).toBe(d);
    expect(mesurer).not.toHaveBeenCalled();
  });
  it('URL hors de notre stockage : jamais lue (0, même objet)', async () => {
    expect(await avecDepartMusique({ title: 'T', musicUrl: 'https://tiers.example/m.mp3' }, 'u'))
      .toEqual({ title: 'T', musicUrl: 'https://tiers.example/m.mp3' });
  });
});

describe('boucle de la musique (pure)', () => {
  it('sans départ : passes d avant, à l identique (i × boucle)', () => {
    expect(passesMusiqueEnBoucle(300, 900, 0)).toEqual([
      { from: 0, duree: 300, trimBefore: 0 }, { from: 300, duree: 300, trimBefore: 0 }, { from: 600, duree: 300, trimBefore: 0 },
    ]);
    expect(passesMusiqueEnBoucle(1000, 900, 0)).toEqual([{ from: 0, duree: 900, trimBefore: 0 }]);
    expect(passesMusiqueEnBoucle(0, 900, 0)).toEqual([{ from: 0, duree: 900, trimBefore: 0 }]);
  });
  it('avec départ : 1re passe raccourcie, suivantes depuis le début du fichier, rien de perdu', () => {
    const p = passesMusiqueEnBoucle(300, 900, 64);
    expect(p[0]).toEqual({ from: 0, duree: 236, trimBefore: 64 });
    expect(p.slice(1)).toEqual([
      { from: 236, duree: 300, trimBefore: 0 }, { from: 536, duree: 300, trimBefore: 0 }, { from: 836, duree: 64, trimBefore: 0 },
    ]);
    // Couverture continue de toute la vidéo.
    expect(p.reduce((s, x) => s + x.duree, 0)).toBe(900);
  });
  it('morceau long : une seule passe décalée', () => {
    expect(passesMusiqueEnBoucle(5640, 600, 64)).toEqual([{ from: 0, duree: 600, trimBefore: 64 }]);
  });
  it('départ qui mangerait tout le morceau : ignoré', () => {
    expect(passesMusiqueEnBoucle(50, 900, 64)[0].trimBefore).toBe(0);
  });
});

describe('ducking du jumeau (A2) préservé', () => {
  it('le fondu ne multiplie que les 0,15 premières secondes ; la fenêtre du jumeau reste à 0,1', () => {
    const fenetre = { debut: 6, fin: 14 };
    const vol = (t: number, dep?: number) => 0.8 * facteurMusiqueJumeau(t, fenetre) * facteurFonduEntreeMusique(t, dep);
    for (const t of [0.2, 3, 5.9, 6, 10, 14, 14.3, 18]) expect(vol(t, 2.113)).toBe(vol(t));
    expect(vol(10, 2.113)).toBeCloseTo(0.8 * DUCK_MUSIQUE_JUMEAU, 6);
  });
});

describe('commande ffmpeg hybride', () => {
  const base = (musique: EntreeHybride['musique']): EntreeHybride => ({
    segments: [{ source: 'a.mp4', debut: 0, fin: 3, depuis: 0 }],
    duree: 3, fps: 30, largeur: 1080, hauteur: 1920, voile: null, filigrane: null,
    surimpressions: [], musique, voix: [], sortie: 'o.mp4',
  });
  it('sans départ : commande identique à celle d avant', () => {
    const a = argumentsHybride(base({ source: 'm.mp3', volume: 0.4 }));
    expect(a.join(' ')).toContain('[1:a]atrim=0:3,asetpts=PTS-STARTPTS,volume=0.4[am]');
    expect(argumentsHybride(base({ source: 'm.mp3', volume: 0.4, depart: 0 }))).toEqual(a);
  });
  it('avec départ : atrim depuis le départ + fondu d entrée, boucle conservée', () => {
    const a = argumentsHybride(base({ source: 'm.mp3', volume: 0.4, depart: 2.113 })).join(' ');
    expect(a).toContain('-stream_loop -1 -i m.mp3');
    expect(a).toContain(`atrim=start=2.113:end=5.113,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FONDU_ENTREE_MUSIQUE_S},volume=0.4[am]`);
  });
});

describe.skipIf(!ffmpegPresent)('mesure ffmpeg RÉELLE (fichiers synthétisés)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a6-silence-'));
  const fichier = (nom: string, blanc: number) => {
    const out = join(dir, nom);
    const entrees = blanc > 0
      ? ['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${blanc}`, '-f', 'lavfi', '-i', 'sine=f=440:d=3:r=44100',
        '-filter_complex', '[1:a]aformat=channel_layouts=stereo[s];[0:a][s]concat=n=2:v=0:a=1']
      : ['-f', 'lavfi', '-i', 'sine=f=440:d=3:r=44100'];
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...entrees, out]);
    return out;
  };
  let f0 = '', f227 = '', f8 = '';
  beforeAll(() => { f0 = fichier('0.wav', 0); f227 = fichier('227.wav', 2.27); f8 = fichier('8.wav', 8); });

  it('0 s : aucun blanc', async () => {
    expect(departMusiquePourSilence(await mesurerSilenceDeTete(f0, FF))).toBe(0);
  });
  it('2,27 s : départ ≈ 2,12 s', async () => {
    const s = await mesurerSilenceDeTete(f227, FF);
    expect(s).toBeGreaterThan(2.2);
    expect(s).toBeLessThan(2.33);
    expect(departMusiquePourSilence(s)).toBeCloseTo(2.27 - FONDU_ENTREE_MUSIQUE_S, 1);
  });
  it('8 s : borné à 5 s', async () => {
    expect(departMusiquePourSilence(await mesurerSilenceDeTete(f8, FF))).toBeCloseTo(SILENCE_TETE_MAX_S - FONDU_ENTREE_MUSIQUE_S, 3);
  });
  it('fichier illisible / ffmpeg introuvable : null → aucun décalage', async () => {
    expect(await mesurerSilenceDeTete(join(dir, 'absent.mp3'), FF)).toBeNull();
    expect(await mesurerSilenceDeTete(f227, '/chemin/inexistant/ffmpeg')).toBeNull();
  });
});
