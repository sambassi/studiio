/**
 * A_3e2 — LES PRESETS : UNE COMBINAISON, PAS UN EFFET DE PLUS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN PRESET NE TOUCHE PAS À LA MARQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il porte un look, un style de texte, deux animations et une transition —
 * c'est-à-dire des choix de FORME. Il ne porte ni couleur de marque, ni logo,
 * ni texte de CTA, ni lien.
 *
 * La raison n'est pas la prudence, c'est la propriété : les couleurs et le
 * message appartiennent au compte, pas au preset. « Cinéma événement » qui
 * repeindrait une charte en noir et remplacerait « Réserve ta place » ferait
 * perdre son identité à un compte pour un choix d'ambiance — et personne ne
 * comprendrait pourquoi, puisqu'il a cliqué sur une vignette de look.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE RÉFÉRENCE MORTE, ET C'EST TESTÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque identifiant cité ici existe dans son catalogue au moment où il est
 * écrit. Un preset qui nommerait un effet futur s'appliquerait à moitié : le
 * contrat retomberait sur le défaut pour le champ inconnu, et la personne
 * verrait un preset « appliqué » qui ne ressemble pas à sa vignette.
 *
 * MODULE PUR.
 */
import { LOOK_IDS } from './looks';
import { STYLE_TEXTE_IDS } from './styles-texte';
import { ANIMATION_TEXTE_IDS } from './animations-texte';
import { ANIMATION_CONTENU_IDS } from './animations-contenu';
import {
  TRANSITION_CREATIVE_IDS, transitionCreativeParId,
  DUREE_TRANSITION_MIN_MS, DUREE_TRANSITION_MAX_MS,
} from './transitions';
import type { EntreeCreative } from './catalogue-contrat';

export const VERSION_PRESETS = 'preset-v1';

/**
 * Ce qu'un preset décide — et rien d'autre.
 *
 * Sept champs, tous des identifiants de catalogue ou des nombres bornés.
 * Aucune couleur, aucun texte, aucune URL.
 */
export interface StylePreset {
  lutId: string;
  lutIntensite: number;
  styleTexteId: string;
  animationBlocId: string;
  animationContenuId: string;
  transitionId: string;
  transitionDureeMs: number;
}

export interface PresetStudiio extends EntreeCreative {
  famille: 'preset';
  style: StylePreset;
}

const p = (
  id: string, nom: string, categorie: EntreeCreative['categorie'],
  tags: string[], description: string, style: StylePreset,
): PresetStudiio => ({
  id, nom, famille: 'preset', categorie, tags, description,
  rendu: true, version: VERSION_PRESETS, style,
});

const s = (
  lutId: string, lutIntensite: number, styleTexteId: string,
  animationBlocId: string, animationContenuId: string,
  transitionId: string, transitionDureeMs: number,
): StylePreset => ({
  lutId, lutIntensite, styleTexteId, animationBlocId, animationContenuId,
  transitionId, transitionDureeMs,
});

