/**
 * A_3c2 — LES ANIMATIONS DU CONTENU : le texte se révèle, mot à mot.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS `drawtext`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `drawtext` n'a pas de sous-chaîne temporelle : il n'existe aucun moyen de
 * lui faire révéler un texte progressivement. La solution naïve — un filtre
 * par étape, chacun avec son fichier — donnerait quatre-vingts filtres et
 * quatre-vingts fichiers pour une accroche d'écriture caractère par
 * caractère.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LIBASS, VÉRIFIÉ SUR LES DEUX ENVIRONNEMENTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ffmpeg -buildconf` rend `--enable-libass` sur le binaire embarqué ET dans
 * le conteneur de production, où les polices Liberation sont installées. Un
 * seul fichier `.ass`, un seul filtre `subtitles`, autant d'événements que
 * d'étapes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA MISE EN PAGE NE SAUTE PAS, ET C'EST MESURÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Écrire « BOUGE » puis « BOUGE AVEC » recentre le texte à chaque étape : le
 * premier mot se déplace, et la lecture devient pénible. Chaque étape porte
 * donc le texte COMPLET, la partie non révélée étant rendue transparente.
 * Mesuré : le texte commence à x = 83 px aux trois instants d'un
 * mot-à-mot, alors qu'il glissait de 83 à 183 sans cette précaution.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN TAG ASS NE PEUT VENIR DU TEXTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Dans un document ASS, `{…}` ouvre un bloc de commandes et `\N` force un
 * saut de ligne. Une accroche contenant `{\c&H0000FF&}` repeindrait le texte
 * en rouge si on la recopiait telle quelle. Ces caractères sont donc
 * REMPLACÉS — ASS n'offre pas de séquence d'échappement pour eux — et un
 * test le vérifie en mesurant que le texte reste blanc.
 */
import type { EntreeCreative } from './catalogue-contrat';

export const VERSION_ANIMATIONS_CONTENU = 'anim-contenu-v1';

/** Ce qui avance à chaque étape. */
export const PROGRESSIONS = ['caractere', 'mot', 'groupe'] as const;
export type Progression = (typeof PROGRESSIONS)[number];

/** Ce qui arrive à l'unité qui vient d'être révélée. */
export const REVELATIONS = ['apparition', 'fondu', 'surbrillance'] as const;
export type Revelation = (typeof REVELATIONS)[number];

export interface AnimationContenuCreative extends EntreeCreative {
  famille: 'animation-texte';
  type: 'contenu';
  progression: Progression;
  revelation: Revelation;
  /** Part de la durée de la couche consacrée à la révélation. 0 à 1. */
  partRevelation: number;
  /** Combien d'unités par étape. `1` sauf pour les groupes. */
  unitesParEtape: number;
}

const c = (
  id: string, nom: string, categorie: EntreeCreative['categorie'],
  tags: string[], description: string,
  progression: Progression, revelation: Revelation,
  partRevelation: number, unitesParEtape = 1,
): AnimationContenuCreative => ({
  id, nom, famille: 'animation-texte', categorie, tags, description,
  rendu: true, version: VERSION_ANIMATIONS_CONTENU, type: 'contenu',
  progression, revelation, partRevelation, unitesParEtape,
});

export const ANIMATIONS_CONTENU: readonly AnimationContenuCreative[] = [
  c('machine-a-ecrire', 'Machine à écrire', 'social',
    ['typewriter', 'frappe', 'caractere', 'dynamique'],
    'Le texte s’écrit lettre après lettre.', 'caractere', 'apparition', 0.7),
  c('machine-rapide', 'Machine rapide', 'energie',
    ['typewriter', 'frappe', 'vif'],
    'La même frappe, deux fois plus vive.', 'caractere', 'apparition', 0.35),
  c('mot-par-mot', 'Mot par mot', 'social',
    ['mot', 'sequence', 'lecture', 'dynamique'],
    'Chaque mot apparaît à son tour.', 'mot', 'apparition', 0.6),
  c('mot-fondu', 'Mots en fondu', 'sobre',
    ['mot', 'fondu', 'doux', 'dynamique'],
    'Les mots se fondent l’un après l’autre.', 'mot', 'fondu', 0.7),
  c('groupe-par-groupe', 'Par groupes', 'cinema',
    ['groupe', 'phrase', 'lecture', 'dynamique'],
    'Le texte se construit deux mots à la fois.', 'groupe', 'apparition', 0.6, 2),
  c('mot-actif', 'Mot actif', 'social',
    ['surbrillance', 'karaoke', 'accent', 'dynamique'],
    'Tout est lisible ; un mot s’allume à son tour.', 'mot', 'surbrillance', 1),
  c('mot-actif-lent', 'Mot actif lent', 'cinema',
    ['surbrillance', 'karaoke', 'lent', 'dynamique'],
    'Le même, posé, pour un texte qu’on lit.', 'mot', 'surbrillance', 1),
  c('lettre-fondu', 'Lettres en fondu', 'sobre',
    ['caractere', 'fondu', 'doux', 'dynamique'],
    'Les lettres se fondent, sans frappe sèche.', 'caractere', 'fondu', 0.8),
];

export const ANIMATION_CONTENU_IDS: readonly string[] = ANIMATIONS_CONTENU.map((x) => x.id);

