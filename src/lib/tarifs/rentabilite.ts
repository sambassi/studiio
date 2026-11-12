/**
 * RENTABILITÉ D'UN TARIF — le prix en crédits couvre-t-il ce que le
 * fournisseur nous facture ? Fonction PURE, réservée à l'ADMINISTRATION.
 *
 * Ce module ne fixe aucun prix et n'en change aucun : il CONFRONTE la grille
 * en vigueur (`lib/tarifs/serveur`) aux coûts fournisseurs DÉJÀ vérifiés
 * ailleurs dans le dépôt, et nomme les tarifs vendus à perte ou vendus à
 * l'aveugle. Trois règles, reprises des modules de coût existants
 * (`fournisseurs/tarifs-heygen.ts`, `cinema/generation/couts.ts`) :
 *
 *  1. UN COÛT NON VÉRIFIÉ N'EST PAS ZÉRO. Sans tarif officiel lu et daté,
 *     `coutUsd: null` et `verdict: 'inconnu'` — jamais « rentable ».
 *  2. ON NE SOUS-ESTIME JAMAIS. Quand le coût dépend du moteur ou du type
 *     d'avatar, on retient le PIRE CAS autorisé par le plafond serveur
 *     (`AVATAR_MAX_SCRIPT_CHARS`), pas le cas favorable.
 *  3. AUCUN TAUX DE CHANGE INVENTÉ. Le coût est en USD, la recette en CHF.
 *     Plutôt que de convertir avec un taux imaginaire, on rend le TAUX
 *     D'ÉQUILIBRE : « rentable seulement si 1 USD vaut moins de X CHF ».
 *     Un taux réel et daté, saisi par l'admin, tranche ensuite sans
 *     ambiguïté ; absent, le verdict reste `inconnu` plutôt que faux.
 */
import {
  CLES_TARIF,
  type CleTarif,
  type CoutFournisseur,
  type GrilleTarifs,
} from './catalogue';
import { AVATAR_MAX_SCRIPT_CHARS } from '@/lib/stripe/constants';
import { SPEECH_CHARS_PER_SECOND } from '@/lib/creer/voiceFit';
import { TARIFS_HEYGEN_USD_PAR_MIN, moteurFacture } from '@/lib/fournisseurs/tarifs-heygen';
import { SOURCE_TARIFS_HEYGEN } from '@/lib/fournisseurs/devis-fournisseur';

export type VerdictRentabilite = 'rentable' | 'perte' | 'inconnu';

export const MESSAGE_COUT_NON_VERIFIE =
  'Coût fournisseur non vérifié pour ce tarif : rentabilité inconnue, pas nulle.';
export const SOURCE_RENDU_LOCAL = 'rendu local (serveur Studiio), aucun appel fournisseur sortant';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * COÛTS UNITAIRES RELEVÉS SUR LES GRILLES PUBLIQUES, LE 2026-11-12
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque montant vient d'une page tarifaire PUBLIQUE, lisible sans compte et
 * sans appel payant. Deux disciplines, les mêmes que pour HeyGen :
 *
 *   - LE PIRE CAS, jamais la moyenne. Un modèle facturé par palier (selon la
 *     résolution ou la durée) est tarifé au palier le plus cher : un devis ne
 *     doit pas sous-estimer.
 *   - LA SOURCE ET LA DATE accompagnent le chiffre. Un montant sans source est
 *     un montant inventé, et six mois plus tard personne ne peut le vérifier.
 *
 * Correspondance action → modèle relevée dans `src/app/api/ai/image/route.ts`
 * (constante `MODELS` et les `case` de chaque action).
 */
const LU_LE = '2026-11-12';

interface CoutReleve {
  usd: number;
  unite: string;
  source: string;
}

const C = (usd: number, unite: string, source: string): CoutReleve => ({ usd, unite, source });

