/**
 * Client-side video composer using Canvas + WebCodecs + webm-muxer.
 * Renders montage sequences (intro, cards, video, CTA) directly in the browser.
 * Uses WebCodecs API (VideoEncoder/AudioEncoder) + webm-muxer for RELIABLE
 * audio+video encoding with VP8 + Opus (proven browser support).
 * Outputs a downloadable WebM video blob — NO server rendering needed.
 */

import { Muxer, ArrayBufferTarget } from 'webm-muxer';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface CardData {
  emoji: string;
  label: string;
  value: string;
  color?: string;
}

export interface ComposerOptions {
  width: number;
  height: number;
  fps?: number;
  // Content
  title: string;
  subtitle?: string;
  salesPhrase?: string;
  cards?: CardData[];
  // Media URLs
  posterUrl?: string | null;
  videoUrl?: string | null;
  logoUrl?: string | null;
  musicUrl?: string | null;
  voiceUrl?: string | null;
  // Sequence durations (seconds)
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  // Branding
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  watermarkText?: string;
  // Callbacks
  onProgress?: (percent: number, stage: string) => void;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Convert a blob: URL to a data: URL.  Data URLs embed the bytes directly so
 * they survive even if the original Blob/ObjectURL is revoked.
 */
async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  console.log('[VideoComposer] Loading image:', src.substring(0, 80) + '...');

