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
  /** Per-sequence positions {titre: {x,y}, cartes: {x,y}, video: {x,y}, cta: {x,y}} */
  positions?: Record<string, { x?: number; y?: number }>;
  /** Legacy single position fallback */
  pos?: { x?: number; y?: number };
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
  /** CTA main color (default: accentColor) */
  ctaColor?: string;
  /** Logo sequences — which sequences show the logo (e.g. ['intro','cards','video','cta']) */
  logoSequences?: string[];
  /** Logo position override {x: 0-100, y: 0-100} (legacy single position, used as fallback) */
  logoPosition?: { x?: number; y?: number };
  /** Per-sequence logo positions {intro: {x,y}, cards: {x,y}, video: {x,y}, cta: {x,y}} */
  logoPositions?: Record<string, { x?: number; y?: number }>;
  /** Video overlay text */
  overlayText?: string;
  /** Video overlay color */
  overlayColor?: string;
  /** Text scale multiplier (default: 1.0) — matches editor textScale */
  textScale?: number;
  /** CTA text scale multiplier (default: 1.0) — matches editor ctaTextScale */
  ctaTextScale?: number;
  /** Card style: 'Compact' | 'Educatif' | 'Stats Bold' | 'Minimal Line' | 'Full Width' */
  cardStyle?: string;
  /** Title position {x: 0-100, y: 0-100} (default: {x:50, y:75}) */
  titlePosition?: { x?: number; y?: number };
  /** Cards position {x: 0-100, y: 0-100} (default: {x:50, y:50}) */
  cardsPosition?: { x?: number; y?: number };
  /** Cards container width in % (default: 92) */
  cardsSize?: number;
  /** CTA main text override from design (e.g. 'AFROBOOST') */
  ctaMainText?: string;
  /** CTA sub text override from design (e.g. "CHAT POUR PLUS D'INFOS") */
  ctaSubTextDesign?: string;
  /** Logo scale multiplier (default: 1.0) */
  logoScale?: number;
  /** Typography settings for title */
  titleTypography?: {
    letterSpacing?: number;
    lineHeight?: number;
    bold?: boolean;
    italic?: boolean;
  };
  /** CTA/Watermark position {x: 0-100, y: 0-100} (default: {x:50, y:97}) — editor uses translate(-50%, -100%) */
  watermarkPosition?: { x?: number; y?: number };
  /** CTA/Watermark container width % (default: 70) — matches editor watermarkSize */
  watermarkSize?: number;
  /** Video overlay text position {x: 0-100, y: 0-100} (default: {x:50, y:33}) */
  overlayPosition?: { x?: number; y?: number };
  /** Title container width % (default: 90) — matches editor titleSize */
  titleSize?: number;
  /** CTA typography (letterSpacing, lineHeight) */
  ctaTypography?: {
    letterSpacing?: number;
    lineHeight?: number;
    bold?: boolean;
    italic?: boolean;
  };
  /** Overlay typography */
  overlayTypography?: {
    letterSpacing?: number;
    lineHeight?: number;
    bold?: boolean;
    italic?: boolean;
  };
  /** Sequence-level gradient overrides */
  seqGradients?: Record<string, { enabled?: boolean; color1?: string; color2?: string; opacity?: number }>;
  /** No-color background flag */
  noColorBg?: boolean;
  /** Sequences with no color overlay */
  noColorSequences?: string[];
  /** Selected filter name */
  filter?: string;
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

function loadImage(src: string, timeoutMs = 20000): Promise<HTMLImageElement> {
  if (src.startsWith('blob:')) {
    return blobUrlToDataUrl(src).then(
      (dataUrl) => loadImage(dataUrl, timeoutMs),
      () => new Promise<HTMLImageElement>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Image load timeout (blob): ${src.substring(0, 40)}`)), timeoutMs);
        const img = new Image();
        img.onload = () => { clearTimeout(timeout); resolve(img); };
        img.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load blob image')); };
        img.src = src;
      })
    );
  }
  if (src.startsWith('data:')) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Image load timeout (data URL)')), timeoutMs);
      const img = new Image();
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load data URL image')); };
      img.src = src;
    });
  }
  // For external images (Pexels, etc.), ALWAYS use proxy first to guarantee same-origin
  // and prevent canvas tainting. Direct cross-origin loads can silently taint the canvas
  // even when crossOrigin='anonymous' is set, if the CDN doesn't return CORS headers
  // consistently (regional caches, etc.). A tainted canvas produces empty captureStream frames.
  const isExternal = !src.includes(window.location.hostname) && !src.includes('.supabase.co/');
  const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(src)}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Image load timeout: ${src.substring(0, 60)}`)), timeoutMs);

    const loadDirect = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error(`Failed to load image: ${src.substring(0, 60)}`)); };
      img.src = src;
    };

    if (isExternal) {
      console.log(`[Composer] External image → proxy first: ${src.substring(0, 60)}`);
      const proxyImg = new Image();
      proxyImg.crossOrigin = 'anonymous';
      proxyImg.onload = () => { clearTimeout(timeout); resolve(proxyImg); };
      proxyImg.onerror = () => {
        console.warn(`[Composer] Proxy load failed, trying direct: ${src.substring(0, 60)}`);
        loadDirect();
      };
      proxyImg.src = proxyUrl;
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => {
        console.warn(`[Composer] Image direct load failed, trying proxy: ${src.substring(0, 60)}`);
        const proxyImg = new Image();
        proxyImg.crossOrigin = 'anonymous';
        proxyImg.onload = () => { clearTimeout(timeout); resolve(proxyImg); };
        proxyImg.onerror = () => { clearTimeout(timeout); reject(new Error(`Failed to load image (direct + proxy): ${src.substring(0, 60)}`)); };
        proxyImg.src = proxyUrl;
      };
      img.src = src;
    }
  });
}

