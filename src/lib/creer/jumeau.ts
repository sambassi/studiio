/**
 * Côté navigateur : l'intention « utiliser mon jumeau », et le garde avant
 * tout rendu. Le navigateur ne décide rien : il DEMANDE au serveur.
 *
 * DEUX intentions distinctes, jamais confondues (`JumeauMode`) :
 *   'voix'   — narration seulement : la voix clonée du jumeau devient la voix
 *              TTS des séquences (Titre, Cartes, CTA). Aucune vidéo d'avatar,
 *              aucun coût avatar. Ne dépend pas du fournisseur de l'avatar.
 *   'avatar' — présence vidéo réelle : la vidéo du jumeau (avatar animé sur
 *              ma voix, produite par le serveur) devient la séquence « Vidéo »
 *              à l'envoi. Exige le moteur vidéo disponible POUR cet avatar
 *              et coûte AVATAR_VIDEO_COST en plus du rendu.
 *   'aucun'  — le parcours normal, celui de tous les brouillons antérieurs.
 */

export type JumeauMode = 'aucun' | 'voix' | 'avatar';
export const JUMEAU_MODES: readonly JumeauMode[] = ['aucun', 'voix', 'avatar'];
export const estJumeauMode = (v: unknown): v is JumeauMode => v === 'aucun' || v === 'voix' || v === 'avatar';

/** Le fournisseur de l'avatar, en clair pour l'écran. */
export type FournisseurAvatarPublic = 'heygen' | 'did' | 'inconnu';
export function libelleFournisseurAvatar(f: FournisseurAvatarPublic | undefined): string {
  if (f === 'did') return 'créé à partir d’une vidéo (D-ID)';
  if (f === 'heygen') return 'créé à partir d’une photo (HeyGen)';
  return 'fournisseur inconnu';
}

export interface EtatJumeau {
  pret: boolean;
  motif: string | null;
  message: string | null;
  jumeau: { avatar: { id: string; version: number; nom: string | null; valideLe: string; fournisseur?: FournisseurAvatarPublic }; voix: { id: string; nom: string }; prononciations: number } | null;
  moteurDisponible: boolean;
  messageMoteur: string | null;
  scripts?: Array<{ display: string; spoken: string }>;
}

export const JUMEAU_API = '/api/creer/jumeau';
export const JUMEAU_INDISPONIBLE = 'Votre jumeau n’est plus disponible. Vérifiez votre avatar et votre voix.';

/** L'état du jumeau, tel que le serveur le voit maintenant. `null` si l'appel échoue. */
export async function lireEtatJumeau(fetchImpl: typeof fetch = fetch): Promise<EtatJumeau | null> {
  try {
    const res = await fetchImpl(JUMEAU_API);
    const json = await res.json();
    return json?.success ? (json.data as EtatJumeau) : null;
  } catch {
    return null;
  }
}

/** La vérification COMPLÈTE avant génération, avec les textes de la vidéo. */
export async function verifierJumeauAvantRendu(textes: string[], fetchImpl: typeof fetch = fetch): Promise<EtatJumeau | null> {
  try {
    const res = await fetchImpl(JUMEAU_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ textes }) });
    const json = await res.json();
    return json?.success ? (json.data as EtatJumeau) : null;
  } catch {
    return null;
  }
}

/**
 * LE GARDE. Rend `null` si le rendu peut continuer, sinon le message qui
 * l'arrête. Mode 'aucun' : rien ne change au parcours normal, aucun appel.
 *   'avatar' — le serveur DOIT confirmer que le jumeau est prêt
 *              (revérification complète), PUIS que le moteur vidéo existe
 *              pour cet avatar — sinon on s'arrête, sans jamais produire une
 *              vidéo ordinaire sous ce nom.
 *   'voix'   — seulement la voix résolue : le serveur confirme que le jumeau
 *              (donc sa voix) est prêt ; le moteur vidéo n'entre pas en jeu,
 *              aucune vidéo d'avatar n'est demandée.
 */
