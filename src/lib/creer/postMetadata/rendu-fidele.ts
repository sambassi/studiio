/**
 * Ce que « Régénérer » doit retrouver dans le post pour refaire LE MÊME
 * montage que le parcours Créer — écrit à la création, relu par « Modifier »
 * (`toWizardDraft`) et par le Calendrier (`optionsRenduDepuisMetadata`).
 *
 * Champs couverts (clés de la metadata) :
 *
 *   - `posterTransform`   recadrage de l'affiche globale ;
 *   - `seqBackgrounds`    fonds par séquence (forme du brouillon :
 *                         `{ titre?, cartes?, video?, cta? }` -> `{ url, transform }`) ;
 *   - `cardsSnapshot`     photo des cartes de l'aperçu : `{ url, rect, empreinte }` ;
 *   - `design.transition` style de transition (même clé que l'Autopilote).
 *
 * RÈGLE DES URL : seules des URL DURABLES (`persistableUrl`) entrent dans
 * un post. `blob:` meurt avec l'onglet ; `data:` pèse des Mo dans une colonne
 * `jsonb` et dans chaque brouillon. Une entrée non durable est ÉCARTÉE — le
 * montage régénéré retombe alors sur l'affiche globale, jamais sur une
 * référence morte.
 *
 * Module PUR : aucun accès réseau, DOM ou stockage.
 */
import { persistableUrl } from '../draft';

/**
 * Une URL qu'on peut écrire dans un post, ou `undefined`. La règle est
 * `persistableUrl` (`@/lib/creer/draft`), la même que pour l'affiche, la
 * musique et le rush : `http(s)` ou chemin relatif du stockage, jamais
 * `blob:` ni `data:`.
 */
export function urlDurable(url: unknown): string | undefined {
  return typeof url === 'string' ? persistableUrl(url) : undefined;
}

