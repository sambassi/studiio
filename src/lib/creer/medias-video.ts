/**
 * MÉDIAS DE LA SÉQUENCE « VIDÉO » — Créer multi-sources, en manuel.
 *
 * Une liste ORDONNÉE de médias de provenances différentes, que l'utilisateur
 * range lui-même : ses rushes, son avatar (jumeau, produit à l'envoi
 * seulement), des vidéos et des photos suggérées (stock), sa médiathèque.
 * Exemple : Mon avatar → Mon rush → Vidéo suggérée → Mon avatar → Photo
 * suggérée, puis le CTA.
 *
 * Module PUR (aucun React, aucun DOM, aucun réseau) : le wizard, le
 * composant de liste et les tests l'appellent.
 *
 * ── Compatibilité (règle « Default safe ») ─────────────────────────────
 * Tant que la liste ne contient QUE des vidéos (rushes, vidéos suggérées,
 * vidéos de la médiathèque), elle n'est qu'une VUE des champs d'avant
 * (`rushUrl` + `rushSuivants`) : même brouillon, même montage (smart montage
 * compris), même export. Elle ne devient une donnée à part entière
 * (`draft.mediasVideo`, `metadata.rushSegments` avec `kind`) qu'à l'entrée
 * d'un avatar ou d'une photo (`estListeEnrichie`).
 *
 * ── Plan (`planDetaille`, projeté par `planDepuisListe`) ─────────────────
 * Déterministe, dans l'ORDRE de la liste, UNE source de vérité pour l'écran
 * et le rendu (durée affichée = chronologie = aperçu = rendu = jouée) :
 *  - sans avatar : chaque média joue sa durée (vidéo : sa durée retenue,
 *    bornée comme un rush ; photo : 3 s par défaut, en Ken Burns) ;
 *  - avec avatar : la PAROLE de l'avatar est la durée maîtresse. Les médias
 *    gardent EXACTEMENT leur durée, les créneaux d'avatar se partagent le
 *    reste ; si les médias ne tiennent pas, rien n'est raccourci en silence :
 *    le dépassement est affiché et l'envoi bloqué. Chaque extrait d'avatar a
 *    `depuis === debut` (INVARIANT LIP-SYNC, le même que `planMultiSources`
 *    de l'Autopilote) : la voix de l'avatar est continue, les plans de coupe
 *    sont muets.
 */
import type { RushItem, RushSegment, MouvementImage, SourceSegment } from '@/lib/creer/multi-rush';
import { MOUVEMENTS_PHOTO } from '@/lib/autopilot/plan-multi-sources';
import { TRANSITION_DURATION_SECONDS } from '@/lib/creer/transitionPreview';

export type SourceMediaVideo = 'rush' | 'avatar' | 'stock-video' | 'stock-photo' | 'mediatheque';
export type TypeMediaVideo = 'video' | 'image';

export interface MediaVideo {
  /** Identifiant stable dans la liste (clé React, sélection). */
  id: string;
  source: SourceMediaVideo;
  /** URL du média. ABSENTE pour un avatar pas encore produit (placeholder). */
  url?: string;
  type: TypeMediaVideo;
  /**
   * Durée MESURÉE (s) : vidéo = durée sondée à l'import (`loadedmetadata`),
   * photo = 3 s par défaut, avatar = durée de sa parole une fois produit.
   * Une durée ANNONCÉE par une recherche n'entre jamais ici.
   */
  duree?: number | null;
  /**
   * Durée CHOISIE par l'utilisateur (s), distincte de la mesure. Photo :
   * 1–30 s ; vidéo : raccourcie seulement (jamais au-delà de `duree`) ;
   * avatar : jamais (sa durée est celle de la voix). Absente = la durée par
   * défaut. Se déplace avec le média, disparaît à son remplacement.
   */
  dureeChoisie?: number | null;
  /** Nom technique (fichier) : jamais affiché comme libellé, seulement en `title`. */
  nom?: string;
  meta?: {
    /** Extrait « Temps forts » (ne se redécoupe pas). */
    isClip?: boolean;
    /** Média produit par l'IA (image générée…). */
    ia?: boolean;
    /** Version de l'avatar qui a produit la vidéo. */
    avatarVersion?: number;
    /**
     * Vidéo du jumeau posée comme RUSH (parcours « jumeau seul » d'avant) :
     * libellée « Mon avatar », mais montée comme un rush — rien ne change.
     */
    jumeau?: boolean;
  };
}

/** Durée d'une photo par défaut (s). */
export const DUREE_PHOTO_DEFAUT = 3;
/** Durée supposée d'une vidéo dont la durée n'est pas (encore) connue (s). */
export const DUREE_VIDEO_REPLI = 6;
/** Bornes d'une durée retenue (s). */
export const DUREE_MEDIA_MIN = 1;
export const DUREE_MEDIA_MAX = 120;
/** Bornes de la durée choisie d'une photo (s), réglée seconde par seconde. */
export const DUREE_PHOTO_MIN = 1;
export const DUREE_PHOTO_MAX = 30;
/** Un créneau d'avatar ne descend jamais sous cette durée tant que la parole le permet. */
export const AVATAR_CRENEAU_MIN_S = 1.5;
/** Nombre de médias au plus dans la liste (garde-fou brouillon). */
export const MAX_MEDIAS_VIDEO = 20;

const SOURCES: readonly SourceMediaVideo[] = ['rush', 'avatar', 'stock-video', 'stock-photo', 'mediatheque'];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

