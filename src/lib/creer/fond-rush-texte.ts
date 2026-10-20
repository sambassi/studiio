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
}
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
  const intro = p.fondsSequence?.titre?.url ? null
    : pIntro ? { url: premier.url, depuis: r2(pIntro[0]), jusqua: r2(pIntro[1]) } : { url: premier.url, depuis: 0 };
  const cta = p.fondsSequence?.cta?.url ? null
    : pCta ? { url: dernier.url, depuis: r2(Math.max(pCta[0], pCta[1] - Math.max(0, p.dureeCta))), jusqua: r2(pCta[1]) }
    : { url: dernier.url, depuis: Math.max(0, r2((dernier.secondes ?? 0) - Math.max(0, p.dureeCta))) };
  return intro || cta ? { intro, cta } : null;
}

/** Le fond en mouvement d'un onglet d'aperçu (Titre / CTA / composition complète). */
export function fondRushDeLOnglet(f: FondsRushTexte | null | undefined, onglet: string): FondRush | null {
  if (!f) return null;
  if (onglet === 'cta') return f.cta;
  return onglet === 'intro' || onglet === 'all' ? f.intro : null;
}
