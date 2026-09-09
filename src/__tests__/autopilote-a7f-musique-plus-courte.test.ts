/**
 * A_7F — UNE MUSIQUE PLUS COURTE QUE LE MONTAGE NE BLOQUE PLUS LE RENDU.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI SE PASSAIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le graphe posait `-stream_loop -1` sur la musique : une entrée SANS FIN, que
 * `atrim` bornait dans le filtre. Cela paraissait suffisant — la sortie est
 * bornée, donc le processus devrait finir.
 *
 * Il ne finissait pas. Mesuré le 2026-09-09, montage de 8 s, même graphe, seule
 * la durée de la musique change :
 *
 *   1 s → BLOQUE      2,5 s → 0,5 s      5 s → 0,4 s
 *   2 s → BLOQUE      3 s   → 0,4 s      8 s → 0,5 s
 *   4 s → BLOQUE      1,5 s → 0,5 s     12 s → 0,5 s
 *
 * Ni `-shortest` ni `-t` en sortie n'y changeaient rien : le blocage est DANS
 * le graphe, pas au muxeur. Le rendu partait alors dans les 60 s de budget et
 * ressortait en `delai_depasse`, sans une ligne de diagnostic — c'est le
 * symptôme observé en navigateur avec `bulk-alpha.mp3` (4 s) sur un montage
 * de 8 s.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER TIENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux niveaux, et les deux comptent :
 *
 *   1. le COMPTE de répétitions, en pur calcul — exhaustif, instantané ;
 *   2. le RENDU RÉEL sur le cas qui bloquait, ffmpeg à l'appui. Sans lui, on
 *      testerait une formule, pas un correctif : c'est le comportement du
 *      moteur qui était en cause, et lui seul peut en témoigner.
 *
 * ⚠️ LE CAS RÉEL EST BORNÉ PAR UN DÉLAI COURT. Un test qui attendrait la fin
 * d'un processus bloqué ne dirait « échec » qu'au bout du délai de vitest ;
 * ici, dépasser quelques secondes EST l'échec.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  argumentsRendu, repetitionsMusique, dureeAudioLocale,
  couperSilenceInitialMusique,
} from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';

const execFileP = promisify(execFile);

function outilPresent(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
const OUTILS = outilPresent(cheminFfmpeg()) && outilPresent(cheminFfprobe());

const MONTAGE_SECONDES = 8;
const RECADRAGE = { x: 0, y: 0, largeur: 720, hauteur: 1280 };

let atelier = '';
const F = { clipA: '', clipB: '', musique4s: '' };

async function fabriquerFixtures(): Promise<void> {
  F.clipA = join(atelier, 'clip-a.mp4');
  F.clipB = join(atelier, 'clip-b.mp4');
  for (const [chemin, motif, hz] of [
    [F.clipA, 'smptebars', 880], [F.clipB, 'testsrc', 440],
  ] as const) {
    await execFileP(cheminFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `${motif}=size=720x1280:rate=30:d=4`,
      '-f', 'lavfi', '-i', `sine=frequency=${hz}:d=4`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', chemin,
    ], { timeout: 120_000 });
  }
  // 4 s pour 8 s de montage : LE cas qui bloquait.
  F.musique4s = join(atelier, 'musique-4s.mp3');
  await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=300:d=4',
    '-c:a', 'libmp3lame', '-b:a', '128k', F.musique4s,
  ], { timeout: 120_000 });
}

beforeAll(async () => {
  if (!OUTILS) return;
  atelier = await mkdtemp(join(tmpdir(), 'a7f-musique-'));
  await fabriquerFixtures();
}, 180_000);

afterAll(async () => {
  if (atelier) await rm(atelier, { recursive: true, force: true });
});

/** Les arguments réels du rendu, pour un montage de 8 s et cette musique-là. */
function args(cheminMusique: string, dureeMusique: number | null, sortie: string): string[] {
  const sources = [0, 1].map((i) => ({
    ordre: i + 1,
    chemin: i === 0 ? F.clipA : F.clipB,
    entreeSecondes: 0,
    dureeRetenueSecondes: 4,
    crop: RECADRAGE,
    aAudio: true,
  }));
  return argumentsRendu(
    sources, { largeur: 1080, hauteur: 1920, fps: 30 }, sortie,
    {
      recette: RECETTE_AUDIO_DEFAUT,
      musique: { chemin: cheminMusique, dureeSecondes: dureeMusique },
      dureeSecondes: MONTAGE_SECONDES,
    } as never,
    null,
  );
}

