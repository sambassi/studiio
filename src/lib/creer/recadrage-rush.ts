/**
 * RECADRAGE DU RUSH (séquence Vidéo de Créer) — UNE géométrie, partout.
 *
 * Le rush REMPLIT toujours le cadre du format (9:16, 16:9, 1:1) : jamais de
 * bandes, jamais d'étirement. La personne choisit ce qui reste visible avec un
 * zoom et un décalage :
 *
 *   { scale ≥ 1, offsetX, offsetY }  — décalages en FRACTION DU CADRE de sortie.
 *
 * C'est exactement la convention du compositeur (`drawVideoSeq` :
 * `cx = w/2 + offsetX·w`, image « cover » × scale) : l'aperçu (CSS
 * `translate(offsetX·100 %) scale(scale)` sur un élément plein cadre en
 * `object-fit: cover`) et l'export MP4 tracent donc la même image.
 *
 * Les bornes dépendent des dimensions de la SOURCE : une vidéo 16:9 dans un
 * cadre 9:16 déborde déjà largement en largeur à zoom 1 — on peut la faire
 * glisser jusqu'à son bord, jamais au-delà (aucune bande vide).
 */
export interface RecadrageRush { scale: number; offsetX: number; offsetY: number }

export const RECADRAGE_RUSH_NEUTRE: RecadrageRush = { scale: 1, offsetX: 0, offsetY: 0 };
export const ZOOM_RUSH_MIN = 1;
export const ZOOM_RUSH_MAX = 3;

/** La taille dessinée de la source dans un cadre `w × h` (cover × zoom) — même calcul que le compositeur. */
export function tailleDessinee(srcW: number, srcH: number, w: number, h: number, scale: number): { l: number; h: number } {
  const base = Math.max(w / srcW, h / srcH);
  return { l: srcW * base * scale, h: srcH * base * scale };
}

/**
 * Ramène un recadrage dans ses bornes. Sans dimensions connues (source pas
 * encore chargée), seul le zoom est borné et les décalages restent dans ce que
 * le zoom seul laisse dépasser — prudent, jamais de bande.
 */
export function bornerRecadrageRush(
  t: Partial<RecadrageRush> | null | undefined,
  dims?: { srcW: number; srcH: number; w: number; h: number } | null,
): RecadrageRush {
  const scale = Math.min(ZOOM_RUSH_MAX, Math.max(ZOOM_RUSH_MIN, Number(t?.scale) || 1));
  let margeX = (scale - 1) / 2;
  let margeY = (scale - 1) / 2;
  if (dims && dims.srcW > 0 && dims.srcH > 0 && dims.w > 0 && dims.h > 0) {
    const d = tailleDessinee(dims.srcW, dims.srcH, dims.w, dims.h, scale);
    margeX = Math.max(0, (d.l - dims.w) / (2 * dims.w));
    margeY = Math.max(0, (d.h - dims.h) / (2 * dims.h));
  }
  const borne = (v: unknown, m: number) => {
    const n = Number(v);
    return Math.min(m, Math.max(-m, Number.isFinite(n) ? n : 0));
  };
  // Arrondi VERS ZÉRO pour les décalages : jamais un dixième de pixel de bande au bord.
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const versZero = (n: number) => Math.trunc(n * 10000) / 10000;
  return { scale: r(scale), offsetX: versZero(borne(t?.offsetX, margeX)), offsetY: versZero(borne(t?.offsetY, margeY)) };
}

/** Le recadrage change-t-il quoi que ce soit ? (sinon on n'enregistre rien : comportement d'avant). */
export function recadrageRushActif(t: Partial<RecadrageRush> | null | undefined): boolean {
  return !!t && ((Number(t.scale) || 1) !== 1 || (Number(t.offsetX) || 0) !== 0 || (Number(t.offsetY) || 0) !== 0);
}

/** Ratio largeur/hauteur de chaque format de sortie. */
export const RATIO_FORMAT: Record<'9:16' | '1:1' | '16:9', number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };

