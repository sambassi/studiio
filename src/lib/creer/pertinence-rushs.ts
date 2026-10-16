/**
 * M2-c — PERTINENCE DES RUSHES par rapport au sujet de la vidéo.
 *
 * Pour chaque rush : « pertinent », « partiel » (lien indirect, ou « à
 * vérifier »), « hors sujet » ou « inconnu », avec au plus trois raisons
 * courtes. RECOMMANDATION SEULEMENT : rien ici ne nourrit `planMontage`, le
 * rendu, l'aperçu ni l'export ; aucun rush n'est retiré automatiquement.
 *
 * Entrées : la fiche de contenu (v1 M2-a, ou v2 M2-b quand elle existe) et le
 * MÊME contexte que le moteur (`contexteMontageDepuis`), lu avec la MÊME
 * taxonomie fermée (`conceptsDe` / `CONCEPTS`). Aucune autre interprétation
 * du thème, aucun concept ajouté.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANTI-FAUSSE DÉCISION
 * ─────────────────────────────────────────────────────────────────────────
 *   - La RECHERCHE Pexels (`pexels-requete`) ne prouve JAMAIS rien : elle a
 *     été construite à partir du thème (circulaire).
 *   - Un NOM DE FICHIER seul ne prouve rien, et ne compte jamais pour « hors
 *     sujet ».
 *   - Les MÉTADONNÉES peuvent recopier le titre du projet : elles ne comptent
 *     pas pour « pertinent » (circulaire), seulement pour une divergence.
 *   - « Hors sujet » exige une activité établie par ≥ 2 sources
 *     INDÉPENDANTES et concordantes sur le contenu (description, image,
 *     parole, métadonnées), AUCUN lien avec le sujet (concept commun,
 *     affinité, même famille, décor associé), et aucune contradiction.
 *   - Une seule source divergente → « partiel », « à vérifier ».
 *   - Drapeau `contradiction` de la fiche, ou indices qui se contredisent →
 *     jamais « hors sujet » ni « pertinent » : « à vérifier ».
 *   - Thème non reconnu, fiche absente ou muette → « inconnu », score `null`.
 *   - La QUALITÉ technique (M1 : flou, noir…) n'entre PAS ici : un rush flou
 *     mais pertinent reste pertinent ; la qualité est affichée à part.
 *
 * Module PUR : aucun réseau, aucun stockage, aucun fournisseur.
 */
import { conceptParId, conceptsDe, estHorsSport } from '@/lib/stock/requetes';
import { ficheInformative, type ConfianceFiche, type FicheContenuRush } from '@/lib/creer/fiche-contenu';
import type { FicheContenuRushV2 } from '@/lib/creer/fiche-contenu-v2';
import type { ContexteMontage } from '@/lib/creer/smart-montage';
import { texteMotif, type MotifPertinence, type SourcePertinence } from '@/lib/creer/pertinence-rushs-textes';

export type { MotifPertinence, SourcePertinence } from '@/lib/creer/pertinence-rushs-textes';

export const VERSION_PERTINENCE = 1 as const;

export type NiveauPertinence = 'pertinent' | 'partiel' | 'hors_sujet' | 'inconnu';

export interface PertinenceRush {
  /** Clé de stockage du rush (`cleSource`), comme M1. */
  cle: string;
  niveau: NiveauPertinence;
  /** « À vérifier » : une seule source diverge, ou les indices se contredisent. */
  aVerifier: boolean;
  /** 0..1, indicatif (le niveau décide) ; `null` quand le niveau est `inconnu`. */
  score: number | null;
  confiance: ConfianceFiche;
  /** ≤ 3 phrases courtes en français (libellés `CONCEPTS` seulement). */
  raisons: string[];
  /** Les mêmes raisons, en codes (traduites à l'écran). */
  motifs: MotifPertinence[];
  /** Provenance des indices qui ont compté. */
  sources: SourcePertinence[];
  /** Identifiants `CONCEPTS` partagés avec le sujet. */
  communs: string[];
}

export interface DiagnosticPertinence {
  /** Identifiants `CONCEPTS` du sujet (activités, lieux, objets). */
  theme: string[];
  /** Activité principale du sujet (libellé des raisons), ou `null` (non reconnu). */
  themePrincipal: string | null;
  rushs: PertinenceRush[];
  /** Nombre de fiches qui apprennent quelque chose. */
  informatives: number;
}

type FicheEntree = FicheContenuRush | FicheContenuRushV2 | null | undefined;

// ─────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────

