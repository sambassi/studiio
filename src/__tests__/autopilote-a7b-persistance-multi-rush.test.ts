/**
 * A_7b — LA PERSISTANCE D'UN PLAN MULTI-RUSH PASSE PAR A_7B0, ET PAR LUI SEUL.
 *
 * ⚠️ CE FICHIER TIENT UNE INTERDICTION, PAS UNE FONCTIONNALITÉ. Écrire le plan
 * puis ses sources en deux appels laisserait, si le second échoue, un plan
 * portant une empreinte qui décrit une matière absente de la base —
 * indiscernable, pour A_7M, d'un plan amputé par la suppression d'un jeu de
 * clips. Le jour où quelqu'un « simplifierait » en appelant `creerPlan`
 * directement, c'est ici que ça doit casser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) },
}));

const UUID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const RUSH = (n: number) => `${String(n).repeat(8)}-2222-4222-8222-222222222222`;
const UTILISATEUR = '99999999-9999-4999-8999-999999999999';

const segment = (n: number, ordre: number) => ({
  ordre, rangClip: 1, bucket: 'videos', cle: `k${n}`,
  entreeSecondes: 0, dureeRetenueSecondes: 4, debutTimelineSecondes: (ordre - 1) * 4,
  raccourci: false, recadrage: null, strategieRecadrage: 'aucune',
  largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe' as const,
  source: {
    rushId: RUSH(n), clipSetId: UUID(n), clipSetVersion: 1,
    rangClip: 1, debutSourceSecondes: 0, finSourceSecondes: 4,
  },
});

function resultat(sources: { clipSetId: string; clipSetVersion: number }[]) {
  return {
    segments: sources.map((s, i) => segment(Number(s.clipSetId[0]), i + 1)),
    sources,
    empreinteSources: 'abcdef0123456789abcdef01',
    algorithmePlan: 'm3g-v2+ms1',
    politique: { algorithmePlan: 'm3g-v2', objectiveAware: false, motif: null,
      ordreRangs: [], notes: {} },
    dureeTotaleSecondes: 8, ecartSecondes: 0, clipsEcartes: 0,
    usage: {}, pool: { candidats: [], clips: [], contextes: [], sources },
  };
}

const DEMANDE = {
  format: '9:16' as const, dureeCibleSecondes: 16, fps: 30,
  largeurCible: 1080, hauteurCible: 1920,
};
const IDENTITE = { algorithme: 'm3e-v4', methodeMaterialisation: 'ffmpeg-copy' };

beforeEach(() => { rpc.mockReset(); from.mockReset(); });

describe('A_7b — la persistance est atomique', () => {
  it('un plan A,B,C part en UNE transaction A_7B0', async () => {
    const { persisterPlanMultiRush } = await import('@/lib/autopilot/analyse/montage-pool');
    rpc.mockResolvedValue({ data: [{ issue: 'cree', plan_id: null, cree: true }], error: null });

    const sources = [1, 2, 3].map((n) => ({ clipSetId: UUID(n), clipSetVersion: 1 }));
    await persisterPlanMultiRush(
      UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    const [nom, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(nom).toBe('creer_plan_montage_multi_rush');
    expect(args.p_sources).toHaveLength(3);
    /* ⚠️ AUCUN `from('rush_montage_plans')` : la seule écriture est la RPC. */
    expect(from).not.toHaveBeenCalled();
  });

  it('le marqueur multi-source voyage dans algorithme_plan', async () => {
    const { persisterPlanMultiRush } = await import('@/lib/autopilot/analyse/montage-pool');
    rpc.mockResolvedValue({ data: [{ issue: 'cree', plan_id: null, cree: true }], error: null });
    const sources = [1, 2].map((n) => ({ clipSetId: UUID(n), clipSetVersion: 1 }));
    await persisterPlanMultiRush(UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE);
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_algorithme_plan).toBe('m3g-v2+ms1');
  });

  it('une source invalide ne crée aucun plan', async () => {
    const { persisterPlanMultiRush } = await import('@/lib/autopilot/analyse/montage-pool');
    rpc.mockResolvedValue({
      data: [{ issue: 'source_inconnue', plan_id: null, cree: false }], error: null,
    });
    const sources = [1, 2].map((n) => ({ clipSetId: UUID(n), clipSetVersion: 1 }));
    const r = await persisterPlanMultiRush(
      UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE,
    );
    expect(r.issue).toBe('source_inconnue');
    expect(r.plan).toBeNull();
  });

  it('le même plan deux fois ne fait qu un plan logique', async () => {
    const { persisterPlanMultiRush } = await import('@/lib/autopilot/analyse/montage-pool');
    const sources = [1, 2].map((n) => ({ clipSetId: UUID(n), clipSetVersion: 1 }));

    rpc.mockResolvedValueOnce({ data: [{ issue: 'cree', plan_id: null, cree: true }], error: null });
    rpc.mockResolvedValueOnce({ data: [{ issue: 'existant', plan_id: null, cree: false }], error: null });

    const un = await persisterPlanMultiRush(UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE);
    const deux = await persisterPlanMultiRush(UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE);
    expect(un.issue).toBe('cree');
    expect(deux.issue).toBe('existant');
  });

  it('deux appels concurrents identiques ne font qu un plan', async () => {
    /* ⚠️ L'IDEMPOTENCE VIENT DE L'INDEX, PAS D'UN `if`. Le second appel est
       refusé par la base puis rattrapé : c'est A_7B0 qui le prouve sur un vrai
       PostgreSQL ; ici on vérifie seulement que rien ne l'intercepte avant. */
    const { persisterPlanMultiRush } = await import('@/lib/autopilot/analyse/montage-pool');
    const sources = [1, 2].map((n) => ({ clipSetId: UUID(n), clipSetVersion: 1 }));
    rpc.mockResolvedValue({ data: [{ issue: 'existant', plan_id: null, cree: false }], error: null });

    const [a, b] = await Promise.all([
      persisterPlanMultiRush(UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE),
      persisterPlanMultiRush(UTILISATEUR, resultat(sources) as never, IDENTITE, DEMANDE),
    ]);
    expect([a.issue, b.issue]).toEqual(['existant', 'existant']);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

/**
 * ⚠️ LE CODE, PAS LES COMMENTAIRES — et le dépôt tient déjà cette règle pour
 * la garde des migrations : « un commentaire a le droit d'annoncer la suite ».
 * `montage-pool` EXPLIQUE en prose pourquoi il n'appelle ni `ecrireSourcesPlan`
 * ni `Math.random` ; le compter comme fautif pour l'avoir dit interdirait
 * d'écrire la raison d'une décision. Ce qui est interdit, c'est de l'exécuter.
 */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('A_7b — ce que le module ne fait pas', () => {
  const src = sansProse(readFileSync(
    path.join(process.cwd(), 'src/lib/autopilot/analyse/montage-pool.ts'), 'utf8',
  ));

  it('il n écrit jamais le plan et les sources séparément', () => {
    expect(src).not.toContain('ecrireSourcesPlan');
    expect(src).not.toMatch(/\bcreerPlan\b/);
    expect(src).toContain('creerPlanMultiRushAtomique');
  });

  it('il ne débite aucun crédit — un montage à 4 rushes reste UNE vidéo', () => {
    expect(src).not.toContain('@/lib/credits');
    expect(src).not.toContain('debiter');
  });

  it('il ne réécrit ni le scoring, ni les signaux, ni le moteur de coupe', () => {
    /* Exigence n°3 : pas de `m3g-v4-multirush` copié de `m3g-v3`. Le pool
       consomme `politiqueDePlan` et `planifierMontage`, il ne les duplique pas. */
    expect(src).toContain("from './objectif-score'");
    expect(src).toContain("from './montage'");
    expect(src).not.toContain('noterFenetre');
    expect(src).not.toContain('poidsDeLObjectif');
    expect(src).not.toContain('COUVERTURE_MAX_RUSH');
    expect(src).not.toContain('ECART_MOMENTS_MIN');
  });

  it('il ne recrée pas un second algorithme d empreinte', () => {
    expect(src).toContain('empreinteJeuxSources');
    expect(src).not.toContain('createHash');
    expect(src).not.toContain('sha256');
  });

  it('il ne touche ni au renderer, ni aux captions, ni à l audio', () => {
    for (const interdit of ['rendu-ffmpeg', 'captions-', 'recette-audio', 'voix']) {
      expect(src, `montage-pool ne doit pas importer « ${interdit} »`)
        .not.toContain(interdit);
    }
  });

  it('il n a ni horloge ni tirage au sort', () => {
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('new Date');
  });
});

describe('A_7b — le moteur M3-G n a pas été forké', () => {
  const moteur = sansProse(readFileSync(
    path.join(process.cwd(), 'src/lib/autopilot/analyse/montage.ts'), 'utf8',
  ));

  it('il n existe qu UNE fonction de planification', () => {
    const planificateurs = moteur.match(/export function planifier[A-Za-z]*/g) ?? [];
    expect(planificateurs).toEqual(['export function planifierMontage']);
  });

  it('les garde-fous éditoriaux n existent qu en un exemplaire', () => {
    /* Un second exemplaire serait corrigé une fois sur deux. */
    for (const garde of ['COUVERTURE_MAX_RUSH', 'ECART_MOMENTS_MIN_SECONDES',
      'DUREE_PLAN_MIN_SECONDES', 'PLANS_MAX']) {
      const occurrences = (moteur.match(new RegExp(`\\b${garde}\\b`, 'g')) ?? []).length;
      /* Un import et deux ou trois usages : c'est le compte d'AVANT le lot.
         Un fork en aurait doublé chacun. */
      expect(occurrences, `${garde} apparaît ${occurrences} fois`).toBeLessThanOrEqual(4);
    }
  });

  it('ALGORITHME_PLAN reste m3g-v2', async () => {
    const { ALGORITHME_PLAN } = await import('@/lib/autopilot/analyse/montage-contrat');
    expect(ALGORITHME_PLAN).toBe('m3g-v2');
  });
});

describe('A_7b — la récence inter-vidéos se lit sur le parc réel', () => {
  it('l historique est rendu du plus RÉCENT au plus ancien', async () => {
    const { lireHistoriqueSources } = await import('@/lib/autopilot/analyse/montage-service');

    const plans = { id: 'x' };
    from.mockImplementation((table: string) => {
      if (table === 'rush_montage_plans') {
        const q: Record<string, unknown> = {};
        q.select = () => q; q.eq = () => q; q.order = () => q;
        q.limit = () => Promise.resolve({
          data: [{ id: 'p1' }, { id: 'p2' }], error: null,
        });
        return q;
      }
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q;
      q.in = () => Promise.resolve({
        data: [
          { plan_id: 'p2', clip_set_id: UUID(2) },
          { plan_id: 'p1', clip_set_id: UUID(1) },
        ],
        error: null,
      });
      return q;
    });
    void plans;

    const r = await lireHistoriqueSources(UTILISATEUR, 10);
    expect(r.historique).toEqual([[UUID(1)], [UUID(2)]]);
    expect(r.motif).toBeNull();
  });

  it('une panne de lecture n est PAS traduite en « aucun historique »', async () => {
    /* ⚠️ Rendre un tableau vide ferait croire à la diversité que toutes les
       sources sont fraîches, et le même rush reviendrait à chaque cycle. */
    const { lireHistoriqueSources } = await import('@/lib/autopilot/analyse/montage-service');
    from.mockImplementation(() => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.order = () => q;
      q.limit = () => Promise.resolve({
        data: null, error: { code: '08006', message: 'connexion perdue' },
      });
      return q;
    });
    await expect(lireHistoriqueSources(UTILISATEUR)).rejects.toThrow(/connexion perdue/);
  });

  it('socle absent → historique vide ET motif, jamais un silence', async () => {
    const { lireHistoriqueSources } = await import('@/lib/autopilot/analyse/montage-service');
    from.mockImplementation(() => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.order = () => q;
      q.limit = () => Promise.resolve({
        data: null, error: { code: 'PGRST205', message: 'schema cache' },
      });
      return q;
    });
    const r = await lireHistoriqueSources(UTILISATEUR);
    expect(r.historique).toEqual([]);
    expect(r.motif).toBe('socle_absent');
  });
});
