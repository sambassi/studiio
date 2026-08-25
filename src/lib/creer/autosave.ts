/**
 * Marqueur d'auto-sauvegarde de l'editeur.
 *
 * ⚠️ Ce module ne stocke PAS le montage : l'editeur avance `/dashboard/creer-avance` le
 * persiste deja integralement sous sa propre cle (`studiio-creer-design-prefs`)
 * — instantane complet, sauvegarde debounce a 500 ms ET synchrone sur
 * `beforeunload`, `pagehide`, `visibilitychange` et au demontage. Ce fichier
 * n'y touche jamais.
 *
 * Ce qui manquait, et que ce module apporte :
 *   - savoir QUAND la derniere sauvegarde a eu lieu, pour l'afficher ;
 *   - pouvoir declarer le brouillon « termine » apres un export reussi.
 *
 * D'ou une cle SEPAREE et VERSIONNEE, qui ne contient qu'un horodatage. La
 * separation est le point important : effacer ce marqueur apres un export ne
 * doit jamais effacer les preferences de design de l'utilisateur.
 */

export const AUTOSAVE_VERSION = 1;

/** Cle du marqueur pour le grand editeur. Versionnee : un format futur
 *  incompatible utilisera `:v2:` et ignorera proprement l'ancien. */
export const AUTOSAVE_KEY_CREER = `studiio:autosave:v${AUTOSAVE_VERSION}:creer`;

export interface AutosaveMark {
  version: number;
  /** Millisecondes epoch de la derniere sauvegarde. */
  savedAt: number;
}

/** `true` cote navigateur uniquement — l'editeur est rendu cote serveur au
 *  premier passage, ou `window` n'existe pas. */
function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Ecrit le marqueur. Renvoie `false` si le stockage est indisponible
 * (SSR, quota depasse, navigation privee) — jamais d'exception : une
 * sauvegarde d'horodatage ne doit pas pouvoir casser l'editeur.
 */
export function markAutosave(key: string, now: number = Date.now()): boolean {
  if (!hasStorage()) return false;
  try {
    const mark: AutosaveMark = { version: AUTOSAVE_VERSION, savedAt: now };
    window.localStorage.setItem(key, JSON.stringify(mark));
    return true;
  } catch {
    return false;
  }
}

/**
 * Relit le marqueur. Renvoie `null` s'il est absent, illisible, d'une autre
 * version, ou si l'horodatage n'est pas exploitable — l'appelant retombe
 * alors sur le comportement d'origine, sans indicateur.
 */
export function readAutosave(key: string): AutosaveMark | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutosaveMark> | null;
    if (!parsed || parsed.version !== AUTOSAVE_VERSION) return null;
    const savedAt = parsed.savedAt;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) return null;
    return { version: AUTOSAVE_VERSION, savedAt };
  } catch {
    return null;
  }
}

/** Efface le marqueur — et lui seul. */
export function clearAutosave(key: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* stockage indisponible : rien a effacer de toute facon */
  }
}

/**
 * Age lisible d'une sauvegarde, pour l'indicateur.
 * Volontairement grossier : au-dela de l'heure, la minute exacte n'apprend
 * plus rien a l'utilisateur.
 */
export function formatAutosaveAge(savedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 45) return "a l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

// ── Repartir de zéro ──────────────────────────────────────────────────────

/** Cle de l'instantane de l'editeur avance `/dashboard/creer-avance`. */
export const CREER_PREFS_KEY = 'studiio-creer-design-prefs';

/**
 * Champs de l'instantane qui appartiennent au MONTAGE en cours, par
 * opposition aux preferences de design (polices, couleurs, positions,
 * tailles, logo, gabarits) qui suivent l'utilisateur d'un montage a l'autre.
 *
 * C'est cette liste — et rien d'autre — que « Repartir de zéro » efface.
 * Preferences et montage partagent une seule cle : sans ce filtrage, repartir
 * d'un montage neuf emporterait aussi la charte visuelle de l'utilisateur.
 *
 * Volontairement CONSERVES malgre l'ambiguite : `ctaMainText` / `ctaSubText`
 * (appel a l'action recurrent d'une marque, pas une copie jetable) et
 * `logoImage`. Mieux vaut laisser survivre un champ de trop que supprimer un
 * reglage que l'utilisateur croyait acquis.
 */
export const MONTAGE_CONTENT_FIELDS: readonly string[] = [
  'title', 'subtitle', 'extraTitle', 'extraSubtitle',
  'contentTheme', 'customTopic',
  'cards', 'salesPhrases', 'customCardIcons', 'cardGroups',
  'pexelsPhotos', 'selectedPhotoIndex', 'batchPhotoIndices',
  'rushList',
  'audioMusicUrl', 'audioVoiceUrl',
  'sequenceVoices', 'sequenceVoicesUserEdited',
  'videoOverlayText', 'extraOverlays',
  'audioKeyframes',
  'sequenceBackgrounds',
];

/**
 * Retire du snapshot les seuls champs de contenu, et le reecrit.
 *
 * Renvoie `false` — sans rien casser — si le stockage est indisponible, si
 * aucun instantane n'existe, ou s'il est illisible : l'appelant recharge
 * alors sur l'etat courant, ce qui est le comportement d'aujourd'hui.
 */
export function clearMontageContent(key: string = CREER_PREFS_KEY): boolean {
  if (!hasStorage()) return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return false;
    for (const field of MONTAGE_CONTENT_FIELDS) delete (snap as Record<string, unknown>)[field];
    window.localStorage.setItem(key, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}
