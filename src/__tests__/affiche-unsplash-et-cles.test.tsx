/**
 * Deux petites dettes fermées :
 *  - (9) choisir une photo UNSPLASH comme affiche (recherche `/api/pexels`,
 *    `source=both`) signale le téléchargement à Unsplash par le chemin
 *    existant `POST /api/stock/importer` — hotlink conservé ;
 *  - (16) la barre de formatage du texte ne déclenche plus l'avertissement
 *    React « unique key » (boutons d'alignement rendus par un `.map`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render } from '@testing-library/react';
import { idUnsplashAffiche, signalerChoixAfficheUnsplash } from '@/lib/stock/client';
import TextFormatToolbar from '@/components/creer/TextFormatToolbar';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('affiche Unsplash : téléchargement signalé', () => {
  it('identifiant : seulement une photo Unsplash, préfixe retiré, forme bornée', () => {
    expect(idUnsplashAffiche({ id: 'unsplash-AbC_12-x', source: 'unsplash' })).toBe('AbC_12-x');
    expect(idUnsplashAffiche({ id: 'pexels-123', source: 'pexels' })).toBeNull();
    expect(idUnsplashAffiche({ id: 'ia-1', source: 'upload' })).toBeNull();
    expect(idUnsplashAffiche({ id: 'unsplash-../../x', source: 'unsplash' })).toBeNull();
  });

  it('photo Unsplash : POST /api/stock/importer { provider: unsplash, type: photo, providerAssetId }', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, url: 'https://images.unsplash.com/x', importe: false, media: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(signalerChoixAfficheUnsplash({ id: 'unsplash-k9', source: 'unsplash' })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/stock/importer');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'unsplash', type: 'photo', providerAssetId: 'k9' });
  });

  it('photo Pexels : aucun appel ; panne réseau : jamais d’exception', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('réseau'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(signalerChoixAfficheUnsplash({ id: 'pexels-1', source: 'pexels' })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(signalerChoixAfficheUnsplash({ id: 'unsplash-k9', source: 'unsplash' })).resolves.toBe(false);
  });

  it('Créer : la grille d’affiches signale le choix AVANT de poser l’URL (hotlink), jamais au dé-choix', () => {
    const src = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    const i = src.indexOf('if (choisit) void signalerChoixAfficheUnsplash(photo);');
    expect(i).toBeGreaterThan(0);
    const bloc = src.slice(src.lastIndexOf('onClick={() => {', i), src.indexOf('data-poster-photo={photo.url}', i));
    // Signalé avant toute pose, et la pose garde l'URL du fournisseur.
    expect(bloc.indexOf('signalerChoixAfficheUnsplash')).toBeLessThan(bloc.indexOf('assignerAffiche(slotCible, photo.url)'));
    expect(bloc).toContain('setPosterUrl(retenue ? null : photo.url)');
    expect(bloc).toContain(': !retenue');
  });
});

describe('TextFormatToolbar : aucune clé React manquante ou dupliquée', () => {
  it('rendu sans avertissement « key »', () => {
    const erreurs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { erreurs.push(a.map(String).join(' ')); });
    render(
      <TextFormatToolbar
        zone="titre"
        valeurs={{}}
        defauts={{ textCase: 'uppercase', align: 'center' }}
        onChange={() => {}}
      />,
    );
    expect(erreurs.filter((e) => /key/i.test(e))).toEqual([]);
  });
});
