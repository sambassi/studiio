import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AUTOSAVE_KEY_CREER,
  AUTOSAVE_VERSION,
  markAutosave,
  readAutosave,
  clearAutosave,
  formatAutosaveAge,
} from '@/lib/creer/autosave';

/** Cle historique des preferences de design de l'editeur. */
const PREFS_KEY = 'studiio-creer-design-prefs';

describe('Marqueur d auto-sauvegarde — cohabitation avec les preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('utilise une cle SEPAREE et versionnee', () => {
    expect(AUTOSAVE_KEY_CREER).toBe('studiio:autosave:v1:creer');
    expect(AUTOSAVE_KEY_CREER).not.toBe(PREFS_KEY);
    expect(AUTOSAVE_KEY_CREER).toContain(`v${AUTOSAVE_VERSION}`);
  });

  it('n ecrit jamais dans la cle des preferences', () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ titleColor: '#fff' }));
    markAutosave(AUTOSAVE_KEY_CREER, 1_000);
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!)).toEqual({ titleColor: '#fff' });
  });

  it('effacer le marqueur laisse les preferences intactes', () => {
    // C'est LA garantie du « vider apres export » : le montage exporte ne
    // doit pas emporter les couleurs et polices choisies par l'utilisateur.
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ titleColor: '#fff' }));
    markAutosave(AUTOSAVE_KEY_CREER, 1_000);

    clearAutosave(AUTOSAVE_KEY_CREER);

    expect(window.localStorage.getItem(AUTOSAVE_KEY_CREER)).toBeNull();
    expect(window.localStorage.getItem(PREFS_KEY)).not.toBeNull();
  });
});

describe('Marqueur d auto-sauvegarde — lecture defensive', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ecrit puis relit l horodatage', () => {
    expect(markAutosave(AUTOSAVE_KEY_CREER, 1_720_000_000_000)).toBe(true);
    expect(readAutosave(AUTOSAVE_KEY_CREER)).toEqual({
      version: AUTOSAVE_VERSION,
      savedAt: 1_720_000_000_000,
    });
  });

  it('absence de marqueur : null, et surtout aucune exception', () => {
    expect(readAutosave(AUTOSAVE_KEY_CREER)).toBeNull();
  });

  it('contenu illisible ou incoherent : null, jamais d exception', () => {
    const bad = [
      'pas du json',
      'null',
      '{}',
      JSON.stringify({ version: 99, savedAt: 1 }),        // autre version
      JSON.stringify({ version: AUTOSAVE_VERSION }),       // horodatage absent
      JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: 'hier' }),
      JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: 0 }),
      JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: -5 }),
      JSON.stringify({ version: AUTOSAVE_VERSION, savedAt: Number.NaN }),
    ];
    for (const raw of bad) {
      window.localStorage.setItem(AUTOSAVE_KEY_CREER, raw);
      expect(readAutosave(AUTOSAVE_KEY_CREER), raw.slice(0, 40)).toBeNull();
    }
  });

  it('quota depasse : renvoie false au lieu de casser l editeur', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => markAutosave(AUTOSAVE_KEY_CREER)).not.toThrow();
    expect(markAutosave(AUTOSAVE_KEY_CREER)).toBe(false);
    spy.mockRestore();
  });

  it('lecture qui echoue (mode prive) : null, sans exception', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => readAutosave(AUTOSAVE_KEY_CREER)).not.toThrow();
    expect(readAutosave(AUTOSAVE_KEY_CREER)).toBeNull();
    spy.mockRestore();
  });

  it('effacement qui echoue : silencieux, sans exception', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => clearAutosave(AUTOSAVE_KEY_CREER)).not.toThrow();
    spy.mockRestore();
  });
});

describe('Marqueur d auto-sauvegarde — rendu serveur', () => {
  const realWindow = globalThis.window;
  afterEach(() => {
    globalThis.window = realWindow;
  });

  it('sans window, les trois operations sont inertes', () => {
    // @ts-expect-error simulation du rendu serveur Next.js
    delete globalThis.window;
    expect(markAutosave(AUTOSAVE_KEY_CREER)).toBe(false);
    expect(readAutosave(AUTOSAVE_KEY_CREER)).toBeNull();
    expect(() => clearAutosave(AUTOSAVE_KEY_CREER)).not.toThrow();
  });
});

describe('Age lisible', () => {
  const t0 = 1_720_000_000_000;
  it('arrondit par paliers utiles', () => {
    expect(formatAutosaveAge(t0, t0)).toBe("a l'instant");
    expect(formatAutosaveAge(t0, t0 + 30_000)).toBe("a l'instant");
    expect(formatAutosaveAge(t0, t0 + 120_000)).toBe('il y a 2 min');
    expect(formatAutosaveAge(t0, t0 + 3 * 3_600_000)).toBe('il y a 3 h');
    expect(formatAutosaveAge(t0, t0 + 26 * 3_600_000)).toBe('hier');
    expect(formatAutosaveAge(t0, t0 + 3 * 86_400_000)).toBe('il y a 3 jours');
  });

  it('une horloge qui recule ne produit pas d age negatif', () => {
    expect(formatAutosaveAge(t0, t0 - 60_000)).toBe("a l'instant");
  });
});