let compteur = 0;
/** Identifiant neuf (déterministe dans un même onglet, aucune horloge). */
export function nouvelIdMedia(prefixe = 'm'): string {
  compteur += 1;
  return `${prefixe}-${compteur.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Nom de fichier d'une vidéo stock importée (`stock-<fournisseur>-video-…`). */
export function estNomStock(nomOuUrl: string | null | undefined): boolean {
  if (!nomOuUrl) return false;
  const fichier = nomOuUrl.split('?')[0].split('/').pop() ?? '';
  return /^stock[-_]/i.test(fichier);
}

/**
 * La liste d'un brouillon / d'un écran d'avant : le rush principal puis les
 * suivants, chacun une vidéo. Une vidéo importée depuis la recherche stock
 * (`stockUrls`, ou un fichier `stock-…`) est une « Vidéo suggérée ».
 * Ids DÉRIVÉS de la position et de l'URL : deux dérivations de la même liste
 * sont égales (React ne remonte rien).
 */
/** Provenance d'une vidéo posée comme rush. */
function sourceVideo(
  r: { url: string; name?: string },
  stock?: ReadonlySet<string> | null,
  mediatheque?: ReadonlySet<string> | null,
): SourceMediaVideo {
  if (stock?.has(r.url) || estNomStock(r.name) || estNomStock(r.url)) return 'stock-video';
  if (mediatheque?.has(r.url)) return 'mediatheque';
  return 'rush';
}

export function listeDepuisRushs(
  rushs: ReadonlyArray<RushItem>,
  stockUrls?: ReadonlySet<string> | ReadonlyArray<string> | null,
  mediathequeUrls?: ReadonlySet<string> | null,
): MediaVideo[] {
  const stock = stockUrls ? new Set(stockUrls as Iterable<string>) : new Set<string>();
  return rushs
    .filter((r) => typeof r?.url === 'string' && r.url.length > 0)
    .map((r, i) => ({
      id: `r${i}:${r.url}`,
      source: sourceVideo(r, stock, mediathequeUrls),
      url: r.url,
      type: 'video' as const,
      duree: typeof r.secondes === 'number' && r.secondes > 0 ? r.secondes : null,
      nom: r.name || undefined,
      ...(r.isClip || estVideoJumeau(r) ? { meta: { ...(r.isClip ? { isClip: true } : {}), ...(estVideoJumeau(r) ? { jumeau: true } : {}) } } : {}),
    }));
}

/** Vidéo du jumeau déjà posée comme rush (nom « Mon jumeau », fichier `/avatar/<id>.mp4`). */
export function estVideoJumeau(r: { url: string; name?: string }): boolean {
  return /^Mon jumeau\b/.test(r.name ?? '') || /\/avatar\/[^/]+\.mp4(\?|#|$)/.test(r.url);
}

/** La liste dépasse-t-elle ce que portent `rushUrl` / `rushSuivants` (avatar ou photo) ? */
export function estListeEnrichie(liste: ReadonlyArray<MediaVideo> | null | undefined): boolean {
  // Une vidéo RACCOURCIE aussi : sa durée choisie n'existe pas dans les champs
  // d'avant, et le smart montage ne la respecterait pas (DURÉE AFFICHÉE =
  // DURÉE RENDUE). Sans durée choisie, rien ne change.
  return !!liste?.some((m) => m.source === 'avatar' || m.type === 'image' || estDureeChoisieActive(m));
}

/** La liste contient-elle au moins un créneau d'avatar ? */
export function listeAvecAvatar(liste: ReadonlyArray<MediaVideo> | null | undefined): boolean {
  return !!liste?.some((m) => m.source === 'avatar');
}

/** Un créneau d'avatar attend-il encore sa vidéo (produite à l'envoi) ? */
export function avatarAProduire(liste: ReadonlyArray<MediaVideo> | null | undefined): boolean {
  return !!liste?.some((m) => m.source === 'avatar' && !m.url);
}

/** Les VIDÉOS de la liste (hors avatar), dans l'ordre, sous la forme des champs d'avant. */
export function rushsDeListe(liste: ReadonlyArray<MediaVideo>): RushItem[] {
  return liste
    .filter((m) => m.type === 'video' && m.source !== 'avatar' && !!m.url)
    .map((m) => ({
      url: m.url!,
      name: m.nom ?? '',
      ...(m.meta?.isClip ? { isClip: true } : {}),
      secondes: typeof m.duree === 'number' && m.duree > 0 ? m.duree : null,
    }));
}

/** URL des médias à recadrer (vidéos et photos, hors avatar). */
export function urlsRecadrables(liste: ReadonlyArray<MediaVideo> | null | undefined): string[] {
  return (liste ?? []).filter((m) => m.source !== 'avatar' && !!m.url).map((m) => m.url!);
}

// ── Gestes sur la liste (toujours une NOUVELLE liste) ────────────────────

export function ajouterMedia(liste: ReadonlyArray<MediaVideo>, media: MediaVideo, position?: number): MediaVideo[] {
  if (liste.length >= MAX_MEDIAS_VIDEO) return [...liste];
  const out = [...liste];
  const i = typeof position === 'number' && position >= 0 && position <= out.length ? position : out.length;
  out.splice(i, 0, media);
  return out;
}

export function deplacerMedia(liste: ReadonlyArray<MediaVideo>, i: number, delta: number): MediaVideo[] {
  const j = i + delta;
  if (i < 0 || i >= liste.length || j < 0 || j >= liste.length) return [...liste];
  const out = [...liste];
  const [x] = out.splice(i, 1);
  out.splice(j, 0, x);
  return out;
}

export function retirerMedia(liste: ReadonlyArray<MediaVideo>, i: number): MediaVideo[] {
  return liste.filter((_, k) => k !== i);
}

/** Remplace le média `i` (même place dans l'ordre). */
export function remplacerMedia(liste: ReadonlyArray<MediaVideo>, i: number, media: MediaVideo): MediaVideo[] {
  if (i < 0 || i >= liste.length) return [...liste];
  return liste.map((m, k) => (k === i ? media : m));
}

/** Pose l'URL et la durée de l'avatar produit dans CHAQUE créneau d'avatar. */
export function poserVideoAvatar(
  liste: ReadonlyArray<MediaVideo>, url: string, secondes: number | null, avatarVersion?: number,
): MediaVideo[] {
  return liste.map((m) => (m.source === 'avatar'
    ? { ...m, url, type: 'video' as const, duree: secondes, ...(typeof avatarVersion === 'number' ? { meta: { ...m.meta, avatarVersion } } : {}) }
    : m));
}

// ── Libellés (langage utilisateur, jamais un nom de fournisseur ni de fichier) ──

/**
 * « 0:16 », « 0:04,5 » — au dixième près, comme le réglage de durée et la
 * chronologie (une durée de 4,5 s ne s'affiche jamais « 0:05 »). `null` sans durée.
 */
export function formatDureeMedia(s: number | null | undefined): string | null {
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return null;
  const dixiemes = Math.round(s * 10);
  const t = Math.floor(dixiemes / 10);
  const reste = dixiemes % 10;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${reste ? `,${reste}` : ''}`;
}

