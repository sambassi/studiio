/**
 * MON AVATAR — LA PROGRESSION, DÉRIVÉE DE CE QUE LE SERVEUR SAIT.
 *
 * Règle de la page : dès qu'une opération dure plus de quelques secondes,
 * l'écran dit que Studiio travaille, et sur QUOI.
 *
 *   A. un vrai pourcentage existe (octets envoyés)  → on l'affiche ;
 *   B. seuls des étapes / statuts existent          → progression par étapes ;
 *   C. rien n'est mesurable                         → barre indéterminée + texte précis.
 *
 * Aucun pourcentage n'est jamais inventé ici : ce module ne rend QUE des
 * étapes et des textes. Il est PUR (aucun réseau, aucun écran) : après un
 * rechargement, la même entrée serveur redonne exactement la même
 * progression — elle ne « repart » jamais au début.
 */
import type { EtapeProgression, StatutProgression } from '@/components/ux/ProgressStatus';

// ─────────────────────────────────────────────────────────────────────────
// La nouvelle version d'un avatar (version CANDIDATE)
// ─────────────────────────────────────────────────────────────────────────

export type EtatVersionCandidate = 'preparation' | 'entrainement' | 'prete' | 'echec' | 'abandonnee';
/** L'état de l'aperçu d'une version prête, tel que `GET /api/avatars` le relit (`null` = inconnu). */
export type EtatApercuVersion = 'aucun' | 'en_cours' | 'echec' | 'indisponible' | 'pret' | null;

export const ETAPES_VERSION = ['Source', 'Consentement', 'Entraînement', 'Aperçu', 'Validation'] as const;

export interface ProgressionVersion {
  titre: string;
  statut: StatutProgression;
  etapes: EtapeProgression[];
  /** Ce qui se passe maintenant, en une phrase. */
  message: string;
  /** Phrase de rassurance (durée, mise à jour automatique). */
  description?: string;
}

const etapes = (courante: number, echouee = false): EtapeProgression[] =>
  ETAPES_VERSION.map((libelle, i) => ({
    libelle,
    etat: i < courante ? 'terminee' : i === courante ? (echouee ? 'echouee' : 'courante') : 'a_venir',
  }));

/**
 * La progression d'une nouvelle version, depuis son état SERVEUR. La source
 * et le consentement sont toujours faits : une version candidate n'existe
 * qu'après les deux (`POST /api/avatar/create` exige le consentement).
 */
