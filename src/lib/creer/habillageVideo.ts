/**
 * Habillage de la séquence Vidéo (jumeau, rush) — un CADRE aux couleurs du
 * style, posé PAR-DESSUS les bords de la vidéo : bande en dégradé
 * (début → fin, sur la diagonale), puis un filet à la couleur d'accent juste
 * à l'intérieur. Le centre de l'image n'est jamais touché, aucun filtre.
 *
 * Mêmes mesures pour l'aperçu (CSS) et l'export (canvas) : WYSIWYG par
 * construction. Opt-in : un montage sans `habillageVideo` (anciens posts)
 * est rendu exactement comme avant.
 */
export interface HabillageVideo {
  debut: string;
  fin: string;
  accent: string;
}

/** Épaisseurs en pixels de la vidéo (largeur `w`). */
export function mesuresHabillage(w: number): { bande: number; filet: number } {
  return { bande: Math.max(4, Math.round(w * 0.018)), filet: Math.max(2, Math.round(w * 0.004)) };
}

/**
 * Angle CSS (deg) dont le dégradé va EXACTEMENT du coin haut-gauche au coin
 * bas-droit — le même que `createLinearGradient(0, 0, w, h)` du canvas.
 */
export function angleDiagonale(w: number, h: number): number {
  return Math.round(((Math.atan2(w, -h) * 180) / Math.PI) * 100) / 100;
}

/** Couleur CSS hexadécimale (#rgb, #rrggbb, #rrggbbaa) — rien d'autre n'est dessiné. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Relit un habillage (métadonnées, options) ; `undefined` s'il est mal formé. */
export function lireHabillageVideo(brut: unknown): HabillageVideo | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
  return ok(o.debut) && ok(o.fin) && ok(o.accent) ? { debut: o.debut, fin: o.fin, accent: o.accent } : undefined;
}

/** Dessine l'habillage sur le canvas, par-dessus la vidéo déjà peinte. */
export function dessinerHabillageVideo(ctx: CanvasRenderingContext2D, w: number, h: number, hab: HabillageVideo): void {
  const { bande, filet } = mesuresHabillage(w);
  ctx.save();
  const degrade = ctx.createLinearGradient(0, 0, w, h);
  degrade.addColorStop(0, hab.debut);
  degrade.addColorStop(1, hab.fin);
  ctx.fillStyle = degrade;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(bande, bande, w - 2 * bande, h - 2 * bande);
  ctx.fill('evenodd');
  ctx.strokeStyle = hab.accent;
  ctx.lineWidth = filet;
  ctx.strokeRect(bande + filet / 2, bande + filet / 2, w - 2 * bande - filet, h - 2 * bande - filet);
  ctx.restore();
}