/** Lance ffmpeg et rend le verdict — ou `bloque` au bout du délai. */
function lancerBorne(
  argv: string[], delaiMs: number,
): Promise<{ code: number | null; bloque: boolean; secondes: number }> {
  return new Promise((resoudre) => {
    const t0 = Date.now();
    const p = spawn(cheminFfmpeg(), argv, { stdio: ['ignore', 'ignore', 'ignore'] });
    const minuterie = setTimeout(() => {
      p.kill('SIGKILL');
      resoudre({ code: null, bloque: true, secondes: (Date.now() - t0) / 1000 });
    }, delaiMs);
    p.on('close', (code) => {
      clearTimeout(minuterie);
      resoudre({ code, bloque: false, secondes: (Date.now() - t0) / 1000 });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le compte de répétitions', () => {
  it('1.1 ⚠️ IL EST TOUJOURS FINI', () => {
    /* C'EST TOUT LE CORRECTIF. `-1` — sans fin — laissait la terminaison
       dépendre du bon vouloir du graphe. Un compte fini la garantit. */
    for (const d of [0.1, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 8, 12, 600]) {
      const n = repetitionsMusique(MONTAGE_SECONDES, d);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('1.2 la matière produite couvre le montage', () => {
    // (n + 1) passages doivent atteindre la durée, sinon la musique
    // s'arrêterait avant la fin du film.
    for (const d of [1, 1.5, 2, 2.5, 3, 4, 5, 7]) {
      const total = (repetitionsMusique(MONTAGE_SECONDES, d) + 1) * d;
      expect(total).toBeGreaterThanOrEqual(MONTAGE_SECONDES - 1e-9);
    }
  });

  it('1.3 une musique déjà assez longue ne se répète pas', () => {
    // Boucler une musique de 12 s pour 8 s de montage serait du travail pur
    // perdu, et une jonction audible pour rien.
    expect(repetitionsMusique(8, 8)).toBe(0);
    expect(repetitionsMusique(8, 12)).toBe(0);
    expect(repetitionsMusique(8, 600)).toBe(0);
  });

  it('1.4 ⚠️ UNE DURÉE INCONNUE JOUE UNE FOIS, ELLE NE BOUCLE PAS SANS FIN', () => {
    /* Le cas dégradé doit rester SÛR. Une mesure manquante donnait autrefois
       une entrée infinie ; elle donne maintenant une musique jouée une fois —
       visible, vérifiable, et incapable de bloquer quoi que ce soit. */
    for (const d of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(repetitionsMusique(8, d as number | null)).toBe(0);
    }
  });

  it('1.5 un montage sans durée ne fait pas boucler non plus', () => {
    for (const m of [0, -1, Number.NaN]) {
      expect(repetitionsMusique(m, 4)).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les arguments du rendu', () => {
  it('2.1 ⚠️ `-stream_loop -1` N’A PLUS LE DROIT D’APPARAÎTRE', () => {
    if (!OUTILS) return;
    const a = args(F.musique4s, 4, join(atelier, 'sortie-args.mp4'));
    const i = a.indexOf('-stream_loop');
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).not.toBe('-1');
    expect(Number(a[i + 1])).toBeGreaterThanOrEqual(0);
  });

  it('2.2 le compte suit la durée mesurée', () => {
    if (!OUTILS) return;
    const compte = (d: number | null) => {
      const a = args(F.musique4s, d, join(atelier, 'x.mp4'));
      return Number(a[a.indexOf('-stream_loop') + 1]);
    };
    expect(compte(4)).toBe(1);   // 2 passages = 8 s
    expect(compte(3)).toBe(2);   // 3 passages = 9 s, `atrim` garde 8
    expect(compte(12)).toBe(0);  // déjà plus longue
    expect(compte(null)).toBe(0); // mesure absente : un seul passage
  });

  it('2.3 `atrim` garde son rôle : couper à la bonne seconde', () => {
    if (!OUTILS) return;
    const a = args(F.musique4s, 4, join(atelier, 'x.mp4'));
    const filtre = a[a.indexOf('-filter_complex') + 1];
    expect(filtre).toContain(`atrim=duration=${MONTAGE_SECONDES}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le rendu réel — le banc qui échouait', () => {
  it('3.1 ⚠️ MUSIQUE DE 4 s SUR UN MONTAGE DE 8 s : LE RENDU SE TERMINE', async () => {
    if (!OUTILS) return;
    /* LE CAS EXACT observé en navigateur. Avec `-stream_loop -1`, ffmpeg ne
       rendait jamais la main : tué à 25 s sur le banc, `delai_depasse` à 60 s
       en production. Le délai court ci-dessous EST l'assertion. */
    const sortie = join(atelier, 'rendu-musique-courte.mp4');
    const r = await lancerBorne(args(F.musique4s, 4, sortie), 20_000);
    expect(r.bloque, 'le rendu ne doit pas dépasser le délai').toBe(false);
    expect(r.code).toBe(0);

    const { stdout } = await execFileP(cheminFfprobe(), [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sortie,
    ]);
    // La durée reste celle du montage : la musique le couvre sans l'allonger.
    expect(Number(stdout.trim())).toBeCloseTo(MONTAGE_SECONDES, 1);
  }, 60_000);

  it('3.2 une musique sans mesure ne bloque pas non plus', async () => {
    if (!OUTILS) return;
    // Le chemin dégradé doit rester rapide et fini, pas seulement « correct ».
    const sortie = join(atelier, 'rendu-sans-mesure.mp4');
    const r = await lancerBorne(args(F.musique4s, null, sortie), 20_000);
    expect(r.bloque).toBe(false);
    expect(r.code).toBe(0);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La durée mesurée vient du fichier réellement lu', () => {
  it('4.1 la mesure lit bien la durée du fichier', async () => {
    if (!OUTILS) return;
    expect(await dureeAudioLocale(F.musique4s)).toBeCloseTo(4, 0);
  }, 30_000);

  it('4.2 un fichier illisible rend `null`, jamais une valeur inventée', async () => {
    if (!OUTILS) return;
    expect(await dureeAudioLocale(join(atelier, 'inexistant.mp3'))).toBeNull();
  }, 30_000);

  it('4.3 ⚠️ LA DURÉE EST CELLE D’APRÈS LA COUPE DU BLANC INITIAL', async () => {
    if (!OUTILS) return;
    /* Le blanc du début est retiré AVANT la répétition — mesuré le 2026-09-07,
       un `-ss` à l'entrée laissait le silence revenir à chaque tour. La durée
       qui décide du compte doit donc être celle du fichier RETENU, pas celle
       de l'original : la mesurer avant la coupe ferait boucler une fois de
       trop, ou une fois de trop peu. */
    const avecBlanc = join(atelier, 'avec-blanc.mp3');
    await execFileP(cheminFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=300:d=3',
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]',
      '-c:a', 'libmp3lame', '-b:a', '128k', avecBlanc,
    ], { timeout: 120_000 });

    const coupee = await couperSilenceInitialMusique(
      avecBlanc, join(atelier, 'avec-blanc-sans-blanc.wav'),
    );
    expect(coupee.dureeSecondes).not.toBeNull();
    // Le fichier rendu est celui que ffmpeg lira, et sa durée le décrit.
    const mesuree = await dureeAudioLocale(coupee.chemin);
    expect(coupee.dureeSecondes).toBeCloseTo(mesuree as number, 2);
    // Une coupe effective raccourcit : la durée retenue est celle d'après.
    if (coupee.coupeSecondes > 0) {
      expect(coupee.dureeSecondes as number)
        .toBeLessThan((await dureeAudioLocale(avecBlanc)) as number);
    }
  }, 180_000);
});

it('les binaires sont là, ou la CI le dit', () => {
  if (process.env.CI) {
    expect(OUTILS, 'ffmpeg et ffprobe sont requis en intégration continue').toBe(true);
  } else if (!OUTILS) {
    console.warn('[a7f] ffmpeg/ffprobe absents : le rendu réel est ignoré');
  }
  expect(true).toBe(true);
});
