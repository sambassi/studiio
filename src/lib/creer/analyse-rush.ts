/**
 * SMART MONTAGE — analyse LOCALE d'un rush, dans le navigateur, sans aucun
 * fournisseur : échantillonnage d'images (canvas) + énergie audio
 * (`decodeAudioData`). Produit les mesures que `smart-montage.ts` note.
 *
 * Même technique que `clip-detector.ts` (seek + drawImage + différence de
 * pixels), mais sur une URL déjà stockée et avec la netteté et l'audio en
 * plus. Toute erreur rend `null` : l'appelant garde alors l'enchaînement
 * classique, jamais un montage cassé.
 */
import { analyserRythme, type RythmeMusique } from '@/lib/creer/rythme-musique';
import { mesurerImage, saturationRgb, ANALYSE_L as L, ANALYSE_H as H, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';

/** Au-delà, on n'échantillonne pas plus finement (≈ 240 images par rush). */
const ECHANTILLONS_MAX = 240;
/** Au-delà, l'audio n'est pas décodé (mémoire) : énergie audio à 0. */
const AUDIO_OCTETS_MAX = 150 * 1024 * 1024;

function attendreSeek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let fini = false;
    const ok = () => { if (fini) return; fini = true; video.removeEventListener('seeked', ok); resolve(); };
    video.addEventListener('seeked', ok);
    // Certains MP4 mal indexés n'émettent jamais `seeked` (clip-detector.ts).
    setTimeout(ok, 1500);
    video.currentTime = t;
  });
}

function chargerVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('rush illisible'));
    setTimeout(() => reject(new Error('rush trop long à charger')), 30_000);
    v.src = url;
  });
}

/** Énergie RMS par fenêtre de `pas` secondes (0..1). Tableau vide si pas d'audio. */
async function energieAudio(url: string, duree: number, pas: number): Promise<number[]> {
  try {
    const rep = await fetch(url);
    if (!rep.ok) return [];
    const octets = await rep.arrayBuffer();
    if (octets.byteLength > AUDIO_OCTETS_MAX) return [];
    const Ctx = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx) return [];
    const ctx = new Ctx(1, 1, 22050);
    const buf = await ctx.decodeAudioData(octets);
    const data = buf.getChannelData(0);
    const n = Math.ceil(duree / pas);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * pas * buf.sampleRate);
      const b = Math.min(data.length, Math.floor((i + 1) * pas * buf.sampleRate));
      let s = 0;
      for (let j = a; j < b; j += 4) s += data[j] * data[j];
      out.push(b > a ? Math.min(1, Math.sqrt(s / Math.ceil((b - a) / 4)) * 4) : 0);
    }
    return out;
  } catch {
    return []; // rush sans piste audio, codec non décodable : pas bloquant
  }
}

export async function analyserRush(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<AnalyseRush | null> {
  let video: HTMLVideoElement | null = null;
  try {
    video = await chargerVideo(url);
    const duree = video.duration;
    if (!Number.isFinite(duree) || duree < 1) return null;
    const pas = Math.max(0.5, duree / ECHANTILLONS_MAX);
    const audioP = energieAudio(url, duree, pas);

    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const echantillons: EchantillonRush[] = [];
    let prec: Float32Array | null = null;
    const total = Math.floor(duree / pas);
    for (let i = 0, t = 0; t < duree; i++, t = i * pas) {
      await attendreSeek(video, t);
      ctx.drawImage(video, 0, 0, L, H);
      const px = ctx.getImageData(0, 0, L, H).data; // lève si le rush n'est pas CORS : → null
      const gris = new Float32Array(L * H);
      for (let p = 0, q = 0; p < px.length; p += 4, q++) {
        gris[q] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) / 255;
      }
      const m = mesurerImage(gris, prec);
      prec = gris;
      echantillons.push({ t: Math.round(t * 1000) / 1000, ...m, saturation: saturationRgb(px, 4), audio: 0 });
      onProgress?.(Math.min(0.95, (i + 1) / Math.max(1, total)));
    }
    const audio = await audioP;
    echantillons.forEach((e, i) => { e.audio = audio[i] ?? 0; });
    onProgress?.(1);
    return { url, duree, echantillons };
  } catch (err) {
    console.warn('[SmartMontage] analyse impossible, enchaînement classique :', url.slice(0, 60), err);
    return null;
  } finally {
    if (video) { video.removeAttribute('src'); video.load(); }
  }
}

/**
 * Rythme de la musique, dans le navigateur (Créer) — même analyse que le
 * serveur (`rythme-musique.ts`). `null` si la musique est illisible.
 */
export async function analyserMusiqueNavigateur(url: string): Promise<RythmeMusique | null> {
  try {
    const rep = await fetch(url);
    if (!rep.ok) return null;
    const Ctx = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx) return null;
    const buf = await new Ctx(1, 1, 11025).decodeAudioData(await rep.arrayBuffer());
    return analyserRythme(buf.getChannelData(0), buf.sampleRate);
  } catch {
    return null;
  }
}
