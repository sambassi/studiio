/**
 * P0.1 — LA CHAÎNE « CRÉER MA VIDÉO », CÔTÉ ÉCRAN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE N'IMPLÉMENTE AUCUNE LOGIQUE MÉTIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni découpage, ni planification, ni encodage : ce module ENCHAÎNE trois
 * routes qui existent déjà et savent tout faire. Il ne calcule aucune borne,
 * ne choisit aucun clip, ne décide d'aucun recadrage — tout cela est refusé
 * par les routes elles-mêmes, qui listent explicitement les champs qu'un
 * client n'a pas le droit d'envoyer.
 *
 *   1. `POST /api/autopilot/candidats/[candidateSetId]/clips`   (M3-F)
 *   2. `POST /api/autopilot/clips/[clipSetId]/montage`          (M3-G)
 *   3. `POST /api/autopilot/montages/[montagePlanId]/rendu`     (M3-H)
 *
 * M3-E (les coupes) n'a PAS d'appel à lui : la route des clips le calcule
 * elle-même, et un appel séparé ne servirait qu'à afficher des timecodes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE MODULE EST IMPORTÉ PAR UN COMPOSANT CLIENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Comme `rendu-passerelle`, il n'importe RIEN à l'exécution : les
 * vocabulaires fermés n'entrent que comme des TYPES. Une arête vers
 * `clip-contrat` ou `montage-contrat` tirerait tout le socle serveur dans le
 * paquet navigateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REPRENDRE PLUTÔT QUE RECOMMENCER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les trois routes sont IDEMPOTENTES, et c'est ce qui rend ce module simple :
 *
 *   • un jeu de clips réussi identique  → 200 `reutilise`, aucun ffmpeg ;
 *   • un plan identique                 → 200 `reutilise`, aucun calcul ;
 *   • un rendu réussi identique         → 200 `reutilise`, aucun encodage.
 *
 * Un second clic ne refait donc rien : il REPREND là où le précédent s'est
 * arrêté. C'est aussi ce qui rend acceptable d'abandonner l'attente — le
 * travail continue sur le serveur, et le clic suivant le retrouve.
 */
import type { Fetcher } from './rendu-passerelle';
import type { RecetteAudio } from './recette-audio';

// ───────────────────────────────────────────────────────────────────────────
// Les deux seules décisions du lot
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ EN DUR, ET ASSUMÉ. M3-G exige un format ET une durée cible, sans valeur
 * par défaut — le serveur refuse d'en inventer une, au motif qu'un montage
 * que personne n'a demandé n'est signalé nulle part comme arbitraire.
 *
 * Ce lot tranche donc À LA PLACE de l'écran, une fois, ici : le format le
 * plus courant des réseaux, et une durée qui tient dans les bornes du contrat
 * (1 à 120 secondes). Un sélecteur est une fonctionnalité à part entière ;
 * il viendra quand le parcours marchera.
 */
export const FORMAT_VIDEO = '9:16' as const;
export const DUREE_CIBLE_SECONDES = 30;

/** Le rythme du sondage, repris de M3-B3 comme partout ailleurs. */
export const DELAI_CHAINE_MS = 3000;

/**
 * Au bout de combien de temps on cesse d'ATTENDRE — pas de travailler.
 *
 * Le découpage peut prendre de longues minutes : il lance un ffmpeg par
 * passage. Abandonner l'attente n'annule rien côté serveur, et le clic
 * suivant retrouvera le jeu terminé grâce à la réutilisation. Attendre
 * indéfiniment, en revanche, laisserait un onglet interroger le serveur
 * jusqu'à la fin des temps.
 */
