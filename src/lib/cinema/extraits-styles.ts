/**
 * CINEMA IA — LES EXTRAITS D'EXEMPLE DES SIX STYLES.
 *
 * Ce sont de VRAIS extraits filmes (vraies personnes, vrais decors), pas des illustrations :
 * une carte de style doit montrer ce que le style donne a l'ecran, sinon on ne peut pas s'y
 * projeter. Ils vivent dans le depot (`public/cinema-styles-extraits/`), en 1280x720, 5 s,
 * 24 i/s, SANS SON, avec leur image d'affiche pour un chargement differe. Le 720p est la
 * resolution utile : l'apercu agrandi occupe au plus ~1400 px de large, un 640x360 y paraissait flou.
 *
 * ⚠️ TROIS REGLES QUI NE SE NEGOCIENT PAS :
 *
 *   1. CE NE SONT PAS DES VIDEOS PRODUITES PAR STUDIIO, et l'ecran le dit. Les presenter
 *      comme un resultat de generation serait un mensonge commercial.
 *   2. LICENCE : Pexels — usage commercial gratuit, sans achat ni autorisation ecrite,
 *      modification autorisee (ici : coupe de 5 s, recadrage 16:9, son retire). L'attribution
 *      n'est pas exigee par la licence ; on la donne quand meme, c'est l'auteur qui a filme.
 *      La licence interdit en revanche de SUGGERER QUE LES PERSONNES FILMEES RECOMMANDENT le
 *      produit : l'ecran le dit noir sur blanc (`MENTION_EXTRAITS`), et aucun extrait n'est
 *      presente comme un temoignage, un avis ou une reference client.
 *   3. AUCUNE GENERATION, AUCUN CREDIT : montrer un extrait ne fait que lire un fichier.
 *
 * Ces extraits illustrent le STYLE (lumiere, palette, ambiance). Les MOUVEMENTS DE CAMERA ont
 * leurs propres demonstrations (`public/cinema-demo/`, `DemoGratuite`) : deux choses
 * differentes, jamais melangees dans le meme bloc.
 */
import type { IdStyleCinema } from '@/lib/cinema/types';

export interface ExtraitStyle {
  /** Fichier servi depuis `public/` — jamais une URL distante (aucune dependance reseau). */
  video: string;
  /** Image d'affiche : ce qu'on voit avant la lecture, et ce que la carte affiche. */
  poster: string;
  /** Ce que l'extrait montre, en une ligne. */
  sujet: string;
  credit: { auteur: string; source: 'Pexels'; url: string; licence: string };
}

const pexels = (auteur: string, id: number, slug: string, licence = 'Licence Pexels — usage commercial gratuit'): ExtraitStyle['credit'] => ({
  auteur, source: 'Pexels', url: `https://www.pexels.com/video/${slug}-${id}/`, licence,
});

export const EXTRAITS_STYLES: Record<IdStyleCinema, ExtraitStyle> = {
  realiste: {
    video: '/cinema-styles-extraits/realiste.mp4', poster: '/cinema-styles-extraits/realiste.jpg',
    sujet: 'Marche dans une rue ensoleillee, lumiere naturelle',
    credit: pexels('Vladimir Kalugin', 28808272, 'cinematic-walk-in-sunlit-downtown-street'),
  },
  noir: {
    video: '/cinema-styles-extraits/noir.mp4', poster: '/cinema-styles-extraits/noir.jpg',
    sujet: 'Enqueteur a son bureau, noir et blanc contraste',
    credit: pexels('cottonbro studio', 7319404, 'a-male-investigator-in-his-workplace'),
  },
  publicite: {
    video: '/cinema-styles-extraits/publicite.mp4', poster: '/cinema-styles-extraits/publicite.jpg',
    sujet: 'Flacon de parfum, lumiere de studio',
    credit: pexels('MART PRODUCTION', 8447664, 'a-bottle-of-perfume-next-to-a-white-rose'),
  },
  romantique: {
    video: '/cinema-styles-extraits/romantique.mp4', poster: '/cinema-styles-extraits/romantique.jpg',
    sujet: 'Couple au coucher du soleil, lumiere chaude',
    credit: pexels('Naveen G', 4417867, 'couple-having-sweet-moments'),
  },
  documentaire: {
    video: '/cinema-styles-extraits/documentaire.mp4', poster: '/cinema-styles-extraits/documentaire.jpg',
    sujet: 'Travail aux champs, lumiere du matin',
    credit: pexels('Subham Das', 35644814, 'cinematic-indian-farmer-working-in-rice-field'),
  },
  scifi: {
    video: '/cinema-styles-extraits/scifi.mp4', poster: '/cinema-styles-extraits/scifi.jpg',
    sujet: 'Personnage en decor urbain, neons froids',
    credit: pexels('Mikhail Nilov', 8058406, 'a-woman-dressed-in-futuristic-style'),
  },
};

export const extraitStyle = (id: IdStyleCinema | null | undefined): ExtraitStyle | null =>
  (id && EXTRAITS_STYLES[id]) || null;

/** La phrase qui accompagne TOUT extrait : elle dit ce que c'est, et ce que ce n'est pas. */
export const MENTION_EXTRAITS = 'Extraits de films d’exemple (Pexels) — ce ne sont pas des vidéos produites par Studiio, '
  + 'et les personnes filmées n’ont aucun lien avec Studiio ni ne le recommandent.';
