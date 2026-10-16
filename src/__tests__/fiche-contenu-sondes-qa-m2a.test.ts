/**
 * M2-a — SONDES de la QA indépendante : « pas de fausse certitude ».
 * Chaque cas a été prouvé faux sur 3ccede7 (rouge avant), vert après.
 * Descriptions = titres Pexels ANGLAIS (forme `motsDuSlug`) ; aucune IA.
 */
import { describe, it, expect } from 'vitest';
import { ficheContenuRush, ficheContenuValide } from '@/lib/creer/fiche-contenu';

const desc = (description: string, requete?: string) => ficheContenuRush({ pexels: { description, requete: requete ?? null } });
const ids = (f: ReturnType<typeof ficheContenuRush>) => f.categories.map((c) => c.id);
const elevees = (f: ReturnType<typeof ficheContenuRush>) => f.categories.filter((c) => c.confiance === 'elevee');

describe('mots FRANÇAIS de la taxonomie jamais appliqués à un titre Pexels anglais', () => {
  it.each<[string, string]>([
    ['aerial view of a golf course', 'running'],
    ['man playing tennis on a court', 'running'],
    ['people at a night club', 'gym'],
    ['woman in a hair salon', 'home'],
    ['food on a table', 'cooking'],
  ])('« %s » ne donne pas %s', (titre, faux) => {
    const f = desc(titre);
    expect(ids(f)).not.toContain(faux);
    expect(ficheContenuValide(f)).toBe(true);
  });
  it('« food on a table » : aucune action inventée', () => {
    expect(desc('food on a table').inconnus).toContain('action');
  });
});

describe('une seule source ne donne jamais « élevée »', () => {
  it.each(['women dancing in a studio', 'a man calculating his monthly budget', 'woman doing yoga at the beach', 'running water in a sink'])('description seule « %s »', (t) => {
    expect(elevees(desc(t))).toEqual([]);
  });
  it('requête seule, nom de fichier seul, métadonnées seules : jamais élevée', () => {
    expect(elevees(ficheContenuRush({ pexels: { requete: 'healthy food' } }))).toEqual([]);
    expect(elevees(ficheContenuRush({ nomFichier: 'cours-de-danse.mp4' }))).toEqual([]);
    expect(elevees(ficheContenuRush({ metadonnees: ['Cours de yoga'] }))).toEqual([]);
  });
  it('élevée : deux sources indépendantes concordantes', () => {
    expect(elevees(desc('women dancing in a studio', 'dance workout')).map((c) => c.id)).toEqual(['dance']);
  });
});

describe('ambigus : au plus faible/moyenne, jamais élevée', () => {
  it('« running water in a sink » : pas de course à pied', () => {
    expect(ids(desc('running water in a sink'))).not.toContain('running');
  });
  it.each(['tennis court at sunset', 'a bank building downtown', 'man running in a park'])('« %s »', (t) => {
    expect(elevees(desc(t))).toEqual([]);
  });
});

describe('contradiction entre sources', () => {
  it('description « man playing football » + requête « yoga » → yoga faible, contradiction, action inconnue', () => {
    const f = desc('man playing football', 'yoga');
    expect(f.categories.find((c) => c.id === 'yoga')?.confiance).toBe('faible');
    expect(f.contradiction).toBe(true);
    expect(f.inconnus).toContain('action');
  });
  it.each<[string, string, string]>([
    ['people at a night club', 'dance workout', 'dance'],
    ['woman in a hair salon', 'skincare', 'skincare'],
    ['aerial view of a golf course', 'running', 'running'],
    ['group of people dancing', 'personal finance', 'personal-finance'],
  ])('« %s » + requête « %s » → %s faible + drapeau', (d, r, id) => {
    const f = desc(d, r);
    expect(f.categories.find((c) => c.id === id)?.confiance).toBe('faible');
    expect(f.contradiction).toBe(true);
  });
  it('pas de contradiction quand la description est muette ou concorde', () => {
    expect(desc('woman sitting at a table', 'personal finance').contradiction).toBeUndefined();
    expect(desc('women dancing in a studio', 'dance').contradiction).toBeUndefined();
  });
});

describe('inconnus : seulement un mot explicite les établit', () => {
  it('une catégorie n’implique jamais une action', () => {
    const f = ficheContenuRush({ pexels: { requete: 'cooking' } });
    expect(f.inconnus).toEqual(['objets', 'lieu', 'action', 'personnes']);
  });
  it('verbe explicite, lieu explicite, personnes explicites', () => {
    const f = desc('women dancing in a studio');
    expect(f.inconnus).toEqual(['objets']);
    expect(desc('fresh fruits on a table').inconnus).toEqual(['objets', 'lieu', 'action', 'personnes']);
  });
});
