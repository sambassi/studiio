/**
 * P0 — « REGARDER » NE DÉPEND PLUS D'UN AUTOPLAY.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PANNE QUE CES TESTS EMPÊCHENT DE REVENIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le lecteur portait `autoPlay` ET `preload="none"`. Le second ne charge rien
 * tant que la lecture n'est pas demandée ; le premier la demandait — et
 * Chrome REFUSE de démarrer une vidéo non mutée qu'aucun geste n'a réclamée.
 * Refus de la lecture = pas de chargement : mesuré en production à
 * `readyState: 0`, `buffered: 0`, indéfiniment, sur un MP4 pourtant valide et
 * encodé en `+faststart`.
 *
 * ⚠️ LA TENTATION À BLOQUER EST `muted`. Remettre l'autoplay en coupant le
 * son « répare » l'écran et démarre une vidéo que personne n'a demandée. Le
 * contrat est l'inverse : AUCUNE lecture automatique, et un chargement qui
 * part au clic. C'est le bouton natif de `controls` qui joue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

import VideosPretes from '@/components/creer/VideosPretes';

const SESSION = '11111111-1111-4111-8111-111111111111';
const RENDU = '77777777-7777-4777-8777-777777777777';
const CHEMIN = `/api/autopilot/rendus-montage/${RENDU}/fichier`;

const rendu = {
  id: RENDU, etat: 'reussie', etape: null, motif: null,
  video: { dureeSecondes: 15, largeur: 1920, hauteur: 1080, chemin: CHEMIN },
};

/** Un serveur en carton qui répond comme le vrai : une vidéo prête. */
const fetcher = async () => ({
  ok: true, status: 200,
  headers: { get: () => null },
  json: async () => ({ ok: true, rendu }),
}) as unknown as Response;

/**
 * L'espion qui compte les lectures.
 *
 * jsdom n'implémente pas `play()` — sans ce remplacement il lèverait « Not
 * implemented ». Le remplacer sert donc deux fois : le test ne casse pas, et
 * on peut affirmer qu'AUCUNE lecture n'est partie toute seule.
 */
let lectures = 0;

beforeEach(() => {
  lectures = 0;
  vi.spyOn(window.HTMLMediaElement.prototype, 'play')
    .mockImplementation(async () => { lectures += 1; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function ouvrir() {
  const rendu = render(
    <VideosPretes sessionId={SESSION} aucunRush={false} fetcher={fetcher} />,
  );
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return rendu;
}

const lecteur = (c: HTMLElement) => c.querySelector('[data-videos-lecteur]') as HTMLVideoElement;

describe('1. Le lecteur ne se monte qu’au clic', () => {
  it('1.1 avant « Regarder », aucun `<video>` — donc aucun octet demandé', async () => {
    const { container } = await ouvrir();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[data-videos-placeholder]')).not.toBeNull();
    expect(container.querySelector('[data-videos-regarder]')).not.toBeNull();
  });

  it('1.2 après le clic, le `<video>` porte l’adresse rendue par le serveur', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    const v = lecteur(container);
    expect(v).not.toBeNull();
    // ⚠️ L'ADRESSE VIENT DU SERVEUR, telle quelle : ni URL de stockage, ni
    // signature reconstruite côté écran.
    expect(v.getAttribute('src')).toBe(CHEMIN);
  });
});

describe('2. Aucune lecture automatique', () => {
  it('2.1 le lecteur ne porte NI `autoplay` NI `muted`', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    const v = lecteur(container);
    // `autoplay` seul ne chargeait rien ; `muted` le ferait démarrer sans
    // qu'on l'ait demandé. Ni l'un, ni l'autre.
    expect(v.hasAttribute('autoplay')).toBe(false);
    expect(v.hasAttribute('muted')).toBe(false);
    expect(v.muted).toBe(false);
  });

  it('2.2 `play()` n’est appelé par personne', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    await act(async () => { await Promise.resolve(); });
    expect(lectures, 'aucune lecture ne doit partir sans le bouton natif').toBe(0);
  });

  it('2.3 le source ne contient aucun appel de lecture', () => {
    // ⚠️ LECTURE DE SOURCE ASSUMÉE : un rendu prouve qu'aucune lecture n'est
    // partie dans CE scénario ; l'absence d'appel dans le fichier est ce qui
    // vaut pour tous les autres.
    const brut = readFileSync(
      path.resolve(__dirname, '../components/creer/VideosPretes.tsx'), 'utf8',
    );
    // Les commentaires sont retirés : l'en-tête du fichier NOMME `autoPlay`
    // pour expliquer pourquoi il est parti. Interdire le mot partout
    // interdirait d'expliquer la panne — c'est le CODE qu'on garde propre.
    const code = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.play\s*\(/);
    expect(code).not.toMatch(/\bautoPlay\b/);
    expect(code).not.toMatch(/\bmuted\b/);
  });
});

describe('3. Le chargement part vraiment', () => {
  it('3.1 `preload` demande les octets au lieu de les retenir', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    const p = lecteur(container).getAttribute('preload');
    // C'est LA moitié de la panne : `none` sans lecture demandée = rien.
    expect(p).not.toBe('none');
    expect(['auto', 'metadata']).toContain(p);
  });

  it('3.2 `controls` et `playsInline` sont là — c’est l’utilisateur qui joue', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    const v = lecteur(container);
    expect(v.hasAttribute('controls')).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
  });
});

describe('4. L’état du média est dit, jamais tu', () => {
  it('4.1 tant que rien n’est arrivé, l’écran fait patienter', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    expect(container.querySelector('[data-videos-media-message]')!.textContent)
      .toContain('se charge');
  });

  it('4.2 les métadonnées reçues effacent la phrase', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    await act(async () => { fireEvent.loadedMetadata(lecteur(container)); });
    expect(container.querySelector('[data-videos-media-message]')).toBeNull();
    expect(lecteur(container).getAttribute('data-videos-media')).toBe('pret');
  });

  it('4.3 une erreur de média renvoie vers le téléchargement, sans mot de machine', async () => {
    const { container } = await ouvrir();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    await act(async () => { fireEvent.error(lecteur(container)); });
    const msg = container.querySelector('[data-videos-media-message]')!.textContent ?? '';
    expect(msg).toContain('Télécharge');
    for (const machine of ['MEDIA_ERR', 'readyState', 'codec', 'NaN', 'undefined']) {
      expect(msg).not.toContain(machine);
    }
  });
});

describe('5. Ce que ce lot ne devait pas casser', () => {
  it('5.1 « Télécharger » garde son adresse et son nom de fichier', async () => {
    const { container } = await ouvrir();
    const a = container.querySelector('[data-videos-telecharger]')!;
    expect(a.getAttribute('href')).toBe(CHEMIN);
    expect(a.getAttribute('download')).toBe('ma-video.mp4');
    // Et il reste accessible une fois le lecteur ouvert : c'est la porte de
    // sortie quand la lecture échoue.
    await act(async () => {
      fireEvent.click(container.querySelector('[data-videos-regarder]')!);
    });
    expect(container.querySelector('[data-videos-telecharger]')!.getAttribute('href'))
      .toBe(CHEMIN);
  });

  it('5.2 « Planifier la publication » est toujours là, et n’a pas été touché', async () => {
    const { container } = await ouvrir();
    expect(container.querySelector('[data-videos-planifier]')!.textContent)
      .toContain('Planifier la publication');
  });
});