  // For blob: URLs, convert to data URL first for reliability
  if (src.startsWith('blob:')) {
    return blobUrlToDataUrl(src).then(
      (dataUrl) => {
        console.log('[VideoComposer] Converted blob URL to data URL, length:', dataUrl.length);
        return loadImage(dataUrl);
      },
      (err) => {
        console.warn('[VideoComposer] blob→dataURL conversion failed, trying direct load:', err);
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => { console.log('[VideoComposer] Image loaded (blob direct):', img.width, 'x', img.height); resolve(img); };
          img.onerror = () => reject(new Error(`Failed to load blob image: ${src.substring(0, 40)}`));
          img.src = src;
        });
      }
    );
  }

  // For data: URLs, load directly (no CORS issues)
  if (src.startsWith('data:')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log('[VideoComposer] Image loaded (data URL):', img.width, 'x', img.height);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load data URL image`));
      img.src = src;
    });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      console.log('[VideoComposer] Image loaded (cors):', img.width, 'x', img.height);
      resolve(img);
    };
    img.onerror = () => {
      console.warn('[VideoComposer] Image CORS failed, trying proxy...');
      const proxyImg = new Image();
      proxyImg.crossOrigin = 'anonymous';
      proxyImg.onload = () => {
        console.log('[VideoComposer] Image loaded (proxy):', proxyImg.width, 'x', proxyImg.height);
        resolve(proxyImg);
      };
      proxyImg.onerror = () => reject(new Error(`Failed to load image: ${src.substring(0, 60)}`));
      proxyImg.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
    };
    img.src = src;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const vid = document.createElement('video');
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      vid.oncanplaythrough = () => resolve(vid);
      vid.onerror = () => reject(new Error(`Failed to load local video`));
      vid.src = src;
      vid.load();
      return;
    }

    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.oncanplaythrough = () => resolve(vid);
    vid.onerror = () => {
      console.warn('[VideoComposer] Video CORS failed, trying proxy...');
      const vid2 = document.createElement('video');
      vid2.crossOrigin = 'anonymous';
      vid2.muted = true;
      vid2.playsInline = true;
      vid2.preload = 'auto';
      vid2.oncanplaythrough = () => resolve(vid2);
      vid2.onerror = () => reject(new Error(`Failed to load video: ${src.substring(0, 60)}`));
      vid2.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
      vid2.load();
    };
    vid.src = src;
    vid.load();
  });
}

/**
 * Fetch raw audio bytes from a URL.
 * Returns an ArrayBuffer that can be decoded by any AudioContext.
 */
async function fetchAudioBytes(src: string): Promise<ArrayBuffer> {
  console.log('[VideoComposer] Fetching audio bytes from:', src.substring(0, 80));

  // For blob: and data: URLs, fetch directly
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const res = await fetch(src);
    const arrayBuf = await res.arrayBuffer();
    console.log('[VideoComposer] Audio fetched (local):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
    return arrayBuf;
  }

  const isRemote = src.startsWith('http://') || src.startsWith('https://');

  if (isRemote) {
    // Method 1: Proxy
    try {
      const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(src)}`;
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          console.log('[VideoComposer] Audio fetched (proxy):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
          return arrayBuf;
        }
      }
    } catch (proxyErr) {
      console.warn('[VideoComposer] Proxy fetch failed:', (proxyErr as Error)?.message);
    }

    // Method 2: Direct CORS fetch
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          console.log('[VideoComposer] Audio fetched (cors):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
          return arrayBuf;
        }
      }
    } catch (corsErr) {
      console.warn('[VideoComposer] CORS fetch failed:', (corsErr as Error)?.message);
    }
  }

  // Method 3: Direct fetch
  const res = await fetch(src);
  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength > 0) {
    console.log('[VideoComposer] Audio fetched (direct):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
    return arrayBuf;
  }

  throw new Error(`Failed to load audio from all methods: ${src.substring(0, 60)}`);
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ═══════════════════════════════════════════════════════════
// SEQUENCE RENDERERS
// ═══════════════════════════════════════════════════════════

function drawIntro(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  posterImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  title: string, subtitle: string | undefined,
  accent: string, progress: number
) {
  if (posterImg) {
    const scale = Math.max(w / posterImg.width, h / posterImg.height);
    const sw = posterImg.width * scale;
    const sh = posterImg.height * scale;
    ctx.drawImage(posterImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, hexToRgba(accent, 0.85));
    grad.addColorStop(0.4, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(1, '#1a0030');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  const zoomScale = 1 + progress * 0.05;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoomScale, zoomScale);
  ctx.translate(-w / 2, -h / 2);

  const titleAlpha = Math.min(1, progress * 3);
  const fontSize = Math.round(w * 0.065);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${titleAlpha})`;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 20;
  ctx.fillText(title.toUpperCase(), w / 2, h / 2);
  ctx.shadowBlur = 0;

  if (subtitle) {
    const subAlpha = Math.max(0, Math.min(1, (progress - 0.2) * 3));
    const subSize = Math.round(w * 0.028);
    ctx.font = `400 ${subSize}px sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${subAlpha * 0.9})`;
    ctx.fillText(subtitle, w / 2, h / 2 + fontSize * 0.8);
  }

  const lineAlpha = Math.max(0, Math.min(1, (progress - 0.3) * 3));
  const lineW = w * 0.12;
  ctx.strokeStyle = `rgba(${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)},${lineAlpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - lineW / 2, h / 2 + fontSize * 1.2);
  ctx.lineTo(w / 2 + lineW / 2, h / 2 + fontSize * 1.2);
  ctx.stroke();

  if (logoImg) {
    const logoAlpha = Math.min(1, progress * 2);
    ctx.globalAlpha = logoAlpha;
    const logoSize = Math.round(w * 0.12);
    ctx.drawImage(logoImg, (w - logoSize) / 2, h * 0.15, logoSize, logoSize);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawCards(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  cards: CardData[],
  logoImg: HTMLImageElement | null,
  accent: string, progress: number
) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a0030');
  grad.addColorStop(0.5, '#0a0a0a');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const labelSize = Math.round(w * 0.022);
  ctx.font = `700 ${labelSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('INFORMATIONS', w / 2, h * 0.2);

  const cardH = Math.round(h * 0.065);
  const cardW = Math.round(w * 0.8);
  const cardX = (w - cardW) / 2;
  const startY = h * 0.27;
  const gap = cardH * 1.4;

  cards.slice(0, 5).forEach((card, i) => {
    const cardProgress = Math.max(0, Math.min(1, (progress - i * 0.12) * 4));
    if (cardProgress <= 0) return;

    const y = startY + i * gap;
    const slideX = cardX + (1 - cardProgress) * (-w * 0.15);
    const alpha = cardProgress;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    drawRoundRect(ctx, slideX, y, cardW, cardH, 12);
    ctx.fill();

    ctx.fillStyle = card.color || accent;
    ctx.fillRect(slideX, y + 4, 3, cardH - 8);

    const dotR = Math.round(cardH * 0.12);
    ctx.fillStyle = card.color || accent;
    ctx.beginPath();
    ctx.arc(slideX + 16 + dotR, y + cardH * 0.5, dotR, 0, Math.PI * 2);
    ctx.fill();

    const lblSize = Math.round(w * 0.022);
    ctx.font = `400 ${lblSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(card.label, slideX + 16 + dotR * 2 + 10, y + cardH * 0.6);

    const valSize = Math.round(w * 0.032);
    ctx.font = `700 ${valSize}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'white';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.fillText(card.value, slideX + cardW - 16, y + cardH * 0.65);
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 1;
  });

  if (logoImg) {
    const logoSize = Math.round(w * 0.08);
    const padding = Math.round(w * 0.03);
    ctx.drawImage(logoImg, w - logoSize - padding, padding, logoSize, logoSize);
  }
}

function drawVideoSeq(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  videoEl: HTMLVideoElement | null,
  logoImg: HTMLImageElement | null,
  _progress: number
) {
  if (videoEl) {
    const scale = Math.max(w / videoEl.videoWidth, h / videoEl.videoHeight);
    const vw = videoEl.videoWidth * scale;
    const vh = videoEl.videoHeight * scale;
    ctx.drawImage(videoEl, (w - vw) / 2, (h - vh) / 2, vw, vh);
  } else {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `400 ${Math.round(w * 0.03)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('Vidéo', w / 2, h / 2);
  }

  if (logoImg) {
    const logoSize = Math.round(w * 0.08);
    const padding = Math.round(w * 0.03);
    ctx.drawImage(logoImg, w - logoSize - padding, h - logoSize - padding, logoSize, logoSize);
  }
}

function drawCTA(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  accent: string, ctaText: string, ctaSubText: string,
  salesPhrase: string | undefined, watermark: string | undefined,
  logoImg: HTMLImageElement | null, progress: number
) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, hexToRgba(accent, 0.9));
  grad.addColorStop(0.5, 'rgba(255,45,170,0.7)');
  grad.addColorStop(1, hexToRgba(accent, 0.6));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const scaleProgress = Math.min(1, progress * 3);
  const scale = 0.92 + scaleProgress * 0.08;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-w / 2, -h / 2);

  if (logoImg) {
    const logoSize = Math.round(w * 0.12);
    ctx.drawImage(logoImg, (w - logoSize) / 2, h * 0.3, logoSize, logoSize);
  }

  const ctaSize = Math.round(w * 0.04);
  ctx.font = `900 ${ctaSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'white';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 25;
  ctx.fillText(ctaText.toUpperCase(), w / 2, h * 0.52);
  ctx.shadowBlur = 0;

  const subSize = Math.round(w * 0.022);
  ctx.font = `400 ${subSize}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(ctaSubText.toUpperCase(), w / 2, h * 0.57);

  if (salesPhrase) {
    const pSize = Math.round(w * 0.026);
    ctx.font = `italic 500 ${pSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(salesPhrase, w / 2, h * 0.63);
  }

  if (watermark) {
    ctx.font = `400 ${Math.round(w * 0.014)}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText(watermark, w / 2, h * 0.9);
  }

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// TRANSITION: Crossfade between two sequences
// ═══════════════════════════════════════════════════════════