export const ATTENTE_CLIPS_MAX_MS = 20 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
// Les motifs d'échec ASYNCHRONES du découpage
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ SEULS CES MOTIFS-LÀ SONT TRADUITS ICI.
 *
 * Les REFUS des trois routes portent déjà un `error` écrit en français par le
 * serveur (« Cette recherche de passages n'a proposé aucun moment. ») : le
 * reprendre tel quel est plus juste que de le retraduire, et évite deux
 * vocabulaires qui divergent.
 *
 * Ce qui n'a PAS de phrase, en revanche, c'est `motifEchec` — le mot de
 * machine écrit dans la ligne quand le travail détaché échoue APRÈS le 202.
 * Il n'est jamais passé par un message, et c'est celui-là qu'on traduit.
 */
type MotifClips =
  | 'candidats_introuvables' | 'decision_invalide' | 'source_inaccessible'
  | 'outil_absent' | 'media_illisible' | 'extraction_echouee'
  | 'televersement_echoue' | 'timeout' | 'capacite_saturee' | 'set_interrompu';

const ECHECS_CLIPS: Record<MotifClips, string> = {
  candidats_introuvables: 'Les passages de ce rush ont disparu.',
  decision_invalide: 'Aucun passage de ce rush n’est découpable.',
  source_inaccessible: 'Ton rush n’a pas pu être récupéré. Réessaie.',
  outil_absent: 'La création vidéo est indisponible sur ce serveur.',
  media_illisible: 'Ce rush est illisible.',
  extraction_echouee: 'Le découpage n’a pas abouti. Réessaie.',
  televersement_echoue: 'Les extraits n’ont pas pu être enregistrés. Réessaie.',
  timeout: 'Le découpage a été trop long. Réessaie.',
  capacite_saturee: 'Studiio termine un autre travail. Réessaie dans un instant.',
  set_interrompu: 'Le découpage a été interrompu. Réessaie.',
};

const ECHEC_CLIPS_INDETERMINE = 'Le découpage n’a pas abouti. Réessaie.';

export function messageClips(motif: string | null): string {
  if (motif !== null && motif in ECHECS_CLIPS) return ECHECS_CLIPS[motif as MotifClips];
  return ECHEC_CLIPS_INDETERMINE;
}

/** Les motifs traduits, pour le test d'exhaustivité. */
export const MOTIFS_CLIPS_TRADUITS = Object.keys(ECHECS_CLIPS);

// ───────────────────────────────────────────────────────────────────────────
// Les phrases de progression — une par ÉTAPE, jamais un pourcentage
// ───────────────────────────────────────────────────────────────────────────

export type EtapeChaine = 'decoupage' | 'montage' | 'rendu';

const PHRASES: Record<EtapeChaine, string> = {
  decoupage: 'Découpage des meilleurs passages…',
  montage: 'Préparation du montage…',
  rendu: 'Lancement de la création…',
};

export function phraseChaine(etape: EtapeChaine): string {
  return PHRASES[etape];
}

// ───────────────────────────────────────────────────────────────────────────
// L'issue
// ───────────────────────────────────────────────────────────────────────────

export type IssueChaine =
  /** Le rendu est parti. `VideosPretes` prendra le relais. */
  | { sorte: 'lancee' }
  /** Un rendu identique existait déjà : rien n'a été relancé. */
  | { sorte: 'deja_prete' }
  /** Un rendu de ce montage tourne déjà. */
  | { sorte: 'deja_en_cours' }
  /** L'attente a été abandonnée ; le travail, lui, continue. */
  | { sorte: 'trop_long'; message: string }
  | { sorte: 'echec'; message: string };

const MESSAGE_RESEAU = 'Réseau indisponible.';
const MESSAGE_SESSION = 'Ta session a expiré. Reconnecte-toi.';
const MESSAGE_ILLISIBLE = 'Réponse illisible.';
const MESSAGE_TROP_LONG =
  'C’est plus long que prévu. Le travail continue — reclique pour reprendre.';

interface Reponse { statut: number; corps: Record<string, unknown> | null }

async function appeler(
  fetcher: Fetcher, url: string, init: RequestInit,
): Promise<Reponse | null> {
  let r: Response;
  try {
    r = await fetcher(url, { credentials: 'same-origin', ...init });
  } catch {
    return null;
  }
  let corps: unknown = null;
  try { corps = await r.json(); } catch { corps = null; }
  return {
    statut: r.status,
    corps: typeof corps === 'object' && corps !== null
      ? corps as Record<string, unknown> : null,
  };
}

/**
 * Le message d'un refus.
 *
 * ⚠️ ON REPREND CELUI DU SERVEUR, quand il y en a un. Les trois routes
 * écrivent des phrases françaises destinées à être lues ; les remplacer par
 * les nôtres perdrait le détail utile (« Ce rush n'a pas été vérifié dans le
 * stockage. ») au profit d'un générique.
 */
function messageRefus(r: Reponse): string {
  if (r.statut === 401) return MESSAGE_SESSION;
  const e = r.corps?.error;
  if (typeof e === 'string' && e.length > 0) return e;
  return 'La création n’a pas pu démarrer.';
}

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? v as Record<string, unknown> : null;
}

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export interface OptionsChaine {
  /** Le jeu de passages d'où l'on part. */
  candidateSetId: string;
  /**
   * Le format demandé. Omis = `FORMAT_VIDEO`.
   *
   * ⚠️ TRANSMIS TEL QUEL À M3-G, qui le REFUSE s'il sort de son vocabulaire.
   * Rien n'est validé ici : une seconde validation qui diverge du serveur est
   * pire qu'aucune.
   */
  format?: string;
  /** La durée cible en secondes. Omise = `DUREE_CIBLE_SECONDES`. */
  dureeCibleSecondes?: number;
  /**
   * La recette audio de CETTE vidéo. Omise = le comportement historique.
   *
   * ⚠️ TRANSMISE TELLE QUELLE À M3-H, QUI LA REFUSE si elle sort de son
   * schéma fermé — et qui vérifie lui-même que la musique appartient au
   * compte. Rien n'est validé ici : une seconde validation qui diverge du
   * serveur est pire qu'aucune.
   *
   * ⚠️ ELLE NE TOUCHE PAS AU PLAN. Le montage reste identifié par son format
   * et sa durée ; deux recettes différentes réutilisent donc le MÊME plan et
   * produisent deux rendus distincts.
   */
  audio?: RecetteAudio | null;
  /**
   * L'objectif de CETTE vidéo, s'il diffère de celui du compte.
   *
   * ⚠️ OMIS = LE DÉFAUT DU COMPTE, chargé par le serveur. Le navigateur n'a
   * rien à renvoyer quand il n'a rien à dire : lui faire porter l'objectif
   * habituel ferait dépendre le plan de ce qu'un écran périmé croit savoir
   * de l'intention de son utilisateur.
   *
   * ⚠️ IL N'ÉCRIT RIEN. Cet objectif vaut pour ce plan et repart avec lui ;
   * seul `PUT /api/autopilot/objectif` change le défaut du compte.
   *
   * ⚠️ TRANSMIS TEL QUEL À M3-G, qui le REFUSE s'il sort de son schéma
   * fermé. Rien n'est validé ici : une seconde validation qui diverge du
   * serveur est pire qu'aucune.
   */
  objectif?: unknown;
  fetcher?: Fetcher;
  /** Appelé au passage de chaque étape, pour la phrase affichée. */
  signalerEtape?: (etape: EtapeChaine) => void;
  /** Injectables pour les tests — jamais fournis en production. */
  attendre?: (ms: number) => Promise<void>;
  maintenant?: () => number;
}

