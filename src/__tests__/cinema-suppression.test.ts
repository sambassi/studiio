// @vitest-environment node
/**
 * CINEMA IA — SUPPRIMER UN FILM : objets FICTIFS uniquement, jamais MinIO reel.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { depotFilmsMemoire } from '@/lib/cinema/stockage/depot-films';
import { objetsMemoire, type ObjetsMemoire } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import { supprimerFilm } from '@/lib/cinema/stockage/suppression';
import { cleMedia, cleReference, cleScene, cleVoix, cleFilmMp4 } from '@/lib/cinema/stockage/cles';
import type { Film } from '@/lib/cinema/types';

const A = 'abcdef01-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const filmDe = (id: string): Film => ({ id, titre: 'Film fictif', majLe: new Date().toISOString(), scenes: [], personnages: [] } as unknown as Film);

let films: ReturnType<typeof depotFilmsMemoire>;
let travaux: ReturnType<typeof depotTravauxMemoire>;
let objets: ObjetsMemoire;
const ctx = () => ({ films, travaux, objets });
const octets = new Uint8Array([1, 2, 3]);

async function remplir(proprietaire: string, filmId: string) {
  const cles = [
    cleMedia(proprietaire, filmId, `cinema/${filmId}/medias/s1-p-1-0a1b2c3d.mp4`)!,
    cleReference(proprietaire, filmId, `cinema/${filmId}/references/perso-1-0a1b2c3d.png`)!,
    cleVoix(proprietaire, filmId, 's1-p-1', 'bbbbbbbb')!,
    cleScene(proprietaire, filmId, 's1', 'aaaaaaaa')!,
    cleFilmMp4(proprietaire, filmId, 'cccccccc')!,
  ];
  for (const k of cles) { expect(k).toBeTruthy(); await objets.deposerOctets(k, octets, 'application/octet-stream'); }
  return cles;
}

beforeEach(async () => {
  films = depotFilmsMemoire(); travaux = depotTravauxMemoire(); objets = objetsMemoire();
  await films.creer(filmDe('film-a'), A);
});

describe('suppression d\'un film', () => {
  it('efface le film, ses scenes, medias, voix, references et son MP4 — et RIEN d\'autre', async () => {
    const miens = await remplir(A, 'film-a');
    // Des objets qui ne sont PAS au film : autre film du meme compte (prefixes voisins), autre compte, hors cinema.
    await films.creer(filmDe('film-a2'), A); await films.creer(filmDe('film-ab'), A); await films.creer(filmDe('film-b'), B);
    const voisins = [...await remplir(A, 'film-a2'), ...await remplir(A, 'film-ab'), ...await remplir(B, 'film-b')];
    const horsCinema = [`${B}/cinema/film-a/medias/s1-p-1-0a1b2c3d.mp4`, `${A}/rendus/r1.webm`, `${A}/library/partage.mp4`, `${A}/cinema/film-a.txt`, `${B}/library/x.mp4`];
    for (const k of horsCinema) await objets.deposerOctets(k, octets, 'video/mp4');
    const avant = new Set([...voisins, ...horsCinema]);

    const r = await supprimerFilm(ctx(), A, 'film-a');
    expect(r).toEqual({ ok: true, objetsSupprimes: 5, objetsIgnores: 0 });
    for (const k of miens) expect(objets.contenu(k)).toBeUndefined();
    for (const k of avant) expect(objets.contenu(k), k).toBeDefined();
    expect(await films.lire('film-a', A)).toBeNull();
    // Le film de B est intact.
    expect(await films.lire('film-b', B)).not.toBeNull();
    expect((await films.lister(A)).map((f) => f.id).sort()).toEqual(['film-a2', 'film-ab']);
  });

  it('un autre compte ne peut ni supprimer le film ni toucher ses objets', async () => {
    const miens = await remplir(A, 'film-a');
    expect(await supprimerFilm(ctx(), B, 'film-a')).toEqual({ ok: false, motif: 'inconnu' });
    expect(await supprimerFilm(ctx(), B, '../film-a')).toEqual({ ok: false, motif: 'inconnu' });
    expect(await supprimerFilm(ctx(), '../' + A, 'film-a')).toEqual({ ok: false, motif: 'inconnu' });
    for (const k of miens) expect(objets.contenu(k)).toBeDefined();
    expect(await films.lire('film-a', A)).not.toBeNull();
  });

  it('un film inconnu rend « inconnu » et ne supprime rien', async () => {
    const miens = await remplir(A, 'film-a');
    expect(await supprimerFilm(ctx(), A, 'film-nexiste-pas')).toEqual({ ok: false, motif: 'inconnu' });
    expect(objets.cles().length).toBe(miens.length);
  });

  it('refuse tant qu\'un travail est actif ; accepte une fois termine, et oublie l\'historique', async () => {
    const miens = await remplir(A, 'film-a');
    const c = await travaux.creerOuRetrouver({ film: filmDe('film-a'), proprietaire: A, cle: 'k', scenesDemandees: [], maxActifs: 2 });
    const id = c.travail!.id;
    expect(await supprimerFilm(ctx(), A, 'film-a')).toEqual({ ok: false, motif: 'travail_en_cours' });
    for (const k of miens) expect(objets.contenu(k)).toBeDefined();
    const pris = await travaux.reclamer(id, 90);
    await travaux.annuler(id, pris!.tentatives);
    expect((await supprimerFilm(ctx(), A, 'film-a')).ok).toBe(true);
    expect(travaux.tous().filter((t) => t.filmId === 'film-a')).toEqual([]);
  });

  it('si le stockage echoue : le film est CONSERVE, et la suppression se rejoue', async () => {
    const miens = await remplir(A, 'film-a');
    const vrai = objets.supprimer.bind(objets);
    let n = 0;
    objets.supprimer = async (k) => { if (++n === 3) throw new Error('minio indisponible'); return vrai(k); };
    const r1 = await supprimerFilm(ctx(), A, 'film-a');
    expect(r1).toEqual({ ok: false, motif: 'echec_stockage', objetsSupprimes: 2 });
    expect(await films.lire('film-a', A)).not.toBeNull();
    objets.supprimer = vrai;
    expect(await supprimerFilm(ctx(), A, 'film-a')).toEqual({ ok: true, objetsSupprimes: 3, objetsIgnores: 0 });
    for (const k of miens) expect(objets.contenu(k)).toBeUndefined();
    expect(await films.lire('film-a', A)).toBeNull();
  });

  it('ne supprime JAMAIS une cle etrangere meme si le stockage la liste (defense en profondeur)', async () => {
    const miens = await remplir(A, 'film-a');
    const intrus = `${B}/cinema/film-a/medias/s1-p-1-0a1b2c3d.mp4`;
    await objets.deposerOctets(intrus, octets, 'video/mp4');
    const vrai = objets.lister.bind(objets);
    objets.lister = async (p) => [...(await vrai(p)), intrus, `${A}/cinema/film-autre/scenes/s1-aaaaaaaa.mp4`];
    const r = await supprimerFilm(ctx(), A, 'film-a');
    expect(r).toEqual({ ok: true, objetsSupprimes: miens.length, objetsIgnores: 2 });
    expect(objets.contenu(intrus)).toBeDefined();
  });
});
