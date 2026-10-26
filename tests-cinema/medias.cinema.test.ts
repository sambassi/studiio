/**
 * CINEMA IA — LOT 2 : le film est-il fait des MEDIAS, ou de cartes ?
 *
 * Ce banc produit un vrai MP4 a partir de vraies images et de vraies videos
 * locales, puis le MESURE. La question centrale n'est pas « le rendu a-t-il
 * reussi » — un rendu reussit aussi quand il retombe sur ses cartes — mais
 * « ce qu'on voit a l'ecran vient-il bien des fichiers importes ».
 *
 * La reponse est prise dans le MP4 : la couleur dominante de l'image, au
 * milieu de chaque plan, est comparee a celle du fichier source. Une carte
 * de plan aurait la dominante du degrade Studiio, pas celle du media.
 *
 *   npm run test:cinema
 */
import { describe, it, expect } from 'vitest';
import { readFile, rm, copyFile } from 'fs/promises';
import path from 'path';
import { ErreurMediasManquants, preparerFilm, produireFilm } from '@/lib/cinema/atelier';
import { importerMedia, fichierDuMedia } from '@/lib/cinema/medias';
import { monterFilm } from '@/lib/cinema/montage';
import { dureeFilm } from '@/lib/cinema/types';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { couleurMoyenne, dominante, fixturesMedias } from './fixtures-medias';
import type { Film } from '@/lib/cinema/types';

