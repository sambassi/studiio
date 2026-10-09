/**
 * PRÉPARER LA VIDÉO SOURCE — les règles PURES.
 *
 * Module sans réseau, sans stockage, sans `child_process` : il est lu par le
 * serveur (`preparation-source.ts`, les routes `/api/avatar/sources/*`) ET
 * par l'éditeur du navigateur (`PreparationSource.tsx`). Une seule règle,
 * donc, pour ce que l'aperçu promet et ce que ffmpeg produit.
 *
 * Le principe est NON DESTRUCTIF : l'ORIGINAL reste tel quel en stockage, la
 * version PRÉPARÉE (coupe, recadrage, rotation, correction légère) est un
 * second objet. Aucune déformation du visage, aucun filtre « beauté » : les
 * corrections sont bornées à ce qu'un étalonnage naturel ferait.
 *
 * Les exigences sont celles du fournisseur (« digital twin », documentation
 * vérifiée) : 15 à 600 s, grand côté entre 640 et 4096 px (1080p
 * recommandé), MP4 ou WebM, une seule personne face caméra, voix claire —
 * et 32 Mo par l'envoi direct de Studiio (`EXIGENCES_SOURCE_VIDEO`).
 */

import { EXIGENCES_SOURCE_VIDEO } from '@/lib/avatar/capture';

/** Grand côté maximal accepté par le fournisseur. */
export const GRAND_COTE_MAX_PX = 4096;
/** Grand côté recommandé (1080p) : en dessous, un simple avertissement. */
export const GRAND_COTE_RECOMMANDE_PX = 1080;
/** Au-delà, la version préparée est réduite : 1080p suffit, et le poids reste sous 32 Mo. */
export const GRAND_COTE_SORTIE_MAX_PX = 1920;
export const TAILLE_MAX_OCTETS = EXIGENCES_SOURCE_VIDEO.tailleMaxMo * 1024 * 1024;

export const TYPES_VIDEO_ACCEPTES: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const CODECS_VIDEO_ACCEPTES = ['h264', 'hevc', 'vp8', 'vp9'];

// ─────────────────────────────────────────────────────────────────────────
// Ce que ffprobe dit d'un fichier
// ─────────────────────────────────────────────────────────────────────────

export type Rotation = 0 | 90 | 180 | 270;

export interface InfosVideo {
  /** `format_name` de ffprobe (`mov,mp4,m4a,3gp,3g2,mj2`, `matroska,webm`…). */
  conteneur: string;
  codecVideo: string | null;
  codecAudio: string | null;
  /** Dimensions CODÉES du flux. */
  largeur: number;
  hauteur: number;
  /** Rotation d'affichage déclarée par le fichier (téléphones). */
  rotation: Rotation;
  /** Dimensions À L'AFFICHAGE : codées, permutées si la rotation est 90/270. */
  largeurEffective: number;
  hauteurEffective: number;
  dureeS: number;
  fps: number;
  debitBps: number | null;
  tailleOctets: number;
}

/** Une rotation quelconque (−90, 270, "90", 450…) ramenée au quart de tour le plus proche. */
export function normaliserRotation(brute: unknown): Rotation {
  const n = typeof brute === 'string' ? Number(brute) : typeof brute === 'number' ? brute : NaN;
  if (!Number.isFinite(n)) return 0;
  const quart = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
  return quart as Rotation;
}

