import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AfficheIA from '@/components/creer/AfficheIA';

/**
 * CRÉER — « Partir de ma photo » sur l'Affiche IA.
 *
 * Sans référence : texte seul (comme avant). Avec « Partir de ma photo » coché
 * ET une photo de référence : la requête porte `imageUrl` — le serveur bascule
 * alors sur le modèle qui préserve le sujet (visage, vêtements). Sans photo, le
 * bouton reste inerte : jamais une génération texte déguisée en « ma photo ».
 */

function stubFetchOk() {
  globalThis.fetch = vi.fn(async () => new Response(
    JSON.stringify({ success: true, resultUrl: 'https://cdn.test/affiche.webp', creditsRemaining: 42 }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;
}

const REF = 'https://cdn.test/ma-photo.jpg';

describe('AfficheIA — Partir de ma photo', () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => { stubFetchOk(); });
  afterEach(() => { cleanup(); globalThis.fetch = fetchOriginal; });

  it('sans « ma photo » : la requête est en texte seul (pas d’imageUrl)', async () => {
    render(<AfficheIA suggestion="gym" onUtiliser={() => {}} format="9:16" referenceUrl={REF} />);
    fireEvent.change(screen.getByPlaceholderText(/ex : gym/i), { target: { value: 'salle sombre néons' } });
    fireEvent.click(screen.getByText('Générer'));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const body = JSON.parse(((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string }).body) as { imageUrl?: string; action: string };
    expect(body.action).toBe('generate-bg');
    expect(body.imageUrl).toBeUndefined();
  });

  it('« ma photo » cochée + référence : la requête porte imageUrl = ma photo', async () => {
    render(<AfficheIA suggestion="gym" onUtiliser={() => {}} format="9:16" referenceUrl={REF} />);
    fireEvent.click(screen.getByLabelText(/Partir de ma photo/i));
    fireEvent.change(screen.getByPlaceholderText(/ex : gym/i), { target: { value: 'affiche cinématique' } });
    fireEvent.click(screen.getByText('Générer'));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const body = JSON.parse(((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string }).body) as { imageUrl?: string };
    expect(body.imageUrl).toBe(REF);
  });

  it('« ma photo » cochée SANS référence : bouton inerte + consigne de choisir une photo', () => {
    render(<AfficheIA suggestion="gym" onUtiliser={() => {}} format="9:16" referenceUrl={null} />);
    fireEvent.click(screen.getByLabelText(/Partir de ma photo/i));
    expect(screen.getByText(/Choisissez d’abord une photo/i)).toBeTruthy();
    expect((screen.getByText('Générer').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