/** Provenance, en mots de l'utilisateur. */
export function libelleSource(m: Pick<MediaVideo, 'source' | 'type' | 'meta'>): string {
  if (m.meta?.ia) return 'Généré avec l’IA';
  if (m.meta?.jumeau) return 'Mon avatar';
  switch (m.source) {
    case 'avatar': return 'Mon avatar';
    case 'stock-video': return 'Vidéo suggérée';
    case 'stock-photo': return 'Photo suggérée';
    case 'mediatheque': return 'Ma médiathèque';
    default: return m.type === 'image' ? 'Photo personnelle' : 'Rush personnel';
  }
}

/** Libellé principal d'une carte : « Vidéo suggérée · 0:16 ». */
export function libelleMedia(m: MediaVideo, dureePlan?: number | null): string {
  const base = libelleSource(m);
  if (m.source === 'avatar' && !m.url) return `${base} · produit à l’envoi`;
  const d = formatDureeMedia(dureePlan ?? dureeAffichee(m));
  return d ? `${base} · ${d}` : base;
}

/** Retire une durée collée à un nom (« Vidéo suggérée · 0:08 », anciens brouillons). */
const sansDuree = (nom: string) => nom.replace(/\s*·\s*\d+:\d{2}\s*$/, '').trim();

/**
 * Infobulle : le nom du fichier, gardé pour qui le cherche, suivi de la
 * MÊME durée que la légende (`dureeEffective`) — jamais celle qu'annonçait
 * une recherche (« · 0:08 » au survol, « 0:02 » à l'écran : corrigé).
 */
export function titreMedia(m: MediaVideo, dureePlan?: number | null): string | undefined {
  // Jamais un nom qui trahit le fournisseur, même au survol.
  if (!m.nom || /pexels|unsplash/i.test(m.nom) || estNomStock(m.nom)) return undefined;
  const nom = sansDuree(m.nom);
  if (!nom) return undefined;
  const d = formatDureeMedia(dureePlan ?? dureeAffichee(m));
  return d ? `${nom} · ${d}` : nom;
}

/** Durée montrée par la légende et l'infobulle (`null` : avatar à produire, vidéo non sondée). */
function dureeAffichee(m: MediaVideo): number | null {
  if (m.source === 'avatar') return m.url ? (typeof m.duree === 'number' && m.duree > 0 ? m.duree : null) : null;
  if (m.type === 'video' && !(typeof m.duree === 'number' && m.duree > 0)) return null;
  return dureeEffective(m);
}

// ── Durées ───────────────────────────────────────────────────────────────

/** Durée de parole estimée d'un texte (≈ 2,6 mots/s), au moins 3 s. */
export function estimerDureeParole(textes: ReadonlyArray<string | null | undefined>): number {
  const mots = textes.join(' ').split(/\s+/).filter(Boolean).length;
  return r3(Math.max(3, mots / 2.6));
}

const positif = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const borne = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Durée MESURÉE d'un média (sonde / parole), `null` si inconnue. */
export function dureeMesuree(m: MediaVideo): number | null {
  return positif(m.duree);
}

/** La durée choisie d'une VIDÉO la raccourcit-elle vraiment (ou celle d'une photo est-elle posée) ? */
export function estDureeChoisieActive(m: MediaVideo): boolean {
  const c = positif(m.dureeChoisie);
  if (c === null || m.source === 'avatar') return false;
  if (m.type === 'image') return true;
  const mesuree = dureeMesuree(m);
  return mesuree !== null && c < mesuree;
}

/**
 * LA durée d'un média — UNE source de vérité pour la légende, l'infobulle,
 * la chronologie, l'aperçu du projet et le plan rendu :
 *  - photo : durée choisie (1–30 s), sinon 3 s ;
 *  - vidéo : durée mesurée, raccourcie par la durée choisie (jamais au-delà
 *    de la mesure, jamais sous 1 s) ; non sondée : 6 s supposées ;
 *  - avatar : durée de sa parole (posée à la production), sinon l'estimation.
 */
export function dureeEffective(m: MediaVideo, dureeAvatarEstimee?: number | null): number {
  if (m.source === 'avatar') return r3(dureeMesuree(m) ?? positif(dureeAvatarEstimee) ?? estimerDureeParole([]));
  const choisie = positif(m.dureeChoisie);
  if (m.type === 'image') {
    return r3(borne(choisie ?? dureeMesuree(m) ?? DUREE_PHOTO_DEFAUT, DUREE_PHOTO_MIN, DUREE_PHOTO_MAX));
  }
  const mesuree = dureeMesuree(m);
  if (mesuree === null) return DUREE_VIDEO_REPLI;
  return r3(choisie !== null ? borne(choisie, Math.min(DUREE_MEDIA_MIN, mesuree), mesuree) : mesuree);
}

/** Durée qu'un média joue hors avatar (= `dureeEffective`). */
export function dureeMedia(m: MediaVideo): number {
  return dureeEffective(m);
}

