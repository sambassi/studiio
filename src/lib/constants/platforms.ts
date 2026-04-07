/**
 * Platform safe zones for social media overlay guides.
 *
 * Each zone uses percentage-based coordinates relative to the preview container.
 * `platform` key is used by PlatformIcon component for rendering.
 *
 * NOTE: This is a NEW file. It does NOT modify or replace any existing constant
 * in the codebase. The infographie page will import this when safe zones are integrated.
 */

export interface SafeZoneArea {
  /** Label displayed on the overlay */
  label: string;
  /** Top position as percentage */
  top: string;
  /** Right position as percentage (optional) */
  right?: string;
  /** Left position as percentage (optional) */
  left?: string;
  /** Bottom position as percentage (optional) */
  bottom?: string;
  /** Width as percentage */
  width: string;
  /** Height as percentage */
  height: string;
}

export interface PlatformSafeZone {
  /** Platform key (matches PlatformIcon) */
  platform: 'instagram' | 'tiktok' | 'youtube' | 'facebook';
  /** Brand color */
  color: string;
  /** Platform display label */
  label: string;
  /** Overlay border color for the safe zone guides */
  overlayColor: string;
  /** Array of danger zones where platform UI covers content */
  zones: SafeZoneArea[];
}

export const PLATFORM_SAFE_ZONES: Record<string, PlatformSafeZone> = {
  instagram: {
    platform: 'instagram',
    color: '#E1306C',
    label: 'Instagram',
    overlayColor: '#D91CD2',
    zones: [
      {
        label: 'Boutons',
        top: '45%',
        right: '0%',
        width: '15%',
        height: '35%',
      },
      {
        label: 'Description',
        bottom: '0%',
        left: '0%',
        width: '75%',
        height: '18%',
      },
    ],
  },
  tiktok: {
    platform: 'tiktok',
    color: '#00F2EA',
    label: 'TikTok',
    overlayColor: '#D91CD2',
    zones: [
      {
        label: 'Boutons',
        top: '35%',
        right: '0%',
        width: '15%',
        height: '45%',
      },
      {
        label: 'Description',
        bottom: '0%',
        left: '0%',
        width: '80%',
        height: '22%',
      },
    ],
  },
  youtube: {
    platform: 'youtube',
    color: '#FF0000',
    label: 'YouTube Shorts',
    overlayColor: '#D91CD2',
    zones: [
      {
        label: 'Boutons',
        top: '50%',
        right: '0%',
        width: '15%',
        height: '30%',
      },
      {
        label: 'Subscribe',
        bottom: '22%',
        right: '0%',
        width: '15%',
        height: '8%',
      },
      {
        label: 'Titre',
        bottom: '0%',
        left: '0%',
        width: '85%',
        height: '20%',
      },
    ],
  },
  facebook: {
    platform: 'facebook',
    color: '#1877F2',
    label: 'Facebook Reels',
    overlayColor: '#D91CD2',
    zones: [
      {
        label: 'Boutons',
        top: '50%',
        right: '0%',
        width: '15%',
        height: '30%',
      },
      {
        label: 'Follow',
        bottom: '18%',
        right: '0%',
        width: '15%',
        height: '6%',
      },
      {
        label: 'Description',
        bottom: '0%',
        left: '0%',
        width: '80%',
        height: '15%',
      },
    ],
  },
};

export default PLATFORM_SAFE_ZONES;
