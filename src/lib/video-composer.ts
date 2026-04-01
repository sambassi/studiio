/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Renders montage sequences (intro, cards, video, CTA) directly in the browser.
 * Outputs a downloadable WebM/MP4 video blob — NO server rendering needed.
 */

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

function loadImage(src: string): Promise<HTMLImageElement> {
  console.log('[VideoComposer] Loading image:', src.substring(0, 80) + '...');

  // For blob: and data: URLs, load directly (no CORS issues)
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log('[VideoComposer] Image loaded (local):', img.width, 'x', img.height);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load local image: ${src.substring(0, 40)}`));
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
      // IMPORTANT: Do NOT try without crossOrigin — it taints the canvas
      // and makes captureStream() produce empty/black frames.
      // Go directly to proxy which keeps canvas clean.
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
    // For blob: URLs, load directly
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
      // CORS fallback: try proxy (keeps canvas clean)
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

async function loadAudio(ctx: AudioContext, src: string): Promise<AudioBuffer> {
  console.log('[VideoComposer] Loading audio from:', src.substring(0, 80) + '...');

  // For blob: and data: URLs, fetch directly (no CORS issues)
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const res = await fetch(src);
    const arrayBuf = await res.arrayBuffer();
    console.log('[VideoComposer] Audio fetched (local):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
    return ctx.decodeAudioData(arrayBuf);
  }

  // For remote URLs, try proxy FIRST (most reliable for Supabase storage)
  const isRemote = src.startsWith('http://') || src.startsWith('https://');

  if (isRemote) {
    // Method 1: Proxy through our API (bypasses all CORS issues)
    try {
      const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(src)}`;
      console.log('[VideoComposer] Trying audio proxy...');
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        console.log('[VideoComposer] Audio fetched (proxy):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
        if (arrayBuf.byteLength > 0) {
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          console.log('[VideoComposer] Audio decoded via proxy:', audioBuf.duration.toFixed(1), 's');
          return audioBuf;
        }
      }
    } catch (proxyErr) {
      console.warn('[VideoComposer] Proxy fetch failed:', (proxyErr as Error)?.message);
    }

    // Method 2: Direct fetch with CORS (fallback)
    try {
      console.log('[VideoComposer] Trying direct CORS fetch...');
      const res = await fetch(src, { mode: 'cors' });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        console.log('[VideoComposer] Audio fetched (cors):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
        if (arrayBuf.byteLength > 0) {
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          console.log('[VideoComposer] Audio decoded:', audioBuf.duration.toFixed(1), 's');
          return audioBuf;
        }
      }
    } catch (corsErr) {
      console.warn('[VideoComposer] CORS fetch failed:', (corsErr as Error)?.message);
    }
  }

  // Method 3: Direct fetch (for same-origin or unknown URLs)
  try {
    const res = await fetch(src);
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > 0) {
      console.log('[VideoComposer] Audio fetched (direct):', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');
      return ctx.decodeAudioData(arrayBuf);
    }
  } catch (directErr) {
    console.warn('[VideoComposer] Direct fetch failed:', (directErr as Error)?.message);
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

// Sleep ms
const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
void _sleep; // keep for potential future use

// ═══════════════════════════════════════════════════════════
// SEQUENCE RENDERERS
// ═══════════════════════════════════════════════════════════

function drawIntro(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  posterImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  title: string, subtitle: string | undefined,
  accent: string, progress: number // 0-1
) {
  // Background
  if (posterImg) {
    const scale = Math.max(w / posterImg.width, h / posterImg.height);
    const sw = posterImg.width * scale;
    const sh = posterImg.height * scale;
    ctx.drawImage(posterImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
    // Gradient overlay
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

  // Ken Burns effect: slight zoom
  const zoomScale = 1 + progress * 0.05;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoomScale, zoomScale);
  ctx.translate(-w / 2, -h / 2);

  // Title — fade in
  const titleAlpha = Math.min(1, progress * 3);
  const fontSize = Math.round(w * 0.065);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${titleAlpha})`;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 20;
  ctx.fillText(title.toUpperCase(), w / 2, h / 2);
  ctx.shadowBlur = 0;

  // Subtitle
  if (subtitle) {
    const subAlpha = Math.max(0, Math.min(1, (progress - 0.2) * 3));
    const subSize = Math.round(w * 0.028);
    ctx.font = `400 ${subSize}px sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${subAlpha * 0.9})`;
    ctx.fillText(subtitle, w / 2, h / 2 + fontSize * 0.8);
  }

  // Accent line
  const lineAlpha = Math.max(0, Math.min(1, (progress - 0.3) * 3));
  const lineW = w * 0.12;
  ctx.strokeStyle = `rgba(${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)},${lineAlpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - lineW / 2, h / 2 + fontSize * 1.2);
  ctx.lineTo(w / 2 + lineW / 2, h / 2 + fontSize * 1.2);
  ctx.stroke();

  // Logo overlay top-center
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
  // Dark gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a0030');
  grad.addColorStop(0.5, '#0a0a0a');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // "Informations" label
  const labelSize = Math.round(w * 0.022);
  ctx.font = `700 ${labelSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.letterSpacing = '4px';
  ctx.fillText('INFORMATIONS', w / 2, h * 0.2);

  // Cards — stagger entrance
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

    // Card background
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    drawRoundRect(ctx, slideX, y, cardW, cardH, 12);
    ctx.fill();

    // Left color border
    ctx.fillStyle = card.color || accent;
    ctx.fillRect(slideX, y + 4, 3, cardH - 8);

    // Accent dot instead of emoji (emojis can render as broken icons on some canvas setups)
    const dotR = Math.round(cardH * 0.12);
    ctx.fillStyle = card.color || accent;
    ctx.beginPath();
    ctx.arc(slideX + 16 + dotR, y + cardH * 0.5, dotR, 0, Math.PI * 2);
    ctx.fill();

    // Label
    const lblSize = Math.round(w * 0.022);
    ctx.font = `400 ${lblSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(card.label, slideX + 16 + dotR * 2 + 10, y + cardH * 0.6);

    // Value
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

  // Logo overlay top-center
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

  // Logo overlay bottom-right
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
  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, hexToRgba(accent, 0.9));
  grad.addColorStop(0.5, 'rgba(255,45,170,0.7)');
  grad.addColorStop(1, hexToRgba(accent, 0.6));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Scale entrance
  const scaleProgress = Math.min(1, progress * 3);
  const scale = 0.92 + scaleProgress * 0.08;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-w / 2, -h / 2);

  // Logo
  if (logoImg) {
    const logoSize = Math.round(w * 0.12);
    ctx.drawImage(logoImg, (w - logoSize) / 2, h * 0.3, logoSize, logoSize);
  }

  // CTA Text
  const ctaSize = Math.round(w * 0.04);
  ctx.font = `900 ${ctaSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'white';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 25;
  ctx.fillText(ctaText.toUpperCase(), w / 2, h * 0.52);
  ctx.shadowBlur = 0;

  // CTA SubText
  const subSize = Math.round(w * 0.022);
  ctx.font = `400 ${subSize}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(ctaSubText.toUpperCase(), w / 2, h * 0.57);

  // Sales phrase
  if (salesPhrase) {
    const pSize = Math.round(w * 0.026);
    ctx.font = `italic 500 ${pSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(salesPhrase, w / 2, h * 0.63);
  }

  // Watermark
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
  t: number // 0=fully A, 1=fully B
) {
  // Draw A
  ctx.globalAlpha = 1 - t;
  drawA(1);
  // Draw B on top with increasing opacity
  ctx.globalAlpha = t;
  drawB(t * 0.3); // B starts with entrance animation
  ctx.globalAlpha = 1;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPOSER
// ═══════════════════════════════════════════════════════════

export async function composeVideo(options: ComposerOptions): Promise<Blob> {
  const {
    width, height,
    fps = 30,
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

  console.log('[VideoComposer] Media URLs — poster:', !!posterUrl, 'logo:', !!logoUrl, 'video:', !!videoUrl);

  // Load all media in parallel
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch((err) => { console.error('[VideoComposer] Poster load failed:', err?.message); return null; }) : Promise.resolve(null),
    logoUrl ? loadImage(logoUrl).catch((err) => { console.error('[VideoComposer] Logo load failed:', err?.message); return null; }) : Promise.resolve(null),
    videoUrl ? loadVideo(videoUrl).catch((err) => { console.error('[VideoComposer] Video load failed:', err?.message); return null; }) : Promise.resolve(null),
  ]);

  console.log('[VideoComposer] Media loaded — poster:', !!posterImg, 'logo:', !!logoImg, 'video:', !!videoEl);

  onProgress?.(10, 'Préparation du rendu...');

  // Build sequence list (skip video seq if no video)
  const sequences: Array<{ type: string; duration: number }> = [
    { type: 'intro', duration: introDuration },
  ];
  if (cards.length > 0) sequences.push({ type: 'cards', duration: cardsDuration });
  if (videoEl) sequences.push({ type: 'video', duration: videoDuration });
  sequences.push({ type: 'cta', duration: ctaDuration });

  const totalDuration = sequences.reduce((s, seq) => s + seq.duration, 0);
  const transitionDur = 0.8; // seconds for crossfade

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Audio setup — ONLY create AudioContext if we have actual audio files
  let audioCtx: AudioContext | null = null;
  let audioDestination: MediaStreamAudioDestinationNode | null = null;
  let musicSource: AudioBufferSourceNode | null = null;
  let voiceSource: AudioBufferSourceNode | null = null;
  let hasAudio = false;

  if (musicUrl || voiceUrl) {
    console.log('[VideoComposer] Audio URLs — music:', musicUrl, 'voice:', voiceUrl);
    try {
      audioCtx = new AudioContext();
      // CRITICAL: Resume AudioContext if suspended (browser autoplay policy)
      if (audioCtx.state === 'suspended') {
        console.log('[VideoComposer] AudioContext is suspended, resuming...');
        await audioCtx.resume();
        console.log('[VideoComposer] AudioContext resumed, state:', audioCtx.state);
      }
      audioDestination = audioCtx.createMediaStreamDestination();

      const [musicBuf, voiceBuf] = await Promise.all([
        musicUrl ? loadAudio(audioCtx, musicUrl).catch((err) => {
          console.error('[VideoComposer] Failed to load music:', err?.message || err);
          return null;
        }) : Promise.resolve(null),
        voiceUrl ? loadAudio(audioCtx, voiceUrl).catch((err) => {
          console.error('[VideoComposer] Failed to load voice:', err?.message || err);
          return null;
        }) : Promise.resolve(null),
      ]);

      console.log('[VideoComposer] Audio loaded — music:', musicBuf ? `${musicBuf.duration.toFixed(1)}s` : 'null', 'voice:', voiceBuf ? `${voiceBuf.duration.toFixed(1)}s` : 'null');

      if (musicBuf) {
        musicSource = audioCtx.createBufferSource();
        musicSource.buffer = musicBuf;
        musicSource.loop = true;
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = voiceBuf ? 0.3 : 0.8;
        musicSource.connect(gainNode);
        gainNode.connect(audioDestination);
        hasAudio = true;
      }

      if (voiceBuf) {
        voiceSource = audioCtx.createBufferSource();
        voiceSource.buffer = voiceBuf;
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;
        voiceSource.connect(gainNode);
        gainNode.connect(audioDestination);
        hasAudio = true;
      }

      // If neither audio loaded successfully, clean up
      if (!hasAudio) {
        console.warn('[VideoComposer] No audio buffers loaded, cleaning up AudioContext');
        try { audioCtx.close(); } catch {}
        audioCtx = null;
        audioDestination = null;
      }
    } catch (audioErr) {
      console.error('[VideoComposer] Audio setup failed:', audioErr);
      audioCtx = null;
      audioDestination = null;
    }
  }

  console.log('[VideoComposer] Audio status:', hasAudio ? 'ENABLED' : 'disabled (no audio)', 'musicUrl:', !!musicUrl, 'voiceUrl:', !!voiceUrl);

  onProgress?.(15, 'Démarrage du rendu...');

  // Append canvas to DOM (hidden) — required for captureStream reliability
  canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;opacity:0;';
  document.body.appendChild(canvas);

  // MediaRecorder setup — use captureStream(fps) for automatic frame capture
  const videoStream = canvas.captureStream(fps);

  // Build recording stream: video only, or video + audio if we have real audio
  let recordingStream: MediaStream;
  let mimeType: string;

  if (hasAudio && audioDestination) {
    // Combined video + audio stream
    recordingStream = new MediaStream();
    videoStream.getVideoTracks().forEach(t => recordingStream.addTrack(t));
    audioDestination.stream.getAudioTracks().forEach(t => recordingStream.addTrack(t));
    // Use codec with opus for audio
    mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
  } else {
    // Video-only stream — simpler mimeType
    recordingStream = videoStream;
    mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
  }

  console.log('[VideoComposer] Recording stream tracks:', recordingStream.getTracks().map(t => `${t.kind}:${t.readyState}`));
  console.log('[VideoComposer] Using mimeType:', mimeType);

  const recorder = new MediaRecorder(recordingStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000, // 8Mbps
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
    console.log('[VideoComposer] Data chunk:', e.data.size, 'bytes, total chunks:', chunks.length);
  };
  recorder.onerror = (e) => {
    console.error('[VideoComposer] Recorder error:', e);
  };

  // Start recording + audio
  recorder.start(500); // collect data every 500ms (less frequent = more reliable)
  if (musicSource) musicSource.start(0);
  if (voiceSource) voiceSource.start(0);
  if (videoEl) { videoEl.currentTime = 0; videoEl.play().catch(() => {}); }

  // ═══ RENDER LOOP (requestAnimationFrame-based for reliability) ═══
  const totalFrames = totalDuration * fps;
  const frameDurationMs = 1000 / fps;

  // Pre-calculate sequence start times
  const seqStarts: number[] = [];
  let cumTime = 0;
  for (const seq of sequences) {
    seqStarts.push(cumTime);
    cumTime += seq.duration;
  }

  // Helper: draw a single frame at a given time
  const drawFrame = (elapsed: number) => {
    // Determine current sequence
    let seqIdx = 0;
    for (let i = sequences.length - 1; i >= 0; i--) {
      if (elapsed >= seqStarts[i]) { seqIdx = i; break; }
    }
    const seq = sequences[seqIdx];
    const seqElapsed = elapsed - seqStarts[seqIdx];
    const seqProgress = seqElapsed / seq.duration; // 0-1

    // Check if in transition zone
    const inTransition = seqIdx < sequences.length - 1 && seqElapsed > seq.duration - transitionDur;
    const transProgress = inTransition ? (seqElapsed - (seq.duration - transitionDur)) / transitionDur : 0;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw sequence
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

  console.log('[VideoComposer] Starting render loop:', totalFrames, 'frames,', totalDuration, 's');

  // Use requestAnimationFrame + setInterval fallback for robust rendering
  // RAF ensures frames are captured by MediaRecorder; setInterval provides timing accuracy
  await new Promise<void>((resolve) => {
    let frameCount = 0;
    const startTime = performance.now();
    let _lastFrameTime = startTime;

    const renderTick = () => {
      // Calculate elapsed time
      const now = performance.now();
      const elapsedReal = (now - startTime) / 1000; // real seconds elapsed
      const targetFrame = Math.min(Math.floor(elapsedReal * fps), totalFrames);

      // Draw the frame for current real time (skip frames only when we're behind)
      if (frameCount <= targetFrame && frameCount < totalFrames) {
        const elapsed = elapsedReal; // use real elapsed for smooth playback
        drawFrame(Math.min(elapsed, totalDuration - 0.001));
        frameCount = targetFrame + 1;
        _lastFrameTime = now;

        // Update progress
        const percent = Math.round(15 + (elapsed / totalDuration) * 80);
        onProgress?.(Math.min(percent, 95), `Rendu: ${Math.round(Math.min((elapsed / totalDuration) * 100, 100))}%`);
      }

      // Check if done
      if (elapsedReal >= totalDuration) {
        clearInterval(intervalId);
        cancelAnimationFrame(rafId);
        console.log('[VideoComposer] Render loop complete:', frameCount, 'frames rendered');
        resolve();
      } else {
        // Schedule next frame with RAF for smooth capture
        rafId = requestAnimationFrame(renderTick);
      }
    };

    // Use both RAF (for smooth capture) and setInterval (for timing accuracy)
    // This ensures MediaRecorder captures frames even if RAF is throttled
    let rafId = requestAnimationFrame(renderTick);
    const intervalId = setInterval(renderTick, frameDurationMs);

    // Also render first frame immediately
    renderTick();
  });

  // Draw one final frame to ensure canvas has content
  drawFrame(totalDuration - 0.001);

  // Wait a moment for MediaRecorder to capture the last frames
  await new Promise(r => setTimeout(r, 1000));

  onProgress?.(96, 'Finalisation...');

  // Stop recording first, THEN clean up audio
  const blob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      const b = new Blob(chunks, { type: mimeType });
      console.log('[VideoComposer] Output blob:', (b.size / 1024 / 1024).toFixed(1), 'MB, chunks:', chunks.length);
      resolve(b);
    };
    recorder.stop();
  });

  // Clean up AFTER recording is stopped
  if (videoEl) videoEl.pause();
  if (musicSource) try { musicSource.stop(); } catch {}
  if (voiceSource) try { voiceSource.stop(); } catch {}
  if (audioCtx) try { audioCtx.close(); } catch {}
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

  // Skip upload if blob is empty
  if (blob.size === 0) {
    console.error('[VideoComposer] Blob is empty, skipping upload');
    return { blob, url: null };
  }

  console.log('[VideoComposer] Uploading blob:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

  // Upload to Supabase via /api/upload/media
  let url: string | null = null;
  try {
    const formData = new FormData();
    // Use clean mimeType without codec spec (Supabase may reject complex types)
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
