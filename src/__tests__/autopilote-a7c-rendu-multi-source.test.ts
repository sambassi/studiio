/**
 * A_7c — LA PREUVE : PLUSIEURS RUSHES DANS UN SEUL MP4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE BANC ÉTABLIT, ET POURQUOI IL LIT DES PIXELS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le reste de la suite vérifie des CHAÎNES : que le graphe contient `xfade`,
 * que l'identité change, que la base garde la bonne clé. Rien de cela ne
 * prouve qu'une image de B apparaît réellement après une image de A. Un graphe
 * peut être écrit, accepté par ffmpeg, et monter quatre fois le même fichier :
 * la durée serait juste, la résolution juste, et la vidéo fausse.
 *
 * Ce banc rend donc de VRAIS MP4 depuis de VRAIS fichiers sources, et lit ce
 * que l'œil et l'oreille percevraient :
 *
 *   • LES COULEURS, pour dire quelle source est à l'image à quelle seconde ;
 *   • LES FRÉQUENCES, pour dire quel son accompagne cette image. C'est la
 *     mesure qui compte le plus : « image de B, son de A » est le défaut que
 *     personne ne remarque avant publication.
 *
 * ⚠️ AUCUN GRAPHE N'EST RECOPIÉ ICI. C'est `argumentsRendu` — la fonction de
 * production — qui est appelée. Un test qui réécrirait le graphe ne testerait
 * que sa propre copie.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import {
  argumentsRendu, type CibleRendu, type SourceLocale,
} from '@/lib/autopilot/analyse/rendu-ffmpeg';

const executer = promisify(execFile);

const L = 180;
const H = 320;
const FPS = 30;
const CIBLE: CibleRendu = { largeur: L, hauteur: H, fps: FPS };
const CROP = { largeur: 180, hauteur: 320, x: 0, y: 0 };

async function ffmpegDisponible(): Promise<boolean> {
  try { await executer('ffmpeg', ['-hide_banner', '-version']); return true; } catch { return false; }
}
const AVEC_FFMPEG = await ffmpegDisponible();

/**
 * Une source de test : une couleur unie, un son pur, une géométrie donnée.
 *
 * ⚠️ TROIS SIGNATURES DISTINCTES ET RECONNAISSABLES. Deux rushes qui se
 * ressemblent ne prouveraient rien : si le montage servait quatre fois le
 * premier fichier, la mesure passerait quand même.
 */
async function fabriquerSource(
  chemin: string,
  o: { couleur: string; hertz: number | null; secondes: number;
       largeur?: number; hauteur?: number; fps?: number },
): Promise<void> {
  const l = o.largeur ?? L;
  const h = o.hauteur ?? H;
  const f = o.fps ?? FPS;
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${o.couleur}:s=${l}x${h}:r=${f}:d=${o.secondes}`,
  ];
  if (o.hertz !== null) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=${o.hertz}:sample_rate=48000:d=${o.secondes}`);
    args.push('-c:a', 'aac', '-b:a', '96k');
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(o.secondes), '-y', chemin);
  await executer('ffmpeg', args);
}

/** Une frame, en RGB brut — la seule façon de lire ce que l'œil verrait. */
async function frameRgb(fichier: string, seconde: number): Promise<Uint8Array> {
  const dossier = await mkdtemp(join(tmpdir(), 'a7c-frame-'));
  const brut = join(dossier, 'f.raw');
  await executer('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(seconde), '-i', fichier, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', brut,
  ]);
  const octets = new Uint8Array(await readFile(brut));
  await rm(dossier, { recursive: true, force: true });
  return octets;
}

interface Couleur { r: number; g: number; b: number }

function moyenne(px: Uint8Array): Couleur {
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i + 2 < px.length; i += 3) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n += 1; }
  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n, g: g / n, b: b / n };
}

/** Laquelle des trois teintes domine — rouge, vert ou bleu. */
function teinte(c: Couleur): 'rouge' | 'vert' | 'bleu' | 'indecis' {
  const { r, g, b } = c;
  if (r > g + 40 && r > b + 40) return 'rouge';
  if (g > r + 40 && g > b + 40) return 'vert';
  if (b > r + 40 && b > g + 40) return 'bleu';
  return 'indecis';
}

const teinteA = (f: string, s: number) => frameRgb(f, s).then((p) => teinte(moyenne(p)));

/**
 * La fréquence dominante d'une tranche de son.
 *
 * ⚠️ MESURÉE, PAS DÉDUITE DU GRAPHE. On extrait les échantillons bruts et on
 * compte les passages par zéro : sur un signal sinusoïdal pur, leur nombre par
 * seconde vaut deux fois la fréquence. C'est grossier pour de la musique, et
 * parfaitement suffisant pour distinguer 440 Hz de 880 Hz — ce qui est la
 * seule question posée.
 */
