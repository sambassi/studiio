/**
 * CINEMA IA — d'AUTRES rendus lourds sont-ils en cours dans ce conteneur ?
 *
 * Le compteur `rendusRemotionActifs` ne voit que `renderVideo`. Le rendu hybride
 * de l'Autopilote lance son propre Chromium et ffmpeg SANS y figurer, et
 * l'Autopilote ne lit pas ce compteur. Sans toucher a l'Autopilote, Cinema
 * regarde donc ce qui tourne VRAIMENT : les processus Chromium et ffmpeg du
 * meme espace de processus (`/proc`).
 *
 * ⚠️ CE N'EST PAS UNE GARANTIE.
 *   - Un rendu qui demarre APRES la verification n'est pas vu (course).
 *   - Seuls les processus du MEME conteneur sont visibles.
 *   - Hors Linux (`/proc` absent), la detection est impossible : `null`, et
 *     l'appelant ne doit pas pretendre le contraire.
 * Cinema ne l'appelle qu'AVANT une scene : son propre Chromium est alors
 * termine (chaque scene ferme son navigateur), donc tout ce qui est vu est
 * etranger a Cinema.
 */
import { readdir, readFile } from 'fs/promises';

/** Noms de processus (`comm`, 15 caracteres au plus) consideres comme un rendu lourd. */
export function estProcessusLourd(comm: string): boolean {
  const c = comm.trim().toLowerCase();
  return c.startsWith('chrome') || c.startsWith('chromium') || c === 'ffmpeg';
}

export interface LecteurProc {
  pids(): Promise<string[]>;
  /** `comm` et etat (`R`, `S`, `Z`…) d'un processus, ou `null` s'il a disparu. */
  lire(pid: string): Promise<{ comm: string; etat: string } | null>;
}

const lecteurReel: LecteurProc = {
  async pids() { return (await readdir('/proc')).filter((n) => /^[0-9]+$/.test(n)); },
  async lire(pid) {
    try {
      const comm = (await readFile(`/proc/${pid}/comm`, 'utf-8')).trim();
      const stat = await readFile(`/proc/${pid}/stat`, 'utf-8');
      // L'etat suit la parenthese fermante du nom : « 12 (nom) S ... ».
      const etat = stat.slice(stat.lastIndexOf(')') + 1).trim().charAt(0);
      return { comm, etat };
    } catch { return null; }
  },
};

/** Nombre de processus Chromium/ffmpeg vivants, ou `null` si la detection est impossible ici. */
export async function compterProcessusLourds(lecteur: LecteurProc = lecteurReel): Promise<number | null> {
  let pids: string[];
  try { pids = await lecteur.pids(); } catch { return null; }
  if (!pids.length) return null;
  let n = 0;
  for (const pid of pids) {
    const p = await lecteur.lire(pid);
    // Un zombie (`Z`) ou un processus mort (`X`) ne consomme plus rien.
    if (p && p.etat !== 'Z' && p.etat !== 'X' && estProcessusLourd(p.comm)) n += 1;
  }
  return n;
}