const RACINE = path.resolve(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');

const HISTOIRE = [
  'Nina entre dans la salle avant le lever du jour.',
  'Le tatami est encore froid et personne ne parle.',
  'Marco la regarde sans bouger.',
  'Nina sait que le combat a deja commence.',
  'Marco avance et le silence se brise.',
  'Nina murmure « je ne reculerai pas ».',
  'Le jour se leve sur la salle vide.',
  'Personne ne dira ce qui s est joue ici.',
].join(' ');

const CASTING = [
  { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge' },
  { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire' },
];

/** Le niveau sonore moyen du fichier, en dB. */
async function niveauSonore(fichier: string): Promise<number> {
  const r = await executer(cheminFfmpeg(), ['-i', fichier, '-af', 'volumedetect', '-f', 'null', '-'], { timeoutMs: 120_000 });
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(r.stderr);
  if (!m) throw new Error('niveau sonore illisible');
  return Number(m[1]);
}

/** Le premier plan (plan d'ensemble) de chaque scene. */
const plansDEnsemble = (film: Film) => film.scenes.map((s) => ({ sceneId: s.id, planId: s.plans[0].id }));

describe('un film monte avec de vrais medias', () => {
  it('montre les medias importes, dans l ordre, sans deformation', async () => {
    const fixtures = await fixturesMedias();
    const ordre = [fixtures.longue, fixtures.courte, fixtures.affiche, fixtures.verticale];

    let film = preparerFilm({
      titre: 'Avant le jour',
      histoire: HISTOIRE,
      personnages: CASTING,
      idFilm: 'film-medias',
      format: '16:9',
      qualite: 'standard',
      nbScenes: 4,
    });
    expect(film.scenes).toHaveLength(4);

    // ── MISSION 1 : un media par plan d'ensemble ────────────────────────
    const cibles = plansDEnsemble(film);
    for (let i = 0; i < cibles.length; i++) {
      const fixture = ordre[i];
      const resultat = await importerMedia({
        film,
        planId: cibles[i].planId,
        nomOrigine: fixture.nom,
        donnees: await readFile(fixture.fichier),
        racinePublique: PUBLIC,
      });
      expect(resultat.ok, `import de ${fixture.nom}`).toBe(true);
      if (!resultat.ok) return;
      // Les dimensions ne sont pas CRUES, elles sont mesurees par ffprobe.
      expect(resultat.media.genre).toBe(fixture.genre);
      expect(resultat.media.largeur).toBe(fixture.largeur);
      expect(resultat.media.hauteur).toBe(fixture.hauteur);
      if (fixture.dureeS !== null) expect(resultat.media.dureeS).toBeCloseTo(fixture.dureeS, 1);
      else expect(resultat.media.dureeS).toBeNull();
      film = resultat.film;
    }

    // Un fichier qui n'est pas un media est refuse, pas ecrit « au cas ou ».
    const faux = await importerMedia({
      film, planId: cibles[0].planId, nomOrigine: 'piege.mp4',
      donnees: Buffer.from('ceci n est pas une video'), racinePublique: PUBLIC,
    });
    expect(faux.ok).toBe(false);

    // ── Cadrage : une seule echelle par media, donc aucun etirement ─────
    const montageAvant = monterFilm(film);
    const segVerticale = montageAvant.segments.find((s) => s.media?.hauteur === 480)!;
    expect(segVerticale.cadrage!.rogneX).toBe(0);
    expect(segVerticale.cadrage!.rogneY).toBeGreaterThan(0.6);
    const segPlein = montageAvant.segments.find((s) => s.media?.largeur === 1920 && s.media?.genre === 'image')!;
    expect(segPlein.cadrage).toEqual({ echelle: 1, rogneX: 0, rogneY: 0, memeRapport: true });

    // La video de 8 s commande son plan (il est muet) ; la parole commande
    // partout ailleurs.
    const segLongue = montageAvant.segments.find((s) => s.media?.dureeS === 8)!;
    expect(segLongue.dureeS).toBe(8);

    const vise = dureeFilm(film);
    expect(vise).toBeGreaterThanOrEqual(30);
    expect(vise).toBeLessThanOrEqual(60);

    // ── MISSION 2 : le rendu ────────────────────────────────────────────
    const premier = await produireFilm(film, { racine: RACINE, concurrence: 2 });
    expect(premier.avertissements.filter((a) => !a.startsWith('voix produites par le moteur'))).toEqual([]);
    expect(premier.scenesRendues).toHaveLength(4);
    const mp4 = premier.mp4!;
    expect(mp4).not.toBeNull();
    expect(mp4.codecVideo).toBe('h264');
    expect(mp4.codecAudio).toBeTruthy();
    expect(mp4.largeur).toBe(1920);
    expect(mp4.hauteur).toBe(1080);
    expect(mp4.dureeS).not.toBeNull();
    expect(mp4.dureeS as number).toBeGreaterThanOrEqual(30);
    expect(mp4.dureeS as number).toBeLessThanOrEqual(60);
    expect(Math.abs((mp4.dureeS as number) - premier.montage.dureeS)).toBeLessThan(1.5);

    // Le son existe vraiment : une piste muette passerait les controles de
    // codec sans qu'on entende une seule replique.
    expect(await niveauSonore(mp4.fichier)).toBeGreaterThan(-45);

    // ── Les medias sont-ils A L'IMAGE ? ─────────────────────────────────
    const montage = premier.montage;
    for (let i = 0; i < ordre.length; i++) {
      const segment = montage.segments.find((s) => s.planId === cibles[i].planId)!;
      expect(segment.media, `scene ${i + 1} : media attendu`).not.toBeNull();
      const instant = segment.debutS + Math.min(1.2, segment.dureeS / 2);
      const attendue = dominante(await couleurMoyenne(ordre[i].fichier, ordre[i].genre === 'video' ? 0.5 : 0));
      const obtenue = dominante(await couleurMoyenne(mp4.fichier, instant));
      expect(obtenue, `scene ${i + 1} (${ordre[i].nom}) a ${instant.toFixed(1)} s`).toBe(attendue);
    }

    // ── MISSION 4 : changer UN media ne refait QUE sa scene ──────────────
    const remplace = await importerMedia({
      film: premier.film,
      planId: cibles[1].planId,
      nomOrigine: fixtures.affiche.nom,
      donnees: await readFile(fixtures.affiche.fichier),
      racinePublique: PUBLIC,
    });
    expect(remplace.ok).toBe(true);
    if (!remplace.ok) return;

    const second = await produireFilm(remplace.film, { racine: RACINE, concurrence: 2 });
    expect(second.scenesRendues).toEqual([cibles[1].sceneId]);
    expect(second.scenesReutilisees).toHaveLength(3);
    expect(second.devis.totalUsd).toBe(0);

    // ── Un media DECLARE mais ABSENT arrete le rendu, il n'est pas
    //    remplace par une carte ────────────────────────────────────────
    const victime = second.film.scenes[0].plans[0];
    const fichierVictime = fichierDuMedia(PUBLIC, victime.media!.url);
    const copie = `${fichierVictime}.sauvegarde`;
    await copyFile(fichierVictime, copie);
    await rm(fichierVictime);
    try {
      await expect(produireFilm(second.film, { racine: RACINE })).rejects.toBeInstanceOf(ErreurMediasManquants);

      // En APERCU, il est signale — et le montage reste consultable.
      const apercu = await produireFilm(second.film, { racine: RACINE, rendre: false });
      expect(apercu.avertissements.some((a) => a.includes('media introuvable'))).toBe(true);
      expect(apercu.montage.segments.length).toBeGreaterThan(0);
    } finally {
      await copyFile(copie, fichierVictime);
      await rm(copie, { force: true });
    }

    console.log('[cinema/lot2] MP4 :', mp4.fichier, '|', mp4.dureeS, 's |',
      `${mp4.largeur}x${mp4.hauteur}`, '|', (mp4.octets / 1_000_000).toFixed(2), 'Mo');
  }, 1_750_000);
});
