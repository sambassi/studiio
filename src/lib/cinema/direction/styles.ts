/**
 * CINEMA IA — LES SIX STYLES CINEMATIQUES.
 *
 * Un style est une DIRECTION ARTISTIQUE de la lumiere, de la couleur, de l'ambiance et de
 * la texture de l'image. Il n'est ni un sujet, ni un lieu, ni un personnage : choisir un
 * style ne change jamais ce qui est dit ou montre, seulement la facon de le filmer. C'est
 * ce que `composerPrompt` rappelle au modele a chaque generation.
 *
 * Chaque style a cinq descripteurs ANGLAIS (ce que recoit le modele) et leur resume
 * FRANCAIS (ce que lit l'utilisateur) : profil artistique, eclairage, palette, ambiance,
 * texture. Ils sont volontairement distincts d'un style a l'autre : un test verifie
 * qu'aucun descripteur n'est partage.
 *
 * Les miniatures (`public/cinema-styles/*.svg`) sont des illustrations DESSINEES de
 * reference — jamais des resultats generes par une IA, et l'ecran le dit.
 */
import type { IdStyleCinema } from '@/lib/cinema/types';

export interface StyleCinema {
  id: IdStyleCinema;
  libelle: string;
  /** Nom court ANGLAIS, pour les prompts. */
  nomEn: string;
  /** Une phrase pour la carte. */
  resume: string;
  /** Detail affiche a la demande (icone d'information). */
  detail: { eclairage: string; palette: string; ambiance: string; texture: string };
  /** Miniature statique du depot, jamais une image generee. */
  miniature: string;
  /** Ce qui est ENVOYE au modele (anglais). */
  prompt: { profil: string; eclairage: string; palette: string; ambiance: string; texture: string };
}