export const PRESETS_STUDIIO: readonly PresetStudiio[] = [
  p('fitness-energie', 'Fitness Énergie', 'energie',
    ['fitness', 'sport', 'coach', 'dynamique'],
    'Couleurs franches, texte massif, rythme rapide.',
    s('energie', 0.9, 'sport', 'pop-rapide', 'mot-par-mot', 'zoom-avant', 400)),
  p('createur-epure', 'Créateur épuré', 'sobre',
    ['clean', 'minimal', 'creator', 'sobre'],
    'Image propre, texte discret, passages doux.',
    s('clean', 0.7, 'minimal-blanc', 'fondu-entree', 'aucune', 'fondu', 500)),
  p('cinema-evenement', 'Cinéma événement', 'cinema',
    ['cinema', 'event', 'evenement', 'dramatique'],
    'Contraste de film et ouvertures larges.',
    s('blockbuster', 0.85, 'titre-cinema', 'revelation', 'aucune', 'iris-noir', 700)),
  p('temoignage', 'Témoignage', 'portrait',
    ['temoignage', 'testimonial', 'interview', 'visage'],
    'Peaux naturelles, texte lisible, rien qui distraie.',
    s('peau-naturelle', 0.8, 'temoignage', 'fondu-entree', 'mot-fondu', 'fondu-gris', 600)),
  p('luxe', 'Luxe', 'cinema',
    ['luxe', 'premium', 'elegant', 'sobre'],
    'Noir profond, lettres fines, gestes lents.',
    s('noir', 0.8, 'elegant', 'fondu-lent', 'aucune', 'vague-droite', 600)),
  p('produit', 'Produit', 'social',
    ['produit', 'ecommerce', 'demo', 'vente'],
    'Image claire, texte encadré, lecture par groupes.',
    s('bright', 0.8, 'boxed', 'zoom-avant', 'groupe-par-groupe', 'balayage-gauche', 400)),
  p('voyage', 'Voyage', 'ambiance',
    ['voyage', 'travel', 'exterieur', 'vacances'],
    'Couleurs de plein air et glissements latéraux.',
    s('tropical', 0.85, 'creator', 'glisse-gauche', 'aucune', 'glisse-gauche', 400)),
  p('cuisine', 'Cuisine', 'ambiance',
    ['food', 'cuisine', 'restaurant', 'recette'],
    'Lumière chaude, texte appétissant, fondus doux.',
    s('heure-doree', 0.85, 'promo', 'pop', 'mot-par-mot', 'dissolution', 500)),
  p('immobilier', 'Immobilier', 'sobre',
    ['immobilier', 'visite', 'architecture', 'calme'],
    'Rendu sobre, titres posés, ouvertures au centre.',
    s('film-soft', 0.75, 'editorial', 'montee', 'aucune', 'ouverture-centre', 600)),
  p('podcast', 'Podcast', 'sobre',
    ['podcast', 'parole', 'interview', 'sous-titre'],
    'Image neutre et mot actif : la parole passe devant.',
    s('desature', 0.7, 'caption', 'aucune', 'mot-actif', 'cut', 0)),
  p('lifestyle', 'Lifestyle', 'social',
    ['lifestyle', 'quotidien', 'creator', 'doux'],
    'Teintes flatteuses et transitions en vague.',
    s('lifestyle', 0.8, 'creator', 'fondu-entree', 'mot-fondu', 'vague-gauche', 600)),
  p('promo-choc', 'Promo choc', 'energie',
    ['promo', 'soldes', 'offre', 'vif'],
    'Tout est fort : couleur, frappe, éclair.',
    s('punchy', 0.95, 'challenge', 'surgissement', 'machine-rapide', 'flash', 300)),
];

export const PRESET_STUDIIO_IDS: readonly string[] = PRESETS_STUDIIO.map((x) => x.id);

export function presetStudiioParId(id: unknown): PresetStudiio | null {
  if (typeof id !== 'string') return null;
  return PRESETS_STUDIIO.find((x) => x.id === id) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// LES PRESETS PERSONNELS
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ VINGT, ET PAS L'INFINI.
 *
 * Ils vivent dans le même `jsonb` que les favoris, envoyé en entier à chaque
 * enregistrement. Vingt combinaisons nommées couvrent largement une identité
 * de marque — au-delà, c'est une bibliothèque qu'il faudrait ranger, pas une
 * liste de raccourcis.
 */
export const PRESETS_PERSONNELS_MAX = 20;
export const NOM_PRESET_MAX = 40;

export interface PresetPersonnel {
  id: string;
  nom: string;
  style: StylePreset;
}

const borner = (v: unknown, min: number, max: number, defaut: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : defaut;
  return Math.min(max, Math.max(min, n));
};

const dansListe = (v: unknown, liste: readonly string[]): string | null =>
  (typeof v === 'string' && liste.includes(v) ? v : null);

/**
 * Un style de preset relu — TOUT OU RIEN.
 *
 * ⚠️ UN SEUL CHAMP MORT SUFFIT À LE REFUSER. Retomber sur un défaut pour le
 * champ inconnu donnerait un preset qui s'applique à moitié : la personne
 * verrait « appliqué » et une image qui ne ressemble pas à ce qu'elle a
 * enregistré. Mieux vaut dire qu'il n'est plus valide.
 */
export function stylePresetValide(brut: unknown): StylePreset | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  const lutId = dansListe(o.lutId, LOOK_IDS);
  const styleTexteId = dansListe(o.styleTexteId, STYLE_TEXTE_IDS);
  const animationBlocId = dansListe(o.animationBlocId, ANIMATION_TEXTE_IDS);
  const contenus = ANIMATION_CONTENU_IDS.includes('aucune')
    ? ANIMATION_CONTENU_IDS : ['aucune', ...ANIMATION_CONTENU_IDS];
  const animationContenuId = dansListe(o.animationContenuId, contenus);
  const transitionId = dansListe(o.transitionId, TRANSITION_CREATIVE_IDS);
  if (!lutId || !styleTexteId || !animationBlocId || !animationContenuId || !transitionId) {
    return null;
  }
  const tr = transitionCreativeParId(transitionId);
  return {
    lutId,
    lutIntensite: borner(o.lutIntensite, 0, 1, 0.8),
    styleTexteId,
    animationBlocId,
    animationContenuId,
    transitionId,
    /* La coupe n'a pas de durée ; les autres sont bornées par le moteur de
       transition, pas par un nombre écrit ici une seconde fois. */
    transitionDureeMs: transitionId === 'cut' ? 0 : borner(
      o.transitionDureeMs, DUREE_TRANSITION_MIN_MS, DUREE_TRANSITION_MAX_MS,
      tr?.dureeDefautMs ?? 400,
    ),
  };
}

