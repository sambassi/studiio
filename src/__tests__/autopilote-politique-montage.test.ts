// @vitest-environment node
/**
 * LA POLITIQUE EDITORIALE DU MONTAGE — QUALITE AVANT DUREE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI A CHANGE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La duree demandee etait un OBJECTIF A REMPLIR : sur un rush de 23 s avec
 * une cible de 60 s, le plan prenait les quatre passages proposes, couvrait
 * 92 % de la source et rejouait 1,85 s d'images deja vues. Le montage donnait
 * l'impression du rush repris presque tel quel — constate en production le
 * 2026-09-04 sur `20260903_073142_195_1.mp4`.
 *
 * Trois regles, et AUCUNE n'est un quota :
 *
 *   1. la duree demandee est un MAXIMUM ;
 *   2. la couverture de la source est un MAXIMUM (60 %) ;
 *   3. aucune portion du rush n'est montree deux fois.
 *
 * Et une quatrieme, d'ordonnancement : le score CHOISIT, la chronologie
 * MONTE. Sur un rush unique, la source a un ordre, et le suivre est la seule
 * lecture qui ne surprenne pas.
 *
 * ⚠️ NI LE SCORING NI LA DETECTION DES CANDIDATS NE SONT TOUCHES. Ce fichier
 * ne teste que ce que `planifierMontage` fait des passages qu'on lui donne.
 */
import { describe, it, expect } from 'vitest';
import { planifierMontage } from '@/lib/autopilot/analyse/montage';
import {
  COUVERTURE_MAX_RUSH, DUREE_PLAN_MIN_SECONDES,
} from '@/lib/autopilot/analyse/montage-contrat';
import type { ClipMaterialise } from '@/lib/autopilot/analyse/clip-contrat';

const GEO = { largeur: 1920, hauteur: 1080, fps: 30 };

/** Un clip materialise : le passage `debut → fin` du rush, dans un fichier. */
function clip(rang: number, debut: number, fin: number): ClipMaterialise {
  return {
    rang,
    debutSecondes: debut,
    finSecondes: fin,
    dureeSecondes: fin - debut,
    bucket: 'videos',
    cle: `A/autopilote/clips/jeu/rang-0${rang}.mp4`,
    octets: 1_000_000,
    debutMesureSecondes: 0,
    dureeMesureeSecondes: fin - debut,
  };
}

/** Les plages SOURCE reellement montrees par un plan. */
function plagesSource(plans: readonly { rangClip: number; entreeSecondes: number;
  dureeRetenueSecondes: number }[], clips: readonly ClipMaterialise[]) {
  return plans.map((p) => {
    const c = clips.find((x) => x.rang === p.rangClip)!;
    const debut = c.debutSecondes + p.entreeSecondes;
    return { debut, fin: debut + p.dureeRetenueSecondes };
  });
}

function secondesCouvertes(plages: readonly { debut: number; fin: number }[]): number {
  const tri = [...plages].sort((a, b) => a.debut - b.debut);
  const union: { debut: number; fin: number }[] = [];
  for (const p of tri) {
    const dernier = union[union.length - 1];
    if (dernier && p.debut <= dernier.fin) dernier.fin = Math.max(dernier.fin, p.fin);
    else union.push({ ...p });
  }
  return union.reduce((t, p) => t + (p.fin - p.debut), 0);
}

