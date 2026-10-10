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
 *   3. PROVENANCE : une valeur lue dans une clé n'est réécrite QUE dans cette
 *      clé. Aucune synchronisation entre deux clés au prétexte qu'elles
 *      porteraient « la même information ».
 *
 *   4. SEUL CE QUE L'UTILISATEUR A CHANGÉ PART. L'appelant fournit ce que
 *      l'écran portait AU CHARGEMENT ; tout ce qui n'a pas bougé depuis est
 *      omis. Ouvrir puis enregistrer sans rien toucher n'écrit donc rien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES DEUX CTA S'ÉCRIVENT DANS LEUR PROVENANCE — ET VOICI POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les producteurs ne nomment pas pareil, et le compositeur le documente
 * (`video-composer.ts:2803-2805`, « branding naming is confusing ») :
 *
 *   `creer-avance`, Agent IA : `branding.ctaText` porte la PETITE ligne
 *   Assistant, Autopilote    : `branding.ctaText` porte le GROS texte
 *
 * Le nom d'une clé ne dit donc rien de son contenu. Seule la FORME du post le
 * dit, et c'est le rôle de `resoudreTextes` (`../textesCanoniques`) — d'où
 * l'unique règle de ce module en matière de textes :
 *
 *   ON ÉCRIT DANS LA CLÉ D'OÙ VIENT LA VALEUR RELUE, JAMAIS AILLEURS.
 *
 * Ce que cela ferme, mesuré sur les six formes réellement produites :
 *
 *   - la clé `branding.ctaText` était écrasée SUR LES SIX — or c'est elle que
 *     le compositeur peint en PETITE ligne (`video-composer.ts:2807`) ;
 *   - le nouveau GROS texte n'atteignait JAMAIS le rendu, sur les six non
 *     plus : le compositeur lit `design.ctaMainText` en premier (`:2806`), et
 *     personne ne l'écrivait ;
 *   - au pixel, la petite ligne changeait sur TROIS des six — ailleurs,
 *     `design.ctaSubText` masquait la casse au rendu.
 *
 * Le tout sans affichage, sans erreur, et sans retour possible : la colonne
 * `jsonb` n'a pas d'historique.
 *
 * Ce que cela NE fait PAS, et ne doit pas faire :
 *
 *   - AUCUNE SYNCHRONISATION des clés jumelles. Un post dont
 *     `branding.watermarkText` recopiait `design.ctaMainText` garde son
 *     `watermarkText` sur l'ancienne valeur. Le rendu lit `design.ctaMainText`
 *     en premier (`video-composer.ts:2806`) ; aligner l'autre demanderait une
 *     décision produit que ce module n'a pas à prendre.
 *   - AUCUNE ÉCRITURE DU VRAI FILIGRANE. Il vit sous `design.siteText.text`,
 *     qu'aucune cascade de CTA ne traverse, et le parcours n'a pas de contrôle
 *     relié au post pour le modifier. Sa valeur est préservée telle quelle.
 *
 * Le montage déjà rendu (`renderedVideoUrl`, `thumbnailUrl`, `composerVersion`)
 * n'est JAMAIS touché : modifier des textes ne produit pas une nouvelle vidéo,
 * et y toucher ferait pointer le post vers un fichier qui ne lui correspond pas.
 * En revanche, dès qu'une modification change le rendu, l'envoi porte
 * `montagePerime: true` (voir `CLE_MONTAGE_PERIME`) : le Calendrier propose
 * alors « Régénérer », et le rendu suivant retire le drapeau.
 *
 * Ce module ne fait aucun appel réseau, ne déclenche aucun rendu et ne modifie
 * pas ses arguments.
 */

import { resoudreTextes, ecrireTexte, type ChampTexte, type CleTexte } from '../textesCanoniques';
import { CLE_MONTAGE_PERIME } from '../montage-perime';

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const copier = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * Egalite profonde, suffisante pour ce que le parcours porte : des valeurs
 * JSON. `JSON.stringify` seul trahirait sur l'ordre des cles ; on compare donc
 * structurellement.
 */
function memeValeur(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => memeValeur(v, b[i]));
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ca = Object.keys(oa);
  const cb = Object.keys(ob);
  if (ca.length !== cb.length) return false;
  return ca.every((k) => Object.prototype.hasOwnProperty.call(ob, k) && memeValeur(oa[k], ob[k]));
}

