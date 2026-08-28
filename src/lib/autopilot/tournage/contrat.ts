/**
 * Le vocabulaire du tournage — un seul, partagé par la base, l'API et l'écran.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN MODULE, ET NON DES TYPES DANS CHAQUE COMPOSANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Studiio a déjà payé ce prix ailleurs : `CARD_ICON_MAP` est une copie
 * quasi-identique de `ICON_MAP`, et le commentaire du fichier reconnaît que
 * les deux doivent rester synchronisés — sinon une icône ajoutée d'un côté
 * s'affiche vide de l'autre. Deux définitions d'un même concept ne divergent
 * pas tout de suite ; elles divergent au troisième changement.
 *
 * Les états ci-dessous sont donc déclarés UNE fois, avec les mêmes chaînes
 * que les contraintes `CHECK` de la migration. Un état ajouté en base sans
 * l'être ici sera refusé à la lecture, ce qui est bruyant — et c'est voulu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni analyse, ni segments, ni scores, ni stratégie de contenu, ni rendus, ni
 * publications. Ces concepts appartiennent aux lots suivants et n'ont pas de
 * forme arrêtée : les déclarer maintenant reviendrait à figer un vocabulaire
 * avant d'avoir la fonctionnalité qui le porte.
 */

/** Les trois états d'une session. Mêmes valeurs que le CHECK de la table. */
export const STATUTS_SESSION = ['ouverte', 'fermee', 'archivee'] as const;
export type ShootSessionStatus = (typeof STATUTS_SESSION)[number];

/**
 * Les trois états d'ingestion d'un rush.
 *
 * `verifie` — le serveur a REGARDÉ l'objet dans le stockage et l'y a trouvé.
 * `indexe`  — enregistré sans preuve. Aucun chemin ne produit cet état
 *             aujourd'hui ; il existe pour qu'un futur import en masse
 *             n'ait pas à mentir en se déclarant vérifié.
 * `absent`  — l'objet n'était pas là. On le consigne au lieu de supprimer la
 *             ligne en silence : une disparition doit se voir.
 */
export const ETATS_RUSH = ['indexe', 'verifie', 'absent'] as const;
export type RushIngestionStatus = (typeof ETATS_RUSH)[number];

export const STATUT_SESSION_DEFAUT: ShootSessionStatus = 'ouverte';

/** Bornes reprises des CHECK de la migration, pour refuser AVANT la base. */
export const TITRE_MAX = 200;
export const CONTEXTE_MAX = 2000;
export const NOM_ORIGINE_MAX = 512;

export interface ShootSession {
  id: string;
  userId: string;
  titre: string;
  statut: ShootSessionStatus;
  contexte: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Rush {
  id: string;
  shootSessionId: string;
  userId: string;
  /** La CLÉ de l'objet dans le stockage — jamais une URL. */
  bucket: string;
  cleObjet: string;
  nomOrigine: string | null;
  contentType: string | null;
  tailleOctets: number | null;
  /** `null` = inconnue. Jamais `0` : un zéro se lirait comme « vide ». */
  dureeSecondes: number | null;
  rang: number;
  etat: RushIngestionStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Champs qu'un navigateur n'a jamais le droit de proposer.
 *
 * Même principe que `CHAMPS_INTERDITS` des crédits : refusés en 422, pas
 * ignorés en silence. Un champ ignoré laisse croire qu'il a été pris en
 * compte — et c'est exactement ce qu'espère celui qui l'envoie.
 */
export const CHAMPS_INTERDITS_TOURNAGE = [
  'user_id', 'userId', 'id', 'rang', 'etat', 'created_at', 'createdAt',
  'updated_at', 'updatedAt', 'shoot_session_id', 'shootSessionId',
] as const;

export function statutSessionValide(valeur: unknown): valeur is ShootSessionStatus {
  return typeof valeur === 'string'
    && (STATUTS_SESSION as readonly string[]).includes(valeur);
}

export function etatRushValide(valeur: unknown): valeur is RushIngestionStatus {
  return typeof valeur === 'string'
    && (ETATS_RUSH as readonly string[]).includes(valeur);
}

/**
 * Un titre acceptable : non vide une fois détouré, et borné.
 *
 * Rend le titre nettoyé, ou `null` si inacceptable. L'appelant décide du
 * code de refus — cette fonction ne connaît pas HTTP.
 */
export function titreValide(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const t = valeur.trim();
  if (t.length === 0 || t.length > TITRE_MAX) return null;
  return t;
}

/** Un contexte acceptable : absent, ou borné. `null` distinct de `''`. */
export function contexteValide(valeur: unknown): { ok: boolean; valeur: string | null } {
  if (valeur === undefined || valeur === null) return { ok: true, valeur: null };
  if (typeof valeur !== 'string') return { ok: false, valeur: null };
  const t = valeur.trim();
  if (t.length === 0) return { ok: true, valeur: null };
  if (t.length > CONTEXTE_MAX) return { ok: false, valeur: null };
  return { ok: true, valeur: t };
}

/**
 * Un objet de métadonnées acceptable.
 *
 * Un tableau est un objet en JavaScript, et `jsonb` l'accepterait — mais
 * `metadata[0]` n'a aucun sens ici, et la colonne a pour défaut `{}`.
 */
export function metadataValide(valeur: unknown): { ok: boolean; valeur: Record<string, unknown> } {
  if (valeur === undefined || valeur === null) return { ok: true, valeur: {} };
  if (typeof valeur !== 'object' || Array.isArray(valeur)) return { ok: false, valeur: {} };
  return { ok: true, valeur: valeur as Record<string, unknown> };
}

/** Les lignes de la base ↔ le vocabulaire ci-dessus. Un seul endroit. */
export function sessionDepuisLigne(row: Record<string, unknown>): ShootSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    titre: String(row.titre ?? ''),
    statut: statutSessionValide(row.statut) ? row.statut : STATUT_SESSION_DEFAUT,
    contexte: typeof row.contexte === 'string' ? row.contexte : null,
    metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
      ? row.metadata as Record<string, unknown> : {},
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function rushDepuisLigne(row: Record<string, unknown>): Rush {
  const nombreOuNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(row.id),
    shootSessionId: String(row.shoot_session_id),
    userId: String(row.user_id),
    bucket: String(row.bucket ?? ''),
    cleObjet: String(row.cle_objet ?? ''),
    nomOrigine: typeof row.nom_origine === 'string' ? row.nom_origine : null,
    contentType: typeof row.content_type === 'string' ? row.content_type : null,
    tailleOctets: nombreOuNull(row.taille_octets),
    dureeSecondes: nombreOuNull(row.duree_secondes),
    rang: Number(row.rang ?? 0),
    etat: etatRushValide(row.etat) ? row.etat : 'indexe',
    metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
      ? row.metadata as Record<string, unknown> : {},
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}
