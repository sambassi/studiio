/**
 * Contrat de design canonique — point d'entree unique.
 *
 * Phase 1A : le contrat existe et est teste, mais AUCUN consommateur ne
 * l'utilise encore. Aucune page, aucun composant, aucune route n'a ete
 * modifie. C'est deliberé : le contrat doit etre prouve avant d'etre branche.
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
