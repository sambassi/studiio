import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

/**
 * Créer — ÉDITION DU CONTENU DES CARTES EXISTANTES (portage PR 1).
 *
 * L'étape « Contenu » était en lecture seule : pour changer une valeur, il
 * fallait tout régénérer ou passer par l'éditeur avancé. On porte ici le
 * modèle `CardsRailPanel` de creer-avance, RESTREINT aux cartes existantes :
 * titre, valeur, description. Ni ajout, ni suppression, ni groupe, ni icône.
 *
 * Ce qui est verrouillé :
 * 1. `updateCard` : l'identifiant est conservé, seuls les trois champs changent,
 *    un identifiant inconnu ne change rien.
 * 2. `CartesEditeur` : trois champs par carte, bornés, AUCUN bouton d'ajout ni
 *    de suppression.
 * 3. Dans le vrai assistant : la modification se voit tout de suite dans
 *    l'aperçu ; la voix des cartes déjà générée est marquée périmée.
 * 4. En modification d'un post : le PATCH vise le MÊME post, garde
 *    l'identifiant de chaque carte (couleur, position, champs inconnus
 *    conservés) et ne touche ni aux groupes, ni aux icônes, ni aux médias.
 *    Aucun rendu, aucun débit, aucun fournisseur.
 */

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
import CartesEditeur, { CARTE_LIMITES } from '../components/creer/CartesEditeur';
import { updateCard } from '../lib/creer/selection';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';
import { buildAutoFillText } from '../lib/types/voice';

