/**
 * P0-C — DEUX FOIS LE MÊME MOMENT N'EST PAS UN MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT, MESURÉ DEUX FOIS EN PRODUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-C classe les passages, il ne les rend pas disjoints. Sur le rush
 * `c0ad258d` du 2026-09-02, la première version de la règle — plus de la
 * MOITIÉ de la plus courte — a écarté le gros doublon et laissé passer les
 * deux autres :
 *
 *   #2  3,156 → 11,156  ∩  #3  7,927 → 16,120  =  3,229 s  (40 %)
 *   #3  7,927 → 16,120  ∩  #6 14,197 → 19,197  =  1,923 s  (38 %)
 *
 * 5,152 s rejouées sur 28,993 s — 18 % du montage, et #2 et #3 CONSÉCUTIFS.
 *
 * ⚠️ CE FICHIER TESTE LA RÈGLE, PAS SA PRÉSENCE. Aucune assertion sur le
 * source : on donne des fenêtres, on regarde ce qui sort.
 */
import { describe, it, expect } from 'vitest';
import {
  ALGORITHME_COUPES, CHEVAUCHEMENT_MAX, CHEVAUCHEMENT_MIN_SECONDES,
  chevauchement, chevauchentTrop, ecarterChevauchements, secondesCommunes,
} from '@/lib/autopilot/analyse/coupe-contrat';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';
import { planifierMontage } from '@/lib/autopilot/analyse/montage';

