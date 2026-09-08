/**
 * A_7d4 — LA PREUVE D'INTÉGRATION : DU CLIC AU GRAPHE FFMPEG.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI « LE SERVICE A ÉTÉ APPELÉ » NE PROUVE RIEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vérifier qu'un service a été appelé prouve qu'un appel existe, pas qu'il
 * aboutit. Entre le clic et l'image, six couches peuvent perdre les sources en
 * silence : la préparation peut n'en garder qu'une, le planificateur peut les
 * écarter, la persistance peut n'en écrire qu'une, le renderer peut n'ouvrir
 * qu'une entrée. Chacune de ces pertes produit une vidéo VALIDE — bonne durée,
 * bonne résolution — et fausse.
 *
 * Ce banc part donc de la demande manuelle et va jusqu'aux ARGUMENTS FFMPEG,
 * en traversant les VRAIS modules : `monterMultiRush` (A_7d), le planificateur
 * `planifierMontageMultiRush` (A_7b), et `argumentsRendu` (A_7c). Seules la
 * préparation des rushes et l'écriture en base sont simulées — l'une appelle
 * des fournisseurs payants, l'autre demande un PostgreSQL.
 *
 * ⚠️ AUCUN PLAN N'EST FABRIQUÉ À LA MAIN. Le plan qui arrive au renderer est
 * celui qu'A_7b a réellement calculé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const preparerRush = vi.fn();
const preparerJeuClips = vi.fn();
const creerPlanMultiRushAtomique = vi.fn();
const lireHistoriqueSources = vi.fn();

vi.mock('@/lib/autopilot/automatique/chaine-serveur', () => ({
  preparerRush: (...a: unknown[]) => preparerRush(...a),
  preparerJeuClips: (...a: unknown[]) => preparerJeuClips(...a),
}));
vi.mock('@/lib/autopilot/analyse/montage-service', () => ({
  creerPlanMultiRushAtomique: (...a: unknown[]) => creerPlanMultiRushAtomique(...a),
  lireHistoriqueSources: (...a: unknown[]) => lireHistoriqueSources(...a),
}));

const UTILISATEUR = '99999999-9999-4999-8999-999999999999';
const RUSH = (n: number) => `${String(n).repeat(8)}-2222-4222-8222-222222222222`;
const JEU = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

/* ⚠️ LA CLE PORTE LE JEU, comme en production : `cleClip` de M3-F la fabrique
   sur `(clipSetId, rang)`. Une cle qui ne dependrait que du rang ferait
   collisionner le clip 1 de A et le clip 1 de B — et le montage servirait
   quatre fois le meme fichier sans qu'aucune duree ne bouge. */
const clip = (jeu: string, rang: number, debut: number, fin: number, score: number) => ({
  rang, debutSecondes: debut, finSecondes: fin, dureeSecondes: fin - debut,
  bucket: 'videos', cle: `u/clips/${jeu}/${rang}.mp4`, octets: 1000,
  debutMesureSecondes: 0, dureeMesureeSecondes: fin - debut,
  scoreMontage: score, signaux: null,
});

/** Un rush préparé, avec des clips reconnaissables et sa propre géométrie. */
const jeuPret = (n: number, scores: number[]) => ({
  ok: true,
  rushId: RUSH(n),
  set: {
    id: JEU(n), version: 1,
    algorithme: 'm3e-v4', methodeMaterialisation: 'ffmpeg-copy',
    /* Chaque rush porte ses passages À DES INSTANTS DIFFÉRENTS : si le
       montage confondait deux sources, les bornes le diraient. */
    clips: scores.map((s, i) =>
      clip(JEU(n), i + 1, n * 100 + i * 20, n * 100 + i * 20 + 8, s)),
  },
  analyse: {
    technique: { largeur: 1920, hauteur: 1080, fps: 30 },
    dureeSecondes: 600,
  },
});