export function animationContenuParId(id: unknown): AnimationContenuCreative | null {
  if (typeof id !== 'string') return null;
  return ANIMATIONS_CONTENU.find((x) => x.id === id) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// LE SÉQUENCEUR
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ AU-DELÀ, ON NE FRAPPE PLUS LETTRE PAR LETTRE.
 *
 * Une accroche fait au plus 80 caractères ; à ce rythme, la frappe
 * deviendrait illisible sur une couche de trois secondes, et le fichier
 * porterait quatre-vingts événements. Passé ce seuil, la progression bascule
 * sur les MOTS — le message n'est jamais coupé, c'est le grain qui change.
 */
export const CARACTERES_MAX_FRAPPE = 48;

/** Une étape : ce qui est révélé, et quand. */
export interface EtapeContenu {
  /** Nombre d'unités révélées à cette étape, à partir du début. */
  revelees: number;
  /** L'unité qui vient d'être révélée — celle qu'on met en avant. */
  active: number;
  debutSecondes: number;
  finSecondes: number;
}

export interface DecoupageContenu {
  /** Les unités, dans l'ordre. Des mots, ou des caractères. */
  unites: readonly string[];
  /** Ce qui sépare deux unités à l'affichage. */
  separateur: string;
  etapes: readonly EtapeContenu[];
}

/**
 * Découpe le texte et répartit les étapes sur la durée de la couche.
 *
 * ⚠️ LE RYTHME S'ADAPTE, IL N'EST PAS FIXE. Trois mots ne doivent pas mettre
 * huit secondes à s'écrire, ni douze mots apparaître en deux dixièmes. La
 * part de la couche consacrée à la révélation est fixée par l'animation ; le
 * reste est du temps de lecture.
 *
 * Fonction PURE : c'est elle que l'aperçu du navigateur consomme aussi, et
 * c'est ce qui interdit aux deux de diverger.
 */
export function decouperContenu(
  anim: AnimationContenuCreative, texte: string,
  debutSecondes: number, finSecondes: number,
): DecoupageContenu {
  const duree = Math.max(0, finSecondes - debutSecondes);
  /* ⚠️ L'ÉCHAPPEMENT EST FAIT ICI, PAS PLUS LOIN. Le laisser au générateur
     ASS ferait compter les mots sur un texte que l'aperçu affiche et que le
     rendu ne montrera pas : une accolade deviendrait une parenthèse dans la
     vidéo, et l'écran continuerait de promettre l'accolade. Les deux lisent
     cette fonction, donc les deux voient le MÊME texte. */
  const propre = echapperAss(texte ?? '').trim();
  if (propre === '' || duree <= 0) {
    return { unites: [], separateur: '', etapes: [] };
  }

  const mots = propre.split(/\s+/).filter(Boolean);
  /* La frappe caractère par caractère bascule sur les mots au-delà du seuil :
     le message reste entier, seul le grain change. */
  const parCaractere = anim.progression === 'caractere'
    && propre.length <= CARACTERES_MAX_FRAPPE;
  const unites = parCaractere ? [...propre] : mots;
  const separateur = parCaractere ? '' : ' ';

  const pas = Math.max(1, Math.round(anim.unitesParEtape));
  const nbEtapes = Math.max(1, Math.ceil(unites.length / pas));
  const dureeRevelation = Math.min(duree, duree * Math.max(0.05, Math.min(1, anim.partRevelation)));
  const parEtape = dureeRevelation / nbEtapes;

  const etapes: EtapeContenu[] = [];
  for (let i = 0; i < nbEtapes; i += 1) {
    const revelees = Math.min(unites.length, (i + 1) * pas);
    const debut = debutSecondes + i * parEtape;
    /* La DERNIÈRE étape tient jusqu'à la fin de la couche : sans cela, le
       texte disparaîtrait avant que `enable` ne l'éteigne, et clignoterait. */
    const fin = i === nbEtapes - 1 ? finSecondes : debutSecondes + (i + 1) * parEtape;
    etapes.push({ revelees, active: Math.max(0, revelees - 1), debutSecondes: debut, finSecondes: fin });
  }
  return { unites, separateur, etapes };
}

// ─────────────────────────────────────────────────────────────────────────
// L'ÉCHAPPEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Rend un texte inoffensif dans un document ASS.
 *
 * ⚠️ ASS N'A PAS DE SÉQUENCE D'ÉCHAPPEMENT POUR `{`, `}` NI `\`. On ne peut
 * donc pas « échapper » : on REMPLACE, par des caractères qui se lisent
 * pareil. C'est une substitution visible, et c'est le prix à payer pour
 * qu'une accroche contenant `{\c&H0000FF&}` reste du texte au lieu de
 * repeindre la vidéo en rouge.
 *
 * Vérifié par la mesure : le texte reste blanc (R=G=B≈221) alors qu'une
 * commande interprétée l'aurait rendu rouge.
 */
export function echapperAss(texte: string): string {
  return (texte ?? '')
    .replace(/\\/g, '⧵')   // ⧵ : un antislash qui ne commande rien
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    // Les retours à la ligne deviendraient des événements mal formés.
    .replace(/[\r\n]+/g, ' ');
}

/** `&HBBGGRR&` — l'ordre des octets d'ASS, qui n'est pas celui du HTML. */
export function couleurAss(hex: string): string {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : 'ffffff';
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}
