/**
 * LOT 2B — ÉTAPE 4A : LES SIGNAUX SÉMANTIQUES PAR FENÊTRE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'audit de l'Étape 4 a établi qu'`ObjectifCommunication` ne pouvait PAS
 * changer la sélection : entre `m3c` et `m3g`, le sens disparaît. `Coupe`
 * portait encore `scoreMontage` et `raison` ; `ClipMaterialise` ne garde que
 * `rang`, des bornes, une clé et des octets. Le moteur de plan reçoit donc
 * des fichiers, pas des moments.
 *
 * Et ce qui décrit un moment aujourd'hui — `qualite.energie`,
 * `qualite.interetVisuel` — est écrit PAR RUSH. Un plan ne porte qu'un seul
 * rush : ces notes y sont constantes, elles ne séparent aucun instant d'un
 * autre. Elles ne peuvent pas servir à choisir.
 *
 * Ce module crée la couche qui manquait : des faits OBSERVÉS SUR UNE FENÊTRE,
 * transportés intacts jusqu'au moteur de plan.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QU'IL NE FAIT PAS, ET N'A PAS LE DROIT DE FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IL NE CHOISIT RIEN. `m3g` reste `m3g-v2`, `m3e` reste `m3e-v3`. Ces signaux
 * traversent le pipeline sans qu'une seule décision de montage les lise. Le
 * premier scoring qui les utilisera sera `m3g-v3`, dans un autre commit.
 *
 * IL NE TOUCHE PAS À `scoreMontage`. Celui-ci continue de noter l'intérêt
 * VISUEL d'un moment comme matière de montage, et rien d'autre. Aucun signal
 * de ce module n'entre dans son calcul, et l'invite le dit au modèle en
 * toutes lettres.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUI N'EST PAS ICI, ET POURQUOI — LA LISTE IMPORTANTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le modèle voit UNE image fixe par instant. `positionsVignettes` en produit
 * au plus huit, réparties sur toute la durée : environ 7,5 s d'écart sur un
 * rush d'une minute, 15 s sur deux minutes. Une fenêtre candidate dure 3 à
 * 12 s. L'image suivante est donc, le plus souvent, HORS de la fenêtre.
 *
 * D'où l'absence, assumée et non négociable à cette étape :
 *
 *   • `mouvement`, `energie`  — une image fixe ne montre aucun déplacement.
 *   • `reaction`              — une réaction est un changement entre deux
 *                               instants ; il n'y en a qu'un.
 *   • `avantApres`            — deux moments, comparés. Un seul est vu.
 *   • `preuve`                — ce n'est pas une observation, c'est un
 *                               jugement marketing. Le demander à un modèle
 *                               qui regarde une photo, c'est fabriquer une
 *                               donnée qui aurait l'air d'un fait.
 *
 * Les faire produire quand même donnerait des valeurs plausibles et fausses,
 * que rien en aval ne pourrait distinguer des vraies. Les débloquer demande
 * PLUSIEURS IMAGES PAR FENÊTRE — donc une extraction différente, un coût
 * différent, et une décision séparée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PAS DE SCORE DE CONFIANCE FABRIQUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun champ `confiance`. Un modèle qui note lui-même sa propre certitude
 * produit un nombre invérifiable : `0,62` n'a jamais été comparé à quoi que
 * ce soit. L'incertitude s'exprime ici par une VALEUR — `indetermine` pour
 * les catégories, `null` pour le reste — qui, elle, se vérifie et se compte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MODULE PUR — AUCUN IMPORT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Comme `objectif-communication.ts` et `profil-creatif.ts` : lisible par
 * l'écran autant que par le moteur, et incapable de tirer `child_process` ou
 * `minio` dans le paquet navigateur.
 */

// ───────────────────────────────────────────────────────────────────────────
// La version
// ───────────────────────────────────────────────────────────────────────────

/**
 * Elle est PORTÉE PAR LA DONNÉE, pas déduite de sa forme.
 *
 * Le jour où `signaux-v2` ajoutera `mouvement`, une fenêtre `signaux-v1` devra
 * rester lisible et reconnaissable comme n'ayant jamais été interrogée
 * là-dessus — ce qui n'est pas la même chose que « mouvement inconnu ».
 */
export const VERSION_SIGNAUX = 'signaux-v1' as const;
export type VersionSignaux = typeof VERSION_SIGNAUX;

// ───────────────────────────────────────────────────────────────────────────
// Le vocabulaire — fermé, et « indetermine » en fait partie
// ───────────────────────────────────────────────────────────────────────────

