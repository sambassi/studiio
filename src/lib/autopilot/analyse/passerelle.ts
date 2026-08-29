/**
 * La passerelle réseau de l'écran d'analyse — le SEUL endroit qui parle au
 * serveur, et le seul à raccorder le jour où les routes bougent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN MODULE, ET NON DES `fetch` DANS LE COMPOSANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois raisons, dans l'ordre d'importance :
 *
 * 1. Le raccord. L'écran est écrit contre une route de lecture qui n'existe
 *    pas encore au moment où il est écrit (`GET …/analyse`, lot voisin). Un
 *    `fetch` recopié dans trois branches du rendu se raccorde à trois
 *    endroits, et le troisième est oublié. Ici il y a UNE fonction par appel.
 *
 * 2. L'invariant du suivi. Le suivi périodique ne doit JAMAIS écrire — un
 *    `POST` rejoué consommerait une place d'extraction et pourrait créer une
 *    analyse que personne n'a demandée. Séparer `lireAnalyse` (GET) de
 *    `lancerAnalyse` (POST) rend cet invariant vérifiable : un test compte
 *    les méthodes, et il n'y a pas d'autre chemin.
 *
 * 3. La conduite à tenir. Le serveur répond six codes différents et chacun
 *    appelle une conduite différente. Décider dans le rendu obligerait à
 *    monter React pour vérifier qu'un 429 ne relance pas. `conduiteApresLancement`
 *    est pure : elle se teste seule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il ne relance rien tout seul, ni sur 429, ni sur 503, ni sur 504. Un
 * ré-essai automatique sur un refus de capacité transforme un serveur occupé
 * en serveur martelé, et `Retry-After` n'est là que pour DIRE quand revenir.
 * La relance est un geste de l'utilisateur, toujours.
 *
 * Il ne met rien en forme non plus : les libellés, les unités et les phrases
 * vivent dans `presentation.ts`, qui ne connaît pas le réseau.
 */
import type {
  RushAnalysisStatus, RushAnalysisStep, FournisseursParEtape,
} from './contrat';
import {
  statutAnalyseValide, etapeAnalyseValide, fournisseursValides, analyseActive,
} from './contrat';

// ─────────────────────────────────────────────────────────────────────────
// Les chemins — écrits une fois
// ─────────────────────────────────────────────────────────────────────────

/**
 * La route d'analyse d'un rush.
 *
 * `POST` la lance (elle existe), `GET` rend la plus récente (lot voisin).
 * L'identifiant est encodé : il vient d'une ligne de base, mais un
 * identifiant recopié dans une URL sans encodage est une habitude qui finit
 * par croiser une valeur qui en avait besoin.
 */
export function cheminAnalyse(rushId: string): string {
  return `/api/autopilot/rushes/${encodeURIComponent(rushId)}/analyse`;
}

/**
 * L'adresse d'UNE vignette — l'image elle-même, servie par le serveur.
 *
 * ⚠️ CE N'EST PAS UNE URL SIGNÉE, ET C'EST VOULU.
 *
 * L'écran attendait d'abord une liste d'URL signées courtes. Il n'existe
 * aucun signeur de lecture utilisable par un navigateur : `signeurInterne`
 * signe sur le nom interne `studiio-minio:9000`, injouable dehors et
 * révélateur de la topologie ; `signeurPublic` n'expose pas de GET. Et une
 * URL signée fuite par trois chemins qu'on ne maîtrise pas — la signature
 * en query-string dans les journaux du proxy, le `Referer` d'un `<img>`
 * cross-origin, et le cache public du chemin `/storage`.
 *
 * Le serveur relit donc la ligne d'analyse filtrée par `user_id`, en tire la
 * clé LUI-MÊME, et rend les octets. Le navigateur n'envoie qu'un
 * identifiant d'analyse et un INDEX : il n'existe aucune clé à falsifier,
 * aucun jeton à faire expirer, et la session est réévaluée à chaque image.
 *
 * `/storage/v1/object/public/…` n'est ni utilisé ni touché.
 *
 * On passe l'identifiant de l'ANALYSE et non celui du rush : les vignettes
 * restent alors celles de l'analyse affichée, même si une nouvelle démarre
 * entre-temps.
 */