// ── LE plan détaillé — UNE source de vérité ──────────────────────────────
//
// RÈGLE ABSOLUE : durée affichée = chronologie = aperçu = plan rendu = durée
// réellement jouée. Aucune exception silencieuse.
//
// `planDetaille` est le SEUL calcul des durées et positions de la séquence
// « Vidéo ». La légende et l'infobulle d'une carte, son réglage de durée,
// l'en-tête « N s disponibles », la chronologie, l'aperçu du projet, le plan
// passé à `composeVideo` (`planDepuisListe`, simple projection) et la durée
// de séquence écrite au brouillon LISENT ses `items` — aucun composant ne
// recalcule une durée de son côté.
//
// Avec avatar, la NARRATION est la durée maîtresse :
//  - chaque média (photo, vidéo) garde EXACTEMENT sa durée effective ;
//  - les créneaux d'avatar se partagent le reste de la parole, chacun au
//    moins `AVATAR_CRENEAU_MIN_S` ; une parole RÉELLE plus longue que prévu
//    agrandit les créneaux d'avatar, jamais les médias ;
//  - si les médias ne tiennent pas (`depassement > 0`), RIEN n'est réduit :
//    le plan le dit, l'écran l'affiche et l'envoi est bloqué tant que
//    l'utilisateur n'a pas raccourci ses médias.

/** Origine de la durée de parole : estimée sur le texte, ou mesurée sur la vidéo produite. */
export type SourceParole = 'estimee' | 'reelle';

export interface ItemPlanDetaille {
  id: string;
  type: TypeMediaVideo;
  source: SourceMediaVideo;
  /** Le média de la liste (URL absente : avatar pas encore produit). */
  media: MediaVideo;
  debut: number;
  fin: number;
  /** Durée JOUÉE (= fin − debut) : celle que la carte, la chronologie et le rendu montrent. */
  dureeEffective: number;
  /** Ce média ne tient plus dans la narration de l'avatar (l'envoi est bloqué). */
  horsNarration: boolean;
}

export interface PlanDetaille {
  items: ItemPlanDetaille[];
  /** La liste contient au moins un créneau d'avatar. */
  avecAvatar: boolean;
  /** Durée de la parole de l'avatar (s) ; `null` sans avatar. */
  dureeParole: number | null;
  sourceParole: SourceParole | null;
  /** Somme des durées effectives des médias (hors avatar). */
  dureeMediasPlanifiee: number;
  /** Temps laissé aux médias par la narration (parole − créneaux d'avatar minimum) ; `null` sans avatar. */
  dureeDisponible: number | null;
  /** Temps encore libre pour les médias (≥ 0) ; `null` sans avatar. */
  dureeRestante: number | null;
  /** De combien les médias dépassent la narration (s, ≥ 0) ; 0 sans avatar. */
  depassement: number;
  /** Durée de la séquence « Vidéo » (fin du dernier item). */
  duree: number;
}

/**
 * La parole qui fixe la séquence : celle de l'avatar PRODUIT (durée mesurée,
 * « réelle ») sinon l'estimation sur le texte (« estimée »). `null` sans avatar.
 */
export function paroleDeListe(
  liste: ReadonlyArray<MediaVideo>, dureeAvatarEstimee?: number | null,
): { dureeParole: number | null; source: SourceParole | null } {
  if (!listeAvecAvatar(liste)) return { dureeParole: null, source: null };
  const posee = liste.find((m) => m.source === 'avatar' && !!m.url && positif(m.duree) !== null)?.duree ?? null;
  if (posee !== null) return { dureeParole: r3(posee), source: 'reelle' };
  return { dureeParole: r3(positif(dureeAvatarEstimee) ?? estimerDureeParole([])), source: 'estimee' };
}

export function planDetaille(
  liste: ReadonlyArray<MediaVideo>,
  opts: { dureeParole?: number | null; source?: SourceParole | null } = {},
): PlanDetaille {
  const avecAvatar = listeAvecAvatar(liste);
  const parole = !avecAvatar ? { dureeParole: null, source: null }
    : positif(opts.dureeParole) !== null
      ? { dureeParole: r3(opts.dureeParole as number), source: opts.source ?? paroleDeListe(liste).source }
      : paroleDeListe(liste);
  const effectives = liste.map((m) => (m.source === 'avatar' ? 0 : dureeEffective(m)));
  const M = r3(effectives.reduce((a, b) => a + b, 0));
  const nbAvatar = liste.filter((m) => m.source === 'avatar').length;

  let durees: number[];
  let dureeDisponible: number | null = null;
  let dureeRestante: number | null = null;
  let depassement = 0;
  const hors = liste.map(() => false);
  if (avecAvatar && parole.dureeParole !== null) {
    const P = parole.dureeParole;
    // Parole très courte : le minimum d'un créneau descend à sa part égale.
    const minAvatar = Math.min(AVATAR_CRENEAU_MIN_S, P / nbAvatar);
    dureeDisponible = r3(Math.max(0, P - nbAvatar * minAvatar));
    depassement = r3(Math.max(0, M - dureeDisponible));
    dureeRestante = r3(Math.max(0, dureeDisponible - M));
    // Dans l'ORDRE : le premier média qui fait franchir le temps disponible,
    // et ceux qui le suivent, ne tiennent plus dans la narration.
    let cumul = 0;
    liste.forEach((m, i) => {
      if (m.source === 'avatar') return;
      cumul = r3(cumul + effectives[i]);
      if (cumul > dureeDisponible! + 1e-6) hors[i] = true;
    });
    // Créneaux d'avatar : la parole moins les médias, en parts égales ; le
    // dernier prend l'arrondi pour finir EXACTEMENT sur la parole. En
    // dépassement, chacun garde son minimum (rien n'est raccourci).
    const total = depassement > 0 ? r3(M + nbAvatar * minAvatar) : P;
    const part = depassement > 0 ? r3(minAvatar) : r3((P - M) / nbAvatar);
    const dernierAvatar = liste.map((m) => m.source).lastIndexOf('avatar');
    durees = liste.map((m, i) => (m.source !== 'avatar' ? effectives[i]
      : i === dernierAvatar ? r3(total - M - part * (nbAvatar - 1)) : part));
  } else {
    durees = effectives;
  }

  const items: ItemPlanDetaille[] = [];
  let curseur = 0;
  liste.forEach((m, i) => {
    const debut = curseur;
    const fin = r3(debut + durees[i]);
    curseur = fin;
    items.push({
      id: m.id, type: m.type, source: m.source, media: m,
      debut, fin, dureeEffective: m.source === 'avatar' ? r3(fin - debut) : durees[i],
      horsNarration: hors[i],
    });
  });
  return {
    items,
    avecAvatar,
    dureeParole: parole.dureeParole,
    sourceParole: parole.source,
    dureeMediasPlanifiee: M,
    dureeDisponible,
    dureeRestante,
    depassement,
    duree: items.length ? items[items.length - 1].fin : 0,
  };
}

