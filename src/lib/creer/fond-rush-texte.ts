/**
 * FONDS EN MOUVEMENT des séquences Titre et CTA (Créer, défauts lisibles).
 *
 * Constat (démo « LE SPORT », lot 2) : 5,2 s d'ouverture et 4,6 s de CTA
 * FIGÉS sur un dégradé uni, alors que le projet a des rushes. Pour un projet
 * aux défauts lisibles (`versionLisibilite` ≥ 2), sans affiche ni fond choisi
 * pour la séquence, le fond devient le rush EN MOUVEMENT, assombri, sous le
 * voile du dégradé — la composition d'une affiche :
 *   - Titre : le PREMIER rush, depuis son début ;
 *   - CTA   : le DERNIER rush, sur sa fin (le plan qui « continue »).
 * L'aperçu (`FondRushTexte` du plateau) et le compositeur (`fondRushTexte`)
 * lisent CETTE fonction : même fond des deux côtés. Un post enregistré garde
 * son rendu : le marqueur de version y décide. Module PUR.
 */

/** Assombrissement du rush servi en fond des séquences Titre / CTA (avant le voile du dégradé). */
export const ASSOMBRISSEMENT_FOND_TEXTE = 0.35;

export interface FondRush {
  url: string;
  depuis: number;
  /**
   * #613 — fin de la plage PROPRE du rush (ni image figée ni coupe de la
   * source, `plansPropres`) : le fond joue [depuis, jusqua] et y reboucle
   * (jamais le reste d'un autre plan ni une image figée). Absent : le rush
   * entier, bouclé (comportement d'avant).
   */
  jusqua?: number;
  /**
   * Recadrage du rush (`rushTransforms`) — le MÊME que le compositeur
   * (`recadragePourRushPeint`), appliqué par l'aperçu en CSS. Absent : centré.
   */
  recadrage?: { scale?: number; offsetX?: number; offsetY?: number } | null;
  /**
   * Plusieurs passages propres ENCHAÎNÉS (≥ 2), dans l'ordre de lecture —
   * `url` / `depuis` / `jusqua` ci-dessus sont alors ceux du PREMIER passage
   * montré. Joués bout à bout sur la durée de la séquence ; rejoués depuis le
   * premier seulement si toute la matière est épuisée. Absent : un seul
   * passage (comportement d'avant).
   */
  segments?: SegmentFond[];
}
/** Un passage propre d'un rush servi en fond : [depuis, jusqua] de `url`. */
export interface SegmentFond {
  url: string;
  depuis: number;
  jusqua: number;
  recadrage?: { scale?: number; offsetX?: number; offsetY?: number } | null;
}
/** Durée minimale d'un passage montré (en dessous : un flash, pas un plan). */
export const SEGMENT_FOND_MIN_S = 0.8;
/** Marge ajoutée au passage qui clôt la séquence (pas de reprise sur une fraction d'image). */
const MARGE_FIN_S = 0.1;
/** Le compositeur s'arrête à `durée du fichier − 0,05 s` (`video-composer`, fonds Titre / CTA). */
const FIN_FICHIER_S = 0.05;
export interface FondsRushTexte { intro: FondRush | null; cta: FondRush | null }

