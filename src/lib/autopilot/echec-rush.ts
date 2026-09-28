/**
 * Un montage a échoué : faut-il faire avancer la rotation des rushes ?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME, DANS LES DEUX SENS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * - Ne JAMAIS avancer sur un échec (comportement d'origine) : un rush qui
 *   fait échouer le rendu est repris par `pickRush` à chaque passage, et
 *   l'Autopilote reste bloqué dessus pour toujours.
 * - TOUJOURS avancer (premier correctif) : un crash passager — Chromium,
 *   téléversement, insertion — fait sauter un rush parfaitement valide
 *   jusqu'au tour de banque suivant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE CRITÈRE RETENU — deux conditions, la première qui répond gagne
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. L'ERREUR ACCUSE LE RUSH (`erreurImputableAuRush`) : elle cite l'adresse
 *    du rush (Remotion nomme la source qu'il n'a pas pu lire), ou elle a la
 *    forme d'une erreur de décodage/lecture de média (données invalides,
 *    atome `moov` absent, aucun flux vidéo, codec non pris en charge…).
 *    → on avance tout de suite.
 *
 * 2. SINON, ÉCHECS CONSÉCUTIFS SUR LE MÊME RUSH : au-delà de
 *    `SEUIL_ECHECS_CONSECUTIFS`, on avance quand même. C'est le filet contre
 *    une erreur imputable au rush que la classification ne reconnaît pas.
 *    Le compteur vit EN MÉMOIRE du processus — aucune migration. Un
 *    redéploiement le remet à zéro, ce qui retarde au pire le saut de
 *    quelques passages ; il ne bloque plus jamais à vie. Un succès sur le
 *    rush remet son compteur à zéro.
 *
 * Tout le reste est TRANSITOIRE : la rotation ne bouge pas, et le même rush
 * est retenté au passage suivant (`last_run_at` n'ayant pas avancé si rien
 * n'a été produit).
 */

/** Échecs consécutifs sur un même rush au-delà desquels on le passe. */
export const SEUIL_ECHECS_CONSECUTIFS = 3;

/** Formes d'erreur qui désignent un média illisible, quel qu'il soit. */
const MOTIFS_MEDIA_ILLISIBLE: RegExp[] = [
  /invalid data found when processing input/i,
  /moov atom not found/i,
  /no (video|audio) stream/i,
  /unsupported (codec|format|video)/i,
  /(could not|couldn'?t|failed to|unable to|cannot) (decode|demux|parse|read|open|load) (the )?(video|media|file|source)/i,
  /MEDIA_ERR_(DECODE|SRC_NOT_SUPPORTED)/,
  /DEMUXER_ERROR/i,
];

/** L'erreur accuse-t-elle le rush lui-même ? */
export function erreurImputableAuRush(message: string, rushUrl: string | null | undefined): boolean {
  if (!message) return false;
  if (rushUrl && message.includes(rushUrl)) return true;
  return MOTIFS_MEDIA_ILLISIBLE.some((m) => m.test(message));
}

/** `userId|rush` → échecs consécutifs. */
const echecsConsecutifs = new Map<string, number>();

const cle = (userId: string, rushUrl: string) => `${userId}|${rushUrl}`;

/**
 * Enregistre un échec sur ce rush et dit s'il faut le passer.
 * Rend `true` quand la rotation doit avancer (compteur remis à zéro).
 */
export function doitPasserLeRush(input: {
  userId: string;
  rushUrl: string;
  message: string;
}): boolean {
  const k = cle(input.userId, input.rushUrl);
  if (erreurImputableAuRush(input.message, input.rushUrl)) {
    echecsConsecutifs.delete(k);
    return true;
  }
  const n = (echecsConsecutifs.get(k) ?? 0) + 1;
  if (n >= SEUIL_ECHECS_CONSECUTIFS) {
    echecsConsecutifs.delete(k);
    return true;
  }
  echecsConsecutifs.set(k, n);
  return false;
}

/** Un succès sur ce rush efface ses échecs passés. */
export function rushReussi(userId: string, rushUrl: string | null | undefined): void {
  if (rushUrl) echecsConsecutifs.delete(cle(userId, rushUrl));
}

/** Pour les tests. */
export function reinitialiserEchecsRush(): void {
  echecsConsecutifs.clear();
}
