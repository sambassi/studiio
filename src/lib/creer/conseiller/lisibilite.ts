/**
 * CONSEILLER LISIBILITÉ / PLACEMENT — module PUR.
 *
 * Entrées MESURÉES par le rendu hybride (`render/hybride/mesures-textes.ts`) :
 *   - l'image fixe de chaque texte (Remotion, fond transparent) : où il est,
 *     la hauteur réelle de chaque ligne, sa couleur ;
 *   - la vidéo de base SANS textes, en petit (72×128, 4 images/s) : ce qu'il
 *     y a derrière (luminosité, voile compris) et où ça bouge.
 *
 * « Zone calme » = peu de mouvement et peu de détails, mesurés. Studiio ne
 * reconnaît NI visages NI corps : le conseil le dit en ces termes-là.
 */
import type { Conseil } from '@/lib/creer/conseiller/types';

export const BASE_L = 72;
export const BASE_H = 128;
export const BASE_FPS = 4;

export const REGLES_LISIBILITE = {
  /**
   * Hauteur MESURÉE (px, image 1080×1920) des caractères de la plus petite
   * ligne — ≈ 2,2 % de la hauteur de l'image, soit un corps d'environ 50 px :
   * en dessous, il faut plisser les yeux sur un téléphone.
   */
  ligneMinPx: 42,
  /** Ligne principale d'une accroche / d'un CTA : en dessous, elle n'accroche pas. */
  lignePrincipaleMinPx: 70,
  /** Contraste (WCAG) sous lequel le texte se perd sur le fond le plus clair. */
  contrasteMin: 3,
  /** Une zone est « nettement plus calme » sous cette part de l'activité derrière le texte. */
  zonePlusCalme: 0.6,
} as const;

/** Les 7 positions conseillées (rectangles 0..1 de l'image). */
export const ZONES: Array<{ nom: string; x0: number; y0: number; x1: number; y1: number }> = [
  { nom: 'haut-gauche', x0: 0, y0: 0, x1: 1 / 2, y1: 1 / 4 },
  { nom: 'haut', x0: 1 / 6, y0: 0, x1: 5 / 6, y1: 1 / 4 },
  { nom: 'haut-droite', x0: 1 / 2, y0: 0, x1: 1, y1: 1 / 4 },
  { nom: 'centre', x0: 0, y0: 3 / 8, x1: 1, y1: 5 / 8 },
  { nom: 'bas-gauche', x0: 0, y0: 3 / 4, x1: 1 / 2, y1: 1 },
  { nom: 'bas', x0: 1 / 6, y0: 3 / 4, x1: 5 / 6, y1: 1 },
  { nom: 'bas-droite', x0: 1 / 2, y0: 3 / 4, x1: 1, y1: 1 },
];

/** Opacité du voile noir des surimpressions à la hauteur `y` (0..1) — `VOILE_SURIMPRESSION`. */
export function voileAlpha(y: number): number {
  if (y <= 0.32) return 0.45 * (1 - y / 0.32);
  if (y <= 0.62) return 0;
  return 0.55 * ((y - 0.62) / 0.38);
}

/** Luminance relative (WCAG) d'un gris encodé 0..1. */
const lineaire = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export function contraste(a: number, b: number): number {
  const [x, y] = [lineaire(a), lineaire(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10;
}

// ── 1. L'image fixe d'un texte (RVBA, largeur × hauteur) ──
export interface GeometrieTexte {
  /** Boîte englobante 0..1 [x0, y0, x1, y1], ou null si l'image est vide. */
  boite: [number, number, number, number] | null;
  /** Hauteur de chaque ligne de texte, en px de l'image 1080×1920. */
  lignesPx: number[];
  /** Luminosité moyenne des pixels du texte (0..1). */
  lumTexte: number;
  /**
   * Cadre semi-transparent derrière le texte (badge), s'il y en a un :
   * opacité et luminosité moyennes des pixels translucides de la boîte.
   */
  cadre?: { opacite: number; lum: number } | null;
}

export function geometrieTexte(rgba: ArrayLike<number>, largeur: number, hauteur: number, hauteurSortie = 1920): GeometrieTexte {
  let x0 = largeur; let y0 = hauteur; let x1 = -1; let y1 = -1;
  let somme = 0; let n = 0;
  const parLigne = new Array<number>(hauteur).fill(0);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const o = (y * largeur + x) * 4;
      if (rgba[o + 3] < 128) continue;
      parLigne[y] += 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      somme += (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
      n += 1;
    }
  }
  if (n === 0) return { boite: null, lignesPx: [], lumTexte: 1, cadre: null };
  // Pixels translucides DANS la boîte : un cadre (badge) s'ils la couvrent.
  let ta = 0; let tl = 0; let tn = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * largeur + x) * 4;
      const a = rgba[o + 3];
      if (a <= 8 || a >= 128) continue;
      ta += a / 255; tl += (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255; tn += 1;
    }
  }
  const surface = (x1 - x0 + 1) * (y1 - y0 + 1);
  const cadre = tn > surface * 0.3 ? { opacite: Math.round((ta / tn) * 1000) / 1000, lum: Math.round((tl / tn) * 1000) / 1000 } : null;
  // Lignes = suites de rangées contenant du texte (un trou de 1 rangée est
  // toléré : barres des accents, points).
  const lignes: number[] = [];
  let debut = -1; let trou = 0;
  for (let y = y0; y <= y1 + 2; y++) {
    const plein = y <= y1 && parLigne[y] > 0;
    if (plein) { if (debut < 0) debut = y; trou = 0; continue; }
    if (debut >= 0 && ++trou > 1) { lignes.push(y - trou - debut + 1); debut = -1; trou = 0; }
  }
  const echelle = hauteurSortie / hauteur;
  return {
    boite: [x0 / largeur, y0 / hauteur, (x1 + 1) / largeur, (y1 + 1) / hauteur],
    lignesPx: lignes.map((h) => Math.round(h * echelle)),
    lumTexte: Math.round((somme / n) * 1000) / 1000,
    cadre,
  };
}

