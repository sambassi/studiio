import { describe, it, expect, vi } from 'vitest';
import { construireRecherchesStock } from '@/lib/stock/requetes';
import { CacheStock, rankStockResults, searchStockMedia, selectStockForMissingCoverage } from '@/lib/stock/service';
import { analyserCouvertureRushes, plansAutopilote } from '@/lib/stock/couverture';
import { choisirFichierVideo, type DependancesStock } from '@/lib/stock/fournisseurs';
import { importerMediaStock } from '@/lib/stock/importer';
import type { MediaStock } from '@/lib/stock/types';

/**
 * MOTEUR STOCK COMMUN — aucun fournisseur réel : `fetch` est simulé partout.
 */

const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);

function videoPexels(id: number, w: number, h: number, slug = 'woman-dancing', duree = 12) {
  return {
    id, width: w, height: h, duration: duree, url: `https://www.pexels.com/video/${slug}-${id}/`, image: `https://images.pexels.com/videos/${id}/a.jpg`,
    user: { name: 'Ana', url: 'https://www.pexels.com/@ana' },
    video_pictures: [{ picture: `https://images.pexels.com/videos/${id}/p.jpg` }],
    video_files: [
      { link: `https://videos.pexels.com/video-files/${id}/uhd.mp4`, file_type: 'video/mp4', width: w * 2, height: h * 2 },
      { link: `https://videos.pexels.com/video-files/${id}/hd.mp4`, file_type: 'video/mp4', width: w, height: h },
    ],
  };
}
function photoUnsplash(id: string, w: number, h: number) {
  return {
    id, width: w, height: h, alt_description: 'group dance class',
    urls: { regular: `https://images.unsplash.com/${id}?w=1080`, small: `https://images.unsplash.com/${id}?w=400`, thumb: `https://images.unsplash.com/${id}?w=200` },
    links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download` },
    user: { name: 'Bo', links: { html: 'https://unsplash.com/@bo' } },
  };
}

function deps(routes: (url: string) => Response | Promise<Response>): DependancesStock & { appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    cles: { pexels: 'k-pexels', unsplash: 'k-unsplash' },
    fetch: vi.fn(async (u: unknown) => { appels.push(String(u)); return routes(String(u)); }) as unknown as typeof fetch,
  };
}

describe('construireRecherchesStock — déterministe, sans IA', () => {
  it('Afroboost / cardio-danse + « Le groupe danse avec énergie » → recherches pertinentes en anglais', () => {
    const r = construireRecherchesStock({ sujet: 'Afroboost / sport / cardio-danse', texte: 'Le groupe danse avec énergie', role: 'video', format: '9:16' });
    expect(r.type).toBe('video');
    expect(r.orientation).toBe('portrait');
    expect(r.requetes).toEqual(expect.arrayContaining(['african dance workout group', 'cardio dance fitness', 'energetic group workout', 'dance class movement']));
    expect(r.requetes.some((q) => /dancing/.test(q))).toBe(true);
    expect(r.requetes.length).toBeLessThanOrEqual(5);
    // Même entrée → mêmes suggestions.
    expect(construireRecherchesStock({ sujet: 'Afroboost / sport / cardio-danse', texte: 'Le groupe danse avec énergie', role: 'video', format: '9:16' })).toEqual(r);
  });

  it('le format décide de l’orientation ; une séquence titre/cartes/CTA cherche une photo d’arrière-plan', () => {
    expect(construireRecherchesStock({ sujet: 'yoga', format: '16:9' }).orientation).toBe('landscape');
    expect(construireRecherchesStock({ sujet: 'yoga', format: '1:1' }).orientation).toBe('square');
    const t = construireRecherchesStock({ sujet: 'yoga du matin', role: 'titre', format: '9:16' });
    expect(t.type).toBe('photo');
    expect(t.requetes.some((q) => q.includes('background'))).toBe(true);
  });

  it('rien de reconnu → les mots du sujet, jamais une liste vide', () => {
    expect(construireRecherchesStock({ sujet: 'Kizomba Lisbonne' }).requetes[0]).toBe('kizomba lisbonne');
  });
});

describe('searchStockMedia — capacités, format, pannes, cache', () => {
  const reseau = () => deps((u) => {
    if (u.includes('api.pexels.com/videos/search')) return json({ videos: [videoPexels(1, 1920, 1080, 'beach-landscape'), videoPexels(2, 1080, 1920, 'woman-dancing')] });
    if (u.includes('api.pexels.com/v1/search')) return json({ photos: [] });
    if (u.includes('api.unsplash.com/search/photos')) return json({ results: [photoUnsplash('u1', 4000, 6000)] });
    return json({}, 404);
  });

  it('⚠️ vidéo : Unsplash n’est JAMAIS interrogé (photos seulement) ; 9:16 → vertical en premier, paysage gardé après', async () => {
    const d = reseau();
    const r = await searchStockMedia({ requete: 'woman dancing', type: 'video', format: '9:16' }, d, new CacheStock());
    expect(d.appels.some((u) => u.includes('unsplash'))).toBe(false);
    expect(r.medias.map((m) => m.providerAssetId)).toEqual(['2', '1']);
    expect(r.medias.every((m) => m.type === 'video')).toBe(true);
    // Fichier ≤ 1080p retenu, pas l'UHD ; provenance complète conservée.
    expect(r.medias[0]).toMatchObject({ provider: 'pexels', fichierUrl: 'https://videos.pexels.com/video-files/2/hd.mp4', auteur: 'Ana', sourceUrl: 'https://www.pexels.com/video/woman-dancing-2/', orientation: 'portrait', licence: 'Licence Pexels' });
  });

  it('16:9 → paysage en premier', async () => {
    const r = await searchStockMedia({ requete: 'beach', type: 'video', format: '16:9' }, reseau(), new CacheStock());
    expect(r.medias[0].providerAssetId).toBe('1');
  });

  it('⚠️ Pexels en panne : pas d’exception, Unsplash répond, l’échec est signalé', async () => {
    const d = deps((u) => (u.includes('pexels') ? json({}, 503) : json({ results: [photoUnsplash('u1', 3000, 4000)] })));
    const r = await searchStockMedia({ requete: 'dance', type: 'photo', format: '9:16' }, d, new CacheStock());
    expect(r.medias.map((m) => m.provider)).toEqual(['unsplash']);
    expect(r.medias[0].downloadLocation).toBe('https://api.unsplash.com/photos/u1/download');
    expect(r.echecs).toEqual([{ provider: 'pexels', motif: 'indisponible' }]);
  });

  it('⚠️ Unsplash quota + Pexels coupé réseau : liste vide, deux échecs, aucune exception', async () => {
    const d = deps((u) => { if (u.includes('pexels')) throw new Error('ECONNRESET'); return json({}, 429); });
    const r = await searchStockMedia({ requete: 'dance', type: 'photo', format: '9:16' }, d, new CacheStock());
    expect(r.medias).toEqual([]);
    expect(r.echecs).toEqual([{ provider: 'pexels', motif: 'indisponible' }, { provider: 'unsplash', motif: 'quota' }]);
  });

  it('⚠️ cache : 10 recherches identiques → 1 seul appel par fournisseur ; un échec n’est pas gardé', async () => {
    const d = reseau();
    const cache = new CacheStock();
    await Promise.all(Array.from({ length: 10 }, () => searchStockMedia({ requete: 'Woman  dancing', type: 'video', format: '9:16' }, d, cache)));
    expect(d.appels.filter((u) => u.includes('videos/search'))).toHaveLength(1);

    let tomber = true;
    const d2 = deps(() => (tomber ? json({}, 500) : json({ videos: [videoPexels(3, 1080, 1920)] })));
    const c2 = new CacheStock();
    expect((await searchStockMedia({ requete: 'x', type: 'video', format: '9:16' }, d2, c2)).medias).toHaveLength(0);
    tomber = false;
    expect((await searchStockMedia({ requete: 'x', type: 'video', format: '9:16' }, d2, c2)).medias).toHaveLength(1);
  });

  it('la recherche ne télécharge AUCUN fichier vidéo (métadonnées seulement)', async () => {
    const d = reseau();
    await searchStockMedia({ requete: 'woman dancing', type: 'video', format: '9:16' }, d, new CacheStock());
    expect(d.appels.some((u) => u.includes('video-files'))).toBe(false);
  });

  it('choisirFichierVideo garde le plus grand ≤ 1080p', () => {
    expect(choisirFichierVideo([
      { link: 'a', file_type: 'video/mp4', width: 3840, height: 2160 },
      { link: 'b', file_type: 'video/mp4', width: 1920, height: 1080 },
      { link: 'c', file_type: 'video/mp4', width: 640, height: 360 },
    ])?.link).toBe('b');
  });
});

describe('rankStockResults', () => {
  const m = (id: string, o: MediaStock['orientation'], description = '', type: MediaStock['type'] = 'video'): MediaStock => ({
    id, provider: 'pexels', providerAssetId: id, type, largeur: 1080, hauteur: 1920, orientation: o, vignetteUrl: '', apercuUrl: '', fichierUrl: '', sourceUrl: '', auteur: '', description, licence: '', attribution: '',
  });
  it('pertinence : à orientation égale, la description qui reprend la recherche passe devant ; les déjà-pris sont exclus', () => {
    const r = rankStockResults([m('a', 'portrait', 'man running city'), m('b', 'portrait', 'group dance workout'), m('c', 'portrait', 'group dance')], {
      format: '9:16', type: 'video', requete: 'group dance workout', exclus: new Set(['c']),
    });
    expect(r.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('analyserCouvertureRushes — explicable, sans seuil arbitraire', () => {
  const sujet = 'cours Afroboost cardio-danse';
  const quatre = [
    { cle: 's1', role: 'HOOK' as const, texte: 'Bienvenue au cours Afroboost' },
    { cle: 's2', role: 'BUILD' as const, texte: 'Le groupe danse avec énergie' },
    { cle: 's3', role: 'PEAK' as const, texte: 'Afroboost permet de travailler le cardio' },
    { cle: 's4', role: 'FOCUS' as const, texte: 'Une femme danse avec son casque' },
  ];

  it('⚠️ SCÉNARIO : 1 vidéo face caméra + 4 séquences → le rush utilisateur est gardé (1er plan), 3 manques avec brief', () => {
    const c = analyserCouvertureRushes({ plans: quatre, rushes: [{ url: 'https://studiio.pro/u/face.mp4', origine: 'utilisateur', dureeSecondes: 9 }], sujet, format: '9:16' });
    expect(c.couvertureSuffisante).toBe(false);
    expect(c.rushesPersonnels).toBe(1);
    expect(c.affectations).toEqual([{ sequence: 's1', rushUrl: 'https://studiio.pro/u/face.mp4', origine: 'utilisateur' }]);
    expect(c.manques.map((x) => x.sequence)).toEqual(['s2', 's3', 's4']);
    for (const x of c.manques) {
      expect(x.type).toBe('video');
      expect(x.searchQueries.length).toBeGreaterThan(0);
      expect(x.raison).toMatch(/déjà utilisés/);
    }
    expect(c.manques[0].searchQueries).toContain('energetic group workout');
    expect(c.manques[2].searchQueries.join(' ')).toMatch(/headphones/);
  });

  it('⚠️ rushes suffisants → aucun manque (donc aucune recherche stock)', () => {
    const rushes = ['a', 'b', 'c', 'd'].map((u) => ({ url: `https://x/${u}.mp4`, origine: 'utilisateur' as const, dureeSecondes: 8 }));
    const c = analyserCouvertureRushes({ plans: quatre, rushes, sujet });
    expect(c.couvertureSuffisante).toBe(true);
    expect(c.manques).toEqual([]);
  });

  it('un rush long nourrit deux plans ; priorité utilisateur > Médiathèque > stock', () => {
    const c = analyserCouvertureRushes({
      plans: quatre,
      rushes: [
        { url: 'stock', origine: 'stock', dureeSecondes: 8 },
        { url: 'mt', origine: 'mediatheque', dureeSecondes: 8 },
        { url: 'long', origine: 'utilisateur', dureeSecondes: 40 },
      ],
      sujet,
    });
    expect(c.affectations.map((a) => a.rushUrl)).toEqual(['long', 'mt', 'stock', 'long']);
    expect(c.couvertureSuffisante).toBe(true);
  });

  it('plans Autopilote = 3 phases du smart montage (RUSHS_MONTAGE_MAX)', async () => {
    const { RUSHS_MONTAGE_MAX } = await import('@/lib/autopilot/produire');
    expect(plansAutopilote('Afroboost cardio')).toHaveLength(RUSHS_MONTAGE_MAX);
  });
});

