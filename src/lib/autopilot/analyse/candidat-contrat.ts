/**
 * M3-C — LE CONTRAT DES CANDIDATS DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE EST PUR, ET DOIT LE RESTER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il n'importe que `./contrat`. Il ne doit JAMAIS importer `candidat.ts` ni
 * `extraction.ts` : l'ecran d'analyse est un composant client, et la moindre
 * arete vers eux tirerait `child_process` et `minio` dans le paquet
 * navigateur. C'est exactement la faute que `visuel-contrat.ts` a ete cree
 * pour eviter en M3-B4, et la raison tient toujours.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PARTAGE DES ROLES, QUI EST TOUTE LA SECURITE DE CE LOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un modele qui n'a vu que huit images fixes ne SAIT PAS ce qui se passe a
 * la seconde 4,25. S'il pouvait ecrire un timecode libre, il en inventerait
 * un — non par malice, mais parce qu'on le lui aurait demande.
 *
 * D'ou la coupure, stricte :
 *
 *   CE QUE LE FOURNISSEUR CHOISIT      CE QUE STUDIIO CALCULE
 *   ─────────────────────────────      ──────────────────────
 *   secondeReference (enum ferme)      rang
 *   dureeCibleSecondes (enum ferme)    debutSecondes
 *   scoreMontage                       finSecondes
 *   raison
 *
 * `secondeReference` est enferme dans les positions des vignettes REELLEMENT
 * envoyees. Le modele ne peut donc designer qu'un instant qu'on lui a montre.
 * Le schema du fournisseur le contraint a la generation ; ce module le
 * refuse a la lecture. Les deux, parce qu'un schema est une promesse du
 * fournisseur et qu'une promesse ne se verifie pas toute seule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE `scoreMontage` NE DIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il note l'interet VISUEL d'un moment comme matiere de montage. Il ne mesure
 * ni le son, ni la parole, ni un potentiel viral, ni une performance
 * marketing, ni une retention. M3-B5 n'existe pas : rien dans ce pipeline
 * n'a jamais entendu ce rush.
 */
import { MOTIF_ECHEC_MAX } from './contrat';
// ⚠️ MODULE PUR LUI AUSSI : aucun `child_process`, aucun `minio`. L'ecran
// d'analyse importe ce contrat, et l'arete doit rester inoffensive.
import { visionDepuisLigne, type SignauxVision } from './signaux-contrat';

export { MOTIF_ECHEC_MAX };
export type { SignauxVision };

// ───────────────────────────────────────────────────────────────────────────
// Les bornes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les durees proposables, et rien d'autre.
 *
 * Une duree libre laisserait le modele ecrire `7.31`, une valeur qu'aucun
 * monteur ne demanderait et que personne n'aurait choisie. Quatre longueurs
 * couvrent les usages : un plan de coupe, un moment, une phrase visuelle,
 * une sequence.
 */
export const DUREES_CANDIDAT_SECONDES = [3, 5, 8, 12] as const;
export type DureeCandidat = (typeof DUREES_CANDIDAT_SECONDES)[number];

/** Au-dela, ce n'est plus une selection, c'est le rush entier. */
export const CANDIDATS_MAX = 6;

/**
 * Une reponse reussie en contient au moins un.
 *
 * ⚠️ ET PAS SIX. Forcer six candidats sur un rush qui n'a que deux moments
 * utiles obligerait le modele a en inventer quatre — c'est-a-dire a noter
 * haut ce qu'il juge bas. Le minimum garantit qu'une reussite dit quelque
 * chose ; il ne garantit pas une quantite.
 */
export const CANDIDATS_MIN = 1;

/** Une raison est une phrase, pas un paragraphe. */
export const RAISON_MAX = 240;

/** La borne du score, aux deux bouts, et en entier. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/**
 * La reponse du fournisseur, en octets.
 *
 * Six candidats de quatre champs courts tiennent tres au large dans seize
 * kilo-octets. Cette borne est lue AVANT toute analyse : elle protege le
 * serveur d'une reponse absurde sans jamais lui faire confiance.
 */
export const REPONSE_CANDIDATS_MAX_OCTETS = 16 * 1024;

/**
 * L'ecart tolere entre la seconde annoncee et une position de vignette.
 *
 * Les positions sont des nombres a trois decimales qui ont voyage en JSON.
 * Exiger l'egalite binaire ferait echouer une reponse juste sur un
 * arrondi ; tolerer davantage laisserait passer un instant voisin, donc
 * invente. Un millieme est le pas de nos propres valeurs.
 */
