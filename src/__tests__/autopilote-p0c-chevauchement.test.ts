/**
 * P0-C — DEUX FOIS LE MÊME MOMENT N'EST PAS UN MONTAGE.
 *
 * Le défaut a été constaté en production le 2026-09-02 : M3-C classe les
 * passages mais ne les rend pas disjoints, M3-E les calait indépendamment, et
 * la vidéo finale contenait deux fois la même image.
 *
 * ⚠️ CE FICHIER TESTE LA RÈGLE, PAS SA PRÉSENCE. Aucune assertion sur le
 * source : on donne des fenêtres, on regarde ce qui sort.
 */
import { describe, it, expect } from 'vitest';
import {
  ALGORITHME_COUPES, CHEVAUCHEMENT_MAX,
  chevauchement, chevauchentTrop, ecarterChevauchements,
} from '@/lib/autopilot/analyse/coupe-contrat';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';

const f = (debutSecondes: number, finSecondes: number, rang = 1) => ({
  debutSecondes, finSecondes, rang,
});

describe('1. La mesure du chevauchement', () => {
  it('1.1 deux fenêtres disjointes ne partagent rien', () => {
    expect(chevauchement(f(0, 5), f(6, 10))).toBe(0);
    // Jointives, pas chevauchantes : la fin de l'une est le début de l'autre.
    expect(chevauchement(f(0, 5), f(5, 10))).toBe(0);
  });

  it('1.2 le cas RÉEL de production : 4,8 s communes sur 8 s', () => {
    const a = f(3.2, 11.2);
    const b = f(0.0, 8.0);
    expect(chevauchement(a, b)).toBeCloseTo(0.6, 5);
    expect(chevauchentTrop(a, b)).toBe(true);
  });

  it('1.3 la part est rapportée à la plus COURTE des deux', () => {
    // Une fenêtre brève entièrement contenue dans une longue est un doublon
    // total, même si elle ne couvre qu'un dixième de sa voisine.
    expect(chevauchement(f(0, 100), f(10, 12))).toBe(1);
    expect(chevauchentTrop(f(0, 100), f(10, 12))).toBe(true);
  });

  it('1.4 la mesure est symétrique', () => {
    const a = f(3.2, 11.2);
    const b = f(0.0, 8.0);
    expect(chevauchement(a, b)).toBe(chevauchement(b, a));
  });

  it('1.5 une fenêtre sans durée mesurable ne divise pas par zéro', () => {
    for (const mauvaise of [f(5, 5), f(5, 4), f(Number.NaN, 3), f(1, Number.POSITIVE_INFINITY)]) {
      expect(chevauchement(f(0, 10), mauvaise)).toBe(0);
      expect(chevauchentTrop(f(0, 10), mauvaise)).toBe(false);
    }
  });

  it('1.6 le seuil est strict : exactement la moitié passe encore', () => {
    // 0 → 10 et 5 → 15 : 5 s communes sur 10 s, soit exactement 0,5.
    expect(chevauchement(f(0, 10), f(5, 15))).toBeCloseTo(CHEVAUCHEMENT_MAX, 5);
    expect(chevauchentTrop(f(0, 10), f(5, 15))).toBe(false);
    // Un cheveu de plus, et c'est écarté.
    expect(chevauchentTrop(f(0, 10), f(4.9, 14.9))).toBe(true);
  });
});

