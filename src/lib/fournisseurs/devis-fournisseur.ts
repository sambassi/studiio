/**
 * DEVIS FOURNISSEUR — ce qu'une opération va coûter CHEZ LE FOURNISSEUR,
 * calculé AVANT tout appel payant. Fonction PURE (aucun appel réseau).
 *
 * « 0 crédit Studiio » (admin exempté) ≠ « gratuit chez HeyGen » : le devis
 * porte toujours les deux, séparés (`creditsStudiio` / `coutUsd`).
 *
 * RÈGLE ABSOLUE : jamais de prix inventé. Moteur inconnu, durée inconnue ou
 * opération sans tarif public (création / entraînement d'un avatar) →
 * `prixConnu: false`, `coutUsd: null`, et un avertissement explicite.
 */
import { TARIFS_HEYGEN_USD_PAR_MIN, typeTarif } from '@/lib/fournisseurs/tarifs-heygen';

export const SOURCE_TARIFS_HEYGEN =
  'Tarifs API HeyGen (help.heygen.com/en/articles/10060327, page du 16/09/2026, lue le 13/10/2026) — facturé à la seconde générée';

export type OperationFournisseur =
  | 'creation_avatar'
  | 'apercu_avatar'
  | 'video_avatar'
  | 'video_autopilote'
  | 'relance_video';

export const LIBELLE_OPERATION: Record<OperationFournisseur, string> = {
  creation_avatar: 'Création d’un nouvel avatar / Digital Twin',
  apercu_avatar: 'Aperçu de l’avatar',
  video_avatar: 'Génération vidéo avatar',
  video_autopilote: 'Vidéo avatar de l’Autopilote',
  relance_video: 'Nouvelle génération vidéo (relance)',
};

export const LIBELLE_MOTEUR: Record<string, string> = {
  avatar_iii: 'Avatar III',
  avatar_iv: 'Avatar IV',
  avatar_v: 'Avatar V',
};

export const MESSAGE_PRIX_INCONNU =
  'Coût fournisseur : montant exact non disponible. Cette opération peut être facturée par HeyGen.';
/** Contrat de la confirmation (serveur ↔ navigateur). */
export const CODE_CONFIRMATION_COUT = 'confirmation_cout_fournisseur';
export const CHAMP_CONFIRMATION_COUT = 'confirmationCoutFournisseur';

export const MESSAGE_AUCUN_APPEL = 'Aucun nouvel appel vidéo fournisseur prévu.';

export interface Intervalle { min: number; max: number }

export interface DevisFournisseur {
  fournisseur: 'heygen';
  operation: OperationFournisseur;
  libelleOperation: string;
  /** Moteur FACTURÉ (`null` : sans objet ou inconnu). */
  moteur: string | null;
  /** Le moteur n'est pas envoyé : HeyGen applique son défaut (Avatar IV). */
  moteurImplicite: boolean;
  typeAvatar: 'twin' | 'photo' | null;
  dureeSecondes: Intervalle | null;
  /** D'où vient la durée : audio mesuré, texte estimé, ou plage prudente. */
  origineDuree: 'audio' | 'texte' | 'plage' | null;
  tarifUsdParSeconde: number | null;
  coutUsd: Intervalle | null;
  prixConnu: boolean;
  source: string;
  /** Crédits Studiio débités à l'utilisateur (0 pour l'admin) — distinct du coût fournisseur. */
  creditsStudiio: number | null;
  avertissement: string | null;
}

const arrondi = (v: number, pas = 100) => Math.round(v * pas) / pas;

/** Tarif USD/seconde du moteur et du type, `null` si inconnu (jamais un repli sur un autre moteur). */
export function tarifUsdParSeconde(moteur: string | null | undefined, typeAvatar: 'twin' | 'photo'): number | null {
  if (!moteur) return null;
  const grille = TARIFS_HEYGEN_USD_PAR_MIN[moteur];
  const parMin = grille?.[typeAvatar];
  return typeof parMin === 'number' ? parMin / 60 : null;
}

/**
 * Durée de parole d'un texte, en PLAGE (≈ 2,6 mots/s ± 15 %, au moins 3 s) —
 * la même cadence que l'estimation du montage (`estimerDureeParole`).
 */
export function dureeParoleEstimee(textes: ReadonlyArray<string | null | undefined>): Intervalle | null {
  const mots = textes.join(' ').split(/\s+/).filter(Boolean).length;
  if (!mots) return null;
  const centre = Math.max(3, mots / 2.6);
  return { min: Math.max(1, Math.floor(centre * 0.85)), max: Math.ceil(centre * 1.15) };
}

