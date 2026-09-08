/**
 * A_7c — LA PAROLE DE CHAQUE RUSH, ET D'AUCUN AUTRE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA DERNIÈRE HYPOTHÈSE MONO-RUSH DU RENDERER ÉTAIT LE TEXTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le graphe ffmpeg ouvrait déjà une entrée par segment, chacune avec sa propre
 * piste audio : l'image de B ne pouvait pas porter le son de A. Le TEXTE, lui,
 * le pouvait. `projeterMots` recevait UNE liste de mots pour tout le montage,
 * et le repère de chaque plan se lisait sur `clips` — rang du clip → instant
 * dans LE rush.
 *
 * Deux défauts en découlaient, tous deux invisibles à la relecture d'un graphe :
 *
 *   1. LA COLLISION DE RANG. Le rang 1 existe dans A comme dans B ; un segment
 *      de B trouvait l'origine du clip 1 de A ;
 *   2. LE MAUVAIS TRANSCRIPT. Même origine juste, les mots venaient d'une
 *      seule transcription — celle du premier rush.
 *
 * Le résultat n'est pas une erreur : c'est un sous-titre qui s'affiche, bien
 * calé, parfaitement lisible, et qui dit autre chose que ce qu'on entend. Cela
 * ne se voit qu'à l'écran, sur la vidéo publiée.
 */
import { describe, it, expect } from 'vitest';
import {
  projeterMots, type MotSource, type PlanProjection, type ClipProjection,
} from '@/lib/autopilot/analyse/captions-timeline';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const mot = (texte: string, debut: number, fin: number): MotSource =>
  ({ texte, debutSecondes: debut, finSecondes: fin });

/** Un segment source-aware, tel qu'A_7b le produit. */
const seg = (
  ordre: number, clipSetId: string, debutSource: number, duree: number,
  rangClip = 1,
): PlanProjection => ({
  ordre, rangClip, entreeSecondes: 0, dureeRetenueSecondes: duree,
  source: {
    clipSetId,
    debutSourceSecondes: debutSource,
    finSourceSecondes: debutSource + duree,
  },
});

const textes = (m: { texte: string }[]) => m.map((x) => x.texte);