export const TOLERANCE_REFERENCE = 0.001;

/** Trois decimales : le pas de `duree_secondes` en base, numeric(10,3). */
export const DECIMALES = 3;

// ───────────────────────────────────────────────────────────────────────────
// Les formes
// ───────────────────────────────────────────────────────────────────────────

/** Ce que le fournisseur a le droit de proposer. */
export interface PropositionCandidateVisuelle {
  secondeReference: number;
  dureeCibleSecondes: number;
  scoreMontage: number;
  raison: string;
  /**
   * LES SIGNAUX SEMANTIQUES DE LA FENETRE — Lot 2B, etapes 4A / 4A.1.
   *
   * ⚠️ TOUJOURS `null` A LA SORTIE DE `lireReponseCandidats`. Ce champ n'est
   * PAS rempli par le fournisseur qui choisit les moments : il l'est apres
   * coup, par l'etape d'enrichissement (`candidat-signaux.ts`), sur des
   * candidats deja figes.
   *
   * C'est toute la raison d'etre de l'etape 4A.1 : demander davantage au
   * modele qui SELECTIONNE pouvait deplacer sa selection. Le chemin
   * historique doit rester historique tant qu'aucun objectif ne l'influence.
   */
  signaux: SignauxVision | null;
}

/** Ce que Studiio persiste, une fois les bornes calculees ICI. */
export interface CandidatMontage {
  rang: number;
  secondeReference: number;
  dureeCibleSecondes: number;
  debutSecondes: number;
  finSecondes: number;
  scoreMontage: number;
  raison: string;
  /**
   * ⚠️ OPTIONNEL A LA RELECTURE. Toutes les generations ecrites avant l'etape
   * 4A valent `null` ici : les relire doit continuer de fonctionner, sans
   * quoi ce pipeline deviendrait incapable de lire son propre passe.
   *
   * ⚠️ AUCUNE DECISION NE LES LIT ENCORE — ni le classement ci-dessous, ni
   * `m3e`, ni `m3g`. Ils traversent, ils ne choisissent pas.
   */
  signaux: SignauxVision | null;
}

/**
 * Les motifs FINS d'un refus de lecture — journalisables, jamais persistes.
 *
 * Comme en M3-B4.2 : la base ne verra que `resultat_candidats_invalide`, et
 * le journal serveur dira lequel des sept, sur quel champ.
 */
export const MOTIFS_CANDIDATS = [
  'reponse_illisible',    // pas du JSON, ou plus longue que la borne d'octets
  'forme_invalide',       // JSON correct, forme fausse : type, absence, vide
  'champ_inconnu',        // une cle que ce contrat ne connait pas
  'borne_depassee',       // trop de candidats, raison trop longue
  'valeur_hors_plage',    // score hors 0-100, non entier
  'duree_inconnue',       // une duree hors du jeu propose
  'reference_inventee',   // un instant qu'aucune vignette ne portait
  'reference_dupliquee',  // deux candidats sur le meme instant
] as const;
export type MotifCandidats = (typeof MOTIFS_CANDIDATS)[number];

export function motifCandidatsValide(valeur: unknown): valeur is MotifCandidats {
  return typeof valeur === 'string'
    && (MOTIFS_CANDIDATS as readonly string[]).includes(valeur);
}

/**
 * Les motifs d'ETAPE — ceux-la VONT en base, dans `motif_echec`.
 *
 * Un motif hors liste afficherait le message generique et proposerait de
 * relancer un echec definitif : meme raisonnement qu'en M3-B4.
 */
export const MOTIFS_CANDIDATS_ETAPE = [
  'aucune_image',                // rien de lisible — le fournisseur n'est pas appele
  'analyse_inexploitable',       // l'analyse source ne porte pas de quoi travailler
  'fournisseur_absent',          // aucun adaptateur branche sur ce serveur
  'fournisseur_en_erreur',       // il a leve, ou le delai a ete depasse
  'resultat_candidats_invalide', // il a repondu, mais hors du contrat
  'generation_interrompue',      // le processus est mort, la ligne est restee active
] as const;

/**
 * Au-dela, une generation active est un RESTE, pas un travail en cours.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D'OU VIENT CE CHIFFRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route s'arrete a 120 secondes, et l'appel au fournisseur a 40. Une
 * generation qui vit encore au bout de CINQ minutes n'attend donc plus rien :
 * son processus est mort — redeploiement, kill, panne — et sa ligne bloque
 * l'index unique partiel pour toujours.
 *
 * ⚠️ LARGE, ET DELIBEREMENT. Le risque n'est pas symetrique : fermer trop
 * tot une generation qui travaille encore ferait payer un second appel au
 * fournisseur pendant que le premier tourne. Attendre deux minutes de trop
 * ne coute rien a personne. C'est le meme raisonnement que
 * `PEREMPTION_ANALYSE_MS`, avec un budget quatre fois plus court.
 */
