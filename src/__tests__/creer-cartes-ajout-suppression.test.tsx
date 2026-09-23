import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

/**
 * Créer — AJOUT et SUPPRESSION de cartes, SANS PERTE (portage PR 2).
 *
 * L'audit avait trouvé trois dépendances cachées qui rendaient l'ajout et la
 * suppression dangereux sur un post existant :
 *
 *   B1. Les cartes n'avaient pas d'identifiant PERSISTANT : `to-wizard` les
 *       renumérotait `card-lu-N` à chaque chargement, alors que `cardGroups`
 *       gardait les identifiants de la session. Supprimer la 2e carte, puis
 *       recharger : le groupe désignait une AUTRE carte.
 *   B2. `design.cardCustomIcons` est rangé par POSITION (`{'0': url}`) et lu
 *       ainsi par le Calendrier : supprimer une carte décalait les icônes.
 *   B3. Mode libre : une carte sans emplacement efface TOUTE la disposition ;
 *       un emplacement orphelin invalide le brouillon au rechargement.
 *
 * Les corrections, vérifiées ici :
 *   - l'`id` de chaque carte est ÉCRIT dans `metadata.cards` et RELU (repli
 *     `card-lu-N` pour les posts qui n'en ont pas, unicité garantie) ;
 *   - `cardCustomIcons` est RÉALIGNÉ par identifiant à l'enregistrement, et
 *     n'est envoyé que s'il change ;
 *   - ajouter crée l'emplacement de la carte ; supprimer retire carte,
 *     emplacement, appartenance aux groupes, sélection ;
 *   - aucun champ inconnu perdu ; aucun rendu, crédit ni fournisseur.
 */

import {
  idsCartesLues, indexerCartesOrigine, indexerRangsOrigine, cartesPourEnregistrement, iconesPersoRealignees,
} from '../lib/creer/postMetadata/cartes';
import { toWizardDraft } from '../lib/creer/postMetadata/to-wizard';
import { metadataPourEnregistrement } from '../lib/creer/postMetadata/from-wizard';
import { addCard, removeCard, boxForNewCard, removeBox, maxCards } from '../lib/creer/selection';

/** `Draft.generated` est typé largement : on relit les cartes sous leur forme d'écran. */
type CarteLue = { id: string; icon: string; title: string; value: string; description: string };
const cartesDe = (d: { generated?: unknown }) => (d.generated as { cards: CarteLue[] }).cards;

