/**
 * Client-side video clip detector using Canvas frame analysis.
 * Detects scene changes and interesting moments by comparing consecutive frames.
 * Returns a list of clip boundaries for user selection.
 */

export interface DetectedClip {
  id: string;
  startTime: number;   // seconds
  endTime: number;     // seconds
  duration: number;    // seconds
  thumbnailUrl: string; // data URL from canvas
  score: number;       // interest score (higher = more dynamic/interesting)
  label: string;       // auto-generated label
}

export interface ClipDetectionResult {
  clips: DetectedClip[];
  totalDuration: number;
  framesAnalyzed: number;
}

/**
 * Analyze a video file and detect the best sequences/clips.
 * Uses frame-by-frame comparison to detect scene changes and high-motion areas.
 */
export async function detectClips(
  file: File,
  options?: {
    maxClips?: number;
    minClipDuration?: number; // seconds
    maxClipDuration?: number; // seconds
    sampleInterval?: number;  // seconds between samples
    onProgress?: (percent: number, stage: string) => void;
  }
): Promise<ClipDetectionResult> {
  const {
    maxClips = 6,
    minClipDuration = 2,
    maxClipDuration = 15,
    sampleInterval = 0.5,
    onProgress,
  } = options || {};

  onProgress?.(0, 'Chargement de la vidéo...');

  // Create video element
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = videoUrl;
  });

  // Wait for video to be ready
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) { resolve(); return; }
    video.oncanplay = () => resolve();
    video.load();
  });

  const totalDuration = video.duration;
  if (!totalDuration || totalDuration < 1) {
    URL.revokeObjectURL(videoUrl);
    return { clips: [], totalDuration: 0, framesAnalyzed: 0 };
  }

  // Canvas for frame analysis
  const canvas = document.createElement('canvas');
  const analysisWidth = 160; // Small for fast analysis
  const analysisHeight = 90;
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Thumbnail canvas (higher res)
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 320;
  thumbCanvas.height = 180;
  const thumbCtx = thumbCanvas.getContext('2d')!;

  onProgress?.(5, 'Analyse des frames...');

  // Sample frames and compute differences
  const frameDiffs: { time: number; diff: number; brightness: number }[] = [];
  let prevImageData: ImageData | null = null;
  const totalSamples = Math.floor(totalDuration / sampleInterval);
  let framesAnalyzed = 0;

  for (let t = 0; t < totalDuration; t += sampleInterval) {
    // Seek to time
    video.currentTime = t;
    await new Promise<void>((resolve) => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
    });

    // Draw frame to analysis canvas
    ctx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
    const imageData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
    framesAnalyzed++;

    // Compute frame difference and brightness
    let diff = 0;
    let brightness = 0;
    const pixels = imageData.data;

    if (prevImageData) {
      const prevPixels = prevImageData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const rDiff = Math.abs(pixels[i] - prevPixels[i]);
        const gDiff = Math.abs(pixels[i + 1] - prevPixels[i + 1]);
        const bDiff = Math.abs(pixels[i + 2] - prevPixels[i + 2]);
        diff += (rDiff + gDiff + bDiff) / 3;
        brightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      }
      const pixelCount = pixels.length / 4;
      diff /= pixelCount;
      brightness /= pixelCount;
    } else {
      for (let i = 0; i < pixels.length; i += 4) {
        brightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      }
      brightness /= (pixels.length / 4);
    }

    frameDiffs.push({ time: t, diff, brightness });
    prevImageData = imageData;

    const progress = 5 + Math.round((framesAnalyzed / totalSamples) * 70);
    onProgress?.(Math.min(progress, 75), `Analyse: ${Math.round((t / totalDuration) * 100)}%`);
  }

  onProgress?.(80, 'Détection des séquences...');

  // Find scene boundaries (high diff = scene change)
  const avgDiff = frameDiffs.reduce((s, f) => s + f.diff, 0) / frameDiffs.length;
  const sceneThreshold = avgDiff * 2.5; // Scene change if diff is 2.5x average

  // Find scene change points
  const sceneChanges: number[] = [0]; // Always start at 0
  for (let i = 1; i < frameDiffs.length; i++) {
    if (frameDiffs[i].diff > sceneThreshold) {
      const lastChange = sceneChanges[sceneChanges.length - 1];
      if (frameDiffs[i].time - lastChange >= minClipDuration) {
        sceneChanges.push(frameDiffs[i].time);
      }
    }
  }
  sceneChanges.push(totalDuration); // End of video

  // Build clips from scene boundaries
  let rawClips: { start: number; end: number; score: number }[] = [];
  for (let i = 0; i < sceneChanges.length - 1; i++) {
    const start = sceneChanges[i];
    const end = Math.min(sceneChanges[i + 1], start + maxClipDuration);
    const duration = end - start;
    if (duration < minClipDuration) continue;

    // Score: based on motion (frame diffs) in this segment
    const segFrames = frameDiffs.filter(f => f.time >= start && f.time < end);
    const motionScore = segFrames.reduce((s, f) => s + f.diff, 0) / (segFrames.length || 1);
    const brightnessScore = segFrames.reduce((s, f) => s + f.brightness, 0) / (segFrames.length || 1);
    // Higher motion + good brightness = more interesting
    const score = motionScore * 0.7 + (brightnessScore / 255) * 30;

    rawClips.push({ start, end, score });
  }

  // If not enough scene-based clips, create evenly spaced clips
  if (rawClips.length < maxClips && totalDuration > minClipDuration * 2) {
    const clipDuration = Math.min(maxClipDuration, totalDuration / maxClips);
    for (let t = 0; t < totalDuration - minClipDuration; t += clipDuration) {
      const start = t;
      const end = Math.min(t + clipDuration, totalDuration);
      if (end - start < minClipDuration) continue;
      // Check if overlaps with existing clip
      const overlaps = rawClips.some(c => start < c.end && end > c.start);
      if (!overlaps) {
        const segFrames = frameDiffs.filter(f => f.time >= start && f.time < end);
        const motionScore = segFrames.reduce((s, f) => s + f.diff, 0) / (segFrames.length || 1);
        rawClips.push({ start, end, score: motionScore });
      }
    }
  }

  // Sort by score (best first) and take top N
  rawClips.sort((a, b) => b.score - a.score);
  rawClips = rawClips.slice(0, maxClips);
  // Re-sort by time for display
  rawClips.sort((a, b) => a.start - b.start);

  onProgress?.(85, 'Génération des miniatures...');

  // Generate thumbnails for each clip
  const clips: DetectedClip[] = [];
  for (let i = 0; i < rawClips.length; i++) {
    const { start, end, score } = rawClips[i];
    const midTime = start + (end - start) * 0.3; // 30% into clip for thumbnail

    // Seek to thumbnail time
    video.currentTime = midTime;
    await new Promise<void>((resolve) => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
    });

    // Draw thumbnail
    thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

    const duration = Math.round((end - start) * 10) / 10;
    clips.push({
      id: `clip-${i}`,
      startTime: Math.round(start * 10) / 10,
      endTime: Math.round(end * 10) / 10,
      duration,
      thumbnailUrl,
      score: Math.round(score * 10) / 10,
      label: `Séquence ${i + 1} (${duration}s)`,
    });

    onProgress?.(85 + Math.round((i / rawClips.length) * 12), `Miniature ${i + 1}/${rawClips.length}...`);
  }

  // Clean up
  URL.revokeObjectURL(videoUrl);
  onProgress?.(100, 'Analyse terminée');

  return { clips, totalDuration, framesAnalyzed };
}

