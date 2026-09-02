/**
 * UX-A1 — LA PASSERELLE D'ÉCRAN DES RENDUS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE MODULE EST IMPORTÉ PAR UN COMPOSANT CLIENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il n'importe RIEN à l'exécution — pas même `rendu-contrat`. Les trois
 * vocabulaires fermés (états, étapes, motifs) n'entrent ici que comme des
 * TYPES, effacés à la compilation. Une arête d'exécution vers
 * `rendu-contrat` tirerait `clip-contrat` et `montage-contrat` dans le paquet
 * navigateur ; une arête vers `rendu-service`, `rendu-ffmpeg` ou `rendu.ts` y
 * tirerait la base, MinIO et ffmpeg. C'est la règle que `candidat-passerelle`
 * énonce déjà, appliquée d'un cran plus strictement.
 *
 * L'exhaustivité n'est pas perdue pour autant : les tables ci-dessous sont
 * typées `Record<MotifRendu, …>` et `Record<EtapeRendu, …>`. Ajouter un motif
 * au contrat sans le traduire ici NE COMPILE PAS, et un test compare les clés
 * au vocabulaire réel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL FAIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il traduit une réponse HTTP en une forme que l'écran sait afficher, et un
 * vocabulaire de machine en phrases humaines. Il ne décide de rien, ne lance
 * rien, ne retient rien : aucune URL de stockage ne transite par lui, et
 * aucune adresse n'est fabriquée — le chemin du fichier vient du serveur,
 * tel quel.
 */
import type { EtapeRendu, EtatRendu, MotifRendu } from './rendu-contrat';

/** Le rythme du sondage, repris de M3-B3 : ni agressif, ni distrait. */
export const DELAI_SUIVI_MS = 3000;

// ───────────────────────────────────────────────────────────────────────────
// Ce que l'écran affiche d'un rendu
// ───────────────────────────────────────────────────────────────────────────

export interface VideoEcran {
  dureeSecondes: number;
  largeur: number;
  hauteur: number;
  /**
   * Le chemin servi par le serveur, REPRIS TEL QUEL.
   *
   * ⚠️ JAMAIS RECONSTRUIT À PARTIR DE L'IDENTIFIANT. Fabriquer l'adresse ici
   * ferait exister deux définitions de la même route : le jour où elle bouge,
   * l'une des deux se tait sans erreur.
   */
  chemin: string;
}

export interface RenduEcran {
  id: string;
  etat: EtatRendu;
  etape: EtapeRendu | null;
  motif: MotifRendu | null;
  video: VideoEcran | null;
}

const ETATS: readonly string[] = [
  'en_attente', 'en_cours', 'reussie', 'echouee', 'annulee',
];

/**
 * Relit un rendu venu du réseau.
 *
 * ⚠️ LA VIDÉO EST REVALIDÉE, CHAMP PAR CHAMP. Ce qui arrive ici a traversé la
 * base et HTTP, et l'écran fait des divisions dessus. Une durée absente
 * afficherait `NaN:NaN`, et un `chemin` vide donnerait un lecteur muet qu'on
 * met des jours à rattacher à sa cause. Un champ manquant ne devient pas
 * zéro : la vidéo entière est écartée, et l'écran retombe sur « en cours »
 * plutôt que d'annoncer une vidéo prête qu'il ne peut pas jouer.
 */
export function renduDepuisReponse(brut: unknown): RenduEcran | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const r = brut as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.etat !== 'string' || !ETATS.includes(r.etat)) return null;

  const v = typeof r.video === 'object' && r.video !== null
    ? r.video as Record<string, unknown> : null;
  const video: VideoEcran | null = v
    && typeof v.dureeSecondes === 'number' && Number.isFinite(v.dureeSecondes)
    && typeof v.largeur === 'number' && v.largeur > 0
    && typeof v.hauteur === 'number' && v.hauteur > 0
    && typeof v.chemin === 'string' && v.chemin.startsWith('/')
    ? {
      dureeSecondes: v.dureeSecondes,
      largeur: v.largeur,
      hauteur: v.hauteur,
      chemin: v.chemin,
    }
    : null;

  return {
    id: r.id,
    etat: r.etat as EtatRendu,
    etape: typeof r.etape === 'string' ? r.etape as EtapeRendu : null,
    motif: typeof r.motif === 'string' ? r.motif as MotifRendu : null,
    // Une réussite dont la vidéo n'est pas exploitable n'est pas une réussite
    // pour l'écran non plus — le serveur applique déjà cette règle, et la
    // répéter ici garantit qu'aucun bouton « Regarder » ne pointe vers rien.
    video: r.etat === 'reussie' ? video : null,
  };
}

