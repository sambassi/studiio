/**
 * M3-C — LE MOTEUR DES CANDIDATS DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il relit les vignettes DÉJÀ extraites par M3-B2, les remet à un
 * fournisseur avec le contexte visuel DÉJÀ produit par M3-B4, et rend des
 * passages candidats dont les bornes sont calculées ici.
 *
 * Il ne coupe rien, n'encode rien, ne publie rien. Un candidat est un
 * intervalle de temps et une phrase courte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI IL RÉUTILISE `lireImagesAnalyse` PLUTÔT QUE DE RELIRE MinIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cette fonction porte déjà tout ce qu'il faut, et qui a coûté un lot à
 * écrire : périmètre de clé vérifié, `statObject` avant lecture, compteur de
 * flux, bornes haute et basse, en-tête et pied JPEG, budget d'octets global,
 * troncature à huit AVANT la première requête. En réécrire une seconde
 * version reviendrait à refaire ces sept décisions, et à en oublier une.
 *
 * ⚠️ CE MODULE TIRE MinIO. Il ne doit JAMAIS être importé par la route ni par
 * un composant client — c'est `moteur-candidat.ts` qui fait la couture, par
 * import dynamique, exactement comme `moteur-visuel.ts` le fait pour M3-B4.
 */
import { lireImagesAnalyse, IMAGES_MAX } from './visuel';
import {
  lireReponseCandidats, usageCandidats,
  type CandidatMontage, type ContexteCandidats, type MotifCandidatsEtape,
} from './candidat-contrat';
import type { VignetteAnalyse } from './contrat';
// ⚠️ L'ENRICHISSEMENT EST UNE ETAPE A PART, APPELEE APRES COUP. Il ne partage
// ni invite, ni schema, ni fournisseur, ni drapeau avec la selection.
import { enrichirCandidats, type MotifEnrichissement } from './candidat-signaux';
import type { usageSignaux } from './candidat-signaux-contrat';

/**
 * Le délai de l'étape, et celui de la requête.
 *
 * Plus court que les soixante secondes du visuel : le fournisseur ne rédige
 * ici ni résumé ni transcription, mais au plus six objets de quatre champs.
 * Un modèle qui n'a pas répondu en quarante secondes ne répondra pas mieux
 * en cent.
 */
export const TIMEOUT_CANDIDATS_MS = 40_000;

/**
 * ⚠️ AUCUNE REPRISE. Un seul appel, quoi qu'il arrive.
 *
 * Une reprise automatique double la facture sans rien garantir : si le
 * fournisseur a rendu une réponse hors contrat, il la rendra deux fois.
 */
export const TENTATIVES_CANDIDATS = 1;

/** Le contexte visuel remis au fournisseur — issu de M3-B4, jamais inventé. */
export interface ContexteVisuelSource {
  resume: string;
  /** Les textes lus dans les images, tels que M3-B4 les a validés. */
  textesVisibles: ReadonlyArray<{ texte: string; seconde: number; confiance: number }>;
  /** Les notes de qualité, telles que M3-B4 les a validées. */
  qualite: Record<string, unknown>;
}

/** Ce qu'on remet au fournisseur : des images, leurs instants, du contexte. */
export interface EntreeCandidats {
  images: ReadonlyArray<{ seconde: number; mimeType: 'image/jpeg'; data: Buffer }>;
  dureeSecondes: number;
  contexte: ContexteVisuelSource;
}

/**
 * Ce que le fournisseur rend.
 *
 * Une CHAÎNE ou un OBJET brut : c'est `lireReponseCandidats` qui tranche.
 * Le fournisseur ne valide rien lui-même.
 */
export interface SortieFournisseurCandidats {
  reponse: unknown;
  /** Métriques de transport. Jamais lues dans le JSON du modèle. */
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  /** Le modèle CONFIGURÉ, constante de l'adaptateur. */
  modele: string;
}

export type FournisseurCandidats =
  (entree: EntreeCandidats) => Promise<SortieFournisseurCandidats>;

/**
 * Le fournisseur posé à la main.
 *
 * ⚠️ UNE VARIABLE SÉPARÉE DE CELLE DU VISUEL, et c'est délibéré : M3-B4 doit
 * pouvoir tourner en production pendant que M3-C reste éteint. Les partager
 * ferait de l'activation de l'un l'activation de l'autre.
 */
let fournisseurInjecte: FournisseurCandidats | null = null;

export function definirFournisseurCandidats(f: FournisseurCandidats | null): void {
  fournisseurInjecte = f;
}

export function moteurCandidatsDisponible(): boolean {
  return fournisseurInjecte !== null;
}

/** Ce que la route remet au moteur. */
export interface DemandeCandidats {
  userId: string;
  analysisId: string;
  vignettes: readonly VignetteAnalyse[];
  dureeSecondes: number;
  contexte: ContexteVisuelSource;
}

/**
 * L'usage de l'etape, selection et enrichissement compris.
 *
 * ⚠️ `signaux` EST UNE SOUS-CLE, ET NON UN SECOND COMPTEUR FONDU DANS LE
 * PREMIER. L'enrichissement est un appel PAYANT distinct : melanger son cout
 * a celui de la selection rendrait impossible de savoir lequel des deux
 * coute. Absente quand l'enrichissement n'a rien attache.
 */
export type UsageEtapeCandidats = ReturnType<typeof usageCandidats> & {
  signaux?: ReturnType<typeof usageSignaux> & { modele: string };
};