export function fondsRushTexte(p: {
  lisible: boolean;
  /** Une affiche globale est posée (elle reste le fond). */
  affiche: boolean;
  /** Fonds choisis par séquence (clés `titre`, `cta`). */
  fondsSequence?: Partial<Record<'titre' | 'cartes' | 'video' | 'cta', { url?: string | null } | null | undefined>> | null;
  /** Rushes du projet, dans l'ordre (durée connue ou non). */
  rushs: ReadonlyArray<{ url: string | null | undefined; secondes?: number | null }>;
  dureeCta: number;
  /**
   * #613 — plans propres MESURÉS par URL (`plansPropres`, analyse mémoïsée
   * partagée avec l'export). Démo « LE SPORT » : le CTA partait à 0,5 s du
   * 3e rush, dans son image figée (0,27 s de gel puis un flash de l'ancien
   * plan). Absent ou inconnu pour ce rush : la règle d'avant.
   */
  plansPropres?: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> | null;
  /**
   * Durée de la séquence Titre. Connue (avec les plans propres de PLUSIEURS
   * rushes) : quand le 1er passage est plus court qu'elle, les passages
   * suivants s'enchaînent au lieu de reboucler sur le même (démo « LE
   * SPORT » : 6 s de Titre sur 3,5 s de matière → répétition visible à
   * 3,5 s). Absente : la règle d'avant.
   */
  dureeIntro?: number;
}): FondsRushTexte | null {
  if (!p.lisible || p.affiche) return null;
  const rushs = p.rushs.filter((r): r is { url: string; secondes?: number | null } => typeof r.url === 'string' && /^(https?:\/\/|\/)/.test(r.url));
  if (!rushs.length) return null;
  const premier = rushs[0];
  const dernier = rushs[rushs.length - 1];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const propresIntro = p.plansPropres?.[premier.url];
  const propresCta = p.plansPropres?.[dernier.url];
  // Titre : le 1er plan propre, depuis son début. CTA : le dernier plan propre, sur sa fin.
  const pIntro = propresIntro?.length ? propresIntro[0] : null;
  const pCta = propresCta?.length ? propresCta[propresCta.length - 1] : null;
  // Passages propres MESURÉS de tous les rushes, dans l'ordre du projet.
  // Une plage qui va jusqu'au bout du fichier s'arrête une image avant (le lecteur du compositeur ne
  // lit pas la toute dernière image) : la durée prévue est celle réellement jouée, sans gel final.
  const passages: SegmentFond[] = rushs.flatMap((r) => (p.plansPropres?.[r.url] ?? []).map(([a, b]) => ({
    url: r.url, depuis: a, jusqua: typeof r.secondes === 'number' && r.secondes > 0 ? Math.min(b, r.secondes - FIN_FICHIER_S) : b,
  })));
  const titreSansFond = !!p.fondsSequence?.titre?.url;
  const ctaSansFond = !!p.fondsSequence?.cta?.url;
  const passageDe = (url: string, x: readonly [number, number]) => passages.find((q) => q.url === url && q.depuis === x[0]) ?? { url, depuis: x[0], jusqua: x[1] };
  const chaineIntro = !titreSansFond && pIntro && typeof p.dureeIntro === 'number'
    ? enchainer({ ...passageDe(premier.url, pIntro) }, passages, p.dureeIntro, 'debut', [])
    : null;
  const chaineCta = !ctaSansFond && pCta
    ? enchainer({ ...passageDe(dernier.url, pCta) }, passages, p.dureeCta, 'fin', chaineIntro ?? [])
    : null;
  const enFond = (c: SegmentFond[]): FondRush => ({
    url: c[0].url, depuis: r2(c[0].depuis), jusqua: r2(c[0].jusqua),
    segments: c.map((x) => ({ url: x.url, depuis: r2(x.depuis), jusqua: r2(x.jusqua) })),
  });
  const intro = titreSansFond ? null
    : chaineIntro ? enFond(chaineIntro)
    : pIntro ? { url: premier.url, depuis: r2(pIntro[0]), jusqua: r2(pIntro[1]) } : { url: premier.url, depuis: 0 };
  const cta = ctaSansFond ? null
    : chaineCta ? enFond(chaineCta)
    : pCta ? { url: dernier.url, depuis: r2(Math.max(pCta[0], pCta[1] - Math.max(0, p.dureeCta))), jusqua: r2(pCta[1]) }
    : { url: dernier.url, depuis: Math.max(0, r2((dernier.secondes ?? 0) - Math.max(0, p.dureeCta))) };
  return intro || cta ? { intro, cta } : null;
}

/** Intervalles de [a, b] non couverts par `pris` (même URL). */
function libres(seg: SegmentFond, pris: ReadonlyArray<SegmentFond>): SegmentFond[] {
  let morceaux: Array<[number, number]> = [[seg.depuis, seg.jusqua]];
  for (const u of pris) {
    if (u.url !== seg.url) continue;
    morceaux = morceaux.flatMap(([a, b]): Array<[number, number]> => {
      if (u.jusqua <= a || u.depuis >= b) return [[a, b]];
      return [[a, Math.min(b, u.depuis)], [Math.max(a, u.jusqua), b]].filter(([x, y]) => y - x > 1e-6) as Array<[number, number]>;
    });
  }
  return morceaux.filter(([a, b]) => b - a >= SEGMENT_FOND_MIN_S - 1e-6).map(([a, b]) => ({ url: seg.url, depuis: a, jusqua: b }));
}