/** Le cas de production, au dixieme de seconde pres. */
const CAS_REEL = {
  rush: 23.061,
  clips: [
    clip(1, 8.972, 16.972), // score 78
    clip(2, 16.237, 21.237), // score 76
    clip(3, 0, 5), // score 75
    clip(4, 4.707, 9.707), // score 72
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
describe('A. Le cas de production ne reprend plus presque tout le rush', () => {
  const { resultat } = planifierMontage({
    clips: CAS_REEL.clips, format: '9:16', dureeCibleSecondes: 60,
    geometrie: GEO, dureeRushSecondes: CAS_REEL.rush,
  });
  const plages = plagesSource(resultat!.plans, CAS_REEL.clips);
  const couverture = secondesCouvertes(plages);

  it('la couverture tombe sous le plafond, loin des 92 % d’avant', () => {
    expect(couverture / CAS_REEL.rush).toBeLessThanOrEqual(COUVERTURE_MAX_RUSH);
    // Avant : 21,237 s couvertes sur 23,061 — 92,09 %.
    expect(couverture / CAS_REEL.rush).toBeLessThan(0.92);
    expect(+(couverture).toFixed(3)).toBe(12.265);
  });

  it('les deux meilleurs scores sont retenus, les deux suivants écartés', () => {
    // Le classement est celui de M3-C : `rang` 1 = meilleur score.
    expect(resultat!.plans.map((p) => p.rangClip).sort()).toEqual([1, 2]);
    expect(resultat!.clipsEcartes).toBe(2);
  });

  it('la durée finale est celle de la matière retenue, pas la cible', () => {
    expect(+resultat!.dureeTotaleSecondes.toFixed(3)).toBe(12.265);
    // ⚠️ L'ECART EST DIT, JAMAIS COMBLE.
    expect(+resultat!.ecartSecondes.toFixed(3)).toBe(47.735);
  });
});

describe('B/H. Le plafond ne se remplit pas', () => {
  it('huit secondes excellentes donnent huit secondes, pas soixante', () => {
    const clips = [clip(1, 0, 8)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 60, geometrie: GEO,
      dureeRushSecondes: 120,
    });
    expect(resultat!.plans).toHaveLength(1);
    expect(resultat!.dureeTotaleSecondes).toBe(8);
  });

  it('un passage faible n’est PAS ajouté pour approcher la cible', () => {
    // Deux passages, de quoi tenir sous les deux plafonds : les deux passent.
    // Le troisième ferait dépasser la couverture — il est écarté, et rien
    // n'est rogné pour le faire entrer.
    const rush = 100;
    const clips = [clip(1, 0, 30), clip(2, 40, 70), clip(3, 80, 90)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: rush,
    });
    const couverture = secondesCouvertes(plagesSource(resultat!.plans, clips));
    expect(couverture).toBeLessThanOrEqual(COUVERTURE_MAX_RUSH * rush);
    expect(resultat!.plans.map((p) => p.rangClip)).toEqual([1, 2]);
    // Le troisième aurait tenu en le rognant à 0 s de marge : on ne le fait pas.
    expect(resultat!.clipsEcartes).toBe(1);
  });
});

describe('C. La durée demandée reste un maximum qu’on peut atteindre', () => {
  it('cible 10 s avec beaucoup de matière : 10 s, pas plus', () => {
    const clips = [clip(1, 0, 8), clip(2, 20, 28), clip(3, 40, 48)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 10, geometrie: GEO,
      dureeRushSecondes: 600,
    });
    expect(resultat!.dureeTotaleSecondes).toBeLessThanOrEqual(10);
    expect(resultat!.dureeTotaleSecondes).toBe(10);
    // ⚠️ ELLE, on y tombe pile : c'est une commande explicite, pas une garde.
    expect(resultat!.plans.some((p) => p.raccourci)).toBe(true);
  });
});

