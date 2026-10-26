/**
 * Banc de montage (`e2e/banc-montage/`) : formats, validation, mesures de référence,
 * sélection des scénarios, étiquettes aveugles, isolation du moteur. Aucun média réel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { validerAnnotation, mesuresContreReference, ficheCopieeDeLAnnotation, type AnnotationRush } from '../../e2e/banc-montage/annotations';
import { scenariosPrets, codesAveugles, type ScenarioBanc } from '../../e2e/banc-montage/scenarios';

const lire = (p: string) => readFileSync(p, 'utf8');
const scenarios = (JSON.parse(lire('e2e/banc-montage/scenarios.json')) as { scenarios: ScenarioBanc[] }).scenarios;
const ann = (rush: string, passages: AnnotationRush['passages']): AnnotationRush => ({ version: 1, rush, annotateur: 'AB', date: '2026-10-26', passages });
const p = (debut: number, fin: number, o: Partial<AnnotationRush['passages'][number]> = {}) => ({ debut, fin, action: 'x', interet: 3, qualiteImage: 'nette' as const, paroleAudible: false, horsSujet: false, ...o });

describe('scénarios', () => {
  it('les cinq scénarios demandés, ids et fichiers uniques', () => {
    expect(scenarios.map((s) => s.id)).toEqual(['danse-collective', 'coach-parle-puis-danse', 'temoignage', 'nets-et-flous', 'scene-hors-sujet']);
    const fichiers = scenarios.flatMap((s) => s.rushs);
    expect(new Set(fichiers).size).toBe(fichiers.length);
    expect(scenarios.every((s) => s.rushs.length >= 2 && s.cibleSecondes > 0 && s.theme && s.objectif && s.demande)).toBe(true);
  });
  it('un scénario incomplet est ignoré, avec les fichiers manquants', () => {
    const r = scenariosPrets(scenarios, (f) => f.startsWith('danse-'));
    expect(r.prets.map((s) => s.id)).toEqual(['danse-collective']);
    expect(r.ignores.find((x) => x.id === 'temoignage')?.manquants).toEqual(['temoignage-1.mp4', 'temoignage-2.mp4']);
  });
  it('sans aucun média : tout est ignoré, rien ne plante', () => {
    const r = scenariosPrets(scenarios, () => false);
    expect(r.prets).toEqual([]);
    expect(r.ignores).toHaveLength(5);
  });
});

describe('étiquettes aveugles', () => {
  it('reproductibles, distinctes, sans indice sur la méthode', () => {
    expect(codesAveugles('temoignage', 4)).toEqual(codesAveugles('temoignage', 4));
    expect(new Set(codesAveugles('temoignage', 4)).size).toBe(4);
    expect(codesAveugles('temoignage', 4)).not.toEqual(codesAveugles('danse-collective', 4));
    expect(codesAveugles('x', 4).every((c) => /^[A-Z]$/.test(c))).toBe(true);
  });
});

describe('annotations humaines', () => {
  it('le modèle fourni n’est PAS valide tel quel (annotateur et date à renseigner) : on ne livre pas de fausse annotation', () => {
    const modele = JSON.parse(lire('e2e/banc-montage/annotations/modele.json'));
    expect(validerAnnotation(modele)).toEqual(['annotateur : à renseigner', 'date : format AAAA-MM-JJ']);
  });
  it('une annotation correcte est valide ; les null (« je ne sais pas ») sont permis', () => {
    expect(validerAnnotation(ann('a.mp4', [p(0, 4), p(4, 9, { interet: null, qualiteImage: null, paroleAudible: null, horsSujet: null, action: null })]), 9.2)).toEqual([]);
  });
  it('erreurs lisibles : chevauchement, bornes, valeurs hors vocabulaire, fin après le rush', () => {
    const e = validerAnnotation(ann('a.mp4', [p(0, 5), p(4, 8), p(9, 8), p(10, 12, { interet: 9 }), p(12, 14, { qualiteImage: 'bof' as never }), p(14, 99)]), 20);
    expect(e.some((m) => /passage 2 : chevauche/.test(m))).toBe(true);
    expect(e.some((m) => /passage 3 : debut\/fin invalides/.test(m))).toBe(true);
    expect(e.some((m) => /passage 4 : interet/.test(m))).toBe(true);
    expect(e.some((m) => /passage 5 : qualiteImage/.test(m))).toBe(true);
    expect(e.some((m) => /passage 6 : fin 99/.test(m))).toBe(true);
    expect(validerAnnotation('n’importe quoi')).toEqual(['le fichier n’est pas un objet JSON']);
  });
  it('mesures de référence : intérêt, hors sujet, flou, bornes dans la parole', () => {
    const a = ann('a.mp4', [p(0, 4, { interet: 5, paroleAudible: true }), p(4, 8, { interet: 1, horsSujet: true }), p(8, 10, { qualiteImage: 'floue' })]);
    const m = mesuresContreReference([{ rush: 'a.mp4', depuis: 1, jusqua: 3 }, { rush: 'a.mp4', depuis: 5, jusqua: 7 }, { rush: 'a.mp4', depuis: 8, jusqua: 9 }], { 'a.mp4': a });
    expect(m.couvertureAnnotee).toBe(1);
    expect(m.secondesHorsSujet).toBe(2);
    expect(m.secondesFloues).toBe(1);
    expect(m.interetMoyen).toBeCloseTo((5 * 2 + 1 * 2 + 3 * 1) / 5, 1);
    expect(m.bornesDansParole).toBe(2); // 1 s et 3 s sont au cœur d'un passage parlé
    expect(m.bornes).toBe(6);
  });
  it('rush non annoté : aucune mesure inventée', () => {
    const m = mesuresContreReference([{ rush: 'b.mp4', depuis: 0, jusqua: 4 }], {});
    expect(m).toMatchObject({ couvertureAnnotee: 0, interetMoyen: null, secondesHorsSujet: 0, bornesDansParole: 0 });
  });
  it('une fiche recopiée sur l’annotation est détectée (non indépendante)', () => {
    const a = ann('a.mp4', [p(0, 4, { action: 'danse' })]);
    expect(ficheCopieeDeLAnnotation({ scenes: [{ debut: 0, fin: 4, action: 'danse' }] }, a)).toBe(true);
    expect(ficheCopieeDeLAnnotation({ scenes: [{ debut: 0, fin: 3.5, action: 'danse en groupe' }] }, a)).toBe(false);
  });
});

describe('isolation', () => {
  it('médias et rendus ignorés par Git, le modèle et la grille suivis', () => {
    const g = lire('.gitignore');
    expect(g).toContain('e2e/banc-montage/medias/*');
    expect(g).toContain('e2e/banc-montage/resultats/*');
    expect(g).toContain('!e2e/banc-montage/resultats/grille-modele.csv');
    expect(g).toContain('!e2e/banc-montage/annotations/modele.json');
  });
  it('le banc ne modifie pas le moteur : pas d’écriture dans src/, aucun réseau, aucun fournisseur', () => {
    const r = lire('e2e/banc-montage/lancer.bench.ts');
    expect(r).not.toMatch(/fetch\(|anthropic|groq|process\.env\.(ANTHROPIC|GROQ|STUDIIO_)/i);
    expect(r).not.toMatch(/writeFileSync\([^)]*src\//);
    expect(r).toContain("analysesAvecScenes(analyses, fiches, true)"); // B force l'interrupteur localement, jamais en production
  });
  it('FICHE_SCENES_ACTIVE reste désactivé en production', () => {
    expect(lire('src/lib/creer/fiche-scenes.ts')).toContain('export const FICHE_SCENES_ACTIVE = false;');
  });
  it('la suite normale n’exécute pas le banc, et son dossier de médias existe', () => {
    expect(lire('vitest.config.ts')).toContain("include: ['src/**/*.{test,spec}.{ts,tsx}']");
    expect(existsSync('e2e/banc-montage/medias/.gitkeep')).toBe(true);
    expect(lire('e2e/banc-montage/vitest.banc.config.ts')).toContain("include: ['e2e/banc-montage/*.bench.ts']");
  });
});
