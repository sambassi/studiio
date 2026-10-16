/**
 * M2-a — FICHE DE CONTENU D'UN RUSH, sans IA, à 0 €.
 *
 * Ce que l'on SAIT du contenu d'un rush, d'après des sources RÉELLES déjà
 * présentes chez nous — et rien d'autre :
 *
 *   - `pexels-description` : le titre de la page Pexels (mots du « slug »,
 *     `motsDuSlug`), écrit dans l'attribution à l'import ou relu depuis son
 *     `sourceUrl` pour les imports plus anciens ;
 *   - `pexels-requete` : la recherche qui a fait trouver ce média (écrite
 *     dans l'attribution à l'import, quand le serveur la connaît) ;
 *   - `nom-fichier` : le nom du fichier, SEULEMENT s'il porte un indice
 *     (`converted_123.mp4`, un UUID, `IMG_1234` n'en portent aucun) ;
 *   - `metadonnees` : un texte déjà enregistré par l'utilisateur (titre,
 *     contexte) — aucun appelant ne le fournit encore ;
 *   - `audio-energie` : l'énergie audio DÉJÀ mesurée (analyse du rush), pour
 *     la seule question « y a-t-il de la parole ? ».
 *
 * ⚠️ N'INVENTE RIEN. Les catégories sont des identifiants de la taxonomie
 * FERMÉE existante (`CONCEPTS`, `stock/requetes.ts`) ; un objet, un lieu, une
 * action ou des personnes qu'aucune source n'établit restent dans `inconnus`.
 * Un rush personnel sans indice rend `categories: []` et tout « inconnu ».
 *
 * ⚠️ CONSULTATIF. La fiche ne nourrit ni `planMontage`, ni le rendu : elle
 * est écrite à côté (`metadata.decisionMontage.contenuRushs`) et servira à
 * M2-c (pertinence) — aucun texte libre n'y est recopié.
 *
 * Module PUR : aucun réseau, aucun stockage, aucun fournisseur IA.
 */
import { motsDuSlug } from '@/lib/stock/fournisseurs';
import { conceptParId, conceptsDuTexte, IDS_CONCEPTS, motsDe, sujetsHorsTaxonomie } from '@/lib/stock/requetes';

export const VERSION_FICHE_CONTENU = 1 as const;

export type SourceFiche = 'pexels-description' | 'pexels-requete' | 'nom-fichier' | 'metadonnees' | 'audio-energie';
export type ConfianceFiche = 'elevee' | 'moyenne' | 'faible';
export type ParoleFiche = 'probable' | 'improbable' | 'inconnu';
export type DimensionInconnue = 'objets' | 'lieu' | 'action' | 'personnes';

export interface CategorieFiche {
  /** Identifiant de la taxonomie fermée `CONCEPTS` (ex. `healthy-food`, `dance`). */
  id: string;
  confiance: ConfianceFiche;
  sources: SourceFiche[];
}

export interface FicheContenuRush {
  version: typeof VERSION_FICHE_CONTENU;
  categories: CategorieFiche[];
  parole: ParoleFiche;
  /** Tout ce qu'aucune source n'établit (au moins « moyenne »). */
  inconnus: DimensionInconnue[];
  /** Résumé lisible des sources consultées — jamais un texte venu du fournisseur. */
  source: string;
  /** Présent (vrai) quand le contenu contredit la recherche : la recherche est alors « faible ». */
  contradiction?: true;
}

export interface IndicesContenu {
  pexels?: {
    /** Titre déjà extrait (`MediaStock.description`). */
    description?: string | null;
    /** Recherche qui a fait trouver le média. */
    requete?: string | null;
    /** Page Pexels : son slug sert de description quand elle manque. */
    sourceUrl?: string | null;
  } | null;
  /** Nom du fichier (sans chemin) : retenu seulement s'il est parlant. */
  nomFichier?: string | null;
  /** Textes déjà enregistrés (titre, contexte). */
  metadonnees?: Array<string | null | undefined> | null;
  /** Énergie audio RMS déjà mesurée (une valeur par échantillon, 0..1). */
  energieAudio?: number[] | null;
}

