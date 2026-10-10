/**
 * Catalogue des TARIFS Studiio — clés techniques stables, valeurs de repli.
 *
 * ⚠️ UNE SOURCE DE VÉRITÉ. Écrans et routes lisent les mêmes prix : les
 * routes via `lib/tarifs/serveur` (configuration admin, cache court), les
 * écrans via `GET /api/tarifs`. Ce module est PUR (aucune dépendance
 * serveur) : les composants client en importent les libellés et les
 * valeurs de repli.
 *
 * ⚠️ LE REPLI N'EST JAMAIS GRATUIT. `defaut` = le prix codé AVANT la
 * configuration admin, sans aucune modification économique : si la
 * configuration est illisible, on facture ce prix-là, jamais 0.
 *
 * ⚠️ LE TEXTE AFFICHÉ N'EST PAS UN IDENTIFIANT. Seule `cle` est stockée.
 */

export const CLES_TARIF = [
  'audio.full_1000_chars',
  'render.reel',
  'render.tv',
  'render.infographic',
  'avatar.avatar_iii',
  'avatar.avatar_iv',
  'avatar.avatar_v',
  'avatar.jumeau',
  'ai.remove_background',
  'ai.magic_eraser',
  'ai.magic_edit',
  'ai.upscale',
  'ai.image_to_video',
  'ai.generate_background',
  'ai.magic_layers',
  'ai.style_transfer',
  'ai.ocr',
  'autopilot.poster_reference',
] as const;

export type CleTarif = (typeof CLES_TARIF)[number];
export type CategorieTarif = 'audio' | 'video' | 'avatar' | 'ia' | 'autres';

export interface EntreeCatalogue {
  cle: CleTarif;
  categorie: CategorieTarif;
  libelle: string;
  unite: string;
  /** Prix codé avant la configuration admin — le repli sûr. */
  defaut: number;
  /** Prix proposé par la direction, appliqué seulement quand l'admin l'enregistre. */
  propose?: number;
  aide?: string;
}

/** Au-delà, une faute de frappe (400 au lieu de 40). */
export const TARIF_MAX = 10_000;

export const CATALOGUE_TARIFS: readonly EntreeCatalogue[] = [
  { cle: 'audio.full_1000_chars', categorie: 'audio', libelle: 'Audio complet', unite: 'crédit(s) / 1000 caractères', defaut: 1, aide: 'La pré-écoute (≈ 5 s) reste gratuite.' },
  { cle: 'render.reel', categorie: 'video', libelle: 'Reel (9:16)', unite: 'crédits / rendu', defaut: 10 },
  { cle: 'render.tv', categorie: 'video', libelle: 'TV (16:9)', unite: 'crédits / rendu', defaut: 15 },
  { cle: 'render.infographic', categorie: 'video', libelle: 'Rendu infographique', unite: 'crédits / rendu', defaut: 25 },
  { cle: 'avatar.avatar_iii', categorie: 'avatar', libelle: 'Standard — Avatar III', unite: 'crédits / génération', defaut: 40, propose: 10 },
  { cle: 'avatar.avatar_iv', categorie: 'avatar', libelle: 'Qualité — Avatar IV', unite: 'crédits / génération', defaut: 40, propose: 25 },
  { cle: 'avatar.avatar_v', categorie: 'avatar', libelle: 'Premium — Avatar V', unite: 'crédits / génération', defaut: 40, propose: 40 },
  { cle: 'avatar.jumeau', categorie: 'avatar', libelle: 'Jumeau (Créer / Autopilote)', unite: 'crédits / génération', defaut: 40 },
  { cle: 'ai.remove_background', categorie: 'ia', libelle: 'Suppression arrière-plan', unite: 'crédits / image', defaut: 2 },
  { cle: 'ai.magic_eraser', categorie: 'ia', libelle: 'Gomme magique', unite: 'crédits / image', defaut: 3 },
  { cle: 'ai.magic_edit', categorie: 'ia', libelle: 'Édition magique', unite: 'crédits / image', defaut: 5 },
  { cle: 'ai.upscale', categorie: 'ia', libelle: 'Upscale', unite: 'crédits / image', defaut: 3 },
  { cle: 'ai.image_to_video', categorie: 'ia', libelle: 'Image vers vidéo', unite: 'crédits / vidéo', defaut: 15 },
  { cle: 'ai.generate_background', categorie: 'ia', libelle: 'Génération arrière-plan / affiche', unite: 'crédits / image', defaut: 5 },
  { cle: 'ai.magic_layers', categorie: 'ia', libelle: 'Calques magiques', unite: 'crédits / image', defaut: 3 },
  { cle: 'ai.style_transfer', categorie: 'ia', libelle: 'Transfert de style', unite: 'crédits / image', defaut: 5 },
  { cle: 'ai.ocr', categorie: 'ia', libelle: 'OCR (capture de texte)', unite: 'crédits / image', defaut: 1 },
  { cle: 'autopilot.poster_reference', categorie: 'autres', libelle: 'Affiche de référence Autopilote', unite: 'crédits / affiche', defaut: 5 },
];

