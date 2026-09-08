/**
 * A_7b — LE POOL GLOBAL MULTI-RUSH.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS TIENNENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. QUE LE CHEMIN MONO-RUSH NE BOUGE PAS. C'est la garantie la plus chère
 *      du lot : `planifierMontage` a appris que trois de ses scalaires sont
 *      des attributs de la source, et un seul écart de comportement sur une
 *      source unique invaliderait des plans dont les MP4 sont déjà rendus.
 *   2. QUE LA QUALITÉ RESTE PRIORITAIRE. La diversité de source ne franchit
 *      jamais un palier : un rush médiocre ne remonte pas pour faire varier.
 *   3. QUE RIEN N'EST DEVINÉ. Les plages d'un rush ne sont comparées qu'aux
 *      siennes, chaque segment garde sa géométrie, et un plan qui perd une
 *      provenance est refusé plutôt que rattaché au hasard.
 *   4. QUE TOUT EST DÉTERMINISTE. Aucun `Math.random`, aucune horloge : deux
 *      appels sur la même matière rendent le même montage.
 */
import { describe, it, expect } from 'vitest';

import { planifierMontage, entrelacerSources } from '@/lib/autopilot/analyse/montage';
import {
  construirePoolGlobal, planifierMontageMultiRush, ordonnerAvecDiversiteSource,
  penaliteSourceRecente, penaliteRecenceSource, sourcesDuPlan,
  classerRushesEligibles, validerRushesChoisis, rendreEstPossible, planEstMultiSource,
  maxRushesAutomatique, MAX_RUSHES_MANUEL, SOURCES_RETENUES_MIN,
  CONCURRENCE_PREPARATION, HISTORIQUE_SOURCES_MAX, SUFFIXE_PLAN_MULTI_SOURCE,
  type SourceMontable, type RushEligible,
} from '@/lib/autopilot/analyse/montage-pool';
import { empreinteJeuxSources } from '@/lib/autopilot/analyse/montage-source';
import { normaliserObjectif, type ObjectifCommunication, type ObjectifPartiel }
  from '@/lib/autopilot/analyse/objectif-communication';
import {
  assemblerSignaux, type SignauxFenetre, type SignauxVision,
} from '@/lib/autopilot/analyse/signaux-contrat';
import type { ClipMaterialise } from '@/lib/autopilot/analyse/clip-contrat';

// ───────────────────────────────────────────────────────────────────────────
// Les fixtures
// ───────────────────────────────────────────────────────────────────────────

const GEO = { largeur: 1920, hauteur: 1080, fps: 30 };
const GEO_VERTICALE = { largeur: 1080, hauteur: 1920, fps: 25 };
const DUREE_RUSH = 120;

const UUID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const RUSH = (n: number) => `${String(n).repeat(8)}-2222-4222-8222-222222222222`;

function vision(over: Partial<Omit<SignauxVision, 'source'>> = {}): SignauxVision {
  return {
    source: 'vision',
    personnes: 'une', echellePlan: 'plan_moyen', expression: 'neutre',
    objetMisEnAvant: 'non', mainsEnAction: 'non', marqueVisible: 'non',
    texteALEcran: 'non', nettete: 0.8,
    ...over,
  };
}

function signaux(
  v: Partial<Omit<SignauxVision, 'source'>> = {},
  parole: SignauxFenetre['parole'] = { source: 'transcription', etat: 'absente', densite: 0 },
): SignauxFenetre {
  return assemblerSignaux(vision(v), parole);
}

function clip(
  rang: number, debut: number, fin: number,
  scoreMontage: number | null, s: SignauxFenetre | null = signaux(),
): ClipMaterialise {
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
    scoreMontage,
    signaux: s,
  };
}

function source(
  n: number, clips: ClipMaterialise[],
  over: Partial<SourceMontable> = {},
): SourceMontable {
  return {
    rushId: RUSH(n),
    clipSetId: UUID(n),
    clipSetVersion: 1,
    geometrie: GEO,
    dureeRushSecondes: DUREE_RUSH,
    clips,
    ...over,
  };
}

const objectif = (over: ObjectifPartiel): ObjectifCommunication => normaliserObjectif(over);

const POOL_DEMANDE = { format: '9:16' as const, dureeCibleSecondes: 16 };

/** Les `clipSetId` réellement montés, dans l'ordre du montage. */
const sourcesMontees = (r: ReturnType<typeof planifierMontageMultiRush>) =>
  (r.resultat?.segments ?? []).map((s) => s.source.clipSetId);