beforeEach(() => {
  preparerRush.mockReset(); preparerJeuClips.mockReset();
  creerPlanMultiRushAtomique.mockReset(); lireHistoriqueSources.mockReset();
  lireHistoriqueSources.mockResolvedValue({ historique: [], motif: null });
  preparerRush.mockImplementation(async (_u: string, rushId: string) =>
    ({ analysisId: `an-${rushId}`, candidateSetId: `ca-${rushId}` }));
  /* La persistance rend le plan TEL QU'ON LE LUI A DONNÉ : c'est le contrat
     d'A_7B0, et cela laisse le banc lire les segments réellement calculés. */
  creerPlanMultiRushAtomique.mockImplementation(
    async (_u: string, _s: unknown, _i: unknown, contenu: { plans: unknown[] }) => ({
      plan: { id: 'plan-multi', version: 1, plans: contenu.plans },
      issue: 'cree', sources: [], empreinte: 'abcdef0123456789abcdef01', motif: null,
    }),
  );
});

describe('A_7d4 — du clic manuel au graphe ffmpeg', () => {
  it('trois rushes choisis arrivent au renderer comme TROIS entrées', async () => {
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    const { argumentsRendu } = await import('@/lib/autopilot/analyse/rendu-ffmpeg');
    const { rendreEstPossible } = await import('@/lib/autopilot/analyse/montage-pool');

    preparerJeuClips.mockImplementation(async (_u: string, an: string) => {
      const n = Number(an.slice(3, 4));
      return jeuPret(n, [92 - n, 88 - n]);
    });

    const issue = await monterMultiRush({
      userId: UTILISATEUR,
      rushIds: [RUSH(1), RUSH(2), RUSH(3)],
      format: '9:16',
      dureeCibleSecondes: 24,
    });

    expect(issue.motif).toBeNull();
    const segments = issue.plan?.plans ?? [];
    expect(segments.length).toBeGreaterThanOrEqual(3);

    /* ── 1. LE PLAN EST BIEN MULTI-SOURCE ─────────────────────────────── */
    const jeux = new Set(segments.map((s) => s.source?.clipSetId));
    expect(jeux.size).toBeGreaterThanOrEqual(2);

    /* ── 2. LE RENDU EST AUTORISÉ ─────────────────────────────────────── */
    expect(rendreEstPossible(segments).possible).toBe(true);

    /* ── 3. LE GRAPHE OUVRE UNE ENTRÉE PAR SEGMENT ────────────────────── */
    const args = argumentsRendu(
      segments.map((s, i) => ({
        ordre: i + 1,
        chemin: `/tmp/${s.cle}`,
        entreeSecondes: s.entreeSecondes,
        dureeRetenueSecondes: s.dureeRetenueSecondes,
        crop: { largeur: 1080, hauteur: 1080, x: 420, y: 0 },
        aAudio: true,
      })),
      { largeur: 1080, hauteur: 1920, fps: 30 },
      '/tmp/out.mp4',
    );

    const entrees = args.filter((a, i) => args[i - 1] === '-i');
    expect(entrees).toHaveLength(segments.length);
    /* ⚠️ DES FICHIERS DISTINCTS : si le montage servait le même clip partout,
       la durée serait juste et la vidéo fausse. */
    expect(new Set(entrees).size).toBe(segments.length);

    /* ── 4. CHAQUE BRANCHE PREND SON AUDIO SUR SON PROPRE INDEX ───────── */
    const graphe = args[args.indexOf('-filter_complex') + 1];
    for (let i = 0; i < segments.length; i += 1) {
      expect(graphe, `la branche vidéo ${i} manque`).toContain(`[${i}:v]trim=`);
      expect(graphe, `la branche audio ${i} manque`).toContain(`[${i}:a]atrim=`);
    }
  });

  it('l ORDRE décidé par A_7b arrive intact au graphe', async () => {
    /* ⚠️ LE RENDERER N'EST PAS UN SECOND DÉCIDEUR. Il exécute le plan ; le
       réordonner ici donnerait un film que personne n'a choisi. */
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    const { argumentsRendu } = await import('@/lib/autopilot/analyse/rendu-ffmpeg');

    preparerJeuClips.mockImplementation(async (_u: string, an: string) => {
      const n = Number(an.slice(3, 4));
      return jeuPret(n, [92 - n, 88 - n]);
    });

    const issue = await monterMultiRush({
      userId: UTILISATEUR, rushIds: [RUSH(1), RUSH(2), RUSH(3)],
      format: '9:16', dureeCibleSecondes: 24,
    });
    const segments = issue.plan?.plans ?? [];
    const attendu = segments.map((s) => s.cle);

    const args = argumentsRendu(
      segments.map((s, i) => ({
        ordre: i + 1, chemin: s.cle,
        entreeSecondes: s.entreeSecondes,
        dureeRetenueSecondes: s.dureeRetenueSecondes,
        crop: { largeur: 1080, hauteur: 1080, x: 420, y: 0 }, aAudio: true,
      })),
      { largeur: 1080, hauteur: 1920, fps: 30 }, '/tmp/out.mp4',
    );
    const entrees = args.filter((a, i) => args[i - 1] === '-i');
    expect(entrees).toEqual(attendu);
  });

  it('chaque segment garde SA plage dans SON rush', async () => {
    /* Deux rushes filmés aux mêmes secondes ne montrent pas la même chose ; la
       plage source est celle du rush d'origine, jamais une horloge commune. */
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    preparerJeuClips.mockImplementation(async (_u: string, an: string) => {
      const n = Number(an.slice(3, 4));
      return jeuPret(n, [90, 86]);
    });

    const issue = await monterMultiRush({
      userId: UTILISATEUR, rushIds: [RUSH(1), RUSH(2)],
      format: '9:16', dureeCibleSecondes: 24,
    });

    for (const s of issue.plan?.plans ?? []) {
      const src = s.source;
      expect(src).toBeDefined();
      /* Les clips du rush n commencent vers n*100 : la plage source doit
         tomber dans SA fenêtre, pas dans celle du voisin. */
      const n = Number(String(src?.rushId ?? '').slice(0, 1));
      expect(src?.debutSourceSecondes).toBeGreaterThanOrEqual(n * 100);
      expect(src?.debutSourceSecondes).toBeLessThan((n + 1) * 100);
      /* Et la plage MONTAGE est un autre référentiel : elle part de zéro. */
      expect(s.debutTimelineSecondes).toBeLessThan(24);
    }
  });

  it('la persistance reçoit les MÊMES segments que le renderer', async () => {
    /* ⚠️ SINON LE PLAN EN BASE DÉCRIRAIT UNE AUTRE VIDÉO que celle rendue, et
       la relecture d'un rendu réussi servirait un fichier qui ne correspond
       plus à son plan. */
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    preparerJeuClips.mockImplementation(async (_u: string, an: string) => {
      const n = Number(an.slice(3, 4));
      return jeuPret(n, [90, 86]);
    });

    const issue = await monterMultiRush({
      userId: UTILISATEUR, rushIds: [RUSH(1), RUSH(2)],
      format: '9:16', dureeCibleSecondes: 24,
    });

    const [, sources, , contenu] = creerPlanMultiRushAtomique.mock.calls[0] as [
      string, { clipSetId: string }[], unknown, { plans: { cle: string }[] },
    ];
    expect(contenu.plans.map((p) => p.cle))
      .toEqual((issue.plan?.plans ?? []).map((p) => p.cle));
    /* Et les sources déclarées sont celles que les segments citent. */
    const citees = new Set((issue.plan?.plans ?? []).map((p) => p.source?.clipSetId));
    expect(new Set(sources.map((s) => s.clipSetId))).toEqual(citees);
  });

  it('une seule source exploitable NE produit aucun plan multi', async () => {
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    preparerJeuClips.mockImplementation(async (_u: string, an: string) =>
      (an === 'an-' + RUSH(1)
        ? jeuPret(1, [90, 86])
        : { sorte: 'echec', motif: 'analyse_echouee' }));

    const issue = await monterMultiRush({
      userId: UTILISATEUR, rushIds: [RUSH(1), RUSH(2)],
      format: '9:16', dureeCibleSecondes: 24,
    });
    expect(issue.motif).toBe('source_unique');
    expect(creerPlanMultiRushAtomique).not.toHaveBeenCalled();
  });
});
