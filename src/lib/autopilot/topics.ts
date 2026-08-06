/**
 * Les sujets de l'Autopilote, et leur rotation.
 *
 * ⚠️ LE SUJET ÉTAIT FIXE, D'OÙ DES VIDÉOS IDENTIQUES. Le cycle lisait
 * `objectives.target_audience` — une seule valeur par compte — et retombait
 * sur « motivation quotidienne » quand elle manquait. Tout en découlait : le
 * titre, les cartes, le CTA, et jusqu'à la photo d'affiche, dont la requête
 * et le tirage dérivent du sujet. Deux cycles produisaient donc deux fois la
 * même vidéo.
 *
 * La liste reprend les thèmes proposés par le Mode simple : l'Autopilote doit
 * produire ce qu'un utilisateur obtiendrait en parcourant l'assistant, pas un
 * catalogue parallèle.
 */

/** Sujets disponibles — les mêmes que les thèmes de l'assistant. */
export const AUTOPILOT_TOPICS: readonly string[] = Object.freeze([
  'sommeil', 'nutrition', 'energie', 'stress', 'danse', 'motivation',
  'eau', 'beauty', 'finance', 'productivity', 'food', 'travel',
]);

/** Normalise un sujet pour le comparer — casse et accents mis de côté. */
export function normalizeTopic(t: string): string {
  return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Choisit `count` sujets DISTINCTS, en évitant ceux déjà employés.
 *
 * `seed` fait tourner le point de départ d'un cycle à l'autre : sans elle,
 * deux passages qui trouvent la même liste d'exclusions repartiraient sur le
 * même sujet.
 *
 * Si tout a déjà servi, on reprend depuis le début plutôt que de ne rien
 * rendre : mieux vaut un thème revu qu'un cycle vide.
 */
export function pickTopics(input: {
  count: number;
  /** Sujets déjà employés récemment — évités en priorité. */
  exclude?: string[];
  seed?: number;
}): string[] {
  const combien = Math.max(1, Math.floor(input.count) || 1);
  const exclus = new Set((input.exclude ?? []).map(normalizeTopic).filter(Boolean));
  const depart = Math.abs(Math.floor(input.seed ?? 0)) % AUTOPILOT_TOPICS.length;

  // Parcours circulaire depuis `depart` : l'ordre reste stable et lisible,
  // seul le point d'entrée bouge.
  const ordonnes = AUTOPILOT_TOPICS.map(
    (_, i) => AUTOPILOT_TOPICS[(depart + i) % AUTOPILOT_TOPICS.length],
  );
  const frais = ordonnes.filter((t) => !exclus.has(normalizeTopic(t)));
  const source = frais.length >= combien ? frais : [...frais, ...ordonnes];

  const out: string[] = [];
  for (const t of source) {
    if (out.length >= combien) break;
    // Deux montages d'un même cycle ne doivent pas partager leur sujet.
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
