/**
 * A_8d — LE TEXTE ÉCRIT N'EST PAS LE TEXTE PARLÉ.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LE PROBLÈME, TEL QU'IL A ÉTÉ ENTENDU
 * ═════════════════════════════════════════════════════════════════════════
 *
 * « Profite de -25 % à partir de 18h30, seulement 25 CHF » part tel quel au
 * moteur de synthèse. Celui-ci lit une chaîne conçue pour être LUE : le tiret
 * devient un silence, `%` un mot approximatif, `18h30` une bouillie, `CHF`
 * trois lettres épelées. La voix ressemble à la personne ; ce qu'elle dit ne
 * ressemble à rien.
 *
 * Le défaut n'est donc pas dans le clone. Il est dans ce qu'on lui donne.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEUX TEXTES, ET UN SEUL EST MODIFIÉ
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   DISPLAY  ce que la personne a écrit. Interface, édition, historique,
 *            sous-titres, publication. JAMAIS touché.
 *   SPOKEN   une vue de ce texte, fabriquée au moment de parler, jetée après.
 *
 * ⚠️ ET C'EST POUR CELA QUE RIEN N'EST PERSISTÉ ICI. Un texte parlé rangé en
 * base finirait par être réaffiché, corrigé, republié — et l'utilisateur
 * verrait « vingt-cinq pour cent » dans ses sous-titres.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ L'ORDRE DES RÈGLES EST LA MOITIÉ DU TRAVAIL
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 1. METTRE À L'ABRI ce qui ne doit surtout pas être lu comme des nombres :
 *    URL, adresses e-mail, numéros de téléphone. Sans cette étape, `17/06`
 *    dans une URL devient une date, et `+41 79 123 45 67` un entier de onze
 *    chiffres.
 * 2. Les formes COMPOSÉES, du plus spécifique au plus général : dates, heures,
 *    montants, pourcentages, ordinaux, multiplicateurs, numéros.
 * 3. Les nombres NUS, en dernier — sinon ils dévoreraient le « 25 » de
 *    « 25 CHF » avant que la devise ait été vue.
 *
 * Inverser deux de ces étapes ne produit pas une erreur : cela produit une
 * phrase presque juste, ce qui est bien pire à repérer.
 *
 * ⚠️ AUCUN MODÈLE DE LANGAGE. « 25 % » → « vingt-cinq pour cent » est une
 * règle, pas une opinion. Y consacrer un appel payant serait absurde, et
 * introduirait une variabilité là où l'on veut exactement l'inverse.
 */

export type LangueParlee = 'fr' | 'fr-FR' | 'fr-CH';

/** La langue par défaut du produit. */
export const LANGUE_PARLEE_DEFAUT: LangueParlee = 'fr-FR';

export function langueParleeValide(brut: unknown): LangueParlee {
  return brut === 'fr' || brut === 'fr-FR' || brut === 'fr-CH'
    ? brut : LANGUE_PARLEE_DEFAUT;
}

/* ═══════════════════════════════════════════════════════════════════════
   LES NOMBRES EN LETTRES
   ═══════════════════════════════════════════════════════════════════════ */

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];

/**
 * ⚠️ SEPTANTE / NONANTE : UN SEUL SYSTÈME, PILOTÉ PAR LA LANGUE.
 *
 * La Suisse romande dit « septante » et « nonante » ; la France dit
 * « soixante-dix » et « quatre-vingt-dix ». Les deux sont justes, chacune chez
 * elle. Ce qui serait faux, c'est de les mélanger dans une même phrase — d'où
 * un seul interrupteur, jamais deux tables concurrentes.
 *
 * ⚠️ ET « HUITANTE » N'EN EST PAS. Il n'est usuel qu'à Vaud, Fribourg et
 * Valais ; Genève et Neuchâtel disent « quatre-vingts ». Retenir la forme
 * majoritaire évite de faire dire à quelqu'un un mot qu'il n'emploie pas.
 */