/**
 * COMBIEN de personnes sont visibles. Un COMPTE, jamais une identité.
 *
 * Ce champ porte à lui seul deux besoins de l'Étape 4B : `groupe` / `foule`
 * pour un objectif événementiel, `une` pour un témoignage. Les séparer en
 * deux booléens aurait autorisé l'état absurde « seul ET foule ».
 *
 * ⚠️ AUCUNE PERSONNE N'EST IDENTIFIÉE, ni nommée, ni classée par âge, origine,
 * genre, état de santé ou statut. L'invite l'interdit déjà (règle 8) et ce
 * vocabulaire ne porte aucune case où l'écrire.
 */
export const PRESENCES_PERSONNES = [
  'aucune', 'une', 'deux', 'groupe', 'foule', 'indetermine',
] as const;
export type PresencePersonnes = (typeof PRESENCES_PERSONNES)[number];

/**
 * L'ÉCHELLE DE PLAN — un fait de cadrage, lisible sur une image fixe.
 *
 * C'est le signal le plus fiable de tous : il ne demande ni interprétation,
 * ni mémoire, ni son. Un gros plan sur un visage et un plan large de salle
 * ne servent pas le même objectif, et cela se voit sans rien deviner.
 */
export const ECHELLES_PLAN = [
  'gros_plan', 'plan_moyen', 'plan_large', 'indetermine',
] as const;
export type EchellePlan = (typeof ECHELLES_PLAN)[number];

/**
 * L'EXPRESSION VISIBLE — trois valeurs, et une sortie.
 *
 * Volontairement pauvre. « Émotion » au sens large demanderait de lire un
 * état intérieur sur une photo ; ce qu'on peut constater, c'est une bouche
 * qui sourit ou un regard qui fixe. `indetermine` est la réponse attendue
 * dès qu'aucun visage n'est lisible — c'est-à-dire souvent.
 */
export const EXPRESSIONS_VISIBLES = [
  'souriante', 'neutre', 'concentree', 'indetermine',
] as const;
export type ExpressionVisible = (typeof EXPRESSIONS_VISIBLES)[number];

/**
 * PRESENT / ABSENT / ON NE SAIT PAS — pour ce qui se constate d'un coup d'oeil.
 *
 * ⚠️ TROIS VALEURS, ET NON UN BOOLEEN. Un booleen force a choisir entre deux
 * mensonges quand l'image ne tranche pas : `false` affirme l'absence d'un
 * logo qu'on n'a peut-etre pas su lire. `indetermine` est la troisieme
 * reponse, et c'est souvent la vraie.
 *
 * Le meme vocabulaire pour les quatre champs qui s'en servent : un seul
 * `enum` a verifier, une seule chose a apprendre, et le schema du fournisseur
 * ne melange pas des booleens nullables avec des categories.
 */
export const PRESENCES_OBSERVEES = ['oui', 'non', 'indetermine'] as const;
export type PresenceObservee = (typeof PRESENCES_OBSERVEES)[number];

/**
 * L'ÉTAT DE LA PAROLE SUR LA FENÊTRE.
 *
 * ⚠️ `inconnue` N'EST PAS `absente`, ET LES CONFONDRE SERAIT UN BUG SILENCIEUX.
 *
 * La transcription est OPTIONNELLE : elle peut n'avoir jamais été demandée,
 * avoir échoué, ou n'avoir rendu aucun horodatage. Dans ces cas on ne sait
 * pas s'il y a de la parole — écrire `absente` affirmerait un silence que
 * personne n'a constaté, et un futur objectif « témoignage » écarterait
 * exactement les fenêtres qu'il cherchait.
 */
export const ETATS_PAROLE_FENETRE = ['presente', 'absente', 'inconnue'] as const;
export type EtatParoleFenetre = (typeof ETATS_PAROLE_FENETRE)[number];

/** Trois décimales, comme partout ailleurs dans ce pipeline. */
export const DECIMALES_SIGNAUX = 3;

// ───────────────────────────────────────────────────────────────────────────
// La forme
// ───────────────────────────────────────────────────────────────────────────

/**
 * CE QUE LE MODÈLE A VU SUR L'IMAGE DE LA FENÊTRE.
 *
 * `source` est structurel et non décoratif : il rend la provenance lisible
 * sans avoir à savoir quel champ vient d'où. Un futur `signaux-v2` qui
 * dériverait `marqueVisible` d'une détection locale changerait cette valeur,
 * et l'aval saurait que la fiabilité n'est plus la même.
 */
