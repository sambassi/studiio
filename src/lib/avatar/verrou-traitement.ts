/**
 * UN SEUL envoi ou traitement de source vidéo à la fois PAR COMPTE.
 *
 * Chaque appel stocke jusqu'à 32 Mo ou lance ffmpeg jusqu'à 240 s : sans ce
 * verrou, un seul compte pourrait saturer le serveur en parallélisant.
 * Verrou en mémoire du processus (un conteneur applicatif) — suffisant
 * contre la rafale d'un même navigateur ; jamais bloquant au-delà d'un appel.
 */
const enCours = new Set<string>();

export function prendreVerrouSource(userId: string): boolean {
  if (enCours.has(userId)) return false;
  enCours.add(userId);
  return true;
}

export function libererVerrouSource(userId: string): void {
  enCours.delete(userId);
}

export const MESSAGE_SOURCE_EN_COURS = 'Une vidéo est déjà en cours de traitement. Patientez quelques secondes, puis réessayez.';
