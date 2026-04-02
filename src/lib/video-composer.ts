/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Uses <audio> elements + createMediaElementSource for GUARANTEED audio.
 * Audio elements handle MP3/OGG/WAV decoding natively (no OfflineAudioContext).
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

/** Load an <audio> element from a URL. Returns null on failure. */
async function loadAudioElement(src: string): Promise<HTMLAudioElement | null> {
  console.log('[Composer] Loading audio:', src.substring(0, 80));
  try {
    const audio = new Audio();
    // blob: URLs are same-origin, no CORS needed
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      audio.crossOrigin = 'anonymous';
    }
    audio.preload = 'auto';
    audio.volume = 1;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio load timeout')), 15000);
      audio.oncanplaythrough = () => { clearTimeout(timeout); resolve(); };
      audio.onerror = () => { clearTimeout(timeout); reject(new Error('Audio load error: ' + src.substring(0, 40))); };
      audio.src = src;
      audio.load();
    });

    console.log('[Composer] Audio loaded OK, duration:', audio.duration.toFixed(1), 's');
    return audio;
  } catch (err) {
    console.error('[Composer] Audio load FAILED:', (err as Error)?.message);

    // Fallback: try via proxy for remote URLs
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      try {
        const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(src)}`;
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Proxy timeout')), 15000);
          audio.oncanplaythrough = () => { clearTimeout(timeout); resolve(); };
          audio.onerror = () => { clearTimeout(timeout); reject(new Error('Proxy audio load error')); };
          audio.src = proxyUrl;
          audio.load();
        });
        console.log('[Composer] Audio loaded via proxy, duration:', audio.duration.toFixed(1), 's');
        return audio;
      } catch {
        console.error('[Composer] Audio proxy load also failed');
      }
    }
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
  ctx.font = `700 ${Math.round(w * 0.03)}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('INFORMATIONS', w / 2, h * 0.15);
  const cardH = Math.round(h * 0.095), cardW = Math.round(w * 0.88);
  const cardX = (w - cardW) / 2, startY = h * 0.21, gap = cardH * 1.25;
  cards.slice(0, 5).forEach((card, i) => {
    const cp = Math.max(0, Math.min(1, (progress - i * 0.12) * 4));
    if (cp <= 0) return;
    const y = startY + i * gap, slideX = cardX + (1 - cp) * (-w * 0.15);
    ctx.globalAlpha = cp;
    // Card background
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; drawRoundRect(ctx, slideX, y, cardW, cardH, 14); ctx.fill();
    // Left accent border
    ctx.fillStyle = card.color || accent; ctx.fillRect(slideX, y + 5, 4, cardH - 10);
    // Emoji (real emoji, large and visible)
    const emojiSize = Math.round(w * 0.06);
    ctx.font = `${emojiSize}px sans-serif`; ctx.textAlign = 'left';
    ctx.fillText(card.emoji || '●', slideX + 18, y + cardH * 0.62);
    // Label (bold, bigger)
    const labelX = slideX + 18 + emojiSize + 12;
    ctx.font = `700 ${Math.round(w * 0.032)}px sans-serif`; ctx.fillStyle = 'white'; ctx.textAlign = 'left';
    ctx.fillText(card.label.toUpperCase(), labelX, y + cardH * 0.42);
    // Sublabel if value has description
    ctx.font = `400 ${Math.round(w * 0.022)}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(card.label !== card.value ? '' : '', labelX, y + cardH * 0.68);
    // Value (large, glowing)
    ctx.font = `800 ${Math.round(w * 0.048)}px sans-serif`; ctx.textAlign = 'right'; ctx.fillStyle = 'white';
    ctx.shadowColor = accent; ctx.shadowBlur = 12;
    ctx.fillText(card.value, slideX + cardW - 20, y + cardH * 0.65); ctx.shadowBlur = 0;
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
// MAIN COMPOSER — MediaRecorder + <audio> elements
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

  console.log('[Composer] === START ===');
  console.log('[Composer] Music:', musicUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Voice:', voiceUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Logo:', logoUrl?.substring(0, 60) || 'NONE');

  onProgress?.(2, 'Chargement des médias...');

  // Load visual media
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch(() => null) : null,
    logoUrl ? loadImage(logoUrl).catch(() => null) : null,
    videoUrl ? loadVideo(videoUrl).catch(() => null) : null,
  ]);

  // Load audio elements (using native <audio> — handles MP3/OGG/WAV automatically)
  const [musicEl, voiceEl] = await Promise.all([
    musicUrl ? loadAudioElement(musicUrl) : null,
    voiceUrl ? loadAudioElement(voiceUrl) : null,
  ]);

  const hasAudio = musicEl !== null || voiceEl !== null;
  console.log('[Composer] Media loaded — poster:', !!posterImg, 'logo:', !!logoImg, 'video:', !!videoEl);
  console.log('[Composer] Audio loaded — music:', !!musicEl, 'voice:', !!voiceEl);

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

  // ═══ AUDIO SETUP: Use <audio> elements + createMediaElementSource ═══
  // This is the SIMPLEST, MOST RELIABLE approach:
  // <audio> elements decode audio natively (MP3/OGG/WAV)
  // createMediaElementSource routes audio through Web Audio API
  // MediaStreamDestination captures it for MediaRecorder
  // Audio does NOT play through speakers (redirected from default output)

  let audioCtx: AudioContext | null = null;
  let audioDest: MediaStreamAudioDestinationNode | null = null;

  if (hasAudio) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    await audioCtx.resume();
    console.log('[Composer] AudioContext state:', audioCtx.state);

    audioDest = audioCtx.createMediaStreamDestination();

    if (musicEl) {
      try {
        const musicSource = audioCtx.createMediaElementSource(musicEl);
        const musicGain = audioCtx.createGain();
        musicGain.gain.value = voiceEl ? 0.3 : 0.8;
        musicSource.connect(musicGain);
        musicGain.connect(audioDest);
        musicEl.loop = true;
        console.log('[Composer] ✅ Music connected to audio graph, gain:', musicGain.gain.value);
      } catch (err) {
        console.error('[Composer] ❌ Music audio graph setup failed:', err);
      }
    }

    if (voiceEl) {
      try {
        const voiceSource = audioCtx.createMediaElementSource(voiceEl);
        const voiceGain = audioCtx.createGain();
        voiceGain.gain.value = 1.0;
        voiceSource.connect(voiceGain);
        voiceGain.connect(audioDest);
        console.log('[Composer] ✅ Voice connected to audio graph');
      } catch (err) {
        console.error('[Composer] ❌ Voice audio graph setup failed:', err);
      }
    }
  }

  // ═══ MEDIARECORDER SETUP ═══
  const videoStream = canvas.captureStream(fps);

  // Combine video + audio into one MediaStream
  const combinedStream = new MediaStream();
  for (const track of videoStream.getVideoTracks()) combinedStream.addTrack(track);
  if (audioDest) {
    for (const track of audioDest.stream.getAudioTracks()) combinedStream.addTrack(track);
  }

  console.log('[Composer] Stream tracks:', combinedStream.getTracks().map(t => t.kind + ':' + t.readyState).join(', '));

  // Choose best mimeType — prefer MP4!
  const mimeTypes = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  let mimeType = 'video/webm';
  for (const t of mimeTypes) {
    if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }
  const isMP4 = mimeType.startsWith('video/mp4');
  console.log('[Composer] MediaRecorder mimeType:', mimeType, '| MP4:', isMP4);

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  onProgress?.(15, 'Rendu en cours...');

  // ═══ REAL-TIME RENDER + RECORD ═══
  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const outputType = isMP4 ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunks, { type: outputType });
      console.log('[Composer] ✅ DONE — blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type:', outputType, ', chunks:', chunks.length);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (musicEl) { musicEl.pause(); musicEl.src = ''; }
      if (voiceEl) { voiceEl.pause(); voiceEl.src = ''; }
      if (videoEl) videoEl.pause();
      try { document.body.removeChild(canvas); } catch {}
      onProgress?.(100, 'Terminé !');
      resolve(blob);
    };

    recorder.onerror = (e) => {
      console.error('[Composer] MediaRecorder error:', e);
      reject(new Error('Recording failed'));
    };

    // START recording
    recorder.start(200);

    // START audio playback (through MediaStreamDestination, NOT speakers)
    if (musicEl) {
      musicEl.currentTime = 0;
      musicEl.play().then(() => console.log('[Composer] ✅ Music playing')).catch(err => console.error('[Composer] ❌ Music play failed:', err));
    }
    if (voiceEl) {
      voiceEl.currentTime = 0;
      voiceEl.play().then(() => console.log('[Composer] ✅ Voice playing')).catch(err => console.error('[Composer] ❌ Voice play failed:', err));
    }

    // START video element
    if (videoEl) { videoEl.currentTime = 0; videoEl.pause(); }

    console.log('[Composer] Recording started for', totalDuration.toFixed(1), 's');

    const startTime = performance.now();
    let lastProgress = 0;

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;

      if (elapsed >= totalDuration + 0.3) {
        console.log('[Composer] Render done, stopping recorder');
        if (musicEl) musicEl.pause();
        if (voiceEl) voiceEl.pause();
        recorder.stop();
        return;
      }

      const t = Math.min(elapsed, totalDuration - 0.001);

      // Handle video element
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

  const isMP4 = blob.type.includes('mp4');
  const ext = isMP4 ? 'mp4' : 'webm';
  console.log('[Composer] Uploading', (blob.size / 1024 / 1024).toFixed(2), 'MB', ext);

  let url: string | null = null;
  try {
    const formData = new FormData();
    formData.append('file', new File([blob], `montage-${Date.now()}.${ext}`, { type: blob.type }));
    formData.append('purpose', 'rush');
    const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success && data.file?.url) { url = data.file.url; console.log('[Composer] Upload OK:', url); }
    else console.error('[Composer] Upload failed:', data);
  } catch (err) { console.error('[Composer] Upload error:', err); }
  return { blob, url };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
