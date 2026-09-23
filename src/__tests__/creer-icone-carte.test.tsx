import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

/**
 * Créer — CHOISIR L'ICÔNE D'UNE CARTE à l'étape Contenu (portage cartes PR 3).
 *
 * Ce qui est verrouillé :
 * 1. `setCardIcon` : n'accepte QUE des noms lucide de la bibliothèque
 *    (jamais d'emoji, jamais un nom inconnu) ; l'identifiant est conservé.
 * 2. SYNCHRONISATION : chaque icône proposée par la grille (`ICON_LIBRARY`)
 *    est résolue par `CardIcon` (`CARD_ICON_MAP`) — sinon l'aperçu et le
 *    Calendrier afficheraient une icône vide (bug latent signalé par CLAUDE.md).
 * 3. `CartesEditeur` : un bouton d'icône par carte ouvre la grille partagée
 *    `IconPicker` ; sans gestionnaire, aucun bouton (contrat des PR 1/2).
 * 4. Dans le vrai assistant : l'icône choisie se voit dans l'aperçu, part
 *    dans le brouillon, et — en modification — dans le PATCH du même post
 *    (`cards[].emoji`), sans toucher `design.cardCustomIcons` ni les autres
 *    champs de la carte.
 * 5. Une image personnalisée (`design.cardCustomIcons`, éditeur avancé)
 *    s'affiche EN PRIORITÉ dans le Calendrier : l'éditeur le DIT, au lieu de
 *    laisser croire que l'icône choisie y apparaîtra. Rien n'est supprimé.
 * Aucun rendu, aucun crédit, aucun fournisseur.
 */

import { setCardIcon } from '../lib/creer/selection';
import { ALL_LUCIDE_NAMES } from '../lib/icons/library';
import { CARD_ICON_MAP } from '../components/ui/CardIcon';
import CartesEditeur from '../components/creer/CartesEditeur';
import { indexerCartesOrigine, cartesPourEnregistrement } from '../lib/creer/postMetadata/cartes';

const CARTES = [
  { id: 'c-1', icon: 'Heart', title: 'Alpha', description: 'da', value: '1' },
  { id: 'c-2', icon: 'Zap', title: 'Beta', description: 'db', value: '2' },
];

describe('setCardIcon — logique pure', () => {
  it('pose un nom lucide de la bibliothèque, garde l’identifiant et le texte', () => {
    const r = setCardIcon(CARTES, 'c-2', 'Rocket');
    expect(r[1]).toEqual({ id: 'c-2', icon: 'Rocket', title: 'Beta', description: 'db', value: '2' });
    expect(r[0]).toBe(CARTES[0]);
  });

  it('⚠️ refuse un emoji, un nom inconnu ou vide : même tableau', () => {
    expect(setCardIcon(CARTES, 'c-1', '🔥')).toBe(CARTES);
    expect(setCardIcon(CARTES, 'c-1', 'PasUneIcone')).toBe(CARTES);
    expect(setCardIcon(CARTES, 'c-1', '')).toBe(CARTES);
  });

  it('identifiant inconnu ou icône identique : même tableau', () => {
    expect(setCardIcon(CARTES, 'absente', 'Rocket')).toBe(CARTES);
    expect(setCardIcon(CARTES, 'c-1', 'Heart')).toBe(CARTES);
  });
});

describe('enregistrement — une icône CHOISIE reste une icône dans l’éditeur avancé', () => {
  it('⚠️ carte relue dont l’icône change : iconType passe à « svg » (sinon creer-avance affiche le nom en texte)', () => {
    const origines = indexerCartesOrigine({ cards: [
      { id: 'k-1', emoji: '🔥', iconType: 'emoji', label: 'A' },
      { id: 'k-2', emoji: 'Heart', label: 'B' },
    ] });
    const out = cartesPourEnregistrement(
      [
        { id: 'k-1', icon: 'Rocket', title: 'A', value: '', description: '' },
        { id: 'k-2', icon: 'Heart', title: 'B', value: '', description: '' },
      ],
      origines, '#A', '#A',
    );
    expect(out[0]).toMatchObject({ emoji: 'Rocket', iconType: 'svg' });
    // Icône INCHANGÉE : la carte d'origine traverse telle quelle (pas d'iconType ajouté).
    expect('iconType' in out[1]).toBe(false);
  });
});

