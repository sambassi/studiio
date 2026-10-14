/**
 * CADRAGE DE LA VIDÉO DU JUMEAU — retirer les bandes INCRUSTÉES par le
 * fournisseur, avant que le fichier ne devienne un rush.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE BUG (Créer 9:16 → Calendrier : jumeau horizontal, grandes bandes noires)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Constaté en production (#539) : un avatar entraîné sur une source 16:9,
 * généré en 9:16, revient du fournisseur en 720 × 1280 dont seule une bande
 * centrale de 720 × 405 contient l'image. Les bandes sont DANS LE FICHIER.
 *
 * Tout l'aval est pourtant en « cover » : l'aperçu Créer (`object-fit: cover`
 * / `styleRecadrageRush`), le compositeur (`drawVideoSeq`, `max(w/srcW,
 * h/srcH)`), Remotion (`objectFit: 'cover'`), le rendu hybride (`crop` cover)
 * et le lecteur du Calendrier (cadre au ratio du montage). Mais un « cover »
 * d'un fichier 9:16 dans un cadre 9:16 est l'identité : il recopie
 * fidèlement… les bandes. Aucun lecteur ni compositeur ne peut les retirer
 * sans savoir qu'elles sont là.
 *
 * `fit: "cover"` est bien demandé à HeyGen depuis Créer (#540), mais :
 *   - D-ID ne le reçoit pas (aucun champ équivalent) ;
 *   - l'Autopilote ne l'envoie pas ;
 *   - rien ne GARANTIT que le fournisseur l'honore sur chaque moteur.
 *
 * La correction est donc posée au seul point par lequel passe CHAQUE vidéo de
 * jumeau, quel que soit le fournisseur : le rapatriement (`statut.ts`). Le
 * fichier hébergé chez nous est plein cadre ; l'aperçu, le MP4 et le
 * Calendrier, qui le reproduisent déjà fidèlement, deviennent pleins cadres
 * eux aussi — et le recadrage manuel (#540) s'applique sur une vraie image.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RÈGLES (pures, testées)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * - La zone utile est mesurée par `cropdetect` sur TOUT le clip, sans remise
 *   à zéro : c'est l'UNION des images — un geste qui sort de la bande
 *   l'élargit, jamais on ne coupe ce qui a été visible.
 * - Ce n'est une bande incrustée que si : un axe est entier, l'autre est
 *   amputé de part ET d'autre (≥ 2 % chacun) de façon symétrique. Un fond
 *   sombre d'un seul côté, ou un sujet décentré, ne déclenche rien.
 * - La zone utile est recadrée en « cover » centré au ratio DEMANDÉ
 *   (`aspect_ratio` de la génération), puis remise aux dimensions du
 *   fichier : jamais d'étirement (même facteur sur x et y), jamais de bande.
 * - BANDES CLAIRES OU COLORÉES (BUG 6, Autopilote 9:16, octobre 2026) :
 *   `cropdetect` ne voit QUE le noir (`limit=24` = seuil de luminance). Le
 *   fournisseur pose aussi des bandes de SA couleur de fond (mesurée en
 *   production : #F0F3F9, luminance ≈ 243) — invisibles pour `cropdetect`,
 *   qui rendait le cadre entier : fichier gardé tel quel, bandes recopiées
 *   par le « cover » de Remotion jusque dans le MP4. Quand `cropdetect` ne
 *   trouve rien, une seconde mesure (`zoneBandesUnies`) cherche des bandes
 *   UNIES de n'importe quelle couleur : lignes / colonnes de bord IDENTIQUES
 *   à la couleur du coin, sur TOUTES les images échantillonnées. Les mêmes
 *   garde-fous s'appliquent (`bandesIncrustees` : symétrique, un axe entier).
 * - FAUX POSITIF (revue de release après #565) : un vrai 9:16 plein cadre sur
 *   fond de studio UNI (clair, gris ou NOIR), sujet du haut au bas du cadre,
 *   était lu comme pillarbox et zoomé ≈ 2× (coupe 532×944 → 1080×1920) ; un
 *   sujet large ou rond sur fond uni passait pour un letterbox. Règle
 *   désormais CONSERVATRICE — mieux vaut laisser une bande douteuse que
 *   recadrer une bonne vidéo — sur les DEUX mesures (noire et unie) :
 *     (b) fichier déjà au ratio demandé : seule la forme qu'un fournisseur
 *         peut produire est admise — letterbox (bandes haut / bas) pour un
 *         cadre vertical, pillarbox pour un cadre horizontal (`planCadrage`) ;
 *     (c2) chaque bande finit sur un BORD DROIT : sur la ligne frontière, les
 *         pixels d'image couvrent ≥ 90 % de sa longueur (`bordsFrancs`). Un
 *         sujet (tête, épaules, disque) sur fond uni n'a pas de bord droit.
 *   Dans le doute : aucun recadrage.
 * - Le son est COPIÉ tel quel : la synchronisation labiale ne bouge pas.
 * - Tout échec (ffmpeg absent, fichier illisible, délai) rend le fichier
 *   d'origine : le rapatriement n'est jamais bloqué par cette étape.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';

export interface Zone { l: number; h: number; x: number; y: number }

/** Ratio largeur/hauteur d'un `aspect_ratio` de génération (`9:16`, `16:9`, `1:1`) ; `null` sinon. */
export function ratioDemande(aspect: unknown): number | null {
  if (typeof aspect !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(aspect);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  return a > 0 && b > 0 ? a / b : null;
}

/** La DERNIÈRE mesure `crop=l:h:x:y` de `cropdetect` (l'union du clip). */
export function lireCropdetect(stderr: string): Zone | null {
  const toutes = [...String(stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const m = toutes[toutes.length - 1];
  if (!m) return null;
  const [l, h, x, y] = m.slice(1, 5).map(Number);
  return l > 0 && h > 0 ? { l, h, x, y } : null;
}

/**
 * Bandes INCRUSTÉES (letterbox ou pillarbox) ? Un axe entier, l'autre amputé
 * des deux côtés, symétriquement. Pur.
 */
export function bandesIncrustees(src: { l: number; h: number }, z: Zone): boolean {
  const axe = (total: number, debut: number, taille: number) => {
    const avant = debut;
    const apres = total - debut - taille;
    const tol = Math.max(4, total * 0.01);
    return {
      entier: avant <= tol && apres <= tol,
      bandes: avant >= total * 0.02 && apres >= total * 0.02 && Math.abs(avant - apres) <= Math.max(8, total * 0.03),
    };
  };
  const x = axe(src.l, z.x, z.l);
  const y = axe(src.h, z.y, z.h);
  return (x.entier && y.bandes) || (y.entier && x.bandes);
}

const pair = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * « Cover » centré de la zone utile au ratio `r` : le plus grand rectangle de
 * ratio `r` contenu dans la zone, centré. Pur, dimensions paires.
 */
export function rectangleCover(z: Zone, r: number): Zone {
  const ratioZone = z.l / z.h;
  let l = z.l; let h = z.h;
  if (ratioZone > r) l = z.h * r; else h = z.l / r;
  l = Math.min(pair(l), pair(z.l)); h = Math.min(pair(h), pair(z.h));
  const x = z.x + Math.floor((z.l - l) / 2);
  const y = z.y + Math.floor((z.h - h) / 2);
  return { l, h, x, y };
}

/**
 * Dimensions de sortie : celles du fichier quand il est déjà au ratio demandé
 * (HeyGen 9:16 → 720 × 1280), sinon le grand côté du fichier au ratio demandé.
 */
export function dimensionsSortie(src: { l: number; h: number }, r: number): { l: number; h: number } {
  if (Math.abs(src.l / src.h - r) < 0.01) return { l: pair(src.l), h: pair(src.h) };
  const grand = Math.max(src.l, src.h);
  return r < 1 ? { l: pair(grand * r), h: pair(grand) } : { l: pair(grand), h: pair(grand / r) };
}

export interface PlanCadrage { coupe: Zone; sortie: { l: number; h: number } }

/**
 * (b) Forme des bandes admise. Un fichier DÉJÀ au ratio demandé ne peut porter
 * que les bandes d'une image d'une autre forme « contenue » dedans : dans un
 * cadre vertical, une image plus large → bandes en haut et en bas (letterbox,
 * pleine largeur) ; dans un cadre horizontal, l'inverse (pillarbox). Des
 * colonnes unies de part et d'autre d'un 9:16 sont le fond de studio autour
 * du sujet, pas une incrustation. Fichier carré, ou d'une autre forme que la
 * demande (16:9 rendu pour un 9:16) : les deux formes restent admises. Pur.
 */
export function formeBandesAdmise(src: { l: number; h: number }, z: Zone, r: number): boolean {
  const cadre = src.l / src.h;
  if (Math.abs(cadre / r - 1) >= 0.02 || Math.abs(r - 1) < 0.02) return true;
  const pleineLargeur = z.x <= Math.max(4, src.l * 0.01) && src.l - z.x - z.l <= Math.max(4, src.l * 0.01);
  return r < 1 ? pleineLargeur : !pleineLargeur;
}

/**
 * Décision géométrique, PURE : `null` = fichier gardé tel quel. `ratio`
 * absent : celui du fichier (on retire les bandes sans changer de format).
 * La preuve sur les pixels (`bordsFrancs`) s'ajoute dans `retirerBandesIncrustees`.
 */
export function planCadrage(src: { l: number; h: number }, zone: Zone | null, ratio: number | null): PlanCadrage | null {
  if (!zone || !(src.l > 0 && src.h > 0) || !bandesIncrustees(src, zone)) return null;
  const r = ratio ?? src.l / src.h;
  if (!formeBandesAdmise(src, zone, r)) return null;
  return { coupe: rectangleCover(zone, r), sortie: dimensionsSortie(src, r) };
}

/**
 * (c2) BORDS DROITS : une bande incrustée se termine sur une arête droite —
 * l'image du fournisseur est un rectangle. Pour chaque côté amputé (> 4 px),
 * on cherche autour de la frontière (6 lignes côté bande, 8 côté image) la
 * ligne dont l'ÉTENDUE des pixels d'image (du premier au dernier pixel à plus
 * de `tol` de la couleur de bande) est la plus grande, en médiane sur les
 * images échantillonnées. Exigé : ≥ 90 % de la longueur, sur CHAQUE côté. Un
 * sujet sur fond uni (tête, épaules, disque, silhouette) n'y arrive pas.
 * Couleur de bande : coin haut-gauche de la première image. Pur ; `false`
 * dès qu'un doute subsiste (aucun pixel lisible, aucun côté amputé).
 */
export function bordsFrancs(pixels: Uint8Array, src: { l: number; h: number }, z: Zone, tol = 8): boolean {
  const { l, h } = src;
  const taille = l * h;
  if (!(l > 0 && h > 0) || !pixels || pixels.length < taille) return false;
  const n = Math.floor(pixels.length / taille);
  const ref = pixels[0];
  const etendue = (f: number, pos: number, ligne: boolean) => {
    const longueur = ligne ? l : h;
    let a = -1; let b = -1;
    for (let i = 0; i < longueur; i++) {
      const v = ligne ? pixels[f * taille + pos * l + i] : pixels[f * taille + i * l + pos];
      if (Math.abs(v - ref) > tol) { if (a < 0) a = i; b = i; }
    }
    return a < 0 ? 0 : (b - a + 1) / longueur;
  };
  // `vers` : +1 si l'image est du côté des indices croissants (haut, gauche).
  const cote = (frontiere: number, vers: 1 | -1, ligne: boolean) => {
    const limite = ligne ? h : l;
    let meilleure = 0;
    for (let k = -6; k <= 8; k++) {
      const pos = frontiere + vers * k;
      if (pos < 0 || pos >= limite) continue;
      const parImage: number[] = [];
      for (let f = 0; f < n; f++) parImage.push(etendue(f, pos, ligne));
      parImage.sort((a, b) => a - b);
      meilleure = Math.max(meilleure, parImage[Math.floor(parImage.length / 2)]);
    }
    return meilleure >= 0.9;
  };
  const cotes: boolean[] = [];
  if (z.y > 4) cotes.push(cote(z.y, 1, true));
  if (h - z.y - z.h > 4) cotes.push(cote(z.y + z.h - 1, -1, true));
  if (z.x > 4) cotes.push(cote(z.x, 1, false));
  if (l - z.x - z.l > 4) cotes.push(cote(z.x + z.l - 1, -1, false));
  return cotes.length > 0 && cotes.every(Boolean);
}

/** Lecture du fichier LOCAL uniquement (jamais d'URL, de playlist ni de concat). */
const PROTECTIONS_ENTREE = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm'] as const;

export function argumentsCropdetect(entree: string): string[] {
  // `reset=0` : la zone ne fait que grandir — l'UNION de tout le clip.
  return ['-hide_banner', ...PROTECTIONS_ENTREE, '-i', entree, '-an', '-vf', 'cropdetect=limit=24:round=2:reset=0', '-f', 'null', '-'];
}

/**
 * Échantillons pour `zoneBandesUnies` : 2 images/s (30 au plus), en
 * luminance pleine résolution, écrites brutes dans `sortie` (jamais sur la
 * sortie standard : aucun tampon binaire à travers `execFile`).
 */
export const ECHANTILLONS_MAX = 30;
export function argumentsEchantillons(entree: string, sortie: string): string[] {
  return [
    '-hide_banner', '-y', ...PROTECTIONS_ENTREE, '-i', entree, '-an',
    '-vf', 'fps=2,format=gray', '-frames:v', String(ECHANTILLONS_MAX), '-f', 'rawvideo', sortie,
  ];
}

/**
 * Zone utile d'après des bandes UNIES de n'importe quelle couleur (claire,
 * colorée, noire). Pur.
 *
 * `pixels` : images en luminance (`l × h` octets chacune), bout à bout. La
 * couleur de fond est celle du coin haut-gauche de la PREMIÈRE image ; une
 * ligne (colonne) de bord est une bande si, sur CHAQUE image, au moins 99 %
 * de ses pixels restent à `tol` de cette couleur. On ne lit que depuis les
 * bords : la zone utile est l'UNION de ce qui n'est pas bande dans tout le
 * clip. Un liseré de transition (mise à l'échelle du fournisseur) est retiré
 * par une marge de `marge` px sur chaque côté amputé — jamais un trait clair.
 * `null` : rien de lisible, ou tout le cadre est uni (image vide).
 */
export function zoneBandesUnies(pixels: Uint8Array, dims: { l: number; h: number }, tol = 8, marge = 4): Zone | null {
  const { l, h } = dims;
  const taille = l * h;
  if (!(l > 0 && h > 0) || !pixels || pixels.length < taille) return null;
  const n = Math.floor(pixels.length / taille);
  const ref = pixels[0];
  const proche = (v: number) => Math.abs(v - ref) <= tol;
  const ecartsMax = (total: number) => Math.floor(total * 0.01);
  const ligneUnie = (y: number) => {
    for (let f = 0; f < n; f++) {
      const base = f * taille + y * l;
      let ecarts = 0;
      for (let x = 0; x < l; x++) if (!proche(pixels[base + x]) && ++ecarts > ecartsMax(l)) return false;
    }
    return true;
  };
  const colonneUnie = (x: number) => {
    for (let f = 0; f < n; f++) {
      const base = f * taille + x;
      let ecarts = 0;
      for (let y = 0; y < h; y++) if (!proche(pixels[base + y * l]) && ++ecarts > ecartsMax(h)) return false;
    }
    return true;
  };
  let haut = 0; while (haut < h && ligneUnie(haut)) haut++;
  if (haut >= h) return null;
  let bas = 0; while (bas < h - haut && ligneUnie(h - 1 - bas)) bas++;
  let gauche = 0; while (gauche < l && colonneUnie(gauche)) gauche++;
  let droite = 0; while (droite < l - gauche && colonneUnie(l - 1 - droite)) droite++;
  if (haut + bas + gauche + droite === 0) return { l, h, x: 0, y: 0 };
  const m = (bande: number) => (bande > 0 ? marge : 0);
  const y = haut + m(haut);
  const x = gauche + m(gauche);
  const zh = h - bas - m(bas) - y;
  const zl = l - droite - m(droite) - x;
  return zl > 0 && zh > 0 ? { l: zl, h: zh, x, y } : null;
}

export function argumentsRecadrage(entree: string, sortie: string, p: PlanCadrage): string[] {
  const { coupe: c, sortie: s } = p;
  return [
    '-hide_banner', '-y', ...PROTECTIONS_ENTREE, '-i', entree,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', `crop=${c.l}:${c.h}:${c.x}:${c.y},scale=${s.l}:${s.h}:flags=lanczos,setsar=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', sortie,
  ];
}

/** Dimensions du flux vidéo, lues dans la sortie de ffmpeg (`Stream … Video: … 720x1280`). */
export function lireDimensions(stderr: string): { l: number; h: number } | null {
  const m = /Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(String(stderr));
  return m ? { l: Number(m[1]), h: Number(m[2]) } : null;
}

type Executer = (bin: string, args: string[], opts: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string; stderr: string }>;

// `execFile` : aucun shell, les arguments partent tels quels.
const executerParDefaut: Executer = async (bin, args, opts) => {
  const r = await promisify(execFile)(bin, args, opts);
  return { stdout: String(r.stdout), stderr: String(r.stderr) };
};

export interface ResultatCadrage {
  buffer: Buffer;
  /** Vrai seulement si des bandes ont été retirées. */
  corrige: boolean;
  plan: PlanCadrage | null;
}

/**
 * Rend la vidéo du jumeau SANS bandes incrustées, au ratio demandé. Ne lève
 * jamais : tout échec rend le fichier d'origine.
 */
export async function retirerBandesIncrustees(
  buffer: Buffer,
  opts: { aspectRatio?: unknown; executer?: Executer; ffmpeg?: string } = {},
): Promise<ResultatCadrage> {
  const tel: ResultatCadrage = { buffer, corrige: false, plan: null };
  if (!buffer || buffer.length === 0) return tel;
  const exec = opts.executer ?? executerParDefaut;
  let dossier: string | null = null;
  try {
    const bin = opts.ffmpeg ?? cheminFfmpeg();
    dossier = await mkdtemp(join(tmpdir(), 'jumeau-cadrage-'));
    const entree = join(dossier, 'entree.mp4');
    const sortie = join(dossier, 'sortie.mp4');
    await writeFile(entree, buffer);
    const mesure = await exec(bin, argumentsCropdetect(entree), { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    const src = lireDimensions(mesure.stderr);
    if (!src) return tel;
    const ratio = ratioDemande(opts.aspectRatio);
    // Échantillons TOUJOURS lus : ils servent à la mesure des bandes unies
    // (BUG 6 : `cropdetect` ne voit que le NOIR) ET à la preuve des bords
    // droits, exigée aussi pour une zone trouvée par `cropdetect` (fond de
    // studio noir autour d'un sujet = même faux positif).
    const brut = join(dossier, 'echantillons.gray');
    await exec(bin, argumentsEchantillons(entree, brut), { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    const pixels = new Uint8Array(await readFile(brut));
    const noire = lireCropdetect(mesure.stderr);
    const zone = planCadrage(src, noire, ratio) ? noire : zoneBandesUnies(pixels, src);
    const plan = zone && bordsFrancs(pixels, src, zone) ? planCadrage(src, zone, ratio) : null;
    if (!plan) return tel;
    await exec(bin, argumentsRecadrage(entree, sortie, plan), { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    const corrige = await readFile(sortie);
    if (!corrige.length) return tel;
    console.log('[Jumeau][cadrage] bandes incrustées retirées', JSON.stringify({ source: src, ...plan }));
    return { buffer: corrige, corrige: true, plan };
  } catch (e) {
    console.warn('[Jumeau][cadrage] contrôle des bandes impossible, fichier gardé tel quel :', e instanceof Error ? e.message : e);
    return tel;
  } finally {
    if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}
