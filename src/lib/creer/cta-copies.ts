/**
 * CTA MULTIPLES — copies visuelles de l'appel à l'action, DANS la séquence CTA.
 *
 * ⚠️ LE CTA D'ORIGINE NE CHANGE PAS DE FORME. Ses champs historiques
 * (`generated.cta` / `ctaSub`, `ctaPos`, `ctaStyle`, `ctaWidth`, puis
 * `design.ctaMainText`, `watermarkPosition`, `watermarkSize`… dans la
 * metadata) restent l'élément n° 1, implicite. Les copies vivent À CÔTÉ, dans
 * une liste optionnelle `ctaCopies`, rangée dans les structures JSON déjà
 * existantes (brouillon, `metadata.design`, options du compositeur, props
 * Remotion) — aucune migration.
 *
 * Liste absente ou vide = le rendu d'avant, à l'octet près : chaque moteur
 * ne fait qu'une boucle de plus, qui ne tourne pas.
 *
 * Une copie est AUTONOME : son texte, son sous-texte, sa position, sa largeur
 * et son style lui appartiennent. La modifier, la déplacer ou la supprimer ne
 * touche jamais l'original. L'animation du texte, elle, est celle du montage
 * (`design.textAnimation`) : l'original et ses copies l'appliquent chacun à
 * leur propre texte, à la même proportion.
 *
 * Les SURIMPRESSIONS (CTA posé sur la vidéo) restent sur le seul original :
 * leur mise en page calcule une place pour UN bloc (#502).
 *
 * Module PUR : ni DOM, ni React.
 */
import { TEXT_CASES, TEXT_ALIGNS, type TextCase, type TextAlign } from '@/lib/creer/textFormat';
import { CTA_BAS_916, ZONE_SURE_916, estFormat916 } from '@/lib/creer/zones-sures-916';

type Pos = { x: number; y: number };

/** Style d'une copie — la forme exacte de `CtaTypography` (`SequenceCta`). */
export interface CtaCopieStyle {
  font: string;
  color: string;
  /** Chaîne vide = « suit la fin du dégradé », comme le CTA d'origine. */
  subColor: string;
  scale: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  lineHeight: number;
  textCase?: TextCase;
  align?: TextAlign;
  underline?: boolean;
  strike?: boolean;
}

export interface CtaCopie {
  id: string;
  /** Texte principal. */
  text: string;
  /** Petite ligne sous le texte ; vide = rien. */
  sub: string;
  /** Ancre BAS-CENTRE, en % du cadre — la même que `ctaPos`. */
  pos: Pos;
  /** Largeur du bloc, en % de la vidéo — la même que `ctaWidth`. */
  width: number;
  style: CtaCopieStyle;
}

/** Copies qu'on peut créer depuis l'éditeur (l'original en plus). */
export const MAX_CTA_COPIES = 5;
/** Borne de RELECTURE, plus large : une donnée relue n'est jamais tronquée sans raison. */
const MAX_CTA_COPIES_LUES = 12;
/** Décalage vertical d'une nouvelle copie, en % de la hauteur. */
export const DECALAGE_COPIE_CTA = 4;

const LARGEUR_DEFAUT = 70;
const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const borne = (v: unknown, min: number, max: number, defaut: number) =>
  (fini(v) && v >= min && v <= max ? v : defaut);
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,48}$/;
const arrondi = (v: number) => Math.round(v * 100) / 100;

/**
 * Position d'une NOUVELLE copie : l'original décalé de `DECALAGE_COPIE_CTA`
 * vers le bas, ou vers le haut s'il n'y a plus la place.
 *
 * Le bloc s'ancre par son BAS. En 9:16, ce bas ne descend jamais sous
 * `CTA_BAS_916` (au-dessus des descriptions des réseaux) ni ne remonte au
 * point de passer sous les barres du haut. L'original, lui, ne bouge pas.
 */
export function positionCopieCta(source: Pos, format: string | null | undefined): Pos {
  const bas = estFormat916(format) ? CTA_BAS_916 : 98;
  const haut = estFormat916(format) ? ZONE_SURE_916.haut + 8 : 10;
  let y = source.y + DECALAGE_COPIE_CTA;
  if (y > bas) y = source.y - DECALAGE_COPIE_CTA;
  y = Math.min(bas, Math.max(haut, y));
  return { x: arrondi(source.x), y: arrondi(y) };
}

