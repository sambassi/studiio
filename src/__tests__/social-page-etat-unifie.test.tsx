import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { I18nContext } from '@/i18n/client';
import SocialPage from '../app/dashboard/social/page';
import {
  deriverTousLesReseaux,
  reseauDepuisLibelle,
  RESEAUX,
  type CompteZernio,
  type StatutDirect,
} from '@/lib/social/etatReseaux';

/**
 * ⚠️ Écran « Réseaux sociaux » — état UNIFIÉ, rafraîchi sans rechargement.
 *
 * La page est montée pour de vrai (jsdom, messages FR réels), le serveur est
 * une doublure `fetch` PAR SCÉNARIO dont l'état est MUTABLE : un scénario
 * peut « connecter » un compte côté serveur pendant que la page tourne, et
 * l'on vérifie que la page va le RELIRE (par `unifie.recharger()`), sans
 * `window.location.reload()`, et sans boucle.
 *
 * Sources uniques : `src/lib/social/etatReseaux.ts` (règle pure) et
 * `src/lib/hooks/useEtatReseaux.ts` (lecture). La page ne fait que présenter
 * et rafraîchir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOOKS DOM EXIGÉS (existants ou à conserver)
 * ─────────────────────────────────────────────────────────────────────────
 *   data-testid="grille-reseaux"                — la grille, une seule
 *   data-testid="reseau-<id>" + data-etat="…"   — une carte par réseau
 *   [data-action="connecter" | "reconnecter" | "deconnecter"]
 *   data-testid="confirmation-deconnexion"       — la modale
 *   [data-self-publish] (ou data-testid="publier-vous-meme") — UN seul bloc
 *       de repli pour la page, hors des cartes, ouvert (`open` ou
 *       data-ouvert="true") quand au moins un réseau n'a pas la publication
 *       automatique, avec un lien href="/dashboard/library"
 * ─────────────────────────────────────────────────────────────────────────
 */

const racine = resolve(__dirname, '..', '..');
const messages = JSON.parse(readFileSync(resolve(racine, 'messages/fr.json'), 'utf-8'));
const M = messages.social;
const sourcePage = readFileSync(resolve(racine, 'src/app/dashboard/social/page.tsx'), 'utf-8');
const sourceCalendrier = readFileSync(resolve(racine, 'src/app/dashboard/calendar/page.tsx'), 'utf-8');

/** Un jeton factice, reconnaissable : il ne doit JAMAIS finir dans le DOM ni dans localStorage. */
const JETON = 'EAAG' + 'jetonFactice'.repeat(6) + '0123456789';
const RX_JETON = /[A-Za-z0-9_-]{40,}/;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale: 'fr', messages, setLocale: () => {} }}>
      {children}
    </I18nContext.Provider>
  );
}

// ─── Doublure serveur, à état mutable ────────────────────────────────────────

type Plateformes = Record<string, StatutDirect>;
interface EtatZernio { autorise: boolean; raison?: string | null; comptes: CompteZernio[] }

interface Serveur {
  platforms: Plateformes;
  zernio: EtatZernio;
  /** `GET /api/social/accounts` — colonnes publiques uniquement. */
  comptesDirects: Array<{ id: string; platform: string; username: string; connected: boolean; connectedAt: string }>;
  /** Simule une panne serveur sur /api/social/disconnect. */
  deconnexionEnPanne: boolean;
  journal: string[];
  externes: string[];
  nb: (prefixe: string) => number;
  fetch: ReturnType<typeof vi.fn>;
}

