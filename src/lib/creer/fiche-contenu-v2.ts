/**
 * M2-b — FICHE DE CONTENU v2 : la fiche M2-a, plus ce que la VISION et la
 * PAROLE d'un rush personnel ont établi. Module PUR (aucun réseau, aucun
 * stockage, aucun fournisseur) : il valide ce qu'un fournisseur a rendu et
 * le fusionne avec la fiche v1, selon les règles M2-a conservées.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANTI-INVENTION
 * ─────────────────────────────────────────────────────────────────────────
 *   - Une observation n'existe que si le fournisseur la donne avec une
 *     confiance au moins « moyenne » ; « faible » reste écrite mais laisse la
 *     dimension dans `inconnus`.
 *   - La vision SEULE plafonne à « moyenne ». « Élevée » exige DEUX sources
 *     concordantes (vision + parole, ou vision + une source M2-a de contenu).
 *   - Une catégorie n'implique JAMAIS une action : `action` ne sort des
 *     inconnus que sur une observation d'action explicite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANTI-INJECTION
 * ─────────────────────────────────────────────────────────────────────────
 * Tout texte vu dans l'image ou entendu est une DONNÉE. La sortie du
 * fournisseur est FERMÉE : identifiants de la taxonomie `CONCEPTS` seulement,
 * énumérations fermées, champs libres de 40 caractères en minuscules, sans
 * URL, sans chiffre long, sans consigne, sans nom propre. Rien de ce module
 * n'est jamais réinjecté dans une invite, ni lu par `planMontage`, le rendu
 * ou l'export.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANTI-BIOMÉTRIE
 * ─────────────────────────────────────────────────────────────────────────
 * `personnes` est un COMPTE (`aucune|une|plusieurs|inconnu`) et rien d'autre.
 * Aucun nom, âge, genre, origine, émotion, état de santé n'a de champ ; les
 * catégories « personnes » (femme, homme…) et « qualité » (joyeux, calme…) de
 * la taxonomie sont REFUSÉES en sortie de vision ; tout libre qui en parle est
 * effacé.
 */
import { conceptParId, conceptsDuTexte, IDS_CONCEPTS, motsDe } from '@/lib/stock/requetes';
import { ficheContenuValide, type ConfianceFiche, type DimensionInconnue, type FicheContenuRush } from '@/lib/creer/fiche-contenu';

export const VERSION_FICHE_CONTENU_V2 = 2 as const;

export type SourceObservation = 'vision' | 'parole' | 'm2a';
export type ComptePersonnes = 'aucune' | 'une' | 'plusieurs' | 'inconnu';
export type LangueParole = 'fr' | 'en' | 'de' | 'autre' | 'inconnu';
/** État d'une étape : faite, sans objet (rien à analyser), à faire (éteinte, place prise), échec. */
export type EtatEtape = 'faite' | 'sans_objet' | 'a_faire' | 'echec';

export interface Observation {
  /** Concept de la taxonomie fermée, ou `null` (seul le libre est connu). */
  id: string | null;
  /** ≤ 40 caractères, minuscules, filtré. */
  libre: string | null;
  confiance: ConfianceFiche;
  source: SourceObservation;
}

export interface ObservationsRush {
  objets: Observation[];
  lieu: Observation | null;
  action: Observation | null;
  personnes: { valeur: ComptePersonnes; confiance: ConfianceFiche; source: 'vision' } | null;
  /** Les sujets que l'IMAGE seule a donnés (avant fusion), pour refondre sans rappeler. */
  categoriesVision: Array<{ id: string; confiance: ConfianceFiche }>;
  langue: LangueParole;
  parole: {
    /** ≤ 300 caractères, URL / adresses / numéros / noms propres masqués. Jamais réinjecté. */
    extrait: string | null;
    /** Concepts cités (taxonomie fermée), via `conceptsDuTexte`. */
    sujets: string[];
    /** Vrai quand la parole ressemble à une consigne : sujets et extrait écartés. */
    ecartee?: true;
    source: 'parole';
  } | null;
}

export interface EtapeAnalyse {
  etat: EtatEtape;
  /** Littéral à nous (jamais un message de fournisseur). */
  motif?: string;
  /** Horodatage ISO de la dernière tentative (échec : réessai après 24 h). */
  le?: string;
}

