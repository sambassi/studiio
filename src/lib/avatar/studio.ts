/**
 * MINI-STUDIO AVATAR — les règles PURES de /dashboard/avatar.
 *
 * Deux usages, jamais confondus :
 *
 *   A. ENREGISTRER MA SOURCE — caméra + prompteur → un FICHIER, rendu au
 *      parcours d'import EXISTANT (consentement → `POST /api/avatar/create`
 *      → nouvelle version → entraînement → validation). Rien n'est envoyé ni
 *      écrit avant la confirmation de la personne.
 *
 *   B. GÉNÉRER UNE VIDÉO AVEC MON AVATAR — texte → la chaîne du jumeau
 *      (`POST /api/creer/jumeau/generer` : avatar actif relu, voix clonée,
 *      prononciations du compte, débit idempotent, remboursement unique),
 *      puis, si demandé, recadrage + LUT appliqués DANS LE NAVIGATEUR par le
 *      compositeur existant (`composeVideo`), MP4 par `downloadBlob`.
 *      Le post-traitement est INCLUS dans le coût de la génération : aucune
 *      réservation de rendu, aucun second débit.
 *
 * Aucun accès réseau ici : tout est testable sans navigateur.
 */

export type FormatStudio = '9:16' | '16:9' | '1:1';
export const FORMATS_STUDIO: readonly FormatStudio[] = ['9:16', '16:9', '1:1'];

/** Mêmes dimensions que l'Assistant Créer (`VIDEO_SIZE`). */
export const DIMENSIONS_STUDIO: Record<FormatStudio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

export const RATIO_CSS: Record<FormatStudio, string> = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1' };

export const estFormatStudio = (v: unknown): v is FormatStudio => v === '9:16' || v === '16:9' || v === '1:1';

// ── Coût et solde ──────────────────────────────────────────────────────

export interface EtatCout {
  /** Le bouton « Générer ma vidéo » peut-il partir ? */
  peutGenerer: boolean;
  /** Solde connu ET inférieur au coût. */
  insuffisant: boolean;
  libelleCout: string;
  libelleSolde: string;
}

/**
 * Coût et solde, tels qu'ils sont affichés AVANT la génération.
 *
 * `solde === null` : le serveur ne l'a pas donné (compte partenaire, solde
 * indisponible). On ne l'invente pas, et on ne bloque pas : le serveur
 * refuse lui-même une génération sans crédits (402), avant tout fournisseur.
 */
export function etatCout(args: { cout: number; solde: number | null; texte: string; enCours: boolean }): EtatCout {
  const insuffisant = typeof args.solde === 'number' && args.solde < args.cout;
  return {
    insuffisant,
    peutGenerer: !args.enCours && !insuffisant && args.texte.trim().length > 0,
    libelleCout: `${args.cout} crédits`,
    libelleSolde: typeof args.solde === 'number' ? `${args.solde} crédits` : 'indisponible',
  };
}

// ── Recadrage + étalonnage ─────────────────────────────────────────────

export interface Recadrage { scale: number; offsetX: number; offsetY: number }
export const RECADRAGE_NEUTRE: Recadrage = { scale: 1, offsetX: 0, offsetY: 0 };

export function recadrageNeutre(t: Recadrage | null | undefined): boolean {
  return !t || (t.scale === 1 && t.offsetX === 0 && t.offsetY === 0);
}

/**
 * Faut-il repasser la vidéo par le compositeur ? Seulement si un recadrage
 * ou une LUT est choisi. Sinon le MP4 d'origine (re-hébergé chez nous) EST
 * le fichier final : on le télécharge tel quel.
 */
export function besoinPostTraitement(args: { recadrage: Recadrage | null; lutChoisie: boolean }): boolean {
  return args.lutChoisie || !recadrageNeutre(args.recadrage);
}

/**
 * Les options du compositeur pour le post-traitement : UNE seule séquence,
 * la vidéo de l'avatar, au format choisi — ni titre, ni cartes, ni CTA, ni
 * filigrane, ni texte de site. Le son de l'avatar est EXIGÉ (`rushAudioRequis`) : un rendu
 * muet échoue plutôt que d'être livré.
 *
 * Le recadrage et la LUT passent par `rushTransform` / `rushLut`, les mêmes
 * entrées que l'export de Créer : ce que l'aperçu montre est ce que le
 * moteur dessine.
 */