function serveur(platforms: Plateformes, zernio: EtatZernio): Serveur {
  const s: Serveur = {
    platforms, zernio, comptesDirects: [], journal: [], externes: [], deconnexionEnPanne: false,
    nb: (p) => s.journal.filter((l) => l.startsWith(p)).length,
    fetch: vi.fn(),
  };
  const json = (b: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => b });
  const lireCorps = (init?: RequestInit): Record<string, unknown> => {
    try { return init?.body ? JSON.parse(String(init.body)) : {}; } catch { return {}; }
  };
  s.fetch.mockImplementation(async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entree);
    const methode = init?.method ?? 'GET';
    // ⚠️ Aucun hôte externe : le stub lève, et le socket est de toute façon
    // fermé par setup.ts. `externes` garde la trace pour le test 12.
    if (/^https?:\/\//i.test(url)) {
      s.externes.push(`${methode} ${url}`);
      throw new Error(`Appel externe interdit pendant les tests : ${url}`);
    }
    s.journal.push(`${methode} ${url}${init?.body ? ' ' + String(init.body) : ''}`);
    const chemin = url.split('?')[0];
    const corps = lireCorps(init);

    if (chemin === '/api/social/status') {
      return json({
        success: true,
        platforms: s.platforms,
        channels: { email: { available: true }, whatsapp: { available: false }, 'afroboost.com': { available: false } },
      });
    }
    if (chemin === '/api/social/zernio/accounts') {
      if (methode === 'DELETE') {
        // Même règle que la vraie route : « disconnected », jamais supprimé.
        s.zernio.comptes = s.zernio.comptes.map((c) => (c.platform === corps.platform ? { ...c, status: 'disconnected' } : c));
        return json({ success: true });
      }
      return json({ success: true, autorise: s.zernio.autorise, raison: s.zernio.raison ?? null, comptes: s.zernio.comptes });
    }
    if (chemin === '/api/social/zernio/connect') {
      return json({ success: true, authUrl: `https://zernio.example/oauth?platform=${String(corps.platform)}&state=${JETON}` });
    }
    if (chemin === '/api/social/connect') {
      const p = String(corps.platform ?? new URL(url, 'http://localhost').searchParams.get('platform') ?? '');
      return json({ success: true, authUrl: `https://www.facebook.com/v19.0/dialog/oauth?client_id=1&platform=${p}&state=${JETON}` });
    }
    if (chemin === '/api/social/disconnect') {
      // La route réelle est POST ; un DELETE est accepté ici aussi — la
      // méthode n'est pas l'objet du test, le RECHARGEMENT l'est.
      if (s.deconnexionEnPanne) return json({ success: false, error: 'panne' }, false);
      const p = String(corps.platform ?? new URL(url, 'http://localhost').searchParams.get('platform') ?? '');
      if (s.platforms[p]) s.platforms[p] = { ...s.platforms[p], connected: false, username: null };
      s.comptesDirects = s.comptesDirects.filter((c) => c.platform !== p);
      return json({ success: true });
    }
    if (chemin === '/api/social/accounts') return json({ success: true, accounts: s.comptesDirects });
    if (chemin === '/api/social/settings') return json({ success: true, settings: null });
    return json({ success: false, error: `route inconnue ${methode} ${chemin}` }, false);
  });
  return s;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const direct = (over: Partial<StatutDirect> = {}): StatutDirect => ({
  available: true, connected: false, username: null, oauthAvailable: true, ...over,
});
const quatre = (over: Partial<Record<string, Partial<StatutDirect>>> = {}): Plateformes => ({
  instagram: direct(over.instagram),
  facebook: direct(over.facebook),
  tiktok: direct({ available: false, oauthAvailable: false, ...over.tiktok }),
  youtube: direct({ available: false, oauthAvailable: false, ...over.youtube }),
});
const zNon = (): EtatZernio => ({ autorise: false, raison: 'option-absente', comptes: [] });
const zOui = (...comptes: CompteZernio[]): EtatZernio => ({ autorise: true, raison: null, comptes });
const compteZ = (platform: string, username: string | null = 'afroboosteur', status = 'connected'): CompteZernio =>
  ({ accountId: `z_${platform}`, platform, username, status });

// ─── Environnement navigateur ────────────────────────────────────────────────

