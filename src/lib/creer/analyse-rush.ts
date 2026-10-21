/**
 * SMART MONTAGE — analyse LOCALE d'un rush, dans le navigateur, sans aucun
 * fournisseur : échantillonnage d'images (canvas) + énergie audio
 * (`decodeAudioData`). Produit les mesures que `smart-montage.ts` note.
 *
 * Même technique que `clip-detector.ts` (seek + drawImage + différence de
 * pixels), mais sur une URL déjà stockée et avec la netteté et l'audio en
 * plus. Toute erreur rend `null` : l'appelant garde alors l'enchaînement
 * classique, jamais un montage cassé.
 */
import { analyserRythme, type RythmeMusique } from '@/lib/creer/rythme-musique';
import {
  mesurerImage, saturationRgb, coupesFranches, localiserCoupe, PAS_COUPE_FINE_S, ANALYSE_L as L, ANALYSE_H as H, type EchantillonRush,
} from '@/lib/creer/smart-montage';
import { HD_L, HD_H, HD_IMAGES, mesurerNetteteHD, agregerNetteteHD, type AnalyseRushQualite } from '@/lib/creer/nettete-hd';
import { silencesDepuisEchantillons } from '@/lib/creer/silences-audio';

/** Au-delà, on n'échantillonne pas plus finement (≈ 240 images par rush). */
const ECHANTILLONS_MAX = 240;
/** #613 — seeks de la 2e mesure des coupes, au plus, par rush (chacun peut attendre jusqu'à 1,5 s). */
export const SEEKS_FINS_MAX = 120;
/** #613 — au-delà de ce pas d'échantillonnage (rush long), pas de 2e mesure : la règle d'avant. */
export const PAS_LOCALISATION_MAX_S = 1;

/**
 * #613 — 2e mesure LOCALE des coupes franches : chaque coupe vue entre deux
 * échantillons est localisée au dixième de seconde (`localiserCoupe`).
 * Bornée : seulement si le pas d'échantillonnage ≤ `PAS_LOCALISATION_MAX_S`,
 * et au plus `SEEKS_FINS_MAX` images lues ; une coupe qui ne tient plus dans
 * le budget garde la règle d'avant (tout l'intervalle écarté). `onProgress`
 * avance de 0,95 à 1 pendant la passe (monotone). `lireA(t)` lit l'image
 * d'analyse à l'instant `t`.
 */
export async function localiserCoupesFines(
  echantillons: ReadonlyArray<EchantillonRush>,
  images: ReadonlyArray<Float32Array>,
  pas: number,
  lireA: (t: number) => Promise<Float32Array>,
  onProgress?: (fraction: number) => void,
): Promise<Array<[number, number]>> {
  const out: Array<[number, number]> = [];
  if (!(pas <= PAS_LOCALISATION_MAX_S)) return out;
  const coupes = coupesFranches(echantillons);
  const instants = (i: number) => {
    const ts: number[] = [];
    for (let t = echantillons[i - 1].t + PAS_COUPE_FINE_S; t < echantillons[i].t - 1e-3; t += PAS_COUPE_FINE_S) ts.push(Math.round(t * 1000) / 1000);
    return ts;
  };
  // Budget : les coupes dans l'ordre, tant que leurs images tiennent dans le plafond.
  const plan: Array<{ i: number; ts: number[] }> = [];
  let budget = SEEKS_FINS_MAX;
  for (const i of coupes) {
    const ts = instants(i);
    if (ts.length > budget) break;
    budget -= ts.length;
    plan.push({ i, ts });
  }
  const total = SEEKS_FINS_MAX - budget;
  let faits = 0;
  for (const { i, ts } of plan) {
    const inter: Array<{ t: number; gris: Float32Array }> = [];
    for (const t of ts) {
      inter.push({ t, gris: await lireA(t) });
      faits += 1;
      onProgress?.(0.95 + 0.05 * (faits / Math.max(1, total)) * 0.99);
    }
    const fine = localiserCoupe(echantillons[i - 1].t, images[i - 1], echantillons[i].t, images[i], inter);
    if (fine) out.push(fine);
  }
  return out;
}
/** Au-delà, l'audio n'est pas décodé (mémoire) : énergie audio à 0. */
export const AUDIO_OCTETS_MAX = 150 * 1024 * 1024;
/**
 * Borne de durée du PANNEAU QUALITÉ seulement (même valeur que le serveur,
 * `DUREE_ANALYSEE_MAX`). ⚠️ L'EXPORT n'a AUCUNE borne : il analyse le rush
 * entier, exactement comme avant M1 — sinon le plan d'un rush > 180 s changerait.
 */
