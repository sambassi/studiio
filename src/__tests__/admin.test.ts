import { describe, it, expect, vi } from 'vitest';

// Mock les dépendances lourdes (auth, supabase, next/server)
vi.mock('@/lib/auth/config', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: vi.fn(() => ({ insert: vi.fn() })) },
}));
vi.mock('next/server', () => ({
  NextResponse: { json: vi.fn((body, init) => ({ body, status: init?.status })) },
}));

import { isAdmin } from '@/lib/admin';

describe('Admin System', () => {
  describe('isAdmin', () => {
    it('doit reconnaître contact.artboost@gmail.com comme admin', () => {
      expect(isAdmin('contact.artboost@gmail.com')).toBe(true);
    });

    it('doit reconnaître bassicustomshoes@gmail.com comme admin', () => {
      expect(isAdmin('bassicustomshoes@gmail.com')).toBe(true);
    });

    it('doit être insensible à la casse', () => {
      expect(isAdmin('Contact.Artboost@Gmail.com')).toBe(true);
      expect(isAdmin('BASSICUSTOMSHOES@GMAIL.COM')).toBe(true);
    });

    it('doit rejeter les emails non-admin', () => {
      expect(isAdmin('random@gmail.com')).toBe(false);
      expect(isAdmin('hacker@evil.com')).toBe(false);
    });

    it('doit gérer les valeurs nulles/undefined', () => {
      expect(isAdmin(null)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
      expect(isAdmin('')).toBe(false);
    });
  });
});
