/**
 * `AfficheIA` — le composant seul, contre le NOUVEAU contrat de
 * `/api/ai/image` (`generate-bg` + `format`, `resultUrl` durable).
 *
 *   a. le `format` part dans le corps et dicte l'`aspect-ratio` de l'apercu ;
 *      sans prop → '9:16' ;
 *   b. deux clics quasi simultanes → UNE requete (verrou synchrone) ; une
 *      fois la reponse arrivee, un nouveau clic regenere (2e requete) ;
 *   c. `onUtiliser` qui echoue → alerte, pas d'etat « applique » ;
 *   d. delai : la requete ne repond jamais → passe 100 s, alerte, bouton
 *      rendu, AUCUNE relance automatique ;
 *   e. 402 `{ success:false, error }` → l'erreur serveur mot pour mot, pas de
 *      resultat ;
 *   f. nominal : l'URL Studiio absolue est affichee et remise telle quelle,
 *      une fois, a `onUtiliser`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import AfficheIA, { AFFICHE_IA_TIMEOUT_MS, AFFICHE_IA_MESSAGE_DELAI } from '@/components/creer/AfficheIA';

const URL_DURABLE = 'https://studiio.pro/storage/media/ai-posters/u1/gen-42.webp';

function reponseOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      resultUrl: URL_DURABLE,
      generationId: 'gen-42',
      creditsUsed: 5,
      creditsRemaining: 295,
      format: '9:16',
      ...overrides,
    }),
  };
}

/** Une doublure de `fetch` qui repond `reponse` et retient les corps envoyes. */
function stubFetch(reponse: () => unknown | Promise<unknown>) {
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    void init;
    return reponse();
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const corps = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String((f.mock.calls[i][1] as RequestInit).body));
const btnGenerer = () => document.querySelector('[data-affiche-ia-generer]') as HTMLButtonElement;
const btnUtiliser = () => document.querySelector('[data-affiche-ia-utiliser]') as HTMLButtonElement;
const apercu = () => document.querySelector('[data-affiche-ia-apercu]') as HTMLDivElement | null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a. format → corps de la requete et ratio de l apercu', () => {
  const cas: Array<['9:16' | '1:1' | '16:9', string]> = [
    ['9:16', '9 / 16'],
    ['1:1', '1 / 1'],
    ['16:9', '16 / 9'],
  ];

  for (const [format, ratio] of cas) {
    it(`format ${format} → body.format = ${format}, aspect-ratio ${ratio}`, async () => {
      const f = stubFetch(() => reponseOk({ format }));
      render(<AfficheIA suggestion="lac au matin" format={format} onUtiliser={async () => {}} />);
      fireEvent.click(btnGenerer());
      await waitFor(() => expect(apercu()).not.toBeNull());
      expect(f).toHaveBeenCalledTimes(1);
      expect(f.mock.calls[0][0]).toBe('/api/ai/image');
      expect(corps(f)).toEqual({ action: 'generate-bg', prompt: 'lac au matin', format });
      expect(apercu()!.style.aspectRatio).toBe(ratio);
    });
  }

  it('sans prop : format 9:16 par defaut', async () => {
    const f = stubFetch(() => reponseOk());
    render(<AfficheIA suggestion="lac au matin" onUtiliser={async () => {}} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(apercu()).not.toBeNull());
    expect(corps(f).format).toBe('9:16');
    expect(apercu()!.style.aspectRatio).toBe('9 / 16');
  });
});

