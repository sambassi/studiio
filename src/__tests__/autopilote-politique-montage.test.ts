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
  COUVERTURE_MAX_RUSH, DUREE_PLAN_MIN_SECONDES, ECART_MOMENTS_MIN_SECONDES,
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
    scoreMontage: null,
    signaux: null,
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
    expect(+(couverture).toFixed(3)).toBe(13);
  });

  it('le second moment n’est PAS le voisin du premier, mais un ailleurs', () => {
    // ⚠️ LE SCORE NE SUFFIT PAS. `rang` 2 (score 76) touche `rang` 1 une fois
    // leur recouvrement retiré : les garder tous deux reconstruisait une
    // plage continue de 12,3 s. C'est `rang` 3 (score 75), qui vit à l'autre
    // bout du rush, qui fait le second MOMENT.
    expect(resultat!.plans.map((p) => p.rangClip).sort()).toEqual([1, 3]);
    expect(resultat!.clipsEcartes).toBe(2);
  });

  it('les deux moments sont séparés par un vrai trou dans la source', () => {
    const tri = [...plages].sort((a, b) => a.debut - b.debut);
    expect(+(tri[1].debut - tri[0].fin).toFixed(3)).toBe(3.972);
    expect(resultat!.usage.plusPetitTrouSecondes).toBe(3.972);
  });

  it('la durée finale est celle de la matière retenue, pas la cible', () => {
    expect(+resultat!.dureeTotaleSecondes.toFixed(3)).toBe(13);
    // ⚠️ L'ECART EST DIT, JAMAIS COMBLE.
    expect(+resultat!.ecartSecondes.toFixed(3)).toBe(47);
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
  it('deux passages qui se chevauchent : le second est ÉCARTÉ, pas rogné', () => {
    // ⚠️ LE ROGNAGE PROLONGERAIT LA MEME SCENE. `0→10` puis `8→18` rogné
    // donnerait `0→10` + `10→18`, soit `0→18` d'une traite : deux plans, une
    // seule plage continue. C'est exactement ce qu'on refuse.
    const clips = [clip(1, 0, 10), clip(2, 8, 18)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    expect(resultat!.plans.map((p) => p.rangClip)).toEqual([1]);
    const plages = plagesSource(resultat!.plans, clips);
    const somme = plages.reduce((t, p) => t + (p.fin - p.debut), 0);
    expect(+somme.toFixed(3)).toBe(+secondesCouvertes(plages).toFixed(3));
  });

  it('deux passages exactement adjacents ne font qu’UN moment', () => {
    // `0→10` puis `10→20`, c'est `0→20`. Aucune coupe ne se verrait.
    const clips = [clip(1, 0, 10), clip(2, 10, 20)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 100,
    });
    expect(resultat!.plans).toHaveLength(1);
    expect(resultat!.plans[0].rangClip).toBe(1);
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
    const clips = [clip(1, 50, 70), clip(2, 25, 45), clip(3, 0, 20)];
    const { resultat } = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
      dureeRushSecondes: 90,
    });
    expect(resultat!.plans.map((p) => p.rangClip).sort()).toEqual([1, 2]);
  });

  it('l’ordre du montage est CHRONOLOGIQUE, pas celui du score', () => {
    // Trois moments réellement séparés — 5 s de trou entre chacun.
    const clips = [clip(1, 50, 70), clip(2, 25, 45), clip(3, 0, 20)];
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
    // Et chaque coupe correspond à une vraie suppression dans la source.
    expect(resultat!.usage.plusPetitTrouSecondes).toBe(5);
  });
});

