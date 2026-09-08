/**
 * A_5a — CE QU'ON APPREND D'UN FICHIER AUDIO, ET COMMENT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE CROIT PAS LE NAVIGATEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une extension `.mp3` ne prouve rien : un fichier texte renommé porte la
 * même. La durée, les canaux et le codec viennent donc de `ffprobe`, et un
 * fichier sans piste audio est refusé — quel que soit ce qu'il annonce.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA FORME D'ONDE VIENT DU SIGNAL, PAS D'UN GÉNÉRATEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une onde décorative aléatoire serait plus rapide et plus jolie. Elle
 * mentirait : deux morceaux différents auraient la même, et un silence
 * ressemblerait à un refrain. On décode donc réellement, en mono à basse
 * fréquence — ce qui suffit largement pour soixante-quatre barres.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE SILENCE INITIAL EST MESURÉ ICI, UNE FOIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur de rendu sait déjà le mesurer et le couper — et il continuera de
 * le faire, c'est lui qui décide. Le mémoriser à l'import sert l'ÉCRAN : une
 * écoute qui démarre sur huit cents millisecondes de blanc donne l'impression
 * que le fichier est cassé.
 */
import {
  POINTS_FORME_ONDE, DUREE_AUDIO_MAX_MS, DUREE_AUDIO_MIN_MS,
} from '@/lib/creatif/audio';

/** La fréquence d'analyse : assez pour une enveloppe, pas plus. */
export const FREQUENCE_ANALYSE = 8_000;

/** Ce qu'un fichier doit peser au plus pour entrer dans la banque. */
export const OCTETS_AUDIO_MAX = 40 * 1024 * 1024;

export const MOTIFS_IMPORT_AUDIO = [
  'cle_hors_perimetre',
  'fichier_absent',
  'fichier_trop_gros',
  'pas_un_audio',
  'duree_hors_bornes',
  'analyse_impossible',
  'banque_pleine',
  'droits_non_confirmes',
] as const;
export type MotifImportAudio = (typeof MOTIFS_IMPORT_AUDIO)[number];

export const MESSAGES_IMPORT_AUDIO: Record<MotifImportAudio, string> = {
  cle_hors_perimetre: 'Ce fichier ne vient pas de ta médiathèque.',
  fichier_absent: 'Ce fichier n’existe plus dans ta médiathèque.',
  fichier_trop_gros: 'Ce fichier est trop lourd pour la banque audio.',
  pas_un_audio: 'Ce fichier ne contient aucune piste audio.',
  duree_hors_bornes: 'Cette musique est trop courte ou trop longue.',
  analyse_impossible: 'Cette musique n’a pas pu être analysée. Réessaie.',
  banque_pleine: 'Ta banque audio est pleine. Retire une musique pour en ajouter.',
  droits_non_confirmes: 'Confirme que tu disposes des droits sur ce fichier.',
};

/** La sonde : une passe, et rien que ce qu'on lit. */
export function argumentsSondeAudio(fichier: string): string[] {
  return [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=codec_type,codec_name,sample_rate,channels',
    '-of', 'json', fichier,
  ];
}

export interface SondeAudio {
  dureeMs: number;
  codec: string;
  canaux: number;
  frequence: number;
}

/** Ce que la sonde a dit, ou `null`. Fonction PURE. */
export function lireSondeAudio(brut: string): SondeAudio | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(brut) as Record<string, unknown>; } catch { return null; }
  const format = o.format as Record<string, unknown> | undefined;
  const flux = Array.isArray(o.streams) ? o.streams as Record<string, unknown>[] : [];
  // ⚠️ PAR `codec_type`, JAMAIS PAR POSITION. Un fichier peut porter une
  // pochette : `streams[0]` serait alors une image.
  const audio = flux.find((s) => s.codec_type === 'audio');
  if (!audio) return null;
  const secondes = Number(format?.duration);
  if (!Number.isFinite(secondes) || secondes <= 0) return null;
  return {
    dureeMs: Math.round(secondes * 1000),
    codec: String(audio.codec_name ?? ''),
    canaux: Number(audio.channels ?? 0) || 0,
    frequence: Number(audio.sample_rate ?? 0) || 0,
  };
}

export function dureeAudioAcceptable(dureeMs: number): boolean {
  return dureeMs >= DUREE_AUDIO_MIN_MS && dureeMs <= DUREE_AUDIO_MAX_MS;
}

/** Le décodage en PCM mono, pour la forme d'onde. */
export function argumentsFormeOnde(fichier: string): string[] {
  return [
    '-hide_banner', '-v', 'error', '-nostdin',
    '-i', fichier,
    '-ac', '1', '-ar', String(FREQUENCE_ANALYSE),
    '-f', 's16le', 'pipe:1',
  ];
}

/**
 * Soixante-quatre valeurs, de 0 à 255, calculées sur le VRAI signal.
 *
 * ⚠️ EN VALEUR EFFICACE, PAS EN CRÊTE. Le maximum d'une fenêtre saute au
 * moindre transitoire : deux morceaux très différents finiraient avec la même
 * onde plate à 255. La moyenne quadratique décrit l'énergie perçue, et c'est
 * elle qu'on reconnaît d'un coup d'œil.
 *
 * ⚠️ NORMALISÉE SUR LE MORCEAU. Une piste enregistrée bas produirait sinon
 * une ligne écrasée illisible. C'est une VISUALISATION, pas une mesure de
 * niveau — le rendu, lui, ne lit jamais cette valeur.
 *
 * Fonction PURE et déterministe.
 */
export function formeOndeDepuisPcm(pcm: Buffer): number[] {
  const echantillons = Math.floor(pcm.length / 2);
  if (echantillons < POINTS_FORME_ONDE) return [];
  const parPoint = Math.floor(echantillons / POINTS_FORME_ONDE);
  const brut: number[] = [];
  for (let p = 0; p < POINTS_FORME_ONDE; p += 1) {
    let somme = 0;
    const debut = p * parPoint;
    for (let i = 0; i < parPoint; i += 1) {
      const v = pcm.readInt16LE((debut + i) * 2) / 32768;
      somme += v * v;
    }
    brut.push(Math.sqrt(somme / parPoint));
  }
  const max = Math.max(...brut);
  if (!(max > 0)) return brut.map(() => 0);
  return brut.map((v) => Math.min(255, Math.round((v / max) * 255)));
}

/** Les 64 valeurs en base64 — la forme que le catalogue stocke. */
export function encoderFormeOnde(points: readonly number[]): string {
  return Buffer.from(Uint8Array.from(points.slice(0, POINTS_FORME_ONDE))).toString('base64');
}

/**
 * L'empreinte des OCTETS d'une piste.
 *
 * ⚠️ ELLE NE PORTE NI CHEMIN NI NOM. Deux fichiers différents sous la même
 * clé — un ré-téléversement — doivent produire deux rendus différents ; deux
 * fichiers identiques renommés doivent produire le même. La taille et
 * l'étiquette du stockage disent exactement cela, et rien d'autre.
 */
export function empreinteAsset(octets: number, etag: string | null | undefined): string {
  const propre = String(etag ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  return propre ? `${octets}-${propre}` : `${octets}`;
}