/** L'item du plan pour ce média (par id). */
export function itemDuPlan(plan: PlanDetaille, id: string): ItemPlanDetaille | null {
  return plan.items.find((it) => it.id === id) ?? null;
}

export interface BornesDureeMedia {
  /** `'photo'` : − / + de 1 à 30 s ; `'video'` : raccourcir seulement ; `'voix'` : liée à la voix ; `null` : rien. */
  mode: 'photo' | 'video' | 'voix' | null;
  min: number;
  /** Plus grande durée VALIDE : bornes du média ET, avec avatar, le temps de narration encore libre. */
  max: number;
  /** Borne propre au média (photo 30 s, vidéo sa durée mesurée), narration ignorée. */
  maxMedia: number;
  /** `max` est fixé par la narration de l'avatar (et non par le média). */
  limiteParNarration: boolean;
  pas: number;
}

const plancher1 = (n: number) => Math.floor(n * 10 + 1e-6) / 10;

/**
 * Ce que la carte permet de régler sur la durée de ce média. Avec `plan`
 * (liste avec avatar), le maximum est aussi celui que la narration laisse :
 * la durée actuelle + le temps encore disponible (arrondi à 0,1 s en dessous).
 */
export function bornesDuree(m: MediaVideo, plan?: PlanDetaille | null): BornesDureeMedia {
  const sans = (mode: BornesDureeMedia['mode']): BornesDureeMedia => ({ mode, min: 0, max: 0, maxMedia: 0, limiteParNarration: false, pas: 1 });
  if (m.source === 'avatar') return sans('voix');
  let b: { mode: 'photo' | 'video'; min: number; maxMedia: number };
  if (m.type === 'image') b = { mode: 'photo', min: DUREE_PHOTO_MIN, maxMedia: DUREE_PHOTO_MAX };
  else {
    const mesuree = dureeMesuree(m);
    if (mesuree === null || !m.url) return sans(null);
    b = { mode: 'video', min: Math.min(DUREE_MEDIA_MIN, mesuree), maxMedia: mesuree };
  }
  let max = b.maxMedia;
  let limiteParNarration = false;
  if (plan?.avecAvatar && plan.dureeDisponible !== null) {
    const actuelle = dureeEffective(m);
    const autres = r3(plan.dureeMediasPlanifiee - actuelle);
    const place = plancher1(Math.max(0, plan.dureeDisponible - autres));
    if (place < max) { max = Math.max(b.min, place); limiteParNarration = true; }
  }
  return { mode: b.mode, min: b.min, max, maxMedia: b.maxMedia, limiteParNarration, pas: 1 };
}

/**
 * Le média avec la durée `secondes`, BORNÉE (photo 1–30 s ; vidéo
 * 1 s → durée mesurée). Avec `plan` (avatar), un ALLONGEMENT ne dépasse
 * jamais le temps de narration encore libre : la valeur est ramenée au
 * maximum valide AVANT d'être enregistrée (jamais au-dessous de la durée
 * actuelle). Un raccourcissement passe toujours. Une vidéo ramenée à sa
 * mesure perd sa durée choisie (retour au défaut). Avatar : inchangé.
 */
export function avecDureeChoisie(m: MediaVideo, secondes: number, plan?: PlanDetaille | null): MediaVideo {
  const b = bornesDuree(m, plan);
  if (b.mode !== 'photo' && b.mode !== 'video') return m;
  if (!Number.isFinite(secondes)) return m;
  let d = r3(borne(Math.round(secondes), b.min, b.maxMedia));
  const actuelle = dureeEffective(m);
  if (d > actuelle && d > b.max) d = r3(Math.max(actuelle, b.max));
  if (b.mode === 'video' && d >= b.maxMedia) {
    const { dureeChoisie: _retire, ...reste } = m;
    return reste;
  }
  if (d === actuelle && positif(m.dureeChoisie) === d) return m;
  return { ...m, dureeChoisie: d };
}

/**
 * Durée de la séquence « Vidéo » pour cette liste — `planDetaille(...).duree`.
 */
export function dureeListe(liste: ReadonlyArray<MediaVideo>, dureeAvatarEstimee?: number | null): number {
  if (liste.length === 0) return 0;
  const p = paroleDeListe(liste, dureeAvatarEstimee);
  return planDetaille(liste, { dureeParole: p.dureeParole, source: p.source }).duree;
}

// ── Plan rendu : projection de `planDetaille` ───────────────────────────

const sourceSegment = (m: MediaVideo): SourceSegment => (
  m.source === 'avatar' ? 'jumeau' : m.type === 'image' ? 'photo' : m.source === 'stock-video' ? 'stock' : 'rush'
);

export interface ResultatPlanListe {
  plan: RushSegment[];
  /** Fin du dernier plan — la durée de la séquence « Vidéo ». */
  duree: number;
  /** Médias écartés (sans URL : avatar non produit), pour le dire. */
  ignores: number;
  /** Les médias dépassent la narration de l'avatar (s) : AUCUN rendu tant que > 0. */
  depassement: number;
  dureeParole: number | null;
  sourceParole: SourceParole | null;
}