/** Le rendu mérite-t-il un tour de sondage de plus ? */
export function renduEnCours(r: RenduEcran | null): boolean {
  return r !== null && (r.etat === 'en_attente' || r.etat === 'en_cours');
}

// ───────────────────────────────────────────────────────────────────────────
// Les phrases — une par étape RÉELLE, jamais un pourcentage
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ AUCUN POURCENTAGE, ET CE N'EST PAS UN OUBLI. Le serveur ne sait pas
 * qu'il est à 43 % : il sait quelle étape il traverse. Dériver un
 * pourcentage du nom de l'étape serait une mesure sans mesure — une barre qui
 * avance par paliers arbitraires et se fige au plus long d'entre eux.
 */
const PHRASES_ETAPE: Record<EtapeRendu, string> = {
  source: 'Récupération de tes rushes…',
  encodage: 'Montage de ta vidéo…',
  mesure: 'Vérification du résultat…',
  televersement: 'Finalisation…',
};

/** Ce qu'on dit quand le travail n'a pas encore annoncé son étape. */
const PHRASE_SANS_ETAPE = 'Préparation de ta vidéo…';

export function phraseEnCours(etape: EtapeRendu | null): string {
  if (etape !== null && etape in PHRASES_ETAPE) return PHRASES_ETAPE[etape];
  return PHRASE_SANS_ETAPE;
}

// ───────────────────────────────────────────────────────────────────────────
// Les motifs d'échec — les DIX du contrat, traduits
// ───────────────────────────────────────────────────────────────────────────

interface Echec {
  /** Ce que la personne lit. Jamais un mot de machine. */
  message: string;
  /**
   * Recommencer peut-il changer le résultat ?
   *
   * ⚠️ CETTE COLONNE N'ARME AUCUN BOUTON DANS CE LOT. Relancer un rendu
   * demande le plan qui l'a produit, et `renduPublic` masque volontairement
   * `montagePlanId`. La distinction sert donc uniquement à choisir la PHRASE :
   * « Réessaie » n'est écrit que là où réessayer a un sens. Promettre une
   * relance qu'aucun bouton ne porte serait pire que de se taire.
   */
  relancable: boolean;
}

const ECHECS: Record<MotifRendu, Echec> = {
  plan_non_conforme: {
    message: 'Ce montage ne peut pas être créé.',
    relancable: false,
  },
  source_inaccessible: {
    message: 'Un de tes fichiers n’a pas pu être récupéré. Réessaie.',
    relancable: true,
  },
  clip_illisible: {
    message: 'Un de tes rushes est illisible.',
    relancable: false,
  },
  outil_absent: {
    message: 'La création vidéo est indisponible sur ce serveur.',
    relancable: false,
  },
  encodage_echoue: {
    message: 'Ta vidéo n’a pas pu être créée. Réessaie.',
    relancable: true,
  },
  delai_depasse: {
    message: 'Ta vidéo était trop longue à créer. Réessaie.',
    relancable: true,
  },
  resultat_invalide: {
    message: 'Le résultat n’était pas exploitable. Réessaie.',
    relancable: true,
  },
  televersement_echoue: {
    message: 'Ta vidéo n’a pas pu être enregistrée. Réessaie.',
    relancable: true,
  },
  capacite_saturee: {
    message: 'Studiio termine une autre vidéo. La tienne démarre juste après.',
    relancable: true,
  },
  rendu_interrompu: {
    message: 'La création a été interrompue. Réessaie.',
    relancable: true,
  },
};

