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

export interface FondRush { url: string; depuis: number }
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
}): FondsRushTexte | null {
  if (!p.lisible || p.affiche) return null;
  const rushs = p.rushs.filter((r): r is { url: string; secondes?: number | null } => typeof r.url === 'string' && /^(https?:\/\/|\/)/.test(r.url));
  if (!rushs.length) return null;
  const premier = rushs[0];
  const dernier = rushs[rushs.length - 1];
  const intro = p.fondsSequence?.titre?.url ? null : { url: premier.url, depuis: 0 };
  const cta = p.fondsSequence?.cta?.url ? null
    : { url: dernier.url, depuis: Math.max(0, Math.round(((dernier.secondes ?? 0) - Math.max(0, p.dureeCta)) * 100) / 100) };
  return intro || cta ? { intro, cta } : null;
}

/** Le fond en mouvement d'un onglet d'aperçu (Titre / CTA / composition complète). */
export function fondRushDeLOnglet(f: FondsRushTexte | null | undefined, onglet: string): FondRush | null {
  if (!f) return null;
  if (onglet === 'cta') return f.cta;
  return onglet === 'intro' || onglet === 'all' ? f.intro : null;
}
