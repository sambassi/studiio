/**
 * CONSEILLER — mesures RÉELLES des textes du rendu hybride (lecture seule).
 *
 * Lit les images fixes des textes (déjà rendues par Remotion) et la vidéo de
 * base en petit (écrite par le même passage ffmpeg), et en tire, pour chaque
 * texte : sa place, la hauteur de ses lignes, le fond derrière et l'activité
 * de chaque zone pendant son affichage. Toute erreur rend `null` : le rendu
 * n'en dépend jamais.
 */
import fs from 'fs';
import { spawn } from 'child_process';
import {
  BASE_L, BASE_H, ZONES, activite, fondDerriere, geometrieTexte, imagesFenetre,
  type ElementLisibilite,
} from '@/lib/creer/conseiller/lisibilite';

const STILL_L = 270;
const STILL_H = 480;

function lireRgba(ffmpeg: string, png: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', png, '-vf', `scale=${STILL_L}:${STILL_H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const morceaux: Buffer[] = [];
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('délai')); }, 15_000);
    p.stdout.on('data', (b: Buffer) => morceaux.push(b));
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => { clearTimeout(minuteur); if (code === 0) resolve(Buffer.concat(morceaux)); else reject(new Error(`ffmpeg ${code}`)); });
  });
}

export async function mesurerTextes(input: {
  ffmpeg: string;
  baseBrute: string;
  textes: Array<{ cible: string; texte: string | null; image: string; debut: number; fin: number }>;
}): Promise<ElementLisibilite[] | null> {
  try {
    const brut = fs.readFileSync(input.baseBrute);
    const taille = BASE_L * BASE_H;
    const images: Uint8Array[] = [];
    for (let o = 0; o + taille <= brut.length; o += taille) images.push(brut.subarray(o, o + taille));
    if (images.length < 2) return null;
    const gris = images.map((im) => Float32Array.from(im, (v) => v / 255));
    const out: ElementLisibilite[] = [];
    for (const t of input.textes) {
      const rgba = await lireRgba(input.ffmpeg, t.image);
      if (rgba.length < STILL_L * STILL_H * 4) continue;
      const geometrie = geometrieTexte(rgba, STILL_L, STILL_H);
      if (!geometrie.boite) continue;
      const fenetre = imagesFenetre(gris, t.debut, t.fin);
      const [x0, y0, x1, y1] = geometrie.boite;
      out.push({
        cible: t.cible,
        texte: t.texte,
        debut: t.debut,
        fin: t.fin,
        geometrie,
        fond: fondDerriere(fenetre, geometrie.boite),
        activiteTexte: activite(fenetre, { x0, y0, x1, y1 }),
        zones: ZONES.map((z) => ({ nom: z.nom, activite: activite(fenetre, z) })),
      });
    }
    return out;
  } catch (err) {
    console.warn('[Conseiller] mesure des textes impossible :', err instanceof Error ? err.message : err);
    return null;
  }
}