const CARTES = [
  { id: 'c-1', icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
  { id: 'c-2', icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
];

// ─────────────────────────────────────────────────────────────────────────
describe('updateCard — logique pure', () => {
  it('ne change que la carte visée, garde son identifiant et son icône', () => {
    const r = updateCard(CARTES, 'c-2', { value: '+30%' });
    expect(r[1]).toEqual({ id: 'c-2', icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '+30%' });
    expect(r[0]).toBe(CARTES[0]);
    expect(CARTES[1].value).toBe('5');
  });

  it('seuls titre, valeur et description sont modifiables (id et icône ignorés)', () => {
    const r = updateCard(CARTES, 'c-1', { title: 'Inspirer', id: 'pirate', icon: 'Skull' } as never);
    expect(r[0]).toMatchObject({ id: 'c-1', icon: 'Heart', title: 'Inspirer' });
  });

  it('identifiant inconnu : même tableau, rien ne bouge', () => {
    expect(updateCard(CARTES, 'absente', { title: 'x' })).toBe(CARTES);
  });

  it('les longueurs sont bornées comme dans l’éditeur avancé', () => {
    const r = updateCard(CARTES, 'c-1', {
      value: 'x'.repeat(100),
      description: 'd'.repeat(500),
      title: 't'.repeat(500),
    });
    expect(r[0].value).toHaveLength(CARTE_LIMITES.value);
    expect(r[0].description).toHaveLength(CARTE_LIMITES.description);
    expect(r[0].title).toHaveLength(CARTE_LIMITES.title);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('CartesEditeur — composant', () => {
  afterEach(cleanup);

  it('trois champs par carte, pré-remplis', () => {
    render(<CartesEditeur cards={CARTES} onChange={() => {}} />);
    const c1 = document.querySelector('[data-carte-editeur="c-1"]') as HTMLElement;
    expect((c1.querySelector('[data-carte-champ="title"]') as HTMLInputElement).value).toBe('Respirer');
    expect((c1.querySelector('[data-carte-champ="value"]') as HTMLInputElement).value).toBe('3');
    expect((c1.querySelector('[data-carte-champ="description"]') as HTMLTextAreaElement).value).toBe('Trois minutes');
  });

  it('une saisie remonte l’identifiant et le seul champ modifié', () => {
    const onChange = vi.fn();
    render(<CartesEditeur cards={CARTES} onChange={onChange} />);
    const champ = document.querySelector('[data-carte-editeur="c-2"] [data-carte-champ="value"]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: '+30%' } });
    expect(onChange).toHaveBeenCalledWith('c-2', { value: '+30%' });
  });

  it('les champs sont bornés (maxLength)', () => {
    render(<CartesEditeur cards={CARTES} onChange={() => {}} />);
    const c1 = document.querySelector('[data-carte-editeur="c-1"]') as HTMLElement;
    expect(c1.querySelector('[data-carte-champ="value"]')?.getAttribute('maxLength')).toBe(String(CARTE_LIMITES.value));
    expect(c1.querySelector('[data-carte-champ="description"]')?.getAttribute('maxLength')).toBe(String(CARTE_LIMITES.description));
    expect(c1.querySelector('[data-carte-champ="title"]')?.getAttribute('maxLength')).toBe(String(CARTE_LIMITES.title));
  });

  it('⚠️ PR 1 : AUCUN ajout, AUCUNE suppression, AUCUNE duplication', () => {
    render(<CartesEditeur cards={CARTES} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /ajouter|supprimer|dupliquer/i })).toBeNull();
    expect(document.querySelector('[data-carte-editeur] button')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Le VRAI assistant
// ─────────────────────────────────────────────────────────────────────────
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
    if (u.startsWith('/api/posts/post-42') && method === 'PATCH') {
      return rep({ success: true, data: { ...postServeur, metadata: { ...(postServeur.metadata as object), ...((body as { metadata?: object })?.metadata ?? {}) } } });
    }
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
  const b = screen.queryAllByRole('button', { name: motif })[0];
  if (b) await act(async () => { fireEvent.click(b); await Promise.resolve(); });
  return !!b;
}
const champ = (id: string, nom: 'title' | 'value' | 'description') =>
  document.querySelector(`[data-carte-editeur="${id}"] [data-carte-champ="${nom}"]`) as HTMLInputElement | null;
/** Texte VISIBLE hors champs de saisie (la valeur d'un input n'est pas du textContent). */
const visible = (t: string) => (document.body.textContent ?? '').includes(t);

beforeEach(() => {
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.localStorage.clear();
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('assistant — création : l’étape Contenu devient éditable', () => {
  const GEN = { title: 'Yoga du matin', subtitle: 'Réveiller le corps', cards: CARTES, cta: 'Je commence', ctaSub: '' };
  const autoCartes = buildAutoFillText({
    title: GEN.title, subtitle: GEN.subtitle,
    cards: CARTES.map((c) => ({ label: c.title, value: c.value, description: c.description })),
    ctaMainText: GEN.cta, ctaSubText: GEN.ctaSub,
  }).cartes;

  const poserBrouillon = (extra: Record<string, unknown> = {}) => {
    window.localStorage.setItem(draftKey('a@b.c'), JSON.stringify({
      version: DRAFT_VERSION, savedAt: 1, started: true, step: 3, generated: GEN, ...extra,
    }));
  };

  it('⚠️ les champs des cartes existantes sont là, et la modification se voit tout de suite dans l’aperçu', async () => {
    poserBrouillon();
    render(<AssistantWizard />);
    await laisserTourner();
    expect(champ('c-1', 'title')).not.toBeNull();
    expect(visible('Respirer')).toBe(true);
    await act(async () => { fireEvent.change(champ('c-1', 'title')!, { target: { value: 'Inspirer profondément' } }); });
    await laisserTourner();
    // Plus d'« Respirer » visible nulle part (liste et aperçu), le nouveau titre l'est.
    expect(visible('Inspirer profondément')).toBe(true);
    expect(visible('Respirer')).toBe(false);
  });

  it('valeur et description aussi, et l’identifiant de la carte ne change pas', async () => {
    poserBrouillon();
    render(<AssistantWizard />);
    await laisserTourner();
    await act(async () => { fireEvent.change(champ('c-2', 'value')!, { target: { value: '+30%' } }); });
    await act(async () => { fireEvent.change(champ('c-2', 'description')!, { target: { value: 'Dix postures douces' } }); });
    await laisserTourner();
    expect(visible('+30%')).toBe(true);
    expect(visible('Dix postures douces')).toBe(true);
    // Toujours la même carte — le champ est retrouvé par le même identifiant.
    expect(champ('c-2', 'value')!.value).toBe('+30%');
  });

  it('⚠️ une voix des cartes déjà générée est marquée périmée quand le texte change — rien n’est régénéré', async () => {
    poserBrouillon({
      sequenceVoices: {
        cartes: { text: autoCartes, audioUrl: 'https://cdn/voix-cartes.mp3', source: 'upload', textAtGeneration: autoCartes },
      },
    });
    render(<AssistantWizard />);
    await laisserTourner();
    expect(document.querySelector('[data-voice-stale="cartes"]')).toBeNull();
    await act(async () => { fireEvent.change(champ('c-1', 'value')!, { target: { value: '10' } }); });
    await laisserTourner();
    const perime = document.querySelector('[data-voice-stale="cartes"]');
    expect(perime).not.toBeNull();
    expect(perime!.getAttribute('data-voice-stale-motif')).toBe('texte');
    expect(appels.filter((a) => /tts|voice|render|credits\/deduct/.test(a.url) && a.method === 'POST')).toEqual([]);
  });

  it('⚠️ ni ajout, ni suppression de carte dans l’assistant (PR 1)', async () => {
    poserBrouillon();
    render(<AssistantWizard />);
    await laisserTourner();
    expect(screen.queryByRole('button', { name: /Ajouter une carte/i })).toBeNull();
    expect(document.querySelector('[data-carte-editeur] button')).toBeNull();
  });
});

describe('assistant — modification d’un post : PATCH du même post, rien d’autre de perdu', () => {
  beforeEach(() => {
    postServeur = {
      id: 'post-42',
      title: 'YOGA DU MATIN',
      caption: 'legende',
      status: 'draft',
      scheduled_date: '2026-09-01',
      platforms: ['instagram'],
      media_url: 'https://cdn/montage.webm',
      metadata: {
        subtitle: 'Réveiller le corps',
        cards: [
          { emoji: 'Heart', label: 'Respirer', value: '3', description: 'Trois minutes', color: '#123456', position: { x: 10, y: 20 }, textOnly: true, champInconnu: 'garde-moi' },
          { emoji: 'Zap', label: 'Bouger', value: '5', description: 'Cinq postures', color: '#654321' },
        ],
        cardGroups: [{ id: 'g-1', cardIds: ['card-lu-0', 'card-lu-1'] }],
        design: { cardCustomIcons: { '0': 'https://cdn/icone.png' }, titleFont: 'Anton' },
        renderedVideoUrl: 'https://cdn/montage.webm',
        videoUrl: 'https://cdn/rush.mp4',
      },
    };
  });

  async function ouvrirEtAllerAuContenu() {
    urlQuery = new URLSearchParams('postId=post-42');
    render(<AssistantWizard />);
    await laisserTourner(6);
    for (const m of [/^Continuer vers Style/, /Continuer vers Audio/, /Continuer vers Contenu/]) {
      // eslint-disable-next-line no-await-in-loop
      await cliquer(m);
    }
    await laisserTourner();
  }

  it('⚠️ la valeur modifiée part en PATCH sur post-42 ; la carte garde couleur, position, textOnly et ses champs inconnus', async () => {
    await ouvrirEtAllerAuContenu();
    expect(champ('card-lu-0', 'value')).not.toBeNull();
    await act(async () => { fireEvent.change(champ('card-lu-0', 'value')!, { target: { value: '+30%' } }); });
    await laisserTourner();
    expect(await cliquer(/Enregistrer les modifications/i)).toBe(true);
    await laisserTourner(6);

    const patchs = appels.filter((a) => a.method === 'PATCH');
    expect(patchs).toHaveLength(1);
    expect(patchs[0].url).toBe('/api/posts/post-42');
    const meta = (patchs[0].body as { metadata: Record<string, unknown> }).metadata;
    const cartes = meta.cards as Array<Record<string, unknown>>;
    expect(cartes).toHaveLength(2);
    expect(cartes[0]).toEqual({
      emoji: 'Heart', label: 'Respirer', value: '+30%', description: 'Trois minutes',
      color: '#123456', position: { x: 10, y: 20 }, textOnly: true, champInconnu: 'garde-moi',
    });
    expect(cartes[1]).toMatchObject({ emoji: 'Zap', label: 'Bouger', value: '5', description: 'Cinq postures', color: '#654321' });
  });

  it('⚠️ groupes, icônes personnalisées et médias ne sont ni envoyés modifiés ni perdus ; aucun rendu, aucun débit', async () => {
    await ouvrirEtAllerAuContenu();
    await act(async () => { fireEvent.change(champ('card-lu-1', 'description')!, { target: { value: 'Dix postures' } }); });
    await laisserTourner();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner(6);

    const patch = appels.find((a) => a.method === 'PATCH')!;
    const body = patch.body as { metadata: Record<string, unknown>; media_url?: unknown };
    const meta = body.metadata;
    // Envoi par différence : ce qui n'a pas changé n'est pas envoyé — le serveur le garde.
    // S'il l'était, il devrait être intact.
    if ('cardGroups' in meta) expect(meta.cardGroups).toEqual([{ id: 'g-1', cardIds: ['card-lu-0', 'card-lu-1'] }]);
    if ('design' in meta) expect((meta.design as Record<string, unknown>).cardCustomIcons).toEqual({ '0': 'https://cdn/icone.png' });
    for (const cle of ['renderedVideoUrl', 'videoUrl']) {
      if (cle in meta) expect(meta[cle]).toBe((postServeur.metadata as Record<string, unknown>)[cle]);
    }
    expect('media_url' in body).toBe(false);
    // Aucun rendu, aucun débit, aucun fournisseur.
    // Les lectures GET des catalogues de voix (panneau Voix, au montage) ne
    // coûtent rien ; on ne vise que ce qui PRODUIT ou DÉBITE : les POST.
    expect(appels.filter((a) => a.method === 'POST'
      && /\/api\/render|credits|\/api\/tts|\/api\/voice|replicate|heygen|d-id|\/api\/avatar/i.test(a.url))).toEqual([]);
  });
});
