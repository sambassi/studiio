/**
 * CINEMA IA — LES QUATRE MOUVEMENTS DE CAMERA, MONTRES PAR DE VRAIS PLANS.
 *
 * Avant, ces demonstrations etaient dessinees (personnages en aplats, mouvement fabrique par
 * FFmpeg) : on ne pouvait pas juger de ce que donne un travelling. Ce sont desormais quatre
 * extraits FILMES, ou la camera fait REELLEMENT le mouvement annonce — verifie image par
 * image avant integration :
 *
 *   - travelling avant : la camera avance le long d'un chemin, le decor vient vers nous ;
 *   - panoramique      : la camera pivote, le relief traverse le cadre de droite a gauche ;
 *   - suivi lateral    : la camera accompagne une passante, la facade defile derriere elle ;
 *   - orbite           : la camera tourne autour d'un homme, le batiment pivote en fond.
 *
 * ⚠️ AUCUNE SIMULATION. Si un jour un mouvement devait etre fabrique (zoom numerique a la
 * place d'un vrai travelling), il faudrait l'ECRIRE a l'ecran : presenter un zoom comme une
 * orbite serait un mensonge sur ce que l'outil sait faire.
 *
 * Licence : Pexels — usage commercial gratuit, sans achat. Modification autorisee (coupe de
 * 5 s, recadrage 16:9, son retire). Ce ne sont pas des videos produites par Studiio, et les
 * personnes filmees n'ont aucun lien avec Studiio.
 *
 * Ces extraits illustrent le MOUVEMENT. Le STYLE a les siens (`extraits-styles.ts`).
 */
import type { IdCameraCinema } from '@/lib/cinema/types';

export interface MouvementDemo {
  /** Le mouvement montre — l'un de ceux qu'un plan peut demander. */
  camera: Extract<IdCameraCinema, 'travelling_avant' | 'pano_droite' | 'suivi_lateral' | 'orbite'>;
  libelle: string;
  /** Ce que l'oeil doit suivre dans l'image. */
  quoiRegarder: string;
  video: string;
  poster: string;
  credit: { auteur: string; source: 'Pexels'; url: string };
}

export const MOUVEMENTS_CAMERA: readonly MouvementDemo[] = [
  {
    camera: 'travelling_avant', libelle: 'Travelling avant',
    quoiRegarder: 'La camera avance : le chemin vient vers vous.',
    video: '/cinema-mouvements/travelling-avant.mp4', poster: '/cinema-mouvements/travelling-avant.jpg',
    credit: { auteur: 'Ruvim Miksanskiy', source: 'Pexels', url: 'https://www.pexels.com/video/drone-shot-of-dirt-road-7622651/' },
  },
  {
    camera: 'pano_droite', libelle: 'Panoramique',
    quoiRegarder: 'La camera pivote sur place : le relief traverse le cadre.',
    video: '/cinema-mouvements/panoramique.mp4', poster: '/cinema-mouvements/panoramique.jpg',
    credit: { auteur: 'Taryn Elliott', source: 'Pexels', url: 'https://www.pexels.com/video/panoramic-view-of-mountains-5895537/' },
  },
  {
    camera: 'suivi_lateral', libelle: 'Suivi latéral',
    quoiRegarder: 'La camera accompagne la passante : la facade defile derriere elle.',
    video: '/cinema-mouvements/suivi-lateral.mp4', poster: '/cinema-mouvements/suivi-lateral.jpg',
    credit: { auteur: 'cottonbro studio', source: 'Pexels', url: 'https://www.pexels.com/video/a-woman-walking-in-the-street-while-holding-a-cup-7223729/' },
  },
  {
    camera: 'orbite', libelle: 'Orbite',
    quoiRegarder: 'La camera tourne autour de l’homme : le batiment pivote en fond.',
    video: '/cinema-mouvements/orbite.mp4', poster: '/cinema-mouvements/orbite.jpg',
    credit: { auteur: 'cottonbro studio', source: 'Pexels', url: 'https://www.pexels.com/video/man-standing-outside-a-building-looking-around-7251034/' },
  },
];

export const mouvementDemo = (camera: string | null | undefined): MouvementDemo | null =>
  MOUVEMENTS_CAMERA.find((m) => m.camera === camera) ?? null;

/** La phrase qui accompagne tout mouvement montre : ce que c'est, et ce que ce n'est pas. */
export const MENTION_MOUVEMENTS = 'Plans d’exemple filmés (Pexels) — mouvement réel, pas une simulation, et pas une vidéo produite par Studiio.';