export interface SignauxVision {
  source: 'vision';
  /** Combien de personnes. `indetermine` si l'image ne permet pas de dire. */
  personnes: PresencePersonnes;
  /** L'échelle de cadrage. */
  echellePlan: EchellePlan;
  /** L'expression visible, si un visage est lisible. */
  expression: ExpressionVisible;
  /** Un objet délibérément présenté, tenu ou centré. */
  objetMisEnAvant: PresenceObservee;
  /**
   * Des mains en train d'agir sur quelque chose.
   *
   * C'est la PRIMITIVE OBSERVABLE sous le mot « démonstration ». Une
   * démonstration est un processus, qui se déroule ; une image fixe ne peut
   * pas le montrer. Des mains sur un objet, si.
   */
  mainsEnAction: PresenceObservee;
  /** Un logo ou un nom de marque lisible dans l'image. */
  marqueVisible: PresenceObservee;
  /** Du texte incrusté ou filmé, lisible. */
  texteALEcran: PresenceObservee;
  /**
   * La netteté de CETTE image, 0–1.
   *
   * Distincte de `qualite.nettete`, qui juge le rush entier. Un rush net peut
   * porter une fenêtre floue, et c'est précisément ce qu'on veut pouvoir voir.
   */
  nettete: number | null;
}

/**
 * CE QUE LA TRANSCRIPTION DIT DE LA FENÊTRE — calculé, jamais demandé.
 *
 * ⚠️ AUCUN MODÈLE N'EST INTERROGÉ ICI. Ces deux valeurs sont une intersection
 * d'intervalles : déterministe, reproductible, vérifiable sans réseau. Le
 * pipeline n'a jamais entendu le rush, et ce n'est pas ce module qui va le
 * prétendre — il lit des horodatages déjà écrits par `m3d2`.
 */
export interface SignauxParole {
  source: 'transcription';
  etat: EtatParoleFenetre;
  /**
   * La part de la fenêtre couverte par de la parole, 0–1.
   *
   * `null` quand `etat` vaut `inconnue` : sans horodatage, il n'y a pas de
   * fraction à calculer, et `0` serait un mensonge.
   */
  densite: number | null;
}

/**
 * LES SIGNAUX D'UNE FENÊTRE, ASSEMBLÉS.
 *
 * Les deux blocs sont produits par des étapes différentes — `vision` par
 * `m3c`, qui voit les images ; `parole` par `m3e`, qui reçoit la
 * transcription. `vision` peut donc être `null` sur un serveur où le
 * fournisseur de candidats est éteint, sans que `parole` le soit.
 */
export interface SignauxFenetre {
  version: VersionSignaux;
  vision: SignauxVision | null;
  parole: SignauxParole;
}

/**
 * La parole d'une fenêtre dont personne ne sait rien.
 *
 * C'est la valeur d'un pipeline sans transcription, et c'est aussi celle des
 * fenêtres écrites AVANT cette étape : elles n'ont jamais été mesurées, et
 * `inconnue` est la seule chose vraie qu'on puisse en dire.
 */
export const PAROLE_INCONNUE: SignauxParole = Object.freeze({
  source: 'transcription',
  etat: 'inconnue',
  densite: null,
});

/** Les signaux d'une fenêtre dont rien n'a été observé. */
export const SIGNAUX_ABSENTS: SignauxFenetre = Object.freeze({
  version: VERSION_SIGNAUX,
  vision: null,
  parole: PAROLE_INCONNUE,
});

// ───────────────────────────────────────────────────────────────────────────
// La lecture — ce qui est refusé, et ce qui devient « inconnu »
// ───────────────────────────────────────────────────────────────────────────

/**
 * LA RÈGLE, ET ELLE TIENT EN DEUX LIGNES.
 *
 *   • UNE FAUTE DE FORME EST REFUSÉE. Pas un objet, une clé que ce contrat
 *     ne connaît pas : le fournisseur répond hors contrat, et on ne trie pas
 *     dans ce qu'il raconte. C'est le geste de `lireReponseCandidats`, et il
 *     ne change pas.
 *
 *   • UNE VALEUR ILLISIBLE DEVIENT « INCONNU ». `personnes: "beaucoup"` n'est
 *     pas une faute de forme : c'est une réponse à laquelle notre vocabulaire
 *     n'a pas de case. `indetermine` dit exactement cela, et c'est VRAI.
 *
 * ⚠️ CE N'EST PAS UN BORNAGE MUET, et la nuance est tout le raisonnement.
 * Ramener `nettete: 5` à `1` affirmerait une image parfaitement nette que
 * personne n'a constatée. `null` dit « on ne sait pas », ce qui est le seul
 * énoncé exact — et une valeur qu'un test peut exiger.
 *
 * Refuser la génération entière pour un enum fantaisiste serait par ailleurs
 * une régression pure : le pipeline échouerait là où il réussissait hier,
 * pour un champ que personne ne lit encore.
 */
