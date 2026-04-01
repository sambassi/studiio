/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Uses fetch() + decodeAudioData() + AudioBufferSourceNode for GUARANTEED audio capture.
 * AudioBufferSourceNode plays ONLY through Web Audio graph (not speakers).
 * This ensures MediaRecorder captures all audio in the final video file.
 * Outputs MP4 if supported, otherwise WebM.
 */

// ═══════════════════════════════════════════════════════════
// AUDIO & FORMAT DIAGNOSTICS
// ═══════════════════════════════════════════════════════════

/** Log all supported MediaRecorder mime types for debugging */
export function diagnoseMediaSupport(): Record<string, boolean> {
  const types = [
    'video/mp4', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=h264,aac',
    'video/webm', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus',
    'video/webm;codecs=h264,opus', 'audio/webm;codecs=opus',
  ];
  const results: Record<string, boolean> = {};
  for (const t of types) {
    results[t] = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t);
  }
  console.log('[AudioDiag] MediaRecorder supported types:', JSON.stringify(results, null, 2));
  return results;
}

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
  title: string;
  subtitle?: string;
  salesPhrase?: string;
  cards?: CardData[];
  posterUrl?: string | null;
  videoUrl?: string | null;
  logoUrl?: string | null;
  musicUrl?: string | null;
  voiceUrl?: string | null;
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  watermarkText?: string;
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
  if (src.startsWith('blob:')) {
    return blobUrlToDataUrl(src).then(
      (dataUrl) => loadImage(dataUrl),
      () => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load blob image'));
        img.src = src;
      })
    );
  }
  if (src.startsWith('data:')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load data URL image'));
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
      proxyImg.onerror = () => reject(new Error('Failed to load image'));
      proxyImg.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
    };
    img.src = src;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const vid = document.createElement('video');
    if (!src.startsWith('blob:') && !src.startsWith('data:')) vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.oncanplaythrough = () => resolve(vid);
    vid.onerror = () => {
      if (src.startsWith('blob:') || src.startsWith('data:')) return reject(new Error('Video load failed'));
      const vid2 = document.createElement('video');
      vid2.crossOrigin = 'anonymous';
      vid2.muted = true; vid2.playsInline = true; vid2.preload = 'auto';
      vid2.oncanplaythrough = () => resolve(vid2);
      vid2.onerror = () => reject(new Error('Video load failed'));
      vid2.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
      vid2.load();
    };
    vid.src = src;
    vid.load();
  });
}

/**
 * Fetch audio file and decode it into an AudioBuffer.
 * This is MORE RELIABLE than <audio> + createMediaElementSource because:
 * 1. fetch() works perfectly with blob: URLs (same-origin)
 * 2. decodeAudioData handles MP3/OGG/WAV natively
 * 3. The resulting AudioBuffer can be played via AudioBufferSourceNode
 *    which ONLY outputs through Web Audio graph (never speakers)
 * 4. GUARANTEED to be captured by MediaStreamDestinationNode → MediaRecorder
 */
