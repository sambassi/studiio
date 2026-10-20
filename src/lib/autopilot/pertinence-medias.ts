/**
 * PERTINENCE SÉMANTIQUE des médias STOCK — sans IA, sans réseau.
 *
 * Constat (production, sujet « Voyage ») : une vidéo de cuisine ouvrait le
 * montage et revenait plus loin. Le filtre par sujet (#608) compare le SUJET
 * NOTÉ au moment de la rétention (`MediaStockRetenu.sujet`), pas le CONTENU :
 * un plat cherché pendant une recherche « voyage » est noté « Voyage »
 * (`AutopilotPanel.retenirStock` écrit `sujetStock`), et passe le filtre.
 *
 * Ici, le CONTENU décide : la description du média (titre Pexels / Unsplash,
 * lu dans le slug de sa page source — `motsDuSlug`) est comparée au SCÉNARIO
 * (sujet, brief, titre, cartes, script) avec la taxonomie fermée de Créer
 * (`conceptsDe`, `@/lib/stock/requetes`) complétée d'un lexique anglais (les
 * pages Pexels sont titrées en anglais) et de DÉCORS par activité.
 *
 *   pertinent : montre l'activité du sujet (« man traveling », « suitcase ») ;
 *   decor     : un décor du sujet sans autre activité (« boat on a lake ») ;
 *   limite    : une AUTRE activité que le scénario MENTIONNE (« cuisine
 *               locale » dans un script de voyage → un plat) — au plus une fois ;
 *   hors      : une autre activité que le scénario ne mentionne pas — jamais
 *               piochée automatiquement (un média FORCÉ reste un choix) ;
 *   inconnu   : aucune description, ou rien de reconnu — la règle d'avant.
 *
 * DEFAULT SAFE : sujet non reconnu par la taxonomie → tout est `inconnu`, rien
 * n'est filtré ni réordonné. Les rushes PERSONNELS ne passent jamais ici.
 * Module PUR.
 */
import { CONCEPTS_ABSTRAITS, conceptsAbstraitsDe, conceptsDe, motsDe } from '@/lib/stock/requetes';

export type NiveauPertinenceMedia = 'pertinent' | 'decor' | 'limite' | 'inconnu' | 'hors';

export interface PertinenceMedia {
  niveau: NiveauPertinenceMedia;
  /** 0..1 — ordre de pioche (le plus pertinent ouvre le montage). */
  score: number;
  /** Activités reconnues dans le média. */
  activites: string[];
  /** Décors / objets reconnus dans le média. */
  scenes: string[];
}

/**
 * Lexique ANGLAIS (titres Pexels / Unsplash) et français complémentaire →
 * activité de la taxonomie (`id` de `CONCEPTS`, forme anglaise).
 */
const ACTIVITES_MOTS: Record<string, readonly string[]> = {
  travel: ['travel', 'traveler', 'traveller', 'travelling', 'traveling', 'tourist', 'tourists', 'tourism', 'vacation', 'holiday', 'holidays', 'trip', 'journey', 'backpacker', 'backpacking', 'sightseeing', 'voyageur', 'voyageuse', 'touriste', 'sejour', 'escapade', 'roadtrip'],
  cooking: ['cooking', 'cook', 'cooks', 'chef', 'chefs', 'food', 'foods', 'dish', 'dishes', 'meal', 'meals', 'seafood', 'lobster', 'shrimp', 'pasta', 'plate', 'plated', 'kitchen', 'restaurant', 'recipe', 'dinner', 'lunch', 'breakfast', 'cuisine', 'culinaire', 'gastronomie', 'gastronomique', 'gastronomy', 'gourmet', 'dessert', 'pastry', 'pastries', 'baking', 'bakery', 'gougere', 'gougeres', 'pot', 'frying', 'grill', 'grilling', 'cheese', 'bread', 'pizza', 'burger', 'sushi', 'soup', 'stew'],
  'healthy-food': ['salad', 'vegetables', 'vegetable', 'fruit', 'fruits', 'smoothie', 'healthy', 'nutrition'],
  dance: ['dance', 'dancing', 'dancer', 'dancers', 'zumba', 'choreography'],
  yoga: ['yoga', 'asana'],
  meditation: ['meditation', 'meditating', 'meditate', 'mindfulness'],
  running: ['running', 'runner', 'runners', 'jogging', 'jogger', 'marathon', 'sprint'],
  'strength-training': ['weightlifting', 'dumbbell', 'dumbbells', 'barbell', 'deadlift', 'squat', 'bodybuilding'],
  cycling: ['cycling', 'cyclist', 'bicycle', 'bike', 'biking'],
  swimming: ['swimming', 'swimmer', 'swim'],
  boxing: ['boxing', 'boxer', 'punching'],
  workout: ['workout', 'fitness', 'exercise', 'exercising', 'training', 'gym'],
  'personal-finance': ['money', 'finance', 'budget', 'coins', 'banknotes', 'savings', 'investing', 'calculator'],
  skincare: ['skincare', 'makeup', 'cosmetics', 'beauty'],
  productivity: ['office', 'laptop', 'desk', 'productivity', 'notebook', 'planner'],
};