describe('synchronisation ICON_LIBRARY ↔ CARD_ICON_MAP', () => {
  it('⚠️ chaque icône proposée par la grille est affichable par CardIcon', () => {
    const manquantes = ALL_LUCIDE_NAMES.filter((n) => !CARD_ICON_MAP[n]);
    expect(manquantes).toEqual([]);
  });
});

describe('CartesEditeur — bouton d’icône', () => {
  afterEach(cleanup);

  it('ouvre la grille partagée ; un choix remonte (id, nom) et referme la grille', () => {
    const onIcon = vi.fn();
    render(<CartesEditeur cards={CARTES} onChange={() => {}} onIconChange={onIcon} />);
    expect(document.querySelector('[data-icon-search]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Changer l’icône de la carte 2/i }));
    expect(document.querySelector('[data-icon-search]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-element-pick="Rocket"]') as HTMLElement);
    expect(onIcon).toHaveBeenCalledWith('c-2', 'Rocket');
    expect(document.querySelector('[data-icon-search]')).toBeNull();
  });

  it('la grille ne propose que des SVG lucide — aucun emoji', () => {
    render(<CartesEditeur cards={CARTES} onChange={() => {}} onIconChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Changer l’icône de la carte 1/i }));
    const boutons = [...document.querySelectorAll('[data-element-pick]')];
    expect(boutons.length).toBeGreaterThan(100);
    for (const b of boutons) expect(b.querySelector('svg')).not.toBeNull();
    // L'icône courante est mise en évidence.
    expect(document.querySelector('[data-element-pick="Heart"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('sans gestionnaire : aucun bouton d’icône (contrat des PR 1 et 2)', () => {
    render(<CartesEditeur cards={CARTES} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /Changer l’icône/i })).toBeNull();
  });

  it('image personnalisée signalée : l’éditeur dit qu’elle s’affiche à la place dans le Calendrier', () => {
    render(<CartesEditeur cards={CARTES} onChange={() => {}} onIconChange={() => {}} iconesMasquees={new Set(['c-1'])} />);
    expect(document.querySelector('[data-carte-editeur="c-1"] [data-carte-icone-masquee]')).not.toBeNull();
    expect(document.querySelector('[data-carte-editeur="c-2"] [data-carte-icone-masquee]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Le VRAI assistant
// ─────────────────────────────────────────────────────────────────────────
class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

interface Appel { url: string; method: string; body: unknown }
let appels: Appel[];
let postServeur: Record<string, unknown>;

function installerFetch() {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = String(init?.method ?? 'GET').toUpperCase();
    let body: unknown = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
    appels.push({ url: u, method, body });
    const rep = (corps: unknown, status = 200) => ({ ok: status < 300, status, json: async () => corps } as Response);
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    if (u.includes('/api/social/')) return rep({ success: true, platforms: {}, channels: {}, autorise: false, comptes: [] });
    if (u.startsWith('/api/posts/post-42')) return rep({ success: true, data: postServeur });
    return rep({ success: true, ok: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}
async function laisserTourner(n = 4) {
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
}
async function cliquer(motif: RegExp) {
  const b = screen.queryAllByRole('button', { name: motif })[0] as HTMLButtonElement | undefined;
  if (b && !b.disabled) await act(async () => { fireEvent.click(b); await Promise.resolve(); });
  return b;
}
async function choisirIcone(rang: number, nom: string) {
  await cliquer(new RegExp(`Changer l’icône de la carte ${rang}`, 'i'));
  await act(async () => { fireEvent.click(document.querySelector(`[data-element-pick="${nom}"]`) as HTMLElement); });
  await laisserTourner();
}

beforeEach(() => {
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.localStorage.clear();
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('assistant — création : l’icône choisie se voit et se garde', () => {
  it('⚠️ choisir « Rocket » pour la carte 1 : visible dans l’aperçu, enregistrée dans le brouillon, id inchangé', async () => {
    window.localStorage.setItem(draftKey('a@b.c'), JSON.stringify({
      version: DRAFT_VERSION, savedAt: 1, started: true, step: 3, format: '9:16',
      generated: { title: 'Yoga', subtitle: 'Matin', cards: CARTES, cta: 'Go', ctaSub: '' },
    }));
    render(<AssistantWizard />);
    await laisserTourner();
    expect(document.querySelector('[data-card-id="c-1"] .lucide-rocket')).toBeNull();
    await choisirIcone(1, 'Rocket');
    expect(document.querySelector('[data-card-id="c-1"] .lucide-rocket')).not.toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    const b = JSON.parse(window.localStorage.getItem(draftKey('a@b.c'))!);
    expect(b.generated.cards[0]).toMatchObject({ id: 'c-1', icon: 'Rocket', title: 'Alpha' });
    expect(appels.filter((a) => a.method === 'POST'
      && /\/api\/render|credits|\/api\/tts|\/api\/voice|\/api\/content|replicate|heygen|d-id|\/api\/avatar/i.test(a.url))).toEqual([]);
  });
});

describe('assistant — modification : PATCH du même post, rien d’autre touché', () => {
  beforeEach(() => {
    postServeur = {
      id: 'post-42', title: 'YOGA', caption: 'l', status: 'draft', scheduled_date: '2026-09-01', platforms: [],
      metadata: {
        cards: [
          { id: 'k-1', emoji: 'Heart', label: 'Alpha', value: '1', description: 'da', color: '#111', position: { x: 1, y: 2 }, inconnu: 'garde' },
          { id: 'k-2', emoji: 'Zap', label: 'Beta', value: '2', description: 'db' },
        ],
        design: { titleFont: 'Anton', cardCustomIcons: { '0': 'https://cdn/image-perso.png' } },
      },
    };
  });

  async function ouvrirContenu() {
    urlQuery = new URLSearchParams('postId=post-42');
    render(<AssistantWizard />);
    await laisserTourner(6);
    for (const m of [/^Continuer vers Style/, /Continuer vers Audio/, /Continuer vers Contenu/]) {
      // eslint-disable-next-line no-await-in-loop
      await cliquer(m);
    }
    await laisserTourner();
  }

  it('⚠️ l’icône part dans cards[].emoji ; champs de la carte et cardCustomIcons intacts', async () => {
    await ouvrirContenu();
    await choisirIcone(2, 'Rocket');
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner(6);
    const patch = appels.filter((a) => a.method === 'PATCH');
    expect(patch).toHaveLength(1);
    expect(patch[0].url).toBe('/api/posts/post-42');
    const meta = (patch[0].body as { metadata: Record<string, unknown> }).metadata;
    const cartes = meta.cards as Array<Record<string, unknown>>;
    expect(cartes[1]).toMatchObject({ id: 'k-2', emoji: 'Rocket', label: 'Beta', value: '2', description: 'db' });
    expect(cartes[0]).toMatchObject({ id: 'k-1', emoji: 'Heart', color: '#111', position: { x: 1, y: 2 }, inconnu: 'garde' });
    if ('design' in meta) {
      expect((meta.design as Record<string, unknown>).cardCustomIcons).toEqual({ '0': 'https://cdn/image-perso.png' });
    }
  });

  it('⚠️ la carte qui a une image personnalisée est signalée (et elle seule)', async () => {
    await ouvrirContenu();
    expect(document.querySelector('[data-carte-editeur="k-1"] [data-carte-icone-masquee]')).not.toBeNull();
    expect(document.querySelector('[data-carte-editeur="k-2"] [data-carte-icone-masquee]')).toBeNull();
  });
});