export type ResultatEtapeCandidats =
  | {
    ok: true;
    modele: string;
    candidats: CandidatMontage[];
    usage: UsageEtapeCandidats;
    /** Pourquoi aucun releve n'a ete attache. `null` = il l'a ete. */
    motifSignaux?: MotifEnrichissement | null;
  }
  | { ok: false; motif: MotifCandidatsEtape; detail?: string };

/**
 * Masque ce qui ne doit jamais sortir d'un message d'erreur.
 *
 * Le message d'une exception de transport peut porter une URL, un
 * identifiant de requête, voire un fragment de clé. On garde une trace
 * courte, sans rien de tout cela.
 */
function messageSur(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  return brut.replace(/https?:\/\/\S+/g, '[url]').slice(0, 120);
}

/**
 * Produit les candidats d'une analyse.
 *
 * ⚠️ NE LÈVE PAS. Tout chemin rend un `ResultatEtapeCandidats` — la route
 * traduit ensuite le motif en état et en message. Une exception qui
 * remonterait jusqu'à elle laisserait la génération `en_cours` pour toujours.
 */
export async function produireCandidats(
  demande: DemandeCandidats,
): Promise<ResultatEtapeCandidats> {
  const fournisseur = fournisseurInjecte;
  if (!fournisseur) return { ok: false, motif: 'fournisseur_absent' };

  // ── Le contexte source doit être exploitable ────────────────────────────
  //
  // Une analyse réussie SANS résumé n'existe pas dans le contrat M3-B4 ; si
  // elle se présente, c'est une ligne abîmée, et on refuse plutôt que de
  // demander au modèle de travailler sur rien.
  if (!demande.contexte.resume || demande.contexte.resume.trim().length === 0) {
    return { ok: false, motif: 'analyse_inexploitable', detail: 'resume:absent' };
  }
  if (!Number.isFinite(demande.dureeSecondes) || demande.dureeSecondes <= 0) {
    return { ok: false, motif: 'analyse_inexploitable', detail: 'duree:invalide' };
  }

  // ── Les images ──────────────────────────────────────────────────────────
  const lecture = await lireImagesAnalyse(demande.userId, demande.vignettes);
  if (lecture.images.length === 0) {
    return { ok: false, motif: 'aucune_image' };
  }

  const entree: EntreeCandidats = {
    images: lecture.images.map((i) => ({
      seconde: i.seconde, mimeType: 'image/jpeg' as const, data: i.octets,
    })),
    dureeSecondes: demande.dureeSecondes,
    contexte: demande.contexte,
  };

  let sortie: SortieFournisseurCandidats;
  try {
    sortie = await fournisseur(entree);
  } catch (e: unknown) {
    return { ok: false, motif: 'fournisseur_en_erreur', detail: messageSur(e) };
  }

  // ── La lecture stricte ──────────────────────────────────────────────────
  //
  // ⚠️ LES POSITIONS SONT CELLES DES IMAGES RÉELLEMENT ENVOYÉES, et non
  // celles des vignettes demandées. Une vignette écartée par
  // `lireImagesAnalyse` — absente, tronquée, hors budget — n'a JAMAIS été
  // montrée au modèle : accepter un instant qu'elle porte reviendrait à
  // valider une référence qu'il n'a pas pu voir.
  const contexte: ContexteCandidats = {
    positions: entree.images.map((i) => i.seconde),
    dureeSecondes: demande.dureeSecondes,
  };

  const valide = lireReponseCandidats(sortie.reponse, contexte);
  if (!valide.ok) {
    // Le motif FIN va au journal de l'appelant ; la base ne verra que
    // `resultat_candidats_invalide`. Le champ fautif est un nom de notre
    // contrat, jamais une valeur du modèle.
    return {
      ok: false,
      motif: 'resultat_candidats_invalide',
      detail: `${valide.motif}:${valide.champ}`,
    };
  }

  // ── L'ENRICHISSEMENT SEMANTIQUE — APRES, ET SEULEMENT APRES ────────────
  //
  // ⚠️ LES CANDIDATS SONT FIGES A CETTE LIGNE. `valide.valeur` porte les
  // moments choisis, leurs bornes, leurs notes et leur ordre ; plus rien
  // ci-dessous n'y touche. C'est ce qui garantit que le chemin historique
  // reste historique : le modele qui SELECTIONNE n'a rien eu de plus a
  // faire qu'avant, donc son choix ne peut pas avoir change.
  //
  // ⚠️ NE PEUT PAS FAIRE ECHOUER L'ETAPE. `enrichirCandidats` ne leve jamais
  // et rend toujours des candidats : fournisseur eteint, cle absente,
  // reponse hors contrat ou delai depasse laissent `signaux: null` et le
  // montage se poursuit. Perdre une selection deja payee parce qu'un releve
  // decoratif n'a pas abouti serait echanger la fonction contre l'ornement.
  const enrichissement = await enrichirCandidats({
    candidats: valide.valeur,
    images: entree.images,
  });

  const usage: UsageEtapeCandidats = usageCandidats({
    images: entree.images.length,
    inputTokens: sortie.usage?.inputTokens,
    outputTokens: sortie.usage?.outputTokens,
  });
  if (enrichissement.usage && enrichissement.modele) {
    usage.signaux = { ...enrichissement.usage, modele: enrichissement.modele };
  }

  return {
    ok: true,
    modele: sortie.modele,
    candidats: enrichissement.candidats,
    usage,
    motifSignaux: enrichissement.motif,
  };
}

export { IMAGES_MAX };