/**
 * DÉCORS et objets (anglais + français) → scène. Une scène n'est pas une
 * activité : elle situe le plan (un bateau, un ponton, une valise).
 */
const SCENES_MOTS: Record<string, readonly string[]> = {
  plage: ['beach', 'beaches', 'sand', 'shore', 'plage', 'sable'],
  mer: ['sea', 'ocean', 'coast', 'coastline', 'bay', 'lagoon', 'mer', 'ocean', 'cote', 'lagon', 'baie'],
  ile: ['island', 'islands', 'ile', 'iles', 'islet'],
  bateau: ['boat', 'boats', 'ship', 'sailboat', 'sailing', 'yacht', 'canoe', 'kayak', 'ferry', 'bateau', 'voilier', 'pirogue'],
  ponton: ['pier', 'dock', 'jetty', 'boardwalk', 'wharf', 'harbor', 'harbour', 'port', 'ponton', 'jetee', 'quai'],
  palmier: ['palm', 'palms', 'tropical', 'tropics', 'palmier', 'palmiers', 'tropique', 'tropiques'],
  avion: ['airplane', 'aeroplane', 'plane', 'planes', 'flight', 'flights', 'airport', 'aircraft', 'avion', 'avions', 'vol', 'vols', 'aeroport', 'cockpit'],
  bagage: ['suitcase', 'suitcases', 'luggage', 'baggage', 'backpack', 'packing', 'bagage', 'bagages', 'valise', 'valises', 'sac'],
  carte: ['map', 'maps', 'compass', 'passport', 'carte', 'boussole', 'passeport', 'itineraire'],
  soleil: ['sunset', 'sunrise', 'golden', 'dusk', 'dawn', 'sun', 'coucher', 'lever', 'soleil', 'doree', 'crepuscule'],
  montagne: ['mountain', 'mountains', 'hiking', 'hiker', 'valley', 'cliff', 'montagne', 'montagnes', 'randonnee', 'vallee', 'falaise'],
  paysage: ['landscape', 'scenery', 'view', 'panorama', 'nature', 'lake', 'river', 'waterfall', 'forest', 'paysage', 'lac', 'riviere', 'cascade', 'foret'],
  ville: ['city', 'street', 'streets', 'town', 'village', 'market', 'old town', 'architecture', 'ville', 'rue', 'marche', 'village', 'ruelle'],
  hotel: ['hotel', 'resort', 'bungalow', 'villa', 'hostel', 'hotel', 'auberge'],
  salle: ['gym', 'studio', 'salle'],
};

/** Les décors de chaque activité : ce qui situe un plan « dans le sujet ». */
const DECORS_ACTIVITE: Record<string, readonly string[]> = {
  travel: ['plage', 'mer', 'ile', 'bateau', 'ponton', 'palmier', 'avion', 'bagage', 'carte', 'soleil', 'montagne', 'paysage', 'ville', 'hotel'],
  cooking: ['ville'],
  dance: ['salle'],
  workout: ['salle'],
  yoga: ['plage', 'paysage', 'soleil'],
  running: ['paysage', 'ville', 'plage'],
  cycling: ['paysage', 'ville', 'montagne'],
  swimming: ['mer', 'plage'],
  meditation: ['paysage', 'soleil', 'plage'],
};

/** Activités voisines : un plat est « mentionné » par un script qui parle de repas. */
const FAMILLES: Record<string, readonly string[]> = {
  cooking: ['healthy-food'],
  'healthy-food': ['cooking'],
};