const DIMENSIONS: DimensionInconnue[] = ['objets', 'lieu', 'action', 'personnes'];
const DIMENSION_DE: Record<string, DimensionInconnue | undefined> = {
  objet: 'objets', lieu: 'lieu', activite: 'action', personnes: 'personnes',
};
/** Sources qui disent ce que MONTRE le média (la requête dit ce qu'on cherchait). */
const SOURCES_CONTENU: ReadonlySet<SourceFiche> = new Set(['pexels-description', 'nom-fichier', 'metadonnees']);
/** Langues lues par source : un titre Pexels est anglais. */
const LANGUES: Record<SourceFiche, { fr: boolean; en: boolean }> = {
  'pexels-description': { fr: false, en: true },
  'pexels-requete': { fr: true, en: true },
  'nom-fichier': { fr: true, en: true },
  metadonnees: { fr: true, en: true },
  'audio-energie': { fr: false, en: false },
};
/** Mots qui NOMMENT des personnes (anglais / français), sans les identifier. */
const MOTS_PERSONNES: ReadonlySet<string> = new Set([
  'people', 'person', 'persons', 'woman', 'women', 'man', 'men', 'girl', 'girls', 'boy', 'boys', 'kid', 'kids', 'child', 'children',
  'player', 'players', 'dancer', 'dancers', 'couple', 'family', 'friends', 'crowd', 'group', 'team',
  'personne', 'personnes', 'gens', 'femme', 'femmes', 'homme', 'hommes', 'fille', 'filles', 'garcon', 'enfant', 'enfants', 'famille', 'groupe', 'equipe',
]);
const RANG_CONFIANCE: Record<ConfianceFiche, number> = { elevee: 0, moyenne: 1, faible: 2 };
const MAX_CATEGORIES = 8;
const MAX_TEXTE = 300;

/** Énergie sous laquelle une fenêtre est muette (RMS normalisée, `analyse-rush`). */
export const SEUIL_SILENCE_AUDIO = 0.002;
/** Échantillons minimum pour juger le son. */
export const ECHANTILLONS_AUDIO_MIN = 3;

const borneTexte = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_TEXTE) : '');

/** Hôte de page Pexels reconnu (le slug n'est lu que là). */
function estPagePexels(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'www.pexels.com' || u.hostname === 'pexels.com');
  } catch {
    return false;
  }
}

/**
 * Le nom de fichier porte-t-il un indice ? Rend les MOTS retenus (sans
 * extension ni horodatage d'envoi), ou `''` pour un nom muet :
 * `converted_…`, `stock-pexels-video-<id>`, UUID, `IMG_1234`, `VID_…`,
 * `PXL_…`, `DSC…`, `MVI_…`, `GOPR…`, chiffres/hexadécimal seuls,
 * enregistrements d'écran, noms génériques (`video`, `rush`, `clip`…).
 */
export function motsDuNomFichier(nom: string | null | undefined): string {
  if (typeof nom !== 'string') return '';
  let base = nom.split(/[\\/]/).pop() ?? '';
  try { base = decodeURIComponent(base); } catch { /* nom tel quel */ }
  base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  // Horodatage préfixé par nos routes d'envoi (`<ms>-<nom>`).
  base = base.replace(/^\d{10,}[-_]/, '');
  if (!base) return '';
  const muet = [
    /^converted[_-]?\d*$/i,
    /^stock-(pexels|unsplash)-(video|photo)-[A-Za-z0-9_-]+$/i,
    /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i,
    /^(img|vid|pxl|dsc|dscn|dji|mvi|gopr|gp|mov|trim|video|rush|clip|untitled|sans[-_ ]?titre|export|final|output|record(ing)?|screen[-_ ]?recording|enregistrement|whatsapp[-_ ]?video)[\s_-]*[\d_\-.: ]*$/i,
    /^[\d_\-. ]+$/,
    /^(screen[-_ ]?recording|enregistrement[-_ ]?(d[-_ ']?)?ecran|capture[-_ ]?(d[-_ ']?)?ecran|whatsapp)\b/i,
    /^[0-9a-f]{16,}$/i,
  ];
  if (muet.some((r) => r.test(base))) return '';
  // Un identifiant d'appareil collé à un mot (`IMG_1234_cuisine`) : le mot seul compte.
  const mots = base.split(/[^A-Za-zÀ-ÿ0-9]+/).filter((m) => m && !/^\d+$/.test(m) && !/^(img|vid|pxl|dsc|mvi|gopr|copy|copie|final|v\d+)$/i.test(m));
  return mots.join(' ');
}