// ─────────────────────────────────────────────────────────────────────────
describe('B1 — identifiants de carte PERSISTANTS', () => {
  it('idsCartesLues : l’id enregistré fait foi ; sinon card-lu-N ; jamais deux fois le même', () => {
    expect(idsCartesLues([{ id: 'a' }, {}, { id: 'b' }])).toEqual(['a', 'card-lu-1', 'b']);
    expect(idsCartesLues([{ id: 'x' }, { id: 'x' }, { id: '' }, 42])).toEqual(['x', 'card-lu-1', 'card-lu-2', 'card-lu-3']);
    // Un id enregistré qui vaut le repli d'une AUTRE carte ne la vole pas.
    expect(idsCartesLues([{}, { id: 'card-lu-0' }])).toEqual(['card-lu-0', 'card-lu-1']);
  });

  it('to-wizard relit l’id enregistré ; la table des origines utilise EXACTEMENT les mêmes', () => {
    const meta = { cards: [{ id: 'k1', label: 'A' }, { label: 'B' }] };
    const d = toWizardDraft({ title: 'T', metadata: meta } as never);
    expect(cartesDe(d).map((c) => c.id)).toEqual(['k1', 'card-lu-1']);
    expect([...indexerCartesOrigine(meta).keys()]).toEqual(['k1', 'card-lu-1']);
    expect([...indexerRangsOrigine(meta).entries()]).toEqual([['k1', 0], ['card-lu-1', 1]]);
  });

  it('cartesPourEnregistrement ÉCRIT l’id de chaque carte — relue comme neuve — sans perdre les champs inconnus', () => {
    const origines = indexerCartesOrigine({ cards: [{ label: 'A', color: '#111', position: { x: 1, y: 2 }, inconnu: 'garde' }] });
    const out = cartesPourEnregistrement(
      [
        { id: 'card-lu-0', icon: 'Heart', title: 'A', value: '1', description: 'd' },
        { id: 'neuve-1', icon: 'Star', title: 'N', value: '', description: '' },
      ],
      origines, '#ACC', '#ACC',
    );
    expect(out[0]).toEqual({ id: 'card-lu-0', label: 'A', color: '#111', position: { x: 1, y: 2 }, inconnu: 'garde', emoji: 'Heart', value: '1', description: 'd' });
    expect(out[1]).toEqual({ id: 'neuve-1', emoji: 'Star', label: 'N', value: '', description: '', color: '#ACC' });
  });

  it('⚠️ aller-retour : supprimer la 2e carte, enregistrer, RECHARGER — le groupe désigne toujours les MÊMES cartes', () => {
    const post = {
      title: 'T',
      metadata: {
        cards: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }],
        cardGroups: [{ id: 'g1', cardIds: ['card-lu-0', 'card-lu-2'] }],
      },
    };
    const d = toWizardDraft(post as never);
    const origines = indexerCartesOrigine(post.metadata);
    const apres = cartesDe(d).filter((c) => c.id !== 'card-lu-1');
    const cartesEnvoyees = cartesPourEnregistrement(apres, origines, '#A', '#A');
    const relu = toWizardDraft({ title: 'T', metadata: { ...post.metadata, cards: cartesEnvoyees } } as never);
    const parId = Object.fromEntries(cartesDe(relu).map((c) => [c.id, c.title]));
    expect(post.metadata.cardGroups[0].cardIds.map((id) => parId[id])).toEqual(['Alpha', 'Gamma']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B2 — icônes personnalisées réalignées par identifiant', () => {
  const rangs = new Map([['card-lu-0', 0], ['card-lu-1', 1], ['card-lu-2', 2]]);
  const icones = { '0': 'a.png', '1': 'b.png', '2': 'c.png', 'custom-99': 'z.png' };

  it('suppression : l’icône suit SA carte, celle de la carte supprimée disparaît, les clés non numériques restent', () => {
    const r = iconesPersoRealignees(icones, [{ id: 'card-lu-0' }, { id: 'card-lu-2' }], rangs);
    expect(r).toEqual({ '0': 'a.png', '1': 'c.png', 'custom-99': 'z.png' });
  });

  it('ajout : une carte neuve n’hérite d’aucune icône ; réordonner suit les cartes', () => {
    expect(iconesPersoRealignees(icones, [{ id: 'card-lu-2' }, { id: 'neuve' }, { id: 'card-lu-0' }], rangs))
      .toEqual({ '0': 'c.png', '2': 'a.png', 'custom-99': 'z.png' });
  });

  it('⚠️ structure INCHANGÉE (mêmes cartes, même ordre) : undefined — rien n’est envoyé ni réécrit', () => {
    expect(iconesPersoRealignees(icones, [{ id: 'card-lu-0' }, { id: 'card-lu-1' }, { id: 'card-lu-2' }], rangs)).toBeUndefined();
    expect(iconesPersoRealignees(undefined, [{ id: 'card-lu-0' }], rangs)).toBeUndefined();
  });

  it('⚠️ suppression : les métadonnées NON associées aux cartes restent intactes (orpheline numérique, clé inconnue, valeur non textuelle)', () => {
    const riches = { '0': 'a.png', '1': 'b.png', '2': 'c.png', '7': 'orph.png', 'custom-x': 'u.png', '01': 'n.png', '5': null, '1x': 3 };
    expect(iconesPersoRealignees(riches, [{ id: 'card-lu-0' }, { id: 'card-lu-2' }], rangs)).toEqual({
      '0': 'a.png', '1': 'c.png', '7': 'orph.png', 'custom-x': 'u.png', '01': 'n.png', '5': null, '1x': 3,
    });
  });

  it('une valeur non textuelle attachée à une carte SUIT sa carte, intacte', () => {
    expect(iconesPersoRealignees({ '0': 'a.png', '1': { v: 1 }, '2': 'c.png' }, [{ id: 'card-lu-1' }, { id: 'card-lu-2' }], rangs))
      .toEqual({ '0': { v: 1 }, '1': 'c.png' });
  });

  it('⚠️ ajout sur une position occupée par une orpheline : la carte neuve n’hérite de RIEN, l’orpheline est conservée sous une clé non lue', () => {
    const r = iconesPersoRealignees({ '0': 'a.png', '1': 'b.png', '2': 'c.png', '3': 'o3.png' },
      [{ id: 'card-lu-0' }, { id: 'card-lu-1' }, { id: 'card-lu-2' }, { id: 'neuve' }], rangs)!;
    expect(r['3']).toBeUndefined();
    expect(r).toEqual({ '0': 'a.png', '1': 'b.png', '2': 'c.png', 'orphelin-3': 'o3.png' });
  });

  it('from-wizard : envoyé seulement s’il change, DANS design, sans perdre le reste de design', () => {
    const base = { design: { titleFont: 'Anton', cardCustomIcons: icones } };
    const inchange = metadataPourEnregistrement(base, { cardCustomIcons: icones }, { cardCustomIcons: icones });
    expect(inchange.design).toBeUndefined();
    const change = metadataPourEnregistrement(base, { cardCustomIcons: { '0': 'a.png' } }, { cardCustomIcons: icones });
    expect(change.design).toEqual({ titleFont: 'Anton', cardCustomIcons: { '0': 'a.png' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B3 — règles pures d’ajout / suppression / emplacement', () => {
  const C = (id: string) => ({ id, icon: 'Star', title: id, value: '', description: '' });

  it('addCard ajoute à la fin, refuse au-delà du maximum du format', () => {
    const r = addCard([C('a'), C('b')], C('n'), 5);
    expect(r.added).toBe(true);
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'b', 'n']);
    const plein = [1, 2, 3, 4, 5].map((i) => C(`c${i}`));
    expect(addCard(plein, C('n'), maxCards('9:16'))).toEqual({ cards: plein, added: false });
  });

  it('removeCard retire par identifiant, jamais la DERNIÈRE carte', () => {
    expect(removeCard([C('a'), C('b')], 'a')).toEqual({ cards: [C('b')], removed: true });
    const un = [C('a')];
    expect(removeCard(un, 'a')).toEqual({ cards: un, removed: false });
    const deux = [C('a'), C('b')];
    expect(removeCard(deux, 'absente')).toEqual({ cards: deux, removed: false });
  });

  it('boxForNewCard : décalée de la dernière carte, bornée ; case par défaut sinon', () => {
    expect(boxForNewCard({ a: { x: 10, y: 20, w: 30, h: 15 } }, 'a')).toEqual({ x: 13, y: 23, w: 30, h: 15 });
    expect(boxForNewCard({ a: { x: 69, y: 84, w: 30, h: 15 } }, 'a')).toEqual({ x: 70, y: 85, w: 30, h: 15 });
    const def = boxForNewCard({}, 'absente');
    expect(def.w).toBeGreaterThan(0);
    expect(def.x + def.w).toBeLessThanOrEqual(100);
  });

  it('removeBox retire l’emplacement orphelin (sinon le brouillon rechargé perd TOUTE la disposition)', () => {
    expect(removeBox({ a: { x: 1, y: 1, w: 1, h: 1 }, b: { x: 2, y: 2, w: 2, h: 2 } }, 'a')).toEqual({ b: { x: 2, y: 2, w: 2, h: 2 } });
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
    if (u.startsWith('/api/posts/post-42') && method === 'PATCH') return rep({ success: true, data: postServeur });
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
const editeurs = () => [...document.querySelectorAll('[data-carte-editeur]')].map((e) => e.getAttribute('data-carte-editeur'));
const pauseBrouillon = () => act(async () => { await new Promise((r) => setTimeout(r, 600)); });
const brouillon = () => JSON.parse(window.localStorage.getItem(draftKey('a@b.c')) ?? '{}');

beforeEach(() => {
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.localStorage.clear();
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('assistant — création : ajouter / supprimer à l’étape Contenu', () => {
  const CARTES = [
    { id: 'c-1', icon: 'Heart', title: 'Alpha', description: 'da', value: '1' },
    { id: 'c-2', icon: 'Zap', title: 'Beta', description: 'db', value: '2' },
    { id: 'c-3', icon: 'Star', title: 'Gamma', description: 'dc', value: '3' },
  ];
  const BOXES = { 'c-1': { x: 5, y: 10, w: 40, h: 15 }, 'c-2': { x: 50, y: 10, w: 40, h: 15 }, 'c-3': { x: 5, y: 40, w: 40, h: 15 } };
  const poser = (extra: Record<string, unknown> = {}) => {
    window.localStorage.setItem(draftKey('a@b.c'), JSON.stringify({
      version: DRAFT_VERSION, savedAt: 1, started: true, step: 3, format: '9:16',
      generated: { title: 'Yoga', subtitle: 'Matin', cards: CARTES, cta: 'Go', ctaSub: '' },
      ...extra,
    }));
  };

  it('⚠️ ajouter : une carte vide apparaît, éditable ; en mode libre la disposition est GARDÉE (+ emplacement de la nouvelle)', async () => {
    poser({ cardBoxes: { format: '9:16', boxes: BOXES } });
    render(<AssistantWizard />);
    await laisserTourner();
    expect(editeurs()).toEqual(['c-1', 'c-2', 'c-3']);
    await cliquer(/Ajouter une carte/i);
    await laisserTourner();
    const ids = editeurs();
    expect(ids).toHaveLength(4);
    const neuve = ids[3]!;
    expect(['c-1', 'c-2', 'c-3']).not.toContain(neuve);
    await pauseBrouillon();
    const b = brouillon();
    expect(b.cardBoxes?.boxes).toBeTruthy();
    expect(Object.keys(b.cardBoxes.boxes).sort()).toEqual([...ids].sort());
    expect(b.cardBoxes.boxes['c-1']).toEqual(BOXES['c-1']);
  });

  it('⚠️ supprimer : carte, emplacement, groupe (et sélection) suivent ; les autres cartes sont intactes', async () => {
    poser({
      cardBoxes: { format: '9:16', boxes: BOXES },
      cardGroups: [{ id: 'g1', cardIds: ['c-1', 'c-2'] }],
    });
    render(<AssistantWizard />);
    await laisserTourner();
    await cliquer(/Supprimer la carte 2/i);
    await laisserTourner();
    expect(editeurs()).toEqual(['c-1', 'c-3']);
    expect((document.body.textContent ?? '').includes('Beta')).toBe(false);
    await pauseBrouillon();
    const b = brouillon();
    expect(Object.keys(b.cardBoxes.boxes).sort()).toEqual(['c-1', 'c-3']);
    expect(b.cardBoxes.boxes['c-3']).toEqual(BOXES['c-3']);
    // Un groupe de 2 qui perd un membre n'a plus d'objet.
    expect(b.cardGroups ?? []).toEqual([]);
    expect(b.generated.cards.map((c: { title: string }) => c.title)).toEqual(['Alpha', 'Gamma']);
  });

  it('bornes : impossible de supprimer la DERNIÈRE carte ; ajout désactivé au maximum du format', async () => {
    poser({ generated: { title: 'Y', subtitle: '', cards: [CARTES[0]], cta: '', ctaSub: '' } });
    render(<AssistantWizard />);
    await laisserTourner();
    const suppr = screen.getAllByRole('button', { name: /Supprimer la carte 1/i })[0] as HTMLButtonElement;
    expect(suppr.disabled).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await cliquer(/Ajouter une carte/i);
    }
    await laisserTourner();
    expect(editeurs()).toHaveLength(maxCards('9:16'));
    expect((screen.getAllByRole('button', { name: /Ajouter une carte/i })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('aucun rendu, aucun crédit, aucun fournisseur à l’ajout ou à la suppression', async () => {
    poser();
    render(<AssistantWizard />);
    await laisserTourner();
    await cliquer(/Ajouter une carte/i);
    await cliquer(/Supprimer la carte 1/i);
    await laisserTourner();
    expect(appels.filter((a) => a.method === 'POST'
      && /\/api\/render|credits|\/api\/tts|\/api\/voice|\/api\/content|replicate|heygen|d-id|\/api\/avatar/i.test(a.url))).toEqual([]);
  });
});

describe('assistant — sélection et double clic', () => {
  const CARTES3 = [
    { id: 'c-1', icon: 'Heart', title: 'Alpha', description: 'da', value: '1' },
    { id: 'c-2', icon: 'Zap', title: 'Beta', description: 'db', value: '2' },
    { id: 'c-3', icon: 'Star', title: 'Gamma', description: 'dc', value: '3' },
  ];
  const poser = () => window.localStorage.setItem(draftKey('a@b.c'), JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 3, format: '9:16',
    generated: { title: 'Yoga', subtitle: 'Matin', cards: CARTES3, cta: 'Go', ctaSub: '' },
  }));

  it('⚠️ supprimer la carte SÉLECTIONNÉE laisse une sélection valide (vide, sans fantôme)', async () => {
    poser();
    render(<AssistantWizard />);
    await laisserTourner();
    const carte = document.querySelector('[data-card-id="c-2"]') as HTMLElement;
    expect(carte).not.toBeNull();
    await act(async () => { fireEvent.pointerDown(carte, { button: 0, isPrimary: true, pointerId: 1 }); });
    await laisserTourner();
    expect(document.body.textContent).toContain('1 carte sélectionnée');
    await cliquer(/Supprimer la carte 2/i);
    await laisserTourner();
    expect(editeurs()).toEqual(['c-1', 'c-3']);
    expect(document.body.textContent).not.toContain('sélectionnée');
  });

  it('⚠️ double clic sur « Ajouter » : DEUX cartes, aucune écrasée', async () => {
    poser();
    render(<AssistantWizard />);
    await laisserTourner();
    const ajouter = screen.getAllByRole('button', { name: /Ajouter une carte/i })[0];
    await act(async () => { fireEvent.click(ajouter); fireEvent.click(ajouter); });
    await laisserTourner();
    expect(editeurs()).toHaveLength(5);
    expect(new Set(editeurs()).size).toBe(5);
  });

  it('⚠️ deux suppressions rapides : les DEUX cartes partent, aucune ne revient', async () => {
    poser();
    render(<AssistantWizard />);
    await laisserTourner();
    const s1 = screen.getAllByRole('button', { name: /Supprimer la carte 1/i })[0];
    const s2 = screen.getAllByRole('button', { name: /Supprimer la carte 2/i })[0];
    await act(async () => { fireEvent.click(s1); fireEvent.click(s2); });
    await laisserTourner();
    expect(editeurs()).toEqual(['c-3']);
  });
});

describe('assistant — enregistrement SANS changement de structure : icônes intactes', () => {
  const ICONES = { '0': 'a.png', '1': 'b.png', '7': 'orph.png', 'custom-x': 'u.png', '5': null };
  beforeEach(() => {
    postServeur = {
      id: 'post-42', title: 'YOGA', caption: 'l', status: 'draft', scheduled_date: '2026-09-01', platforms: [],
      metadata: {
        cards: [
          { emoji: 'Heart', label: 'Alpha', value: '1', description: 'da' },
          { emoji: 'Zap', label: 'Beta', value: '2', description: 'db' },
        ],
        design: { titleFont: 'Anton', cardCustomIcons: ICONES },
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

  it('⚠️ aucune carte ajoutée, supprimée ni déplacée (texte seulement) : cardCustomIcons n’est PAS réécrit', async () => {
    await ouvrirContenu();
    const champ = document.querySelector('[data-carte-editeur="card-lu-1"] [data-carte-champ="value"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(champ, { target: { value: '+30%' } }); });
    await laisserTourner();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner(6);
    const meta = (appels.find((a) => a.method === 'PATCH')!.body as { metadata: Record<string, unknown> }).metadata;
    // `design` peut partir pour une AUTRE raison (défaut antérieur des CTA) ; si
    // c'est le cas, les icônes y sont EXACTEMENT celles de la base.
    if ('design' in meta) expect((meta.design as Record<string, unknown>).cardCustomIcons).toEqual(ICONES);
  });

  it('⚠️ enregistrer sans rien toucher : cardCustomIcons exactement conservé', async () => {
    await ouvrirContenu();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner(6);
    const patch = appels.find((a) => a.method === 'PATCH');
    if (patch) {
      const meta = (patch.body as { metadata: Record<string, unknown> }).metadata;
      if ('design' in meta) expect((meta.design as Record<string, unknown>).cardCustomIcons).toEqual(ICONES);
    }
  });

  it('⚠️ suppression dans l’assistant : orpheline, clé inconnue et valeur non textuelle intactes', async () => {
    await ouvrirContenu();
    await cliquer(/Supprimer la carte 1/i);
    await laisserTourner();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner(6);
    const meta = (appels.find((a) => a.method === 'PATCH')!.body as { metadata: Record<string, unknown> }).metadata;
    expect((meta.design as Record<string, unknown>).cardCustomIcons).toEqual({
      '0': 'b.png', '7': 'orph.png', 'custom-x': 'u.png', '5': null,
    });
  });
});

describe('assistant — modification d’un post : suppression SANS PERTE', () => {
  beforeEach(() => {
    postServeur = {
      id: 'post-42', title: 'YOGA', caption: 'l', status: 'draft', scheduled_date: '2026-09-01', platforms: [],
      metadata: {
        cards: [
          { emoji: 'Heart', label: 'Alpha', value: '1', description: 'da', color: '#111', position: { x: 1, y: 2 }, inconnu: 'garde' },
          { emoji: 'Zap', label: 'Beta', value: '2', description: 'db', color: '#222' },
          { emoji: 'Star', label: 'Gamma', value: '3', description: 'dc', color: '#333', textOnly: true },
        ],
        cardGroups: [{ id: 'g1', cardIds: ['card-lu-0', 'card-lu-2'] }],
        design: { titleFont: 'Anton', cardCustomIcons: { '0': 'a.png', '1': 'b.png', '2': 'c.png' } },
        renderedVideoUrl: 'https://cdn/montage.webm',
      },
    };
  });

  it('⚠️ supprimer la carte 2 : ids écrits, champs inconnus gardés, icônes réalignées, groupe intact, reste de design gardé', async () => {
    urlQuery = new URLSearchParams('postId=post-42');
    render(<AssistantWizard />);
    await laisserTourner(6);
    for (const m of [/^Continuer vers Style/, /Continuer vers Audio/, /Continuer vers Contenu/]) {
      // eslint-disable-next-line no-await-in-loop
      await cliquer(m);
    }
    await laisserTourner();
    expect(editeurs()).toEqual(['card-lu-0', 'card-lu-1', 'card-lu-2']);
    await cliquer(/Supprimer la carte 2/i);
    await laisserTourner();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner(6);

    const patch = appels.filter((a) => a.method === 'PATCH');
    expect(patch).toHaveLength(1);
    expect(patch[0].url).toBe('/api/posts/post-42');
    const meta = (patch[0].body as { metadata: Record<string, unknown> }).metadata;
    const cartes = meta.cards as Array<Record<string, unknown>>;
    expect(cartes.map((c) => c.id)).toEqual(['card-lu-0', 'card-lu-2']);
    expect(cartes[0]).toMatchObject({ label: 'Alpha', color: '#111', position: { x: 1, y: 2 }, inconnu: 'garde' });
    expect(cartes[1]).toMatchObject({ label: 'Gamma', color: '#333', textOnly: true });
    // Icônes : celle de Gamma passe à la position 1, celle de Beta disparaît.
    // Le reste de `design` est conservé, les icônes suivent leur carte.
    // (`ctaMainText`/`ctaSubText` vides peuvent aussi partir : défaut ANTÉRIEUR
    // de l'empreinte de chargement de l'assistant, hors de ce lot — valeur vide.)
    expect(meta.design).toMatchObject({ titleFont: 'Anton', cardCustomIcons: { '0': 'a.png', '1': 'c.png' } });
    for (const [cle, v] of Object.entries(meta.design as Record<string, unknown>)) {
      if (cle === 'titleFont' || cle === 'cardCustomIcons') continue;
      expect(['ctaMainText', 'ctaSubText']).toContain(cle);
      expect(v).toBe('');
    }
    // Le groupe désignait Alpha et Gamma — toujours valides, avec les ids désormais PERSISTÉS.
    if ('cardGroups' in meta) expect(meta.cardGroups).toEqual([{ id: 'g1', cardIds: ['card-lu-0', 'card-lu-2'] }]);
    // Médias intacts, aucun rendu ni débit.
    expect('renderedVideoUrl' in meta ? meta.renderedVideoUrl : 'https://cdn/montage.webm').toBe('https://cdn/montage.webm');
    expect(appels.filter((a) => a.method === 'POST' && /\/api\/render|credits/i.test(a.url))).toEqual([]);
  });
});
