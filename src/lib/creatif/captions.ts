/**
 * A_4b — LES STYLES DE SOUS-TITRES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN SOUS-TITRE N'EST PAS UN TITRE DÉCORATIF
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les vingt-sept animations de texte d'A_3c servent un HOOK : un bloc qu'on
 * regarde. Un sous-titre, on le LIT, en même temps qu'on écoute et qu'on
 * regarde l'image. Les recopier ici aurait donné des sous-titres qui rebondissent
 * — jolis une fois, illisibles au bout de trente secondes.
 *
 * Les animations d'ici sont donc courtes, discrètes, et aucune ne déplace le
 * texte pendant qu'on le lit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUI EST ANNONCÉ EST CE QUE `libass` SAIT FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le karaoké utilise `\kf`, mesuré sur le binaire : à 0,4 s le premier mot
 * est rempli à moitié (1193 pixels d'accent contre 1241 de base), à 1,4 s il
 * l'est entièrement et le deuxième est à moitié, à 2,6 s le troisième est aux
 * deux tiers. La progression est réelle et monotone.
 *
 * ⚠️ AUCUN EMOJI PROMIS. Les polices Liberation n'en portent aucun glyphe :
 * un emoji dans une transcription sortirait en carré vide. On ne l'annonce
 * donc nulle part, et on ne le retire pas non plus du texte — ce serait
 * censurer ce qui a été dit.
 *
 * MODULE PUR.
 */
import type { EntreeCreative } from './catalogue-contrat';

export const VERSION_CAPTIONS = 'caption-engine-v1';

/** Les trois familles installées par `fonts-liberation`, et rien d'autre. */
export const POLICES_CAPTION = ['sans', 'serif', 'mono'] as const;
export type PoliceCaption = (typeof POLICES_CAPTION)[number];

/** Ce qui arrive au mot en cours de prononciation. */
export const SURBRILLANCES = ['aucune', 'mot-actif', 'mot-actif-fond', 'karaoke'] as const;
export type Surbrillance = (typeof SURBRILLANCES)[number];

/** Comment un bloc arrive à l'écran. Court, toujours. */
export const APPARITIONS_CAPTION = ['aucune', 'fondu', 'pop', 'montee'] as const;
export type ApparitionCaption = (typeof APPARITIONS_CAPTION)[number];

export const POSITIONS_CAPTION = ['bas', 'centre-bas', 'centre', 'haut'] as const;
export type PositionCaption = (typeof POSITIONS_CAPTION)[number];

/** L'aide à la lisibilité — la même grammaire que les styles de texte A_3b. */
export interface HabillageCaption {
  contour: { largeur: number; teinte: 'noir' | 'blanc' } | null;
  ombre: { decalage: number; opacite: number; teinte: 'noir' | 'blanc' } | null;
  fond: { opacite: number; marge: number; teinte: 'noir' | 'blanc' } | null;
}

export interface StyleCaption extends EntreeCreative {
  famille: 'caption';
  police: PoliceCaption;
  graisse: 'normale' | 'grasse';
  /** En part de la HAUTEUR du cadre : la même valeur tient en 9:16 et en 16:9. */
  taillePct: number;
  casse: 'normale' | 'majuscules';
  /** Combien de mots par bloc. Le segmenteur peut descendre en dessous. */
  motsParBloc: number;
  lignesMax: 1 | 2;
  habillage: HabillageCaption;
  surbrillance: Surbrillance;
  apparition: ApparitionCaption;
  position: PositionCaption;
}

const CONTOUR = (largeur: number, teinte: 'noir' | 'blanc' = 'noir') => ({ largeur, teinte });
const OMBRE = (decalage: number, opacite = 0.6) => ({
  decalage, opacite, teinte: 'noir' as const,
});
const FOND = (opacite: number, marge: number, teinte: 'noir' | 'blanc' = 'noir') => ({
  opacite, marge, teinte,
});

