// @vitest-environment node
/**
 * M3-E — LE CALAGE INTELLIGENT DES COUPES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE EN PRIORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-E ne choisit rien : il polit les bords d'un choix déjà fait. Les
 * défauts qui coûteraient cher sont donc ceux qui TRAHISSENT ce choix :
 *
 *   1. Bouger plus que nécessaire — le piège de la priorité par catégorie,
 *      celui qui, sur les données réelles, faisait perdre une bonne coupe.
 *   2. Bouger sur des données douteuses — un horodatage fantaisiste ne doit
 *      pas déplacer une borne ; la tolérance étroite le met hors de portée.
 *   3. Rendre une fenêtre invalide — hors du rush, sans la référence, ou
 *      d'une durée dénaturée. Le doute conserve, toujours.
 *
 * ⚠️ AUCUN RÉSEAU, AUCUNE IA, AUCUNE ÉCRITURE. Le moteur est une fonction
 * pure et se teste sans rien monter ; la route se teste sur une base en
 * mémoire qui compte les écritures — et n'en attend aucune.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ───────────────────────────────────────────────────────────────────────────
// Ce qu'il faut pour faire tourner la ROUTE — et rien de plus
// ───────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'A' } }) }));

interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
/** ⚠️ Toute écriture est comptée. M3-E ne doit en produire aucune. */
const ecritures: Array<{ table: string; type: 'insert' | 'update' }> = [];
const erreurTable = { code: '42P01', message: 'relation does not exist' };