/** Identifiant neuf, absent de `existants`. */
export function nouvelIdCtaCopie(existants: ReadonlyArray<string>, alea: () => number = Math.random): string {
  for (;;) {
    const id = `cta-${Math.floor(alea() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!existants.includes(id)) return id;
  }
}

/**
 * Copie d'un CTA (l'original ou une copie) : TOUT est repris — texte,
 * sous-texte, style, largeur — sous un identifiant neuf, à une position
 * décalée. Les objets sont recopiés : rien n'est partagé avec la source.
 */
export function dupliquerCta(
  source: Omit<CtaCopie, 'id'>,
  existantes: ReadonlyArray<CtaCopie>,
  format: string | null | undefined,
  alea?: () => number,
): CtaCopie {
  return {
    id: nouvelIdCtaCopie(existantes.map((c) => c.id), alea),
    text: source.text,
    sub: source.sub,
    pos: positionCopieCta(source.pos, format),
    width: source.width,
    style: { ...source.style },
  };
}

function lireStyle(brut: unknown): CtaCopieStyle {
  const s = estObj(brut) ? brut : {};
  const style: CtaCopieStyle = {
    font: typeof s.font === 'string' && s.font.trim() && s.font.length <= 80 ? s.font : 'Inter',
    color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : '#FFFFFF',
    subColor: typeof s.subColor === 'string' && HEX.test(s.subColor) ? s.subColor : '',
    scale: borne(s.scale, 0.2, 3, 1),
    bold: s.bold !== false,
    italic: s.italic === true,
    letterSpacing: borne(s.letterSpacing, -10, 40, 0),
    lineHeight: borne(s.lineHeight, 0.5, 4, 1.2),
  };
  if (TEXT_CASES.includes(s.textCase as TextCase)) style.textCase = s.textCase as TextCase;
  if (TEXT_ALIGNS.includes(s.align as TextAlign)) style.align = s.align as TextAlign;
  if (s.underline === true) style.underline = true;
  if (s.strike === true) style.strike = true;
  return style;
}

/**
 * Relit une liste de copies (brouillon, metadata, props). Toute entrée
 * inexploitable est ÉCARTÉE plutôt qu'approchée ; doublons d'identifiant
 * écartés. Jamais d'exception : une valeur abîmée rend `[]`, c'est-à-dire le
 * CTA unique d'avant.
 */
export function lireCtaCopies(brut: unknown): CtaCopie[] {
  if (!Array.isArray(brut)) return [];
  const out: CtaCopie[] = [];
  const vus = new Set<string>();
  for (const c of brut) {
    if (out.length >= MAX_CTA_COPIES_LUES) break;
    if (!estObj(c)) continue;
    if (typeof c.id !== 'string' || !ID.test(c.id) || vus.has(c.id)) continue;
    if (typeof c.text !== 'string') continue;
    const p = estObj(c.pos) ? c.pos : null;
    if (!p || !fini(p.x) || !fini(p.y) || p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) continue;
    vus.add(c.id);
    out.push({
      id: c.id,
      text: c.text.slice(0, 200),
      sub: typeof c.sub === 'string' ? c.sub.slice(0, 80) : '',
      pos: { x: p.x, y: p.y },
      width: borne(c.width, 30, 96, LARGEUR_DEFAUT),
      style: lireStyle(c.style),
    });
  }
  return out;
}

/**
 * Champs du COMPOSITEUR canvas pour une copie, posés par-dessus le `design`
 * du montage — exactement les champs que Créer traduit pour l'original
 * (`textDesign` : police, couleurs, échelle, graisse, italique, interlettrage,
 * interligne ; `ctaMainText`, `ctaSubTextDesign`, `watermarkPosition`,
 * `watermarkSize`). Casse, alignement et décoration restent ceux du montage,
 * comme pour l'original : la copie sort comme l'original sortirait.
 * Ni icône ni phrase d'accroche : elles n'appartiennent qu'à l'original.
 */
export function designCompositeurCopie<D extends object>(
  design: D | undefined,
  c: CtaCopie,
): D {
  const base = (design ?? {}) as Record<string, unknown>;
  const typo = estObj(base.ctaTypography) ? base.ctaTypography : {};
  return {
    ...base,
    ctaMainText: c.text,
    ctaSubTextDesign: c.sub,
    watermarkPosition: { x: c.pos.x, y: c.pos.y },
    watermarkSize: c.width,
    watermarkFont: c.style.font,
    ctaFont: c.style.font,
    ctaColor: c.style.color,
    ctaSubColor: c.style.subColor || base.ctaSubColor,
    ctaTextScale: c.style.scale,
    ctaTypography: {
      ...typo,
      bold: c.style.bold,
      italic: c.style.italic,
      letterSpacing: c.style.letterSpacing,
      lineHeight: c.style.lineHeight,
    },
    ctaIconImage: undefined,
  } as unknown as D;
}
