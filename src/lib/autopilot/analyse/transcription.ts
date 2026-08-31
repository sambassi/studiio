/**
 * M3-D2 — LE MOTEUR DE TRANSCRIPTION : la couture, et l'étape complète.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il enchaîne : extraction FLAC temporaire → UN appel au fournisseur →
 * validation locale stricte. Il ne persiste rien, ne décide d'aucun état, ne
 * rend aucune réponse HTTP — c'est la route qui le fait, comme en M3-C.
 *
 * Le fournisseur est INJECTÉ. C'est ce qui rend l'étape testable sans réseau,
 * et ce qui permet à un serveur sans clé de ne rien avoir à configurer.
 *
 * ⚠️ UN SEUL APPEL, AUCUNE REPRISE. Un fournisseur qui refuse ne devient pas
 * accueillant parce qu'on insiste : réessayer n'a jamais fait que doubler
 * l'attente et la facture avant le même échec.
 *
 * ⚠️ AUCUN DÉBIT. Ce module n'importe pas `@/lib/credits`, et un test le
 * vérifie.
 */
import { avecAudioFlac, type EntreeAudioFlac } from './transcription-audio';
import {
  lireReponseTranscription,
  type MotifTranscription, type Transcription,
} from './transcription-contrat';

/**
 * Temps maximal accordé à l'appel au fournisseur.
 *
 * Trois minutes. Un transcripteur travaille bien plus vite que le temps réel
 * — quelques secondes pour une minute d'audio — mais la file d'attente d'un
 * service partagé, elle, n'a pas de vitesse. Au-delà, ce n'est plus « c'est
 * long », c'est « ce service ne répond pas », et il vaut mieux rendre la
 * place que continuer d'attendre.
 */
export const TIMEOUT_TRANSCRIPTION_MS = 180_000;

/** Ce que l'adaptateur reçoit : un fichier local, et rien du stockage. */
export interface DemandeTranscription {
  /** Le FLAC temporaire. Valable UNIQUEMENT pendant l'appel. */
  chemin: string;
  octets: number;
}

/** Ce que l'adaptateur rend. `reponse` est du TEXTE BRUT, validé ailleurs. */
export interface SortieFournisseur {
  reponse: string;
  /** Le modèle CONFIGURÉ, jamais celui que la réponse prétendrait être. */
  modele: string;
}

export type FournisseurTranscription =
  (demande: DemandeTranscription) => Promise<SortieFournisseur>;

// ─────────────────────────────────────────────────────────────────────────
// La couture
// ─────────────────────────────────────────────────────────────────────────

let fournisseurInjecte: FournisseurTranscription | null = null;

/**
 * Injecte un fournisseur — POUR LES TESTS, et pour eux seuls.
 *
 * Même esprit que `definirMoteurExtraction` et `definirFournisseurCandidats` :
 * la couture est exportée pour que chaque test parte d'un serveur connu, et
 * personne ne l'appelle en production.
 */
export function definirFournisseurTranscription(f: FournisseurTranscription | null): void {
  fournisseurInjecte = f;
}

export function fournisseurTranscriptionInjecte(): FournisseurTranscription | null {
  return fournisseurInjecte;
}

// ─────────────────────────────────────────────────────────────────────────
// L'étape
// ─────────────────────────────────────────────────────────────────────────

export interface EntreeEtapeTranscription extends EntreeAudioFlac {
  /** La durée MESURÉE du rush. Elle borne tous les instants rendus. */
  dureeSecondes: number;
}

export type ResultatEtapeTranscription =
  | {
      ok: true;
      transcription: Transcription;
      modele: string;
      usage: Record<string, unknown>;
    }
  | { ok: false; motif: MotifTranscription; detail?: string };

/**
 * Le minimum facturé par le fournisseur, en secondes.
 *
 * Documenté : « Minimum Billed Length 10 seconds. If you submit a request
 * less than this, you will still be billed for 10 seconds. » Un rush de trois
 * secondes coûte donc autant qu'un rush de dix, et l'écran doit pouvoir le
 * dire plutôt que de laisser croire à une facturation à la seconde.
 */
export const SECONDES_MIN_FACTUREES = 10;

/**
 * Exécute l'étape complète.
 *
 * ⚠️ `usage` EST CALCULÉ ICI, LOCALEMENT, ET NE VIENT JAMAIS DE LA RÉPONSE.
 * La durée est celle que ffprobe a mesurée, les octets sont ceux que nous
 * avons produits, le minimum facturé est une règle publiée. Laisser le
 * fournisseur déclarer ce qu'il nous facture, c'est lui laisser écrire notre
 * comptabilité.
 */
export async function transcrireRush(
  entree: EntreeEtapeTranscription,
  fournisseur: FournisseurTranscription,
): Promise<ResultatEtapeTranscription> {
  const resultat = await avecAudioFlac(entree, async (fichier) => {
    // ⚠️ UN SEUL APPEL. Une exception ici n'est PAS rattrapée dans le
    // `travail` : elle traverse `avecAudioFlac`, dont le `finally` supprime
    // quand même le fichier, et c'est l'appelant qui la nomme.
    return fournisseur({ chemin: fichier.chemin, octets: fichier.octets });
  });

  if (!resultat.ok) return { ok: false, motif: resultat.motif };

  const sortie = resultat.valeur;
  const lu = lireReponseTranscription(sortie.reponse, entree.dureeSecondes);
  if (!lu.ok) return { ok: false, motif: lu.motif, detail: lu.detail };

  const secondes = Math.max(0, entree.dureeSecondes);
  return {
    ok: true,
    transcription: lu.transcription,
    modele: sortie.modele,
    usage: {
      octetsEnvoyes: resultat.octets,
      secondesAudio: Math.round(secondes * 1000) / 1000,
      secondesFacturees: Math.max(SECONDES_MIN_FACTUREES, Math.ceil(secondes)),
    },
  };
}
