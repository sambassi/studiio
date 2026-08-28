/**
 * Le vocabulaire de l'analyse d'un rush — un seul, partagé par la base,
 * l'API et l'écran.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN MODULE SÉPARÉ DE CELUI DU TOURNAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `autopilot/tournage/contrat.ts` décrit ce qu'un utilisateur A TÉLÉVERSÉ :
 * une session, un fichier, un rang. Ce module-ci décrit ce que le serveur A
 * DÉDUIT de ce fichier. Les deux vocabulaires évoluent pour des raisons
 * différentes — un état d'ingestion change quand le stockage change, un état
 * d'analyse change quand un moteur d'analyse change — et les mélanger ferait
 * qu'une modification de l'un obligerait à relire l'autre.
 *
 * Les états ci-dessous sont déclarés UNE fois, avec les mêmes chaînes que les
 * contraintes `CHECK` de `2026-09-01-rush-analyses.sql`. Un état ajouté en
 * base sans l'être ici sera refusé à la lecture, ce qui est bruyant — et
 * c'est voulu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni segments candidats, ni scores, ni montage, ni publication. Ces concepts
 * appartiennent aux lots suivants et n'ont pas de forme arrêtée. Ce module ne
 * connaît pas non plus HTTP : il ne décide d'aucun code de refus.
 */

/** Les cinq états d'une analyse. Mêmes valeurs que le CHECK de la table. */
export const STATUTS_ANALYSE = [
  'en_attente', 'en_cours', 'reussie', 'echouee', 'annulee',
] as const;
export type RushAnalysisStatus = (typeof STATUTS_ANALYSE)[number];

/**
 * Les états qui occupent le verrou d'unicité de la base.
 *
 * Mêmes valeurs que la clause `where` de `rush_analyses_active_unique`. Le
 * code ne s'en sert QUE pour expliquer un refus à l'appelant — jamais pour
 * décider s'il peut créer une analyse. Cette décision appartient au moteur :
 * un `select` suivi d'un `insert` laisse une fenêtre entre les deux.
 */
export const ETATS_ACTIFS: readonly RushAnalysisStatus[] = ['en_attente', 'en_cours'];

/** Les états dont on ne sort plus. Une analyse close ne se rouvre pas. */
export const ETATS_TERMINAUX: readonly RushAnalysisStatus[] = [
  'reussie', 'echouee', 'annulee',
];

/**
 * Les trois étapes d'une analyse, dans leur ordre d'exécution.
 *
 * `extraction`    — ffmpeg, en local : durée réelle, dimensions, vignettes.
 * `visuel`        — lecture des vignettes par un modèle.
 * `transcription` — la parole, si le rush en porte.
 *
 * Aucune n'est implémentée dans ce lot : ce sont M3-B2, M3-B4 et M3-B5. Le
 * vocabulaire est posé maintenant parce que la colonne `etape` doit savoir
 * quoi accepter, pas parce que le travail est fait.
 */
export const ETAPES_ANALYSE = ['extraction', 'visuel', 'transcription'] as const;
export type RushAnalysisStep = (typeof ETAPES_ANALYSE)[number];

/**
 * Les moteurs qui peuvent produire une étape.
 *
 * Alignés sur `ServiceName` de `src/lib/service-alerts.ts` pour les deux qui
 * y figurent, afin qu'un échec puisse être remonté sous le même nom que
 * partout ailleurs. `local` n'y figure pas et n'a pas à y figurer : ffmpeg
 * tourne chez nous, il n'y a pas de service tiers à superviser.
 */
export const FOURNISSEURS_ANALYSE = ['local', 'anthropic', 'replicate'] as const;
export type FournisseurAnalyse = (typeof FOURNISSEURS_ANALYSE)[number];

/** Qui a fait une étape, et avec quoi. `modele` est `null` pour `local`. */
export interface FournisseurEtape {
  fournisseur: FournisseurAnalyse;
  modele: string | null;
}

/**
 * Un fournisseur PAR ÉTAPE.
 *
 * Une paire `fournisseur`/`modele` unique pour toute l'analyse laisserait
 * croire qu'un seul moteur produit tout le résultat. Il n'y aurait alors
 * aucun moyen de savoir lequel a produit `resume` et lequel a produit
 * `parole` — ni, le jour où l'un des deux se met à mal répondre, lequel
 * remplacer.
 *
 * Partiel : une analyse arrêtée après l'extraction n'a pas de `visuel`.
 */
export type FournisseursParEtape = Partial<Record<RushAnalysisStep, FournisseurEtape>>;

/**
 * Une vignette : une CLÉ d'objet, jamais une URL.
 *
 * Une URL est une façon de lire un objet à un instant donné et change avec la
 * configuration du stockage ; une URL permanente stockée ici survivrait à la
 * session qui l'a créée. Tout accès au média se signe à la demande, pour une
 * durée courte.
 */