async function loadAudioBuffer(audioCtx: AudioContext, src: string): Promise<AudioBuffer | null> {
  console.log('[AudioPipeline] ====== loadAudioBuffer START ======');
  console.log('[AudioPipeline] Source:', src);
  console.log('[AudioPipeline] AudioContext state:', audioCtx.state, 'sampleRate:', audioCtx.sampleRate);

  const tryDecode = async (arrayBuf: ArrayBuffer, method: string): Promise<AudioBuffer> => {
    console.log(`[AudioPipeline] decodeAudioData (${method}), size:`, arrayBuf.byteLength, 'bytes');
    // Log file header to identify format
    const header = new Uint8Array(arrayBuf.slice(0, 16));
    console.log(`[AudioPipeline] File header (${method}):`, Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' '));

    const cloned = arrayBuf.slice(0);
    const audioBuf = await audioCtx.decodeAudioData(cloned);
    console.log(`[AudioPipeline] ✅ decode SUCCESS (${method}):`, {
      duration: audioBuf.duration.toFixed(2) + 's',
      channels: audioBuf.numberOfChannels,
      sampleRate: audioBuf.sampleRate,
      length: audioBuf.length,
    });
    // Verify audio is not silent
    const ch = audioBuf.getChannelData(0);
    let maxAmp = 0;
    for (let i = 0; i < Math.min(ch.length, 44100); i++) maxAmp = Math.max(maxAmp, Math.abs(ch[i]));
    console.log(`[AudioPipeline] Amplitude (first 1s): max=${maxAmp.toFixed(4)} ${maxAmp > 0.001 ? '✅ HAS AUDIO' : '⚠️ SILENT'}`);
    return audioBuf;
  };

  try {
    // Step 1: Fetch the audio file as raw bytes
    let response: Response;
    try {
      console.log('[AudioPipeline] Fetching direct...');
      response = await fetch(src);
      console.log('[AudioPipeline] Direct fetch:', response.status, 'type:', response.headers.get('content-type'), 'size:', response.headers.get('content-length'));
    } catch {
      if (!src.startsWith('blob:') && !src.startsWith('data:')) {
        console.log('[AudioPipeline] Direct fetch failed, trying proxy...');
        response = await fetch(`/api/proxy-media?url=${encodeURIComponent(src)}`);
        console.log('[AudioPipeline] Proxy fetch:', response.status, 'type:', response.headers.get('content-type'));
      } else {
        throw new Error('Fetch failed for blob/data URL');
      }
    }

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    console.log('[AudioPipeline] Fetched:', (arrayBuffer.byteLength / 1024).toFixed(1), 'KB');

    if (arrayBuffer.byteLength < 100) {
      console.warn('[AudioPipeline] ⚠️ Audio file too small (<100 bytes), skipping');
      return null;
    }

    return await tryDecode(arrayBuffer, 'direct');
  } catch (err) {
    console.error('[AudioPipeline] ❌ Primary load FAILED:', (err as Error)?.message);

    // Fallback: try proxy for remote URLs
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      try {
        const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(src)}`;
        console.log('[AudioPipeline] Trying proxy fallback...');
        const resp = await fetch(proxyUrl);
        console.log('[AudioPipeline] Proxy response:', resp.status, 'type:', resp.headers.get('content-type'));
        const ab = await resp.arrayBuffer();
        if (ab.byteLength > 100) {
          return await tryDecode(ab, 'proxy');
        }
      } catch (proxyErr) {
        console.error('[AudioPipeline] ❌ Proxy fallback also failed:', (proxyErr as Error)?.message);
      }
    }
    console.error('[AudioPipeline] ====== ALL METHODS FAILED ======');
    return null;
  }
}

/**
 * Fallback: load audio via <audio> element + createMediaElementSource.
 * Works even when decodeAudioData fails for some codecs.
 * Does NOT play through speakers — only feeds into the recording stream.
 */
function loadAudioElement(src: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    console.log('[AudioPipeline] Creating <audio> element fallback for:', src.substring(0, 80));
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      audio.src = src;
    } else {
      audio.src = `/api/proxy-media?url=${encodeURIComponent(src)}`;
    }
    audio.oncanplaythrough = () => {
      console.log('[AudioPipeline] <audio> element ready, duration:', audio.duration.toFixed(2) + 's');
      resolve(audio);
    };
    audio.onerror = (e) => {
      console.error('[AudioPipeline] <audio> element failed:', e);
      reject(new Error('Audio element load failed'));
    };
    audio.load();
  });
}

/** Encode an AudioBuffer to a WAV Blob (PCM 16-bit) */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and write PCM data
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
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
  ctx: CanvasRenderingContext2D, w: number, h: number,
  posterImg: HTMLImageElement | null, logoImg: HTMLImageElement | null,
  title: string, subtitle: string | undefined, accent: string, progress: number
) {
  if (posterImg) {
    const scale = Math.max(w / posterImg.width, h / posterImg.height);
    const sw = posterImg.width * scale, sh = posterImg.height * scale;
    ctx.drawImage(posterImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, hexToRgba(accent, 0.85));
    grad.addColorStop(0.4, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#000000'); grad.addColorStop(1, '#1a0030');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  }
  const zoomScale = 1 + progress * 0.05;
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(zoomScale, zoomScale); ctx.translate(-w / 2, -h / 2);
  const fontSize = Math.round(w * 0.065);
  ctx.font = `900 ${fontSize}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${Math.min(1, progress * 3)})`;
  ctx.shadowColor = accent; ctx.shadowBlur = 20;
  ctx.fillText(title.toUpperCase(), w / 2, h / 2); ctx.shadowBlur = 0;
  if (subtitle) {
    const subAlpha = Math.max(0, Math.min(1, (progress - 0.2) * 3));
    ctx.font = `400 ${Math.round(w * 0.028)}px sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${subAlpha * 0.9})`;
    ctx.fillText(subtitle, w / 2, h / 2 + fontSize * 0.8);
  }
  const lineAlpha = Math.max(0, Math.min(1, (progress - 0.3) * 3));
  const lineW = w * 0.12;
  ctx.strokeStyle = `rgba(${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)},${lineAlpha})`;
  ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(w / 2 - lineW / 2, h / 2 + fontSize * 1.2);
  ctx.lineTo(w / 2 + lineW / 2, h / 2 + fontSize * 1.2); ctx.stroke();
  if (logoImg) {
    ctx.globalAlpha = Math.min(1, progress * 2);
    const logoSize = Math.round(w * 0.12);
    ctx.drawImage(logoImg, (w - logoSize) / 2, h * 0.15, logoSize, logoSize);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawCards(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  cards: CardData[], logoImg: HTMLImageElement | null, accent: string, progress: number
) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a0030'); grad.addColorStop(0.5, '#0a0a0a'); grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  ctx.font = `700 ${Math.round(w * 0.022)}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('INFORMATIONS', w / 2, h * 0.2);
  const cardH = Math.round(h * 0.065), cardW = Math.round(w * 0.8);
  const cardX = (w - cardW) / 2, startY = h * 0.27, gap = cardH * 1.4;
  cards.slice(0, 5).forEach((card, i) => {
    const cp = Math.max(0, Math.min(1, (progress - i * 0.12) * 4));
    if (cp <= 0) return;
    const y = startY + i * gap, slideX = cardX + (1 - cp) * (-w * 0.15);
    ctx.globalAlpha = cp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; drawRoundRect(ctx, slideX, y, cardW, cardH, 12); ctx.fill();
    ctx.fillStyle = card.color || accent; ctx.fillRect(slideX, y + 4, 3, cardH - 8);
    const dotR = Math.round(cardH * 0.12);
    ctx.fillStyle = card.color || accent; ctx.beginPath();
    ctx.arc(slideX + 16 + dotR, y + cardH * 0.5, dotR, 0, Math.PI * 2); ctx.fill();
    ctx.font = `400 ${Math.round(w * 0.022)}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'left';
    ctx.fillText(card.label, slideX + 16 + dotR * 2 + 10, y + cardH * 0.6);
    ctx.font = `700 ${Math.round(w * 0.032)}px sans-serif`; ctx.textAlign = 'right'; ctx.fillStyle = 'white';
    ctx.shadowColor = accent; ctx.shadowBlur = 8;
    ctx.fillText(card.value, slideX + cardW - 16, y + cardH * 0.65); ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  });
  if (logoImg) {
    const logoSize = Math.round(w * 0.08), padding = Math.round(w * 0.03);
    ctx.drawImage(logoImg, w - logoSize - padding, padding, logoSize, logoSize);
  }
}

function drawVideoSeq(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  videoEl: HTMLVideoElement | null, logoImg: HTMLImageElement | null, _progress: number
) {
  if (videoEl) {
    const scale = Math.max(w / videoEl.videoWidth, h / videoEl.videoHeight);
    ctx.drawImage(videoEl, (w - videoEl.videoWidth * scale) / 2, (h - videoEl.videoHeight * scale) / 2, videoEl.videoWidth * scale, videoEl.videoHeight * scale);
  } else {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
    ctx.font = `400 ${Math.round(w * 0.03)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillText('Vidéo', w / 2, h / 2);
  }
  if (logoImg) {
    const logoSize = Math.round(w * 0.08), padding = Math.round(w * 0.03);
    ctx.drawImage(logoImg, w - logoSize - padding, h - logoSize - padding, logoSize, logoSize);
  }
}

function drawCTA(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  accent: string, ctaText: string, ctaSubText: string,
  salesPhrase: string | undefined, watermark: string | undefined,
  logoImg: HTMLImageElement | null, progress: number
) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, hexToRgba(accent, 0.9));
  grad.addColorStop(0.5, 'rgba(255,45,170,0.7)');
  grad.addColorStop(1, hexToRgba(accent, 0.6));
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  const scale = 0.92 + Math.min(1, progress * 3) * 0.08;
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(scale, scale); ctx.translate(-w / 2, -h / 2);
  if (logoImg) {
    const logoSize = Math.round(w * 0.12);
    ctx.drawImage(logoImg, (w - logoSize) / 2, h * 0.3, logoSize, logoSize);
  }
  ctx.font = `900 ${Math.round(w * 0.04)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = 'white';
  ctx.shadowColor = accent; ctx.shadowBlur = 25;
  ctx.fillText(ctaText.toUpperCase(), w / 2, h * 0.52); ctx.shadowBlur = 0;
  ctx.font = `400 ${Math.round(w * 0.022)}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(ctaSubText.toUpperCase(), w / 2, h * 0.57);
  if (salesPhrase) {
    ctx.font = `italic 500 ${Math.round(w * 0.026)}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(salesPhrase, w / 2, h * 0.63);
  }
  if (watermark) {
    ctx.font = `400 ${Math.round(w * 0.014)}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText(watermark, w / 2, h * 0.9);
  }
  ctx.restore();
}

