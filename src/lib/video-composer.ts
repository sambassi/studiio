/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Uses <audio> elements + createMediaElementSource for GUARANTEED audio.
 * Audio elements handle MP3/OGG/WAV decoding natively (no OfflineAudioContext).
 * Outputs MP4 if supported, otherwise WebM.
 */
const COMPOSER_VERSION = 'v23-snapshot-parity-2026-04-19';
console.log(`[Composer] Loaded version: ${COMPOSER_VERSION}`);

// Exported so the calendar UI can detect stale videos and show a "Régénérer"
// button when a post was rendered by an older composer. Bump the version
// string every time the composer's visual output changes meaningfully.
export const CURRENT_COMPOSER_VERSION = COMPOSER_VERSION;

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface CardData {
  emoji: string;
  label: string;
  value: string;
  description?: string;
  color?: string;
  /** Pre-rendered icon image for SVG icons. When present, drawn on canvas instead of emoji text. */
  iconImage?: HTMLImageElement;
  /**
   * Free-positioning mode (per-card): x/y are percentages (0–100) of the
   * canvas dimensions (card center). When present, overrides the default
   * grid layout for this card. When absent, the card falls into the grid
   * at its natural index.
   */
  position?: { x: number; y: number };
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
  /** Cards-only text scale in percent (default 100). Independent of textScale
   *  so the card fonts can be grown/shrunk without touching title/CTA. */
  cardsTextScale?: number;
  /** Card style: 'Compact' | 'Educatif' | 'Stats Bold' | 'Minimal Line' | 'Full Width' */
  cardStyle?: string;
  /** Title position {x: 0-100, y: 0-100} (default: {x:50, y:75}) */
  titlePosition?: { x?: number; y?: number };
  /** Cards position {x: 0-100, y: 0-100} (default: {x:50, y:50}) */
  cardsPosition?: { x?: number; y?: number };
  /** Cards container width in % (default: 92) */
  cardsSize?: number;
  /** Pre-rendered DOM snapshot of the cards grid (via html2canvas in the
   *  editor). When present, drawCards short-circuits and blits this image
   *  directly for pixel-perfect WYSIWYG parity. Falls back to the manual
   *  canvas rendering pipeline when absent. */
  cardsSnapshot?: HTMLImageElement;
  /** Cards grid bounding rect relative to the editor preview, expressed
   *  in percent (0-100) of the preview container. When present, the
   *  composer uses this to position the snapshot WYSIWYG instead of
   *  centering on cardsPosition (which assumes the grid is centered and
   *  clips the top when the snapshot is tall). */
  cardsSnapshotRect?: { x: number; y: number; width: number; height: number };
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
    /** Gradient text fill */
    textGradient?: boolean;
    gradColor1?: string;
    gradColor2?: string;
    /** Duplicate/shadow text layer */
    duplicate?: boolean;
    duplicateOffset?: number;
    duplicateOpacity?: number;
  };
  /** CTA/Watermark position {x: 0-100, y: 0-100} (default: {x:50, y:97}) — editor uses translate(-50%, -100%) */
  watermarkPosition?: { x?: number; y?: number };
  /** CTA/Watermark container width % (default: 70) — matches editor watermarkSize */
  watermarkSize?: number;
  /** Video overlay text position {x: 0-100, y: 0-100} (default: {x:50, y:33}) */
  overlayPosition?: { x?: number; y?: number };
  /** Title container width % (default: 90) — matches editor titleSize */
  titleSize?: number;
  /** CTA typography (letterSpacing, lineHeight, optional gradient) */
  ctaTypography?: {
    letterSpacing?: number;
    lineHeight?: number;
    bold?: boolean;
    italic?: boolean;
    textGradient?: boolean;
    gradColor1?: string;
    gradColor2?: string;
  };
  /** Overlay typography (optional gradient) */
  overlayTypography?: {
    letterSpacing?: number;
    lineHeight?: number;
    bold?: boolean;
    italic?: boolean;
    textGradient?: boolean;
    gradColor1?: string;
    gradColor2?: string;
  };
  /** Per-element font overrides (undefined → inherit `font`). */
  titleFont?: string;
  ctaFont?: string;
  overlayFont?: string;
  watermarkFont?: string;
  cardsFont?: string;
  /** Watermark (large CTA banner) gradient. */
  watermarkTextGradient?: boolean;
  watermarkGradColor1?: string;
  watermarkGradColor2?: string;

  /**
   * Rounded rectangle backdrop — clips the per-sequence background
   * (and its gradient overlay) to a rounded rect inset from the canvas
   * edges. When off, behavior is identical to the pre-feature rect fill.
   */
  backdropRounded?: boolean;
  /** Corner radius in px at 1080-wide (scaled to actual video width). */
  backdropRadius?: number;
  /** Inner margin in percent (0..20). 0 = full-bleed, 5 = 5% margin. */
  backdropMargin?: number;
  /** Sequence-level gradient overrides (keys: 'titre'|'intro' 'cartes'|'cards' 'video' 'cta') */
  seqGradients?: Record<string, { enabled?: boolean; color1?: string; color2?: string; opacity?: number; position?: 'top' | 'bottom' | 'left' | 'right' | 'both' }>;
  /** No-color background flag */
  noColorBg?: boolean;
  /** Sequences with no color overlay */
  noColorSequences?: string[];
  /** Selected filter name */
  filter?: string;
  /** Inner-edge colored border applied on top of every sequence. */
  borderEnabled?: boolean;
  /** Hex color for the border (defaults to accentColor when enabled). */
  borderColor?: string;

  /**
   * Per-overlay scale multiplier applied to the legacy overlayText
   * (1.0 = 100 %). Extras carry their own `scale` inside `overlays`.
   */
  overlayTextScale?: number;
  /** Legacy overlay appears at this second (0 = whole video sequence). */
  overlayStartTime?: number;
  /** Legacy overlay disappears at this second (< 0 → plays until end). */
  overlayEndTime?: number;
  /**
   * Extra overlays beyond the legacy one. Each carries its own
   * text / position / color / typography / timing so drawVideoSeq can
   * stack multiple pieces of text on the video background.
   */
  overlays?: Array<{
    text: string;
    position: { x: number; y: number };
    color: string;
    scale: number;
    startTime: number;
    endTime: number; // < 0 → no end
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
  }>;
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
  /**
   * Alternative to `videoUrl`: a still image to display during the "video"
   * sequence (e.g. user uploaded a JPG/PNG in the Médias tab). Loaded as
   * HTMLImageElement and drawn in drawVideoSeq. If both videoUrl and
   * videoImageUrl are set, videoUrl (the real video) wins.
   */
  videoImageUrl?: string | null;
  /** Optional crop transform for the rush/background video (scale + fractional offsets). */
  rushTransform?: { scale?: number; offsetX?: number; offsetY?: number };
  logoUrl?: string | null;
  musicUrl?: string | null;
  voiceUrl?: string | null;
  musicVolume?: number;
  voiceVolume?: number;
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  watermarkText?: string;
  /** Free-plan "Studiio" watermark overlay (distinct from watermarkText which is CTA) */
  watermark?: boolean;
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
  // NOTE: design.logoPositions keys are already normalized from French → English
  // (titre→intro, cartes→cards) in composeAndUpload before being passed here
  const perSeq = design?.logoPositions?.[seq];
  if (perSeq && (perSeq.x !== undefined || perSeq.y !== undefined)) {
    return { x: perSeq.x ?? 50, y: perSeq.y ?? 85 };
  }
  return { x: design?.logoPosition?.x ?? 50, y: design?.logoPosition?.y ?? 85 };
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

/** Draw text with letter-spacing (Canvas 2D doesn't natively support it) */
function fillTextWithSpacing(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number
) {
  if (!spacing || spacing === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  // For center alignment, calculate total width first and offset
  const chars = Array.from(text);
  const totalExtra = (chars.length - 1) * spacing;
  const textWidth = ctx.measureText(text).width + totalExtra;
  let offsetX = 0;
  if (ctx.textAlign === 'center') offsetX = -textWidth / 2;
  else if (ctx.textAlign === 'right') offsetX = -textWidth;

  let curX = x + offsetX;
  const savedAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const char of chars) {
    ctx.fillText(char, curX, y);
    curX += ctx.measureText(char).width + spacing;
  }
  ctx.textAlign = savedAlign;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Tailwind's `drop-shadow-lg` is a COMPOUND shadow:
 *   drop-shadow(0 10px 8px rgb(0 0 0 / 0.04))
 *   drop-shadow(0 4px 3px  rgb(0 0 0 / 0.1))
 * Canvas's `ctx.shadow*` only supports ONE shadow. We emulate the compound
 * shadow via `ctx.filter`, scaled from the editor's 320-px viewport to canvas.
 * Returns the filter string to assign to `ctx.filter` — remember to reset it
 * to 'none' after drawing.
 */
function dropShadowLgFilter(w: number): string {
  const s = w / 320; // scale px from editor viewport to canvas
  const y1 = Math.max(1, Math.round(4 * s));
  const b1 = Math.max(1, Math.round(3 * s));
  const y2 = Math.max(1, Math.round(10 * s));
  const b2 = Math.max(1, Math.round(8 * s));
  return `drop-shadow(0 ${y1}px ${b1}px rgba(0,0,0,0.1)) drop-shadow(0 ${y2}px ${b2}px rgba(0,0,0,0.04))`;
}

/** Tailwind's `drop-shadow` (base) is a single softer shadow. Used for subtitle/cards. */
function dropShadowBaseFilter(w: number): string {
  const s = w / 320;
  const y = Math.max(1, Math.round(1 * s));
  const b = Math.max(1, Math.round(2 * s));
  return `drop-shadow(0 ${y}px ${b}px rgba(0,0,0,0.1))`;
}

/** Truncate a string at a word boundary before `maxChars`, append an
 *  ellipsis when cut. MUST mirror `truncateAtWord` in creer/page.tsx
 *  and calendar/page.tsx so the composer, editor and calendar agree
 *  on what a truncated description looks like. */
function truncateAtWord(text: string | undefined, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[\s,;:.!?-]+$/, '') + '…';
}

/** Truncate text with ellipsis so it fits within `maxWidth`. Preserves the
 *  CSS `truncate` behaviour used by Full Width card labels/descriptions. */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text || maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
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
// SEQUENCE NAME NORMALIZATION
// ═══════════════════════════════════════════════════════════
// The editor stores sequence keys in French ('titre','cartes','video','cta')
// but the draw functions think in English ('intro','cards','video','cta').
// Keep a single source of truth for both directions.

