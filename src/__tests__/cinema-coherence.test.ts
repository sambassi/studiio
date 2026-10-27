/**
 * CINEMA IA — LOT 3, MISSION 2 : comparer deux plans d un meme personnage.
 *
 * ⚠️ CE FICHIER NE TESTE PAS UNE COHERENCE VISUELLE REELLE. Aucun fournisseur
 * de ce lot ne genere d'identite visuelle — le fournisseur simule peint un
 * aplat de couleur. Ce qui est teste ici, et SEULEMENT ceci :
 *
 *   1. le MECANISME de continuite (version de reference tracee, position
 *      alignee sur `plan.personnages`) distingue bien une reference
 *      INCHANGEE d'une reference CHANGEE entre deux generations ;
 *   2. le rapport ne pretend JAMAIS garantir une coherence visuelle
 *      (`coherenceVisuelleGarantie` reste `false`, l'avertissement est
 *      toujours present) ;
 *   3. `signalIdentiteSimulee` (fournisseur simule uniquement) distingue
 *      bien deux textes de reference identiques de deux textes differents —
 *      preuve de mecanisme, explicitement nommee comme telle.
 */
import { describe, it, expect } from 'vitest';
import {
  AVERTISSEMENT_COHERENCE, plansGeneresDuPersonnage, rapportCoherencePersonnage, signalIdentiteSimulee,
} from '@/lib/cinema/generation/coherence';
import { ajouterReference } from '@/lib/cinema/personnages';
import { preparerFilm } from '@/lib/cinema/atelier';
import { remplacerMedia } from '@/lib/cinema/medias';
import type { Film, MediaPlan } from '@/lib/cinema/types';

const CASTING = [
  { nom: 'Nina', description: 'cheveux courts, veste rouge' },
  { nom: 'Marco', description: 'grand, barbe, ceinture noire' },
];
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Nina murmure « je ne reculerai pas ». Le jour se leve sur la salle vide.';
const horloge = () => new Date('2026-10-26T09:00:00Z');

const filmDeTest = () => preparerFilm({ histoire: HISTOIRE, personnages: CASTING, idFilm: 'film-coherence-test', maintenant: horloge });

/**
 * Attache un media GENERE a un plan, avec sa trace de reference pour UN
 * personnage precis — sans appeler de fournisseur. `referencesUtilisees` est
 * pose a la POSITION de `personnageId` dans `plan.personnages`, exactement
 * comme le fait `generation/atelier.ts`.
 */
function attacherMediaGenere(film: Film, planId: string, personnageId: string, referenceId: string): Film {
  const media: MediaPlan = {
    url: `cinema/${film.id}/medias/${planId}-simule.png`, genre: 'image', largeur: 360, hauteur: 640,
    dureeS: null, octets: 1000, origine: 'genere', fournisseurGeneration: 'simule',
  };
  const avecMedia = remplacerMedia(film, planId, media);
  return {
    ...avecMedia,
    scenes: avecMedia.scenes.map((s) => ({
      ...s,
      plans: s.plans.map((p) => {
        if (p.id !== planId) return p;
        const refs = p.referencesUtilisees ? [...p.referencesUtilisees] : new Array(p.personnages.length).fill('');
        const position = p.personnages.indexOf(personnageId);
        if (position >= 0) refs[position] = referenceId;
        return { ...p, referencesUtilisees: refs };
      }),
    })),
  };
}

describe('plansGeneresDuPersonnage — ce qui compte comme « genere »', () => {
  it('ignore les plans sans media ou avec un media IMPORTE (pas genere)', () => {
    const film = filmDeTest();
    const nina = film.personnages[0];
    expect(plansGeneresDuPersonnage(film, nina.id)).toEqual([]);
  });

  it('retrouve les plans ou le personnage figure ET porte un media genere', () => {
    const film = filmDeTest();
    const nina = film.personnages[0];
    const refId = nina.references[0].id;
    const planAvecNina = film.scenes.flatMap((s) => s.plans).find((p) => p.personnages.includes(nina.id))!;
    const avec = attacherMediaGenere(film, planAvecNina.id, nina.id, refId);
    const plans = plansGeneresDuPersonnage(avec, nina.id);
    expect(plans).toHaveLength(1);
    expect(plans[0].planId).toBe(planAvecNina.id);
    expect(plans[0].referenceUtilisee).toBe(refId);
  });
});