/** Sources qui disent ce que MONTRE le rush. `pexels-requete` et `audio-energie` n'en sont pas. */
const INDEPENDANTES: ReadonlySet<string> = new Set(['pexels-description', 'vision', 'parole', 'metadonnees', 'nom-fichier']);
/** Sources « fortes » : lues sur le contenu même (titre de la page, image, parole). */
const FORTES: ReadonlySet<string> = new Set(['pexels-description', 'vision', 'parole']);

// ─────────────────────────────────────────────────────────────────────────
// Affinités MINIMALES entre concepts existants (aucun concept ajouté)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Activités hors de la même famille mais UTILES l'une à l'autre — symétrique.
 *   - Alimentation saine ↔ Cuisine : préparer un repas sain est le sujet même.
 *   - Beauté ↔ Bien-être : le soin de soi.
 *   - Finance ↔ Productivité : même décor (bureau), même public.
 * Les activités SPORTIVES (non `horsSport`, Alimentation saine, Récupération
 * et Bien-être compris) forment une seule famille : elles ne sont jamais
 * « hors sujet » l'une pour l'autre.
 */
const AFFINITES: ReadonlyArray<readonly [string, string]> = [
  ['healthy-food', 'cooking'],
  ['skincare', 'wellness'],
  ['personal-finance', 'productivity'],
];

/** Lieux et objets qui servent de DÉCOR naturel à une activité du sujet. */
const DECORS_SPORT = ['gym', 'studio', 'yoga-mat', 'water-bottle'];
const DECORS: Readonly<Record<string, readonly string[]>> = {
  dance: [...DECORS_SPORT, 'music'],
  cardio: [...DECORS_SPORT, 'music', 'headphones'],
  workout: [...DECORS_SPORT, 'music', 'headphones'],
  running: ['outdoor', 'city', 'headphones', 'water-bottle'],
  cycling: ['outdoor', 'city', 'gym', 'water-bottle'],
  yoga: [...DECORS_SPORT, 'outdoor', 'beach', 'home'],
  meditation: ['yoga-mat', 'outdoor', 'beach', 'home', 'studio'],
  stretching: [...DECORS_SPORT, 'home'],
  'strength-training': DECORS_SPORT,
  boxing: DECORS_SPORT,
  swimming: ['beach', 'outdoor'],
  'healthy-food': ['home', 'water-bottle'],
  cooking: ['home'],
  'rest-recovery': ['home', 'yoga-mat'],
  wellness: ['home', 'outdoor', 'beach', 'yoga-mat'],
  skincare: ['home'],
  travel: ['beach', 'outdoor', 'city'],
};

const estSport = (id: string) => conceptParId(id)?.categorie === 'activite' && !estHorsSport(id);
const affines = (a: string, b: string) => AFFINITES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// ─────────────────────────────────────────────────────────────────────────
// Thème
// ─────────────────────────────────────────────────────────────────────────

const idDe = (en: string) => en.replace(/\s+/g, '-');

/** Concepts du sujet : MÊME lecture que le moteur (`conceptsDe`, implications comprises). */
export function conceptsDuSujet(contexte: ContexteMontage | null | undefined): { activites: string[]; lieuxObjets: string[] } {
  const c = contexte ?? {};
  const concepts = conceptsDe(c.theme, c.sujet, c.objectif, c.texte);
  const activites: string[] = [];
  const lieuxObjets: string[] = [];
  for (const k of concepts) {
    const id = idDe(k.en);
    if (k.categorie === 'activite' && !activites.includes(id)) activites.push(id);
    else if ((k.categorie === 'lieu' || k.categorie === 'objet') && !lieuxObjets.includes(id)) lieuxObjets.push(id);
  }
  return { activites, lieuxObjets };
}

// ─────────────────────────────────────────────────────────────────────────
// Verdict d'un rush
// ─────────────────────────────────────────────────────────────────────────

interface Preuve {
  id: string;
  categorie: 'activite' | 'lieu' | 'objet';
  sources: SourcePertinence[];
  /** Sources comptées pour « pertinent » (sans les métadonnées, possiblement circulaires). */
  nPertinent: number;
  /** Sources comptées pour « hors sujet » (sans le nom de fichier). */
  nHorsSujet: number;
  fortes: number;
}

/** Les indices RECEVABLES d'une fiche : ≥ « moyenne », au moins une source de contenu hors nom de fichier. */
function preuvesDe(fiche: FicheEntree): Preuve[] {
  const out: Preuve[] = [];
  for (const c of fiche?.categories ?? []) {
    if (!c || c.confiance === 'faible') continue;
    const k = conceptParId(c.id);
    if (!k || (k.categorie !== 'activite' && k.categorie !== 'lieu' && k.categorie !== 'objet')) continue;
    const sources = [...new Set((c.sources ?? []).filter((s) => INDEPENDANTES.has(s)))] as SourcePertinence[];
    // Recherche seule, nom de fichier seul : aucune preuve.
    if (!sources.some((s) => s !== 'nom-fichier')) continue;
    out.push({
      id: c.id,
      categorie: k.categorie,
      sources,
      nPertinent: sources.filter((s) => s !== 'metadonnees').length,
      nHorsSujet: sources.filter((s) => s !== 'nom-fichier').length,
      fortes: sources.filter((s) => FORTES.has(s)).length,
    });
  }
  return out;
}

