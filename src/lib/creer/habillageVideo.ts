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
/**
 * Mode d'habillage choisi dans Créer :
 *  - `degrade` (défaut) : le voile coloré des Cartes — teinte du dégradé
 *    début en haut, centre dégagé, teinte du dégradé fin en bas ;
 *  - `cadre` : le cadre (bande en dégradé + filet d'accent) ;
 *  - `aucun` : rien (aucun champ n'est envoyé).
 */
export type ModeHabillage = 'degrade' | 'cadre' | 'aucun';
export const MODES_HABILLAGE: ReadonlyArray<{ id: ModeHabillage; label: string }> = [
  { id: 'degrade', label: 'Dégradé' },
  { id: 'cadre', label: 'Cadre coloré' },
  { id: 'aucun', label: 'Aucun' },
];
export const MODE_HABILLAGE_DEFAUT: ModeHabillage = 'degrade';

export interface HabillageVideo {
  debut: string;
  fin: string;
  accent: string;
  /** Absent : `cadre` — les posts enregistrés avant les modes. */
  mode?: 'degrade' | 'cadre';
  /** Opacité du voile (mode `degrade`), celle du style. Défaut 0,5. */
  opacite?: number;
}

/** Opacité du voile, bornée ; 0,5 par défaut. */
export function opaciteVoile(hab: Pick<HabillageVideo, 'opacite'>): number {
  const o = hab.opacite;
  return typeof o === 'number' && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0.5;
}

const rgba = (hex: string, alpha: number) => {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.slice(0, 7);
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * Les arrêts du voile, de HAUT (0) en BAS (1) — UNE seule définition pour
 * le canvas (`addColorStop`) et l'aperçu (CSS) : WYSIWYG par construction.
 * Mêmes positions que le voile des Cartes (`paintSeqGradient`, 'both').
 */
export function arretsVoile(hab: HabillageVideo): Array<[number, string]> {
  const a = opaciteVoile(hab);
  return [[0, rgba(hab.debut, a)], [0.4, 'rgba(0, 0, 0, 0)'], [0.6, 'rgba(0, 0, 0, 0)'], [1, rgba(hab.fin, a)]];
}

/** Le voile en CSS (aperçu), mêmes arrêts que le canvas. */
export function cssVoile(hab: HabillageVideo): string {
  return `linear-gradient(180deg, ${arretsVoile(hab).map(([p, c]) => `${c} ${Math.round(p * 100)}%`).join(', ')})`;
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
  if (!(ok(o.debut) && ok(o.fin) && ok(o.accent))) return undefined;
  const hab: HabillageVideo = { debut: o.debut, fin: o.fin, accent: o.accent };
  if (o.mode === 'degrade' || o.mode === 'cadre') hab.mode = o.mode;
  if (typeof o.opacite === 'number' && Number.isFinite(o.opacite)) hab.opacite = opaciteVoile({ opacite: o.opacite });
  return hab;
}

/** Relit un mode choisi (brouillon) ; le défaut sinon. */
export function lireModeHabillage(brut: unknown): ModeHabillage {
  return brut === 'degrade' || brut === 'cadre' || brut === 'aucun' ? brut : MODE_HABILLAGE_DEFAUT;
}

/** Ce que Créer envoie pour un mode : `undefined` pour `aucun` (rendu sans habillage). */
export function habillagePourMode(
  mode: ModeHabillage,
  couleurs: { debut: string; fin: string; accent: string; opacite: number },
): HabillageVideo | undefined {
  if (mode === 'aucun') return undefined;
  return { ...couleurs, mode };
}

/** Dessine l'habillage sur le canvas, par-dessus la vidéo déjà peinte. */
export function dessinerHabillageVideo(ctx: CanvasRenderingContext2D, w: number, h: number, hab: HabillageVideo): void {
  if (hab.mode === 'degrade') {
    ctx.save();
    const voile = ctx.createLinearGradient(0, 0, 0, h);
    for (const [p, c] of arretsVoile(hab)) voile.addColorStop(p, c);
    ctx.fillStyle = voile;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
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
