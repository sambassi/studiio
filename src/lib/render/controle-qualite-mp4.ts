/**
 * CONTRÔLE QUALITÉ DU MP4 FINAL — commun à l'Autopilote et à Créer.
 *
 * Un fichier rendu est REGARDÉ par ffmpeg, jamais jugé sur la configuration.
 * Aucune dépendance à `ffprobe` (absent de `ffmpeg-static`, présent en
 * production sans que ce soit un contrat) : tout vient de `ffmpeg` seul.
 *
 *   mesurerMp4()      — IO : trois passages courts sur un fichier LOCAL
 *                       (analyse vidéo à 2 images/s, copie de chaque piste pour
 *                       leurs durées, volume via `mesurerAudioFichier`).
 *   evaluerControleMp4() — PUR : mesures + attentes → niveau et problèmes.
 *
 * ⚠️ NE CHANGE RIEN À L'ENCODAGE ni au montage : le contrôle observe et
 * signale. Les défauts mineurs sont des AVERTISSEMENTS discrets ; seul un
 * fichier illisible, sans vidéo ou vide est `inutilisable`
 * (l'appelant applique alors sa gestion d'erreur existante).
 *
 * Ce que chaque contrôle vaut, honnêtement :
 *  - netteté : énergie de contours (Sobel) d'images réduites à 270 px. Sur un
 *    banc réel, un plan net vaut ≈ 24 et le même plan flouté ≈ 3,5. Un fond uni
 *    ou un montage de cartes très épurées peut aussi être bas : c'est un
 *    AVERTISSEMENT sur la part des images, jamais un blocage.
 *  - écart audio/vidéo : différence des durées des deux pistes. Ce n'est pas
 *    une mesure de décalage de phase (non fiable sans repère commun) : elle
 *    détecte une piste tronquée ou trop longue.
 *  - noirs : un fondu volontaire au début ou à la fin (≤ 0,6 s) n'en est pas un ;
 *    une vidéo presque noire est SIGNALÉE, jamais bloquée (scène de nuit).
 *  - images plates (fond uni, dégradé, carte de texte, scène très sombre) : leur
 *    netteté n'est pas jugée (`contrasteMin`).
 */
import { spawn } from 'child_process';
import { mesurerAudioFichier, type MesureAudioFichier } from '@/lib/render/audio-fichier';

export const VERSION_CONTROLE_MP4 = 1 as const;

/** Réglages chiffrés, écrits une fois. */
export const SEUILS_CONTROLE_MP4 = {
  /** Images analysées par seconde. */
  imagesParSeconde: 2,
  /** Largeur de réduction avant mesure (px) — l'échelle des seuils de netteté. */
  largeurAnalyse: 270,
  /** Fondu volontaire toléré au début et à la fin (s). */
  fonduTolereS: 0.6,
  /** Plan noir anormal : durée restante, hors fondu, au-delà de laquelle on avertit (s). */
  noirAnormalS: 0.8,
  /**
   * Part de la durée noire au-delà de laquelle on signale une vidéo « presque entièrement noire ».
   * AVERTISSEMENT, jamais blocage : une scène de nuit réelle assombrie de 35 % est déjà vue noire
   * 67 % du temps par `blackdetect` (banc du 26/10) — bloquer jetterait un rendu valide.
   */
  noirInutilisable: 0.9,
  /** Énergie de contours sous laquelle une image est « floue ou vide » (banc : images nettes 9 à 34, moyenne 24 ; mêmes images floutées 3 à 5, moyenne 3,7). */
  netteteFloue: 6,
  /**
   * Écart de luminosité (10e → 90e centile, 0..255) sous lequel une image est PLATE (fond uni,
   * dégradé, carte de texte, scène très sombre) : sa netteté n'est pas jugée. Banc du 26/10 :
   * fond uni 0, dégradé 20–30, scènes sombres 0–12 ; vrais plans nets 36–66, mêmes plans floutés 31–53.
   */
  contrasteMin: 28,
  /**
   * Énergie de contours sous laquelle l'image n'a AUCUNE structure (dégradé lisse, fond uni) :
   * pas jugée non plus. Banc du 26/10 : dégradés 0,6–1,5 (même quand leur écart de luminosité
   * dépasse `contrasteMin`, en 540×960) ; vrais plans floutés 3–5. Un flou réel extrême passe
   * donc sans avertissement — préféré à un faux « flou » sur chaque carte graphique.
   */
  structureMin: 2,
  /** Part d'images floues au-delà de laquelle on avertit. */
  partFloue: 0.7,
  /** Nombre d'images minimal pour juger la netteté. */
  imagesMinNettete: 6,
  /** Écart de durée audio/vidéo toléré (s). */
  ecartAudioVideoS: 0.5,
  /** Écart de durée toléré avec le plan : le plus grand de (s) et (part). */
  ecartDureeS: 1,
  ecartDureePart: 0.08,
  /** Plus petit côté sous lequel la résolution est signalée (px). */
  coteMinPx: 540,
  /** Durée sous laquelle le fichier n'est pas un montage (s). */
  dureeMinS: 0.5,
} as const;