describe('I. La couverture se mesure sur l’union, jamais sur la somme', () => {
  it('trois passages qui se recouvrent ne consomment pas trois fois le plafond', () => {
    // Somme des durées = 30 s ; union réelle = 14 s. Le plafond (0,60 × 20 s
    // = 12 s) doit s'appliquer à l'union, sinon un seul passage suffirait à
    // le saturer — et le montage n'aurait qu'un plan là où deux tiennent.
    // Trois passages qui se recouvrent deux à deux : seul le premier passe
    // la garde de diversité, et l'union ne compte donc pas trois fois.
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

// ═══════════════════════════════════════════════════════════════════════════
// LA DIVERSITÉ TEMPORELLE — « plusieurs clips » ne fait pas « un montage »
// ═══════════════════════════════════════════════════════════════════════════
describe('Diversité temporelle : deux plans, deux MOMENTS', () => {
  const rush = 200;
  const monter = (clips: ClipMaterialise[]) => planifierMontage({
    clips, format: '9:16', dureeCibleSecondes: 300, geometrie: GEO,
    dureeRushSecondes: rush,
  }).resultat!;

  it('A. deux candidats exactement adjacents : un seul moment', () => {
    const r = monter([clip(1, 0, 10), clip(2, 10, 20)]);
    expect(r.plans).toHaveLength(1);
  });

  it('B. deux candidats séparés de 0,2 s : ce n’est pas une coupe', () => {
    // ⚠️ UNE COUPE DE DEUX DIXIEMES NE COUPE RIEN. Elle ne se voit pas, et
    // le montage reste la même scène jouée d'une traite.
    const r = monter([clip(1, 0, 10), clip(2, 10.2, 20)]);
    expect(r.plans).toHaveLength(1);
  });

  it('C. au seuil exact, le second moment est accepté', () => {
    expect(ECART_MOMENTS_MIN_SECONDES).toBe(1);
    // Juste en dessous : refusé. Juste au seuil : accepté. La convention est
    // « >= seuil », et le test la fixe des deux côtés.
    expect(monter([clip(1, 0, 10), clip(2, 10.999, 20)]).plans).toHaveLength(1);
    expect(monter([clip(1, 0, 10), clip(2, 11, 20)]).plans).toHaveLength(2);
  });

  it('D. un score plus faible mais VRAIMENT ailleurs bat un voisin mieux noté', () => {
    // C'est le cas de production, en miniature : rang 2 est mieux classé,
    // mais il colle à rang 1 ; rang 3 est à l'autre bout du rush.
    const r = monter([clip(1, 50, 60), clip(2, 60, 70), clip(3, 0, 10)]);
    expect(r.plans.map((p) => p.rangClip).sort()).toEqual([1, 3]);
    // Et le montage les rend dans l'ordre du rush.
    expect(r.plans.map((p) => p.rangClip)).toEqual([3, 1]);
  });

  it('E/F/G/H. les garanties du lot précédent tiennent toujours', () => {
    const clips = [clip(1, 0, 20), clip(2, 40, 60), clip(3, 80, 100)];
    const r = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 45, geometrie: GEO,
      dureeRushSecondes: rush,
    }).resultat!;
    const plages = plagesSource(r.plans, clips);
    // E — aucune portion source répétée
    const somme = plages.reduce((t, p) => t + (p.fin - p.debut), 0);
    expect(+somme.toFixed(3)).toBe(+secondesCouvertes(plages).toFixed(3));
    // F — couverture sous le plafond
    expect(secondesCouvertes(plages)).toBeLessThanOrEqual(COUVERTURE_MAX_RUSH * rush);
    // G — la durée demandée reste un maximum
    expect(r.dureeTotaleSecondes).toBeLessThanOrEqual(45);
    // H — ordre chronologique
    for (let i = 1; i < plages.length; i += 1) {
      expect(plages[i].debut).toBeGreaterThan(plages[i - 1].debut);
    }
  });

  it('I. aucun quota : trois vrais moments donnent trois plans', () => {
    const r = monter([clip(1, 0, 10), clip(2, 30, 40), clip(3, 60, 70)]);
    expect(r.plans).toHaveLength(3);
  });

  it('J. un rush qui n’a qu’un moment fort donne UN plan, sans remplissage', () => {
    // Les trois candidats vivent au même endroit : le second colle au
    // premier, le troisième n'en est séparé que d'une demi-seconde. Aucun des
    // deux n'ajoute un moment, et rien n'est ajouté pour « faire des coupes ».
    const r = monter([clip(1, 0, 10), clip(2, 10, 20), clip(3, 10.5, 20.5)]);
    expect(r.plans).toHaveLength(1);
    expect(r.dureeTotaleSecondes).toBe(10);
    expect(r.clipsEcartes).toBe(2);
  });

  it('le relevé dit le seuil appliqué et le plus petit trou obtenu', () => {
    const r = monter([clip(1, 0, 10), clip(2, 30, 40), clip(3, 60, 70)]);
    expect(r.usage.ecartMomentsMin).toBe(ECART_MOMENTS_MIN_SECONDES);
    expect(r.usage.plusPetitTrouSecondes).toBe(20);
    // Un seul moment : il n'y a pas de trou à mesurer, et on ne l'invente pas.
    expect(monter([clip(1, 0, 10)]).usage.plusPetitTrouSecondes).toBeNull();
  });
});
