// @vitest-environment node
/**
 * M2-a — Fiches de contenu côté serveur : cache DURABLE (MinIO doublé en
 * mémoire), clé dérivée de la session, isolation entre comptes, dégradé
 * silencieux. Aucun réseau, aucune IA.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ficheContenuServeur,
  fichesContenuServeur,
  cleFicheContenu,
  ABSENT,
  type StockageFiches,
} from '@/lib/creer/fiche-contenu-serveur';
import { cibleRecevable, cibleLisibleParCompte, cleDansNamespaceAnalyse } from '@/lib/storage/acces-objet';
import { estFichierDurable } from '@/lib/storage/bibliotheque';
import { attributionPourStockage } from '@/lib/stock/importer';
import { memoriserRequeteStock, requeteStockMemorisee, viderRequetesStock } from '@/lib/stock/requetes-memo';
import type { MediaStock } from '@/lib/stock/types';

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PUB = '/storage/v1/object/public';
const STOCK_A = `${PUB}/media/${A}/library/stock-pexels-video-8955360.mp4`;
const PERSO_A = `${PUB}/media/${A}/library/converted_1791985445290.mp4`;
const STOCK_B = `${PUB}/media/${B}/library/stock-pexels-video-8955360.mp4`;

/** MinIO en mémoire, avec compteurs et pannes injectables. */
function memoire(objets: Record<string, { taille?: number; json?: unknown }> = {}) {
  const store = new Map(Object.entries(objets));
  const appels = { taille: 0, lire: [] as string[], ecrire: [] as string[] };
  const pannes = { taille: false, lire: false, ecrire: false };
  const s: StockageFiches = {
    async taille(b, c) { appels.taille++; if (pannes.taille) throw new Error('ECONNREFUSED'); const o = store.get(`${b}/${c}`); return o?.taille ?? ABSENT; },
    async lireJson(b, c) { appels.lire.push(`${b}/${c}`); if (pannes.lire) throw new Error('timeout'); const o = store.get(`${b}/${c}`); return o && 'json' in o ? JSON.parse(JSON.stringify(o.json)) : ABSENT; },
    async ecrireJson(b, c, v) { appels.ecrire.push(`${b}/${c}`); if (pannes.ecrire) throw new Error('AccessDenied'); store.set(`${b}/${c}`, { json: v }); },
  };
  return { s, store, appels, pannes };
}

