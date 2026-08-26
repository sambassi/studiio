/**
 * `metadataPourEnregistrement` — l'état du parcours guidé -> ce qu'on envoie au
 * serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, ET LE PIÈGE QU'ELLE FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `mergePostMetadata` fusionne au niveau des CLÉS DE PREMIER NIVEAU : une clé
 * envoyée remplace l'existante ENTIÈREMENT. Envoyer un `design` réduit aux
 * champs que le parcours guidé règle effacerait donc `design.siteText` (le
 * filigrane), `design.font`, `design.sizes` — tout ce que l'éditeur avancé a pu
 * y écrire. La perte serait silencieuse, et la colonne `jsonb` n'a pas
 * d'historique.
 *
 * D'où les deux règles de ce module :
 *
 *   1. LES OBJETS IMBRIQUÉS SONT RECOMPOSÉS À PARTIR DE L'EXISTANT
 *      (`design`, `branding`), jamais reconstruits de zéro.
 *
 *   2. CE QU'ON NE SAIT PAS N'EST PAS ENVOYÉ. Une clé absente de l'envoi garde
 *      sa valeur en base — c'est ce que garantit la fusion. Un `undefined` du
 *      wizard signifie « je n'en porte pas », jamais « supprimez-la » : un rush
 *      téléversé depuis l'éditeur avancé ne doit pas disparaître parce que le
 *      parcours guidé ne l'affiche pas.
 *
 * Le montage déjà rendu (`renderedVideoUrl`, `thumbnailUrl`, `composerVersion`)
 * n'est JAMAIS touché : modifier des textes ne produit pas une nouvelle vidéo,
 * et y toucher ferait pointer le post vers un fichier qui ne lui correspond pas.
 *
 * Ce module ne fait aucun appel réseau, ne déclenche aucun rendu et ne modifie
 * pas ses arguments.
 */

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const copier = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Pose la clé seulement si la valeur existe. `null` compte comme une valeur. */
function poserSiConnu(cible: Record<string, unknown>, cle: string, valeur: unknown): void {
  if (valeur !== undefined) cible[cle] = copier(valeur);
}

/** Ce que le parcours guidé sait produire sans rendre de vidéo. */
export interface ValeursWizard {
  subtitle?: string;
  theme?: string;
  cards?: unknown[];
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  textAnimation?: string;
  gradientColor1?: string;
  gradientColor2?: string;
  gradientOpacity?: number;
  titlePos?: { x: number; y: number };
  ctaPos?: { x: number; y: number };
  elements?: unknown[];
  sequences?: Record<string, unknown>;
  videoSize?: { w: number; h: number };
  posterUrl?: string;
  musicUrl?: string;
  voiceUrl?: string;
  musicVolume?: number;
  voiceVolume?: number;
  sequenceVoiceUrls?: Record<string, string>;
  rushUrls?: string[];
  audioKeyframes?: unknown;
  cardGroups?: unknown[];
  hasAudio?: boolean;
}

/**
 * Compose la metadata à envoyer.
 *
 * @param existante  la metadata telle qu'elle est en base (celle du post chargé)
 * @param valeurs    ce que le wizard porte à l'écran maintenant
 */
export function metadataPourEnregistrement(
  existante: unknown,
  valeurs: ValeursWizard,
): Record<string, unknown> {
  const base = estObjet(existante) ? existante : {};
  const envoi: Record<string, unknown> = {};

  // ── Champs simples ──────────────────────────────────────────────────
  poserSiConnu(envoi, 'subtitle', valeurs.subtitle);
  poserSiConnu(envoi, 'theme', valeurs.theme);
  poserSiConnu(envoi, 'cards', valeurs.cards);
  poserSiConnu(envoi, 'videoSize', valeurs.videoSize);
  poserSiConnu(envoi, 'posterUrl', valeurs.posterUrl);
  poserSiConnu(envoi, 'musicUrl', valeurs.musicUrl);
  poserSiConnu(envoi, 'voiceUrl', valeurs.voiceUrl);
  poserSiConnu(envoi, 'musicVolume', valeurs.musicVolume);
  poserSiConnu(envoi, 'voiceVolume', valeurs.voiceVolume);
  poserSiConnu(envoi, 'sequenceVoiceUrls', valeurs.sequenceVoiceUrls);
  poserSiConnu(envoi, 'rushUrls', valeurs.rushUrls);
  poserSiConnu(envoi, 'audioKeyframes', valeurs.audioKeyframes);
  poserSiConnu(envoi, 'cardGroups', valeurs.cardGroups);
  poserSiConnu(envoi, 'hasAudio', valeurs.hasAudio);
  poserSiConnu(envoi, 'sequences', valeurs.sequences);

  // ── `branding` : recomposé SUR l'existant ───────────────────────────
  const brandingBase = estObjet(base.branding) ? copier(base.branding) : {};
  const branding: Record<string, unknown> = { ...brandingBase };
  poserSiConnu(branding, 'accentColor', valeurs.accentColor);
  poserSiConnu(branding, 'ctaText', valeurs.ctaText);
  poserSiConnu(branding, 'ctaSubText', valeurs.ctaSubText);
  // Le filigrane suit le CTA, comme a la creation : les deux portent le meme
  // texte, et les desynchroniser ferait afficher un filigrane que
  // l'utilisateur n'a jamais choisi.
  poserSiConnu(branding, 'watermarkText', valeurs.ctaText);
  if (Object.keys(branding).length > 0) envoi.branding = branding;

  // ── `design` : recomposé SUR l'existant ─────────────────────────────
  const designBase = estObjet(base.design) ? copier(base.design) : {};
  const design: Record<string, unknown> = { ...designBase };
  poserSiConnu(design, 'textAnimation', valeurs.textAnimation);
  poserSiConnu(design, 'gradientColor1', valeurs.gradientColor1);
  poserSiConnu(design, 'gradientColor2', valeurs.gradientColor2);
  poserSiConnu(design, 'gradientOpacity', valeurs.gradientOpacity);
  poserSiConnu(design, 'ctaMainText', valeurs.ctaText);
  poserSiConnu(design, 'ctaSubText', valeurs.ctaSubText);

  // `positions` est lui-meme imbrique : meme regle, un cran plus bas. Ecraser
  // l'objet entier perdrait une cle que seul l'editeur avance y met.
  const positionsBase = estObjet(designBase.positions) ? copier(designBase.positions) : {};
  const positions: Record<string, unknown> = { ...positionsBase };
  poserSiConnu(positions, 'title', valeurs.titlePos);
  // Le wizard nomme `ctaPos` ce que la metadata range sous `watermark`.
  poserSiConnu(positions, 'watermark', valeurs.ctaPos);
  poserSiConnu(positions, 'elements', valeurs.elements);
  if (Object.keys(positions).length > 0) design.positions = positions;

  if (Object.keys(design).length > 0) envoi.design = design;

  return envoi;
}