const INDEX_ACTIVITES = new Map<string, string>();
for (const [id, mots] of Object.entries(ACTIVITES_MOTS)) for (const m of mots) INDEX_ACTIVITES.set(m, id);
const INDEX_SCENES = new Map<string, string>();
for (const [id, mots] of Object.entries(SCENES_MOTS)) for (const m of mots) if (!INDEX_SCENES.has(m)) INDEX_SCENES.set(m, id);

const idConcept = (en: string) => en.replace(/\s+/g, '-');

/** Activités et scènes d'un ou plusieurs textes (taxonomie de Créer + lexique). */
export function lireConcepts(...textes: Array<string | null | undefined>): { activites: Set<string>; scenes: Set<string> } {
  const activites = new Set<string>();
  const scenes = new Set<string>();
  for (const c of conceptsDe(...textes)) {
    const id = idConcept(c.en);
    if (c.categorie === 'activite') activites.add(id);
  }
  for (const t of textes) {
    for (const mot of motsDe(t ?? '')) {
      const a = INDEX_ACTIVITES.get(mot);
      if (a) activites.add(a);
      const s = INDEX_SCENES.get(mot);
      if (s) scenes.add(s);
    }
  }
  return { activites, scenes };
}

/**
 * Le SCÉNARIO d'une vidéo : ce que le sujet EST (activités principales, lues
 * sur le sujet / l'objectif) et ce que la vidéo MENTIONNE (titre, cartes,
 * script — une activité citée y rend un média « limite » acceptable).
 */
export interface ScenarioPertinence {
  principales: Set<string>;
  mentionnees: Set<string>;
  scenesMentionnees: Set<string>;
  /**
   * Concepts ABSTRAITS du sujet (motivation, confiance… — `CONCEPTS_ABSTRAITS`),
   * lus seulement quand aucune activité principale n'est reconnue. Ils ne
   * servent qu'à CLASSER (un média qui les illustre passe devant) : jamais un
   * niveau `hors`, jamais un filtre. Absent : la règle d'avant.
   */
  abstraits?: Set<string>;
}

export function scenarioPertinence(e: {
  /** Sujet(s) : libellés des thèmes, objectif du brief. */
  sujets: ReadonlyArray<string | null | undefined>;
  /** Ce que la vidéo dit : titre, sous-titre, cartes, script, message, CTA. */
  textes?: ReadonlyArray<string | null | undefined>;
}): ScenarioPertinence {
  const principales = lireConcepts(...e.sujets).activites;
  const lus = lireConcepts(...e.sujets, ...(e.textes ?? []));
  const abstraits = principales.size === 0 ? new Set(conceptsAbstraitsDe(...e.sujets).map((c) => c.id)) : new Set<string>();
  return { principales, mentionnees: lus.activites, scenesMentionnees: lus.scenes, ...(abstraits.size ? { abstraits } : {}) };
}

