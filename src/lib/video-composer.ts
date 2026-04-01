/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Renders montage sequences (intro, cards, video, CTA) directly in the browser.
 * Uses canvas.captureStream() + MediaStreamAudioDestinationNode for GUARANTEED
 * audio+video capture. MediaRecorder encodes in real-time (VP8 + Opus → WebM).
 * Outputs a downloadable WebM video blob — NO server rendering needed.
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

  if (src.startsWith('blob:')) {
    return blobUrlToDataUrl(src).then(
      (dataUrl) => {
        console.log('[VideoComposer] Converted blob URL to data URL, length:', dataUrl.length);
        return loadImage(dataUrl);
      },
      (err) => {
        console.warn('[VideoComposer] blob→dataURL conversion failed, trying direct:', err);
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Failed to load blob image`));
          img.src = src;
        });
      }
    );
  }

  if (src.startsWith('data:')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load data URL image`));
      img.src = src;
    });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      const proxyImg = new Image();
      proxyImg.crossOrigin = 'anonymous';
      proxyImg.onload = () => resolve(proxyImg);
      proxyImg.onerror = () => reject(new Error(`Failed to load image: ${src.substring(0, 60)}`));
      proxyImg.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
    };
    img.src = src;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const vid = document.createElement('video');
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      vid.crossOrigin = 'anonymous';
    }
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.oncanplaythrough = () => resolve(vid);
    vid.onerror = () => {
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        return reject(new Error('Failed to load local video'));
      }
      const vid2 = document.createElement('video');
      vid2.crossOrigin = 'anonymous';
      vid2.muted = true;
      vid2.playsInline = true;
      vid2.preload = 'auto';
      vid2.oncanplaythrough = () => resolve(vid2);
      vid2.onerror = () => reject(new Error(`Failed to load video`));
      vid2.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
      vid2.load();
    };
    vid.src = src;
    vid.load();
  });
}

async function fetchAudioBuffer(src: string, audioCtx: AudioContext | OfflineAudioContext): Promise<AudioBuffer | null> {
  console.log('[VideoComposer] Fetching audio from:', src.substring(0, 80));
  try {
    let arrayBuf: ArrayBuffer;

    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const res = await fetch(src);
      arrayBuf = await res.arrayBuffer();
    } else {
      // Try proxy first, then CORS, then direct
      let fetched = false;
      arrayBuf = new ArrayBuffer(0);

      try {
        const res = await fetch(`/api/proxy-media?url=${encodeURIComponent(src)}`);
        if (res.ok) { arrayBuf = await res.arrayBuffer(); fetched = arrayBuf.byteLength > 0; }
      } catch {}

      if (!fetched) {
        try {
          const res = await fetch(src, { mode: 'cors' });
          if (res.ok) { arrayBuf = await res.arrayBuffer(); fetched = arrayBuf.byteLength > 0; }
        } catch {}
      }

      if (!fetched) {
        const res = await fetch(src);
        arrayBuf = await res.arrayBuffer();
      }
    }

    console.log('[VideoComposer] Audio bytes fetched:', (arrayBuf.byteLength / 1024).toFixed(1), 'KB');

    if (arrayBuf.byteLength < 100) {
      console.warn('[VideoComposer] Audio file too small:', arrayBuf.byteLength, 'bytes');
      return null;
    }

    // Log header for format identification
    const header = new Uint8Array(arrayBuf.slice(0, 12));
    console.log('[VideoComposer] Audio header:', Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' '));

    const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    console.log('[VideoComposer] Audio decoded:', decoded.duration.toFixed(1), 's,', decoded.numberOfChannels, 'ch');
    return decoded;
  } catch (err) {
    console.error('[VideoComposer] Audio fetch/decode FAILED:', (err as Error)?.message);
    return null;
  }
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
  console.log('[VideoComposer] Audio sources — music:', musicUrl?.substring(0, 80) || 'NONE', '| voice:', voiceUrl?.substring(0, 80) || 'NONE');

  // Use a temporary OfflineAudioContext just for decoding
  const decodeCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  const [musicBuf, voiceBuf] = await Promise.all([
    musicUrl ? fetchAudioBuffer(musicUrl, decodeCtx).catch(() => null) : null,
    voiceUrl ? fetchAudioBuffer(voiceUrl, decodeCtx).catch(() => null) : null,
  ]);

  console.log('[VideoComposer] Decoded — music:', musicBuf ? `${musicBuf.duration.toFixed(1)}s` : 'NULL',
    '| voice:', voiceBuf ? `${voiceBuf.duration.toFixed(1)}s` : 'NULL');

  if (!musicBuf && !voiceBuf) {
    console.error('[VideoComposer] ❌ No audio could be decoded!');
    return null;
  }

  // Create a fresh OfflineAudioContext for rendering (the previous one may be in a bad state)
  const renderCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  if (musicBuf) {
    const musicSource = renderCtx.createBufferSource();
    musicSource.buffer = musicBuf;
    musicSource.loop = true;
    const gainNode = renderCtx.createGain();
    gainNode.gain.value = voiceBuf ? 0.3 : 0.8;
    musicSource.connect(gainNode);
    gainNode.connect(renderCtx.destination);
    musicSource.start(0);
    console.log('[VideoComposer] Music connected, gain:', voiceBuf ? 0.3 : 0.8);
  }

  if (voiceBuf) {
    const voiceSource = renderCtx.createBufferSource();
    voiceSource.buffer = voiceBuf;
    const gainNode = renderCtx.createGain();
    gainNode.gain.value = 1.0;
    voiceSource.connect(gainNode);
    gainNode.connect(renderCtx.destination);
    voiceSource.start(0);
    console.log('[VideoComposer] Voice connected, gain: 1.0');
  }

  const renderedBuffer = await renderCtx.startRendering();
  console.log('[VideoComposer] ✅ Audio pre-rendered:', renderedBuffer.duration.toFixed(1), 's,',
    renderedBuffer.numberOfChannels, 'ch');

  // Verify audio has content
  const ch0 = renderedBuffer.getChannelData(0);
  let maxAmp = 0;
  for (let i = 0; i < Math.min(ch0.length, 48000 * 2); i++) { maxAmp = Math.max(maxAmp, Math.abs(ch0[i])); }
  console.log('[VideoComposer] Audio max amplitude (first 2s):', maxAmp.toFixed(4), maxAmp > 0.001 ? '✅ HAS AUDIO' : '⚠ SILENT');

  return renderedBuffer;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPOSER — MediaRecorder (canvas stream + audio destination)