export const DUREE_ANALYSEE_MAX = 180;

/** Durée réellement analysée : le rush entier sans borne (export), sinon bornée. Pure. */
export function dureeAnalysee(dureeTotale: number, dureeMax?: number | null): number {
  return typeof dureeMax === 'number' && dureeMax > 0 ? Math.min(dureeTotale, dureeMax) : dureeTotale;
}

/** Analyse BORNÉE qui n'a pas couvert tout le rush : jamais réutilisée par l'export. */
export type AnalyseNavigateur = AnalyseRushQualite & { partielle?: true };

/**
 * Taille annoncée du fichier (HEAD), AVANT tout téléchargement. `null` si le
 * serveur ne la donne pas : l'appelant garde alors le chemin d'avant (le
 * fichier est lu puis mesuré), pour ne rien changer aux mesures de l'export.
 */
async function tailleAnnoncee(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const n = Number(r.headers.get('content-length'));
    return r.ok && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function attendreSeek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let fini = false;
    const ok = () => { if (fini) return; fini = true; video.removeEventListener('seeked', ok); resolve(); };
    video.addEventListener('seeked', ok);
    // Certains MP4 mal indexés n'émettent jamais `seeked` (clip-detector.ts).
    setTimeout(ok, 1500);
    video.currentTime = t;
  });
}

function chargerVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('rush illisible'));
    setTimeout(() => reject(new Error('rush trop long à charger')), 30_000);
    v.src = url;
  });
}

/**
 * Son d'un rush : énergie RMS par fenêtre de `pas` secondes (0..1, comme
 * avant) et, M3-a PR2, silences francs sur trames de 50 ms calculés sur le
 * MÊME buffer décodé (aucun second décodage). `pisteAudio: null` quand le son
 * n'a pas pu être décodé : jamais confondu avec un silence.
 */
export interface SonRush {
  energie: number[];
  pisteAudio: boolean | null;
  silences?: Array<[number, number]>;
  sonContinu?: boolean;
}

/** Énergie RMS par fenêtre de `pas` secondes (0..1). Tableau vide si pas d'audio. */
export async function energieAudio(url: string, duree: number, pas: number): Promise<number[]> {
  return (await sonDuRush(url, duree, pas)).energie;
}

export async function sonDuRush(url: string, duree: number, pas: number): Promise<SonRush> {
  const inconnu: SonRush = { energie: [], pisteAudio: null };
  try {
    // Trop gros pour décoder le son : on ne le télécharge même pas (le
    // résultat est le même qu'avant — aucune énergie audio — sans les octets).
    const annoncee = await tailleAnnoncee(url);
    if (annoncee !== null && annoncee > AUDIO_OCTETS_MAX) return inconnu;
    const rep = await fetch(url);
    if (!rep.ok) return inconnu;
    const octets = await rep.arrayBuffer();
    if (octets.byteLength > AUDIO_OCTETS_MAX) return inconnu;
    const Ctx = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx) return inconnu;
    const ctx = new Ctx(1, 1, 22050);
    const buf = await ctx.decodeAudioData(octets);
    const data = buf.getChannelData(0);
    const n = Math.ceil(duree / pas);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * pas * buf.sampleRate);
      const b = Math.min(data.length, Math.floor((i + 1) * pas * buf.sampleRate));
      let s = 0;
      for (let j = a; j < b; j += 4) s += data[j] * data[j];
      out.push(b > a ? Math.min(1, Math.sqrt(s / Math.ceil((b - a) / 4)) * 4) : 0);
    }
    // M3-a PR2 : silences 50 ms sur la durée analysée, depuis le buffer déjà décodé.
    const fin = Math.min(data.length, Math.floor(duree * buf.sampleRate));
    const m = silencesDepuisEchantillons(data.subarray(0, fin), buf.sampleRate);
    return { energie: out, pisteAudio: true, silences: m.silences, sonContinu: m.sonContinu };
  } catch {
    return inconnu; // rush sans piste audio, codec non décodable : pas bloquant
  }
}

