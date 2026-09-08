#!/usr/bin/env node
/**
 * A_2 — FABRIQUE LES `.cube` DES LOOKS INTÉGRÉS.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI GÉNÉRER, ET NE RIEN TÉLÉCHARGER
 * ---------------------------------------------------------------------------
 *
 * Une LUT trouvée sur Internet arrive sans licence vérifiable, et se
 * retrouverait redistribuée dans chaque MP4 publié. Ces fichiers-ci sont
 * PRODUITS PAR LE PROJET, à partir des coefficients de `LOOKS_RENDUS` qui
 * vivent dans le dépôt depuis le premier jour. Leur provenance est donc la
 * nôtre, et leur licence celle du dépôt.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ C'EST FFMPEG QUI CALCULE, PAS NOUS
 * ---------------------------------------------------------------------------
 *
 * Réimplémenter `eq` et `colorbalance` en JavaScript aurait donné une
 * APPROXIMATION : le look de chaque compte aurait changé le jour du
 * déploiement, sans que personne ne l'ait demandé. On demande donc le calcul
 * aux filtres eux-mêmes — ceux qui produisent le look d'aujourd'hui — et on
 * lit le résultat. La LUT reproduit alors exactement ce que le preset
 * faisait, à l'interpolation près.
 *
 * ---------------------------------------------------------------------------
 * L'ORDRE DES ENTRÉES, QUI EST TOUT LE PIÈGE
 * ---------------------------------------------------------------------------
 *
 * On n'utilise PAS `haldclutsrc`, dont la disposition d'image obéit à une
 * convention qu'il faudrait deviner. On fabrique nous-mêmes une image dont
 * les pixels sont, dans l'ordre, les entrées d'une LUT identité au format
 * `.cube` : rouge le plus rapide, puis vert, puis bleu. On applique les
 * filtres, on relit dans le même ordre, on écrit. Aucune convention externe
 * n'entre dans le calcul.
 *
 * Usage : node scripts/lut/generer-luts.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Lance ffmpeg, lui pousse l'identite, et rend les octets transformes. */
function transformer(ffmpeg, args, entree) {
  return new Promise((resoudre, rejeter) => {
    const proc = spawn(ffmpeg, args);
    const morceaux = [];
    const erreurs = [];
    proc.stdout.on('data', (d) => morceaux.push(d));
    proc.stderr.on('data', (d) => erreurs.push(d));
    proc.on('error', rejeter);
    proc.on('close', (code) => (code === 0
      ? resoudre(Buffer.concat(morceaux))
      : rejeter(new Error(Buffer.concat(erreurs).toString().slice(0, 400)))));
    proc.stdin.end(entree);
  });
}

/**
 * 16 pas par axe — 4 096 entrées.
 *
 * ⚠️ UN COMPROMIS ASSUMÉ, PAS UNE VALEUR AU HASARD. 33 est la taille usuelle
 * des LUT de cinéma, mais elle pèse 35 937 lignes par fichier, soit près d'un
 * mégaoctet à porter dans le dépôt ET dans l'image Docker, pour quatre looks.
 * Ces transformations sont LISSES — contraste, saturation, balance : elles
 * n'ont ni cassure ni marche que 16 pas rateraient.
 *
 * MESURÉ, PAS SUPPOSÉ (mire `testsrc2`, le pire cas : primaires saturées et
 * bords durs), écart entre le preset et la LUT :
 *
 *   TAILLE 16 → max 5/255, p99 3/255, moyenne 0,759   — 110 Ko par fichier
 *   TAILLE 33 → max 5/255, p99 3/255, moyenne 0,552   — 970 Ko par fichier
 *
 * Neuf fois le poids pour le MÊME écart maximal : le résidu n'est pas de
 * l'interpolation, c'est l'arrondi entre deux chemins de calcul. 33 aurait
 * été une précaution qui ne précaute rien, payée dans le dépôt et dans
 * l'image Docker.
 */
const TAILLE = 16;

