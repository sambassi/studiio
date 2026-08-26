import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DRAFT_VERSION, newCardId, sanitizeDraft, type SanitizeDeps } from '../lib/creer/draft';

/**
 * Identité stable des cartes de « Créer (simple) ».
 *
 * Les cartes étaient rendues avec `key={i}`. L'index tient lieu d'identité tant
 * que la liste ne bouge pas — mais il désigne une AUTRE carte dès qu'on en
 * insère, supprime ou réordonne une. C'est le préalable à « dupliquer » et à
 * « regrouper », qui doivent tous deux nommer une carte précise et la
 * retrouver après un rafraîchissement.
 *
 * Ce que ces tests surveillent :
 *
 * 1. **L'identité survit au brouillon.** Un groupe enregistré référence des
 *    `id` ; si le brouillon les jetait, le groupe rechargé désignerait des
 *    cartes disparues.
 * 2. **Les brouillons antérieurs restent lisibles.** Ils n'ont aucun `id` :
 *    il faut leur en fabriquer un plutôt que de rejeter le brouillon.
 * 3. **Deux cartes n'ont jamais le même `id`.** Sinon l'identité ne vaut pas
 *    mieux que l'index qu'elle remplace.
 */

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'],
  toneIds: ['punchy'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: {
      font: 'Inter',
      color: '#FFFFFF',
      scale: 1,
      bold: true,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.1,
    },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: {
      font: 'Inter',
      color: '#FFFFFF',
      subColor: '',
      scale: 1,
      bold: true,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};

const card = (over: Record<string, unknown> = {}) => ({
  icon: 'Droplet',
  title: 'Carte',
  description: 'Description',
  value: '80%',
  ...over,
});

const withCards = (cards: unknown[]) => ({
  version: DRAFT_VERSION,
  savedAt: 1,
  started: true,
  step: 1,
  themeId: 'sommeil',
  toneId: 'punchy',
  format: '9:16' as const,
  titleStyle: DEPS.defaults.titleStyle,
  subtitleStyle: DEPS.defaults.subtitleStyle,
  ctaStyle: DEPS.defaults.ctaStyle,
  sequences: DEPS.defaults.sequences,
  generated: { title: 'T', subtitle: 'S', cta: 'C', ctaSub: 'CS', cards },
});

const readCards = (raw: unknown) =>
  (sanitizeDraft(raw, DEPS)!.generated as { cards: { id: string }[] }).cards;

describe('newCardId', () => {
  it('ne se répète pas dans la même milliseconde', () => {
    // Le cas réel : dupliquer plusieurs cartes sélectionnées d'un coup. Un
    // `Date.now()` seul leur donnerait à toutes le même identifiant.
    const ids = Array.from({ length: 200 }, () => newCardId());
    expect(new Set(ids).size).toBe(200);
  });
});

describe('L’identité traverse le brouillon', () => {
  it('rend l’`id` enregistré, tel quel', () => {
    const cards = readCards(withCards([card({ id: 'garde-moi' }), card({ id: 'et-moi' })]));
    expect(cards.map((c) => c.id)).toEqual(['garde-moi', 'et-moi']);
  });

  it('fabrique un `id` pour un brouillon antérieur qui n’en a pas', () => {
    // Rétro-compatibilité : ces brouillons existent déjà chez les
    // utilisateurs. Les rejeter perdrait leur travail en cours.
    const cards = readCards(withCards([card(), card()]));
    expect(cards).toHaveLength(2);
    cards.forEach((c) => expect(c.id).toMatch(/^card-/));
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it('refabrique un `id` en double plutôt que de le laisser passer', () => {
    const cards = readCards(withCards([card({ id: 'x' }), card({ id: 'x' }), card({ id: 'x' })]));
    expect(new Set(cards.map((c) => c.id)).size).toBe(3);
    expect(cards[0].id).toBe('x'); // le premier garde le sien
  });

  it('remplace un `id` vide ou du mauvais type', () => {
    const cards = readCards(withCards([card({ id: '' }), card({ id: 42 })]));
    cards.forEach((c) => expect(c.id).toMatch(/^card-/));
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it('laisse le reste de la carte intact', () => {
    // L'ajout de l'identité ne doit rien changer d'autre : le contenu part
    // tel quel au compositeur.
    const [c] = readCards(withCards([card({ id: 'a', title: 'Mon titre', value: '12%' })]));
    expect(c).toEqual({
      id: 'a',
      icon: 'Droplet',
      title: 'Mon titre',
      description: 'Description',
      value: '12%',
    });
  });
});

describe('Plus aucune carte n’est rendue par son index', () => {
  const wizardSource = readFileSync(
    resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
    'utf8',
  );

  it('les deux listes de cartes sont clés par `id`', () => {
    // Grep-avant-modif : les cartes sont rendues à DEUX endroits — l'aperçu
    // et le récapitulatif de l'étape Contenu. N'en corriger qu'un laisserait
    // la moitié du bug en place.
    //
    // Depuis la Phase 2 du rendu serveur, l'aperçu délègue sa grille au
    // composant PARTAGÉ `SequenceCards` : la clé y vit désormais, et c'est
    // aussi celle qu'utilise la composition Remotion.
    const cardsSource = readFileSync(
      resolve(__dirname, '../components/creer/SequenceCards.tsx'),
      'utf-8',
    );
    const byId = [
      ...(wizardSource.match(/key=\{c\.id\}/g) ?? []),
      ...(cardsSource.match(/key=\{c\.id\}/g) ?? []),
    ];
    expect(byId).toHaveLength(2);
  });

  it('l’identité a une seule source', () => {
    // Une deuxième fabrique d'`id` divergerait en silence — le projet a déjà
    // ce problème avec ICON_MAP / CARD_ICON_MAP.
    expect(wizardSource).toMatch(/newCardId/);
    expect(wizardSource).not.toMatch(/const newCardId =/);
  });
});