const c = (
  id: string, nom: string, categorie: EntreeCreative['categorie'], tags: string[],
  description: string,
  police: PoliceCaption, graisse: 'normale' | 'grasse', taillePct: number,
  casse: 'normale' | 'majuscules', motsParBloc: number, lignesMax: 1 | 2,
  habillage: HabillageCaption, surbrillance: Surbrillance,
  apparition: ApparitionCaption, position: PositionCaption,
): StyleCaption => ({
  id, nom, famille: 'caption', categorie, tags, description,
  rendu: true, version: VERSION_CAPTIONS,
  police, graisse, taillePct, casse, motsParBloc, lignesMax,
  habillage, surbrillance, apparition, position,
});

export const STYLES_CAPTION: readonly StyleCaption[] = [
  // ── SOBRE ───────────────────────────────────────────────────────────
  c('minimal-blanc', 'Minimal blanc', 'sobre', ['minimal', 'blanc', 'discret', 'propre'],
    'Blanc, contour fin, rien de plus.',
    'sans', 'normale', 4.0, 'normale', 5, 2,
    { contour: CONTOUR(2), ombre: null, fond: null }, 'aucune', 'aucune', 'centre-bas'),
  c('minimal-sombre', 'Minimal sombre', 'sobre', ['minimal', 'sombre', 'bandeau'],
    'Un bandeau sombre discret sous le texte.',
    'sans', 'normale', 4.0, 'normale', 5, 2,
    { contour: null, ombre: null, fond: FOND(0.45, 10) }, 'aucune', 'aucune', 'centre-bas'),
  c('propre', 'Propre', 'sobre', ['clean', 'net', 'lisible'],
    'Gras léger, ombre douce, lecture facile.',
    'sans', 'grasse', 4.2, 'normale', 4, 2,
    { contour: null, ombre: OMBRE(3), fond: null }, 'aucune', 'aucune', 'centre-bas'),
  c('doux', 'Doux', 'sobre', ['doux', 'fondu', 'calme'],
    'Chaque bloc arrive en fondu.',
    'sans', 'normale', 3.8, 'normale', 5, 2,
    { contour: CONTOUR(1), ombre: OMBRE(2, 0.4), fond: null }, 'aucune', 'fondu', 'centre-bas'),
  c('editorial', 'Éditorial', 'sobre', ['editorial', 'serif', 'article'],
    'Un empattement sobre, comme un article.',
    'serif', 'normale', 3.8, 'normale', 6, 2,
    { contour: CONTOUR(2), ombre: null, fond: null }, 'aucune', 'aucune', 'centre-bas'),
  c('classique', 'Classique', 'sobre', ['classique', 'standard', 'neutre'],
    'Le sous-titre tel qu’on le connaît.',
    'sans', 'normale', 3.6, 'normale', 7, 2,
    { contour: CONTOUR(2), ombre: OMBRE(2), fond: null }, 'aucune', 'aucune', 'bas'),

  // ── SOCIAL ──────────────────────────────────────────────────────────
  c('bold-social', 'Bold Social', 'social', ['bold', 'social', 'gras', 'reels'],
    'Gros, gras, majuscules : fait pour le téléphone.',
    'sans', 'grasse', 5.5, 'majuscules', 3, 2,
    { contour: CONTOUR(4), ombre: null, fond: null }, 'aucune', 'pop', 'centre'),
  c('createur', 'Créateur', 'social', ['createur', 'creator', 'mot actif'],
    'Le mot prononcé s’allume au fil de la phrase.',
    'sans', 'grasse', 4.8, 'normale', 4, 2,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'mot-actif', 'aucune', 'centre-bas'),
  c('reels', 'Reels', 'social', ['reels', 'shorts', 'vertical', 'mot actif'],
    'Le mot prononcé passe sur un fond d’accent.',
    'sans', 'grasse', 5.0, 'majuscules', 3, 1,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'mot-actif-fond', 'aucune', 'centre'),
  c('format-court', 'Format court', 'social', ['court', 'rythme', 'montee'],
    'Deux mots à la fois, qui montent doucement.',
    'sans', 'grasse', 5.2, 'majuscules', 2, 1,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'aucune', 'montee', 'centre'),
  c('grande-caption', 'Grande caption', 'social', ['grand', 'impact', 'plein ecran'],
    'Très gros, très court, très lisible.',
    'sans', 'grasse', 6.5, 'majuscules', 2, 1,
    { contour: CONTOUR(5), ombre: null, fond: null }, 'aucune', 'aucune', 'centre'),
  c('encadre', 'Encadré', 'social', ['encadre', 'boite', 'fond'],
    'Le texte vit dans un pavé plein.',
    'sans', 'grasse', 4.5, 'normale', 4, 2,
    { contour: null, ombre: null, fond: FOND(0.75, 16) }, 'aucune', 'aucune', 'centre-bas'),
  c('caption-pop', 'Caption Pop', 'social', ['pop', 'rebond', 'mot actif', 'vif'],
    'Chaque bloc surgit, et le mot prononcé s’allume.',
    'sans', 'grasse', 5.0, 'majuscules', 3, 1,
    { contour: CONTOUR(4), ombre: null, fond: null }, 'mot-actif', 'pop', 'centre'),

  // ── MOT ACTIF ───────────────────────────────────────────────────────
  c('mot-actif', 'Mot actif', 'portrait', ['mot actif', 'accent', 'suivi'],
    'Tout est lisible ; le mot dit s’allume.',
    'sans', 'grasse', 4.6, 'normale', 5, 2,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'mot-actif', 'aucune', 'centre-bas'),
  c('mot-actif-doux', 'Mot actif doux', 'portrait', ['mot actif', 'doux', 'fondu'],
    'Le même, avec des blocs qui se fondent.',
    'sans', 'normale', 4.2, 'normale', 5, 2,
    { contour: CONTOUR(2), ombre: OMBRE(2, 0.5), fond: null },
    'mot-actif', 'fondu', 'centre-bas'),
  c('mot-actif-boite', 'Mot actif encadré', 'portrait', ['mot actif', 'boite', 'fond'],
    'Le mot dit passe sur un fond d’accent.',
    'sans', 'grasse', 4.6, 'normale', 4, 2,
    { contour: CONTOUR(2), ombre: null, fond: null },
    'mot-actif-fond', 'aucune', 'centre-bas'),
  c('mot-actif-bandeau', 'Mot actif sur bandeau', 'portrait',
    ['mot actif', 'bandeau', 'lisible'],
    'Un bandeau sombre, et le mot dit en accent.',
    'sans', 'grasse', 4.4, 'normale', 4, 2,
    { contour: null, ombre: null, fond: FOND(0.55, 12) },
    'mot-actif', 'aucune', 'centre-bas'),

  // ── KARAOKÉ ─────────────────────────────────────────────────────────
  c('karaoke', 'Karaoké', 'ambiance', ['karaoke', 'remplissage', 'progressif'],
    'La couleur remplit chaque mot pendant qu’il est dit.',
    'sans', 'grasse', 4.8, 'normale', 4, 2,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'karaoke', 'aucune', 'centre-bas'),
  c('karaoke-accent', 'Karaoké accent', 'ambiance', ['karaoke', 'accent', 'couleur'],
    'Le même, en majuscules et plus grand.',
    'sans', 'grasse', 5.4, 'majuscules', 3, 1,
    { contour: CONTOUR(4), ombre: null, fond: null }, 'karaoke', 'aucune', 'centre'),
  c('karaoke-doux', 'Karaoké doux', 'ambiance', ['karaoke', 'doux', 'fondu', 'lent'],
    'Un remplissage posé, sur des blocs qui se fondent.',
    'sans', 'normale', 4.2, 'normale', 6, 2,
    { contour: CONTOUR(2), ombre: OMBRE(2, 0.4), fond: null },
    'karaoke', 'fondu', 'centre-bas'),
  c('karaoke-bandeau', 'Karaoké sur bandeau', 'ambiance', ['karaoke', 'bandeau', 'lisible'],
    'Le remplissage, sur un fond qui protège la lecture.',
    'sans', 'grasse', 4.4, 'normale', 5, 2,
    { contour: null, ombre: null, fond: FOND(0.5, 12) }, 'karaoke', 'aucune', 'centre-bas'),

  // ── CINÉMA ──────────────────────────────────────────────────────────
  c('cinema', 'Cinéma', 'cinema', ['cinema', 'film', 'sobre', 'bas'],
    'Discret, en bas, comme au cinéma.',
    'sans', 'normale', 3.4, 'normale', 8, 2,
    { contour: CONTOUR(2), ombre: OMBRE(2), fond: null }, 'aucune', 'aucune', 'bas'),
  c('documentaire', 'Documentaire', 'cinema', ['documentaire', 'serif', 'pose'],
    'Un empattement calme, deux lignes.',
    'serif', 'normale', 3.4, 'normale', 8, 2,
    { contour: null, ombre: null, fond: FOND(0.4, 10) }, 'aucune', 'fondu', 'bas'),
  c('interview', 'Interview', 'cinema', ['interview', 'temoignage', 'lisible'],
    'Fait pour un visage qui parle longtemps.',
    'sans', 'normale', 3.6, 'normale', 7, 2,
    { contour: CONTOUR(2), ombre: OMBRE(3, 0.5), fond: null },
    'aucune', 'fondu', 'centre-bas'),
  c('sous-titre-film', 'Sous-titre film', 'cinema', ['film', 'classique', 'jaune'],
    'Le sous-titre de projection, en bas, sobre.',
    'sans', 'normale', 3.2, 'normale', 9, 2,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'aucune', 'aucune', 'bas'),
  c('elegant', 'Élégant', 'cinema', ['elegant', 'fin', 'espace', 'luxe'],
    'Fin, aéré, sans effet.',
    'serif', 'normale', 3.6, 'majuscules', 5, 1,
    { contour: null, ombre: OMBRE(2, 0.35), fond: null }, 'aucune', 'fondu', 'centre-bas'),

  // ── ÉNERGIE ─────────────────────────────────────────────────────────
  c('energie', 'Énergie', 'energie', ['energie', 'vif', 'mot actif', 'pop'],
    'Gros, gras, et le mot dit surgit.',
    'sans', 'grasse', 5.6, 'majuscules', 3, 1,
    { contour: CONTOUR(4), ombre: null, fond: null }, 'mot-actif', 'pop', 'centre'),
  c('fitness', 'Fitness', 'energie', ['fitness', 'sport', 'coach', 'mot actif'],
    'Le mot dit passe sur un pavé d’accent.',
    'sans', 'grasse', 5.2, 'majuscules', 3, 1,
    { contour: CONTOUR(3), ombre: null, fond: null },
    'mot-actif-fond', 'pop', 'centre'),
  c('puissance', 'Puissance', 'energie', ['puissance', 'massif', 'impact'],
    'Le plus massif du catalogue.',
    'sans', 'grasse', 7.0, 'majuscules', 2, 1,
    { contour: CONTOUR(6), ombre: null, fond: null }, 'aucune', 'pop', 'centre'),
  c('dynamique', 'Dynamique', 'energie', ['dynamique', 'rythme', 'montee'],
    'Des blocs courts qui montent au rythme de la parole.',
    'sans', 'grasse', 4.8, 'majuscules', 3, 1,
    { contour: CONTOUR(3), ombre: null, fond: null }, 'mot-actif', 'montee', 'centre-bas'),
  c('challenge', 'Challenge', 'energie', ['challenge', 'karaoke', 'defi'],
    'Un remplissage rapide, en majuscules.',
    'sans', 'grasse', 5.0, 'majuscules', 3, 1,
    { contour: CONTOUR(4), ombre: null, fond: null }, 'karaoke', 'aucune', 'centre'),
];

export const CAPTION_IDS: readonly string[] = STYLES_CAPTION.map((x) => x.id);
export const STYLE_CAPTION_DEFAUT = STYLES_CAPTION[0];

export function styleCaptionParId(id: unknown): StyleCaption | null {
  if (typeof id !== 'string') return null;
  return STYLES_CAPTION.find((x) => x.id === id) ?? null;
}

/** La signature visuelle d'un style — ce qui le rend reconnaissable. */
export function signatureVisuelle(s: StyleCaption): string {
  return [
    s.police, s.graisse, s.taillePct.toFixed(1), s.casse,
    String(s.motsParBloc), String(s.lignesMax),
    s.habillage.contour ? `c${s.habillage.contour.largeur}${s.habillage.contour.teinte}` : 'c0',
    s.habillage.ombre ? `o${s.habillage.ombre.decalage}` : 'o0',
    s.habillage.fond ? `f${s.habillage.fond.opacite}${s.habillage.fond.marge}` : 'f0',
    s.surbrillance, s.apparition, s.position,
  ].join('|');
}
