/**
 * Normalisation du texte POUR LA VOIX (fr-FR) — ce que le moteur vocal lit.
 *
 * Les moteurs (voix clonée comprise) lisent mal les chiffres accolés à un
 * symbole : « 76% », « +2%/an », « 300+ », « 3-en-1 »… Cette fonction rend
 * une version ÉCRITE EN TOUTES LETTRES de ces tournures.
 *
 * ⚠️ TEXTE POUR TTS UNIQUEMENT. Le texte affiché (cartes, titres, sous-titres,
 * légendes) n'est JAMAIS passé ici : seul le texte envoyé au moteur l'est. La
 * fonction est pure, déterministe et IDEMPOTENTE (l'appliquer deux fois ne
 * change rien) : elle peut donc être appelée à plusieurs étages sans risque.
 *
 * Ce qu'elle NE fait PAS : lire les nombres ordinaires en lettres (« 10 ans »
 * reste « 10 ans », les moteurs les lisent bien), ni deviner une marque — les
 * mots propres au compte passent par les prononciations (`scriptParle`).
 */

/** Ce qui prolonge un mot : lettre, chiffre, marque combinante. */
const MOT = '\\p{L}\\p{N}\\p{M}';
/** Un nombre écrit à la française : « 300 », « 2 500 », « 1,5 ». */
const NOMBRE = '\\d+(?: \\d{3})*(?:,\\d+)?';

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

