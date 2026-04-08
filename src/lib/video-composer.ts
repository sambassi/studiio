/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Uses <audio> elements + createMediaElementSource for GUARANTEED audio.
 * Audio elements handle MP3/OGG/WAV decoding natively (no OfflineAudioContext).
 * Outputs MP4 if supported, otherwise WebM.
 */

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

// Extend MediaStreamTrack for canvas capture manual frame requests
interface CanvasCaptureMediaStreamTrack extends MediaStreamTrack {
  requestFrame(): void;
}

export interface CardData {
  emoji: string;
  label: string;
  value: string;
  color?: string;
}

export interface SiteTextConfig {
  text: string;
  color?: string;
  opacity?: number;
  size?: number;
  /** Sequences where siteText is visible — e.g. ['intro', 'cards', 'video', 'cta'] */
  sequences?: string[];
  enabled?: boolean;
}

/** Design settings matching the HTML preview — ensures published video looks identical */
export interface DesignOptions {
  /** Font family name (e.g. 'Anton', 'Syne', 'Poppins') — will be loaded via document.fonts */
  font?: string;
  /** Title text color (default: #FFFFFF) */
  titleColor?: string;
  /** Primary gradient color (default: accentColor) */
  gradientColor1?: string;
  /** Secondary gradient color (default: accentColor lighter) */
  gradientColor2?: string;
  /** Gradient opacity 0-1 (default: 0.3) */
  gradientOpacity?: number;
  /** CTA sub-text color (default: #FFFFFF) */
  ctaSubColor?: string;
  /** Logo sequences — which sequences show the logo (e.g. ['intro','cards','video','cta']) */
  logoSequences?: string[];
  /** Logo position override {x: 0-100, y: 0-100} */
  logoPosition?: { x?: number; y?: number };
  /** Video overlay text */
  overlayText?: string;
  /** Video overlay color */
  overlayColor?: string;
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
  /** Flexible site text overlay (e.g. Afroboost.com) */
  siteText?: SiteTextConfig;
  /** Design options to match HTML preview styling */
  design?: DesignOptions;
  onProgress?: (percent: number, stage: string) => void;
  /** Shared AudioContext for batch mode — avoids creating/closing multiple contexts */
  sharedAudioCtx?: AudioContext;
  /** Pre-decoded audio buffers for batch mode — more reliable than <audio> elements */
  musicBuffer?: AudioBuffer;
  voiceBuffer?: AudioBuffer;
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

/** Draw text with a dark outline for better readability on any background */
function fillTextWithOutline(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  outlineWidth: number = 3, outlineColor: string = 'rgba(0,0,0,0.8)'
) {
  ctx.save();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outlineWidth;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Draw a logo image as-is (no background, no clip — just the image) */
function drawLogo(ctx: CanvasRenderingContext2D, logoImg: HTMLImageElement, x: number, y: number, size: number) {
  ctx.drawImage(logoImg, x, y, size, size);
}

// ═══════════════════════════════════════════════════════════
// SEQUENCE RENDERERS
// ═══════════════════════════════════════════════════════════

function drawIntro(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  posterImg: HTMLImageElement | null, logoImg: HTMLImageElement | null,
  title: string, subtitle: string | undefined, accent: string, progress: number,
  design?: DesignOptions
) {
  const fontFamily = design?.font || 'sans-serif';
  const titleColor = design?.titleColor || '#FFFFFF';
  const grad1 = design?.gradientColor1 || accent;
  const grad2 = design?.gradientColor2 || accent;
  const gradOpacity = design?.gradientOpacity ?? 0.3;

  // Background: poster image or dark gradient
  if (posterImg) {
    const scale = Math.max(w / posterImg.width, h / posterImg.height);
    const sw = posterImg.width * scale, sh = posterImg.height * scale;
    ctx.drawImage(posterImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
    // Bottom-up gradient matching preview: gradient(to top, grad1 at opacity, grad2 at 40%, transparent at 65%)
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, hexToRgba(grad1, gradOpacity));
    grad.addColorStop(0.4, hexToRgba(grad2, gradOpacity * 0.4));
    grad.addColorStop(0.65, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#000000'); grad.addColorStop(1, hexToRgba(grad1, 1));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  }

  // Title at BOTTOM (flex-end with paddingBottom 15%) — matches audio-studio preview
  // Sizes match HTML clamp(): title=7cqw, subtitle=4.5cqw
  const titleAlpha = Math.min(1, progress * 3);
  const fontSize = Math.round(w * 0.07); // 7cqw → 76px at 1080w
  const subFontSize = Math.round(w * 0.045); // 4.5cqw → 49px at 1080w

  // Position: 85% from top (= 15% padding from bottom, like flex-end + paddingBottom 15%)
  const titleY = h * 0.85;

  ctx.save();
  ctx.font = `900 ${fontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = hexToRgba(titleColor, titleAlpha);
  ctx.shadowColor = hexToRgba(accent, 0.8); ctx.shadowBlur = Math.round(w * 0.02);
  fillTextWithOutline(ctx, title.toUpperCase(), w / 2, titleY, Math.round(w * 0.004), 'rgba(0,0,0,0.9)');
  ctx.shadowBlur = 0;

  // Subtitle below title
  if (subtitle) {
    const subAlpha = Math.max(0, Math.min(1, (progress - 0.2) * 3));
    ctx.font = `400 ${subFontSize}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = hexToRgba(titleColor, subAlpha * 0.8);
    ctx.shadowColor = hexToRgba(accent, 0.5); ctx.shadowBlur = Math.round(w * 0.006);
    fillTextWithOutline(ctx, subtitle, w / 2, titleY + fontSize * 0.7, 2, 'rgba(0,0,0,0.7)');
    ctx.shadowBlur = 0;
  }

  // Accent line below title — gradient line like preview
  const lineAlpha = Math.max(0, Math.min(1, (progress - 0.3) * 3));
  const lineW = w * 0.15;
  const lineY = titleY + fontSize * (subtitle ? 1.0 : 0.5);
  const lineGrad = ctx.createLinearGradient(w / 2 - lineW / 2, 0, w / 2 + lineW / 2, 0);
  lineGrad.addColorStop(0, 'rgba(0,0,0,0)');
  lineGrad.addColorStop(0.5, hexToRgba(accent, lineAlpha));
  lineGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(w / 2 - lineW / 2, lineY);
  ctx.lineTo(w / 2 + lineW / 2, lineY); ctx.stroke();

  // Logo on intro if configured
  if (logoImg && design?.logoSequences?.includes('intro')) {
    const logoSize = Math.round(w * 0.12); // 12cqw like preview
    const lx = ((design.logoPosition?.x ?? 50) / 100) * w - logoSize / 2;
    const ly = ((design.logoPosition?.y ?? 85) / 100) * h - logoSize / 2;
    drawLogo(ctx, logoImg, lx, ly, logoSize);
  }

  // Bottom accent bar
  const barGrad = ctx.createLinearGradient(0, 0, w, 0);
  barGrad.addColorStop(0, grad1); barGrad.addColorStop(1, grad2);
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, h - 4, w, 4);

  ctx.restore();
}

function drawCards(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  cards: CardData[], logoImg: HTMLImageElement | null, accent: string, progress: number,
  design?: DesignOptions
) {
  const fontFamily = design?.font || 'sans-serif';
  const grad1 = design?.gradientColor1 || accent;
  const grad2 = design?.gradientColor2 || accent;

  // Background gradient matching preview: gradient(to bottom, grad1 at 0.9, grad2 at 0.7, #000)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexToRgba(grad1, 0.9));
  grad.addColorStop(0.5, hexToRgba(grad2, 0.7));
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

  // Cards centered vertically — sizes match HTML preview cqw proportions
  // HTML: emoji=5cqw, label=4cqw, value=4.5cqw
  const maxCards = Math.min(cards.length, 5);
  const cardH = Math.round(h * 0.07); // slightly smaller cards for better spacing
  const cardW = Math.round(w * 0.92); // wider cards
  const gap = Math.round(h * 0.012);
  const totalCardsH = maxCards * cardH + (maxCards - 1) * gap;
  const startY = (h - totalCardsH) / 2;
  const cardX = (w - cardW) / 2;

  const emojiSize = Math.round(w * 0.05);   // 5cqw → 54px at 1080w
  const labelSize = Math.round(w * 0.04);   // 4cqw → 43px at 1080w
  const valueSize = Math.round(w * 0.045);  // 4.5cqw → 49px at 1080w
  const borderW = Math.round(w * 0.004);    // proportional border

  cards.slice(0, 5).forEach((card, i) => {
    const rawCp = Math.max(0, Math.min(1, (progress - i * 0.08) * 3.5));
    if (rawCp <= 0) return;
    const cp = 1 - Math.pow(1 - rawCp, 3);
    const y = startY + i * (cardH + gap);
    const slideX = cardX + (1 - cp) * (-w * 0.12);
    ctx.globalAlpha = cp;

    // Card background — rgba(0,0,0,0.3) with backdrop effect
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; drawRoundRect(ctx, slideX, y, cardW, cardH, Math.round(w * 0.012)); ctx.fill();
    // Left accent border
    const cardColor = card.color || accent;
    ctx.fillStyle = cardColor;
    ctx.fillRect(slideX, y + Math.round(cardH * 0.12), borderW, cardH - Math.round(cardH * 0.24));

    // Emoji — large and readable
    const emojiX = slideX + Math.round(w * 0.025);
    ctx.font = `${emojiSize}px sans-serif`; ctx.textAlign = 'left';
    ctx.fillStyle = 'white';
    ctx.fillText(card.emoji || '●', emojiX, y + cardH * 0.65);

    // Label — user font, white, 600 weight, 4cqw
    const labelX = emojiX + emojiSize + Math.round(w * 0.015);
    ctx.font = `600 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left';
    fillTextWithOutline(ctx, card.label, labelX, y + cardH * 0.58, 2, 'rgba(0,0,0,0.5)');

    // Value — user font, card.color or accent (matches preview), 800 weight, 4.5cqw
    ctx.font = `800 ${valueSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'right';
    ctx.fillStyle = cardColor;
    fillTextWithOutline(ctx, card.value, slideX + cardW - Math.round(w * 0.025), y + cardH * 0.62, 2, 'rgba(0,0,0,0.6)');
    ctx.globalAlpha = 1;
  });

  // Logo on cards if configured
  if (logoImg && design?.logoSequences?.includes('cards')) {
    const logoSize = Math.round(w * 0.12); // 12cqw like preview
    const lx = ((design.logoPosition?.x ?? 50) / 100) * w - logoSize / 2;
    const ly = ((design.logoPosition?.y ?? 85) / 100) * h - logoSize / 2;
    drawLogo(ctx, logoImg, lx, ly, logoSize);
  }
}

function drawVideoSeq(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  videoEl: HTMLVideoElement | null, logoImg: HTMLImageElement | null, _progress: number,
  design?: DesignOptions
) {
  const fontFamily = design?.font || 'sans-serif';
  if (videoEl) {
    const scale = Math.max(w / videoEl.videoWidth, h / videoEl.videoHeight);
    ctx.drawImage(videoEl, (w - videoEl.videoWidth * scale) / 2, (h - videoEl.videoHeight * scale) / 2, videoEl.videoWidth * scale, videoEl.videoHeight * scale);
  } else {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
    ctx.font = `400 ${Math.round(w * 0.04)}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillText('Vidéo', w / 2, h / 2);
  }
  // Video overlay text if configured
  if (design?.overlayText) {
    ctx.save();
    ctx.font = `700 ${Math.round(w * 0.06)}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center'; // 6cqw
    ctx.fillStyle = design.overlayColor || '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 12;
    fillTextWithOutline(ctx, design.overlayText.toUpperCase(), w / 2, h / 2, 3, 'rgba(0,0,0,0.7)');
    ctx.restore();
  }
  // Logo on video if configured
  if (logoImg && design?.logoSequences?.includes('video')) {
    const logoSize = Math.round(w * 0.1);
    const lx = ((design.logoPosition?.x ?? 50) / 100) * w - logoSize / 2;
    const ly = ((design.logoPosition?.y ?? 85) / 100) * h - logoSize / 2;
    drawLogo(ctx, logoImg, lx, ly, logoSize);
  }
}

function drawCTA(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  accent: string, ctaText: string, ctaSubText: string,
  salesPhrase: string | undefined, watermark: string | undefined,
  logoImg: HTMLImageElement | null, progress: number,
  design?: DesignOptions
) {
  const fontFamily = design?.font || 'sans-serif';
  const ctaSubColor = design?.ctaSubColor || '#FFFFFF';

  // CTA: black background — matches preview
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
  const scale = 0.92 + Math.min(1, progress * 3) * 0.08;
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(scale, scale); ctx.translate(-w / 2, -h / 2);

  // Sizes match HTML preview cqw: salesPhrase=4cqw, ctaText=8cqw, subText=5cqw
  const ctaFontSize = Math.round(w * 0.08);   // 8cqw → 86px at 1080w
  const salesFontSize = Math.round(w * 0.04);  // 4cqw → 43px at 1080w
  const subFontSize = Math.round(w * 0.05);    // 5cqw → 54px at 1080w

  // Word-wrap CTA text
  ctx.font = `900 ${ctaFontSize}px "${fontFamily}", sans-serif`;
  const ctaWords = ctaText.toUpperCase().split(' ');
  let ctaLines: string[] = [];
  let currentLine = '';
  for (const word of ctaWords) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (ctx.measureText(testLine).width > w * 0.85 && currentLine) {
      ctaLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) ctaLines.push(currentLine);

  // Measure total block height for centering
  let blockH = 0;
  if (salesPhrase) blockH += salesFontSize * 1.5;
  blockH += ctaLines.length * ctaFontSize * 1.2;
  blockH += subFontSize * 1.5;

  let curY = (h - blockH) / 2 + ctaFontSize * 0.5;

  // Sales phrase — accent color with transparency (matches preview: ctaColor + ee)
  if (salesPhrase) {
    ctx.font = `900 ${salesFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = hexToRgba(accent, 0.93);
    ctx.fillText(salesPhrase, w / 2, curY);
    curY += salesFontSize * 1.5;
  }

  // Main CTA text — accent color, large, bold (matches preview)
  ctaLines.forEach((line, i) => {
    ctx.font = `900 ${ctaFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.shadowColor = hexToRgba(accent, 0.4); ctx.shadowBlur = Math.round(w * 0.02);
    ctx.fillText(line, w / 2, curY + i * (ctaFontSize * 1.2));
  });
  ctx.shadowBlur = 0;
  curY += ctaLines.length * ctaFontSize * 1.2;

  // Sub-text — user-configured color, 900 weight (matches preview)
  ctx.font = `900 ${subFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = ctaSubColor;
  ctx.fillText(ctaSubText.toUpperCase(), w / 2, curY + subFontSize * 0.3);

  // Logo on CTA if configured
  if (logoImg && (!design?.logoSequences || design.logoSequences.includes('cta'))) {
    const logoSize = Math.round(w * 0.12); // 12cqw like preview
    const lx = ((design?.logoPosition?.x ?? 50) / 100) * w - logoSize / 2;
    const ly = ((design?.logoPosition?.y ?? 85) / 100) * h - logoSize / 2;
    drawLogo(ctx, logoImg, lx, ly, logoSize);
  }

  // Watermark
  if (watermark) {
    ctx.font = `700 ${Math.round(w * 0.025)}px "${fontFamily}", sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    ctx.fillText(watermark, w / 2, h * 0.92);
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
    width, height, fps = 30,
    title, subtitle, salesPhrase, cards = [],
    posterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
    introDuration = 4, cardsDuration = 6, videoDuration = 10, ctaDuration = 4,
    accentColor = '#D91CD2',
    ctaText = 'CHAT POUR PLUS D\'INFOS', ctaSubText = 'LIEN EN BIO',
    watermarkText, siteText, design, onProgress,
  } = options;

  console.log('[Composer] === START ===');
  console.log('[Composer] Music:', musicUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Voice:', voiceUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Logo:', logoUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Design:', design ? JSON.stringify({ font: design.font, titleColor: design.titleColor, grad1: design.gradientColor1 }) : 'NONE');

  onProgress?.(2, 'Chargement des médias...');

  // Ensure the design font is loaded before rendering (Canvas needs fonts in document.fonts)
  if (design?.font && design.font !== 'sans-serif') {
    try {
      // Google Fonts URL for common fonts used in the app
      const FONT_URLS: Record<string, string> = {
        'Anton': 'https://fonts.googleapis.com/css2?family=Anton&display=swap',
        'Syne': 'https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap',
        'Bebas Neue': 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
        'Poppins': 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap',
        'Space Grotesk': 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap',
      };
      const fontUrl = FONT_URLS[design.font];
      if (fontUrl) {
        // Check if already loaded
        const alreadyLoaded = document.fonts.check(`900 48px "${design.font}"`);
        if (!alreadyLoaded) {
          console.log(`[Composer] Loading font: ${design.font}...`);
          // Inject link if not present
          if (!document.querySelector(`link[href*="${encodeURIComponent(design.font)}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet'; link.href = fontUrl;
            document.head.appendChild(link);
          }
          // Wait for font to be ready (max 3s)
          await Promise.race([
            document.fonts.load(`900 48px "${design.font}"`),
            new Promise(r => setTimeout(r, 3000)),
          ]);
          console.log(`[Composer] Font "${design.font}" loaded:`, document.fonts.check(`900 48px "${design.font}"`));
        } else {
          console.log(`[Composer] Font "${design.font}" already loaded`);
        }
      }
    } catch (err) {
      console.warn('[Composer] Font loading failed, using fallback:', err);
    }
  }

  // Load visual media
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch(() => null) : null,
    logoUrl ? loadImage(logoUrl).catch(() => null) : null,
    videoUrl ? loadVideo(videoUrl).catch(() => null) : null,
  ]);

  // Load audio — prefer pre-decoded AudioBuffers (batch mode), fallback to <audio> elements
  // ALWAYS load voice as <audio> element too (WebM recordings may decode to empty buffers)
  let musicEl: HTMLAudioElement | null = null;
  let voiceEl: HTMLAudioElement | null = null;
  if (!options.musicBuffer && musicUrl) {
    musicEl = await loadAudioElement(musicUrl);
  }
  // Always load voice element as fallback — decodeAudioData may return empty buffer for WebM recordings
  if (voiceUrl) {
    voiceEl = await loadAudioElement(voiceUrl);
  }
  // Validate voice buffer — if duration is too short, discard it so we use the <audio> element instead
  let validVoiceBuffer = options.voiceBuffer;
  if (validVoiceBuffer) {
    console.log('[Composer] Voice buffer check — duration:', validVoiceBuffer.duration.toFixed(2), 's, channels:', validVoiceBuffer.numberOfChannels, ', sampleRate:', validVoiceBuffer.sampleRate);
    if (validVoiceBuffer.duration < 0.5) {
      console.warn('[Composer] ⚠️ Voice buffer too short (<0.5s), discarding — will use <audio> element');
      validVoiceBuffer = undefined;
    }
  }

  const hasAudio = !!options.musicBuffer || !!validVoiceBuffer || musicEl !== null || voiceEl !== null;
  console.log('[Composer] Media loaded — poster:', !!posterImg, 'logo:', !!logoImg, 'video:', !!videoEl);
  console.log('[Composer] Audio — musicBuffer:', !!options.musicBuffer, 'voiceBuffer:', !!validVoiceBuffer, 'musicEl:', !!musicEl, 'voiceEl:', !!voiceEl, 'hasAudio:', hasAudio);

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
        case 'intro': drawIntro(ctx, width, height, posterImg, logoImg, title, subtitle, accentColor, progress, design); break;
        case 'cards': drawCards(ctx, width, height, cards, logoImg, accentColor, progress, design); break;
        case 'video': drawVideoSeq(ctx, width, height, videoEl, logoImg, progress, design); break;
        case 'cta': drawCTA(ctx, width, height, accentColor, ctaText, ctaSubText, salesPhrase, watermarkText, logoImg, progress, design); break;
      }
    };
    if (inTransition && seqIdx < sequences.length - 1) {
      drawTransition(ctx, width, height, (p) => drawSeq(seq.type, p), (p) => drawSeq(sequences[seqIdx + 1].type, p), transProgress);
    } else { drawSeq(seq.type, seqProgress); }
    // ── Accent border/contour frame ──
    const borderW = Math.round(width * 0.006);
    const borderGrad = ctx.createLinearGradient(0, 0, width, height);
    borderGrad.addColorStop(0, accentColor);
    borderGrad.addColorStop(0.5, '#FF2DAA');
    borderGrad.addColorStop(1, accentColor);
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = borderW;
    ctx.strokeRect(borderW / 2, borderW / 2, width - borderW, height - borderW);

    // ── Site text overlay (e.g. Afroboost.com) — configurable per sequence ──
    const siteTextLabel = siteText?.text || 'Afroboost.com';
    const siteTextEnabled = siteText?.enabled !== false;
    // Map sequence types to editor sequence names for matching
    const seqToEditor: Record<string, string> = { intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta' };
    const siteTextSeqs = siteText?.sequences || ['titre', 'cartes', 'video', 'cta'];
    const showSiteText = siteTextEnabled && siteTextSeqs.includes(seqToEditor[seq.type] || seq.type);
    if (showSiteText) {
      const stSize = siteText?.size || 1.0;
      const stColor = siteText?.color || '#FFFFFF';
      const stOpacity = siteText?.opacity ?? 0.85;
      const linkFontSize = Math.round(width * 0.028 * stSize);
      ctx.save();
      ctx.font = `700 ${linkFontSize}px ${design?.font || 'sans-serif'}`; ctx.textAlign = 'center';
      ctx.fillStyle = hexToRgba(stColor, stOpacity);
      ctx.shadowColor = accentColor; ctx.shadowBlur = 8;
      fillTextWithOutline(ctx, siteTextLabel, width / 2, height * 0.94, 3, 'rgba(0,0,0,0.85)');
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Progress bar ──
    const barH = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, height - barH, width, barH);
    const barGrad = ctx.createLinearGradient(0, 0, width * (elapsed / totalDuration), 0);
    barGrad.addColorStop(0, accentColor); barGrad.addColorStop(0.5, '#FF2DAA'); barGrad.addColorStop(1, '#00D4FF');
    ctx.fillStyle = barGrad; ctx.fillRect(0, height - barH, width * (elapsed / totalDuration), barH);
  };

  // ═══ AUDIO SETUP ═══
  // Strategy: try AudioBuffer approach first (reliable for batch), fallback to <audio> element
  // AudioBufferSourceNode: no autoplay policy issues, can be reused across batch
  // <audio> element: simpler but Chrome's autoplay policy blocks play() after first video in batch

  let audioCtx: AudioContext | null = null;
  let audioDest: MediaStreamAudioDestinationNode | null = null;
  const isSharedCtx = !!options.sharedAudioCtx;
  let musicBufferSource: AudioBufferSourceNode | null = null;
  let voiceBufferSource: AudioBufferSourceNode | null = null;
  let musicElConnected = false;
  let voiceElConnected = false;

  if (hasAudio) {
    // For batch mode with shared context: if it's closed or broken, create a fresh one
    if (options.sharedAudioCtx && options.sharedAudioCtx.state === 'closed') {
      console.warn('[Composer] ⚠️ Shared AudioContext is CLOSED — creating a new one');
      audioCtx = new AudioContext({ sampleRate: 48000 });
    } else {
      audioCtx = options.sharedAudioCtx || new AudioContext({ sampleRate: 48000 });
    }
    // Ensure AudioContext is running — critical for batch mode on mobile
    // Mobile browsers aggressively suspend AudioContext
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch (err) {
        console.warn('[Composer] ⚠️ AudioContext resume failed, creating new one:', err);
        audioCtx = new AudioContext({ sampleRate: 48000 });
        await audioCtx.resume().catch(() => {});
      }
    }
    // Double-check it's running
    if (audioCtx.state !== 'running') {
      console.warn('[Composer] ⚠️ AudioContext still not running (state:', audioCtx.state, ') — trying one more resume');
      await new Promise(r => setTimeout(r, 100));
      await audioCtx.resume().catch(() => {});
    }
    console.log('[Composer] AudioContext state:', audioCtx.state, '| sampleRate:', audioCtx.sampleRate, isSharedCtx ? '(SHARED)' : '(new)');

    audioDest = audioCtx.createMediaStreamDestination();
    console.log('[Composer] AudioDestination created, stream tracks:', audioDest.stream.getAudioTracks().length);

    // ── MUSIC: try AudioBuffer first, then <audio> element ──
    if (options.musicBuffer) {
      try {
        musicBufferSource = audioCtx.createBufferSource();
        musicBufferSource.buffer = options.musicBuffer;
        musicBufferSource.loop = true;
        const musicGain = audioCtx.createGain();
        musicGain.gain.value = (validVoiceBuffer || voiceEl) ? 0.5 : 0.8;
        musicBufferSource.connect(musicGain);
        musicGain.connect(audioDest);
        console.log('[Composer] ✅ Music: AudioBuffer connected | duration:', options.musicBuffer.duration.toFixed(1), 's | channels:', options.musicBuffer.numberOfChannels, '| gain:', musicGain.gain.value);
      } catch (err) {
        console.error('[Composer] ❌ Music AudioBuffer setup failed:', err);
        musicBufferSource = null;
        // Fallback: try loading <audio> element if we have a URL
        if (musicUrl && !musicEl) {
          console.log('[Composer] ↪ Fallback: loading music <audio> element...');
          musicEl = await loadAudioElement(musicUrl);
        }
      }
    }
    // <audio> element approach (single mode or fallback)
    if (musicEl && !musicBufferSource) {
      try {
        const musicSource = audioCtx.createMediaElementSource(musicEl);
        const musicGain = audioCtx.createGain();
        musicGain.gain.value = voiceEl ? 0.5 : 0.8;
        musicSource.connect(musicGain);
        musicGain.connect(audioDest);
        musicEl.loop = true;
        musicElConnected = true;
        console.log('[Composer] ✅ Music: <audio> element connected | gain:', musicGain.gain.value);
      } catch (err) {
        console.error('[Composer] ❌ Music <audio> setup failed:', err);
      }
    }

    // ── VOICE: try AudioBuffer first, then <audio> element ──
    if (validVoiceBuffer) {
      try {
        voiceBufferSource = audioCtx.createBufferSource();
        voiceBufferSource.buffer = validVoiceBuffer;
        voiceBufferSource.loop = false;
        const voiceGain = audioCtx.createGain();
        voiceGain.gain.value = 1.0;
        voiceBufferSource.connect(voiceGain);
        voiceGain.connect(audioDest);
        console.log('[Composer] ✅ Voice: AudioBuffer connected | duration:', validVoiceBuffer.duration.toFixed(1), 's');
      } catch (err) {
        console.error('[Composer] ❌ Voice AudioBuffer setup failed:', err);
        voiceBufferSource = null;
      }
    }
    // <audio> element approach for voice (always available as fallback)
    if (voiceEl && !voiceBufferSource) {
      try {
        const voiceSource = audioCtx.createMediaElementSource(voiceEl);
        const voiceGain = audioCtx.createGain();
        voiceGain.gain.value = 1.0;
        voiceSource.connect(voiceGain);
        voiceGain.connect(audioDest);
        voiceElConnected = true;
        console.log('[Composer] ✅ Voice: <audio> element connected');
      } catch (err) {
        console.error('[Composer] ❌ Voice <audio> setup failed:', err);
      }
    }

    // Final audio status
    const audioReady = !!musicBufferSource || musicElConnected || !!voiceBufferSource || voiceElConnected;
    console.log('[Composer] Audio setup complete — ready:', audioReady, '| musicBuffer:', !!musicBufferSource, '| musicEl:', musicElConnected, '| voiceBuffer:', !!voiceBufferSource, '| voiceEl:', voiceElConnected);
  }

  // ═══ MEDIARECORDER SETUP ═══
  // Use manual frame capture (fps=0) for fast mode, auto fps for real-time
  const useFastMode = !hasAudio;
  const videoStream = canvas.captureStream(useFastMode ? 0 : fps);

  // Combine video + audio into one MediaStream
  const combinedStream = new MediaStream();
  for (const track of videoStream.getVideoTracks()) combinedStream.addTrack(track);
  if (audioDest) {
    for (const track of audioDest.stream.getAudioTracks()) combinedStream.addTrack(track);
  }

  console.log('[Composer] Stream tracks:', combinedStream.getTracks().map(t => t.kind + ':' + t.readyState).join(', '));

  // Choose best mimeType — prefer MP4 (H.264) for universal compatibility (QuickTime, VLC, etc.)
  // FFmpeg.wasm WebM→MP4 conversion requires SharedArrayBuffer which most sites lack.
  // Chrome 124+ natively supports MP4 MediaRecorder — use it first, fallback to WebM.
  const mimeTypes = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  let mimeType = 'video/webm';
  for (const t of mimeTypes) {
    if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }
  const isMP4 = mimeType.startsWith('video/mp4');
  console.log('[Composer] MediaRecorder mimeType:', mimeType, '| MP4:', isMP4);
  console.log('[Composer] Mode:', useFastMode ? '⚡ FAST (no audio)' : '🔊 REAL-TIME (with audio)');

  // 8 Mbps for social media quality (Instagram/TikTok/YouTube recommend 5-10 Mbps for 1080p)
  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  onProgress?.(15, useFastMode ? 'Rendu rapide...' : 'Rendu en cours...');

  // ═══════════════════════════════════════════════════════════
  // FAST MODE: No audio → render frames as fast as possible
  // Instead of waiting 18s real-time, renders ~2s total
  // ═══════════════════════════════════════════════════════════
  if (useFastMode) {
    return new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const outputType = isMP4 ? 'video/mp4' : 'video/webm';
        const blob = new Blob(chunks, { type: outputType });
        console.log('[Composer] ✅ DONE — blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type:', outputType, ', chunks:', chunks.length);
        if (videoEl) videoEl.pause();
        try { document.body.removeChild(canvas); } catch {}
        onProgress?.(100, 'Terminé !');
        resolve(blob);
      };
      recorder.onerror = (e) => { console.error('[Composer] MediaRecorder error:', e); reject(new Error('Recording failed')); };

      // Get video track for manual frame capture
      const videoTrack = videoStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      const canRequestFrame = videoTrack && typeof videoTrack.requestFrame === 'function';
      if (!canRequestFrame) {
        console.warn('[Composer] requestFrame not available, falling back to timer-based fast mode');
      }

      recorder.start(100); // Shorter timeslice for more frequent data collection
      console.log('[Composer] ⚡ Fast recording started for', totalDuration.toFixed(1), 's');

      const totalFrames = Math.ceil(totalDuration * fps);
      const frameInterval = 1 / fps;
      let frameIdx = 0;
      const fastStart = performance.now();

      const renderBatch = () => {
        // Render up to 4 frames per batch — smaller batches give MediaRecorder more encoding time
        const batchSize = 4;
        for (let b = 0; b < batchSize && frameIdx < totalFrames; b++, frameIdx++) {
          const t = Math.min(frameIdx * frameInterval, totalDuration - 0.001);

          // Seek video element to correct position
          if (videoEl) {
            const videoSeq = sequences.find(s => s.type === 'video');
            if (videoSeq) {
              const vs = seqStarts[sequences.indexOf(videoSeq)];
              const ve = vs + videoSeq.duration;
              if (t >= vs && t < ve) { videoEl.currentTime = t - vs; }
            }
          }

          drawFrame(t);
          if (canRequestFrame) videoTrack.requestFrame();
        }

        // Report progress
        const pct = Math.round(15 + (frameIdx / totalFrames) * 80);
        onProgress?.(Math.min(pct, 95), `Montage rapide... ${Math.round((frameIdx / totalFrames) * 100)}%`);

        if (frameIdx < totalFrames) {
          // Delay between batches — gives MediaRecorder time to encode frames properly
          setTimeout(renderBatch, 16); // ~60fps pacing, prevents timing corruption
        } else {
          // Render complete — give MediaRecorder time to flush all pending data
          const fastElapsed = ((performance.now() - fastStart) / 1000).toFixed(1);
          console.log(`[Composer] ⚡ Fast render done: ${totalFrames} frames in ${fastElapsed}s (vs ${totalDuration.toFixed(1)}s real-time)`);
          setTimeout(() => recorder.stop(), 500);
        }
      };

      // Kick off fast rendering
      drawFrame(0);
      if (canRequestFrame) videoTrack.requestFrame();
      setTimeout(renderBatch, 10);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // REAL-TIME MODE: With audio → must render in sync with audio
  // ═══════════════════════════════════════════════════════════
  return new Promise<Blob>(async (resolve, reject) => {
    recorder.onstop = () => {
      const outputType = isMP4 ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunks, { type: outputType });
      console.log('[Composer] ✅ DONE — blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type:', outputType, ', chunks:', chunks.length);
      // Clean up audio
      if (musicEl) { musicEl.pause(); musicEl.currentTime = 0; }
      if (voiceEl) { voiceEl.pause(); voiceEl.currentTime = 0; }
      try { musicBufferSource?.stop(); } catch {}
      try { voiceBufferSource?.stop(); } catch {}
      if (videoEl) videoEl.pause();
      try { document.body.removeChild(canvas); } catch {}
      onProgress?.(100, 'Terminé !');
      resolve(blob);
      // Only close AudioContext if we created it (NOT shared in batch mode)
      if (audioCtx && !isSharedCtx) { audioCtx.close().catch(() => {}); }
    };

    recorder.onerror = (e) => {
      console.error('[Composer] MediaRecorder error:', e);
      reject(new Error('Recording failed'));
    };

    // Ensure AudioContext is still running right before starting audio
    if (audioCtx && audioCtx.state !== 'running') {
      console.warn('[Composer] ⚠️ AudioContext suspended before audio start, resuming...');
      await audioCtx.resume().catch(() => {});
      await new Promise(r => setTimeout(r, 50));
    }

    // START audio BEFORE recorder — prime the audio pipeline so MediaRecorder captures it
    // Use audioCtx.currentTime (not 0) to avoid timing issues with shared/reused contexts
    const audioStartTime = audioCtx ? audioCtx.currentTime + 0.1 : 0;
    if (musicBufferSource) {
      try {
        musicBufferSource.start(audioStartTime);
        console.log('[Composer] ✅ Music AudioBuffer STARTED at', audioStartTime.toFixed(3), '| ctx.state:', audioCtx?.state);
      } catch (err) {
        console.error('[Composer] ❌ Music AudioBuffer start failed:', err);
        // If start() failed (e.g. already started), try recreating the source
        if (audioCtx && options.musicBuffer && audioDest) {
          try {
            musicBufferSource = audioCtx.createBufferSource();
            musicBufferSource.buffer = options.musicBuffer;
            musicBufferSource.loop = true;
            const mg = audioCtx.createGain();
            mg.gain.value = (validVoiceBuffer || voiceEl) ? 0.5 : 0.8;
            musicBufferSource.connect(mg);
            mg.connect(audioDest);
            musicBufferSource.start(audioCtx.currentTime + 0.05);
            console.log('[Composer] ✅ Music AudioBuffer RECREATED and STARTED');
          } catch (e2) {
            console.error('[Composer] ❌ Music AudioBuffer recreation also failed:', e2);
          }
        }
      }
    } else if (musicElConnected && musicEl) {
      musicEl.currentTime = 0;
      musicEl.play().then(() => console.log('[Composer] ✅ Music <audio> PLAYING')).catch(err => console.error('[Composer] ❌ Music play failed:', err));
    }
    if (voiceBufferSource) {
      try {
        voiceBufferSource.start(audioStartTime);
        console.log('[Composer] ✅ Voice AudioBuffer STARTED at', audioStartTime.toFixed(3));
      } catch (err) {
        console.error('[Composer] ❌ Voice AudioBuffer start failed:', err);
      }
    } else if (voiceElConnected && voiceEl) {
      voiceEl.currentTime = 0;
      voiceEl.play().then(() => console.log('[Composer] ✅ Voice <audio> PLAYING')).catch(err => console.error('[Composer] ❌ Voice play failed:', err));
    }

    // Wait a moment for audio pipeline to fill before starting recording
    await new Promise(r => setTimeout(r, 150));

    // START recording AFTER audio — ensures audio tracks have data flowing
    recorder.start(200);

    // START video element
    if (videoEl) { videoEl.currentTime = 0; videoEl.pause(); }

    console.log('[Composer] 🔊 Real-time recording started for', totalDuration.toFixed(1), 's');

    // Keep-alive: prevent mobile browsers from suspending AudioContext during render
    const keepAliveInterval = audioCtx ? setInterval(() => {
      if (audioCtx && audioCtx.state === 'suspended') {
        console.warn('[Composer] ⚠️ AudioContext suspended during render, resuming...');
        audioCtx.resume().catch(() => {});
      }
    }, 1000) : null;

    const startTime = performance.now();
    let lastProgress = 0;
    let animStopped = false;
    let lastAnimTime = performance.now(); // Pour détecter si rAF est en pause

    const doFrame = () => {
      if (animStopped) return;
      lastAnimTime = performance.now();
      const elapsed = (performance.now() - startTime) / 1000;

      if (elapsed >= totalDuration + 0.3) {
        animStopped = true;
        console.log('[Composer] Rendu terminé, arrêt du recorder');
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (musicEl) musicEl.pause();
        if (voiceEl) voiceEl.pause();
        try { musicBufferSource?.stop(); } catch {}
        try { voiceBufferSource?.stop(); } catch {}
        recorder.stop();
        return;
      }

      const t = Math.min(elapsed, totalDuration - 0.001);

      // Gérer l'élément vidéo
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
        onProgress?.(Math.min(pct, 95), 'Montage vidéo en cours...');
      }

      requestAnimationFrame(doFrame);
    };

    // Watchdog : si rAF est en pause (onglet en arrière-plan), setTimeout prend le relais
    // Chrome met rAF en pause dans les onglets en arrière-plan, ce qui bloque le rendu.
    // Le watchdog vérifie toutes les 2s si rAF a tourné récemment. Sinon, il force un frame.
    const watchdogInterval = setInterval(() => {
      if (animStopped) { clearInterval(watchdogInterval); return; }
      const timeSinceLastAnim = performance.now() - lastAnimTime;
      if (timeSinceLastAnim > 2000) {
        // rAF n'a pas tourné depuis 2s → onglet probablement en arrière-plan
        console.log('[Composer] ⚠️ rAF en pause (onglet arrière-plan), watchdog force le frame');
        doFrame();
      }
    }, 2000);

    const animate = doFrame;

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
  const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
  console.log('[Composer] Uploading', sizeMB, 'MB', ext);

  let url: string | null = null;

  // Strategy 1: Use signed URL for direct Supabase upload (bypasses Vercel 4.5MB limit)
  try {
    const filename = `montage-${Date.now()}.${ext}`;
    console.log('[Composer] Requesting signed upload URL...');
    const signedRes = await fetch('/api/upload/signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType: blob.type, purpose: 'rush' }),
    });
    const signedData = await signedRes.json();

    if (signedData.success && signedData.signedUrl) {
      console.log('[Composer] Got signed URL, uploading directly to Supabase...');
      const uploadRes = await fetch(signedData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });

      if (uploadRes.ok) {
        url = signedData.publicUrl;
        console.log('[Composer] Direct upload OK:', url);
      } else {
        console.error('[Composer] Direct upload failed:', uploadRes.status, uploadRes.statusText);
      }
    } else {
      console.error('[Composer] Signed URL request failed:', signedData);
    }
  } catch (err) {
    console.error('[Composer] Signed URL upload error:', err);
  }

  // Strategy 2: Fallback to API route (works for small files < 4.5MB)
  if (!url) {
    try {
      console.log('[Composer] Fallback: uploading via API route...');
      const formData = new FormData();
      formData.append('file', new File([blob], `montage-${Date.now()}.${ext}`, { type: blob.type }));
      formData.append('purpose', 'rush');
      const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.file?.url) { url = data.file.url; console.log('[Composer] Fallback upload OK:', url); }
      else console.error('[Composer] Fallback upload failed:', data);
    } catch (err) { console.error('[Composer] Fallback upload error:', err); }
  }

  return { blob, url };
}

/**
 * Convert a WebM blob to MP4 using FFmpeg.wasm (client-side).
 * Falls back to original blob if conversion fails.
 */
export async function convertWebmToMp4(
  webmBlob: Blob,
  onProgress?: (percent: number, stage: string) => void
): Promise<Blob> {
  if (webmBlob.type.includes('mp4')) return webmBlob; // Already MP4

  onProgress?.(0, 'Conversion MP4...');
  try {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();

    // Load FFmpeg WASM from CDN — try jsdelivr first (more reliable), fallback to unpkg
    let loaded = false;
    const cdnBases = [
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm',
      'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
    ];
    for (const baseURL of cdnBases) {
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        loaded = true;
        console.log('[Composer] FFmpeg loaded from:', baseURL);
        break;
      } catch (cdnErr) {
        console.warn('[Composer] FFmpeg CDN failed:', baseURL, cdnErr);
      }
    }
    if (!loaded) throw new Error('FFmpeg WASM failed to load from all CDNs');

    onProgress?.(20, 'Conversion MP4...');

    // Write input WebM
    const inputData = await fetchFile(webmBlob);
    await ffmpeg.writeFile('input.webm', inputData);

    onProgress?.(40, 'Encodage H.264...');

    // Convert WebM → MP4 (H.264 Baseline + AAC) — QuickTime compatible
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', 'output.mp4',
    ]);

    onProgress?.(85, 'Finalisation MP4...');

    // Read output MP4
    const outputData = await ffmpeg.readFile('output.mp4');
    // FFmpeg readFile returns Uint8Array or string; use slice for BlobPart compat
    const uint8 = outputData as Uint8Array;
    const mp4Blob = new Blob([new Uint8Array(uint8)], { type: 'video/mp4' });

    // Cleanup
    ffmpeg.terminate();

    onProgress?.(100, 'MP4 prêt !');
    console.log('[Composer] WebM→MP4 conversion OK:', (mp4Blob.size / 1024 / 1024).toFixed(1), 'MB');
    return mp4Blob;
  } catch (err) {
    console.error('[Composer] WebM→MP4 conversion failed, using original WebM:', err);
    onProgress?.(100, 'Export WebM (conversion MP4 échouée)');
    return webmBlob; // Fallback: return original WebM
  }
}

/**
 * Download a blob as a file. Converts WebM to MP4 automatically for desktop export.
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
  onProgress?: (percent: number, stage: string) => void
) {
  let finalBlob = blob;
  let finalFilename = filename;

  // Auto-convert WebM to MP4 for desktop download
  if (blob.type.includes('webm') || filename.endsWith('.webm')) {
    finalBlob = await convertWebmToMp4(blob, onProgress);
    if (finalBlob.type.includes('mp4')) {
      finalFilename = filename.replace(/\.webm$/i, '.mp4');
    }
  }

  const url = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = url; a.download = finalFilename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
