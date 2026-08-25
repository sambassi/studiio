/**
 * `fromPostMetadata` — metadonnees d'un post -> contrat canonique.
 *
 * Fonction PURE : elle ne lit aucun stockage, n'appelle aucune API, ne
 * declenche aucun rendu et ne modifie jamais son argument. Elle est le seul
 * point d'entree en lecture du contrat.
 */

import {
  deepClone,
  deepFreeze,
  hasOwn,
  isPlainObject,
  safeAssign,
  setPath,
} from './internal';
import { MANAGED_FIELDS, MANAGED_METADATA_KEYS } from './managed';
import type {
  CanonicalAudio,
  CanonicalBranding,
  CanonicalCards,
  CanonicalContent,
  CanonicalDesign,
  CanonicalDesignOptions,
  CanonicalFormat,
  CanonicalMedia,
  CanonicalOverlays,
  CanonicalSequences,
  CanonicalSource,
} from './types';

/**
 * Origine PROBABLE du post.
 *
 * Simple indication de lecture. Aucune decision fonctionnelle ne doit en
 * dependre : un post edite par les deux editeurs successivement n'a plus
 * d'origine unique.
 */
function detectSource(metadata: Record<string, unknown>): CanonicalSource {
  if (metadata.source === 'assistant-simple') return 'assistant';
  const design = metadata.design;
  if (isPlainObject(design) && ('positions' in design || 'typography' in design || 'sizes' in design)) {
    return 'advanced';
  }
  return 'unknown';
}

/** Coquille vide : chaque groupe existe, aucun champ n'est renseigne. */
function emptyShell(): Record<string, unknown> {
  return {
    content: {},
    format: {},
    media: {},
    cards: {},
    audio: {},
    overlays: {},
  };
}

/**
 * Lit des metadonnees de post et en produit un `CanonicalDesign` gele.
 *
 * Tolerance : `null`, `undefined`, une chaine, un tableau — tout ce qui n'est
 * pas un objet nu donne un design vide plutot qu'une exception. Un post
 * abime ne doit pas empecher l'ouverture de l'editeur.
 *
 * Ce qui est GARANTI :
 *   - toute cle de premier niveau non geree part dans `passthrough`, copiee ;
 *   - toute cle geree REELLEMENT presente est notee dans `present`, meme si
 *     sa valeur est `null`, `false`, `0`, `''` ou `[]` ;
 *   - aucune valeur par defaut n'est injectee : l'absence reste l'absence.
 */
export function fromPostMetadata(metadata?: unknown): CanonicalDesign {
  const source: Record<string, unknown> = isPlainObject(metadata) ? metadata : {};

  const shell = emptyShell();
  const present: string[] = [];

  // Ordre de `MANAGED_FIELDS`, jamais celui des cles de l'objet : deux posts
  // portant les memes champs produisent exactement le meme `present`.
  for (const field of MANAGED_FIELDS) {
    if (!hasOwn(source, field.key)) continue;
    present.push(field.key);
    setPath(shell, field.path, deepClone(source[field.key]));
  }

  const passthrough: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (MANAGED_METADATA_KEYS.has(key)) continue;
    safeAssign(passthrough, key, deepClone(source[key]));
  }

  // Assemblage explicite plutot qu'un `...shell` : la coquille est adressee
  // par chemins (`setPath`), donc typee `Record<string, unknown>` ; l'etaler
  // ferait perdre a TypeScript la trace de chaque groupe, et il faudrait
  // rattraper le tout par une assertion sur l'objet entier — qui masquerait
  // alors un vrai oubli de champ.
  return deepFreeze({
    version: 1,
    source: detectSource(source),
    content: shell.content as CanonicalContent,
    format: shell.format as CanonicalFormat,
    media: shell.media as CanonicalMedia,
    cards: shell.cards as CanonicalCards,
    sequences: shell.sequences as CanonicalSequences | undefined,
    branding: shell.branding as CanonicalBranding | undefined,
    audio: shell.audio as CanonicalAudio,
    overlays: shell.overlays as CanonicalOverlays,
    designOptions: shell.designOptions as CanonicalDesignOptions | undefined,
    passthrough,
    present,
  });
}