export async function gardeJumeauAvantRendu(args: {
  mode: JumeauMode;
  textes: string[];
  verifier?: (textes: string[]) => Promise<EtatJumeau | null>;
}): Promise<string | null> {
  if (args.mode !== 'avatar' && args.mode !== 'voix') return null;
  const etat = await (args.verifier ?? verifierJumeauAvantRendu)(args.textes);
  if (!etat) return JUMEAU_INDISPONIBLE;
  if (!etat.pret) return etat.message || JUMEAU_INDISPONIBLE;
  if (args.mode === 'voix') return null;
  if (!etat.moteurDisponible) return etat.messageMoteur || 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.';
  return null;
}

/**
 * LES ÉTAPES RÉELLES du jumeau, dans l'ordre où elles se produisent — la
 * seule progression affichée pendant sa génération. Aucun pourcentage : ni
 * D-ID ni HeyGen n'en fournissent, et `/api/avatar/status` ne rend que
 * `processing | completed | failed`. L'ancien `setRenderProgress(5)` figeait
 * « 5 % » à l'écran pendant 5 à 30 min : un chiffre qui ne mesurait rien.
 *
 *   preparation — garde serveur + solde (navigateur)
 *   envoi       — POST /generer : voix synthétisée + dépôt chez le fournisseur
 *   traitement  — le fournisseur anime l'avatar (polling du statut)
 *   stockage    — vidéo rapatriée sur notre stockage, posée dans « Vidéo »
 *   rendu       — composition du montage (là, le pourcentage est RÉEL : frames)
 *   pret        — le montage est livré
 */
export type PhaseJumeau = 'preparation' | 'envoi' | 'traitement' | 'stockage' | 'rendu' | 'pret';
export const PHASES_JUMEAU: ReadonlyArray<{ phase: PhaseJumeau; libelle: string }> = [
  { phase: 'preparation', libelle: 'Préparation' },
  { phase: 'envoi', libelle: 'Envoi' },
  { phase: 'traitement', libelle: 'Traitement' },
  { phase: 'stockage', libelle: 'Stockage' },
  { phase: 'rendu', libelle: 'Rendu' },
  { phase: 'pret', libelle: 'Prêt' },
];

/** Ce que dit chaque étape pendant qu'elle tourne — une phrase, pas un chiffre. */
export const DETAIL_PHASE_JUMEAU: Record<PhaseJumeau, string> = {
  preparation: 'Vérification de votre jumeau et de votre solde…',
  envoi: 'Envoi de votre voix et de votre avatar au fournisseur…',
  traitement: 'Votre jumeau est animé par le fournisseur (5 à 20 min).',
  stockage: 'Vidéo du jumeau reçue — mise en place dans la séquence « Vidéo »…',
  rendu: 'Composition du montage…',
  pret: 'Prêt.',
};

/** Les étapes au format `ProgressStatus` : terminées avant, courante, à venir après. */
export function etapesJumeau(phase: PhaseJumeau, echec = false): Array<{ libelle: string; etat: 'terminee' | 'courante' | 'a_venir' | 'echouee' }> {
  const i = PHASES_JUMEAU.findIndex((p) => p.phase === phase);
  return PHASES_JUMEAU.map((p, k) => ({
    libelle: p.libelle,
    etat: k < i || (phase === 'pret' && k === i) ? 'terminee' : k === i ? (echec ? 'echouee' : 'courante') : 'a_venir',
  }));
}

/**
 * Délai d'attente CLIENT. Le serveur (`STALE_AFTER_MS`, `lib/avatar/statut.ts`)
 * déclare une génération perdue — et la rembourse — après 30 min comptées
 * depuis sa création. Le client attendait 20 min seulement : il annonçait un
 * échec que le serveur n'avait pas prononcé, pendant que la vidéo pouvait
 * encore aboutir (et être débitée). On attend donc 30 min + une marge, pour
 * que ce soit TOUJOURS le verdict serveur (`failed`, remboursé) qui s'affiche.
 */