export interface UsageVision {
  modele: string;
  images: number;
  jetonsEntree: number | null;
  jetonsSortie: number | null;
  coutEstimeUsd: number | null;
  depassement?: true;
}

export interface UsageTranscription {
  modele: string;
  secondesAudio: number;
  secondesFacturees: number;
  coutEstimeUsd: number | null;
  /** Transcription relue depuis l'Autopilote (même fichier) : aucun appel. */
  reutilisee?: true;
}

export type CategorieV2 = { id: string; confiance: ConfianceFiche; sources: string[] };

export interface FicheContenuRushV2 extends Omit<FicheContenuRush, 'version' | 'categories'> {
  version: typeof VERSION_FICHE_CONTENU_V2;
  categories: CategorieV2[];
  observations: ObservationsRush;
  etapes: { vision: EtapeAnalyse; transcription: EtapeAnalyse };
  usage: { vision?: UsageVision; transcription?: UsageTranscription; tarifs: string };
}

// ─────────────────────────────────────────────────────────────────────────
// Bornes et vocabulaires fermés
// ─────────────────────────────────────────────────────────────────────────

export const OBJETS_MAX = 5;
export const CATEGORIES_VISION_MAX = 6;
export const LIBRE_MAX = 40;
export const EXTRAIT_MAX = 300;
const CONFIANCES: readonly ConfianceFiche[] = ['elevee', 'moyenne', 'faible'];
const COMPTES: readonly ComptePersonnes[] = ['aucune', 'une', 'plusieurs', 'inconnu'];
const RANG: Record<ConfianceFiche, number> = { elevee: 0, moyenne: 1, faible: 2 };

const idsDe = (categorie: string) => [...IDS_CONCEPTS].filter((id) => conceptParId(id)?.categorie === categorie);
/** Concepts qu'une IMAGE a le droit de nommer : activités, lieux, objets. Jamais personnes / qualités / style. */
export const IDS_ACTIONS: readonly string[] = idsDe('activite');
export const IDS_LIEUX: readonly string[] = idsDe('lieu');
export const IDS_OBJETS: readonly string[] = idsDe('objet');
export const IDS_CATEGORIES_VISION: readonly string[] = [...IDS_ACTIONS, ...IDS_LIEUX, ...IDS_OBJETS];

/**
 * Mots qui trahissent une inférence sensible (identité, âge, genre, origine,
 * santé, émotion, religion) ou une consigne. Un libre qui en contient un est
 * effacé — on ne tente pas de le « réparer ».
 */
const MOTS_INTERDITS: ReadonlySet<string> = new Set([
  // identité / biométrie
  'nom', 'prenom', 'visage', 'visages', 'age', 'ans', 'agee', 'age', 'vieux', 'vieille', 'jeune', 'jeunes', 'adolescent', 'adolescente',
  'homme', 'hommes', 'femme', 'femmes', 'garcon', 'fille', 'filles', 'bebe', 'enfant', 'enfants', 'monsieur', 'madame',
  'ethnie', 'ethnique', 'origine', 'race', 'peau', 'blanc', 'blanche', 'noir', 'noire', 'metis', 'asiatique', 'africain', 'africaine', 'arabe', 'europeen',
  'religion', 'musulman', 'chretien', 'juif', 'voile', 'handicap', 'handicape', 'malade', 'enceinte', 'obese', 'mince', 'gros', 'grosse', 'tatouage',
  'celebrite', 'celebre', 'star', 'influenceur', 'influenceuse',
  // émotions inférées
  'triste', 'heureux', 'heureuse', 'joyeux', 'joyeuse', 'colere', 'enerve', 'enervee', 'souriant', 'souriante', 'anxieux', 'stresse', 'stressee', 'fatigue', 'fatiguee', 'emotion', 'emu', 'emue',
  // consignes
  'ignore', 'ignorer', 'ignorez', 'instruction', 'instructions', 'consigne', 'consignes', 'prompt', 'systeme', 'assistant', 'reponds', 'repondez', 'supprime', 'supprimer', 'efface', 'effacer', 'compte', 'mot', 'passe', 'cle', 'api', 'commande', 'execute', 'executer', 'classe', 'classer', 'categorise', 'categoriser',
  // anglais courant
  'name', 'face', 'age', 'old', 'young', 'woman', 'man', 'girl', 'boy', 'white', 'black', 'asian', 'happy', 'sad', 'angry', 'ignore', 'previous', 'delete', 'account', 'system',
]);

