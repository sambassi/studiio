import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase avant d'importer le module
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
      insert: vi.fn(),
    })),
  },
}));

import { getVideoRenderCost } from '@/lib/credits/system';
import { RENDER_COSTS } from '@/lib/stripe/constants';

describe('Credits System', () => {
  describe('getVideoRenderCost', () => {
    it('doit retourner 10 crédits pour un Reel', () => {
      expect(getVideoRenderCost('reel')).toBe(10);
    });

    it('doit retourner 15 crédits pour un TV', () => {
      expect(getVideoRenderCost('tv')).toBe(15);
    });

    it('doit correspondre exactement aux RENDER_COSTS', () => {
      expect(getVideoRenderCost('reel')).toBe(RENDER_COSTS.reel);
      expect(getVideoRenderCost('tv')).toBe(RENDER_COSTS.tv);
    });
  });
});
