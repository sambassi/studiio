/**
 * Regles du LOT : generer plusieurs montages d'un coup.
 *
 * Fonctions PURES, sans React ni reseau — c'est ce qui les rend verifiables
 * sur des valeurs. Le lot touche aux credits et cree des posts : ses regles
 * meritent d'etre lisibles ailleurs que dans une boucle de 400 lignes.
 */

/**
 * Angles editoriaux, repris tels quels de l'editeur avance.
 *
 * Sans angle impose, l'IA renvoie le meme contenu a chaque appel sur un meme
 * sujet : un lot de cinq videos serait cinq fois la meme.
 */
export const BATCH_ANGLES = [
  'axe scientifique : données, études, chiffres précis',
  'axe pratique : routines quotidiennes, conseils actionnables',
  'axe débutant : vocabulaire simple, erreurs à éviter',
  'axe avancé : techniques pointues, optimisations',
  'axe motivation : transformation, gains concrets',
  'axe santé mentale : bien-être, récupération, stress',
  'axe alimentation : nutriments, timing des repas',
  'axe matériel / équipement : ce qu’il faut vraiment',
  'axe mythes et vérités : idées reçues vs réalité',
  'axe transformation 30 jours : plan structuré avec jalons',
  'axe pièges à éviter : erreurs communes et comment y échapper',
  'axe routine matin/soir : rituels pour encadrer la journée',
  'axe combinaison : synergies entre plusieurs pratiques',
  'axe récupération : repos actif, sommeil, techniques',
  'axe énergie rapide : gains sous 5-10 minutes',
  'axe longue durée : progression sur 3-6-12 mois',
  'axe débutant vs avancé : le même geste adapté à chaque niveau',
  'axe erreurs courantes : ce que presque tout le monde rate',
  'axe guide pas à pas : séquence numérotée de A à Z',
  'axe naturel vs industriel : choix bruts vs produits transformés',
] as const;

/** Nombre maximal de montages par lot. */
export const MAX_BATCH = 10;

/**
 * Angle de la n-ieme video du lot, `index` partant de 0.
 *
 * Tourne au-dela de la liste : un lot plus long que la liste reprend les
 * angles dans l'ordre plutot que de s'arreter.
 */
export function angleForIndex(index: number): string {
  const n = Math.max(0, Math.floor(index));
  return BATCH_ANGLES[n % BATCH_ANGLES.length];
}

/** Nombre de montages retenu, borne a ce que l'ecran propose. */
export function clampBatchCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_BATCH, Math.max(1, Math.floor(value)));
}

/** Cout total du lot, en credits. */
export function batchCost(unitCost: number, count: number): number {
  return unitCost * clampBatchCount(count);
}

/**
 * Photo de la n-ieme video.
 *
 * Moins de photos choisies que de videos : on reprend depuis le debut plutot
 * que de laisser des montages sans affiche. Aucune photo : `undefined`, et le
 * fond degrade s'applique — le comportement d'avant le lot.
 */
export function photoForIndex(urls: string[], index: number): string | undefined {
  if (!urls || urls.length === 0) return undefined;
  const n = Math.max(0, Math.floor(index));
  return urls[n % urls.length];
}

/**
 * Dates du lot, etalees d'un jour a partir de `base`.
 *
 * Le lot va vers l'AVANT, sauf s'il franchit la fin du mois : les iterations
 * qui deborderaient repartent alors vers l'arriere. C'est la regle de
 * l'editeur avance, conservee telle quelle pour que les deux parcours
 * remplissent le calendrier de la meme facon.
 */
export function batchDates(base: Date, count: number): string[] {
  const total = clampBatchCount(count);
  const out: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const target = new Date(base.getTime());
    target.setDate(base.getDate() + i);
    if (target.getMonth() !== base.getMonth()) {
      target.setTime(base.getTime());
      target.setDate(base.getDate() - i);
    }
    out.push(
      `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

/**
 * Sujet envoye a l'IA pour la n-ieme video.
 *
 * L'angle est un SUFFIXE : le sujet lui-meme reste propre, ce qui evite que
 * l'angle se retrouve dans le titre affiche.
 */
export function batchTopic(topic: string, index: number): string {
  return `${topic} (angle: ${angleForIndex(index)})`;
}

/** Jeton de variation — deux appels du meme lot ne doivent pas se confondre. */
export function variationNonce(index: number, now: number): string {
  return `${index + 1}-${now.toString(36)}`;
}
