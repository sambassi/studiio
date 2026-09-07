/**
 * M3-E v4 — FINIR LA PHRASE.
 *
 * ---------------------------------------------------------------------------
 * CE QUE BASSI A ENTENDU, ET QUE LE MOTEUR NE VOYAIT PAS
 * ---------------------------------------------------------------------------
 *
 * Validation humaine du 2026-09-07 : « le montage global est souvent bon,
 * MAIS certaines phrases parlées sont coupées ». Le moteur, lui, faisait
 * exactement ce qu'on lui demandait : poser chaque borne sur le point le plus
 * proche. Le défaut était dans la matière offerte, pas dans l'arbitrage :
 *
 *   • un « segment » Whisper est un tronçon de souffle, pas une phrase — il
 *     s'arrête volontiers au milieu d'une proposition ;
 *   • une frontière de MOT est presque toujours à quelques centièmes — donc
 *     elle gagnait, et la coupe tombait proprement entre deux mots, en plein
 *     milieu d'une phrase. Irréprochable au millième, inaudible à l'oreille.
 *
 * v4 ajoute une source d'ancrage `phrase`, tirée de la PONCTUATION, avec sa
 * propre tolérance (1,5 s) et une concession de durée de même ampleur.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT AVANT TOUT : que rien d'ancien ne se perde.
 * Une correction de calage qui rendrait une fenêtre PIRE ailleurs serait un
 * échec, même si la phrase est belle.
 */