/** Devis d'une VIDÉO HeyGen (aperçu, Créer, Mon avatar, Autopilote, relance). */
export function devisVideoHeygen(args: {
  operation: OperationFournisseur;
  /** Moteur ENVOYÉ à HeyGen ; `null` = non envoyé (HeyGen facture Avatar IV). */
  moteurEnvoye: string | null;
  avatarType: string | null | undefined;
  dureeSecondes: Intervalle | null;
  origineDuree?: DevisFournisseur['origineDuree'];
  creditsStudiio?: number | null;
}): DevisFournisseur {
  const moteurImplicite = args.moteurEnvoye === null;
  const moteur = moteurImplicite ? 'avatar_iv' : args.moteurEnvoye;
  const type = typeTarif(args.avatarType);
  const tarif = tarifUsdParSeconde(moteur, type);
  const d = args.dureeSecondes;
  const coutUsd = tarif !== null && d ? { min: arrondi(d.min * tarif), max: arrondi(d.max * tarif) } : null;
  const avertissement = tarif === null
    ? `Moteur ${moteur ?? 'inconnu'} sans tarif connu : ${MESSAGE_PRIX_INCONNU}`
    : !d ? `Durée inconnue avant génération : ${MESSAGE_PRIX_INCONNU}` : null;
  return {
    fournisseur: 'heygen',
    operation: args.operation,
    libelleOperation: LIBELLE_OPERATION[args.operation],
    moteur,
    moteurImplicite,
    typeAvatar: type,
    dureeSecondes: d,
    origineDuree: d ? (args.origineDuree ?? 'texte') : null,
    tarifUsdParSeconde: tarif === null ? null : arrondi(tarif, 10_000),
    coutUsd,
    prixConnu: coutUsd !== null,
    source: SOURCE_TARIFS_HEYGEN,
    creditsStudiio: args.creditsStudiio ?? null,
    avertissement,
  };
}

/**
 * Devis d'une CRÉATION / d'un entraînement d'avatar (POST /v3/avatars) :
 * HeyGen ne publie AUCUN tarif pour cette opération — jamais de montant.
 */
export function devisCreationAvatar(args: { avatarType: string | null | undefined; creditsStudiio?: number | null }): DevisFournisseur {
  return {
    fournisseur: 'heygen',
    operation: 'creation_avatar',
    libelleOperation: LIBELLE_OPERATION.creation_avatar,
    moteur: null,
    moteurImplicite: false,
    typeAvatar: typeTarif(args.avatarType),
    dureeSecondes: null,
    origineDuree: null,
    tarifUsdParSeconde: null,
    coutUsd: null,
    prixConnu: false,
    source: 'Aucun tarif public HeyGen pour la création d’avatar par l’API (vérifié le 13/10/2026)',
    creditsStudiio: args.creditsStudiio ?? null,
    avertissement: MESSAGE_PRIX_INCONNU,
  };
}

/** « ≈ 0,47 $ » / « 0,42–0,48 $ » / « montant exact non disponible ». */
export function libelleCoutUsd(c: Intervalle | null): string {
  if (!c) return 'montant exact non disponible';
  const f = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c.min === c.max ? `≈ ${f(c.min)} $` : `≈ ${f(c.min)}–${f(c.max)} $`;
}

export function libelleDuree(d: Intervalle | null): string {
  if (!d) return 'inconnue';
  return d.min === d.max ? `${d.min} s` : `${d.min}–${d.max} s`;
}

/** Jours d'un cycle Autopilote (miroir de `CADENCE_DAYS`). */
const JOURS_CADENCE: Record<string, number> = { daily: 1, every_2_days: 2, weekly: 7 };

export interface BudgetAutopilote {
  avatarUtilise: boolean;
  coutParVideoUsd: Intervalle | null;
  videosParJour: number;
  coutJournalierUsd: Intervalle | null;
  coutMensuelUsd: Intervalle | null;
  prixConnu: boolean;
  source: string;
}

/**
 * Budget fournisseur ESTIMÉ de l'Autopilote — une estimation pour l'admin,
 * jamais un prélèvement. Sans avatar : aucune vidéo HeyGen, coût 0.
 * Mois = 30 jours.
 */
