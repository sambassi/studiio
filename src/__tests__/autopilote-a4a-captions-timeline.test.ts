/**
 * A_4a — LA PAROLE, REPLACÉE SUR LE MONTAGE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ TROIS REPÈRES DE TEMPS, ET C'EST LÀ QUE TOUT SE JOUE
 * ---------------------------------------------------------------------------
 *
 * La transcription est datée dans le RUSH ; le plan entre dans un CLIP, dont
 * le zéro n'est pas celui du rush ; et le montage réordonne ces plans en les
 * faisant parfois se recouvrir. Sauter une conversion donne des sous-titres
 * qui dérivent régulièrement — invisible sur deux secondes de démonstration,
 * flagrant sur trente.
 *
 * ⚠️ CES TESTS MESURENT DES INSTANTS, PAS DES COMPTES. Vérifier « il reste
 * quatre mots » laisserait passer quatre mots placés n'importe où.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  projeterMots, dureeMontageSecondes, VERSION_MOTEUR_CAPTIONS,
  PART_MOT_RETENUE, DUREE_MOT_MIN_SECONDES,
  type MotSource, type PlanProjection, type ClipProjection,
} from '@/lib/autopilot/analyse/captions-timeline';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const MAPPEUR = lire('src/lib/autopilot/analyse/captions-timeline.ts');

/** Un mot par seconde, de 0 à 19 : « m0 » à 0–0,9 s, « m1 » à 1–1,9 s… */
const motsParSeconde = (n = 20): MotSource[] => Array.from({ length: n }, (_, i) => ({
  debutSecondes: i, finSecondes: i + 0.9, texte: `m${i}`,
}));

const plan = (
  ordre: number, rangClip: number, entreeSecondes: number, duree: number,
): PlanProjection => ({
  ordre, rangClip, entreeSecondes, dureeRetenueSecondes: duree,
});

const clip = (rang: number, debutSecondes: number): ClipProjection => ({
  rang, debutSecondes,
});