function nombre(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** `30000/1001` → 29.97 ; `0/0` → 0. */
function cadence(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const [a, b] = v.split('/').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return Math.round((a / b) * 100) / 100;
}

interface FluxFfprobe {
  codec_type?: string; codec_name?: string; width?: number; height?: number;
  avg_frame_rate?: string; r_frame_rate?: string; duration?: string;
  tags?: Record<string, string>; side_data_list?: Array<{ rotation?: number | string }>;
}

/**
 * La sortie JSON de `ffprobe -show_format -show_streams`, lue. `null` si le
 * fichier n'a rien d'exploitable (ni format, ni flux).
 */
export function analyserSortieFfprobe(json: unknown, tailleOctets: number): InfosVideo | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { streams?: FluxFfprobe[]; format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string } };
  const flux = Array.isArray(j.streams) ? j.streams : [];
  if (!j.format && flux.length === 0) return null;

  const video = flux.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png');
  const audio = flux.find((s) => s.codec_type === 'audio');

  const rotationBrute = video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate;
  const rotation = normaliserRotation(rotationBrute);
  const largeur = video?.width ?? 0;
  const hauteur = video?.height ?? 0;
  const permute = rotation === 90 || rotation === 270;

  const dureeS = nombre(j.format?.duration) ?? nombre(video?.duration) ?? 0;
  const taille = nombre(j.format?.size) ?? tailleOctets;

  return {
    conteneur: j.format?.format_name ?? '',
    codecVideo: video?.codec_name ?? null,
    codecAudio: audio?.codec_name ?? null,
    largeur,
    hauteur,
    rotation,
    largeurEffective: permute ? hauteur : largeur,
    hauteurEffective: permute ? largeur : hauteur,
    dureeS: Math.max(0, dureeS),
    fps: cadence(video?.avg_frame_rate) || cadence(video?.r_frame_rate),
    debitBps: nombre(j.format?.bit_rate),
    tailleOctets: taille > 0 ? taille : tailleOctets,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Le contrôle AVANT tout fournisseur
// ─────────────────────────────────────────────────────────────────────────

export interface ResultatPreflight {
  ok: boolean;
  /** Bloquants, en français, pour la personne. */
  motifs: string[];
  /** Non bloquants. */
  avertissements: string[];
}

const arrondi = (s: number) => Math.round(s);

/**
 * Le fichier respecte-t-il les règles du fournisseur ?
 *
 * `etape: 'original'` — le fichier importé, AVANT préparation : ce que la
 * préparation sait corriger (trop long → couper ; trop grand → réduire) n'y
 * est qu'un avertissement. `etape: 'traitee'` (défaut) — la version qui
 * partira : tout est bloquant.
 */
export function preflightSource(infos: InfosVideo, options: { etape?: 'original' | 'traitee' } = {}): ResultatPreflight {
  const etape = options.etape ?? 'traitee';
  const e = EXIGENCES_SOURCE_VIDEO;
  const motifs: string[] = [];
  const avertissements: string[] = [];
  const corrigible = (m: string, avertissement: string) => {
    if (etape === 'original') avertissements.push(avertissement);
    else motifs.push(m);
  };

  if (!infos.codecVideo || infos.largeur <= 0 || infos.hauteur <= 0) {
    motifs.push('Aucune image vidéo n’a été trouvée dans ce fichier.');
    return { ok: false, motifs, avertissements };
  }

  const conteneur = infos.conteneur.toLowerCase().split(',');
  if (!conteneur.some((c) => c === 'mp4' || c === 'mov' || c === 'webm')) {
    motifs.push('Format non pris en charge : utilisez une vidéo MP4, MOV ou WebM.');
  }
  if (!CODECS_VIDEO_ACCEPTES.includes(infos.codecVideo.toLowerCase())) {
    motifs.push(`Encodage vidéo non pris en charge (${infos.codecVideo}) : exportez la vidéo en MP4 (H.264).`);
  }
  if (!infos.codecAudio) {
    motifs.push('La vidéo n’a pas de son : votre voix est indispensable pour créer votre avatar.');
  }

  if (infos.dureeS < e.dureeMinS) {
    motifs.push(`La vidéo dure ${arrondi(infos.dureeS)} s : ${e.dureeMinS} secondes minimum (idéalement 2 minutes).`);
  } else if (infos.dureeS > e.dureeMaxS + 0.5) {
    corrigible(
      `La vidéo dure ${Math.ceil(infos.dureeS / 60)} min : ${e.dureeMaxS / 60} minutes maximum.`,
      `La vidéo dépasse ${e.dureeMaxS / 60} minutes : coupez-la à l’étape « Couper ».`,
    );
  }

  const grandCote = Math.max(infos.largeurEffective, infos.hauteurEffective);
  const resolution = `${infos.largeurEffective} × ${infos.hauteurEffective}`;
  if (grandCote < e.grandCoteMinPx) {
    motifs.push(`Résolution trop faible (${resolution}) : ${e.grandCoteMinPx} px minimum sur le grand côté, 1080p recommandé.`);
  } else if (grandCote > GRAND_COTE_MAX_PX) {
    corrigible(
      `Résolution trop élevée (${resolution}) : ${GRAND_COTE_MAX_PX} px maximum sur le grand côté.`,
      `Résolution très élevée (${resolution}) : elle sera réduite à la préparation.`,
    );
  } else if (grandCote < GRAND_COTE_RECOMMANDE_PX) {
    avertissements.push(`Résolution correcte (${resolution}), mais une vidéo 1080p donne un avatar plus net.`);
  }

  if (infos.tailleOctets > TAILLE_MAX_OCTETS) {
    corrigible(
      `Vidéo trop lourde (${Math.round(infos.tailleOctets / 1024 / 1024)} Mo) : ${e.tailleMaxMo} Mo maximum.`,
      `Vidéo lourde (${Math.round(infos.tailleOctets / 1024 / 1024)} Mo) : elle sera allégée à la préparation.`,
    );
  }

  if (infos.fps > 0 && infos.fps < 20) {
    avertissements.push(`Image saccadée (${Math.round(infos.fps)} images/s) : 25 à 30 images/s donnent un mouvement plus naturel.`);
  }

  return { ok: motifs.length === 0, motifs, avertissements };
}

export type NiveauQualite = 'bon' | 'acceptable' | 'insuffisant';

/** Bon / Acceptable / Insuffisant, tel que l'éditeur l'affiche. */
export function niveauQualite(p: ResultatPreflight): NiveauQualite {
  if (!p.ok) return 'insuffisant';
  return p.avertissements.length > 0 ? 'acceptable' : 'bon';
}

// ─────────────────────────────────────────────────────────────────────────
// Les paramètres de préparation, et leurs bornes
// ─────────────────────────────────────────────────────────────────────────

export interface ParametresAmelioration {
  active: boolean;
  /** `eq=brightness` : −0,08 … +0,08. */
  luminosite: number;
  /** `eq=contrast` : 0,9 … 1,15. */
  contraste: number;
  /** `eq=saturation` : 0,9 … 1,15. */
  saturation: number;
  /** Quantité d'`unsharp` (luma) : 0 … 0,6. */
  nettete: number;
  debruitage: boolean;
}

/** Fractions 0..1 de l'image APRÈS rotation. */
export interface Recadrage { x: number; y: number; largeur: number; hauteur: number }

export interface ParametresTraitement {
  debutS: number;
  finS: number;
  rotation: Rotation;
  recadrage: Recadrage | null;
  amelioration: ParametresAmelioration;
}

export const BORNES_AMELIORATION = {
  luminosite: [-0.08, 0.08],
  contraste: [0.9, 1.15],
  saturation: [0.9, 1.15],
  nettete: [0, 0.6],
} as const;

export const AMELIORATION_NEUTRE: ParametresAmelioration = {
  active: false, luminosite: 0, contraste: 1, saturation: 1, nettete: 0, debruitage: false,
};

const borner = (v: unknown, min: number, max: number, defaut: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : defaut;
  return Math.min(max, Math.max(min, n));
};

/** Les paramètres par défaut d'une vidéo de `dureeS` secondes : tout, sans retouche. */
export function parametresParDefaut(dureeS: number): ParametresTraitement {
  return {
    debutS: 0,
    finS: Math.min(Math.max(0, dureeS), EXIGENCES_SOURCE_VIDEO.dureeMaxS),
    rotation: 0,
    recadrage: null,
    amelioration: { ...AMELIORATION_NEUTRE },
  };
}

/** Dimensions de l'image après la rotation demandée. */
export function dimensionsApresRotation(largeur: number, hauteur: number, rotation: Rotation): { largeur: number; hauteur: number } {
  return rotation === 90 || rotation === 270 ? { largeur: hauteur, hauteur: largeur } : { largeur, hauteur };
}

/**
 * Tout ce que le navigateur envoie est RAMENÉ dans des bornes sûres — jamais
 * refusé pour un excès, jamais exécuté tel quel :
 *
 *   - coupe dans la durée, durée retenue entre 15 et 600 s (si la vidéo le permet) ;
 *   - rotation au quart de tour ;
 *   - recadrage dans l'image, assez grand pour garder 640 px sur le grand côté ;
 *   - corrections dans les plages d'un étalonnage naturel.
 *
 * `dims` : dimensions À L'AFFICHAGE de l'original (`largeurEffective`…). Sans
 * elles, le recadrage n'est borné qu'en fractions.
 */
export function bornerParametres(
  p: Partial<ParametresTraitement> | null | undefined,
  dureeS: number,
  dims?: { largeur: number; hauteur: number },
): ParametresTraitement {
  const e = EXIGENCES_SOURCE_VIDEO;
  const duree = Number.isFinite(dureeS) && dureeS > 0 ? dureeS : 0;
  const src = (p && typeof p === 'object' ? p : {}) as Partial<ParametresTraitement>;

  // ── Coupe ──
  let debut = borner(src.debutS, 0, duree, 0);
  let fin = borner(src.finS, 0, duree, duree);
  if (fin < debut) [debut, fin] = [fin, debut];
  if (fin - debut > e.dureeMaxS) fin = debut + e.dureeMaxS;
  if (fin - debut < e.dureeMinS) {
    fin = Math.min(duree, debut + e.dureeMinS);
    if (fin - debut < e.dureeMinS) debut = Math.max(0, fin - e.dureeMinS);
  }
  debut = Math.round(debut * 1000) / 1000;
  fin = Math.round(fin * 1000) / 1000;

  // ── Rotation ──
  const r = src.rotation;
  const rotation: Rotation = r === 90 || r === 180 || r === 270 ? r : 0;

  // ── Recadrage ──
  let recadrage: Recadrage | null = null;
  const c = src.recadrage;
  if (c && typeof c === 'object') {
    let l = borner(c.largeur, 0.05, 1, 1);
    let h = borner(c.hauteur, 0.05, 1, 1);
    if (dims && dims.largeur > 0 && dims.hauteur > 0) {
      const { largeur: W, hauteur: H } = dimensionsApresRotation(dims.largeur, dims.hauteur, rotation);
      const grandCote = Math.max(l * W, h * H);
      // Trop petit : agrandi PROPORTIONNELLEMENT, jusqu'à l'image entière.
      if (grandCote < e.grandCoteMinPx) {
        const k = Math.min(e.grandCoteMinPx / Math.max(1, grandCote), 1 / l, 1 / h);
        l = Math.min(1, l * k);
        h = Math.min(1, h * k);
      }
    }
    const x = borner(c.x, 0, 1 - l, 0);
    const y = borner(c.y, 0, 1 - h, 0);
    // L'image entière n'est pas un recadrage.
    recadrage = l >= 0.999 && h >= 0.999 ? null : { x, y, largeur: l, hauteur: h };
  }

  // ── Amélioration ──
  const a = (src.amelioration && typeof src.amelioration === 'object' ? src.amelioration : {}) as Partial<ParametresAmelioration>;
  const B = BORNES_AMELIORATION;
  const amelioration: ParametresAmelioration = {
    active: a.active === true,
    luminosite: borner(a.luminosite, B.luminosite[0], B.luminosite[1], 0),
    contraste: borner(a.contraste, B.contraste[0], B.contraste[1], 1),
    saturation: borner(a.saturation, B.saturation[0], B.saturation[1], 1),
    nettete: borner(a.nettete, B.nettete[0], B.nettete[1], 0),
    debruitage: a.debruitage === true,
  };

  return { debutS: debut, finS: fin, rotation, recadrage, amelioration };
}

// ─────────────────────────────────────────────────────────────────────────
// La commande ffmpeg
// ─────────────────────────────────────────────────────────────────────────

const pair = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const fixe = (n: number, d = 3) => Number(n.toFixed(d)).toString();

/**
 * Le débit vidéo PLAFOND pour que la version préparée tienne sous 32 Mo :
 * le budget (90 % de la limite, l'audio déduit) réparti sur la durée.
 */
export function debitVideoMaxBps(dureeS: number): number {
  const budget = (TAILLE_MAX_OCTETS * 8 * 0.9) / Math.max(1, dureeS) - 128_000;
  return Math.round(Math.min(8_000_000, Math.max(300_000, budget)));
}

/** Les dimensions de sortie (paires) et le recadrage en pixels, pour des paramètres déjà bornés. */
export function geometrieSortie(p: ParametresTraitement, infos: Pick<InfosVideo, 'largeurEffective' | 'hauteurEffective'>): {
  rogner: { l: number; h: number; x: number; y: number } | null;
  /** Dimensions juste avant la réduction éventuelle. */
  avantEchelle: { largeur: number; hauteur: number };
  largeur: number; hauteur: number;
} {
  const { largeur: W, hauteur: H } = dimensionsApresRotation(infos.largeurEffective, infos.hauteurEffective, p.rotation);
  let rogner: { l: number; h: number; x: number; y: number } | null = null;
  let l = W; let h = H;
  if (p.recadrage) {
    l = Math.min(pair(p.recadrage.largeur * W), pair(W));
    h = Math.min(pair(p.recadrage.hauteur * H), pair(H));
    const x = Math.min(pair(p.recadrage.x * W), Math.max(0, W - l));
    const y = Math.min(pair(p.recadrage.y * H), Math.max(0, H - h));
    rogner = { l, h, x: x - (x % 2), y: y - (y % 2) };
  }
  const avantEchelle = { largeur: l, hauteur: h };
  let sortieL = pair(l); let sortieH = pair(h);
  const grand = Math.max(sortieL, sortieH);
  if (grand > GRAND_COTE_SORTIE_MAX_PX) {
    const k = GRAND_COTE_SORTIE_MAX_PX / grand;
    sortieL = pair(sortieL * k);
    sortieH = pair(sortieH * k);
  }
  return { rogner, avantEchelle, largeur: sortieL, hauteur: sortieH };
}

/**
 * Les arguments de ffmpeg — fonction PURE, éprouvée sans binaire.
 *
 * L'ordre des filtres compte : rotation, recadrage, réduction, débruitage,
 * PUIS correction et netteté (accentuer un bruit qu'on va retirer serait
 * absurde). ffmpeg applique déjà la rotation déclarée par le fichier à la
 * lecture (autorotation) : `rotation` est un quart de tour EN PLUS, choisi
 * par la personne, et la métadonnée est remise à zéro en sortie.
 *
 * La coupe est un `-ss` d'ENTRÉE (positionnement rapide, exact en
 * ré-encodage) suivi d'un `-t` : `-to` en option d'entrée n'existe pas dans
 * tous les ffmpeg que la production peut exécuter (`binaires.ts`).
 */
export function argumentsFfmpeg(
  entree: string, sortie: string, p: ParametresTraitement,
  infos: Pick<InfosVideo, 'largeurEffective' | 'hauteurEffective'>,
): string[] {
  const filtres: string[] = [];
  if (p.rotation === 90) filtres.push('transpose=1');
  else if (p.rotation === 270) filtres.push('transpose=2');
  else if (p.rotation === 180) filtres.push('hflip', 'vflip');

  const g = geometrieSortie(p, infos);
  if (g.rogner) filtres.push(`crop=${g.rogner.l}:${g.rogner.h}:${g.rogner.x}:${g.rogner.y}`);
  if (g.largeur !== g.avantEchelle.largeur || g.hauteur !== g.avantEchelle.hauteur) filtres.push(`scale=${g.largeur}:${g.hauteur}:flags=lanczos`);

  const a = p.amelioration;
  if (a.active) {
    if (a.debruitage) filtres.push('hqdn3d=1.5:1.5:6:6');
    if (a.luminosite !== 0 || a.contraste !== 1 || a.saturation !== 1) {
      filtres.push(`eq=brightness=${fixe(a.luminosite)}:contrast=${fixe(a.contraste)}:saturation=${fixe(a.saturation)}`);
    }
    if (a.nettete > 0) filtres.push(`unsharp=5:5:${fixe(a.nettete, 2)}:5:5:0`);
  }
  filtres.push('format=yuv420p');

  const duree = Math.max(0, p.finS - p.debutS);
  const maxDebit = debitVideoMaxBps(duree);
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', fixe(p.debutS),
    '-i', entree,
    '-t', fixe(duree),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-sn', '-dn',
    // Aucune métadonnée d'origine (lieu, appareil) ne suit le visage.
    '-map_metadata', '-1',
    '-vf', filtres.join(','),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-maxrate', String(maxDebit), '-bufsize', String(maxDebit * 2),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-metadata:s:v', 'rotate=0',
    '-movflags', '+faststart',
    sortie,
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Amélioration automatique — et son aperçu dans le navigateur
// ─────────────────────────────────────────────────────────────────────────

export interface StatistiquesImage {
  /** 0..255 */
  luminanceMoyenne: number;
  /** 0..128 */
  ecartType: number;
}

/** Luminance moyenne et écart-type d'une image RGBA (`ImageData.data`). */
export function statistiquesImage(rgba: ArrayLike<number>): StatistiquesImage {
  let n = 0; let somme = 0; let somme2 = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const y = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    somme += y; somme2 += y * y; n++;
  }
  if (n === 0) return { luminanceMoyenne: 128, ecartType: 50 };
  const moy = somme / n;
  const variance = Math.max(0, somme2 / n - moy * moy);
  return { luminanceMoyenne: moy, ecartType: Math.min(128, Math.sqrt(variance)) };
}

/**
 * Des corrections NATURELLES calculées sur une image de la vidéo : une image
 * sombre est un peu éclaircie, une image terne un peu contrastée. Toujours
 * dans les bornes ; une image déjà correcte reçoit des valeurs quasi neutres.
 */
export function ameliorationAutomatique(stats: StatistiquesImage): ParametresAmelioration {
  const lum = borner(stats.luminanceMoyenne, 0, 255, 128);
  const ecart = borner(stats.ecartType, 0, 128, 50);
  const B = BORNES_AMELIORATION;

  // Luminance : cible ~125, zone neutre de ±15.
  const ecartLum = 125 - lum;
  const luminosite = Math.abs(ecartLum) <= 15 ? 0 : borner((ecartLum / 255) * 0.5, B.luminosite[0], B.luminosite[1], 0);

  // Contraste : image terne (< 40) relevée ; très contrastée (> 80) adoucie.
  let contraste = 1;
  if (ecart < 40) contraste = 1 + ((40 - ecart) / 40) * 0.12;
  else if (ecart > 80) contraste = 1 - Math.min(0.08, ((ecart - 80) / 48) * 0.08);
  contraste = borner(contraste, B.contraste[0], B.contraste[1], 1);

  const terne = ecart < 40;
  const sombre = lum < 90;
  const saturation = terne ? 1.04 : 1;
  const nettete = terne || sombre ? 0.3 : 0;

  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    active: true,
    luminosite: r(luminosite),
    contraste: r(contraste),
    saturation,
    nettete,
    debruitage: lum < 80,
  };
}

