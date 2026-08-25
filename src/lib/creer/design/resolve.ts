/**
 * `resolveCanonicalDesign` — vue COMPLETE, pour l'affichage et le rendu.
 *
 * Applique les defauts d'affichage par-dessus les valeurs enregistrees. Le
 * resultat n'est JAMAIS reecrit en base : c'est `toPostMetadata`, qui lit le
 * design brut et non cette vue, qui decide de ce qui est persiste.
 */

import { DEFAULT_CANONICAL_DESIGN } from './defaults';
import { deepClone, deepFreeze, isPlainObject, safeAssign } from './internal';
import type { CanonicalDesign, ResolvedCanonicalDesign } from './types';

/**
 * Fusionne un groupe enregistre avec ses defauts.
 *
 * Deux regles, et seulement deux :
 *
 *   - `undefined` (champ absent) laisse le defaut en place ;
 *   - `null` laisse le defaut en place UNIQUEMENT si le defaut n'est pas
 *     lui-meme nul. Un `rushUrls: null` herite donc de `[]`, et un
 *     `sequences.intro: null` de `5` — sans quoi la vue promettrait un
 *     nombre et livrerait `null` au compositeur. Un `posterUrl: null`, dont
 *     le defaut est deja `null`, reste nul : l'absence d'affiche est une
 *     information, pas une lacune.
 *
 * Toute cle inconnue du defaut est recopiee telle quelle : c'est ce qui fait
 * traverser les extensions futures jusqu'a l'affichage.
 */
function mergeGroup(
  stored: unknown,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = deepClone(defaults);
  if (!isPlainObject(stored)) return out;
  for (const key of Object.keys(stored)) {
    const value = stored[key];
    if (value === undefined) continue;
    if (value === null && key in defaults && defaults[key] !== null && defaults[key] !== undefined) {
      continue;
    }
    safeAssign(out, key, deepClone(value));
  }
  return out;
}

/**
 * Design entierement renseigne, gele.
 *
 * Deterministe : memes entrees, meme sortie, sans horloge ni aleatoire.
 */
export function resolveCanonicalDesign(design: CanonicalDesign): ResolvedCanonicalDesign {
  const d = DEFAULT_CANONICAL_DESIGN as unknown as Record<string, Record<string, unknown>>;
  return deepFreeze({
    version: 1,
    source: design.source,
    content: mergeGroup(design.content, d.content),
    format: mergeGroup(design.format, d.format),
    media: mergeGroup(design.media, d.media),
    cards: mergeGroup(design.cards, d.cards),
    sequences: mergeGroup(design.sequences, d.sequences),
    branding: mergeGroup(design.branding, d.branding),
    audio: mergeGroup(design.audio, d.audio),
    overlays: mergeGroup(design.overlays, d.overlays),
    designOptions: mergeGroup(design.designOptions, d.designOptions),
  } as unknown as ResolvedCanonicalDesign);
}
