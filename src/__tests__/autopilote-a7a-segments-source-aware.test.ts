/**
 * A_7a — CHAQUE SEGMENT SAIT DE QUEL RUSH IL VIENT.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS TIENNENT
 * ---------------------------------------------------------------------------
 *
 * Deux garanties, et elles tirent en sens opposé — c'est ce qui rend le lot
 * risqué :
 *
 *   1. UN PLAN MULTI-SOURCE EST REPRÉSENTABLE, et sa provenance est
 *      vérifiable plutôt que devinée.
 *   2. UN PLAN HISTORIQUE NE BOUGE PAS D'UN OCTET. Ni son `jsonb`, ni son
 *      identité, ni son empreinte — donc ni ses rendus déjà réussis.
 *
 * La seconde est la plus fragile : elle se casse en ajoutant un champ « pour
 * plus tard », en donnant une empreinte à un plan qui n'en avait pas, ou en
 * comptant deux fois une source que la migration A_7M a backfillée. Chacun de
 * ces trois accidents a son test.
 */
import { describe, it, expect } from 'vitest';
import {
  sourceValide, sourceCoherente, sourceDuClip, sourceDuSegment,
  normaliserPlanSourceAware, jeuxSourcesDesSegments, fusionnerJeuxSources,
  jeuxSourcesCanoniques, empreinteJeuxSources, empreinteSegments,
  LONGUEUR_EMPREINTE_SOURCES,
  type SourceSegment, type SegmentSourceAware, type ContexteJeuClips,
} from '@/lib/autopilot/analyse/montage-source';
import { planValide, type PlanMontage } from '@/lib/autopilot/analyse/montage-contrat';

const RUSH_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const RUSH_B = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const JEU_A = 'a2a2a2a2-1111-4111-8111-aaaaaaaaaaaa';
const JEU_B = 'b2b2b2b2-1111-4111-8111-bbbbbbbbbbbb';

const source = (p: Partial<SourceSegment> = {}): SourceSegment => ({
  rushId: RUSH_A, clipSetId: JEU_A, clipSetVersion: 1, rangClip: 1,
  debutSourceSecondes: 10, finSourceSecondes: 13, ...p,
});

const segment = (p: Partial<PlanMontage> = {}): PlanMontage => ({
  ordre: 1, rangClip: 1, bucket: 'videos', cle: 'u/autopilote/clips/x/rang-01.mp4',
  entreeSecondes: 0, dureeRetenueSecondes: 3, debutTimelineSecondes: 0,
  raccourci: false, recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 },
  strategieRecadrage: 'aucun', largeurSource: 1080, hauteurSource: 1920,
  raccordEntrant: 'coupe', ...p,
});

const avecSource = (p: Partial<PlanMontage>, s: Partial<SourceSegment>): SegmentSourceAware =>
  ({ ...segment(p), source: source(s) });