describe('rapportCoherencePersonnage — jamais une garantie', () => {
  it('reste honnete quand aucun plan n est genere', () => {
    const film = filmDeTest();
    const r = rapportCoherencePersonnage(film, film.personnages[0].id);
    expect(r.nbPlansGeneres).toBe(0);
    expect(r.continuiteGlobale).toBeNull();
    expect(r.coherenceVisuelleGarantie).toBe(false);
    expect(r.avertissement).toBe(AVERTISSEMENT_COHERENCE);
  });

  it('detecte une continuite de reference TENUE entre deux plans du meme personnage', () => {
    let film = filmDeTest();
    const nina = film.personnages[0];
    const refId = nina.references[0].id;
    const plansNina = film.scenes.flatMap((s) => s.plans).filter((p) => p.personnages.includes(nina.id));
    expect(plansNina.length).toBeGreaterThanOrEqual(2);

    for (const p of plansNina) film = attacherMediaGenere(film, p.id, nina.id, refId);

    const r = rapportCoherencePersonnage(film, nina.id);
    expect(r.nbPlansGeneres).toBe(plansNina.length);
    expect(r.continuiteGlobale).toBe(true);
    expect(r.paires.every((p) => p.continuiteReference === true)).toBe(true);
    // Toujours false : aucune evaluation visuelle n a ete menee.
    expect(r.coherenceVisuelleGarantie).toBe(false);
  });

  it('detecte une continuite de reference ROMPUE (apparence changee entre deux scenes)', () => {
    let film = filmDeTest();
    const nina0 = film.personnages[0];
    const refInitiale = nina0.references[0].id;
    const plansNina = film.scenes.flatMap((s) => s.plans).filter((p) => p.personnages.includes(nina0.id));
    expect(plansNina.length).toBeGreaterThanOrEqual(2);

    // Le premier plan genere AVANT le changement de reference.
    film = attacherMediaGenere(film, plansNina[0].id, nina0.id, refInitiale);

    // La reference change ENTRE les deux generations — incident du
    // 2026-10-09 : une identite remplacee en place invaliderait les plans
    // deja generes sans le dire. Ici, elle est AJOUTEE (nouvelle version).
    const ninaMaj = ajouterReference(film.personnages[0], { description: 'veste rouge dechiree, blessee au bras' }, horloge);
    film = { ...film, personnages: film.personnages.map((p) => (p.id === ninaMaj.id ? ninaMaj : p)) };
    const refNouvelle = ninaMaj.references.at(-1)!.id;
    expect(refNouvelle).not.toBe(refInitiale);

    // Le second plan genere APRES le changement.
    film = attacherMediaGenere(film, plansNina[1].id, nina0.id, refNouvelle);

    const r = rapportCoherencePersonnage(film, nina0.id);
    expect(r.nbPlansGeneres).toBe(2);
    expect(r.continuiteGlobale).toBe(false);
    expect(r.paires[0].continuiteReference).toBe(false);
    expect(r.coherenceVisuelleGarantie).toBe(false);
  });

  it('rend continuiteGlobale null quand la trace manque (donnee ancienne, pre-lot-3)', () => {
    let film = filmDeTest();
    const nina = film.personnages[0];
    const plansNina = film.scenes.flatMap((s) => s.plans).filter((p) => p.personnages.includes(nina.id));
    // Media genere SANS trace de reference (simule un film cree avant que
    // `referencesUtilisees` ne soit peuple).
    for (const p of plansNina) {
      const media: MediaPlan = { url: `cinema/${film.id}/medias/${p.id}.png`, genre: 'image', largeur: 360, hauteur: 640, dureeS: null, octets: 1, origine: 'genere', fournisseurGeneration: 'simule' };
      film = remplacerMedia(film, p.id, media);
    }
    const r = rapportCoherencePersonnage(film, nina.id);
    expect(r.nbPlansGeneres).toBe(plansNina.length);
    expect(r.continuiteGlobale).toBeNull();
  });
});

describe('signalIdentiteSimulee — preuve de mecanisme, pas de visage', () => {
  it('reconnait la MEME apparence', () => {
    expect(signalIdentiteSimulee('veste rouge, cheveux courts', 'veste rouge, cheveux courts')).toBe(true);
  });

  it('distingue deux apparences differentes (jeu de personnages du test)', () => {
    expect(signalIdentiteSimulee('cheveux courts, veste rouge', 'grand, barbe, ceinture noire')).toBe(false);
  });
});