function drawTransition(
  ctx: CanvasRenderingContext2D,
  _w: number, _h: number,
  drawA: (p: number) => void,
  drawB: (p: number) => void,
  t: number
) {
  ctx.globalAlpha = 1 - t;
  drawA(1);
  ctx.globalAlpha = t;
  drawB(t * 0.3);
  ctx.globalAlpha = 1;
}

// ═══════════════════════════════════════════════════════════
// PRE-RENDER AUDIO using OfflineAudioContext
// This produces a single AudioBuffer with music + voice mixed together.
// ═══════════════════════════════════════════════════════════

async function preRenderAudio(
  musicUrl: string | null,
  voiceUrl: string | null,
  totalDuration: number,
): Promise<AudioBuffer | null> {
  if (!musicUrl && !voiceUrl) {
    console.log('[VideoComposer] No audio URLs provided, skipping audio');
    return null;
  }

  const sampleRate = 48000;
  const totalSamples = Math.ceil(sampleRate * totalDuration);

  console.log('[VideoComposer] Pre-rendering audio:', totalDuration.toFixed(1), 's @', sampleRate, 'Hz');

  // Fetch raw audio bytes in parallel
  const [musicBytes, voiceBytes] = await Promise.all([
    musicUrl ? fetchAudioBytes(musicUrl).catch((err) => {
      console.error('[VideoComposer] Failed to fetch music:', err?.message);
      return null;
    }) : Promise.resolve(null),
    voiceUrl ? fetchAudioBytes(voiceUrl).catch((err) => {
      console.error('[VideoComposer] Failed to fetch voice:', err?.message);
      return null;
    }) : Promise.resolve(null),
  ]);

  if (!musicBytes && !voiceBytes) {
    console.warn('[VideoComposer] No audio data fetched');
    return null;
  }

  // Create OfflineAudioContext for pre-rendering
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Decode audio buffers
  let musicBuf: AudioBuffer | null = null;
  let voiceBuf: AudioBuffer | null = null;

  if (musicBytes) {
    try {
      musicBuf = await offlineCtx.decodeAudioData(musicBytes.slice(0)); // slice to avoid detached buffer
      console.log('[VideoComposer] Music decoded:', musicBuf.duration.toFixed(1), 's,', musicBuf.numberOfChannels, 'ch');
    } catch (err) {
      console.error('[VideoComposer] Music decode failed:', (err as Error)?.message);
    }
  }

  if (voiceBytes) {
    console.log('[VideoComposer] Voice bytes received:', voiceBytes.byteLength, 'bytes');
    // Check first few bytes to identify format
    const header = new Uint8Array(voiceBytes.slice(0, 16));
    const headerHex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('[VideoComposer] Voice file header (hex):', headerHex);
    try {
      voiceBuf = await offlineCtx.decodeAudioData(voiceBytes.slice(0));
      console.log('[VideoComposer] Voice decoded OK:', voiceBuf.duration.toFixed(1), 's,', voiceBuf.numberOfChannels, 'ch,', voiceBuf.sampleRate, 'Hz');
      // Check if voice buffer actually has audio content (not silence)
      const voiceSamples = voiceBuf.getChannelData(0);
      let maxAmp = 0;
      for (let i = 0; i < Math.min(voiceSamples.length, 48000); i++) {
        maxAmp = Math.max(maxAmp, Math.abs(voiceSamples[i]));
      }
      console.log('[VideoComposer] Voice max amplitude (first 1s):', maxAmp.toFixed(4), maxAmp > 0.001 ? '(HAS AUDIO)' : '(SILENT!)');
    } catch (err) {
      console.error('[VideoComposer] Voice decode FAILED:', (err as Error)?.message);
      console.error('[VideoComposer] Voice bytes size was:', voiceBytes.byteLength, '— this format may not be decodable');
    }
  } else {
    console.warn('[VideoComposer] No voice bytes received — voiceUrl was:', voiceUrl);
  }

  if (!musicBuf && !voiceBuf) {
    console.warn('[VideoComposer] No audio buffers decoded');
    return null;
  }

  // Connect music source (looping)
  if (musicBuf) {
    const musicSource = offlineCtx.createBufferSource();
    musicSource.buffer = musicBuf;
    musicSource.loop = true;
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = voiceBuf ? 0.3 : 0.8;
    musicSource.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    musicSource.start(0);
    console.log('[VideoComposer] Music source connected, gain:', voiceBuf ? 0.3 : 0.8);
  }

  // Connect voice source (plays once from start)
  if (voiceBuf) {
    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuf;
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = 1.0;
    voiceSource.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    voiceSource.start(0);
    console.log('[VideoComposer] Voice source connected, gain: 1.0');
  }

  // Render!
  console.log('[VideoComposer] Starting offline audio render...');
  const renderedBuffer = await offlineCtx.startRendering();
  console.log('[VideoComposer] Audio pre-rendered:', renderedBuffer.duration.toFixed(1), 's,',
    renderedBuffer.numberOfChannels, 'ch,', renderedBuffer.length, 'samples');

  return renderedBuffer;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPOSER — WebCodecs + webm-muxer (VP8 + Opus)
// ═══════════════════════════════════════════════════════════

export async function composeVideo(options: ComposerOptions): Promise<Blob> {
  const {
    width, height,
    fps = 24,
    title, subtitle, salesPhrase, cards = [],
    posterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
    introDuration = 5, cardsDuration = 8, videoDuration = 12, ctaDuration = 5,
    accentColor = '#D91CD2',
    ctaText = 'CHAT POUR PLUS D\'INFOS',
    ctaSubText = 'LIEN EN BIO',
    watermarkText,
    onProgress,
  } = options;

  onProgress?.(2, 'Chargement des médias...');

  console.log('[VideoComposer] === COMPOSE START (WebCodecs + webm-muxer VP8+Opus) ===');
  console.log('[VideoComposer] Media URLs — poster:', posterUrl?.substring(0, 60), 'logo:', logoUrl?.substring(0, 60), 'video:', videoUrl?.substring(0, 60));
  console.log('[VideoComposer] Audio URLs — music:', musicUrl?.substring(0, 60) || 'NONE', 'voice:', voiceUrl?.substring(0, 60) || 'NONE');

  if (!logoUrl) console.warn('[VideoComposer] ⚠ No logo URL provided — logo will NOT appear in video');

  // Load all visual media in parallel
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch((err) => { console.error('[VideoComposer] Poster load failed:', err?.message); return null; }) : Promise.resolve(null),
    logoUrl ? loadImage(logoUrl).catch((err) => { console.error('[VideoComposer] ⚠ Logo load FAILED:', err?.message); return null; }) : Promise.resolve(null),
    videoUrl ? loadVideo(videoUrl).catch((err) => { console.error('[VideoComposer] Video load failed:', err?.message); return null; }) : Promise.resolve(null),
  ]);

  console.log('[VideoComposer] Media loaded — poster:', !!posterImg, `(${posterImg?.width}x${posterImg?.height})`, 'logo:', !!logoImg, `(${logoImg?.width}x${logoImg?.height})`, 'video:', !!videoEl);
  if (!logoImg) console.error('[VideoComposer] ❌ LOGO IS NULL — logoUrl was:', logoUrl);
  if (logoImg) console.log('[VideoComposer] ✅ Logo loaded successfully:', logoImg.width, 'x', logoImg.height);

  onProgress?.(10, 'Préparation du rendu...');

  // Build sequence list
  const sequences: Array<{ type: string; duration: number }> = [
    { type: 'intro', duration: introDuration },
  ];
  if (cards.length > 0) sequences.push({ type: 'cards', duration: cardsDuration });
  if (videoEl) sequences.push({ type: 'video', duration: videoDuration });
  sequences.push({ type: 'cta', duration: ctaDuration });

  const totalDuration = sequences.reduce((s, seq) => s + seq.duration, 0);
  const transitionDur = 0.8;

  // Pre-render audio using OfflineAudioContext (GUARANTEED to produce correct audio)
  console.log('[VideoComposer] Calling preRenderAudio with musicUrl:', musicUrl ? musicUrl.substring(0, 60) : 'NULL', '| voiceUrl:', voiceUrl ? voiceUrl.substring(0, 60) : 'NULL');
  const audioBuffer = await preRenderAudio(musicUrl || null, voiceUrl || null, totalDuration);
  const hasAudio = audioBuffer !== null;
  if (hasAudio) {
    console.log('[VideoComposer] Audio pre-rendered OK:', audioBuffer!.duration.toFixed(1), 's,', audioBuffer!.numberOfChannels, 'ch,', audioBuffer!.length, 'samples');
    // Check if audio buffer has content
    const ch0 = audioBuffer!.getChannelData(0);
    let maxAmp = 0;
    for (let i = 0; i < Math.min(ch0.length, 48000 * 3); i++) { maxAmp = Math.max(maxAmp, Math.abs(ch0[i])); }
    console.log('[VideoComposer] Audio max amplitude (first 3s):', maxAmp.toFixed(4), maxAmp > 0.001 ? '✅ HAS AUDIO' : '❌ SILENT');
  } else {
    console.error('[VideoComposer] ❌ NO AUDIO — preRenderAudio returned null. Music:', !!musicUrl, 'Voice:', !!voiceUrl);
  }

  onProgress?.(15, 'Démarrage de l\'encodage...');

  // Canvas for rendering frames
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Append to DOM (some browsers need this for canvas rendering)
  canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;opacity:0;';
  document.body.appendChild(canvas);

  // ═══ SET UP webm-muxer (VP8 + Opus — proven browser support) ═══
  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'V_VP8',
      width,
      height,
    },
    ...(hasAudio ? {
      audio: {
        codec: 'A_OPUS',
        sampleRate: 48000,
        numberOfChannels: audioBuffer!.numberOfChannels,
      },
    } : {}),
    firstTimestampBehavior: 'offset',
  });

  console.log('[VideoComposer] WebM Muxer created — video: VP8', width, 'x', height, '| audio:', hasAudio ? 'Opus ' + audioBuffer!.numberOfChannels + 'ch' : 'none');

  // ═══ SET UP VideoEncoder (VP8) ═══
  let videoEncoderChunks = 0;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => { videoEncoderChunks++; muxer.addVideoChunk(chunk, meta ?? undefined); },
    error: (e) => console.error('[VideoComposer] VideoEncoder error:', e),
  });

  videoEncoder.configure({
    codec: 'vp8',
    width,
    height,
    bitrate: 8_000_000,
    framerate: fps,
  });

  console.log('[VideoComposer] VideoEncoder configured: VP8', width, 'x', height, '@', fps, 'fps');

  // ═══ SET UP AudioEncoder (Opus — if audio) ═══
  let audioEncoder: AudioEncoder | null = null;
  let audioEncoderChunks = 0;
  let audioEncoderErrors = 0;
  if (hasAudio) {
    // First verify Opus encoding is supported
    try {
      const opusSupport = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: audioBuffer!.numberOfChannels,
        bitrate: 128_000,
      });
      console.log('[VideoComposer] Opus AudioEncoder support:', JSON.stringify(opusSupport));
      if (!opusSupport.supported) {
        console.error('[VideoComposer] ❌ Opus AudioEncoder NOT SUPPORTED by this browser!');
      }
    } catch (supportErr) {
      console.error('[VideoComposer] AudioEncoder.isConfigSupported check failed:', supportErr);
    }

    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        audioEncoderChunks++;
        try {
          muxer.addAudioChunk(chunk, meta ?? undefined);
        } catch (muxErr) {
          console.error('[VideoComposer] muxer.addAudioChunk failed:', muxErr);
        }
      },
      error: (e) => { audioEncoderErrors++; console.error('[VideoComposer] AudioEncoder error #' + audioEncoderErrors + ':', e); },
    });

    try {
      audioEncoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: audioBuffer!.numberOfChannels,
        bitrate: 128_000,
      });
      console.log('[VideoComposer] AudioEncoder state after configure:', audioEncoder.state);
    } catch (configErr) {
      console.error('[VideoComposer] AudioEncoder.configure FAILED:', configErr);
    }

    console.log('[VideoComposer] AudioEncoder configured: Opus', audioBuffer!.numberOfChannels, 'ch @ 48000Hz');
  }

  // Pre-calculate sequence start times
  const seqStarts: number[] = [];
  let cumTime = 0;
  for (const seq of sequences) {
    seqStarts.push(cumTime);
    cumTime += seq.duration;
  }

  // Helper: draw a single frame at a given time
  const drawFrame = (elapsed: number) => {
    let seqIdx = 0;
    for (let i = sequences.length - 1; i >= 0; i--) {
      if (elapsed >= seqStarts[i]) { seqIdx = i; break; }
    }
    const seq = sequences[seqIdx];
    const seqElapsed = elapsed - seqStarts[seqIdx];
    const seqProgress = seqElapsed / seq.duration;

    const inTransition = seqIdx < sequences.length - 1 && seqElapsed > seq.duration - transitionDur;
    const transProgress = inTransition ? (seqElapsed - (seq.duration - transitionDur)) / transitionDur : 0;

    ctx.clearRect(0, 0, width, height);

    const drawSeq = (type: string, progress: number) => {
      switch (type) {
        case 'intro':
          drawIntro(ctx, width, height, posterImg, logoImg, title, subtitle, accentColor, progress);
          break;
        case 'cards':
          drawCards(ctx, width, height, cards, logoImg, accentColor, progress);
          break;
        case 'video':
          drawVideoSeq(ctx, width, height, videoEl, logoImg, progress);
          break;
        case 'cta':
          drawCTA(ctx, width, height, accentColor, ctaText, ctaSubText, salesPhrase, watermarkText, logoImg, progress);
          break;
      }
    };

    if (inTransition && seqIdx < sequences.length - 1) {
      drawTransition(ctx, width, height,
        (p) => drawSeq(seq.type, p),
        (p) => drawSeq(sequences[seqIdx + 1].type, p),
        transProgress
      );
    } else {
      drawSeq(seq.type, seqProgress);
    }

    // Progress bar at bottom
    const barH = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, height - barH, width, barH);
    const barGrad = ctx.createLinearGradient(0, 0, width * (elapsed / totalDuration), 0);
    barGrad.addColorStop(0, accentColor);
    barGrad.addColorStop(0.5, '#FF2DAA');
    barGrad.addColorStop(1, '#00D4FF');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, height - barH, width * (elapsed / totalDuration), barH);
  };

  // ═══ ENCODE VIDEO FRAMES (non-realtime — as fast as possible!) ═══
  const totalFrames = Math.ceil(totalDuration * fps);
  const frameDurationUs = Math.round(1_000_000 / fps); // microseconds

  console.log('[VideoComposer] Encoding', totalFrames, 'video frames...');

  // If we have a video element, we need to seek it frame by frame
  if (videoEl) {
    videoEl.currentTime = 0;
    videoEl.pause();
  }

  for (let f = 0; f < totalFrames; f++) {
    const elapsed = f / fps;

    // If in video sequence, seek the video element to the correct time
    if (videoEl) {
      const videoSeq = sequences.find(s => s.type === 'video');
      if (videoSeq) {
        const videoStart = seqStarts[sequences.indexOf(videoSeq)];
        const videoEnd = videoStart + videoSeq.duration;
        if (elapsed >= videoStart && elapsed < videoEnd) {
          videoEl.currentTime = elapsed - videoStart;
        }
      }
    }

    // Draw the frame
    drawFrame(Math.min(elapsed, totalDuration - 0.001));

    // Create VideoFrame from canvas and encode it
    const frame = new VideoFrame(canvas, {
      timestamp: f * frameDurationUs,
      duration: frameDurationUs,
    });

    // Keyframe every 2 seconds
    const keyFrame = f % (fps * 2) === 0;
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    // Update progress every 12 frames (~0.5s at 24fps) for responsive UI
    if (f % 12 === 0) {
      const percent = Math.round(15 + (f / totalFrames) * 60);
      onProgress?.(Math.min(percent, 75), `Encodage vidéo: ${Math.round((f / totalFrames) * 100)}%`);

      // Yield to browser to prevent UI freeze
      await new Promise(r => setTimeout(r, 0));
    }
  }

  console.log('[VideoComposer] All video frames encoded');

  // ═══ ENCODE AUDIO (if available) ═══
  if (hasAudio && audioEncoder && audioBuffer) {
    onProgress?.(78, 'Encodage audio...');
    console.log('[VideoComposer] Encoding audio — encoder state:', audioEncoder.state,
      '| buffer:', audioBuffer.duration.toFixed(1), 's,', audioBuffer.numberOfChannels, 'ch,', audioBuffer.length, 'samples');

    if (audioEncoder.state !== 'configured') {
      console.error('[VideoComposer] ❌ AudioEncoder is NOT configured! State:', audioEncoder.state, '— skipping audio encoding');
    } else {
      const numChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;

      // Get all channel data
      const channels: Float32Array[] = [];
      for (let c = 0; c < numChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
      }

      // Encode audio in chunks (960 samples = 20ms @ 48kHz, standard Opus frame)
      const chunkSize = 960;
      const totalAudioSamples = audioBuffer.length;
      let audioChunksSubmitted = 0;

      for (let offset = 0; offset < totalAudioSamples; offset += chunkSize) {
        // IMPORTANT: Pad the last chunk to chunkSize (Opus requires fixed frame sizes)
        const frameLength = Math.min(chunkSize, totalAudioSamples - offset);
        const actualLength = chunkSize; // Always use full chunk size

        // Create planar Float32 data for AudioData
        const planarData = new Float32Array(actualLength * numChannels);
        for (let c = 0; c < numChannels; c++) {
          const srcData = channels[c].subarray(offset, offset + frameLength);
          planarData.set(srcData, c * actualLength);
          // Remaining samples (if frameLength < actualLength) are zero-padded automatically
        }

        try {
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: actualLength,
            numberOfChannels: numChannels,
            timestamp: Math.round((offset / sampleRate) * 1_000_000), // microseconds
            data: planarData,
          });

          audioEncoder.encode(audioData);
          audioData.close();
          audioChunksSubmitted++;
        } catch (encodeErr) {
          console.error('[VideoComposer] Audio encode error at offset', offset, ':', encodeErr);
          break;
        }
      }

      console.log('[VideoComposer] Audio encoding done — submitted:', audioChunksSubmitted,
        'chunks | encoder output chunks:', audioEncoderChunks, '| errors:', audioEncoderErrors);
    }
  }

  // ═══ FLUSH & FINALIZE ═══
  onProgress?.(90, 'Finalisation...');

  console.log('[VideoComposer] Flushing encoders...');
  await videoEncoder.flush();
  if (audioEncoder) await audioEncoder.flush();

  console.log('[VideoComposer] Encoder stats — video chunks:', videoEncoderChunks, '| audio chunks:', audioEncoderChunks);

  videoEncoder.close();
  if (audioEncoder) audioEncoder.close();

  muxer.finalize();
  console.log('[VideoComposer] Muxer finalized');

  // Get the final WebM blob
  const { buffer } = muxerTarget;
  const blob = new Blob([buffer], { type: 'video/webm' });

  console.log('[VideoComposer] Output blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type: video/webm');

  // Clean up
  if (videoEl) videoEl.pause();
  try { document.body.removeChild(canvas); } catch {}

  onProgress?.(100, 'Terminé !');
  return blob;
}