/**
 * Enchaîne des passages propres derrière (Titre, `sens: 'debut'`) ou devant
 * (CTA, `sens: 'fin'` : la séquence finit sur la FIN du passage de base) le
 * passage de base, jusqu'à couvrir `duree`. Ordre : les rushes du projet
 * (Titre) ou à rebours (CTA) ; un passage déjà pris par l'autre fond n'est
 * repris qu'en dernier recours. Aucun passage montré moins de
 * `SEGMENT_FOND_MIN_S` (sauf matière de la base elle-même). `null` : la base suffit, ou aucune autre matière.
 */
function enchainer(base: SegmentFond, passages: ReadonlyArray<SegmentFond>, duree: number, sens: 'debut' | 'fin', autreFond: ReadonlyArray<SegmentFond>): SegmentFond[] | null {
  const L = (x: SegmentFond) => x.jusqua - x.depuis;
  const marge = sens === 'debut' ? MARGE_FIN_S : 0;
  if (!(duree > 0) || L(base) >= duree - 0.05) return null;
  const ordre = sens === 'debut' ? passages : [...passages].reverse();
  const autres = ordre.flatMap((x) => libres(x, [base]));
  const neufs = autres.flatMap((x) => libres(x, autreFond));
  // Dernier recours : les portions déjà montrées par l'autre fond.
  const repris = autres.flatMap((x) => libres(x, neufs));
  const candidats = [...neufs, ...repris];
  if (!candidats.length) return null;
  // Chaîne dans l'ordre de CONSTRUCTION (Titre : lecture ; CTA : à rebours de la lecture).
  const chaine: SegmentFond[] = [{ ...base }];
  let total = L(base);
  for (const c of candidats) {
    if (total >= duree - 1e-6) break;
    if (chaine.some((x) => x.url === c.url && x.depuis < c.jusqua && x.jusqua > c.depuis)) continue;
    const reste = duree - total;
    // Le dernier passage construit ne sert que ce qu'il manque (+ marge), jamais moins que le minimum
    // (`libres` n'a gardé que des passages d'au moins `SEGMENT_FOND_MIN_S`).
    const prend = Math.min(L(c), Math.max(reste + marge, SEGMENT_FOND_MIN_S));
    const seg = sens === 'debut'
      ? { url: c.url, depuis: c.depuis, jusqua: c.depuis + prend }
      : { url: c.url, depuis: c.jusqua - prend, jusqua: c.jusqua };
    chaine.push(seg);
    total += prend;
  }
  if (chaine.length < 2) return null;
  // Le dernier passage construit a pris au moins le minimum : l'excédent est rendu par le passage
  // VOISIN — Titre : l'avant-dernier finit plus tôt (le dernier se voit ≥ 1 s, pas un flash) ;
  // CTA : la base commence plus tard (la séquence finit toujours sur la fin du dernier rush).
  // Matière épuisée (total < durée) : la chaîne sera rejouée depuis son début.
  const exces = total - duree - marge;
  if (exces > 1e-6) {
    const voisin = chaine[chaine.length - 2];
    const rend = Math.min(exces, Math.max(0, L(voisin) - SEGMENT_FOND_MIN_S));
    if (sens === 'debut') {
      voisin.jusqua -= rend;
      const dernier = chaine[chaine.length - 1];
      dernier.jusqua -= Math.max(0, exces - rend);
    } else voisin.depuis += rend;
  }
  return sens === 'debut' ? chaine : chaine.reverse();
}

/** Le fond en mouvement d'un onglet d'aperçu (Titre / CTA / composition complète). */
export function fondRushDeLOnglet(f: FondsRushTexte | null | undefined, onglet: string): FondRush | null {
  if (!f) return null;
  if (onglet === 'cta') return f.cta;
  return onglet === 'intro' || onglet === 'all' ? f.intro : null;
}