/**
 * Le style CSS de l'aperçu, à poser sur une `<video>` dans un cadre
 * `position: relative; overflow: hidden`.
 *
 * Avec le ratio de la SOURCE connu (`onLoadedMetadata`), l'élément a EXACTEMENT
 * la taille de l'image que dessine le compositeur (cover × zoom), en % du
 * cadre, et il est placé au centre + décalage : même rectangle que
 * `rectangleRush` / `drawVideoSeq`, donc aucune bande que l'export n'aurait pas.
 *
 * Sans ce ratio (vidéo pas encore chargée) : plein cadre en `cover`, transformé.
 * ⚠️ Ce repli COUPE l'image au bord de l'élément : un décalage plus grand que
 * ce que le zoom seul laisse dépasser y montrerait une bande. Il ne sert que
 * pendant le chargement.
 */
export function styleRecadrageRush(
  t: Partial<RecadrageRush> | null | undefined,
  ratios?: { source: number; cadre: number } | null,
): Record<string, string | number> {
  const plein = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as Record<string, string | number>;
  if (ratios && ratios.source > 0 && ratios.cadre > 0 && Number.isFinite(ratios.source) && Number.isFinite(ratios.cadre)) {
    // Bornes recalculées avec les ratios : un cadre de largeur 1 et de hauteur 1/cadre.
    const b = bornerRecadrageRush(t, { srcW: ratios.source, srcH: 1, w: ratios.cadre, h: 1 });
    // Taille dessinée en fraction du cadre (cover × zoom).
    const l = Math.max(1, ratios.source / ratios.cadre) * b.scale;
    const h = Math.max(1, ratios.cadre / ratios.source) * b.scale;
    const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;
    return {
      position: 'absolute',
      width: pct(l),
      height: pct(h),
      left: pct(0.5 + b.offsetX - l / 2),
      top: pct(0.5 + b.offsetY - h / 2),
      maxWidth: 'none',
      objectFit: 'fill', // l'élément a déjà le ratio de la source : rien n'est étiré
    };
  }
  if (!recadrageRushActif(t)) return plein;
  // Le recadrage a déjà été borné AVEC les dimensions de la source à l'édition :
  // ici, seulement des nombres sûrs (sans dimensions, on ne peut pas re-borner).
  const n = (v: unknown, min: number, max: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
  const b = { scale: n(t?.scale, ZOOM_RUSH_MIN, ZOOM_RUSH_MAX, 1), offsetX: n(t?.offsetX, -1, 1, 0), offsetY: n(t?.offsetY, -1, 1, 0) };
  return { ...plein, transform: `translate(${b.offsetX * 100}%, ${b.offsetY * 100}%) scale(${b.scale})`, transformOrigin: 'center' };
}

/**
 * Le rectangle source → cadre que trace le compositeur (pour les tests et la
 * vérification « aperçu = export ») : où l'image est posée dans le cadre.
 */
export function rectangleRush(srcW: number, srcH: number, w: number, h: number, t: Partial<RecadrageRush> | null | undefined) {
  const b = bornerRecadrageRush(t, { srcW, srcH, w, h });
  const d = tailleDessinee(srcW, srcH, w, h, b.scale);
  const cx = w / 2 + b.offsetX * w;
  const cy = h / 2 + b.offsetY * h;
  return { x: cx - d.l / 2, y: cy - d.h / 2, l: d.l, h: d.h };
}

// ── RECADRAGE PAR RUSH ─────────────────────────────────────────────────
//
// Chaque rush a SON recadrage. Clé stable = l'URL du rush : les éléments de
// la liste (`RushItem`) n'ont pas d'identifiant propre, et l'URL est ce que
// partagent l'écran, le brouillon, la metadata (`rushUrls`, `rushSegments`)
// et le compositeur (`rushs`, `montage`). Elle survit donc au réordonnancement,
// au rechargement et à « Régénérer ». Un même fichier ajouté deux fois partage
// son recadrage (c'est la même image).
//
//   rushTransforms: { [urlDuRush]: RecadrageRush }
//
// N'y figurent QUE les rushes réellement recadrés : un rush absent est en
// « cover » centré (le comportement d'avant). Les dimensions de la source ne
// sont pas stockées — elles sont relues sur la vidéo à l'édition, et le
// recadrage enregistré a déjà été borné avec elles.
//
// Héritage : l'ancien champ unique `rushTransform` (posts / brouillons d'avant)
// ne vaut QUE pour le rush principal (`rushUrls[0]` / `rushUrl`), jamais pour
// les autres. Dès qu'une table `rushTransforms` existe, elle fait foi.

export type RecadragesRush = Record<string, RecadrageRush>;

const estObjetSimple = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Un recadrage enregistrable : nombres finis, zoom 1–3, décalages ±1 (mêmes bornes que l'affiche). */
export function recadrageRushValide(t: unknown): RecadrageRush | null {
  if (!estObjetSimple(t)) return null;
  const { scale, offsetX, offsetY } = t;
  const fini = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!fini(scale) || scale < ZOOM_RUSH_MIN || scale > ZOOM_RUSH_MAX) return null;
  if (!fini(offsetX) || Math.abs(offsetX) > 1) return null;
  if (!fini(offsetY) || Math.abs(offsetY) > 1) return null;
  return { scale, offsetX, offsetY };
}

/** Plafond défensif : une liste de rushes n'en compte jamais autant. */
const MAX_RECADRAGES = 50;

/**
 * Nettoie une table brute (brouillon, metadata) : clé = URL non vide,
 * recadrage valide ET actif. Toujours un objet — vide s'il ne reste rien.
 */
export function recadragesRushValides(v: unknown): RecadragesRush {
  const out: RecadragesRush = {};
  if (!estObjetSimple(v)) return out;
  for (const url of Object.keys(v)) {
    if (Object.keys(out).length >= MAX_RECADRAGES) break;
    if (!url || typeof url !== 'string') continue;
    const t = recadrageRushValide(v[url]);
    if (t && recadrageRushActif(t)) out[url] = t;
  }
  return out;
}

/**
 * La table effective : `table` si elle existe (elle fait foi, même vide),
 * sinon l'ancien recadrage unique posé sur le rush PRINCIPAL seulement.
 */
export function recadragesRushAvecHeritage(
  table: unknown,
  heritage: unknown,
  urlPrincipale: string | null | undefined,
): RecadragesRush {
  if (estObjetSimple(table)) return recadragesRushValides(table);
  const t = recadrageRushValide(heritage);
  return urlPrincipale && t && recadrageRushActif(t) ? { [urlPrincipale]: t } : {};
}

/** Le recadrage d'UN rush : le sien, sinon « cover » centré. */
export function recadrageDuRush(table: RecadragesRush | null | undefined, url: string | null | undefined): RecadrageRush {
  return (url && table && Object.prototype.hasOwnProperty.call(table, url) ? table[url] : null) ?? RECADRAGE_RUSH_NEUTRE;
}

/** Pose le recadrage d'UN rush (neutre = retiré). Ne touche aucune autre entrée. */
export function avecRecadrageRush(table: RecadragesRush | null | undefined, url: string, t: Partial<RecadrageRush> | null | undefined): RecadragesRush {
  const out: RecadragesRush = { ...(table ?? {}) };
  const v = recadrageRushValide(t);
  if (v && recadrageRushActif(v)) out[url] = v;
  else delete out[url];
  return out;
}

/** Ne garde que les recadrages des rushes encore présents (un rush retiré emporte le sien). */
export function recadragesPourRushs(
  table: RecadragesRush | null | undefined,
  urls: ReadonlyArray<string | null | undefined>,
): RecadragesRush {
  const out: RecadragesRush = {};
  if (!table) return out;
  for (const url of urls) {
    if (url && Object.prototype.hasOwnProperty.call(table, url)) out[url] = table[url];
  }
  return out;
}

/**
 * COMPOSITEUR — le recadrage du rush PEINT à cet instant.
 *
 *   1. son entrée dans `rushTransforms` ;
 *   2. sinon, s'il est le rush principal (`videoUrl`), l'ancien `rushTransform` ;
 *   3. sinon rien : « cover » centré.
 *
 * `url` absente (image fixe à la place du rush) : l'ancien `rushTransform`,
 * comme avant.
 */
export function recadragePourRushPeint(
  url: string | null | undefined,
  options: {
    rushTransforms?: Record<string, { scale?: number; offsetX?: number; offsetY?: number }> | null;
    rushTransform?: { scale?: number; offsetX?: number; offsetY?: number } | null;
    videoUrl?: string | null;
  },
): { scale?: number; offsetX?: number; offsetY?: number } | undefined {
  if (!url) return options.rushTransform ?? undefined;
  const table = options.rushTransforms;
  if (table && Object.prototype.hasOwnProperty.call(table, url)) return table[url] ?? undefined;
  return url === options.videoUrl ? options.rushTransform ?? undefined : undefined;
}
