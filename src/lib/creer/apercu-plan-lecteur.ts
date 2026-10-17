/**
 * M3-a PR3 — APERÇU RAPIDE DU PLAN (Créer), moteur de lecture.
 *
 * ⚠️ CE N'EST PAS UN SECOND MOTEUR DE RENDU. Il joue le plan que l'export
 * rejouera (mêmes extraits, même ordre, mêmes bornes) avec le MÊME pilote que
 * le compositeur (`pilote-montage.ts`), et ne fait QUE copier l'image
 * courante d'un `<video>` (hors DOM, muet) dans un `<canvas>` d'aperçu à
 * résolution LIMITÉE, filigrané. Pas de son, pas de filtre couleur, pas de
 * typographie canvas : l'export reste la seule vidéo finale.
 *
 * ⚠️ AUCUN FICHIER : ni MediaRecorder, ni captureStream, ni téléchargement.
 * Le rendu final propre (son, effets, pleine résolution, sans filigrane)
 * reste soumis aux crédits (`rendreEtFacturer`, inchangé).
 *
 * Honnêteté : filigrane et résolution découragent la capture d'écran ; ils
 * ne protègent PAS contre un utilisateur technique, qui lit ses propres
 * rushes et le plan dans son navigateur. La valeur protégée est le rendu
 * composé, payé en crédits.
 */
import { creerPiloteMontage, alternerLecteurs, type LecteurVideo } from '@/lib/creer/pilote-montage';
import { rectangleRush, type RecadragesRush } from '@/lib/creer/recadrage-rush';
import type { RushSegment } from '@/lib/creer/multi-rush';

/**
 * Plus grand côté de l'image d'aperçu (px). 540 = la moitié de la sortie
 * 1080 : scènes, cadrages et coupes restent lisibles (un visage occupe encore
 * ~100 px de haut en 9:16), mais l'image est quatre fois plus pauvre que le
 * rendu final et ne vaut pas une publication.
 */
export const APERCU_COTE_MAX = 540;

export function dimensionsApercu(format: '9:16' | '1:1' | '16:9'): { w: number; h: number } {
  const ratio = format === '9:16' ? 9 / 16 : format === '16:9' ? 16 / 9 : 1;
  return ratio >= 1
    ? { w: APERCU_COTE_MAX, h: Math.round(APERCU_COTE_MAX / ratio) }
    : { w: Math.round(APERCU_COTE_MAX * ratio), h: APERCU_COTE_MAX };
}

// ── SURIMPRESSIONS : la formule de `dessinerSurimpressions` ────────────────
/**
 * Opacité et glissement d'une fenêtre de surimpression à `secondes` — la
 * formule EXACTE du compositeur (`dessinerSurimpressions`, video-composer.ts) :
 * temps quantifié à l'image, fondu linéaire sur round(0,3·fps) = 9 images à
 * l'entrée et à la sortie, glissement de 24 px (résolution vidéo) à l'entrée.
 * `null` hors de la fenêtre. Parité vérifiée par test contre le compositeur.
 */
export function etatSurimpression(secondes: number, debut: number, fin: number, fps = 30): { opacite: number; decalage: number } | null {
  const bord = Math.max(1, Math.round(0.3 * fps));
  const image = Math.round(secondes * fps);
  const f = image - Math.round(debut * fps);
  const duree = Math.max(1, Math.round((fin - debut) * fps));
  if (f < 0 || f >= duree) return null;
  const entree = Math.min(1, f / bord);
  const opacite = Math.max(0, Math.min(entree, (duree - f) / bord));
  if (opacite <= 0) return null;
  return { opacite, decalage: Math.round((1 - entree) * 24) };
}

/** Voile des surimpressions — arrêts de `peindreVoileSurimpression`. */
export const VOILE_SURIMPRESSION_CSS = 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.55) 100%)';

// ── FILIGRANE ─────────────────────────────────────────────────────────────
export const FILIGRANE_TEXTE = 'STUDIIO · APERÇU';
/** Opacité de chaque occurrence (cible 20–30 %). */
export const FILIGRANE_OPACITE = 0.25;
/** Angle (degrés) du motif. */
export const FILIGRANE_ANGLE = -28;
/** Période de la dérive diagonale (s) : une tuile entière parcourue. */
export const FILIGRANE_PERIODE_S = 14;

/** Motif en fraction du PETIT côté du cadre (identique canvas / DOM, même densité dans les 3 formats). */
export function motifFiligrane(largeur: number, hauteur: number = largeur) {
  const base = Math.min(largeur, hauteur);
  const police = Math.max(9, 0.045 * base);
  return { police, pasX: 0.56 * base, pasY: 0.2 * base };
}

