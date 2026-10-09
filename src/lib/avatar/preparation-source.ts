/**
 * PRÉPARER LA VIDÉO SOURCE — côté serveur : ffprobe et ffmpeg.
 *
 * Les règles (contrôle, bornes, commande, amélioration automatique) vivent
 * dans `preparation-source-regles.ts`, module PUR partagé avec l'éditeur du
 * navigateur ; ce module-ci y ajoute les deux binaires, et rien d'autre.
 * Ré-exportées pour que les routes n'aient qu'une porte.
 *
 * Aucun fournisseur n'est appelé ici : la préparation précède tout envoi.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import {
  analyserSortieFfprobe, argumentsFfmpeg, type InfosVideo, type ParametresTraitement,
} from '@/lib/avatar/preparation-source-regles';

export * from '@/lib/avatar/preparation-source-regles';

const executer = promisify(execFile);

/**
 * Options d'ENTRÉE communes à ffprobe et ffmpeg : seul le protocole `file`
 * est permis, et seuls les démultiplexeurs des formats acceptés (MP4/MOV,
 * WebM/Matroska). HLS, concat, http… sont refusés avant toute lecture.
 */
export const PROTECTIONS_ENTREE = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm',
] as const;

/** Une sonde ne lit que l'en-tête : 30 s suffisent largement. */
const DELAI_FFPROBE_MS = 30_000;
/** 10 min de 1080p en `veryfast` : quelques minutes au pire. Sous le `maxDuration` de la route. */
export const DELAI_FFMPEG_MS = 240_000;

/** Les informations d'un fichier vidéo local ; lève si ffprobe est absent ou si le fichier est illisible. */
export async function infosVideo(chemin: string): Promise<InfosVideo> {
  const { size } = await stat(chemin);
  const { stdout } = await executer(cheminFfprobe(), [
    // Fichier LOCAL uniquement : un conteneur piégé (playlist, concat) ne
    // doit jamais faire ouvrir une URL ou un autre fichier (SSRF / lecture).
    ...PROTECTIONS_ENTREE, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', chemin,
  ], { timeout: DELAI_FFPROBE_MS, maxBuffer: 4 * 1024 * 1024 });
  let json: unknown;
  try { json = JSON.parse(String(stdout)); } catch { throw new Error('ffprobe: sortie illisible'); }
  const infos = analyserSortieFfprobe(json, size);
  if (!infos) throw new Error('ffprobe: aucun flux exploitable');
  return infos;
}

/** Produit la version PRÉPARÉE dans `sortie`. Les paramètres doivent être déjà bornés (`bornerParametres`). */
export async function traiterVideo(
  entree: string, sortie: string, p: ParametresTraitement, infos: InfosVideo,
): Promise<void> {
  await executer(cheminFfmpeg(), [...PROTECTIONS_ENTREE, ...argumentsFfmpeg(entree, sortie, p, infos)], {
    timeout: DELAI_FFMPEG_MS, maxBuffer: 16 * 1024 * 1024,
  });
}

/** Un dossier de travail privé, propre à UNE requête. */
export function dossierTemporaire(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'avatar-source-'));
}

/** Retire le dossier de travail ; ne lève jamais (un visage ne reste pas sur le disque, mais un échec ici ne casse pas la réponse). */
export async function retirerDossierTemporaire(dossier: string | null): Promise<void> {
  if (!dossier) return;
  await rm(dossier, { recursive: true, force: true }).catch(() => {});
}