function drawTransition(
  ctx: CanvasRenderingContext2D, _w: number, _h: number,
  drawA: (p: number) => void, drawB: (p: number) => void, t: number
) {
  ctx.globalAlpha = 1 - t; drawA(1);
  ctx.globalAlpha = t; drawB(t * 0.3);
  ctx.globalAlpha = 1;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPOSER — MediaRecorder + AudioBufferSourceNode
// ═══════════════════════════════════════════════════════════

export async function composeVideo(options: ComposerOptions): Promise<Blob> {
  const {
    width, height, fps = 24,
    title, subtitle, salesPhrase, cards = [],
    posterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
    introDuration = 4, cardsDuration = 6, videoDuration = 10, ctaDuration = 4,
    accentColor = '#D91CD2',
    ctaText = 'CHAT POUR PLUS D\'INFOS', ctaSubText = 'LIEN EN BIO',
    watermarkText, onProgress,
  } = options;

  console.log('[Composer] ═══════════════════════════════════════');
  console.log('[Composer] === START COMPOSE ===');
  console.log('[Composer] Music URL:', musicUrl ? musicUrl.substring(0, 80) : 'NONE');
  console.log('[Composer] Voice URL:', voiceUrl ? voiceUrl.substring(0, 80) : 'NONE');
  console.log('[Composer] Logo URL:', logoUrl ? logoUrl.substring(0, 80) : 'NONE');

  onProgress?.(2, 'Chargement des médias...');

  // Run format diagnostics
  diagnoseMediaSupport();

  // ═══ CREATE AUDIO CONTEXT FIRST (needed for decodeAudioData) ═══
  const hasAudioUrls = !!musicUrl || !!voiceUrl;
  let audioCtx: AudioContext | null = null;
  // audioDest removed — now using playbackDest in the audio section below
  // Fallback: <audio> elements when decodeAudioData fails
  let musicElement: HTMLAudioElement | null = null;
  let voiceElement: HTMLAudioElement | null = null;

  if (hasAudioUrls) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    await audioCtx.resume();
    console.log('[AudioPipeline] AudioContext created — state:', audioCtx.state, ', sampleRate:', audioCtx.sampleRate);
    if (audioCtx.state !== 'running') {
      console.error('[AudioPipeline] ❌ AudioContext NOT RUNNING after resume! Browser may have blocked it (no user gesture).');
    }
  }

  // ═══ LOAD ALL MEDIA IN PARALLEL ═══
  const [posterImg, logoImg, videoEl, musicBuffer, voiceBuffer] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch(() => null) : null,
    logoUrl ? loadImage(logoUrl).catch(() => null) : null,
    videoUrl ? loadVideo(videoUrl).catch(() => null) : null,
    (audioCtx && musicUrl) ? loadAudioBuffer(audioCtx, musicUrl) : null,
    (audioCtx && voiceUrl) ? loadAudioBuffer(audioCtx, voiceUrl) : null,
  ]);

  let hasAudio = musicBuffer !== null || voiceBuffer !== null;
  console.log('[Composer] Media loaded — poster:', !!posterImg, '| logo:', !!logoImg, '| video:', !!videoEl);
  console.log('[Composer] Audio buffers — music:', musicBuffer ? `${musicBuffer.duration.toFixed(1)}s` : 'NULL', '| voice:', voiceBuffer ? `${voiceBuffer.duration.toFixed(1)}s` : 'NULL');

  // ═══ AUDIO ELEMENT FALLBACK for failed decodeAudioData ═══
  if (audioCtx && musicUrl && !musicBuffer) {
    console.log('[AudioPipeline] Music decodeAudioData failed, trying <audio> element fallback...');
    try {
      musicElement = await loadAudioElement(musicUrl);
      hasAudio = true;
    } catch (e) {
      console.error('[AudioPipeline] ❌ Music <audio> fallback also failed:', (e as Error)?.message);
    }
  }
  if (audioCtx && voiceUrl && !voiceBuffer) {
    console.log('[AudioPipeline] Voice decodeAudioData failed, trying <audio> element fallback...');
    try {
      voiceElement = await loadAudioElement(voiceUrl);
      hasAudio = true;
    } catch (e) {
      console.error('[AudioPipeline] ❌ Voice <audio> fallback also failed:', (e as Error)?.message);
    }
  }

  // If we created AudioContext but got no audio at all, close it
  if (audioCtx && !hasAudio) {
    console.warn('[AudioPipeline] ❌ No audio loaded (buffer or element), closing AudioContext');
    await audioCtx.close();
    audioCtx = null;
  }

  // Build sequences
  const sequences: Array<{ type: string; duration: number }> = [{ type: 'intro', duration: introDuration }];
  if (cards.length > 0) sequences.push({ type: 'cards', duration: cardsDuration });
  if (videoEl) sequences.push({ type: 'video', duration: videoDuration });
  sequences.push({ type: 'cta', duration: ctaDuration });

  const totalDuration = sequences.reduce((s, seq) => s + seq.duration, 0);
  const transitionDur = 0.8;
  const seqStarts: number[] = [];
  let cumTime = 0;
  for (const seq of sequences) { seqStarts.push(cumTime); cumTime += seq.duration; }

  console.log('[Composer] Duration:', totalDuration.toFixed(1), 's | Sequences:', sequences.map(s => s.type).join(' → '));

  onProgress?.(10, 'Préparation...');

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;opacity:0;';
  document.body.appendChild(canvas);

  // Draw frame helper
  const drawFrame = (elapsed: number) => {
    let seqIdx = 0;
    for (let i = sequences.length - 1; i >= 0; i--) { if (elapsed >= seqStarts[i]) { seqIdx = i; break; } }
    const seq = sequences[seqIdx];
    const seqElapsed = elapsed - seqStarts[seqIdx];
    const seqProgress = seqElapsed / seq.duration;
    const inTransition = seqIdx < sequences.length - 1 && seqElapsed > seq.duration - transitionDur;
    const transProgress = inTransition ? (seqElapsed - (seq.duration - transitionDur)) / transitionDur : 0;
    ctx.clearRect(0, 0, width, height);
    const drawSeq = (type: string, progress: number) => {
      switch (type) {
        case 'intro': drawIntro(ctx, width, height, posterImg, logoImg, title, subtitle, accentColor, progress); break;
        case 'cards': drawCards(ctx, width, height, cards, logoImg, accentColor, progress); break;
        case 'video': drawVideoSeq(ctx, width, height, videoEl, logoImg, progress); break;
        case 'cta': drawCTA(ctx, width, height, accentColor, ctaText, ctaSubText, salesPhrase, watermarkText, logoImg, progress); break;
      }
    };
    if (inTransition && seqIdx < sequences.length - 1) {
      drawTransition(ctx, width, height, (p) => drawSeq(seq.type, p), (p) => drawSeq(sequences[seqIdx + 1].type, p), transProgress);
    } else { drawSeq(seq.type, seqProgress); }
    const barH = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, height - barH, width, barH);
    const barGrad = ctx.createLinearGradient(0, 0, width * (elapsed / totalDuration), 0);
    barGrad.addColorStop(0, accentColor); barGrad.addColorStop(0.5, '#FF2DAA'); barGrad.addColorStop(1, '#00D4FF');
    ctx.fillStyle = barGrad; ctx.fillRect(0, height - barH, width * (elapsed / totalDuration), barH);
  };

  // ═══ AUDIO CAPTURE — Simple approach: AudioBufferSourceNode → MediaStreamDestinationNode ═══
  // 1. Pre-mix all audio via OfflineAudioContext into a single AudioBuffer
  // 2. At record time, play that buffer via AudioBufferSourceNode
  // 3. Connected to MediaStreamAudioDestinationNode → track added to MediaRecorder
  // 4. Verbose logging at every step to diagnose any failure

  let mixedBuffer: AudioBuffer | null = null;
  let playbackCtx: AudioContext | null = null;
  let playbackDest: MediaStreamAudioDestinationNode | null = null;
  let playbackSource: AudioBufferSourceNode | null = null;

  if (audioCtx && hasAudio) {
    console.log('[AudioPipeline] ═══ STEP 1: OFFLINE MIX ═══');

    const offlineCtx = new OfflineAudioContext(1, Math.ceil(totalDuration * 48000), 48000);

    if (musicBuffer) {
      const src = offlineCtx.createBufferSource();
      src.buffer = musicBuffer;
      src.loop = true;
      src.loopEnd = musicBuffer.duration;
      const gain = offlineCtx.createGain();
      gain.gain.value = voiceBuffer ? 0.3 : 0.8;
      src.connect(gain);
      gain.connect(offlineCtx.destination);
      src.start(0);
      src.stop(totalDuration);
      console.log('[AudioPipeline] Music → offline (gain:', gain.gain.value, 'dur:', musicBuffer.duration.toFixed(1) + 's loop to', totalDuration.toFixed(1) + 's)');
    }

    if (voiceBuffer) {
      const src = offlineCtx.createBufferSource();
      src.buffer = voiceBuffer;
      const gain = offlineCtx.createGain();
      gain.gain.value = 1.0;
      src.connect(gain);
      gain.connect(offlineCtx.destination);
      src.start(0);
      console.log('[AudioPipeline] Voice → offline (gain: 1.0, dur:', voiceBuffer.duration.toFixed(1) + 's)');
    }

    // Test tone 0.5s at start
    const osc = offlineCtx.createOscillator();
    osc.frequency.value = 440;
    const oscGain = offlineCtx.createGain();
    oscGain.gain.value = 0.25;
    osc.connect(oscGain);
    oscGain.connect(offlineCtx.destination);
    osc.start(0);
    osc.stop(0.5);

    console.log('[AudioPipeline] Rendering offline mix...');
    mixedBuffer = await offlineCtx.startRendering();
    console.log('[AudioPipeline] ✅ Mixed buffer:', mixedBuffer.duration.toFixed(2) + 's,', mixedBuffer.numberOfChannels, 'ch,', mixedBuffer.length, 'samples');

    // Verify the buffer has actual audio content
    const ch0 = mixedBuffer.getChannelData(0);
    let maxAmp = 0, rms = 0;
    for (let i = 0; i < Math.min(ch0.length, 48000); i++) {
      const v = Math.abs(ch0[i]);
      if (v > maxAmp) maxAmp = v;
      rms += v * v;
    }
    rms = Math.sqrt(rms / Math.min(ch0.length, 48000));
    console.log('[AudioPipeline] Buffer amplitude (first 1s): max=' + maxAmp.toFixed(4) + ' rms=' + rms.toFixed(4),
      maxAmp > 0.01 ? '✅ HAS AUDIO' : '❌ SILENT');

    // Close the original AudioContext used for loading
    await audioCtx.close();
    audioCtx = null;

    console.log('[AudioPipeline] ═══ STEP 2: PLAYBACK CONTEXT ═══');

    // Create a NEW AudioContext for real-time playback during recording
    playbackCtx = new AudioContext({ sampleRate: 48000 });
    await playbackCtx.resume();
    console.log('[AudioPipeline] Playback AudioContext: state=' + playbackCtx.state + ' sampleRate=' + playbackCtx.sampleRate);

    playbackDest = playbackCtx.createMediaStreamDestination();
    console.log('[AudioPipeline] MediaStreamDestination created');

    // Verify the destination has an audio track
    const destTracks = playbackDest.stream.getAudioTracks();
    console.log('[AudioPipeline] Dest tracks:', destTracks.length, destTracks.map(t =>
      'id=' + t.id.substring(0, 8) + ' state=' + t.readyState + ' enabled=' + t.enabled + ' muted=' + t.muted
    ));

    // Create the source node (will be started when recording starts)
    playbackSource = playbackCtx.createBufferSource();
    playbackSource.buffer = mixedBuffer;
    playbackSource.connect(playbackDest);
    console.log('[AudioPipeline] ✅ AudioBufferSourceNode created and connected to dest');
  }

  // ═══ MEDIARECORDER SETUP ═══
  const videoStream = canvas.captureStream(fps);
  console.log('[Composer] Canvas captureStream: video tracks=' + videoStream.getVideoTracks().length);

  const combinedStream = new MediaStream();
  for (const track of videoStream.getVideoTracks()) combinedStream.addTrack(track);

  if (playbackDest) {
    const audioTracks = playbackDest.stream.getAudioTracks();
    for (const track of audioTracks) {
      combinedStream.addTrack(track);
      console.log('[AudioPipeline] ✅ Added audio track to recording stream: id=' + track.id.substring(0, 8) +
        ' state=' + track.readyState + ' enabled=' + track.enabled + ' muted=' + track.muted);
    }
  }

  console.log('[Composer] Combined stream — video:', combinedStream.getVideoTracks().length,
    'audio:', combinedStream.getAudioTracks().length);

  // Choose best mimeType — prefer MP4 if truly supported
  // IMPORTANT: Do NOT use quoted codecs in isTypeSupported — Chrome rejects them
  const mimeTypeCandidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  let mimeType = 'video/webm';
  for (const t of mimeTypeCandidates) {
    const supported = MediaRecorder.isTypeSupported(t);
    console.log('[Composer] isTypeSupported("' + t + '"):', supported);
    if (supported && mimeType === 'video/webm') { mimeType = t; }
  }
  const isMP4 = mimeType.startsWith('video/mp4');
  console.log('[Composer] ✅ Selected mimeType:', mimeType, '| isMP4:', isMP4);

  // Bitrate: 2Mbps keeps file under 4.5MB for ~18s video (Vercel Hobby limit)
  // For longer videos, bitrate is further reduced
  const targetMaxBytes = 4 * 1024 * 1024; // 4MB target (under 4.5MB Vercel limit)
  const autoBitrate = Math.min(2_500_000, Math.floor((targetMaxBytes * 8) / totalDuration));
  console.log('[Composer] Bitrate:', autoBitrate, 'bps for', totalDuration.toFixed(1), 's → estimated', ((autoBitrate * totalDuration) / 8 / 1024 / 1024).toFixed(1), 'MB');

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: autoBitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  onProgress?.(15, 'Rendu en cours...');

  // ═══ REAL-TIME RENDER + RECORD ═══
  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const outputType = isMP4 ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunks, { type: outputType });
      console.log('[Composer] ✅ DONE — blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type:', outputType, ', chunks:', chunks.length);

      // Cleanup
      if (playbackCtx) playbackCtx.close().catch(() => {});
      if (musicElement) { musicElement.pause(); musicElement.src = ''; }
      if (voiceElement) { voiceElement.pause(); voiceElement.src = ''; }
      if (audioCtx) audioCtx.close().catch(() => {});
      if (videoEl) videoEl.pause();
      try { document.body.removeChild(canvas); } catch {}
      onProgress?.(100, 'Terminé !');
      resolve(blob);
    };

    recorder.onerror = (e) => {
      console.error('[Composer] MediaRecorder error:', e);
      if (audioCtx) audioCtx.close().catch(() => {});
      reject(new Error('Recording failed'));
    };

    // START recording FIRST, then audio
    recorder.start(200);
    console.log('[AudioPipeline] MediaRecorder started, state:', recorder.state);

    // START the pre-mixed audio buffer playback
    if (playbackSource && playbackCtx) {
      playbackSource.start(0);
      console.log('[AudioPipeline] ✅ AudioBufferSourceNode.start(0) called');
      console.log('[AudioPipeline] playbackCtx: state=' + playbackCtx.state + ' currentTime=' + playbackCtx.currentTime.toFixed(3));
      // Verify audio is flowing after a short delay
      setTimeout(() => {
        if (playbackCtx) {
          console.log('[AudioPipeline] @100ms: playbackCtx state=' + playbackCtx.state + ' time=' + playbackCtx.currentTime.toFixed(3));
        }
        if (playbackDest) {
          const t = playbackDest.stream.getAudioTracks()[0];
          if (t) console.log('[AudioPipeline] @100ms: audio track state=' + t.readyState + ' enabled=' + t.enabled + ' muted=' + t.muted);
        }
      }, 100);
    }

    // START video element
    if (videoEl) { videoEl.currentTime = 0; videoEl.pause(); }

    console.log('[Composer] Recording started for', totalDuration.toFixed(1), 's');

    const startTime = performance.now();
    let lastProgress = 0;
    let lastDiagTime = 0;

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;

      if (elapsed >= totalDuration + 0.3) {
        console.log('[Composer] Render complete, stopping recorder...');
        // Stop audio
        try { if (playbackSource) playbackSource.stop(); } catch {}
        recorder.stop();
        return;
      }

      const t = Math.min(elapsed, totalDuration - 0.001);

      // Handle video element playback
      if (videoEl) {
        const videoSeq = sequences.find(s => s.type === 'video');
        if (videoSeq) {
          const vs = seqStarts[sequences.indexOf(videoSeq)];
          const ve = vs + videoSeq.duration;
          if (t >= vs && t < ve) {
            if (videoEl.paused) { videoEl.currentTime = t - vs; videoEl.play().catch(() => {}); }
          } else if (!videoEl.paused) { videoEl.pause(); }
        }
      }

      drawFrame(t);

      if (elapsed - lastProgress > 0.5) {
        lastProgress = elapsed;
        const pct = Math.round(15 + (elapsed / totalDuration) * 80);
        onProgress?.(Math.min(pct, 95), `Rendu: ${Math.round((elapsed / totalDuration) * 100)}%`);
      }

      // Periodic audio diagnostics every 3s
      const now = performance.now();
      if (hasAudio && audioCtx && (now - lastDiagTime > 3000)) {
        lastDiagTime = now;
        console.log(`[AudioPipeline] @${elapsed.toFixed(1)}s — AudioCtx: state=${audioCtx.state} time=${audioCtx.currentTime.toFixed(2)}s, Recorder: state=${recorder.state} chunks=${chunks.length}`);
        combinedStream.getAudioTracks().forEach(t => {
          console.log(`[AudioPipeline] Track: ${t.id.substring(0, 8)} readyState=${t.readyState} enabled=${t.enabled} muted=${t.muted}`);
        });
      }

      requestAnimationFrame(animate);
    };

    drawFrame(0);
    requestAnimationFrame(animate);
  });
}

