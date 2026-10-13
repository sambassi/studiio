/**
 * Miniatures de rushs PRIVÉS (#554) en cache navigateur — elles ne doivent
 * survivre ni à la déconnexion, ni à 7 jours. Sur un ordinateur partagé, le
 * compte suivant ne retrouve pas sur le disque les images du précédent.
 *
 * IndexedDB est remplacée par une doublure minimale (open / get / put /
 * deleteDatabase) qui ENREGISTRE ce qui est écrit et effacé.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { obtenirVignette, viderVignettesPersistantes, vignettesPourTests, cleVignette, TTL_PERSISTANT_MS } from '@/lib/medias/vignette-video';

const bases = new Map<string, Map<string, unknown>>();
const effacees: string[] = [];
let suppressionBloquee = false;
const transaction = (store: Map<string, unknown>) => {
  const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => unknown } = {
    objectStore: () => ({
      get: (k: string) => requete(() => store.get(k)),
      put: (v: unknown, k: string) => { store.set(k, v); setTimeout(() => tx.oncomplete?.(), 0); return requete(() => undefined); },
      clear: () => { store.clear(); setTimeout(() => tx.oncomplete?.(), 0); return requete(() => undefined); },
    }),
  };
  return tx;
};
const requete = <T,>(f: () => T) => {
  const r: { result?: T; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; onupgradeneeded?: () => void } = {};
  setTimeout(() => { r.result = f(); r.onsuccess?.(); }, 0);
  return r;
};
const fauxIndexedDB = {
  open: (nom: string) => requete(() => {
    if (!bases.has(nom)) bases.set(nom, new Map());
    const store = bases.get(nom)!;
    return { createObjectStore: () => {}, close: () => {}, transaction: () => transaction(store) };
  }),
  deleteDatabase: (nom: string) => {
    if (suppressionBloquee) {
      const r: { onsuccess?: () => void; onblocked?: () => void; onerror?: () => void } = {};
      setTimeout(() => r.onblocked?.(), 0);
      return r;
    }
    return requete(() => { effacees.push(nom); bases.delete(nom); });
  },
};
vi.stubGlobal('indexedDB', fauxIndexedDB);

const URL_RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rushs/a.mp4';
const ecritures = () => [...(bases.get('studiio-vignettes')?.values() ?? [])] as Array<{ creeLe?: number }>;

beforeEach(async () => {
  // Laisse finir l'écriture persistante (asynchrone) du test précédent.
  await new Promise((r) => setTimeout(r, 10));
  bases.clear();
  effacees.length = 0;
  suppressionBloquee = false;
  vignettesPourTests.reinitialiser();
  vignettesPourTests.definirExtracteur(async () => ({ url: 'blob:x', blob: new Blob(['jpg']), ratio: 16 / 9, duree: 3 }));
});

describe('confidentialité du cache de miniatures', () => {
  it('chaque entrée persistée est datée', async () => {
    await obtenirVignette(URL_RUSH);
    await new Promise((r) => setTimeout(r, 5));
    expect(ecritures()).toHaveLength(1);
    expect(typeof ecritures()[0].creeLe).toBe('number');
  });

  it('déconnexion : la base IndexedDB est EFFACÉE et la mémoire vidée', async () => {
    await obtenirVignette(URL_RUSH);
    await viderVignettesPersistantes();
    expect(effacees).toEqual(['studiio-vignettes']);
    const extracteur = vi.fn(async () => ({ url: 'blob:y', blob: new Blob(['jpg']), ratio: 1, duree: 1 }));
    vignettesPourTests.definirExtracteur(extracteur);
    await obtenirVignette(URL_RUSH);
    expect(extracteur).toHaveBeenCalledTimes(1); // plus rien en cache
  });

  it('suppression BLOQUÉE (autre onglet) : le contenu est quand même effacé', async () => {
    await obtenirVignette(URL_RUSH);
    await new Promise((r) => setTimeout(r, 5));
    expect(ecritures()).toHaveLength(1);
    suppressionBloquee = true;
    await viderVignettesPersistantes();
    expect(effacees).toEqual([]);
    expect(ecritures()).toHaveLength(0);
  });

  it('entrée de plus de 7 jours : ignorée, la miniature est réextraite', async () => {
    bases.set('studiio-vignettes', new Map([[cleVignette(URL_RUSH), { blob: new Blob(['vieux']), ratio: 1, duree: 1, creeLe: Date.now() - TTL_PERSISTANT_MS - 1 }]]));
    const extracteur = vi.fn(async () => ({ url: 'blob:z', blob: new Blob(['neuf']), ratio: 1, duree: 1 }));
    vignettesPourTests.definirExtracteur(extracteur);
    await obtenirVignette(URL_RUSH);
    expect(extracteur).toHaveBeenCalledTimes(1);
  });
});