/** Les grilles publiques, par clé tarifaire. */
const COUTS_RELEVES: Partial<Record<CleTarif, CoutReleve>> = {
  // ── Audio ───────────────────────────────────────────────────────────────
  // Trois moteurs de voix coexistent : Edge (gratuit), la voix naturelle
  // ($0,03 / 1000 car.) et la voix premium ($0,08 / 1000 car. en multilingue).
  // Le plancher est posé sur LE PLUS CHER : c'est celui que l'utilisateur peut
  // choisir, donc celui qu'il faut couvrir.
  'audio.full_1000_chars': C(
    0.08, '1000 caractères (moteur le plus cher)',
    `grille API publique du moteur de voix premium, lue le ${LU_LE} : « Text to Speech $0.08 per 1,000 characters (multilingual models) », facturé au caractère`,
  ),

  // ── Rendus : locaux, aucun appel sortant ───────────────────────────────
  'render.reel': C(0, '1 rendu', SOURCE_RENDU_LOCAL),
  'render.tv': C(0, '1 rendu', SOURCE_RENDU_LOCAL),
  'render.infographic': C(0, '1 rendu', SOURCE_RENDU_LOCAL),

  // ── IA image ───────────────────────────────────────────────────────────
  'ai.remove_background': C(
    0.0038, '1 image',
    `grille publique du modèle de détourage, lue le ${LU_LE} : « approximately $0.0038 to run », GPU L40S, ~4 s`,
  ),
  'ai.magic_layers': C(
    0.0038, '1 image',
    `même modèle de détourage que la suppression d'arrière-plan (route IA image), lu le ${LU_LE} : « approximately $0.0038 to run »`,
  ),
  'ai.upscale': C(
    0.002, '1 image',
    `grille publique du modèle d'agrandissement, lue le ${LU_LE} : « $2 per thousand output images »`,
  ),
  'ai.ocr': C(
    0.0021, '1 image',
    `grille publique du modèle de reconnaissance de texte, lue le ${LU_LE} : « approximately $0.0021 to run », CPU, ~22 s`,
  ),
  // Gomme, édition, transfert de style et génération d'affiche passent tous
  // par le MÊME modèle d'édition d'image.
  'ai.magic_eraser': C(
    0.04, '1 image',
    `grille publique du modèle d'édition d'image, lue le ${LU_LE} : « $0.04 per output image, or 25 images for $1 »`,
  ),
  'ai.magic_edit': C(
    0.04, '1 image',
    `grille publique du modèle d'édition d'image, lue le ${LU_LE} : « $0.04 per output image »`,
  ),
  'ai.style_transfer': C(
    0.04, '1 image',
    `grille publique du modèle d'édition d'image, lue le ${LU_LE} : « $0.04 per output image »`,
  ),
  'ai.generate_background': C(
    0.04, '1 image',
    `grille publique du modèle d'édition d'image, lue le ${LU_LE} : « $0.04 per output image » — palier le plus cher des deux voies (texte seul : « $3.00 / thousand output images »)`,
  ),
  'autopilot.poster_reference': C(
    0.04, '1 affiche',
    `même voie que la génération d'arrière-plan (cf. lib/autopilot/produire.ts), palier le plus cher, lu le ${LU_LE} : « $0.04 per output image »`,
  ),
  'ai.image_to_video': C(
    0.145, '1 vidéo courte (palier le plus cher)',
    `grille publique du modèle image-vers-vidéo, lue le ${LU_LE} : paliers « $0.05 », « $0.11 » et « $0.145 per output video » selon résolution et durée — le plus cher est retenu`,
  ),
};

/**
 * Durée de parole MAXIMALE qu'un avatar peut facturer : le plafond de script
 * du serveur, à la cadence de lecture retenue par le montage. C'est le pire
 * cas réellement atteignable, donc la base du devis.
 */
export const SECONDES_AVATAR_PIRE_CAS = Math.ceil(AVATAR_MAX_SCRIPT_CHARS / SPEECH_CHARS_PER_SECOND);