// ── 2. La vidéo de base sans textes (gris BASE_L × BASE_H, BASE_FPS) ──
export interface ActiviteZone { nom: string; activite: number }

const quantile = (l: number[], q: number) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/** Images de la base pendant [debut, fin] (s). */
export function imagesFenetre(images: ReadonlyArray<ArrayLike<number>>, debut: number, fin: number): Array<ArrayLike<number>> {
  const i0 = Math.max(0, Math.floor(debut * BASE_FPS));
  const i1 = Math.min(images.length, Math.max(i0 + 1, Math.ceil(fin * BASE_FPS)));
  return images.slice(i0, i1);
}

/** Activité d'un rectangle : mouvement (écart entre images) + détails (contraste local). */
export function activite(images: ReadonlyArray<ArrayLike<number>>, rect: { x0: number; y0: number; x1: number; y1: number }): number {
  const L = BASE_L; const H = BASE_H;
  const xa = Math.max(1, Math.floor(rect.x0 * L)); const xb = Math.min(L - 1, Math.ceil(rect.x1 * L));
  const ya = Math.max(1, Math.floor(rect.y0 * H)); const yb = Math.min(H - 1, Math.ceil(rect.y1 * H));
  let mouv = 0; let det = 0; let n = 0;
  images.forEach((g, k) => {
    const prec = k > 0 ? images[k - 1] : null;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const c = y * L + x;
        det += Math.abs(4 * g[c] - g[c - 1] - g[c + 1] - g[c - L] - g[c + L]);
        if (prec) mouv += Math.abs(g[c] - prec[c]);
        n += 1;
      }
    }
  });
  if (!n) return 0;
  const parImage = images.length > 1 ? (images.length - 1) / images.length : 1;
  return Math.round(((mouv / (n * parImage)) * 4 + det / n) * 1000) / 1000;
}

/** Luminosité du fond derrière la boîte, voile compris : [p10, p90]. */
export function fondDerriere(images: ReadonlyArray<ArrayLike<number>>, boite: [number, number, number, number]): [number, number] {
  const L = BASE_L; const H = BASE_H;
  const valeurs: number[] = [];
  const xa = Math.floor(boite[0] * L); const xb = Math.max(xa + 1, Math.ceil(boite[2] * L));
  const ya = Math.floor(boite[1] * H); const yb = Math.max(ya + 1, Math.ceil(boite[3] * H));
  for (const g of images) {
    for (let y = ya; y < yb; y++) {
      const a = voileAlpha((y + 0.5) / H);
      for (let x = xa; x < xb; x++) valeurs.push(g[y * L + x] * (1 - a));
    }
  }
  return [quantile(valeurs, 0.1), quantile(valeurs, 0.9)];
}

// ── 3. Les conseils ──
export interface ElementLisibilite {
  cible: string;
  texte: string | null;
  debut: number;
  fin: number;
  geometrie: GeometrieTexte;
  /** [p10, p90] de la luminosité du fond derrière le texte. */
  fond: [number, number];
  /** Activité derrière le texte, et dans chacune des 7 zones, pendant son affichage. */
  activiteTexte: number;
  zones: ActiviteZone[];
}