export const STYLES_CINEMA: readonly StyleCinema[] = [
  {
    id: 'realiste',
    nomEn: 'realistic cinema',
    libelle: 'Cinéma réaliste',
    resume: 'Naturel et crédible, comme un film tourné en décor réel.',
    detail: {
      eclairage: 'lumière naturelle justifiée, douce et équilibrée',
      palette: 'couleurs fidèles à la réalité, teintes de peau naturelles',
      ambiance: 'ancrée, authentique, sans artifice',
      texture: 'grain fin de pellicule 35 mm, faible profondeur de champ',
    },
    miniature: '/cinema-styles/realiste.svg',
    prompt: {
      profil: 'naturalistic photographic cinematography, shot on 35mm film, true-to-life realism',
      eclairage: 'soft motivated natural light, balanced exposure, gentle shadows',
      palette: 'natural true-to-life colors, realistic skin tones, restrained saturation',
      ambiance: 'grounded, authentic and believable, no stylization',
      texture: 'fine 35mm film grain, shallow depth of field, natural lens rendering',
    },
  },
  {
    id: 'noir',
    nomEn: 'film noir',
    libelle: 'Film noir',
    resume: 'Contrastes durs, ombres profondes, tension nocturne.',
    detail: {
      eclairage: 'faible clé dure, ombres de stores vénitiens, une seule source franche',
      palette: 'noir et blanc très contrasté, léger voile bleu acier',
      ambiance: 'tendue, nocturne, urbaine, fumée dans l’air',
      texture: 'grain épais, noirs profonds, contraste net',
    },
    miniature: '/cinema-styles/noir.svg',
    prompt: {
      profil: 'classic film noir cinematography, expressionist black-and-white crime drama look',
      eclairage: 'hard low-key lighting from a single source, venetian blind shadows, deep pools of darkness',
      palette: 'near-monochrome black, white and grey with a faint cold steel-blue tint, desaturated',
      ambiance: 'tense, moody, nocturnal urban mystery with drifting cigarette smoke',
      texture: 'heavy visible film grain, crushed blacks, crisp high contrast',
    },
  },
  {
    id: 'publicite',
    nomEn: 'premium advertising',
    libelle: 'Publicité premium',
    resume: 'Image léchée, produit mis en valeur, finition haut de gamme.',
    detail: {
      eclairage: 'lumière de studio douce et brillante, contre-jour de bord, hautes lumières propres',
      palette: 'fond sobre, une couleur d’accent riche et saturée',
      ambiance: 'désirable, raffinée, minimaliste',
      texture: 'ultra nette, reflets brillants, aucun grain',
    },
    miniature: '/cinema-styles/publicite.svg',
    prompt: {
      profil: 'premium commercial advertising cinematography, polished high-end campaign look',
      eclairage: 'soft glossy studio lighting with crisp rim light and clean specular highlights',
      palette: 'clean neutral backdrop with one rich saturated accent color, controlled color grade',
      ambiance: 'aspirational, refined, minimal and desirable',
      texture: 'ultra-sharp clean image, glossy reflections, zero grain',
    },
  },
  {
    id: 'romantique',
    nomEn: 'romantic cinema',
    libelle: 'Romantique',
    resume: 'Lumière dorée, douceur, intimité.',
    detail: {
      eclairage: 'contre-jour chaud et diffus, heure dorée, halo lumineux',
      palette: 'ambre, pêche, rose poudré, crème',
      ambiance: 'tendre, intime, rêveuse',
      texture: 'flou doux lumineux, halation légère, grain discret',
    },
    miniature: '/cinema-styles/romantique.svg',
    prompt: {
      profil: 'romantic cinema cinematography, tender golden-hour love story look',
      eclairage: 'warm soft diffused backlight, glowing golden hour sun, gentle lens bloom',
      palette: 'warm amber, peach, dusty rose and soft cream tones',
      ambiance: 'tender, intimate, dreamy and affectionate',
      texture: 'soft luminous glow, subtle halation around highlights, delicate fine grain',
    },
  },
  {
    id: 'documentaire',
    nomEn: 'documentary',
    libelle: 'Documentaire',
    resume: 'Sur le vif, lumière disponible, vérité du moment.',
    detail: {
      eclairage: 'lumière disponible, non contrôlée, réaliste',
      palette: 'neutre, légèrement désaturée, authentique',
      ambiance: 'spontanée, immédiate, véridique',
      texture: 'imperfections naturelles, grain réel, grande profondeur de champ',
    },
    miniature: '/cinema-styles/documentaire.svg',
    prompt: {
      profil: 'observational documentary cinematography, candid reportage footage look',
      eclairage: 'available ambient light only, uncontrolled and realistic, mixed color temperatures',
      palette: 'neutral slightly desaturated colors, honest and unpolished',
      ambiance: 'candid, spontaneous, immediate and truthful',
      texture: 'natural imperfections, real-world grain, deep focus with slight sensor noise',
    },
  },
  {
    id: 'scifi',
    nomEn: 'science fiction',
    libelle: 'Science-fiction',
    resume: 'Néons froids, brume lumineuse, futur technologique.',
    detail: {
      eclairage: 'néons froids, lumière volumétrique, sources lumineuses visibles dans le décor',
      palette: 'turquoise et cyan, accents magenta ou orange, ombres bleu profond',
      ambiance: 'futuriste, vaste, technologique',
      texture: 'netteté numérique propre, reflets d’objectif anamorphiques discrets',
    },
    miniature: '/cinema-styles/scifi.svg',
    prompt: {
      profil: 'futuristic science fiction cinematography, sleek cyberpunk-tinged sci-fi epic look',
      eclairage: 'cool neon and volumetric light shafts, glowing practical lights, atmospheric haze',
      palette: 'teal and cyan with magenta or orange accents, deep blue shadows',
      ambiance: 'futuristic, vast, technological and otherworldly',
      texture: 'clean digital sharpness, subtle anamorphic lens flares, crisp specular glints',
    },
  },
];

export const IDS_STYLES: readonly IdStyleCinema[] = STYLES_CINEMA.map((s) => s.id);

export function estStyleCinema(v: unknown): v is IdStyleCinema {
  return typeof v === 'string' && (IDS_STYLES as readonly string[]).includes(v);
}

export function styleCinema(id: IdStyleCinema | null | undefined): StyleCinema | null {
  return id ? STYLES_CINEMA.find((s) => s.id === id) ?? null : null;
}

/**
 * Le style EFFECTIF d'une scene : son exception, sinon le style du film, sinon aucun.
 * Un identifiant inconnu (donnee alteree) vaut « aucun » — jamais un style devine.
 */
export function styleEffectif(
  film: { styleCinema?: IdStyleCinema },
  scene: { styleCinema?: IdStyleCinema } | null | undefined,
): StyleCinema | null {
  return styleCinema(estStyleCinema(scene?.styleCinema) ? scene!.styleCinema : estStyleCinema(film.styleCinema) ? film.styleCinema : null);
}
