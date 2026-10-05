/**
 * ENVOI DE CRÉER — quand une date est exigée (régression staging après #497).
 *
 * #497 vide une date de BROUILLON LOCAL déjà passée (sinon le post tombait,
 * invisible, dans un mois passé). Appliquée aussi en MODIFICATION, elle vidait
 * la date du post rouvert : « choisissez une date », alors que l'utilisateur
 * ne programmait rien. Et le bouton d'envoi exigeait une date même pour un
 * simple brouillon.
 *
 * Règles :
 *  - brouillon : aucune date demandée (vide = aujourd'hui, comme le rendu) ;
 *  - téléchargement : aucune date (jamais exigée) ;
 *  - programmation : date obligatoire, et au moins un réseau.
 */
import { dateBrouillonReprise } from '@/lib/creer/batch';

export type IntentionEnvoi = 'brouillon' | 'programmer';

/** Date restaurée : celle du POST en modification, #497 seulement pour un brouillon local. */
export function dateRestauree(date: string, enModification: boolean, maintenant: Date = new Date()): string {
  return enModification ? date : dateBrouillonReprise(date, maintenant);
}

/** La date manque-t-elle VRAIMENT ? Seulement pour programmer. */
export function dateRequiseManquante(intention: IntentionEnvoi, date: string): boolean {
  return intention === 'programmer' && !date;
}

/** L'envoi au Calendrier est-il possible ? */
export function envoiPossible(p: { intention: IntentionEnvoi; date: string; reseaux: number }): boolean {
  if (p.intention === 'brouillon') return true;
  return !!p.date && p.reseaux > 0;
}
