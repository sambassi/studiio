/**
 * P0.1 — LE BOUTON « CRÉER MA VIDÉO ».
 *
 * ⚠️ `chaine-passerelle` EST MOCKÉ ICI, et seulement sa fonction
 * d'orchestration. Ce fichier teste le BOUTON — ce qu'il affiche, ce qu'il
 * désarme, qui il prévient — pas l'enchaînement, qui a son propre fichier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render, screen, cleanup, fireEvent, act, waitFor,
} from '@testing-library/react';

const CANDIDATS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// React n'active ses garde-fous `act` que si l'environnement l'annonce ;
// sans ça, chaque mise à jour d'état produit un avertissement et les
// assertions courent après le rendu.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { cleanup(); });

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE BOUTON
// ═══════════════════════════════════════════════════════════════════════════

const chaineMock = vi.hoisted(() => ({ creerVideo: vi.fn() }));

vi.mock('@/lib/autopilot/analyse/chaine-passerelle', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  creerVideo: chaineMock.creerVideo,
}));

// eslint-disable-next-line import/first
import PassagesSuggeres from '@/components/creer/PassagesSuggeres';

/** Le composant lit d'abord ses candidats : on lui en donne un. */
function fetchCandidats() {
  return vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    generation: {
      id: CANDIDATS, version: 1, etat: 'reussie',
      candidats: [{
        rang: 1, debutSecondes: 2, finSecondes: 8, secondeReference: 4,
        dureeCibleSecondes: 6, scoreMontage: 88, raison: 'Le geste est net.',
      }],
    },
  }), { status: 200 }));
}

describe('6. Le bouton « Créer ma vidéo »', () => {
  beforeEach(() => {
    chaineMock.creerVideo.mockReset();
    globalThis.fetch = fetchCandidats() as never;
  });

  const monter = (onVideoLancee?: () => void) => render(
    <PassagesSuggeres analyseId={CANDIDATS} onVideoLancee={onVideoLancee} />,
  );

  it('6.1 apparaît dès qu’un jeu de passages existe', async () => {
    monter();
    expect(await screen.findByText('Créer ma vidéo')).toBeInTheDocument();
  });

  it('6.2 un clic lance la chaîne et prévient l’écran des vidéos', async () => {
    chaineMock.creerVideo.mockResolvedValue({ sorte: 'lancee' });
    const prevenu = vi.fn();
    monter(prevenu);

    const bouton = await screen.findByText('Créer ma vidéo');
    await act(async () => { fireEvent.click(bouton); });

    expect(chaineMock.creerVideo).toHaveBeenCalledTimes(1);
    expect(chaineMock.creerVideo.mock.calls[0][0].candidateSetId).toBe(CANDIDATS);
    expect(prevenu).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/en cours de création/i)).toBeInTheDocument();
  });

  it('6.3 ⚠️ UN DOUBLE CLIC NE LANCE PAS DEUX CHAÎNES', async () => {
    let debloquer: (v: unknown) => void = () => {};
    chaineMock.creerVideo.mockImplementation(
      () => new Promise((r) => { debloquer = r; }),
    );
    monter();

    const bouton = await screen.findByText('Créer ma vidéo');
    await act(async () => {
      fireEvent.click(bouton);
      fireEvent.click(bouton);
      fireEvent.click(bouton);
    });

    expect(chaineMock.creerVideo).toHaveBeenCalledTimes(1);
    // Le bouton est aussi DÉSARMÉ pendant le travail : le garde n'est pas
    // seulement logique, il est visible.
    expect(document.querySelector('[data-chaine-bouton]')).toBeDisabled();

    await act(async () => { debloquer({ sorte: 'lancee' }); });
  });

  it('6.4 le bouton porte l’étape en cours, jamais un pourcentage', async () => {
    chaineMock.creerVideo.mockImplementation(async (o: {
      signalerEtape?: (e: string) => void;
    }) => {
      o.signalerEtape?.('montage');
      return new Promise(() => {});
    });
    monter();
    const bouton = await screen.findByText('Créer ma vidéo');
    await act(async () => { fireEvent.click(bouton); });

    const noeud = document.querySelector('[data-chaine-bouton]')!;
    expect(noeud.textContent).toBe('Préparation du montage…');
    expect(noeud.textContent).not.toMatch(/%|\d/);
  });

  it('6.5 un échec affiche le message humain, et réarme le bouton', async () => {
    chaineMock.creerVideo.mockResolvedValue({
      sorte: 'echec', message: 'Ce rush est illisible.',
    });
    const prevenu = vi.fn();
    monter(prevenu);

    const bouton = await screen.findByText('Créer ma vidéo');
    await act(async () => { fireEvent.click(bouton); });

    expect(await screen.findByText('Ce rush est illisible.')).toBeInTheDocument();
    // ⚠️ ON NE PRÉVIENT PAS l'écran des vidéos : il n'y a rien à aller voir.
    expect(prevenu).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.querySelector('[data-chaine-bouton]')).not.toBeDisabled();
    });
  });

  it('6.6 un rendu déjà prêt réveille quand même l’écran des vidéos', async () => {
    chaineMock.creerVideo.mockResolvedValue({ sorte: 'deja_prete' });
    const prevenu = vi.fn();
    monter(prevenu);
    const bouton = await screen.findByText('Créer ma vidéo');
    await act(async () => { fireEvent.click(bouton); });
    expect(prevenu).toHaveBeenCalledTimes(1);
  });

  it('6.7 aucun bouton quand il n’y a aucun passage', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, generation: null }), { status: 200 },
    )) as never;
    monter();
    await screen.findByText(/Aucun passage proposé/i);
    expect(screen.queryByText('Créer ma vidéo')).not.toBeInTheDocument();
  });
});
