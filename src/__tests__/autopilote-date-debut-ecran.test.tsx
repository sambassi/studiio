import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * L'écran de l'Autopilote, étapes « Publication » et « Vérification » : la
 * date de début, les deux heures nommées, le récapitulatif des prochaines
 * échéances, et « Produire un brouillon maintenant ».
 *
 * Le VRAI panneau est monté ; l'API est doublée. Ce qu'on lit, c'est ce que
 * le panneau ENVOIE (`PUT /api/autopilot/config`, `POST
 * /api/autopilot/produire-maintenant`) et ce qu'il affiche.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AutopilotPanel from '../components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, type AutopilotConfig } from '../lib/autopilot/rules';

let enBase: AutopilotConfig;
let puts: Array<Record<string, unknown>>;
let colonneDate: boolean;
/** Les POST de production, dans l'ordre. */
let productions: number;
/** Délai de réponse du POST — pour laisser le second clic arriver EN VOL. */
let delaiProduction: number;

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        puts.push(recu);
        enBase = { ...enBase, ...(recu as Partial<AutopilotConfig>) };
        if (!colonneDate) enBase.startDate = null;
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, brandingReady: true, publishTimeReady: true, startDateReady: colonneDate, config: enBase }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, ready: true, brandingReady: true, publishTimeReady: true, startDateReady: colonneDate, config: enBase }),
      } as unknown as Response;
    }
    if (u.includes('/api/autopilot/produire-maintenant')) {
      if (init?.method === 'POST') {
        productions += 1;
        if (delaiProduction) await new Promise((r) => setTimeout(r, delaiProduction));
        return {
          ok: true, status: 200,
          json: async () => ({
            success: true, postId: 'p1', scheduledDate: '2026-08-04', scheduledTime: '11:10',
            timezone: 'Europe/Paris', calendrierUrl: '/dashboard/calendar', status: 'draft', platforms: [], cout: 10,
          }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, politique: 'credits', cout: 10, solde: 120, enCours: false }),
      } as unknown as Response;
    }
    if (u.includes('/api/voice/clone')) {
      return { ok: true, status: 200, json: async () => ({ success: true, voices: [] }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, success: true, sessions: [], luts: [], items: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** 2026-08-04 à 09:02 UTC = 11:02 à Paris, 05:02 à New York. */
const MAINTENANT = Date.parse('2026-08-04T09:02:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
  window.localStorage.clear();
  enBase = { ...DEFAULT_CONFIG, rushUrls: ['https://x/a.mp4'], runHour: 8, publishTime: '18:45', runTimezone: 'Europe/Paris' };
  puts = [];
  colonneDate = true;
  productions = 0;
  delaiProduction = 0;
  stubApi();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const dernierPut = () => puts[puts.length - 1];

async function monter(etape: 3 | 5 = 3) {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
  fireEvent.click(document.querySelector(`[data-autopilot-etape="${etape}"]`)!);
  await waitFor(() => expect(q('[data-autopilot-prochaines]')).not.toBeNull());
}

describe('La date de début', () => {
  it('un champ `date`, vide = dès le prochain passage ; une date saisie part en PUT `startDate`', async () => {
    await monter();
    const champ = q<HTMLInputElement>('[data-autopilot-start-date]')!;
    expect(champ.type).toBe('date');
    expect(champ.value).toBe('');
    expect(q('[data-autopilot-bloc-production]')!.textContent).toContain('dès le prochain passage');
    await act(async () => { fireEvent.change(champ, { target: { value: '2026-10-05' } }); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(dernierPut().startDate).toBe('2026-10-05');
    // Les deux heures n'ont pas bougé : trois réglages distincts.
    expect(dernierPut().runHour).toBe(8);
    expect(dernierPut().publishTime).toBe('18:45');
    await waitFor(() => expect(q<HTMLInputElement>('[data-autopilot-start-date]')!.value).toBe('2026-10-05'));
    expect(q('[data-autopilot-bloc-production]')!.textContent).toContain('lundi 5 octobre 2026');
  });

  it('effacer la date envoie `null` — un choix, pas une saisie incomplète', async () => {
    enBase = { ...enBase, startDate: '2026-10-05' };
    await monter();
    const champ = q<HTMLInputElement>('[data-autopilot-start-date]')!;
    expect(champ.value).toBe('2026-10-05');
    await act(async () => { fireEvent.change(champ, { target: { value: '' } }); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(dernierPut().startDate).toBeNull();
  });

  it('dit quand la colonne manque, au lieu d un champ sans effet', async () => {
    colonneDate = false;
    await monter();
    expect(q('[data-autopilot-start-date-absente]')).not.toBeNull();
    expect(q('[data-autopilot-start-date-absente]')!.textContent).toContain('2026-09-21-autopilot-start-date');
  });

  it('la phrase de diffusion l annonce quand elle est à venir', async () => {
    enBase = { ...enBase, startDate: '2026-10-05' };
    await monter();
    expect(q('[data-autopilot-phrase-diffusion]')!.textContent).toContain('à partir du lundi 5 octobre 2026');
    expect(q('[data-autopilot-phrase-diffusion]')!.textContent).toContain('produite à 08:00');
  });
});

describe('Production et publication, nommées et séparées', () => {
  it('deux blocs, deux titres, et l heure de production ne s appelle plus « départ »', async () => {
    await monter();
    expect(q('[data-autopilot-bloc-production]')!.textContent).toContain('Production — quand Studiio fabrique');
    expect(q('[data-autopilot-bloc-publication]')!.textContent).toContain('Publication — quand les vidéos produites sont programmées');
    expect(q('[data-autopilot-bloc-production]')!.textContent).toContain('Heure de production');
    expect(q('[data-autopilot-bloc-production]')!.querySelector('[data-autopilot-hour]')).not.toBeNull();
    expect(q('[data-autopilot-bloc-publication]')!.querySelector('[data-autopilot-publish-time]')).not.toBeNull();
    // Et l'heure de production dit qu'elle n'est pas une commande immédiate.
    expect(q('[data-autopilot-bloc-production]')!.textContent).toContain('pas une commande immédiate');
  });
});

describe('Les prochaines échéances', () => {
  it('prochaine production = demain 08:00 à Paris ; prochaine publication = le lendemain à 18:45, minutes conservées', async () => {
    await monter();
    const production = q('[data-autopilot-prochaine-production]')!.textContent!;
    expect(production).toContain('mercredi 5 août 2026');
    expect(production).toContain('08:00');
    expect(production).toContain('(Europe/Paris)');
    const publication = q('[data-autopilot-prochaine-publication]')!;
    expect(publication.getAttribute('data-date')).toBe('2026-08-06');
    expect(publication.getAttribute('data-time')).toBe('18:45');
    expect(publication.textContent).toContain('jeudi 6 août 2026 à 18:45');
  });

  it('le fuseau est respecté — à New York, 08:00 est encore à venir aujourd hui', async () => {
    enBase = { ...enBase, runTimezone: 'America/New_York' };
    await monter();
    const production = q('[data-autopilot-prochaine-production]')!.textContent!;
    expect(production).toContain('mardi 4 août 2026');
    expect(production).toContain('08:00');
    expect(production).toContain('(America/New_York)');
    expect(q('[data-autopilot-prochaine-publication]')!.getAttribute('data-date')).toBe('2026-08-05');
  });

  it('une date de début à venir déplace les deux échéances', async () => {
    enBase = { ...enBase, startDate: '2026-08-10' };
    await monter();
    expect(q('[data-autopilot-prochaine-production]')!.textContent).toContain('lundi 10 août 2026');
    expect(q('[data-autopilot-prochaine-publication]')!.getAttribute('data-date')).toBe('2026-08-11');
    expect(q('[data-autopilot-prochaine-publication]')!.getAttribute('data-time')).toBe('18:45');
  });

  it('une date de début passée ne change rien', async () => {
    enBase = { ...enBase, startDate: '2026-01-01' };
    await monter();
    expect(q('[data-autopilot-prochaine-production]')!.textContent).toContain('mercredi 5 août 2026');
    expect(q('[data-autopilot-prochaine-publication]')!.getAttribute('data-date')).toBe('2026-08-06');
  });

  it('le même récapitulatif est à l étape Vérification, avec la date de début', async () => {
    enBase = { ...enBase, startDate: '2026-08-10' };
    await monter(5);
    expect(q('[data-autopilot-prochaine-production]')!.textContent).toContain('lundi 10 août 2026');
    expect(q('[data-autopilot-recap="diffusion"]')!.textContent).toContain('Date de début');
    expect(q('[data-autopilot-recap="diffusion"]')!.textContent).toContain('lundi 10 août 2026');
    expect(q('[data-autopilot-produire-maintenant]')).not.toBeNull();
  });
});

describe('« Produire un brouillon maintenant »', () => {
  it('le bouton ouvre une confirmation qui affiche le COÛT du serveur — rien n est parti', async () => {
    await monter();
    expect(productions).toBe(0);
    fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-confirmation]')).not.toBeNull());
    await waitFor(() => expect(q('[data-autopilot-produire-cout]')!.textContent).toContain('10 crédits'));
    expect(q('[data-autopilot-produire-cout]')!.textContent).toContain('solde actuel : 120 crédits');
    expect(q('[data-autopilot-produire-confirmation]')!.textContent).toContain('rien ne sera publié');
    expect(productions).toBe(0);
  });

  it('confirmer envoie UN SEUL POST malgré un double clic, puis montre le résultat et le lien', async () => {
    delaiProduction = 30;
    await monter();
    fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-confirmer]')).not.toBeNull());
    const confirmer = q<HTMLButtonElement>('[data-autopilot-produire-confirmer]')!;
    await act(async () => {
      fireEvent.click(confirmer);
      fireEvent.click(confirmer);
      fireEvent.click(confirmer);
    });
    await waitFor(() => expect(q('[data-autopilot-produire-resultat]')).not.toBeNull());
    expect(productions).toBe(1);
    const resultat = q('[data-autopilot-produire-resultat]')!;
    expect(resultat.getAttribute('data-post-id')).toBe('p1');
    expect(resultat.textContent).toContain('mardi 4 août 2026');
    expect(resultat.textContent).toContain('11:10');
    expect(q<HTMLAnchorElement>('[data-autopilot-produire-lien]')!.getAttribute('href')).toBe('/dashboard/calendar');
  });

  it('en vol, le bouton de confirmation a disparu — et un clic sur rien ne renvoie rien', async () => {
    delaiProduction = 50;
    await monter();
    fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-confirmer]')).not.toBeNull());
    await act(async () => { fireEvent.click(q('[data-autopilot-produire-confirmer]')!); });
    await waitFor(() => expect(q('[data-autopilot-produire-en-cours]')).not.toBeNull());
    expect(q('[data-autopilot-produire-confirmer]')).toBeNull();
    expect(q('[data-autopilot-produire-maintenant]')).toBeNull();
    await waitFor(() => expect(q('[data-autopilot-produire-resultat]')).not.toBeNull());
    expect(productions).toBe(1);
  });

  it('annuler referme la confirmation sans rien envoyer', async () => {
    await monter();
    fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-annuler]')).not.toBeNull());
    fireEvent.click(q('[data-autopilot-produire-annuler]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-confirmation]')).toBeNull());
    expect(productions).toBe(0);
  });

  it('sans rush, le bouton est désactivé', async () => {
    enBase = { ...enBase, rushUrls: [] };
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="3"]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-maintenant]')).not.toBeNull());
    expect(q<HTMLButtonElement>('[data-autopilot-produire-maintenant]')!.disabled).toBe(true);
  });

  it('une erreur du serveur est affichée, et on peut réessayer', async () => {
    await monter();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('/api/autopilot/produire-maintenant') && init?.method === 'POST') {
        productions += 1;
        return { ok: false, status: 402, json: async () => ({ success: false, error: 'Crédits insuffisants : ce rendu coûte 10 crédits, il vous en reste 4.' }) } as unknown as Response;
      }
      return original(url as string, init);
    }) as unknown as typeof fetch;
    fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-confirmer]')).not.toBeNull());
    await act(async () => { fireEvent.click(q('[data-autopilot-produire-confirmer]')!); });
    await waitFor(() => expect(q('[data-autopilot-produire-erreur]')).not.toBeNull());
    expect(q('[data-autopilot-produire-erreur]')!.textContent).toContain('Crédits insuffisants');
    expect(productions).toBe(1);
    // Le bouton est de retour : on peut réessayer.
    expect(q('[data-autopilot-produire-maintenant]')).not.toBeNull();
  });
});