const SEQ_NAME_MAP: Record<string, string> = { titre: 'intro', cartes: 'cards', video: 'video', cta: 'cta' };
const SEQ_NAME_REVERSE: Record<string, string> = { intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta' };

/**
 * Look up a per-sequence gradient override with FR-key fallback.
 * `seq` is the English name ('intro'|'cards'|'video'|'cta').
 */
function resolveSeqGradient(
  design: DesignOptions | undefined, seq: string
): { enabled: boolean; color1: string; color2: string; opacity: number; position: 'top'|'bottom'|'left'|'right'|'both' } {
  const frKey = SEQ_NAME_REVERSE[seq] || seq;
  const override = design?.seqGradients?.[seq] ?? design?.seqGradients?.[frKey];
  // Editor default: video has gradient disabled, others enabled
  const defaultEnabled = seq === 'video' ? false : true;
  // Honor per-sequence color overrides to match the editor's CSS preview
  // (page.tsx `getSeqGradient`, line ~1308: `override?.color1 || gradientColor1`).
  // The editor's overlay uses the override when present and falls back to the
  // global gradientColor1/2 otherwise — the composer must mirror that or the
  // export will diverge from the preview. Prior revisions ignored overrides
  // to mask stale `seqGradients.titre.color1` entries carried over from old
  // configs; the real fix there is to align with the editor, which already
  // decides what's authoritative.
  return {
    enabled: override?.enabled ?? defaultEnabled,
    color1: override?.color1 || design?.gradientColor1 || '#7C3AED',
    color2: override?.color2 || design?.gradientColor2 || '#EC4899',
    opacity: override?.opacity ?? design?.gradientOpacity ?? 0.3,
    position: override?.position || 'both',
  };
}

/**
 * Paint the per-sequence gradient matching the editor's CSS output exactly
 * (see page.tsx:3098-3148). Respects:
 *   - `design.noColorBg` / `design.noColorSequences` → solid dark #0A0A0F
 *   - `seqGradients[seq].enabled === false` → no paint (caller already cleared or drew a background)
 *   - `position`: 'top' | 'bottom' | 'left' | 'right' | 'both'
 *   - `opacity > 1` → second layer for >100% intensity
 */
/**
 * Paint an inner-edge colored border on top of the current frame. Kept
 * inset (via a stroke centered on the inner edge) so it doesn't bleed
 * past the canvas on the outside. Matches the CSS border the editor
 * preview uses when branding.borderEnabled is on.
 */
function paintBorder(
  ctx: CanvasRenderingContext2D, w: number, h: number, design?: DesignOptions,
  fallbackAccent: string = '#D91CD2'
): void {
  if (!design?.borderEnabled) return;
  const color = design.borderColor || fallbackAccent;
  // ~8-12px at 1080w; scale with canvas width so exports at different
  // resolutions match the preview thickness.
  const lineWidth = Math.max(6, Math.round(w * 0.01));
  const half = lineWidth / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(half, half, w - lineWidth, h - lineWidth);
  ctx.restore();
}

function paintSeqGradient(
  ctx: CanvasRenderingContext2D, w: number, h: number, seq: string, design?: DesignOptions
): void {
  // NOTE: noColor mode is a BACKDROP concern, not an overlay concern.
  // Handled by paintSeqBackdrop. Previously we painted `#0A0A0F` here too,
  // which wiped out any existing poster in drawIntro when the intro was
  // listed in `noColorSequences`.
  const g = resolveSeqGradient(design, seq);
  if (!g.enabled || g.opacity <= 0) return;

  const paintLayer = (alpha: number) => {
    if (alpha <= 0) return;
    const c1 = hexToRgba(g.color1, alpha);
    const c2 = hexToRgba(g.color2, alpha);
    let grad: CanvasGradient;
    switch (g.position) {
      case 'top':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, c1);
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        break;
      case 'bottom':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        grad.addColorStop(1, c2);
        break;
      case 'left':
        grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, c1);
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        break;
      case 'right':
        grad = ctx.createLinearGradient(w, 0, 0, 0);
        grad.addColorStop(0, c1);
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        break;
      case 'both':
      default:
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, c1);
        grad.addColorStop(0.4, 'rgba(0,0,0,0)');
        grad.addColorStop(0.6, 'rgba(0,0,0,0)');
        grad.addColorStop(1, c2);
        break;
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  };

  // First layer: opacity clamped to 1
  paintLayer(Math.min(g.opacity, 1));
  // Second layer for >100% intensity (matches editor)
  if (g.opacity > 1) paintLayer(g.opacity - 1);
}

/**
 * Paint the SEQUENCE BACKDROP — i.e. the base fill under everything else.
 * Matches the editor's `activeColorTheme.bg` (a `bg-gradient-to-br` Tailwind
 * class): a diagonal gradient from `gradientColor1` (top-left) to
 * `gradientColor2` (bottom-right). Without this, the composer used a
 * hard-coded `#0A0A0F` which turned any dark CTA text into "black on black".
 *
 * When the sequence is listed in `noColorSequences` AND `noColorBg` is true,
 * we paint the editor's dark `#0A0A0F` (matches the no-color mode).
 */
