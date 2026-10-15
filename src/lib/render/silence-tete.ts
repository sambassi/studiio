/**
 * A6 — mesure SERVEUR du silence de tête de la musique (ffmpeg). Les règles
 * (seuil, maximum, fondu) et leur justification : `silence-tete-pur.ts`.
 */
import { spawn } from 'child_process';
import {
  argumentsSilenceDeTete, departMusiquePourSilence, lireSilenceDeTete,
} from '@/lib/render/silence-tete-pur';

export * from '@/lib/render/silence-tete-pur';

const TIMEOUT_MS = 20_000;

function ffmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (p && require('fs').existsSync(p)) return p;
  } catch { /* binaire système */ }
  return 'ffmpeg';
}

/** Silence de tête d'une source lisible par ffmpeg. `null` sur tout échec. */
export function mesurerSilenceDeTete(source: string, ffmpeg = ffmpegPath(), timeoutMs = TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (v: number | null) => { if (!fini) { fini = true; resolve(v); } };
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(ffmpeg, argumentsSilenceDeTete(source), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch { finir(null); return; }
    let journal = '';
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); finir(null); }, timeoutMs);
    p.stderr?.on('data', (b: Buffer) => { journal += b.toString(); });
    p.on('error', () => { clearTimeout(minuteur); finir(null); });
    p.on('close', (code) => { clearTimeout(minuteur); finir(code === 0 ? lireSilenceDeTete(journal) : null); });
  });
}

const cache = new Map<string, Promise<number>>();

/**
 * Départ de la musique d'un rendu SERVEUR. Ne lit que NOTRE stockage (après
 * `localiserEntreesRendu`, tout média l'est) ou un fichier local : jamais un
 * hôte tiers. Lu AU NOM de `userId` (garde de `urlDeLecture`). 0 sur tout
 * échec ou refus.
 */
export async function departMusiqueServeur(url: string, userId: string): Promise<number> {
  const cle = `${userId}|${url}`;
  const hit = cache.get(cle);
  if (hit) return hit;
  const travail = (async () => {
    try {
      let source: string;
      if (url.startsWith('/') && !url.startsWith('/storage/')) {
        const fs = await import('fs');
        if (!fs.existsSync(url)) return 0;
        source = url;
      } else {
        const { estNotreStockage } = await import('@/lib/securite/medias-externes');
        if (!url.startsWith('/storage/v1/object/public/') && !estNotreStockage(url)) return 0;
        const { urlDeLecture } = await import('@/lib/creer/analyse-rush-serveur');
        source = await urlDeLecture(url, userId);
      }
      return departMusiquePourSilence(await mesurerSilenceDeTete(source));
    } catch {
      return 0;
    }
  })();
  cache.set(cle, travail);
  while (cache.size > 50) cache.delete(cache.keys().next().value as string);
  const r = await travail;
  if (r === 0) cache.delete(cle);
  return r;
}

/**
 * Le design avec `musicStartSeconds` posé quand la musique commence par un
 * blanc. Sans musique, avec un départ déjà fixé, ou sans blanc mesurable :
 * le MÊME objet, inchangé (sortie identique à celle d'avant).
 */
export async function avecDepartMusique<T extends { musicUrl?: string | null; musicStartSeconds?: number }>(
  d: T, userId: string,
  mesurer: (url: string, userId: string) => Promise<number> = departMusiqueServeur,
): Promise<T> {
  if (!d.musicUrl || typeof d.musicStartSeconds === 'number') return d;
  let depart = 0;
  try { depart = await mesurer(d.musicUrl, userId); } catch { depart = 0; }
  if (!(depart > 0)) return d;
  console.log(`[RenduServeur/A6] musique : silence de tête sauté, départ à ${depart} s`);
  return { ...d, musicStartSeconds: depart };
}