export interface CoutVerifieTarif {
  /** USD pour UNE opération au pire cas. `null` = non vérifié. */
  usd: number | null;
  unite: string;
  source: string;
}

const arrondi = (v: number, pas = 10_000) => Math.round(v * pas) / pas;

/** Le plus cher des types d'avatar servis par ce moteur — jamais le moins cher. */
function usdParMinutePireCas(moteur: string): number | null {
  const grille = TARIFS_HEYGEN_USD_PAR_MIN[moteur];
  if (!grille) return null;
  const valeurs = Object.values(grille).filter((v): v is number => typeof v === 'number');
  return valeurs.length ? Math.max(...valeurs) : null;
}

function coutAvatar(moteur: string): CoutVerifieTarif {
  const parMin = usdParMinutePireCas(moteur);
  return {
    usd: parMin === null ? null : arrondi((SECONDES_AVATAR_PIRE_CAS / 60) * parMin),
    unite: `1 génération de ${SECONDES_AVATAR_PIRE_CAS} s (plafond de script)`,
    source: parMin === null ? MESSAGE_COUT_NON_VERIFIE : SOURCE_TARIFS_HEYGEN,
  };
}

/**
 * Le coût fournisseur VÉRIFIÉ d'un tarif, ou `null` quand il ne l'est pas.
 *
 * Volontairement incomplet : `/api/ai/image` appelle plusieurs modèles
 * Replicate dont le prix n'a pas été lu sur une page officielle (dont
 * `wan-2.2-i2v-fast`, absent de la grille publique — cf.
 * `cinema/generation/couts.ts`). Les déclarer `null` est ce qui rend leur
 * absence VISIBLE à l'admin au lieu de la faire passer pour gratuite.
 */
export function coutVerifie(cle: CleTarif): CoutVerifieTarif {
  switch (cle) {
    // L'avatar se calcule : son coût dépend du moteur et de la durée.
    case 'avatar.avatar_iii': return coutAvatar('avatar_iii');
    case 'avatar.avatar_iv': return coutAvatar('avatar_iv');
    case 'avatar.avatar_v': return coutAvatar('avatar_v');
    // Jumeau : le moteur n'est pas envoyé, le fournisseur applique son défaut.
    case 'avatar.jumeau': return coutAvatar(moteurFacture(null));
    default: {
      const releve = COUTS_RELEVES[cle];
      if (!releve) return { usd: null, unite: '', source: MESSAGE_COUT_NON_VERIFIE };
      return { usd: releve.usd, unite: releve.unite, source: releve.source };
    }
  }
}

/** Les clés dont le coût fournisseur est relevé sur une grille publique. */
export function clesAvecCoutReleve(): CleTarif[] {
  return Object.keys(COUTS_RELEVES) as CleTarif[];
}

/**
 * Marge brute visée au-dessus du coût fournisseur, pour le PRIX CONSEILLÉ.
 * 0,40 = « vendre 40 % au-dessus du coût ». C'est un point de départ, pas une
 * vérité : la valeur réellement appliquée vient de la configuration admin.
 */
export const MARGE_CIBLE_DEFAUT = 0.4;

/** Bornes de bon sens : une marge négative n'est pas une marge. */
export const MARGE_MIN = 0;
export const MARGE_MAX = 10;

export function margeValide(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= MARGE_MIN && v <= MARGE_MAX;
}

export interface LigneRentabilite {
  cle: CleTarif;
  prixCredits: number;
  /** Recette CHF de l'opération, si la valeur du crédit est configurée. */
  revenuChf: number | null;
  coutUsd: number | null;
  uniteCout: string;
  sourceCout: string;
  /** Coût saisi à la main par l'admin (CHF), s'il existe. */
  coutAdminChf: number | null;
  /**
   * Taux maximal auquel l'opération reste rentable : « rentable seulement si
   * 1 USD < X CHF ». `null` si la recette ou le coût manque. Un coût nul rend
   * `Infinity` — rentable à tout taux.
   */
  tauxEquilibreChfParUsd: number | null;
  /** Marge CHF, seulement quand elle est calculable sans taux inventé. */
  margeChf: number | null;
  verdict: VerdictRentabilite;
  motif: string;
  /**
   * Prix minimal en crédits pour ne PAS vendre à perte, arrondi au crédit
   * SUPÉRIEUR (arrondir vers le bas vendrait sous le coût). `null` dès qu'un
   * élément manque : coût inconnu, valeur du crédit ou taux non configurés.
   */
  prixPlancherCredits: number | null;
  /** Plancher + marge visée, même arrondi. `null` aux mêmes conditions. */
  prixConseilleCredits: number | null;
}

