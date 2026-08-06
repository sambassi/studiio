/**
 * Les thèmes de contenu — la SEULE liste.
 *
 * ⚠️ ELLE VIT ICI PARCE QUE DEUX ÉCRANS S'EN SERVENT. « Créer simple » la
 * propose au choix pour un montage ; l'Autopilote la propose au choix pour sa
 * rotation. Recopiée des deux côtés, elle aurait fini par diverger — et un
 * thème présent à un endroit, absent de l'autre, ne se remarque que le jour
 * où une vidéo sort sur un sujet qu'on ne peut plus reproduire à la main.
 *
 * ⚠️ `icon` EST UN NOM D'ICÔNE LUCIDE, JAMAIS UN EMOJI. La règle du dépôt est
 * absolue : les emojis sont proscrits du contenu généré comme de l'interface.
 * Ces noms se résolvent par `CardIcon` / `ICON_MAP`.
 */

export interface Theme {
  id: string;
  label: string;
  /** Nom d'icône lucide — résolu par `CardIcon`. */
  icon: string;
  /** Sujet envoyé au générateur de contenu. */
  topic: string;
}

export const THEMES: readonly Theme[] = Object.freeze([
  { id: 'sommeil', label: 'Sommeil & récupération', icon: 'Moon', topic: 'sommeil' },
  { id: 'nutrition', label: 'Nutrition', icon: 'Salad', topic: 'nutrition' },
  { id: 'energie', label: 'Énergie & cardio', icon: 'Zap', topic: 'energie' },
  { id: 'stress', label: 'Stress & mental', icon: 'Brain', topic: 'stress' },
  { id: 'danse', label: 'Danse', icon: 'PersonStanding', topic: 'danse' },
  { id: 'motivation', label: 'Motivation', icon: 'Flame', topic: 'motivation' },
  { id: 'eau', label: 'Hydratation', icon: 'Droplet', topic: 'eau' },
  { id: 'beauty', label: 'Beauté', icon: 'Sparkles', topic: 'beauty' },
  { id: 'finance', label: 'Finance', icon: 'Wallet', topic: 'finance' },
  { id: 'productivity', label: 'Productivité', icon: 'Target', topic: 'productivity' },
  { id: 'food', label: 'Cuisine', icon: 'Utensils', topic: 'food' },
  { id: 'travel', label: 'Voyage', icon: 'Plane', topic: 'travel' },
]);

/** Libellé d'un thème, ou la chaîne elle-même si elle est personnalisée. */
export function themeLabel(topic: string): string {
  return THEMES.find((t) => t.topic === topic || t.id === topic)?.label || topic;
}

/** Le sujet vient-il de la liste, ou l'utilisateur l'a-t-il écrit ? */
export function isCustomTopic(topic: string): boolean {
  return !THEMES.some((t) => t.topic === topic || t.id === topic);
}
