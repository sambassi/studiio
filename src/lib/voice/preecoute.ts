/**
 * Pré-écoute GRATUITE de la voix personnelle — la borne, commune à l'écran
 * et au serveur (module pur, sans dépendance serveur).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ≈ 5 SECONDES, ET PAS PLUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une voix française lue à débit normal dit environ 14 caractères par
 * seconde (≈ 150 mots/min, ≈ 5,5 caractères par mot espace compris) :
 * 5 s ≈ 70 caractères. La borne porte sur le texte RÉELLEMENT PRONONCÉ
 * (après prononciations du compte et normalisation), pas sur le texte
 * affiché : « 76% » s'écrit court mais se dit « 76 pour cent ».
 *
 * Le serveur est seul juge : une durée ou une longueur venue du navigateur
 * n'est jamais crue. L'écran applique la même borne pour prévenir, pas
 * pour décider.
 *
 * L'audio complet (« Générer l'audio complet ») n'existe PAS ici : aucun
 * tarif n'est fixé, aucun débit de crédits n'est branché.
 */

export const MAX_CARACTERES_PREECOUTE = 70;

/** Le texte borné à `max` caractères, coupé à la dernière frontière de mot. */
export function couperAuMot(texte: string, max: number = MAX_CARACTERES_PREECOUTE): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  if (propre.length <= max) return propre;
  const coupe = propre.slice(0, max + 1);
  const dernierEspace = coupe.lastIndexOf(' ');
  // Un seul mot plus long que la borne : coupe franche, jamais au-delà.
  const net = dernierEspace > 0 ? coupe.slice(0, dernierEspace) : propre.slice(0, max);
  return net.replace(/[\s,;:–—-]+$/u, '').trim();
}

export const MESSAGE_TROP_D_ECOUTES = 'Trop d’écoutes, réessayez dans un instant.';
export const MESSAGE_TEXTE_TROP_LONG = `La pré-écoute gratuite est limitée à environ 5 secondes (${MAX_CARACTERES_PREECOUTE} caractères prononcés).`;