async function hertzDominant(fichier: string, debut: number, duree: number): Promise<number> {
  const dossier = await mkdtemp(join(tmpdir(), 'a7c-son-'));
  const brut = join(dossier, 's.raw');
  await executer('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(debut), '-t', String(duree), '-i', fichier,
    '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '48000', '-y', brut,
  ]);
  const buf = await readFile(brut);
  await rm(dossier, { recursive: true, force: true });

  const n = Math.floor(buf.length / 2);
  let passages = 0;
  let precedent = 0;
  for (let i = 0; i < n; i += 1) {
    const v = buf.readInt16LE(i * 2);
    // Un seuil écarte le bruit de fond autour de zéro.
    if (Math.abs(v) < 500) continue;
    const signe = v > 0 ? 1 : -1;
    if (precedent !== 0 && signe !== precedent) passages += 1;
    precedent = signe;
  }
  const secondes = n / 48000;
  return secondes <= 0 ? 0 : passages / (2 * secondes);
}

async function ffprobeDuree(fichier: string, flux: 'v' | 'a'): Promise<number> {
  const { stdout } = await executer('ffprobe', [
    '-v', 'error', '-select_streams', flux, '-show_entries', 'format=duration:stream=duration',
    '-of', 'json', fichier,
  ]);
  const j = JSON.parse(stdout);
  const d = j.streams?.[0]?.duration ?? j.format?.duration;
  return Number(d) || 0;
}

const segment = (
  ordre: number, chemin: string, entree: number, duree: number, aAudio = true,
): SourceLocale => ({ ordre, chemin, entreeSecondes: entree, dureeRetenueSecondes: duree,
  crop: CROP, aAudio });