type Relation = 'commun' | 'affine' | 'famille' | 'decor' | 'etranger' | 'neutre';

function relation(p: Preuve, sujet: { activites: string[]; lieuxObjets: string[] }): { rel: Relation; theme: string | undefined } {
  if (p.categorie === 'activite') {
    if (sujet.activites.includes(p.id)) return { rel: 'commun', theme: p.id };
    const aff = sujet.activites.find((a) => affines(a, p.id));
    if (aff) return { rel: 'affine', theme: aff };
    const fam = estSport(p.id) ? sujet.activites.find(estSport) : undefined;
    if (fam) return { rel: 'famille', theme: fam };
    return { rel: 'etranger', theme: undefined };
  }
  if (sujet.lieuxObjets.includes(p.id)) return { rel: 'commun', theme: undefined };
  const dec = sujet.activites.find((a) => DECORS[a]?.includes(p.id));
  return dec ? { rel: 'decor', theme: dec } : { rel: 'neutre', theme: undefined };
}

const arrondi = (x: number) => Math.round(x * 100) / 100;
const confianceDe = (n: number): ConfianceFiche => (n >= 3 ? 'elevee' : 'moyenne');

/** La pertinence d'UN rush. Pure, déterministe. `scenario` : réservé (aucun champ produit aujourd'hui). */
export function pertinenceRush(
  fiche: FicheEntree,
  contexte: ContexteMontage | null | undefined,
  opts: { cle?: string; scenario?: string | null } = {},
): PertinenceRush {
  const sujet = conceptsDuSujet(contexte);
  const principal = sujet.activites[0];
  const sortie = (niveau: NiveauPertinence, x: Partial<PertinenceRush> & { motifs: MotifPertinence[] }): PertinenceRush => {
    const motifs = x.motifs.slice(0, 3);
    return {
      cle: opts.cle ?? '',
      niveau,
      aVerifier: x.aVerifier ?? false,
      score: niveau === 'inconnu' ? null : arrondi(x.score ?? 0.5),
      confiance: x.confiance ?? 'faible',
      raisons: motifs.map((m) => texteMotif(m, 'fr')),
      motifs,
      sources: x.sources ?? [],
      communs: x.communs ?? [],
    };
  };

  if (!principal) return sortie('inconnu', { motifs: [{ code: 'theme_inconnu' }] });
  const preuves = preuvesDe(fiche);
  if (!preuves.length) return sortie('inconnu', { motifs: [{ code: 'non_identifie' }] });

  const lues = preuves.map((p) => ({ p, ...relation(p, sujet) }));
  const communs = lues.filter((x) => x.rel === 'commun').map((x) => x.p.id);
  const sourcesDe = (xs: Array<{ p: Preuve }>) => [...new Set(xs.flatMap((x) => x.p.sources))];
  const actsCommunes = lues.filter((x) => x.p.categorie === 'activite' && x.rel === 'commun').sort((a, b) => b.p.nPertinent - a.p.nPertinent);
  const etrangers = lues.filter((x) => x.rel === 'etranger').sort((a, b) => b.p.nHorsSujet - a.p.nHorsSujet);
  const liens = lues.filter((x) => x.rel !== 'etranger' && x.rel !== 'neutre');
  const contradiction = fiche?.contradiction === true;

  // ── Pertinent : activité du sujet, ≥ 2 sources (dont une forte), rien qui la contredise au même niveau.
  const meilleure = actsCommunes[0];
  if (meilleure && !contradiction && meilleure.p.nPertinent >= 2 && meilleure.p.fortes >= 1
    && !etrangers.some((e) => e.p.nHorsSujet >= meilleure.p.nPertinent)) {
    const n = meilleure.p.nPertinent;
    return sortie('pertinent', {
      score: 0.7 + 0.1 * Math.min(2, n - 2),
      confiance: confianceDe(n),
      motifs: [{ code: 'comme_sujet', concept: meilleure.p.id, sources: meilleure.p.sources.filter((s) => s !== 'metadonnees') }],
      sources: sourcesDe(liens),
      communs,
    });
  }

  // ── Hors sujet : activité étrangère établie par ≥ 2 sources indépendantes, AUCUN lien, aucune contradiction.
  const sur = etrangers[0];
  if (sur && sur.p.nHorsSujet >= 2 && liens.length === 0 && !contradiction) {
    const n = sur.p.nHorsSujet;
    return sortie('hors_sujet', {
      score: Math.max(0.05, 0.15 - 0.05 * (n - 2)),
      confiance: confianceDe(n),
      motifs: [{ code: 'hors_sujet', concept: sur.p.id, theme: principal, sources: sur.p.sources.filter((s) => s !== 'nom-fichier') }],
      sources: sourcesDe([sur]),
      communs,
    });
  }

  // ── Lien avec le sujet (le plus fort d'abord).
  const rang: Record<Relation, number> = { commun: 0, affine: 1, famille: 2, decor: 3, etranger: 9, neutre: 9 };
  const lien = [...liens].sort((a, b) => rang[a.rel] - rang[b.rel] || (b.p.categorie === 'activite' ? 1 : 0) - (a.p.categorie === 'activite' ? 1 : 0))[0];
  const motifLien = (): MotifPertinence | null => {
    if (!lien) return null;
    if (lien.rel === 'commun' && lien.p.categorie === 'activite') return { code: 'comme_sujet_une_source', concept: lien.p.id, sources: lien.p.sources };
    if (lien.rel === 'affine') return { code: 'proche_sujet', concept: lien.p.id, theme: lien.theme };
    if (lien.rel === 'famille') return { code: 'meme_famille', concept: lien.p.id, theme: lien.theme };
    return { code: 'decor', concept: lien.p.id };
  };
  const scoreLien = !lien ? 0.4
    : lien.rel === 'commun' && lien.p.categorie === 'activite' ? 0.6
    : lien.rel === 'affine' ? 0.55 : lien.rel === 'famille' ? 0.5 : 0.45;

  // ── Contradictions : la recherche contredite, ou un lien ET une activité étrangère.
  if (contradiction || (lien && sur)) {
    const motifs: MotifPertinence[] = [];
    if (contradiction) motifs.push({ code: 'recherche_contredite' });
    if (lien && sur) motifs.push({ code: 'contradictoire', sources: sourcesDe([lien, sur]) });
    const m = motifLien();
    if (m) motifs.push(m);
    else if (sur) motifs.push({ code: 'divergence', concept: sur.p.id, theme: principal });
    return sortie('partiel', { aVerifier: true, score: 0.4, motifs, sources: sourcesDe(lues), communs });
  }
  if (lien) {
    return sortie('partiel', { score: scoreLien, motifs: [motifLien() as MotifPertinence], sources: sourcesDe(liens), communs });
  }
  // ── Une seule source montre autre chose : à vérifier, jamais « hors sujet ».
  if (sur) {
    return sortie('partiel', {
      aVerifier: true,
      score: 0.35,
      motifs: [{ code: 'divergence', concept: sur.p.id, theme: principal }],
      sources: sourcesDe([sur]),
      communs,
    });
  }
  // Seulement des lieux / objets sans lien : on ne sait pas.
  return sortie('inconnu', { motifs: [{ code: 'sans_lien' }], sources: sourcesDe(lues), communs });
}

