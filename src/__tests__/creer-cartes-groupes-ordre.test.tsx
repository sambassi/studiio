import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  blocsCartes, regrouper, deplacerBloc, basculerSelection, ungroupCards, expandSelection,
  type CardGroup,
} from '@/lib/creer/selection';
import {
  calageCartes, morceauxCartes, texteDesMorceaux, type TimingVoix,
} from '@/lib/creer/synchro-cartes';
import { capturerEtapesCartes } from '@/lib/creer/capture-etapes-cartes';
import SequenceCards from '@/components/creer/SequenceCards';
import CartesEditeur from '@/components/creer/CartesEditeur';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import { indexerCartesOrigine, cartesPourEnregistrement } from '@/lib/creer/postMetadata/cartes';

/**
 * Cartes — sélection multiple, Regrouper / Dissocier, ordre des blocs.
 *
 * Trois invariants portent tout le reste :
 *   1. le TEXTE d'une carte n'est jamais modifié — seuls l'ordre du tableau et
 *      l'appartenance aux groupes changent ;
 *   2. l'ordre du tableau EST l'ordre affiché (liste, aperçu, photo exportée)
 *      ET l'ordre de lecture de la voix ;
 *   3. un groupe ne force pas un instant commun : chaque ligne garde son
 *      propre horodatage.
 */

afterEach(cleanup);

type Carte = { id: string; icon: string; title: string; description: string; value: string };
const carte = (id: string): Carte => ({ id, icon: 'Flame', title: `Titre ${id}`, description: `Desc ${id}`, value: `${id}%` });
const CARTES = ['a', 'b', 'c', 'd', 'e'].map(carte);
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
const g = (id: string, ...cardIds: string[]): CardGroup => ({ id, cardIds });
const seq = () => { let n = 0; return () => `g${++n}`; };