export function optionsPostTraitement<L>(args: {
  videoUrl: string;
  format: FormatStudio;
  dureeSecondes: number;
  recadrage: Recadrage | null;
  lut: L | null;
}) {
  const { width, height } = DIMENSIONS_STUDIO[args.format];
  return {
    width,
    height,
    title: '',
    subtitle: '',
    cards: [] as never[],
    videoUrl: args.videoUrl,
    introDuration: 0,
    cardsDuration: 0,
    ctaDuration: 0,
    videoDuration: Math.max(1, Math.ceil(args.dureeSecondes)),
    rushTransform: recadrageNeutre(args.recadrage) ? undefined : { ...(args.recadrage as Recadrage) },
    rushLut: args.lut,
    rushAudioRequis: true,
    watermark: false,
    // Le compositeur incruste par défaut un texte de site (« Afroboost.com ») :
    // la vidéo de l'avatar n'en porte AUCUN — seulement recadrage et style.
    siteText: { text: '', enabled: false },
  };
}

export function nomFichierAvatar(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `mon-avatar-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.mp4`;
}

// ── Génération en cours : reprise après rafraîchissement ───────────────

/**
 * La génération lancée est mémorisée DÈS que le serveur l'accepte : après un
 * rafraîchissement, on REPREND son suivi (lecture de statut, gratuite) au
 * lieu d'en lancer — et d'en payer — une seconde.
 */
export const CLE_GENERATION_STUDIO = 'studiio_avatar_studio_generation';

export interface GenerationMemorisee { generationId: string; format: FormatStudio; lanceeLe: number }

export function lireGenerationMemorisee(brut: string | null, maintenant = Date.now()): GenerationMemorisee | null {
  if (!brut) return null;
  try {
    const g = JSON.parse(brut) as Partial<GenerationMemorisee>;
    if (typeof g.generationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(g.generationId)) return null;
    if (!estFormatStudio(g.format) || typeof g.lanceeLe !== 'number') return null;
    // Au-delà de 40 min, le serveur a de toute façon tranché (délai 30 min).
    if (maintenant - g.lanceeLe > 40 * 60 * 1000) return null;
    return { generationId: g.generationId, format: g.format, lanceeLe: g.lanceeLe };
  } catch {
    return null;
  }
}

// ── Enregistrement caméra ──────────────────────────────────────────────

/**
 * Le format d'enregistrement, parmi ceux que le navigateur sait produire ET
 * que l'import accepte (`/api/avatar/create` : MP4, WebM, MOV). `mp4Requis` :
 * le fournisseur de l'avatar vidéo n'accepte pas le WebM — on ne propose
 * alors que du MP4, ou rien.
 */
export function choisirFormatEnregistrement(
  supporte: (mime: string) => boolean,
  mp4Requis = false,
): string | null {
  const mp4 = ['video/mp4;codecs=avc1,mp4a', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const candidats = mp4Requis ? mp4 : [...webm, ...mp4];
  return candidats.find((m) => supporte(m)) ?? null;
}

/** Le type « nu » d'un mime (`video/webm;codecs=…` → `video/webm`) et son extension. */
export function typeEtExtension(mime: string): { type: string; extension: string } {
  const type = mime.split(';')[0].trim();
  return { type, extension: type === 'video/mp4' ? 'mp4' : type === 'video/quicktime' ? 'mov' : 'webm' };
}

/** Message clair pour un refus d'accès à la caméra — jamais l'erreur brute du navigateur. */
export function messageErreurCamera(nom: string | undefined): string {
  if (nom === 'NotAllowedError' || nom === 'SecurityError') return 'Accès à la caméra refusé. Autorisez la caméra et le micro dans votre navigateur, puis réessayez.';
  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') return 'Aucune caméra détectée. Branchez une caméra ou importez une vidéo.';
  if (nom === 'NotReadableError') return 'La caméra est utilisée par une autre application. Fermez-la, puis réessayez.';
  return 'La caméra n’a pas pu démarrer. Vous pouvez importer une vidéo à la place.';
}

export function formaterDuree(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Prompteur ──────────────────────────────────────────────────────────

/** Vitesse de défilement (1 à 10) → pixels par seconde. */
export function vitessePrompteur(niveau: number): number {
  const n = Math.max(1, Math.min(10, Math.round(niveau)));
  return 12 + n * 10;
}

// ── Prononciations : le mot sélectionné ────────────────────────────────

/** Le mot (ou groupe) sélectionné dans un texte, nettoyé ; `null` si rien d'exploitable. */
export function motSelectionne(texte: string, debut: number, fin: number): string | null {
  if (!(fin > debut)) return null;
  const brut = texte.slice(debut, fin).replace(/\s+/g, ' ').trim().replace(/^[«»"'“”‘’.,;:!?()[\]]+|[«»"'“”‘’.,;:!?()[\]]+$/g, '');
  return brut.length > 0 && brut.length <= 80 ? brut : null;
}