export interface VignetteAnalyse {
  bucket: string;
  cle: string;
  /** Position dans le rush, en secondes. */
  seconde: number;
}

export interface RushAnalysis {
  id: string;
  rushId: string;
  userId: string;
  version: number;
  etat: RushAnalysisStatus;
  /** `null` tant que rien n'a commencé — « pas démarré » n'est pas « en extraction ». */
  etape: RushAnalysisStep | null;
  fournisseurs: FournisseursParEtape;
  /** La durée MESURÉE. `null` = pas encore mesurée. Jamais `0`. */
  dureeSecondes: number | null;
  /** Ce qui se mesure : dimensions, fps, débit, codec, piste audio. */
  technique: Record<string, unknown>;
  /** Ce qui s'interprète, tenu à l'écart de ce qui se mesure. */
  resume: string | null;
  textesVisibles: unknown[];
  parole: Record<string, unknown>;
  audio: Record<string, unknown>;
  qualite: Record<string, unknown>;
  vignettes: VignetteAnalyse[];
  /** Jetons, secondes facturables, coût estimé. Renseigné, jamais débité ici. */
  usage: Record<string, unknown>;
  motifEchec: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Bornes reprises des CHECK de la migration, pour refuser AVANT la base. */
export const RESUME_MAX = 4000;
export const MOTIF_ECHEC_MAX = 200;

/**
 * Champs qu'un navigateur n'a jamais le droit de proposer.
 *
 * Même principe que `CHAMPS_INTERDITS_TOURNAGE` et `CHAMPS_INTERDITS_RENDU` :
 * refusés en 422 par la future route, pas ignorés en silence. Un champ ignoré
 * laisse croire qu'il a été pris en compte — et c'est exactement ce qu'espère
 * celui qui l'envoie.
 *
 * La liste couvre les deux formes, `snake_case` et `camelCase` : un client ne
 * doit pas pouvoir passer par l'orthographe que la liste a oubliée.
 */
export const CHAMPS_INTERDITS_ANALYSE = [
  'id',
  'user_id', 'userId',
  'rush_id', 'rushId',
  'version',
  'etat', 'etape',
  'fournisseurs',
  'duree_secondes', 'dureeSecondes',
  'technique',
  'resume',
  'textes_visibles', 'textesVisibles',
  'parole', 'audio', 'qualite',
  'vignettes',
  'usage',
  'motif_echec', 'motifEchec',
  'created_at', 'createdAt',
  'updated_at', 'updatedAt',
] as const;

export function statutAnalyseValide(valeur: unknown): valeur is RushAnalysisStatus {
  return typeof valeur === 'string'
    && (STATUTS_ANALYSE as readonly string[]).includes(valeur);
}

export function etapeAnalyseValide(valeur: unknown): valeur is RushAnalysisStep {
  return typeof valeur === 'string'
    && (ETAPES_ANALYSE as readonly string[]).includes(valeur);
}

export function fournisseurValide(valeur: unknown): valeur is FournisseurAnalyse {
  return typeof valeur === 'string'
    && (FOURNISSEURS_ANALYSE as readonly string[]).includes(valeur);
}

export function analyseActive(etat: RushAnalysisStatus): boolean {
  return ETATS_ACTIFS.includes(etat);
}

/** Un objet JSON acceptable : ni tableau, ni `null`, ni scalaire. */
export function objetJsonValide(valeur: unknown): { ok: boolean; valeur: Record<string, unknown> } {
  if (valeur === undefined || valeur === null) return { ok: true, valeur: {} };
  if (typeof valeur !== 'object' || Array.isArray(valeur)) return { ok: false, valeur: {} };
  return { ok: true, valeur: valeur as Record<string, unknown> };
}

/** Un tableau JSON acceptable. Un objet n'en est pas un, même si `jsonb` l'accepterait. */
export function tableauJsonValide(valeur: unknown): { ok: boolean; valeur: unknown[] } {
  if (valeur === undefined || valeur === null) return { ok: true, valeur: [] };
  if (!Array.isArray(valeur)) return { ok: false, valeur: [] };
  return { ok: true, valeur };
}

/**
 * Une carte de fournisseurs acceptable.
 *
 * Refuse une étape inconnue, un fournisseur inconnu et un `modele` qui ne
 * serait ni une chaîne ni `null`. Une carte invalide n'est pas nettoyée en
 * silence : `ok: false`, et l'appelant décide.
 */
export function fournisseursValides(
  valeur: unknown,
): { ok: boolean; valeur: FournisseursParEtape } {
  const vide: FournisseursParEtape = {};
  if (valeur === undefined || valeur === null) return { ok: true, valeur: vide };
  if (typeof valeur !== 'object' || Array.isArray(valeur)) return { ok: false, valeur: vide };

  const sortie: FournisseursParEtape = {};
  for (const [etape, brut] of Object.entries(valeur as Record<string, unknown>)) {
    if (!etapeAnalyseValide(etape)) return { ok: false, valeur: vide };
    if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
      return { ok: false, valeur: vide };
    }
    const entree = brut as Record<string, unknown>;
    if (!fournisseurValide(entree.fournisseur)) return { ok: false, valeur: vide };
    const modele = entree.modele;
    if (modele !== null && modele !== undefined && typeof modele !== 'string') {
      return { ok: false, valeur: vide };
    }
    sortie[etape] = {
      fournisseur: entree.fournisseur,
      modele: typeof modele === 'string' ? modele : null,
    };
  }
  return { ok: true, valeur: sortie };
}