export function budgetAutopilote(args: {
  avatarUtilise: boolean;
  enabled?: boolean;
  countPerCycle: number;
  cadence: string;
  devisParVideo: DevisFournisseur | null;
}): BudgetAutopilote {
  const jours = JOURS_CADENCE[args.cadence] ?? 1;
  const videosParJour = arrondi(Math.max(0, args.countPerCycle) / jours, 1000);
  if (!args.avatarUtilise) {
    const zero = { min: 0, max: 0 };
    return { avatarUtilise: false, coutParVideoUsd: zero, videosParJour, coutJournalierUsd: zero, coutMensuelUsd: zero, prixConnu: true, source: 'Sans avatar : aucune vidéo HeyGen' };
  }
  const c = args.devisParVideo?.coutUsd ?? null;
  const mult = (k: number) => (c ? { min: arrondi(c.min * k), max: arrondi(c.max * k) } : null);
  return {
    avatarUtilise: true,
    coutParVideoUsd: c,
    videosParJour,
    coutJournalierUsd: mult(videosParJour),
    coutMensuelUsd: mult(videosParJour * 30),
    prixConnu: c !== null,
    source: args.devisParVideo?.source ?? SOURCE_TARIFS_HEYGEN,
  };
}

// ── Présentation (pure, testée) ────────────────────────────────────────────

/** Ce que la confirmation affiche, ligne par ligne. */
export function lignesDevis(d: DevisFournisseur): Array<{ libelle: string; valeur: string }> {
  const moteur = d.moteur
    ? `${LIBELLE_MOTEUR[d.moteur] ?? d.moteur}${d.moteurImplicite ? ' (aucun moteur envoyé : défaut HeyGen)' : ''}`
    : 'sans objet';
  const origine = d.origineDuree === 'audio' ? 'audio mesuré' : d.origineDuree === 'texte' ? 'estimée depuis le texte' : d.origineDuree === 'plage' ? 'plage prudente' : '';
  const lignes = [
    { libelle: 'Fournisseur', valeur: 'HeyGen' },
    { libelle: 'Opération', valeur: d.libelleOperation },
  ];
  if (d.operation !== 'creation_avatar') {
    lignes.push(
      { libelle: 'Moteur', valeur: moteur },
      { libelle: 'Durée estimée', valeur: `${libelleDuree(d.dureeSecondes)}${origine ? ` (${origine})` : ''}` },
      { libelle: 'Tarif', valeur: d.tarifUsdParSeconde !== null ? `${d.tarifUsdParSeconde.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} $ / seconde` : 'non publié' },
    );
  }
  lignes.push(
    { libelle: 'Coût fournisseur estimé', valeur: libelleCoutUsd(d.coutUsd) },
    { libelle: 'Crédits Studiio débités', valeur: d.creditsStudiio === null ? 'selon votre offre' : String(d.creditsStudiio) },
    { libelle: 'Source du tarif', valeur: d.source },
  );
  return lignes;
}

/** Le libellé du bouton qui LANCE l'opération : il porte le coût, ou dit qu'il est variable. */
export function libelleContinuer(d: DevisFournisseur, avatarExistant: boolean): string {
  if (d.operation === 'creation_avatar') {
    return avatarExistant ? 'Créer une nouvelle version — coût fournisseur possible' : 'Créer l’avatar malgré le coût fournisseur variable';
  }
  return d.coutUsd ? `Continuer — coût estimé ${libelleCoutUsd(d.coutUsd)}` : 'Continuer malgré le coût fournisseur inconnu';
}

/** Le budget Autopilote, en lignes lisibles (admin). */
export function lignesBudgetAutopilote(b: BudgetAutopilote, devisParVideo: DevisFournisseur | null): string[] {
  const parJour = b.videosParJour.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  if (!b.avatarUtilise) return [`Sans avatar : aucune vidéo HeyGen — coût fournisseur 0 $ (${parJour} vidéo(s) / jour).`];
  const moteur = devisParVideo?.moteur ? LIBELLE_MOTEUR[devisParVideo.moteur] ?? devisParVideo.moteur : null;
  const detail = devisParVideo
    ? ` (HeyGen ${moteur ?? ''}, ${libelleDuree(devisParVideo.dureeSecondes)}${devisParVideo.origineDuree === 'plage' ? ', plage prudente' : ''})`
    : '';
  return [
    `Par vidéo : ${libelleCoutUsd(b.coutParVideoUsd)}${detail}`,
    `Vidéos prévues : ${parJour} / jour`,
    `Par jour : ${libelleCoutUsd(b.coutJournalierUsd)}`,
    `Par mois (30 j) : ${libelleCoutUsd(b.coutMensuelUsd)}`,
  ];
}