// This approach GUARANTEES audio capture because the audio plays
// through a MediaStreamAudioDestinationNode, not just speakers.
// ═══════════════════════════════════════════════════════════

export async function composeVideo(options: ComposerOptions): Promise<Blob> {
  const {
    width, height,
    fps = 24,
    title, subtitle, salesPhrase, cards = [],
    posterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
    introDuration = 4, cardsDuration = 6, videoDuration = 10, ctaDuration = 4,
    accentColor = '#D91CD2',
    ctaText = 'CHAT POUR PLUS D\'INFOS',
    ctaSubText = 'LIEN EN BIO',
    watermarkText,
    onProgress,
  } = options;

  console.log('[VideoComposer] === COMPOSE START (MediaRecorder) ===');
  console.log('[VideoComposer] Size:', width, 'x', height, '@ ', fps, 'fps');
  console.log('[VideoComposer] Audio — music:', musicUrl?.substring(0, 60) || 'NONE', '| voice:', voiceUrl?.substring(0, 60) || 'NONE');
  console.log('[VideoComposer] Logo:', logoUrl?.substring(0, 60) || 'NONE');

  onProgress?.(2, 'Chargement des médias...');

  // Load all visual media in parallel
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch(() => null) : null,
    logoUrl ? loadImage(logoUrl).catch((err) => { console.error('[VideoComposer] Logo load FAILED:', err); return null; }) : null,
    videoUrl ? loadVideo(videoUrl).catch(() => null) : null,
  ]);

  console.log('[VideoComposer] Media — poster:', !!posterImg, 'logo:', !!logoImg, 'video:', !!videoEl);

  // Build sequence list
  const sequences: Array<{ type: string; duration: number }> = [
    { type: 'intro', duration: introDuration },
  ];
  if (cards.length > 0) sequences.push({ type: 'cards', duration: cardsDuration });
  if (videoEl) sequences.push({ type: 'video', duration: videoDuration });
  sequences.push({ type: 'cta', duration: ctaDuration });

  const totalDuration = sequences.reduce((s, seq) => s + seq.duration, 0);
  const transitionDur = 0.8;

  // Pre-calculate sequence start times
  const seqStarts: number[] = [];
  let cumTime = 0;
  for (const seq of sequences) {
    seqStarts.push(cumTime);
    cumTime += seq.duration;
  }

  console.log('[VideoComposer] Total duration:', totalDuration.toFixed(1), 's | Sequences:', sequences.map(s => s.type).join(' → '));

  onProgress?.(8, 'Préparation audio...');

  // Pre-render audio
  const audioBuffer = await preRenderAudio(musicUrl || null, voiceUrl || null, totalDuration);
  const hasAudio = audioBuffer !== null;

  onProgress?.(15, 'Démarrage du rendu...');

  // ═══ SET UP CANVAS ═══
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;opacity:0;';
  document.body.appendChild(canvas);

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

  // ═══ SET UP MEDIARECORDER WITH AUDIO ═══
  // canvas.captureStream gives us a video track
  // AudioContext + MediaStreamDestination gives us an audio track
  // MediaRecorder captures BOTH together — guaranteed!

  const videoStream = canvas.captureStream(fps);

  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;

  if (hasAudio) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    const audioDest = audioCtx.createMediaStreamDestination();

    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioDest);

    // Add audio track to the video stream
    for (const track of audioDest.stream.getAudioTracks()) {
      videoStream.addTrack(track);
    }

    console.log('[VideoComposer] Audio stream attached — tracks:', videoStream.getTracks().map(t => t.kind).join(', '));
  }

  // Choose MediaRecorder codec
  let mimeType = 'video/webm;codecs=vp8,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
  }
  console.log('[VideoComposer] MediaRecorder mimeType:', mimeType);

  const recorder = new MediaRecorder(videoStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });

  // Collect recorded chunks
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // ═══ REAL-TIME RENDER + RECORD ═══
  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      console.log('[VideoComposer] MediaRecorder stopped, chunks:', chunks.length);
      const blob = new Blob(chunks, { type: 'video/webm' });
      console.log('[VideoComposer] Output blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB');

      // Cleanup
      if (audioCtx) audioCtx.close().catch(() => {});
      if (videoEl) videoEl.pause();
      try { document.body.removeChild(canvas); } catch {}

      onProgress?.(100, 'Terminé !');
      resolve(blob);
    };

    recorder.onerror = (e) => {
      console.error('[VideoComposer] MediaRecorder error:', e);
      reject(new Error('MediaRecorder error'));
    };

    // Start recording
    recorder.start(200); // collect data every 200ms

    // Start audio playback (through MediaStreamDestination, NOT speakers)
    if (audioSource) {
      audioSource.start(0);
      console.log('[VideoComposer] Audio playback started');
    }

    // Start video element for the video sequence
    if (videoEl) {
      videoEl.currentTime = 0;
      videoEl.pause();
    }

    console.log('[VideoComposer] Recording started, rendering', totalDuration.toFixed(1), 's in real-time...');

    const startTime = performance.now();
    let lastProgressUpdate = 0;

    const animate = () => {
      const now = performance.now();
      const elapsed = (now - startTime) / 1000;

      if (elapsed >= totalDuration + 0.2) {
        // Done! Add a tiny buffer to ensure last frame is captured
        console.log('[VideoComposer] Render complete, stopping recorder');
        recorder.stop();
        return;
      }

      const clampedElapsed = Math.min(elapsed, totalDuration - 0.001);

      // Handle video element playback
      if (videoEl) {
        const videoSeq = sequences.find(s => s.type === 'video');
        if (videoSeq) {
          const videoStart = seqStarts[sequences.indexOf(videoSeq)];
          const videoEnd = videoStart + videoSeq.duration;
          if (clampedElapsed >= videoStart && clampedElapsed < videoEnd) {
            if (videoEl.paused) {
              videoEl.currentTime = clampedElapsed - videoStart;
              videoEl.play().catch(() => {});
            }
          } else if (!videoEl.paused) {
            videoEl.pause();
          }
        }
      }

      // Draw frame
      drawFrame(clampedElapsed);

      // Update progress (not too often)
      if (elapsed - lastProgressUpdate > 0.5) {
        lastProgressUpdate = elapsed;
        const percent = Math.round(15 + (elapsed / totalDuration) * 80);
        onProgress?.(Math.min(percent, 95), `Rendu: ${Math.round((elapsed / totalDuration) * 100)}%`);
      }

      requestAnimationFrame(animate);
    };

    // Draw first frame immediately
    drawFrame(0);
    requestAnimationFrame(animate);
  });
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
    const file = new File([blob], `montage-${Date.now()}.webm`, { type: 'video/webm' });
    formData.append('file', file);
    formData.append('purpose', 'rush');
    const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success && data.file?.url) {
      url = data.file.url;
      console.log('[VideoComposer] Upload success:', url);
    } else {
      console.error('[VideoComposer] Upload failed:', data);
    }
  } catch (err) {
    console.error('[VideoComposer] Upload error:', err);
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