const textes = (r: readonly { texte: string }[]) => r.map((x) => x.texte);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le repère du rush', () => {
  it('1.1 ⚠️ le clip a son propre zéro : `entree` s’ajoute à son début', () => {
    // Le clip 1 commence à 5 s dans le rush ; le plan y entre à 2 s.
    // La fenêtre de parole est donc 7–10 s du RUSH.
    const r = projeterMots(motsParSeconde(), [plan(1, 1, 2, 3)], [clip(1, 5)]);
    expect(textes(r)).toEqual(['m7', 'm8', 'm9']);
  });

  it('1.2 le premier mot retenu commence à zéro dans le montage', () => {
    const r = projeterMots(motsParSeconde(), [plan(1, 1, 2, 3)], [clip(1, 5)]);
    expect(r[0].debutSecondes).toBe(0);
    expect(r[0].finSecondes).toBeCloseTo(0.9, 3);
    expect(r[2].debutSecondes).toBeCloseTo(2, 3);
  });

  it('1.3 un plan dont le clip est inconnu n’affiche rien — on n’invente pas', () => {
    const r = projeterMots(motsParSeconde(), [plan(1, 9, 0, 5)], [clip(1, 0)]);
    expect(r).toEqual([]);
  });

  it('1.4 aucune parole, aucun mot : rien, et sans lever', () => {
    expect(projeterMots([], [plan(1, 1, 0, 5)], [clip(1, 0)])).toEqual([]);
    expect(projeterMots(motsParSeconde(), [], [])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les plans coupés', () => {
  it('2.1 ⚠️ SEULES LES PLAGES RETENUES SURVIVENT, recalées bout à bout', () => {
    // Transcription 0–20 s ; le plan garde 5–10 puis 15–18.
    const r = projeterMots(
      motsParSeconde(),
      [plan(1, 1, 5, 5), plan(2, 1, 15, 3)],
      [clip(1, 0)],
    );
    expect(textes(r)).toEqual(['m5', 'm6', 'm7', 'm8', 'm9', 'm15', 'm16', 'm17']);
    // « m5 » ouvre le montage ; « m15 » arrive juste après les cinq secondes.
    expect(r[0].debutSecondes).toBe(0);
    expect(r[5].debutSecondes).toBeCloseTo(5, 3);
    expect(r[7].finSecondes).toBeCloseTo(7.9, 3);
  });

  it('2.2 ⚠️ LE MONTAGE PEUT RÉORDONNER, ET LES MOTS SUIVENT LE MONTAGE', () => {
    // On montre d'abord 15–18, puis 5–10.
    const r = projeterMots(
      motsParSeconde(),
      [plan(1, 1, 15, 3), plan(2, 1, 5, 5)],
      [clip(1, 0)],
    );
    expect(textes(r)).toEqual(['m15', 'm16', 'm17', 'm5', 'm6', 'm7', 'm8', 'm9']);
    // Trier par temps de RUSH aurait remis « m5 » en tête.
    expect(r[0].debutSecondes).toBe(0);
    expect(r[3].debutSecondes).toBeCloseTo(3, 3);
  });

  it('2.3 plusieurs clips, chacun avec son origine dans le rush', () => {
    const r = projeterMots(
      motsParSeconde(),
      [plan(1, 2, 0, 2), plan(2, 1, 0, 2)],
      [clip(1, 3), clip(2, 12)],
    );
    expect(textes(r)).toEqual(['m12', 'm13', 'm3', 'm4']);
  });

  it('2.4 l’ordre des plans est celui de `ordre`, pas celui du tableau', () => {
    const a = projeterMots(motsParSeconde(), [plan(2, 1, 15, 3), plan(1, 1, 5, 3)], [clip(1, 0)]);
    const b = projeterMots(motsParSeconde(), [plan(1, 1, 5, 3), plan(2, 1, 15, 3)], [clip(1, 0)]);
    expect(textes(a)).toEqual(textes(b));
    expect(textes(a)[0]).toBe('m5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les mots à cheval sur une coupe', () => {
  it('3.1 ⚠️ UN MOT APPARTIENT AU PLAN QUI EN MONTRE LE PLUS', () => {
    const mots: MotSource[] = [{ debutSecondes: 4.5, finSecondes: 5.5, texte: 'coupe' }];
    // La coupe tombe à 5 : le plan 5–8 en montre la moitié — il le garde.
    expect(textes(projeterMots(mots, [plan(1, 1, 5, 3)], [clip(1, 0)]))).toEqual(['coupe']);
    // Le plan 5,8–8 n'en montre plus qu'un cinquième — il ne l'affiche pas.
    expect(projeterMots(mots, [plan(1, 1, 5.3, 3)], [clip(1, 0)])).toEqual([]);
    expect(PART_MOT_RETENUE).toBe(0.5);
  });

  it('3.2 le mot gardé est BORNÉ par la fenêtre, jamais prolongé', () => {
    const mots: MotSource[] = [{ debutSecondes: 4.5, finSecondes: 5.5, texte: 'coupe' }];
    const r = projeterMots(mots, [plan(1, 1, 5, 3)], [clip(1, 0)]);
    expect(r[0].debutSecondes).toBe(0);
    expect(r[0].finSecondes).toBeCloseTo(0.5, 3);
  });

  it('3.3 un éclat de mot trop court ne clignote pas à l’écran', () => {
    const mots: MotSource[] = [{ debutSecondes: 4.99, finSecondes: 5.01, texte: 'x' }];
    expect(projeterMots(mots, [plan(1, 1, 5, 3)], [clip(1, 0)])).toEqual([]);
    expect(DUREE_MOT_MIN_SECONDES).toBeGreaterThan(0);
  });

  it('3.4 ⚠️ LES BORNES FINALES SONT CELLES DU PLAN, pas des candidats', () => {
    // m3e-v4 étend une fenêtre pour garder une phrase entière : les derniers
    // mots DOIVENT apparaître, puisqu'ils sont dans la durée retenue.
    const mots: MotSource[] = [
      { debutSecondes: 9.0, finSecondes: 9.4, texte: 'jusqu’au' },
      { debutSecondes: 9.5, finSecondes: 10.4, texte: 'bout' },
    ];
    // Fenêtre étendue à 11 s : les deux mots tiennent.
    const r = projeterMots(mots, [plan(1, 1, 8, 3)], [clip(1, 0)]);
    expect(textes(r)).toEqual(['jusqu’au', 'bout']);
    expect(r[1].finSecondes).toBeCloseTo(2.4, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Les recouvrements d’A_3d', () => {
  it('4.1 ⚠️ CHAQUE PLAN COMMENCE `i x D` PLUS TÔT', () => {
    const sansD = projeterMots(
      motsParSeconde(), [plan(1, 1, 0, 5), plan(2, 1, 10, 5)], [clip(1, 0)], 0,
    );
    const avecD = projeterMots(
      motsParSeconde(), [plan(1, 1, 0, 5), plan(2, 1, 10, 5)], [clip(1, 0)], 0.5,
    );
    const m10sans = sansD.find((m) => m.texte === 'm10')!;
    const m10avec = avecD.find((m) => m.texte === 'm10')!;
    expect(m10sans.debutSecondes).toBeCloseTo(5, 3);
    expect(m10avec.debutSecondes).toBeCloseTo(4.5, 3);
  });

  it('4.2 trois plans : le décalage s’accumule, il ne se répète pas', () => {
    const r = projeterMots(
      motsParSeconde(),
      [plan(1, 1, 0, 4), plan(2, 1, 8, 4), plan(3, 1, 14, 4)],
      [clip(1, 0)], 0.5,
    );
    // Plan 3 commence à 4 + 4 − 2 x 0,5 = 7 s.
    expect(r.find((m) => m.texte === 'm14')!.debutSecondes).toBeCloseTo(7, 3);
  });

  it('4.3 ⚠️ AUCUNE PAROLE N’EST PERDUE DANS LA ZONE DE TRANSITION', () => {
    /* Le réflexe — faire taire chaque plan dans la moitié de l'autre —
       supprime les mots prononcés entièrement dans cette moitié. Mesuré : le
       mot « sortant » disparaissait purement et simplement. */
    const mots: MotSource[] = [
      { debutSecondes: 4.6, finSecondes: 4.95, texte: 'sortant' },
      { debutSecondes: 10.05, finSecondes: 10.4, texte: 'entrant' },
    ];
    const r = projeterMots(
      mots, [plan(1, 1, 0, 5), plan(2, 1, 10, 5)], [clip(1, 0)], 1.0,
    );
    expect(textes(r)).toContain('sortant');
    expect(textes(r)).toContain('entrant');
  });

  it('4.4 les mots gardent leur timing naturel — la piste unique tranchera', () => {
    const mots: MotSource[] = [
      { debutSecondes: 4.6, finSecondes: 4.95, texte: 'sortant' },
      { debutSecondes: 10.05, finSecondes: 10.4, texte: 'entrant' },
    ];
    const r = projeterMots(
      mots, [plan(1, 1, 0, 5), plan(2, 1, 10, 5)], [clip(1, 0)], 1.0,
    );
    // Plan 1 commence à 0, plan 2 à 5 − 1 = 4.
    expect(r.find((m) => m.texte === 'sortant')!.debutSecondes).toBeCloseTo(4.6, 3);
    expect(r.find((m) => m.texte === 'entrant')!.debutSecondes).toBeCloseTo(4.05, 3);
    // Ils se chevauchent : c'est au segmenteur d'en faire deux blocs
    // successifs, pas au mappeur de jeter de la parole.
    expect(r.find((m) => m.texte === 'entrant')!.debutSecondes)
      .toBeLessThan(r.find((m) => m.texte === 'sortant')!.finSecondes);
  });

  it('4.5 la durée du montage tient compte des recouvrements', () => {
    const plans = [plan(1, 1, 0, 5), plan(2, 1, 0, 5), plan(3, 1, 0, 5)];
    expect(dureeMontageSecondes(plans, 0)).toBe(15);
    expect(dureeMontageSecondes(plans, 0.5)).toBe(14);
    expect(dureeMontageSecondes([], 0.5)).toBe(0);
  });

  it('4.6 aucun mot ne dépasse la fin réelle du montage', () => {
    const plans = [plan(1, 1, 0, 5), plan(2, 1, 10, 5)];
    const fin = dureeMontageSecondes(plans, 0.5);
    for (const m of projeterMots(motsParSeconde(), plans, [clip(1, 0)], 0.5)) {
      expect(m.finSecondes).toBeLessThanOrEqual(fin + 1e-9);
      expect(m.debutSecondes).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le contrat du module', () => {
  it('5.1 il est PUR : ni base, ni disque, ni réseau, ni horloge', () => {
    expect(sansProse(MAPPEUR)).not.toMatch(/supabase|node:fs|fetch\(|new Date\(|Date\.now/);
  });

  it('5.2 il est déterministe : deux appels rendent la même chose', () => {
    const a = projeterMots(motsParSeconde(), [plan(1, 1, 5, 5)], [clip(1, 0)], 0.4);
    const b = projeterMots(motsParSeconde(), [plan(1, 1, 5, 5)], [clip(1, 0)], 0.4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('5.3 il porte sa version : une segmentation qui change devra la changer', () => {
    expect(VERSION_MOTEUR_CAPTIONS).toBe('caption-engine-v1');
  });

  it('5.4 le texte n’est ni réécrit, ni censuré, ni complété', () => {
    const mots: MotSource[] = [
      { debutSecondes: 0, finSecondes: 0.5, texte: 'C’est' },
      { debutSecondes: 0.6, finSecondes: 1.2, texte: 'l’énergie !' },
      { debutSecondes: 1.3, finSecondes: 1.9, texte: '50 %' },
    ];
    const r = projeterMots(mots, [plan(1, 1, 0, 3)], [clip(1, 0)]);
    expect(textes(r)).toEqual(['C’est', 'l’énergie !', '50 %']);
  });

  it('5.5 chaque mot sait de quel plan il vient', () => {
    const r = projeterMots(
      motsParSeconde(), [plan(1, 1, 0, 3), plan(2, 1, 10, 3)], [clip(1, 0)],
    );
    expect(new Set(r.map((m) => m.ordrePlan))).toEqual(new Set([1, 2]));
  });

  it('5.6 il est « source-aware » : le rang du clip décide de l’origine', () => {
    // C'est ce qui le rendra réutilisable le jour du vrai multi-rush, sans
    // le transformer aujourd'hui en autre chose.
    expect(sansProse(MAPPEUR)).toContain('parRang.get(p.rangClip)');
  });
});