export interface EntreeAnalyse {
  prix: GrilleTarifs;
  valeurCreditChf: number | null;
  coutsFournisseur?: Partial<Record<CleTarif, CoutFournisseur>>;
  /** Taux réel et daté, saisi par l'admin. Absent = aucun verdict en USD. */
  tauxChfParUsd?: number | null;
  /** Marge visée pour le prix conseillé. Absente = `MARGE_CIBLE_DEFAUT`. */
  margeCible?: number | null;
}

/**
 * Du coût en CHF au prix en crédits. Arrondi au crédit SUPÉRIEUR, et au moins
 * 1 crédit dès qu'il y a un coût : une opération qui coûte ne peut pas être
 * facturée 0.
 */
function creditsPour(coutChf: number, valeurCreditChf: number): number {
  if (coutChf <= 0) return 0;
  return Math.max(1, Math.ceil(coutChf / valeurCreditChf));
}

function verdictDepuisMarge(margeChf: number): VerdictRentabilite {
  return margeChf < 0 ? 'perte' : 'rentable';
}

export function analyserTarif(cle: CleTarif, e: EntreeAnalyse): LigneRentabilite {
  const prixCredits = e.prix[cle];
  const valeur = typeof e.valeurCreditChf === 'number' && e.valeurCreditChf > 0 ? e.valeurCreditChf : null;
  const revenuChf = valeur === null ? null : arrondi(prixCredits * valeur);
  const { usd, unite, source } = coutVerifie(cle);
  const coutAdminChf = e.coutsFournisseur?.[cle]?.chf ?? null;
  const taux = typeof e.tauxChfParUsd === 'number' && e.tauxChfParUsd > 0 ? e.tauxChfParUsd : null;
  const marge = margeValide(e.margeCible) ? e.margeCible : MARGE_CIBLE_DEFAUT;

  // Le coût de référence pour le plancher : celui saisi en CHF s'il existe,
  // sinon le coût vérifié converti — et rien du tout sans taux.
  const coutChf = coutAdminChf !== null ? coutAdminChf : (usd !== null && taux !== null ? usd * taux : null);
  const prixPlancherCredits = valeur === null || coutChf === null ? null : creditsPour(coutChf, valeur);
  const prixConseilleCredits = valeur === null || coutChf === null ? null : creditsPour(coutChf * (1 + marge), valeur);
  const planchers = { prixPlancherCredits, prixConseilleCredits };

  // 1. Le coût saisi par l'admin est déjà en CHF : il tranche sans taux.
  if (revenuChf !== null && coutAdminChf !== null) {
    const margeDirecte = arrondi(revenuChf - coutAdminChf);
    const ligne: LigneRentabilite = {
      cle, prixCredits, revenuChf, coutUsd: usd, uniteCout: unite, sourceCout: source,
      coutAdminChf,
      ...planchers,
      tauxEquilibreChfParUsd: usd === null ? null : usd === 0 ? Infinity : arrondi(revenuChf / usd),
      margeChf: margeDirecte,
      verdict: verdictDepuisMarge(margeDirecte),
      motif: margeDirecte < 0
        ? `Vendu à perte : ${prixCredits} crédits = ${revenuChf} CHF pour ${coutAdminChf} CHF de coût saisi.`
        : 'Couvre le coût fournisseur saisi par l’administration.',
    };
    return ligne;
  }

  // 2. Sinon le coût vérifié, en USD : taux d'équilibre, et verdict seulement
  //    si un taux réel est configuré.
  if (revenuChf === null) {
    return {
      cle, prixCredits, revenuChf: null, coutUsd: usd, uniteCout: unite, sourceCout: source,
      coutAdminChf, ...planchers, tauxEquilibreChfParUsd: null, margeChf: null, verdict: 'inconnu',
      motif: 'Valeur du crédit non configurée : aucune recette calculable.',
    };
  }
  if (usd === null) {
    return {
      cle, prixCredits, revenuChf, coutUsd: null, uniteCout: unite, sourceCout: source,
      coutAdminChf, ...planchers, tauxEquilibreChfParUsd: null, margeChf: null, verdict: 'inconnu',
      motif: MESSAGE_COUT_NON_VERIFIE,
    };
  }
  if (usd === 0) {
    return {
      cle, prixCredits, revenuChf, coutUsd: 0, uniteCout: unite, sourceCout: source,
      coutAdminChf, ...planchers, tauxEquilibreChfParUsd: Infinity, margeChf: revenuChf, verdict: 'rentable',
      motif: 'Aucun coût fournisseur : rendu local.',
    };
  }
  const equilibre = arrondi(revenuChf / usd);
  if (taux === null) {
    return {
      cle, prixCredits, revenuChf, coutUsd: usd, uniteCout: unite, sourceCout: source,
      coutAdminChf, ...planchers, tauxEquilibreChfParUsd: equilibre, margeChf: null, verdict: 'inconnu',
      motif: `Rentable seulement si 1 USD vaut moins de ${equilibre} CHF. Taux non configuré : verdict suspendu.`,
    };
  }
  const margeFinale = arrondi(revenuChf - usd * taux);
  return {
    cle, prixCredits, revenuChf, coutUsd: usd, uniteCout: unite, sourceCout: source,
    coutAdminChf, ...planchers, tauxEquilibreChfParUsd: equilibre, margeChf: margeFinale,
    verdict: verdictDepuisMarge(margeFinale),
    motif: margeFinale < 0
      ? `Vendu à perte : ${prixCredits} crédits = ${revenuChf} CHF pour ${usd} USD de coût (${unite}).`
      : `Couvre le coût fournisseur (${usd} USD, ${unite}).`,
  };
}

