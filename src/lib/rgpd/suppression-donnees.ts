/**
 * Suppression RÉELLE et VÉRIFIABLE des données d'un utilisateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE GARANTIT
 * ─────────────────────────────────────────────────────────────────────────
 *  - Une DEMANDE (code de confirmation aléatoire) est enregistrée AVANT toute
 *    action, puis mise à jour après chaque étape : le statut publié est celui
 *    que les étapes ont réellement atteint, jamais une promesse.
 *  - Une étape ratée n'est JAMAIS marquée « terminée ». La reprise
 *    (`executerDemande` sur le même code) rejoue uniquement ce qui n'est pas
 *    terminé ; toutes les étapes sont idempotentes (supprimer ce qui n'existe
 *    plus ne fait rien).
 *  - Le stockage est purgé par PRÉFIXE STRICT dérivé ici, côté serveur, de
 *    l'identifiant du compte (`prefixesStockageDuCompte`) — jamais d'une
 *    valeur venue du client. Un identifiant qui n'est pas un UUID canonique
 *    en minuscules est refusé : il produirait un préfixe vide, traversant, ou
 *    qui ne correspond à aucun objet (et donc une « suppression » fausse).
 *  - Le module ne sait agir que sur UN `userId`, donné par l'appelant. Qui a
 *    le droit de le donner est décidé par les routes : la session (soi-même),
 *    `requireAdmin` (route admin), la signature Meta + le lien enregistré.
 *
 * Portées :
 *  - `meta`   : données obtenues via Facebook/Instagram (jetons et comptes
 *               sociaux Meta, photo de profil Facebook, lien d'identité).
 *               Ne supprime PAS le compte Studiio.
 *  - `compte` : suppression complète du compte (superset de `meta`), sur
 *               demande de l'utilisateur authentifié ou d'un administrateur.
 *
 * Ce qui est CONSERVÉ (obligations comptables — voir
 * tasks/dette-rgpd-purge-stockage.md) : `credit_transactions`,
 * `subscriptions`, `rendus` (preuve serveur des débits), `audit_log`,
 * `email_suppressions` (un désabonnement doit survivre au compte). La ligne
 * `users` est ANONYMISÉE, pas supprimée : ses `on delete cascade`
 * emporteraient la comptabilité.
 *
 * Aucune dépendance réseau directe : base, stockage, registre et liens sont
 * injectés (`DependancesSuppression`). Les adaptateurs réels vivent dans
 * `adaptateurs.ts`.
 */
import { randomBytes } from 'crypto';
import { NAMESPACES_PROPRIETAIRE_SECOND } from '@/lib/storage/acces-objet';
import { ALLOWED_BUCKETS } from '@/lib/storage/buckets';
import type { AppliMeta } from '@/lib/rgpd/meta-signed-request';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type Portee = 'meta' | 'compte';
export type Origine = 'meta' | 'utilisateur' | 'admin';
export type StatutSuppression = 'en_attente' | 'en_cours' | 'terminee' | 'partielle' | 'echec';

export type IdEtape =
  | 'rattachement'
  | 'verifications'
  | 'inventaire_externes'
  | 'comptes_sociaux_meta'
  | 'photo_profil_meta'
  | 'lien_meta'
  | 'jetons_sociaux'
  | 'stockage'
  | 'contenus'
  | 'liens_meta'
  | 'compte';

export interface Etape {
  id: IdEtape;
  statut: StatutSuppression;
  /** Code interne (jamais un message brut d'erreur, jamais publié). */
  motif?: string;
  tentatives: number;
  maj: string | null;
}

/** Fournisseurs EXTERNES qui peuvent détenir des données du compte. */
export type Fournisseur = 'heygen' | 'elevenlabs' | 'zernio' | 'stripe' | 'meta';
export const FOURNISSEURS: readonly Fournisseur[] = ['heygen', 'elevenlabs', 'zernio', 'stripe', 'meta'];

/**
 * État d'une opération chez un fournisseur. AUCUN appel fournisseur n'est
 * fait par ce module : il n'y a donc pas d'état « fait ». `non_applicable`
 * n'est posé QUE si les données locales prouvent qu'il n'y a rien chez ce
 * fournisseur ; dans le doute (lecture en échec), `a_faire_manuellement`.
 */
export type EtatExterne = 'a_faire_manuellement' | 'non_applicable';