export interface MesuresMp4 {
  /** `null` si ffmpeg a échoué ou n'a rien pu lire. */
  erreur: string | null;
  /** Durée du conteneur (s), `null` si illisible. */
  dureeS: number | null;
  video: { codec: string; largeur: number; hauteur: number; fps: number | null; debitKbps: number | null } | null;
  audio: { codec: string; hz: number | null } | null;
  /** Durée de chaque piste, mesurée par copie (s). */
  dureeVideoS: number | null;
  dureeAudioS: number | null;
  /** Intervalles noirs [début, fin] (s). */
  noirs: Array<[number, number]>;
  /** Énergie de contours par image analysée (hors intervalles noirs). */
  netteteImages: number[];
  /** Son mesuré sur le fichier (`volumedetect`). */
  son: MesureAudioFichier | null;
}

export interface AttentesMp4 {
  /** Durée du plan de montage (s), si connue. */
  dureeS?: number | null;
  /** `attendu` : un son doit être audible ; `absent` : volontairement muet ; `inconnu` : on ne dit rien. */
  son?: 'attendu' | 'absent' | 'inconnu';
  /** Format du post : contrôle l'orientation. */
  format?: 'reel' | 'tv' | 'carre' | null;
}

export type GraviteControle = 'avertissement' | 'inutilisable';

export interface ProblemeControleMp4 {
  code: string;
  gravite: GraviteControle;
  message: string;
}

export interface ResultatControleMp4 {
  version: typeof VERSION_CONTROLE_MP4;
  niveau: 'ok' | GraviteControle;
  problemes: ProblemeControleMp4[];
  /** Ce qui a été mesuré, pour le diagnostic (jamais d'URL ni de chemin). */
  resume: {
    dureeS: number | null;
    resolution: string | null;
    codecVideo: string | null;
    codecAudio: string | null;
    sonAudible: boolean | null;
    noirsS: number;
    netteteMoyenne: number | null;
  };
}

// ── Lecture des journaux ffmpeg (PURE) ────────────────────────────────────

