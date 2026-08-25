/**
 * Table des champs GERES par le contrat.
 *
 * Source unique de verite pour `fromPostMetadata` et `toPostMetadata` : deux
 * listes finiraient par diverger, et un champ lu mais jamais reecrit
 * disparaitrait au premier enregistrement — silencieusement.
 *
 * `key`  : nom de la cle au premier niveau de `metadata`.
 * `path` : ou elle vit dans le `CanonicalDesign`.
 *
 * L'ordre est stable et fait foi : c'est lui qui rend `present` deterministe.
 */
export interface ManagedField {
  readonly key: string;
  readonly path: string;
}

export const MANAGED_FIELDS: readonly ManagedField[] = Object.freeze([
  // ── Contenu ────────────────────────────────────────────────────────
  { key: 'type', path: 'content.type' },
  { key: 'subtitle', path: 'content.subtitle' },
  { key: 'salesPhrase', path: 'content.salesPhrase' },
  { key: 'theme', path: 'content.theme' },
  { key: 'colorTheme', path: 'content.colorTheme' },
  // ── Format ─────────────────────────────────────────────────────────
  { key: 'videoSize', path: 'format.videoSize' },
  // ── Medias ─────────────────────────────────────────────────────────
  { key: 'posterUrl', path: 'media.posterUrl' },
  { key: 'pexelsUrl', path: 'media.pexelsUrl' },
  { key: 'videoUrl', path: 'media.videoUrl' },
  { key: 'videoImageUrl', path: 'media.videoImageUrl' },
  { key: 'rushKind', path: 'media.rushKind' },
  { key: 'rushUrls', path: 'media.rushUrls' },
  { key: 'rawVideoUrl', path: 'media.rawVideoUrl' },
  { key: 'logoUrl', path: 'media.logoUrl' },
  { key: 'characterUrl', path: 'media.characterUrl' },
  { key: 'renderedVideoUrl', path: 'media.renderedVideoUrl' },
  { key: 'thumbnailUrl', path: 'media.thumbnailUrl' },
  { key: 'composerVersion', path: 'media.composerVersion' },
  // ── Cartes ─────────────────────────────────────────────────────────
  { key: 'cards', path: 'cards.cards' },
  { key: 'textCards', path: 'cards.textCards' },
  { key: 'cardGroups', path: 'cards.cardGroups' },
  // ── Sequences ──────────────────────────────────────────────────────
  { key: 'sequences', path: 'sequences' },
  // ── Marque ─────────────────────────────────────────────────────────
  { key: 'branding', path: 'branding' },
  // ── Audio ──────────────────────────────────────────────────────────
  { key: 'musicUrl', path: 'audio.musicUrl' },
  { key: 'voiceUrl', path: 'audio.voiceUrl' },
  { key: 'musicVolume', path: 'audio.musicVolume' },
  { key: 'voiceVolume', path: 'audio.voiceVolume' },
  { key: 'hasAudio', path: 'audio.hasAudio' },
  { key: 'audioKeyframes', path: 'audio.audioKeyframes' },
  { key: 'sequenceVoiceUrls', path: 'audio.sequenceVoiceUrls' },
  // ── Incrustations video ────────────────────────────────────────────
  { key: 'videoOverlayText', path: 'overlays.videoOverlayText' },
  { key: 'overlays', path: 'overlays.overlays' },
  { key: 'overlayTextScale', path: 'overlays.overlayTextScale' },
  { key: 'overlayStartTime', path: 'overlays.overlayStartTime' },
  { key: 'overlayEndTime', path: 'overlays.overlayEndTime' },
  { key: 'overlayPosition', path: 'overlays.overlayPosition' },
  { key: 'overlayColor', path: 'overlays.overlayColor' },
  // ── Design ─────────────────────────────────────────────────────────
  { key: 'design', path: 'designOptions' },
]);

/** Les memes cles, pour trier le passthrough en une passe. */
export const MANAGED_METADATA_KEYS: ReadonlySet<string> = new Set(
  MANAGED_FIELDS.map((field) => field.key),
);