export function progressionVersion(c: { version: number; etat: EtatVersionCandidate; message?: string | null; apercu?: EtatApercuVersion }): ProgressionVersion {
  const titre = `Nouvelle version v${c.version}`;
  if (c.etat === 'echec' || c.etat === 'abandonnee') {
    return {
      titre, statut: 'erreur', etapes: etapes(2, true),
      message: c.etat === 'abandonnee' ? 'Cette version a été mise de côté.' : (c.message || 'La nouvelle version n’a pas pu être créée.'),
    };
  }
  if (c.etat === 'preparation') {
    return {
      titre, statut: 'en_cours', etapes: etapes(2),
      message: 'Envoi de votre source au service de génération…',
      description: 'L’entraînement démarre juste après. Cette page se met à jour toute seule.',
    };
  }
  if (c.etat === 'entrainement') {
    return {
      titre, statut: 'en_cours', etapes: etapes(2),
      message: 'Entraînement de votre avatar en cours…',
      description: 'Cette opération peut prendre plusieurs minutes. Progression exacte indisponible : le service ne rend qu’un statut.',
    };
  }
  // prête : l'étape suivante dépend de l'aperçu, relu en base.
  switch (c.apercu) {
    case 'en_cours':
      return {
        titre, statut: 'en_cours', etapes: etapes(3),
        message: 'Génération de l’aperçu de la nouvelle version…',
        description: 'Cela prend généralement 1 à 5 minutes. Cette page se met à jour toute seule.',
      };
    case 'echec':
    case 'indisponible':
      return { titre, statut: 'erreur', etapes: etapes(3, true), message: 'L’aperçu n’a pas pu être généré.' };
    case 'pret':
      return { titre, statut: 'attente', etapes: etapes(4), message: 'Aperçu prêt : regardez-le, puis choisissez la version à utiliser.' };
    default:
      return { titre, statut: 'attente', etapes: etapes(3), message: 'Entraînement terminé : l’aperçu de la nouvelle version est à générer.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// La génération d'une vidéo avec l'avatar (colonne de droite)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Voix HeyGen : `POST /api/avatar/generate` puis le statut du fournisseur
 * (`pending` → `processing` → `completed`), relu par `/api/avatar/status`
 * qui RE-HÉBERGE la vidéo dans le même appel. Trois étapes réelles.
 */
export type PhaseGenerationHeygen = 'lancement' | 'generation' | 'prete';
export const ETAPES_GENERATION_HEYGEN: ReadonlyArray<{ phase: PhaseGenerationHeygen; libelle: string }> = [
  { phase: 'lancement', libelle: 'Envoi' },
  { phase: 'generation', libelle: 'Génération de l’avatar' },
  { phase: 'prete', libelle: 'Vidéo prête' },
];

/**
 * Voix clonée (moteur du jumeau) : vérification de la voix et du jumeau, puis
 * les phases RÉELLES de `genererEtAttendreVideoJumeau` — envoi (synthèse de
 * la voix + dépôt de l'audio), traitement (le fournisseur anime l'avatar),
 * stockage (vidéo rapatriée chez Studiio). Pas de montage ici.
 */
export type PhaseGenerationJumeau = 'verification' | 'envoi' | 'traitement' | 'stockage' | 'prete';
export const ETAPES_GENERATION_JUMEAU: ReadonlyArray<{ phase: PhaseGenerationJumeau; libelle: string }> = [
  { phase: 'verification', libelle: 'Vérification de la voix' },
  { phase: 'envoi', libelle: 'Préparation audio' },
  { phase: 'traitement', libelle: 'Génération de l’avatar' },
  { phase: 'stockage', libelle: 'Finalisation' },
  { phase: 'prete', libelle: 'Vidéo prête' },
];

export const DETAIL_GENERATION: Record<PhaseGenerationHeygen | PhaseGenerationJumeau, string> = {
  verification: 'Vérification de votre voix clonée et de votre avatar…',
  lancement: 'Envoi de votre texte au service de génération…',
  envoi: 'Synthèse de votre voix et envoi de l’audio…',
  generation: 'Génération de votre avatar en cours…',
  traitement: 'Génération de votre avatar en cours…',
  stockage: 'Vidéo reçue — enregistrement dans Studiio…',
  prete: 'Vidéo prête.',
};

/** Les étapes au format `ProgressStatus` : terminées avant, courante (ou échouée), à venir après. */
export function etapesGeneration<P extends string>(
  liste: ReadonlyArray<{ phase: P; libelle: string }>, phase: P, echec = false,
): EtapeProgression[] {
  const i = liste.findIndex((p) => p.phase === phase);
  const fin = i === liste.length - 1;
  return liste.map((p, k) => ({
    libelle: p.libelle,
    etat: k < i || (fin && k === i && !echec) ? 'terminee' : k === i ? (echec ? 'echouee' : 'courante') : 'a_venir',
  }));
}

/** Le statut fournisseur, dit en clair — jamais un pourcentage. */
export function detailStatutFournisseur(statut: string | null | undefined): string | null {
  if (statut === 'pending') return 'En file d’attente chez le service de génération.';
  if (statut === 'processing') return 'Le service de génération anime votre avatar.';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Reprise après rechargement
// ─────────────────────────────────────────────────────────────────────────

/**
 * La génération EN COURS, mémorisée dans le navigateur dès que le serveur
 * l'a acceptée : un rechargement reprend le SUIVI de la même génération
 * (simple lecture de statut — aucun nouveau lancement, aucun débit).
 */
export const CLE_GENERATION_EN_COURS = 'studiio:avatar:generation-en-cours';
export interface GenerationEnCours { generationId: string; mode: 'heygen' | 'jumeau'; avatarId: string; debutLe: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Relit l'entrée mémorisée — illisible, mal formée ou périmée (> 35 min, au-delà du verdict serveur) : `null`. */
export function lireGenerationEnCours(brut: string | null, maintenant = Date.now()): GenerationEnCours | null {
  if (!brut) return null;
  try {
    const g = JSON.parse(brut) as Partial<GenerationEnCours>;
    if (typeof g.generationId !== 'string' || !UUID.test(g.generationId)) return null;
    if (g.mode !== 'heygen' && g.mode !== 'jumeau') return null;
    if (typeof g.avatarId !== 'string' || !g.avatarId) return null;
    if (typeof g.debutLe !== 'number' || !Number.isFinite(g.debutLe) || maintenant - g.debutLe > 35 * 60 * 1000) return null;
    return { generationId: g.generationId, mode: g.mode, avatarId: g.avatarId, debutLe: g.debutLe };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Le parcours d'une nouvelle source (Remplacer / Créer un nouvel avatar)
// ─────────────────────────────────────────────────────────────────────────

/** Le format d'une source, d'après ses dimensions RÉELLES (image chargée, vidéo préparée) — `null` si inconnues. */
export function formatSource(largeur: number | null | undefined, hauteur: number | null | undefined): string | null {
  if (!largeur || !hauteur || largeur <= 0 || hauteur <= 0) return null;
  const r = largeur / hauteur;
  const proches: Array<[string, number]> = [['9:16', 9 / 16], ['3:4', 3 / 4], ['4:5', 4 / 5], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]];
  const [nom, valeur] = proches.reduce((m, p) => (Math.abs(p[1] - r) < Math.abs(m[1] - r) ? p : m));
  return Math.abs(valeur - r) / valeur <= 0.03 ? `${nom} (${largeur} × ${hauteur})` : `${largeur} × ${hauteur}`;
}

export type EtapeParcoursSource = 'source' | 'preparation' | 'consentement' | 'recapitulatif' | 'lancement';
/** Les étapes du parcours, dans l'ordre ; la préparation (recadrage, coupe, améliorer) n'existe que pour une vidéo. */
export function etapesParcoursSource(type: 'photo' | 'video'): Array<{ cle: EtapeParcoursSource; libelle: string }> {
  return [
    { cle: 'source', libelle: 'Source' },
    ...(type === 'video' ? [{ cle: 'preparation' as const, libelle: 'Recadrer, couper, améliorer' }] : []),
    { cle: 'consentement', libelle: 'Consentement' },
    { cle: 'recapitulatif', libelle: 'Récapitulatif' },
    { cle: 'lancement', libelle: 'Lancement' },
  ];
}
