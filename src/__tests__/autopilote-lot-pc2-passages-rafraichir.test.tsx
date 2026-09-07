/**
 * LOT PC-2 — « CHERCHER A NOUVEAU », ENFIN ATTEIGNABLE.
 *
 * ---------------------------------------------------------------------------
 * LE DEFAUT QU'ON FERME
 * ---------------------------------------------------------------------------
 *
 * Le bouton existait depuis toujours dans l'en-tete de `PassagesSuggeres`.
 * En variante compacte — celle de la page principale — cet en-tete recoit
 * `hidden` des qu'un passage existe. Un commentaire disait qu'il « part dans
 * le tiroir » ; le tiroir, `ContenuAnalyse`, est en lecture seule par
 * conception et ne l'a jamais recu.
 *
 * Consequence mesuree : pour obtenir d'autres passages, il fallait
 * « Re-analyser » — donc repayer l'extraction des vignettes, l'analyse
 * visuelle et la transcription, ~24 s et trois appels payants — alors que la
 * route des candidats REUTILISE l'analyse existante et ne recalcule que les
 * passages, en ~7 s.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI COMPTE VRAIMENT ICI
 * ---------------------------------------------------------------------------
 *
 * Que le bouton soit visible ne suffit pas : il doit appeler LA ROUTE DES
 * CANDIDATS, et elle seule. S'il declenchait `/rushes/<id>/analyse`, on aurait
 * deplace le bouton sans rien economiser — et le test qui se contente de
 * chercher un libelle a l'ecran ne l'aurait pas vu.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const PassagesSuggeres = (await import('@/components/creer/PassagesSuggeres')).default;

const ANALYSE = '49b3af46-a051-41fc-be88-10c7a3e9da14';

/** Les URL reellement appelees. C'est la mesure qui compte. */
let appels: Array<{ url: string; methode: string }> = [];

/**
 * Un candidat qui passe `candidatValide` — six nombres et une raison non vide.
 *
 * ⚠️ LE PREMIER JET ECRIVAIT `dureeSecondes`, ET LE CONTRAT ATTEND
 * `dureeCibleSecondes`. Le filtre les ecartait tous en silence : l'ecran
 * n'affichait aucun passage, et les neuf tests echouaient sur un defaut de
 * fixture, pas de produit. On reprend donc le contrat, champ par champ.
 */
const CANDIDAT = (i: number) => ({
  rang: i,
  debutSecondes: i * 5,
  finSecondes: i * 5 + 4,
  dureeCibleSecondes: 4,
  secondeReference: i * 5 + 1,
  scoreMontage: 80 - i,
  raison: 'raison',
});

function generation(nb: number, etat = 'reussie') {
  return {
    id: 'jeu-1',
    etat,
    etape: 'candidats',
    modele: 'claude-haiku-4-5',
    candidats: Array.from({ length: nb }, (_, i) => CANDIDAT(i + 1)),
  };
}

