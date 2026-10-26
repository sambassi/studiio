/**
 * CINEMA IA — les medias des plans (lot 2), partie PURE.
 *
 * Ce qui touche au disque et a ffprobe est verifie par le banc
 * (`tests-cinema/`) ; ici, tout est calcul : cadrage sans deformation,
 * duree d'un plan qui porte une video, extensions acceptees, et l'effet du
 * media sur l'empreinte de sa scene.
 */
import { describe, it, expect } from 'vitest';
import { cadrage, dureePlanAvecMedia, extensionAcceptee, remplacerMedia, reglerSonMedia, TAILLE_MAX_MEDIA } from '@/lib/cinema/medias';
import { scelleScene, scenesAReproduire } from '@/lib/cinema/empreinte';
import { monterFilm } from '@/lib/cinema/montage';
import { preparerFilm } from '@/lib/cinema/atelier';
import type { MediaPlan } from '@/lib/cinema/types';

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Nina murmure « je ne reculerai pas ». Le jour se leve sur la salle vide.';
const CASTING = [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }];
const film = () => preparerFilm({ histoire: HISTOIRE, personnages: CASTING, idFilm: 'film-test', format: '16:9', maintenant: () => new Date('2026-10-26T09:00:00Z') });

const video = (o: Partial<MediaPlan> = {}): MediaPlan => ({
  url: 'cinema/film-test/medias/p-1.mp4', genre: 'video', largeur: 1920, hauteur: 1080,
  dureeS: 6, octets: 1000, origine: 'import', sonActif: false, ...o,
});
const image = (o: Partial<MediaPlan> = {}): MediaPlan => ({
  url: 'cinema/film-test/medias/p-1.png', genre: 'image', largeur: 1920, hauteur: 1080,
  dureeS: null, octets: 1000, origine: 'import', ...o,
});

describe('extensions acceptees', () => {
  it('reconnait images et videos, refuse le reste', () => {
    expect(extensionAcceptee('rush.MP4')).toEqual({ ok: true, genre: 'video', ext: '.mp4' });
    expect(extensionAcceptee('photo.jpeg')).toEqual({ ok: true, genre: 'image', ext: '.jpeg' });
    for (const n of ['script.sh', 'archive.zip', 'sans-extension', 'page.html', 'media.mp4.exe']) {
      expect(extensionAcceptee(n).ok).toBe(false);
    }
  });

  it('plafonne la taille a 200 Mo', () => {
    expect(TAILLE_MAX_MEDIA).toBe(200 * 1024 * 1024);
  });
});

describe('cadrage — remplir sans deformer', () => {
  it('un media au meme rapport remplit sans rien rogner', () => {
    const c = cadrage({ largeur: 1280, hauteur: 720 }, { w: 1920, h: 1080 });
    expect(c.memeRapport).toBe(true);
    expect(c.echelle).toBeCloseTo(1.5, 3);
    expect(c.rogneX).toBe(0);
    expect(c.rogneY).toBe(0);
  });

  it('un media vertical dans un cadre 16:9 est ROGNE, jamais etire', () => {
    const c = cadrage({ largeur: 270, hauteur: 480 }, { w: 1920, h: 1080 });
    // Une seule echelle pour les deux axes : c'est la definition de « sans
    // deformation ». Elle vient de la plus contraignante des deux.
    expect(c.echelle).toBeCloseTo(1920 / 270, 2);
    expect(c.rogneX).toBe(0);
    expect(c.rogneY).toBeGreaterThan(0.6);
    expect(c.memeRapport).toBe(false);
  });

  it('un media horizontal dans un cadre 9:16 rogne sur les cotes', () => {
    const c = cadrage({ largeur: 1920, hauteur: 1080 }, { w: 1080, h: 1920 });
    expect(c.rogneX).toBeGreaterThan(0.6);
    expect(c.rogneY).toBe(0);
  });

  it('le montage calcule le cadrage de chaque plan qui porte un media', () => {
    const base = film();
    const avec = remplacerMedia(base, base.scenes[0].plans[0].id, video({ largeur: 270, hauteur: 480 }));
    const segment = monterFilm(avec).segments.find((s) => s.media)!;
    expect(segment.cadrage).not.toBeNull();
    expect(segment.cadrage!.rogneY).toBeGreaterThan(0);
    // Un plan sans media n'a pas de cadrage : il n'y a rien a cadrer.
    expect(monterFilm(avec).segments.find((s) => !s.media)!.cadrage).toBeNull();
  });
});

describe('duree d un plan qui porte une video', () => {
  it('sans parole, le plan epouse la video', () => {
    expect(dureePlanAvecMedia({ dureeS: 2.4, dialogue: null }, video({ dureeS: 6 }))).toBe(6);
  });

  it('sans parole, une video tres longue est bornee', () => {
    expect(dureePlanAvecMedia({ dureeS: 2.4, dialogue: null }, video({ dureeS: 90 }))).toBe(12);
  });

  it('avec parole, la PAROLE commande — la video ne raccourcit pas le plan', () => {
    const parle = { dureeS: 5.2, dialogue: { personnageId: null, genre: 'narration' as const, texte: 'x', dureeS: 5.2 } };
    expect(dureePlanAvecMedia(parle, video({ dureeS: 1.5 }))).toBe(5.2);
    expect(dureePlanAvecMedia(parle, video({ dureeS: 30 }))).toBe(5.2);
  });

  it('une image ne change pas la duree du plan', () => {
    expect(dureePlanAvecMedia({ dureeS: 2.4, dialogue: null }, image())).toBe(2.4);
    expect(dureePlanAvecMedia({ dureeS: 2.4, dialogue: null }, null)).toBe(2.4);
  });
});

describe('empreinte et medias', () => {
  it('attacher un media IMPORTE marque la scene, et elle seule', () => {
    const base = film();
    const planId = base.scenes[1].plans[0].id;
    const avec = remplacerMedia(base, planId, video());
    expect(scenesAReproduire(avec).map((s) => s.id)).toEqual([base.scenes[1].id]);
  });

  it('couper le son d un rush marque la scene', () => {
    const base = remplacerMedia(film(), film().scenes[0].plans[0].id, video({ sonActif: false }));
    const avec = reglerSonMedia(base, base.scenes[0].plans[0].id, true);
    expect(scenesAReproduire(avec).map((s) => s.id)).toEqual([base.scenes[0].id]);
  });

  it('un media GENERE par le rendu ne salit pas sa propre scene', () => {
    // Sinon produire le media demanderait aussitot de le reproduire.
    const base = film();
    const avec = remplacerMedia(base, base.scenes[0].plans[0].id, video({ origine: 'genere' }));
    expect(scenesAReproduire(avec)).toHaveLength(0);
  });

  it('retirer un media marque la scene', () => {
    const base = film();
    const planId = base.scenes[0].plans[0].id;
    // On attache, puis on SCELLE (comme apres un rendu reussi) : la scene est
    // alors propre, et c'est le retrait seul qui la salit.
    const avec = remplacerMedia(base, planId, video());
    const produit = { ...avec, scenes: avec.scenes.map((s, i) => (i === 0 ? scelleScene(s, avec.personnages) : s)) };
    expect(scenesAReproduire(produit)).toHaveLength(0);

    const sans = remplacerMedia(produit, planId, null);
    expect(scenesAReproduire(sans).map((s) => s.id)).toEqual([base.scenes[0].id]);
  });
});
