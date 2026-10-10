/**
 * PRÉPARER UNE PHOTO SOURCE — côté serveur : ffmpeg, le même binaire que la
 * vidéo (`cheminFfmpeg`). Les règles pures sont dans `preparation-photo-regles.ts`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { argumentsFfmpegPhoto, PROTECTIONS_ENTREE_PHOTO } from '@/lib/avatar/preparation-photo-regles';

export * from '@/lib/avatar/preparation-photo-regles';

const executer = promisify(execFile);
/** Une photo, même grande : quelques secondes. */
export const DELAI_FFMPEG_PHOTO_MS = 60_000;

/** Produit la photo EMBELLIE dans `sortie` (JPEG). L'entrée n'est jamais modifiée. */
export async function traiterPhoto(entree: string, sortie: string, lissage: number, orientation: number): Promise<void> {
  const args = argumentsFfmpegPhoto(entree, sortie, lissage, orientation);
  // Les protections d'entrée AVANT `-i` (options d'entrée), après les options globales.
  const i = args.indexOf('-noautorotate');
  await executer(cheminFfmpeg(), [...args.slice(0, i), ...PROTECTIONS_ENTREE_PHOTO, ...args.slice(i)], {
    timeout: DELAI_FFMPEG_PHOTO_MS, maxBuffer: 4 * 1024 * 1024,
  });
}