export async function analyserRush(
  url: string,
  onProgress?: (fraction: number) => void,
  options: { dureeMax?: number | null } = {},
): Promise<AnalyseNavigateur | null> {
  let video: HTMLVideoElement | null = null;
  try {
    video = await chargerVideo(url);
    const dureeTotale = video.duration;
    if (!Number.isFinite(dureeTotale) || dureeTotale < 1) return null;
    const duree = dureeAnalysee(dureeTotale, options.dureeMax);
    const partielle = duree < dureeTotale;
    const pas = Math.max(0.5, duree / ECHANTILLONS_MAX);
    const audioP = sonDuRush(url, duree, pas);

    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // M1 : netteté QUALITÉ (320×320), 8 images au plus — jamais lue par planMontage.
    const canvasHD = document.createElement('canvas');
    canvasHD.width = HD_L;
    canvasHD.height = HD_H;
    const ctxHD = canvasHD.getContext('2d', { willReadFrequently: true });
    if (ctxHD) ctxHD.imageSmoothingQuality = 'high';
    const pasHD = Math.max(pas, duree / HD_IMAGES);
    let trancheHD = -1;
    const mesuresHD: Array<{ finesse: number; detail: number }> = [];

    const echantillons: EchantillonRush[] = [];
    /** Images d'analyse gardées (64×36, ~9 Ko chacune) : la 2e mesure des coupes les compare. */
    const images: Float32Array[] = [];
    const lireGris = (): Float32Array => {
      ctx.drawImage(video!, 0, 0, L, H);
      const px = ctx.getImageData(0, 0, L, H).data;
      const g = new Float32Array(L * H);
      for (let p = 0, q = 0; p < px.length; p += 4, q++) g[q] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) / 255;
      return g;
    };
    let prec: Float32Array | null = null;
    const total = Math.floor(duree / pas);
    for (let i = 0, t = 0; t < duree; i++, t = i * pas) {
      await attendreSeek(video, t);
      ctx.drawImage(video, 0, 0, L, H);
      const px = ctx.getImageData(0, 0, L, H).data; // lève si le rush n'est pas CORS : → null
      const gris = new Float32Array(L * H);
      for (let p = 0, q = 0; p < px.length; p += 4, q++) {
        gris[q] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) / 255;
      }
      const m = mesurerImage(gris, prec);
      prec = gris;
      images.push(gris);
      echantillons.push({ t: Math.round(t * 1000) / 1000, ...m, saturation: saturationRgb(px, 4), audio: 0 });
      if (ctxHD && Math.floor(t / pasHD) > trancheHD) {
        trancheHD = Math.floor(t / pasHD);
        ctxHD.drawImage(video, 0, 0, HD_L, HD_H);
        const pxHD = ctxHD.getImageData(0, 0, HD_L, HD_H).data;
        const grisHD = new Float32Array(HD_L * HD_H);
        for (let p = 0, q = 0; p < pxHD.length; p += 4, q++) grisHD[q] = (pxHD[p] * 0.299 + pxHD[p + 1] * 0.587 + pxHD[p + 2] * 0.114) / 255;
        mesuresHD.push(mesurerNetteteHD(grisHD));
      }
      onProgress?.(Math.min(0.95, (i + 1) / Math.max(1, total)));
    }
    // #613 — 2e mesure LOCALE (vidéo déjà chargée, aucun octet de plus) : chaque coupe franche vue entre
    // deux échantillons est localisée au dixième de seconde. Sans elle, `plansPropres` écarte tout
    // l'intervalle (0,5 s) : démo « LE SPORT », 0,5 s de matière valide jetée sur 3 rushes.
    const coupesFines = await localiserCoupesFines(echantillons, images, pas, async (t) => {
      await attendreSeek(video!, t);
      return lireGris();
    }, onProgress);
    const son = await audioP;
    const audio = son.energie;
    echantillons.forEach((e, i) => { e.audio = audio[i] ?? 0; });
    onProgress?.(1);
    const netteteHD = agregerNetteteHD(mesuresHD);
    const sonFin = { pisteAudio: son.pisteAudio, ...(son.silences ? { silences: son.silences, sonContinu: !!son.sonContinu } : null) };
    return { url, duree, echantillons, ...(coupesFines.length ? { coupesFines } : null), ...(netteteHD ? { netteteHD } : null), ...(partielle ? { partielle: true as const } : null), ...sonFin };
  } catch (err) {
    console.warn('[SmartMontage] analyse impossible, enchaînement classique :', url.slice(0, 60), err);
    return null;
  } finally {
    if (video) { video.removeAttribute('src'); video.load(); }
  }
}

// ── UNE analyse par rush, pour le panneau Qualité ET l'export ───────────
// Même promesse : mêmes chiffres par construction. Purgée si le résultat est
// `null` (rush illisible, CORS) pour qu'un nouvel essai reste possible.
const MEMO_MAX = 40;
type Analyse = (url: string, onProgress?: (fraction: number) => void, borne?: boolean) => Promise<AnalyseNavigateur | null>;