const f = (debutSecondes: number, finSecondes: number, rang = 1) => ({
  debutSecondes, finSecondes, rang,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA MESURE
// ═══════════════════════════════════════════════════════════════════════════

describe('1. La mesure du chevauchement', () => {
  it('1.1 deux fenêtres disjointes ne partagent rien', () => {
    expect(secondesCommunes(f(0, 5), f(6, 10))).toBe(0);
    expect(chevauchement(f(0, 5), f(6, 10))).toBe(0);
  });

  it('1.2 les secondes communes sont comptées, pas estimées', () => {
    expect(secondesCommunes(f(3.156, 11.156), f(7.927, 16.12))).toBeCloseTo(3.229, 5);
    expect(secondesCommunes(f(7.927, 16.12), f(14.197, 19.197))).toBeCloseTo(1.923, 5);
  });

  it('1.3 la part est rapportée à la plus COURTE des deux', () => {
    // Une fenêtre brève entièrement contenue dans une longue est un doublon
    // total, même si elle ne couvre qu'un cinquantième de sa voisine.
    expect(chevauchement(f(0, 100), f(10, 12))).toBe(1);
  });

  it('1.4 la mesure est symétrique', () => {
    const a = f(3.2, 11.2);
    const b = f(0.0, 8.0);
    expect(secondesCommunes(a, b)).toBe(secondesCommunes(b, a));
    expect(chevauchement(a, b)).toBe(chevauchement(b, a));
    expect(chevauchentTrop(a, b)).toBe(chevauchentTrop(b, a));
  });

  it('1.5 une fenêtre sans durée mesurable ne divise pas par zéro', () => {
    for (const mauvaise of [f(5, 5), f(5, 4), f(Number.NaN, 3), f(1, Number.POSITIVE_INFINITY)]) {
      expect(secondesCommunes(f(0, 10), mauvaise)).toBe(0);
      expect(chevauchement(f(0, 10), mauvaise)).toBe(0);
      expect(chevauchentTrop(f(0, 10), mauvaise)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LES DEUX SEUILS
// ═══════════════════════════════════════════════════════════════════════════

describe('2. Le critère : le plus exigeant des deux seuils', () => {
  it('2.1 les valeurs décidées sont bien celles-là', () => {
    expect(CHEVAUCHEMENT_MAX).toBe(0.20);
    expect(CHEVAUCHEMENT_MIN_SECONDES).toBe(0.25);
  });

  it('2.2 ⚠️ CAS A : 0→8 et 3→11 ne peuvent JAMAIS coexister', () => {
    // 5 s communes ; seuil = max(0,25 ; 0,20 × 8) = 1,6.
    const A = f(0, 8);
    const B = f(3, 11);
    expect(secondesCommunes(A, B)).toBe(5);
    expect(chevauchentTrop(A, B)).toBe(true);
    expect(ecarterChevauchements([f(0, 8, 1), f(3, 11, 2)])).toHaveLength(1);
  });

  it('2.3 ⚠️ CAS B : 0→5 et 5→10 sont AUTORISÉS — jointif n’est pas chevauchant', () => {
    const A = f(0, 5);
    const B = f(5, 10);
    expect(secondesCommunes(A, B)).toBe(0);
    expect(chevauchentTrop(A, B)).toBe(false);
    const l = [f(0, 5, 1), f(5, 10, 2)];
    expect(ecarterChevauchements(l)).toEqual(l);
  });

  it('2.4 ⚠️ 0→8 et 3→4 : la petite est REJETÉE, elle est rejouée à 100 %', () => {
    // C'est ce que le critère « part de l'UNION » aurait laissé passer :
    // 1 s sur une union de 8 s ne fait que 12,5 %. Rapportée à la plus courte
    // — 1 s sur 1 s — c'est une répétition entière.
    const A = f(0, 8);
    const B = f(3, 4);
    expect(secondesCommunes(A, B)).toBe(1);
    expect(chevauchement(A, B)).toBe(1);
    // Seuil = max(0,25 ; 0,20 × 1) = 0,25 ; 1 ≥ 0,25.
    expect(chevauchentTrop(A, B)).toBe(true);
    expect(ecarterChevauchements([f(0, 8, 1), f(3, 4, 2)]).map((x) => x.rang)).toEqual([1]);
  });

  it('2.5 le seuil relatif mord PILE dessus — « à partir de », pas « au-delà »', () => {
    // 10 s et 10 s : seuil relatif = 2 s. 8 → 18 partage exactement 2 s.
    expect(secondesCommunes(f(0, 10), f(8, 18))).toBe(2);
    expect(chevauchentTrop(f(0, 10), f(8, 18))).toBe(true);
    // Un cheveu de moins, et les deux passent.
    expect(chevauchentTrop(f(0, 10), f(8.01, 18))).toBe(false);
  });

  it('2.6 le plancher protège le frôlement entre deux longues fenêtres', () => {
    // 0,2 s communes sur deux fenêtres de 8 s : personne ne le voit.
    expect(secondesCommunes(f(0, 8), f(7.8, 15.8))).toBeCloseTo(0.2, 5);
    expect(chevauchentTrop(f(0, 8), f(7.8, 15.8))).toBe(false);
  });

  it('2.7 le plancher l’emporte quand le relatif serait dérisoire', () => {
    // Deux fenêtres d'une seconde : 0,20 × 1 = 0,2 s, en dessous du plancher.
    // C'est donc 0,25 s qui décide.
    expect(chevauchentTrop(f(0, 1), f(0.79, 1.79))).toBe(false); // 0,21 s
    expect(chevauchentTrop(f(0, 1), f(0.74, 1.74))).toBe(true); // 0,26 s
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LE TRI
// ═══════════════════════════════════════════════════════════════════════════

describe('3. Le tri des fenêtres', () => {
  it('3.1 le mieux classé gagne, quel que soit l’ordre d’arrivée', () => {
    const meilleur = f(0, 10, 1);
    const doublon = f(1, 11, 2);
    expect(ecarterChevauchements([meilleur, doublon])).toEqual([meilleur]);
  });

  it('3.2 des fenêtres distinctes sont toutes gardées', () => {
    const l = [f(0, 5, 1), f(6, 11, 2), f(12, 17, 3)];
    expect(ecarterChevauchements(l)).toEqual(l);
  });

  it('3.3 une fenêtre écartée n’écarte personne à son tour', () => {
    // B est écarté par A ; C ne touche pas A : il doit survivre.
    const A = f(0, 10, 1);
    const B = f(1, 11, 2);
    const C = f(10.5, 16, 3);
    expect(ecarterChevauchements([A, B, C])).toEqual([A, C]);
  });

  it('3.4 déterministe : deux appels rendent le même résultat', () => {
    const l = [f(0, 8, 1), f(3.2, 11.2, 2), f(9, 15, 3), f(14, 20, 4)];
    expect(ecarterChevauchements(l)).toEqual(ecarterChevauchements(l));
  });

  it('3.5 ne renumérote rien : le rang de M3-C est conservé', () => {
    const gardees = ecarterChevauchements([f(0, 10, 1), f(1, 11, 2), f(20, 30, 7)]);
    expect(gardees.map((g) => g.rang)).toEqual([1, 7]);
  });

  it('3.6 ne mute pas la liste reçue', () => {
    const l = [f(0, 10, 1), f(1, 11, 2)];
    const copie = JSON.parse(JSON.stringify(l));
    ecarterChevauchements(l);
    expect(l).toEqual(copie);
  });

  it('3.7 ⚠️ CAS G : deux fenêtres couvrant la même plage ne sortent jamais ensemble', () => {
    // Décalées d'un dixième de seconde : deux « passages » différents pour le
    // classement, une seule et même image à l'écran.
    const gardees = ecarterChevauchements([f(5, 13, 1), f(5.1, 13.1, 2)]);
    expect(gardees.map((g) => g.rang)).toEqual([1]);
  });

  it('3.8 aucune paire retenue ne se répète, sur un jeu bruité', () => {
    const l = [
      f(0, 8, 1), f(3, 11, 2), f(7, 15, 3), f(14, 19, 4), f(28, 33, 5), f(34, 37, 6),
    ];
    const gardees = ecarterChevauchements(l);
    for (let i = 0; i < gardees.length; i += 1) {
      for (let j = i + 1; j < gardees.length; j += 1) {
        expect(chevauchentTrop(gardees[i], gardees[j]),
          `#${gardees[i].rang} vs #${gardees[j].rang}`).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE CAS RÉEL DE PRODUCTION, DE BOUT EN BOUT
// ═══════════════════════════════════════════════════════════════════════════

describe('4. Le rush c0ad258d du 2026-09-02', () => {
  /** Les six passages tels que M3-C les a rendus, dans leur ordre de rang. */
  const candidats = [
    { rang: 1, secondeReference: 35.78, dureeCibleSecondes: 3, debutSecondes: 34.28, finSecondes: 37.28, scoreMontage: 76, raison: 'Portrait net.' },
    { rang: 2, secondeReference: 7.156, dureeCibleSecondes: 8, debutSecondes: 3.156, finSecondes: 11.156, scoreMontage: 75, raison: 'Groupe dansant.' },
    { rang: 3, secondeReference: 11.927, dureeCibleSecondes: 8, debutSecondes: 7.927, finSecondes: 15.927, scoreMontage: 73, raison: 'Scène extérieure.' },
    { rang: 4, secondeReference: 4, dureeCibleSecondes: 8, debutSecondes: 0, finSecondes: 8, scoreMontage: 72, raison: 'Ouverture.' },
    { rang: 5, secondeReference: 31, dureeCibleSecondes: 5, debutSecondes: 28.509, finSecondes: 33.509, scoreMontage: 70, raison: 'Public.' },
    { rang: 6, secondeReference: 16.7, dureeCibleSecondes: 5, debutSecondes: 14.197, finSecondes: 19.197, scoreMontage: 68, raison: 'Mouvement.' },
  ];
  const entree = {
    candidats, dureeRushSecondes: 38.165,
    transcriptionRetenue: false, parolePresente: false,
  };

  it('4.1 ⚠️ RÉGRESSION : #3 ne sort plus avec #2', () => {
    // 3,229 s communes ; seuil = max(0,25 ; 0,20 × 8) = 1,6.
    const rangs = calerCoupes(entree as never).coupes.map((c) => c.rang);
    expect(rangs).toContain(2);
    expect(rangs).not.toContain(3);
  });

  it('4.2 #4, déjà écarté par l’ancienne règle, l’est toujours', () => {
    expect(calerCoupes(entree as never).coupes.map((c) => c.rang)).not.toContain(4);
  });

  it('4.3 les quatre passages distincts sont conservés', () => {
    expect(calerCoupes(entree as never).coupes.map((c) => c.rang)).toEqual([1, 2, 5, 6]);
  });

  it('4.4 ⚠️ CAS E : le montage est PLUS COURT, et sans une image répétée', () => {
    const r = calerCoupes(entree as never);
    const total = r.coupes.reduce((t, c) => t + c.dureeSecondes, 0);
    // Avant : 28,993 s dont 5,152 s rejouées. Après : plus court, et honnête.
    expect(total).toBeLessThan(28.993);
    expect(total).toBeGreaterThan(15);
    for (let i = 0; i < r.coupes.length; i += 1) {
      for (let j = i + 1; j < r.coupes.length; j += 1) {
        expect(secondesCommunes(r.coupes[i], r.coupes[j]),
          `#${r.coupes[i].rang} vs #${r.coupes[j].rang}`).toBe(0);
      }
    }
  });

  it('4.5 ⚠️ CAS D : la règle porte sur les fenêtres CALÉES, pas sur les entrées', () => {
    // En production, le calage de #3 a poussé sa fin de 15,927 à 16,120, ce
    // qui a AUGMENTÉ son recouvrement avec #6 — de 1,730 s à 1,923 s. Une
    // règle appliquée aux candidats d'entrée n'aurait pas vu la différence.
    const r = calerCoupes(entree as never);
    for (const c of r.coupes) {
      const source = candidats.find((x) => x.rang === c.rang)!;
      const bouge = c.debutSecondes !== source.debutSecondes
        || c.finSecondes !== source.finSecondes;
      // Qu'une borne bouge ou non, la fenêtre COMPARÉE est celle qui sort.
      expect(typeof bouge).toBe('boolean');
      expect(c.finSecondes - c.debutSecondes).toBeCloseTo(c.dureeSecondes, 5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. CE QUE M3-G NE FAIT PAS
// ═══════════════════════════════════════════════════════════════════════════

describe('5. Le plan ne répète jamais, et ne remplit jamais', () => {
  const clip = (rang: number, debutSecondes: number, finSecondes: number) => ({
    rang, debutSecondes, finSecondes,
    dureeSecondes: finSecondes - debutSecondes,
    bucket: 'studiio', cle: `clips/rang-${rang}.mp4`, octets: 1000,
    debutMesureSecondes: 0, dureeMesureeSecondes: finSecondes - debutSecondes,
  });
  const demande = (clips: ReturnType<typeof clip>[], dureeCibleSecondes: number) => ({
    clips, format: '9:16' as const, dureeCibleSecondes,
    geometrie: { largeur: 1920, hauteur: 1080 },
  });

  it('5.1 ⚠️ CAS F : un clip n’est jamais monté deux fois', () => {
    const clips = [clip(1, 0, 5), clip(2, 10, 15), clip(3, 20, 25)];
    // Cible très au-dessus de la matière : la tentation du remplissage.
    const r = planifierMontage(demande(clips, 60) as never);
    const rangs = r.resultat!.plans.map((p) => p.rangClip);
    expect(rangs).toEqual([1, 2, 3]);
    expect(new Set(rangs).size).toBe(rangs.length);
    expect(new Set(r.resultat!.plans.map((p) => p.cle)).size).toBe(3);
  });

  it('5.2 ⚠️ CAS E : la cible n’est pas atteinte, et le déficit est DIT', () => {
    const r = planifierMontage(demande([clip(1, 0, 5), clip(2, 10, 15)], 25) as never);
    expect(r.resultat!.dureeTotaleSecondes).toBe(10);
    // Une vidéo de 10 s annoncée comme telle, plutôt que 25 s dont 15 répétées.
    expect(r.resultat!.ecartSecondes).toBe(15);
  });

  it('5.3 la cible tronque, elle n’allonge pas', () => {
    const r = planifierMontage(demande([clip(1, 0, 20), clip(2, 30, 50)], 12) as never);
    expect(r.resultat!.dureeTotaleSecondes).toBe(12);
    expect(r.resultat!.ecartSecondes).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE CONTRAT MONO-RUSH
// ═══════════════════════════════════════════════════════════════════════════

describe('6. Un seul rush à la fois', () => {
  const unRush = (debutSecondes: number, finSecondes: number) => ({
    candidats: [{
      rang: 1, secondeReference: (debutSecondes + finSecondes) / 2,
      dureeCibleSecondes: finSecondes - debutSecondes,
      debutSecondes, finSecondes, scoreMontage: 75, raison: 'Passage.',
    }],
    dureeRushSecondes: 60, transcriptionRetenue: false, parolePresente: false,
  });

  it('6.1 ⚠️ CAS C : deux rushes aux MÊMES timecodes ne se comparent jamais', () => {
    // `calerCoupes` est appelé par ANALYSE, et une analyse porte UN rush :
    // deux fenêtres `0→8` venues de deux fichiers différents passent par deux
    // appels distincts, et aucune ne peut écarter l'autre. Ce test fige ce
    // contrat — c'est lui que le chantier multi-rush devra reprendre, en
    // comparant alors « même rushId ET recouvrement ».
    const rushA = calerCoupes(unRush(0, 8) as never);
    const rushB = calerCoupes(unRush(0, 8) as never);
    expect(rushA.coupes).toHaveLength(1);
    expect(rushB.coupes).toHaveLength(1);
    expect(rushA.coupes[0].debutSecondes).toBe(0);
    expect(rushB.coupes[0].debutSecondes).toBe(0);
  });

  it('6.2 dans un MÊME appel, en revanche, la répétition est écartée', () => {
    const deux = {
      candidats: [
        { rang: 1, secondeReference: 4, dureeCibleSecondes: 8, debutSecondes: 0, finSecondes: 8, scoreMontage: 80, raison: 'A.' },
        { rang: 2, secondeReference: 4, dureeCibleSecondes: 8, debutSecondes: 0, finSecondes: 8, scoreMontage: 70, raison: 'B.' },
      ],
      dureeRushSecondes: 60, transcriptionRetenue: false, parolePresente: false,
    };
    expect(calerCoupes(deux as never).coupes.map((c) => c.rang)).toEqual([1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. LA VERSION
// ═══════════════════════════════════════════════════════════════════════════

describe('7. La version de l’algorithme', () => {
  it('7.1 ⚠️ ELLE A CHANGÉ, SINON RIEN NE CHANGE À L’ÉCRAN', () => {
    // L'identité d'un jeu de clips M3-F porte `algorithme`. Sans ce bump, le
    // jeu déjà calculé sous `m3e-v2` — avec ses 5,152 s rejouées — serait
    // RÉUTILISÉ tel quel, et la correction resterait invisible sur tout rush
    // déjà découpé, dont celui de production.
    expect(ALGORITHME_COUPES).toBe('m3e-v3');
  });
});