/**
 * Le filtre CSS qui APPROCHE `eq` dans l'aperçu. `eq` ajoute la luminosité,
 * CSS la multiplie : autour du gris moyen, +0,08 ≈ ×1,16. La netteté et le
 * débruitage ne se voient qu'au rendu serveur.
 */
export function filtreCssApercu(a: ParametresAmelioration): string {
  if (!a.active) return 'none';
  return `brightness(${fixe(1 + a.luminosite * 2)}) contrast(${fixe(a.contraste)}) saturate(${fixe(a.saturation)})`;
}

// ─────────────────────────────────────────────────────────────────────────
// Le cadre de l'éditeur → un recadrage en fractions
// ─────────────────────────────────────────────────────────────────────────

export type RatioCadre = 'original' | '9:16' | '1:1' | '16:9';
export const RATIOS_CADRE: readonly RatioCadre[] = ['original', '9:16', '1:1', '16:9'];

export interface ReglagesCadre {
  rotation: Rotation;
  ratio: RatioCadre;
  /** 1 = le plus grand cadre du ratio dans l'image ; plus petit = zoom avant. */
  zoom: number;
  /** Centre du cadre, en fractions de l'image tournée. */
  centre: { x: number; y: number };
}

/** Le plus grand cadre du ratio dans l'image tournée, en pixels. */
function cadreMaximal(dims: { largeur: number; hauteur: number }, rotation: Rotation, ratio: RatioCadre) {
  const { largeur: W, hauteur: H } = dimensionsApresRotation(dims.largeur, dims.hauteur, rotation);
  const r = ratio === '9:16' ? 9 / 16 : ratio === '1:1' ? 1 : ratio === '16:9' ? 16 / 9 : W / Math.max(1, H);
  return r > W / Math.max(1, H) ? { W, H, l: W, h: W / r } : { W, H, l: H * r, h: H };
}

