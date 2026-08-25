/**
 * Contrat des metadonnees de post — point d'entree unique.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PERIMETRE DE CE LOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce module lit, fusionne et reecrit `scheduled_posts.metadata` SANS PERTE.
 * Il ne parle a personne d'autre : ni au compositeur, ni a Remotion, ni au
 * Calendrier. Sa raison d'etre est la fusion sure exigee par les routes API,
 * ou un `update` brut remplace aujourd'hui la colonne `jsonb` entiere et
 * detruit toute cle que le client n'a pas renvoyee.
 *
 * Le module s'appelle `postMetadata` et non `design` : le depot compte deja
 * `designSpec.ts` (geometrie et plan de montage), `useDesignHistory.ts`,
 * `autopilot/design.ts`, `DesignOptions` et la cle `metadata.design`. Un
 * cinquieme « design » aurait ete indechiffrable.
 *
 * Consommateurs actuels — la mecanique de FUSION uniquement, jamais
 * l'interpretation du design :
 *
 *   - `PUT /api/posts` et `PATCH /api/posts/[id]` via `mergePostMetadata` ;
 *   - `PUT /api/videos/[id]`, indirectement, via `@/lib/videos/metadata`.
 *
 * Aucune page ni composant ne l'utilise encore : le contrat a d'abord ete
 * prouve seul, puis branche la ou une mise a jour partielle ecrasait tout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DETTE DOCUMENTEE — la traduction vers le compositeur, volontairement absente
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une fonction `toComposerOptions` existait dans la version d'origine de ce
 * contrat. Elle a ete RETIREE de ce lot — et non desactivee — parce qu'elle
 * portait trois defauts averes. Les voici, pour que celui qui la reecrira
 * parte de la liste plutot que du code :
 *
 *   D1. SEQUENCE VIDEO FANTOME
 *       Elle emettait toujours `cardsDuration` et `videoDuration` depuis les
 *       defauts, la ou `calendar/page.tsx` (`regenerateMontage`) force 0 en
 *       l'absence de carte ou de rush. Un post sans rush aurait gagne une
 *       sequence video vide.
 *
 *   D2. REPLI `videoUrl` CONTRAIRE AU CALENDRIER
 *       Elle retombait sur `media.videoUrl` quand `rushUrls[0]` manquait. Le
 *       Calendrier l'ignore VOLONTAIREMENT : sur les posts les plus anciens,
 *       `metadata.videoUrl` porte le MONTAGE, pas un rush. Le repli aurait
 *       reinjecte une video finale comme fond.
 *
 *   D3. CONFUSION `cardsTypography` / `cardsTextStyle`
 *       `DesignOptions.cardsTypography` designe des drapeaux de degrade,
 *       tandis que `metadata.design.typography.cards` porte
 *       `{ letterSpacing, lineHeight, bold, italic }`. La traduction
 *       confondait les deux — comme le Calendrier. `main` a depuis introduit
 *       `cardsTextStyle` pour les separer ; toute reecriture doit s'y
 *       appuyer.
 *
 * Prealable a toute reintroduction : un test de PARITE
 * `metadata.design -> ComposerOptions` compare aux quatre blocs de traduction
 * de `calendar/page.tsx`. Ce test n'existe aujourd'hui nulle part.
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
  DesignOptions,
  NonSerializableDesignKey,
  OpenRecord,
  ResolvedCanonicalDesign,
} from './types';