const NOMS = { accroche: ['Ton accroche', 'e'], cta: ['Ton CTA', ''] } as Record<string, [string, string]>;
const numeroCarte = (cible: string) => Number(cible.split(':')[1]) + 1;
const zoneDeBoite = (b: [number, number, number, number]) => {
  const cx = (b[0] + b[2]) / 2; const cy = (b[1] + b[3]) / 2;
  const ligne = cy < 1 / 3 ? 'haut' : cy > 2 / 3 ? 'bas' : 'centre';
  if (ligne === 'centre') return 'centre';
  return cx < 0.38 ? `${ligne}-gauche` : cx > 0.62 ? `${ligne}-droite` : ligne;
};

/** Constats MESURÉS sur un texte (avant mise en mots). */
interface Constat {
  e: ElementLisibilite;
  ici: string;
  placement: string;
  plusCalme: ActiviteZone | null;
  petite: number;
  grande: number;
  taille: boolean;
  principaleTropPetite: boolean;
  contraste: number | null;
  clair: boolean;
  fondPire: number;
}

function constater(e: ElementLisibilite): Constat | null {
  const R = REGLES_LISIBILITE;
  const g = e.geometrie;
  if (!g.boite || !g.lignesPx.length) return null;
  const ici = zoneDeBoite(g.boite);
  const calme = [...e.zones].sort((a, b) => a.activite - b.activite)[0];
  const plusCalme = calme && calme.nom !== ici && calme.activite < e.activiteTexte * R.zonePlusCalme ? calme : null;
  const petite = Math.min(...g.lignesPx);
  const grande = Math.max(...g.lignesPx);
  const clair = g.lumTexte >= 0.5;
  const brut = clair ? e.fond[1] : e.fond[0];
  // Le cadre du badge assombrit (ou éclaircit) le fond d'autant.
  const fondPire = g.cadre ? g.cadre.lum * g.cadre.opacite + brut * (1 - g.cadre.opacite) : brut;
  const c = contraste(g.lumTexte, fondPire);
  return {
    e, ici, plusCalme,
    placement: plusCalme ? `${plusCalme.nom} (zone mesurée la plus calme pendant ce texte)` : `${ici} (bonne place : aucune zone nettement plus calme)`,
    petite, grande,
    taille: petite < R.ligneMinPx,
    principaleTropPetite: (e.cible === 'accroche' || e.cible === 'cta') && grande < R.lignePrincipaleMinPx,
    contraste: c < R.contrasteMin ? c : null,
    clair, fondPire,
  };
}

const plage = (l: number[]) => { const a = Math.min(...l); const b = Math.max(...l); return a === b ? `${a}` : `${a} à ${b}`; };