export const PEREMPTION_GENERATION_CANDIDATS_MS = 5 * 60 * 1000;

/** Le seuil, en ISO, tel que la requete le compare. */
export function seuilPeremptionGeneration(maintenant: number = Date.now()): string {
  return new Date(maintenant - PEREMPTION_GENERATION_CANDIDATS_MS).toISOString();
}
export type MotifCandidatsEtape = (typeof MOTIFS_CANDIDATS_ETAPE)[number];

export function motifCandidatsEtapeValide(valeur: unknown): valeur is MotifCandidatsEtape {
  return typeof valeur === 'string'
    && (MOTIFS_CANDIDATS_ETAPE as readonly string[]).includes(valeur);
}

// ───────────────────────────────────────────────────────────────────────────
// Le calcul des bornes — 100 % local, et deterministe
// ───────────────────────────────────────────────────────────────────────────

/** Arrondi a trois decimales, sans jamais rendre `-0`. */
function arrondi(v: number): number {
  const f = 10 ** DECIMALES;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

/**
 * Derive la fenetre d'un candidat, autour de l'instant choisi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLE, ET SON UNIQUE COMPROMIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On veut une fenetre CENTREE sur l'instant, de la duree demandee. Aux deux
 * bouts du rush, les deux souhaits s'opposent : une fenetre centree sur la
 * seconde 1 avec huit secondes de duree commencerait a -3.
 *
 * Le compromis retenu : on garde la DUREE, on deplace le centre. Un plan de
 * cinq secondes reste un plan de cinq secondes, meme pris au tout debut.
 * L'inverse — garder le centre et raccourcir — rendrait des candidats de
 * longueurs imprevisibles, dont certains trop courts pour etre montables.
 *
 * Le seul cas ou la duree cede est le rush plus COURT que la duree demandee :
 * il n'y a alors rien a garder, et la fenetre devient le rush entier.
 *
 * Garantit, pour tout `dureeRush > 0` :
 *   0 <= debut < fin <= dureeRush, et aucun NaN.
 */
export function fenetreCandidat(
  reference: number, dureeCible: number, dureeRush: number,
): { debutSecondes: number; finSecondes: number } | null {
  if (!Number.isFinite(reference) || !Number.isFinite(dureeCible)) return null;
  if (!Number.isFinite(dureeRush) || dureeRush <= 0) return null;
  if (reference < 0 || reference > dureeRush) return null;
  if (dureeCible <= 0) return null;

  // Le rush plus court que la duree demandee : la fenetre est le rush.
  const duree = Math.min(dureeCible, dureeRush);
  const demi = duree / 2;

  let debut = reference - demi;
  let fin = reference + demi;

  // On DEPLACE, on ne raccourcit pas.
  if (debut < 0) { fin -= debut; debut = 0; }
  if (fin > dureeRush) { debut -= fin - dureeRush; fin = dureeRush; }
  if (debut < 0) debut = 0;

  debut = arrondi(debut);
  fin = arrondi(fin);

  // ⚠️ APRES L'ARRONDI, ET PAS AVANT. Arrondir peut pousser `fin` d'un
  // millieme au-dela du rush ; le verifier avant ne prouverait rien sur ce
  // qui est reellement ecrit.
  if (fin > dureeRush) fin = arrondi(dureeRush);
  if (debut < 0) debut = 0;
  if (!(debut < fin)) return null;

  return { debutSecondes: debut, finSecondes: fin };
}

// ───────────────────────────────────────────────────────────────────────────
// La lecture de la reponse
// ───────────────────────────────────────────────────────────────────────────

export interface ContexteCandidats {
  /** Les positions REELLEMENT montrees au fournisseur. */
  positions: readonly number[];
  dureeSecondes: number;
}

export type ResultatCandidats =
  | { ok: true; valeur: CandidatMontage[] }
  | { ok: false; motif: MotifCandidats; champ: string; detail: string | null };

/** Un refus qui NOMME le champ fautif. Meme geste que `visuel-contrat`. */
function refus(
  motif: MotifCandidats, champ: string, detail: string | null = null,
): ResultatCandidats {
  return { ok: false, motif, champ, detail };
}

/** Les cles connues. Tout le reste est `champ_inconnu`. */
const CLES_RACINE = ['candidats'] as const;
// ⚠️ `signaux` N'EN FAIT PAS PARTIE, ET C'EST LE POINT DE L'ETAPE 4A.1.
// Le fournisseur qui CHOISIT les moments n'a rien a dire sur ce qu'ils
// montrent : on ne lui demande rien de plus qu'avant, donc son choix ne
// peut pas avoir change. Les signaux sont attaches APRES, par une etape
// distincte, sur des candidats deja figes.
const CLES_CANDIDAT = [
  'secondeReference', 'dureeCibleSecondes', 'scoreMontage', 'raison',
] as const;

function cleInconnue(objet: Record<string, unknown>, connues: readonly string[]): string | null {
  return Object.keys(objet).find((k) => !connues.includes(k)) ?? null;
}

/**
 * Ramene une seconde annoncee sur la position de vignette qui lui correspond,
 * ou rend `null`.
 *
 * ⚠️ C'EST NOTRE VALEUR QUI EST RENDUE, PAS LA SIENNE. Un modele qui ecrirait
 * `2.3849999` obtiendrait `2.385` — la position que nous lui avons montree.
 * Ce qui entre en base vient donc toujours de nos vignettes.
 */
export function normaliserReference(
  v: unknown, positions: readonly number[],
): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  for (const p of positions) {
    if (Math.abs(p - v) <= TOLERANCE_REFERENCE) return p;
  }
  return null;
}

