/**
 * A_3b — LA BIBLIOTHÈQUE DE STYLES DE TEXTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN STYLE N'EST PAS UNE POLICE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « Sans serif » est une police. « Bold Social » est une DÉCISION COMPLÈTE :
 * la police, sa graisse, sa taille relative, la casse, le contour, l'ombre,
 * le fond. C'est ce qu'une personne choisit quand elle dit « je veux que ça
 * ressemble à ça » — et c'est ce qu'elle ne veut pas reconstruire réglage
 * par réglage à chaque vidéo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CHAQUE CHAMP EST UNE OPTION RÉELLE DE `drawtext`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rien n'est décoratif ici. `borderw` + `bordercolor` font le contour,
 * `box` + `boxcolor` + `boxborderw` font le fond, `shadowx/y` +
 * `shadowcolor` font l'ombre, `fontsize` la taille, `fontfile` la police et
 * sa graisse. La casse est appliquée au TEXTE avant écriture du fichier.
 *
 * Un style qui promettrait un dégradé, une bordure arrondie ou une rotation
 * serait une carte morte : `drawtext` ne les produit pas, et l'écart ne se
 * découvrirait qu'à l'ouverture du MP4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA COULEUR RESTE CELLE DE LA MARQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun style n'impose la couleur du texte : elle vient du profil, comme
 * avant. Un catalogue qui repeindrait le texte à chaque changement de style
 * ferait perdre son identité au compte pour un choix de forme — et
 * obligerait à re-régler la couleur après chaque essai.
 *
 * Contours et fonds, eux, sont noirs ou blancs : ce sont des aides à la
 * LISIBILITÉ, pas des couleurs de marque.
 */
import type { EntreeCreative } from './catalogue-contrat';
import type { PoliceRendu } from '@/lib/autopilot/analyse/rendu-texte';

/** La version du rendu des styles. Change quand leur résultat change. */
export const VERSION_STYLES_TEXTE = 'style-texte-v1';

/** Le noir ou le blanc — les deux seules teintes d'aide à la lecture. */
export type TeinteAide = 'noir' | 'blanc';

export interface StyleTexteCreatif extends EntreeCreative {
  famille: 'style-texte';
  police: PoliceRendu;
  graisse: 'normale' | 'grasse';
  /** `majuscules` transforme le TEXTE, pas seulement son apparence. */
  casse: 'normale' | 'majuscules';
  /** Multiplie la taille de base de chaque nature. Entre 0,7 et 1,6. */
  echelle: number;
  /** `borderw` + `bordercolor`. `null` : aucun contour. */
  contour: { largeur: number; teinte: TeinteAide } | null;
  /** `shadowx/y` + `shadowcolor`. `null` : aucune ombre. */
  ombre: { decalage: number; opacite: number; teinte: TeinteAide } | null;
  /** `box` + `boxcolor` + `boxborderw`. `null` : aucun fond. */
  fond: { opacite: number; marge: number; teinte: TeinteAide } | null;
}

const s = (
  id: string, nom: string, categorie: EntreeCreative['categorie'],
  tags: string[], description: string,
  reglages: Omit<StyleTexteCreatif,
    'id' | 'nom' | 'famille' | 'categorie' | 'tags' | 'description' | 'rendu' | 'version'>,
): StyleTexteCreatif => ({
  id, nom, famille: 'style-texte', categorie, tags, description,
  rendu: true, version: VERSION_STYLES_TEXTE, ...reglages,
});

/** L'ombre historique : celle que le rendu applique depuis A_1. */
const OMBRE_DOUCE = { decalage: 2, opacite: 0.65, teinte: 'noir' as const };

