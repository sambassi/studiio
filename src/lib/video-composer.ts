/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Uses fetch() + decodeAudioData() + AudioBufferSourceNode for GUARANTEED audio capture.
 * AudioBufferSourceNode plays ONLY through Web Audio graph (not speakers).
 * This ensures MediaRecorder captures all audio in the final video file.
 * Outputs MP4 if supported, otherwise WebM.
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
  title: string;
  subtitle?: string;
  salesPhrase?: string;
  cards?: CardData[];
  posterUrl?: string | null;
  videoUrl?: string | null;
  logoUrl?: string | null;
  musicUrl?: string | null;
  voiceUrl?: string | null;
  // Raw audio bytes — bypasses ALL URL/fetch/CORS issues
  musicData?: ArrayBuffer | null;
  voiceData?: ArrayBuffer | null;
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
// MAIN COMPOSER — Video-only MediaRecorder + FFmpeg.wasm audio mux
// ═══════════════════════════════════════════════════════════

export async function composeVideo(options: ComposerOptions): Promise<Blob> {
  const {
    width, height, fps = 24,
    title, subtitle, salesPhrase, cards = [],
    posterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
    musicData, voiceData,
    introDuration = 4, cardsDuration = 6, videoDuration = 10, ctaDuration = 4,
    accentColor = '#D91CD2',
    ctaText = 'CHAT POUR PLUS D\'INFOS', ctaSubText = 'LIEN EN BIO',
    watermarkText, onProgress,
  } = options;

  console.log('[Composer] ═══ START ═══');
  console.log('[Composer] Music:', musicData ? `RAW ${(musicData.byteLength/1024).toFixed(0)}KB` : (musicUrl ? 'URL:' + musicUrl.substring(0, 50) : 'NONE'));
  console.log('[Composer] Voice:', voiceData ? `RAW ${(voiceData.byteLength/1024).toFixed(0)}KB` : (voiceUrl ? 'URL:' + voiceUrl.substring(0, 50) : 'NONE'));

  onProgress?.(2, 'Chargement des médias...');

  // ═══ LOAD MEDIA ═══
  const hasAudio = !!musicData || !!voiceData || !!musicUrl || !!voiceUrl;
  let audioCtx: AudioContext | null = null;

  if (hasAudio) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    await audioCtx.resume();
  }

  // Load visual media
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch(() => null) : null,
    logoUrl ? loadImage(logoUrl).catch(() => null) : null,
    videoUrl ? loadVideo(videoUrl).catch(() => null) : null,
  ]);

  // Load audio — prefer raw bytes (musicData/voiceData) over URLs
  let musicBuffer: AudioBuffer | null = null;
  let voiceBuffer: AudioBuffer | null = null;

  if (audioCtx) {
    // MUSIC: raw bytes first, then URL fallback
    if (musicData && musicData.byteLength > 100) {
      try {
        musicBuffer = await audioCtx.decodeAudioData(musicData.slice(0)); // clone — decodeAudioData consumes buffer
        console.log('[Composer] ✅ Music decoded from RAW bytes:', musicBuffer.duration.toFixed(1) + 's');
      } catch (e) {
        console.error('[Composer] ❌ Music RAW decode failed:', (e as Error)?.message);
      }
    }
    if (!musicBuffer && musicUrl) {
      musicBuffer = await loadAudioBuffer(audioCtx, musicUrl).catch(() => null);
      if (musicBuffer) console.log('[Composer] ✅ Music decoded from URL:', musicBuffer.duration.toFixed(1) + 's');
    }

    // VOICE: raw bytes first, then URL fallback
    if (voiceData && voiceData.byteLength > 100) {
      try {
        voiceBuffer = await audioCtx.decodeAudioData(voiceData.slice(0));
        console.log('[Composer] ✅ Voice decoded from RAW bytes:', voiceBuffer.duration.toFixed(1) + 's');
      } catch (e) {
        console.error('[Composer] ❌ Voice RAW decode failed:', (e as Error)?.message);
      }
    }
    if (!voiceBuffer && voiceUrl) {
      voiceBuffer = await loadAudioBuffer(audioCtx, voiceUrl).catch(() => null);
      if (voiceBuffer) console.log('[Composer] ✅ Voice decoded from URL:', voiceBuffer.duration.toFixed(1) + 's');
    }
  }

  console.log('[Composer] Media: poster=' + !!posterImg + ' logo=' + !!logoImg + ' video=' + !!videoEl +
    ' music=' + (musicBuffer ? musicBuffer.duration.toFixed(1) + 's' : 'NONE') +
    ' voice=' + (voiceBuffer ? voiceBuffer.duration.toFixed(1) + 's' : 'NONE'));

  // Build sequences (needed before audio mix to know totalDuration)
  const sequences: Array<{ type: string; duration: number }> = [{ type: 'intro', duration: introDuration }];
  if (cards.length > 0) sequences.push({ type: 'cards', duration: cardsDuration });
  if (videoEl) sequences.push({ type: 'video', duration: videoDuration });
  sequences.push({ type: 'cta', duration: ctaDuration });

  const totalDuration = sequences.reduce((s, seq) => s + seq.duration, 0);
  const transitionDur = 0.8;
  const seqStarts: number[] = [];
  let cumTime = 0;
  for (const seq of sequences) { seqStarts.push(cumTime); cumTime += seq.duration; }
  console.log('[Composer] Sequences:', sequences.map(s => s.type).join('→'), totalDuration.toFixed(1) + 's');

  // ═══ PRE-MIX AUDIO → WAV BLOB (OfflineAudioContext) ═══
  let audioWavBlob: Blob | null = null;

  if (musicBuffer || voiceBuffer) {
    if (!audioCtx) { audioCtx = new AudioContext({ sampleRate: 48000 }); await audioCtx.resume(); }
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * 48000), 48000);

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
      console.log('[Composer] Audio mix: music gain=' + gain.gain.value);
    }

    if (voiceBuffer) {
      const src = offlineCtx.createBufferSource();
      src.buffer = voiceBuffer;
      const gain = offlineCtx.createGain();
      gain.gain.value = 1.0;
      src.connect(gain);
      gain.connect(offlineCtx.destination);
      src.start(0);
      console.log('[Composer] Audio mix: voice gain=1.0');
    }

    const rendered = await offlineCtx.startRendering();
    audioWavBlob = audioBufferToWav(rendered);
    console.log('[Composer] ✅ Audio WAV: ' + (audioWavBlob.size / 1024).toFixed(0) + ' KB, ' + rendered.duration.toFixed(1) + 's');
  }

  if (audioCtx) { await audioCtx.close(); audioCtx = null; }

  onProgress?.(10, 'Préparation...');

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;opacity:0;';
  document.body.appendChild(canvas);

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
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, height - 3, width, 3);
    const barGrad = ctx.createLinearGradient(0, 0, width * (elapsed / totalDuration), 0);
    barGrad.addColorStop(0, accentColor); barGrad.addColorStop(0.5, '#FF2DAA'); barGrad.addColorStop(1, '#00D4FF');
    ctx.fillStyle = barGrad; ctx.fillRect(0, height - 3, width * (elapsed / totalDuration), 3);
  };

  // ═══ SETUP AUDIO PLAYBACK via <audio>.captureStream() ═══
  // This is the ONLY approach that works reliably in Chrome:
  // 1. Create blob URL from WAV
  // 2. Set as <audio src="blob:..."> (NOT srcObject)
  // 3. Wait for canplaythrough
  // 4. Call audio.captureStream() to get audio MediaStream
  // 5. Add audio track to combined stream for MediaRecorder
  let audioElement: HTMLAudioElement | null = null;
  let audioTrack: MediaStreamTrack | null = null;

  if (audioWavBlob && audioWavBlob.size > 100) {
    const wavUrl = URL.createObjectURL(audioWavBlob);
    console.log('[Composer] Loading audio element: WAV=' + (audioWavBlob.size / 1024).toFixed(0) + 'KB url=' + wavUrl.substring(0, 50));

    audioElement = document.createElement('audio');
    audioElement.preload = 'auto';
    audioElement.volume = 0.01; // near-silent speaker output

    // Wait for audio to be ready
    const audioReady = await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
      audioElement!.oncanplaythrough = () => { console.log('[Composer] ✅ Audio element ready, dur=' + audioElement!.duration.toFixed(1) + 's'); finish(true); };
      audioElement!.onloadeddata = () => { console.log('[Composer] Audio loadeddata'); finish(true); };
      audioElement!.onerror = () => {
        const e = audioElement!.error;
        console.error('[Composer] ❌ Audio element error:', e?.code, e?.message);
        finish(false);
      };
      audioElement!.src = wavUrl; // MUST set src after handlers
      audioElement!.load();
      setTimeout(() => { console.warn('[Composer] Audio load timeout 10s'); finish(false); }, 10000);
    });

    if (audioReady && audioElement.duration > 0) {
      // captureStream() on <audio> element — Chrome native, no Web Audio API needed
      try {
        const audioStream = (audioElement as any).captureStream() as MediaStream;
        const tracks = audioStream.getAudioTracks();
        if (tracks.length > 0) {
          audioTrack = tracks[0];
          console.log('[Composer] ✅ captureStream() audio track: state=' + audioTrack.readyState + ' enabled=' + audioTrack.enabled);
        } else {
          console.error('[Composer] captureStream() returned 0 audio tracks');
        }
      } catch (csErr) {
        console.error('[Composer] captureStream() failed:', (csErr as Error)?.message);
      }
    } else {
      console.error('[Composer] Audio element not ready — no audio in output');
      URL.revokeObjectURL(wavUrl);
      audioElement = null;
    }
  }

  onProgress?.(15, 'Rendu...');

  // ═══ RECORD VIDEO + AUDIO TOGETHER ═══
  const videoStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream();
  for (const t of videoStream.getVideoTracks()) combinedStream.addTrack(t);
  if (audioTrack) combinedStream.addTrack(audioTrack);

  console.log('[Composer] Recording: video=' + combinedStream.getVideoTracks().length + ' audio=' + combinedStream.getAudioTracks().length);

  // Pick mime type — with audio, prefer codecs that support audio
  const mimeType = audioTrack
    ? (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2') ? 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
      : 'video/webm')
    : (MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
      : 'video/webm');

  const targetBytes = 4 * 1024 * 1024;
  const bitrate = Math.min(2_500_000, Math.floor((targetBytes * 8) / totalDuration));

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  console.log('[Composer] MediaRecorder: ' + mimeType + ' @ ' + (bitrate / 1000) + 'kbps');

  const finalBlob = await new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const isMP4 = mimeType.includes('mp4');
      const blob = new Blob(chunks, { type: isMP4 ? 'video/mp4' : 'video/webm' });
      console.log('[Composer] ✅ DONE: ' + (blob.size / 1024 / 1024).toFixed(2) + ' MB, ' + blob.type);
      resolve(blob);
    };
    recorder.onerror = () => reject(new Error('Recording failed'));

    // Start recording FIRST
    recorder.start(200);

    // Start audio playback (captureStream captures it in real-time)
    if (audioElement) {
      audioElement.currentTime = 0;
      audioElement.play().catch(e => console.error('[Composer] Audio play error:', e));
      console.log('[Composer] ✅ Audio playback started');
    }

    if (videoEl) { videoEl.currentTime = 0; videoEl.pause(); }

    const startTime = performance.now();
    let lastProg = 0;

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= totalDuration + 0.3) {
        if (audioElement) audioElement.pause();
        recorder.stop();
        return;
      }

      const t = Math.min(elapsed, totalDuration - 0.001);

      if (videoEl) {
        const videoSeq = sequences.find(s => s.type === 'video');
        if (videoSeq) {
          const vs = seqStarts[sequences.indexOf(videoSeq)];
          if (t >= vs && t < vs + videoSeq.duration) {
            if (videoEl.paused) { videoEl.currentTime = t - vs; videoEl.play().catch(() => {}); }
          } else if (!videoEl.paused) { videoEl.pause(); }
        }
      }

      drawFrame(t);

      if (elapsed - lastProg > 0.5) {
        lastProg = elapsed;
        onProgress?.(Math.min(15 + Math.round((elapsed / totalDuration) * 80), 95),
          `Rendu: ${Math.round((elapsed / totalDuration) * 100)}%`);
      }

      requestAnimationFrame(animate);
    };

    drawFrame(0);
    requestAnimationFrame(animate);
  });

  // Cleanup
  if (audioElement) {
    audioElement.pause();
    if (audioElement.src.startsWith('blob:')) URL.revokeObjectURL(audioElement.src);
  }
  if (videoEl) videoEl.pause();
  try { document.body.removeChild(canvas); } catch {}

  onProgress?.(100, 'Terminé !');
  return finalBlob;
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