/**
 * Extract a clip from a video file as a new File object.
 * Uses MediaRecorder to re-encode the clip segment.
 */
export async function extractClip(
  file: File,
  startTime: number,
  endTime: number,
  onProgress?: (percent: number) => void,
): Promise<File> {
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = videoUrl;
  });

  // Create canvas for recording
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1080;
  canvas.height = video.videoHeight || 1920;
  const ctx = canvas.getContext('2d')!;

  // Seek to start
  video.currentTime = startTime;
  await new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true });
  });

  // Setup MediaRecorder
  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  // Record the clip segment
  const duration = endTime - startTime;
  recorder.start(200);
  video.play();

  await new Promise<void>((resolve) => {
    const startMs = performance.now();
    const tick = setInterval(() => {
      const elapsed = (performance.now() - startMs) / 1000;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onProgress?.(Math.round((elapsed / duration) * 100));
      if (elapsed >= duration || video.currentTime >= endTime) {
        clearInterval(tick);
        resolve();
      }
    }, 1000 / 30);
  });

  video.pause();
  const blob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.stop();
  });

  URL.revokeObjectURL(videoUrl);
  const clipFile = new File([blob], `clip_${startTime.toFixed(1)}-${endTime.toFixed(1)}.webm`, { type: 'video/webm' });
  return clipFile;
}