const contexte = (p: Partial<ContexteJeuClips> = {}): ContexteJeuClips => ({
  clipSetId: JEU_A, clipSetVersion: 1, rushId: RUSH_A,
  clips: [
    { rang: 1, debutSecondes: 10, finSecondes: 15 },
    { rang: 2, debutSecondes: 40, finSecondes: 44 },
  ],
  ...p,
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — la provenance est complète ou refusée', () => {
  it('accepte une provenance entière', () => {
    expect(sourceValide(source())).toBe(true);
  });

  it('refuse un rushId sans clipSetId — le demi-contrat', () => {
    /* ⚠️ LE CAS QUE LE LOT EXISTE POUR FERMER. Un segment portant la moitié
       de sa provenance a l'air renseigné : personne n'ira chercher le
       contexte pour le compléter, et le rush annoncé sera cru. */
    const { clipSetId, ...ampute } = source();
    expect(sourceValide(ampute)).toBe(false);
  });

  it('refuse une version de jeu absente, nulle ou fractionnaire', () => {
    for (const v of [undefined, 0, -1, 1.5, '2']) {
      expect(sourceValide({ ...source(), clipSetVersion: v })).toBe(false);
    }
  });

  it('refuse un rang de clip qui n’en est pas un', () => {
    for (const r of [undefined, 0, -3, 2.5]) {
      expect(sourceValide({ ...source(), rangClip: r })).toBe(false);
    }
  });

  it('refuse une plage source vide ou inversée', () => {
    expect(sourceValide(source({ debutSourceSecondes: 12, finSourceSecondes: 12 })))
      .toBe(false);
    expect(sourceValide(source({ debutSourceSecondes: 12, finSourceSecondes: 9 })))
      .toBe(false);
    expect(sourceValide(source({ debutSourceSecondes: -1, finSourceSecondes: 4 })))
      .toBe(false);
  });

  it('refuse un identifiant qui n’est pas un UUID', () => {
    expect(sourceValide(source({ clipSetId: '../autre' }))).toBe(false);
    expect(sourceValide(source({ rushId: '' }))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — une provenance ne peut pas se contredire', () => {
  it('refuse le rush A quand le jeu appartient au rush B', () => {
    /* ⚠️ LE SEUL CONTROLE QUE LA BASE NE FAIT PAS. A_7M garantit que le jeu
       appartient au bon COMPTE ; rien en base ne dit que le `rushId` recopié
       dans le segment est celui de son jeu. Sans ce refus, le montage rendrait
       les bonnes bornes sur le mauvais fichier, sans lever d'erreur. */
    expect(sourceCoherente(source({ rushId: RUSH_A }), { rushId: RUSH_B })).toBe(false);
  });

  it('accepte quand les deux concordent', () => {
    expect(sourceCoherente(source({ rushId: RUSH_A }), { rushId: RUSH_A })).toBe(true);
  });

  it('ne prétend rien quand la lignée est inconnue', () => {
    // Indécidable n'est pas faux : affirmer l'incohérence sans savoir
    // rejetterait des plans parfaitement sains.
    expect(sourceCoherente(source(), null)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — SOURCE et TIMELINE restent deux référentiels', () => {
  it('la plage source d’un segment est celle du RUSH, décalée par l’entrée', () => {
    /* Le clip couvre 10–15 s du rush ; le montage n'en garde que 3 s à partir
       de la 2ᵉ seconde du fichier découpé. La source est donc 12–15, pas
       10–15 : prendre les bornes du clip ferait pointer les captions de A_7c
       sur un passage plus large que ce qui est montré. */
    const s = sourceDuSegment(
      { rangClip: 1, entreeSecondes: 2, dureeRetenueSecondes: 3 },
      { rang: 1, debutSecondes: 10, finSecondes: 15 },
      JEU_A, 1, { rushId: RUSH_A },
    );
    expect(s.debutSourceSecondes).toBe(12);
    expect(s.finSourceSecondes).toBe(15);
  });

  it('la plage montage n’apparaît nulle part dans la provenance', () => {
    const s = sourceDuSegment(
      { rangClip: 1, entreeSecondes: 0, dureeRetenueSecondes: 3 },
      { rang: 1, debutSecondes: 10, finSecondes: 15 },
      JEU_A, 1, { rushId: RUSH_A },
    );
    // 15–18 s du rush peut devenir 4–7 s du montage : les confondre est le
    // bug qui ne se voit qu'à l'image.
    expect(Object.keys(s)).not.toContain('debutTimelineSecondes');
    expect(Object.keys(s)).not.toContain('dureeRetenueSecondes');
  });

  it('la provenance d’un clip entier reste celle du clip', () => {
    const s = sourceDuClip(
      { rang: 2, debutSecondes: 40, finSecondes: 44 }, JEU_A, 3, { rushId: RUSH_A },
    );
    expect(s).toEqual({
      rushId: RUSH_A, clipSetId: JEU_A, clipSetVersion: 3, rangClip: 2,
      debutSourceSecondes: 40, finSourceSecondes: 44,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — l’adaptateur lit le passé et le présent', () => {
  it('un plan historique sans provenance devient source-aware', () => {
    const { segments, motif } = normaliserPlanSourceAware(
      [segment({ ordre: 1, rangClip: 1, entreeSecondes: 0, dureeRetenueSecondes: 3 }),
        segment({ ordre: 2, rangClip: 2, entreeSecondes: 1, dureeRetenueSecondes: 2 })],
      [contexte()],
    );
    expect(motif).toBeNull();
    expect(segments).toHaveLength(2);
    expect(segments![0].source).toEqual({
      rushId: RUSH_A, clipSetId: JEU_A, clipSetVersion: 1, rangClip: 1,
      debutSourceSecondes: 10, finSourceSecondes: 13,
    });
    expect(segments![1].source.debutSourceSecondes).toBe(41);
  });

  it('un plan historique produit EXACTEMENT une source', () => {
    const { segments } = normaliserPlanSourceAware(
      [segment({ rangClip: 1 }), segment({ ordre: 2, rangClip: 2 })], [contexte()],
    );
    expect(jeuxSourcesDesSegments(segments!)).toEqual([
      { clipSetId: JEU_A, clipSetVersion: 1 },
    ]);
  });

  it('un plan multi-rush A1,B1,A2 garde sa provenance écrite', () => {
    const { segments, motif } = normaliserPlanSourceAware(
      [
        avecSource({ ordre: 1 }, { clipSetId: JEU_A, rushId: RUSH_A }),
        avecSource({ ordre: 2 }, { clipSetId: JEU_B, rushId: RUSH_B }),
        avecSource({ ordre: 3 }, { clipSetId: JEU_A, rushId: RUSH_A, rangClip: 2 }),
      ],
      [contexte(), contexte({ clipSetId: JEU_B, rushId: RUSH_B })],
    );
    expect(motif).toBeNull();
    expect(segments!.map((s) => s.source.rushId)).toEqual([RUSH_A, RUSH_B, RUSH_A]);
  });

  it('rejette une provenance à moitié écrite plutôt que de la compléter', () => {
    const ampute = { ...segment(), source: { rushId: RUSH_A } };
    const { segments, motif } = normaliserPlanSourceAware(
      [ampute as PlanMontage], [contexte()],
    );
    expect(segments).toBeNull();
    expect(motif).toBe('source_incomplete');
  });

  it('rejette un segment dont le rush contredit son jeu', () => {
    const { motif } = normaliserPlanSourceAware(
      [avecSource({}, { clipSetId: JEU_A, rushId: RUSH_B })], [contexte()],
    );
    expect(motif).toBe('source_incoherente');
  });

  it('refuse de deviner quand un segment nu côtoie plusieurs jeux', () => {
    /* ⚠️ INDÉCIDABLE, DONC REFUSÉ. Attribuer au hasard l'un des deux jeux
       rendrait le mauvais rush sans qu'aucune erreur ne le dise. */
    const { motif } = normaliserPlanSourceAware(
      [segment()], [contexte(), contexte({ clipSetId: JEU_B, rushId: RUSH_B })],
    );
    expect(motif).toBe('source_incomplete');
  });

  it('signale un clip absent du jeu plutôt que d’inventer ses bornes', () => {
    const { motif } = normaliserPlanSourceAware([segment({ rangClip: 9 })], [contexte()]);
    expect(motif).toBe('clip_introuvable');
  });

  it('ne réécrit pas le segment d’origine', () => {
    /* L'adaptation se fait à la LECTURE : les lignes historiques ne sont
       jamais modifiées, ni en mémoire ni en base. */
    const origine = segment();
    normaliserPlanSourceAware([origine], [contexte()]);
    expect(origine).not.toHaveProperty('source');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — le backfill de A_7M ne double aucune source', () => {
  it('scalaire + ligne backfillée = UNE source logique', () => {
    /* ⚠️ LE PIÈGE DU BACKFILL. A_7M a écrit, pour chaque plan mono-rush, la
       ligne de source qu'il portait déjà dans sa colonne. Les additionner
       donnerait deux sources ; un plan à deux sources reçoit une empreinte,
       bascule sous l'index d'identité multi-rush, et perd ses rendus. */
    const scalaire = { clipSetId: JEU_A, clipSetVersion: 1 };
    expect(fusionnerJeuxSources(scalaire, [scalaire])).toEqual([scalaire]);
  });

  it('sans ligne de source, le scalaire suffit', () => {
    const scalaire = { clipSetId: JEU_A, clipSetVersion: 1 };
    expect(fusionnerJeuxSources(scalaire, [])).toEqual([scalaire]);
  });

  it('les lignes font foi quand elles disent plus que le scalaire', () => {
    const lignes = [
      { clipSetId: JEU_A, clipSetVersion: 1 },
      { clipSetId: JEU_B, clipSetVersion: 2 },
    ];
    expect(fusionnerJeuxSources({ clipSetId: JEU_A, clipSetVersion: 1 }, lignes))
      .toEqual(lignes);
  });

  it('une version différente du même jeu reste une source distincte', () => {
    const scalaire = { clipSetId: JEU_A, clipSetVersion: 2 };
    const ligne = { clipSetId: JEU_A, clipSetVersion: 3 };
    expect(fusionnerJeuxSources(scalaire, [ligne])).toEqual([ligne, scalaire]);
  });

  it('un jeu cité trois fois dans les segments reste UNE source', () => {
    // `source_set_fingerprint` décrit la MATIÈRE employée, pas le découpage.
    const segments = [
      avecSource({ ordre: 1 }, { clipSetId: JEU_A }),
      avecSource({ ordre: 2 }, { clipSetId: JEU_B, rushId: RUSH_B }),
      avecSource({ ordre: 3 }, { clipSetId: JEU_A, rangClip: 2 }),
    ];
    expect(jeuxSourcesDesSegments(segments)).toEqual([
      { clipSetId: JEU_A, clipSetVersion: 1 },
      { clipSetId: JEU_B, clipSetVersion: 1 },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — l’empreinte des sources', () => {
  const A = { clipSetId: JEU_A, clipSetVersion: 1 };
  const B = { clipSetId: JEU_B, clipSetVersion: 1 };
  const C = { clipSetId: 'c2c2c2c2-1111-4111-8111-cccccccccccc', clipSetVersion: 1 };

  it('est stable sur plusieurs appels', () => {
    expect(empreinteJeuxSources([A, B, C])).toBe(empreinteJeuxSources([A, B, C]));
  });

  it('dépend de l’ORDRE des sources', () => {
    // A,B,C et B,A,C n'emploient pas la matière dans le même ordre.
    expect(empreinteJeuxSources([A, B, C])).not.toBe(empreinteJeuxSources([B, A, C]));
  });

  it('dépend de la VERSION du jeu', () => {
    /* Rematérialiser produit d'autres octets pour les mêmes bornes : un plan
       calculé sur la v2 ne décrit pas le fichier de la v3. */
    const A2 = { clipSetId: JEU_A, clipSetVersion: 2 };
    expect(empreinteJeuxSources([A, B])).not.toBe(empreinteJeuxSources([A2, B]));
  });

  it('reste NULL pour une source unique — la garantie du passé', () => {
    /* ⚠️ LE TEST QUI PROTÈGE LES MP4 DÉJÀ RENDUS. A_7M laisse les plans
       mono-rush gouvernés par l'index d'identité historique, empreinte NULL.
       Leur en donner une les ferait basculer sous l'index multi-rush. */
    expect(empreinteJeuxSources([A])).toBeNull();
    expect(empreinteJeuxSources([])).toBeNull();
  });

  it('tient dans la colonne ouverte par A_7M', () => {
    const e = empreinteJeuxSources([A, B])!;
    expect(e).toHaveLength(LONGUEUR_EMPREINTE_SOURCES);
    // La migration borne `source_set_fingerprint` à 8–128 caractères.
    expect(e.length).toBeGreaterThanOrEqual(8);
    expect(e.length).toBeLessThanOrEqual(128);
    expect(e).toMatch(/^[0-9a-f]+$/);
  });

  it('la forme canonique est écrite champ par champ, séparateur compris', () => {
    /* ⚠️ JAMAIS `JSON.stringify` : l'ordre des clés d'un littéral suit
       l'ordre d'écriture, qu'un refactor déplace sans le vouloir. */
    expect(jeuxSourcesCanoniques([A, B])).toBe(`${JEU_A}@1|${JEU_B}@1`);
  });

  it('deux découpages des mêmes caractères ne se confondent pas', () => {
    const x = [{ clipSetId: JEU_A, clipSetVersion: 11 }, { clipSetId: JEU_B, clipSetVersion: 1 }];
    const y = [{ clipSetId: JEU_A, clipSetVersion: 1 }, { clipSetId: JEU_B, clipSetVersion: 11 }];
    expect(empreinteJeuxSources(x)).not.toBe(empreinteJeuxSources(y));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — l’empreinte de l’ordre des segments', () => {
  const A1 = avecSource({ ordre: 1 }, { clipSetId: JEU_A, rangClip: 1 });
  const A2 = avecSource({ ordre: 2 }, { clipSetId: JEU_A, rangClip: 2,
    debutSourceSecondes: 40, finSourceSecondes: 44 });
  const B1 = avecSource({ ordre: 3 }, { clipSetId: JEU_B, rushId: RUSH_B, rangClip: 1 });

  it('A1,B1,A2 diffère de A1,A2,B1', () => {
    /* ⚠️ MÊME MATIÈRE, AUTRE FILM. Alterner entre deux rushes et les enchaîner
       par blocs ne se regarde pas pareil ; l'empreinte des SOURCES est
       identique dans les deux cas, celle des segments non. */
    expect(empreinteSegments([A1, B1, A2])).not.toBe(empreinteSegments([A1, A2, B1]));
    expect(empreinteJeuxSources(jeuxSourcesDesSegments([A1, B1, A2])))
      .toBe(empreinteJeuxSources(jeuxSourcesDesSegments([A1, A2, B1])));
  });

  it('un même clip coupé ailleurs donne une autre empreinte', () => {
    const autre = { ...A1, source: { ...A1.source, finSourceSecondes: 14 } };
    expect(empreinteSegments([A1])).not.toBe(empreinteSegments([autre]));
  });

  it('est stable sur plusieurs appels', () => {
    expect(empreinteSegments([A1, B1, A2])).toBe(empreinteSegments([A1, B1, A2]));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — le contrat de plan reste rétrocompatible', () => {
  it('un segment SANS provenance reste valide', () => {
    /* ⚠️ LA FORME HISTORIQUE N'EST PAS UNE ERREUR. Tous les plans en base ont
       été écrits sans ce champ ; le rendre obligatoire rendrait leur `jsonb`
       illisible, donc leurs MP4 déjà rendus inatteignables. */
    expect(planValide(segment())).toBe(true);
  });

  it('un segment AVEC une provenance entière est valide', () => {
    expect(planValide(avecSource({}, {}))).toBe(true);
  });

  it('un segment avec une provenance à moitié écrite est REFUSÉ', () => {
    expect(planValide({ ...segment(), source: { rushId: RUSH_A } })).toBe(false);
    expect(planValide({ ...segment(), source: {} })).toBe(false);
    expect(planValide({ ...segment(), source: null })).toBe(false);
  });

  it('survit à l’aller-retour `jsonb` sans perdre sa provenance', () => {
    /* ⚠️ LE PLAN VIT EN `jsonb`. Ce qui est écrit doit se relire à
       l'identique, sinon la provenance serait perdue au premier rechargement
       et le renderer de A_7c retomberait sur l'hypothèse mono-rush. */
    const ecrit = avecSource({ ordre: 2, rangClip: 2 }, { clipSetId: JEU_B, rushId: RUSH_B });
    const relu = JSON.parse(JSON.stringify(ecrit)) as PlanMontage;
    expect(planValide(relu)).toBe(true);
    expect(relu.source).toEqual(ecrit.source);
  });

  it('la provenance ne change aucun autre champ du segment', () => {
    /* Le champ est purement additif : ce qu'un consommateur historique lisait
       hier, il le lit à l'identique. */
    const { source: _, ...sansProvenance } = avecSource({}, {});
    expect(sansProvenance).toEqual(segment());
  });
});