/**
 * Pose la clé seulement si l'utilisateur l'a CHANGÉE.
 *
 * `null`, `0`, `false`, `''` et `[]` comptent comme des valeurs : seule
 * `undefined` signifie « le parcours n'en porte pas ». Une valeur identique a
 * celle du chargement est omise — ce qui la laisse intacte en base, la fusion
 * ne touchant pas aux cles absentes.
 */
function poserSiChange(
  cible: Record<string, unknown>,
  cle: string,
  valeur: unknown,
  reference: unknown,
): boolean {
  if (valeur === undefined) return false;
  if (memeValeur(valeur, reference)) return false;
  cible[cle] = copier(valeur);
  return true;
}

/**
 * La cle ou ECRIRE un CTA : celle d'ou vient la valeur relue.
 *
 * On ne la rededuit pas ici — ce serait dupliquer l'invariant du contrat, et
 * c'est exactement la faute qui avait fait perdre des ecritures. On demande sa
 * cible a `ecrireTexte`, puis on relit la provenance sur son resultat : le
 * contrat garantit que les deux coincident.
 */
function cibleTexte(base: unknown, champ: ChampTexte, valeur: string): CleTexte | null {
  return resoudreTextes(ecrireTexte(base, champ, valeur))[champ].cle;
}

// Drapeau « montage périmé » : défini dans un module PUR partagé avec le
// serveur (cron, route de publication). Réexporté ici pour les appelants
// existants.
export {
  CLE_MONTAGE_PERIME, montageEstPerime, MESSAGE_MONTAGE_PERIME,
  MESSAGE_MONTAGE_PERIME_SERVEUR, messageMontagePerime, montageRenduServeur,
  estErreurMontagePerime, leverMontagePerime,
} from '../montage-perime';

/**
 * Clés écrites qui NE changent PAS la vidéo rendue.
 *
 * ⚠️ Liste d'EXCLUSION, et non d'inclusion — même raison que
 * `renderSignature.ts` : une liste des champs visuels écrite à la main serait
 * fausse au premier champ ajouté sans y penser, et son échec serait SILENCIEUX
 * (une vidéo publiée qui ne correspond plus à l'écran). Ici, tout nouveau champ
 * envoyé périme le montage par défaut ; le pire cas est un « Régénérer » de
 * trop, jamais une vidéo périmée publiée sans signal.
 *
 * `hasAudio` n'est qu'un résumé des champs audio, qui périment eux-mêmes.
 */
const CLES_SANS_EFFET_SUR_LE_RENDU: ReadonlySet<string> = new Set(['hasAudio']);