/** Description Pexels : explicite, sinon le slug de la page source. */
function descriptionPexels(p: NonNullable<IndicesContenu['pexels']>): string {
  const explicite = borneTexte(p.description).trim();
  if (explicite) return explicite;
  const url = borneTexte(p.sourceUrl);
  return url && estPagePexels(url) ? motsDuSlug(url) : '';
}

/**
 * Parole d'après l'énergie audio DÉJÀ mesurée.
 *
 * ⚠️ Une RMS par demi-seconde ne sépare pas une voix d'une musique : un son
 * présent rend donc `inconnu`, jamais `probable` (réservé à la transcription,
 * M2-b). Seul un rush MUET de bout en bout rend `improbable`.
 */
export function paroleDepuisEnergie(energie: number[] | null | undefined): ParoleFiche {
  if (!Array.isArray(energie)) return 'inconnu';
  const valeurs = energie.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (valeurs.length < ECHANTILLONS_AUDIO_MIN) return 'inconnu';
  return valeurs.every((v) => v < SEUIL_SILENCE_AUDIO) ? 'improbable' : 'inconnu';
}

const LIBELLE_SOURCE: Record<SourceFiche, string> = {
  'pexels-description': 'description Pexels',
  'pexels-requete': 'recherche Pexels',
  'nom-fichier': 'nom du fichier',
  metadonnees: 'informations enregistrées',
  'audio-energie': 'énergie audio',
};