export const JUMEAU_ATTENTE_MAX_MS = 32 * 60 * 1000;
/** Intervalle nominal entre deux lectures du statut. */
export const JUMEAU_POLL_MS = 5000;
/**
 * Échecs CONSÉCUTIFS tolérés (réseau coupé, 5xx, proxy, erreur transitoire
 * fournisseur relayée en 4xx) avant d'abandonner l'ATTENTE — jamais la
 * génération : elle continue côté serveur et reste reprenable au retour
 * (l'identifiant est persisté). Une réponse valide remet le compteur à zéro.
 * Chaque relance est une simple LECTURE de statut : aucun nouveau lancement,
 * aucun débit.
 */
export const JUMEAU_ECHECS_MAX = 6;
const attenteApresEchec = (n: number) => Math.min(30_000, JUMEAU_POLL_MS * 2 ** (n - 1));

export const JUMEAU_INTROUVABLE = 'Cette génération de jumeau est introuvable. Relancez-la si besoin.';
export const JUMEAU_CONNEXION_PERDUE = 'Connexion perdue pendant la préparation de votre jumeau. Il continue côté serveur : rouvrez cette page pour le retrouver.';
export const JUMEAU_SESSION_EXPIREE = 'Votre session a expiré. Reconnectez-vous : votre jumeau continue côté serveur et sera repris.';
export const JUMEAU_TROP_LONG = 'La génération de votre jumeau prend trop de temps. Réessayez plus tard.';

/**
 * Erreur TERMINALE d'une attente de jumeau. `code` dit à l'appelant quoi faire
 * de l'identifiant persisté :
 *   'introuvable' — 404 : la génération n'existe pas (ou pas pour ce compte).
 *                   L'identifiant est à OUBLIER : le reprendre bouclerait.
 *   'echec'       — le serveur a dit `failed` (déjà remboursé côté serveur).
 *   'session' / 'connexion' / 'delai' — l'attente s'arrête, PAS la génération :
 *                   l'identifiant est à GARDER pour la reprise au retour.
 */
export class ErreurAttenteJumeau extends Error {
  constructor(message: string, readonly code: 'introuvable' | 'echec' | 'session' | 'connexion' | 'delai') {
    super(message);
    this.name = 'ErreurAttenteJumeau';
  }
}

/**
 * ATTEND une génération DÉJÀ lancée — le cœur de polling, partagé par le
 * lancement en un clic et la REPRISE au montage : GET /api/avatar/status?
 * generationId= jusqu'à `completed` (URL re-hébergée) ou `failed`. Rend l'URL
 * de la vidéo, ou lève `ErreurAttenteJumeau`. Aucune vidéo de repli.
 *
 * Cette fonction ne lance RIEN : elle sonde un identifiant existant. Elle est
 * donc sûre à rappeler pour une génération orpheline (l'onglet a été fermé
 * pendant le rendu) — le serveur, lui, finalise la scène `done` quel que soit
 * son âge (voir `avatar/status/route.ts`).
 *
 * Contrat de la route, lu tel quel :
 *   200 success + completed/videoUrl → fin, URL rendue
 *   200 success + failed             → fin, message serveur
 *   200 success + processing         → on relit dans JUMEAU_POLL_MS
 *   404                              → fin, génération introuvable (terminal)
 *   401                              → fin, session expirée (terminal)
 *   autre / JSON illisible / réseau  → transitoire, relance bornée (JUMEAU_ECHECS_MAX)
 */