/** Un nom lisible : ni vide, ni un paragraphe, ni des retours à la ligne. */
export function nomPresetValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(/[\r\n\t]+/g, ' ').trim().slice(0, NOM_PRESET_MAX);
  return propre.length > 0 ? propre : null;
}

export function presetsPersonnelsValides(brut: unknown): readonly PresetPersonnel[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const sortie: PresetPersonnel[] = [];
  for (const v of brut) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : null;
    const nom = nomPresetValide(o.nom);
    const style = stylePresetValide(o.style);
    if (!id || !nom || !style || vus.has(id)) continue;
    vus.add(id);
    sortie.push({ id, nom, style });
    if (sortie.length >= PRESETS_PERSONNELS_MAX) break;
  }
  return sortie;
}

// ─────────────────────────────────────────────────────────────────────────
// APPLIQUER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les seuls blocs qu'un preset touche.
 *
 * ⚠️ TYPÉ PAR SA FORME, PAS PAR LE PROFIL. Nommer `ProfilCreatifAutopilote`
 * ici ferait remonter tout le contrat de l'Autopilote dans un module de
 * catalogue — et rendrait impossible d'appliquer un preset à un brouillon.
 */
export interface BlocsCreatifs {
  lut: { active: boolean; lutId: string | null; intensite: number };
  /**
   * ⚠️ LU, JAMAIS ECRIT PAR UN PRESET. Les sous-titres sont un reglage de
   * LISIBILITE ; un preset d'ambiance n'a pas a en changer. Il est ici pour
   * que la variation puisse le RECONDUIRE, pas pour qu'elle le choisisse.
   */
  captions?: { styleId: string };
  typographie: { styleTexteId: string | null };
  animations: { texteId: string; texteContenuId: string };
  transitions: {
    active: boolean; transitionId: string; dureeMs: number; intensite: number;
  };
}

/**
 * Applique un preset, et RIEN d'autre.
 *
 * ⚠️ LES BLOCS NON CITÉS SONT RECOPIÉS TELS QUELS. `couleurs`, `marque`,
 * `texte`, `ctaVisuel`, `margesSures` traversent sans être lus : c'est ce qui
 * garantit qu'un preset ne repeint pas une charte et ne remplace pas un
 * message. Le test le vérifie champ par champ.
 *
 * ⚠️ `neutral` VEUT DIRE « PAS DE LOOK ». Un preset qui le nommerait doit
 * éteindre la LUT, pas l'activer sur l'identité — sinon le graphe porterait
 * un filtre qui ne fait rien.
 */
export function appliquerPreset<T extends BlocsCreatifs>(profil: T, style: StylePreset): T {
  return {
    ...profil,
    lut: {
      ...profil.lut,
      active: style.lutId !== 'neutral',
      lutId: style.lutId,
      intensite: style.lutIntensite,
    },
    typographie: { ...profil.typographie, styleTexteId: style.styleTexteId },
    animations: {
      ...profil.animations,
      texteId: style.animationBlocId,
      texteContenuId: style.animationContenuId,
    },
    transitions: {
      ...profil.transitions,
      active: style.transitionId !== 'cut',
      transitionId: style.transitionId,
      dureeMs: style.transitionId === 'cut'
        ? profil.transitions.dureeMs : style.transitionDureeMs,
    },
  };
}

/** Le style courant d'un profil, tel qu'un preset personnel l'enregistre. */
export function styleDepuisProfil(profil: BlocsCreatifs): StylePreset {
  return {
    lutId: profil.lut.active ? (profil.lut.lutId ?? 'neutral') : 'neutral',
    lutIntensite: profil.lut.intensite,
    styleTexteId: profil.typographie.styleTexteId ?? 'defaut',
    animationBlocId: profil.animations.texteId,
    animationContenuId: profil.animations.texteContenuId,
    transitionId: profil.transitions.active ? profil.transitions.transitionId : 'cut',
    transitionDureeMs: profil.transitions.dureeMs,
  };
}