describe('2. Le tri des fenêtres', () => {
  it('2.1 ⚠️ RÉGRESSION OBLIGATOIRE : A et B ne peuvent pas coexister', () => {
    const A = f(3.2, 11.2, 1);
    const B = f(0.0, 8.0, 2);
    const gardees = ecarterChevauchements([A, B]);
    expect(gardees).toHaveLength(1);
    // Le MIEUX classé gagne : A est rang 1.
    expect(gardees[0]).toBe(A);
  });

  it('2.2 le mieux classé gagne, quel que soit l’ordre d’arrivée', () => {
    // La liste arrive triée par rang ; on garde en avançant.
    const meilleur = f(0, 10, 1);
    const doublon = f(1, 11, 2);
    expect(ecarterChevauchements([meilleur, doublon])).toEqual([meilleur]);
  });

  it('2.3 des fenêtres distinctes sont toutes gardées', () => {
    const l = [f(0, 5, 1), f(6, 11, 2), f(12, 17, 3)];
    expect(ecarterChevauchements(l)).toEqual(l);
  });

  it('2.4 une fenêtre écartée n’écarte personne à son tour', () => {
    // B est écarté par A ; C chevauche B mais PAS A : il doit survivre.
    const A = f(0, 10, 1);
    const B = f(1, 11, 2);
    const C = f(10.5, 16, 3);
    expect(ecarterChevauchements([A, B, C])).toEqual([A, C]);
  });

  it('2.5 déterministe : deux appels rendent le même résultat', () => {
    const l = [f(0, 8, 1), f(3.2, 11.2, 2), f(9, 15, 3), f(14, 20, 4)];
    expect(ecarterChevauchements(l)).toEqual(ecarterChevauchements(l));
  });

  it('2.6 ne renumérote rien : le rang de M3-C est conservé', () => {
    const gardees = ecarterChevauchements([f(0, 10, 1), f(1, 11, 2), f(20, 30, 7)]);
    expect(gardees.map((g) => g.rang)).toEqual([1, 7]);
  });

  it('2.7 ne mute pas la liste reçue', () => {
    const l = [f(0, 10, 1), f(1, 11, 2)];
    const copie = JSON.parse(JSON.stringify(l));
    ecarterChevauchements(l);
    expect(l).toEqual(copie);
  });
});

describe('3. La règle appliquée par M3-E', () => {
  /** Le cas de production, tel que M3-C l'a rendu. */
  const candidats = [
    {
      rang: 1, secondeReference: 7, dureeCibleSecondes: 8,
      debutSecondes: 3.2, finSecondes: 11.2, scoreMontage: 78, raison: 'Danseurs en action.',
    },
    {
      rang: 2, secondeReference: 4, dureeCibleSecondes: 8,
      debutSecondes: 0, finSecondes: 8, scoreMontage: 75, raison: 'Groupe dansant.',
    },
    {
      rang: 3, secondeReference: 12, dureeCibleSecondes: 5,
      debutSecondes: 9.4, finSecondes: 14.4, scoreMontage: 72, raison: 'Salle de danse.',
    },
  ];

  /** Le rush réel de production : 38,165 s, sans transcription retenue. */
  const entree = {
    candidats, dureeRushSecondes: 38.165,
    transcriptionRetenue: false, parolePresente: false,
  };

  it('3.1 ⚠️ les deux passages qui se répètent ne sortent pas tous les deux', () => {
    const r = calerCoupes(entree as never);
    const rangs = r.coupes.map((c) => c.rang);
    expect(rangs).toContain(1);
    expect(rangs).not.toContain(2);
  });

  it('3.2 le troisième passage, distinct, est conservé', () => {
    const r = calerCoupes(entree as never);
    // 9,4 → 14,4 contre 3,2 → 11,2 : 1,8 s sur 5 s, soit 0,36. En deçà du seuil.
    expect(r.coupes.map((c) => c.rang)).toEqual([1, 3]);
  });

  it('3.3 la règle vaut aussi sur les fenêtres CALÉES', () => {
    // Avec une durée de rush, les bornes bougent : la comparaison doit porter
    // sur ce qui sort, pas sur ce qui entrait.
    const r = calerCoupes(entree as never);
    for (let i = 0; i < r.coupes.length; i += 1) {
      for (let j = i + 1; j < r.coupes.length; j += 1) {
        expect(chevauchentTrop(r.coupes[i], r.coupes[j]), `#${r.coupes[i].rang} vs #${r.coupes[j].rang}`)
          .toBe(false);
      }
    }
    expect(r.coupes.length).toBeGreaterThan(0);
  });

  it('3.4 ⚠️ LA VERSION DE L’ALGORITHME A CHANGÉ', () => {
    // Sans ce changement, un jeu de clips calculé sous l'ancienne règle —
    // donc avec ses doublons — serait REUTILISE tel quel : l'identité d'un
    // jeu M3-F porte `algorithme`. La correction serait restée invisible sur
    // tout rush déjà découpé.
    expect(ALGORITHME_COUPES).toBe('m3e-v2');
  });
});