export function analyserGrille(e: EntreeAnalyse): LigneRentabilite[] {
  return CLES_TARIF.map((cle) => analyserTarif(cle, e));
}

export interface ResumeRentabilite {
  pertes: number;
  inconnus: number;
  rentables: number;
  /** Les clés vendues à perte, pour l'alerte administrateur. */
  clesEnPerte: CleTarif[];
  /** Les clés dont le coût fournisseur n'a jamais été vérifié. */
  clesSansCout: CleTarif[];
  /**
   * La grille rentable proposée : seulement les clés dont le prix actuel est
   * sous le prix conseillé. Rien n'est appliqué — c'est une proposition.
   */
  grilleConseillee: Partial<Record<CleTarif, number>>;
}

export function resumeRentabilite(lignes: readonly LigneRentabilite[]): ResumeRentabilite {
  return {
    pertes: lignes.filter((l) => l.verdict === 'perte').length,
    inconnus: lignes.filter((l) => l.verdict === 'inconnu').length,
    rentables: lignes.filter((l) => l.verdict === 'rentable').length,
    clesEnPerte: lignes.filter((l) => l.verdict === 'perte').map((l) => l.cle),
    clesSansCout: lignes.filter((l) => l.coutUsd === null && l.coutAdminChf === null).map((l) => l.cle),
    grilleConseillee: Object.fromEntries(
      lignes
        .filter((l) => l.prixConseilleCredits !== null && l.prixConseilleCredits > l.prixCredits)
        .map((l) => [l.cle, l.prixConseilleCredits as number]),
    ),
  };
}