/** Ce que le parcours guidé sait produire sans rendre de vidéo. */
export interface ValeursWizard {
  /**
   * Le titre part dans la colonne `title`, jamais dans la metadata. Il n'est
   * lu ici que pour savoir si le montage devient périmé : il est peint dans
   * la vidéo.
   */
  title?: string;
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
  /**
   * MULTI-RUSH (`src/lib/creer/multi-rush.ts`) : place de chaque rush dans la
   * séquence « Vidéo ». `null` = un seul rush (efface d'anciens segments s'il
   * y en avait) ; `undefined` = ne rien envoyer.
   */
  rushSegments?: { url: string; debut: number; fin: number }[] | null;
  audioKeyframes?: unknown;
  cardGroups?: unknown[];
  hasAudio?: boolean;
  /**
   * `design.cardCustomIcons` REALIGNE sur les cartes de l'ecran
   * (`iconesPersoRealignees`). Envoye seulement s'il change — c'est-a-dire
   * quand une carte a ete ajoutee, supprimee ou deplacee.
   */
  cardCustomIcons?: Record<string, unknown>;
  /**
   * Filtre couleur du rush : la REFERENCE (`LutRef` : empreinte, nom,
   * intensite), jamais la table. `null` = filtre retire. Change le rendu :
   * hors de la liste d'exclusion, il pose donc `montagePerime`.
   */
  lut?: { empreinte: string; nom: string; intensite: number } | null;
  /**
   * Transition entre séquences — écrite sous `design.transition` (la clé
   * que relisent « Régénérer » et l'Autopilote).
   */
  transition?: string;
  /** Recadrage de l'affiche (`posterTransform`), déjà validé par l'appelant. */
  posterTransform?: { scale: number; offsetX: number; offsetY: number };
  /** HÉRITÉ — recadrage unique du rush. Créer écrit désormais `rushTransforms`. */
  rushTransform?: { scale: number; offsetX: number; offsetY: number };
  /**
   * Recadrage PAR RUSH (clé = URL du rush), déjà validé par l'appelant. `{}`
   * = aucun rush recadré : c'est une VALEUR (retirer le dernier recadrage
   * doit partir, et une table présente fait foi sur l'ancien `rushTransform`).
   */
  rushTransforms?: Record<string, { scale: number; offsetX: number; offsetY: number }>;
  /**
   * Fonds par séquence (`seqBackgrounds`), URL durables seulement
   * (`fondsPourMetadata`). `{}` = aucun fond propre : c'est une VALEUR, qui
   * part quand l'utilisateur retire le dernier.
   */
  seqBackgrounds?: Record<string, unknown>;
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
  chargees: ValeursWizard = {},
): Record<string, unknown> {
  const base = estObjet(existante) ? existante : {};
  const envoi: Record<string, unknown> = {};
  const ref = chargees ?? {};

  // ── Champs simples ──────────────────────────────────────────────────
  poserSiChange(envoi, 'subtitle', valeurs.subtitle, ref.subtitle);
  poserSiChange(envoi, 'theme', valeurs.theme, ref.theme);
  poserSiChange(envoi, 'cards', valeurs.cards, ref.cards);
  poserSiChange(envoi, 'videoSize', valeurs.videoSize, ref.videoSize);
  poserSiChange(envoi, 'posterUrl', valeurs.posterUrl, ref.posterUrl);
  poserSiChange(envoi, 'musicUrl', valeurs.musicUrl, ref.musicUrl);
  poserSiChange(envoi, 'voiceUrl', valeurs.voiceUrl, ref.voiceUrl);
  poserSiChange(envoi, 'musicVolume', valeurs.musicVolume, ref.musicVolume);
  poserSiChange(envoi, 'voiceVolume', valeurs.voiceVolume, ref.voiceVolume);
  poserSiChange(envoi, 'sequenceVoiceUrls', valeurs.sequenceVoiceUrls, ref.sequenceVoiceUrls);
  poserSiChange(envoi, 'rushUrls', valeurs.rushUrls, ref.rushUrls);
  // `ref ?? null` : un post chargé SANS segments compare `null` à `null` —
  // un post mono-rush enregistré sans changement n'écrit rien de nouveau.
  poserSiChange(envoi, 'rushSegments', valeurs.rushSegments, ref.rushSegments ?? null);
  poserSiChange(envoi, 'audioKeyframes', valeurs.audioKeyframes, ref.audioKeyframes);
  poserSiChange(envoi, 'cardGroups', valeurs.cardGroups, ref.cardGroups);
  poserSiChange(envoi, 'hasAudio', valeurs.hasAudio, ref.hasAudio);
  poserSiChange(envoi, 'sequences', valeurs.sequences, ref.sequences);
  // `ref.lut ?? null` : un post charge SANS filtre compare `null` a `null`.
  poserSiChange(envoi, 'lut', valeurs.lut, ref.lut === undefined ? null : ref.lut);
  // Recadrage et fonds par séquence : ils changent le rendu, donc hors de la
  // liste d'exclusion — un changement pose `montagePerime`, un
  // enregistrement sans changement n'écrit rien.
  poserSiChange(envoi, 'posterTransform', valeurs.posterTransform, ref.posterTransform);
  poserSiChange(envoi, 'rushTransform', valeurs.rushTransform, ref.rushTransform);
  poserSiChange(envoi, 'rushTransforms', valeurs.rushTransforms, ref.rushTransforms);
  poserSiChange(envoi, 'seqBackgrounds', valeurs.seqBackgrounds, ref.seqBackgrounds);

  // ── `branding` : recomposé SUR l'existant, et seulement s'il bouge ───
  //
  // Les deux CTA ne sont plus posés ici en direct : leur clé dépend de la
  // FORME du post, pas du bloc. Voir la section « textes » plus bas.
  const brandingBase = estObjet(base.branding) ? copier(base.branding) : {};
  const branding: Record<string, unknown> = { ...brandingBase };
  let brandingChange = false;
  brandingChange = poserSiChange(branding, 'accentColor', valeurs.accentColor, ref.accentColor)
    || brandingChange;

  // ── `design` : même règle ───────────────────────────────────────────
  const designBase = estObjet(base.design) ? copier(base.design) : {};
  const design: Record<string, unknown> = { ...designBase };
  let designChange = false;
  designChange = poserSiChange(design, 'textAnimation', valeurs.textAnimation, ref.textAnimation)
    || designChange;
  designChange = poserSiChange(design, 'transition', valeurs.transition, ref.transition)
    || designChange;
  designChange = poserSiChange(design, 'gradientColor1', valeurs.gradientColor1, ref.gradientColor1)
    || designChange;
  designChange = poserSiChange(design, 'gradientColor2', valeurs.gradientColor2, ref.gradientColor2)
    || designChange;
  designChange = poserSiChange(design, 'gradientOpacity', valeurs.gradientOpacity, ref.gradientOpacity)
    || designChange;
  // Rangees par POSITION : realignees par l'appelant, posees seulement si elles
  // ont bouge. Le reste de `design` part de l'existant (`designBase`).
  designChange = poserSiChange(design, 'cardCustomIcons', valeurs.cardCustomIcons, ref.cardCustomIcons)
    || designChange;

  // `positions` est lui-meme imbrique : meme regle, un cran plus bas. Ecraser
  // l'objet entier perdrait une cle que seul l'editeur avance y met.
  const positionsBase = estObjet(designBase.positions) ? copier(designBase.positions) : {};
  const positions: Record<string, unknown> = { ...positionsBase };
  let positionsChange = false;
  positionsChange = poserSiChange(positions, 'title', valeurs.titlePos, ref.titlePos)
    || positionsChange;
  // Le wizard nomme `ctaPos` ce que la metadata range sous `watermark` — c'est
  // une POSITION, sans rapport avec le texte du filigrane.
  positionsChange = poserSiChange(positions, 'watermark', valeurs.ctaPos, ref.ctaPos)
    || positionsChange;
  positionsChange = poserSiChange(positions, 'elements', valeurs.elements, ref.elements)
    || positionsChange;
  if (positionsChange) {
    design.positions = positions;
    designChange = true;
  }

  // ── LES DEUX CTA : ECRITS DANS LEUR PROVENANCE ──────────────────────
  //
  // La cle depend du producteur du post. Sur un post `avance-herite`, le GROS
  // texte vit sous `branding.watermarkText` et la PETITE ligne sous
  // `branding.ctaText` ; sur un post recent, sous `design.ctaMainText` et
  // `design.ctaSubText`. Ecrire toujours dans `branding.ctaText`, comme avant
  // ce lot, revenait a remplacer la petite ligne de la video par le gros texte
  // — une perte silencieuse, sur une colonne `jsonb` sans historique.
  //
  // AUCUNE ancienne cle n'est deplacee, synchronisee ni supprimee : seule la
  // cle d'origine de la valeur est reecrite. Un post dont `watermarkText` et
  // `design.ctaMainText` etaient jumeles garde donc son `watermarkText` sur
  // l'ancienne valeur — le rendu lit `design.ctaMainText` en premier
  // (`video-composer.ts:2806`), et synchroniser demanderait une decision
  // produit que ce lot n'a pas a prendre.
  const textes: ReadonlyArray<readonly [ChampTexte, string | undefined, unknown]> = [
    ['ctaPrincipal', valeurs.ctaText, ref.ctaText],
    ['ctaSecondaire', valeurs.ctaSubText, ref.ctaSubText],
  ];
  for (const [champ, valeur, reference] of textes) {
    if (valeur === undefined) continue;
    if (memeValeur(valeur, reference)) continue;
    const cle = cibleTexte(base, champ, valeur);
    // `cle` ne peut etre nulle : `ecrireTexte` pose toujours la valeur.
    if (cle === null) continue;
    const separateur = cle.indexOf('.');
    const bloc = cle.slice(0, separateur);
    const feuille = cle.slice(separateur + 1);
    // Un CTA ne vise jamais un chemin profond — `design.siteText.text` est le
    // filigrane, qu'aucune cascade de CTA ne traverse.
    if (feuille.includes('.')) continue;
    if (bloc === 'branding') {
      branding[feuille] = valeur;
      brandingChange = true;
    } else {
      design[feuille] = valeur;
      designChange = true;
    }
  }

  if (brandingChange) envoi.branding = branding;
  if (designChange) envoi.design = design;

  // ── Montage périmé ──────────────────────────────────────────────────
  //
  // Le montage rendu n'est pas touché (voir l'en-tête), mais il ne correspond
  // plus : on le DIT, pour que le Calendrier propose de le régénérer. Rien
  // n'a changé, rien n'est posé — ouvrir puis enregistrer n'écrit toujours
  // rien.
  const titreChange = valeurs.title !== undefined && !memeValeur(valeurs.title, ref.title);
  const renduChange = Object.keys(envoi).some((cle) => !CLES_SANS_EFFET_SUR_LE_RENDU.has(cle));
  if (titreChange || renduChange) envoi[CLE_MONTAGE_PERIME] = true;

  return envoi;
}
