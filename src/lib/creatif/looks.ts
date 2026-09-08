/**
 * A_3a — LA BIBLIOTHÈQUE DE LOOKS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CHAQUE ENTRÉE EST ADOSSÉE À UN `.cube` RÉEL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il n'y a pas un seul look décoratif ici : `scripts/lut/generer-luts.mjs`
 * produit un fichier par identifiant, et un test refuse le catalogue si l'un
 * d'eux manque. Une carte qui ne changerait rien à la vidéo serait pire
 * qu'une absence — elle se découvrirait après le rendu.
 *
 * `neutral` est la seule exception, et elle est explicite : « aucun look »
 * ne s'applique pas, il s'abstient.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TOUS SONT DISTINCTS, ET C'EST MESURÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Écart moyen par pixel sur mire `testsrc2`, chacun contre l'image d'origine :
 * médiane 6,98/255, maximum 91,06/255. Aucune PAIRE de looks n'est sous
 * 2/255 l'un de l'autre. Deux looks restent volontairement discrets —
 * « Peau naturelle » (1,42) dont c'est le propos, et « Vibrant » (1,91)
 * qui existait avant ce lot et ne doit pas changer.
 *
 * ⚠️ CE FICHIER NE DÉCRIT PAS LES COULEURS, IL LES NOMME. La transformation
 * vit dans le générateur, une seule fois ; la répéter ici en ferait deux
 * vérités qui divergeraient au premier réglage.
 */
import type { EntreeCreative } from './catalogue-contrat';

/** Une entrée de look : le contrat commun, plus son fichier. */
export interface LookCreatif extends EntreeCreative {
  famille: 'lut';
  /**
   * Le nom du `.cube`, ou `null` pour « aucun look ».
   *
   * ⚠️ UN NOM DE FICHIER, JAMAIS UN CHEMIN. La racine est fixée côté serveur
   * par `rendu-lut`, qui refuse tout ce qui en sortirait.
   */
  fichier: string | null;
}

/** La version du rendu des looks. Change quand le `.cube` change. */
export const VERSION_LOOKS = 'look-v1';

