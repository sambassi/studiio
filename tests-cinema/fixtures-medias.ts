/**
 * MEDIAS DE TEST — fabriques LOCALEMENT, jamais telecharges.
 *
 * Le banc a besoin de vraies images et de vraies videos : des fichiers que
 * ffprobe mesure et que Chromium decode. Ils sont produits ici par ffmpeg
 * (sources `lavfi`), donc sans un octet de reseau, et poses dans
 * `tests-cinema/medias/` — un dossier a part, ignore par Git.
 *
 * Chaque media a une DOMINANTE DE COULEUR franche. C'est ce qui permet au
 * banc de prouver que le MP4 montre bien le media : si le montage retombait
 * sur sa carte de plan, la dominante serait celle du degrade Studiio, pas
 * celle du fichier.
 */
import { mkdir, access } from 'fs/promises';
import path from 'path';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';

export const DOSSIER_MEDIAS = path.resolve(__dirname, 'medias');

export interface FixtureMedia {
  nom: string;
  fichier: string;
  genre: 'image' | 'video';
  largeur: number;
  hauteur: number;
  dureeS: number | null;
}

const existe = async (f: string) => { try { await access(f); return true; } catch { return false; } };

/**
 * Une video de couleur dominante, avec un carre qui traverse l'image : une
 * dominante stable ET du mouvement reel a encoder.
 */
async function video(nom: string, couleur: string, l: number, h: number, duree: number): Promise<string> {
  const fichier = path.join(DOSSIER_MEDIAS, nom);
  if (await existe(fichier)) return fichier;
  const r = await executer(cheminFfmpeg(), [
    '-f', 'lavfi', '-i', `color=c=${couleur}:s=${l}x${h}:d=${duree}:r=30`,
    '-vf', `drawbox=x='(w-200)*t/${duree}':y=h/2-100:w=200:h=200:color=white@0.85:t=fill`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-y', fichier,
  ], { timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`fixture video ${nom} : ffmpeg code ${r.code}\n${r.stderr.slice(-800)}`);
  return fichier;
}

/** Une image de couleur dominante, avec une bande claire pour la lisibilite. */
async function image(nom: string, couleur: string, l: number, h: number): Promise<string> {
  const fichier = path.join(DOSSIER_MEDIAS, nom);
  if (await existe(fichier)) return fichier;
  const r = await executer(cheminFfmpeg(), [
    '-f', 'lavfi', '-i', `color=c=${couleur}:s=${l}x${h}`,
    '-vf', 'drawbox=x=0:y=ih-ih/5:w=iw:h=ih/5:color=white@0.25:t=fill',
    '-frames:v', '1', '-y', fichier,
  ], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`fixture image ${nom} : ffmpeg code ${r.code}\n${r.stderr.slice(-800)}`);
  return fichier;
}

/**
 * Le jeu de medias du banc. Il couvre exprès quatre cas differents :
 *   - une video 16:9 PLUS LONGUE qu'un plan parle (elle sera coupee) ;
 *   - une video 16:9 PLUS COURTE (sa derniere image sera figee) ;
 *   - une image au format du film (aucun rognage) ;
 *   - un media VERTICAL dans un film horizontal (rognage, sans etirement).
 */
export async function fixturesMedias(): Promise<Record<'longue' | 'courte' | 'affiche' | 'verticale', FixtureMedia>> {
  await mkdir(DOSSIER_MEDIAS, { recursive: true });
  return {
    longue: { nom: 'salle-rouge.mp4', fichier: await video('salle-rouge.mp4', '0xB22222', 1920, 1080, 8), genre: 'video', largeur: 1920, hauteur: 1080, dureeS: 8 },
    courte: { nom: 'tatami-vert.mp4', fichier: await video('tatami-vert.mp4', '0x2E8B57', 1280, 720, 2.5), genre: 'video', largeur: 1280, hauteur: 720, dureeS: 2.5 },
    affiche: { nom: 'aube-orange.png', fichier: await image('aube-orange.png', '0xD2691E', 1920, 1080), genre: 'image', largeur: 1920, hauteur: 1080, dureeS: null },
    verticale: { nom: 'portrait-bleu.png', fichier: await image('portrait-bleu.png', '0x1E3A8A', 270, 480), genre: 'image', largeur: 270, hauteur: 480, dureeS: null },
  };
}

/**
 * La couleur moyenne d'une image du fichier, a l'instant demande.
 *
 * Mesure directe : ffmpeg reduit la frame a UN pixel et le rend en brut. Pas
 * d'histogramme a interpreter, pas de dependance de plus.
 */
export async function couleurMoyenne(fichier: string, tS = 0): Promise<[number, number, number]> {
  const r = await executer(cheminFfmpeg(), [
    '-v', 'error', '-ss', String(tS), '-i', fichier,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { timeoutMs: 60_000, binaire: true });
  const octets = r.stdoutBrut ?? Buffer.alloc(0);
  if (octets.length < 3) throw new Error(`couleur illisible dans ${path.basename(fichier)} a ${tS} s`);
  return [octets[0], octets[1], octets[2]];
}

/** Le canal dominant d'une couleur : 'r', 'v' ou 'b'. */
export function dominante([r, v, b]: [number, number, number]): 'r' | 'v' | 'b' {
  if (r >= v && r >= b) return 'r';
  return v >= b ? 'v' : 'b';
}