// ═══════════════════════════════════════════════════════════
// CONVENIENCE: Compose + upload to Supabase
// ═══════════════════════════════════════════════════════════

export async function composeAndUpload(
  options: ComposerOptions,
): Promise<{ blob: Blob; url: string | null }> {
  const blob = await composeVideo(options);

  if (blob.size === 0) {
    console.error('[VideoComposer] Blob is empty, skipping upload');
    return { blob, url: null };
  }

  console.log('[VideoComposer] Uploading blob:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

  let url: string | null = null;
  try {
    const formData = new FormData();
    const cleanType = 'video/webm';
    const file = new File([blob], `montage-${Date.now()}.webm`, { type: cleanType });
    formData.append('file', file);
    formData.append('purpose', 'rush');
    const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
    const data = await res.json();
    console.log('[VideoComposer] Upload response:', JSON.stringify(data));
    if (data.success && data.file?.url) {
      url = data.file.url;
      console.log('[VideoComposer] Upload success:', url);
    } else {
      console.error('[VideoComposer] Upload response not successful:', data);
    }
  } catch (err) {
    console.error('[VideoComposer] Upload failed:', err);
  }

  return { blob, url };
}

// ═══════════════════════════════════════════════════════════
// CONVENIENCE: Download blob as file
// ═══════════════════════════════════════════════════════════

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