export type MotifSignaux = 'forme_invalide' | 'champ_inconnu';

export type LectureSignauxVision =
  | { ok: true; valeur: SignauxVision }
  | { ok: false; motif: MotifSignaux; champ: string };

/** Les clés que ce contrat connaît. Toute autre est `champ_inconnu`. */
const CLES_VISION = [
  'personnes', 'echellePlan', 'expression', 'objetMisEnAvant',
  'mainsEnAction', 'marqueVisible', 'texteALEcran', 'nettete',
] as const;

function categorie<T extends string>(
  v: unknown, vocabulaire: readonly T[], inconnu: T,
): T {
  return typeof v === 'string' && (vocabulaire as readonly string[]).includes(v)
    ? (v as T)
    : inconnu;
}

/** Trois décimales. `-0` ramené à `0`, comme dans `clip-contrat`. */
export function arrondirSignal(n: number): number {
  const f = 10 ** DECIMALES_SIGNAUX;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Une fraction 0–1, ou `null`. Hors bornes vaut inconnu, jamais ramené. */
function fractionOuInconnue(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0 || v > 1) return null;
  return arrondirSignal(v);
}

/**
 * Lit le bloc `vision` tel qu'un fournisseur l'a rendu.
 *
 * Les motifs portent la MÊME ORTHOGRAPHE que ceux de `candidat-contrat` :
 * l'appelant les repasse tels quels, sans table de traduction — une table de
 * traduction est un endroit de plus où un motif se perd.
 */
export function lireSignauxVision(brut: unknown): LectureSignauxVision {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
    return { ok: false, motif: 'forme_invalide', champ: 'signaux' };
  }
  const o = brut as Record<string, unknown>;

  const inconnue = Object.keys(o).find(
    (k) => !(CLES_VISION as readonly string[]).includes(k),
  );
  if (inconnue !== undefined) {
    return { ok: false, motif: 'champ_inconnu', champ: `signaux.${inconnue}` };
  }

  return {
    ok: true,
    valeur: {
      source: 'vision',
      personnes: categorie(o.personnes, PRESENCES_PERSONNES, 'indetermine'),
      echellePlan: categorie(o.echellePlan, ECHELLES_PLAN, 'indetermine'),
      expression: categorie(o.expression, EXPRESSIONS_VISIBLES, 'indetermine'),
      objetMisEnAvant: categorie(o.objetMisEnAvant, PRESENCES_OBSERVEES, 'indetermine'),
      mainsEnAction: categorie(o.mainsEnAction, PRESENCES_OBSERVEES, 'indetermine'),
      marqueVisible: categorie(o.marqueVisible, PRESENCES_OBSERVEES, 'indetermine'),
      texteALEcran: categorie(o.texteALEcran, PRESENCES_OBSERVEES, 'indetermine'),
      nettete: fractionOuInconnue(o.nettete),
    },
  };
}

/**
 * Relit le SEUL bloc `vision` venu de la BASE.
 *
 * ⚠️ NE REFUSE JAMAIS. Une generation ecrite avant l'etape 4A ne porte pas ce
 * champ, et une generation ecrite par une version future en portera d'autres.
 * Dans les deux cas la reponse honnete est « rien d'observe », et non une
 * lecture en echec qui rendrait le passe de ce pipeline illisible.
 */
export function visionDepuisLigne(brut: unknown): SignauxVision | null {
  if (brut === undefined || brut === null) return null;
  const lu = lireSignauxVision(brut);
  return lu.ok ? lu.valeur : null;
}

/**
 * Relit des signaux venus de la BASE, jamais d'un fournisseur.
 *
 * ⚠️ NE REFUSE JAMAIS, et c'est voulu : une ligne écrite avant cette étape ne
 * porte pas de signaux, et une ligne écrite par une version future en
 * portera d'autres. Faire échouer la lecture d'un plan de montage de la
 * semaine dernière parce qu'il ignore un champ d'aujourd'hui rendrait ce
 * pipeline incapable de relire son propre passé.
 *
 * Une version inconnue est traitée comme une absence : on ne devine pas ce
 * qu'un `signaux-v2` voulait dire.
 */