/**
 * Une liste de vignettes acceptable : des clés, jamais des URL.
 *
 * La base pose la même interdiction (`vignettes::text not like '%://%'`).
 * Elle est répétée ici pour refuser AVANT l'aller-retour, et parce qu'un
 * refus applicatif peut nommer la vignette fautive là où la base ne nomme que
 * la contrainte.
 */
export function vignettesValides(
  valeur: unknown,
): { ok: boolean; valeur: VignetteAnalyse[] } {
  if (valeur === undefined || valeur === null) return { ok: true, valeur: [] };
  if (!Array.isArray(valeur)) return { ok: false, valeur: [] };

  const sortie: VignetteAnalyse[] = [];
  for (const brut of valeur) {
    if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
      return { ok: false, valeur: [] };
    }
    const v = brut as Record<string, unknown>;
    if (typeof v.bucket !== 'string' || !v.bucket.trim()) return { ok: false, valeur: [] };
    if (typeof v.cle !== 'string' || !v.cle.trim()) return { ok: false, valeur: [] };
    // Une URL n'est pas une clé. Ni `https://…`, ni `s3://…`.
    if (v.cle.includes('://') || v.bucket.includes('://')) return { ok: false, valeur: [] };
    // Même garde que `verifierObjet` : `A/../B/x` désigne l'espace de B.
    if (v.cle.includes('..')) return { ok: false, valeur: [] };
    const seconde = Number(v.seconde);
    if (!Number.isFinite(seconde) || seconde < 0) return { ok: false, valeur: [] };
    sortie.push({ bucket: v.bucket, cle: v.cle, seconde });
  }
  return { ok: true, valeur: sortie };
}

/** Les lignes de la base ↔ le vocabulaire ci-dessus. Un seul endroit. */
export function analyseDepuisLigne(row: Record<string, unknown>): RushAnalysis {
  const nombreOuNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const objet = (v: unknown): Record<string, unknown> => (
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  );

  return {
    id: String(row.id),
    rushId: String(row.rush_id),
    userId: String(row.user_id),
    version: Number(row.version ?? 1),
    // Un état inconnu n'est pas traduit en « en attente » : ce serait
    // annoncer un travail qui n'aura pas lieu. `echouee` est le seul repli
    // honnête pour une ligne que ce code ne sait pas lire.
    etat: statutAnalyseValide(row.etat) ? row.etat : 'echouee',
    etape: etapeAnalyseValide(row.etape) ? row.etape : null,
    fournisseurs: fournisseursValides(row.fournisseurs).valeur,
    dureeSecondes: nombreOuNull(row.duree_secondes),
    technique: objet(row.technique),
    resume: typeof row.resume === 'string' ? row.resume : null,
    textesVisibles: Array.isArray(row.textes_visibles) ? row.textes_visibles : [],
    parole: objet(row.parole),
    audio: objet(row.audio),
    qualite: objet(row.qualite),
    vignettes: vignettesValides(row.vignettes).valeur,
    usage: objet(row.usage),
    motifEchec: typeof row.motif_echec === 'string' ? row.motif_echec : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/**
 * Les colonnes à lire — écrites une fois, pour que deux lectures ne divergent
 * pas.
 *
 * UNE SEULE chaîne littérale, sur une seule ligne : le client PostgREST est
 * générique sur le littéral qu'on lui passe. Un tableau recollé par `join`,
 * ou même deux littéraux concaténés par `+`, s'infèrent en `string` — et le
 * client rend alors `GenericStringError` au lieu de la ligne. La longueur de
 * la ligne est le prix de la vérification de type sur la sélection.
 */
// eslint-disable-next-line max-len
export const COLONNES_ANALYSE = 'id, rush_id, user_id, version, etat, etape, fournisseurs, duree_secondes, technique, resume, textes_visibles, parole, audio, qualite, vignettes, usage, motif_echec, created_at, updated_at';