describe('b. double clic → une seule requete', () => {
  it('deux clics dans le meme tour → fetch appele une fois ; apres la reponse, un clic regenere', async () => {
    let resoudre!: (v: unknown) => void;
    const f = stubFetch(() => new Promise((r) => { resoudre = r; }));
    render(<AfficheIA suggestion="lac au matin" onUtiliser={async () => {}} />);

    await act(async () => {
      fireEvent.click(btnGenerer());
      fireEvent.click(btnGenerer());
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(btnGenerer().disabled).toBe(true);
    expect(screen.getByText('Génération…')).toBeTruthy();

    // Meme un clic force pendant le vol (le bouton est desactive, mais on
    // simule un clic qui passerait) ne relance rien.
    await act(async () => { fireEvent.click(btnGenerer()); });
    expect(f).toHaveBeenCalledTimes(1);

    await act(async () => { resoudre(reponseOk()); });
    await waitFor(() => expect(apercu()).not.toBeNull());
    expect(btnGenerer().disabled).toBe(false);
    expect(screen.getByText('Régénérer')).toBeTruthy();

    // Regenerer = une nouvelle requete, 5 credits de plus.
    await act(async () => { fireEvent.click(btnGenerer()); });
    expect(f).toHaveBeenCalledTimes(2);
    await act(async () => { resoudre(reponseOk()); });
  });
});

describe('c. onUtiliser en echec', () => {
  it('montre une alerte et ne signale pas l image comme appliquee', async () => {
    stubFetch(() => reponseOk());
    const onUtiliser = vi.fn(async () => { throw new Error('Stockage indisponible'); });
    render(<AfficheIA suggestion="lac au matin" onUtiliser={onUtiliser} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(btnUtiliser()).not.toBeNull());

    await act(async () => { fireEvent.click(btnUtiliser()); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Stockage indisponible'));
    expect(onUtiliser).toHaveBeenCalledTimes(1);
    // Pas d'etat « applique » : ni « Enregistrement… », ni coche de succes ;
    // le bouton propose de nouveau d'utiliser l'image (elle reste visible).
    expect(screen.queryByText('Enregistrement…')).toBeNull();
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(document.querySelector('[data-affiche-ia-etat]')?.getAttribute('data-affiche-ia-etat')).toBe('erreur');
    expect(btnUtiliser().disabled).toBe(false);
    expect(screen.getByText('Utiliser comme affiche')).toBeTruthy();
  });

  it('deux clics sur Utiliser → un seul onUtiliser', async () => {
    stubFetch(() => reponseOk());
    let resoudre!: () => void;
    const onUtiliser = vi.fn(() => new Promise<void>((r) => { resoudre = r; }));
    render(<AfficheIA suggestion="lac au matin" onUtiliser={onUtiliser} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(btnUtiliser()).not.toBeNull());

    await act(async () => {
      fireEvent.click(btnUtiliser());
      fireEvent.click(btnUtiliser());
    });
    expect(onUtiliser).toHaveBeenCalledTimes(1);
    await act(async () => { resoudre(); });
    expect(screen.getByText('Utiliser comme affiche')).toBeTruthy();
  });
});

describe('d. delai client', () => {
  it('requete muette → passe 100 s : alerte, bouton rendu, pas de relance', async () => {
    vi.useFakeTimers();
    const f = stubFetch(() => new Promise(() => { /* ne repond jamais */ }));
    render(<AfficheIA suggestion="lac au matin" onUtiliser={async () => {}} />);

    await act(async () => { fireEvent.click(btnGenerer()); });
    expect(f).toHaveBeenCalledTimes(1);
    expect(btnGenerer().disabled).toBe(true);
    const signal = (f.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    // Juste avant le delai : toujours en vol.
    await act(async () => { await vi.advanceTimersByTimeAsync(AFFICHE_IA_TIMEOUT_MS - 1); });
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(AFFICHE_IA_MESSAGE_DELAI);
    expect(btnGenerer().disabled).toBe(false);
    expect(screen.getByText('Générer')).toBeTruthy();
    expect(document.querySelector('[data-affiche-ia-resultat]')).toBeNull();

    // Aucune relance automatique, meme longtemps apres.
    await act(async () => { await vi.advanceTimersByTimeAsync(AFFICHE_IA_TIMEOUT_MS * 3); });
    expect(f).toHaveBeenCalledTimes(1);

    // Le verrou est bien leve : un clic volontaire relance UNE requete.
    await act(async () => { fireEvent.click(btnGenerer()); });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('un fetch qui rejette en AbortError → le meme message de delai', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    stubFetch(() => Promise.reject(err));
    render(<AfficheIA suggestion="lac au matin" onUtiliser={async () => {}} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(AFFICHE_IA_MESSAGE_DELAI));
    expect(btnGenerer().disabled).toBe(false);
  });
});

describe('e. erreur serveur', () => {
  it('402 { success:false, error } → le message mot pour mot, pas de resultat', async () => {
    stubFetch(() => ({ ok: false, status: 402, json: async () => ({ success: false, error: 'Crédits insuffisants' }) }));
    render(<AfficheIA suggestion="lac au matin" onUtiliser={async () => {}} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Crédits insuffisants'));
    expect(document.querySelector('[data-affiche-ia-resultat]')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Générer')).toBeTruthy();
    expect(btnGenerer().disabled).toBe(false);
  });

  it('reponse sans corps JSON → « Erreur <status> »', async () => {
    stubFetch(() => ({ ok: false, status: 503, json: async () => { throw new Error('pas de JSON'); } }));
    render(<AfficheIA suggestion="lac au matin" onUtiliser={async () => {}} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Erreur 503'));
  });

  it('sans consigne ni suggestion → demande une description, sans requete', async () => {
    const f = stubFetch(() => reponseOk());
    render(<AfficheIA onUtiliser={async () => {}} />);
    fireEvent.click(btnGenerer());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(f).not.toHaveBeenCalled();
    expect(btnGenerer().disabled).toBe(false);
  });
});

describe('f. nominal', () => {
  it('affiche l URL Studiio durable et la remet telle quelle a onUtiliser, une fois', async () => {
    stubFetch(() => reponseOk());
    const onUtiliser = vi.fn(async (_url: string) => {});
    render(<AfficheIA suggestion="lac au matin" onUtiliser={onUtiliser} />);
    expect(screen.getByText('5 crédits par image')).toBeTruthy();

    fireEvent.click(btnGenerer());
    await waitFor(() => expect(document.querySelector('[data-affiche-ia-resultat] img')).not.toBeNull());
    const img = document.querySelector('[data-affiche-ia-resultat] img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(URL_DURABLE);
    expect(img.src).toBe(URL_DURABLE);
    expect(img.src.startsWith('https://studiio.pro/')).toBe(true);
    // Le solde du serveur, s'il est fourni.
    expect(document.querySelector('[data-affiche-ia-credits-restants]')?.textContent).toContain('295');

    fireEvent.click(btnUtiliser());
    expect(screen.getByText('Enregistrement…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Utiliser comme affiche')).toBeTruthy());
    expect(onUtiliser).toHaveBeenCalledTimes(1);
    expect(onUtiliser).toHaveBeenCalledWith(URL_DURABLE);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
