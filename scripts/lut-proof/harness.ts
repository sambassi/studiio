/**
 * Banc de preuve pour l'étalonnage du rush.
 *
 * Ce fichier tourne DANS le navigateur (bundlé par esbuild, lancé par
 * `run.js`). Il ne simule rien : il utilise le vrai `createLutGrader`, la
 * vraie `applyLutToPixels`, un vrai `<video>` 1080×1920 encodé sur place, et
 * le même montage temps réel que le compositeur — `captureStream(fps)` +
 * `MediaRecorder` + boucle `requestAnimationFrame` cadencée sur l'horloge.
 *
 * Il répond à trois questions, dans cet ordre :
 *
 * 1. l'image change-t-elle vraiment, et comme prévu ?
 * 2. combien coûte une frame étalonnée, face au budget de 33,3 ms ?
 * 3. le rendu temps réel perd-il des frames, et l'audio reste-t-il synchrone ?
 */
import { parseCube } from '../../src/lib/luts/parse';
import { applyLutToPixels } from '../../src/lib/luts/apply';
import { createLutGrader } from '../../src/lib/luts/grader';

const W = 1080;
const H = 1920;
const FPS = 30;
const SECONDS = 6;

/**
 * LUT « teal & orange » : bleus tirés vers le cyan, hautes lumières vers
 * l'orange. Un vrai étalonnage, pas une identité — sinon la comparaison
 * « avant / après » ne prouverait rien.
 */
function tealOrangeCube(n = 17): string {
  const lines = [`TITLE "Teal Orange"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const R = r / (n - 1);
        const G = g / (n - 1);
        const B = b / (n - 1);
        const lum = 0.299 * R + 0.587 * G + 0.114 * B;
        const warm = Math.pow(lum, 1.4);
        const or = clamp01(R * (0.85 + 0.35 * warm) + 0.05 * warm);
        const og = clamp01(G * (0.9 + 0.1 * warm) + 0.02 * (1 - warm));
        const ob = clamp01(B * (0.8 + 0.2 * (1 - warm)) + 0.12 * (1 - warm));
        lines.push(`${or.toFixed(6)} ${og.toFixed(6)} ${ob.toFixed(6)}`);
      }
    }
  }
  return lines.join('\n');
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Étape courante, lisible depuis le pilote si le banc se bloque. */
function stage(name: string): void {
  (window as unknown as { __LUT_STAGE__: string }).__LUT_STAGE__ = name;
  console.log('[stage]', name);
}

/** Peint une scène animée : dégradés, disques, texte — de quoi voir un étalonnage. */
function paintScene(ctx: CanvasRenderingContext2D, t: number): void {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#12314f');
  grad.addColorStop(0.5, '#7C3AED');
  grad.addColorStop(1, '#EC4899');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.35 + i / 6) % 1;
    ctx.beginPath();
    ctx.arc(W * (0.2 + 0.6 * p), H * (0.15 + 0.7 * ((i + 1) / 7)), 130, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${(i * 60 + t * 40) % 360}, 85%, 55%)`;
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 96px sans-serif';
  ctx.fillText('RUSH', 90, 300);
}

/** Encode un vrai rush 1080×1920 et rend un `<video>` prêt à lire. */
async function makeRush(): Promise<HTMLVideoElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((r) => (rec.onstop = () => r(new Blob(chunks, { type: 'video/webm' }))));
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      paintScene(ctx, t);
      if (t >= SECONDS) return resolve();
      requestAnimationFrame(step);
    };
    step();
  });
  rec.stop();
  const blob = await done;

  const video = document.createElement('video');
  video.src = URL.createObjectURL(blob);
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('rush illisible'));
  });
  await video.play();
  return video;
}

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
    p50: +at(0.5).toFixed(2),
    p95: +at(0.95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
}

/**
 * Chaque mesure tourne dans une PAGE NEUVE.
 *
 * Deux `MediaRecorder` successifs dans la même page ne produisent pas des
 * fichiers comparables — le second sort tronqué, parfois vide. Le témoin
 * « sans filtre » et la mesure « avec filtre » doivent partir du même état,
 * sinon la comparaison mesure l'ordre d'exécution autant que l'étalonnage.
 */