describe('D/G. Aucune image source deux fois', () => {
  it('deux passages qui se chevauchent : la partie commune n’est montrée qu’une fois', () => {
    const clips = [clip(1, 0, 10), clip(2, 8, 18)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    const plages = plagesSource(resultat!.plans, clips);
    const somme = plages.reduce((t, p) => t + (p.fin - p.debut), 0);
    // Somme des durées === union : il n'y a donc aucun recouvrement.
    expect(+somme.toFixed(3)).toBe(+secondesCouvertes(plages).toFixed(3));
    // Le second entre APRES la partie déjà prise.
    const second = resultat!.plans.find((p) => p.rangClip === 2)!;
    expect(second.entreeSecondes).toBe(2);
    expect(second.dureeRetenueSecondes).toBe(8);
  });

  it('deux passages adjacents sans recouvrement sont gardés entiers', () => {
    const clips = [clip(1, 0, 10), clip(2, 10, 20)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    expect(resultat!.plans).toHaveLength(2);
    for (const p of resultat!.plans) {
      expect(p.entreeSecondes).toBe(0);
      expect(p.dureeRetenueSecondes).toBe(10);
    }
  });

  it('un passage entièrement contenu dans un autre est écarté', () => {
    const clips = [clip(1, 0, 20), clip(2, 5, 10)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    expect(resultat!.plans.map((p) => p.rangClip)).toEqual([1]);
    expect(resultat!.clipsEcartes).toBe(1);
  });

  it('un reste trop court après retrait du chevauchement est écarté', () => {
    // Il ne resterait que 0,5 s — sous `DUREE_PLAN_MIN_SECONDES`.
    const clips = [clip(1, 0, 10), clip(2, 9.5, 10.5)];
    expect(DUREE_PLAN_MIN_SECONDES).toBe(1);
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    expect(resultat!.plans.map((p) => p.rangClip)).toEqual([1]);
  });
});

describe('E/F. Le score choisit, la chronologie monte', () => {
  it('les meilleurs scores sont prioritaires', () => {
    // Le rang porte le classement : rang 1 = meilleur. Le plafond (0,60 × 90
    // = 54 s) ne laisse passer que deux passages de 20 s sur trois.
    const clips = [clip(1, 50, 70), clip(2, 20, 40), clip(3, 0, 20)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 90,
    });
    expect(resultat!.plans.map((p) => p.rangClip).sort()).toEqual([1, 2]);
  });

  it('l’ordre du montage est CHRONOLOGIQUE, pas celui du score', () => {
    const clips = [clip(1, 50, 70), clip(2, 20, 40), clip(3, 0, 20)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 200,
    });
    // Choisis dans l'ordre 1, 2, 3 (score) ; montés dans l'ordre 3, 2, 1.
    expect(resultat!.plans.map((p) => p.rangClip)).toEqual([3, 2, 1]);
    const plages = plagesSource(resultat!.plans, clips);
    for (let i = 1; i < plages.length; i += 1) {
      expect(plages[i].debut).toBeGreaterThanOrEqual(plages[i - 1].debut);
    }
    // Et la timeline est continue, renumérotée après le tri.
    expect(resultat!.plans.map((p) => p.ordre)).toEqual([1, 2, 3]);
    expect(resultat!.plans.map((p) => p.debutTimelineSecondes)).toEqual([0, 20, 40]);
  });
});

describe('I. La couverture se mesure sur l’union, jamais sur la somme', () => {
  it('trois passages qui se recouvrent ne consomment pas trois fois le plafond', () => {
    // Somme des durées = 30 s ; union réelle = 14 s. Le plafond (0,60 × 20 s
    // = 12 s) doit s'appliquer à l'union, sinon un seul passage suffirait à
    // le saturer — et le montage n'aurait qu'un plan là où deux tiennent.
    const clips = [clip(1, 0, 10), clip(2, 8, 18), clip(3, 16, 26)];
    const rush = 40;
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: rush,
    });
    const plages = plagesSource(resultat!.plans, clips);
    const union = secondesCouvertes(plages);
    expect(union).toBeLessThanOrEqual(COUVERTURE_MAX_RUSH * rush);
    expect(resultat!.usage.couvertureSecondes).toBe(union);
    expect(resultat!.usage.couverturePart).toBeLessThanOrEqual(COUVERTURE_MAX_RUSH);
  });

  it('sans durée de rush connue, aucun plafond n’est inventé', () => {
    // ⚠️ REFUSER AU HASARD SERAIT PIRE QUE NE PAS REFUSER : on ne peut pas
    // dire quelle part d'une source on montre si on ignore combien elle dure.
    const clips = [clip(1, 0, 10), clip(2, 20, 30), clip(3, 40, 50)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
    });
    expect(resultat!.plans).toHaveLength(3);
    expect(resultat!.usage.couvertureMaxSecondes).toBeNull();
    expect(resultat!.usage.couverturePart).toBeNull();
  });
});

describe('L. Les trois formats restent intacts', () => {
  it.each([
    ['9:16', 1080, 1920],
    ['16:9', 1920, 1080],
    ['1:1', 1080, 1080],
  ] as const)('%s reste %s × %s', (format, l, h) => {
    const clips = [clip(1, 0, 10), clip(2, 20, 30)];
    const { resultat } = planifierMontage({
      clips, format, dureeCibleSecondes: 60, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    expect(resultat!.usage.largeurCible).toBe(l);
    expect(resultat!.usage.hauteurCible).toBe(h);
  });
});