// ═══════════════════════════════════════════════════════════════════════════
// 1. LE CHEMIN MONO-RUSH NE BOUGE PAS
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 1. le mono-rush est intact', () => {
  const CLIPS = () => [
    clip(1, 2, 10, 90), clip(2, 20, 28, 80), clip(3, 40, 48, 70),
    clip(4, 60, 66, 60), clip(5, 80, 84, 50),
  ];
  const DEMANDE = {
    format: '9:16' as const, dureeCibleSecondes: 16,
    geometrie: GEO, dureeRushSecondes: DUREE_RUSH,
  };

  it('1.1 sans `contextes`, le plan est celui d avant le lot', () => {
    const r = planifierMontage({ clips: CLIPS(), ...DEMANDE });
    expect(r.resultat).not.toBeNull();
    expect(r.resultat?.plans.map((p) => p.rangClip)).toEqual([1, 2]);
    expect(r.resultat?.dureeTotaleSecondes).toBe(16);
    // ⚠️ L'ORDRE RESTE CHRONOLOGIQUE : `entrelacerSources` ne s'applique pas.
    expect(r.resultat?.usage.ordreFinal).toBe('chronologique');
  });

  it('1.2 aucune clé multi-source n apparaît dans le relevé', () => {
    const r = planifierMontage({ clips: CLIPS(), ...DEMANDE });
    /* ⚠️ SANS CELA, « RIEN N'A CHANGÉ » DEVIENDRAIT INVÉRIFIABLE : le relevé
       d'un plan historique doit rester identique jusque dans ses clés. */
    expect(r.resultat?.usage.sources).toBeUndefined();
    expect(r.resultat?.usage.ordreFinalMultiSource).toBeUndefined();
    expect(r.resultat?.usage.plusPetitTrouSecondes).not.toBeNull();
  });

  it('1.3 aucun segment ne reçoit de provenance', () => {
    /* Une source implicite n'en déclare pas : le `jsonb` d'un plan mono-rush
       reste identique, donc son empreinte, donc ses rendus restent trouvables. */
    const r = planifierMontage({ clips: CLIPS(), ...DEMANDE });
    for (const p of r.resultat?.plans ?? []) expect(p.source).toBeUndefined();
  });

  it('1.4 le plafond de couverture et le relevé sont inchangés', () => {
    const r = planifierMontage({ clips: CLIPS(), ...DEMANDE });
    expect(r.resultat?.usage.couvertureSecondes).toBe(16);
    expect(r.resultat?.usage.couvertureMaxSecondes).toBe(72);
    expect(r.resultat?.usage.couverturePart).toBe(0.133);
  });

  it('1.5 une géométrie illisible refuse toujours le plan', () => {
    const r = planifierMontage({
      clips: CLIPS(), ...DEMANDE, geometrie: { largeur: 0, hauteur: 0, fps: 30 },
    });
    expect(r.motif).toBe('geometrie_inconnue');
  });

  it('1.6 les moments trop proches sont toujours écartés', () => {
    const r = planifierMontage({
      clips: [clip(1, 2, 10, 90), clip(2, 10.2, 14, 80)], ...DEMANDE,
    });
    expect(r.resultat?.plans.map((p) => p.rangClip)).toEqual([1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE POOL
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 2. le pool global', () => {
  it('2.1 trois rushes de 3/3/2 clips donnent 8 candidats avec provenance', () => {
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 90), clip(2, 10, 15, 70), clip(3, 20, 25, 50)]),
      source(2, [clip(1, 0, 5, 85), clip(2, 10, 15, 65), clip(3, 20, 25, 45)]),
      source(3, [clip(1, 0, 5, 80), clip(2, 10, 15, 60)]),
    ]);
    expect(pool.candidats).toHaveLength(8);
    expect(pool.sources).toHaveLength(3);
    for (const c of pool.candidats) {
      expect(c.rushId).toMatch(/^\d{8}-2222/);
      expect(c.clipSetId).toMatch(/^\d{8}-1111/);
      expect(c.clipSetVersion).toBe(1);
      expect(c.rangDansJeu).toBeGreaterThanOrEqual(1);
    }
  });

  it('2.2 le rang 1 de A et le rang 1 de B sont DEUX candidats', () => {
    /* ⚠️ LE RANG N'EST UNIQUE QU'À L'INTÉRIEUR D'UN JEU. `politiqueDePlan`
       indexe ses notes par rang : deux rangs 1 lui en feraient oublier un. */
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 90)]), source(2, [clip(1, 0, 5, 85)]),
    ]);
    expect(pool.candidats).toHaveLength(2);
    expect(pool.candidats.map((c) => c.rangGlobal)).toEqual([1, 2]);
    expect(pool.candidats.map((c) => c.rangDansJeu)).toEqual([1, 1]);
    expect(new Set(pool.candidats.map((c) => c.clipSetId)).size).toBe(2);
  });

  it('2.3 le pool est ordonné par QUALITÉ, pas par source', () => {
    /* Concaténer les jeux mettrait le pire clip de A devant le meilleur de B. */
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 90), clip(2, 10, 15, 40)]),
      source(2, [clip(1, 0, 5, 85), clip(2, 10, 15, 60)]),
    ]);
    expect(pool.candidats.map((c) => c.scoreMontage)).toEqual([90, 85, 60, 40]);
  });

  it('2.4 une source sans clip n entre pas dans le pool', () => {
    /* Elle recevrait une ligne `plan_sources`, donc une empreinte décrivant
       une matière que le montage ne montre pas. */
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 90)]), source(2, []), source(3, [clip(1, 0, 5, 80)]),
    ]);
    expect(pool.sources.map((s) => s.clipSetId)).toEqual([UUID(1), UUID(3)]);
    expect(pool.contextes).toHaveLength(2);
  });

  it('2.5 un clip sans qualité passe derrière ceux qui en ont une', () => {
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, null)]), source(2, [clip(1, 0, 5, 30)]),
    ]);
    expect(pool.candidats[0].scoreMontage).toBe(30);
    expect(pool.candidats[1].palierQualite).toBeNull();
  });

  it('2.6 chaque source garde SA géométrie', () => {
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 90)]),
      source(2, [clip(1, 0, 5, 80)], { geometrie: GEO_VERTICALE }),
    ]);
    expect(pool.contextes[0].geometrie).toEqual(GEO);
    expect(pool.contextes[1].geometrie).toEqual(GEO_VERTICALE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LA DIVERSITÉ DE SOURCE
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 3. la diversité ne dégrade jamais', () => {
  it('3.1 la pénalité est une fonction pure, sans base ni horloge', () => {
    expect(penaliteSourceRecente('A', [])).toBe(0);
    expect(penaliteSourceRecente('A', ['A'])).toBe(100);
    expect(penaliteSourceRecente('A', ['A', 'A', 'B'])).toBe(200);
    expect(penaliteSourceRecente('A', ['B', 'C'])).toBe(0);
  });

  it('3.2 la récence inter-vidéos est DÉGRESSIVE, jamais éliminatoire', () => {
    const h = [['A'], ['B'], ['C']];
    expect(penaliteRecenceSource('A', h)).toBe(60);
    expect(penaliteRecenceSource('B', h)).toBe(40);
    expect(penaliteRecenceSource('C', h)).toBe(20);
    /* ⚠️ ZÉRO AU-DELÀ : un compte à deux rushes doit pouvoir continuer à
       produire. Une pénalité plate rendrait tout inutilisable dès la 2e vidéo. */
    expect(penaliteRecenceSource('D', h)).toBe(0);
  });

  it('3.3 un rush MÉDIOCRE ne remonte pas pour faire varier', () => {
    /* Exigence n°13 : la diversité ne franchit pas un palier de qualité.
       95 et 92 sont dans le palier 4 ; 20 est dans le palier 1. */
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 95), clip(2, 10, 15, 92)]),
      source(2, [clip(1, 0, 5, 20)]),
    ]);
    const ordre = ordonnerAvecDiversiteSource(
      pool.candidats.map((c) => c.rangGlobal), pool.candidats,
    );
    expect(ordre).toEqual([1, 2, 3]);
    expect(pool.candidats[2].scoreMontage).toBe(20);
  });

  it('3.4 à qualité COMPARABLE, la source la moins servie passe devant', () => {
    /* 91/90/90 sont dans le même palier : la diversité départage. */
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 91), clip(2, 10, 15, 90)]),
      source(2, [clip(1, 0, 5, 90)]),
    ]);
    const ordre = ordonnerAvecDiversiteSource(
      pool.candidats.map((c) => c.rangGlobal), pool.candidats,
    );
    const parRang = new Map(pool.candidats.map((c) => [c.rangGlobal, c.clipSetId]));
    expect(ordre.map((r) => parRang.get(r))).toEqual([UUID(1), UUID(2), UUID(1)]);
  });

  it('3.5 aucun quota : une source dominante sort plusieurs fois', () => {
    /* Exigence n°20 : « max 2 clips par rush » forcerait un clip inférieur. */
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 95), clip(2, 10, 15, 94), clip(3, 20, 25, 93)]),
      source(2, [clip(1, 0, 5, 30)]),
    ]);
    const ordre = ordonnerAvecDiversiteSource(
      pool.candidats.map((c) => c.rangGlobal), pool.candidats,
    );
    const parRang = new Map(pool.candidats.map((c) => [c.rangGlobal, c.clipSetId]));
    expect(ordre.slice(0, 3).map((r) => parRang.get(r))).toEqual([UUID(1), UUID(1), UUID(1)]);
  });

  it('3.6 un rush vu récemment cède le pas à qualité comparable', () => {
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 91)]), source(2, [clip(1, 0, 5, 90)]),
    ]);
    const ordre = ordonnerAvecDiversiteSource(
      pool.candidats.map((c) => c.rangGlobal), pool.candidats,
      [[UUID(1)], [UUID(1)]],
    );
    const parRang = new Map(pool.candidats.map((c) => [c.rangGlobal, c.clipSetId]));
    expect(ordre.map((r) => parRang.get(r))).toEqual([UUID(2), UUID(1)]);
  });

  it('3.7 le réordonnancement est déterministe', () => {
    const pool = construirePoolGlobal([
      source(1, [clip(1, 0, 5, 91), clip(2, 10, 15, 90)]),
      source(2, [clip(1, 0, 5, 90), clip(2, 10, 15, 88)]),
      source(3, [clip(1, 0, 5, 89)]),
    ]);
    const base = pool.candidats.map((c) => c.rangGlobal);
    const a = ordonnerAvecDiversiteSource(base, pool.candidats);
    const b = ordonnerAvecDiversiteSource(base, pool.candidats);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. L'ORDRE DU MONTAGE
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 4. l ordre entre plusieurs sources', () => {
  it('4.1 chaque source garde SA chronologie', () => {
    const ordre = entrelacerSources([
      { cle: 'A', debut: 30 }, { cle: 'A', debut: 5 }, { cle: 'B', debut: 10 },
    ]);
    /* A doit sortir 5 puis 30 — un rush montré à rebours de lui-même se voit. */
    const cles = ordre.map((i) => ['A', 'A', 'B'][i]);
    expect(cles).toEqual(['A', 'B', 'A']);
    expect(ordre[0]).toBe(1);
    expect(ordre[2]).toBe(0);
  });

  it('4.2 les sources ALTERNENT plutôt que de sortir en blocs', () => {
    const ordre = entrelacerSources([
      { cle: 'A', debut: 0 }, { cle: 'A', debut: 10 },
      { cle: 'B', debut: 0 }, { cle: 'B', debut: 10 },
    ]);
    const cles = ordre.map((i) => ['A', 'A', 'B', 'B'][i]);
    expect(cles).toEqual(['A', 'B', 'A', 'B']);
  });

  it('4.3 une source seule à avoir de la matière reprend la main', () => {
    /* ⚠️ « AUTRE QUE LA PRÉCÉDENTE » N'EST PAS UNE INTERDICTION : refuser
       reviendrait à jeter des segments retenus pour une règle de forme. */
    const ordre = entrelacerSources([
      { cle: 'A', debut: 0 }, { cle: 'A', debut: 10 }, { cle: 'A', debut: 20 },
      { cle: 'B', debut: 0 },
    ]);
    const cles = ordre.map((i) => ['A', 'A', 'A', 'B'][i]);
    expect(cles).toEqual(['A', 'B', 'A', 'A']);
  });

  it('4.4 une seule source rend l ordre chronologique pur', () => {
    const ordre = entrelacerSources([
      { cle: 'A', debut: 30 }, { cle: 'A', debut: 5 }, { cle: 'A', debut: 20 },
    ]);
    expect(ordre).toEqual([1, 2, 0]);
  });

  it('4.5 il est déterministe', () => {
    const seg = [
      { cle: 'A', debut: 0 }, { cle: 'B', debut: 0 },
      { cle: 'C', debut: 0 }, { cle: 'A', debut: 9 },
    ];
    expect(entrelacerSources(seg)).toEqual(entrelacerSources(seg));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LE PLAN MULTI-RUSH
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 5. le plan', () => {
  it('5.1 deux sources de qualité comparable produisent un plan multi', () => {
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 8, 90), clip(2, 20, 28, 86)]),
        source(2, [clip(1, 0, 8, 88), clip(2, 20, 28, 84)]),
      ],
      ...POOL_DEMANDE,
    });
    expect(r.motif).toBeNull();
    expect(new Set(sourcesMontees(r)).size).toBe(2);
  });

  it('5.2 chaque segment porte sa provenance ET sa plage SOURCE', () => {
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 4, 12, 90)]), source(2, [clip(1, 30, 38, 88)]),
      ],
      ...POOL_DEMANDE,
    });
    const s = r.resultat?.segments ?? [];
    expect(s).toHaveLength(2);
    for (const seg of s) {
      expect(seg.source.rangClip).toBe(1);
      /* ⚠️ LA PLAGE SOURCE EST DANS LE RUSH, la plage montage dans le film :
         deux référentiels, jamais mélangés. */
      expect(seg.source.finSourceSecondes - seg.source.debutSourceSecondes)
        .toBeCloseTo(seg.dureeRetenueSecondes, 3);
    }
    const a = s.find((x) => x.source.clipSetId === UUID(1));
    expect(a?.source.debutSourceSecondes).toBe(4);
    const b = s.find((x) => x.source.clipSetId === UUID(2));
    expect(b?.source.debutSourceSecondes).toBe(30);
    /* Les deux commencent à des instants MONTAGE différents. */
    expect(s.map((x) => x.debutTimelineSecondes)).toEqual([0, 8]);
  });

  it('5.3 « 15 s dans A » et « 15 s dans B » ne se recouvrent pas', () => {
    /* ⚠️ SANS ÉTAT PAR SOURCE, le second serait écarté comme la suite du
       premier, et le montage perdrait en silence tout ce qui vient de B. */
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 15, 23, 90)]), source(2, [clip(1, 15, 23, 88)])],
      ...POOL_DEMANDE,
    });
    expect(r.resultat?.segments).toHaveLength(2);
    expect(new Set(sourcesMontees(r)).size).toBe(2);
  });

  it('5.4 chaque segment garde la géométrie DE SON rush', () => {
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 8, 90)]),
        source(2, [clip(1, 0, 8, 88)], { geometrie: GEO_VERTICALE }),
      ],
      ...POOL_DEMANDE,
    });
    const s = r.resultat?.segments ?? [];
    const a = s.find((x) => x.source.clipSetId === UUID(1));
    const b = s.find((x) => x.source.clipSetId === UUID(2));
    expect([a?.largeurSource, a?.hauteurSource]).toEqual([1920, 1080]);
    expect([b?.largeurSource, b?.hauteurSource]).toEqual([1080, 1920]);
  });

  it('5.5 le plafond de couverture est celui DE CHAQUE rush', () => {
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 5, 90)], { dureeRushSecondes: 10 }),
        source(2, [clip(1, 0, 8, 88)], { dureeRushSecondes: 200 }),
      ],
      ...POOL_DEMANDE,
    });
    /* A ne peut montrer que 6 s de ses 10, et ses 5 s y tiennent ; B, lui,
       n'est pas puni par le plafond d'un rush qui n'est pas le sien. */
    expect(r.motif).toBeNull();
    const detail = (r.resultat?.usage.sources ?? []) as { cle: string; couvertureMaxSecondes: number }[];
    expect(detail.find((d) => d.cle === UUID(1))?.couvertureMaxSecondes).toBe(6);
    expect(detail.find((d) => d.cle === UUID(2))?.couvertureMaxSecondes).toBe(120);
  });

  it('5.6 la durée cible reste la contrainte — plus de rushes ≠ plus long', () => {
    const quatre = [1, 2, 3, 4].map((n) =>
      source(n, [clip(1, 0, 8, 92 - n), clip(2, 20, 28, 88 - n)]));
    const r = planifierMontageMultiRush({ sources: quatre, ...POOL_DEMANDE });
    expect(r.resultat?.dureeTotaleSecondes).toBe(16);
  });

  it('5.7 un pool de quatre sources est stable', () => {
    const quatre = [1, 2, 3, 4].map((n) => source(n, [clip(1, 0, 8, 92 - n)]));
    const a = planifierMontageMultiRush({ sources: quatre, ...POOL_DEMANDE });
    const b = planifierMontageMultiRush({ sources: quatre, ...POOL_DEMANDE });
    expect(sourcesMontees(a)).toEqual(sourcesMontees(b));
    expect(a.resultat?.empreinteSources).toBe(b.resultat?.empreinteSources);
  });

  it('5.8 une seule source est REFUSÉE, pas maquillée en multi', () => {
    /* ⚠️ Lui donner l'identité multi-rush la ferait basculer sous l'index
       d'empreinte, et ses rendus déjà produits deviendraient introuvables. */
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 0, 8, 90)])], ...POOL_DEMANDE,
    });
    expect(r.resultat).toBeNull();
    expect(r.motif).toBe('sources_insuffisantes');
  });

  it('5.9 deux sources dont une seule est retenue retombent sur le mono', () => {
    /* B est dans un palier très inférieur : le remplissage ne l'atteint pas. */
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 9, 95), clip(2, 20, 29, 94)]),
        source(2, [clip(1, 0, 9, 10)]),
      ],
      ...POOL_DEMANDE,
    });
    expect(r.resultat).toBeNull();
    expect(r.motif).toBe('source_unique_retenue');
  });

  it('5.10 le marqueur multi-source entre dans `algorithme_plan`', () => {
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 0, 8, 90)]), source(2, [clip(1, 0, 8, 88)])],
      ...POOL_DEMANDE,
    });
    /* Deux politiques différentes ne doivent pas porter le même identifiant :
       `lirePlanIdentique` rendrait un jour l'un pour l'autre. */
    expect(r.resultat?.algorithmePlan.endsWith(SUFFIXE_PLAN_MULTI_SOURCE)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. L'OBJECTIF
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 6. l objectif s applique au pool global', () => {
  const FOULE = signaux({ personnes: 'foule' });
  const SEULE = signaux({ personnes: 'une', echellePlan: 'gros_plan' },
    { source: 'transcription', etat: 'presente', densite: 0.9 });

  it('6.1 le scoring n est pas réécrit : la politique vient d objectif-score', () => {
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 8, 90, FOULE), clip(2, 20, 28, 86, FOULE)]),
        source(2, [clip(1, 0, 8, 88, SEULE), clip(2, 20, 28, 84, SEULE)]),
      ],
      ...POOL_DEMANDE,
      objectif: objectif({ type: 'evenement' }),
    });
    expect(r.resultat?.politique.notes).toBeDefined();
    expect(Object.keys(r.resultat?.politique.notes ?? {})).toHaveLength(4);
  });

  it('6.2 sans objectif, le pool reste ordonné par qualité', () => {
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 8, 90, FOULE)]), source(2, [clip(1, 0, 8, 88, SEULE)]),
      ],
      ...POOL_DEMANDE,
    });
    expect(r.resultat?.politique.objectiveAware).toBe(false);
    expect(r.resultat?.pool.candidats.map((c) => c.scoreMontage)).toEqual([90, 88]);
  });

  it('6.3 l objectif ne franchit jamais un palier de qualité', () => {
    /* Le clip « événement » est très mauvais : aucun objectif ne le sauve. */
    const r = planifierMontageMultiRush({
      sources: [
        source(1, [clip(1, 0, 9, 95, SEULE), clip(2, 20, 29, 94, SEULE)]),
        source(2, [clip(1, 0, 9, 15, FOULE)]),
      ],
      ...POOL_DEMANDE,
      objectif: objectif({ type: 'evenement' }),
    });
    /* Une seule source survit : le lot refuse plutôt que de forcer la seconde. */
    expect(r.motif).toBe('source_unique_retenue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. LES SOURCES DU PLAN
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 7. les sources persistées', () => {
  const seg = (cle: string, rang: number) => ({
    ordre: rang, rangClip: rang, bucket: 'videos', cle: 'k',
    entreeSecondes: 0, dureeRetenueSecondes: 2, debutTimelineSecondes: 0,
    raccourci: false, recadrage: null, strategieRecadrage: 'aucune',
    largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe' as const,
    source: {
      rushId: RUSH(1), clipSetId: cle, clipSetVersion: 1,
      rangClip: rang, debutSourceSecondes: 0, finSourceSecondes: 2,
    },
  });

  it('7.1 A1,B1,A2,C1 donne EXACTEMENT A,B,C', () => {
    /* Une source citée deux fois reste UNE source : l'empreinte décrit la
       matière employée, pas le découpage. */
    const sources = sourcesDuPlan([
      seg(UUID(1), 1), seg(UUID(2), 1), seg(UUID(1), 2), seg(UUID(3), 1),
    ] as never);
    expect(sources.map((s) => s.clipSetId)).toEqual([UUID(1), UUID(2), UUID(3)]);
  });

  it('7.2 l ordre est celui de PREMIÈRE APPARITION', () => {
    const sources = sourcesDuPlan([seg(UUID(2), 1), seg(UUID(1), 1)] as never);
    expect(sources.map((s) => s.clipSetId)).toEqual([UUID(2), UUID(1)]);
  });

  it('7.3 l empreinte est celle d A_7a, jamais un second algorithme', () => {
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 0, 8, 90)]), source(2, [clip(1, 0, 8, 88)])],
      ...POOL_DEMANDE,
    });
    expect(r.resultat?.empreinteSources)
      .toBe(empreinteJeuxSources(r.resultat?.sources ?? []));
  });

  it('7.4 A,B et B,A ont deux empreintes différentes', () => {
    const ab = empreinteJeuxSources([
      { clipSetId: UUID(1), clipSetVersion: 1 }, { clipSetId: UUID(2), clipSetVersion: 1 },
    ]);
    const ba = empreinteJeuxSources([
      { clipSetId: UUID(2), clipSetVersion: 1 }, { clipSetId: UUID(1), clipSetVersion: 1 },
    ]);
    expect(ab).not.toBe(ba);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LE CHOIX DES RUSHES
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 8. le mode automatique', () => {
  const eligible = (n: number, over: Partial<RushEligible> = {}): RushEligible => ({
    rushId: RUSH(n), clipSetId: UUID(n), ordreBanque: n, pret: true, ...over,
  });

  it('8.1 le plafond suit la durée demandée', () => {
    expect(maxRushesAutomatique(15)).toBe(3);
    expect(maxRushesAutomatique(30)).toBe(4);
    expect(maxRushesAutomatique(60)).toBe(5);
  });

  it('8.2 un rush PRÊT passe devant un rush brut', () => {
    /* Le monter ne coûte qu'un encodage ; un rush brut appelle des
       fournisseurs payants. */
    const c = classerRushesEligibles(
      [eligible(1, { pret: false }), eligible(2, { pret: true })],
      { graine: 'g', max: 2 },
    );
    expect(c.map((r) => r.rushId)).toEqual([RUSH(2), RUSH(1)]);
  });

  it('8.3 la sélection est DÉTERMINISTE — aucun tirage au sort', () => {
    const banque = [1, 2, 3, 4, 5].map((n) => eligible(n));
    const a = classerRushesEligibles(banque, { graine: 'u|slot|16', max: 3 });
    const b = classerRushesEligibles(banque, { graine: 'u|slot|16', max: 3 });
    expect(a.map((r) => r.rushId)).toEqual(b.map((r) => r.rushId));
  });

  it('8.4 un rush vu récemment recule, sans être exclu', () => {
    const banque = [1, 2].map((n) => eligible(n));
    const c = classerRushesEligibles(banque, {
      graine: 'g', max: 2, historique: [[UUID(1)]],
    });
    expect(c.map((r) => r.rushId)).toEqual([RUSH(2), RUSH(1)]);
    expect(c).toHaveLength(2);
  });

  it('8.5 le plafond tronque la liste', () => {
    const banque = [1, 2, 3, 4, 5].map((n) => eligible(n));
    expect(classerRushesEligibles(banque, { graine: 'g', max: 3 })).toHaveLength(3);
  });

  it('8.6 la concurrence de préparation est bornée', () => {
    /* Huit analyses lancées d'un coup exposent le compte à une limite de
       débit et transforment un cycle en cascade d'échecs. */
    expect(CONCURRENCE_PREPARATION).toBeLessThanOrEqual(3);
    expect(CONCURRENCE_PREPARATION).toBeGreaterThanOrEqual(1);
    expect(HISTORIQUE_SOURCES_MAX).toBe(10);
  });
});