/**
 * Ce qu'on dit d'un échec dont le motif est absent ou inconnu.
 *
 * Il arrive : une ligne écrite par une version future, ou un `annulee` que le
 * contrat laisse sans motif. Afficher le code brut — ou pire, un écran vide —
 * laisserait quelqu'un devant un travail disparu sans explication.
 */
const ECHEC_INDETERMINE: Echec = {
  message: 'La création n’a pas abouti. Réessaie.',
  relancable: true,
};

function echec(motif: MotifRendu | null): Echec {
  if (motif !== null && motif in ECHECS) return ECHECS[motif];
  return ECHEC_INDETERMINE;
}

export function messageEchec(motif: MotifRendu | null): string {
  return echec(motif).message;
}

export function relanceCoherente(motif: MotifRendu | null): boolean {
  return echec(motif).relancable;
}

/** Les motifs traduits, pour le test d'exhaustivité. */
export const MOTIFS_TRADUITS = Object.keys(ECHECS) as MotifRendu[];

// ───────────────────────────────────────────────────────────────────────────
// Les mises en forme — humaines, jamais techniques
// ───────────────────────────────────────────────────────────────────────────

/** `28` → `0:28`. Jamais de millisecondes, jamais de timecode. */
export function formaterDuree(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes < 0) return '';
  const total = Math.round(secondes);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * L'orientation, en mots.
 *
 * ⚠️ PAS « 1080 × 1920 ». Le créateur ne monte pas une vidéo en pixels ; il
 * en fait une pour un écran tenu debout ou couché. Les dimensions restent
 * dans la réponse — l'écran ne les affiche simplement pas.
 */
export function orientation(largeur: number, hauteur: number): string {
  if (!(largeur > 0) || !(hauteur > 0)) return '';
  if (largeur === hauteur) return 'Carré';
  return hauteur > largeur ? 'Vertical' : 'Horizontal';
}

// ───────────────────────────────────────────────────────────────────────────
// La lecture réseau
// ───────────────────────────────────────────────────────────────────────────

export type LectureRendu =
  | { sorte: 'trouve'; rendu: RenduEcran }
  /** La session n'a encore produit aucune vidéo. Ce n'est pas une erreur. */
  | { sorte: 'aucun' }
  /** Table absente, session inconnue : rien à montrer, et rien à réparer. */
  | { sorte: 'indisponible' }
  | { sorte: 'erreur'; message: string };

/** Le type de `fetch`, injectable pour les tests. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Lit le rendu d'une session.
 *
 * ⚠️ UN GET, ET RIEN D'AUTRE. Cette fonction ne déclenche aucun travail : la
 * route qu'elle appelle n'écrit pas, et aucune autre n'est appelée ici.
 */
export async function lireRenduDeSession(
  sessionId: string, fetcher: Fetcher = fetch,
): Promise<LectureRendu> {
  let reponse: Response;
  try {
    reponse = await fetcher(
      `/api/autopilot/sessions/${encodeURIComponent(sessionId)}/rendus`,
      { method: 'GET', credentials: 'same-origin' },
    );
  } catch {
    return { sorte: 'erreur', message: 'Réseau indisponible.' };
  }

  // 503 : la migration n'est pas appliquée. 404 : la session n'existe pas, ou
  // n'est pas la nôtre. Dans les deux cas il n'y a rien à montrer, et rien
  // que la personne puisse faire — l'écran se tait plutôt que d'alarmer.
  if (reponse.status === 503 || reponse.status === 404) return { sorte: 'indisponible' };
  if (reponse.status === 401) {
    return { sorte: 'erreur', message: 'Ta session a expiré. Reconnecte-toi.' };
  }

  let corps: unknown;
  try { corps = await reponse.json(); } catch {
    return { sorte: 'erreur', message: 'Réponse illisible.' };
  }
  if (typeof corps !== 'object' || corps === null) {
    return { sorte: 'erreur', message: 'Réponse illisible.' };
  }
  const c = corps as Record<string, unknown>;
  if (!reponse.ok || c.ok !== true) {
    return { sorte: 'erreur', message: 'La lecture a échoué.' };
  }

  if (c.rendu === null || c.rendu === undefined) return { sorte: 'aucun' };
  const rendu = renduDepuisReponse(c.rendu);
  // Une charge utile qu'on ne sait pas relire n'est pas « aucun rendu » : le
  // dire effacerait de l'écran un travail qui existe.
  if (!rendu) return { sorte: 'erreur', message: 'Réponse illisible.' };
  return { sorte: 'trouve', rendu };
}