describe('selectStockForMissingCoverage — jamais bloquant, jamais deux fois le même média', () => {
  it('un média différent par manque ; une recherche qui lève → manque vide, on continue', async () => {
    const media = (id: string): MediaStock => ({ id, provider: 'pexels', providerAssetId: id, type: 'video', largeur: 1080, hauteur: 1920, orientation: 'portrait', vignetteUrl: '', apercuUrl: '', fichierUrl: '', sourceUrl: '', auteur: '', description: '', licence: '', attribution: '' });
    let n = 0;
    const r = await selectStockForMissingCoverage(
      [{ cle: 'a', type: 'video', searchQueries: ['q1'] }, { cle: 'b', type: 'video', searchQueries: ['boom', 'q2'] }, { cle: 'c', type: 'video', searchQueries: ['q3'] }],
      '9:16',
      async (d) => {
        n++;
        if (d.requete === 'boom') throw new Error('panne');
        return { medias: [media('m1'), media('m2'), media('m3')].filter((x) => !d.exclus?.has(x.id)), echecs: [], requete: d.requete };
      },
    );
    expect(r.propositions.map((p) => p.media?.id)).toEqual(['m1', 'm2', 'm3']);
    expect(r.propositions[1].requete).toBe('q2');
    expect(r.echecs).toEqual([{ provider: 'pexels', motif: 'indisponible' }]);
    expect(n).toBe(4);
  });
});