async function main() {
  const mode = new URLSearchParams(location.search).get('mode') || 'analyse';
  const report: Record<string, unknown> = { mode, width: W, height: H, fps: FPS };
  stage('lut');
  const lut = parseCube(tealOrangeCube());
  report.lut = { size: lut.size, title: lut.title };

  stage('rush');
  const video = await makeRush();
  report.rush = { videoWidth: video.videoWidth, videoHeight: video.videoHeight };

  stage('grader');
  const grader = createLutGrader(lut, 1);
  if (!grader) throw new Error('WebGL indisponible dans ce navigateur');

  if (mode === 'temps-reel-sans-lut') {
    grader.dispose();
    report.capture = await realtimeCapture(video, null);
    return report;
  }
  if (mode === 'temps-reel-avec-lut') {
    report.capture = await realtimeCapture(video, grader);
    grader.dispose();
    return report;
  }

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const outCtx = out.getContext('2d', { willReadFrequently: true })!;

  // ── 1. L'image change-t-elle vraiment, et comme prévu ? ──────────────
  // La video est FIGEE : comparer deux captures d'une video qui joue
  // comparerait deux frames differentes, et le rapport ne voudrait rien dire.
  stage('image');
  video.pause();
  video.currentTime = 2;
  await new Promise<void>((r) => { video.onseeked = () => r(); });

  outCtx.drawImage(video, 0, 0, W, H);
  const before = outCtx.getImageData(0, 0, W, H);

  outCtx.drawImage(grader.grade(video, W, H), 0, 0, W, H);
  const afterGpu = outCtx.getImageData(0, 0, W, H);

  // Référence CPU : la même image passée par `applyLutToPixels`, déjà couverte
  // par les tests unitaires. Si le GPU s'en écarte, c'est le shader qui ment.
  const afterCpu = new Uint8ClampedArray(before.data);
  applyLutToPixels(afterCpu, lut, 1);

  let sumChange = 0;
  let maxChange = 0;
  let n = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const ch = Math.abs(afterGpu.data[i + c] - before.data[i + c]);
      if (ch > maxChange) maxChange = ch;
      sumChange += ch;
      n++;
    }
  }

  // Le shader, compare a la reference CPU SUR LES MEMES PIXELS.
  //
  // Passer la video aux deux ne prouverait rien : le televersement d'une
  // texture video et `drawImage` ne convertissent pas forcement le YUV de la
  // meme facon, et l'ecart mesure serait celui des ENTREES, pas celui de
  // l'etalonnage. On repart donc d'une image RGB identique des deux cotes.
  const same = document.createElement('canvas');
  same.width = W;
  same.height = H;
  const sameCtx = same.getContext('2d', { willReadFrequently: true })!;
  sameCtx.putImageData(before, 0, 0);
  outCtx.drawImage(grader.grade(same, W, H), 0, 0, W, H);
  const shaderOut = outCtx.getImageData(0, 0, W, H);

  let sumDelta = 0;
  let maxDelta = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(shaderOut.data[i + c] - afterCpu[i + c]);
      if (d > maxDelta) maxDelta = d;
      sumDelta += d;
    }
  }

  report.image = {
    ecartMoyenAvantApres: +(sumChange / n).toFixed(2),
    ecartMaxAvantApres: maxChange,
    shaderVsCpu: {
      ecartMoyen: +(sumDelta / n).toFixed(3),
      ecartMax: maxDelta,
    },
  };

  // ── 2. Ce que coûterait le CPU ───────────────────────────────────────
  // Mesure honnête parce que synchrone : `applyLutToPixels` est du JavaScript
  // pur, rien n'est différé. C'est le chiffre qui justifie le GPU.
  // Le coût GPU, lui, ne se mesure pas frame par frame — forcer une lecture
  // pour le chronométrer provoquerait justement le blocage qu'on évite. Il se
  // lit au débit soutenu, mesuré en §3.
  stage('bench-cpu');
  const cpuTimes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const frame = new Uint8ClampedArray(before.data);
    const t0 = performance.now();
    applyLutToPixels(frame, lut, 1);
    cpuTimes.push(performance.now() - t0);
  }
  report.msParFrameCpu = stats(cpuTimes);
  report.budgetMs = +(1000 / FPS).toFixed(2);

  grader.dispose();
  return report;
}

