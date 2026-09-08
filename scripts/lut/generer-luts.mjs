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

/**
 * LES LOOKS, ET LEUR CHAÎNE DE FILTRES.
 *
 * ⚠️ LA CHAÎNE **EST** LE LOOK. Pas un nom, pas une intention : la suite de
 * filtres que ffmpeg applique, écrite ici une fois et gravée dans un `.cube`.
 *
 * ⚠️ LES QUATRE PREMIERS NE DOIVENT JAMAIS CHANGER D'UN CHIFFRE. Ce sont les
 * chaînes exactes que le lot A_2 produisait depuis `LOOKS_RENDUS` ; les
 * retoucher changerait le rendu de tous les comptes qui les utilisent déjà,
 * sans que personne ne l'ait demandé — et sans qu'aucune erreur ne le dise.
 */
const LOOKS = {
  'clean': 'eq=contrast=1.060:saturation=0.970:brightness=0.012',
  'vibrant': 'eq=contrast=1.100:saturation=1.300',
  'cinema-warm': 'eq=contrast=1.140:saturation=1.040,colorbalance=rm=0.100:bm=-0.080:rh=0.060:bh=-0.050',
  'cinema-cool': 'eq=contrast=1.120:saturation=0.960,colorbalance=rm=-0.080:bm=0.120:rh=-0.040:bh=0.080',
  'blockbuster': 'eq=contrast=1.18:saturation=1.10,colorbalance=rs=-0.06:bs=0.10:rh=0.08:bh=-0.06',
  'teal-orange': 'eq=contrast=1.12:saturation=1.15,colorbalance=rs=-0.10:gs=0.02:bs=0.14:rh=0.12:gh=0.02:bh=-0.10',
  'film-soft': 'eq=contrast=0.94:saturation=0.92:brightness=0.02,colorbalance=rs=0.04:bs=0.04',
  'film-contrast': 'eq=contrast=1.28:saturation=0.98',
  'dramatic': 'eq=contrast=1.34:saturation=0.88:brightness=-0.03',
  'noir': 'eq=contrast=1.22:saturation=0.02',
  'desature': 'eq=contrast=1.06:saturation=0.55',
  'punchy': 'eq=contrast=1.30:saturation=1.26,colorbalance=rs=-0.08:bs=0.06:rh=0.05',
  'bright': 'eq=contrast=1.02:saturation=1.06:brightness=0.075',
  'pop': 'eq=contrast=1.12:saturation=1.40:brightness=0.05,colorbalance=rm=0.06:bm=0.06:gh=-0.04',
  'high-contrast': 'eq=contrast=1.42:saturation=1.05',
  'creator': 'eq=contrast=1.14:saturation=1.20:brightness=0.04,colorbalance=rs=-0.05:bs=0.05:rh=0.07:bh=-0.03',
  'lifestyle': 'eq=contrast=0.98:saturation=1.04:brightness=0.06,colorbalance=rs=0.08:gs=0.04:rm=0.06:bm=-0.05:bh=0.04',
  'peau-naturelle': 'eq=contrast=1.05:saturation=1.03,colorbalance=rm=0.05:gm=0.02:bm=-0.04:rh=0.03',
  'peau-chaude': 'eq=contrast=0.99:saturation=1.10:brightness=0.03,colorbalance=rm=0.16:gm=0.06:bm=-0.14:rs=0.06:bh=-0.04',
  'portrait-doux': 'eq=contrast=0.96:saturation=0.98:brightness=0.03,colorbalance=rs=0.05:bs=0.03',
  'peau-doree': 'eq=contrast=1.10:saturation=1.16:brightness=0.02,colorbalance=rm=0.08:gm=0.10:bm=-0.14:rh=0.10:gh=0.06:bh=-0.08',
  'ete': 'eq=contrast=1.10:saturation=1.24:brightness=0.04,colorbalance=rh=0.05:gh=0.05:bh=-0.06:bs=0.05',
  'heure-doree': 'eq=contrast=1.12:saturation=1.12,colorbalance=rm=0.16:gm=0.06:bm=-0.16:rh=0.10:bh=-0.10',
  'tropical': 'eq=contrast=1.14:saturation=1.34,colorbalance=gm=0.12:bm=0.10:rs=-0.06:gh=0.08',
  'nuit': 'eq=contrast=1.16:saturation=0.86:brightness=-0.05,colorbalance=rs=-0.06:bs=0.12:bm=0.08',
  'urbain': 'eq=contrast=1.20:saturation=0.90,colorbalance=rs=-0.04:bs=0.06:gh=0.02',
  'moody': 'eq=contrast=1.14:saturation=0.80:brightness=-0.04,colorbalance=rs=0.04:bs=0.06',
  'vintage': 'eq=contrast=0.92:saturation=0.78:brightness=0.03,colorbalance=rs=0.10:gs=0.04:bs=-0.06:rh=0.06:bh=-0.08',
  'retro': 'eq=contrast=1.02:saturation=0.88,colorbalance=rs=0.12:bs=-0.04:rm=0.04:bh=0.06',
  'pastel': 'eq=contrast=0.90:saturation=0.82:brightness=0.06,colorbalance=rs=0.06:gs=0.04:bs=0.06',
  'energie': 'eq=contrast=1.26:saturation=1.28,colorbalance=rh=0.06:bh=-0.04',
  'puissance': 'eq=contrast=1.36:saturation=1.12:brightness=-0.02,colorbalance=rs=-0.04:rh=0.06',
  'neon': 'eq=contrast=1.22:saturation=1.40,colorbalance=rs=0.06:bs=0.12:gh=0.04:bh=0.06',
};

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
    const filtres = look;
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