export interface OperationExterne {
  fournisseur: Fournisseur;
  /** Code stable de l'action manuelle (voir tasks/dette-rgpd-purge-stockage.md). */
  action: string;
  etat: EtatExterne;
}

/**
 * Identifiant fournisseur relevé AVANT la suppression locale, pour que
 * l'opérateur retrouve la donnée dans la console du fournisseur. PRIVÉ :
 * vit dans le registre (objet non public), JAMAIS dans `statutPublic`.
 */
export interface ReferenceExterne {
  fournisseur: Fournisseur;
  table: string;
  colonne: string;
  valeur: string;
}

export const ACTIONS_EXTERNES: Record<Fournisseur, string> = {
  heygen: 'supprimer_avatars_et_videos',
  elevenlabs: 'supprimer_voix_clonees',
  zernio: 'supprimer_profil_et_comptes_connectes',
  stripe: 'verifier_resiliation_facturation_conservee',
  meta: 'revoquer_autorisation_application',
};

/** Ce qui est conservé, volontairement (affiché tel quel). */
export const CONSERVE_PUBLIC = [
  'comptabilite (credit_transactions, subscriptions, rendus)',
  'audit_log',
  'email_suppressions',
] as const;

export interface DemandeSuppression {
  version: 1;
  code: string;
  portee: Portee;
  origine: Origine;
  /** `null` tant qu'une demande Meta n'est rattachée à aucun compte. */
  userId: string | null;
  metaAppli?: AppliMeta;
  metaUserId?: string;
  /** Statut DANS STUDIIO (base + stockage), calculé depuis les étapes. */
  statut: StatutSuppression;
  motif?: string;
  etapes: Etape[];
  /**
   * Opérations chez les fournisseurs externes, figées par l'étape
   * `inventaire_externes` AVANT toute suppression locale (après, les lignes
   * qui prouvent l'existence d'une donnée externe ont disparu).
   */
  externes?: OperationExterne[];
  /** Identifiants fournisseurs relevés (privé, jamais publié). */
  referencesExternes?: ReferenceExterne[];
  creeLe: string;
  majLe: string;
}

export type Filtre = { colonne: string; op: 'eq'; valeur: string } | { colonne: string; op: 'in'; valeur: string[] };

/** Résultat d'un accès base. `tableAbsente` : 42P01 / PGRST205 uniquement. */
export interface ResultatBase {
  erreur: string | null;
  tableAbsente?: boolean;
  /** Nom de la colonne absente du schéma (42703 / PGRST204), si c'est la cause. */
  colonneAbsente?: string;
}

export interface BaseSuppression {
  supprimer(table: string, filtres: Filtre[]): Promise<ResultatBase>;
  mettreAJour(table: string, valeurs: Record<string, unknown>, filtres: Filtre[]): Promise<ResultatBase>;
  lire(table: string, colonnes: string, filtres: Filtre[]): Promise<ResultatBase & { lignes: Record<string, unknown>[] }>;
}

export interface StockageSuppression {
  /** Clés (complètes) sous `prefixe`, RÉCURSIF, au plus `max`. Lève sur panne. */
  lister(bucket: string, prefixe: string, max: number): Promise<string[]>;
  /** Supprime ces clés. Lève si UNE seule n'a pas pu l'être. */
  supprimer(bucket: string, cles: string[]): Promise<void>;
}

export interface RegistreSuppressions {
  /** `null` si le code est inconnu ; lève sur panne. */
  lire(code: string): Promise<DemandeSuppression | null>;
  ecrire(demande: DemandeSuppression): Promise<void>;
}

export interface LiensMeta {
  /** Le compte a-t-il AU MOINS un lien Meta (connexion Facebook) ? Lève sur panne. */
  existePourCompte?(userId: string): Promise<boolean>;
  /** Compte Studiio rattaché à cet identifiant Meta, `null` sinon ; lève sur panne. */
  resoudre(appli: AppliMeta, metaUserId: string): Promise<string | null>;
  /** Retire le lien de cet identifiant (s'il pointe vers `userId`). Idempotent. */
  supprimer(appli: AppliMeta, metaUserId: string, userId: string): Promise<void>;
  /** Retire tous les liens qui pointent vers ce compte. Idempotent. */
  supprimerPourCompte(userId: string): Promise<void>;
}