describe('importerMediaStock — sélection réelle, provenance conservée', () => {
  it('⚠️ vidéo Pexels : relue PAR IDENTIFIANT, rangée dans la Médiathèque, attribution écrite à côté', async () => {
    const d = deps((u) => {
      if (u === 'https://api.pexels.com/videos/videos/42') return json(videoPexels(42, 1080, 1920));
      if (u.startsWith('https://videos.pexels.com/')) return { ok: true, status: 200, headers: new Headers({ 'content-length': '4096' }), arrayBuffer: async () => new ArrayBuffer(4096) } as unknown as Response;
      return json({}, 404);
    });
    const ecrits: Array<{ chemin: string; contentType: string; contenu: Buffer }> = [];
    const r = await importerMediaStock('u1', { provider: 'pexels', type: 'video', providerAssetId: '42' }, d, {
      televerser: async (o) => { ecrits.push(o); return `https://studiio.pro/storage/v1/object/public/media/${o.chemin}`; },
    });
    expect(r.importe).toBe(true);
    expect(r.url).toBe('https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-42.mp4');
    expect(ecrits[0]).toMatchObject({ chemin: 'u1/library/stock-pexels-video-42.mp4', contentType: 'video/mp4' });
    const attribution = JSON.parse(ecrits[1].contenu.toString());
    expect(ecrits[1].chemin).toBe('stock-attributions/u1/stock-pexels-video-42.mp4.json');
    expect(attribution).toMatchObject({ provider: 'pexels', providerAssetId: '42', type: 'video', auteur: 'Ana', sourceUrl: 'https://www.pexels.com/video/woman-dancing-42/', licence: 'Licence Pexels', largeur: 1080, hauteur: 1920, orientation: 'portrait' });
  });

  it('⚠️ photo Unsplash : téléchargement SIGNALÉ, photo hotlinkée, rien recopié chez nous', async () => {
    const d = deps((u) => (u.endsWith('/photos/abcd1') ? json(photoUnsplash('abcd1', 3000, 4000)) : json({ url: 'x' })));
    const televerser = vi.fn();
    const r = await importerMediaStock('u1', { provider: 'unsplash', type: 'photo', providerAssetId: 'abcd1' }, d, { televerser });
    expect(d.appels).toContain('https://api.unsplash.com/photos/abcd1/download');
    expect(televerser).not.toHaveBeenCalled();
    expect(r).toMatchObject({ importe: false, url: 'https://images.unsplash.com/abcd1?w=1080' });
    expect(r.media.sourceUrl).toContain('utm_source=studiio');
  });

  it('Unsplash vidéo → refusé ; identifiant Pexels invalide → introuvable sans appel réseau', async () => {
    const d = deps(() => json({}));
    await expect(importerMediaStock('u1', { provider: 'unsplash', type: 'video', providerAssetId: 'abcd1' }, d, { televerser: vi.fn() })).rejects.toMatchObject({ code: 'invalide' });
    await expect(importerMediaStock('u1', { provider: 'pexels', type: 'video', providerAssetId: '../x' }, d, { televerser: vi.fn() })).rejects.toMatchObject({ code: 'introuvable' });
    expect(d.appels).toEqual([]);
  });
});