/** La fiche d'un rush. Pure, déterministe, sans IA. */
export function ficheContenuRush(indices: IndicesContenu | null | undefined): FicheContenuRush {
  const i = indices ?? {};
  const textes: Array<{ source: SourceFiche; texte: string }> = [];
  if (i.pexels) {
    const d = descriptionPexels(i.pexels);
    if (d) textes.push({ source: 'pexels-description', texte: d });
    const r = borneTexte(i.pexels.requete).trim();
    if (r) textes.push({ source: 'pexels-requete', texte: r });
  }
  const nom = motsDuNomFichier(i.nomFichier);
  if (nom) textes.push({ source: 'nom-fichier', texte: nom });
  const meta = (Array.isArray(i.metadonnees) ? i.metadonnees : []).map(borneTexte).filter((t) => t.trim()).join(' · ');
  if (meta) textes.push({ source: 'metadonnees', texte: meta });

  // Concept → sources qui le citent (mots entiers, PAR LANGUE : un titre
  // Pexels est anglais, une requête ou un nom de fichier peut être l'un ou
  // l'autre), et s'il a été lu sur un verbe d'action dans une source de contenu.
  const parConcept = new Map<string, { categorie: string; sources: Set<SourceFiche>; verbeContenu: boolean }>();
  const categoriesDuContenu = new Set<string>();
  const horsTaxonomie: string[] = [];
  let personnesExplicites = false;
  for (const { source, texte } of textes) {
    const contenu = SOURCES_CONTENU.has(source);
    if (contenu) {
      horsTaxonomie.push(...sujetsHorsTaxonomie(texte));
      if (source !== 'nom-fichier' && motsDe(texte).some((m) => MOTS_PERSONNES.has(m))) personnesExplicites = true;
    }
    for (const { concept, parVerbe } of conceptsDuTexte(texte, LANGUES[source])) {
      const e = parConcept.get(concept.id) ?? { categorie: concept.categorie, sources: new Set<SourceFiche>(), verbeContenu: false };
      e.sources.add(source);
      if (parVerbe && contenu && source !== 'nom-fichier') e.verbeContenu = true;
      parConcept.set(concept.id, e);
      if (contenu) categoriesDuContenu.add(concept.categorie);
    }
  }

  // La recherche dit ce qu'on CHERCHAIT, pas ce que montre le média.
  // CONTRADICTION seulement si AUCUN concept de la recherche n'est confirmé par
  // le contenu ET que le contenu parle d'autre chose (un autre concept, ou un
  // sujet évident hors taxonomie : football, golf, club…). Une catégorie
  // ANNEXE de la recherche (« workout » dans « dance workout ») non confirmée
  // alors que la principale l'est garde sa confiance, sans drapeau.
  const deLaRequete = [...parConcept].filter(([, e]) => e.sources.has('pexels-requete'));
  const requeteConfirmee = deLaRequete.some(([, e]) => [...e.sources].some((x) => SOURCES_CONTENU.has(x)));
  // « Ailleurs » = un concept du contenu de MÊME NATURE (une autre activité, un
  // autre lieu), ou un sujet hors taxonomie face à une activité / un lieu
  // recherché. Une personne nommée ne contredit pas une recherche « nutrition ».
  const contenuAilleurs = deLaRequete.some(([, e]) => categoriesDuContenu.has(e.categorie)
    || (horsTaxonomie.length > 0 && (e.categorie === 'activite' || e.categorie === 'lieu')));
  const contradiction = deLaRequete.length > 0 && !requeteConfirmee && contenuAilleurs;
  const categories: CategorieFiche[] = [];
  for (const [id, e] of parConcept) {
    const sources = [...e.sources];
    const parLeContenu = sources.some((x) => SOURCES_CONTENU.has(x));
    const requeteSeule = e.sources.has('pexels-requete') && !parLeContenu;
    let confiance: ConfianceFiche;
    if (requeteSeule && contradiction) confiance = 'faible';
    // Annexe de même nature qu'un concept du contenu (« workout » à côté de « dance ») : faible.
    else if (requeteSeule && categoriesDuContenu.has(e.categorie)) confiance = 'faible';
    // « Élevée » exige DEUX sources indépendantes qui concordent ; jamais une seule.
    else if (sources.length >= 2) confiance = 'elevee';
    else if (e.sources.has('nom-fichier')) confiance = 'faible'; // nom de fichier seul : faible au maximum
    else confiance = 'moyenne';
    categories.push({ id, confiance, sources });
  }
  categories.sort((x, y) => RANG_CONFIANCE[x.confiance] - RANG_CONFIANCE[y.confiance]);
  const retenues = categories.slice(0, MAX_CATEGORIES);

  // Une dimension sort des inconnus SEULEMENT sur un mot explicite d'une
  // source de contenu (titre, informations) : un verbe d'action pour l'action,
  // un lieu / un objet / des personnes nommés. Une catégorie seule (Cuisine)
  // n'implique jamais une action ; une recherche n'établit rien.
  const etablies = new Set<DimensionInconnue>();
  if (personnesExplicites) etablies.add('personnes');
  for (const c of retenues) {
    const e = parConcept.get(c.id)!;
    if (c.confiance === 'faible' || !c.sources.some((x) => x === 'pexels-description' || x === 'metadonnees')) continue;
    if (e.categorie === 'activite') { if (e.verbeContenu) etablies.add('action'); continue; }
    const dim = DIMENSION_DE[e.categorie];
    if (dim) etablies.add(dim);
  }

  const parole = paroleDepuisEnergie(i.energieAudio);
  // Ce qui a ÉTABLI quelque chose, puis ce qui a été lu sans rien donner.
  const utiles: SourceFiche[] = [...new Set(retenues.flatMap((c) => c.sources))];
  if (parole !== 'inconnu') utiles.push('audio-energie');
  const muettes = [...new Set(textes.map((t) => t.source))].filter((x) => !utiles.includes(x));
  const morceaux = [
    utiles.length ? `d'après ${utiles.map((x) => LIBELLE_SOURCE[x]).join(', ')}` : '',
    muettes.length ? `rien de reconnu dans : ${muettes.map((x) => LIBELLE_SOURCE[x]).join(', ')}` : '',
  ].filter(Boolean);
  const source = morceaux.length ? morceaux.join(' · ') : 'aucun indice fiable';

  return {
    version: VERSION_FICHE_CONTENU,
    categories: retenues,
    parole,
    inconnus: DIMENSIONS.filter((d) => !etablies.has(d)),
    source,
    ...(contradiction ? { contradiction: true as const } : {}),
  };
}

/**
 * Complète la parole d'une fiche RELUE avec une énergie audio mesurée
 * depuis (la fiche du cache a pu être calculée sans elle). En mémoire
 * seulement : rien n'est recalculé ni réécrit.
 */