export interface DependancesSuppression {
  base: BaseSuppression;
  stockage: StockageSuppression;
  registre: RegistreSuppressions;
  liensMeta: LiensMeta;
  maintenant?: () => Date;
  genererCode?: () => string;
  /** Compte qu'aucune demande ne peut supprimer (administrateurs). */
  estCompteProtege?: (email: string | null) => boolean;
  journal?: (evenement: string, details: Record<string, unknown>) => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Gardes
// ─────────────────────────────────────────────────────────────────────────

/** UUID canonique, MINUSCULES (forme que Postgres renvoie et que les clés portent). */
export const UUID_CANONIQUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CODE_CONFIRMATION = /^[0-9a-f]{32}$/;

export function uidValide(uid: unknown): uid is string {
  return typeof uid === 'string' && UUID_CANONIQUE.test(uid);
}

export class RefusSuppression extends Error {
  constructor(public readonly raison: string) { super(raison); }
}

export interface CiblePurge { bucket: string; prefixe: string }

/**
 * Les SEULS préfixes purgés pour un compte. Dérivés de l'uid, ici.
 *
 *  - `<bucket>/<uid>/…` pour chaque compartiment géré ;
 *  - `<bucket>/<ns>/<uid>/…` pour les namespaces dont le propriétaire est au
 *    2e segment (`audio-complet`, `stock-attributions`, `fiches-contenu`).
 *
 * Refus (exception) pour tout uid qui n'est pas un UUID canonique : vide,
 * `..`, `/`, joker, majuscules — rien de cela ne sort jamais d'ici.
 */
export function prefixesStockageDuCompte(uid: unknown): CiblePurge[] {
  if (!uidValide(uid)) throw new RefusSuppression('uid_invalide');
  const cibles: CiblePurge[] = [];
  for (const bucket of ALLOWED_BUCKETS) {
    cibles.push({ bucket, prefixe: `${uid}/` });
    for (const ns of NAMESPACES_PROPRIETAIRE_SECOND) cibles.push({ bucket, prefixe: `${ns}/${uid}/` });
  }
  for (const c of cibles) {
    // Défense en profondeur : la forme est garantie par construction.
    if (!c.prefixe.endsWith(`${uid}/`) || c.prefixe.includes('..') || c.prefixe.startsWith('/') || c.prefixe.length < 37) {
      throw new RefusSuppression('prefixe_invalide');
    }
  }
  return cibles;
}

// ─────────────────────────────────────────────────────────────────────────
// Plan des étapes
// ─────────────────────────────────────────────────────────────────────────

export const PLATEFORMES_META = ['facebook', 'instagram'] as const;

/** Jetons OAuth et comptes tiers : retirés en premier, ce sont les plus sensibles. */
export const TABLES_JETONS = ['social_accounts', 'user_drive', 'zernio_accounts'] as const;

/**
 * Tables de contenu supprimées par `user_id`, ENFANTS AVANT PARENTS (les
 * clés composites `rushes → shoot_sessions` sont en `on delete restrict`).
 */
export const TABLES_CONTENUS = [
  'avatar_generations', 'avatar_versions', 'avatar_verrous_creation', 'user_avatars',
  'rush_montage_renders', 'rush_montage_plans', 'rush_clip_sets', 'rush_candidate_sets',
  'rush_transcriptions', 'rush_analyses', 'creer_draft_rushes', 'rushes', 'shoot_sessions',
  'autopilot_jumeau_attente', 'autopilot_config', 'agent_plans',
  'render_jobs', 'scheduled_posts', 'videos', 'objectives',
  'lut_assets', 'user_voices', 'user_notifications', 'user_settings', 'chat_logs',
] as const;

/** Tables CONSERVÉES, volontairement (documentées). */
export const TABLES_CONSERVEES = [
  'credit_transactions', 'subscriptions', 'rendus', 'audit_log', 'email_suppressions', 'stripe_events',
] as const;

/** Statuts Stripe d'un abonnement qui facture encore. */
export const STATUTS_ABONNEMENT_ACTIF = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

const ETAPES: Record<Portee, IdEtape[]> = {
  meta: ['rattachement', 'comptes_sociaux_meta', 'photo_profil_meta', 'lien_meta'],
  compte: ['verifications', 'inventaire_externes', 'jetons_sociaux', 'stockage', 'contenus', 'liens_meta', 'compte'],
};

/** Étapes après lesquelles, si elles ne sont pas terminées, on s'arrête. */
const BLOQUANTES: IdEtape[] = ['rattachement', 'verifications'];
/** Étape qui n'est tentée que si TOUTES les précédentes sont terminées. */
const EXIGE_TOUT: IdEtape[] = ['compte'];

export const TAILLE_LOT_STOCKAGE = 1000;
export const LOTS_MAX_PAR_PASSE = 200;

const HOTES_PHOTO_META = /(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com|cdninstagram\.com)$/i;

export function estPhotoMeta(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try { return HOTES_PHOTO_META.test(new URL(url).hostname); } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────
// Création
// ─────────────────────────────────────────────────────────────────────────

function nouveauCode(): string {
  return randomBytes(16).toString('hex');
}

function iso(deps: DependancesSuppression): string {
  return (deps.maintenant ? deps.maintenant() : new Date()).toISOString();
}

function squelette(
  deps: DependancesSuppression, portee: Portee, origine: Origine, userId: string | null,
): DemandeSuppression {
  const code = (deps.genererCode ?? nouveauCode)();
  if (!CODE_CONFIRMATION.test(code)) throw new RefusSuppression('code_invalide');
  const t = iso(deps);
  return {
    version: 1, code, portee, origine, userId,
    statut: 'en_attente',
    etapes: ETAPES[portee].map((id) => ({ id, statut: 'en_attente', tentatives: 0, maj: null })),
    creeLe: t, majLe: t,
  };
}

/** Demande de suppression d'un compte identifié (session ou admin). Enregistrée, pas exécutée. */
export async function creerDemandeCompte(
  userId: string, origine: 'utilisateur' | 'admin', deps: DependancesSuppression,
): Promise<DemandeSuppression> {
  if (!uidValide(userId)) throw new RefusSuppression('uid_invalide');
  const d = squelette(deps, 'compte', origine, userId);
  await deps.registre.ecrire(d);
  return d;
}

/** Demande Meta VÉRIFIÉE (signature contrôlée par l'appelant). Enregistrée, pas exécutée. */
export async function creerDemandeMeta(
  appli: AppliMeta, metaUserId: string, deps: DependancesSuppression,
): Promise<DemandeSuppression> {
  if (!/^[0-9]{1,32}$/.test(metaUserId)) throw new RefusSuppression('id_meta_invalide');
  const d = squelette(deps, 'meta', 'meta', null);
  // Meta n'envoie ce rappel que lorsque la personne a RETIRÉ l'application
  // de son compte Facebook/Instagram : l'autorisation est déjà révoquée
  // côté Meta. Les autres fournisseurs ne sont pas dans la portée « meta ».
  d.externes = [{ fournisseur: 'meta', action: ACTIONS_EXTERNES.meta, etat: 'non_applicable' }];
  d.metaAppli = appli;
  d.metaUserId = metaUserId;
  await deps.registre.ecrire(d);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────
// Exécution
// ─────────────────────────────────────────────────────────────────────────

type ResultatEtape = { statut: StatutSuppression; motif?: string };

const OK: ResultatEtape = { statut: 'terminee' };

function echecBase(r: ResultatBase, table: string): ResultatEtape | null {
  if (!r.erreur) return null;
  return { statut: 'echec', motif: `base:${table}` };
}

async function supprimerTables(
  tables: readonly string[], userId: string, deps: DependancesSuppression,
): Promise<ResultatEtape> {
  let faites = 0;
  for (const table of tables) {
    const r = await deps.base.supprimer(table, [{ colonne: 'user_id', op: 'eq', valeur: userId }]);
    // Une table ABSENTE (42P01 / PGRST205) ne contient rien : rien à supprimer.
    if (r.erreur && !r.tableAbsente) {
      return { statut: faites > 0 ? 'partielle' : 'echec', motif: `base:${table}` };
    }
    if (r.tableAbsente) deps.journal?.('table_absente', { table });
    faites++;
  }
  return OK;
}

async function purgerStockage(userId: string, deps: DependancesSuppression): Promise<ResultatEtape> {
  const cibles = prefixesStockageDuCompte(userId);
  let supprimes = 0;
  let lots = 0;
  for (const { bucket, prefixe } of cibles) {
    for (;;) {
      if (lots >= LOTS_MAX_PAR_PASSE) {
        // Borne d'une passe : on s'arrête HONNÊTEMENT, la reprise continuera.
        return { statut: 'partielle', motif: 'stockage:borne_atteinte' };
      }
      let cles: string[];
      try {
        cles = await deps.stockage.lister(bucket, prefixe, TAILLE_LOT_STOCKAGE);
      } catch {
        return { statut: supprimes > 0 ? 'partielle' : 'echec', motif: `stockage:liste:${bucket}` };
      }
      if (cles.length === 0) break;
      // Jamais une clé hors du préfixe, ni traversante : liste anormale → arrêt.
      if (cles.some((c) => typeof c !== 'string' || !c.startsWith(prefixe) || c.length === prefixe.length || c.includes('..'))) {
        return { statut: supprimes > 0 ? 'partielle' : 'echec', motif: `stockage:liste_hors_prefixe:${bucket}` };
      }
      try {
        await deps.stockage.supprimer(bucket, cles);
      } catch {
        return { statut: supprimes > 0 ? 'partielle' : 'echec', motif: `stockage:suppression:${bucket}` };
      }
      supprimes += cles.length;
      lots++;
    }
  }
  deps.journal?.('stockage_purge', { objets: supprimes });
  return OK;
}

/** Colonnes dont la valeur identifie la donnée chez le fournisseur. */
const SOURCES_EXTERNES: {
  fournisseur: Fournisseur | ((l: Record<string, unknown>) => Fournisseur);
  table: string;
  filtres?: Filtre[];
  colonnes: string[];
  /** Ligne à retenir (défaut : toutes). */
  retenir?: (l: Record<string, unknown>) => boolean;
}[] = [
  { fournisseur: 'heygen', table: 'user_avatars', colonnes: ['provider_avatar_id', 'provider_asset_id'] },
  { fournisseur: 'heygen', table: 'avatar_versions', colonnes: ['provider_avatar_id', 'provider_asset_id'] },
  { fournisseur: 'heygen', table: 'avatar_generations', colonnes: ['provider_video_id'] },
  {
    // `user_voices.provider` : 'elevenlabs' aujourd'hui, 'heygen' possible.
    fournisseur: (l) => (l.provider === 'heygen' ? 'heygen' : 'elevenlabs'),
    table: 'user_voices', colonnes: ['provider_voice_id'],
  },
  { fournisseur: 'zernio', table: 'zernio_accounts', colonnes: ['profile_id', 'account_id'] },
  { fournisseur: 'stripe', table: 'subscriptions', colonnes: ['stripe_subscription_id', 'stripe_customer_id'] },
  {
    fournisseur: 'stripe', table: 'credit_transactions',
    filtres: [{ colonne: 'type', op: 'in', valeur: ['purchase', 'subscription'] }],
    // `reference_id` = `stripe:in:<facture>` / `stripe:cs:<session>` (crediter.ts).
    colonnes: ['reference_id'],
    retenir: (l) => typeof l.reference_id === 'string' && l.reference_id.startsWith('stripe:'),
  },
  {
    fournisseur: 'meta', table: 'social_accounts',
    filtres: [{ colonne: 'platform', op: 'in', valeur: [...PLATEFORMES_META] }],
    colonnes: ['account_id'],
  },
];

const MAX_REFERENCES = 500;

/**
 * Relève, à partir des SEULES données locales, ce qui reste à faire chez
 * chaque fournisseur. Aucune requête réseau vers un fournisseur.
 * Toute lecture en échec → `a_faire_manuellement` (jamais un faux « rien »).
 */
async function inventorierExternes(uid: string, deps: DependancesSuppression): Promise<{
  externes: OperationExterne[]; references: ReferenceExterne[];
}> {
  const concerne = new Set<Fournisseur>();
  const references: ReferenceExterne[] = [];
  const noter = (fournisseur: Fournisseur, table: string, colonne: string, v: unknown) => {
    if (references.length >= MAX_REFERENCES) return;
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const valeur = String(v);
    if (!valeur || references.some((r) => r.fournisseur === fournisseur && r.table === table && r.colonne === colonne && r.valeur === valeur)) return;
    references.push({ fournisseur, table, colonne, valeur });
  };

  for (const src of SOURCES_EXTERNES) {
    const r = await deps.base.lire(src.table, '*', [{ colonne: 'user_id', op: 'eq', valeur: uid }, ...(src.filtres ?? [])]);
    if (r.erreur && !r.tableAbsente) {
      // Lecture impossible : on ne sait pas, donc on ne prétend pas « rien ».
      if (typeof src.fournisseur === 'string') concerne.add(src.fournisseur);
      else { concerne.add('elevenlabs'); concerne.add('heygen'); }
      continue;
    }
    for (const l of r.lignes) {
      if (src.retenir && !src.retenir(l)) continue;
      const f = typeof src.fournisseur === 'string' ? src.fournisseur : src.fournisseur(l);
      concerne.add(f);
      for (const c of src.colonnes) noter(f, src.table, c, l[c]);
    }
  }

  // Ligne `users` : client Stripe et profil Zernio (colonnes facultatives).
  const u = await deps.base.lire('users', '*', [{ colonne: 'id', op: 'eq', valeur: uid }]);
  if (u.erreur) { concerne.add('stripe'); concerne.add('zernio'); concerne.add('meta'); }
  else for (const l of u.lignes) {
    if (l.stripe_customer_id) { concerne.add('stripe'); noter('stripe', 'users', 'stripe_customer_id', l.stripe_customer_id); }
    if (l.zernio_profile_id) { concerne.add('zernio'); noter('zernio', 'users', 'zernio_profile_id', l.zernio_profile_id); }
    // Photo de profil servie par Meta : la personne s'est connectée via Facebook.
    if (estPhotoMeta(l.avatar_url)) concerne.add('meta');
  }

  // Meta : une connexion Facebook laisse un lien, donc une autorisation d'application.
  if (!concerne.has('meta')) {
    if (!deps.liensMeta.existePourCompte) concerne.add('meta');
    else {
      try { if (await deps.liensMeta.existePourCompte(uid)) concerne.add('meta'); } catch { concerne.add('meta'); }
    }
  }

  return {
    externes: FOURNISSEURS.map((f) => ({
      fournisseur: f, action: ACTIONS_EXTERNES[f], etat: concerne.has(f) ? 'a_faire_manuellement' : 'non_applicable',
    })),
    references,
  };
}

async function executerEtape(id: IdEtape, d: DemandeSuppression, deps: DependancesSuppression): Promise<ResultatEtape> {
  const uid = d.userId;
  switch (id) {
    case 'rattachement': {
      if (uid) return OK;
      if (!d.metaAppli || !d.metaUserId) return { statut: 'echec', motif: 'rattachement:demande_incomplete' };
      let trouve: string | null;
      try {
        trouve = await deps.liensMeta.resoudre(d.metaAppli, d.metaUserId);
      } catch {
        return { statut: 'echec', motif: 'rattachement:indisponible' };
      }
      if (!trouve) {
        // Aucun compte rattaché dans nos registres : on ne PRÉTEND rien.
        // La demande reste ouverte pour une vérification manuelle.
        return { statut: 'en_attente', motif: 'rattachement:aucun_compte' };
      }
      if (!uidValide(trouve)) return { statut: 'echec', motif: 'rattachement:lien_invalide' };
      d.userId = trouve;
      return OK;
    }
    case 'verifications': {
      if (!uid) return { statut: 'echec', motif: 'verifications:sans_compte' };
      const u = await deps.base.lire('users', 'id, email', [{ colonne: 'id', op: 'eq', valeur: uid }]);
      if (u.erreur) return { statut: 'echec', motif: 'verifications:base' };
      if (u.lignes.length === 0) return { statut: 'echec', motif: 'verifications:compte_introuvable' };
      const email = typeof u.lignes[0].email === 'string' ? (u.lignes[0].email as string) : null;
      if (deps.estCompteProtege?.(email)) return { statut: 'echec', motif: 'verifications:compte_protege' };
      const abonnements = await deps.base.lire('subscriptions', 'status, cancel_at_period_end', [
        { colonne: 'user_id', op: 'eq', valeur: uid },
        { colonne: 'status', op: 'in', valeur: STATUTS_ABONNEMENT_ACTIF },
      ]);
      if (abonnements.erreur && !abonnements.tableAbsente) return { statut: 'echec', motif: 'verifications:base' };
      // Un abonnement qui facture encore ne peut pas survivre à un compte
      // anonymisé : il doit être résilié AVANT (aucun appel Stripe ici).
      if (abonnements.lignes.some((a) => a.cancel_at_period_end !== true)) {
        return { statut: 'echec', motif: 'verifications:abonnement_actif' };
      }
      return OK;
    }
    case 'inventaire_externes': {
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      // Figé une fois pour toutes : rejoué après la suppression locale, il
      // conclurait à tort « rien chez le fournisseur ».
      if (d.externes) return OK;
      const inv = await inventorierExternes(uid, deps);
      d.externes = inv.externes;
      d.referencesExternes = inv.references;
      return OK;
    }
    case 'comptes_sociaux_meta': {
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      const r = await deps.base.supprimer('social_accounts', [
        { colonne: 'user_id', op: 'eq', valeur: uid },
        { colonne: 'platform', op: 'in', valeur: [...PLATEFORMES_META] },
      ]);
      return echecBase(r, 'social_accounts') ?? OK;
    }
    case 'photo_profil_meta': {
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      const u = await deps.base.lire('users', 'id, avatar_url', [{ colonne: 'id', op: 'eq', valeur: uid }]);
      if (u.erreur) return { statut: 'echec', motif: 'base:users' };
      if (!u.lignes.some((l) => estPhotoMeta(l.avatar_url))) return OK;
      const r = await deps.base.mettreAJour('users', { avatar_url: '' }, [{ colonne: 'id', op: 'eq', valeur: uid }]);
      return echecBase(r, 'users') ?? OK;
    }
    case 'lien_meta': {
      if (!uid || !d.metaAppli || !d.metaUserId) return { statut: 'echec', motif: 'sans_compte' };
      try { await deps.liensMeta.supprimer(d.metaAppli, d.metaUserId, uid); } catch { return { statut: 'echec', motif: 'liens:indisponible' }; }
      return OK;
    }
    case 'jetons_sociaux':
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      return supprimerTables(TABLES_JETONS, uid, deps);
    case 'stockage':
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      return purgerStockage(uid, deps);
    case 'contenus':
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      return supprimerTables(TABLES_CONTENUS, uid, deps);
    case 'liens_meta':
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      try { await deps.liensMeta.supprimerPourCompte(uid); } catch { return { statut: 'echec', motif: 'liens:indisponible' }; }
      return OK;
    case 'compte': {
      if (!uid) return { statut: 'echec', motif: 'sans_compte' };
      // Anonymisation, pas suppression : `on delete cascade` emporterait la
      // comptabilité conservée. L'adresse devient unique et non routable ;
      // une reconnexion avec l'ancienne adresse crée un compte neuf.
      // Les bases n'ont pas toutes les mêmes colonnes (la prod n'a ni
      // `deleted_at` ni `blocked`) : une colonne ABSENTE est retirée et l'on
      // réessaie. L'adresse anonymisée, elle, est obligatoire — c'est elle
      // qui coupe la session (`lib/auth/etat-compte.ts`).
      const valeurs: Record<string, unknown> = {
        email: `supprime-${uid}@supprime.invalid`,
        name: '',
        avatar_url: '',
        image: null,
        password_hash: null,
        deleted_at: iso(deps),
        blocked: true,
        updated_at: iso(deps),
      };
      for (let essai = 0; essai < 8; essai++) {
        const r = await deps.base.mettreAJour('users', valeurs, [{ colonne: 'id', op: 'eq', valeur: uid }]);
        if (!r.erreur) return OK;
        const absente = r.colonneAbsente;
        if (!absente || absente === 'email' || !(absente in valeurs)) return echecBase(r, 'users')!;
        delete valeurs[absente];
      }
      return { statut: 'echec', motif: 'base:users' };
    }
  }
}

/** Statut global, calculé UNIQUEMENT à partir des étapes. */
export function statutGlobal(etapes: Etape[]): StatutSuppression {
  if (etapes.length > 0 && etapes.every((e) => e.statut === 'terminee')) return 'terminee';
  const faites = etapes.some((e) => e.statut === 'terminee' || e.statut === 'partielle');
  const ratees = etapes.some((e) => e.statut === 'echec' || e.statut === 'partielle');
  if (ratees) return faites ? 'partielle' : 'echec';
  if (etapes.some((e) => e.statut === 'en_cours')) return 'en_cours';
  return faites ? 'en_cours' : 'en_attente';
}

/**
 * Exécute (ou REPREND) une demande. Rejoue seulement les étapes non
 * terminées. Le registre est écrit après chaque étape : une panne au milieu
 * laisse un état exact, jamais « terminée ».
 */
export async function executerDemande(code: string, deps: DependancesSuppression): Promise<DemandeSuppression> {
  if (!CODE_CONFIRMATION.test(code)) throw new RefusSuppression('code_invalide');
  const d = await deps.registre.lire(code);
  if (!d) throw new RefusSuppression('demande_inconnue');
  if (d.statut === 'terminee') return d;
  if (d.userId !== null && !uidValide(d.userId)) throw new RefusSuppression('uid_invalide');

  delete d.motif;
  for (let i = 0; i < d.etapes.length; i++) {
    const e = d.etapes[i];
    if (e.statut === 'terminee') continue;
    if (EXIGE_TOUT.includes(e.id) && d.etapes.slice(0, i).some((p) => p.statut !== 'terminee')) {
      e.statut = 'en_attente';
      e.motif = 'attend_etapes_precedentes';
      continue;
    }
    e.statut = 'en_cours';
    e.tentatives += 1;
    e.maj = iso(deps);
    d.statut = 'en_cours';
    d.majLe = e.maj;
    await deps.registre.ecrire(d);

    let r: ResultatEtape;
    try {
      r = await executerEtape(e.id, d, deps);
    } catch (err) {
      // Une exception d'adaptateur n'est jamais une réussite.
      deps.journal?.('etape_exception', { etape: e.id, erreur: err instanceof Error ? err.message : String(err) });
      r = { statut: 'echec', motif: `${e.id}:exception` };
    }
    e.statut = r.statut;
    if (r.motif) e.motif = r.motif; else delete e.motif;
    e.maj = iso(deps);
    deps.journal?.('etape', { code: d.code, etape: e.id, statut: e.statut, motif: e.motif ?? null });

    if (BLOQUANTES.includes(e.id) && e.statut !== 'terminee') {
      d.motif = e.motif;
      break;
    }
  }
  d.statut = statutGlobal(d.etapes);
  d.majLe = iso(deps);
  await deps.registre.ecrire(d);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────
// Statut public — AUCUNE donnée personnelle
// ─────────────────────────────────────────────────────────────────────────

/** Statut GLOBAL publié : Studiio + fournisseurs externes. */
export type StatutGlobalPublic = StatutSuppression | 'terminee_studiio_externes_restantes';

const MESSAGES: Record<StatutGlobalPublic, string> = {
  en_attente: 'Demande reçue. Elle n’a pas encore été exécutée ; elle est en attente de traitement.',
  en_cours: 'Suppression en cours.',
  terminee: 'Les données concernées par cette demande ont été supprimées.',
  terminee_studiio_externes_restantes: 'Terminée dans Studiio — opérations externes restantes.',
  partielle: 'Suppression partielle : certaines étapes n’ont pas abouti et seront reprises.',
  echec: 'La suppression n’a pas pu être effectuée pour le moment. Elle sera reprise.',
};

/**
 * Opérations externes d'une demande. Une demande de compte dont
 * l'inventaire n'a pas (encore) été fait : tous les fournisseurs sont « à
 * faire » — on ne sait pas, on ne prétend rien.
 */
export function externesDe(d: DemandeSuppression): OperationExterne[] {
  if (d.externes) return d.externes;
  if (d.portee === 'meta') return [];
  return FOURNISSEURS.map((f) => ({ fournisseur: f, action: ACTIONS_EXTERNES[f], etat: 'a_faire_manuellement' as const }));
}

/** Jamais « terminée » tant qu'une opération externe reste à faire. */
export function statutGlobalPublic(d: DemandeSuppression): StatutGlobalPublic {
  if (d.statut !== 'terminee') return d.statut;
  return externesDe(d).some((e) => e.etat === 'a_faire_manuellement') ? 'terminee_studiio_externes_restantes' : 'terminee';
}

export interface StatutPublic {
  confirmation_code: string;
  /** Statut GLOBAL (Studiio + externes). */
  statut: StatutGlobalPublic;
  /** Statut dans Studiio seul. */
  studiio: StatutSuppression;
  externes: { fournisseur: Fournisseur; action: string; etat: EtatExterne }[];
  conserve: string[];
  portee: Portee;
  etapes: { etape: IdEtape; statut: StatutSuppression }[];
  cree_le: string;
  mis_a_jour: string;
  message: string;
}

/**
 * Ce que la page de statut montre : ni uid, ni identifiant Meta, ni motif
 * interne, ni identifiant fournisseur (`referencesExternes` reste privé).
 */
export function statutPublic(d: DemandeSuppression): StatutPublic {
  const statut = statutGlobalPublic(d);
  return {
    confirmation_code: d.code,
    statut,
    studiio: d.statut,
    externes: externesDe(d).map((e) => ({ fournisseur: e.fournisseur, action: e.action, etat: e.etat })),
    conserve: [...CONSERVE_PUBLIC],
    portee: d.portee,
    etapes: d.etapes.map((e) => ({ etape: e.id, statut: e.statut })),
    cree_le: d.creeLe,
    mis_a_jour: d.majLe,
    message: MESSAGES[statut],
  };
}
