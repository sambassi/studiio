import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { I18nContext } from '@/i18n/client';
import SocialPage from '../app/dashboard/social/page';

/**
 * Rendu réel de l'écran « Réseaux sociaux » (jsdom, messages FR réels,
 * réseau simulé) : chaque plateforme n'apparaît qu'UNE fois, l'état affiché
 * est celui de la règle unique, la déconnexion demande confirmation.
 */

const messages = JSON.parse(readFileSync(resolve(__dirname, '../../messages/fr.json'), 'utf-8'));

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale: 'fr', messages, setLocale: () => {} }}>
      {children}
    </I18nContext.Provider>
  );
}

function fauxFetch(statut: unknown, zernio: unknown, journal: string[] = []) {
  return vi.fn(async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entree);
    journal.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (b: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => b });
    if (url === '/api/social/status') return json(statut);
    if (url === '/api/social/zernio/accounts') {
      if (init?.method === 'DELETE') return json({ success: true });
      return json(zernio);
    }
    if (url === '/api/social/disconnect') return json({ success: true });
    if (url === '/api/social/settings') return json({ success: true });
    return json({ success: false }, false);
  });
}

const statutMixte = {
  success: true,
  platforms: {
    instagram: { available: true, connected: true, username: 'spordateur', oauthAvailable: true },
    facebook: { available: true, connected: false, username: null, oauthAvailable: true },
    tiktok: { available: false, connected: false, username: null, oauthAvailable: true },
    youtube: { available: false, connected: false, username: null, oauthAvailable: false },
  },
  channels: { email: { available: true }, whatsapp: { available: false }, 'afroboost.com': { available: false } },
};

const zernioMixte = {
  success: true,
  autorise: true,
  comptes: [
    { accountId: 'z1', platform: 'instagram', username: 'afroboosteur', status: 'connected' },
    { accountId: 'z2', platform: 'facebook', username: 'Afroboost', status: 'disconnected' },
  ],
};

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    configurable: true,
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Écran Réseaux sociaux — rendu unifié', () => {
  it('rend chaque réseau exactement une fois, avec l état de la règle unique', async () => {
    vi.stubGlobal('fetch', fauxFetch(statutMixte, zernioMixte));
    render(<Wrap><SocialPage /></Wrap>);
    await waitFor(() => expect(screen.getByTestId('grille-reseaux')).toBeTruthy());

    for (const id of ['instagram', 'facebook', 'tiktok', 'youtube']) {
      expect(screen.getAllByTestId(`reseau-${id}`)).toHaveLength(1);
    }
    // Instagram : le compte Zernio de l'utilisateur gagne sur le compte direct
    const ig = screen.getByTestId('reseau-instagram');
    expect(ig.getAttribute('data-etat')).toBe('connecte');
    expect(ig.textContent).toContain('@afroboosteur');
    expect(ig.textContent).not.toContain('@spordateur');
    // Facebook : compte Zernio expiré → reconnexion nécessaire
    const fb = screen.getByTestId('reseau-facebook');
    expect(fb.getAttribute('data-etat')).toBe('reconnexion');
    expect(fb.querySelector('[data-action="reconnecter"]')).toBeTruthy();
    expect(fb.querySelector('[data-action="deconnecter"]')).toBeNull();
    // TikTok / YouTube : Zernio autorisé → connectables via Zernio, pas « bientôt »
    for (const id of ['tiktok', 'youtube']) {
      const c = screen.getByTestId(`reseau-${id}`);
      expect(c.getAttribute('data-etat')).toBe('non_connecte');
      expect(c.querySelector('[data-action="connecter"]')).toBeTruthy();
    }
    // Bannière : 1 connecté (Instagram)
    expect(screen.getByText(messages.social.networksConnected.replace('{count}', '1'))).toBeTruthy();
    // Aucune seconde liste « Mes réseaux »
    expect(document.querySelector('[data-mes-reseaux]')).toBeNull();
  });

  it('sans droit Zernio et plateformes en attente → « bientôt disponible », aucun bouton de connexion', async () => {
    vi.stubGlobal('fetch', fauxFetch(statutMixte, { success: true, autorise: false, raison: 'option-absente', comptes: [] }));
    render(<Wrap><SocialPage /></Wrap>);
    await waitFor(() => expect(screen.getByTestId('grille-reseaux')).toBeTruthy());
    for (const id of ['tiktok', 'youtube']) {
      const c = screen.getByTestId(`reseau-${id}`);
      expect(c.getAttribute('data-etat')).toBe('bientot');
      expect(c.querySelector('[data-action="connecter"]')).toBeNull();
      expect(c.textContent).toContain(messages.social.status.comingSoon);
    }
    // le repli « publier vous-même » : UN bloc sous la grille, OUVERT (au moins un réseau sans auto-publication), nommant ces réseaux
    const replis = document.querySelectorAll('details[data-self-publish]');
    expect(replis).toHaveLength(1);
    expect(replis[0].getAttribute('data-self-publish')).toBe('fallback');
    expect(replis[0].hasAttribute('open')).toBe(true);
    expect(replis[0].textContent).toContain('TikTok');
    expect(replis[0].querySelector('a[href="/dashboard/library"]')).not.toBeNull();
    expect(document.querySelector('[data-zernio-refus]')?.textContent).toContain(messages.social.zernio.optionAbsente);
  });

  it('la déconnexion demande confirmation, puis appelle la bonne route selon la voie', async () => {
    const journal: string[] = [];
    vi.stubGlobal('fetch', fauxFetch(statutMixte, zernioMixte, journal));
    render(<Wrap><SocialPage /></Wrap>);
    await waitFor(() => expect(screen.getByTestId('grille-reseaux')).toBeTruthy());

    const ig = screen.getByTestId('reseau-instagram');
    fireEvent.click(ig.querySelector('[data-action="deconnecter"]')!);
    const dialog = await screen.findByTestId('confirmation-deconnexion');
    expect(dialog.textContent).toContain('Instagram');
    expect(journal.some((l) => l.startsWith('DELETE'))).toBe(false); // rien avant confirmation

    fireEvent.click(screen.getByText(messages.social.confirmDisconnect.cancel));
    expect(screen.queryByTestId('confirmation-deconnexion')).toBeNull();
    expect(journal.some((l) => l.startsWith('DELETE'))).toBe(false);

    fireEvent.click(ig.querySelector('[data-action="deconnecter"]')!);
    const dialog2 = await screen.findByTestId('confirmation-deconnexion');
    fireEvent.click(within(dialog2).getByText(messages.social.actions.disconnect));
    await waitFor(() => expect(journal).toContain('DELETE /api/social/zernio/accounts'));
    expect(journal.filter((l) => l === 'POST /api/social/disconnect')).toHaveLength(0);
  });

  it('la grille est responsive : une colonne par défaut, deux dès md', async () => {
    vi.stubGlobal('fetch', fauxFetch(statutMixte, zernioMixte));
    render(<Wrap><SocialPage /></Wrap>);
    const grille = await screen.findByTestId('grille-reseaux');
    expect(grille.className).toContain('grid');
    expect(grille.className).toContain('md:grid-cols-2');
    expect(grille.className).not.toMatch(/(^|\s)grid-cols-[2-9]\b/);
  });
});