/**
 * Le plan passé à `composeVideo` : chaque item de `planDetaille` (dans
 * l'ordre, mêmes `debut` / `fin`) traduit en segment — rien n'est recalculé.
 * Un créneau d'avatar SANS vidéo est compté dans `ignores` (l'appelant
 * produit l'avatar avant). `depassement > 0` : l'appelant NE REND PAS.
 * Chaque extrait d'avatar a `depuis === debut` (lip-sync).
 */
export function planDepuisListe(
  liste: ReadonlyArray<MediaVideo>,
  opts: { dureeParole?: number | null; source?: SourceParole | null } = {},
): ResultatPlanListe {
  return planRenduDepuis(planDetaille(liste, opts));
}

/** La projection seule (plan déjà calculé). */
export function planRenduDepuis(p: PlanDetaille): ResultatPlanListe {
  const plan: RushSegment[] = [];
  let ignores = 0;
  let photos = 0;
  for (const it of p.items) {
    const m = it.media;
    if (!m.url) { ignores += 1; continue; }
    const { debut, fin } = it;
    if (!(fin > debut)) continue;
    if (m.source === 'avatar') {
      plan.push({ url: m.url, debut, fin, depuis: debut, kind: 'avatar', source: 'jumeau' });
    } else if (m.type === 'image') {
      const mouvement: MouvementImage = MOUVEMENTS_PHOTO[photos % MOUVEMENTS_PHOTO.length];
      photos += 1;
      plan.push({ url: m.url, debut, fin, kind: 'image', source: 'photo', mouvement });
    } else {
      plan.push({
        url: m.url, debut, fin, kind: 'video', source: sourceSegment(m),
        // Vidéo RACCOURCIE : l'extrait part du début et s'arrête à la durée
        // choisie (les champs d'entrée / sortie du smart montage).
        ...(estDureeChoisieActive(m) ? { depuis: 0, jusqua: it.dureeEffective } : {}),
      });
    }
  }
  return { plan, duree: p.duree, ignores, depassement: p.depassement, dureeParole: p.dureeParole, sourceParole: p.sourceParole };
}

/**
 * Une étape de l'aperçu du projet (chronologie, lecteur local) : un item de
 * `planDetaille`. Un créneau d'avatar pas encore produit a une URL `null` :
 * l'écran montre sa vignette, rien n'est produit.
 */
export interface EtapeApercu {
  id: string;
  source: SourceMediaVideo;
  type: TypeMediaVideo;
  /** `null` : avatar à produire (vignette + « Votre avatar parlera ici »). */
  url: string | null;
  debut: number;
  fin: number;
  /** Point d'entrée dans la vidéo (s). */
  depuis: number;
  mouvement?: MouvementImage;
  libelle: string;
  horsNarration: boolean;
}

/** Les étapes MONTRÉES : les items du plan, les mêmes que le rendu. */
export function planApercuListe(plan: PlanDetaille): { etapes: EtapeApercu[]; duree: number } {
  let photos = 0;
  const etapes = plan.items.filter((it) => it.fin > it.debut).map((it): EtapeApercu => {
    const m = it.media;
    const mouvement = m.type === 'image' && m.source !== 'avatar' ? MOUVEMENTS_PHOTO[photos++ % MOUVEMENTS_PHOTO.length] : undefined;
    return {
      id: it.id,
      source: it.source,
      type: it.type,
      url: m.url ?? null,
      debut: it.debut,
      fin: it.fin,
      depuis: m.source === 'avatar' ? it.debut : 0,
      ...(mouvement ? { mouvement } : {}),
      libelle: libelleSource(m),
      horsNarration: it.horsNarration,
    };
  });
  return { etapes, duree: plan.duree };
}

/** Une ligne de la chronologie : « Rush personnel 4–9 s ». */
export interface LigneChronologie {
  id: string;
  libelle: string;
  debut: number;
  fin: number;
  cta?: boolean;
  horsNarration?: boolean;
  /**
   * Fondu ENTRANT, en secondes, joué AVANT `debut` : le CTA apparaît par-dessus
   * la fin du dernier média, qui, lui, joue jusqu'à `debut` (le compositeur
   * place la transition dans les `TRANSITION_DURATION_SECONDS` dernières
   * secondes de la séquence sortante). `debut` reste l'instant où le CTA est
   * seul à l'écran ; absent = coupe franche.
   */
  fondu?: number;
}

/** La chronologie de la séquence Vidéo (les items du plan), puis le CTA. */
export function chronologieListe(
  plan: PlanDetaille, opts: { dureeCta?: number | null } = {},
): { lignes: LigneChronologie[]; dureeVideo: number; total: number } {
  const { etapes, duree } = planApercuListe(plan);
  const lignes: LigneChronologie[] = etapes.map((e) => ({
    id: e.id, libelle: e.libelle, debut: e.debut, fin: e.fin, ...(e.horsNarration ? { horsNarration: true } : {}),
  }));
  const cta = positif(opts.dureeCta);
  if (cta !== null && etapes.length) {
    const fondu = r3(Math.min(TRANSITION_DURATION_SECONDS, duree));
    lignes.push({ id: 'cta', libelle: 'CTA', debut: duree, fin: r3(duree + cta), cta: true, ...(fondu > 0 ? { fondu } : {}) });
  }
  return { lignes, dureeVideo: duree, total: lignes.length ? lignes[lignes.length - 1].fin : 0 };
}

/** « La durée totale dépasse la narration de 4 s » / « 6 s disponibles » — `null` sans avatar. */
export function messageNarration(plan: PlanDetaille): { depasse: boolean; texte: string } | null {
  if (!plan.avecAvatar || plan.dureeParole === null) return null;
  if (plan.depassement > 0) return { depasse: true, texte: `La durée totale dépasse la narration de ${formatSecondes(plafond1(plan.depassement))} s` };
  return { depasse: false, texte: `${formatSecondes(plancher1(plan.dureeRestante ?? 0))} s disponibles` };
}

const plafond1 = (n: number) => Math.ceil(n * 10 - 1e-6) / 10;