export const LIBELLE_CATEGORIE: Record<CategorieTarif, string> = {
  audio: 'Audio', video: 'Vidéo', avatar: 'Avatar', ia: 'IA image', autres: 'Autres',
};

export type GrilleTarifs = Record<CleTarif, number>;

export const TARIFS_DEFAUT: GrilleTarifs = Object.fromEntries(
  CATALOGUE_TARIFS.map((e) => [e.cle, e.defaut]),
) as GrilleTarifs;

export function estCleTarif(v: unknown): v is CleTarif {
  return typeof v === 'string' && (CLES_TARIF as readonly string[]).includes(v);
}

export function tarifValide(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= TARIF_MAX;
}

/**
 * Grille complète à partir d'une valeur stockée quelconque : chaque clé
 * absente ou invalide reprend son repli (jamais 0 par accident).
 */
export function normaliserGrille(brut: unknown): GrilleTarifs {
  const out = { ...TARIFS_DEFAUT };
  if (brut && typeof brut === 'object' && !Array.isArray(brut)) {
    for (const [k, v] of Object.entries(brut as Record<string, unknown>)) {
      if (estCleTarif(k) && tarifValide(v)) out[k] = v;
    }
  }
  return out;
}

/** Action de `/api/ai/image` → clé tarifaire. */
export const CLE_ACTION_IA: Record<string, CleTarif> = {
  'remove-bg': 'ai.remove_background',
  'magic-eraser': 'ai.magic_eraser',
  'magic-edit': 'ai.magic_edit',
  'upscale': 'ai.upscale',
  'image-to-video': 'ai.image_to_video',
  'generate-bg': 'ai.generate_background',
  'magic-layers': 'ai.magic_layers',
  'style-transfer': 'ai.style_transfer',
  'ocr': 'ai.ocr',
};

/** Moteur HeyGen → clé tarifaire. */
export const CLE_MOTEUR_AVATAR: Record<'avatar_iii' | 'avatar_iv' | 'avatar_v', CleTarif> = {
  avatar_iii: 'avatar.avatar_iii',
  avatar_iv: 'avatar.avatar_iv',
  avatar_v: 'avatar.avatar_v',
};

/** Coût fournisseur ESTIMÉ, saisi à la main — informatif, ne modifie jamais un prix. */
export interface CoutFournisseur {
  chf: number;
  unite: string;
}

export const TARIFS_GRATUITS = [
  { libelle: 'Pexels — recherche et sélection stock', prix: 'Gratuit' },
  { libelle: 'Unsplash — recherche et sélection stock', prix: 'Gratuit' },
  { libelle: 'Pré-écoute voix (≈ 5 s)', prix: 'Gratuit' },
] as const;