function dizaines(n: number, suisse: boolean): string {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;

  if (suisse && d === 7) return u === 0 ? 'septante' : `septante-${UNITES[u]}`;
  if (suisse && d === 9) return u === 0 ? 'nonante' : `nonante-${UNITES[u]}`;

  const NOMS: Record<number, string> = {
    2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante', 8: 'quatre-vingt',
  };
  if (d === 7 || d === 9) {
    const base = d === 7 ? 'soixante' : 'quatre-vingt';
    if (n % 20 === 0 && d === 9) return 'quatre-vingt-dix';
    const reste = n - (d === 7 ? 60 : 80);
    /* ⚠️ « SOIXANTE ET ONZE », MAIS « QUATRE-VINGT-ONZE ». Le « et » du
       francais standard n'apparait qu'a 21, 31... 61 et 71 — jamais dans la
       serie des quatre-vingts. Le reste vaut 11 ici, pas 1 : la premiere
       redaction testait `reste === 1` et la regle ne s'appliquait jamais. */
    if (reste === 11 && d === 7) return 'soixante et onze';
    return `${base}-${UNITES[reste]}`;
  }
  const base = NOMS[d];
  if (u === 0) return d === 8 ? 'quatre-vingts' : base;
  if (u === 1 && d !== 8) return `${base} et un`;
  return `${base}-${UNITES[u]}`;
}

function centaines(n: number, suisse: boolean): string {
  if (n < 100) return dizaines(n, suisse);
  const c = Math.floor(n / 100);
  const reste = n % 100;
  const tete = c === 1 ? 'cent' : `${UNITES[c]} cent`;
  if (reste === 0) return c === 1 ? 'cent' : `${UNITES[c]} cents`;
  return `${tete} ${dizaines(reste, suisse)}`;
}

/** Un entier, en toutes lettres. Jusqu'au milliard — au-delà, on ne parle plus. */
export function entierEnLettres(n: number, langue: LangueParlee = LANGUE_PARLEE_DEFAUT): string {
  const suisse = langue === 'fr-CH';
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `moins ${entierEnLettres(-n, langue)}`;
  const e = Math.floor(n);
  if (e < 1000) return centaines(e, suisse);

  if (e < 1_000_000) {
    const milliers = Math.floor(e / 1000);
    const reste = e % 1000;
    const tete = milliers === 1 ? 'mille' : `${centaines(milliers, suisse)} mille`;
    return reste === 0 ? tete : `${tete} ${centaines(reste, suisse)}`;
  }
  if (e < 1_000_000_000) {
    const millions = Math.floor(e / 1_000_000);
    const reste = e % 1_000_000;
    const tete = millions === 1 ? 'un million' : `${entierEnLettres(millions, langue)} millions`;
    return reste === 0 ? tete : `${tete} ${entierEnLettres(reste, langue)}`;
  }
  const milliards = Math.floor(e / 1_000_000_000);
  const reste = e % 1_000_000_000;
  const tete = milliards === 1 ? 'un milliard' : `${entierEnLettres(milliards, langue)} milliards`;
  return reste === 0 ? tete : `${tete} ${entierEnLettres(reste, langue)}`;
}

