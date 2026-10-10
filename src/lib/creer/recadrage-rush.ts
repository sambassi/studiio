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

/** Le style CSS de l'aperçu : élément plein cadre en `cover`, transformé comme le compositeur. */
export function styleRecadrageRush(t: Partial<RecadrageRush> | null | undefined): { objectFit: 'cover'; transform?: string; transformOrigin?: string } {
  if (!recadrageRushActif(t)) return { objectFit: 'cover' };
  // Le recadrage a déjà été borné AVEC les dimensions de la source à l'édition :
  // ici, seulement des nombres sûrs (sans dimensions, on ne peut pas re-borner).
  const n = (v: unknown, min: number, max: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
  const b = { scale: n(t?.scale, ZOOM_RUSH_MIN, ZOOM_RUSH_MAX, 1), offsetX: n(t?.offsetX, -1, 1, 0), offsetY: n(t?.offsetY, -1, 1, 0) };
  return { objectFit: 'cover', transform: `translate(${b.offsetX * 100}%, ${b.offsetY * 100}%) scale(${b.scale})`, transformOrigin: 'center' };
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
