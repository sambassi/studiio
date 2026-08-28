/**
 * Le point de couture entre la route d'analyse et le moteur d'extraction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-B2 est écrit en deux morceaux : le moteur d'extraction (ffmpeg, en
 * local) d'un côté, l'orchestration HTTP de l'autre. Les deux ont besoin de
 * s'accorder sur une seule chose — la FORME du résultat — et sur rien
 * d'autre. Ce fichier écrit cette forme, une fois, pour que ni la route ni le
 * moteur n'aient à deviner celle de l'autre.
 *
 * Il ne mesure rien, n'ouvre aucun fichier, ne parle à aucun stockage. Il
 * décrit et il charge.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN CHARGEMENT DYNAMIQUE, ET NON UN `import` EN HAUT DE FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur tire ffmpeg, donc un binaire, donc un module qui n'a rien à faire
 * dans le graphe de démarrage d'une route qui peut refuser la requête bien
 * avant de mesurer quoi que ce soit — un rush d'autrui, une analyse déjà en
 * cours, une migration non appliquée. Le charger à la demande garde ces trois
 * refus gratuits.
 *
 * Le chargement est de plus TOLÉRANT À SON ABSENCE : si le module n'est pas
 * là, `chargerMoteurExtraction` rend `null` au lieu de faire tomber la route,
 * et l'appelant en fait un 503 nommé. Une route qui explose en 500 parce
 * qu'un module manque ne dit pas ce qui manque.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE MOTEUR DOIT EXPORTER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `src/lib/autopilot/analyse/extraction.ts` doit exporter `extraire` — ou, à
 * défaut, un `export default` de la même signature. Les deux sont acceptés
 * parce qu'ils coûtent une ligne ici et évitent un aller-retour de
 * coordination ; rien d'autre ne l'est, pour que l'accord reste écrit.
 */

/** Ce que la route donne au moteur. Une CLÉ d'objet, jamais une URL. */
export interface DemandeExtraction {
  /** Le compartiment du rush, tel qu'indexé. */
  bucket: string;
  /** La clé de l'objet dans ce compartiment. */
  cleObjet: string;
  /** Le propriétaire, tenu de la session — jamais du corps de la requête. */
  userId: string;
  /**
   * L'analyse déjà créée, `en_cours`.
   *
   * Le moteur s'en sert pour ranger ses vignettes sous une clé qui lui
   * appartient. Il n'a PAS à écrire dans `rush_analyses` : c'est la route qui
   * consigne le résultat, en un seul endroit.
   */
  analysisId: string;
}

/** Ce que le moteur a MESURÉ. Rien d'interprété : ça, ce sont les étapes suivantes. */
export interface ExtractionReussie {
  ok: true;
  /** La durée mesurée, en secondes. Strictement positive — jamais `0`. */
  dureeSecondes: number;
  /** Dimensions, fps, débit, codec, présence d'une piste audio. */
  technique: Record<string, unknown>;
  /** Des clés d'objets, jamais des URL. Peut être vide. */
  vignettes: Array<{ bucket: string; cle: string; seconde: number }>;
}

/**
 * Les quatre échecs que le moteur a le droit de rendre.
 *
 * Fermés, et non une chaîne libre : la route en dérive un code HTTP, et une
 * chaîne libre l'obligerait à retomber sur un code générique le jour où le
 * moteur invente un motif. Ce qui n'entre pas dans ces quatre-là est un bug
 * du moteur, pas un échec d'analyse — il doit lever, et la route rendra 500.
 *
 * `format_illisible`      — le fichier est là, ffmpeg n'en tire rien.
 * `extraction_impossible` — le moteur a échoué sans savoir dire pourquoi.
 * `timeout`               — la mesure a dépassé son délai.
 * `objet_introuvable`     — la clé indexée ne désigne plus rien.
 */
/**
 * ⚠️ IMPORTÉ, ET NON REDÉCLARÉ.
 *
 * Ce module a d'abord porté sa propre liste de quatre motifs, écrite avant
 * que le moteur n'existe. Le moteur en rend SIX : il distingue en plus une
 * clé hors du périmètre de l'utilisateur d'un stockage injoignable — deux
 * causes qui n'appellent ni le même code HTTP ni la même conduite.
 *
 * Deux listes du même vocabulaire ne divergent pas tout de suite : elles
 * divergent au troisième changement. Ici la divergence était déjà là, et
 * elle rendait `resultatExtractionValide` refusant sur deux issues
 * parfaitement légitimes — l'analyse aurait fini en 500 « résultat invalide »
 * là où le moteur avait correctement diagnostiqué.
 *
 * Le module qui PRODUIT les motifs fait autorité sur leur liste.
 */