function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter((l) => filtres.every(([c, v]) => l[c] === v));
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.colonne] ?? 0); const y = Number(b[tri!.colonne] ?? 0);
        return tri!.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    in: () => api,
    lt: () => api,
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: () => { ecritures.push({ table, type: 'insert' }); return api; },
    update: () => { ecritures.push({ table, type: 'update' }); return api; },
    maybeSingle: async () => {
      if (tableAbsente === table) return { data: null, error: erreurTable };
      const l = lignes();
      return { data: l && l.length ? l[0] : null, error: null };
    },
    then: (resoudre: (v: unknown) => unknown) => {
      const l = lignes();
      return resoudre(l === null ? { data: null, error: erreurTable } : { data: l, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

import { calerCoupes } from '@/lib/autopilot/analyse/coupe';
import {
  ALGORITHME_COUPES, TOLERANCE_SECONDES, gardeDuree, arrondirSeconde,
  intervalleUtilisable, candidatUtilisable, rangSource,
  SOURCES_ANCRAGE, ETATS_PAROLE, ETATS_AUDIO, SOURCES_TRANSCRIPTION,
  type EntreeCoupes,
} from '@/lib/autopilot/analyse/coupe-contrat';
import type { CandidatMontage } from '@/lib/autopilot/analyse/candidat-contrat';

const { GET, maxDuration } = await import(
  '@/app/api/autopilot/candidats/[candidateSetId]/coupes/route'
);

const SOURCE_ROUTE = resolve(
  process.cwd(), 'src/app/api/autopilot/candidats/[candidateSetId]/coupes/route.ts',
);
const SOURCE_MOTEUR = resolve(process.cwd(), 'src/lib/autopilot/analyse/coupe.ts');
const SOURCE_CONTRAT = resolve(process.cwd(), 'src/lib/autopilot/analyse/coupe-contrat.ts');

const DUREE = 40;

/** Un candidat M3-C, centré comme `fenetreCandidat` le fait. */
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

const mot = (d: number, f: number, texte = 'x') => ({ debutSecondes: d, finSecondes: f, texte });
const seg = (d: number, f: number, texte = 'phrase') => ({ debutSecondes: d, finSecondes: f, texte });
const sil = (d: number, f: number) => ({ debutSecondes: d, finSecondes: f });

/**
 * La première (et souvent unique) coupe.
 *
 * Deux surcharges DISTINCTES, et c'est délibéré : `e` décrit le matériel
 * (silences, parole), `c` décrit le candidat M3-C. Les mélanger ferait
 * passer `dureeCibleSecondes` pour une clé d'entrée du moteur — un test
 * vert sur une fenêtre qui n'est pas celle qu'on croit.
 */
function une(e: Partial<EntreeCoupes> = {}, c: Partial<CandidatMontage> = {}) {
  return calerCoupes(entree({ candidats: [cand(c)], ...e })).coupes[0];
}

beforeEach(() => {
  tables = {};
  tableAbsente = null;
  ecritures.length = 0;
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-4. Sans matière, la fenêtre M3-C ressort intacte', () => {
  it('1. ni audio ni parole : rien ne bouge', () => {
    const c = une();
    expect(c.debutSecondes).toBe(10);
    expect(c.finSecondes).toBe(18);
    expect(c.ajustementDebut).toEqual({ deltaSecondes: 0, source: 'aucun' });
    expect(c.ajustementFin).toEqual({ deltaSecondes: 0, source: 'aucun' });
  });

  it('2. audio `absente` (rush muet) — un résultat, pas un échec', () => {
    const r = calerCoupes(entree({ audioEtatMesure: 'absente' }));
    expect(r.sources.audio).toBe('absente');
    expect(r.coupes[0].debutSecondes).toBe(10);
  });

  it('3. audio `indisponible` (analyse antérieure à M3-D1)', () => {
    expect(calerCoupes(entree()).sources.audio).toBe('indisponible');
  });

  it('4. audio mesuré SANS aucun silence — musique continue, cas réel', () => {
    const r = calerCoupes(entree({ audioEtatMesure: 'mesuree', silences: [] }));
    expect(r.sources.audio).toBe('sans_silence');
    expect(r.coupes[0].ajustementDebut.source).toBe('aucun');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('5-13. Le choix d’un ancrage', () => {
  it('5. un silence proche du début : la borne se pose à sa FIN', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(9.2, 9.7)] });
    expect(c.debutSecondes).toBe(9.7);
    expect(c.ajustementDebut).toEqual({ deltaSecondes: -0.3, source: 'silence' });
    expect(c.finSecondes).toBe(18);
  });

  it('6. un silence proche de la fin : la borne se pose à son DÉBUT', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(18.4, 19)] });
    expect(c.finSecondes).toBe(18.4);
    expect(c.ajustementFin).toEqual({ deltaSecondes: 0.4, source: 'silence' });
  });

  it('7. un silence au-delà de la tolérance est ignoré', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(8, 8.9)] });
    // 8,9 est à 1,1 s de la borne 10 : hors des 0,750 s.
    expect(c.debutSecondes).toBe(10);
    expect(c.ajustementDebut.source).toBe('aucun');
  });

  it('8. début AU MILIEU d’un mot : la borne saute sur une de ses frontières', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      mots: [mot(9.8, 10.4)],
    });
    // 10 coupe le mot ; sa fin (10,4) est à 0,4 s, son début (9,8) à 0,2 s.
    expect(c.debutSecondes).toBe(9.8);
    expect(c.ajustementDebut).toEqual({ deltaSecondes: -0.2, source: 'mot' });
  });

  it('9. fin AU MILIEU d’un mot', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      mots: [mot(17.9, 18.3)],
    });
    expect(c.finSecondes).toBe(17.9);
    expect(c.ajustementFin).toEqual({ deltaSecondes: -0.1, source: 'mot' });
  });

  it('8bis. une borne ENTRE deux mots ne bouge pas — il n’y a rien à réparer', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      mots: [mot(9.0, 9.9), mot(10.1, 10.6)],
    });
    expect(c.debutSecondes).toBe(10);
    expect(c.ajustementDebut.source).toBe('aucun');
  });

  it('10-11. les frontières de segment servent les deux bornes', () => {
    const c = une({
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(10.3, 17.65)],
    });
    expect(c.debutSecondes).toBe(10.3);
    expect(c.ajustementDebut.source).toBe('segment');
    expect(c.finSecondes).toBe(17.65);
    expect(c.ajustementFin.source).toBe('segment');
  });

  it('12. LA PROXIMITÉ GAGNE SUR LA CATÉGORIE', () => {
    // Le cas exact relevé sur les données de production : un silence noble
    // mais lointain, un mot modeste mais proche. C'est le mot qui gagne.
    const c = une({
      audioEtatMesure: 'mesuree', silences: [sil(9.3, 9.4)],
      transcriptionRetenue: true, parolePresente: true, mots: [mot(9.96, 10.5)],
    });
    expect(c.debutSecondes).toBe(9.96);
    expect(c.ajustementDebut.source).toBe('mot');
  });

  it('13. à distance ÉGALE : silence > segment > mot', () => {
    const c = une({
      audioEtatMesure: 'mesuree', silences: [sil(9.2, 9.8)],
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(9.8, 17)], mots: [mot(9.5, 10.2)],
    });
    // Trois points à 9,8 — donc à distance identique. Le silence l'emporte.
    expect(c.debutSecondes).toBe(9.8);
    expect(c.ajustementDebut.source).toBe('silence');
    expect(rangSource('silence')).toBeLessThan(rangSource('segment'));
    expect(rangSource('segment')).toBeLessThan(rangSource('mot'));
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('14-19. Ce que la parole apporte, ou n’apporte pas', () => {
  it('14. transcription retenue mais `presente: false`', () => {
    const r = calerCoupes(entree({ transcriptionRetenue: true, parolePresente: false }));
    expect(r.sources.parole).toBe('sans_parole');
  });

  it('15. aucune transcription retenue', () => {
    expect(calerCoupes(entree()).sources.parole).toBe('absente');
  });

  it('16+19. de la parole annoncée, mais aucun instant : `ecartee`, et rien d’inventé', () => {
    const r = calerCoupes(entree({
      transcriptionRetenue: true, parolePresente: true, segments: [], mots: [],
    }));
    expect(r.sources.parole).toBe('ecartee');
    expect(r.coupes[0].debutSecondes).toBe(10);
    expect(r.coupes[0].finSecondes).toBe(18);
  });

  it('17. mots absents, segments présents', () => {
    const r = calerCoupes(entree({
      transcriptionRetenue: true, parolePresente: true, segments: [seg(10.3, 17.7)], mots: [],
    }));
    expect(r.sources.parole).toBe('exploitee');
    expect(r.coupes[0].ajustementDebut.source).toBe('segment');
  });

  it('18. segments absents, mots présents', () => {
    const r = calerCoupes(entree({
      transcriptionRetenue: true, parolePresente: true, segments: [], mots: [mot(9.9, 10.3)],
    }));
    expect(r.sources.parole).toBe('exploitee');
    expect(r.coupes[0].ajustementDebut.source).toBe('mot');
  });

  it('un intervalle structurellement faux est écarté, jamais corrigé', () => {
    for (const mauvais of [
      mot(Number.NaN, 10.2),                 // pas un nombre
      mot(9.9, Number.POSITIVE_INFINITY),    // pas fini
      mot(10.2, 10.2),                       // vide
      mot(10.4, 9.9),                        // inversé
      mot(-1, 10.1),                         // avant le rush
      mot(39.5, 41),                         // déborde du rush
      null as never, 'x' as never, [] as never,
    ]) {
      expect(intervalleUtilisable(mauvais, DUREE)).toBe(false);
    }
    expect(intervalleUtilisable(mot(9.9, 10.2), DUREE)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('20-25. Deux bornes indépendantes, une durée qui les lie', () => {
  it('20. le DÉBUT seul est amélioré', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(9.5, 9.8)] });
    expect(c.ajustementDebut.source).toBe('silence');
    expect(c.ajustementFin.source).toBe('aucun');
    expect(c.finSecondes).toBe(18);
  });

  it('21. la FIN seule est améliorée', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(18.2, 18.9)] });
    expect(c.ajustementDebut.source).toBe('aucun');
    expect(c.ajustementFin.source).toBe('silence');
  });

  it('22. deux ajustements compatibles s’appliquent ensemble', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(9.4, 9.7), sil(18.3, 19)] });
    expect(c.debutSecondes).toBe(9.7);
    expect(c.finSecondes).toBe(18.3);
    expect(c.dureeSecondes).toBe(8.6);
    // 8,6 contre 8,0 : +0,6 s, sous la garde de 1,0 s pour une cible de 8 s.
    expect(Math.abs(c.dureeSecondes - 8)).toBeLessThanOrEqual(gardeDuree(8));
  });

  it('23-24. deux ajustements violent la garde → le plus PETIT est gardé seul', () => {
    // Fenêtre 12,5 → 15,5 (cible 3 s, garde 0,75 s).
    //   début : le silence finit à 11,8  → −0,7 s
    //   fin   : le silence commence à 15,7 → +0,2 s
    // Ensemble : 3,9 s, soit +0,9 s — au-delà de la garde. Séparément, les
    // deux tiennent ; c'est le plus petit déplacement qui est retenu.
    const c = une(
      { audioEtatMesure: 'mesuree', silences: [sil(11.5, 11.8), sil(15.7, 16.4)] },
      { secondeReference: 14, dureeCibleSecondes: 3 },
    );
    expect(c.ajustementFin).toEqual({ deltaSecondes: 0.2, source: 'silence' });
    expect(c.ajustementDebut.source).toBe('aucun');
    expect(c.debutSecondes).toBe(12.5);
    expect(c.finSecondes).toBe(15.7);
    expect(Math.abs(c.dureeSecondes - 3)).toBeLessThanOrEqual(gardeDuree(3));
  });

  it('23bis. à déplacement ÉGAL et même nature, le DÉBUT l’emporte', () => {
    // Les deux ancrages sont à 0,7 s, tous deux des silences : il faut bien
    // trancher, et la règle est écrite plutôt que subie.
    const c = une(
      { audioEtatMesure: 'mesuree', silences: [sil(11.5, 11.8), sil(16.2, 16.9)] },
      { secondeReference: 14, dureeCibleSecondes: 3 },
    );
    expect(c.ajustementDebut).toEqual({ deltaSecondes: -0.7, source: 'silence' });
    expect(c.ajustementFin.source).toBe('aucun');
    expect(Math.abs(c.dureeSecondes - 3)).toBeLessThanOrEqual(gardeDuree(3));
  });

  it('25. aucun ajustement seul admissible → la fenêtre M3-C, intégralement', () => {
    // Clip de 3 s, garde 0,75 s : chaque silence étirerait de 0,74… non.
    // Ici chaque ancrage seul dépasse la garde, donc rien ne bouge.
    const c = une(
      { audioEtatMesure: 'mesuree', silences: [sil(11.5, 11.7), sil(16.3, 17)] },
      { secondeReference: 14, dureeCibleSecondes: 3 },
    );
    expect(c.debutSecondes).toBe(12.5);
    expect(c.finSecondes).toBe(15.5);
    expect(c.ajustementDebut.source).toBe('aucun');
    expect(c.ajustementFin.source).toBe('aucun');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('26-32. Les invariants, après tout arrondi', () => {
  it('26. la référence reste TOUJOURS dans la fenêtre', () => {
    // Un silence dont la fin dépasse la référence ne peut pas être retenu :
    // le passage perdrait l'instant qui l'avait fait choisir.
    const c = une(
      { audioEtatMesure: 'mesuree', silences: [sil(8.6, 9.3)] },
      { secondeReference: 10.1, dureeCibleSecondes: 3 },
    );
    expect(c.debutSecondes).toBeLessThanOrEqual(c.secondeReference);
    expect(c.finSecondes).toBeGreaterThanOrEqual(c.secondeReference);
  });

  it('26bis. un ancrage qui expulserait la référence est refusé', () => {
    const c = une(
      { transcriptionRetenue: true, parolePresente: true, segments: [seg(10.5, 12)] },
      { secondeReference: 10.2, dureeCibleSecondes: 3 },
    );
    // 10,5 est à 0,2 s de la borne 8,7… mais dépasse la référence 10,2.
    expect(c.debutSecondes).toBeLessThanOrEqual(10.2);
  });

  it('27. début de rush : aucune borne négative', () => {
    const c = une(
      {
        audioEtatMesure: 'mesuree', silences: [sil(0, 0.2)],
        transcriptionRetenue: true, parolePresente: true, mots: [mot(0, 0.4)],
      },
      { secondeReference: 1.5, dureeCibleSecondes: 3 },
    );
    expect(c.debutSecondes).toBeGreaterThanOrEqual(0);
    expect(c.finSecondes).toBeLessThanOrEqual(DUREE);
  });

  it('28. fin de rush : aucune borne au-delà', () => {
    const c = une(
      { audioEtatMesure: 'mesuree', silences: [sil(39.8, 40)] },
      { secondeReference: 38.5, dureeCibleSecondes: 3 },
    );
    expect(c.finSecondes).toBeLessThanOrEqual(DUREE);
    expect(c.debutSecondes).toBeLessThan(c.finSecondes);
  });

  it('29. rush plus court que la cible', () => {
    const court: CandidatMontage = {
      rang: 1, secondeReference: 1, dureeCibleSecondes: 8,
      debutSecondes: 0, finSecondes: 2, scoreMontage: 50, raison: 'r',
      signaux: null,
    };
    const r = calerCoupes(entree({ dureeRushSecondes: 2, candidats: [court] }));
    expect(r.coupes[0].debutSecondes).toBe(0);
    expect(r.coupes[0].finSecondes).toBe(2);
  });

  it('30. trois décimales, toujours', () => {
    const c = une({
      audioEtatMesure: 'mesuree', silences: [sil(9.1, 9.7776543)],
    });
    for (const n of [c.debutSecondes, c.finSecondes, c.dureeSecondes,
      c.ajustementDebut.deltaSecondes, c.ajustementFin.deltaSecondes]) {
      expect(Number.isFinite(n)).toBe(true);
      expect(arrondirSeconde(n)).toBe(n);
    }
    expect(c.debutSecondes).toBe(9.778);
  });

  it('31. `NaN` et `Infinity` ne produisent jamais une fenêtre', () => {
    const casse = { ...cand(), debutSecondes: Number.NaN };
    expect(calerCoupes(entree({ candidats: [casse] })).coupes).toHaveLength(0);
    expect(candidatUtilisable(casse, DUREE)).toBe(false);
    // Une durée de rush absurde : aucun calage, et rien d'invalide.
    const r = calerCoupes(entree({ dureeRushSecondes: Number.POSITIVE_INFINITY }));
    expect(r.coupes.every((x) => Number.isFinite(x.debutSecondes))).toBe(true);
  });

  it('31bis. tout ce qui sort respecte les six bornes du contrat', () => {
    const e = entree({
      candidats: [cand({ rang: 1, secondeReference: 6, dureeCibleSecondes: 5 }),
        cand({ rang: 2, secondeReference: 20, dureeCibleSecondes: 12 }),
        cand({ rang: 3, secondeReference: 38, dureeCibleSecondes: 3 })],
      audioEtatMesure: 'mesuree',
      silences: [sil(3.2, 3.8), sil(8.1, 8.6), sil(13.6, 14.2), sil(26.1, 26.4), sil(39.2, 39.6)],
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(3.8, 8.1), seg(8.6, 13.6), seg(14.2, 26.1)],
      mots: [mot(3.8, 4.2), mot(36.4, 36.9), mot(39.1, 39.5)],
    });
    for (const c of calerCoupes(e).coupes) {
      expect(c.debutSecondes).toBeGreaterThanOrEqual(0);
      expect(c.debutSecondes).toBeLessThan(c.finSecondes);
      expect(c.finSecondes).toBeLessThanOrEqual(DUREE);
      expect(c.secondeReference).toBeGreaterThanOrEqual(c.debutSecondes);
      expect(c.secondeReference).toBeLessThanOrEqual(c.finSecondes);
      expect(Math.abs(c.debutSecondes - c.debutOriginalSecondes))
        .toBeLessThanOrEqual(TOLERANCE_SECONDES + 1e-9);
      expect(Math.abs(c.finSecondes - c.finOriginalSecondes))
        .toBeLessThanOrEqual(TOLERANCE_SECONDES + 1e-9);
      const dureeOriginale = c.finOriginalSecondes - c.debutOriginalSecondes;
      expect(Math.abs(c.dureeSecondes - dureeOriginale))
        .toBeLessThanOrEqual(gardeDuree(c.dureeCibleSecondes) + 1e-9);
    }
  });

  it('32. déterminisme exact : deux appels, deux résultats égaux', () => {
    const e = entree({
      audioEtatMesure: 'mesuree', silences: [sil(9.5, 9.8), sil(18.2, 18.6)],
      transcriptionRetenue: true, parolePresente: true,
      segments: [seg(9.8, 18.2)], mots: [mot(9.7, 10.1)],
    });
    expect(calerCoupes(e)).toEqual(calerCoupes(e));
    // Et l'ordre des entrées ne change pas la décision.
    const melange = entree({
      ...e,
      silences: [...e.silences].reverse(),
      segments: [...e.segments].reverse(),
      mots: [...e.mots].reverse(),
    });
    expect(calerCoupes(melange).coupes).toEqual(calerCoupes(e).coupes);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('33-38. M3-E ne touche à rien, et n’invente aucun score', () => {
  it('33-35. candidats, silences et parole ne sont JAMAIS mutés', () => {
    const candidats = [cand({ rang: 2 }), cand({ rang: 1, secondeReference: 6 })];
    const silences = [sil(9.5, 9.8), sil(3.2, 3.4)];
    const segments = [seg(9.8, 18.2)];
    const mots = [mot(9.7, 10.1), mot(2.9, 3.3)];
    const avant = JSON.stringify({ candidats, silences, segments, mots });

    calerCoupes(entree({
      candidats, silences, segments, mots,
      audioEtatMesure: 'mesuree', transcriptionRetenue: true, parolePresente: true,
    }));

    // Trier sur place aurait suffi à réécrire l'historique de trois lots.
    expect(JSON.stringify({ candidats, silences, segments, mots })).toBe(avant);
    expect(candidats[0].rang).toBe(2);
    expect(silences[0].debutSecondes).toBe(9.5);
  });

  it('36-37. `rang`, `scoreMontage` et `raison` sont recopiés à l’identique', () => {
    const source = cand({ rang: 4, scoreMontage: 63, raison: 'texte exact de M3-C' });
    const c = calerCoupes(entree({
      candidats: [source], audioEtatMesure: 'mesuree', silences: [sil(9.5, 9.8)],
    })).coupes[0];
    expect(c.rang).toBe(4);
    expect(c.scoreMontage).toBe(63);
    expect(c.raison).toBe('texte exact de M3-C');
    expect(c.secondeReference).toBe(source.secondeReference);
    expect(c.dureeCibleSecondes).toBe(source.dureeCibleSecondes);
  });

  it('36bis. l’ordre des rangs de M3-C est conservé, jamais recalculé', () => {
    const r = calerCoupes(entree({
      candidats: [cand({ rang: 3, secondeReference: 30 }), cand({ rang: 1 }),
        cand({ rang: 2, secondeReference: 22 })],
    }));
    expect(r.coupes.map((c) => c.rang)).toEqual([1, 2, 3]);
  });

  it('38. AUCUN score nouveau n’existe dans le contrat', () => {
    const c = une({ audioEtatMesure: 'mesuree', silences: [sil(9.5, 9.8)] });
    expect(Object.keys(c).sort()).toEqual([
      'ajustementDebut', 'ajustementFin', 'debutOriginalSecondes', 'debutSecondes',
      'dureeCibleSecondes', 'dureeSecondes', 'finOriginalSecondes', 'finSecondes',
      'raison', 'rang', 'scoreMontage', 'secondeReference',
      // Lot 2B, etape 4A : des FAITS OBSERVES, transportes tels quels. Ce
      // n'est pas un score de plus, et l'assertion ci-dessous continue de
      // l'interdire.
      'signaux',
    ]);
    for (const src of [SOURCE_MOTEUR, SOURCE_CONTRAT]) {
      const s = readFileSync(src, 'utf8');
      expect(s).not.toMatch(/scoreAudio|scoreParole|scoreViral|scoreRetention|scoreFinal/);
    }
  });

  it('les vocabulaires sont fermés, et l’algorithme est nommé', () => {
    // Bumpe DEUX FOIS en P0-C : la regle anti-chevauchement change la
    // DECISION, donc l'identite d'un jeu de clips doit changer avec elle.
    // `m3e-v2` = premiere version de la regle (moitie de la plus courte) ;
    // `m3e-v3` = le critere en secondes, plancher compris, apres la mesure
    // de production qui montrait 5,152 s encore rejouees.
    expect(ALGORITHME_COUPES).toBe('m3e-v3');
    expect(SOURCES_ANCRAGE).toEqual(['silence', 'segment', 'mot', 'aucun']);
    expect(ETATS_PAROLE).toEqual(['exploitee', 'sans_parole', 'ecartee', 'absente']);
    expect(ETATS_AUDIO).toEqual(['exploitee', 'sans_silence', 'absente', 'indisponible']);
    expect(SOURCES_TRANSCRIPTION).toEqual(['demandee', 'derniere', 'aucune']);
    expect(TOLERANCE_SECONDES).toBe(0.75);
    expect(gardeDuree(3)).toBe(0.75);
    expect(gardeDuree(5)).toBe(1);
    expect(gardeDuree(12)).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// La route
// ═════════════════════════════════════════════════════════════════════════
const CS = '11111111-1111-4111-8111-111111111111';
const AN = '22222222-2222-4222-8222-222222222222';
const RU = '33333333-3333-4333-8333-333333333333';
const T1 = '44444444-4444-4444-8444-444444444444';
const T2 = '55555555-5555-4555-8555-555555555555';

function ligneGeneration(over: Ligne = {}): Ligne {
  return {
    id: CS, analysis_id: AN, rush_id: RU, user_id: 'A', version: 1,
    etat: 'reussie', etape: 'candidats', fournisseurs: {},
    candidats: [{
      rang: 1, secondeReference: 14, dureeCibleSecondes: 8,
      debutSecondes: 10, finSecondes: 18, scoreMontage: 77, raison: 'r',
    }],
    usage: {}, motif_echec: null, created_at: 'x', updated_at: 'y', ...over,
  };
}
function ligneAnalyse(over: Ligne = {}): Ligne {
  return {
    id: AN, rush_id: RU, user_id: 'A', version: 8, etat: 'reussie', etape: 'visuel',
    fournisseurs: {}, duree_secondes: DUREE, technique: {}, resume: null,
    textes_visibles: [], parole: {},
    audio: { present: true, etatMesure: 'mesuree', silences: [sil(9.5, 9.8)] },
    qualite: {}, vignettes: [], usage: {}, motif_echec: null,
    created_at: 'x', updated_at: 'y', ...over,
  };
}
function ligneTranscription(over: Ligne = {}): Ligne {
  return {
    id: T1, rush_id: RU, user_id: 'A', version: 1, etat: 'reussie', etape: 'transcription',
    fournisseurs: {}, presente: true, langue: 'french', texte: 'bonjour',
    segments: [seg(10.3, 17.7)], mots: [mot(10.3, 10.6)],
    usage: {}, motif_echec: null, created_at: 'x', started_at: null,
    completed_at: null, updated_at: 'y', ...over,
  };
}

function appel(id = CS, query = '') {
  return GET(
    { nextUrl: new URL(`http://x/api${query}`) } as never,
    { params: { candidateSetId: id } },
  );
}

describe('La route : propriété, refus, et zéro écriture', () => {
  beforeEach(() => {
    tables = {
      rush_candidate_sets: [ligneGeneration()],
      rush_analyses: [ligneAnalyse()],
      rush_transcriptions: [ligneTranscription()],
    };
  });

  it('identifiant malformé → 422, avant toute lecture', async () => {
    const rep = await appel('pas-un-uuid');
    expect(rep.status).toBe(422);
    expect((await rep.json()).motif).toBe('identifiant_invalide');
  });

  it('génération inconnue → 404', async () => {
    tables.rush_candidate_sets = [];
    expect((await appel()).status).toBe(404);
  });

  it('génération d’autrui → 404, indistinguable d’une inconnue', async () => {
    tables.rush_candidate_sets = [ligneGeneration({ user_id: 'B' })];
    const rep = await appel();
    expect(rep.status).toBe(404);
    // Le message ne doit rien confirmer sur l'existence du travail d'un tiers.
    expect((await rep.json()).error).toBe('Passages introuvables');
  });

  it('génération non réussie → 409', async () => {
    tables.rush_candidate_sets = [ligneGeneration({ etat: 'echouee' })];
    const rep = await appel();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('generation_non_reussie');
  });

  it('génération sans candidat → 409', async () => {
    tables.rush_candidate_sets = [ligneGeneration({ candidats: [] })];
    const rep = await appel();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('candidats_absents');
  });

  it('durée inconnue → 409', async () => {
    tables.rush_analyses = [ligneAnalyse({ duree_secondes: null })];
    const rep = await appel();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('duree_inconnue');
  });

  it('l’analyse d’un AUTRE rush ne sert jamais de source', async () => {
    tables.rush_analyses = [ligneAnalyse({ rush_id: 'autre' })];
    expect((await appel()).status).toBe(404);
  });

  it('socle M3-C absent → 503', async () => {
    tableAbsente = 'rush_candidate_sets';
    const rep = await appel();
    expect(rep.status).toBe(503);
    expect((await rep.json()).motif).toBe('socle_absent');
  });
});

describe('La route : la transcription, demandée ou résolue', () => {
  beforeEach(() => {
    tables = {
      rush_candidate_sets: [ligneGeneration()],
      rush_analyses: [ligneAnalyse()],
      rush_transcriptions: [ligneTranscription()],
    };
  });

  it('sans paramètre : la dernière RÉUSSIE, et la réponse dit laquelle', async () => {
    const rep = await appel();
    expect(rep.status).toBe(200);
    const b = await rep.json();
    expect(b.transcription).toEqual({ id: T1, version: 1, source: 'derniere' });
    expect(b.sources.parole).toBe('exploitee');
  });

  it('une version plus récente ÉCHOUÉE ne masque pas la dernière réussie', async () => {
    tables.rush_transcriptions = [
      ligneTranscription(),
      ligneTranscription({ id: T2, version: 3, etat: 'echouee', segments: [], mots: [] }),
    ];
    const b = await (await appel()).json();
    // Sans le filtre `etat = reussie`, un simple échec de fournisseur ferait
    // perdre la parole d'un rush qui en a pourtant une.
    expect(b.transcription).toEqual({ id: T1, version: 1, source: 'derniere' });
  });

  it('aucune réussie → `aucune`, id et version nuls, et ce n’est PAS une erreur', async () => {
    tables.rush_transcriptions = [ligneTranscription({ etat: 'echouee' })];
    const rep = await appel();
    expect(rep.status).toBe(200);
    const b = await rep.json();
    expect(b.transcription).toEqual({ id: null, version: null, source: 'aucune' });
    expect(b.sources.parole).toBe('absente');
    // M3-E continue avec M3-C et le D1.
    expect(b.coupes[0].ajustementDebut.source).toBe('silence');
  });

  it('avec un identifiant valide → `demandee`', async () => {
    const b = await (await appel(CS, `?transcriptionId=${T1}`)).json();
    expect(b.transcription).toEqual({ id: T1, version: 1, source: 'demandee' });
  });

  it('identifiant de transcription malformé → 422', async () => {
    const rep = await appel(CS, '?transcriptionId=zzz');
    expect(rep.status).toBe(422);
  });

  it('transcription inconnue → 404, et jamais un repli silencieux', async () => {
    const rep = await appel(CS, `?transcriptionId=${T2}`);
    expect(rep.status).toBe(404);
  });

  it('transcription d’autrui → 404', async () => {
    tables.rush_transcriptions = [ligneTranscription({ id: T2, user_id: 'B' })];
    expect((await appel(CS, `?transcriptionId=${T2}`)).status).toBe(404);
  });

  it('transcription d’un AUTRE rush → 409', async () => {
    tables.rush_transcriptions = [ligneTranscription({ id: T2, rush_id: 'autre' })];
    const rep = await appel(CS, `?transcriptionId=${T2}`);
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('transcription_autre_rush');
  });

  it('transcription non réussie → 409', async () => {
    tables.rush_transcriptions = [ligneTranscription({ id: T2, etat: 'echouee' })];
    const rep = await appel(CS, `?transcriptionId=${T2}`);
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('transcription_non_reussie');
  });

  it('les invariants du bloc `transcription` tiennent dans les trois cas', async () => {
    const cas: Array<[string, string]> = [
      ['', 'derniere'], [`?transcriptionId=${T1}`, 'demandee'],
    ];
    for (const [q, attendu] of cas) {
      const t = (await (await appel(CS, q)).json()).transcription;
      expect(t.source).toBe(attendu);
      expect(t.id).not.toBeNull();
      expect(t.version).not.toBeNull();
    }
    tables.rush_transcriptions = [];
    const t = (await (await appel()).json()).transcription;
    expect(t).toEqual({ id: null, version: null, source: 'aucune' });
  });
});

describe('La route : ce qu’elle rend, et ce qu’elle ne fait pas', () => {
  beforeEach(() => {
    tables = {
      rush_candidate_sets: [ligneGeneration()],
      rush_analyses: [ligneAnalyse()],
      rush_transcriptions: [ligneTranscription()],
    };
  });

  it('la réponse porte tout ce qu’il faut pour rejouer la décision', async () => {
    const rep = await appel();
    const b = await rep.json();
    expect(b.ok).toBe(true);
    expect(b.algorithme).toBe(ALGORITHME_COUPES);
    expect(b).toMatchObject({
      candidateSetId: CS, candidateSetVersion: 1, analysisId: AN, rushId: RU,
    });
    expect(Object.keys(b).sort()).toEqual([
      'algorithme', 'analysisId', 'candidateSetId', 'candidateSetVersion',
      'coupes', 'ok', 'rushId', 'sources', 'transcription',
    ]);
    // Ni le texte, ni les segments, ni les mots ne repartent au navigateur.
    const texte = JSON.stringify(b);
    expect(texte).not.toContain('bonjour');
    expect(texte).not.toContain('segments');
    expect(texte).not.toContain('mots');
    expect(rep.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('AUCUNE écriture, sur aucune table', async () => {
    await appel();
    await appel(CS, `?transcriptionId=${T1}`);
    expect(ecritures).toEqual([]);
  });

  it('le source ne contient ni écriture, ni fournisseur, ni rendu, ni crédit', () => {
    // ⚠️ LE CODE, PAS LES COMMENTAIRES. Ces fichiers se racontent, et disent
    // en toutes lettres ce qu'ils ne font PAS — « aucun ffmpeg », « aucun
    // fournisseur ». Chercher les mots dans le texte brut punirait la phrase
    // qui documente l'absence, tout en laissant passer un appel déguisé.
    const sources = [SOURCE_ROUTE, SOURCE_MOTEUR, SOURCE_CONTRAT]
      .map((f) => readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));
    for (const s of sources) {
      expect(s).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(s).not.toMatch(/anthropic|groq|openai|replicate/i);
      expect(s).not.toContain('@/lib/credits');
      expect(s).not.toMatch(/ffmpeg|putObject|presignedGetObject/i);
      expect(s).not.toMatch(/export async function POST/);
    }
  });

  it('le moteur est PUR : aucune base, aucun réseau, aucun temps', () => {
    const moteur = readFileSync(SOURCE_MOTEUR, 'utf8');
    expect(moteur).not.toContain('supabase');
    expect(moteur).not.toMatch(/\bfetch\s*\(/);
    expect(moteur).not.toMatch(/Date\.now|new Date|Math\.random|process\.env/);
  });

  it('le budget de la route est celui d’un calcul local', () => {
    expect(maxDuration).toBe(30);
  });
});