export async function attendreStatutJumeau(args: {
  generationId: string;
  onEtape?: (message: string) => void;
  onPhase?: (phase: PhaseJumeau) => void;
  fetchImpl?: typeof fetch;
  attendreMs?: (ms: number) => Promise<void>;
  maxAttenteMs?: number;
  maintenant?: () => number;
}): Promise<{ url: string }> {
  const f = args.fetchImpl ?? fetch;
  const dormir = args.attendreMs ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const horloge = args.maintenant ?? Date.now;
  const debut = horloge();
  const limite = args.maxAttenteMs ?? JUMEAU_ATTENTE_MAX_MS;
  let echecs = 0;
  let derniereCause: 'connexion' | 'serveur' = 'serveur';
  args.onPhase?.('traitement');
  while (horloge() - debut < limite) {
    let res: Response | null = null;
    try {
      res = await f(`/api/avatar/status?generationId=${encodeURIComponent(args.generationId)}`);
    } catch {
      res = null; // réseau coupé, DNS, onglet en veille… : transitoire
    }
    if (res && res.status === 404) throw new ErreurAttenteJumeau(JUMEAU_INTROUVABLE, 'introuvable');
    if (res && res.status === 401) throw new ErreurAttenteJumeau(JUMEAU_SESSION_EXPIREE, 'session');
    const json = res ? await res.json().catch(() => null) : null;
    if (res?.ok && json?.success) {
      echecs = 0;
      const d = json.data as { status: string; videoUrl?: string | null; error?: string | null };
      if (d.status === 'completed' && d.videoUrl) {
        args.onPhase?.('stockage');
        return { url: d.videoUrl };
      }
      if (d.status === 'failed') throw new ErreurAttenteJumeau(d.error || 'La génération de votre jumeau a échoué.', 'echec');
      args.onEtape?.(DETAIL_PHASE_JUMEAU.traitement);
      await dormir(JUMEAU_POLL_MS);
      continue;
    }
    echecs += 1;
    derniereCause = res ? 'serveur' : 'connexion';
    if (echecs >= JUMEAU_ECHECS_MAX) {
      throw new ErreurAttenteJumeau(
        derniereCause === 'connexion' ? JUMEAU_CONNEXION_PERDUE : 'Le suivi de votre jumeau est momentanément indisponible. Il continue côté serveur : rouvrez cette page pour le retrouver.',
        'connexion',
      );
    }
    args.onEtape?.('Connexion instable — nouvelle tentative de lecture du statut…');
    await dormir(attenteApresEchec(echecs));
  }
  throw new ErreurAttenteJumeau(JUMEAU_TROP_LONG, 'delai');
}

/**
 * Lance la vidéo du jumeau et l'attend — par les routes existantes :
 * POST /api/creer/jumeau/generer, puis `attendreStatutJumeau`. Rend l'URL de
 * la vidéo, ou lève avec le message à afficher. Aucune vidéo de repli.
 *
 * `onLancee` est appelé DÈS que le serveur a accepté la génération (avant tout
 * polling) : c'est le point où l'appelant persiste `generationId`, pour qu'une
 * page fermée pendant le rendu puisse REPRENDRE la même génération au retour
 * plutôt que d'en payer une seconde.
 */
export async function genererEtAttendreVideoJumeau(args: {
  textes: string[];
  aspectRatio: string;
  onLancee?: (generationId: string, avatarVersion: number) => void;
  onEtape?: (message: string) => void;
  onPhase?: (phase: PhaseJumeau) => void;
  fetchImpl?: typeof fetch;
  attendreMs?: (ms: number) => Promise<void>;
  maxAttenteMs?: number;
}): Promise<{ url: string; generationId: string; avatarVersion: number }> {
  const f = args.fetchImpl ?? fetch;
  args.onPhase?.('envoi');
  args.onEtape?.('Génération de votre jumeau…');
  const lancement = await f(`${JUMEAU_API}/generer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ textes: args.textes, aspectRatio: args.aspectRatio }),
  });
  const lance = await lancement.json().catch(() => ({}));
  if (!lancement.ok || !lance?.success) throw new Error(lance?.error || JUMEAU_INDISPONIBLE);
  const generationId: string = lance.data.generationId;
  const avatarVersion: number = lance.data.avatarVersion;
  // Persister l'identifiant AVANT d'attendre : si l'onglet se ferme pendant le
  // rendu, la reprise au montage le retrouvera. Après ce point, `généré` et
  // `abandonné` ne se distinguent que par cet identifiant.
  args.onLancee?.(generationId, avatarVersion);
  const { url } = await attendreStatutJumeau({
    generationId,
    onEtape: args.onEtape,
    onPhase: args.onPhase,
    fetchImpl: args.fetchImpl,
    attendreMs: args.attendreMs,
    maxAttenteMs: args.maxAttenteMs,
  });
  return { url, generationId, avatarVersion };
}