/** Un entier de 0 à 99 en lettres (orthographe traditionnelle). `null` au-delà. */
export function nombreEnLettres(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n <= 16) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    const base = d === 7 ? 'soixante' : 'quatre-vingt';
    const reste = 10 + u;
    if (d === 7 && u === 1) return 'soixante et onze';
    return `${base}-${nombreEnLettres(reste)}`;
  }
  if (d === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITES[u]}`;
  const dizaine = DIZAINES[d];
  if (u === 0) return dizaine;
  if (u === 1) return `${dizaine} et un`;
  return `${dizaine}-${UNITES[u]}`;
}

/** Un ordinal (1 → premier, 2 → deuxième…) ; `null` au-delà de 99. */
function ordinalEnLettres(n: number, feminin: boolean): string | null {
  if (n === 1) return feminin ? 'première' : 'premier';
  const c = nombreEnLettres(n);
  if (!c) return null;
  if (c.endsWith('cinq')) return `${c}uième`;
  if (c.endsWith('neuf')) return `${c.slice(0, -1)}vième`;
  if (c.endsWith('quatre-vingts')) return `${c.slice(0, -1)}ième`;
  if (c.endsWith('e')) return `${c.slice(0, -1)}ième`;
  if (c.endsWith(' et un')) return `${c}ième`;
  return `${c}ième`;
}

const enLettresOuChiffres = (s: string): string => {
  const n = Number(s);
  return /^\d+$/.test(s) ? nombreEnLettres(n) ?? s : s;
};

/** Pluriel simple d'une unité après un nombre : « 1 euro », « 2 euros », « 1,5 euro ». */
const accorder = (nombre: string, singulier: string, pluriel: string): string => {
  const n = Number(nombre.replace(/\s/g, '').replace(',', '.'));
  return `${nombre} ${Number.isFinite(n) && Math.abs(n) < 2 ? singulier : pluriel}`;
};

const PAR_UNITE: Record<string, string> = {
  an: 'an', ans: 'an', 'année': 'année', mois: 'mois', jour: 'jour', jours: 'jour', j: 'jour',
  semaine: 'semaine', sem: 'semaine', heure: 'heure', h: 'heure', min: 'minute', minute: 'minute',
  'séance': 'séance', seance: 'séance', pers: 'personne', personne: 'personne', 'tête': 'tête',
  km: 'kilomètre', kg: 'kilo', mn: 'minute', s: 'seconde', sec: 'seconde',
};

const UNITES_APRES_NOMBRE: Array<[string, string, string]> = [
  ['kcal', 'kilocalorie', 'kilocalories'],
  ['km', 'kilomètre', 'kilomètres'],
  ['kg', 'kilo', 'kilos'],
  ['cm', 'centimètre', 'centimètres'],
  ['min', 'minute', 'minutes'],
  ['mn', 'minute', 'minutes'],
  ['sec', 'seconde', 'secondes'],
  ['j', 'jour', 'jours'],
];

/** Abréviations courantes — mot entier, sensibles à la casse quand elles le doivent. */
const ABREVIATIONS: Array<[RegExp, string]> = [
  [new RegExp(`(?<![${MOT}])etc\\.(?=\\s*$)`, 'giu'), 'et cetera.'],
  [new RegExp(`(?<![${MOT}])etc\\.?(?![${MOT}])`, 'giu'), 'et cetera'],
  [new RegExp(`(?<![${MOT}])env\\.(?=\\s)`, 'giu'), 'environ'],
  [new RegExp(`(?<![${MOT}])approx\\.(?=\\s)`, 'giu'), 'environ'],
  [new RegExp(`(?<![${MOT}])ex\\.(?=\\s)`, 'gu'), 'par exemple'],
  [new RegExp(`(?<![${MOT}])vs\\.?(?![${MOT}])`, 'giu'), 'contre'],
  [new RegExp(`(?<![${MOT}])rdv(?![${MOT}])`, 'giu'), 'rendez-vous'],
  [new RegExp(`(?<![${MOT}])svp(?![${MOT}])`, 'giu'), 's’il vous plaît'],
  [new RegExp(`(?<![${MOT}])Mme(?![${MOT}])`, 'gu'), 'Madame'],
  [new RegExp(`(?<![${MOT}])Dr\\.?(?=\\s+\\p{Lu})`, 'gu'), 'Docteur'],
  [new RegExp(`(?<![${MOT}])[nN]°\\s?(?=\\d)`, 'gu'), 'numéro '],
];

/**
 * Sigles qui se DISENT comme un mot, alors que les moteurs les épellent
 * lettre par lettre. Mot entier, capitales seulement (« nejm.org » n'est pas
 * touché). La forme dite n'est plus en capitales : jamais re-remplacée, la
 * fonction reste idempotente. Une prononciation enregistrée par le compte
 * reste prioritaire (`scriptParle` la protège avant cette étape).
 */
const SIGLES_PRONONCES: Array<[RegExp, string]> = [
  [new RegExp(`(?<![${MOT}])NEJM(?![${MOT}])`, 'gu'), 'Nèjm'],
];

/**
 * Le texte tel que le moteur vocal doit le LIRE. Pure, déterministe,
 * idempotente. Une entrée vide ou non textuelle rend `''`.
 */
export function normaliserPourTTS(texte: string): string {
  if (typeof texte !== 'string' || texte.length === 0) return typeof texte === 'string' ? texte : '';
  let t = texte;

  // ── 0. Caractères : espaces insécables, signe moins, emojis, puces ─────
  t = t.replace(/[\u00a0\u202f\u2007\u2009]/g, ' ');
  t = t.replace(/\u2212/g, '-');
  t = t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '');
  // Une puce en début de ligne est une pause, pas un mot.
  t = t.replace(/^[ \t]*[-•·*▪►]\s+/gm, '');

  // ── 1. Nombres : séparateur de milliers « 10.000 », décimale « 2.5 » ──
  t = t.replace(new RegExp(`(?<![${MOT}.,])\\d{1,3}(?:\\.\\d{3})+(?![\\d.,])`, 'gu'), (m) => m.replace(/\./g, ''));
  t = t.replace(/(\d)\.(\d)/g, '$1,$2');

  // ── 2. Rythmes « 24h/24 », « 7j/7 » ────────────────────────────────────
  t = t.replace(/(?<![\d])(\d+)\s?h\s?\/\s?(\d+)(?![\d])/g, '$1 heures sur $2');
  t = t.replace(/(?<![\d])(\d+)\s?j\s?\/\s?(\d+)(?![\d])/g, '$1 jours sur $2');

  // ── 3. « /an », « /mois », « km/h » → « par an »… ─────────────────────
  t = t.replace(
    new RegExp(`(?<=[${MOT}%€$])\\s*\\/\\s*(${Object.keys(PAR_UNITE).join('|')})(?![${MOT}])`, 'giu'),
    (_m, u: string) => ` par ${PAR_UNITE[u.toLowerCase()] ?? u}`,
  );
  // « et/ou » (les autres barres obliques, URL comprises, ne sont pas devinées).
  t = t.replace(new RegExp(`(?<![${MOT}])et\\s?\\/\\s?ou(?![${MOT}])`, 'giu'), 'et ou');

  // ── 4. « 3-en-1 » → « trois en un » ────────────────────────────────────
  t = t.replace(
    new RegExp(`(?<![${MOT}])(\\d+)\\s?-\\s?en\\s?-\\s?(\\d+)(?![${MOT}])`, 'giu'),
    (_m, a: string, b: string) => `${enLettresOuChiffres(a)} en ${enLettresOuChiffres(b)}`,
  );

  // ── 5. Opérations entre nombres : « 2+2 », « 2x3 », « 10-20 » ─────────
  t = t.replace(/(\d)\s?\+\s?(?=\d)/g, '$1 plus ');
  t = t.replace(/(\d)\s?[x×]\s?(?=\d)/g, '$1 fois ');
  // Intervalle « 10-20 », mais jamais une date « 2026-10-07 ».
  t = t.replace(/(?<!\d|\d[-–/.])(\d+)\s?[–-]\s?(\d+)(?![\d]|\s?[-–/.]\d)/g, '$1 à $2');

  // ── 6. Signe devant un nombre : « +2 », « -76 » ────────────────────────
  t = t.replace(new RegExp(`(?<![${MOT}])\\+(?=\\d)`, 'gu'), 'plus ');
  t = t.replace(new RegExp(`(?<![${MOT}])-(?=\\d)`, 'gu'), 'moins ');

  // ── 7. « 300+ » → « plus de 300 » ──────────────────────────────────────
  t = t.replace(new RegExp(`(?<![${MOT},])(${NOMBRE})\\+(?![${MOT}])`, 'gu'), 'plus de $1');
  // Un « + » isolé entre deux mots se lit « plus ».
  t = t.replace(/(?<=\S) \+ (?=\S)/g, ' plus ');

  // ── 8. Pourcentages ─────────────────────────────────────────────────────
  t = t.replace(/\s?%/g, ' pour cent');

  // ── 9. Multiplicateurs « x2 », « 2x » ──────────────────────────────────
  t = t.replace(new RegExp(`(?<![${MOT}])[x×]\\s?(?=\\d)`, 'gu'), 'fois ');
  t = t.replace(new RegExp(`(\\d)\\s?[x×](?![${MOT}])`, 'gu'), '$1 fois');

  // ── 10. Ordres de grandeur « 10k », « 1,5M », « 2 M€ » ─────────────────
  t = t.replace(new RegExp(`(\\d)\\s?[kK](?![${MOT}])`, 'gu'), '$1 mille');
  t = t.replace(new RegExp(`(\\d+(?:,\\d+)?)\\s?M(?=€)`, 'gu'), (_m, n: string) => `${accorder(n, 'million', 'millions')} d’`);
  t = t.replace(new RegExp(`(\\d+(?:,\\d+)?)\\s?M(?![${MOT}])`, 'gu'), (_m, n: string) => accorder(n, 'million', 'millions'));

  // ── 11. Monnaies ────────────────────────────────────────────────────────
  t = t.replace(/(millions?) d’\s?€/g, '$1 d’euros');
  const n = NOMBRE;
  const suisse = (x: string) => `${accorder(x, 'franc', 'francs')} suisses`.replace('franc suisses', 'franc suisse');
  t = t.replace(new RegExp(`(${n})\\s?€`, 'gu'), (_m, x: string) => accorder(x, 'euro', 'euros'));
  t = t.replace(new RegExp(`€\\s?(${n})`, 'gu'), (_m, x: string) => accorder(x, 'euro', 'euros'));
  t = t.replace(new RegExp(`(${n})\\s?\\$`, 'gu'), (_m, x: string) => accorder(x, 'dollar', 'dollars'));
  t = t.replace(new RegExp(`\\$\\s?(${n})`, 'gu'), (_m, x: string) => accorder(x, 'dollar', 'dollars'));
  t = t.replace(new RegExp(`(${n})\\s?CHF(?![${MOT}])`, 'gu'), (_m, x: string) => suisse(x));
  t = t.replace(new RegExp(`(?<![${MOT}])CHF\\s?(${n})`, 'gu'), (_m, x: string) => suisse(x));
  t = t.replace(/mille\s?€/g, 'mille euros');

  // ── 12. Heures « 10h », « 10h30 » ──────────────────────────────────────
  t = t.replace(new RegExp(`(?<![${MOT}])(\\d{1,2})\\s?h(\\d{2})?(?![${MOT}])`, 'gu'), (_m, h: string, mn?: string) => {
    const heures = accorder(h, 'heure', 'heures');
    return mn ? `${heures} ${mn}` : heures;
  });

  // ── 13. Unités après un nombre ─────────────────────────────────────────
  for (const [abr, sing, plur] of UNITES_APRES_NOMBRE) {
    t = t.replace(new RegExp(`(\\d+(?:,\\d+)?)\\s?${abr}(?![${MOT}'’])`, 'gu'), (_m, x: string) => accorder(x, sing, plur));
  }
  t = t.replace(/(\d)\s?°\s?C(?![\p{L}])/gu, '$1 degrés');
  t = t.replace(/(\d)\s?°/g, '$1 degrés');

  // ── 14. Ordinaux « 1er », « 2e », « 3ème » ─────────────────────────────
  t = t.replace(new RegExp(`(?<![${MOT}])(\\d+)(ers?|res?|ères?|èmes?|emes?|es?)(?![${MOT}])`, 'gu'), (m, n: string, suffixe: string) => {
    const feminin = /^(re|ère)/.test(suffixe);
    if (Number(n) !== 1 && /^(er|re|ère)/.test(suffixe)) return m;
    if (Number(n) === 1 && /^(e|ème|eme)s?$/.test(suffixe)) return m;
    const mot = ordinalEnLettres(Number(n), feminin);
    if (!mot) return m;
    return suffixe.endsWith('s') ? `${mot}s` : mot;
  });

  // ── 15. Abréviations et symboles ───────────────────────────────────────
  for (const [motif, remplacement] of ABREVIATIONS) t = t.replace(motif, remplacement);
  for (const [motif, dit] of SIGLES_PRONONCES) t = t.replace(motif, dit);
  t = t.replace(/\s?&\s?/g, ' et ');
  t = t.replace(/\s*(?:→|=>|->|➜|➔)\s*/g, ', ');
  t = t.replace(/\s*[•·▪|]\s*/g, ', ');
  t = t.replace(new RegExp(`#(?=\\p{L})`, 'gu'), '');

  // ── 16. Pauses : une fin de ligne sans ponctuation devient un point ────
  t = t.replace(/([^\s.!?…:;,])[ \t]*(?:\r?\n)+/g, '$1. ');
  t = t.replace(/\s*(?:\r?\n)+\s*/g, ' ');

  // ── 17. Espaces ────────────────────────────────────────────────────────
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/ +([,.])/g, '$1');
  t = t.replace(/,\s*,/g, ',');
  t = t.replace(/^[\s,]+/, '');
  return t.trim();
}