/** Les coefficients, recopiés de `LOOKS_RENDUS` — la source reste là-bas. */
const LOOKS = {
  clean: { contraste: 1.06, saturation: 0.97, luminosite: 0.012, rm: 0, bm: 0, rh: 0, bh: 0 },
  vibrant: { contraste: 1.10, saturation: 1.30, luminosite: 0, rm: 0, bm: 0, rh: 0, bh: 0 },
  'cinema-warm': {
    contraste: 1.14, saturation: 1.04, luminosite: 0,
    rm: 0.10, bm: -0.08, rh: 0.06, bh: -0.05,
  },
  'cinema-cool': {
    contraste: 1.12, saturation: 0.96, luminosite: 0,
    rm: -0.08, bm: 0.12, rh: -0.04, bh: 0.08,
  },
};

const nb = (v) => Number(v.toFixed(3)).toFixed(3);

/** La même chaîne de filtres que `filtreLook` à intensité 1. */
function chaineFiltres(l) {
  const morceaux = [];
  const eq = [];
  if (l.contraste !== 1) eq.push(`contrast=${nb(l.contraste)}`);
  if (l.saturation !== 1) eq.push(`saturation=${nb(l.saturation)}`);
  if (l.luminosite !== 0) eq.push(`brightness=${nb(l.luminosite)}`);
  if (eq.length > 0) morceaux.push(`eq=${eq.join(':')}`);
  const cb = [];
  if (l.rm !== 0) cb.push(`rm=${nb(l.rm)}`);
  if (l.bm !== 0) cb.push(`bm=${nb(l.bm)}`);
  if (l.rh !== 0) cb.push(`rh=${nb(l.rh)}`);
  if (l.bh !== 0) cb.push(`bh=${nb(l.bh)}`);
  if (cb.length > 0) morceaux.push(`colorbalance=${cb.join(':')}`);
  return morceaux.join(',');
}

/** L'identité, en pixels, dans l'ordre exact du `.cube`. */
function identite() {
  const n = TAILLE ** 3;
  const buf = Buffer.alloc(n * 3);
  let i = 0;
  for (let b = 0; b < TAILLE; b += 1) {
    for (let g = 0; g < TAILLE; g += 1) {
      for (let r = 0; r < TAILLE; r += 1) {
        buf[i] = Math.round((r / (TAILLE - 1)) * 255);
        buf[i + 1] = Math.round((g / (TAILLE - 1)) * 255);
        buf[i + 2] = Math.round((b / (TAILLE - 1)) * 255);
        i += 3;
      }
    }
  }
  return buf;
}

async function main() {
  const { default: ffmpeg } = await import('ffmpeg-static');
  const largeur = TAILLE ** 2;      // 256
  const hauteur = TAILLE;           // 16  → 4 096 pixels, dans l'ordre du .cube
  const source = identite();
  const dossier = path.join(process.cwd(), 'public', 'luts');
  await mkdir(dossier, { recursive: true });

  for (const [id, look] of Object.entries(LOOKS)) {
    const filtres = chaineFiltres(look);
    const sortie = await transformer(ffmpeg, [
      '-hide_banner', '-v', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-s', `${largeur}x${hauteur}`, '-i', 'pipe:0',
      '-vf', filtres,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], source);
    if (sortie.length !== source.length) {
      throw new Error(`${id} : ${sortie.length} octets rendus, ${source.length} attendus`);
    }

    const lignes = [
      `# Studiio — look « ${id} », genere par scripts/lut/generer-luts.mjs`,
      '# Source : les coefficients de LOOKS_RENDUS, calcules par ffmpeg lui-meme.',
      '# Aucune LUT tierce, aucun telechargement : provenance et licence du depot.',
      `LUT_3D_SIZE ${TAILLE}`,
      'DOMAIN_MIN 0.0 0.0 0.0',
      'DOMAIN_MAX 1.0 1.0 1.0',
    ];
    for (let i = 0; i < sortie.length; i += 3) {
      lignes.push(
        `${(sortie[i] / 255).toFixed(6)} `
        + `${(sortie[i + 1] / 255).toFixed(6)} `
        + `${(sortie[i + 2] / 255).toFixed(6)}`,
      );
    }
    const chemin = path.join(dossier, `${id}.cube`);
    await writeFile(chemin, `${lignes.join('\n')}\n`, 'utf8');
    process.stdout.write(`${id}.cube : ${lignes.length - 6} entrees\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