export function conseilsLisibilite(elements: ReadonlyArray<ElementLisibilite>): Conseil[] {
  const R = REGLES_LISIBILITE;
  const out: Conseil[] = [];
  const constats = elements.map(constater).filter((c): c is Constat => c !== null);

  // ── Accroche et CTA : un conseil par constat ──
  for (const k of constats.filter((x) => !x.e.cible.startsWith('carte'))) {
    const [nom, f] = NOMS[k.e.cible] ?? ['Ce texte', ''];
    const section = k.e.cible === 'cta' ? 'CTA' : 'Textes';
    if (k.taille || k.principaleTropPetite) {
      const details = [
        k.taille ? `${k.e.geometrie.lignesPx.length > 1 ? 'Sa plus petite ligne' : 'Son texte'} ne fait que ${k.petite} px de haut sur 1920 : sur un téléphone, il faut plisser les yeux.` : null,
        k.principaleTropPetite ? `Sa ligne principale (${k.grande} px) est trop petite pour arrêter le pouce.` : null,
      ].filter(Boolean);
      out.push({
        id: `lisibilite:taille:${k.e.cible}`, section,
        priorite: k.petite < R.ligneMinPx * 0.8 ? 'IMPORTANTE' : 'MOYENNE',
        cible: k.e.cible, texteActuel: k.e.texte,
        probleme: `${nom} est trop petit${f}. ${details.join(' ')}`,
        conseil: 'Agrandis le texte, quitte à le raccourcir.',
        propositionReecrite: null, placementRecommande: k.placement, dureeRecommandee: null,
        mesures: { lignePetitePx: k.petite, ligneGrandePx: k.grande },
      });
    }
    if (k.contraste !== null) {
      out.push({
        id: `lisibilite:contraste:${k.e.cible}`, section,
        priorite: k.contraste < 2 ? 'IMPORTANTE' : 'MOYENNE',
        cible: k.e.cible, texteActuel: k.e.texte,
        probleme: `${nom} se perd par moments dans l'image : le fond derrière est trop ${k.clair ? 'clair' : 'sombre'} pour un texte ${k.clair ? 'clair' : 'foncé'}.`,
        conseil: `Ajoute un fond ou un dégradé ${k.clair ? 'sombre' : 'clair'} derrière le texte, ou place-le sur une zone plus ${k.clair ? 'sombre' : 'claire'}.`,
        propositionReecrite: null, placementRecommande: k.placement, dureeRecommandee: null,
        mesures: { contraste: k.contraste, lumTexte: k.e.geometrie.lumTexte, fond: Math.round(k.fondPire * 1000) / 1000 },
      });
    }
    if (k.plusCalme) {
      out.push({
        id: `placement:${k.e.cible}`, section, priorite: 'FAIBLE',
        cible: k.e.cible, texteActuel: k.e.texte,
        probleme: `${nom} est posé${f} (${k.ici}) là où l'image bouge le plus : il cache une partie de l'action.`,
        conseil: `Déplace ce texte vers « ${k.plusCalme.nom} », où il y a moins de mouvement et de détails à ce moment-là. (Studiio mesure le mouvement ; il ne reconnaît pas encore les visages.)`,
        propositionReecrite: null, placementRecommande: k.placement, dureeRecommandee: null,
        mesures: { activiteTexte: k.e.activiteTexte, activiteZone: k.plusCalme.activite },
      });
    }
  }

  // ── Cartes : UN conseil par constat, pour toutes les cartes concernées ──
  const cartes = constats.filter((x) => x.e.cible.startsWith('carte'));
  const groupe = (l: Constat[]) => ({
    cible: l.map((x) => x.e.cible).join(','),
    qui: l.length === cartes.length && l.length > 1 ? `Les ${l.length} cartes` : l.length > 1 ? `Les cartes ${l.map((x) => numeroCarte(x.e.cible)).join(', ')}` : `La carte ${numeroCarte(l[0].e.cible)}`,
    pluriel: l.length > 1,
  });
  const petites = cartes.filter((x) => x.taille);
  if (petites.length) {
    const g = groupe(petites);
    out.push({
      id: 'lisibilite:taille:cartes', section: 'Textes',
      priorite: petites.some((x) => x.petite < R.ligneMinPx * 0.8) ? 'IMPORTANTE' : 'MOYENNE',
      cible: g.cible, texteActuel: petites.map((x) => x.e.texte).filter(Boolean).join(' / ') || null,
      probleme: `${g.qui} ${g.pluriel ? 'sont trop petites' : 'est trop petite'} : ${g.pluriel ? 'leur' : 'son'} texte fait ${plage(petites.map((x) => x.petite))} px de haut sur 1920. Sur un téléphone, on les devine plus qu'on ne les lit.`,
      conseil: 'Agrandis les cartes (titre et chiffre) : elles doivent se lire sans zoomer.',
      propositionReecrite: null, placementRecommande: null, dureeRecommandee: null,
      mesures: { lignePetitePx: Math.min(...petites.map((x) => x.petite)), cartes: petites.length },
    });
  }
  const perdues = cartes.filter((x) => x.contraste !== null);
  if (perdues.length) {
    const g = groupe(perdues);
    const pire = Math.min(...perdues.map((x) => x.contraste!));
    const clair = perdues[0].clair;
    out.push({
      id: 'lisibilite:contraste:cartes', section: 'Textes',
      priorite: pire < 2 ? 'IMPORTANTE' : 'MOYENNE',
      cible: g.cible, texteActuel: perdues.map((x) => x.e.texte).filter(Boolean).join(' / ') || null,
      probleme: `${g.qui} se perd${g.pluriel ? 'ent' : ''} par moments dans l'image : derrière, le fond est trop ${clair ? 'clair' : 'sombre'} pour un texte ${clair ? 'clair' : 'foncé'}${perdues.some((x) => x.e.geometrie.cadre) ? ', et le cadre transparent ne suffit pas à les détacher' : ''}.`,
      conseil: `Donne aux cartes un fond ${clair ? 'sombre' : 'clair'} plus opaque, ou place-les sur une zone plus ${clair ? 'sombre' : 'claire'} de l'image.`,
      propositionReecrite: null, placementRecommande: null, dureeRecommandee: null,
      mesures: { contrastePire: pire, cartes: perdues.length },
    });
  }
  for (const k of cartes.filter((x) => x.plusCalme)) {
    out.push({
      id: `placement:${k.e.cible}`, section: 'Textes', priorite: 'FAIBLE',
      cible: k.e.cible, texteActuel: k.e.texte,
      probleme: `La carte ${numeroCarte(k.e.cible)} est posée (${k.ici}) là où l'image bouge le plus : elle cache une partie de l'action.`,
      conseil: `Déplace-la vers « ${k.plusCalme!.nom} », où il y a moins de mouvement et de détails à ce moment-là. (Studiio mesure le mouvement ; il ne reconnaît pas encore les visages.)`,
      propositionReecrite: null, placementRecommande: k.placement, dureeRecommandee: null,
      mesures: { activiteTexte: k.e.activiteTexte, activiteZone: k.plusCalme!.activite },
    });
  }
  return out;
}
