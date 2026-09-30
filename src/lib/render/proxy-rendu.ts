/**
 * PROXY DE RENDU — un rush trop lourd (4K, 60 i/s) n'est plus décodé tel quel
 * par Remotion : une copie légère (côté court 1080 px, 30 i/s, H.264) est
 * fabriquée UNE fois, rangée dans le stockage, puis réutilisée par toutes les
 * vidéos suivantes. L'original reste intact ; le proxy ne sert qu'au rendu.
 *
 * Mesuré (banc local, même plan de 18 extraits, 10 s rendues, 1 processus) :
 *   originaux (dont un 4K 60 i/s de 234 Mo) : 48,6 s
 *   avec proxy 1080p 30 i/s                 : 27,1 s   (×1,8)
 *   plancher Remotion sans vidéo            : 16,2 s
 * La sortie est en 1080×1920 à 30 i/s : le proxy ne perd rien d'utile.
 *
 * Toute erreur rend l'URL ORIGINALE : un proxy raté ne casse jamais un rendu.
 */
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { objetDeUrlPublique, urlDeLecture } from '@/lib/creer/analyse-rush-serveur';

/** Côté court du proxy et cadence : ceux de la sortie 1080×1920 à 30 i/s. */
export const PROXY_COTE_COURT = 1080;
export const PROXY_FPS = 30;
const BUCKET_PROXY = 'media';
const TIMEOUT_MS = 10 * 60_000;

/** Un rush mérite-t-il un proxy ? Au-delà de 1920 px ou de 30 i/s. Pur. */
export function besoinProxy(m: { largeur: number; hauteur: number; fps: number | null }): boolean {
  return Math.max(m.largeur, m.hauteur) > 1920 || Math.min(m.largeur, m.hauteur) > PROXY_COTE_COURT
    || (m.fps !== null && m.fps > PROXY_FPS + 0.5);
}

/**
 * Clé du proxy dans le stockage : dépend du fichier source (clé + taille,
 * donc un remplacement du fichier invalide le cache), de la résolution et
 * de la cadence cibles. Pure.
 */
export function cleProxy(cleSource: string, taille: number): string {
  const h = createHash('sha1').update(`${cleSource}|${taille}`).digest('hex').slice(0, 20);
  // Rangé sous le dossier du PROPRIÉTAIRE du rush (premier segment de la clé
  // après le bucket), comme ses autres fichiers.
  const proprietaire = cleSource.split('/')[1] || 'commun';
  return `${proprietaire}/proxies/${h}-${PROXY_COTE_COURT}p${PROXY_FPS}.mp4`;
}

/** URL publique d'un objet, sur le même hôte que l'URL source. Pure. */
export function urlPubliqueVoisine(urlSource: string, bucket: string, cle: string): string {
  const i = urlSource.indexOf('/storage/v1/object/public/');
  const base = i >= 0 ? urlSource.slice(0, i) : '';
  return `${base}/storage/v1/object/public/${bucket}/${cle}`;
}

function ffmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (p && require('fs').existsSync(p)) return p;
  } catch { /* binaire système */ }
  return 'ffmpeg';
}

function executer(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'ignore'] });
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('proxy : délai dépassé')); }, TIMEOUT_MS);
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => { clearTimeout(minuteur); if (code === 0) resolve(); else reject(new Error(`ffmpeg code ${code}`)); });
  });
}

/** Arguments ffmpeg du proxy : côté court 1080, 30 i/s, H.264 rapide, son gardé. Pur. */
export function argumentsProxy(entree: string, sortie: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', entree,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale='if(gt(iw,ih),-2,${PROXY_COTE_COURT})':'if(gt(iw,ih),${PROXY_COTE_COURT},-2)':flags=bicubic,fps=${PROXY_FPS}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', String(PROXY_FPS), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', sortie,
  ];
}

const enCours = new Map<string, Promise<string>>();

export interface ResultatProxy { url: string; proxy: boolean; cree: boolean }

/**
 * URL à donner au RENDU pour ce rush : son proxy (créé ou retrouvé), ou
 * l'URL d'origine s'il n'en a pas besoin — ou si quoi que ce soit échoue.
 */
export async function urlRenduPourRush(url: string): Promise<ResultatProxy> {
  const objet = objetDeUrlPublique(url);
  if (!objet) return { url, proxy: false, cree: false };
  try {
    const { clientMinio } = await import('@/lib/storage/minio-client');
    const client = clientMinio();
    const { size } = await client.statObject(objet.bucket, objet.cle);
    const cle = cleProxy(`${objet.bucket}/${objet.cle}`, size);
    const urlProxy = urlPubliqueVoisine(url, BUCKET_PROXY, cle);

    // Cache : déjà fabriqué pour ce fichier (même clé, même taille).
    const existe = await client.statObject(BUCKET_PROXY, cle).then(() => true, () => false);
    if (existe) return { url: urlProxy, proxy: true, cree: false };

    // Besoin réel ? (dimensions et cadence lues dans l'en-tête seulement)
    const source = await urlDeLecture(url);
    const { parseMedia } = await import('@remotion/media-parser');
    const meta = await parseMedia({ src: source, fields: { dimensions: true, fps: true }, acknowledgeRemotionLicense: true });
    const dims = meta.dimensions;
    if (!dims || !besoinProxy({ largeur: dims.width, hauteur: dims.height, fps: meta.fps ?? null })) {
      return { url, proxy: false, cree: false };
    }

    // Une seule fabrication à la fois par proxy, même si deux montages le demandent.
    if (!enCours.has(cle)) {
      enCours.set(cle, (async () => {
        const os = await import('os');
        const path = await import('path');
        const { uploadToStorage } = await import('@/lib/storage/upload');
        const local = path.join(os.tmpdir(), `studiio-proxy-${cle.split('/').pop()}`);
        await executer(argumentsProxy(source, local));
        return uploadToStorage({ filePath: local, bucket: BUCKET_PROXY, storagePath: cle, contentType: 'video/mp4' });
      })().finally(() => enCours.delete(cle)));
    }
    await enCours.get(cle);
    return { url: urlProxy, proxy: true, cree: true };
  } catch (err) {
    console.warn('[ProxyRendu] proxy indisponible, rush original utilisé :', err instanceof Error ? err.message : err);
    return { url, proxy: false, cree: false };
  }
}