/** localStorage EN MÉMOIRE et inspectable (le test 11 en lit le contenu). */
function faireLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
    entrees: () => Array.from(m.entries()),
  };
}

interface FauxPopup { closed: boolean; location: { href: string }; close: () => void; focus: () => void }
function fauxPopup(): FauxPopup {
  const p: FauxPopup = { closed: false, location: { href: 'about:blank' }, close: () => { p.closed = true; }, focus: () => {} };
  return p;
}

let stockage: ReturnType<typeof faireLocalStorage>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stockage = faireLocalStorage();
  Object.defineProperty(window, 'localStorage', { value: stockage, configurable: true });
  reload = vi.fn();
  // `location` remplacée : on capture `reload()` (interdit) et l'on évite la
  // navigation jsdom (« not implemented ») quand la page pose `location.href`.
  vi.stubGlobal('location', {
    href: 'http://localhost:3000/dashboard/social',
    origin: 'http://localhost:3000',
    protocol: 'http:', host: 'localhost:3000', hostname: 'localhost', port: '3000',
    pathname: '/dashboard/social', search: '', hash: '',
    reload, assign: vi.fn(), replace: vi.fn(), toString: () => 'http://localhost:3000/dashboard/social',
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function monter(s: Serveur) {
  vi.stubGlobal('fetch', s.fetch);
  render(<Wrap><SocialPage /></Wrap>);
  await waitFor(() => expect(screen.getByTestId('grille-reseaux')).toBeTruthy());
}

const carte = (id: string) => screen.getByTestId(`reseau-${id}`);
/** Le bloc de repli unique : `data-self-publish` (existant) ou un data-testid dédié. */
const SEL_REPLI = '[data-testid="publier-vous-meme"], [data-self-publish]';
const boutonsAction = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-action]'));

/** Lance un OAuth direct et le fait « réussir » comme le ferait la vraie popup. */
async function oauthDirect(s: Serveur, id: string, apres: () => void) {
  const popup = fauxPopup();
  const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
  fireEvent.click(carte(id).querySelector('[data-action="connecter"]')!);
  await waitFor(() => expect(s.journal.some((l) => /\/api\/social\/connect\b/.test(l))).toBe(true));
  expect(open).toHaveBeenCalled();
  // Le serveur enregistre la connexion pendant que l'utilisateur est dans la popup.
  apres();
  // La page de callback (`/api/social/callback`) fait les deux : un
  // postMessage vers l'ouvreur, puis `window.close()` 800 ms plus tard.
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'social-oauth-success', message: 'ok' },
      origin: window.location.origin,
      source: window,
    }));
  });
  await act(async () => { popup.closed = true; });
  return popup;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('⚠️ Réseaux sociaux — une carte, une action, un état', () => {
  it('⚠️ 1. Instagram, Zernio autorisé → une seule carte, une seule action (Zernio), pas de second bouton', async () => {
    // a) compte Zernio vivant : connecté via Zernio, seule action = déconnecter
    const sA = serveur(quatre({ instagram: { connected: true, username: 'spordateur' } }), zOui(compteZ('instagram')));
    await monter(sA);
    expect(screen.getAllByTestId('reseau-instagram')).toHaveLength(1);
    const igA = carte('instagram');
    expect(igA.getAttribute('data-etat')).toBe('connecte');
    expect(igA.textContent).toContain('@afroboosteur');
    expect(igA.textContent).toContain(M.voie.zernio);
    expect(boutonsAction(igA).map((b) => b.getAttribute('data-action'))).toEqual(['deconnecter']);
    cleanup();

    // b) autorisation Zernio sans compte : une seule action = connecter (Zernio)
    const sB = serveur(quatre(), zOui());
    await monter(sB);
    expect(screen.getAllByTestId('reseau-instagram')).toHaveLength(1);
    const igB = carte('instagram');
    expect(igB.getAttribute('data-etat')).toBe('non_connecte');
    expect(boutonsAction(igB).map((b) => b.getAttribute('data-action'))).toEqual(['connecter']);
    fireEvent.click(igB.querySelector('[data-action="connecter"]')!);
    await waitFor(() => expect(sB.journal.some((l) => l.startsWith('POST /api/social/zernio/connect'))).toBe(true));
    expect(sB.journal.some((l) => /POST \/api\/social\/connect\b/.test(l))).toBe(false);
  });

  it('⚠️ 2. Instagram, Zernio non autorisé, OAuth direct disponible → action = OAuth direct (popup + /api/social/connect)', async () => {
    const s = serveur(quatre(), zNon());
    await monter(s);
    const ig = carte('instagram');
    expect(ig.getAttribute('data-etat')).toBe('non_connecte');
    expect(boutonsAction(ig).map((b) => b.getAttribute('data-action'))).toEqual(['connecter']);
    const popup = fauxPopup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    fireEvent.click(ig.querySelector('[data-action="connecter"]')!);
    await waitFor(() => expect(s.journal.some((l) => /\/api\/social\/connect\b.*instagram/.test(l))).toBe(true));
    expect(open).toHaveBeenCalledTimes(1);
    expect(s.journal.some((l) => l.includes('/api/social/zernio/connect'))).toBe(false);
  });

  it('⚠️ 3. Facebook, Zernio non autorisé, OAuth direct disponible → action = OAuth direct', async () => {
    const s = serveur(quatre(), zNon());
    await monter(s);
    const fb = carte('facebook');
    expect(fb.getAttribute('data-etat')).toBe('non_connecte');
    expect(boutonsAction(fb).map((b) => b.getAttribute('data-action'))).toEqual(['connecter']);
    const popup = fauxPopup();
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    fireEvent.click(fb.querySelector('[data-action="connecter"]')!);
    await waitFor(() => expect(s.journal.some((l) => /\/api\/social\/connect\b.*facebook/.test(l))).toBe(true));
    expect(s.journal.some((l) => l.includes('/api/social/zernio/connect'))).toBe(false);
  });

  it('⚠️ 4. Aucune voie (Zernio refusé, OAuth absent) → « non configuré », aucun bouton Connecter', async () => {
    const s = serveur(quatre({ instagram: { oauthAvailable: false }, facebook: { oauthAvailable: false } }), zNon());
    await monter(s);
    for (const id of ['instagram', 'facebook']) {
      const c = carte(id);
      expect(c.getAttribute('data-etat')).toBe('non_configure');
      expect(c.querySelector('[data-action="connecter"]')).toBeNull();
      expect(c.querySelector('[data-action="reconnecter"]')).toBeNull();
      expect(c.textContent).toContain(M.status.oauthNotConfigured);
      expect(c.textContent).not.toContain(M.status.ready);
    }
  });

  it('⚠️ 5. OAuth direct réussi → l état est relu (status + zernio) et la carte passe « Connecté » sans reload ni boucle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = serveur(quatre(), zNon());
    await monter(s);
    expect(carte('instagram').getAttribute('data-etat')).toBe('non_connecte');
    const status0 = s.nb('GET /api/social/status');
    const zernio0 = s.nb('GET /api/social/zernio/accounts');
    expect(status0).toBeGreaterThanOrEqual(1);

    await oauthDirect(s, 'instagram', () => {
      s.platforms.instagram = { ...s.platforms.instagram, connected: true, username: 'spordateur' };
      s.comptesDirects = [{ id: 'd1', platform: 'instagram', username: 'spordateur', connected: true, connectedAt: '2026-09-17T09:00:00.000Z' }];
    });
    // Le sondage de fermeture (500 ms) + le délai de relecture (1 s) : on
    // laisse 3 s s'écouler, ce qui couvre aussi une relecture immédiate.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    await waitFor(() => expect(carte('instagram').getAttribute('data-etat')).toBe('connecte'));
    expect(carte('instagram').textContent).toContain('@spordateur');
    expect(reload).not.toHaveBeenCalled();
    // Exactement UNE relecture de plus de chaque source — pas zéro, pas deux.
    expect(s.nb('GET /api/social/status')).toBe(status0 + 1);
    expect(s.nb('GET /api/social/zernio/accounts')).toBe(zernio0 + 1);

    // Pas de boucle : 30 s plus tard, aucun nouvel appel.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(s.nb('GET /api/social/status')).toBe(status0 + 1);
    expect(s.nb('GET /api/social/zernio/accounts')).toBe(zernio0 + 1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('⚠️ 6. Déconnexion directe : modale → confirmer → /api/social/disconnect → état relu, carte non connectée', async () => {
    const s = serveur(quatre({ instagram: { connected: true, username: 'spordateur' } }), zNon());
    await monter(s);
    const ig = carte('instagram');
    expect(ig.getAttribute('data-etat')).toBe('connecte');
    const status0 = s.nb('GET /api/social/status');

    fireEvent.click(ig.querySelector('[data-action="deconnecter"]')!);
    const modale = await screen.findByTestId('confirmation-deconnexion');
    expect(modale.textContent).toContain('Instagram');
    expect(s.journal.some((l) => l.includes('/api/social/disconnect'))).toBe(false);
    fireEvent.click(within(modale).getByText(M.actions.disconnect));

    await waitFor(() => expect(s.journal.some((l) => /^(POST|DELETE) \/api\/social\/disconnect/.test(l))).toBe(true));
    await waitFor(() => expect(s.nb('GET /api/social/status')).toBe(status0 + 1));
    await waitFor(() => expect(carte('instagram').getAttribute('data-etat')).not.toBe('connecte'));
    const apres = carte('instagram');
    expect(apres.querySelector('[data-action="deconnecter"]')).toBeNull();
    expect(apres.querySelector('[data-action="connecter"]')).toBeTruthy();
    expect(apres.textContent).not.toContain('@spordateur');
    expect(screen.queryByTestId('confirmation-deconnexion')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('⚠️ 6b. Déconnexion directe REFUSÉE par le serveur : aucun faux succès — erreur affichée, le compte reste connecté', async () => {
    const s = serveur(quatre({ instagram: { connected: true, username: 'spordateur' } }), zNon());
    s.deconnexionEnPanne = true;
    await monter(s);
    fireEvent.click(carte('instagram').querySelector('[data-action="deconnecter"]')!);
    const modale = await screen.findByTestId('confirmation-deconnexion');
    fireEvent.click(within(modale).getByText(M.actions.disconnect));
    await waitFor(() => expect(s.journal.some((l) => /^(POST|DELETE) \/api\/social\/disconnect/.test(l))).toBe(true));
    await waitFor(() => expect(document.body.textContent).toContain(M.toasts.disconnectError));
    expect(document.body.textContent).not.toContain('Déconnecté de Instagram');
    await waitFor(() => expect(carte('instagram').getAttribute('data-etat')).toBe('connecte'));
    expect(carte('instagram').textContent).toContain('@spordateur');
  });

  it('⚠️ 7. Déconnexion Zernio : modale → confirmer → DELETE /api/social/zernio/accounts → état relu', async () => {
    const s = serveur(quatre(), zOui(compteZ('instagram')));
    await monter(s);
    const ig = carte('instagram');
    expect(ig.getAttribute('data-etat')).toBe('connecte');
    const zernio0 = s.nb('GET /api/social/zernio/accounts');

    fireEvent.click(ig.querySelector('[data-action="deconnecter"]')!);
    const modale = await screen.findByTestId('confirmation-deconnexion');
    expect(modale.textContent).toContain('Instagram');
    // Le texte Zernio porte « {platform} » : il doit être interpolé, jamais affiché brut.
    expect(modale.textContent).not.toContain('{platform}');
    fireEvent.click(within(modale).getByText(M.actions.disconnect));

    await waitFor(() => expect(s.journal.some((l) => l.startsWith('DELETE /api/social/zernio/accounts'))).toBe(true));
    expect(s.journal.some((l) => l.includes('/api/social/disconnect'))).toBe(false);
    await waitFor(() => expect(s.nb('GET /api/social/zernio/accounts')).toBe(zernio0 + 1));
    await waitFor(() => expect(carte('instagram').getAttribute('data-etat')).not.toBe('connecte'));
    expect(carte('instagram').querySelector('[data-action="deconnecter"]')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('⚠️ 8. username absent sur un compte connecté → jamais « @undefined » ni « @null », état « Connecté » affiché', async () => {
    const s = serveur(
      quatre({ instagram: { connected: true, username: null }, facebook: { connected: true, username: undefined } }),
      zOui(compteZ('youtube', null)),
    );
    await monter(s);
    for (const id of ['instagram', 'facebook', 'youtube']) {
      const c = carte(id);
      expect(c.getAttribute('data-etat')).toBe('connecte');
      expect(c.textContent).toContain(M.status.connected);
      expect(c.querySelector('[data-action="deconnecter"]')).toBeTruthy();
    }
    const texte = document.body.textContent ?? '';
    expect(texte).not.toContain('@undefined');
    expect(texte).not.toContain('@null');
    expect(texte).not.toMatch(/@\s*(<|$)/);
    expect(document.body.innerHTML).not.toContain('@undefined');
    expect(document.body.innerHTML).not.toContain('@null');
  });

  it('⚠️ 9. TikTok/YouTube en attente : « Bientôt disponible » sans Zernio, connectables via Zernio sinon', async () => {
    const sA = serveur(quatre(), zNon());
    await monter(sA);
    for (const id of ['tiktok', 'youtube']) {
      const c = carte(id);
      expect(c.getAttribute('data-etat')).toBe('bientot');
      expect(c.textContent).toContain(M.status.comingSoon);
      expect(c.querySelector('[data-action="connecter"]')).toBeNull();
      expect(c.querySelector('[data-action="reconnecter"]')).toBeNull();
    }
    cleanup();

    const sB = serveur(quatre(), zOui());
    await monter(sB);
    for (const id of ['tiktok', 'youtube']) {
      const c = carte(id);
      expect(c.getAttribute('data-etat')).toBe('non_connecte');
      expect(c.textContent).not.toContain(M.status.comingSoon);
      expect(c.querySelector('[data-action="connecter"]')).toBeTruthy();
    }
    fireEvent.click(carte('youtube').querySelector('[data-action="connecter"]')!);
    await waitFor(() => expect(sB.journal.some((l) => l.startsWith('POST /api/social/zernio/connect') && l.includes('youtube'))).toBe(true));
  });

  it('⚠️ 10. Même entrée → même dérivation pour l écran Réseaux et le Calendrier (règle partagée, aucun second fetch)', async () => {
    const platforms = quatre({ instagram: { connected: true, username: 'spordateur' }, youtube: { oauthAvailable: true } });
    const zernio = zOui(compteZ('facebook', 'Afroboost', 'disconnected'));

    // La règle pure, telle que le Calendrier la consomme (hook partagé → deriverTousLesReseaux).
    const attendu = deriverTousLesReseaux(platforms, { autorise: zernio.autorise, raison: zernio.raison, comptes: zernio.comptes });
    expect(Object.keys(attendu).sort()).toEqual([...RESEAUX].sort());

    // L'écran rend EXACTEMENT ces états, sans règle locale.
    const s = serveur(JSON.parse(JSON.stringify(platforms)), JSON.parse(JSON.stringify(zernio)));
    await monter(s);
    for (const r of RESEAUX) expect(carte(r).getAttribute('data-etat')).toBe(attendu[r].etat);
    expect(carte('facebook').querySelector('[data-action="reconnecter"]')).toBeTruthy();

    // Le Calendrier retrouve le réseau par son libellé, puis lit le même hook.
    for (const [libelle, id] of [['Instagram', 'instagram'], ['Facebook', 'facebook'], ['TikTok', 'tiktok'], ['YouTube Shorts', 'youtube']] as const) {
      expect(reseauDepuisLibelle(libelle)).toBe(id);
    }
    expect(reseauDepuisLibelle('Email')).toBeNull();
    expect(sourceCalendrier).toMatch(/import \{ useEtatReseaux \} from '@\/lib\/hooks\/useEtatReseaux'/);
    expect(sourceCalendrier).toMatch(/import \{ reseauDepuisLibelle(, normaliserPlateformesCalendrier)? \} from '@\/lib\/social\/etatReseaux'/);
    expect(sourceCalendrier).toContain('useEtatReseaux()');
    expect(sourceCalendrier).not.toContain("fetch('/api/social/status')");
    expect(sourceCalendrier).not.toContain('fetch("/api/social/status")');
    expect(sourceCalendrier).not.toContain('fetch(`/api/social/status');
    expect(sourcePage).toContain('useEtatReseaux()');
  });

  it('⚠️ 10b. [tranché] L écran Réseaux ne relit pas /api/social/status par un chemin parallèle au hook', async () => {
    // Deux lectures de la même route au montage = deux états qui peuvent
    // diverger (les badges lus une fois ne suivent pas `recharger()`). Le hook
    // expose déjà tout ce qu'il faut ; `oauthAvailable` / `available` se
    // dérivent de l'état unifié (`non_configure`, `bientot`).
    expect(sourcePage).not.toContain("fetch('/api/social/status')");
    expect(sourcePage).not.toContain('fetch("/api/social/status")');
    expect(sourcePage).not.toContain('fetch(`/api/social/status');
    const s = serveur(quatre(), zNon());
    await monter(s);
    expect(s.nb('GET /api/social/status')).toBe(1);
    expect(s.nb('GET /api/social/zernio/accounts')).toBe(1);
  });

  it('⚠️ 11. Après tout le parcours, ni localStorage ni le DOM ne contiennent de jeton', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = serveur(quatre(), zNon());
    await monter(s);

    await oauthDirect(s, 'instagram', () => {
      s.platforms.instagram = { ...s.platforms.instagram, connected: true, username: 'spordateur' };
      s.comptesDirects = [{ id: 'd1', platform: 'instagram', username: 'spordateur', connected: true, connectedAt: '2026-09-17T09:00:00.000Z' }];
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(carte('instagram').getAttribute('data-etat')).toBe('connecte'));

    fireEvent.click(carte('instagram').querySelector('[data-action="deconnecter"]')!);
    const modale = await screen.findByTestId('confirmation-deconnexion');
    fireEvent.click(within(modale).getByText(M.actions.disconnect));
    await waitFor(() => expect(carte('instagram').getAttribute('data-etat')).not.toBe('connecte'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    for (const [cle, valeur] of stockage.entrees()) {
      expect(cle).not.toMatch(/token|access|refresh/i);
      expect(valeur).not.toContain(JETON);
      expect(valeur).not.toMatch(RX_JETON);
      expect(valeur).not.toMatch(/access_token|refresh_token/i);
    }
    const texte = document.body.textContent ?? '';
    expect(texte).not.toContain(JETON);
    expect(texte).not.toMatch(RX_JETON);
    expect(document.body.innerHTML).not.toContain(JETON);
    expect(document.body.innerHTML).not.toMatch(/access_token|refresh_token/i);
  });

  it('⚠️ 12. Aucune requête vers un hôte externe pendant tout le parcours', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = serveur(quatre(), zNon());
    await monter(s);
    await oauthDirect(s, 'facebook', () => {
      s.platforms.facebook = { ...s.platforms.facebook, connected: true, username: 'Afroboost' };
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(carte('facebook').getAttribute('data-etat')).toBe('connecte'));
    fireEvent.click(carte('facebook').querySelector('[data-action="deconnecter"]')!);
    fireEvent.click(within(await screen.findByTestId('confirmation-deconnexion')).getByText(M.actions.disconnect));
    await waitFor(() => expect(carte('facebook').getAttribute('data-etat')).not.toBe('connecte'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(s.externes).toEqual([]);
    expect(s.fetch.mock.calls.length).toBeGreaterThan(0);
    for (const [entree] of s.fetch.mock.calls as Array<[RequestInfo | URL]>) {
      expect(String(entree)).toMatch(/^\/api\//);
    }
    // L'URL OAuth (hôte externe) n'a été confiée qu'à la popup, jamais à fetch.
    expect(s.journal.some((l) => l.includes('facebook.com'))).toBe(false);
  });

  it('13. [CAS A] La carte « Paramètres de publication » n est plus rendue (réglages morts ; la route /api/social/settings reste)', async () => {
    const s = serveur(quatre({ instagram: { connected: true, username: 'spordateur' } }), zOui());
    await monter(s);
    expect(screen.queryByText(M.settings.title)).toBeNull();
    expect(screen.queryByText(M.settings.defaultHashtags.title)).toBeNull();
    expect(screen.queryByText(M.settings.autoPublish.title)).toBeNull();
    expect(screen.queryByText(M.settings.bestTime.title)).toBeNull();
    expect(document.querySelector('#autoPublish')).toBeNull();
    expect(document.querySelector('#bestTime')).toBeNull();
    expect(document.querySelector('[data-testid="parametres-publication"]')).toBeNull();
    // Plus rien n'est écrit ni lu pour ces réglages.
    expect(s.journal.some((l) => l.includes('/api/social/settings'))).toBe(false);
    expect(stockage.entrees().some(([k]) => k === 'studiio_publishing_settings')).toBe(false);
  });

  it('14. UN seul bloc « Publier vous-même », ouvert quand un réseau n a pas la publication auto, CTA vers la bibliothèque', async () => {
    // a) Instagram auto-publie, TikTok/YouTube non → le bloc existe, une fois, ouvert.
    const sA = serveur(quatre({ instagram: { connected: true, username: 'spordateur' } }), zNon());
    await monter(sA);
    const blocs = document.querySelectorAll(SEL_REPLI);
    expect(blocs).toHaveLength(1);
    expect(screen.getAllByText(M.selfPublish.title)).toHaveLength(1);
    const bloc = blocs[0] as HTMLElement;
    const ouvert = bloc.hasAttribute('open') || bloc.getAttribute('data-ouvert') === 'true';
    expect(ouvert).toBe(true);
    const liens = document.querySelectorAll('a[href="/dashboard/library"]');
    expect(liens).toHaveLength(1);
    expect(bloc.contains(liens[0])).toBe(true);
    expect(bloc.textContent).toContain(M.selfPublish.cta);
    // Aucune carte ne porte son propre repli.
    for (const r of RESEAUX) {
      expect(carte(r).querySelector('[data-self-publish]')).toBeNull();
      expect(carte(r).querySelector('a[href="/dashboard/library"]')).toBeNull();
    }
    cleanup();

    // b) Les quatre réseaux auto-publient (Zernio) → au plus un bloc, et fermé.
    const sB = serveur(quatre(), zOui(compteZ('instagram'), compteZ('facebook'), compteZ('tiktok'), compteZ('youtube')));
    await monter(sB);
    const blocsB = document.querySelectorAll(SEL_REPLI);
    expect(blocsB.length).toBeLessThanOrEqual(1);
    if (blocsB.length === 1) {
      const b = blocsB[0] as HTMLElement;
      expect(b.hasAttribute('open') || b.getAttribute('data-ouvert') === 'true').toBe(false);
    }
    expect(document.querySelectorAll('a[href="/dashboard/library"]').length).toBeLessThanOrEqual(1);
  });
});