/**
 * Reproduit le chemin TEMPS RÉEL du compositeur : canvas capturé à `FPS`,
 * piste audio réelle, boucle cadencée sur l'horloge murale. C'est là que se
 * jouent les frames perdues — l'audio, lui, continue quoi qu'il arrive, donc
 * une frame trop lente ne désynchronise pas : elle disparaît.
 */
async function realtimeCapture(
  video: HTMLVideoElement,
  grader: ReturnType<typeof createLutGrader>,
) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(FPS);

  const audioCtx = new AudioContext();
  const osc = audioCtx.createOscillator();
  const dest = audioCtx.createMediaStreamDestination();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.05;
  osc.connect(gain).connect(dest);
  osc.start();
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((r) => (rec.onstop = () => r(new Blob(chunks, { type: 'video/webm' }))));

  const duration = 4;
  let drawn = 0;
  rec.start(200);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed >= duration) return resolve();
      const source = grader ? grader.grade(video, W, H) : video;
      ctx.drawImage(source, 0, 0, W, H);
      drawn++;
      requestAnimationFrame(step);
    };
    step();
  });
  // Laisse le dernier bloc arriver : `stop()` ne vide pas le tampon
  // instantanement, et sans ce delai le fichier sort vide une fois sur deux.
  await new Promise((r) => setTimeout(r, 300));
  rec.requestData();
  rec.stop();
  const blob = await done;
  const wall = (performance.now() - t0) / 1000;
  osc.stop();
  await audioCtx.close();

  // Durée réelle du fichier produit, mesurée comme le ferait un lecteur.
  const probe = document.createElement('video');
  probe.src = URL.createObjectURL(blob);
  const probed = await new Promise<number>((resolve) => {
    probe.onloadedmetadata = () => {
      // Un WebM MediaRecorder n'annonce pas sa durée : on la force en cherchant
      // au-delà de la fin, exactement comme le fait le reste du produit.
      if (!Number.isFinite(probe.duration)) {
        probe.currentTime = 1e101;
        probe.ontimeupdate = () => {
          probe.ontimeupdate = null;
          resolve(probe.duration);
        };
      } else resolve(probe.duration);
    };
    probe.onerror = () => resolve(NaN);
  });

  // Le flux est capture a `FPS` : une frame n'est perdue que si la boucle de
  // dessin ne tient pas ce rythme. Le debit soutenu est donc LA mesure — pas
  // un chronometre par frame, qui obligerait a bloquer le GPU pour le lire.
  const fpsEffectif = +(drawn / wall).toFixed(1);
  return {
    secondes: duration,
    framesDessinees: drawn,
    fpsEffectif,
    fpsRequis: FPS,
    margeParFrameMs: +(1000 / fpsEffectif).toFixed(2),
    aucuneFramePerdue: fpsEffectif >= FPS,
    pistesAudioDansLeFichier: stream.getAudioTracks().length,
    dureeFichierS: Number.isFinite(probed) ? +probed.toFixed(2) : null,
    derivePistesS: Number.isFinite(probed) ? +Math.abs(probed - wall).toFixed(2) : null,
    tailleMo: +(blob.size / 1024 / 1024).toFixed(2),
    blocs: chunks.length,
  };
}

main()
  .then((report) => {
    (window as unknown as { __LUT_REPORT__: unknown }).__LUT_REPORT__ = report;
    document.getElementById('out')!.textContent = JSON.stringify(report, null, 2);
  })
  .catch((err) => {
    (window as unknown as { __LUT_REPORT__: unknown }).__LUT_REPORT__ = {
      error: String(err?.message ?? err),
    };
    document.getElementById('out')!.textContent = String(err?.stack ?? err);
  });