/** `00:01:02.50` → 62.5 */
function secondes(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** Dernière valeur `time=` d'un journal ffmpeg (durée décodée), `null` sinon. */
export function dernierTemps(journal: string): number | null {
  const tous = [...journal.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!tous.length) return null;
  const d = tous[tous.length - 1];
  return secondes(d[1], d[2], d[3]);
}

/** Durée du conteneur, codecs, résolution, fps, débit — lus dans l'en-tête de `ffmpeg -i`. */
export function lireEntete(journal: string): Pick<MesuresMp4, 'dureeS' | 'video' | 'audio'> {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(journal);
  const v = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video:\s*([^\s,(]+)[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*/.exec(journal);
  const a = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:\s*([^\s,(]+)([^\n]*)/.exec(journal);
  let video: MesuresMp4['video'] = null;
  if (v) {
    const ligne = v[0];
    const fps = /([\d.]+)\s*fps/.exec(ligne);
    const debit = /(\d+)\s*kb\/s/.exec(ligne);
    video = {
      codec: v[1], largeur: Number(v[2]), hauteur: Number(v[3]),
      fps: fps ? Number(fps[1]) : null, debitKbps: debit ? Number(debit[1]) : null,
    };
  }
  const hz = a ? /(\d+)\s*Hz/.exec(a[2]) : null;
  return {
    dureeS: d ? secondes(d[1], d[2], d[3]) : null,
    video,
    audio: a ? { codec: a[1], hz: hz ? Number(hz[1]) : null } : null,
  };
}

/** Intervalles de `blackdetect` (journal d'erreur). */
export function lireNoirs(journal: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of journal.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

/**
 * Écart de luminosité (YHIGH − YLOW) de chaque image, dans l'ordre, lu dans le
 * journal d'erreur (`metadata=print` sans fichier, AVANT Sobel).
 */
export function lireContrastes(journal: string): number[] {
  const hauts = [...journal.matchAll(/lavfi\.signalstats\.YHIGH=(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const bas = [...journal.matchAll(/lavfi\.signalstats\.YLOW=(-?[\d.]+)/g)].map((m) => Number(m[1]));
  if (hauts.length !== bas.length) return [];
  return hauts.map((h, i) => h - bas[i]);
}

/**
 * Énergie de contours (`YAVG` après Sobel) des images JUGEABLES, lue dans la
 * sortie de `metadata=print` (blocs « frame:N pts_time:T » puis la valeur).
 * Écartées : les images d'un intervalle NOIR (comptées par `blackdetect`), les
 * images sans aucune structure (`structureMin`) et, si `contrastes` est fourni,
 * les images PLATES (`contrasteMin`) — un fond uni n'est pas « flou ». Contrastes fournis mais non alignés sur les images : rien
 * n'est jugé (jamais un avertissement sur une mesure incohérente).
 */
export function lireNetteteImages(
  sortie: string, noirs: ReadonlyArray<[number, number]> = [], contrastes: ReadonlyArray<number> | null = null,
): number[] {
  const images = [...sortie.matchAll(/pts_time:\s*(-?[\d.]+)\s*\n\s*lavfi\.signalstats\.YAVG=(-?[\d.]+)/g)]
    .map((m) => ({ t: Number(m[1]), net: Number(m[2]) }));
  if (contrastes && contrastes.length !== images.length) return [];
  const out: number[] = [];
  images.forEach(({ t, net }, i) => {
    if (noirs.some(([d, f]) => t >= d - 1e-6 && t < f)) return;
    if (contrastes && contrastes[i] < SEUILS_CONTROLE_MP4.contrasteMin) return;
    if (net < SEUILS_CONTROLE_MP4.structureMin) return;
    out.push(net);
  });
  return out;
}

// ── Évaluation (PURE) ─────────────────────────────────────────────────────

/** Durée noire ANORMALE d'un intervalle : le noir hors fondu volontaire d'entrée et de sortie. */
export function noirAnormalS(intervalle: [number, number], dureeS: number, fondu: number = SEUILS_CONTROLE_MP4.fonduTolereS): number {
  const debut = Math.max(intervalle[0], fondu);
  const fin = Math.min(intervalle[1], dureeS - fondu);
  return Math.max(0, fin - debut);
}

export function evaluerControleMp4(m: MesuresMp4, attentes: AttentesMp4 = {}): ResultatControleMp4 {
  const S = SEUILS_CONTROLE_MP4;
  const problemes: ProblemeControleMp4[] = [];
  const pb = (code: string, gravite: GraviteControle, message: string) => problemes.push({ code, gravite, message });

  const dureeS = m.dureeS ?? m.dureeVideoS;
  const noirsS = dureeS ? m.noirs.reduce((t, i) => t + Math.max(0, i[1] - i[0]), 0) : 0;
  const netteteMoyenne = m.netteteImages.length ? m.netteteImages.reduce((t, x) => t + x, 0) / m.netteteImages.length : null;
  const resume: ResultatControleMp4['resume'] = {
    dureeS: dureeS ?? null,
    resolution: m.video ? `${m.video.largeur}x${m.video.hauteur}` : null,
    codecVideo: m.video?.codec ?? null,
    codecAudio: m.audio?.codec ?? null,
    sonAudible: m.son ? !m.son.silencieux : null,
    noirsS: Math.round(noirsS * 10) / 10,
    netteteMoyenne: netteteMoyenne === null ? null : Math.round(netteteMoyenne * 10) / 10,
  };
  const fin = (): ResultatControleMp4 => ({
    version: VERSION_CONTROLE_MP4,
    niveau: problemes.some((p) => p.gravite === 'inutilisable') ? 'inutilisable' : problemes.length ? 'avertissement' : 'ok',
    problemes, resume,
  });

  // Fichier illisible, sans vidéo, ou trop court pour être un montage.
  if (m.erreur) { pb('illisible', 'inutilisable', 'Le fichier vidéo est illisible.'); return fin(); }
  if (!m.video) { pb('pas_de_video', 'inutilisable', 'Le fichier ne contient aucune piste vidéo.'); return fin(); }
  if (!(dureeS && dureeS >= S.dureeMinS)) { pb('trop_court', 'inutilisable', 'Le fichier vidéo est vide ou trop court.'); return fin(); }

  // Presque entièrement noir : signalé, jamais bloquant (une vraie scène de nuit y ressemble).
  const presqueNoire = noirsS / dureeS >= S.noirInutilisable;
  if (presqueNoire) pb('image_noire', 'avertissement', 'La vidéo est presque entièrement noire ou très sombre.');

  // Durée réelle contre plan.
  if (attentes.dureeS && attentes.dureeS > 0) {
    const tolerance = Math.max(S.ecartDureeS, attentes.dureeS * S.ecartDureePart);
    if (Math.abs(dureeS - attentes.dureeS) > tolerance) {
      pb('duree_ecart', 'avertissement', `La vidéo dure ${Math.round(dureeS)} s au lieu des ${Math.round(attentes.dureeS)} s prévues.`);
    }
  }

  // Son.
  if (attentes.son === 'attendu') {
    if (!m.audio) pb('son_absent', 'avertissement', 'La vidéo ne contient pas de son alors qu’il était prévu.');
    else if (m.son?.silencieux) pb('son_muet', 'avertissement', 'Le son de la vidéo est inaudible alors qu’il était prévu.');
  }

  // Noirs anormaux (le fondu d'entrée et de sortie est volontaire).
  const anormal = m.noirs.reduce((t, i) => t + noirAnormalS(i, dureeS), 0);
  if (!presqueNoire && anormal > S.noirAnormalS) {
    pb('images_noires', 'avertissement', `La vidéo contient environ ${Math.round(anormal * 10) / 10} s d’images noires ou très sombres.`);
  }

  // Netteté.
  if (m.netteteImages.length >= S.imagesMinNettete) {
    const floues = m.netteteImages.filter((x) => x < S.netteteFloue).length / m.netteteImages.length;
    if (floues > S.partFloue) pb('image_floue', 'avertissement', 'Les images de la vidéo semblent floues.');
  }

  // Écart de durée entre les pistes.
  if (m.dureeVideoS !== null && m.dureeAudioS !== null && Math.abs(m.dureeVideoS - m.dureeAudioS) > S.ecartAudioVideoS) {
    pb('ecart_audio_video', 'avertissement', `Le son et l’image ne durent pas pareil (${Math.round(m.dureeAudioS * 10) / 10} s de son pour ${Math.round(m.dureeVideoS * 10) / 10} s d’image).`);
  }

  // Encodage et résolution (observés, jamais modifiés).
  if (!/^h264|^avc/i.test(m.video.codec)) pb('codec_video', 'avertissement', `Codec vidéo inattendu (${m.video.codec}) pour un MP4.`);
  if (m.audio && !/^aac/i.test(m.audio.codec)) pb('codec_audio', 'avertissement', `Codec audio inattendu (${m.audio.codec}) pour un MP4.`);
  if (Math.min(m.video.largeur, m.video.hauteur) < S.coteMinPx) {
    pb('resolution_basse', 'avertissement', `Résolution basse (${m.video.largeur}×${m.video.hauteur}).`);
  }
  if (attentes.format) {
    const portrait = m.video.hauteur > m.video.largeur;
    const paysage = m.video.largeur > m.video.hauteur;
    if ((attentes.format === 'reel' && !portrait) || (attentes.format === 'tv' && !paysage)) {
      pb('orientation', 'avertissement', 'L’orientation de la vidéo ne correspond pas au format choisi.');
    }
  }
  return fin();
}

/** Les messages, dans l'ordre, pour l'interface (avertissements seulement). */
export function messagesControle(r: ResultatControleMp4 | null | undefined): string[] {
  return (r?.problemes ?? []).filter((p) => p.gravite === 'avertissement').map((p) => p.message);
}

// ── Mesure (IO) ───────────────────────────────────────────────────────────

interface Sortie { code: number | null; stdout: string; stderr: string; absent: boolean }

function lancer(ffmpeg: string, args: string[], timeoutMs: number): Promise<Sortie> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let fini = false;
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const terminer = (s: Sortie) => { if (!fini) { fini = true; clearTimeout(minuteur); resolve(s); } };
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); terminer({ code: null, stdout, stderr: `${stderr}\n[délai]`, absent: false }); }, timeoutMs);
    p.stdout.on('data', (b: Buffer) => { stdout += b.toString(); });
    p.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
    p.on('error', (e: NodeJS.ErrnoException) => terminer({ code: null, stdout, stderr: String(e.message), absent: e.code === 'ENOENT' }));
    p.on('close', (code) => terminer({ code, stdout, stderr, absent: false }));
  });
}

/**
 * Mesure un MP4 LOCAL. Rend `null` si ffmpeg est introuvable (le contrôle ne
 * peut pas avoir lieu : l'appelant continue, comme avant) ; `erreur` renseignée
 * si le fichier n'a pas pu être lu.
 */
export async function mesurerMp4(chemin: string, ffmpeg = 'ffmpeg', timeoutMs = 60_000): Promise<MesuresMp4 | null> {
  const S = SEUILS_CONTROLE_MP4;
  const base = ['-hide_banner', '-nostdin', '-threads', '0'];
  const filtre = [
    `fps=${S.imagesParSeconde}`, `scale=${S.largeurAnalyse}:-2`, 'blackdetect=d=0.3:pic_th=0.98:pix_th=0.10',
    // Contraste de l'image (avant Sobel) dans le journal, énergie de contours sur la sortie standard.
    'format=gray', 'signalstats', 'metadata=print:key=lavfi.signalstats.YHIGH', 'metadata=print:key=lavfi.signalstats.YLOW',
    'sobel', 'signalstats', 'metadata=print:key=lavfi.signalstats.YAVG:file=-',
  ].join(',');
  const video = await lancer(ffmpeg, [...base, '-i', chemin, '-an', '-vf', filtre, '-f', 'null', '-'], timeoutMs);
  // ffmpeg introuvable, ou analyse trop lente : on ne peut PAS juger — jamais un faux « illisible ».
  if (video.absent || video.code === null) return null;

  const vide: MesuresMp4 = {
    erreur: null, dureeS: null, video: null, audio: null, dureeVideoS: null, dureeAudioS: null, noirs: [], netteteImages: [], son: null,
  };
  const entete = lireEntete(video.stderr);
  if (video.code !== 0 || !entete.video) {
    return { ...vide, ...entete, erreur: 'fichier illisible' };
  }

  const [dv, da, son] = await Promise.all([
    lancer(ffmpeg, [...base, '-i', chemin, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], timeoutMs),
    entete.audio ? lancer(ffmpeg, [...base, '-i', chemin, '-map', '0:a:0', '-c', 'copy', '-f', 'null', '-'], timeoutMs) : Promise.resolve(null),
    entete.audio ? mesurerAudioFichier(chemin, ffmpeg, timeoutMs) : Promise.resolve(null),
  ]);
  const noirs = lireNoirs(video.stderr);
  return {
    ...vide,
    ...entete,
    dureeVideoS: dernierTemps(dv.stderr),
    dureeAudioS: da ? dernierTemps(da.stderr) : null,
    noirs,
    netteteImages: lireNetteteImages(video.stdout, noirs, lireContrastes(video.stderr)),
    son,
  };
}

/** Mesure puis évalue. `null` si ffmpeg est introuvable : pas de contrôle, pas de blocage. */
export async function controlerMp4(
  chemin: string, attentes: AttentesMp4 = {}, options: { ffmpeg?: string; timeoutMs?: number } = {},
): Promise<ResultatControleMp4 | null> {
  const m = await mesurerMp4(chemin, options.ffmpeg, options.timeoutMs);
  return m ? evaluerControleMp4(m, attentes) : null;
}
