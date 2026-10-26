/**
 * CINEMA IA — les gardes d'acces.
 *
 * Trois defauts nommes par la revue de securite du 2026-10-26, ici tenus par
 * des tests pour qu'ils ne reviennent pas : identifiant borne (chemin de
 * fichier), media local uniquement (SSRF au rendu), proprietaire exige
 * (IDOR).
 */
import { describe, it, expect } from 'vitest';
import { appartientA, idFilmValide, mediaAccepte, mediaCinemaValide } from '@/lib/cinema/acces';
import { enregistrerFilm, lireFilm } from '@/lib/cinema/store';
import { preparerFilm } from '@/lib/cinema/atelier';

describe('identifiant de film', () => {
  it('accepte ceux que le module fabrique', () => {
    expect(idFilmValide('film-mvp0gqw2-jgiddo')).toBe(true);
    expect(idFilmValide('film-banc')).toBe(true);
  });

  it('refuse tout ce qui pourrait sortir du dossier', () => {
    for (const mauvais of ['../package', 'film-../../x', 'film-/etc/passwd', '/film-1', 'Film-1', '', 'autre-1', null, 42]) {
      expect(idFilmValide(mauvais)).toBe(false);
    }
  });

  it('refuse d ecrire un film a l identifiant non conforme', async () => {
    const film = { ...preparerFilm({ histoire: 'Une phrase. Une autre phrase. Une troisieme.', personnages: [{ nom: 'A' }], idFilm: 'film-ok' }), id: '../evasion' };
    await expect(enregistrerFilm('/tmp', film as never)).rejects.toThrow(/refuse/);
  });

  it('ne lit rien pour un identifiant non conforme', async () => {
    expect(await lireFilm('/tmp', '../../etc/passwd')).toBeNull();
  });
});

describe('media d un plan', () => {
  it('accepte un fichier local du module', () => {
    expect(mediaCinemaValide('cinema/film-1/plan.png')).toBe(true);
    expect(mediaCinemaValide('/cinema/film-1/scenes/scene-1.mp4')).toBe(true);
  });

  it('refuse toute URL qui ferait sortir une requete du serveur', () => {
    for (const mauvais of [
      'http://169.254.169.254/latest/meta-data',
      'https://exemple.test/image.png',
      'file:///etc/passwd',
      'cinema/../../../etc/passwd',
      'data:image/png;base64,AAAA',
      '//exemple.test/image.png',
      'cinema/a b.png',
      42,
    ]) {
      expect(mediaCinemaValide(mauvais)).toBe(false);
      expect(mediaAccepte(mauvais).ok).toBe(false);
    }
  });

  it('laisse effacer un media avec null', () => {
    expect(mediaAccepte(null)).toEqual({ ok: true, url: null });
  });
});

describe('proprietaire', () => {
  it('n appartient qu au compte qui l a cree', () => {
    expect(appartientA({ proprietaire: 'compte-a' }, 'compte-a')).toBe(true);
    expect(appartientA({ proprietaire: 'compte-a' }, 'compte-b')).toBe(false);
  });

  it('un film SANS proprietaire n appartient a personne', () => {
    // Un film d'avant cette regle ne devient pas lisible par defaut : il
    // devient inaccessible, ce qui se repare, alors que l'inverse se fuite.
    expect(appartientA({}, 'compte-a')).toBe(false);
    expect(appartientA({ proprietaire: null }, 'compte-a')).toBe(false);
    expect(appartientA({ proprietaire: '' }, '')).toBe(false);
  });
});
