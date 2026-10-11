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
 * ── Plan (`planDepuisListe`) ───────────────────────────────────────────
 * Déterministe, dans l'ORDRE de la liste :
 *  - sans avatar : chaque média joue sa durée (vidéo : sa durée retenue,
 *    bornée comme un rush ; photo : 3 s en Ken Burns) ;
 *  - avec avatar : la séquence dure la PAROLE de l'avatar. Les plans de
 *    coupe gardent leur durée, les créneaux d'avatar se partagent le reste ;
 *    chaque extrait d'avatar a `depuis === debut` (INVARIANT LIP-SYNC, le
 *    même que `planMultiSources` de l'Autopilote) : la voix de l'avatar est
 *    continue, les plans de coupe sont muets.
 */
import type { RushItem, RushSegment, MouvementImage, SourceSegment } from '@/lib/creer/multi-rush';
import { MOUVEMENTS_PHOTO } from '@/lib/autopilot/plan-multi-sources';

export type SourceMediaVideo = 'rush' | 'avatar' | 'stock-video' | 'stock-photo' | 'mediatheque';
export type TypeMediaVideo = 'video' | 'image';

export interface MediaVideo {
  /** Identifiant stable dans la liste (clé React, sélection). */
  id: string;
  source: SourceMediaVideo;
  /** URL du média. ABSENTE pour un avatar pas encore produit (placeholder). */
  url?: string;
  type: TypeMediaVideo;
  /** Durée retenue (s). Photo : 3 s par défaut ; avatar : durée de sa parole une fois produit. */
  duree?: number | null;
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
  return !!liste?.some((m) => m.source === 'avatar' || m.type === 'image');
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

/** « 0:16 ». `null` sans durée. */
export function formatDureeMedia(s: number | null | undefined): string | null {
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return null;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
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
export function libelleMedia(m: MediaVideo): string {
  const base = libelleSource(m);
  if (m.source === 'avatar' && !m.url) return `${base} · produit à l’envoi`;
  const d = formatDureeMedia(m.type === 'image' ? (m.duree ?? DUREE_PHOTO_DEFAUT) : m.duree);
  return d ? `${base} · ${d}` : base;
}

/** Infobulle : le nom du fichier, gardé pour qui le cherche. */
export function titreMedia(m: MediaVideo): string | undefined {
  return m.nom || undefined;
}

// ── Durées ───────────────────────────────────────────────────────────────

/** Durée de parole estimée d'un texte (≈ 2,6 mots/s), au moins 3 s. */
export function estimerDureeParole(textes: ReadonlyArray<string | null | undefined>): number {
  const mots = textes.join(' ').split(/\s+/).filter(Boolean).length;
  return r3(Math.max(3, mots / 2.6));
}

/** Durée qu'un média joue hors avatar. */
export function dureeMedia(m: MediaVideo): number {
  const d = typeof m.duree === 'number' && Number.isFinite(m.duree) && m.duree > 0 ? m.duree : null;
  if (m.type === 'image') return d ?? DUREE_PHOTO_DEFAUT;
  return d ?? DUREE_VIDEO_REPLI;
}

/**
 * Durée de la séquence « Vidéo » pour cette liste : la parole de l'avatar
 * s'il y en a un (`dureeAvatar`, sinon sa durée posée, sinon l'estimation),
 * sinon la somme des durées des médias.
 */
export function dureeListe(liste: ReadonlyArray<MediaVideo>, dureeAvatarEstimee?: number | null): number {
  if (liste.length === 0) return 0;
  if (listeAvecAvatar(liste)) {
    const posee = liste.find((m) => m.source === 'avatar' && typeof m.duree === 'number' && m.duree > 0)?.duree;
    return r3(posee ?? dureeAvatarEstimee ?? estimerDureeParole([]));
  }
  return r3(liste.reduce((t, m) => t + dureeMedia(m), 0));
}

// ── Plan ─────────────────────────────────────────────────────────────────

const sourceSegment = (m: MediaVideo): SourceSegment => (
  m.source === 'avatar' ? 'jumeau' : m.type === 'image' ? 'photo' : m.source === 'stock-video' ? 'stock' : 'rush'
);

export interface ResultatPlanListe {
  plan: RushSegment[];
  /** Fin du dernier plan — la durée de la séquence « Vidéo ». */
  duree: number;
  /** Médias écartés (sans URL : avatar non produit), pour le dire. */
  ignores: number;
}

/**
 * Le plan de la séquence « Vidéo », dans l'ordre de la liste. Un créneau
 * d'avatar SANS vidéo est ignoré (l'appelant produit l'avatar avant). Deux
 * créneaux d'avatar contigus n'en font qu'un (la parole est continue).
 */
export function planDepuisListe(liste: ReadonlyArray<MediaVideo>): ResultatPlanListe {
  const utilisables = liste.filter((m) => !!m.url);
  const ignores = liste.length - utilisables.length;
  // Fusion des avatars contigus.
  const items: MediaVideo[] = [];
  for (const m of utilisables) {
    const prev = items[items.length - 1];
    if (m.source === 'avatar' && prev?.source === 'avatar') continue;
    items.push(m);
  }
  if (items.length === 0) return { plan: [], duree: 0, ignores };
  const avatar = items.find((m) => m.source === 'avatar') ?? null;
  const nbAvatar = items.filter((m) => m.source === 'avatar').length;
  const brolls = items.filter((m) => m.source !== 'avatar');
  let durees: number[];
  let T: number;
  if (avatar) {
    T = r3(typeof avatar.duree === 'number' && avatar.duree > 0 ? avatar.duree : estimerDureeParole([]));
    const B = brolls.reduce((t, m) => t + dureeMedia(m), 0);
    // Les plans de coupe gardent leur durée tant que chaque créneau d'avatar
    // garde au moins AVATAR_CRENEAU_MIN_S ; sinon ils sont réduits ensemble.
    // Parole très courte : ce minimum descend à la part égale de chaque média
    // — aucun média choisi ne disparaît du plan.
    const minAvatar = Math.min(AVATAR_CRENEAU_MIN_S, T / items.length);
    const placeBroll = Math.max(0, T - nbAvatar * minAvatar);
    const f = B > placeBroll && B > 0 ? placeBroll / B : 1;
    const dB = brolls.map((m) => dureeMedia(m) * f);
    const partAvatar = nbAvatar > 0 ? (T - dB.reduce((a, b) => a + b, 0)) / nbAvatar : 0;
    let k = 0;
    durees = items.map((m) => (m.source === 'avatar' ? partAvatar : dB[k++]));
  } else {
    durees = items.map((m) => dureeMedia(m));
    T = r3(durees.reduce((a, b) => a + b, 0));
  }
  const plan: RushSegment[] = [];
  let cumul = 0;
  let photos = 0;
  items.forEach((m, i) => {
    const debut = r3(cumul);
    cumul += durees[i];
    const fin = i === items.length - 1 ? T : r3(cumul);
    if (!(fin > debut)) return;
    if (m.source === 'avatar') {
      plan.push({ url: m.url!, debut, fin, depuis: debut, kind: 'avatar', source: 'jumeau' });
    } else if (m.type === 'image') {
      const mouvement: MouvementImage = MOUVEMENTS_PHOTO[photos % MOUVEMENTS_PHOTO.length];
      photos += 1;
      plan.push({ url: m.url!, debut, fin, kind: 'image', source: 'photo', mouvement });
    } else {
      plan.push({ url: m.url!, debut, fin, kind: 'video', source: sourceSegment(m) });
    }
  });
  return { plan, duree: plan.length ? plan[plan.length - 1].fin : 0, ignores };
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
    out.push({
      id, source, type,
      ...(url ? { url } : {}),
      duree,
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