import { describe, it, expect } from 'vitest';
import {
  ALGORITHME_COUPES, SOURCES_ANCRAGE, TOLERANCE_SECONDES,
  TOLERANCE_PHRASE_SECONDES, GARDE_PHRASE_SECONDES, toleranceDe,
  frontieresPhrase,
} from '@/lib/autopilot/analyse/coupe-contrat';
import type { EntreeCoupes } from '@/lib/autopilot/analyse/coupe-contrat';
import type { CandidatMontage } from '@/lib/autopilot/analyse/candidat-contrat';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Où une phrase commence et où elle finit', () => {
  const u = (d: number, f: number, texte: string) => ({
    debutSecondes: d, finSecondes: f, texte,
  });

  it('1.1 la ponctuation forte ferme une phrase', () => {
    const r = frontieresPhrase([
      u(0, 3, 'Bonjour à tous.'),
      u(3, 7, 'On commence tout de suite !'),
    ]);
    expect(r.fins).toEqual([3, 7]);
    expect(r.debuts).toEqual([0, 3]);
  });

  it('1.2 point d’interrogation, points de suspension, guillemet fermant', () => {
    const r = frontieresPhrase([
      u(0, 2, 'Vous êtes prêts ?'),
      u(2, 4, 'Alors on y va…'),
      u(4, 6, 'Il a dit « c’est parti. »'),
    ]);
    expect(r.fins).toEqual([2, 4, 6]);
  });

  it('1.3 ⚠️ NI VIRGULE, NI POINT-VIRGULE, NI DEUX-POINTS', () => {
    // Ils ANNONCENT une suite : couper là laisse la phrase en suspens,
    // exactement le défaut qu'on répare.
    const r = frontieresPhrase([
      u(0, 2, 'D’abord, on s’échauffe,'),
      u(2, 4, 'ensuite on enchaîne ; puis :'),
      u(4, 6, 'et voilà.'),
    ]);
    expect(r.fins).toEqual([6]);
  });

  it('1.4 aucune ponctuation : AUCUNE frontière — l’ancien comportement', () => {
    // ⚠️ LE DÉFAUT SÛR. Tous les fournisseurs ne ponctuent pas. Deviner une
    // fin de phrase là où rien ne la prouve couperait au hasard en croyant
    // bien faire ; on rend donc deux listes vides et le moteur se comporte
    // exactement comme en v3.
    const r = frontieresPhrase([u(0, 3, 'bonjour a tous'), u(3, 7, 'on commence')]);
    expect(r.fins).toEqual([]);
    expect(r.debuts).toEqual([]);
  });

  it('1.5 un texte absent ou vide ne ferme rien', () => {
    const r = frontieresPhrase([
      { debutSecondes: 0, finSecondes: 3 },
      u(3, 6, '   '),
      u(6, 9, 'Fin.'),
    ]);
    expect(r.fins).toEqual([9]);
  });

  it('1.6 une phrase qui court sur trois unités n’ouvre qu’une fois', () => {
    const r = frontieresPhrase([
      u(0, 2, 'Ce que je veux dire'),
      u(2, 4, 'c’est que le sport'),
      u(4, 6, 'change une vie.'),
      u(6, 8, 'Vraiment.'),
    ]);
    expect(r.fins).toEqual([6, 8]);
    // Une seule ouverture pour la longue phrase, puis celle qui suit.
    expect(r.debuts).toEqual([0, 6]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les tolérances', () => {
  it('2.1 une phrase a droit à 1,5 s, les autres restent à 0,75 s', () => {
    expect(TOLERANCE_PHRASE_SECONDES).toBe(1.5);
    expect(TOLERANCE_SECONDES).toBe(0.75);
    expect(toleranceDe('phrase')).toBe(1.5);
    for (const s of ['silence', 'segment', 'mot', 'aucun'] as const) {
      expect(toleranceDe(s), s).toBe(0.75);
    }
  });

  it('2.2 la garde de durée concède exactement ce que la tolérance a ouvert', () => {
    // ⚠️ SANS CETTE CONCESSION, LA CORRECTION SE SABORDE : la fenêtre étendue
    // de 1,2 s dépassait la garde, était rejetée, et le moteur retombait sur
    // la coupe qui tranche la phrase.
    expect(GARDE_PHRASE_SECONDES).toBe(TOLERANCE_PHRASE_SECONDES - TOLERANCE_SECONDES);
  });

  it('2.3 `phrase` est en tête du départage, et le vocabulaire reste fermé', () => {
    expect(SOURCES_ANCRAGE).toEqual(['phrase', 'silence', 'segment', 'mot', 'aucun']);
    expect(ALGORITHME_COUPES).toBe('m3e-v4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LE MOTEUR, DE BOUT EN BOUT
// ═══════════════════════════════════════════════════════════════════════════

const DUREE = 40;

function cand(over: Partial<CandidatMontage> = {}): CandidatMontage {
  const ref = over.secondeReference ?? 14;
  const cible = over.dureeCibleSecondes ?? 8;
  return {
    rang: 1, secondeReference: ref, dureeCibleSecondes: cible,
    debutSecondes: ref - cible / 2, finSecondes: ref + cible / 2,
    scoreMontage: 77, raison: 'raison M3-C', signaux: null,
    ...over,
  };
}

function entree(over: Partial<EntreeCoupes> = {}): EntreeCoupes {
  return {
    dureeRushSecondes: DUREE,
    candidats: [cand()],
    silences: [],
    audioEtatMesure: 'indisponible',
    transcriptionRetenue: false,
    parolePresente: false,
    segments: [],
    mots: [],
    ...over,
  };
}

const une = (e: Partial<EntreeCoupes> = {}, c: Partial<CandidatMontage> = {}) =>
  calerCoupes(entree({ candidats: [cand(c)], ...e })).coupes[0];

const seg = (d: number, f: number, texte: string) => ({
  debutSecondes: d, finSecondes: f, texte,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. LE DÉFAUT SIGNALÉ, REJOUÉ', () => {
  it('3.1 la fin s’étend jusqu’au point, au lieu de trancher la phrase', () => {
    /* La fenêtre M3-C finit à 18. La phrase, elle, se termine à 19,1 — donc
       à 1,1 s, hors de portée des 0,75 s de la v3. Un mot se ferme à 17,98,
       à 0,02 s : c'est LUI qui gagnait, et la phrase restait coupée. */
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(9.5, 19.1, 'Le sport change une vie.')],
      mots: [{ debutSecondes: 17.9, finSecondes: 18.4, texte: 'vie' }],
    });
    expect(c.finSecondes).toBe(19.1);
    expect(c.ajustementFin.source).toBe('phrase');
  });

  it('3.2 le début remonte à l’ouverture de la phrase', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [
        seg(4, 9.2, 'Première idée.'),
        seg(9.2, 17.9, 'Deuxième idée, plus longue.'),
      ],
    });
    expect(c.debutSecondes).toBe(9.2);
    expect(c.ajustementDebut.source).toBe('phrase');
  });

  it('3.3 au-delà de 1,5 s, on ne finit plus une phrase — on en ajoute une', () => {
    // La fin de phrase est à +1,9 s : hors tolérance, même élargie.
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(9.5, 19.9, 'Une phrase beaucoup trop longue pour être finie.')],
    });
    expect(c.ajustementFin.source).not.toBe('phrase');
    expect(c.finSecondes).toBeLessThanOrEqual(18 + TOLERANCE_SECONDES);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Rien d’ancien ne se perd', () => {
  it('4.1 sans ponctuation, le calage v3 est rendu à l’identique', () => {
    // ⚠️ LA GARANTIE LA PLUS IMPORTANTE DU LOT. Le matériel est celui d'un
    // test v3 : mêmes segments, aucun point. Le résultat doit être celui
    // d'avant, borne pour borne, source pour source.
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(10.3, 17.65, 'sans ponctuation aucune')],
    });
    expect(c.debutSecondes).toBe(10.3);
    expect(c.ajustementDebut.source).toBe('segment');
    expect(c.finSecondes).toBe(17.65);
    expect(c.ajustementFin.source).toBe('segment');
  });

  it('4.2 un silence proche l’emporte toujours quand aucune phrase n’est là', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [{ debutSecondes: 9.2, finSecondes: 9.7 }] });
    expect(c.debutSecondes).toBe(9.7);
    expect(c.ajustementDebut.source).toBe('silence');
  });

  it('4.3 la fenêtre reste dans le rush et garde sa seconde de référence', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(9.5, 19.1, 'Le sport change une vie.')],
    });
    expect(c.debutSecondes).toBeGreaterThanOrEqual(0);
    expect(c.finSecondes).toBeLessThanOrEqual(DUREE);
    expect(c.secondeReference).toBeGreaterThanOrEqual(c.debutSecondes);
    expect(c.secondeReference).toBeLessThanOrEqual(c.finSecondes);
  });

  it('4.4 la fenêtre d’origine reste tracée', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(9.5, 19.1, 'Le sport change une vie.')],
    });
    expect(c.debutOriginalSecondes).toBe(10);
    expect(c.finOriginalSecondes).toBe(18);
  });
});