export const STYLES_TEXTE: readonly StyleTexteCreatif[] = [
  // ── SOBRE ───────────────────────────────────────────────────────────
  /* ⚠️ `defaut` REPRODUIT EXACTEMENT LE RENDU D'AVANT CE LOT. C'est ce qui
     permet de livrer une bibliothèque sans changer une seule vidéo
     existante : un compte qui n'a jamais choisi de style garde le sien. */
  s('defaut', 'Standard', 'sobre', ['neutre', 'simple', 'defaut'],
    'Le rendu par défaut : lisible, sans effet.',
    { police: 'sans', graisse: 'grasse', casse: 'normale', echelle: 1,
      contour: null, ombre: OMBRE_DOUCE, fond: null }),
  s('minimal-blanc', 'Minimal blanc', 'sobre', ['epure', 'fin', 'clair'],
    'Léger, sans ombre appuyée.',
    { police: 'sans', graisse: 'normale', casse: 'normale', echelle: 0.9,
      contour: null, ombre: { decalage: 1, opacite: 0.4, teinte: 'noir' }, fond: null }),
  s('editorial', 'Éditorial', 'sobre', ['magazine', 'serif', 'sobre'],
    'Serif fin, esprit magazine.',
    { police: 'serif', graisse: 'normale', casse: 'normale', echelle: 0.95,
      contour: null, ombre: { decalage: 1, opacite: 0.45, teinte: 'noir' }, fond: null }),
  s('machine', 'Machine', 'sobre', ['mono', 'technique', 'code'],
    'Chasse fixe, rendu technique.',
    { police: 'mono', graisse: 'normale', casse: 'normale', echelle: 0.85,
      contour: null, ombre: OMBRE_DOUCE, fond: null }),
  s('contour-fin', 'Contour fin', 'sobre', ['lisible', 'contour', 'net'],
    'Un liseré noir pour tenir sur toute image.',
    { police: 'sans', graisse: 'grasse', casse: 'normale', echelle: 1,
      contour: { largeur: 2, teinte: 'noir' }, ombre: null, fond: null }),

  // ── SOCIAL ──────────────────────────────────────────────────────────
  s('bold-social', 'Bold Social', 'social', ['gras', 'impact', 'reel'],
    'Gras et large, pour les formats courts.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.2,
      contour: { largeur: 3, teinte: 'noir' }, ombre: null, fond: null }),
  s('creator', 'Créateur', 'social', ['reel', 'short', 'moderne'],
    'Gras, contour léger, très lisible.',
    { police: 'sans', graisse: 'grasse', casse: 'normale', echelle: 1.1,
      contour: { largeur: 2, teinte: 'noir' }, ombre: OMBRE_DOUCE, fond: null }),
  s('boxed', 'Encadré', 'social', ['fond', 'bandeau', 'lisible'],
    'Texte sur un fond plein : lisible sur tout.',
    { police: 'sans', graisse: 'grasse', casse: 'normale', echelle: 1,
      contour: null, ombre: null, fond: { opacite: 0.7, marge: 12, teinte: 'noir' } }),
  s('caption', 'Sous-titre social', 'social', ['legende', 'bas', 'fond'],
    'Petit, sur bandeau : le format légende.',
    { police: 'sans', graisse: 'grasse', casse: 'normale', echelle: 0.8,
      contour: null, ombre: null, fond: { opacite: 0.6, marge: 10, teinte: 'noir' } }),
  s('highlight', 'Surligné', 'social', ['fond', 'clair', 'accent'],
    'Fond clair, texte qui ressort.',
    { police: 'sans', graisse: 'grasse', casse: 'normale', echelle: 1,
      contour: null, ombre: null, fond: { opacite: 0.85, marge: 10, teinte: 'blanc' } }),
  s('statement', 'Grande affirmation', 'social', ['gros', 'titre', 'impact'],
    'Très grand : une phrase, plein écran.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.5,
      contour: { largeur: 4, teinte: 'noir' }, ombre: null, fond: null }),
  s('heavy', 'Massif', 'social', ['gras', 'dense', 'lourd'],
    'Épais, sans fioriture.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.3,
      contour: null, ombre: { decalage: 3, opacite: 0.8, teinte: 'noir' }, fond: null }),

  // ── CINEMA ──────────────────────────────────────────────────────────
  s('titre-cinema', 'Titre cinéma', 'cinema', ['film', 'titre', 'large'],
    'Capitales espacées, esprit générique.',
    { police: 'serif', graisse: 'grasse', casse: 'majuscules', echelle: 1.15,
      contour: null, ombre: { decalage: 2, opacite: 0.5, teinte: 'noir' }, fond: null }),
  s('sous-titre-film', 'Sous-titre film', 'cinema', ['film', 'bas', 'discret'],
    'Discret, comme un sous-titre de salle.',
    { police: 'sans', graisse: 'normale', casse: 'normale', echelle: 0.8,
      contour: { largeur: 1, teinte: 'noir' }, ombre: null, fond: null }),
  s('documentaire', 'Documentaire', 'cinema', ['reportage', 'sobre', 'serif'],
    'Serif sobre, ton de reportage.',
    { police: 'serif', graisse: 'normale', casse: 'normale', echelle: 0.9,
      contour: null, ombre: { decalage: 1, opacite: 0.5, teinte: 'noir' }, fond: null }),
  s('elegant', 'Élégant', 'cinema', ['luxe', 'fin', 'serif'],
    'Serif fin en capitales, rendu haut de gamme.',
    { police: 'serif', graisse: 'normale', casse: 'majuscules', echelle: 1,
      contour: null, ombre: { decalage: 1, opacite: 0.35, teinte: 'noir' }, fond: null }),
  s('noir-blanc', 'Bandeau noir', 'cinema', ['fond', 'noir', 'carton'],
    'Carton plein, façon intertitre.',
    { police: 'serif', graisse: 'grasse', casse: 'majuscules', echelle: 1.05,
      contour: null, ombre: null, fond: { opacite: 0.9, marge: 16, teinte: 'noir' } }),

  // ── ENERGIE ─────────────────────────────────────────────────────────
  s('energie', 'Énergie', 'energie', ['sport', 'gras', 'dynamique'],
    'Capitales épaisses, contour marqué.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.25,
      contour: { largeur: 4, teinte: 'noir' }, ombre: null, fond: null }),
  s('puissance', 'Puissance', 'energie', ['sport', 'lourd', 'dense'],
    'Massif, ombre dure.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.35,
      contour: null, ombre: { decalage: 4, opacite: 0.85, teinte: 'noir' }, fond: null }),
  s('sport', 'Sport', 'energie', ['sport', 'net', 'contour'],
    'Contour blanc : tient sur fond sombre.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.15,
      contour: { largeur: 3, teinte: 'blanc' }, ombre: null, fond: null }),
  s('challenge', 'Challenge', 'energie', ['defi', 'mono', 'gras'],
    'Chasse fixe en capitales, ton défi.',
    { police: 'mono', graisse: 'grasse', casse: 'majuscules', echelle: 1.05,
      contour: { largeur: 2, teinte: 'noir' }, ombre: null, fond: null }),

  // ── PORTRAIT ────────────────────────────────────────────────────────
  s('portrait-doux', 'Portrait doux', 'portrait', ['visage', 'fin', 'discret'],
    'Fin et discret, ne mange pas le visage.',
    { police: 'sans', graisse: 'normale', casse: 'normale', echelle: 0.85,
      contour: null, ombre: { decalage: 1, opacite: 0.4, teinte: 'noir' }, fond: null }),
  s('temoignage', 'Témoignage', 'portrait', ['parole', 'legende', 'fond'],
    'Bandeau bas, pour une parole rapportée.',
    { police: 'serif', graisse: 'normale', casse: 'normale', echelle: 0.85,
      contour: null, ombre: null, fond: { opacite: 0.55, marge: 12, teinte: 'noir' } }),

  // ── AMBIANCE ────────────────────────────────────────────────────────
  s('promo', 'Promo', 'ambiance', ['offre', 'vente', 'fond'],
    'Fond clair et capitales : une offre se voit.',
    { police: 'sans', graisse: 'grasse', casse: 'majuscules', echelle: 1.1,
      contour: null, ombre: null, fond: { opacite: 0.9, marge: 14, teinte: 'blanc' } }),
  s('evenement', 'Événement', 'ambiance', ['date', 'affiche', 'large'],
    'Capitales larges, esprit affiche.',
    { police: 'serif', graisse: 'grasse', casse: 'majuscules', echelle: 1.2,
      contour: { largeur: 2, teinte: 'noir' }, ombre: null, fond: null }),
  s('retro', 'Rétro', 'ambiance', ['ancien', 'mono', 'annees'],
    'Chasse fixe et contour : rendu daté, volontairement.',
    { police: 'mono', graisse: 'grasse', casse: 'normale', echelle: 1,
      contour: { largeur: 2, teinte: 'blanc' }, ombre: null, fond: null }),
];

export const STYLE_TEXTE_IDS: readonly string[] = STYLES_TEXTE.map((x) => x.id);

/** Le style par défaut : celui qui reproduit le rendu d'avant A_3b. */
export const STYLE_TEXTE_DEFAUT = STYLES_TEXTE[0];

export function styleTexteParId(id: unknown): StyleTexteCreatif {
  if (typeof id !== 'string') return STYLE_TEXTE_DEFAUT;
  return STYLES_TEXTE.find((x) => x.id === id) ?? STYLE_TEXTE_DEFAUT;
}