function serveur(options: { nbApres?: number; echoue?: boolean } = {}) {
  let tour = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const methode = (init?.method ?? 'GET').toUpperCase();
    appels.push({ url: String(url), methode });
    if (String(url).includes('/candidats') && methode === 'GET') {
      return new Response(JSON.stringify({ ok: true, generation: generation(3) }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/candidats') && methode === 'POST') {
      tour += 1;
      if (options.echoue) {
        return new Response(JSON.stringify({ ok: false, error: 'Le moteur n’a pas répondu.' }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ ok: true, generation: generation(options.nbApres ?? 5) }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function monter(props: Record<string, unknown> = {}) {
  return render(
    <PassagesSuggeres
      analyseId={ANALYSE}
      variante="compacte"
      onVoirAnalyse={() => {}}
      {...props}
    />,
  );
}

const bouton = () => document.querySelector('[data-passages-rechercher]') as HTMLButtonElement | null;

beforeEach(() => { appels = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. L’action est atteignable là où elle sert', () => {
  it('1.1 avec des passages déjà trouvés, le bouton EXISTE et est VISIBLE', async () => {
    vi.stubGlobal('fetch', serveur());
    monter();
    await waitFor(() => expect(document.querySelector('[data-passages-voir]')).toBeTruthy());

    const b = bouton();
    expect(b).toBeTruthy();
    expect(b!.textContent).toContain('Chercher à nouveau');
    // ⚠️ LE COEUR DU LOT : aucun ancetre ne doit le masquer. Le defaut
    // d'origine n'etait pas une absence de bouton, c'etait un `hidden`.
    for (let n: HTMLElement | null = b; n; n = n.parentElement) {
      expect(n.className || '').not.toContain('hidden');
      expect(n.hasAttribute('hidden')).toBe(false);
    }
  });

  it('1.2 il se tient à côté du résumé qu’il concerne', async () => {
    vi.stubGlobal('fetch', serveur());
    monter();
    await waitFor(() => expect(bouton()).toBeTruthy());
    const resume = document.querySelector('[data-passages-voir]')!;
    expect(resume.parentElement).toBe(bouton()!.parentElement);
  });

  it('1.3 il n’y a JAMAIS deux boutons de recherche à l’écran', async () => {
    vi.stubGlobal('fetch', serveur());
    monter();
    await waitFor(() => expect(bouton()).toBeTruthy());
    // Celui de l'en-tete existe encore dans le DOM, mais son bloc est `hidden` :
    // un seul est offert au clic.
    const entete = document.querySelector('[data-passages-bouton]')!.closest('div')!;
    expect(entete.className).toContain('hidden');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Ce que l’action déclenche — et surtout ce qu’elle ne déclenche pas', () => {
  it('2.1 elle appelle la route des CANDIDATS, et rien d’autre', async () => {
    vi.stubGlobal('fetch', serveur());
    monter();
    await waitFor(() => expect(bouton()).toBeTruthy());
    appels = [];
    fireEvent.click(bouton()!);
    await waitFor(() => expect(appels.length).toBeGreaterThan(0));

    const posts = appels.filter((a) => a.methode === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/candidats');
  });

  it('2.2 elle ne relance NI l’analyse, NI la transcription, NI le visuel', async () => {
    vi.stubGlobal('fetch', serveur());
    monter();
    await waitFor(() => expect(bouton()).toBeTruthy());
    appels = [];
    fireEvent.click(bouton()!);
    await waitFor(() => expect(appels.length).toBeGreaterThan(0));

    // ⚠️ C'EST TOUTE LA VALEUR DU LOT. Deplacer un bouton sans economiser
    // l'analyse n'aurait rien resolu : c'est le cout qui genait, pas le clic.
    for (const a of appels) {
      expect(a.url).not.toMatch(/\/rushes\/[^/]+\/analyse/);
      expect(a.url).not.toContain('/transcription');
      expect(a.url).not.toContain('/vignettes');
    }
  });

  it('2.3 le double clic ne part qu’une fois', async () => {
    vi.stubGlobal('fetch', serveur());
    monter();
    await waitFor(() => expect(bouton()).toBeTruthy());
    appels = [];
    fireEvent.click(bouton()!);
    fireEvent.click(bouton()!);
    await waitFor(() => expect(appels.filter((a) => a.methode === 'POST').length).toBe(1));
  });

  it('2.4 pendant la recherche, l’écran le DIT', async () => {
    let debloquer: (() => void) | null = null;
    const attente = new Promise<void>((r) => { debloquer = r; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/candidats') && methode === 'POST') {
        await attente;
        return new Response(JSON.stringify({ ok: true, generation: generation(5) }), {
          status: 201, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, generation: generation(3) }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    monter();
    await waitFor(() => expect(bouton()).toBeTruthy());
    fireEvent.click(bouton()!);
    await waitFor(() => expect(bouton()!.textContent).toContain('Recherche de nouveaux passages'));
    expect(bouton()!.disabled).toBe(true);
    debloquer!();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Après', () => {
  it('3.1 le nouveau jeu remplace l’ancien', async () => {
    vi.stubGlobal('fetch', serveur({ nbApres: 6 }));
    monter();
    await waitFor(() => expect(screen.getByText(/3 passages suggérés/)).toBeTruthy());
    fireEvent.click(bouton()!);
    await waitFor(() => expect(screen.getByText(/6 passages suggérés/)).toBeTruthy());
  });

  it('3.2 un échec NE DETRUIT PAS les passages déjà là', async () => {
    vi.stubGlobal('fetch', serveur({ echoue: true }));
    monter();
    await waitFor(() => expect(screen.getByText(/3 passages suggérés/)).toBeTruthy());
    fireEvent.click(bouton()!);
    // ⚠️ UN ECHEC NE DOIT PAS VIDER L'ECRAN. L'utilisateur garde ce qu'il
    // avait et peut réessayer : le bouton redevient actif.
    await waitFor(() => expect(bouton()!.disabled).toBe(false));
    expect(screen.getByText(/3 passages suggérés/)).toBeTruthy();
  });
});