describe('A_7b — 9. le mode manuel', () => {
  const POSSEDES = new Set([RUSH(1), RUSH(2), RUSH(3)]);

  it('9.1 les doublons sont réduits, l ordre de saisie conservé', () => {
    const v = validerRushesChoisis([RUSH(1), RUSH(1), RUSH(2)], POSSEDES);
    expect(v.rushIds).toEqual([RUSH(1), RUSH(2)]);
    expect(v.motif).toBeNull();
  });

  it('9.2 un rush qui n appartient pas au compte est refusé', () => {
    const v = validerRushesChoisis([RUSH(1), RUSH(9)], POSSEDES);
    expect(v.motif).toBe('rush_inconnu');
    expect(v.rushIds).toEqual([]);
  });

  it('9.3 au-delà du plafond, une erreur claire', () => {
    const trop = Array.from({ length: MAX_RUSHES_MANUEL + 1 }, (_, i) => RUSH(i + 1));
    expect(validerRushesChoisis(trop, new Set(trop)).motif).toBe('trop_de_rushes');
  });

  it('9.4 une liste vide est refusée', () => {
    expect(validerRushesChoisis([], POSSEDES).motif).toBe('liste_vide');
  });

  it('9.5 le montage ne sort jamais de la liste', () => {
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 0, 8, 90)]), source(2, [clip(1, 0, 8, 88)])],
      ...POOL_DEMANDE,
    });
    expect(new Set(sourcesMontees(r))).toEqual(new Set([UUID(1), UUID(2)]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. LA GARDE DE RENDU
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 10. le renderer refuse plutôt que de mentir', () => {
  it('10.1 un plan multi-source est reconnu', () => {
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 0, 8, 90)]), source(2, [clip(1, 0, 8, 88)])],
      ...POOL_DEMANDE,
    });
    expect(planEstMultiSource(r.resultat?.segments ?? [])).toBe(true);
  });

  it('10.2 le rendu est REFUSÉ, jamais replié sur la première source', () => {
    /* ⚠️ Servi d'un plan multi-rush, M3-H monterait tout depuis le premier
       fichier : la durée serait juste, la vidéo sortirait, et montrerait autre
       chose que ce qui a été décidé. Un plan non rendu se voit ; une vidéo
       fausse et facturée, non. */
    const r = planifierMontageMultiRush({
      sources: [source(1, [clip(1, 0, 8, 90)]), source(2, [clip(1, 0, 8, 88)])],
      ...POOL_DEMANDE,
    });
    const garde = rendreEstPossible(r.resultat?.segments ?? []);
    expect(garde.possible).toBe(false);
    expect(garde.motif).toBe('multi_rush_renderer_not_ready');
  });

  it('10.3 un plan mono-rush historique reste rendable', () => {
    const mono = planifierMontage({
      clips: [clip(1, 0, 8, 90), clip(2, 20, 28, 80)],
      format: '9:16', dureeCibleSecondes: 16, geometrie: GEO,
      dureeRushSecondes: DUREE_RUSH,
    });
    const garde = rendreEstPossible(mono.resultat?.plans ?? []);
    expect(garde.possible).toBe(true);
    expect(garde.motif).toBeNull();
  });

  it('10.4 un plan à une seule source EXPLICITE reste rendable', () => {
    const pool = construirePoolGlobal([source(1, [clip(1, 0, 8, 90)])]);
    const r = planifierMontage({
      clips: pool.clips, format: '9:16', dureeCibleSecondes: 16,
      geometrie: pool.contextes[0].geometrie, contextes: pool.contextes,
    });
    expect(planEstMultiSource(r.resultat?.plans ?? [])).toBe(false);
    expect(rendreEstPossible(r.resultat?.plans ?? []).possible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. LES CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7b — 11. les bornes tiennent', () => {
  it('11.1 deux sources minimum pour un vrai multi-rush', () => {
    expect(SOURCES_RETENUES_MIN).toBe(2);
  });

  it('11.2 le plafond manuel reste très en deçà de la borne DB', () => {
    /* `ordinal <= 63` est une limite MÉCANIQUE ; celle-ci est un jugement
       produit, et les confondre laisserait la base décider d'éditorial. */
    expect(MAX_RUSHES_MANUEL).toBe(8);
    expect(MAX_RUSHES_MANUEL).toBeLessThan(64);
  });

  it('11.3 le plafond automatique ne dépasse jamais le manuel', () => {
    for (const d of [5, 15, 25, 45, 90, 120]) {
      expect(maxRushesAutomatique(d)).toBeLessThanOrEqual(MAX_RUSHES_MANUEL);
      expect(maxRushesAutomatique(d)).toBeGreaterThanOrEqual(SOURCES_RETENUES_MIN);
    }
  });
});