/**
 * Message d'arrêt à l'envoi quand la parole RÉELLE (avatar produit) laisse
 * moins de place que les médias : rien n'est rendu, l'avatar est gardé.
 */
export function messageNarrationTropCourte(plan: PlanDetaille): string {
  return `Votre narration dure ${formatSecondes(plan.dureeParole ?? 0)} s : réduisez vos médias de ${formatSecondes(plafond1(plan.depassement))} s, puis relancez — votre avatar est déjà prêt, il ne sera pas regénéré.`;
}

/** Identifiant du créneau d'avatar posé automatiquement (jumeau sans liste). */
export const ID_CRENEAU_JUMEAU_AUTO = 'avatar-auto';

/**
 * La liste MONTÉE quand le jumeau est demandé.
 *
 * Avant : sans liste enrichie, le jumeau produit à l'envoi REMPLAÇAIT toute la
 * séquence « Vidéo » par sa seule vidéo (`rushs: null`) — les autres rushes
 * choisis disparaissaient du montage, sans message.
 *
 * Désormais le jumeau prend SA place dans la liste ordonnée, et les autres
 * médias restent :
 *  - liste enrichie (avatar placé par l'utilisateur, photos…) : telle quelle ;
 *  - sinon, jumeau demandé et au moins un rush : un ancien « Mon jumeau »
 *    posé comme rush est remplacé à SA place par le créneau d'avatar ; à
 *    défaut, le créneau ouvre la séquence (l'avatar présente, puis les
 *    rushes, dans l'ordre choisi) ;
 *  - aucun rush, ou jumeau non demandé : `null` (le parcours d'avant, où
 *    rien ne peut disparaître).
 *
 * Fonction PURE, la même pour l'aperçu et pour l'envoi (parité).
 */
export function listeMontageJumeau(
  listeEnrichie: ReadonlyArray<MediaVideo> | null | undefined,
  listeRushs: ReadonlyArray<MediaVideo>,
  jumeauActif: boolean,
): MediaVideo[] | null {
  if (listeEnrichie && estListeEnrichie(listeEnrichie)) return [...listeEnrichie];
  if (!jumeauActif) return null;
  const rushs = listeRushs.filter((m) => !!m.url);
  if (rushs.length === 0) return null;
  const creneau: MediaVideo = { id: ID_CRENEAU_JUMEAU_AUTO, source: 'avatar', type: 'video', duree: null };
  let remplace = false;
  const out: MediaVideo[] = [];
  for (const m of rushs) {
    if (m.meta?.jumeau) {
      // Un seul créneau : l'avatar est UNE génération, à la place du premier
      // ancien jumeau ; les anciens jumeaux suivants ne sont pas rejoués.
      if (!remplace) { out.push(creneau); remplace = true; }
      continue;
    }
    out.push(m);
  }
  return remplace ? out : [creneau, ...out];
}

/** Un média écarté du plan, et pourquoi — en mots de l'utilisateur. */
export interface MediaExclu {
  id: string;
  libelle: string;
  raison: string;
}

/**
 * Les médias qui ne tiennent PAS dans la narration de l'avatar, dans l'ordre.
 * Montrés AVANT toute génération : l'envoi est bloqué tant qu'il en reste, et
 * la liste dit lesquels et pourquoi (jamais un média retiré en silence).
 */
export function mediasExclusDuPlan(plan: PlanDetaille): MediaExclu[] {
  if (!plan.avecAvatar || plan.dureeParole === null || plan.dureeDisponible === null) return [];
  const dispo = formatSecondes(plancher1(plan.dureeDisponible));
  const parole = formatSecondes(plan.dureeParole);
  const estimee = plan.sourceParole === 'reelle' ? '' : ' estimée';
  return plan.items
    .filter((it) => it.horsNarration)
    .map((it) => ({
      id: it.id,
      libelle: libelleMedia(it.media, it.dureeEffective),
      raison: `dépasse la narration${estimee} de l’avatar (${parole} s, dont ${dispo} s disponibles pour les médias)`,
    }));
}

/** Le message d'arrêt à l'envoi, qui NOMME les médias exclus. */
export function messageMediasExclus(plan: PlanDetaille): string | null {
  const exclus = mediasExclusDuPlan(plan);
  if (exclus.length === 0) return null;
  const noms = exclus.map((e) => `« ${e.libelle} »`).join(', ');
  return `${exclus.length === 1 ? 'Ce média ne tient pas' : 'Ces médias ne tiennent pas'} dans la narration de votre avatar : ${noms} — ${exclus[0].raison}. Raccourcissez ou retirez ${exclus.length === 1 ? 'ce média' : 'ces médias'} avant d’envoyer : rien n’a été généré ni débité.`;
}

/** « 4 », « 4,5 » — secondes lisibles (une décimale au plus). */
export function formatSecondes(s: number): string {
  const v = Math.round(s * 10) / 10;
  return String(v).replace('.', ',');
}

// ── Brouillon ────────────────────────────────────────────────────────────

const urlDurable = (u: unknown): string | null => {
  if (typeof u !== 'string' || u.length === 0 || u.length > 2048) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  return null; // blob:, data:, javascript:… — jamais relus
};

/**
 * Relit `draft.mediasVideo`. `undefined` si absent, vide ou illisible — le
 * brouillon se relit alors par `rushUrl` / `rushSuivants`, comme avant.
 * Un média sans URL durable est écarté, SAUF un créneau d'avatar (placeholder).
 */