/** Recadrage : zoom et décalages en FRACTION du plateau (convention du compositeur). */
export interface Recadrage {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const RECADRAGE_NEUTRE: Recadrage = { scale: 1, offsetX: 0, offsetY: 0 };

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Le recadrage s'il est exploitable, `undefined` sinon. Mêmes bornes que
 * `sanitizeDraft` : zoom dans [1, 3], décalages dans [-1, 1].
 */
export function recadrageValide(t: unknown): Recadrage | undefined {
  if (!estObjet(t)) return undefined;
  const { scale, offsetX, offsetY } = t;
  if (!fini(scale) || scale < 1 || scale > 3) return undefined;
  if (!fini(offsetX) || Math.abs(offsetX) > 1) return undefined;
  if (!fini(offsetY) || Math.abs(offsetY) > 1) return undefined;
  return { scale, offsetX, offsetY };
}

export const CLES_FONDS = ['titre', 'cartes', 'video', 'cta'] as const;
export type CleFond = (typeof CLES_FONDS)[number];
export type FondsParSequence = Partial<Record<CleFond, { url: string; transform: Recadrage }>>;

/**
 * Fonds par séquence, réduits à ce qu'on peut écrire dans un post.
 *
 * Chaque entrée est jugée SEULE : une photo `data:` sur « Titre » n'empêche
 * pas d'écrire celle, durable, de « CTA ». Un recadrage abîmé retombe sur le
 * cadrage neutre (même règle que `sanitizeDraft`). Toujours un objet — vide
 * s'il ne reste rien —, pour que « tout retirer » reste une valeur comparable.
 */
export function fondsPourMetadata(fonds: unknown): FondsParSequence {
  const out: FondsParSequence = {};
  if (!estObjet(fonds)) return out;
  for (const cle of CLES_FONDS) {
    const f = fonds[cle];
    if (!estObjet(f)) continue;
    const url = urlDurable(f.url);
    if (!url) continue;
    out[cle] = { url, transform: recadrageValide(f.transform) ?? { ...RECADRAGE_NEUTRE } };
  }
  return out;
}

/**
 * Les fonds sous la forme du compositeur (`SequenceBackgrounds`) — exactement
 * celle que construit le parcours Créer : opacité 1, `null` pour une séquence
 * sans fond propre. `undefined` s'il n'y en a aucun : le compositeur se
 * comporte alors comme avant, à la ligne près.
 */
export function fondsVersCompositeur(fonds: FondsParSequence | undefined) {
  if (!fonds || Object.keys(fonds).length === 0) return undefined;
  const une = (cle: CleFond) => {
    const f = fonds[cle];
    return f ? { url: f.url, opacity: 1, transform: f.transform } : null;
  };
  return { titre: une('titre'), cartes: une('cartes'), video: une('video'), cta: une('cta') };
}

// ── Photo des cartes ────────────────────────────────────────────────────

/** Rectangle de la photo, en % de l'aperçu (convention `cardsSnapshotRect`). */
export interface RectPhoto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoCartes {
  url: string;
  rect: RectPhoto;
  /** Empreinte de ce que la photo représente — voir `empreinteCartes`. */
  empreinte: string;
}

/** JSON à clés triées : deux objets égaux donnent la même chaîne. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (estObjet(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return v === undefined ? 'null' : JSON.stringify(v);
}

/** FNV-1a 32 bits, en hexadécimal. Pas cryptographique : une égalité suffit. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Empreinte de TOUT ce dont la photo des cartes dépend, lu dans la metadata.
 *
 * La photo est blittée telle quelle par le compositeur : si « Modifier »
 * change une carte, sa couleur, son style ou le format, la réutiliser
 * peindrait l'ANCIEN contenu dans le nouveau montage. L'empreinte est donc
 * recalculée à la relecture et comparée : différente, la photo est ignorée et
 * le compositeur redessine les cartes lui-même (le comportement d'avant).
 *
 * Liste volontairement LARGE : une clé de trop coûte une photo ignorée (rendu
 * canvas, correct), une clé oubliée coûterait des cartes périmées.
 */
export function empreinteCartes(meta: unknown): string {
  const m = estObjet(meta) ? meta : {};
  const design = estObjet(m.design) ? m.design : {};
  const branding = estObjet(m.branding) ? m.branding : {};
  return fnv1a(stable({
    cards: m.cards,
    cardGroups: m.cardGroups,
    videoSize: m.videoSize,
    theme: m.theme,
    accentColor: branding.accentColor,
    cardStyle: design.cardStyle,
    cardsTextStyle: design.cardsTextStyle,
    cardsFont: design.cardsFont,
    cardsTextScale: design.cardsTextScale,
    cardCustomIcons: design.cardCustomIcons,
    gradientColor1: design.gradientColor1,
    gradientColor2: design.gradientColor2,
    gradientOpacity: design.gradientOpacity,
  }));
}

function rectValide(r: unknown): RectPhoto | undefined {
  if (!estObjet(r)) return undefined;
  const { x, y, width, height } = r;
  if (!fini(x) || !fini(y) || !fini(width) || !fini(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/**
 * La photo à écrire dans le post, ou `undefined` (URL non durable, rectangle
 * absent). `meta` est la metadata ENVOYÉE : l'empreinte la décrit.
 */
export function photoCartesPourMetadata(
  url: unknown,
  rect: unknown,
  meta: unknown,
): PhotoCartes | undefined {
  const u = urlDurable(url);
  const r = rectValide(rect);
  if (!u || !r) return undefined;
  return { url: u, rect: r, empreinte: empreinteCartes(meta) };
}

/**
 * La photo relue, SEULEMENT si elle représente encore les cartes du post.
 * `undefined` pour tout ancien post (pas de clé), toute URL non durable et
 * toute empreinte qui ne correspond plus.
 */
export function photoCartesValide(meta: unknown): { url: string; rect: RectPhoto } | undefined {
  if (!estObjet(meta) || !estObjet(meta.cardsSnapshot)) return undefined;
  const p = meta.cardsSnapshot;
  const url = urlDurable(p.url);
  const rect = rectValide(p.rect);
  if (!url || !rect) return undefined;
  if (typeof p.empreinte !== 'string' || p.empreinte !== empreinteCartes(meta)) return undefined;
  return { url, rect };
}

// ── Éléments libres ─────────────────────────────────────────────────────

export interface ElementLibre {
  id: string;
  iconName: string;
  x: number;
  y: number;
  sizePct: number;
  color: string;
}

/** Les éléments libres relus (`design.positions.elements`), validés un à un. */
export function elementsLibresDepuisMetadata(meta: unknown): ElementLibre[] {
  if (!estObjet(meta) || !estObjet(meta.design) || !estObjet(meta.design.positions)) return [];
  const liste = meta.design.positions.elements;
  if (!Array.isArray(liste)) return [];
  return liste.filter((e): e is ElementLibre =>
    estObjet(e)
    && typeof e.iconName === 'string' && e.iconName !== ''
    && fini(e.x) && fini(e.y) && fini(e.sizePct) && e.sizePct > 0
    && typeof e.color === 'string',
  ).map((e) => ({
    id: typeof e.id === 'string' ? e.id : '', iconName: e.iconName,
    x: e.x, y: e.y, sizePct: e.sizePct, color: e.color,
  }));
}