/** La description d'un média stock retenu : explicite, sinon le slug de sa page. */
export function descriptionMediaStock(m: { description?: string | null; sourceUrl?: string | null } | null | undefined): string {
  if (!m) return '';
  const explicite = (m.description ?? '').trim();
  if (explicite) return explicite.slice(0, 300);
  const url = (m.sourceUrl ?? '').slice(0, 2048);
  // Pexels : /video/<slug>-<id>/ ou /photo/<slug>-<id>/ ; Unsplash : /photos/<slug>-<id>.
  const r = /\/(?:video|photo|photos)\/([^/?#]+)/.exec(url);
  if (!r) return '';
  // ⚠️ Adresse fournie par l'utilisateur : longueur bornée, aucune regex
  // ambiguë (retour arrière). Le dernier morceau porteur d'un chiffre est l'id.
  const morceaux = r[1].slice(0, 200).split('-').filter(Boolean);
  if (morceaux.length && /\d/.test(morceaux[morceaux.length - 1])) morceaux.pop();
  return morceaux.join(' ').trim();
}

/**
 * Le niveau d'un média pour un scénario. Sans activité principale reconnue
 * (sujet hors taxonomie) : `inconnu` — aucun filtrage (default safe).
 */
export function pertinenceMedia(description: string, s: ScenarioPertinence): PertinenceMedia {
  const lu = lireConcepts(description);
  const activites = Array.from(lu.activites);
  const scenes = Array.from(lu.scenes);
  if (s.principales.size === 0 && s.abstraits?.size && description.trim()) {
    // Sujet abstrait : un média qui l'ILLUSTRE (indices du concept) passe devant,
    // les autres restent « inconnu » à leur score d'avant — rien n'est exclu.
    const mots = new Set(motsDe(description));
    const abstraits = s.abstraits;
    const indices = CONCEPTS_ABSTRAITS.filter((c) => abstraits.has(c.id))
      .flatMap((c) => c.indices.filter((i) => mots.has(i)));
    const n = new Set(indices).size;
    if (n > 0) return { niveau: 'pertinent', score: Math.min(0.95, 0.75 + 0.1 * n), activites, scenes };
    return { niveau: 'inconnu', score: 0.5, activites, scenes };
  }
  if (s.principales.size === 0 || !description.trim()) return { niveau: 'inconnu', score: 0.5, activites, scenes };
  const decors = new Set(Array.from(s.principales).flatMap((a) => DECORS_ACTIVITE[a] ?? []));
  const scenesDuSujet = scenes.filter((x) => decors.has(x) || s.scenesMentionnees.has(x)).length;
  if (activites.some((a) => s.principales.has(a))) {
    return { niveau: 'pertinent', score: Math.min(1, 0.85 + 0.05 * scenesDuSujet), activites, scenes };
  }
  // Activités génériques (entraînement, bien-être) seules : pas une autre activité.
  const autres = activites.filter((a) => a !== 'workout' && a !== 'wellness');
  if (autres.length === 0) {
    if (scenesDuSujet > 0) return { niveau: 'decor', score: Math.min(0.8, 0.65 + 0.05 * scenesDuSujet), activites, scenes };
    return { niveau: 'inconnu', score: 0.4, activites, scenes };
  }
  // Une AUTRE activité : acceptable seulement si la vidéo en parle.
  if (autres.some((a) => s.mentionnees.has(a) || (FAMILLES[a] ?? []).some((f) => s.mentionnees.has(f)))) return { niveau: 'limite', score: 0.3 + 0.02 * scenesDuSujet, activites, scenes };
  return { niveau: 'hors', score: 0, activites, scenes };
}

/** Rapprochement d'un média et d'un passage de la narration (carte affichée) : 0..1. */
export function accordAvecTexte(description: string, texte: string): number {
  if (!description.trim() || !texte.trim()) return 0;
  const m = lireConcepts(description);
  const t = lireConcepts(texte);
  let n = 0;
  for (const x of Array.from(t.scenes)) if (m.scenes.has(x)) n += 1;
  for (const x of Array.from(t.activites)) if (m.activites.has(x)) n += 1;
  return Math.min(1, n / 2);
}

/** Les pertinences à confier à `planMultiSources`, par URL (médias stock retenus). */
export function pertinencesPourPlan(
  stock: ReadonlyArray<{ url: string; description?: string | null; sourceUrl?: string | null }>, s: ScenarioPertinence,
): Record<string, { niveau: NiveauPertinenceMedia; score: number; description: string }> {
  const out: Record<string, { niveau: NiveauPertinenceMedia; score: number; description: string }> = {};
  for (const m of stock) {
    const description = descriptionMediaStock(m);
    const p = pertinenceMedia(description, s);
    out[m.url] = { niveau: p.niveau, score: p.score, description };
  }
  return out;
}

/**
 * La narration d'une séquence en surimpression : la fenêtre du titre et de
 * chaque carte, avec leur texte — ce que la vidéo dit à chaque instant.
 */
export function narrationDesSurimpressions(
  o: { titre?: [number, number] | null; cartes?: ReadonlyArray<{ index: number; debut: number; fin: number }> } | null | undefined,
  textes: { titre?: string | null; cartes?: ReadonlyArray<{ title?: string | null; description?: string | null } | null | undefined> },
): Array<{ debut: number; fin: number; texte: string }> {
  if (!o) return [];
  const out: Array<{ debut: number; fin: number; texte: string }> = [];
  if (o.titre && textes.titre) out.push({ debut: o.titre[0], fin: o.titre[1], texte: textes.titre });
  for (const c of o.cartes ?? []) {
    const carte = textes.cartes?.[c.index];
    const texte = [carte?.title, carte?.description].filter(Boolean).join(' ');
    if (texte) out.push({ debut: c.debut, fin: c.fin, texte });
  }
  return out.sort((a, b) => a.debut - b.debut);
}