/**
 * Fabrique d'une analyse mémorisée par URL (sur le modèle
 * d'`analyserRushServeurCache`). Testable avec une analyse factice ; la
 * progression est relayée à TOUS les demandeurs.
 *
 *  - `borne: true` (panneau) : peut rendre une analyse `partielle` (rush > 180 s) ;
 *  - sans borne (export) : n'accepte JAMAIS une analyse partielle — il attend
 *    celle du panneau, et si elle est partielle, relance une analyse ENTIÈRE
 *    qui la remplace. Rush ≤ 180 s : une seule analyse, identique pour les deux.
 */
export function creerMemoAnalyses(analyser: Analyse, max = MEMO_MAX) {
  type Entree = { analyse: Promise<AnalyseNavigateur | null>; abonnes: Set<(f: number) => void> };
  const memo = new Map<string, Entree>();
  const lancer = (url: string, onProgress: ((f: number) => void) | undefined, borne: boolean): Promise<AnalyseNavigateur | null> => {
    const abonnes = new Set<(f: number) => void>(onProgress ? [onProgress] : []);
    const analyse: Promise<AnalyseNavigateur | null> = analyser(url, (f) => abonnes.forEach((a) => a(f)), borne)
      .catch(() => null)
      .then((a) => { if (!a && memo.get(url)?.analyse === analyse) memo.delete(url); abonnes.clear(); return a; });
    memo.set(url, { analyse, abonnes });
    while (memo.size > max) memo.delete(memo.keys().next().value as string);
    return analyse;
  };
  const analyserMemo = async (url: string, onProgress?: (fraction: number) => void, opts: { borne?: boolean } = {}): Promise<AnalyseNavigateur | null> => {
    const borne = opts.borne === true;
    const hit = memo.get(url);
    if (!hit) return lancer(url, onProgress, borne);
    if (onProgress) hit.abonnes.add(onProgress);
    const a = await hit.analyse;
    if (onProgress) hit.abonnes.delete(onProgress);
    // L'export ne prend jamais une analyse bornée incomplète.
    if (!borne && a?.partielle) {
      const courante = memo.get(url);
      if (courante && courante !== hit) return analyserMemo(url, onProgress, opts);
      return lancer(url, onProgress, false);
    }
    return a;
  };
  return { analyserMemo, vider: () => memo.clear(), taille: () => memo.size };
}

const memoNavigateur = creerMemoAnalyses((url, p, borne) => analyserRush(url, p, { dureeMax: borne ? DUREE_ANALYSEE_MAX : null }));
/**
 * L'analyse d'un rush, UNE fois par URL : panneau Qualité (`{ borne: true }`)
 * et export (sans borne, comme avant M1).
 */
export const analyserRushMemo = memoNavigateur.analyserMemo;

/**
 * Rythme de la musique, dans le navigateur (Créer) — même analyse que le
 * serveur (`rythme-musique.ts`). `null` si la musique est illisible.
 */
export function analyserMusiqueNavigateur(url: string): Promise<RythmeMusique | null> {
  // M3-a PR3 : UNE lecture par URL (aperçu rapide et export partagent le même
  // objet — c'est aussi ce qui prouve que le rythme n'a pas changé). Un échec
  // n'est pas retenu : un nouvel essai reste possible.
  const hit = memoMusique.get(url);
  if (hit) return hit;
  const p = lireRythmeMusique(url).then((r) => { if (!r && memoMusique.get(url) === p) memoMusique.delete(url); return r; });
  memoMusique.set(url, p);
  while (memoMusique.size > MEMO_MUSIQUE_MAX) memoMusique.delete(memoMusique.keys().next().value as string);
  return p;
}

const MEMO_MUSIQUE_MAX = 8;
const memoMusique = new Map<string, Promise<RythmeMusique | null>>();
/** Tests : vide le mémo du rythme. */
export function viderMemoMusique(): void { memoMusique.clear(); }

async function lireRythmeMusique(url: string): Promise<RythmeMusique | null> {
  try {
    const rep = await fetch(url);
    if (!rep.ok) return null;
    const Ctx = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx) return null;
    const buf = await new Ctx(1, 1, 11025).decodeAudioData(await rep.arrayBuffer());
    return analyserRythme(buf.getChannelData(0), buf.sampleRate);
  } catch {
    return null;
  }
}