/** Décalage de la dérive à l'instant `ms` (horloge murale partagée canvas / DOM). */
export function deriveFiligrane(largeur: number, hauteur: number, ms: number): { dx: number; dy: number } {
  const { pasX, pasY } = motifFiligrane(largeur, hauteur);
  const p = ((ms / 1000) % FILIGRANE_PERIODE_S) / FILIGRANE_PERIODE_S;
  return { dx: p * pasX, dy: p * pasY };
}

/**
 * Positions (centre de chaque occurrence, repère du cadre NON tourné) des
 * occurrences du motif. Grille assez large pour couvrir le cadre une fois
 * tournée ; rangées décalées d'une demi-tuile.
 */
export function occurrencesFiligrane(w: number, h: number, ms: number): Array<{ x: number; y: number }> {
  const { pasX, pasY } = motifFiligrane(w, h);
  const { dx, dy } = deriveFiligrane(w, h, ms);
  const diag = Math.hypot(w, h);
  const out: Array<{ x: number; y: number }> = [];
  const a = (FILIGRANE_ANGLE * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const nx = Math.ceil(diag / pasX) + 2;
  const ny = Math.ceil(diag / pasY) + 2;
  for (let j = -ny; j <= ny; j++) {
    for (let i = -nx; i <= nx; i++) {
      // Repère tourné, centré sur le cadre, puis ramené dans le cadre.
      const u = i * pasX + (j % 2 ? pasX / 2 : 0) + dx;
      const v = j * pasY + dy;
      const x = w / 2 + u * cos - v * sin;
      const y = h / 2 + u * sin + v * cos;
      if (x < -pasX || x > w + pasX || y < -pasY || y > h + pasY) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/** Peint le filigrane DANS les pixels d'un canvas d'aperçu. */
export function peindreFiligrane(ctx: CanvasRenderingContext2D, w: number, h: number, ms: number): number {
  const { police } = motifFiligrane(w, h);
  const pts = occurrencesFiligrane(w, h, ms);
  ctx.save();
  ctx.font = `700 ${police}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, police / 9);
  for (const p of pts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(p.x, p.y);
    ctx.rotate((FILIGRANE_ANGLE * Math.PI) / 180);
    ctx.globalAlpha = FILIGRANE_OPACITE;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(FILIGRANE_TEXTE, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(FILIGRANE_TEXTE, 0, 0);
  }
  ctx.restore();
  return pts.length;
}

/**
 * Part de la surface couverte par les boîtes du texte (estimation : largeur
 * ≈ 0,62 × police par caractère, hauteur = police). Sert au rapport.
 */
export function couvertureFiligrane(w: number, h: number = w): number {
  const { police, pasX, pasY } = motifFiligrane(w, h);
  const boite = FILIGRANE_TEXTE.length * 0.62 * police * police;
  return Math.min(1, boite / (pasX * pasY));
}

// ── LE MOTEUR ─────────────────────────────────────────────────────────────
export type ProblemeApercu = 'positionnement' | 'media';

/** Un `<video>` vu par le pilote : la dernière position DEMANDÉE est retenue. */
class LecteurDom implements LecteurVideo {
  cible: number | null = null;
  source: string | null = null;
  constructor(readonly el: HTMLVideoElement) {}
  get currentTime() { return this.el.currentTime; }
  set currentTime(v: number) { this.cible = v; this.el.currentTime = v; }
  get paused() { return this.el.paused; }
  get seeking() { return this.el.seeking; }
  get readyState() { return this.el.readyState; }
  get playbackRate() { return this.el.playbackRate; }
  set playbackRate(v: number) { this.el.playbackRate = v; }
  play() { return this.el.play(); }
  pause() { this.el.pause(); }
}

function memeOrigine(url: string): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try { return typeof window !== 'undefined' && new URL(url, window.location.href).origin === window.location.origin; } catch { return false; }
}

export interface ImageApercu {
  el: HTMLVideoElement;
  index: number;
  source: string;
  depuis: number;
  /** Position voulue dans la source (s). */
  cible: number;
}

/**
 * Deux `<video>` HORS DOM, muets, alternés d'un extrait à l'autre ; le pilote
 * du compositeur les prépare et les bascule. Lecture : `image(s, true)` ;
 * image figée : `image(s, false)` (positionnement exact, sans lecture). Saut
 * arrière, saut avant > 0,5 s ou reprise après suspension : NOUVELLE instance
 * du pilote (il est écrit pour une passe avant).
 */
export class MoteurApercuPlan {
  private lecteurs: [LecteurDom, LecteurDom];
  private pilote: ReturnType<typeof creerPiloteMontage<LecteurDom>> | null = null;
  private derniere = -1;
  private aReprendre = true;
  private abonnes = new Set<() => void>();
  private detruit = false;
  probleme: ProblemeApercu | null = null;

  constructor(
    readonly plan: ReadonlyArray<RushSegment>,
    private readonly deps: { creerVideo?: () => HTMLVideoElement; surProbleme?: (p: ProblemeApercu) => void } = {},
  ) {
    const fabrique = deps.creerVideo ?? (() => document.createElement('video'));
    const creer = () => {
      const el = fabrique();
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.controls = false;
      el.setAttribute('controlsList', 'nodownload noremoteplayback');
      el.setAttribute('disablePictureInPicture', '');
      el.setAttribute('playsinline', '');
      const lecteur = new LecteurDom(el);
      const signaler = () => this.abonnes.forEach((f) => f());
      el.addEventListener('seeked', () => {
        signaler();
        // Sans plages d'octets, `seeked` arrive mais la position retombe à 0 :
        // le montage complet ne peut pas être montré honnêtement.
        const voulu = lecteur.cible;
        setTimeout(() => {
          if (this.detruit || voulu === null || voulu < 1) return;
          if (lecteur.cible === voulu && !el.seeking && el.currentTime < voulu - 0.75) this.signalerProbleme('positionnement');
        }, 250);
      });
      el.addEventListener('loadeddata', signaler);
      el.addEventListener('error', () => { if (el.getAttribute('src')) this.signalerProbleme('media'); });
      return lecteur;
    };
    this.lecteurs = [creer(), creer()];
  }

  private signalerProbleme(p: ProblemeApercu) {
    if (this.probleme) return;
    this.probleme = p;
    this.deps.surProbleme?.(p);
  }

  /** Prévenu quand une image devient disponible (positionnement terminé…). */
  surImage(f: () => void): () => void {
    this.abonnes.add(f);
    return () => { this.abonnes.delete(f); };
  }

  private nouveauPilote() {
    const tampons = alternerLecteurs(this.plan.length);
    this.pilote = creerPiloteMontage<LecteurDom>(
      this.plan.map((s, k) => ({ el: this.lecteurs[tampons[k]], debut: s.debut, fin: s.fin, depuis: s.depuis ?? 0, vitesse: s.vitesse ?? 1, source: s.url })),
      {
        charger: (l, source) => {
          // Même source déjà chargée (nouvelle instance du pilote) : rien à recharger.
          if (l.source === source) return;
          l.source = source;
          l.cible = null;
          if (!memeOrigine(source)) l.el.crossOrigin = 'anonymous';
          else l.el.removeAttribute('crossorigin');
          l.el.src = source;
        },
      },
    );
  }

  /** L'image de l'aperçu à `secondes` (temps DANS la séquence Vidéo). */
  image(secondes: number, lecture: boolean): ImageApercu | null {
    if (this.detruit || !this.plan.length) return null;
    let l: LecteurDom | null;
    if (!lecture) {
      this.nouveauPilote();
      l = this.pilote!.positionner(secondes);
      this.aReprendre = true;
    } else {
      if (!this.pilote || this.aReprendre || secondes < this.derniere - 0.05 || secondes > this.derniere + 0.5) {
        this.nouveauPilote();
        this.aReprendre = false;
      }
      l = this.pilote!.image(secondes);
    }
    this.derniere = secondes;
    if (!l) return null;
    const k = this.pilote!.indexA(secondes);
    const seg = this.plan[k];
    return { el: l.el, index: k, source: seg.url, depuis: seg.depuis ?? 0, cible: (seg.depuis ?? 0) + Math.max(0, secondes - seg.debut) * (seg.vitesse ?? 1) };
  }

  /** Hors de la séquence Vidéo, pause, démontage : tout s'arrête ; la reprise repart d'une instance neuve. */
  suspendre() {
    for (const l of this.lecteurs) if (!l.el.paused) l.el.pause();
    this.aReprendre = true;
  }

  detruire() {
    this.detruit = true;
    this.abonnes.clear();
    for (const l of this.lecteurs) {
      l.el.pause();
      l.el.removeAttribute('src');
      try { l.el.load(); } catch { /* jsdom */ }
    }
  }
}

/** Rectangle de destination du rush (cover × recadrage DE CE RUSH), comme `drawVideoSeq`. */
export function rectangleImageApercu(
  el: { videoWidth: number; videoHeight: number },
  source: string,
  w: number,
  h: number,
  recadrages: RecadragesRush,
): { x: number; y: number; l: number; h: number } | null {
  if (!(el.videoWidth > 0 && el.videoHeight > 0)) return null;
  return rectangleRush(el.videoWidth, el.videoHeight, w, h, recadrages[source] ?? null);
}