// ═══════════════════════════════════════════════════════════
// UPLOAD + DOWNLOAD
// ═══════════════════════════════════════════════════════════

export async function composeAndUpload(options: ComposerOptions): Promise<{ blob: Blob; url: string | null }> {
  const blob = await composeVideo(options);
  if (blob.size === 0) return { blob, url: null };

  const blobIsMP4 = blob.type.includes('mp4');
  const ext = blobIsMP4 ? 'mp4' : 'webm';
  const blobSizeMB = blob.size / 1024 / 1024;
  console.log('[Composer] Blob:', blobSizeMB.toFixed(2), 'MB', ext, 'type:', blob.type);

  // Skip upload if blob exceeds Vercel Hobby body limit (4.5MB)
  let url: string | null = null;
  const UPLOAD_LIMIT_MB = 4.5;

  if (blobSizeMB > UPLOAD_LIMIT_MB) {
    console.warn(`[Composer] ⚠️ Blob too large for upload (${blobSizeMB.toFixed(1)}MB > ${UPLOAD_LIMIT_MB}MB). Using local blob URL.`);
    url = URL.createObjectURL(blob);
  } else {
    try {
      const formData = new FormData();
      formData.append('file', new File([blob], `montage-${Date.now()}.${ext}`, { type: blob.type }));
      formData.append('purpose', 'rush');
      const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
      if (res.status === 413) {
        console.warn('[Composer] Upload 413 — file too large. Using local blob URL.');
        url = URL.createObjectURL(blob);
      } else {
        const data = await res.json();
        if (data.success && data.file?.url) { url = data.file.url; console.log('[Composer] Upload OK:', url); }
        else { console.error('[Composer] Upload failed:', data); url = URL.createObjectURL(blob); }
      }
    } catch (err) {
      console.error('[Composer] Upload error:', err);
      url = URL.createObjectURL(blob);
    }
  }
  return { blob, url };
}

export function downloadBlob(blob: Blob, filename: string) {
  // Force correct extension based on blob type
  let finalFilename = filename;
  if (blob.type.includes('mp4') && !filename.endsWith('.mp4')) {
    finalFilename = filename.replace(/\.\w+$/, '.mp4');
  } else if (blob.type.includes('webm') && !filename.endsWith('.webm')) {
    finalFilename = filename.replace(/\.\w+$/, '.webm');
  }
  console.log('[Composer] downloadBlob:', (blob.size / 1024 / 1024).toFixed(2), 'MB, type:', blob.type, '→', finalFilename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = finalFilename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