export function sanitizeMediasVideo(v: unknown): MediaVideo[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MediaVideo[] = [];
  const ids = new Set<string>();
  for (const brut of v.slice(0, MAX_MEDIAS_VIDEO)) {
    if (!brut || typeof brut !== 'object') continue;
    const o = brut as Record<string, unknown>;
    const source = typeof o.source === 'string' && SOURCES.includes(o.source as SourceMediaVideo) ? o.source as SourceMediaVideo : null;
    if (!source) continue;
    const type: TypeMediaVideo = o.type === 'image' && source !== 'avatar' ? 'image' : 'video';
    const url = urlDurable(o.url);
    if (!url && source !== 'avatar') continue;
    let id = typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 200 ? o.id : `m${out.length}`;
    if (ids.has(id)) id = `${id}-${out.length}`;
    ids.add(id);
    const duree = typeof o.duree === 'number' && Number.isFinite(o.duree) && o.duree >= DUREE_MEDIA_MIN && o.duree <= DUREE_MEDIA_MAX ? o.duree : null;
    const metaBrut = o.meta && typeof o.meta === 'object' ? o.meta as Record<string, unknown> : null;
    const meta: MediaVideo['meta'] = {
      ...(metaBrut?.isClip === true ? { isClip: true } : {}),
      ...(metaBrut?.ia === true ? { ia: true } : {}),
      ...(metaBrut?.jumeau === true ? { jumeau: true } : {}),
      ...(typeof metaBrut?.avatarVersion === 'number' && Number.isFinite(metaBrut.avatarVersion) ? { avatarVersion: metaBrut.avatarVersion as number } : {}),
    };
    const choisieBrute = typeof o.dureeChoisie === 'number' && Number.isFinite(o.dureeChoisie) && o.dureeChoisie > 0 ? o.dureeChoisie : null;
    // Bornée comme à l'écran : photo 1–30 s, vidéo 1 s → durée mesurée, jamais pour l'avatar.
    const dureeChoisie = choisieBrute === null || source === 'avatar' ? null
      : type === 'image' ? r3(borne(choisieBrute, DUREE_PHOTO_MIN, DUREE_PHOTO_MAX))
        : duree !== null && choisieBrute < duree ? r3(Math.max(Math.min(DUREE_MEDIA_MIN, duree), choisieBrute)) : null;
    out.push({
      id, source, type,
      ...(url ? { url } : {}),
      duree,
      ...(dureeChoisie !== null ? { dureeChoisie } : {}),
      ...(typeof o.nom === 'string' && o.nom.length > 0 ? { nom: o.nom.slice(0, 200) } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    });
  }
  return out.length ? out : undefined;
}

/**
 * Accorde la liste aux rushes posés par les gestes d'AVANT (« Changer »,
 * « Ajouter un rush », recherche stock, « Temps forts ») : une vidéo retirée
 * de `rushs` quitte la liste, une vidéo nouvelle s'ajoute EN FIN, les durées
 * sondées sont reprises. Avatar, photos et ordre de la liste : intacts. Rend
 * la MÊME liste (référence) si rien ne change.
 */
export function reconcilierListe(
  liste: ReadonlyArray<MediaVideo>,
  rushs: ReadonlyArray<RushItem>,
  stockUrls?: ReadonlySet<string> | null,
  mediathequeUrls?: ReadonlySet<string> | null,
): ReadonlyArray<MediaVideo> {
  const parUrl = new Map(rushs.map((r) => [r.url, r] as const));
  let change = false;
  const gardes: MediaVideo[] = [];
  for (const m of liste) {
    const estVideo = m.type === 'video' && m.source !== 'avatar' && !!m.url;
    if (!estVideo) { gardes.push(m); continue; }
    const r = parUrl.get(m.url!);
    if (!r) { change = true; continue; }
    const secondes = typeof r.secondes === 'number' && r.secondes > 0 ? r.secondes : null;
    if (secondes !== null && secondes !== m.duree) { change = true; gardes.push({ ...m, duree: secondes }); }
    else gardes.push(m);
  }
  const presentes = new Set(gardes.filter((m) => m.type === 'video' && m.source !== 'avatar').map((m) => m.url));
  for (const r of rushs) {
    if (presentes.has(r.url)) continue;
    change = true;
    presentes.add(r.url);
    gardes.push({
      id: nouvelIdMedia('r'),
      source: sourceVideo(r, stockUrls, mediathequeUrls),
      url: r.url,
      type: 'video',
      duree: typeof r.secondes === 'number' && r.secondes > 0 ? r.secondes : null,
      ...(r.name ? { nom: r.name } : {}),
      ...(r.isClip || estVideoJumeau(r) ? { meta: { ...(r.isClip ? { isClip: true } : {}), ...(estVideoJumeau(r) ? { jumeau: true } : {}) } } : {}),
    });
  }
  return change ? gardes : liste;
}

/**
 * La liste d'un post relu (`metadata.rushSegments`) quand son plan porte des
 * photos ou un avatar (Créer multi-sources, Autopilote #542). `null` pour un
 * plan de vidéos seules — relu par les champs d'avant. Un média repris
 * plusieurs fois (smart montage) n'apparaît qu'une fois, sauf l'avatar dont
 * chaque fenêtre est un créneau.
 */
export function listeDepuisSegments(segments: ReadonlyArray<RushSegment> | null | undefined): MediaVideo[] | null {
  if (!segments || !segments.some((s) => s.kind === 'image' || s.kind === 'avatar')) return null;
  const out: MediaVideo[] = [];
  const vus = new Set<string>();
  // Avec avatar, la séquence dure sa parole : la fin du dernier plan.
  const dureeAvatar = segments[segments.length - 1].fin;
  segments.forEach((s, i) => {
    if (s.kind === 'avatar') {
      out.push({ id: `a${i}`, source: 'avatar', url: s.url, type: 'video', duree: r3(dureeAvatar) });
      return;
    }
    if (vus.has(s.url)) return;
    vus.add(s.url);
    if (s.kind === 'image') {
      out.push({ id: `p${i}`, source: 'stock-photo', url: s.url, type: 'image', duree: r3(s.fin - s.debut) });
    } else {
      out.push({ id: `v${i}`, source: s.source === 'stock' ? 'stock-video' : 'rush', url: s.url, type: 'video', duree: r3(s.fin - s.debut) });
    }
  });
  return out.length ? out : null;
}