export function completerParole(fiche: FicheContenuRush, energie: number[] | null | undefined): FicheContenuRush {
  if (fiche.parole !== 'inconnu') return fiche;
  const parole = paroleDepuisEnergie(energie);
  if (parole === 'inconnu') return fiche;
  const audio = LIBELLE_SOURCE['audio-energie'];
  const source = fiche.source === 'aucun indice fiable' ? `d'après ${audio}`
    : fiche.source.startsWith("d'après ") ? fiche.source.replace(/^(d'après [^·]*?)( · |$)/, `$1, ${audio}$2`)
    : `d'après ${audio} · ${fiche.source}`;
  return { ...fiche, parole, source };
}

const SOURCES: ReadonlySet<string> = new Set(['pexels-description', 'pexels-requete', 'nom-fichier', 'metadonnees', 'audio-energie']);
const CONFIANCES: ReadonlySet<string> = new Set(['elevee', 'moyenne', 'faible']);
const PAROLES: ReadonlySet<string> = new Set(['probable', 'improbable', 'inconnu']);

/**
 * Une fiche RELUE (cache) est-elle exactement de la forme v1 ? Toute valeur
 * hors des énumérations fermées la rejette : elle est alors recalculée.
 */
export function ficheContenuValide(x: unknown): x is FicheContenuRush {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const f = x as Record<string, unknown>;
  if (f.version !== VERSION_FICHE_CONTENU) return false;
  if (typeof f.source !== 'string' || f.source.length > 200) return false;
  if ('contradiction' in f && f.contradiction !== true) return false;
  if (typeof f.parole !== 'string' || !PAROLES.has(f.parole)) return false;
  if (!Array.isArray(f.inconnus) || !f.inconnus.every((d) => (DIMENSIONS as string[]).includes(d as string))) return false;
  if (!Array.isArray(f.categories) || f.categories.length > MAX_CATEGORIES) return false;
  return f.categories.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const k = c as Record<string, unknown>;
    return typeof k.id === 'string' && IDS_CONCEPTS.has(k.id)
      && typeof k.confiance === 'string' && CONFIANCES.has(k.confiance)
      && Array.isArray(k.sources) && k.sources.length > 0 && k.sources.every((s) => typeof s === 'string' && SOURCES.has(s));
  });
}

/** « Contenu : Danse (élevée, d'après description Pexels) » / « Contenu : inconnu ». */
export function libelleContenu(fiche: FicheContenuRush | null | undefined): string {
  const c = fiche?.categories.find((x) => conceptParId(x.id)?.categorie === 'activite') ?? fiche?.categories[0];
  if (!fiche || !c) return 'Contenu : inconnu';
  const conf = c.confiance === 'elevee' ? 'élevée' : c.confiance;
  return `Contenu : ${conceptParId(c.id)?.libelle ?? c.id} (${conf}, ${fiche.source})`;
}

/** Une fiche dit-elle quelque chose (au moins une catégorie ou un verdict de parole) ? */
export function ficheInformative(f: FicheContenuRush | null | undefined): boolean {
  return !!f && (f.categories.length > 0 || f.parole !== 'inconnu');
}

/**
 * ⚠️ `decisionMontage.contenuRushs` est CONSULTATIF, comme `qualiteRushs` :
 * jamais relu par le rendu ni par `planMontage`. Forme v1 compacte, sans URL
 * (clé de stockage `cleSource`), sans texte venu du fournisseur. `null`
 * quand aucune fiche n'apprend rien : le post reste celui d'avant.
 */
export function contenuRushsPourMetadata(fiches: ReadonlyArray<{ cle: string; fiche: FicheContenuRush | null }>) {
  const utiles = fiches.filter((x): x is { cle: string; fiche: FicheContenuRush } => !!x.fiche && !!x.cle);
  if (!utiles.some((x) => ficheInformative(x.fiche))) return null;
  return {
    version: VERSION_FICHE_CONTENU,
    rushs: utiles.map(({ cle, fiche }) => ({
      cle: cle.replace(/^https?:\/\/[^/]+/, ''),
      categories: fiche.categories.map(({ id, confiance, sources }) => ({ id, confiance, sources })),
      parole: fiche.parole,
      inconnus: fiche.inconnus,
      ...(fiche.contradiction ? { contradiction: true as const } : {}),
    })),
  };
}

/**
 * La clé `decisionMontage` du post : `{}` sans diagnostic ni fiche — le post
 * est alors IDENTIQUE à avant M2-a. Une seule version (`version: 1`).
 */
export function decisionMontagePourMetadata<Q>(
  qualiteRushs: Q | null | undefined,
  contenuRushs: ReturnType<typeof contenuRushsPourMetadata> | null | undefined,
): { decisionMontage?: { version: 1; qualiteRushs?: Q; contenuRushs?: NonNullable<ReturnType<typeof contenuRushsPourMetadata>> } } {
  if (!qualiteRushs && !contenuRushs) return {};
  return {
    decisionMontage: {
      version: 1,
      ...(qualiteRushs ? { qualiteRushs } : {}),
      ...(contenuRushs ? { contenuRushs } : {}),
    },
  };
}