// ─────────────────────────────────────────────────────────────────────────
describe('blocsCartes', () => {
  it('cartes seules et groupes consécutifs, dans l’ordre du tableau', () => {
    expect(blocsCartes(CARTES, [g('g1', 'b', 'c')])).toEqual([
      { id: 'carte:a', groupId: null, cardIds: ['a'] },
      { id: 'groupe:g1', groupId: 'g1', cardIds: ['b', 'c'] },
      { id: 'carte:d', groupId: null, cardIds: ['d'] },
      { id: 'carte:e', groupId: null, cardIds: ['e'] },
    ]);
  });

  it('un groupe NON consécutif donne plusieurs blocs — jamais rassemblé en silence', () => {
    const blocs = blocsCartes(CARTES, [g('g1', 'a', 'c')]);
    expect(blocs.map((b) => b.id)).toEqual(['groupe:g1', 'carte:b', 'groupe:g1#2', 'carte:d', 'carte:e']);
    // L'ordre aplati reste celui du tableau.
    expect(blocs.flatMap((b) => b.cardIds)).toEqual(ids(CARTES));
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('regrouper', () => {
  it('rend les membres CONSÉCUTIFS à la place du premier, ordre relatif gardé', () => {
    const res = regrouper(CARTES, [], ['d', 'b'], seq());
    expect(ids(res.cards)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(res.groups).toEqual([{ id: 'g1', cardIds: ['b', 'd'] }]);
  });

  it('premier membre en tête : le groupe reste en tête', () => {
    expect(ids(regrouper(CARTES, [], ['e', 'a', 'c'], seq()).cards)).toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('ne modifie JAMAIS le texte des cartes : mêmes objets, simplement réordonnés', () => {
    const res = regrouper(CARTES, [], ['b', 'e'], seq());
    for (const c of res.cards) expect(c).toBe(CARTES.find((o) => o.id === c.id));
    expect(res.cards).toHaveLength(CARTES.length);
  });

  it('membres déjà consécutifs : le MÊME tableau (aucun ordre changé)', () => {
    const res = regrouper(CARTES, [], ['b', 'c'], seq());
    expect(res.cards).toBe(CARTES);
    expect(res.groups).toEqual([{ id: 'g1', cardIds: ['b', 'c'] }]);
  });

  it('moins de deux cartes existantes : rien ne change', () => {
    const groupes: CardGroup[] = [];
    const res = regrouper(CARTES, groupes, ['b', 'inconnue'], seq());
    expect(res.cards).toBe(CARTES);
    expect(res.groups).toBe(groupes);
  });

  it('une carte quitte son ancien groupe (une carte = un groupe au plus)', () => {
    const res = regrouper(CARTES, [g('g0', 'a', 'b')], ['b', 'd'], seq());
    expect(res.groups).toEqual([{ id: 'g1', cardIds: ['b', 'd'] }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('deplacerBloc', () => {
  const groupes = [g('g1', 'b', 'c')];

  it('déplace une carte seule d’un bloc — elle saute le groupe ENTIER', () => {
    expect(ids(deplacerBloc(CARTES, groupes, 'carte:d', -1))).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('déplace un groupe entier, ordre interne conservé', () => {
    expect(ids(deplacerBloc(CARTES, groupes, 'groupe:g1', 1))).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(ids(deplacerBloc(CARTES, groupes, 'groupe:g1', -1))).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('au bord, bloc inconnu ou delta nul : le MÊME tableau', () => {
    expect(deplacerBloc(CARTES, groupes, 'carte:a', -1)).toBe(CARTES);
    expect(deplacerBloc(CARTES, groupes, 'carte:e', 1)).toBe(CARTES);
    expect(deplacerBloc(CARTES, groupes, 'carte:zz', 1)).toBe(CARTES);
    expect(deplacerBloc(CARTES, groupes, 'carte:b', 0)).toBe(CARTES);
  });

  it('ne touche ni au texte ni aux groupes', () => {
    const out = deplacerBloc(CARTES, groupes, 'groupe:g1', 1);
    for (const c of out) expect(c).toBe(CARTES.find((o) => o.id === c.id));
  });
});

describe('Dissocier et sélection', () => {
  it('Dissocier retire le groupe SANS changer l’ordre', () => {
    const { cards } = regrouper(CARTES, [], ['b', 'd'], seq());
    const groupes = ungroupCards([g('g1', 'b', 'd')], new Set(['b', 'd']));
    expect(groupes).toEqual([]);
    expect(ids(cards)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(blocsCartes(cards, groupes).flatMap((b) => b.cardIds)).toEqual(ids(cards));
  });

  it('cocher un membre prend tout le groupe ; le décocher le retire en entier', () => {
    const groupes = [g('g1', 'b', 'c')];
    const coche = basculerSelection(new Set(), 'b', groupes);
    expect([...coche].sort()).toEqual(['b', 'c']);
    // Cohérent avec la sélection de l'aperçu (expandSelection).
    expect(expandSelection(coche, groupes)).toBe(coche);
    expect([...basculerSelection(coche, 'c', groupes)]).toEqual([]);
    expect([...basculerSelection(new Set(['a']), 'd', groupes)].sort()).toEqual(['a', 'd']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Voix : ordre de lecture = ordre affiché, horodatage par ligne', () => {
  /** Calage réel d'une voix générée pour `cartes` : 1 s par morceau. */
  const voixPour = (cartes: Carte[]) => {
    const morceaux = morceauxCartes(cartes);
    const timing: TimingVoix = {
      source: 'elevenlabs',
      morceaux: morceaux.map((m) => ({ texte: m.texte, apres: m.apres })),
      segments: morceaux.map((_, i) => [i, i + 0.9] as [number, number]),
    };
    return { textAtGeneration: texteDesMorceaux(morceaux), duration: morceaux.length, timing };
  };

  it('après Regrouper, la voix lit les cartes dans l’ordre AFFICHÉ', () => {
    const res = regrouper(CARTES, [], ['a', 'd'], seq());
    const affiche = blocsCartes(res.cards, res.groups).flatMap((b) => b.cardIds);
    const lues = [...new Set(morceauxCartes(res.cards).map((m) => res.cards[m.carte].id))];
    expect(lues).toEqual(affiche);
    expect(affiche).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('…et l’aperçu rend les lignes dans ce même ordre', () => {
    const res = regrouper(CARTES, [], ['a', 'd'], seq());
    const groupeDe = Object.fromEntries(res.groups.flatMap((gr) => gr.cardIds.map((id) => [id, gr.id])));
    const { container } = render(
      <SequenceCards cards={res.cards} containerWidth={1080} landscape={false} valueColor="#EC4899" groupeDe={groupeDe} />,
    );
    const dom = [...container.querySelectorAll('[data-card-id]')].map((el) => el.getAttribute('data-card-id'));
    expect(dom).toEqual(ids(res.cards));
  });

  it('grouper SANS réordonner garde l’audio valide, et chaque ligne garde SON instant', () => {
    const voix = voixPour(CARTES);
    const avant = calageCartes(CARTES, voix)!;
    const res = regrouper(CARTES, [], ['b', 'c'], seq());
    expect(res.cards).toBe(CARTES);
    const apres = calageCartes(res.cards, voix)!;
    expect(apres).toEqual(avant);
    expect(apres.source).toBe('elevenlabs');
    // Les deux lignes du groupe apparaissent à des instants DISTINCTS.
    const debutCarte = (i: number) => apres.etapes.find((e) => e.carte === i && e.element === 'carte')!.debut;
    expect(debutCarte(1)).not.toBe(debutCarte(2));
  });

  it('regrouper EN réordonnant rend l’audio existant périmé (calage null)', () => {
    const voix = voixPour(CARTES);
    const res = regrouper(CARTES, [], ['a', 'd'], seq());
    expect(calageCartes(res.cards, voix)).toBeNull();
    // Une voix régénérée sur le nouvel ordre se cale à nouveau, ligne par ligne.
    expect(calageCartes(res.cards, voixPour(res.cards))?.source).toBe('elevenlabs');
  });

  it('déplacer un bloc rend aussi l’audio périmé', () => {
    const voix = voixPour(CARTES);
    expect(calageCartes(deplacerBloc(CARTES, [], 'carte:e', -1), voix)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('SequenceCards — cadre de groupe', () => {
  const base = { containerWidth: 1080, valueColor: '#EC4899' };

  it('flux : les membres consécutifs sont dans UN conteneur data-card-group, chaque ligne garde data-card-id', () => {
    const { container } = render(
      <SequenceCards {...base} landscape={false} cards={CARTES} groupeDe={{ b: 'g1', c: 'g1' }} />,
    );
    const cadres = container.querySelectorAll('[data-card-group]');
    expect(cadres).toHaveLength(1);
    expect(cadres[0].getAttribute('data-card-group')).toBe('g1');
    expect([...cadres[0].querySelectorAll('[data-card-id]')].map((e) => e.getAttribute('data-card-id'))).toEqual(['b', 'c']);
    expect(container.querySelectorAll('[data-card-id]')).toHaveLength(5);
  });

  it('paysage : le cadre couvre autant de colonnes que de membres (3 au plus)', () => {
    const { container } = render(
      <SequenceCards {...base} landscape cards={CARTES} groupeDe={{ a: 'g1', b: 'g1' }} />,
    );
    const cadre = container.querySelector<HTMLElement>('[data-card-group]')!;
    expect(cadre.style.gridColumn).toContain('span 2');
  });

  it('sans groupe : aucun cadre — le DOM d’avant', () => {
    const { container } = render(<SequenceCards {...base} landscape={false} cards={CARTES} />);
    expect(container.querySelector('[data-card-group]')).toBeNull();
    const grille = container.querySelector('[data-cards-grid]')!;
    expect([...grille.children].every((el) => el.hasAttribute('data-card-id'))).toBe(true);
  });

  it('mode libre : pas de cadre (chaque carte garde sa position absolue)', () => {
    const boxes = Object.fromEntries(CARTES.map((c, i) => [c.id, { x: 10, y: i * 15, w: 60, h: 10 }]));
    const { container } = render(
      <SequenceCards {...base} landscape={false} cards={CARTES} cardBoxes={boxes} groupeDe={{ b: 'g1', c: 'g1' }} />,
    );
    expect(container.querySelector('[data-card-group]')).toBeNull();
  });
});

describe('capturerEtapesCartes — le cadre suit ses lignes', () => {
  const CS = [
    { id: 'c1', title: 'Cardio', description: '', value: '' },
    { id: 'c2', title: 'Force', description: '', value: '' },
    { id: 'c3', title: 'Souplesse', description: '', value: '' },
  ];

  it('cadre masqué tant qu’aucune de ses lignes n’est dite, visible dès la première ; DOM restauré', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<div data-card-id="c1"></div><div data-card-group="g1"><div data-card-id="c2"></div><div data-card-id="c3"></div></div>';
    const cadre = el.querySelector<HTMLElement>('[data-card-group]')!;
    const ligne = (id: string) => el.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!.style.visibility;
    const calage = calageCartes(CS, { textAtGeneration: texteDesMorceaux(morceauxCartes(CS)), duration: 3 })!;
    const vus: string[][] = [];
    const etapes = await capturerEtapesCartes(el, calage, CS.map((c) => c.id), async () => {
      vus.push([cadre.style.visibility, ligne('c1'), ligne('c2'), ligne('c3')]);
      return 'photo';
    });
    expect(etapes).toHaveLength(3);
    expect(vus).toEqual([
      ['hidden', '', 'hidden', 'hidden'],
      // Lignes PAR LIGNE : c3 reste masquée quand c2 apparaît.
      ['', '', '', 'hidden'],
      ['', '', '', ''],
    ]);
    expect(cadre.style.visibility).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('CartesEditeur — cases, Regrouper, Dissocier, flèches', () => {
  const monter = (extra: Partial<React.ComponentProps<typeof CartesEditeur>> = {}) => {
    const props = {
      cards: CARTES,
      onChange: vi.fn(),
      selection: new Set<string>(),
      onToggleSelect: vi.fn(),
      groups: [g('g1', 'b', 'c')],
      onRegrouper: vi.fn(),
      onDissocier: vi.fn(),
      onMoveBloc: vi.fn(),
      ...extra,
    };
    render(<CartesEditeur {...props} />);
    return props;
  };

  it('une case par carte, reliée à la sélection de l’assistant', () => {
    const p = monter({ selection: new Set(['a']) });
    const cases = document.querySelectorAll<HTMLInputElement>('[data-carte-selection]');
    expect(cases).toHaveLength(5);
    expect(cases[0].checked).toBe(true);
    fireEvent.click(cases[3]);
    expect(p.onToggleSelect).toHaveBeenCalledWith('d');
  });

  it('Regrouper exige deux cartes ; Dissocier exige un groupe dans la sélection', () => {
    monter({ selection: new Set(['a']) });
    expect(screen.getByRole('button', { name: /Regrouper/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Dissocier/ })).toHaveProperty('disabled', true);
    cleanup();
    const p = monter({ selection: new Set(['a', 'b', 'c']) });
    fireEvent.click(screen.getByRole('button', { name: /Regrouper/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dissocier/ }));
    expect(p.onRegrouper).toHaveBeenCalledTimes(1);
    expect(p.onDissocier).toHaveBeenCalledTimes(1);
  });

  it('les cartes groupées sont dans UN cadre, avec ses propres flèches', () => {
    const p = monter();
    const cadre = document.querySelector('[data-carte-groupe="g1"]')!;
    expect([...cadre.querySelectorAll('[data-carte-editeur]')].map((e) => e.getAttribute('data-carte-editeur'))).toEqual(['b', 'c']);
    // Pas de flèche sur une carte À L'INTÉRIEUR d'un groupe : c'est le bloc qui bouge.
    expect(cadre.querySelectorAll('[data-carte-editeur] [data-bloc-monter]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Descendre le groupe' }));
    expect(p.onMoveBloc).toHaveBeenCalledWith('groupe:g1', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Monter la carte 4' }));
    expect(p.onMoveBloc).toHaveBeenCalledWith('carte:d', -1);
  });

  it('premier bloc : pas de montée ; dernier : pas de descente', () => {
    monter();
    expect(screen.getByRole('button', { name: 'Monter la carte 1' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Descendre la carte 5' })).toHaveProperty('disabled', true);
  });

  it('sans ces props : ni case, ni flèche, ni barre d’outils (liste d’avant)', () => {
    render(<CartesEditeur cards={CARTES} onChange={vi.fn()} />);
    expect(document.querySelector('[data-carte-selection]')).toBeNull();
    expect(document.querySelector('[data-bloc-monter]')).toBeNull();
    expect(document.querySelector('[data-cartes-outils]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Persistance : ordre et groupes', () => {
  const DEPS: SanitizeDeps = {
    themeIds: ['sommeil'],
    toneIds: ['punchy'],
    formats: ['9:16', '1:1', '16:9'],
    maxStep: 3,
    defaults: {
      themeId: 'sommeil',
      toneId: 'punchy',
      format: '9:16',
      titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
      subtitleStyle: { font: null, color: null, scale: 1 },
      ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
      sequences: [
        { key: 'intro', enabled: true },
        { key: 'cards', enabled: true },
        { key: 'video', enabled: false },
        { key: 'cta', enabled: true },
      ],
      durations: { intro: 4, cards: 6, video: 0, cta: 4 },
    },
  };

  it('brouillon : l’ordre réordonné et le groupe survivent au rechargement', () => {
    const res = regrouper(CARTES, [], ['a', 'd'], seq());
    const d = sanitizeDraft({
      version: DRAFT_VERSION, savedAt: 1,
      generated: { title: 'T', subtitle: 'S', cta: 'C', ctaSub: 'CS', cards: res.cards },
      cardGroups: res.groups,
    }, DEPS)!;
    expect(ids((d.generated as { cards: Carte[] }).cards)).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(d.cardGroups).toEqual([{ id: 'g1', cardIds: ['a', 'd'] }]);
  });

  it('post : enregistrer puis relire garde l’ordre, le texte et le groupe', () => {
    const post = { title: 'T', metadata: { cards: CARTES.map((c) => ({ id: c.id, emoji: c.icon, label: c.title, value: c.value, description: c.description })) } };
    const lu = (toWizardDraft(post as never).generated as { cards: Carte[] }).cards;
    const res = regrouper(lu, [], ['a', 'd'], seq());
    const envoyees = cartesPourEnregistrement(res.cards, indexerCartesOrigine(post.metadata), '#A', '#A');
    const relu = toWizardDraft({ title: 'T', metadata: { cards: envoyees, cardGroups: res.groups } } as never);
    const cartes = (relu.generated as { cards: Carte[] }).cards;
    expect(ids(cartes)).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(cartes.map((c) => c.title)).toEqual(['a', 'd', 'b', 'c', 'e'].map((id) => `Titre ${id}`));
    expect(relu.cardGroups).toEqual([{ id: 'g1', cardIds: ['a', 'd'] }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Câblage dans l’assistant', () => {
  const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

  it('Grouper passe par regrouper (membres consécutifs), la liste par les mêmes actions', () => {
    expect(wizard).toContain('regrouper(courant.cards, groupsRef.current, selectedCards, newGroupId)');
    expect(wizard).toContain('onRegrouper={groupSelection}');
    expect(wizard).toContain('onDissocier={ungroupSelection}');
    expect(wizard).toContain('onMoveBloc={deplacerBlocCartes}');
    expect(wizard).toContain('selection={selectedCards}');
  });

  it('l’aperçu (donc la photo exportée) reçoit les groupes', () => {
    expect(wizard).toContain('groupeDe={groupedCards}');
  });
});