// ───────────────────────────────────────────────────────────────────────────
// Planifier la publication
// ───────────────────────────────────────────────────────────────────────────

export type IssuePlanification =
  | { sorte: 'creee'; postId: string }
  | { sorte: 'echec'; message: string };

/**
 * Crée un BROUILLON dans le Calendrier à partir d'une vidéo produite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN NOUVEAU SYSTÈME DE PUBLICATION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `scheduled_posts` + `POST /api/posts` + le Calendrier existent depuis
 * longtemps et savent déjà choisir une plateforme, une date et une heure.
 * Cette fonction ne fait que POSER la vidéo dans ce système ; tout le reste
 * du parcours de publication reste celui du Calendrier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI `renderedVideoUrl` ET PAS `media_url`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le seul chemin qui sert un montage Autopilote est
 * `/api/autopilot/rendus-montage/[id]/fichier`, et il EXIGE une session : le
 * relais public refuse explicitement le namespace des montages
 * (`cleDansNamespaceMontage`), pour qu'un montage ne devienne pas un lien
 * public et permanent.
 *
 * Or Instagram et TikTok viennent chercher le fichier EUX-MÊMES, sans session.
 * Mettre ce chemin dans `media_url` fabriquerait donc un post qui a l'air
 * publiable et qui ne le sera jamais — l'échec n'arrivant qu'au moment de la
 * publication, longtemps après.
 *
 * Le brouillon porte donc la vidéo dans `metadata.renderedVideoUrl`, le champ
 * que le Calendrier relit déjà pour SON aperçu, et `status: 'draft'`. Studiio
 * sait la montrer ; personne ne la promet à un réseau social.
 *
 * ⚠️ NE JAMAIS BRANCHER LA PUBLICATION SOCIALE LÀ-DESSUS sans avoir d'abord
 * donné au montage une adresse que le réseau peut atteindre. C'est un lot à
 * part, et il commence par cette question-là.
 */
export async function creerBrouillonPlanification(
  rendu: RenduEcran, fetcher: Fetcher = fetch,
): Promise<IssuePlanification> {
  if (!rendu.video) return { sorte: 'echec', message: 'Cette vidéo n’est pas prête.' };

  const aujourdhui = new Date();
  const jour = `${aujourdhui.getFullYear()}-`
    + `${String(aujourdhui.getMonth() + 1).padStart(2, '0')}-`
    + `${String(aujourdhui.getDate()).padStart(2, '0')}`;

  let reponse: Response;
  try {
    reponse = await fetcher('/api/posts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Vidéo Studiio',
        caption: '',
        media_type: 'video',
        // ⚠️ Vide, et c'est voulu — voir l'en-tête. La vidéo vit dans
        // `metadata`, là où le Calendrier sait la lire sans la promettre.
        media_url: null,
        platforms: [],
        scheduled_date: jour,
        scheduled_time: '12:00',
        status: 'draft',
        metadata: {
          renderedVideoUrl: rendu.video.chemin,
          autopilotRenduId: rendu.id,
          hasAudio: true,
          format: rendu.video.hauteur >= rendu.video.largeur ? 'reel' : 'tv',
        },
      }),
    });
  } catch {
    return { sorte: 'echec', message: 'Réseau indisponible.' };
  }

  if (reponse.status === 401) {
    return { sorte: 'echec', message: 'Ta session a expiré. Reconnecte-toi.' };
  }
  let corps: unknown = null;
  try { corps = await reponse.json(); } catch { corps = null; }
  const c = typeof corps === 'object' && corps !== null
    ? corps as Record<string, unknown> : {};
  const post = typeof c.post === 'object' && c.post !== null
    ? c.post as Record<string, unknown> : null;

  if (!reponse.ok || c.success !== true || typeof post?.id !== 'string') {
    return { sorte: 'echec', message: 'La planification n’a pas pu être créée.' };
  }
  return { sorte: 'creee', postId: post.id };
}
