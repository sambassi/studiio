/**
 * Gestes partagés des specs du banc (aucune assertion de comportement cible ici).
 */
import type { Page, Locator } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { choisirParcours } from './fixtures';

export type Format = '9:16' | '1:1' | '16:9';
export const FORMATS: Format[] = ['9:16', '1:1', '16:9'];
export const slugFormat = (f: Format) => f.replace(':', 'x');

/** Textes VISIBLES nommant un fournisseur de médias, hors blocs repliés (<details> fermés). */
export async function mentionsFournisseurVisibles(page: Page, racine?: Locator): Promise<string[]> {
  const zone = racine ?? page.locator('body');
  return zone.evaluate((el) => {
    const out: string[] = [];
    const marche = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = marche.nextNode())) {
      const t = (n.textContent || '').trim();
      if (!/pexels|unsplash/i.test(t)) continue;
      const parent = (n as Text).parentElement;
      if (!parent) continue;
      const fermee = parent.closest('details:not([open])');
      if (fermee && !parent.closest('summary')) continue;
      const r = parent.getBoundingClientRect();
      const s = getComputedStyle(parent);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
      out.push((parent.textContent || t).replace(/\s+/g, ' ').trim().slice(0, 160));
    }
    return [...new Set(out)];
  });
}

/** Ouvre « Créer une vidéo » et choisit le thème Motivation. */
export async function ouvrirCreer(page: Page): Promise<void> {
  await choisirParcours(page, null);
  await page.goto('/dashboard/creer');
  await page.getByRole('button', { name: 'Créer une vidéo' }).click();
  await page.getByRole('button', { name: 'Motivation', exact: true }).click();
}

export async function allerA(page: Page, cible: 'Style' | 'Audio' | 'Contenu' | 'Envoi'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`Continuer vers ${cible}`) }).click();
  await page.waitForTimeout(600);
}

export async function choisirFormat(page: Page, format: Format): Promise<void> {
  const bouton = page.getByRole('button', { name: new RegExp(`^${format.replace(':', '\\:')}`) });
  if (!(await bouton.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Ton et format/ }).click();
  }
  await bouton.first().click();
}

/** Pose la valeur d'un curseur (range) comme le ferait un glissé. */
export async function poserCurseur(curseur: Locator, valeur: number): Promise<void> {
  await curseur.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, valeur);
}

/** Mesure d'un fichier vidéo avec ffprobe (durée, images, dimensions). */
export function sonder(fichier: string): { duree: number | null; images: number | null; largeur: number | null; hauteur: number | null; audio: boolean } {
  try {
    const sortie = execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,width,height,nb_read_packets:packet=pts_time', '-of', 'json', fichier], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const j = JSON.parse(sortie) as { streams?: Array<{ codec_type: string; width?: number; height?: number; nb_read_packets?: string }>; packets?: Array<{ pts_time?: string }> };
    const v = j.streams?.find((s) => s.codec_type === 'video');
    const temps = (j.packets ?? []).map((p) => Number(p.pts_time)).filter(Number.isFinite);
    return {
      duree: temps.length ? Math.max(...temps) : null,
      images: v?.nb_read_packets ? Number(v.nb_read_packets) : null,
      largeur: v?.width ?? null, hauteur: v?.height ?? null,
      audio: !!j.streams?.some((s) => s.codec_type === 'audio'),
    };
  } catch {
    return { duree: null, images: null, largeur: null, hauteur: null, audio: false };
  }
}

/**
 * Texte coupé par le bord : sur des images extraites (2 par seconde, réduites à
 * 270 px de large, niveaux de gris), compte les pixels quasi blancs (> 230)
 * dans une bande de 2 px le long de chaque bord. Les textes du montage sont
 * blancs ; le fond (dégradé, photo assombrie) ne l'est pas. Le filigrane est
 * centré en bas, loin des bords latéraux, et la bande basse est ignorée.
 */
export function texteHorsCadre(fichier: string): { images: number; touches: Array<{ image: number; bord: string; pixels: number }> } {
  const m = sonder(fichier);
  if (!m.largeur || !m.hauteur) return { images: 0, touches: [{ image: -1, bord: 'illisible', pixels: 0 }] };
  const L = 270;
  const H = Math.round((m.hauteur / m.largeur) * L / 2) * 2;
  const brut = execFileSync('ffmpeg', ['-v', 'error', '-i', fichier, '-vf', `fps=2,scale=${L}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 512 * 1024 * 1024 });
  const taille = L * H;
  const n = Math.floor(brut.length / taille);
  const touches: Array<{ image: number; bord: string; pixels: number }> = [];
  const B = 2;
  for (let k = 0; k < n; k++) {
    const o = k * taille;
    const px = (x: number, y: number) => brut[o + y * L + x];
    const compte = { gauche: 0, droite: 0, haut: 0 };
    for (let y = 0; y < H; y++) for (let x = 0; x < B; x++) { if (px(x, y) > 230) compte.gauche++; if (px(L - 1 - x, y) > 230) compte.droite++; }
    for (let x = 0; x < L; x++) for (let y = 0; y < B; y++) if (px(x, y) > 230) compte.haut++;
    for (const [bord, p] of Object.entries(compte)) if (p > 3) touches.push({ image: k, bord, pixels: p });
  }
  return { images: n, touches };
}

/** Planche 5×2 (1 image/s) d'un montage, à côté du fichier. */
export function planche(fichier: string, sortie: string): void {
  try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fichier, '-vf', 'fps=1,scale=360:-2,tile=5x2', '-frames:v', '1', sortie]); } catch { /* sans planche */ }
}
