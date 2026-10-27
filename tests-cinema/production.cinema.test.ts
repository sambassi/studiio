/**
 * CINEMA IA — la production REELLE : voix synthetisees et MP4 sur le disque.
 *
 * Ce banc est VOLONTAIREMENT hors de `npm test` : il appelle le service de
 * voix (gratuit, mais c'est un reseau) et il lance Remotion (Chromium, des
 * minutes). Un test lent et dependant du reseau glisse dans « on le relance
 * plus tard » puis dans « il est casse depuis des semaines ».
 *
 *   npm run test:cinema     (config `vitest.cinema.config.ts`)
 *
 * Il verifie ce qu'on ne peut pas verifier autrement : que le MP4 existe, que
 * ffprobe lui trouve la duree du montage, une piste audio, les dimensions du
 * format — et qu'une seconde production ne refait RIEN.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { preparerFilm, produireFilm } from '@/lib/cinema/atelier';
import { dureeFilm } from '@/lib/cinema/types';

const RACINE = path.resolve(__dirname, '..');

const HISTOIRE = [
  'Nina entre dans la salle avant le lever du jour.',
  'Le tatami est encore froid et personne ne parle.',
  'Marco la regarde sans bouger.',
  'Nina sait que le combat a deja commence.',
  'Marco avance et le silence se brise.',
  'Nina murmure « je ne reculerai pas ».',
  'Nina tient bon jusqu au dernier instant.',
  'Le jour se leve sur la salle vide.',
].join(' ');

const CASTING = [
  { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge' },
  { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire' },
];

describe('production reelle d un film', () => {
  it('produit un MP4 conforme au montage, puis ne refait rien', async () => {
    const depart = preparerFilm({
      titre: 'Avant le jour',
      histoire: HISTOIRE,
      personnages: CASTING,
      idFilm: 'film-banc',
      format: '16:9',
      qualite: 'standard',
      nbScenes: 4,
    });
    expect(depart.scenes).toHaveLength(4);

    // ── Première production : tout est a faire ──────────────────────────
    const premier = await produireFilm(depart, { racine: RACINE, concurrence: 2 });

    // Le seul avertissement tolere est l'ANNONCE du repli de moteur de voix :
    // tout le reste est un vrai probleme.
    expect(premier.avertissements.filter((a) => !a.startsWith('voix produites par le moteur'))).toEqual([]);
    expect(premier.voix.echecs).toEqual([]);
    expect(['edge', 'systeme']).toContain(premier.voix.moteur);
    expect(premier.voix.details.length).toBeGreaterThanOrEqual(7);
    expect(premier.devis.totalUsd).toBe(0);
    expect(premier.scenesRendues).toHaveLength(4);
    expect(premier.mp4).not.toBeNull();

    const mp4 = premier.mp4!;
    expect(mp4.octets).toBeGreaterThan(50_000);
    expect(mp4.codecVideo).toBe('h264');
    // Les repliques sont dans le fichier : sans piste audio, le film est muet.
    expect(mp4.codecAudio).toBeTruthy();
    expect(mp4.largeur).toBe(1920);
    expect(mp4.hauteur).toBe(1080);
    // La duree du fichier est celle du montage, a une seconde pres : c'est la
    // seule preuve que l'aperçu et le MP4 parlent du meme film.
    expect(mp4.dureeS).not.toBeNull();
    expect(Math.abs((mp4.dureeS as number) - premier.montage.dureeS)).toBeLessThan(1.5);
    // Les durees ont suivi la parole mesuree, elles n'ont pas ete imposees.
    expect(dureeFilm(premier.film)).toBeGreaterThanOrEqual(dureeFilm(depart) - 0.1);

    // ── Deuxième production : rien n a change, rien n est refait ────────
    const second = await produireFilm(premier.film, { racine: RACINE, concurrence: 2 });
    expect(second.scenesRendues).toEqual([]);
    expect(second.scenesReutilisees).toHaveLength(4);
    expect(second.devis.secondesAProduire).toBe(0);
    expect(second.mp4?.dureeS).toBeCloseTo(mp4.dureeS as number, 0);

    // ── Régénération d UNE scene : elle seule est refaite ───────────────
    const cible = premier.film.scenes[1].id;
    const troisieme = await produireFilm(premier.film, { racine: RACINE, scenesDemandees: [cible], concurrence: 2 });
    expect(troisieme.scenesRendues).toEqual([cible]);
    expect(troisieme.scenesReutilisees).toHaveLength(3);

    console.log('[cinema] MP4 :', mp4.fichier, '|', mp4.octets, 'octets |', mp4.dureeS, 's |',
      mp4.largeur + 'x' + mp4.hauteur, '|', mp4.codecVideo + '/' + mp4.codecAudio);
  }, 1_800_000);
});
