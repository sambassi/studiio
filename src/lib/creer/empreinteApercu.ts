/**
 * Empreinte de ce que le montage MONTRE — pour savoir si le rendu en cache
 * correspond encore à l'éditeur.
 *
 * Le brouillon complet (ordre des séquences, couleurs, textes, positions,
 * médias…), moins ce qui ne change pas l'image : étape du parcours, date de
 * programmation, réglages de lot, état du jumeau en cours de génération.
 * Plus les couleurs EFFECTIVES (kit de marque compris : `colors` vaut `null`
 * tant que l'utilisateur ne les a pas changées). Pure.
 */
const HORS_IMAGE = new Set([
  'started', 'step', 'scheduledDate', 'batchCount', 'batchPhotoUrls', 'batchPhotoMode',
  'jumeauGenerationId', 'useDigitalTwin', 'sequenceVoicesUserEdited',
]);

export function empreinteApercu(
  brouillon: object,
  couleurs: { accent: string; gradStart: string; gradEnd: string; gradientOpacity: number },
): string {
  const visible = Object.fromEntries(Object.entries(brouillon).filter(([k]) => !HORS_IMAGE.has(k)));
  return JSON.stringify({ visible, couleurs });
}