export function cheminVignette(analyseId: string, index: number): string {
  return `/api/autopilot/analyses/${encodeURIComponent(analyseId)}/vignettes/${index}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Ce que l'écran reçoit
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les vignettes vues de l'écran : un NOMBRE et des POSITIONS.
 *
 * Ni compartiment, ni clé. Le contrat serveur les retire déjà (`analysePublique`) ;
 * ce type le redit côté écran pour qu'on ne puisse pas en fabriquer une URL
 * par inadvertance en lisant un champ qui aurait resurgi.
 */
export interface VignettesResumees {
  nombre: number;
  secondes: number[];
}

/** L'analyse telle que l'écran la manipule. */
export interface AnalyseEcran {
  id: string;
  version: number;
  etat: RushAnalysisStatus;
  etape: RushAnalysisStep | null;
  fournisseurs: FournisseursParEtape;
  dureeSecondes: number | null;
  technique: Record<string, unknown>;
  resume: string | null;
  textesVisibles: unknown[];
  parole: Record<string, unknown>;
  audio: Record<string, unknown>;
  qualite: Record<string, unknown>;
  vignettes: VignettesResumees;
  motifEchec: string | null;
  createdAt: string;
  updatedAt: string;
}

function objet(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/**
 * Normalise les vignettes, quelle que soit la forme reçue.
 *
 * Deux formes circulent, et ce n'est pas une négligence : le contrat interne
 * (`RushAnalysis.vignettes`) est un tableau de clés, la forme publique
 * (`analysePublique`) est `{ nombre, secondes }`. La route de lecture rendra
 * la seconde ; accepter la première coûte quatre lignes et évite qu'un écran
 * n'affiche zéro vignette parce qu'un lot a rendu l'autre forme.
 *
 * Dans les DEUX cas, seules les secondes sortent d'ici. Une clé lue est une
 * clé jetée.
 */
function vignettesDepuis(brut: unknown): VignettesResumees {
  if (Array.isArray(brut)) {
    const secondes = brut
      .map((v) => Number(objet(v).seconde))
      .filter((n) => Number.isFinite(n) && n >= 0);
    return { nombre: brut.length, secondes };
  }
  const o = objet(brut);
  const secondes = Array.isArray(o.secondes)
    ? o.secondes.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
    : [];
  const nombre = Number.isFinite(Number(o.nombre)) ? Number(o.nombre) : secondes.length;
  return { nombre, secondes };
}

/**
 * Une analyse reçue du serveur, ou `null` si ce n'en est pas une.
 *
 * `null` plutôt qu'un objet à moitié rempli : un écran qui affiche « en
 * cours » à partir d'une réponse qu'il n'a pas comprise raconte un travail
 * qui n'a peut-être pas lieu.
 */
export function analyseDepuisReponse(brut: unknown): AnalyseEcran | null {
  const o = objet(brut);
  if (typeof o.id !== 'string' || !o.id) return null;
  if (!statutAnalyseValide(o.etat)) return null;
  return {
    id: o.id,
    version: Number.isFinite(Number(o.version)) ? Number(o.version) : 1,
    etat: o.etat,
    etape: etapeAnalyseValide(o.etape) ? o.etape : null,
    fournisseurs: fournisseursValides(o.fournisseurs).valeur,
    dureeSecondes: Number.isFinite(Number(o.dureeSecondes)) && o.dureeSecondes !== null
      ? Number(o.dureeSecondes) : null,
    technique: objet(o.technique),
    resume: typeof o.resume === 'string' && o.resume.trim() ? o.resume : null,
    textesVisibles: Array.isArray(o.textesVisibles) ? o.textesVisibles : [],
    parole: objet(o.parole),
    audio: objet(o.audio),
    qualite: objet(o.qualite),
    vignettes: vignettesDepuis(o.vignettes),
    motifEchec: typeof o.motifEchec === 'string' ? o.motifEchec : null,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  };
}

/** Vrai quand l'analyse est encore en train de se faire — donc à suivre. */
export function analyseEnCours(a: AnalyseEcran | null): boolean {
  return a !== null && analyseActive(a.etat);
}

// ─────────────────────────────────────────────────────────────────────────
// Lire — et seulement lire
// ─────────────────────────────────────────────────────────────────────────

export type LectureAnalyse =
  /** Le rush n'a jamais été analysé. C'est ce qui fait apparaître « Analyser ». */
  | { sorte: 'aucune' }
  | { sorte: 'trouvee'; analyse: AnalyseEcran }
  /** Le serveur n'a pas répondu, ou pas répondu quelque chose de lisible. */
  | { sorte: 'indisponible'; message: string };

const LECTURE_IMPOSSIBLE = 'Statut de l’analyse indisponible pour l’instant.';

/**
 * L'analyse la plus récente d'un rush. **`GET`, et rien d'autre.**
 *
 * C'est cette fonction que le suivi périodique appelle, et c'est pour ça
 * qu'elle n'accepte aucun paramètre qui pourrait la faire écrire.
 *
 * `404` vaut « aucune analyse » : la route de lecture peut légitimement
 * choisir ce code pour un rush jamais analysé, et un écran qui afficherait
 * « indisponible » ferait disparaître le bouton « Analyser » exactement quand
 * il est utile. Un rush qui n'existe pas rend le même 404 — et dans ce cas,
 * la liste qui l'affichait était déjà périmée.
 */
export async function lireAnalyse(rushId: string): Promise<LectureAnalyse> {
  let reponse: Response;
  try {
    reponse = await fetch(cheminAnalyse(rushId), { method: 'GET' });
  } catch {
    return { sorte: 'indisponible', message: LECTURE_IMPOSSIBLE };
  }
  if (reponse.status === 404) return { sorte: 'aucune' };

  let corps: unknown;
  try { corps = await reponse.json(); } catch {
    return { sorte: 'indisponible', message: LECTURE_IMPOSSIBLE };
  }
  const c = objet(corps);
  if (!reponse.ok) {
    const message = typeof c.error === 'string' && c.error ? c.error : LECTURE_IMPOSSIBLE;
    return { sorte: 'indisponible', message };
  }
  // `analyse: null` est la réponse normale d'un rush jamais analysé.
  const analyse = analyseDepuisReponse(c.analyse);
  if (!analyse) return { sorte: 'aucune' };
  return { sorte: 'trouvee', analyse };
}

// ─────────────────────────────────────────────────────────────────────────
// Lancer — le seul appel qui écrit
// ─────────────────────────────────────────────────────────────────────────

/** Ce que le serveur a répondu, brut, sans conduite décidée. */
export interface ReponseLancement {
  statut: number;
  motif: string | null;
  message: string | null;
  /** `Retry-After`, en secondes, quand l'en-tête est là. INFORMATIF. */
  retryApresSecondes: number | null;
  /** Vrai quand rien n'a pu être envoyé du tout (réseau coupé). */
  injoignable: boolean;
}

/**
 * Demande l'analyse d'un rush. **Un seul `POST`, jamais répété tout seul.**
 *
 * Le corps est vide, et c'est le contrat : tout ce qui décrit une analyse est
 * décidé par le serveur, et un corps qui proposerait `etat` ou `vignettes`
 * serait refusé en 422. Ne rien envoyer est donc la requête normale.
 */
export async function lancerAnalyse(rushId: string): Promise<ReponseLancement> {
  let reponse: Response;
  try {
    reponse = await fetch(cheminAnalyse(rushId), { method: 'POST' });
  } catch {
    return {
      statut: 0, motif: null, message: null, retryApresSecondes: null, injoignable: true,
    };
  }
  let corps: unknown = {};
  try { corps = await reponse.json(); } catch { corps = {}; }
  const c = objet(corps);
  const entete = typeof reponse.headers?.get === 'function'
    ? reponse.headers.get('Retry-After') : null;
  const retry = entete !== null && entete !== '' && Number.isFinite(Number(entete))
    ? Math.max(0, Math.round(Number(entete))) : null;
  return {
    statut: reponse.status,
    motif: typeof c.motif === 'string' ? c.motif : null,
    message: typeof c.error === 'string' && c.error ? c.error : null,
    retryApresSecondes: retry,
    injoignable: false,
  };
}

/**
 * Ce que l'écran fait de la réponse — une décision PURE, donc testable seule.
 *
 * `relire` veut dire : va chercher l'analyse par `GET` et affiche-la. C'est
 * la conduite du succès (201) ET celle du conflit (409), pour la même raison
 * — dans les deux cas, une analyse existe et c'est elle qu'il faut suivre.
 * Le 409 n'est pas un échec de l'utilisateur : quelqu'un (ou un second
 * onglet) a demandé la même chose avant lui.
 *
 * `relancable` dit s'il faut proposer un bouton de relance MANUELLE. Il est
 * faux pour tout ce qui ne passera jamais : un fichier illisible restera
 * illisible, et proposer de recommencer est une invitation à perdre son
 * temps. Il n'a jamais le sens de « relance toute seule » — rien, dans ce
 * module, ne relance.
 */
export type Conduite =
  | { suite: 'relire' }
  | {
      suite: 'message';
      message: string;
      relancable: boolean;
      retryApresSecondes: number | null;
    };

const MESSAGE_CAPACITE = 'Une autre analyse est déjà en cours. Réessaie dans quelques minutes.';
const MESSAGE_INDISPONIBLE = 'Service d’analyse temporairement indisponible. Réessaie plus tard.';
const MESSAGE_DELAI = 'La mesure a dépassé son délai. Le fichier est peut-être très lourd : tu peux relancer l’analyse.';
const MESSAGE_INJOIGNABLE = 'Impossible de joindre le serveur. Vérifie ta connexion, puis relance.';
const MESSAGE_INATTENDU = 'L’analyse n’a pas pu démarrer.';

export function conduiteApresLancement(r: ReponseLancement): Conduite {
  if (r.injoignable) {
    return {
      suite: 'message', message: MESSAGE_INJOIGNABLE, relancable: true, retryApresSecondes: null,
    };
  }
  // 201 — elle est lancée (et, chez nous, déjà terminée : la route mesure
  // dans la requête). On relit plutôt que de croire le corps du POST : une
  // seule source pour l'affichage, c'est une incohérence de moins.
  if (r.statut === 201 || r.statut === 200) return { suite: 'relire' };

  if (r.statut === 409) {
    // Deux 409 différents. `analyse_active_existante` : une analyse tourne,
    // on la suit. `rush_non_verifie` / `analyse_close` : il n'y a rien à
    // suivre, et relire ne montrerait rien.
    if (r.motif === null || r.motif === 'analyse_active_existante') return { suite: 'relire' };
    return {
      suite: 'message',
      message: r.message || MESSAGE_INATTENDU,
      relancable: false,
      retryApresSecondes: null,
    };
  }

  if (r.statut === 429) {
    // `Retry-After` INFORME. Il ne déclenche aucune minuterie de relance.
    return {
      suite: 'message',
      message: MESSAGE_CAPACITE,
      relancable: true,
      retryApresSecondes: r.retryApresSecondes,
    };
  }

  if (r.statut === 422) {
    // Définitif : le fichier n'est pas exploitable, n'est plus là, ou n'est
    // pas dans cet espace. Pas de bouton de relance.
    return {
      suite: 'message',
      message: r.message || 'Ce fichier ne peut pas être analysé.',
      relancable: false,
      retryApresSecondes: null,
    };
  }

  if (r.statut === 503) {
    return {
      suite: 'message',
      message: r.message || MESSAGE_INDISPONIBLE,
      relancable: true,
      retryApresSecondes: r.retryApresSecondes,
    };
  }

  if (r.statut === 504) {
    return {
      suite: 'message', message: MESSAGE_DELAI, relancable: true, retryApresSecondes: null,
    };
  }

  if (r.statut === 401) {
    return {
      suite: 'message',
      message: 'Session expirée. Reconnecte-toi pour analyser ce rush.',
      relancable: false,
      retryApresSecondes: null,
    };
  }

  if (r.statut === 404) {
    return {
      suite: 'message',
      message: 'Ce rush n’existe plus.',
      relancable: false,
      retryApresSecondes: null,
    };
  }

  return {
    suite: 'message',
    message: r.message || MESSAGE_INATTENDU,
    relancable: true,
    retryApresSecondes: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Les vignettes — signées, courtes, jamais publiques
// ─────────────────────────────────────────────────────────────────────────

export interface VignetteAffichable {
  /** Position dans le rush, ou `null` si le serveur ne l'a pas jointe. */
  seconde: number | null;
  /** URL signée, de durée courte. Elle n'est pas conservée entre deux sessions. */
  url: string;
}

export type LectureVignettes =
  | { sorte: 'ok'; vignettes: VignetteAffichable[] }
  | { sorte: 'indisponible' };

/**
 * Les URL d'affichage des vignettes. **`GET`, comme le reste du suivi.**
 *
 * Un échec ne remonte PAS de message : l'analyse, elle, a réussi, et lui
 * coller une erreur rouge parce que huit images ne sont pas revenues
 * ferait croire à un problème de mesure. L'écran dit sobrement que les
 * aperçus ne sont pas disponibles, et le reste des résultats s'affiche.
 */
export function vignettesAffichables(
  analyseId: string, nombre: number, secondes: readonly number[],
): VignetteAffichable[] {
  const total = Math.max(0, Math.min(nombre, secondes.length || nombre));
  const out: VignetteAffichable[] = [];
  for (let i = 0; i < total; i += 1) {
    const s = secondes[i];
    out.push({
      seconde: Number.isFinite(s) ? s : null,
      url: cheminVignette(analyseId, i),
    });
  }
  return out;
}

/**
 * Le rythme du suivi, en millisecondes.
 *
 * Trois secondes : assez pour qu'une extraction courte se voie finir sans que
 * l'écran paraisse figé, assez lent pour qu'une analyse de plusieurs minutes
 * ne produise que quelques dizaines de lectures. Ce n'est pas une barre de
 * progression déguisée — le serveur ne connaît pas de pourcentage, il connaît
 * des étapes.
 */
export const DELAI_SUIVI_MS = 3000;