/**
 * Enchaîne découpage → montage → rendu, et s'arrête à la première rupture.
 *
 * ⚠️ AUCUNE ÉTAPE NE COMMENCE AVANT LE SUCCÈS RÉEL DE LA PRÉCÉDENTE. Le
 * montage n'est demandé que sur un jeu de clips dont l'état est `reussie` —
 * la route le revérifie de son côté (`jeu_non_reussi`), mais on ne l'appelle
 * pas pour se le faire dire.
 *
 * ⚠️ AUCUN CRÉDIT, AUCUN FOURNISSEUR, AUCUNE ÉCRITURE DIRECTE. Ce module ne
 * connaît que trois URL.
 */
export async function creerVideo(o: OptionsChaine): Promise<IssueChaine> {
  const fetcher = o.fetcher ?? fetch;
  const attendre = o.attendre
    ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }));
  const maintenant = o.maintenant ?? (() => Date.now());
  const id = encodeURIComponent(o.candidateSetId);

  // ── 1. Le découpage ───────────────────────────────────────────────────
  o.signalerEtape?.('decoupage');
  const lance = await appeler(fetcher, `/api/autopilot/candidats/${id}/clips`, {
    method: 'POST',
  });
  if (!lance) return { sorte: 'echec', message: MESSAGE_RESEAU };
  if (lance.statut !== 200 && lance.statut !== 202) {
    return { sorte: 'echec', message: messageRefus(lance) };
  }

  const jeu = objet(lance.corps?.clipSet);
  const clipSetId = texte(jeu?.id);
  if (!clipSetId) return { sorte: 'echec', message: MESSAGE_ILLISIBLE };

  // 200 = un jeu réussi identique existait déjà. Rien à attendre.
  let etatJeu = texte(jeu?.etat) ?? 'en_attente';
  const debut = maintenant();

  while (etatJeu === 'en_attente' || etatJeu === 'en_cours') {
    if (maintenant() - debut > ATTENTE_CLIPS_MAX_MS) {
      return { sorte: 'trop_long', message: MESSAGE_TROP_LONG };
    }
    // eslint-disable-next-line no-await-in-loop
    await attendre(DELAI_CHAINE_MS);
    // eslint-disable-next-line no-await-in-loop
    const lu = await appeler(
      fetcher, `/api/autopilot/clips/${encodeURIComponent(clipSetId)}`, { method: 'GET' },
    );
    if (!lu) return { sorte: 'echec', message: MESSAGE_RESEAU };
    if (lu.statut !== 200) return { sorte: 'echec', message: messageRefus(lu) };
    const relu = objet(lu.corps?.clipSet);
    const suivant = texte(relu?.etat);
    if (!suivant) return { sorte: 'echec', message: MESSAGE_ILLISIBLE };
    if (suivant === 'echouee' || suivant === 'annulee') {
      return { sorte: 'echec', message: messageClips(texte(relu?.motifEchec)) };
    }
    etatJeu = suivant;
  }

  if (etatJeu !== 'reussie') {
    return { sorte: 'echec', message: ECHEC_CLIPS_INDETERMINE };
  }

  // ── 2. Le plan ────────────────────────────────────────────────────────
  //
  // Synchrone : M3-G lit deux lignes et calcule en mémoire. Rien à sonder.
  o.signalerEtape?.('montage');
  const planifie = await appeler(
    fetcher, `/api/autopilot/clips/${encodeURIComponent(clipSetId)}/montage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: o.format ?? FORMAT_VIDEO,
        dureeCibleSecondes: o.dureeCibleSecondes ?? DUREE_CIBLE_SECONDES,
        // Absent quand la vidéo ne déclare rien : la clé n'est même pas
        // écrite, et le serveur applique le défaut du compte.
        ...(o.objectif ? { objectif: o.objectif } : {}),
      }),
    },
  );
  if (!planifie) return { sorte: 'echec', message: MESSAGE_RESEAU };
  // 201 = calculé, 200 = un plan identique existait déjà.
  if (planifie.statut !== 200 && planifie.statut !== 201) {
    return { sorte: 'echec', message: messageRefus(planifie) };
  }
  const planId = texte(objet(planifie.corps?.plan)?.id);
  if (!planId) return { sorte: 'echec', message: MESSAGE_ILLISIBLE };

  // ── 3. Le rendu ───────────────────────────────────────────────────────
  //
  // On ne SONDE PAS le rendu ici : `VideosPretes` le fait déjà, au niveau de
  // la session, avec ses phrases et ses messages d'échec. Le refaire ici
  // ferait deux boucles sur la même ligne.
  o.signalerEtape?.('rendu');
  const rendu = await appeler(
    fetcher, `/api/autopilot/montages/${encodeURIComponent(planId)}/rendu`,
    o.audio
      ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Le seul champ que cette route accepte. Un corps vide reste le
        // chemin historique, et reste valide.
        body: JSON.stringify({ audio: o.audio }),
      }
      : { method: 'POST' },
  );
  if (!rendu) return { sorte: 'echec', message: MESSAGE_RESEAU };
  if (rendu.statut === 202) return { sorte: 'lancee' };
  // 200 : un rendu réussi identique existe. Il est déjà affiché en dessous.
  if (rendu.statut === 200) return { sorte: 'deja_prete' };
  // 409 : un rendu de ce montage tourne déjà — le suivre, pas en lancer un second.
  if (rendu.statut === 409) return { sorte: 'deja_en_cours' };
  return { sorte: 'echec', message: messageRefus(rendu) };
}
