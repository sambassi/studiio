/**
 * #504 — VIDÉO RACCOURCIE FAUTE DE MATIÈRE UNIQUE.
 *
 * Le moteur ne répète jamais un passage de rush (verrou CARDIO_DANCE) : si
 * les rushes ne suffisent pas pour la durée demandée, la vidéo PROPRE est plus
 * courte. L'utilisateur est prévenu AVANT le rendu et choisit : continuer
 * avec cette durée, ou ajouter des rushs. Rien n'est réservé ni débité avant.
 */
export interface Raccourci {
  /** Durée demandée (s). */
  demande: number;
  /** Durée propre possible sans répétition (s). */
  possible: number;
  /** Rushes uniques utilisés. */
  rushs: number;
  /** Estimation (arrondie au supérieur) du nombre de rushs à ajouter. */
  supplementaires: number;
  message: string;
}

/** Seuil sous lequel l'écart ne vaut pas une question (s). */
const ECART_MIN_S = 1;

export function raccourciNecessaire(demande: number, possible: number, rushs: number): Raccourci | null {
  if (!(demande > 0) || !(possible > 0) || possible >= demande - ECART_MIN_S) return null;
  const parRush = possible / Math.max(1, rushs);
  const supplementaires = Math.max(1, Math.ceil((demande - possible) / Math.max(1, parRush)));
  const s = (n: number) => Math.round(n);
  return {
    demande, possible, rushs, supplementaires,
    message: `Vos rushs actuels permettent une vidéo d’environ ${s(possible)} secondes sans répétition. `
      + `Pour obtenir une vidéo de ${s(demande)} secondes, ajoutez davantage de rushs.`,
  };
}

/** Arrêt volontaire (« Ajouter des rushs ») : ni erreur ni débit. */
export class ArretPourAjouterDesRushs extends Error {
  constructor() { super('ajouter-des-rushs'); this.name = 'ArretPourAjouterDesRushs'; }
}