// ═══════════════════════════════════════════════════════════════════════════
describe('A_7c — chaque segment lit SA transcription', () => {
  it('A dit ALPHA, B dit BRAVO — jamais l inverse', () => {
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 0, 2)]],
      [B, [mot('BRAVO', 0, 2)]],
    ]);
    const r = projeterMots([], [seg(1, A, 0, 2), seg(2, B, 0, 2)], [], 0, parSource);
    expect(textes(r)).toEqual(['ALPHA', 'BRAVO']);
  });

  it('le plan réordonné réordonne les phrases', () => {
    /* Plan B→A : c'est BRAVO qui s'affiche d'abord. Le texte suit le montage,
       pas le tournage. */
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 0, 2)]],
      [B, [mot('BRAVO', 0, 2)]],
    ]);
    const r = projeterMots([], [seg(1, B, 0, 2), seg(2, A, 0, 2)], [], 0, parSource);
    expect(textes(r)).toEqual(['BRAVO', 'ALPHA']);
  });

  it('MÊMES timestamps, sources différentes : aucune contamination', () => {
    /* ⚠️ LE DÉFAUT EXACT QUE LE LOT FERME. A parle de 5 à 8 s, B aussi. Sans
       provenance, les deux segments afficheraient les mêmes mots. */
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 5, 7)]],
      [B, [mot('BRAVO', 5, 7)]],
    ]);
    const r = projeterMots([], [seg(1, A, 5, 2), seg(2, B, 5, 2)], [], 0, parSource);
    expect(textes(r)).toEqual(['ALPHA', 'BRAVO']);
    expect(r[0].ordrePlan).toBe(1);
    expect(r[1].ordrePlan).toBe(2);
  });

  it('un rush revenant deux fois lit deux passages DE SA transcription', () => {
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('DEBUT', 0, 2), mot('FIN', 10, 12)]],
      [B, [mot('BRAVO', 0, 2)]],
    ]);
    const r = projeterMots(
      [], [seg(1, A, 0, 2), seg(2, B, 0, 2), seg(3, A, 10, 2)], [], 0, parSource,
    );
    expect(textes(r)).toEqual(['DEBUT', 'BRAVO', 'FIN']);
  });

  it('A, C, B : trois transcriptions, trois phrases, dans l ordre du plan', () => {
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 0, 2)]],
      [B, [mot('BRAVO', 0, 2)]],
      [C, [mot('CHARLIE', 0, 2)]],
    ]);
    const r = projeterMots(
      [], [seg(1, A, 0, 2), seg(2, C, 0, 2), seg(3, B, 0, 2)], [], 0, parSource,
    );
    expect(textes(r)).toEqual(['ALPHA', 'CHARLIE', 'BRAVO']);
  });

  it('une source SANS transcription n affiche rien plutôt qu autre chose', () => {
    /* ⚠️ SE RABATTRE SUR LA LISTE GLOBALE LUI FERAIT DIRE LES PHRASES D'UN
       AUTRE RUSH. Mieux vaut un plan muet qu'un sous-titre faux. */
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 0, 2)]],
    ]);
    const r = projeterMots(
      [mot('GLOBAL', 0, 2)], [seg(1, A, 0, 2), seg(2, B, 0, 2)], [], 0, parSource,
    );
    expect(textes(r)).toEqual(['ALPHA']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A_7c — les minutages restent justes', () => {
  it('un mot est daté sur la TIMELINE DU MONTAGE, pas dans son rush', () => {
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 30, 31)]],
      [B, [mot('BRAVO', 50, 51)]],
    ]);
    const r = projeterMots([], [seg(1, A, 30, 2), seg(2, B, 50, 2)], [], 0, parSource);
    /* ALPHA est à 30 s de son rush et à 0 s du montage ; BRAVO à 50 s du sien
       et à 2 s du montage. */
    expect(r[0].debutSecondes).toBe(0);
    expect(r[1].debutSecondes).toBe(2);
  });

  it('le recouvrement d A_3d décale tous les plans à partir du second', () => {
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('ALPHA', 0, 1)]],
      [B, [mot('BRAVO', 0, 1)]],
      [C, [mot('CHARLIE', 0, 1)]],
    ]);
    const sans = projeterMots(
      [], [seg(1, A, 0, 2), seg(2, B, 0, 2), seg(3, C, 0, 2)], [], 0, parSource,
    );
    const avec = projeterMots(
      [], [seg(1, A, 0, 2), seg(2, B, 0, 2), seg(3, C, 0, 2)], [], 0.5, parSource,
    );
    expect(sans.map((m) => m.debutSecondes)).toEqual([0, 2, 4]);
    /* Le plan i commence `i x D` plus tôt. */
    expect(avec.map((m) => m.debutSecondes)).toEqual([0, 1.5, 3]);
  });

  it('un mot à cheval sur la fin du segment est coupé aux bornes de M3-E', () => {
    /* ⚠️ AUCUNE PHRASE N'EST RECOUPÉE PAR CE LOT : M3-E a déjà étendu les
       bornes. Ce qui déborde est écarté, pas rogné en plein milieu d'un mot
       qu'on n'entendra pas. */
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('DEDANS', 0, 1), mot('DEHORS', 1.9, 3.5)]],
      [B, [mot('BRAVO', 0, 1)]],
    ]);
    const r = projeterMots([], [seg(1, A, 0, 2), seg(2, B, 0, 2)], [], 0, parSource);
    // DEHORS n'est montré qu'à 6 % : il appartient au hors-champ, pas au plan.
    expect(textes(r)).toEqual(['DEDANS', 'BRAVO']);
  });

  it('un seul bloc à la fois : les mots sont triés sur la timeline finale', () => {
    const parSource = new Map<string, readonly MotSource[]>([
      [A, [mot('UN', 0, 0.5), mot('DEUX', 1, 1.5)]],
      [B, [mot('TROIS', 0, 0.5)]],
    ]);
    const r = projeterMots([], [seg(1, A, 0, 2), seg(2, B, 0, 2)], [], 0, parSource);
    expect(textes(r)).toEqual(['UN', 'DEUX', 'TROIS']);
    for (let i = 1; i < r.length; i += 1) {
      expect(r[i].debutSecondes).toBeGreaterThanOrEqual(r[i - 1].debutSecondes);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A_7c — le chemin historique est intact', () => {
  const MOTS = [mot('UN', 1, 2), mot('DEUX', 12, 13)];
  const PLANS: PlanProjection[] = [
    { ordre: 1, rangClip: 1, entreeSecondes: 0, dureeRetenueSecondes: 3 },
    { ordre: 2, rangClip: 2, entreeSecondes: 0, dureeRetenueSecondes: 3 },
  ];
  const CLIPS: ClipProjection[] = [
    { rang: 1, debutSecondes: 0 }, { rang: 2, debutSecondes: 11 },
  ];

  it('sans `motsParSource`, la projection est celle d avant le lot', () => {
    const r = projeterMots(MOTS, PLANS, CLIPS, 0);
    expect(textes(r)).toEqual(['UN', 'DEUX']);
    /* Le plan 2 commence à 3 s du montage ; DEUX est à 12 s du rush et le
       clip 2 y démarre à 11 s, donc 1 s dans le plan : 3 + 1 = 4. */
    expect(r.map((m) => m.debutSecondes)).toEqual([1, 4]);
  });

  it('un plan LEGACY sans provenance garde le repère par rang', () => {
    /* ⚠️ MÊME AVEC `motsParSource` FOURNIE. Un plan d'avant A_7a n'a pas de
       `source` : son repère se lit sur `clips`, exactement comme avant, et la
       carte des transcriptions ne le concerne pas. */
    const parSource = new Map<string, readonly MotSource[]>([[A, [mot('AUTRE', 0, 2)]]]);
    const r = projeterMots(MOTS, PLANS, CLIPS, 0, parSource);
    expect(textes(r)).toEqual(['UN', 'DEUX']);
    expect(r.map((m) => m.debutSecondes)).toEqual([1, 4]);
  });

  it('le recouvrement historique est inchangé', () => {
    const r = projeterMots(MOTS, PLANS, CLIPS, 0.5);
    /* Le second plan commence 0,5 s plus tôt : 4 − 0,5 = 3,5. */
    expect(r.map((m) => m.debutSecondes)).toEqual([1, 3.5]);
  });

  it('un plan mixte lit chacun par son propre repère', () => {
    /* Un plan legacy et un plan source-aware dans le même montage : chacun
       suit sa règle, aucun ne contamine l'autre. */
    const parSource = new Map<string, readonly MotSource[]>([[B, [mot('BRAVO', 0, 2)]]]);
    const plans: PlanProjection[] = [
      { ordre: 1, rangClip: 1, entreeSecondes: 0, dureeRetenueSecondes: 3 },
      seg(2, B, 0, 2),
    ];
    const r = projeterMots(MOTS, plans, CLIPS, 0, parSource);
    expect(textes(r)).toEqual(['UN', 'BRAVO']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A_7c — la voix-off reste globale', () => {
  it('ses minutages ne passent par aucune projection', async () => {
    /* ⚠️ ET C'EST LA DIFFÉRENCE DE FOND. La parole d'un rush est datée DANS LE
       RUSH : il faut la couper, la recaler, la réordonner. Une voix-off
       commence au début du montage et ne suit aucun plan — elle ignore
       jusqu'à l'existence des rushes, donc le multi-rush ne la concerne pas.
       Le renderer la prend telle quelle, et c'est ce que dit son code. */
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      `${process.cwd()}/src/lib/autopilot/analyse/rendu.ts`, 'utf8',
    ));
    const i = src.indexOf('const voixOff = demande.captionsVoixOff');
    expect(i).toBeGreaterThan(-1);
    const bloc = src.slice(i, i + 400);
    expect(bloc).toContain('voixOff.map((m) => ({ ...m, ordrePlan: 1 }))');
    /* Elle passe DEVANT la transcription du rush : sous-titrer le son
       d'ambiance pendant qu'une voix parle par-dessus donnerait deux textes
       qui ne correspondent à rien de ce qu'on écoute. */
    expect(bloc).toContain('voixOff.length > 0');
  });
});
