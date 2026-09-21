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
 * Photo de la n-ieme video — SANS recyclage.
 *
 * L'ancienne version bouclait (`urls[index % urls.length]`) : un lot de trois
 * videos avec deux affiches en donnait deux identiques, exactement ce que le
 * lot cherche a eviter — on genere plusieurs montages pour VARIER les
 * publications. Au-dela de la liste, plus d'affiche : l'appelant doit alors
 * bloquer l'envoi plutot que de livrer un doublon en silence.
 */
export function distinctPhotoForIndex(urls: string[], index: number): string | undefined {
  if (!urls || urls.length === 0) return undefined;
  const n = Math.floor(index);
  if (n < 0 || n >= urls.length) return undefined;
  return urls[n] || undefined;
}

/**
 * Liste dedoublonnee, dans l'ordre d'apparition.
 *
 * Deux resultats de recherche peuvent porter la meme URL — Pexels et Unsplash
 * proposent parfois le meme cliche, et l'utilisateur peut avoir televerse deux
 * fois le meme fichier.
 */
export function distinctUrls(urls: Array<string | undefined | null>): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== 'string' || !u || vus.has(u)) continue;
    vus.add(u);
    out.push(u);
  }
  return out;
}

/**
 * Attribution automatique : une affiche DISTINCTE par video.
 *
 * Rend moins d'entrees que demande quand les resultats n'en fournissent pas
 * assez — c'est a l'ecran de le dire et de proposer d'elargir la recherche,
 * pas a cette fonction d'inventer un doublon.
 */
export function autoAssignPhotos(candidates: Array<string | undefined | null>, count: number): string[] {
  return distinctUrls(candidates).slice(0, clampBatchCount(count));
}

/**
 * Le lot est-il pret a partir ?
 *
 * Une affiche par video, toutes differentes. Un lot incomplet doit etre
 * refuse : livrer deux montages identiques a l'affiche pres est precisement ce
 * qu'on veut eviter.
 */
export function batchPhotosReady(urls: string[], count: number): boolean {
  const total = clampBatchCount(count);
  if (total === 1) return true;
  const nets = distinctUrls(urls);
  return nets.length >= total && urls.filter(Boolean).length >= total;
}

/** Combien de photos distinctes il faut demander a la recherche. */
export function photosToFetch(count: number): number {
  return Math.max(clampBatchCount(count) * 2, 6);
}

/**
 * Dates du lot, etalees d'un jour a partir de `base`, TOUJOURS vers l'avant.
 *
 * Vraie progression calendaire : la fin du mois, de fevrier (bissextile ou
 * non) et de l'annee est franchie naturellement, le constructeur `Date`
 * reportant un jour hors limites sur le mois suivant.
 *
 * L'ancienne regle « de l'editeur avance » (repartir en ARRIERE des qu'une date
 * sortait du mois de depart) est abandonnee : un lot de 10 lance le 25 d'un
 * mois de 30 jours donnait 25..30 puis 19, 18, 17, 16 — un lot non consecutif,
 * et des dates potentiellement dans le passe, donc jamais publiees.
 *
 * Chaque cible est construite a MIDI LOCAL a partir des seuls champs civils de
 * `base` (annee, mois, jour), sans recopier son heure : une base proche de
 * minuit (l'appelant retombe sur `new Date()` quand aucune date n'est choisie)
 * ne peut donc pas glisser d'un jour lors d'un changement d'heure — midi
 * n'est jamais une heure inexistante ni ambigue.
 *
 * Format `YYYY-MM-DD` en heure LOCALE (pas UTC) : l'appelant relit ces dates
 * avec `new Date(`${d}T12:00:00`)`, midi local, pour eviter les bascules DST.
 */
export function batchDates(base: Date, count: number): string[] {
  const total = clampBatchCount(count);
  const out: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, 12);
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