/** Le zoom le plus fort autorisé : le grand côté du cadre reste ≥ 640 px. */
export function zoomMinimal(dims: { largeur: number; hauteur: number }, rotation: Rotation, ratio: RatioCadre): number {
  const c = cadreMaximal(dims, rotation, ratio);
  return Math.min(1, EXIGENCES_SOURCE_VIDEO.grandCoteMinPx / Math.max(1, c.l, c.h));
}

/** Les réglages du cadre → le `recadrage` envoyé au serveur ; `null` pour l'image entière. */
export function recadrageDepuisReglages(dims: { largeur: number; hauteur: number }, r: ReglagesCadre): Recadrage | null {
  if (!(dims.largeur > 0 && dims.hauteur > 0)) return null;
  const c = cadreMaximal(dims, r.rotation, r.ratio);
  const z = Math.max(zoomMinimal(dims, r.rotation, r.ratio), Math.min(1, Number.isFinite(r.zoom) ? r.zoom : 1));
  const largeur = Math.min(1, (c.l * z) / c.W);
  const hauteur = Math.min(1, (c.h * z) / c.H);
  if (largeur >= 0.999 && hauteur >= 0.999) return null;
  const cx = Number.isFinite(r.centre.x) ? r.centre.x : 0.5;
  const cy = Number.isFinite(r.centre.y) ? r.centre.y : 0.5;
  const x = Math.min(1 - largeur, Math.max(0, cx - largeur / 2));
  const y = Math.min(1 - hauteur, Math.max(0, cy - hauteur / 2));
  const q = (n: number) => Math.round(n * 10000) / 10000;
  return { x: q(x), y: q(y), largeur: q(largeur), hauteur: q(hauteur) };
}

/** Portrait / Paysage / Carré, pour l'écran de résultat. */
export function libelleCadrage(largeur: number, hauteur: number): string {
  if (!(largeur > 0 && hauteur > 0)) return '—';
  const r = largeur / hauteur;
  if (r > 1.05) return 'Paysage';
  if (r < 0.95) return 'Portrait';
  return 'Carré';
}