export const LOOKS_CREATIFS: readonly LookCreatif[] = [
  {
    id: 'neutral',
    nom: 'Neutre',
    famille: 'lut',
    categorie: 'sobre',
    tags: ['aucun', 'brut', 'sans filtre'],
    description: 'L\'image du rush, sans correction.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: null,
  },
  {
    id: 'clean',
    nom: 'Clean',
    famille: 'lut',
    categorie: 'sobre',
    tags: ['propre', 'doux', 'naturel'],
    description: 'Contraste doux, peaux naturelles.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'clean.cube',
  },
  {
    id: 'desature',
    nom: 'Désaturé',
    famille: 'lut',
    categorie: 'sobre',
    tags: ['gris', 'sobre', 'discret'],
    description: 'Couleurs retenues, presque documentaire.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'desature.cube',
  },
  {
    id: 'film-soft',
    nom: 'Film doux',
    famille: 'lut',
    categorie: 'sobre',
    tags: ['pellicule', 'doux', 'laiteux'],
    description: 'Noirs levés, rendu argentique léger.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'film-soft.cube',
  },
  {
    id: 'pastel',
    nom: 'Pastel',
    famille: 'lut',
    categorie: 'sobre',
    tags: ['clair', 'doux', 'poudre'],
    description: 'Teintes claires et lavées.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'pastel.cube',
  },
  {
    id: 'cinema-warm',
    nom: 'Cinéma chaud',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['chaud', 'ambre', 'film'],
    description: 'Hautes lumières ambrées, ombres denses.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'cinema-warm.cube',
  },
  {
    id: 'cinema-cool',
    nom: 'Cinéma froid',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['froid', 'bleu', 'nuit', 'film'],
    description: 'Bleus profonds, rendu nocturne.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'cinema-cool.cube',
  },
  {
    id: 'blockbuster',
    nom: 'Blockbuster',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['action', 'film', 'contraste'],
    description: 'Ombres bleutées, lumières chaudes.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'blockbuster.cube',
  },
  {
    id: 'teal-orange',
    nom: 'Teal & Orange',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['film', 'chaud', 'froid', 'contraste'],
    description: 'Le contraste chaud-froid des salles.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'teal-orange.cube',
  },
  {
    id: 'film-contrast',
    nom: 'Film contrasté',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['pellicule', 'contraste', 'dense'],
    description: 'Noirs profonds, matière argentique.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'film-contrast.cube',
  },
  {
    id: 'dramatic',
    nom: 'Dramatique',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['sombre', 'tendu', 'contraste'],
    description: 'Contraste fort, couleurs retenues.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'dramatic.cube',
  },
  {
    id: 'noir',
    nom: 'Noir et blanc',
    famille: 'lut',
    categorie: 'cinema',
    tags: ['monochrome', 'nb', 'gris'],
    description: 'Sans couleur, contraste soutenu.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'noir.cube',
  },
  {
    id: 'vibrant',
    nom: 'Vibrant',
    famille: 'lut',
    categorie: 'social',
    tags: ['saturé', 'couleurs', 'franc'],
    description: 'Saturation soutenue, couleurs franches.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'vibrant.cube',
  },
  {
    id: 'punchy',
    nom: 'Punchy',
    famille: 'lut',
    categorie: 'social',
    tags: ['contraste', 'net', 'impact'],
    description: 'Contraste marqué, ombres froides.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'punchy.cube',
  },
  {
    id: 'pop',
    nom: 'Pop',
    famille: 'lut',
    categorie: 'social',
    tags: ['saturé', 'clair', 'joyeux'],
    description: 'Couleurs vives et image ouverte.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'pop.cube',
  },
  {
    id: 'bright',
    nom: 'Lumineux',
    famille: 'lut',
    categorie: 'social',
    tags: ['clair', 'ouvert', 'jour'],
    description: 'Image ouverte, comme en plein jour.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'bright.cube',
  },
  {
    id: 'high-contrast',
    nom: 'Fort contraste',
    famille: 'lut',
    categorie: 'social',
    tags: ['contraste', 'impact', 'net'],
    description: 'Noirs marqués, lecture immédiate.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'high-contrast.cube',
  },
  {
    id: 'creator',
    nom: 'Créateur',
    famille: 'lut',
    categorie: 'social',
    tags: ['reel', 'short', 'moderne'],
    description: 'Le rendu des formats courts.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'creator.cube',
  },
  {
    id: 'lifestyle',
    nom: 'Lifestyle',
    famille: 'lut',
    categorie: 'social',
    tags: ['doux', 'chaud', 'quotidien'],
    description: 'Chaleur douce, image respirante.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'lifestyle.cube',
  },
  {
    id: 'peau-naturelle',
    nom: 'Peau naturelle',
    famille: 'lut',
    categorie: 'portrait',
    tags: ['visage', 'naturel', 'discret'],
    description: 'Correction minime, teint juste.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'peau-naturelle.cube',
  },
  {
    id: 'peau-chaude',
    nom: 'Peau chaude',
    famille: 'lut',
    categorie: 'portrait',
    tags: ['visage', 'chaud', 'doré'],
    description: 'Carnations réchauffées, image douce.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'peau-chaude.cube',
  },
  {
    id: 'peau-doree',
    nom: 'Peau dorée',
    famille: 'lut',
    categorie: 'portrait',
    tags: ['visage', 'doré', 'soleil'],
    description: 'Teint hâlé, lumière dorée.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'peau-doree.cube',
  },
  {
    id: 'portrait-doux',
    nom: 'Portrait doux',
    famille: 'lut',
    categorie: 'portrait',
    tags: ['visage', 'doux', 'clair'],
    description: 'Contraste retenu, ombres ouvertes.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'portrait-doux.cube',
  },
  {
    id: 'ete',
    nom: 'Été',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['soleil', 'chaud', 'vacances'],
    description: 'Lumière franche et couleurs pleines.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'ete.cube',
  },
  {
    id: 'heure-doree',
    nom: 'Heure dorée',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['soleil', 'chaud', 'coucher'],
    description: 'La lumière de fin de journée.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'heure-doree.cube',
  },
  {
    id: 'tropical',
    nom: 'Tropical',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['vert', 'nature', 'vif'],
    description: 'Verts et bleus soutenus.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'tropical.cube',
  },
  {
    id: 'nuit',
    nom: 'Nuit',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['sombre', 'bleu', 'soir'],
    description: 'Ombres bleutées, image basse.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'nuit.cube',
  },
  {
    id: 'urbain',
    nom: 'Urbain',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['ville', 'béton', 'froid'],
    description: 'Couleurs tenues, gris tirant froid.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'urbain.cube',
  },
  {
    id: 'moody',
    nom: 'Moody',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['sombre', 'sourd', 'intime'],
    description: 'Ambiance basse et couleurs sourdes.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'moody.cube',
  },
  {
    id: 'vintage',
    nom: 'Vintage',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['ancien', 'sépia', 'rétro'],
    description: 'Couleurs passées, noirs levés.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'vintage.cube',
  },
  {
    id: 'retro',
    nom: 'Rétro',
    famille: 'lut',
    categorie: 'ambiance',
    tags: ['ancien', 'chaud', 'années 80'],
    description: 'Dominante chaude, bleus dans les ombres.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'retro.cube',
  },
  {
    id: 'energie',
    nom: 'Énergie',
    famille: 'lut',
    categorie: 'energie',
    tags: ['sport', 'vif', 'dynamique'],
    description: 'Contraste et couleurs poussés.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'energie.cube',
  },
  {
    id: 'puissance',
    nom: 'Puissance',
    famille: 'lut',
    categorie: 'energie',
    tags: ['sport', 'fort', 'dense'],
    description: 'Image dense, ombres tenues.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'puissance.cube',
  },
  {
    id: 'neon',
    nom: 'Néon',
    famille: 'lut',
    categorie: 'energie',
    tags: ['nuit', 'saturé', 'salle'],
    description: 'Couleurs électriques, ambiance de salle.',
    rendu: true,
    version: VERSION_LOOKS,
    fichier: 'neon.cube',
  },
];

/** Les identifiants, pour la validation du profil. */
export const LOOK_IDS: readonly string[] = LOOKS_CREATIFS.map((l) => l.id);

export function lookParId(id: unknown): LookCreatif | undefined {
  if (typeof id !== 'string') return undefined;
  return LOOKS_CREATIFS.find((l) => l.id === id);
}