export type { MotifExtraction } from './extraction';
import { MOTIFS_EXTRACTION as MOTIFS, type MotifExtraction as MotifExtractionLocal } from './extraction';

export interface ExtractionEchouee {
  ok: false;
  motif: MotifExtractionLocal;
  /** Facultatif, pour les journaux. Jamais montré tel quel à un navigateur. */
  detail?: string;
}

export type ResultatExtraction = ExtractionReussie | ExtractionEchouee;

/** La signature, en un seul type — c'est le contrat entre les deux morceaux. */
export type MoteurExtraction = (demande: DemandeExtraction) => Promise<ResultatExtraction>;

/** La liste, telle que le moteur la publie. Réexportée, jamais recopiée. */
export { MOTIFS_EXTRACTION } from './extraction';

export function motifExtractionValide(valeur: unknown): valeur is MotifExtractionLocal {
  return typeof valeur === 'string'
    && (MOTIFS as readonly string[]).includes(valeur);
}

/**
 * Le moteur posé à la main — la couture, pour les tests.
 *
 * Un test qui devrait faire tourner ffmpeg sur un vrai fichier pour vérifier
 * qu'une analyse passe à `echouee` ne testerait pas l'orchestration, il
 * testerait ffmpeg. Cette injection est donc ce qui rend la route testable
 * SANS moteur — et elle ne change rien en production, où personne ne
 * l'appelle.
 */
let moteurInjecte: MoteurExtraction | null = null;

export function definirMoteurExtraction(moteur: MoteurExtraction | null): void {
  moteurInjecte = moteur;
}

/**
 * Charge le moteur, ou rend `null` s'il n'est pas branché.
 *
 * `null` n'est pas une panne : c'est un déploiement où le module d'extraction
 * n'est pas là. L'appelant le traduit en 503 nommé, ce qui se diagnostique —
 * là où un 500 « Cannot find module » finit dans les journaux et nulle part
 * ailleurs.
 */
export async function chargerMoteurExtraction(): Promise<MoteurExtraction | null> {
  if (moteurInjecte) return moteurInjecte;
  try {
    const module = await import('@/lib/autopilot/analyse/extraction') as Record<string, unknown>;
    // ⚠️ `extraireRush` D'ABORD — c'est le nom que le moteur exporte.
    //
    // Ce chargeur cherchait `extraire`, un nom choisi avant que le moteur ne
    // soit écrit. Aucun test ne l'a vu : ceux de la route injectent une
    // doublure par `definirMoteurExtraction` et ne passent jamais par ici.
    // En production, la route aurait répondu 503 « moteur absent » avec le
    // moteur pourtant présent — le lot entier inerte, sans un test rouge.
    // D'où le test qui charge RÉELLEMENT le module.
    const candidat = module.extraireRush ?? module.extraire ?? module.default;
    return typeof candidat === 'function' ? candidat as MoteurExtraction : null;
  } catch {
    // Module absent, ou qui refuse de se charger. Les deux se répondent de la
    // même façon : le moteur n'est pas disponible sur ce serveur.
    return null;
  }
}

/**
 * Vérifie que ce que le moteur a rendu a bien la forme annoncée.
 *
 * Le moteur est du code à nous, pas un navigateur — mais il est écrit
 * séparément, et un retour mal formé écrit tel quel dans `rush_analyses`
 * serait accepté par la base (`jsonb`) puis abandonné en silence à la
 * lecture. Le refuser ici le rend bruyant, ce qui est le seul comportement
 * utile.
 */
export function resultatExtractionValide(valeur: unknown): ResultatExtraction | null {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null;
  const r = valeur as Record<string, unknown>;

  if (r.ok === false) {
    if (!motifExtractionValide(r.motif)) return null;
    return {
      ok: false,
      motif: r.motif,
      detail: typeof r.detail === 'string' ? r.detail : undefined,
    };
  }
  if (r.ok !== true) return null;

  const duree = Number(r.dureeSecondes);
  // `0` est refusé : une vidéo de durée nulle n'est pas une mesure, c'est une
  // mesure qui a échoué sans le dire.
  if (!Number.isFinite(duree) || duree <= 0) return null;
  if (typeof r.technique !== 'object' || r.technique === null || Array.isArray(r.technique)) {
    return null;
  }
  if (!Array.isArray(r.vignettes)) return null;

  return {
    ok: true,
    dureeSecondes: duree,
    technique: r.technique as Record<string, unknown>,
    // Le CONTENU des vignettes n'est pas revalidé ici : `vignettesValides` du
    // contrat le fait déjà, avec la liste blanche des compartiments, et le
    // refus qu'il rend nomme le champ. Deux validations du même objet
    // divergeraient au troisième changement.
    vignettes: r.vignettes as ExtractionReussie['vignettes'],
  };
}
