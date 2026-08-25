/**
 * Contrat de design canonique — point d'entree unique.
 *
 * Consommateurs actuels — la mecanique de FUSION uniquement, jamais
 * l'interpretation du design :
 *
 *   - `PUT /api/posts` et `PATCH /api/posts/[id]` via `mergePostMetadata` ;
 *   - `PUT /api/videos/[id]`, indirectement, via `@/lib/videos/metadata`.
 *
 * Aucune page ni composant ne l'utilise encore : le contrat a d'abord ete
 * prouve seul, puis branche la ou une mise a jour partielle ecrasait tout.
 */

export {
  DEFAULT_CANONICAL_DESIGN,
} from './defaults';

export {
  MANAGED_FIELDS,
  MANAGED_METADATA_KEYS,
  type ManagedField,
} from './managed';

export { fromPostMetadata } from './from-post';
export { toPostMetadata, isPostMetadataUnchanged, mergePostMetadata } from './to-post';
export { resolveCanonicalDesign } from './resolve';
export { toComposerOptions } from './to-composer';

export type {
  AudioKeyframe,
  CanonicalAudio,
  CanonicalBranding,
  CanonicalCard,
  CanonicalCardGroup,
  CanonicalCards,
  CanonicalContent,
  CanonicalDesign,
  CanonicalDesignOptions,
  CanonicalFormat,
  CanonicalMedia,
  CanonicalOverlays,
  CanonicalSequenceVoiceUrls,
  CanonicalSequences,
  CanonicalSource,
  CanonicalTextCard,
  CardData,
  ComposerOptions,
  ComposerOptionsFromDesign,
  DesignOptions,
  NonSerializableDesignKey,
  OpenRecord,
  ResolvedCanonicalDesign,
} from './types';
