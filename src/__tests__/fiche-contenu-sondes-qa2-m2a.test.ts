/**
 * M2-a — 2e contre-vérification QA (sur 2adba74) : drapeau `contradiction`
 * allumé sur de BONS cas, et action inventée par « running » non sportif.
 * Rouges sur 2adba74, verts après. Aucune IA.
 */
import { describe, it, expect } from 'vitest';
import { ficheContenuRush } from '@/lib/creer/fiche-contenu';

const desc = (description: string, requete?: string) => ficheContenuRush({ pexels: { description, requete: requete ?? null } });
const conf = (f: ReturnType<typeof ficheContenuRush>, id: string) => f.categories.find((c) => c.id === id)?.confiance;
const ids = (f: ReturnType<typeof ficheContenuRush>) => f.categories.map((c) => c.id);

describe('BONS CAS : catégorie principale confirmée, aucune contradiction', () => {
  it.each<[string, string, string, 'elevee' | 'moyenne']>([
    ['a woman eating healthy at home', 'healthy food', 'healthy-food', 'elevee'],
    ['woman preparing a healthy salad in the kitchen', 'healthy food', 'healthy-food', 'moyenne'],
    ['a man calculating his monthly budget', 'personal finance', 'personal-finance', 'elevee'],
    ['person counting money on a desk', 'personal finance', 'personal-finance', 'moyenne'],
    ['group of people dancing zumba', 'dance workout', 'dance', 'elevee'],
    ['women dancing in a studio', 'dance', 'dance', 'elevee'],
    ['a woman doing yoga at the beach', 'yoga', 'yoga', 'elevee'],
  ])('« %s » + « %s » → %s %s, sans drapeau', (d, r, id, c) => {
    const f = desc(d, r);
    expect(conf(f, id)).toBe(c);
    expect(f.contradiction).toBeUndefined();
  });
  it('catégorie ANNEXE de la requête non confirmée : sa confiance, sans drapeau', () => {
    const danse = desc('group of people dancing zumba', 'dance workout');
    expect(conf(danse, 'workout')).toBe('faible');
    const nutrition = desc('a woman eating healthy at home', 'healthy food');
    expect(['faible', 'moyenne']).toContain(conf(nutrition, 'cooking'));
    expect(nutrition.contradiction).toBeUndefined();
  });
  it('AUCUN concept de la requête confirmé + contenu contraire → drapeau', () => {
    const f = desc('group of people dancing', 'healthy food');
    expect(f.contradiction).toBe(true);
    expect(conf(f, 'healthy-food')).toBe('faible');
    expect(conf(f, 'cooking')).toBe('faible');
  });
});

describe('« running » non sportif : ni catégorie, ni action', () => {
  it.each([
    'woman running a small business', 'man running his company', 'running a shop downtown', 'people running errands',
    'running water in a sink', 'running the store at night', 'woman running late for work',
  ])('« %s »', (t) => {
    const f = desc(t);
    expect(ids(f)).not.toContain('running');
    expect(f.inconnus).toContain('action');
  });
  it.each(['man running in a park', 'woman running on a track', 'runners running a marathon', 'a woman running'])('sportif « %s » → running, action dite', (t) => {
    const f = desc(t);
    expect(conf(f, 'running')).toBe('moyenne');
    expect(f.inconnus).not.toContain('action');
  });
});

describe('lectures discutables retirées', () => {
  it('« studio apartment » n’est pas un studio de danse', () => {
    expect(ids(desc('a cozy studio apartment interior'))).not.toContain('studio');
    expect(ids(desc('women dancing in a studio'))).toContain('studio');
  });
  it('« cours de danse » n’implique pas un groupe', () => {
    const f = ficheContenuRush({ nomFichier: 'cours-de-danse.mp4' });
    expect(ids(f)).toEqual(['dance']);
    expect(ids(ficheContenuRush({ metadonnees: ['Classe de yoga du samedi'] }))).toEqual(['yoga']);
    expect(ids(ficheContenuRush({ metadonnees: ['danse en groupe'] }))).toContain('group');
  });
  it('« boxing day » (soldes) n’est pas de la boxe, et n’invente aucune action', () => {
    const f = desc('boxing day sale in a store');
    expect(ids(f)).not.toContain('boxing');
    expect(f.inconnus).toContain('action');
    expect(ids(desc('man boxing in a gym'))).toContain('boxing');
  });
});