export function signauxDepuisLigne(brut: unknown): SignauxFenetre | null {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const o = brut as Record<string, unknown>;
  if (o.version !== VERSION_SIGNAUX) return null;

  const lu = lireSignauxVision(o.vision);
  const vision = lu.ok ? lu.valeur : null;

  const p = typeof o.parole === 'object' && o.parole !== null && !Array.isArray(o.parole)
    ? o.parole as Record<string, unknown>
    : null;

  return { version: VERSION_SIGNAUX, vision, parole: paroleRelue(p) };
}

/**
 * L'INVARIANT DE LA PAROLE, TENU EN UN SEUL ENDROIT :
 *
 *   `etat === 'inconnue'`  ⟺  `densite === null`
 *   `etat === 'presente'`  ⟺  `densite > 0`
 *
 * Une ligne qui annoncerait `presente` sans densité lisible ne dit rien
 * d'exploitable : elle redevient `inconnue`. Laisser passer un `presente` à
 * densité `0` aurait fabriqué une fenêtre parlante que rien n'a mesurée —
 * exactement le genre de valeur qu'un futur scoring croirait sur parole.
 */
function paroleRelue(p: Record<string, unknown> | null): SignauxParole {
  const etat = categorie(p?.etat, ETATS_PAROLE_FENETRE, 'inconnue');
  if (etat === 'inconnue') return { ...PAROLE_INCONNUE };
  const densite = fractionOuInconnue(p?.densite);
  if (densite === null) return { ...PAROLE_INCONNUE };
  return { source: 'transcription', etat: densite > 0 ? 'presente' : 'absente', densite };
}

// ───────────────────────────────────────────────────────────────────────────
// La dérivation — parole d'une fenêtre, à partir d'intervalles horodatés
// ───────────────────────────────────────────────────────────────────────────

/** Le minimum qu'un intervalle doit avoir pour compter. */
export interface IntervalleParole {
  debutSecondes: number;
  finSecondes: number;
}

/**
 * La part d'une fenêtre couverte par de la parole.
 *
 * ⚠️ LES INTERVALLES SONT FUSIONNÉS AVANT D'ÊTRE SOMMÉS. Les segments d'une
 * transcription se recouvrent — un mot appartient à un segment, et les deux
 * peuvent être fournis. Additionner les durées sans fusionner donnerait des
 * densités supérieures à 1 sur des fenêtres parfaitement ordinaires, et
 * `fractionOuInconnue` les transformerait alors toutes en `null` : on aurait
 * perdu le signal en croyant le mesurer.
 *
 * Pur, déterministe, sans horloge : deux appels sur les mêmes bornes rendent
 * le même nombre.
 */
export function densiteParole(
  debutSecondes: number, finSecondes: number,
  intervalles: readonly IntervalleParole[],
): number | null {
  const duree = finSecondes - debutSecondes;
  if (!Number.isFinite(duree) || duree <= 0) return null;

  const chevauchants = intervalles
    .filter((i) => (
      Number.isFinite(i.debutSecondes) && Number.isFinite(i.finSecondes)
      && i.finSecondes > i.debutSecondes
      && i.finSecondes > debutSecondes && i.debutSecondes < finSecondes
    ))
    .map((i) => ({
      debut: Math.max(i.debutSecondes, debutSecondes),
      fin: Math.min(i.finSecondes, finSecondes),
    }))
    .sort((a, b) => a.debut - b.debut);

  let couvert = 0;
  let finCourante = -Infinity;
  for (const c of chevauchants) {
    const debut = Math.max(c.debut, finCourante);
    if (c.fin > debut) {
      couvert += c.fin - debut;
      finCourante = c.fin;
    }
  }

  return arrondirSignal(Math.min(1, couvert / duree));
}

/**
 * Assemble le bloc `parole` d'une fenêtre.
 *
 * `exploitable` dit si la transcription a réellement fourni des horodatages
 * utilisables — c'est l'appelant qui le sait, parce que c'est lui qui a lu
 * l'état de la transcription. Sans cela, `inconnue` : la seule réponse vraie.
 */
export function paroleDeFenetre(
  debutSecondes: number, finSecondes: number,
  intervalles: readonly IntervalleParole[],
  exploitable: boolean,
): SignauxParole {
  if (!exploitable) return { ...PAROLE_INCONNUE };
  const densite = densiteParole(debutSecondes, finSecondes, intervalles);
  if (densite === null) return { ...PAROLE_INCONNUE };
  return {
    source: 'transcription',
    etat: densite > 0 ? 'presente' : 'absente',
    densite,
  };
}

/** Assemble une fenêtre complète à partir de ses deux blocs. */
export function assemblerSignaux(
  vision: SignauxVision | null, parole: SignauxParole,
): SignauxFenetre {
  return { version: VERSION_SIGNAUX, vision, parole };
}