/**
 * Lit la reponse du fournisseur, et rend des candidats CLASSES.
 *
 * Le tri et le rang sont poses ICI, et jamais par le modele : un rang choisi
 * par lui serait un classement dont personne ne connaitrait la regle.
 *
 *   1. `scoreMontage` decroissant
 *   2. a egalite, `secondeReference` croissante
 *
 * Deterministe dans les deux cas : deux lectures de la meme reponse rendent
 * le meme ordre.
 */
export function lireReponseCandidats(
  brut: unknown, contexte: ContexteCandidats,
): ResultatCandidats {
  // ── Le corps ────────────────────────────────────────────────────────────
  let racine: unknown = brut;
  if (typeof brut === 'string') {
    const octets = Buffer.byteLength(brut, 'utf8');
    if (octets > REPONSE_CANDIDATS_MAX_OCTETS) {
      return refus('reponse_illisible', 'reponse', `${octets} octets`);
    }
    try { racine = JSON.parse(brut); } catch {
      return refus('reponse_illisible', 'reponse', 'json invalide');
    }
  } else if (typeof brut !== 'object' || brut === null) {
    return refus('reponse_illisible', 'reponse', 'ni objet ni chaine');
  }

  if (typeof racine !== 'object' || racine === null || Array.isArray(racine)) {
    return refus('forme_invalide', 'racine', 'objet attendu');
  }
  const objet = racine as Record<string, unknown>;

  const inconnue = cleInconnue(objet, CLES_RACINE);
  if (inconnue) return refus('champ_inconnu', inconnue);

  const liste = objet.candidats;
  if (liste === undefined) return refus('forme_invalide', 'candidats', 'absent');
  if (!Array.isArray(liste)) return refus('forme_invalide', 'candidats', 'tableau attendu');
  if (liste.length < CANDIDATS_MIN) {
    return refus('forme_invalide', 'candidats', 'liste vide');
  }
  if (liste.length > CANDIDATS_MAX) {
    return refus('borne_depassee', 'candidats', `${liste.length} > ${CANDIDATS_MAX}`);
  }

  // ── Chaque candidat ─────────────────────────────────────────────────────
  const vus = new Set<number>();
  const lus: Array<PropositionCandidateVisuelle & { debutSecondes: number; finSecondes: number }> = [];

  for (const [i, item] of liste.entries()) {
    const ou = `candidats[${i}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return refus('forme_invalide', ou, 'objet attendu');
    }
    const c = item as Record<string, unknown>;

    const cle = cleInconnue(c, CLES_CANDIDAT);
    if (cle) return refus('champ_inconnu', `${ou}.${cle}`);

    // L'instant : ferme sur nos vignettes, et remplace par la NOTRE.
    const reference = normaliserReference(c.secondeReference, contexte.positions);
    if (reference === null) {
      return refus('reference_inventee', `${ou}.secondeReference`);
    }
    if (vus.has(reference)) {
      return refus('reference_dupliquee', `${ou}.secondeReference`);
    }
    vus.add(reference);

    // La duree : un des quatre choix, et rien d'autre.
    const duree = c.dureeCibleSecondes;
    if (typeof duree !== 'number'
      || !(DUREES_CANDIDAT_SECONDES as readonly number[]).includes(duree)) {
      return refus('duree_inconnue', `${ou}.dureeCibleSecondes`);
    }

    // Le score : entier, dans 0-100.
    const score = c.scoreMontage;
    if (typeof score !== 'number' || !Number.isInteger(score)
      || score < SCORE_MIN || score > SCORE_MAX) {
      return refus('valeur_hors_plage', `${ou}.scoreMontage`);
    }

    // La raison : une chaine non vide, bornee.
    const raison = c.raison;
    if (typeof raison !== 'string' || raison.trim().length === 0) {
      return refus('forme_invalide', `${ou}.raison`, 'chaine non vide attendue');
    }
    if (raison.length > RAISON_MAX) {
      return refus('borne_depassee', `${ou}.raison`, `${raison.length} > ${RAISON_MAX}`);
    }

    // Les bornes : calculees ici, jamais lues.
    const fenetre = fenetreCandidat(reference, duree, contexte.dureeSecondes);
    if (fenetre === null) {
      return refus('valeur_hors_plage', `${ou}.secondeReference`, 'fenetre indefinissable');
    }

    lus.push({
      secondeReference: reference,
      dureeCibleSecondes: duree,
      scoreMontage: score,
      raison: raison.trim(),
      // ⚠️ TOUJOURS `null` ICI, ET JAMAIS AUTRE CHOSE. Un candidat NAIT sans
      // signaux : les lui demander dans la meme reponse ferait dependre le
      // choix des moments d'une question qui n'a rien a voir avec lui.
      signaux: null,
      ...fenetre,
    });
  }

  // ── Le classement, et le rang ───────────────────────────────────────────
  lus.sort((a, b) => (
    b.scoreMontage - a.scoreMontage || a.secondeReference - b.secondeReference
  ));

  return {
    ok: true,
    valeur: lus.map((c, i) => ({ rang: i + 1, ...c })),
  };
}

/**
 * L'usage, assemble par le TRANSPORT — jamais lu dans le JSON du modele.
 *
 * Identique en esprit a `usageVisuel` : c'est le seul endroit du module ou
 * l'indulgence est le bon choix, et c'est parce que la valeur ne vient PAS
 * du modele. Une metrique de cout absente est un compteur faux ; une
 * generation perdue est un rush a refaire.
 */
export function usageCandidats(brut: {
  images?: unknown; inputTokens?: unknown; outputTokens?: unknown;
}): { images: number; inputTokens: number; outputTokens: number } {
  const entier = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return {
    images: entier(brut.images),
    inputTokens: entier(brut.inputTokens),
    outputTokens: entier(brut.outputTokens),
  };
}

/**
 * Verifie qu'un candidat relu depuis la base a bien la forme annoncee.
 *
 * La base accepte n'importe quel `jsonb` ; l'ecran, lui, affiche des nombres.
 * Un candidat informe passerait la persistance et casserait a l'affichage.
 */
export function candidatValide(valeur: unknown): valeur is CandidatMontage {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return false;
  const c = valeur as Record<string, unknown>;
  const nombres = [
    'rang', 'secondeReference', 'dureeCibleSecondes',
    'debutSecondes', 'finSecondes', 'scoreMontage',
  ];
  for (const k of nombres) {
    if (typeof c[k] !== 'number' || !Number.isFinite(c[k] as number)) return false;
  }
  if (typeof c.raison !== 'string' || c.raison.length === 0) return false;
  if (!(Number(c.debutSecondes) < Number(c.finSecondes))) return false;
  return true;
}

/**
 * Normalise un candidat relu depuis la base.
 *
 * ⚠️ `candidatValide` NE SUFFIT PAS, ET C'EST UNE QUESTION D'HONNETETE DE
 * TYPE. Une ligne ecrite avant l'etape 4A ne porte pas `signaux` ; le garde
 * la laisse passer — a juste titre, elle est valide — mais l'objet rendu
 * aurait alors `signaux: undefined` la ou le type promet `SignauxVision |
 * null`. Un `?.` de plus en aval, et l'absence redeviendrait invisible.
 *
 * Ne refuse rien : ce qui est illisible devient `null`.
 */
export function normaliserCandidatRelu(c: CandidatMontage): CandidatMontage {
  return { ...c, signaux: visionDepuisLigne((c as { signaux?: unknown }).signaux) };
}