/** Un décimal : la virgule se DIT, elle ne s'arrondit pas. */
function decimalEnLettres(entier: string, fraction: string, langue: LangueParlee): string {
  const e = entierEnLettres(Number(entier), langue);
  if (!fraction) return e;
  /* ⚠️ LA PARTIE DÉCIMALE SE LIT COMME UN NOMBRE, PAS CHIFFRE PAR CHIFFRE.
     « 1,5 » se dit « un virgule cinq », et « 0,75 » « zéro virgule
     soixante-quinze » — c'est l'usage courant, et il évite l'égrenage. */
  return `${e} virgule ${entierEnLettres(Number(fraction), langue)}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   LA MISE À L'ABRI
   ═══════════════════════════════════════════════════════════════════════ */

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/**
 * Ce qui ne doit JAMAIS traverser les règles numériques.
 *
 * ⚠️ CONSERVÉ TEL QUEL, ET C'EST LE CHOIX PRUDENT. Épeler une URL ou une
 * adresse e-mail produit une phrase illisible, et deviner comment les dire
 * (« point pro » ? « slash » ?) dépend d'un contexte qu'on n'a pas. Les
 * laisser intactes garde le texte compréhensible, et surtout ne le détruit
 * pas. Une politique de lecture dédiée pourra venir plus tard, mesurée.
 */
const ABRIS: readonly RegExp[] = [
  // Une adresse e-mail avant une URL : `@` la distingue sans ambiguïté.
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  /\bhttps?:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /#[\p{L}\p{N}_]+/gu,
  /@[\p{L}\p{N}_]+/gu,
];

/**
 * Un numéro de téléphone, dit par GROUPES DE CHIFFRES.
 *
 * ⚠️ SANS CETTE RÈGLE, `+41 79 123 45 67` DEVIENT UN ENTIER. La règle des
 * nombres nus le lirait « quarante et un », « soixante-dix-neuf »… ou pire,
 * après recollage, un nombre de onze chiffres. Personne ne reconnaît son
 * propre numéro dans ce qui en sort.
 *
 * Les groupes sont donc lus tels qu'ils sont écrits — c'est ainsi qu'on dicte
 * un numéro à voix haute.
 */
const TELEPHONE = /(?:\+\d{1,3}[\s.]?)?(?:\d{2,3}[\s.]){2,4}\d{2,3}\b/g;

function telephoneEnLettres(brut: string, langue: LangueParlee): string {
  return brut
    .trim()
    .replace(/^\+/, 'plus ')
    .split(/[\s.]+/)
    .map((g) => (/^\d+$/.test(g) ? entierEnLettres(Number(g), langue) : g))
    .join(' ');
}

/* ═══════════════════════════════════════════════════════════════════════
   LE NORMALISEUR
   ═══════════════════════════════════════════════════════════════════════ */

/** Une devise reconnue, et comment elle se dit au singulier et au pluriel. */
const DEVISES: Record<string, { un: string; plusieurs: string; centime: string }> = {
  CHF: { un: 'franc suisse', plusieurs: 'francs suisses', centime: 'centimes' },
  '€': { un: 'euro', plusieurs: 'euros', centime: 'centimes' },
  EUR: { un: 'euro', plusieurs: 'euros', centime: 'centimes' },
  $: { un: 'dollar', plusieurs: 'dollars', centime: 'cents' },
  USD: { un: 'dollar', plusieurs: 'dollars', centime: 'cents' },
};

function montantEnLettres(
  nombre: string, devise: string, langue: LangueParlee,
): string {
  const d = DEVISES[devise];
  const [entier, fraction] = nombre.replace(/\s/g, '').split(/[,.]/);
  const e = Number(entier);
  /* Le singulier suit l'ENTIER, pas la presence de centimes : « un franc suisse
     et cinquante centimes », jamais « un francs suisses ». Constate au banc. */
  const mot = e === 1 ? d.un : d.plusieurs;
  if (!fraction || Number(fraction) === 0) {
    return `${entierEnLettres(e, langue)} ${mot}`;
  }
  /* Les centimes se disent en toutes lettres : « et cinquante centimes »,
     jamais « virgule cinquante » — un montant n'est pas un décimal. */
  const cents = fraction.length === 1 ? Number(fraction) * 10 : Number(fraction.slice(0, 2));
  return `${entierEnLettres(e, langue)} ${mot} et ${entierEnLettres(cents, langue)} ${d.centime}`;
}

/** Une date écrite est-elle une VRAIE date ? Le 31 février ne l'est pas. */
export function dateReelle(j: number, m: number, a: number): boolean {
  if (m < 1 || m > 12 || j < 1 || a < 1) return false;
  const jours = [31, (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return j <= jours[m - 1];
}

/**
 * Le texte tel qu'il doit être PRONONCÉ.
 *
 * Fonction PURE : aucun accès disque, réseau, horloge ou aléa. C'est ce qui
 * permet de la tester exhaustivement, et c'est ce qui garantit qu'une même
 * phrase donnera toujours la même voix.
 */
export function normaliserTexteParle(
  texte: unknown, langue: LangueParlee = LANGUE_PARLEE_DEFAUT,
): string {
  if (typeof texte !== 'string' || texte.length === 0) return '';
  const l = langueParleeValide(langue);

  // ── 1. Mise a l'abri ────────────────────────────────────────────────
  const coffre: string[] = [];
  /* ⚠️ LE JETON NE CONTIENT AUCUN CHIFFRE, ET C'EST INDISPENSABLE. Un
     marqueur numerote « 0 », « 1 »... serait repris par la regle des nombres
     nus et ressortirait en « zero », « un » : le contenu mis a l'abri
     disparaitrait au moment meme ou on le protege. Le defaut a ete constate au
     banc — toutes les URL revenaient en « zero ». L'indice est donc ecrit en
     LETTRES, entre deux caracteres d'usage prive qu'aucune regle ne regarde. */
  const ALPHABET = 'abcdefghij';
  const ranger = (v: string): string => {
    coffre.push(v);
    const code = String(coffre.length - 1).split('').map((c) => ALPHABET[Number(c)]).join('');
    return `\u{E000}${code}\u{E001}`;
  };

  let t = texte;
  for (const motif of ABRIS) t = t.replace(motif, (m) => ranger(m));
  t = t.replace(TELEPHONE, (m) => ranger(telephoneEnLettres(m, l)));

  // ── 2. Les formes composees, du plus specifique au plus general ─────

  // Dates : 17/06/2026 · 17.06.2026 · 17-06-2026
  t = t.replace(
    /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g,
    (brut: string, jj: string, mm: string, aaaa: string) => {
      const j = Number(jj); const m = Number(mm); const a = Number(aaaa);
      /* ⚠️ UNE DATE IMPOSSIBLE N'EST PAS UNE DATE — ET ELLE EST MISE A
         L'ABRI. `31/02/2026` n'est pas lu « trente et un fevrier » : ce serait
         inventer un jour qui n'existe pas. Mais le laisser tel quel ne suffit
         pas — la regle des nombres nus le decouperait ensuite en « trente et
         un / deux / deux mille vingt-six ». Constate au banc. */
      if (!dateReelle(j, m, a)) return ranger(brut);
      const jour = j === 1 ? 'premier' : entierEnLettres(j, l);
      return `${jour} ${MOIS[m - 1]} ${entierEnLettres(a, l)}`;
    },
  );

  // Heures : 18h30 · 18 h 30 · 8h · 08h05
  t = t.replace(
    /\b(\d{1,2})\s*h\s*(\d{2})?\b/gi,
    (brut: string, hh: string, mm?: string) => {
      const h = Number(hh);
      if (h > 23) return brut;
      if (mm !== undefined && Number(mm) > 59) return brut;
      const heures = `${entierEnLettres(h, l)} ${h <= 1 ? 'heure' : 'heures'}`;
      if (mm === undefined || Number(mm) === 0) return heures;
      return `${heures} ${entierEnLettres(Number(mm), l)}`;
    },
  );

  /* Montants. ⚠️ PAS DE `\b` APRES LA DEVISE : `€` et `$` ne sont pas des
     caracteres de mot, et la frontiere echouait systematiquement — « 30 € »
     ressortait « trente € ». Constate au banc.
     ⚠️ ET L'ESPACE AVANT LE NOMBRE N'EST PLUS AVALEE quand il n'y a pas de
     signe : « coute 25 CHF » devenait « coutevingt-cinq francs suisses ». */
  const codes = Object.keys(DEVISES)
    .map((c) => c.replace(/[$]/g, '\\$'))
    .sort((a, b) => b.length - a.length)
    .join('|');
  t = t.replace(
    new RegExp(`([+-]\\s*)?(\\d[\\d\\u00A0\\u202F ]*(?:[,.]\\d{1,2})?)\\s*(${codes})`, 'g'),
    (_b: string, signe: string | undefined, n: string, dev: string) => {
      const prefixe = signe?.trim() === '-' ? 'moins ' : signe?.trim() === '+' ? 'plus ' : '';
      return `${prefixe}${montantEnLettres(n, dev, l)}`;
    },
  );
  t = t.replace(
    new RegExp(`(${codes})\\s*(\\d[\\d\\u00A0\\u202F ]*(?:[,.]\\d{1,2})?)`, 'g'),
    (_b: string, dev: string, n: string) => montantEnLettres(n, dev, l),
  );

  // Pourcentages : 25% · 25 % · +50% · -20% · 0,5 %
  t = t.replace(
    /([+-]\s*)?(\d[\d\u00A0\u202F ]*(?:[,.]\d+)?)\s*%/g,
    (_b: string, signe: string | undefined, n: string) => {
      const [e, f] = n.replace(/[\u00A0\u202F ]/g, '').split(/[,.]/);
      const nombre = decimalEnLettres(e, f ?? '', l);
      const prefixe = signe?.trim() === '-' ? 'moins ' : signe?.trim() === '+' ? 'plus ' : '';
      return `${prefixe}${nombre} pour cent`;
    },
  );

  // Numero : n°3 · nº3 · N° 3
  t = t.replace(/\bn[°º]\s*(\d+)/gi, (_b: string, n: string) => `numéro ${entierEnLettres(Number(n), l)}`);

  // Ordinaux : 1er · 1re · 2e · 3ème
  t = t.replace(/\b(\d+)\s*(ers?|res?|èmes?|emes?|es?)\b/g, (brut: string, n: string, suffixe: string) => {
    const v = Number(n);
    const su = suffixe.toLowerCase();
    if (su.startsWith('er')) return v === 1 ? 'premier' : brut;
    if (su.startsWith('re')) return v === 1 ? 'première' : brut;
    if (v === 1) return 'premier';
    const mot = entierEnLettres(v, l);
    // « deux » -> « deuxieme », « cinq » -> « cinquieme », « neuf » -> « neuvieme »
    const base = mot.endsWith('e') ? mot.slice(0, -1)
      : mot.endsWith('q') ? `${mot}u` : mot.endsWith('f') ? `${mot.slice(0, -1)}v` : mot;
    return `${base}ième`;
  });

  // Multiplicateurs : 3x · 10x
  t = t.replace(/\b(\d+)\s*x\b/gi, (_b: string, n: string) => `${entierEnLettres(Number(n), l)} fois`);

  /* ── 3. Les nombres nus, en DERNIER ──────────────────────────────────
     ⚠️ APRES TOUT LE RESTE. Places plus haut, ils auraient devore le « 25 »
     de « 25 CHF » avant que la devise ait ete reconnue.
     Les milliers groupes ne sont recolles que par paquets de TROIS : sans cette
     contrainte, « 25 CHF 30 » deviendrait un seul nombre. */
  t = t.replace(/([+-]\s*)?\b(\d{1,3}(?:[\u00A0\u202F ]\d{3})+|\d+)(?:[,.](\d+))?\b/g,
    (_brut: string, signe: string | undefined, entier: string, frac: string | undefined) => {
      const nu = entier.replace(/[\u00A0\u202F ]/g, '');
      const prefixe = signe?.trim() === '-' ? 'moins ' : signe?.trim() === '+' ? 'plus ' : '';
      return prefixe + decimalEnLettres(nu, frac ?? '', l);
    });

  // ── 4. Retour du coffre ─────────────────────────────────────────────
  t = t.replace(/\u{E000}([a-j]+)\u{E001}/gu, (_b: string, code: string) => {
    const i = Number(code.split('').map((c) => ALPHABET.indexOf(c)).join(''));
    return coffre[i] ?? '';
  });

  // Les espaces multiples nes des remplacements — jamais le style ni le sens.
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}