function paintSeqBackdrop(
  ctx: CanvasRenderingContext2D, w: number, h: number, seq: string,
  design: DesignOptions | undefined, accent: string
): void {
  const editorSeq = SEQ_NAME_REVERSE[seq] || seq;
  const listedAsNoColor = design?.noColorSequences?.includes(seq)
    || design?.noColorSequences?.includes(editorSeq);
  if (listedAsNoColor) {
    ctx.fillStyle = '#0A0A0F';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // Color-theme gradient backdrop. MUST mirror the editor's preview which uses
  // `linear-gradient(135deg, ${gradientColor1}, ${gradientColor2})` directly —
  // never the color-theme `accent` (which can be green when the user picks the
  // green theme, producing a green/purple export bg even though the editor
  // shows pure purple). Fall back ONLY to the violet defaults if the editor
  // somehow sent empty strings.
  const c1 = design?.gradientColor1 || '#7C3AED';
  const c2 = design?.gradientColor2 || '#EC4899';
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ═══════════════════════════════════════════════════════════
// SEQUENCE RENDERERS
// ═══════════════════════════════════════════════════════════

function drawIntro(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  posterImg: HTMLImageElement | null, logoImg: HTMLImageElement | null,
  title: string, subtitle: string | undefined, _accent: string, _progress: number,
  design?: DesignOptions
) {
  const fontFamily = design?.titleFont || design?.font || 'sans-serif';
  const titleColor = design?.titleColor || '#FFFFFF';

  // Background: poster image (if any) covers the canvas. When no poster is
  // set, paint the color-theme backdrop (or dark if noColor). Then the
  // seqGradient OVERLAY is drawn on top in BOTH cases — that's what the
  // editor does (poster img + gradient div overlaid on top).
  if (posterImg) {
    const scale = Math.max(w / posterImg.width, h / posterImg.height);
    const sw = posterImg.width * scale, sh = posterImg.height * scale;
    ctx.drawImage(posterImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
  } else {
    paintSeqBackdrop(ctx, w, h, 'intro', design, _accent);
  }
  paintSeqGradient(ctx, w, h, 'intro', design);

  // Title sizing and position — matched to editor CSS:
  //   Editor (9:16): fontSize = 14 * textScale px on 320px wide = 14/320 = 0.04375 of width
  //   Editor (16:9): fontSize = 18 * textScale px on 512px wide ≈ 0.035 of width
  //   Subtitle: 9/320 = 0.028 (9:16), 11/512 = 0.0215 (16:9)
  //   Default title position: Y=10% from top (editor), not 75%
  const textScale = design?.textScale || 1.0;
  // NO animation — editor is static, video must match exactly
  const titleAlpha = 1;
  const isReel = h > w; // 9:16 = reel, 16:9 = landscape
  const fontSize = Math.round(w * (isReel ? 0.04375 : 0.035) * textScale);
  const subFontSize = Math.round(w * (isReel ? 0.028 : 0.0215) * textScale);

  // Position from design metadata — editor default is (50%, 10%)
  // The editor uses translate(-50%, 0) so Y% is the TOP edge of the text block
  const titlePosX = ((design?.titlePosition?.x ?? 50) / 100) * w;
  const titlePosY = ((design?.titlePosition?.y ?? 10) / 100) * h;

  const fontWeight = design?.titleTypography?.bold !== false ? 900 : 400;
  const fontStyle = design?.titleTypography?.italic ? 'italic ' : '';
  const titleLetterSpacing = (design?.titleTypography?.letterSpacing || 0) * (w / 320); // scale px from editor viewport

  // Title text — editor does NOT force uppercase, preserves original case
  // Editor uses width constraint (titleSize%, default 90%) for wrapping
  const titleWidth = w * ((design?.titleSize ?? 90) / 100);
  ctx.save();
  // Use 'top' baseline so Y coordinate = top edge of text (matches CSS top: Y%)
  ctx.textBaseline = 'top';
  ctx.font = `${fontStyle}${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
  ctx.fillStyle = hexToRgba(titleColor, titleAlpha);
  // Editor uses Tailwind `drop-shadow-lg` — a COMPOUND filter that single-shadow
  // ctx.shadow* cannot reproduce. Use ctx.filter to match exactly.
  ctx.filter = dropShadowLgFilter(w);
  // Make sure no legacy ctx.shadow* values leak through and double-shadow
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowOffsetX = 0;

  // Word-wrap title to match editor behavior (text wraps within titleWidth)
  const titleLines = wrapText(ctx, title, titleWidth);
  const lineSpacing = fontSize * (design?.titleTypography?.lineHeight || 1.1);
  // With textBaseline='top', Y = top of text — matches CSS top: Y% with translate(-50%, 0)
  let titleDrawY = titlePosY;

  // Title duplicate/shadow layer (editor feature: duplicated text offset behind main text)
  const hasDuplicate = design?.titleTypography && (design.titleTypography as any).duplicate;
  if (hasDuplicate) {
    const dupOffset = ((design!.titleTypography as any).duplicateOffset || 5) * (w / 320);
    const dupOpacity = (design!.titleTypography as any).duplicateOpacity || 0.3;
    ctx.save();
    ctx.filter = 'none';
    ctx.fillStyle = hexToRgba(titleColor, titleAlpha * dupOpacity);
    for (let i = 0; i < titleLines.length; i++) {
      fillTextWithSpacing(ctx, titleLines[i], titlePosX + dupOffset, titleDrawY + i * lineSpacing + dupOffset, titleLetterSpacing);
    }
    ctx.restore();
    // Restore main text style (save/restore already restored filter, but reset explicitly)
    ctx.textBaseline = 'top';
    ctx.font = `${fontStyle}${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = hexToRgba(titleColor, titleAlpha);
    ctx.filter = dropShadowLgFilter(w);
  }

  // Text gradient support: editor uses linear-gradient(135deg, color1, color2) + background-clip: text
  const hasTextGradient = design?.titleTypography?.textGradient;
  const gradC1 = (design?.titleTypography as any)?.gradColor1 || '#FFD700';
  const gradC2 = (design?.titleTypography as any)?.gradColor2 || '#FF6B6B';

  // Main title text — draw shadow pass first, then gradient pass on top
  if (hasTextGradient) {
    // Pass 1: draw text with compound drop-shadow in solid color for shadow layer
    for (let i = 0; i < titleLines.length; i++) {
      if (titleLetterSpacing) {
        fillTextWithSpacing(ctx, titleLines[i], titlePosX, titleDrawY + i * lineSpacing, titleLetterSpacing);
      } else {
        ctx.fillText(titleLines[i], titlePosX, titleDrawY + i * lineSpacing);
      }
    }
    // Disable filter before the gradient overlay pass so the gradient fill
    // itself doesn't get re-shadowed (editor clips the gradient inside text).
    ctx.filter = 'none';

    // Pass 2: overdraw with gradient fill (no shadow)
    // 135deg gradient: from top-left to bottom-right across the text block
    const totalTextH = titleLines.length * lineSpacing;
    const textGrad = ctx.createLinearGradient(
      titlePosX - titleWidth / 2, titleDrawY,
      titlePosX + titleWidth / 2, titleDrawY + totalTextH
    );
    textGrad.addColorStop(0, gradC1);
    textGrad.addColorStop(1, gradC2);
    ctx.fillStyle = textGrad;
    for (let i = 0; i < titleLines.length; i++) {
      if (titleLetterSpacing) {
        fillTextWithSpacing(ctx, titleLines[i], titlePosX, titleDrawY + i * lineSpacing, titleLetterSpacing);
      } else {
        ctx.fillText(titleLines[i], titlePosX, titleDrawY + i * lineSpacing);
      }
    }
  } else {
    // No gradient — single pass with solid color (filter already drop-shadow-lg)
    for (let i = 0; i < titleLines.length; i++) {
      if (titleLetterSpacing) {
        fillTextWithSpacing(ctx, titleLines[i], titlePosX, titleDrawY + i * lineSpacing, titleLetterSpacing);
      } else {
        ctx.fillText(titleLines[i], titlePosX, titleDrawY + i * lineSpacing);
      }
    }
    ctx.filter = 'none';
  }

  const titleBlockBottom = titleDrawY + (titleLines.length - 1) * lineSpacing + fontSize;

  // Subtitle below title — no animation, static like editor
  // Editor: mt-1 (4px on 320px), color = titleColor+cc (80%), drop-shadow (base, not lg)
  // Wraps to fit within the same `titleWidth` as the title (CSS .mt-1 div is
  // a child of the same width-constrained title container). Without wrapping,
  // long subtitles overflow the right edge of the canvas.
  if (subtitle) {
    ctx.font = `${fontStyle}${fontWeight} ${subFontSize}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = hexToRgba(titleColor, 0.8);
    ctx.filter = dropShadowBaseFilter(w);
    const mt1 = Math.round(w * (4 / 320));
    const subLines = wrapText(ctx, subtitle, titleWidth);
    const subLineSpacing = subFontSize * (design?.titleTypography?.lineHeight || 1.1);
    for (let i = 0; i < subLines.length; i++) {
      ctx.fillText(subLines[i], titlePosX, titleBlockBottom + mt1 + i * subLineSpacing);
    }
    ctx.filter = 'none';
  }

  // Accent line removed — not present in editor, video must match exactly

  // Logo on intro if configured — uses per-sequence position
  // Uses drawLogoAccurate to match editor's h-8 w-auto max-w-[60px] scale(logoScale)
  if (logoImg && design?.logoSequences?.includes('intro')) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'intro');
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
  }

  // Bottom accent bar removed — not present in editor

  ctx.restore();
}

function drawCards(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  cards: CardData[], logoImg: HTMLImageElement | null, accent: string, _progress: number,
  design?: DesignOptions
) {
  // eslint-disable-next-line no-console
  console.log('[Composer] drawCards: snapshot in design?', !!design?.cardsSnapshot);
  const fontFamily = design?.cardsFont || design?.font || 'sans-serif';
  const textScale = design?.textScale || 1.0;
  const cardStyle = design?.cardStyle || 'Full Width';
  const isReel = h > w; // 9:16 = reel, 16:9 = landscape

  // Backdrop from the color theme (or dark if the sequence is marked noColor),
  // then the seqGradient overlay on top. Matches editor's bg-gradient-to-br.
  paintSeqBackdrop(ctx, w, h, 'cards', design, accent);
  paintSeqGradient(ctx, w, h, 'cards', design);

  // Snapshot override : if a pre-rendered cards PNG is provided, draw
  // it directly for pixel-perfect parity with the editor. Falls back
  // to the manual canvas drawing below if the snapshot is missing.
  //
  // The editor captures html2canvas at scale `videoW / previewEl.offsetWidth`,
  // so snap.width / snap.height already represent the exact pixel size the
  // cards occupy on the video canvas (for GRID: cardsSize% × videoW; for
  // FREE mode where the wrapper is `absolute inset-0`: full videoW/videoH).
  // We draw at natural bitmap size and just position via cardsPosition.
  if (design?.cardsSnapshot) {
    const snap = design.cardsSnapshot;
    // WYSIWYG branch: when the editor measured the cards grid rect relative
    // to the preview and forwarded it, use those exact bounds. This avoids
    // the top-clipping bug where a tall snapshot centered on cardsPosition.y
    // gives a negative snapY.
    if (design.cardsSnapshotRect) {
      const rect = design.cardsSnapshotRect;
      const drawX = (rect.x / 100) * w;
      const drawY = (rect.y / 100) * h;
      const drawW = (rect.width / 100) * w;
      const drawH = (rect.height / 100) * h;
      // eslint-disable-next-line no-console
      console.log('[Composer] Drawing cards from SNAPSHOT (rect)', snap.width, 'x', snap.height, '→', drawX, drawY, drawW, drawH);
      ctx.drawImage(snap, drawX, drawY, drawW, drawH);
      return;
    }
    const snapW = snap.width;
    const snapH = snap.height;
    const snapX = ((design?.cardsPosition?.x ?? 50) / 100) * w - snapW / 2;
    const snapY = ((design?.cardsPosition?.y ?? 50) / 100) * h - snapH / 2;
    // eslint-disable-next-line no-console
    console.log('[Composer] Drawing cards from SNAPSHOT', snapW, 'x', snapH, 'at', Math.round(snapX), Math.round(snapY));
    ctx.drawImage(snap, snapX, snapY, snapW, snapH);
    return;  // short-circuit — don't draw manual cards
  }

  // Card sizes from design or defaults
  const containerW = Math.round(w * ((design?.cardsSize || 92) / 100));
  // Editor: 9:16 shows max 5 cards, 16:9 shows max 6 cards
  const maxCards = Math.min(cards.length, isReel ? 5 : 6);

  // Editor preview viewport: 320px (9:16) or 512px (16:9). The editor uses
  // FIXED Tailwind/css px values for fonts and paddings (e.g. 7px label,
  // 6px gap), regardless of which format. To reproduce on the canvas we
  // must scale by `w / editorViewportPx` — using the wrong viewport ratio
  // makes 16:9 cards' fonts 60% too large vs the editor and labels overflow
  // the card boundary (user's "MITOCHONDRIES" label was clipping into the
  // adjacent card).
  const editorViewportPx = isReel ? 320 : 512;
  const cardsSizeScale = (design?.cardsSize || 92) / 92; // normalize: 92% = 1x (default)
  // Editor's card-only text multiplier (100 = 1x). Lets card fonts grow/shrink
  // independently of the global textScale — MUST match page.tsx `cardsTextScale`.
  const cardsTextMul = (design?.cardsTextScale ?? 100) / 100;
  const fontPx = (cssPx: number) => Math.round(w * cssPx / editorViewportPx * textScale * cardsSizeScale * cardsTextMul);
  // Same as fontPx but WITHOUT textScale — for elements the editor renders
  // at a fixed pixel size regardless of the global text scale (notably the
  // emoji on Compact/Educatif/etc cards, which uses Tailwind `text-sm`/
  // `text-lg` and is not multiplied by textScale in the editor).
  const fixedFontPx = (cssPx: number) => Math.round(w * cssPx / editorViewportPx);
  // Non-font CSS pixels (padding, gap, border, radius) also live in the
  // editor's fixed-pixel Tailwind world.
  const cssPx = (pxAt320: number) => Math.max(1, Math.round(w * pxAt320 / editorViewportPx));

  // Editor emoji is `text-sm` (14px) for 9:16 / `text-lg` (18px) for 16:9,
  // NOT scaled by textScale. Previously fontPx(14) scaled it 2.2× when the
  // user had textScale=2.2, blowing up card heights and pushing content
  // into adjacent cards.
  const emojiSize = fixedFontPx(isReel ? 14 : 18);

  /**
   * Free-positioning mode: if a card has a `position: { x, y }` (percentages
   * of canvas, card center), translate the computed grid-top-left (x, y) to
   * honour the custom position. Returns adjusted { x, y } top-left.
   */
  const applyCardPos = (card: CardData, x: number, y: number, cardW: number, cardH: number) => {
    if (!card.position) return { x, y };
    const cx = (card.position.x / 100) * w;
    const cy = (card.position.y / 100) * h;
    return { x: cx - cardW / 2, y: cy - cardH / 2 };
  };
  const labelSize = fontPx(7);
  const valueSize = fontPx(9);
  const descSize = fontPx(6);
  // Editor: rounded-lg = 8px in the editor viewport.
  const radius = Math.max(2, cssPx(8));

  // ── Card style: Stats Bold ──
  // Editor (infographie/page.tsx:3429-3452):
  //   grid per `previewClasses.cols` (grid-cols-2 for 9:16, grid-cols-3 for 16:9)
  //   flex flex-col items-center justify-center rounded-lg bg-black/50 px-2 py-2
  //   border border-white/10
  //   Row 1: value (13 * textScale px, font-black, card.color, drop-shadow)
  //   Row 2: label (6 * textScale px, font-medium 500, text-white/80, mt-0.5)
  if (cardStyle === 'Stats Bold') {
    const cols = isReel ? 2 : 3;
    const gap = cssPx(6); // gap-1.5
    const cardW = Math.round((containerW - (cols - 1) * gap) / cols);
    const paddingY = cssPx(8);   // py-2
    const paddingX = cssPx(8);   // px-2
    const innerGap = cssPx(2);   // mt-0.5
    const bigValueSize = Math.round(w * 0.041 * textScale); // 13/320
    const contentH = bigValueSize + innerGap + descSize;
    const cardH = contentH + paddingY * 2;
    const rows = Math.ceil(maxCards / cols);
    const totalH = rows * cardH + (rows - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - containerW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const gridX = cardsX + col * (cardW + gap);
      const gridY = cardsY + row * (cardH + gap);
      const { x, y } = applyCardPos(card, gridX, gridY, cardW, cardH);

      // bg-black/50 rounded-lg
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.fill();
      // border border-white/10
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.stroke();

      ctx.textBaseline = 'top';
      // Center content block vertically inside card (items-center justify-center).
      let curY = y + (cardH - contentH) / 2;

      // Row 1: value (big, font-black, card.color, drop-shadow)
      ctx.font = `900 ${bigValueSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = 'center'; ctx.fillStyle = card.color || accent;
      ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
      ctx.fillText(card.value, x + cardW / 2, curY);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      curY += bigValueSize + innerGap;

      // Row 2: label (small, font-medium, text-white/80)
      ctx.font = `500 ${descSize}px "${fontFamily}", sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(card.label, x + cardW / 2, curY);

      // Keep paddingX referenced (lint-safe for unused var in some paths).
      void paddingX;

      ctx.textBaseline = 'alphabetic';
    });
  }
  // ── Card style: Compact (column layout: emoji, label, value, description centered) ──
  // Editor: flex flex-col items-center gap-0.5 rounded-lg bg-black/30 px-1.5 py-1.5
  //         borderLeft: 2px solid card.color
  //         Emoji (text-sm=14px), Label (7px bold), Value (9px black), Description (6px white/60)
  else if (cardStyle === 'Compact') {
    const cols = isReel ? 2 : 3; // Editor: grid-cols-2 (9:16), grid-cols-3 (16:9)
    const gap = cssPx(6); // gap-1.5 = 6px on 320px editor
    const cardW = Math.round((containerW - (cols - 1) * gap) / cols);
    const paddingY = cssPx(6); // py-1.5 = 6px on 320px
    const paddingX = cssPx(6); // px-1.5
    const innerGap = cssPx(2); // gap-0.5 = 2px on 320px
    const emojiSizeLocal = fixedFontPx(isReel ? 14 : 18);
    // Tailwind preflight sets line-height: 1.5 on html, inherited by
    // all <p> children. text-sm/text-lg classes carry ~1.4× leading.
    // Canvas 2D has no line-height built-in, so without these
    // multipliers the composer renders cards ~22% shorter.
    const lineMul = 1.5;
    const emojiLineMul = 1.4;
    const emojiLineH = emojiSizeLocal * emojiLineMul;

    // Pre-measure each card's wrapped lines. Cap EACH element to 2 lines
    // max (label / value / desc) so no single card stretches taller than
    // ~2× its neighbours and spills text into the next row. Long trailing
    // content is truncated with an ellipsis via `truncateToWidth` on the
    // 2nd line.
    const safety = Math.max(2, cssPx(4));
    const innerW = cardW - paddingX * 2 - safety;
    const clipLines = (lines: string[]) => lines.map(l =>
      ctx.measureText(l).width > innerW ? truncateToWidth(ctx, l, innerW) : l
    );
    const capLines = (lines: string[], maxN: number): string[] => {
      if (lines.length <= maxN) return clipLines(lines);
      // Keep (maxN-1) lines as-is, then truncate the joined remainder onto one
      // final line so nothing is silently dropped.
      const head = lines.slice(0, maxN - 1);
      const tail = lines.slice(maxN - 1).join(' ');
      return clipLines([...head, truncateToWidth(ctx, tail, innerW)]);
    };
    type Pre = { labelLines: string[]; valueLines: string[]; descLines: string[] };
    const pre: Pre[] = cards.slice(0, maxCards).map(card => {
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`;
      const labelLines = capLines(wrapText(ctx, card.label, innerW), 2);
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`;
      const valueLines = capLines(wrapText(ctx, card.value, innerW), 2);
      let descLines: string[] = [];
      if (card.description) {
        const descText = truncateAtWord(card.description, 70);
        ctx.font = `400 ${descSize}px "${fontFamily}", sans-serif`;
        descLines = capLines(wrapText(ctx, descText, innerW), 2);
      }
      return { labelLines, valueLines, descLines };
    });

    // Card height = MAX of all cards' content heights so all cards in the
    // grid stay aligned and the same shape (matches CSS grid behaviour).
    const labelH = (n: number) => n * labelSize * lineMul;
    const valueH = (n: number) => n * valueSize * lineMul;
    const descH = (n: number) => n * descSize * lineMul;
    const contentHs = pre.map(p =>
      emojiLineH + innerGap +
      labelH(p.labelLines.length) + innerGap +
      valueH(p.valueLines.length) +
      (p.descLines.length > 0 ? innerGap + descH(p.descLines.length) : 0)
    );
    const cardContentH = Math.max(...contentHs, 0);
    const cardH = cardContentH + paddingY * 2;
    const rows = Math.ceil(maxCards / cols);
    const totalH = rows * cardH + (rows - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - containerW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const gridX = cardsX + col * (cardW + gap);
      const gridY = cardsY + row * (cardH + gap);
      const { x, y } = applyCardPos(card, gridX, gridY, cardW, cardH);
      const { labelLines, valueLines, descLines } = pre[i];

      // Background: bg-black/30 rounded-lg
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.fill();
      // Left accent border: 2px solid card.color — painted FULL height.
      ctx.fillStyle = card.color || accent;
      const bw = cssPx(2);
      ctx.fillRect(x, y, bw, cardH);

      ctx.textBaseline = 'top';
      let curY = y + paddingY;

      // Icon or emoji (skipped when empty → re-center content vertically)
      const hasEmoji = !!card.emoji && card.emoji.trim() !== '';
      if (hasEmoji) {
        const iconY = curY + (emojiLineH - emojiSizeLocal) / 2;
        if (card.iconImage) {
          ctx.drawImage(card.iconImage, x + cardW / 2 - emojiSizeLocal / 2, iconY, emojiSizeLocal, emojiSizeLocal);
        } else {
          if (/^[A-Z]/.test(card.emoji)) {
            console.warn('[Composer] Card has Lucide icon name but no iconImage — preRenderCardIcons may have failed:', card.emoji);
          }
          ctx.font = `${emojiSizeLocal}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = 'white';
          ctx.fillText(card.emoji, x + cardW / 2, iconY);
        }
        curY += emojiLineH + innerGap;
      } else {
        curY += (emojiLineH + innerGap) / 2;
      }

      // Label (multi-line)
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
      labelLines.forEach((line, li) => {
        ctx.fillText(line, x + cardW / 2, curY + li * labelSize * lineMul);
      });
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      curY += labelH(labelLines.length) + innerGap;

      // Value (multi-line)
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = card.color || accent;
      ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
      valueLines.forEach((line, li) => {
        ctx.fillText(line, x + cardW / 2, curY + li * valueSize * lineMul);
      });
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      curY += valueH(valueLines.length);

      // Description (multi-line, max 2)
      if (descLines.length > 0) {
        curY += innerGap;
        ctx.font = `400 ${descSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
        descLines.forEach((line, li) => {
          ctx.fillText(line, x + cardW / 2, curY + li * descSize * lineMul);
        });
      }

      ctx.textBaseline = 'alphabetic';
    });
  }
  // ── Card style: Educatif ──
  // Editor (infographie/page.tsx:3394-3427):
  //   rounded-lg bg-black/40 px-2 py-2  borderTop: 2px solid card.color
  //   Row 1: emoji (text-sm) + label (scaledLabel bold white) with gap-1.5
  //   Row 2: description (scaledDesc, text-white/70) max 60 chars
  //   Row 3: value (scaledValue font-black, color: card.color)
  //   Grid: editor uses previewClasses.cols → grid-cols-2 (9:16) or grid-cols-3 (16:9).
  else if (cardStyle === 'Educatif') {
    const cols = isReel ? 2 : 3;
    const gridGap = cssPx(6); // gap-1.5
    const cardW = Math.round((containerW - (cols - 1) * gridGap) / cols);
    const paddingX = cssPx(8);   // px-2 = 8px on 320px
    const paddingY = cssPx(8);   // py-2 = 8px on 320px
    const rowGap = cssPx(4);      // mb-1 = 4px between rows
    const emojiGap = cssPx(6);    // gap-1.5 emoji↔label row
    // Card height from content: padding + row1 + gap + row2 + gap + row3 + padding
    const row1H = Math.max(emojiSize, labelSize);
    // Description wraps to at most 2 lines
    const descLineH = descSize * 1.4; // leading-relaxed ≈ 1.625, tighten to 1.4 for canvas
    const row2H = descLineH * 2;
    const row3H = valueSize;
    const cardH = paddingY * 2 + row1H + rowGap + row2H + rowGap + row3H;
    const rows = Math.ceil(maxCards / cols);
    const totalH = rows * cardH + (rows - 1) * gridGap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - containerW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const gridX = cardsX + col * (cardW + gridGap);
      const gridY = cardsY + row * (cardH + gridGap);
      const { x, y } = applyCardPos(card, gridX, gridY, cardW, cardH);

      // Background bg-black/40 rounded-lg
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.fill();
      // borderTop: 2px solid card.color — full width, top edge
      const topBw = cssPx(2);
      ctx.fillStyle = card.color || accent;
      ctx.fillRect(x, y, cardW, topBw);

      ctx.textBaseline = 'top';
      let curY = y + paddingY;
      const contentX = x + paddingX;

      // Row 1: emoji + label (horizontal). When emoji is empty, label starts at contentX (no offset).
      const hasEmojiEdu = !!card.emoji && card.emoji.trim() !== '';
      let labelStartX = contentX;
      if (hasEmojiEdu) {
        if (card.iconImage) {
          ctx.drawImage(card.iconImage, contentX, curY, emojiSize, emojiSize);
          labelStartX = contentX + emojiSize + emojiGap;
        } else {
          ctx.font = `${emojiSize}px sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = '#FFFFFF';
          ctx.fillText(card.emoji, contentX, curY);
          const emojiW = ctx.measureText(card.emoji).width;
          labelStartX = contentX + emojiW + emojiGap;
        }
      }
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF';
      ctx.fillText(card.label, labelStartX, curY + (row1H - labelSize) / 2);
      curY += row1H + rowGap;

      // Row 2: description (text-white/70, max 90 chars, 2 lines)
      if (card.description) {
        const descText = truncateAtWord(card.description, 90);
        ctx.font = `400 ${descSize}px "${fontFamily}", sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const descLines = wrapText(ctx, descText, cardW - paddingX * 2);
        descLines.slice(0, 2).forEach((line, li) => {
          ctx.fillText(line, contentX, curY + li * descLineH);
        });
      }
      curY += row2H + rowGap;

      // Row 3: value (font-black, color: card.color)
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`;
      ctx.fillStyle = card.color || accent;
      ctx.fillText(card.value, contentX, curY);

      ctx.textBaseline = 'alphabetic';
    });
  }
  // ── Card style: Minimal Line ──
  // Editor (infographie/page.tsx:3454-3480):
  //   flex items-center gap-2 py-1 px-1
  //   borderBottom: 1px solid ${card.color}40  (25% alpha)
  //   emoji text-xs (12 * textScale), label scaledLabel white/80 flex-1,
  //   value scaledValue font-bold card.color
  //   Grid: editor uses previewClasses.cols → grid-cols-2 (9:16) or grid-cols-3 (16:9).
  else if (cardStyle === 'Minimal Line') {
    const cols = isReel ? 2 : 3;
    const gridGap = cssPx(6); // gap-1.5
    const cardW = Math.round((containerW - (cols - 1) * gridGap) / cols);
    const paddingY = cssPx(4);   // py-1
    const paddingX = cssPx(4);   // px-1
    const contentGap = cssPx(8); // gap-2 between flex items
    // Minimal Line uses text-xs for emoji (12 * textScale)
    // Editor uses fixed text-xs (12px), not scaled by textScale.
    const minEmojiSize = fixedFontPx(12);
    const rowH = Math.max(minEmojiSize, labelSize, valueSize);
    const cardH = rowH + paddingY * 2;
    const rows = Math.ceil(maxCards / cols);
    const totalH = rows * cardH + (rows - 1) * gridGap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - containerW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const gridX = cardsX + col * (cardW + gridGap);
      const gridY = cardsY + row * (cardH + gridGap);
      const { x, y } = applyCardPos(card, gridX, gridY, cardW, cardH);

      // borderBottom: 1px solid card.color @ 25% alpha
      ctx.strokeStyle = hexToRgba(card.color || accent, 0.25);
      ctx.lineWidth = Math.max(1, cssPx(1));
      ctx.beginPath();
      ctx.moveTo(x, y + cardH);
      ctx.lineTo(x + cardW, y + cardH);
      ctx.stroke();

      ctx.textBaseline = 'top';
      const rowY = y + paddingY;

      // Emoji (left) — text-xs. When empty, label slides left (no emoji offset).
      const hasEmojiMin = !!card.emoji && card.emoji.trim() !== '';
      let labelX = x + paddingX;
      if (hasEmojiMin) {
        if (card.iconImage) {
          ctx.drawImage(card.iconImage, x + paddingX, rowY + (rowH - minEmojiSize) / 2, minEmojiSize, minEmojiSize);
          labelX = x + paddingX + minEmojiSize + contentGap;
        } else {
          ctx.font = `${minEmojiSize}px sans-serif`;
          ctx.textAlign = 'left'; ctx.fillStyle = '#FFFFFF';
          ctx.fillText(card.emoji, x + paddingX, rowY + (rowH - minEmojiSize) / 2);
          const emojiW = ctx.measureText(card.emoji).width;
          labelX = x + paddingX + emojiW + contentGap;
        }
      }

      // Label (middle, flex-1, text-white/80)
      ctx.font = `400 ${labelSize}px "${fontFamily}", sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(card.label, labelX, rowY + (rowH - labelSize) / 2);

      // Value (right, font-bold, card.color)
      ctx.font = `700 ${valueSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = card.color || accent;
      ctx.fillText(card.value, x + cardW - paddingX, rowY + (rowH - valueSize) / 2);

      ctx.textBaseline = 'alphabetic';
    });
  }
  // ── Card style: Full Width (default) ──
  // Editor (infographie/page.tsx:3483-3513):
  //   grid-cols-1 (ALWAYS single column, ignores previewClasses.cols)
  //   flex items-center gap-2 rounded-lg bg-black/30 px-3 py-1.5
  //   borderLeft: 3px solid ${card.color}  (3px not 2!)
  //   emoji text-base (16 * textScale), left
  //   middle: label (scaledLabel font-bold white truncate) + description
  //           (scaledDesc text-white/50 truncate, 40 chars max) stacked
  //   right: value (scaledValue font-black card.color)
  else {
    // grid-cols-1: one column always
    const cardW = containerW;
    const paddingY = cssPx(6);   // py-1.5
    const paddingX = cssPx(12);  // px-3
    const contentGap = cssPx(8); // gap-2
    const innerTextGap = cssPx(2); // between stacked label and description
    // Editor uses fixed text-base (16px), not scaled by textScale.
    const fullEmojiSize = fixedFontPx(16);
    // Middle column height: label + (description if present)
    const hasAnyDesc = cards.slice(0, maxCards).some(c => !!c.description);
    const middleH = labelSize + (hasAnyDesc ? innerTextGap + descSize : 0);
    const rowH = Math.max(fullEmojiSize, middleH, valueSize);
    const cardH = rowH + paddingY * 2;
    const gap = Math.round(h * 0.012);
    const totalH = maxCards * cardH + (maxCards - 1) * gap;
    const cardsY = ((design?.cardsPosition?.y ?? 50) / 100) * h - totalH / 2;
    const cardsX = ((design?.cardsPosition?.x ?? 50) / 100) * w - cardW / 2;

    cards.slice(0, maxCards).forEach((card, i) => {
      const gridY = cardsY + i * (cardH + gap);
      const gridX = cardsX;
      const { x, y } = applyCardPos(card, gridX, gridY, cardW, cardH);

      // bg-black/30 rounded-lg
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      drawRoundRect(ctx, x, y, cardW, cardH, radius); ctx.fill();
      // borderLeft: 3px solid card.color, FULL height (matches CSS border-left)
      const leftBw = cssPx(3); // 3px (not 2)
      ctx.fillStyle = card.color || accent;
      ctx.fillRect(x, y, leftBw, cardH);

      ctx.textBaseline = 'top';
      const rowY = y + paddingY;

      // Emoji (left). When empty, the middle column slides left (no emoji offset).
      const hasEmojiFull = !!card.emoji && card.emoji.trim() !== '';
      let emojiW = 0;
      if (hasEmojiFull) {
        if (card.iconImage) {
          ctx.drawImage(card.iconImage, x + paddingX + leftBw, rowY + (rowH - fullEmojiSize) / 2, fullEmojiSize, fullEmojiSize);
          emojiW = fullEmojiSize;
        } else {
          ctx.font = `${fullEmojiSize}px sans-serif`;
          ctx.textAlign = 'left'; ctx.fillStyle = '#FFFFFF';
          ctx.fillText(card.emoji, x + paddingX + leftBw, rowY + (rowH - fullEmojiSize) / 2);
          emojiW = ctx.measureText(card.emoji).width;
        }
      }

      // Middle column (label + optional description, stacked, vertically centered)
      const middleX = x + paddingX + leftBw + (hasEmojiFull ? emojiW + contentGap : 0);
      // Value measured first so we know middle column width.
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`;
      const valueText = card.value;
      const valueW = ctx.measureText(valueText).width;
      const middleW = cardW - (middleX - x) - paddingX - contentGap - valueW;
      const middleTop = rowY + (rowH - middleH) / 2;
      // Label
      ctx.font = `700 ${labelSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = '#FFFFFF';
      // Truncate label if too wide
      const truncatedLabel = truncateToWidth(ctx, card.label, middleW);
      ctx.fillText(truncatedLabel, middleX, middleTop);
      // Description (if present) — 80 chars max, single-line truncated to
      // the middle column width. Source descriptions are now capped to 80
      // chars at the generator level, so this matches the editor preview.
      if (card.description) {
        const descSrc = truncateAtWord(card.description, 80);
        ctx.font = `400 ${descSize}px "${fontFamily}", sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
        const truncatedDesc = truncateToWidth(ctx, descSrc, middleW);
        ctx.fillText(truncatedDesc, middleX, middleTop + labelSize + innerTextGap);
      }

      // Value (right-aligned)
      ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'right';
      ctx.fillStyle = card.color || accent;
      ctx.fillText(valueText, x + cardW - paddingX, rowY + (rowH - valueSize) / 2);

      ctx.textBaseline = 'alphabetic';
    });
  }

  // Logo on cards if configured — uses per-sequence position
  if (logoImg && design?.logoSequences?.includes('cards')) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'cards');
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
  }
}

/**
 * Draw a single overlay (text block) positioned at {x%, y%} of the
 * canvas with the given typography. Used for both the legacy single
 * overlay (design.overlayText) and every entry in design.overlays.
 */
function drawSingleOverlay(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  fontFamily: string,
  overlay: {
    text: string;
    position: { x: number; y: number };
    color: string;
    scale: number;
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
    textGradient?: boolean;
    gradColor1?: string;
    gradColor2?: string;
  },
): void {
  if (!overlay.text) return;
  const fontSize = Math.round(w * 0.05 * (overlay.scale || 1));
  const x = (overlay.position.x / 100) * w;
  const y = (overlay.position.y / 100) * h;
  const weight = overlay.bold ? 700 : 400;
  const italic = overlay.italic ? 'italic ' : '';
  const letterSpacing = (overlay.letterSpacing || 0) * (w / 320);
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `${italic}${weight} ${fontSize}px "${fontFamily}", sans-serif`;
  ctx.textAlign = 'center';
  // Text fill: solid color by default, linear gradient (135°) when the
  // caller requested textGradient.
  const lines = wrapText(ctx, overlay.text, w * 0.85);
  const lineH = fontSize * (overlay.lineHeight || 1.2);
  const blockH = lines.length * lineH;
  const topY = y - blockH / 2;
  if (overlay.textGradient && overlay.gradColor1 && overlay.gradColor2) {
    const grad = ctx.createLinearGradient(
      x - (w * 0.85) / 2, topY,
      x + (w * 0.85) / 2, topY + blockH,
    );
    grad.addColorStop(0, overlay.gradColor1);
    grad.addColorStop(1, overlay.gradColor2);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = overlay.color;
  }
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 12;
  for (let i = 0; i < lines.length; i++) {
    const lineY = topY + i * lineH;
    if (letterSpacing) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      const chars = Array.from(lines[i]);
      const totalW = chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + (chars.length - 1) * letterSpacing;
      let cursor = x - totalW / 2;
      ctx.textAlign = 'left';
      for (const ch of chars) {
        ctx.strokeText(ch, cursor, lineY);
        ctx.fillText(ch, cursor, lineY);
        cursor += ctx.measureText(ch).width + letterSpacing;
      }
      ctx.restore();
    } else {
      fillTextWithOutline(ctx, lines[i], x, lineY, 3, 'rgba(0,0,0,0.7)');
    }
  }
  ctx.restore();
}

function drawVideoSeq(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  videoEl: HTMLVideoElement | null, logoImg: HTMLImageElement | null, seqProgress: number,
  design?: DesignOptions,
  rushTransform?: { scale?: number; offsetX?: number; offsetY?: number },
  videoImageEl?: HTMLImageElement | null,
  secondsIntoSequence?: number,
) {
  const fontFamily = design?.font || 'sans-serif';
  const backgroundSource: HTMLVideoElement | HTMLImageElement | null = videoEl || videoImageEl || null;
  const srcW = videoEl ? videoEl.videoWidth : (videoImageEl?.naturalWidth || 0);
  const srcH = videoEl ? videoEl.videoHeight : (videoImageEl?.naturalHeight || 0);
  if (backgroundSource && srcW && srcH) {
    const t = rushTransform || {};
    const userScale = t.scale || 1;
    const offX = t.offsetX || 0;
    const offY = t.offsetY || 0;
    const baseScale = Math.max(w / srcW, h / srcH);
    const drawScale = baseScale * userScale;
    const drawW = srcW * drawScale;
    const drawH = srcH * drawScale;
    const cx = w / 2 + offX * w;
    const cy = h / 2 + offY * h;
    ctx.drawImage(backgroundSource, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  } else {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
    ctx.font = `400 ${Math.round(w * 0.04)}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillText('Vidéo', w / 2, h / 2);
  }
  // Per-sequence gradient overlay (default: disabled for 'video', but the user
  // can opt-in via seqGradients). Paints on top of the video frame.
  paintSeqGradient(ctx, w, h, 'video', design);
  // Video overlay text — legacy single overlay + any extras in design.overlays.
  // Each overlay is gated by its own [startTime, endTime] window so the same
  // video can show a CTA-style headline at t=0 and a smaller caption at t=4s.
  // Diagnostic log at first paint of the video sequence so the user can
  // verify which overlays + positions the composer actually received.
  if ((secondsIntoSequence ?? 0) < 0.1) {
    // eslint-disable-next-line no-console
    console.log('[Composer.drawVideoSeq] legacy overlay:', JSON.stringify({
      text: design?.overlayText,
      x: design?.overlayPosition?.x,
      y: design?.overlayPosition?.y,
      startTime: design?.overlayStartTime,
      endTime: design?.overlayEndTime,
      scale: design?.overlayTextScale,
    }));
    // eslint-disable-next-line no-console
    console.log('[Composer.drawVideoSeq] design.overlays:', JSON.stringify(
      (design?.overlays ?? []).map((o) => ({
        text: o.text,
        x: o.position?.x,
        y: o.position?.y,
        startTime: o.startTime,
        endTime: o.endTime,
        scale: o.scale,
      }))
    ));
  }
  const t = secondsIntoSequence ?? 0;
  const inWindow = (start: number, end: number) =>
    t >= (start || 0) && (end === undefined || end < 0 || t <= end);

  // Legacy overlay reuses overlayText / overlayPosition / overlayColor +
  // overlayTypography (bold/italic/letterSpacing/lineHeight/gradient).
  const overlayFontFamily = design?.overlayFont || fontFamily;
  if (design?.overlayText && inWindow(design.overlayStartTime || 0, design.overlayEndTime ?? -1)) {
    drawSingleOverlay(ctx, w, h, overlayFontFamily, {
      text: design.overlayText,
      position: {
        x: design?.overlayPosition?.x ?? 50,
        y: design?.overlayPosition?.y ?? 33,
      },
      color: design.overlayColor || '#FFFFFF',
      // overlayTextScale layers on top of the global textScale so the user can
      // scale the overlay independently.
      scale: (design?.textScale || 1.0) * (design?.overlayTextScale ?? 1.0),
      bold: design?.overlayTypography?.bold !== false,
      italic: !!design?.overlayTypography?.italic,
      letterSpacing: design?.overlayTypography?.letterSpacing || 0,
      lineHeight: design?.overlayTypography?.lineHeight || 1.2,
      textGradient: design?.overlayTypography?.textGradient,
      gradColor1: design?.overlayTypography?.gradColor1,
      gradColor2: design?.overlayTypography?.gradColor2,
    });
  }

  if (Array.isArray(design?.overlays)) {
    for (const ov of design!.overlays) {
      if (!ov?.text) continue;
      if (!inWindow(ov.startTime || 0, ov.endTime ?? -1)) continue;
      drawSingleOverlay(ctx, w, h, overlayFontFamily, {
        text: ov.text,
        position: ov.position,
        color: ov.color || '#FFFFFF',
        scale: (design?.textScale || 1.0) * (ov.scale ?? 1.0),
        bold: ov.bold !== false,
        italic: !!ov.italic,
        letterSpacing: ov.letterSpacing || 0,
        lineHeight: ov.lineHeight || 1.2,
        // Extras inherit the legacy overlay's gradient setting.
        textGradient: design?.overlayTypography?.textGradient,
        gradColor1: design?.overlayTypography?.gradColor1,
        gradColor2: design?.overlayTypography?.gradColor2,
      });
    }
  }
  // Logo on video if configured — uses per-sequence position
  if (logoImg && design?.logoSequences?.includes('video')) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'video');
    drawLogoAccurate(ctx, logoImg, w, h, pos, logoScale);
  }
}

function drawCTA(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  accent: string, ctaText: string, ctaSubTextParam: string,
  salesPhrase: string | undefined, watermark: string | undefined,
  logoImg: HTMLImageElement | null, _progress: number,
  design?: DesignOptions
) {
  // ctaSubTextParam kept for backward compat but design.ctaSubTextDesign takes priority
  void ctaSubTextParam;
  // BIG text (watermark) uses watermarkFont; sub-text uses ctaFont. Fall back to global font.
  const watermarkFontFamily = design?.watermarkFont || design?.font || 'sans-serif';
  const fontFamily = design?.ctaFont || design?.font || 'sans-serif';
  const ctaSubColor = design?.ctaSubColor || accent; // editor default is accent color (#D91CD2)
  const ctaColor = design?.ctaColor || '#FFFFFF'; // editor default is white, not accent
  const ctaTextScale = design?.ctaTextScale || 1.0;

  // CTA text mapping — editor renders:
  //   BIG text = ctaMainText state ("AFROBOOST")     → saved in design.ctaMainText & branding.watermarkText
  //   Sub text = ctaSubText state ("CHAT POUR PLUS D'INFOS") → saved in design.ctaSubTextDesign & branding.ctaText
  // Note: branding naming is confusing (ctaText = editor's ctaSubText, watermarkText = editor's ctaMainText)
  const effectiveCtaText = design?.ctaMainText || watermark || 'AFROBOOST';
  const effectiveSubText = design?.ctaSubTextDesign || ctaText || "CHAT POUR PLUS D'INFOS";

  // CTA background: color-theme gradient backdrop (matches editor's
  // bg-gradient-to-br) + seqGradient overlay. Dark-hardcoded previously made
  // black CTA text invisible on top of it.
  paintSeqBackdrop(ctx, w, h, 'cta', design, accent);
  paintSeqGradient(ctx, w, h, 'cta', design);
  // NO animation — editor is static, no scale bounce
  ctx.save();

  // Font sizes matched to editor CSS:
  //   Editor (9:16): ctaMainText = 12px, ctaSubText = 9px, salesPhrase = 8px on 320px wide
  //   12/320 = 0.0375, 9/320 = 0.028, 8/320 = 0.025
  const isReel = h > w;
  const ctaFontSize = Math.round(w * (isReel ? 0.0375 : 0.031) * ctaTextScale);
  const salesFontSize = Math.round(w * (isReel ? 0.025 : 0.020) * ctaTextScale);
  const subFontSize = Math.round(w * (isReel ? 0.028 : 0.023) * ctaTextScale);
  const ctaLetterSpacing = (design?.ctaTypography?.letterSpacing || 0) * (w / 320); // scale from editor

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

  // Vertical layout math — MATCHES EDITOR EXACTLY
  // (infographie/page.tsx:3553-3593). Each element is ONE LINE at its own
  // `fontSize * lineHeight`. The SPACING between elements is the editor's
  // FIXED Tailwind margins, NOT a proportion of font size:
  //   - sales → main:   `mt-0.5` = 2px on 320-px preview → 2 * w/320 scaled
  //   - main  → sub:    `mt-1`   = 4px on 320-px preview → 4 * w/320 scaled
  // Previously we used `fontSize * 1.5` as per-block height. With large
  // ctaTextScale that produced a block much TALLER than the editor, and
  // the bottom-anchor math pushed the CTA far above the user's chosen
  // watermark position.
  ctx.textBaseline = 'top';
  const lineMul = design?.ctaTypography?.lineHeight || 1.2;
  const mt05 = Math.max(1, Math.round(w * (2 / 320))); // mt-0.5 = 2px
  const mt1 = Math.max(1, Math.round(w * (4 / 320)));  // mt-1   = 4px

  // Wrap sales phrase + sub-text within the CTA container width — without
  // this, long phrases like "Atteignez le bien-être avec nos optimisations
  // expertes" overflow the canvas to the left/right.
  ctx.font = `900 ${salesFontSize}px "${fontFamily}", sans-serif`;
  const salesLines: string[] = salesPhrase ? wrapText(ctx, salesPhrase, ctaContainerW) : [];
  ctx.font = `900 ${subFontSize}px "${fontFamily}", sans-serif`;
  const subLines: string[] = wrapText(ctx, effectiveSubText.toUpperCase(), ctaContainerW);

  const salesLineH = salesFontSize * lineMul;
  const ctaLineH = ctaFontSize * lineMul;
  const subLineH = subFontSize * lineMul;
  const salesBlockH = salesLines.length * salesLineH;
  const ctaBlockH = ctaLines.length * ctaLineH;
  const subBlockH = subLines.length * subLineH;
  const blockH = salesBlockH
    + (salesPhrase ? mt05 : 0) // gap sales → main
    + ctaBlockH
    + mt1                      // gap main → sub
    + subBlockH;

  // Editor uses translate(-50%, -100%) → the BOTTOM of the block sits at ctaPosY.
  let curY = ctaPosY - blockH;

  // Sales phrase (multi-line)
  if (salesLines.length > 0) {
    ctx.font = `900 ${salesFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = hexToRgba(ctaColor, 0.93);
    salesLines.forEach((line, i) => {
      fillTextWithSpacing(ctx, line, ctaPosX, curY + i * salesLineH, ctaLetterSpacing);
    });
    curY += salesBlockH + mt05;
  }

  // Main CTA text (multi-line) — uses watermarkFont + optional gradient.
  ctx.font = `900 ${ctaFontSize}px "${watermarkFontFamily}", sans-serif`; ctx.textAlign = 'center';
  if (design?.watermarkTextGradient && design?.watermarkGradColor1 && design?.watermarkGradColor2) {
    const grad = ctx.createLinearGradient(
      ctaPosX - ctaContainerW / 2, curY,
      ctaPosX + ctaContainerW / 2, curY + ctaBlockH,
    );
    grad.addColorStop(0, design.watermarkGradColor1);
    grad.addColorStop(1, design.watermarkGradColor2);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = ctaColor;
  }
  ctx.shadowColor = hexToRgba(ctaColor, 0.4); ctx.shadowBlur = Math.round(w * 0.02);
  ctaLines.forEach((line, i) => {
    fillTextWithSpacing(ctx, line, ctaPosX, curY + i * ctaLineH, ctaLetterSpacing);
  });
  ctx.shadowBlur = 0;
  curY += ctaBlockH + mt1;

  // Sub-text (multi-line) — user-configured color, 900 weight, uppercase, optional gradient.
  ctx.font = `900 ${subFontSize}px "${fontFamily}", sans-serif`; ctx.textAlign = 'center';
  if (design?.ctaTypography?.textGradient && design?.ctaTypography?.gradColor1 && design?.ctaTypography?.gradColor2) {
    const grad = ctx.createLinearGradient(
      ctaPosX - ctaContainerW / 2, curY,
      ctaPosX + ctaContainerW / 2, curY + subBlockH,
    );
    grad.addColorStop(0, design.ctaTypography.gradColor1);
    grad.addColorStop(1, design.ctaTypography.gradColor2);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = ctaSubColor;
  }
  subLines.forEach((line, i) => {
    fillTextWithSpacing(ctx, line, ctaPosX, curY + i * subLineH, ctaLetterSpacing);
  });
  ctx.textBaseline = 'alphabetic';

  // Logo on CTA if configured — uses per-sequence position
  if (logoImg && (!design?.logoSequences || design.logoSequences.includes('cta'))) {
    const logoScale = design?.logoScale || 1.0;
    const pos = getLogoPos(design, 'cta');
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

export async function composeVideo(options: ComposerOptions): Promise<{ video: Blob; thumbnail: Blob | null }> {
  const {
    width, height, fps = 30,
    title, subtitle, salesPhrase, cards = [],
    posterUrl, videoUrl, videoImageUrl, rushTransform, logoUrl, musicUrl, voiceUrl,
    introDuration = 4, cardsDuration = 6, videoDuration = 10, ctaDuration = 4,
    accentColor = '#D91CD2',
    ctaText = 'CHAT POUR PLUS D\'INFOS', ctaSubText = 'LIEN EN BIO',
    watermarkText, watermark: freeWatermark, siteText, design, onProgress,
  } = options;

  console.log(`[Composer] === START ${COMPOSER_VERSION} ===`);
  console.log('[Composer] cardStyle:', design?.cardStyle || 'DEFAULT (Full Width)');
  console.log('[Composer] captureStream: fps-based (NO requestFrame)');
  console.log('[Composer] animations: NONE (static mode)');
  console.log('[Composer] bitrate: 12Mbps');
  console.log('[Composer] Music:', musicUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Voice:', voiceUrl?.substring(0, 60) || 'NONE');
  console.log('[Composer] Logo:', logoUrl?.substring(0, 60) || 'NONE');
  // Full design log — shows every field the draw functions actually read.
  // Gaps here (e.g. `cardsPosition: undefined`) immediately explain why a
  // regenerated video doesn't match the editor preview.
  if (design) {
    console.log('[Composer] Design received:', JSON.stringify({
      font: design.font,
      cardStyle: design.cardStyle,
      titleColor: design.titleColor,
      ctaColor: design.ctaColor,
      ctaSubColor: design.ctaSubColor,
      gradientColor1: design.gradientColor1,
      gradientColor2: design.gradientColor2,
      gradientOpacity: design.gradientOpacity,
      textScale: design.textScale,
      ctaTextScale: design.ctaTextScale,
      titlePosition: design.titlePosition,
      cardsPosition: design.cardsPosition,
      watermarkPosition: design.watermarkPosition,
      overlayPosition: design.overlayPosition,
      titleSize: design.titleSize,
      cardsSize: design.cardsSize,
      watermarkSize: design.watermarkSize,
      logoPosition: design.logoPosition,
      logoPositions: design.logoPositions,
      logoSequences: design.logoSequences,
      logoScale: design.logoScale,
      titleTypography: design.titleTypography,
      ctaTypography: design.ctaTypography,
      overlayTypography: design.overlayTypography,
      seqGradients: design.seqGradients,
      ctaMainText: design.ctaMainText,
      ctaSubTextDesign: design.ctaSubTextDesign,
      overlayText: design.overlayText,
      overlayColor: design.overlayColor,
      noColorBg: design.noColorBg,
      noColorSequences: design.noColorSequences,
      filter: design.filter,
    }, null, 2));
  } else {
    console.log('[Composer] Design: NONE');
  }

  // ── Normalize French sequence names → English ──
  // The editor (infographie) stores logoSequences / seqGradients with French
  // names ('titre','cartes','video','cta') but the draw functions check English
  // names ('intro','cards','video','cta'). Use the module-scope SEQ_NAME_MAP.
  const normalizeKeys = <V>(obj: Record<string, V> | undefined): Record<string, V> | undefined =>
    obj
      ? Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [SEQ_NAME_MAP[k.toLowerCase()] || k, v])
        )
      : undefined;
  const normalizedLogoPositions = normalizeKeys(design?.logoPositions);
  const normalizedSeqGradients = normalizeKeys(design?.seqGradients);
  const normalizedDesign: DesignOptions | undefined = design
    ? {
        ...design,
        logoSequences: design.logoSequences?.map(s => SEQ_NAME_MAP[s.toLowerCase()] || s),
        logoPositions: normalizedLogoPositions,
        seqGradients: normalizedSeqGradients,
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
  // Must load ALL weight variants used by draw functions (400, 500, 700, 900)
  if (design?.font && design.font !== 'sans-serif') {
    try {
      // Google Fonts URL for common fonts used in the app — include ALL weights needed
      const FONT_URLS: Record<string, string> = {
        'Anton': 'https://fonts.googleapis.com/css2?family=Anton&display=swap',
        'Syne': 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800;900&display=swap',
        'Bebas Neue': 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
        'Poppins': 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap',
        'Space Grotesk': 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap',
        'Montserrat': 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap',
        'Inter': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
        'Oswald': 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap',
        'Playfair Display': 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800;900&display=swap',
        'Raleway': 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800;900&display=swap',
      };
      const fontUrl = FONT_URLS[design.font] ||
        `https://fonts.googleapis.com/css2?family=${encodeURIComponent(design.font)}:wght@400;500;600;700;800;900&display=swap`;

      // Inject CSS link if not present
      if (!document.querySelector(`link[href*="${encodeURIComponent(design.font)}"]`)) {
        console.log(`[Composer] Injecting font stylesheet: ${design.font}`);
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = fontUrl;
        document.head.appendChild(link);
      }

      // Wait for ALL weight variants used by draw functions
      const weightsNeeded = [400, 500, 700, 900];
      const fontLoaders = weightsNeeded.map(w =>
        document.fonts.load(`${w} 48px "${design!.font}"`)
      );
      console.log(`[Composer] Loading font "${design.font}" weights: ${weightsNeeded.join(', ')}...`);
      await Promise.race([
        Promise.all(fontLoaders),
        new Promise(r => setTimeout(r, 8000)), // 8s timeout — multiple weights can be slow
      ]);

      // Verify all weights loaded
      const loadedWeights = weightsNeeded.filter(w =>
        document.fonts.check(`${w} 48px "${design!.font}"`)
      );
      console.log(`[Composer] Font "${design.font}" loaded weights: ${loadedWeights.join(', ')} / ${weightsNeeded.join(', ')}`);
      if (loadedWeights.length === 0) {
        console.warn(`[Composer] ⚠️ Font "${design.font}" failed to load ANY weight — falling back to sans-serif`);
      }
    } catch (err) {
      console.warn('[Composer] Font loading failed, using fallback:', err);
    }
  }

  // Load visual media (with individual error logging)
  // videoUrl (real video) wins over videoImageUrl (still image fallback) if both are set.
  const effectiveVideoImageUrl = !videoUrl && videoImageUrl ? videoImageUrl : null;
  console.log('[Composer] Loading media:', { poster: posterUrl?.substring(0, 60) || 'NONE', logo: logoUrl?.substring(0, 30) || 'NONE', video: videoUrl?.substring(0, 60) || 'NONE', videoImage: effectiveVideoImageUrl?.substring(0, 60) || 'NONE' });
  const mediaLoadStart = performance.now();
  const [posterImg, logoImg, videoEl, videoImageEl] = await Promise.all([
    posterUrl ? loadImage(posterUrl).catch((err) => { console.error('[Composer] ❌ Poster load FAILED:', err.message); return null; }) : null,
    logoUrl ? loadImage(logoUrl).catch((err) => { console.error('[Composer] ❌ Logo load FAILED:', err.message); return null; }) : null,
    videoUrl ? loadVideo(videoUrl).catch((err) => { console.error('[Composer] ❌ Video load FAILED:', err.message); return null; }) : null,
    effectiveVideoImageUrl ? loadImage(effectiveVideoImageUrl).catch((err) => { console.error('[Composer] ❌ Video still image load FAILED:', err.message); return null; }) : null,
  ]);
  console.log(`[Composer] Media loaded in ${((performance.now() - mediaLoadStart) / 1000).toFixed(1)}s — poster:${!!posterImg} logo:${!!logoImg} video:${!!videoEl} videoImage:${!!videoImageEl}`);

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

  // Build sequences. Callers (editor, calendar regenerate) signal an
  // invisible sequence by passing its duration as 0 — e.g. a user who
  // toggled the CTA off sends ctaDuration: 0. We must NOT push those
  // sequences into the list, because the transition logic crossfades
  // INTO sequences[seqIdx + 1] even when that next sequence has
  // duration 0 — which leaks the hidden sequence into the final frame.
  const hasVideoBackground = !!videoEl || !!videoImageEl;
  const sequences: Array<{ type: string; duration: number }> = [];
  if (introDuration > 0) sequences.push({ type: 'intro', duration: introDuration });
  if (cards.length > 0 && cardsDuration > 0) sequences.push({ type: 'cards', duration: cardsDuration });
  if (hasVideoBackground && videoDuration > 0) {
    sequences.push({ type: 'video', duration: videoDuration });
  } else if ((videoUrl || effectiveVideoImageUrl) && videoDuration > 0) {
    // Video was requested but failed to load — redistribute its duration to intro/CTA
    console.warn('[Composer] ⚠️ Video requested but failed to load — extending intro/CTA to fill duration');
    if (sequences[0]) sequences[0].duration += Math.floor(videoDuration / 2);
  }
  const ctaExtraFromDeadVideo = (!hasVideoBackground && (videoUrl || effectiveVideoImageUrl) && videoDuration > 0)
    ? Math.ceil(videoDuration / 2)
    : 0;
  if (ctaDuration + ctaExtraFromDeadVideo > 0) {
    sequences.push({ type: 'cta', duration: ctaDuration + ctaExtraFromDeadVideo });
  }

  if (sequences.length === 0) {
    // Every sequence was hidden — fall back to a 1-frame intro so the
    // recorder produces a valid (if trivial) output rather than hanging.
    console.warn('[Composer] ⚠️ All sequences hidden — falling back to 1s intro');
    sequences.push({ type: 'intro', duration: 1 });
  }

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

  // Thumbnail capture state — we snapshot the first frame past 0.5s into the
  // intro sequence. Saved as JPEG 0.85 quality and uploaded alongside the video
  // so the calendar can render a static miniature instead of loading the full
  // 20–30 MB rush.
  let thumbnailBlob: Blob | null = null;
  let thumbnailRequested = false;
  const captureThumbnail = () => {
    if (thumbnailRequested) return;
    thumbnailRequested = true;
    try {
      canvas.toBlob((b) => {
        if (b) {
          thumbnailBlob = b;
          console.log(`[Composer] 📸 Thumbnail captured: ${(b.size / 1024).toFixed(1)} KB`);
        }
      }, 'image/jpeg', 0.85);
    } catch (err) {
      console.warn('[Composer] Thumbnail capture failed:', err);
    }
  };

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

    // Optional rounded-rect backdrop: paint the matte black "outside" of
    // the rounded card first, then clip the rest of the frame's drawing
    // to the inner rounded rectangle so the sequence content stays inside
    // the card edges. Restored at the very end of each frame.
    const backdropRounded = !!normalizedDesign?.backdropRounded;
    const backdropMarginPct = Math.max(0, Math.min(20, normalizedDesign?.backdropMargin ?? 0)) / 100;
    const backdropRadiusPx = backdropRounded
      ? Math.max(0, (normalizedDesign?.backdropRadius ?? 24) * (width / 1080))
      : 0;
    const needsBackdropClip = backdropRounded || backdropMarginPct > 0;
    if (needsBackdropClip) {
      ctx.save();
      ctx.fillStyle = '#0A0A0F';
      ctx.fillRect(0, 0, width, height);
      const mx = width * backdropMarginPct;
      const my = height * backdropMarginPct;
      const rw = width - 2 * mx;
      const rh = height - 2 * my;
      const r = Math.min(backdropRadiusPx, rw / 2, rh / 2);
      ctx.beginPath();
      if (r > 0) {
        ctx.moveTo(mx + r, my);
        ctx.lineTo(mx + rw - r, my);
        ctx.quadraticCurveTo(mx + rw, my, mx + rw, my + r);
        ctx.lineTo(mx + rw, my + rh - r);
        ctx.quadraticCurveTo(mx + rw, my + rh, mx + rw - r, my + rh);
        ctx.lineTo(mx + r, my + rh);
        ctx.quadraticCurveTo(mx, my + rh, mx, my + rh - r);
        ctx.lineTo(mx, my + r);
        ctx.quadraticCurveTo(mx, my, mx + r, my);
      } else {
        ctx.rect(mx, my, rw, rh);
      }
      ctx.closePath();
      ctx.clip();
    }

    const drawSeq = (type: string, progress: number) => {
      switch (type) {
        case 'intro': drawIntro(ctx, width, height, posterImg, logoImg, title, subtitle, accentColor, progress, normalizedDesign); break;
        case 'cards': {
          // eslint-disable-next-line no-console
          console.log('[Composer] About to call drawCards. Snapshot in design?', !!normalizedDesign?.cardsSnapshot, 'Snapshot in options?', !!(options as any)?.cardsSnapshot);
          drawCards(ctx, width, height, cards, logoImg, accentColor, progress, normalizedDesign);
          break;
        }
        case 'video': {
          // During a transition, `seq` is the departing sequence, not the
          // one we're actually drawing — so use the video sequence's own
          // duration to compute accurate seconds-into-sequence for overlay
          // timing windows.
          const videoSeq = sequences.find((s) => s.type === 'video');
          const secondsIn = videoSeq ? progress * videoSeq.duration : 0;
          drawVideoSeq(ctx, width, height, videoEl, logoImg, progress, normalizedDesign, rushTransform, videoImageEl, secondsIn);
          break;
        }
        case 'cta': drawCTA(ctx, width, height, accentColor, ctaText, ctaSubText, salesPhrase, watermarkText, logoImg, progress, normalizedDesign); break;
      }
    };
    if (inTransition && seqIdx < sequences.length - 1) {
      drawTransition(ctx, width, height, (p) => drawSeq(seq.type, p), (p) => drawSeq(sequences[seqIdx + 1].type, p), transProgress);
    } else { drawSeq(seq.type, seqProgress); }

    if (needsBackdropClip) ctx.restore();
    // NOTE: No accent border/frame — editor doesn't have one

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

    // ── Free-plan "Studiio" watermark (bottom-right) ──
    if (freeWatermark) {
      ctx.save();
      const wmSize = Math.round(height * 0.02);
      ctx.font = `600 ${wmSize}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;
      ctx.fillText('studiio.pro', width - wmSize, height - wmSize - barH);
      ctx.restore();
    }

    // ── Branding border (applied on top of everything) ──
    paintBorder(ctx, width, height, normalizedDesign, accentColor);
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
        musicGain.gain.value = options.musicVolume ?? ((validVoiceBuffer || voiceEl) ? 0.5 : 0.8);
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
        musicGain.gain.value = options.musicVolume ?? (voiceEl ? 0.5 : 0.8);
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
        voiceGain.gain.value = options.voiceVolume ?? 1.0;
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
        voiceGain.gain.value = options.voiceVolume ?? 1.0;
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
  // ALWAYS use captureStream(fps) — this lets the browser control frame timing,
  // ensuring correct video duration. Manual captureStream(0) + requestFrame()
  // caused slow-motion/fast-motion issues because MediaRecorder timestamps
  // frames based on wall-clock time, not the intended frame rate.
  const useFastMode = !hasAudio;
  const videoStream = canvas.captureStream(fps);

  // Combine video + audio into one MediaStream
  const combinedStream = new MediaStream();
  for (const track of videoStream.getVideoTracks()) combinedStream.addTrack(track);
  if (audioDest) {
    for (const track of audioDest.stream.getAudioTracks()) combinedStream.addTrack(track);
  }

  console.log('[Composer] Stream tracks:', combinedStream.getTracks().map(t => t.kind + ':' + t.readyState).join(', '));

  // Choose best mimeType — WebM (VP9/VP8) MUST come first. Chrome's
  // MediaRecorder produces MP4 files with broken temporal metadata in
  // fast mode (captureStream(0) + requestFrame), making them unreadable
  // past the first few seconds in most players. WebM doesn't have this
  // issue. See CLAUDE.md "Pieges connus" section — this is a known trap.
  // Never reorder MP4 before WebM.
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  let mimeType = 'video/webm';
  for (const t of mimeTypes) {
    if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }
  const isMP4 = mimeType.startsWith('video/mp4');
  console.log('[Composer] MediaRecorder mimeType:', mimeType, '| MP4:', isMP4);
  console.log('[Composer] Mode:', useFastMode ? '⚡ FAST (no audio)' : '🔊 REAL-TIME (with audio)');

  // 12 Mbps for high quality — Instagram re-encodes at ~3.5 Mbps so we provide extra headroom
  // to preserve colors and text sharpness after Instagram's compression
  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  onProgress?.(15, useFastMode ? 'Rendu rapide...' : 'Rendu en cours...');

  // ═══════════════════════════════════════════════════════════
  // UNIFIED MODE: Both with and without audio use the same render loop.
  // captureStream(fps) handles frame timing — we just draw each frame
  // at the right time using requestAnimationFrame + wall-clock sync.
  // This eliminates slow-motion/fast-motion bugs caused by manual
  // frame pushing with captureStream(0) + requestFrame().
  // ═══════════════════════════════════════════════════════════
  if (useFastMode) {
    return new Promise<{ video: Blob; thumbnail: Blob | null }>((resolve, reject) => {
      recorder.onstop = () => {
        const outputType = isMP4 ? 'video/mp4' : 'video/webm';
        const blob = new Blob(chunks, { type: outputType });
        console.log('[Composer] ✅ DONE — blob:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type:', outputType, ', chunks:', chunks.length);
        if (videoEl) videoEl.pause();
        try { document.body.removeChild(canvas); } catch {}
        onProgress?.(100, 'Terminé !');
        resolve({ video: blob, thumbnail: thumbnailBlob });
      };
      recorder.onerror = (e) => { console.error('[Composer] MediaRecorder error:', e); reject(new Error('Recording failed')); };

      recorder.start(200);
      console.log('[Composer] Recording started for', totalDuration.toFixed(1), 's at', fps, 'fps');

      // Start video element paused — we'll control seeking
      if (videoEl) { videoEl.currentTime = 0; videoEl.pause(); }

      const startTime = performance.now();
      let animStopped = false;

      const doFrame = () => {
        if (animStopped) return;
        const elapsed = (performance.now() - startTime) / 1000;

        if (elapsed >= totalDuration + 0.3) {
          animStopped = true;
          console.log('[Composer] Render complete, stopping recorder');
          recorder.stop();
          return;
        }

        const t = Math.min(elapsed, totalDuration - 0.001);

        // Manage video element playback
        if (videoEl) {
          const videoSeq = sequences.find(s => s.type === 'video');
          if (videoSeq) {
            const vs = seqStarts[sequences.indexOf(videoSeq)];
            const ve = vs + videoSeq.duration;
            if (t >= vs && t < ve) {
              if (videoEl.paused) { videoEl.currentTime = Math.max(0, t - vs); videoEl.play().catch((e) => console.warn('[Composer] Video play failed:', e.message)); }
            } else if (!videoEl.paused) { videoEl.pause(); }
          }
        }

        drawFrame(t);
        // Capture a JPEG thumbnail ~0.5s into the intro — non-blocking.
        if (t >= 0.5) captureThumbnail();

        // Report progress every 0.5s
        const pct = Math.round(15 + (elapsed / totalDuration) * 80);
        onProgress?.(Math.min(pct, 95), `Montage en cours... ${Math.round((elapsed / totalDuration) * 100)}%`);

        requestAnimationFrame(doFrame);
      };

      // Kick off rendering
      drawFrame(0);
      requestAnimationFrame(doFrame);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // REAL-TIME MODE: With audio → must render in sync with audio
  // ═══════════════════════════════════════════════════════════
  return new Promise<{ video: Blob; thumbnail: Blob | null }>(async (resolve, reject) => {
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
      resolve({ video: blob, thumbnail: thumbnailBlob });
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
      // Capture a JPEG thumbnail ~0.5s into the intro — non-blocking.
      if (t >= 0.5) captureThumbnail();

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

export async function composeAndUpload(options: ComposerOptions): Promise<{ blob: Blob; url: string | null; thumbnailUrl: string | null; composerVersion: string }> {
  const { video: blob, thumbnail: thumbnailBlob } = await composeVideo(options);
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

  // Upload the JPEG thumbnail (if captured) so the calendar can render a cheap
  // <img> miniature instead of loading the 20–30 MB rush video. Failures are
  // non-fatal — we degrade to the legacy `poster/video` fallbacks.
  let thumbnailUrl: string | null = null;
  if (thumbnailBlob && thumbnailBlob.size > 0) {
    try {
      const thumbFilename = `thumb-${Date.now()}.jpg`;
      console.log('[Composer] Requesting signed URL for thumbnail...', (thumbnailBlob.size / 1024).toFixed(1), 'KB');
      const signedThumb = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: thumbFilename, contentType: 'image/jpeg', purpose: 'thumbnail' }),
      });
      const signedThumbData = await signedThumb.json();
      if (signedThumbData.success && signedThumbData.signedUrl) {
        const thumbUp = await fetch(signedThumbData.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: thumbnailBlob,
        });
        if (thumbUp.ok) {
          thumbnailUrl = signedThumbData.publicUrl;
          console.log('[Composer] ✅ Thumbnail uploaded:', thumbnailUrl);
        } else {
          console.warn('[Composer] Thumbnail upload failed:', thumbUp.status, thumbUp.statusText);
        }
      } else {
        console.warn('[Composer] Thumbnail signed URL request failed:', signedThumbData);
      }
    } catch (err) {
      console.warn('[Composer] Thumbnail upload error (non-fatal):', err);
    }
  }

  return { blob, url, thumbnailUrl, composerVersion: COMPOSER_VERSION };
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