function loadVideo(src: string, timeoutMs = 30000): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Video load timeout (${timeoutMs}ms): ${src.substring(0, 60)}`)), timeoutMs);
    const vid = document.createElement('video');
    if (!src.startsWith('blob:') && !src.startsWith('data:')) vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.oncanplaythrough = () => { clearTimeout(timeout); resolve(vid); };
    vid.onerror = () => {
      if (src.startsWith('blob:') || src.startsWith('data:')) { clearTimeout(timeout); return reject(new Error('Video load failed')); }
      console.warn(`[Composer] Video direct load failed, trying proxy: ${src.substring(0, 60)}`);
      const vid2 = document.createElement('video');
      vid2.crossOrigin = 'anonymous';
      vid2.muted = true; vid2.playsInline = true; vid2.preload = 'auto';
      vid2.oncanplaythrough = () => { clearTimeout(timeout); resolve(vid2); };
      vid2.onerror = () => { clearTimeout(timeout); reject(new Error(`Video load failed (direct + proxy): ${src.substring(0, 60)}`)); };
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

/** Get logo position for a specific sequence, with fallback to global logoPosition */
function getLogoPos(design: DesignOptions | undefined, seq: string): { x: number; y: number } {
  const perSeq = design?.logoPositions?.[seq];
  if (perSeq && (perSeq.x !== undefined || perSeq.y !== undefined)) {
    const result = { x: perSeq.x ?? 50, y: perSeq.y ?? 85 };
    console.log(`[Composer] getLogoPos('${seq}'): FOUND per-sequence → ${JSON.stringify(result)} (keys available: ${Object.keys(design?.logoPositions || {}).join(',')})`);
    return result;
  }
  const fallback = { x: design?.logoPosition?.x ?? 50, y: design?.logoPosition?.y ?? 85 };
  console.warn(`[Composer] getLogoPos('${seq}'): ⚠️ FALLBACK to legacy position → ${JSON.stringify(fallback)} (logoPositions keys: ${Object.keys(design?.logoPositions || {}).join(',') || 'NONE'}, logoPosition: ${JSON.stringify(design?.logoPosition)})`);
  return fallback;
}

/** Get siteText position for a specific sequence, with fallback to legacy pos or default */
function getSiteTextPos(siteText: SiteTextConfig | undefined, seq: string): { x: number; y: number } {
  // Map Canvas sequence name → editor French name for positions lookup
  const seqToEditor: Record<string, string> = { intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta' };
  const editorSeq = seqToEditor[seq] || seq;
  const perSeq = siteText?.positions?.[editorSeq];
  if (perSeq && (perSeq.x !== undefined || perSeq.y !== undefined)) {
    return { x: perSeq.x ?? 50, y: perSeq.y ?? 95 };
  }
  // Fallback to legacy single pos
  if (siteText?.pos && (siteText.pos.x !== undefined || siteText.pos.y !== undefined)) {
    return { x: siteText.pos.x ?? 50, y: siteText.pos.y ?? 95 };
  }
  return { x: 50, y: 95 };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Word-wrap text to fit within maxWidth, splitting at word boundaries */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [text];
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

/**
 * Compute logo draw dimensions matching the editor's CSS behavior:
 *   h-8 (32px height), w-auto, max-w-[60px], scale(logoScale)
 * on a ~320px wide editor preview (9:16 aspect → 320×568).
 *
 * Returns { drawW, drawH } in canvas pixels, already scaled by logoScale.
 */
function computeLogoDimensions(
  logoImg: HTMLImageElement, canvasW: number, canvasH: number, logoScale: number
): { drawW: number; drawH: number } {
  const imgW = logoImg.naturalWidth || logoImg.width;
  const imgH = logoImg.naturalHeight || logoImg.height;

  // Editor reference: 320px wide, 568px tall (9:16). Logo: h-8 = 32px, w-auto, max-w-[60px]
  // In canvas coordinates, scale proportionally:
  //   baseH = 32/568 * canvasH ≈ canvasW * 0.10 for 9:16
  //   maxW  = 60/320 * canvasW ≈ canvasW * 0.1875
  const baseH = Math.round(canvasH * (32 / 568));
  const maxW = Math.round(canvasW * (60 / 320));

  if (imgW === 0 || imgH === 0) {
    return { drawW: baseH * logoScale, drawH: baseH * logoScale };
  }

  const ratio = imgW / imgH;
  // Height-based sizing (like CSS h-8 w-auto)
  let drawH = baseH * logoScale;
  let drawW = Math.round(drawH * ratio);
  // Apply max-width constraint (like CSS max-w-[60px] scaled)
  const scaledMaxW = maxW * logoScale;
  if (drawW > scaledMaxW) {
    drawW = scaledMaxW;
    drawH = Math.round(drawW / ratio);
  }
  return { drawW, drawH };
}

/**
 * Draw logo with accurate editor-matching dimensions and position.
 * Uses computeLogoDimensions to match the CSS h-8 w-auto max-w-[60px] behavior.
 * Center of logo is placed at (pos.x%, pos.y%) of canvas.
 */
function drawLogoAccurate(
  ctx: CanvasRenderingContext2D, logoImg: HTMLImageElement,
  canvasW: number, canvasH: number,
  pos: { x: number; y: number }, logoScale: number
) {
  const { drawW, drawH } = computeLogoDimensions(logoImg, canvasW, canvasH, logoScale);
  const cx = (pos.x / 100) * canvasW;
  const cy = (pos.y / 100) * canvasH;
  ctx.drawImage(logoImg, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
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

  // Title sizing and position — matched to editor CSS:
  //   Editor (9:16): fontSize = 14 * textScale px on 320px wide = 14/320 = 0.04375 of width
  //   Editor (16:9): fontSize = 18 * textScale px on 512px wide ≈ 0.035 of width
  //   Subtitle: 9/320 = 0.028 (9:16), 11/512 = 0.0215 (16:9)
  //   Default title position: Y=10% from top (editor), not 75%
  const textScale = design?.textScale || 1.0;
  const titleAlpha = Math.min(1, progress * 3);
  const isReel = h > w; // 9:16 = reel, 16:9 = landscape
  const fontSize = Math.round(w * (isReel ? 0.04375 : 0.035) * textScale);
  const subFontSize = Math.round(w * (isReel ? 0.028 : 0.0215) * textScale);

  // Position from design metadata — editor default is (50%, 10%)
  // The editor uses translate(-50%, 0) so Y% is the TOP edge of the text block
  const titlePosX = ((design?.titlePosition?.x ?? 50) / 100) * w;
  const titlePosY = ((design?.titlePosition?.y ?? 10) / 100) * h;

  const fontWeight = design?.titleTypography?.bold !== false ? 900 : 400;
  const fontStyle = design?.titleTypography?.italic ? 'italic ' : '';

  // Title text — editor does NOT force uppercase, preserves original case
  // Editor uses width constraint (titleSize%, default 90%) for wrapping
  const titleWidth = w * ((design?.titleSize ?? 90) / 100);
  ctx.save();
  ctx.font = `${fontStyle}${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = hexToRgba(titleColor, titleAlpha);
  ctx.shadowColor = hexToRgba(accent, 0.8); ctx.shadowBlur = Math.round(w * 0.02);

  // Word-wrap title to match editor behavior (text wraps within titleWidth)
  const titleLines = wrapText(ctx, title, titleWidth);
  const lineSpacing = fontSize * (design?.titleTypography?.lineHeight || 1.1);
  let titleDrawY = titlePosY + fontSize; // baseline offset (canvas draws text from baseline)
  for (let i = 0; i < titleLines.length; i++) {
    fillTextWithOutline(ctx, titleLines[i], titlePosX, titleDrawY + i * lineSpacing, Math.round(w * 0.004), 'rgba(0,0,0,0.9)');
  }
  ctx.shadowBlur = 0;

  const titleBlockBottom = titleDrawY + (titleLines.length - 1) * lineSpacing;

  // Subtitle below title
  if (subtitle) {
    const subAlpha = Math.max(0, Math.min(1, (progress - 0.2) * 3));
    ctx.font = `${fontStyle}${fontWeight} ${subFontSize}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = hexToRgba(titleColor, subAlpha * 0.8);
    ctx.shadowColor = hexToRgba(accent, 0.5); ctx.shadowBlur = Math.round(w * 0.006);
    // mt-1 in editor ≈ 4px on 320px → ~1.25% of width
    fillTextWithOutline(ctx, subtitle, titlePosX, titleBlockBottom + fontSize * 0.4, 2, 'rgba(0,0,0,0.7)');
    ctx.shadowBlur = 0;
  }

  // Accent line below title — gradient line (not present in editor but kept for video polish)
  const lineAlpha = Math.max(0, Math.min(1, (progress - 0.3) * 3));
  const lineW = w * 0.15;
  const lineY = titleBlockBottom + fontSize * (subtitle ? 0.7 : 0.3);
  const lineGrad = ctx.createLinearGradient(w / 2 - lineW / 2, 0, w / 2 + lineW / 2, 0);
  lineGrad.addColorStop(0, 'rgba(0,0,0,0)');
  lineGrad.addColorStop(0.5, hexToRgba(accent, lineAlpha));
  lineGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(w / 2 - lineW / 2, lineY);
  ctx.lineTo(w / 2 + lineW / 2, lineY); ctx.stroke();

  // Logo on intro if configured — uses per-sequence position
  // Uses drawLogoAccurate to match editor's h-8 w-auto max-w-[60px] scale(logoScale)
  if (logoImg && design?.logoSequences?.includes('intro')) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'intro');
    console.log(`[Composer] Logo INTRO: pos=${JSON.stringify(pos)}, scale=${logoScale}, canvas=${w}x${h}`);
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
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
  const textScale = design?.textScale || 1.0;
  const cardStyle = design?.cardStyle || 'Full Width';

  // Background gradient matching preview: gradient(to bottom, grad1 at 0.9, grad2 at 0.7, #000)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexToRgba(grad1, 0.9));
  grad.addColorStop(0.5, hexToRgba(grad2, 0.7));
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

  // Card sizes from design or defaults
  const containerW = Math.round(w * ((design?.cardsSize || 92) / 100));
  const containerX = (w - containerW) / 2;
  const maxCards = Math.min(cards.length, 5);

  // Font sizes matched to editor CSS:
  //   Editor label = 7px, value = 9px, desc = 6px, emoji = text-sm = 14px
  //   On 320px wide editor → emoji: 14/320=0.04375, label: 7/320=0.022, value: 9/320=0.028, desc: 6/320=0.019
  //   Stats Bold value: 13/320=0.041
  const emojiSize = Math.round(w * 0.04375 * textScale);
  const labelSize = Math.round(w * 0.022 * textScale);
  const valueSize = Math.round(w * 0.028 * textScale);
  const descSize = Math.round(w * 0.019 * textScale);
  const borderW = Math.round(w * 0.004);
  const radius = Math.round(w * 0.012);

  // ── Card style: Stats Bold (value big centered, label small below) ──
  if (cardStyle === 'Stats Bold') {
    const cols = 2;
    const cardW = Math.round((containerW - (cols - 1) * Math.round(w * 0.015)) / cols);
    const cardH = Math.round(h * 0.11);
    const gap = Math.round(w * 0.015);
    const rows = Math.ceil(maxCards / cols);
    const totalH = rows * cardH + (rows - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - containerW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const rawCp = Math.max(0, Math.min(1, (progress - i * 0.08) * 3.5));
      if (rawCp <= 0) return;
      const cp = 1 - Math.pow(1 - rawCp, 3);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cardsX + col * (cardW + gap);
      const y = cardsY + row * (cardH + gap);
      ctx.globalAlpha = cp;

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.stroke();

      const bigValueSize = Math.round(w * 0.041 * textScale); // editor: 13/320 = 0.041
      ctx.font = `900 ${bigValueSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = 'center'; ctx.fillStyle = card.color || accent;
      ctx.fillText(card.value, x + cardW / 2, y + cardH * 0.5);

      ctx.font = `500 ${descSize}px "${fontFamily}", sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(card.label, x + cardW / 2, y + cardH * 0.78);
      ctx.globalAlpha = 1;
    });
  }
  // ── Card style: Compact (column layout: emoji, label, value centered) ──
  else if (cardStyle === 'Compact') {
    const cols = 2;
    const cardW = Math.round((containerW - (cols - 1) * Math.round(w * 0.015)) / cols);
    const cardH = Math.round(h * 0.1);
    const gap = Math.round(w * 0.015);
    const rows = Math.ceil(maxCards / cols);
    const totalH = rows * cardH + (rows - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - containerW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const rawCp = Math.max(0, Math.min(1, (progress - i * 0.08) * 3.5));
      if (rawCp <= 0) return;
      const cp = 1 - Math.pow(1 - rawCp, 3);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cardsX + col * (cardW + gap);
      const y = cardsY + row * (cardH + gap);
      ctx.globalAlpha = cp;

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.fill();
      // Left accent border
      ctx.fillStyle = card.color || accent;
      ctx.fillRect(x, y + Math.round(cardH * 0.1), borderW, cardH - Math.round(cardH * 0.2));

      // Emoji centered
      ctx.font = `${emojiSize}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = 'white';
      ctx.fillText(card.emoji || '●', x + cardW / 2, y + cardH * 0.3);
      // Label
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF';
      ctx.fillText(card.label, x + cardW / 2, y + cardH * 0.58);
      // Value
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = card.color || accent;
      ctx.fillText(card.value, x + cardW / 2, y + cardH * 0.83);
      ctx.globalAlpha = 1;
    });
  }
  // ── Card style: Educatif (emoji + label row, description, value) ──
  else if (cardStyle === 'Educatif') {
    const cardW = containerW;
    const cardH = Math.round(h * 0.09);
    const gap = Math.round(h * 0.012);
    const totalH = maxCards * cardH + (maxCards - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - cardW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const rawCp = Math.max(0, Math.min(1, (progress - i * 0.08) * 3.5));
      if (rawCp <= 0) return;
      const cp = 1 - Math.pow(1 - rawCp, 3);
      const y = cardsY + i * (cardH + gap);
      const slideX = cardsX + (1 - cp) * (-w * 0.12);
      ctx.globalAlpha = cp;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      drawRoundRect(ctx, slideX, y, cardW, cardH, radius); ctx.fill();
      // Top accent border
      ctx.fillStyle = card.color || accent;
      ctx.fillRect(slideX + radius, y, cardW - radius * 2, borderW);

      // Emoji + label row
      const emojiX = slideX + Math.round(w * 0.025);
      ctx.font = `${emojiSize}px sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = 'white';
      ctx.fillText(card.emoji || '●', emojiX, y + cardH * 0.4);
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF';
      ctx.fillText(card.label, emojiX + emojiSize + Math.round(w * 0.01), y + cardH * 0.38);
      // Value
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = card.color || accent; ctx.textAlign = 'left';
      ctx.fillText(card.value, emojiX, y + cardH * 0.78);
      ctx.globalAlpha = 1;
    });
  }
  // ── Card style: Minimal Line (horizontal: emoji, label, value right-aligned) ──
  else if (cardStyle === 'Minimal Line') {
    const cardW = containerW;
    const cardH = Math.round(h * 0.05);
    const gap = Math.round(h * 0.006);
    const totalH = maxCards * cardH + (maxCards - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - cardW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const rawCp = Math.max(0, Math.min(1, (progress - i * 0.08) * 3.5));
      if (rawCp <= 0) return;
      const cp = 1 - Math.pow(1 - rawCp, 3);
      const y = cardsY + i * (cardH + gap);
      const slideX = cardsX + (1 - cp) * (-w * 0.12);
      ctx.globalAlpha = cp;

      // Bottom border line
      ctx.strokeStyle = hexToRgba(card.color || accent, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(slideX, y + cardH); ctx.lineTo(slideX + cardW, y + cardH); ctx.stroke();

      // Emoji
      ctx.font = `${Math.round(emojiSize * 0.7)}px sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = 'white';
      ctx.fillText(card.emoji || '●', slideX + Math.round(w * 0.01), y + cardH * 0.7);
      // Label
      ctx.font = `400 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(card.label, slideX + Math.round(w * 0.05), y + cardH * 0.7);
      // Value right-aligned
      ctx.font = `700 ${valueSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'right';
      ctx.fillStyle = card.color || accent;
      ctx.fillText(card.value, slideX + cardW - Math.round(w * 0.01), y + cardH * 0.7);
      ctx.globalAlpha = 1;
    });
  }
  // ── Card style: Full Width (default — horizontal row with emoji, label left, value right) ──
  else {
    const cardW = containerW;
    const cardH = Math.round(h * 0.07);
    const gap = Math.round(h * 0.012);
    const totalH = maxCards * cardH + (maxCards - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - cardW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const rawCp = Math.max(0, Math.min(1, (progress - i * 0.08) * 3.5));
      if (rawCp <= 0) return;
      const cp = 1 - Math.pow(1 - rawCp, 3);
      const y = cardsY + i * (cardH + gap);
      const slideX = cardsX + (1 - cp) * (-w * 0.12);
      ctx.globalAlpha = cp;

      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      drawRoundRect(ctx, slideX, y, cardW, cardH, radius); ctx.fill();
      // Left accent border
      ctx.fillStyle = card.color || accent;
      ctx.fillRect(slideX, y + Math.round(cardH * 0.12), borderW, cardH - Math.round(cardH * 0.24));

      // Emoji
      const emojiX = slideX + Math.round(w * 0.025);
      ctx.font = `${emojiSize}px sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = 'white';
      ctx.fillText(card.emoji || '●', emojiX, y + cardH * 0.65);
      // Label
      const labelX = emojiX + emojiSize + Math.round(w * 0.015);
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left';
      fillTextWithOutline(ctx, card.label, labelX, y + cardH * 0.58, 2, 'rgba(0,0,0,0.5)');
      // Value right-aligned
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'right';
      ctx.fillStyle = card.color || accent;
      fillTextWithOutline(ctx, card.value, slideX + cardW - Math.round(w * 0.025), y + cardH * 0.62, 2, 'rgba(0,0,0,0.6)');
      ctx.globalAlpha = 1;
    });
  }

  // Logo on cards if configured — uses per-sequence position
  if (logoImg && design?.logoSequences?.includes('cards')) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'cards');
    console.log(`[Composer] Logo CARDS: pos=${JSON.stringify(pos)}, scale=${logoScale}`);
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
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
  // Editor: fontSize = 16 * textScale px on 320px → ratio = 16/320 = 0.05
  // Editor: position from overlayPos (default: x=50%, y=33%), width 85%
  // Editor does NOT force uppercase — preserves original case
  if (design?.overlayText) {
    const textScale = design?.textScale || 1.0;
    const overlayFontSize = Math.round(w * 0.05 * textScale);
    const overlayX = ((design?.overlayPosition?.x ?? 50) / 100) * w;
    const overlayY = ((design?.overlayPosition?.y ?? 33) / 100) * h;
    const overlayBold = design?.overlayTypography?.bold !== false;
    const overlayItalic = design?.overlayTypography?.italic ? 'italic ' : '';
    const overlayWeight = overlayBold ? 700 : 400;
    ctx.save();
    ctx.font = `${overlayItalic}${overlayWeight} ${overlayFontSize}px "${fontFamily}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = design.overlayColor || '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 12;
    // Word-wrap overlay text within 85% width (matches editor width: 85%)
    const overlayLines = wrapText(ctx, design.overlayText, w * 0.85);
    const overlayLineH = overlayFontSize * (design?.overlayTypography?.lineHeight || 1.2);
    const overlayBlockH = overlayLines.length * overlayLineH;
    const overlayStartY = overlayY - overlayBlockH / 2 + overlayFontSize;
    for (let i = 0; i < overlayLines.length; i++) {
      fillTextWithOutline(ctx, overlayLines[i], overlayX, overlayStartY + i * overlayLineH, 3, 'rgba(0,0,0,0.7)');
    }
    ctx.restore();
  }
  // Logo on video if configured — uses per-sequence position
  if (logoImg && design?.logoSequences?.includes('video')) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'video');
    console.log(`[Composer] Logo VIDEO: pos=${JSON.stringify(pos)}, scale=${logoScale}`);
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
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
  const ctaSubColor = design?.ctaSubColor || accent; // editor default is accent color (#D91CD2)
  const ctaColor = design?.ctaColor || '#FFFFFF'; // editor default is white, not accent
  const ctaTextScale = design?.ctaTextScale || 1.0;

  // CTA text mapping — editor renders:
  //   BIG text = ctaMainText state ("AFROBOOST")     → saved in design.ctaMainText & branding.watermarkText
  //   Sub text = ctaSubText state ("CHAT POUR PLUS D'INFOS") → saved in design.ctaSubTextDesign & branding.ctaText
  // Note: branding naming is confusing (ctaText = editor's ctaSubText, watermarkText = editor's ctaMainText)
  const effectiveCtaText = design?.ctaMainText || watermark || 'AFROBOOST';
  const effectiveSubText = design?.ctaSubTextDesign || ctaText || "CHAT POUR PLUS D'INFOS";

  // CTA: black background — matches preview
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
  const scale = 0.92 + Math.min(1, progress * 3) * 0.08;
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(scale, scale); ctx.translate(-w / 2, -h / 2);

  // Font sizes matched to editor CSS:
  //   Editor (9:16): ctaMainText = 12px, ctaSubText = 9px, salesPhrase = 8px on 320px wide
  //   12/320 = 0.0375, 9/320 = 0.028, 8/320 = 0.025
  const isReel = h > w;
  const ctaFontSize = Math.round(w * (isReel ? 0.0375 : 0.031) * ctaTextScale);
  const salesFontSize = Math.round(w * (isReel ? 0.025 : 0.020) * ctaTextScale);
  const subFontSize = Math.round(w * (isReel ? 0.028 : 0.023) * ctaTextScale);

  // CTA position — editor uses translate(-50%, -100%) at watermarkPos (default: x=50%, y=97%)
  // This means the BOTTOM of the text block is at the specified Y position
  const ctaPosX = ((design?.watermarkPosition?.x ?? 50) / 100) * w;
  const ctaPosY = ((design?.watermarkPosition?.y ?? 97) / 100) * h;
  const ctaContainerW = w * ((design?.watermarkSize ?? 70) / 100);

  // Word-wrap CTA text within container width
  ctx.font = `900 ${ctaFontSize}px "${fontFamily}", sans-serif`;
  const ctaWords = effectiveCtaText.toUpperCase().split(' ');
  let ctaLines: string[] = [];
  let currentLine = '';
  for (const word of ctaWords) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (ctx.measureText(testLine).width > ctaContainerW && currentLine) {
      ctaLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) ctaLines.push(currentLine);

  // Measure total block height
  let blockH = 0;
  if (salesPhrase) blockH += salesFontSize * 1.5;
  blockH += ctaLines.length * ctaFontSize * 1.2;
  blockH += subFontSize * 1.5;

  // Bottom-anchored: block bottom at ctaPosY, so top = ctaPosY - blockH
  let curY = ctaPosY - blockH + ctaFontSize * 0.5;

  // Sales phrase — accent/ctaColor with transparency (matches preview: ctaColor + ee)
  if (salesPhrase) {
    ctx.font = `900 ${salesFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = hexToRgba(ctaColor, 0.93);
    ctx.fillText(salesPhrase, ctaPosX, curY);
    curY += salesFontSize * 1.5;
  }

  // Main CTA text — ctaColor, large, bold, uppercase (matches editor .uppercase class)
  ctaLines.forEach((line, i) => {
    ctx.font = `900 ${ctaFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = ctaColor;
    ctx.shadowColor = hexToRgba(ctaColor, 0.4); ctx.shadowBlur = Math.round(w * 0.02);
    ctx.fillText(line, ctaPosX, curY + i * (ctaFontSize * 1.2));
  });
  ctx.shadowBlur = 0;
  curY += ctaLines.length * ctaFontSize * 1.2;

  // Sub-text — user-configured color, 900 weight, uppercase (matches editor)
  ctx.font = `900 ${subFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = ctaSubColor;
  ctx.fillText(effectiveSubText.toUpperCase(), ctaPosX, curY + subFontSize * 0.3);

  // Logo on CTA if configured — uses per-sequence position
  if (logoImg && (!design?.logoSequences || design.logoSequences.includes('cta'))) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'cta');
    console.log(`[Composer] Logo CTA: pos=${JSON.stringify(pos)}, scale=${logoScale}`);
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
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
  console.log('[Composer] Design:', design ? JSON.stringify({ font: design.font, titleColor: design.titleColor, grad1: design.gradientColor1, logoPos: design.logoPosition, logoPositions: design.logoPositions, logoSeqs: design.logoSequences, logoScale: design.logoScale }) : 'NONE');

  // ── Normalize French sequence names → English ──
  // The editor (infographie) stores logoSequences with French names ('titre','cartes','video','cta')
  // but the draw functions check English names ('intro','cards','video','cta').
  const seqNameMap: Record<string, string> = { titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' };
  // Normalize logoPositions keys from French → English too
  const normalizedLogoPositions: Record<string, { x?: number; y?: number }> | undefined =
    design?.logoPositions
      ? Object.fromEntries(
          Object.entries(design.logoPositions).map(([k, v]) => [seqNameMap[k.toLowerCase()] || k, v])
        )
      : undefined;
  const normalizedDesign: DesignOptions | undefined = design
    ? {
        ...design,
        logoSequences: design.logoSequences?.map(s => seqNameMap[s.toLowerCase()] || s),
        logoPositions: normalizedLogoPositions,
      }
    : undefined;
  if (design?.logoSequences) {
    console.log('[Composer] logoSequences raw:', design.logoSequences, '→ normalized:', normalizedDesign?.logoSequences);
  }
  if (design?.logoPositions) {
    console.log('[Composer] logoPositions raw:', JSON.stringify(design.logoPositions), '→ normalized:', JSON.stringify(normalizedLogoPositions));
  }

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

  // Load visual media (with individual error logging)
  console.log('[Composer] Loading media:', { poster: posterUrl?.substring(0, 60) || 'NONE', logo: logoUrl?.substring(0, 30) || 'NONE', video: videoUrl?.substring(0, 60) || 'NONE' });
  const mediaLoadStart = performance.now();
  const [posterImg, logoImg, videoEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch((err) => { console.error('[Composer] ❌ Poster load FAILED:', err.message); return null; }) : null,
    logoUrl ? loadImage(logoUrl).catch((err) => { console.error('[Composer] ❌ Logo load FAILED:', err.message); return null; }) : null,
    videoUrl ? loadVideo(videoUrl).catch((err) => { console.error('[Composer] ❌ Video load FAILED:', err.message); return null; }) : null,
  ]);
  console.log(`[Composer] Media loaded in ${((performance.now() - mediaLoadStart) / 1000).toFixed(1)}s — poster:${!!posterImg} logo:${!!logoImg} video:${!!videoEl}`);

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
  console.log('[Composer] Audio — musicBuffer:', !!options.musicBuffer, 'voiceBuffer:', !!validVoiceBuffer, 'musicEl:', !!musicEl, 'voiceEl:', !!voiceEl, 'hasAudio:', hasAudio);

  // Critical check: if poster is needed but failed to load, abort early with clear error
  if (posterUrl && !posterImg) {
    throw new Error(`Impossible de charger l'image de fond (poster). Vérifiez que l'URL est accessible: ${posterUrl.substring(0, 80)}`);
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
        case 'intro': drawIntro(ctx, width, height, posterImg, logoImg, title, subtitle, accentColor, progress, normalizedDesign); break;
        case 'cards': drawCards(ctx, width, height, cards, logoImg, accentColor, progress, normalizedDesign); break;
        case 'video': drawVideoSeq(ctx, width, height, videoEl, logoImg, progress, normalizedDesign); break;
        case 'cta': drawCTA(ctx, width, height, accentColor, ctaText, ctaSubText, salesPhrase, watermarkText, logoImg, progress, normalizedDesign); break;
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
      const linkFontSize = Math.round(width * 0.0375 * stSize); // editor: 12/320 = 0.0375
      // Per-sequence position (matches editor drag positions)
      const stPos = getSiteTextPos(siteText, seq.type);
      const stX = (stPos.x / 100) * width;
      const stY = (stPos.y / 100) * height;
      ctx.save();
      ctx.font = `700 ${linkFontSize}px ${normalizedDesign?.font || 'sans-serif'}`; ctx.textAlign = 'center';
      ctx.fillStyle = hexToRgba(stColor, stOpacity);
      ctx.shadowColor = accentColor; ctx.shadowBlur = 8;
      fillTextWithOutline(ctx, siteTextLabel, stX, stY, 3, 'rgba(0,0,0,0.85)');
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
  // Check requestFrame support BEFORE choosing captureStream mode
  const useFastMode = !hasAudio;
  const testStream = canvas.captureStream(0);
  const testTrack = testStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const hasRequestFrame = testTrack && typeof testTrack.requestFrame === 'function';
  // Stop the test stream tracks
  testStream.getTracks().forEach(t => t.stop());
  // If requestFrame isn't supported, fall back to timed capture even in fast mode
  const useManualCapture = useFastMode && hasRequestFrame;
  if (useFastMode && !hasRequestFrame) {
    console.warn('[Composer] ⚠️ requestFrame not supported — falling back to timed captureStream for fast mode');
  }
  const videoStream = canvas.captureStream(useManualCapture ? 0 : fps);

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

      // Get video track for manual frame capture (only used if useManualCapture is true)
      const videoTrack = videoStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

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
          if (useManualCapture) videoTrack.requestFrame();
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
      if (useManualCapture) videoTrack.requestFrame();
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
  if (blob.size === 0) {
    console.error('[Composer] ❌ composeVideo produced an EMPTY blob (0 bytes). MediaRecorder likely failed to capture frames.');
    throw new Error('Le rendu vidéo a produit un fichier vide (0 octets). Votre navigateur ne supporte peut-être pas le codec vidéo requis. Essayez avec Chrome ou Edge.');
  }

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

  if (!url && blob.size > 0) {
    console.error('[Composer] ❌ Video blob created (' + (blob.size / 1024 / 1024).toFixed(1) + 'MB) but ALL upload strategies failed!');
    throw new Error(`Le montage a été créé (${(blob.size / 1024 / 1024).toFixed(1)}MB) mais l'upload a échoué. Vérifiez votre connexion internet et réessayez.`);
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
