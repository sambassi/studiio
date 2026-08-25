/**
 * `toPostMetadata` — contrat canonique -> metadonnees d'un post.
 *
 * L'inverse exact de `fromPostMetadata`, et le seul point d'ecriture du
 * contrat. Fonction PURE : aucun appel reseau, aucune base, aucun rendu, et
 * ni le design ni les metadonnees d'origine ne sont modifies.
 */

import { deepClone, deepEqual, getPath, isPlainObject, safeAssign } from './internal';
import { fromPostMetadata } from './from-post';
import { MANAGED_FIELDS } from './managed';
import type { CanonicalDesign } from './types';

/**
 * Fusionne un design dans des metadonnees existantes.
 *
 * Trois garanties, dans cet ordre d'importance :
 *
 * 1. **Rien n'est jamais supprime.** Une cle presente dans
 *    `originalMetadata` et absente du contrat est recopiee telle quelle.
 *    C'est ce qui interdit qu'un enregistrement partiel remplace tout le
 *    `metadata` par un objet incomplet — le defaut exact des routes
 *    `PUT /api/posts` et `PATCH /api/posts/[id]` aujourd'hui.
 *
 * 2. **Une simple lecture n'ajoute rien.** Un champ absent a la lecture et
 *    laisse tel quel n'apparait pas a l'ecriture : les defauts d'affichage
 *    restent en dehors de l'enregistrement.
 *
 * 3. **Les valeurs vides sont des valeurs.** `null`, `false`, `0`, `''` et
 *    `[]` sont reecrits fidelement des lors qu'ils etaient presents.
 *
 * @param design           le contrat, tel que relu ou modifie
 * @param originalMetadata les metadonnees a enrichir. Omises, le
 *                         `passthrough` capture a la lecture sert de base —
 *                         le resultat reste alors complet.
 */
export function toPostMetadata(
  design: CanonicalDesign,
  originalMetadata?: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(originalMetadata)
    ? deepClone(originalMetadata)
    : deepClone(design.passthrough as Record<string, unknown>);

  const present = new Set(design.present);

  for (const field of MANAGED_FIELDS) {
    const stored = getPath(design, field.path);

    // Le champ existait a la lecture : on le reecrit, quelle que soit sa
    // valeur — `null` et `''` compris.
    if (present.has(field.key)) {
      safeAssign(base, field.key, deepClone(stored));
      continue;
    }

    // Le champ n'existait pas et rien ne l'a renseigne depuis : on
    // n'introduit pas de cle. `undefined` n'a pas de representation en JSON,
    // l'ecrire creerait une cle vide a chaque aller-retour.
    if (stored === undefined) continue;

    // Le champ n'existait pas mais porte desormais une valeur : c'est un
    // ajout delibere de l'appelant, on l'ecrit.
    safeAssign(base, field.key, deepClone(stored));
  }

  return base;
}

/**
 * Les metadonnees changeraient-elles si on ecrivait ce design ?
 *
 * Utile a un futur bouton « Enregistrer » pour rester inerte tant que rien
 * n'a bouge, et aux tests d'aller-retour.
 */
export function isPostMetadataUnchanged(
  design: CanonicalDesign,
  originalMetadata?: unknown,
): boolean {
  const base = isPlainObject(originalMetadata)
    ? originalMetadata
    : (design.passthrough as Record<string, unknown>);
  return deepEqual(toPostMetadata(design, base), base);
}

/**
 * Fusionne des metadonnees PARTIELLES dans les metadonnees existantes.
 *
 * C'est la brique d'une mise a jour partielle : ce que le client envoie
 * ecrase, ce qu'il n'envoie pas survit.
 *
 * Semantique : **fusion de surface au premier niveau**. Un objet imbrique
 * envoye par le client REMPLACE l'ancien, il ne s'y melange pas. Envoyer
 * `{ design: { font: 'X' } }` remplace donc tout le bloc `design`.
 *
 * Ce choix est delibere. Une fusion profonde interdirait de RETIRER une cle
 * imbriquee — il faudrait un langage de suppression — et rendrait le sort des
 * tableaux ambigu (remplacer ? concatener ? fusionner par index ?). Le premier
 * niveau suffit au besoin reel : `{ musicUrl: '…' }` ne doit toucher que
 * `musicUrl`, et l'appelant qui modifie un bloc imbrique en detient de toute
 * facon la version complete, puisqu'il vient de la lire.
 *
 * Ni `existing` ni `incoming` ne sont modifies.
 */
export function mergePostMetadata(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const design = fromPostMetadata(incoming);

  // Champs GERES : `present` fait foi, donc `null`, `false`, `0`, `''` et `[]`
  // envoyes par le client sont ecrits, et les champs qu'il n'a pas envoyes
  // gardent la valeur existante.
  const merged = toPostMetadata(design, existing);

  // Champs NON geres : meme regle, appliquee a la main. `toPostMetadata` part
  // des metadonnees existantes et ignore le `passthrough` du design entrant —
  // sans cette passe, une cle inconnue envoyee par le client serait perdue.
  const passthrough = design.passthrough as Record<string, unknown>;
  for (const key of Object.keys(passthrough)) {
    safeAssign(merged, key, deepClone(passthrough[key]));
  }

  return merged;
}