/** Le diagnostic de tous les rushes. */
export function evaluerPertinenceRushs(
  entrees: ReadonlyArray<{ cle: string; fiche: FicheEntree }>,
  contexte: ContexteMontage | null | undefined,
  opts: { scenario?: string | null } = {},
): DiagnosticPertinence {
  const sujet = conceptsDuSujet(contexte);
  return {
    theme: [...sujet.activites, ...sujet.lieuxObjets],
    themePrincipal: sujet.activites[0] ?? null,
    rushs: entrees.filter((e) => !!e.cle).map((e) => pertinenceRush(e.fiche, contexte, { cle: e.cle, scenario: opts.scenario })),
    informatives: entrees.filter((e) => ficheInformative(e.fiche as FicheContenuRush | null)).length,
  };
}

/**
 * ⚠️ `decisionMontage.pertinenceRushs` est CONSULTATIF : jamais relu par le
 * rendu ni par `planMontage`. Sans URL (clé de stockage sans hôte), sans
 * texte venu d'une fiche. `null` quand aucune fiche n'apprend rien : le post
 * reste alors celui d'avant, à l'identique.
 */
export function pertinenceRushsPourMetadata(d: DiagnosticPertinence | null | undefined) {
  if (!d || !d.rushs.length || d.informatives === 0) return null;
  return {
    version: VERSION_PERTINENCE,
    theme: d.theme,
    rushs: d.rushs.map((r) => ({
      cle: r.cle.replace(/^https?:\/\/[^/]+/, ''),
      niveau: r.niveau,
      ...(r.aVerifier ? { aVerifier: true as const } : {}),
      score: r.score,
      raisons: r.raisons,
      sources: r.sources,
    })),
  };
}