/** Ce qui ressemble à une consigne dans une parole ou un texte vu. */
const CONSIGNE = /\b(ignore[rsz]?|oublie[rsz]?|disregard|forget)\b.{0,40}\b(instructions?|consignes?|r[eè]gles?|previous|pr[eé]c[eé]dent)|\b(supprime[rsz]?|efface[rsz]?|delete|remove)\b.{0,30}\b(compte|account|donn[eé]es|data|fichiers?|vid[eé]os?)|\b(classe[rsz]?|cat[eé]gorise[rsz]?|classify|categori[sz]e)\b.{0,30}\b(comme|en|as|dans)\b|\b(tu es|you are|en tant qu.{0,3}(ia|assistant)|system prompt|prompt syst[eè]me|nouvelle consigne|new instructions?)\b/i;

export function ressembleAConsigne(texte: string): boolean {
  return CONSIGNE.test(texte.normalize('NFC'));
}

/**
 * Un libre de vision, ou `null`. Minuscules seulement (une majuscule = nom
 * propre possible → refus), lettres / espaces / apostrophes / tirets, au plus
 * 40 caractères et 5 mots, aucun mot sensible, aucune consigne.
 */
export function libreFiltre(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t.length > LIBRE_MAX) return null;
  if (/[A-ZÀ-Þ]/.test(t)) return null;
  if (!/^[a-zß-öø-ÿœæ' -]+$/.test(t)) return null;
  if (/https?|www|\.com|@/.test(t)) return null;
  const mots = motsDe(t);
  if (mots.length === 0 || mots.length > 5) return null;
  if (mots.some((m) => MOTS_INTERDITS.has(m))) return null;
  if (ressembleAConsigne(t)) return null;
  return t;
}

const confianceDe = (v: unknown): ConfianceFiche | null => (typeof v === 'string' && (CONFIANCES as string[]).includes(v) ? v as ConfianceFiche : null);
const plafonnerVision = (c: ConfianceFiche): ConfianceFiche => (c === 'elevee' ? 'moyenne' : c);

// ─────────────────────────────────────────────────────────────────────────
// Le schéma dit au modèle (sortie structurée) — bornes dans les descriptions
// ─────────────────────────────────────────────────────────────────────────

/** Le schéma de sortie de l'analyse visuelle M2-b. `additionalProperties: false` partout. */
export function schemaObservations(): Record<string, unknown> {
  const confiance = { type: 'string', enum: [...CONFIANCES], description: 'Ta confiance : faible si tu hésites.' };
  const observation = (ids: readonly string[], quoi: string) => ({
    type: 'object',
    additionalProperties: false,
    required: ['id', 'libre', 'confiance'],
    properties: {
      id: {
        anyOf: [{ type: 'string', enum: [...ids] }, { type: 'null' }],
        description: `${quoi} : identifiant de la liste, ou null si aucun ne convient.`,
      },
      libre: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: `Deux à quatre mots en français, en minuscules, au plus ${LIBRE_MAX} caractères, sans nom propre ni marque ; null si inutile.`,
      },
      confiance,
    },
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['objets', 'lieu', 'action', 'personnes', 'categories'],
    properties: {
      objets: {
        type: 'array',
        description: `Les objets clairement visibles et utiles pour comprendre la scène. Au plus ${OBJETS_MAX}.`,
        items: observation(IDS_OBJETS, 'Objet'),
      },
      lieu: { anyOf: [observation(IDS_LIEUX, 'Lieu'), { type: 'null' }] },
      action: { anyOf: [observation(IDS_ACTIONS, 'Action'), { type: 'null' }] },
      personnes: {
        type: 'object',
        additionalProperties: false,
        required: ['valeur', 'confiance'],
        properties: {
          valeur: { type: 'string', enum: [...COMPTES], description: 'Le NOMBRE de personnes visibles, rien d’autre.' },
          confiance,
        },
      },
      categories: {
        type: 'array',
        description: `Les sujets du rush, choisis dans la liste. Au plus ${CATEGORIES_VISION_MAX}. Liste vide si aucun ne convient.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'confiance'],
          properties: { id: { type: 'string', enum: [...IDS_CATEGORIES_VISION] }, confiance },
        },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Lecture STRICTE de la réponse visuelle
// ─────────────────────────────────────────────────────────────────────────

export interface VisionLue {
  objets: Observation[];
  lieu: Observation | null;
  action: Observation | null;
  personnes: { valeur: ComptePersonnes; confiance: ConfianceFiche; source: 'vision' } | null;
  categories: Array<{ id: string; confiance: ConfianceFiche }>;
}

export type ResultatVision = { ok: true; valeur: VisionLue; rejets: number } | { ok: false; motif: 'json_invalide' | 'hors_schema' | 'trop_long' };

const REPONSE_MAX = 16 * 1024;
const CLES = new Set(['objets', 'lieu', 'action', 'personnes', 'categories']);

/** Une observation lue, ou `null` (rejetée). Compte les rejets. */
function lireObservation(brut: unknown, ids: readonly string[]): Observation | null | 'rejet' {
  if (brut === null) return null;
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return 'rejet';
  const o = brut as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['id', 'libre', 'confiance'].includes(k))) return 'rejet';
  const confiance = confianceDe(o.confiance);
  if (!confiance) return 'rejet';
  const id = typeof o.id === 'string' && ids.includes(o.id) ? o.id : null;
  if (o.id !== null && o.id !== undefined && id === null) return 'rejet'; // identifiant inventé
  const libre = o.libre === null || o.libre === undefined ? null : libreFiltre(o.libre);
  if (id === null && libre === null) return null;
  return { id, libre, confiance: plafonnerVision(confiance), source: 'vision' };
}

/**
 * La réponse du fournisseur (chaîne JSON ou objet), validée et FILTRÉE.
 * Clé inconnue à la racine, type faux, JSON tronqué → refus entier. Un
 * élément invalide d'une liste est écarté (et compté), jamais corrigé.
 */
export function lireReponseObservations(reponse: unknown): ResultatVision {
  let brut: unknown = reponse;
  if (typeof reponse === 'string') {
    if (reponse.length > REPONSE_MAX) return { ok: false, motif: 'trop_long' };
    try { brut = JSON.parse(reponse); } catch { return { ok: false, motif: 'json_invalide' }; }
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return { ok: false, motif: 'hors_schema' };
  const r = brut as Record<string, unknown>;
  if (Object.keys(r).some((k) => !CLES.has(k))) return { ok: false, motif: 'hors_schema' };
  if (!Array.isArray(r.objets) || !Array.isArray(r.categories)) return { ok: false, motif: 'hors_schema' };
  let rejets = 0;

  const objets: Observation[] = [];
  for (const x of r.objets.slice(0, 20)) {
    const o = lireObservation(x, IDS_OBJETS);
    if (o === 'rejet') { rejets++; continue; }
    if (o && objets.length < OBJETS_MAX) objets.push(o);
  }
  const un = (x: unknown, ids: readonly string[]) => {
    const o = lireObservation(x ?? null, ids);
    if (o === 'rejet') { rejets++; return null; }
    return o;
  };
  const lieu = un(r.lieu, IDS_LIEUX);
  const action = un(r.action, IDS_ACTIONS);

  let personnes: VisionLue['personnes'] = null;
  const p = r.personnes as Record<string, unknown> | null | undefined;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const extra = Object.keys(p).some((k) => k !== 'valeur' && k !== 'confiance');
    const conf = confianceDe(p.confiance);
    if (!extra && conf && typeof p.valeur === 'string' && (COMPTES as string[]).includes(p.valeur)) {
      // Confiance insuffisante → « inconnu », jamais un compte deviné.
      personnes = { valeur: conf === 'faible' ? 'inconnu' : p.valeur as ComptePersonnes, confiance: plafonnerVision(conf), source: 'vision' };
    } else rejets++;
  } else if (p !== undefined && p !== null) rejets++;

  const categories: VisionLue['categories'] = [];
  for (const c of r.categories.slice(0, 20)) {
    const k = c as Record<string, unknown>;
    const conf = k && typeof k === 'object' ? confianceDe(k.confiance) : null;
    if (!conf || typeof k.id !== 'string' || !IDS_CATEGORIES_VISION.includes(k.id) || Object.keys(k).some((x) => x !== 'id' && x !== 'confiance')) { rejets++; continue; }
    if (categories.some((x) => x.id === k.id) || categories.length >= CATEGORIES_VISION_MAX) continue;
    categories.push({ id: k.id, confiance: plafonnerVision(conf) });
  }
  return { ok: true, valeur: { objets, lieu, action, personnes, categories }, rejets };
}

// ─────────────────────────────────────────────────────────────────────────
// Parole
// ─────────────────────────────────────────────────────────────────────────

/** Langue rapportée par le transcripteur → vocabulaire fermé. */
export function langueParole(v: unknown): LangueParole {
  if (typeof v !== 'string' || !v.trim()) return 'inconnu';
  const l = v.trim().toLowerCase();
  if (l === 'fr' || l.startsWith('fr')) return 'fr';
  if (l === 'en' || l.startsWith('english') || l.startsWith('en-')) return 'en';
  if (l === 'de' || l.startsWith('german') || l.startsWith('deutsch') || l.startsWith('de-')) return 'de';
  return 'autre';
}

/**
 * Extrait court d'une transcription : ≤ 300 caractères, sans URL, adresse
 * électronique, numéro (≥ 3 chiffres) ni mot capitalisé au milieu d'une
 * phrase (nom propre possible) — remplacés par « … ».
 */
export function extraitParole(texte: string): string | null {
  const t = texte.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const masque = t
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '…')
    .replace(/\S+@\S+\.\S+/g, '…')
    .replace(/[+()\d][\d .()\-]{2,}\d/g, (m) => (/\d{3,}|\d[\d .\-]{4,}/.test(m) ? '…' : m))
    .replace(/([^.!?…]\s)([A-ZÀ-Þ][\p{L}'’-]+)/gu, '$1…');
  const borne = masque.length > EXTRAIT_MAX ? `${masque.slice(0, EXTRAIT_MAX - 1).replace(/\s+\S*$/, '')}…` : masque;
  return borne.slice(0, EXTRAIT_MAX);
}

export interface ParoleLue {
  presente: boolean;
  langue: unknown;
  texte: string;
}

/** Les observations de parole d'une transcription validée (jamais réinjectées). */
export function observationsParole(p: ParoleLue): ObservationsRush['parole'] {
  const texte = (p.texte || '').slice(0, 20_000);
  if (!p.presente || !texte.trim()) return null;
  if (ressembleAConsigne(texte)) return { extrait: null, sujets: [], ecartee: true, source: 'parole' };
  const sujets = [...new Set(conceptsDuTexte(texte, { fr: true, en: true })
    .map((c) => c.concept)
    // Les catégories « personnes » / « qualité » ne sortent pas plus de la parole que de l'image.
    .filter((c) => c.categorie === 'activite' || c.categorie === 'lieu' || c.categorie === 'objet')
    .map((c) => c.id))].slice(0, CATEGORIES_VISION_MAX);
  return { extrait: extraitParole(texte), sujets, source: 'parole' };
}

// ─────────────────────────────────────────────────────────────────────────
// Fusion v1 + vision + parole
// ─────────────────────────────────────────────────────────────────────────

const SOURCES_CONTENU_V1 = new Set(['pexels-description', 'metadonnees', 'nom-fichier']);

export interface EntreeFusion {
  v1: FicheContenuRush;
  vision: VisionLue | null;
  parole: ObservationsRush['parole'];
  langue: LangueParole;
  /** La parole a-t-elle été écoutée (transcription faite, même vide) ? */
  paroleEcoutee: boolean;
  etapes: FicheContenuRushV2['etapes'];
  usage: FicheContenuRushV2['usage'];
}

/** La fiche v2. Pure, déterministe. */
export function fusionnerFicheV2(e: EntreeFusion): FicheContenuRushV2 {
  const parId = new Map<string, { confiance: ConfianceFiche; sources: Set<string> }>();
  for (const c of e.v1.categories) parId.set(c.id, { confiance: c.confiance, sources: new Set(c.sources) });

  const confirmeParV1 = (id: string) => [...(parId.get(id)?.sources ?? [])].some((s) => SOURCES_CONTENU_V1.has(s));
  const ajouter = (id: string, confiance: ConfianceFiche, source: 'vision' | 'parole') => {
    const ex = parId.get(id) ?? { confiance, sources: new Set<string>() };
    ex.sources.add(source);
    if (RANG[confiance] < RANG[ex.confiance]) ex.confiance = confiance;
    parId.set(id, ex);
  };
  const sujetsParole = new Set(e.parole?.sujets ?? []);
  const deVision = new Map<string, ConfianceFiche>();
  for (const c of e.vision?.categories ?? []) deVision.set(c.id, c.confiance);
  for (const o of [e.vision?.action, e.vision?.lieu, ...(e.vision?.objets ?? [])]) {
    if (o?.id && !deVision.has(o.id)) deVision.set(o.id, o.confiance);
  }
  for (const [id, c] of deVision) ajouter(id, c, 'vision');
  for (const id of sujetsParole) ajouter(id, 'moyenne', 'parole'); // parole seule : « moyenne » au plus

  // Confiance finale : « élevée » seulement à DEUX sources concordantes, dont
  // au moins une de contenu (vision, parole, description, métadonnées).
  for (const [id, x] of parId) {
    const vision = x.sources.has('vision');
    const parole = x.sources.has('parole');
    const v1 = confirmeParV1(id);
    const nouvelles = vision || parole;
    if (!nouvelles) continue; // catégorie v1 inchangée (règles M2-a)
    const concordantes = (vision ? 1 : 0) + (parole ? 1 : 0) + (v1 ? 1 : 0);
    const visionConf = deVision.get(id);
    if (concordantes >= 2 && (visionConf ? visionConf !== 'faible' : true)) x.confiance = 'elevee';
    else if (vision && !parole && !v1) x.confiance = visionConf ?? 'faible';
    else if (parole && !vision && !v1) x.confiance = 'moyenne';
    else x.confiance = x.confiance === 'elevee' ? 'moyenne' : x.confiance;
  }
  const categories: CategorieV2[] = [...parId].map(([id, x]) => ({ id, confiance: x.confiance, sources: [...x.sources] }))
    .sort((a, b) => RANG[a.confiance] - RANG[b.confiance])
    .slice(0, 8);

  // Inconnus : une dimension n'en sort que sur une observation explicite ≥ « moyenne ».
  const etablies = new Set<DimensionInconnue>(['objets', 'lieu', 'action', 'personnes'].filter((d) => !e.v1.inconnus.includes(d as DimensionInconnue)) as DimensionInconnue[]);
  const sure = (o: Observation | null | undefined) => !!o && o.confiance !== 'faible';
  if (e.vision) {
    if (e.vision.objets.some(sure)) etablies.add('objets');
    if (sure(e.vision.lieu)) etablies.add('lieu');
    if (sure(e.vision.action)) etablies.add('action');
    if (e.vision.personnes && e.vision.personnes.valeur !== 'inconnu' && e.vision.personnes.confiance !== 'faible') etablies.add('personnes');
  }
  const inconnus = (['objets', 'lieu', 'action', 'personnes'] as DimensionInconnue[]).filter((d) => !etablies.has(d));

  // Parole écoutée : présente (même écartée comme consigne) → probable ; vide → improbable.
  const parole = e.paroleEcoutee ? (e.parole ? 'probable' : 'improbable') : e.v1.parole;
  const morceaux = [e.v1.source];
  if (e.vision) morceaux.push('analyse visuelle');
  if (e.paroleEcoutee) morceaux.push('transcription');

  return {
    version: VERSION_FICHE_CONTENU_V2,
    categories,
    parole,
    inconnus,
    source: morceaux.join(' · ').slice(0, 200),
    ...(e.v1.contradiction ? { contradiction: true as const } : {}),
    observations: {
      objets: e.vision?.objets ?? [],
      lieu: e.vision?.lieu ?? null,
      action: e.vision?.action ?? null,
      personnes: e.vision?.personnes ?? null,
      categoriesVision: e.vision?.categories ?? [],
      langue: e.langue,
      parole: e.parole,
    },
    etapes: e.etapes,
    usage: e.usage,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Validation d'une fiche RELUE (cache)
// ─────────────────────────────────────────────────────────────────────────

const ETATS: readonly EtatEtape[] = ['faite', 'sans_objet', 'a_faire', 'echec'];
const etapeValide = (x: unknown) => !!x && typeof x === 'object' && ETATS.includes((x as EtapeAnalyse).etat)
  && ((x as EtapeAnalyse).motif === undefined || (typeof (x as EtapeAnalyse).motif === 'string' && (x as EtapeAnalyse).motif!.length <= 60));
const observationValide = (o: unknown, ids: readonly string[]) => {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  const k = o as Observation;
  return (k.id === null || ids.includes(k.id as string))
    && (k.libre === null || libreFiltre(k.libre) === k.libre)
    && CONFIANCES.includes(k.confiance) && k.confiance !== 'elevee'
    && (k.source === 'vision');
};

/** Une fiche v2 relue est-elle exactement de la forme attendue ? Sinon elle est ignorée. */
export function ficheContenuV2Valide(x: unknown): x is FicheContenuRushV2 {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const f = x as FicheContenuRushV2;
  if (f.version !== VERSION_FICHE_CONTENU_V2) return false;
  // Le socle v1 doit lui-même être valide (catégories v2 : sources élargies).
  const socle = { ...f, version: 1, categories: f.categories?.map((c) => ({ ...c, sources: (c.sources ?? []).filter((s) => s !== 'vision' && s !== 'parole') })).filter((c) => c.sources.length > 0) };
  if (!ficheContenuValide(socle)) return false;
  if (!Array.isArray(f.categories) || !f.categories.every((c) => IDS_CONCEPTS.has(c.id) && Array.isArray(c.sources) && c.sources.length > 0)) return false;
  const o = f.observations;
  if (!o || typeof o !== 'object') return false;
  if (!Array.isArray(o.objets) || o.objets.length > OBJETS_MAX || !o.objets.every((x) => observationValide(x, IDS_OBJETS))) return false;
  if (!observationValide(o.lieu, IDS_LIEUX) || !observationValide(o.action, IDS_ACTIONS)) return false;
  if (o.personnes !== null && (!o.personnes || !COMPTES.includes(o.personnes.valeur) || !CONFIANCES.includes(o.personnes.confiance))) return false;
  if (!Array.isArray(o.categoriesVision) || o.categoriesVision.length > CATEGORIES_VISION_MAX
    || !o.categoriesVision.every((c) => IDS_CATEGORIES_VISION.includes(c?.id) && CONFIANCES.includes(c?.confiance) && c.confiance !== 'elevee')) return false;
  if (!['fr', 'en', 'de', 'autre', 'inconnu'].includes(o.langue)) return false;
  if (o.parole !== null) {
    if (!o.parole || typeof o.parole !== 'object') return false;
    if (o.parole.extrait !== null && (typeof o.parole.extrait !== 'string' || o.parole.extrait.length > EXTRAIT_MAX)) return false;
    if (!Array.isArray(o.parole.sujets) || !o.parole.sujets.every((s) => IDS_CONCEPTS.has(s))) return false;
  }
  if (!f.etapes || !etapeValide(f.etapes.vision) || !etapeValide(f.etapes.transcription)) return false;
  if (!f.usage || typeof f.usage.tarifs !== 'string') return false;
  return true;
}

/** Relit la vision d'une fiche v2 (pour refondre sans rappeler le fournisseur), ou `null`. */
export function visionDeFiche(f: FicheContenuRushV2): VisionLue | null {
  if (f.etapes.vision.etat !== 'faite') return null;
  const o = f.observations;
  return { objets: o.objets, lieu: o.lieu, action: o.action, personnes: o.personnes, categories: o.categoriesVision };
}