async function atelier(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'a7c-'));
}

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!AVEC_FFMPEG)('A_7c — deux et trois sources dans un seul MP4', () => {
  it('A puis B : les DEUX apparaissent, dans cet ordre', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2)], CIBLE, sortie,
      ));

      /* ⚠️ SI LE MONTAGE SERVAIT DEUX FOIS LE PREMIER FICHIER, la durée et la
         résolution seraient JUSTES et cette mesure serait la seule à le voir. */
      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 3.0)).toBe('bleu');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('A, C, B : l ordre du plan est exécuté, jamais réordonné', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4'); const c = join(d, 'c.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4 });
      await fabriquerSource(c, { couleur: 'green', hertz: 220, secondes: 4 });

      const sortie = join(d, 'out.mp4');
      // Le plan dit A, C, B — le renderer n'a pas voix au chapitre.
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, c, 0, 2), segment(3, b, 0, 2)], CIBLE, sortie,
      ));

      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 2.5)).toBe('vert');
      expect(await teinteA(sortie, 4.5)).toBe('bleu');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('A, B, A : la première source revient, avec SES images', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 8 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 8 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2), segment(3, a, 4, 2)], CIBLE, sortie,
      ));

      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 2.5)).toBe('bleu');
      expect(await teinteA(sortie, 4.5)).toBe('rouge');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('MÊMES timestamps, sources différentes → contenus différents', async () => {
    /* ⚠️ « 5 s » DANS A ET « 5 s » DANS B SONT DEUX IMAGES SANS RAPPORT. Un
       renderer qui aurait gardé une source globale les confondrait, et les
       deux segments montreraient la même chose. */
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 8 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 8 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 5, 2), segment(2, b, 5, 2)], CIBLE, sortie,
      ));

      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 3.0)).toBe('bleu');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!AVEC_FFMPEG)('A_7c — le son suit SON image', () => {
  it('image de A → son de A ; image de B → son de B', async () => {
    /* ⚠️ LA MESURE LA PLUS IMPORTANTE DU LOT. « Image de B, son de A » est le
       défaut qui ne se voit pas au montage, ne se lit pas dans un graphe, et
       ne se remarque qu'après publication. */
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2)], CIBLE, sortie,
      ));

      const debut = await hertzDominant(sortie, 0.3, 1.2);
      const fin = await hertzDominant(sortie, 2.3, 1.2);
      expect(debut).toBeGreaterThan(380);
      expect(debut).toBeLessThan(520);
      expect(fin).toBeGreaterThan(780);
      expect(fin).toBeLessThan(980);
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('une source MUETTE au milieu ne fait pas échouer le montage', async () => {
    /* Le silence n'est pas du contenu inventé : c'est la représentation exacte
       d'une absence de son. Le refuser ferait perdre tout le montage pour un
       rush sans micro. */
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4'); const c = join(d, 'c.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: null, secondes: 4 });
      await fabriquerSource(c, { couleur: 'green', hertz: 220, secondes: 4 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2, false), segment(3, c, 0, 2)],
        CIBLE, sortie,
      ));

      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 2.5)).toBe('bleu');
      expect(await teinteA(sortie, 4.5)).toBe('vert');
      /* Le son revient après le segment muet : la piste n'a pas été coupée. */
      expect(await hertzDominant(sortie, 4.3, 1.2)).toBeGreaterThan(180);
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!AVEC_FFMPEG)('A_7c — géométries et cadences mêlées', () => {
  it('paysage + portrait sortent au format cible', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4,
        largeur: 320, hauteur: 180 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4,
        largeur: 180, hauteur: 320 });

      const sortie = join(d, 'out.mp4');
      /* ⚠️ CHAQUE SEGMENT PORTE SON PROPRE `crop`, calculé par M3-G sur la
         géométrie DE SON rush. C'est ce qui rend le mélange possible. */
      await executer('ffmpeg', argumentsRendu([
        { ...segment(1, a, 0, 2), crop: { largeur: 101, hauteur: 180, x: 109, y: 0 } },
        { ...segment(2, b, 0, 2), crop: { largeur: 180, hauteur: 320, x: 0, y: 0 } },
      ], CIBLE, sortie));

      const { stdout } = await executer('ffprobe', [
        '-v', 'error', '-select_streams', 'v', '-show_entries',
        'stream=width,height,sample_aspect_ratio', '-of', 'json', sortie,
      ]);
      const flux = JSON.parse(stdout).streams[0];
      expect([flux.width, flux.height]).toEqual([L, H]);
      /* ⚠️ LE SAR EST NORMALISÉ : un clip anamorphique sortirait aux bonnes
         dimensions avec une image étirée, et la mesure serait juste. */
      expect(['1:1', undefined]).toContain(flux.sample_aspect_ratio);
      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 3.0)).toBe('bleu');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('24, 30 et 60 images/s sortent à la cadence cible', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4'); const c = join(d, 'c.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4, fps: 24 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4, fps: 60 });
      await fabriquerSource(c, { couleur: 'green', hertz: 220, secondes: 4, fps: 30 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2), segment(3, c, 0, 2)], CIBLE, sortie,
      ));

      const { stdout } = await executer('ffprobe', [
        '-v', 'error', '-select_streams', 'v', '-show_entries',
        'stream=r_frame_rate', '-of', 'json', sortie,
      ]);
      expect(JSON.parse(stdout).streams[0].r_frame_rate).toBe(`${FPS}/1`);
      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 2.5)).toBe('bleu');
      expect(await teinteA(sortie, 4.5)).toBe('vert');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!AVEC_FFMPEG)('A_7c — durée et synchronisation A/V', () => {
  it('la durée mesurée suit la somme des segments', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4'); const c = join(d, 'c.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 6 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 6 });
      await fabriquerSource(c, { couleur: 'green', hertz: 220, secondes: 6 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 3), segment(3, c, 0, 2.5)], CIBLE, sortie,
      ));

      const attendue = 2 + 3 + 2.5;
      const video = await ffprobeDuree(sortie, 'v');
      const audio = await ffprobeDuree(sortie, 'a');
      expect(Math.abs(video - attendue) * 1000).toBeLessThan(250);
      /* ⚠️ L'ÉCART A/V EST LA MESURE QUI DIT SI L'IMAGE GLISSE DEVANT LE SON.
         Il se creuse à chaque jonction quand une branche audio manque. */
      expect(Math.abs(video - audio) * 1000).toBeLessThan(150);
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!AVEC_FFMPEG)('A_7c — les transitions A_3d franchissent les rushes', () => {
  const styleAvecTransition = (offsets: number[], duree: number) => ({
    fragmentsParClip: [] as readonly string[],
    entrees: [] as readonly string[],
    post: '',
    documentAss: null,
    documentCaptions: null,
    transitionsNonRendues: [] as readonly string[],
    transition: {
      xfadeId: 'fade',
      dureeSecondes: duree,
      offsetsSecondes: offsets,
      recoupementTotalSecondes: duree * offsets.length,
      courbeAudio: 'tri' as const,
    },
  });

  it('un xfade entre DEUX RUSHES DIFFÉRENTS produit une vraie transition', async () => {
    /* ⚠️ A→B N'EST PAS PLUS DIFFICILE QUE A→A POUR `xfade` : il travaille sur
       deux pads normalisés, pas sur deux fichiers. C'est la normalisation par
       branche — `crop`, `scale`, `setsar`, `fps`, `format` — qui le rend vrai,
       et elle est posée AVANT l'assemblage pour cette raison. */
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4, fps: 24 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4, fps: 60 });

      const sortie = join(d, 'out.mp4');
      // Deux plans de 2 s, recouvrement de 0,5 s → offset 1,5 s, durée 3,5 s.
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2)], CIBLE, sortie, null,
        styleAvecTransition([1.5], 0.5) as never,
      ));

      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 3.0)).toBe('bleu');
      /* Au milieu du fondu, ni l'un ni l'autre ne domine : c'est la preuve que
         les deux images se mélangent réellement. */
      expect(await teinteA(sortie, 1.75)).toBe('indecis');

      const attendue = 2 + 2 - 0.5;
      const video = await ffprobeDuree(sortie, 'v');
      expect(Math.abs(video - attendue) * 1000).toBeLessThan(250);
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('le son se fond aussi entre deux rushes', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: 880, secondes: 4 });

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, b, 0, 2)], CIBLE, sortie, null,
        styleAvecTransition([1.5], 0.5) as never,
      ));

      /* ⚠️ LE FONDU AUDIO DURE EXACTEMENT COMME LE RECOUVREMENT VIDÉO : plus
         court, la piste ne raccourcirait pas d'autant et l'image glisserait
         devant le son un peu plus à chaque jonction. */
      const video = await ffprobeDuree(sortie, 'v');
      const audio = await ffprobeDuree(sortie, 'a');
      expect(Math.abs(video - audio) * 1000).toBeLessThan(150);
      expect(await hertzDominant(sortie, 0.2, 0.8)).toBeGreaterThan(380);
      expect(await hertzDominant(sortie, 2.5, 0.8)).toBeGreaterThan(780);
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('A→A reste aussi valide qu avant', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: 440, secondes: 8 });
      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2), segment(2, a, 4, 2)], CIBLE, sortie, null,
        styleAvecTransition([1.5], 0.5) as never,
      ));
      const video = await ffprobeDuree(sortie, 'v');
      expect(Math.abs(video - 3.5) * 1000).toBeLessThan(250);
      expect(await teinteA(sortie, 0.5)).toBe('rouge');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!AVEC_FFMPEG)('A_7c — la musique reste GLOBALE au-dessus des rushes', () => {
  it('une musique courte boucle sans jamais ramener son silence initial', async () => {
    /* ⚠️ LE SILENCE INITIAL EST LE PIÈGE DU LOT 2A, et le multi-rush ne le
       change pas : la musique est UNE entrée, bouclée sur la durée finale, et
       non relancée à chaque changement de rush. Si elle l'était, le silence de
       tête reviendrait à chaque jonction. */
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: null, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: null, secondes: 4 });

      const musique = join(d, 'm.m4a');
      await executer('ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:d=1.5',
        '-c:a', 'aac', '-y', musique]);

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2, false), segment(2, b, 0, 2, false)], CIBLE, sortie,
        {
          recette: { sonOriginal: false, volumeOriginal: 0, musique: null,
            volumeMusique: 1, ducking: false } as never,
          musique: { chemin: musique },
          dureeSecondes: 4,
        } as never,
      ));

      /* La musique dure 1,5 s et le montage 4 s : sans boucle, la fin serait
         muette. Elle est mesurée à trois instants répartis. */
      for (const t of [0.3, 1.9, 3.2]) {
        expect(await hertzDominant(sortie, t, 0.5),
          `la musique doit sonner à ${t} s`).toBeGreaterThan(700);
      }
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);

  it('la musique couvre le changement de rush sans coupure', async () => {
    const d = await atelier();
    try {
      const a = join(d, 'a.mp4'); const b = join(d, 'b.mp4'); const c = join(d, 'c.mp4');
      await fabriquerSource(a, { couleur: 'red', hertz: null, secondes: 4 });
      await fabriquerSource(b, { couleur: 'blue', hertz: null, secondes: 4 });
      await fabriquerSource(c, { couleur: 'green', hertz: null, secondes: 4 });

      const musique = join(d, 'm.m4a');
      await executer('ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:d=10',
        '-c:a', 'aac', '-y', musique]);

      const sortie = join(d, 'out.mp4');
      await executer('ffmpeg', argumentsRendu(
        [segment(1, a, 0, 2, false), segment(2, b, 0, 2, false), segment(3, c, 0, 2, false)],
        CIBLE, sortie,
        {
          recette: { sonOriginal: false, volumeOriginal: 0, musique: null,
            volumeMusique: 1, ducking: false } as never,
          musique: { chemin: musique },
          dureeSecondes: 6,
        } as never,
      ));

      // Aux deux jonctions (2 s et 4 s), la musique continue.
      expect(await hertzDominant(sortie, 1.8, 0.4)).toBeGreaterThan(700);
      expect(await hertzDominant(sortie, 3.8, 0.4)).toBeGreaterThan(700);
      expect(await teinteA(sortie, 0.5)).toBe('rouge');
      expect(await teinteA(sortie, 4.5)).toBe('vert');
    } finally { await rm(d, { recursive: true, force: true }); }
  }, 120_000);
});