const ATTRIBUTION = {
  provider: 'pexels', providerAssetId: '8955360', type: 'video', auteur: 'X', auteurUrl: null,
  sourceUrl: 'https://www.pexels.com/video/women-dancing-in-a-studio-8955360/', licence: 'Licence Pexels',
  attribution: 'Vidéo de X sur Pexels', largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: 8, url: 'u', importeLe: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro'); });

describe('clé et emplacement', () => {
  it('clé stable : compte de la session + empreinte de l’objet + taille + version', () => {
    const k = cleFicheContenu(A, 'media', `${A}/library/x.mp4`, 1234);
    expect(k).toMatch(new RegExp(`^fiches-contenu/${A}/analyse/[0-9a-f]{40}\\.1234\\.v1\\.json$`));
    expect(cleFicheContenu(A, 'media', `${A}/library/x.mp4`, 1234)).toBe(k);
    expect(cleFicheContenu(A, 'media', `${A}/library/x.mp4`, 1235)).not.toBe(k); // fichier remplacé
    expect(cleFicheContenu(B, 'media', `${A}/library/x.mp4`, 1234)).not.toBe(k);
  });
  it('objet PRIVÉ : refusé par le relais public et par toute lecture au nom d’un compte ; durable', () => {
    const k = cleFicheContenu(A, 'media', `${A}/library/x.mp4`, 1234);
    expect(cleDansNamespaceAnalyse('media', k)).toBe(true);
    expect(cibleRecevable('media', k)).toBe(false);
    expect(cibleLisibleParCompte('media', k, A)).toBe(false);
    expect(estFichierDurable(`media/${k}`)).toBe(true);
    // Un envoi navigateur (toujours sous `<userId>/`) n'imite pas une fiche durable.
    expect(estFichierDurable(`media/${A}/library/fiches-contenu/${A}/analyse/${'a'.repeat(40)}.1.v1.json`)).toBe(false);
  });
});

describe('cache durable : 2e ouverture sans recalcul', () => {
  it('1re ouverture calcule et écrit ; 2e relit (aucun calcul, aucune relecture d’attribution)', async () => {
    const m = memoire({
      [`media/${A}/library/stock-pexels-video-8955360.mp4`]: { taille: 5_000_000 },
      [`media/stock-attributions/${A}/stock-pexels-video-8955360.mp4.json`]: { json: ATTRIBUTION },
    });
    const onCalcul = vi.fn();
    const r1 = await ficheContenuServeur(STOCK_A, A, { stockage: m.s, onCalcul });
    expect(r1?.depuisCache).toBe(false);
    expect(r1?.fiche.categories.map((c) => [c.id, c.confiance, c.sources.join()])).toEqual([['dance', 'elevee', 'pexels-description'], ['studio', 'elevee', 'pexels-description']]);
    expect(m.appels.ecrire).toEqual([`media/${cleFicheContenu(A, 'media', `${A}/library/stock-pexels-video-8955360.mp4`, 5_000_000)}`]);
    const lecturesAvant = m.appels.lire.length;
    const r2 = await ficheContenuServeur(STOCK_A, A, { stockage: m.s, onCalcul });
    expect(r2).toEqual({ fiche: r1!.fiche, depuisCache: true });
    expect(onCalcul).toHaveBeenCalledTimes(1);
    expect(m.appels.lire.slice(lecturesAvant)).toEqual([`media/${cleFicheContenu(A, 'media', `${A}/library/stock-pexels-video-8955360.mp4`, 5_000_000)}`]);
    expect(m.appels.ecrire).toHaveLength(1);
  });

  it('import : `recalculer` réécrit la fiche avec l’attribution enrichie (requête)', async () => {
    const m = memoire({ [`media/${A}/library/stock-pexels-video-8955360.mp4`]: { taille: 10 }, [`media/stock-attributions/${A}/stock-pexels-video-8955360.mp4.json`]: { json: ATTRIBUTION } });
    await ficheContenuServeur(STOCK_A, A, { stockage: m.s });
    m.store.set(`media/stock-attributions/${A}/stock-pexels-video-8955360.mp4.json`, { json: { ...ATTRIBUTION, description: 'women dancing in a studio', requete: 'dance workout' } });
    const r = await ficheContenuServeur(STOCK_A, A, { stockage: m.s, recalculer: true });
    expect(r?.fiche.categories.find((c) => c.id === 'dance')?.sources).toEqual(['pexels-description', 'pexels-requete']);
    const relue = await ficheContenuServeur(STOCK_A, A, { stockage: m.s });
    expect(relue).toEqual({ fiche: r!.fiche, depuisCache: true });
  });

  it('fiche du cache invalide (forme inconnue) → recalculée, jamais servie', async () => {
    const cle = cleFicheContenu(A, 'media', `${A}/library/converted_1791985445290.mp4`, 7);
    const m = memoire({ [`media/${A}/library/converted_1791985445290.mp4`]: { taille: 7 }, [`media/${cle}`]: { json: { version: 1, categories: [{ id: 'football', confiance: 'elevee', sources: ['vision'] }], parole: 'oui', inconnus: [], source: 'x' } } });
    const r = await ficheContenuServeur(PERSO_A, A, { stockage: m.s });
    expect(r).toEqual({ fiche: { version: 1, categories: [], parole: 'inconnu', inconnus: ['objets', 'lieu', 'action', 'personnes'], source: 'aucun indice fiable' }, depuisCache: false });
  });

  it('parole : énergie mesurée complète une fiche relue, en mémoire seulement', async () => {
    const m = memoire({ [`media/${A}/library/stock-pexels-video-8955360.mp4`]: { taille: 10 }, [`media/stock-attributions/${A}/stock-pexels-video-8955360.mp4.json`]: { json: ATTRIBUTION } });
    await ficheContenuServeur(STOCK_A, A, { stockage: m.s });
    const r = await ficheContenuServeur(STOCK_A, A, { stockage: m.s, energieAudio: [0, 0, 0, 0] });
    expect(r?.depuisCache).toBe(true);
    expect(r?.fiche.parole).toBe('improbable');
    expect(m.appels.ecrire).toHaveLength(1);
  });
});

describe('dégradé : MinIO en panne → fiche en mémoire, jamais d’erreur', () => {
  it.each(['taille', 'lire', 'ecrire'] as const)('panne %s', async (panne) => {
    const m = memoire({ [`media/${A}/library/stock-pexels-video-8955360.mp4`]: { taille: 10 }, [`media/stock-attributions/${A}/stock-pexels-video-8955360.mp4.json`]: { json: ATTRIBUTION } });
    m.pannes[panne] = true;
    const r = await ficheContenuServeur(STOCK_A, A, { stockage: m.s });
    expect(r?.depuisCache).toBe(false);
    expect(r?.fiche.version).toBe(1);
    // Attribution illisible (panne) : la fiche n'est pas figée sans elle.
    if (panne === 'lire') expect(m.appels.ecrire).toEqual([]);
  });
  it('sans MinIO configuré (stockage réel, aucune variable) : fiche en mémoire', async () => {
    vi.stubEnv('MINIO_SECRET_KEY', '');
    vi.stubEnv('MINIO_ROOT_PASSWORD', '');
    const r = await ficheContenuServeur(PERSO_A, A);
    expect(r).toEqual({ fiche: expect.objectContaining({ categories: [], parole: 'inconnu' }), depuisCache: false });
  });
  it('lot borné par un délai global : les fiches non obtenues valent null', async () => {
    const lent: StockageFiches = { taille: () => new Promise(() => {}), lireJson: async () => ABSENT, ecrireJson: async () => {} };
    const t0 = Date.now();
    const r = await fichesContenuServeur([STOCK_A, PERSO_A], A, { stockage: lent, delaiMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toEqual([{ url: STOCK_A, fiche: null, depuisCache: false }, { url: PERSO_A, fiche: null, depuisCache: false }]);
  });
});

describe('isolation entre comptes', () => {
  it('le rush de B demandé par A : refusé, rien n’est lu ni écrit', async () => {
    const m = memoire({ [`media/${B}/library/stock-pexels-video-8955360.mp4`]: { taille: 10 }, [`media/stock-attributions/${B}/stock-pexels-video-8955360.mp4.json`]: { json: ATTRIBUTION } });
    expect(await ficheContenuServeur(STOCK_B, A, { stockage: m.s })).toBeNull();
    expect(m.appels).toEqual({ taille: 0, lire: [], ecrire: [] });
  });
  it('la fiche de A n’est jamais servie à B, même pour un objet partagé de même nom', async () => {
    const m = memoire({
      [`media/${A}/library/stock-pexels-video-8955360.mp4`]: { taille: 10 },
      [`media/${B}/library/stock-pexels-video-8955360.mp4`]: { taille: 10 },
      [`media/stock-attributions/${A}/stock-pexels-video-8955360.mp4.json`]: { json: ATTRIBUTION },
    });
    await ficheContenuServeur(STOCK_A, A, { stockage: m.s });
    const n = m.appels.lire.length;
    const rb = await ficheContenuServeur(STOCK_B, B, { stockage: m.s });
    expect(rb?.depuisCache).toBe(false);
    expect(rb?.fiche.categories).toEqual([]); // l'attribution de A n'est pas lue pour B
    expect(m.appels.lire.slice(n).every((k) => k.includes(`/${B}/`) && !k.includes(A))).toBe(true);
    expect(m.appels.ecrire.every((k, i) => k.startsWith(`media/fiches-contenu/${i === 0 ? A : B}/analyse/`))).toBe(true);
  });
  it('namespace privé ou traversée : refus', async () => {
    const m = memoire();
    for (const u of [`${PUB}/media/${A}/analyse/x/vignette-01.jpg`, `${PUB}/media/fiches-contenu/${A}/analyse/x.json`, `${PUB}/media/${A}/../${B}/library/x.mp4`]) {
      expect(await ficheContenuServeur(u, A, { stockage: m.s })).toBeNull();
    }
    expect(m.appels.taille).toBe(0);
  });
});

describe('attribution à l’import : ajout de description et requête, rien d’autre', () => {
  const media: MediaStock = {
    id: 'pexels-video-42', provider: 'pexels', providerAssetId: '42', type: 'video', largeur: 1080, hauteur: 1920, orientation: 'portrait',
    vignetteUrl: '', apercuUrl: '', fichierUrl: 'https://videos.pexels.com/x.mp4', sourceUrl: 'https://www.pexels.com/video/woman-dancing-42/',
    auteur: 'Ana', description: 'woman dancing', licence: 'Licence Pexels', attribution: 'Vidéo de Ana sur Pexels',
  };
  it('mêmes champs qu’avant + description + requête (si connue)', () => {
    const avant = ['provider', 'providerAssetId', 'type', 'auteur', 'auteurUrl', 'sourceUrl', 'licence', 'attribution', 'largeur', 'hauteur', 'orientation', 'dureeSecondes', 'url', 'importeLe'];
    expect(Object.keys(attributionPourStockage(media, 'u'))).toEqual([...avant, 'description']);
    expect(attributionPourStockage(media, 'u', { requete: 'dance workout' })).toMatchObject({ description: 'woman dancing', requete: 'dance workout' });
    expect(Object.keys(attributionPourStockage({ ...media, description: '' }, 'u'))).toEqual(avant);
  });
  it('requête retenue par le SERVEUR pour ce compte seulement', () => {
    viderRequetesStock();
    memoriserRequeteStock(A, ['pexels-video-42'], 'dance workout');
    expect(requeteStockMemorisee(A, 'pexels-video-42')).toBe('dance workout');
    expect(requeteStockMemorisee(B, 'pexels-video-42')).toBeNull();
    expect(requeteStockMemorisee(A, 'pexels-video-43')).toBeNull();
  });
});
