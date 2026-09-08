/**
 * A_7d1 — LE CÂBLAGE COMPLET, ET LA RÉSERVE D'A_7c REFERMÉE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE LOT FERME
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A_7c avait appris au projecteur à lire une transcription PAR SOURCE.
 * Personne ne la lui fournissait : `preparerCaptions` lisait `plan.clipSetId`,
 * que A_7M laisse NUL pour un plan multi-rush — parce qu'une colonne
 * d'identité ne peut pas parler au nom de plusieurs sources. Le préparateur
 * rendait donc `null`, et un montage multi-rush sortait SANS le moindre
 * sous-titre. Le repli était sûr ; il était incomplet.
 *
 * ⚠️ CE FICHIER TIENT AUSSI UNE INTERDICTION. Le manuel et l'automatique
 * doivent parcourir le MÊME code de préparation, de planification et
 * d'écriture. Deux implémentations divergeraient, et le jour où l'une serait
 * corrigée, l'autre continuerait — silencieusement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
/** Le code débarrassé de sa prose : un commentaire ne prouve rien. */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const UTILISATEUR = '99999999-9999-4999-8999-999999999999';

// ═══════════════════════════════════════════════════════════════════════════
// 1. LES TRANSCRIPTIONS PAR SOURCE
// ═══════════════════════════════════════════════════════════════════════════
const lireSetParId = vi.fn();
const lireTranscriptionParId = vi.fn();
const lireDerniereTranscriptionReussie = vi.fn();

vi.mock('@/lib/autopilot/analyse/clip-service', () => ({
  lireSetParId: (...a: unknown[]) => lireSetParId(...a),
}));
vi.mock('@/lib/autopilot/analyse/transcription-service', () => ({
  lireTranscriptionParId: (...a: unknown[]) => lireTranscriptionParId(...a),
  lireDerniereTranscriptionReussie: (...a: unknown[]) => lireDerniereTranscriptionReussie(...a),
}));

const mot = (texte: string, d: number, f: number) =>
  ({ texte, debutSecondes: d, finSecondes: f });

const segment = (ordre: number, clipSetId: string) => ({
  ordre, rangClip: ordre, bucket: 'videos', cle: `k${ordre}`,
  entreeSecondes: 0, dureeRetenueSecondes: 2, debutTimelineSecondes: (ordre - 1) * 2,
  raccourci: false, recadrage: null, strategieRecadrage: 'aucune',
  largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe' as const,
  source: {
    rushId: `r-${clipSetId}`, clipSetId, clipSetVersion: 1,
    rangClip: ordre, debutSourceSecondes: 0, finSourceSecondes: 2,
  },
});

const plan = (segments: unknown[], clipSetId: string | null = null) =>
  ({ id: 'p1', clipSetId, plans: segments } as never);

/** Un jeu de clips qui nomme SA transcription — la lignée d'A_7a. */
const jeu = (id: string, transcriptionId: string | null, rushId = `r-${id}`) =>
  ({ set: { id, transcriptionId, rushId, clips: [{ rang: 1, debutSecondes: 0 }] } });

const transcription = (mots: ReturnType<typeof mot>[]) =>
  ({ transcription: { etat: 'reussie', presente: true, mots } });

beforeEach(() => {
  lireSetParId.mockReset();
  lireTranscriptionParId.mockReset();
  lireDerniereTranscriptionReussie.mockReset();
  lireDerniereTranscriptionReussie.mockResolvedValue({ transcription: null });
});

describe('A_7d1 — chaque source apporte SA transcription', () => {
  it('A dit ALPHA, B dit BRAVO — deux jeux, deux transcriptions', async () => {
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');

    lireSetParId.mockImplementation(async (_u: string, id: string) =>
      jeu(id, id === A ? 'tA' : 'tB'));
    lireTranscriptionParId.mockImplementation(async (_u: string, id: string) =>
      transcription(id === 'tA' ? [mot('ALPHA', 0, 2)] : [mot('BRAVO', 0, 2)]));

    const m = await preparerCaptionsMultiSource(
      UTILISATEUR, plan([segment(1, A), segment(2, B)]),
    );

    expect(m?.motsParSource?.size).toBe(2);
    expect(m?.motsParSource?.get(A)?.[0].texte).toBe('ALPHA');
    expect(m?.motsParSource?.get(B)?.[0].texte).toBe('BRAVO');
    /* ⚠️ `mots` ET `clips` RESTENT VIDES. Leur laisser une matière de repli
       ouvrirait un chemin par lequel un segment pourrait lire les mots d'un
       autre rush. */
    expect(m?.mots).toEqual([]);
    expect(m?.clips).toEqual([]);
  });

  it('SEULES les sources réellement montées sont chargées', async () => {
    /* Six rushes ont pu être candidats pour trois retenus : charger les six
       coûterait trois lectures pour du texte que personne ne verra. */
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');
    lireSetParId.mockImplementation(async (_u: string, id: string) => jeu(id, `t-${id}`));
    lireTranscriptionParId.mockResolvedValue(transcription([mot('X', 0, 2)]));

    await preparerCaptionsMultiSource(UTILISATEUR, plan([segment(1, A), segment(2, B)]));

    expect(lireSetParId).toHaveBeenCalledTimes(2);
    const lus = lireSetParId.mock.calls.map((c) => c[1]);
    expect(lus).toEqual([A, B]);
    expect(lus).not.toContain(C);
  });

  it('une source citée deux fois n est lue qu une fois', async () => {
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');
    lireSetParId.mockImplementation(async (_u: string, id: string) => jeu(id, `t-${id}`));
    lireTranscriptionParId.mockResolvedValue(transcription([mot('X', 0, 2)]));

    await preparerCaptionsMultiSource(
      UTILISATEUR, plan([segment(1, A), segment(2, B), segment(3, A)]),
    );
    expect(lireSetParId).toHaveBeenCalledTimes(2);
  });

  /**
   * ⚠️ LA LIGNÉE, ET NON « LA DERNIÈRE EN DATE ».
   *
   * Un rush peut porter plusieurs analyses successives. Le plan, lui, référence
   * un jeu de clips précis, né d'une analyse précise. Prendre « la dernière
   * transcription du rush » servirait le texte d'une analyse qui n'a jamais
   * découpé ces clips-là : les mots seraient datés autrement que les coupes, et
   * les sous-titres dériveraient.
   */
  it('la transcription vient du JEU, pas de la dernière analyse du rush', async () => {
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');

    lireSetParId.mockImplementation(async (_u: string, id: string) => jeu(id, 'ancienne'));
    lireTranscriptionParId.mockResolvedValue(transcription([mot('HISTORIQUE', 0, 2)]));
    lireDerniereTranscriptionReussie.mockResolvedValue(
      transcription([mot('RECENTE', 0, 2)]),
    );

    const m = await preparerCaptionsMultiSource(
      UTILISATEUR, plan([segment(1, A), segment(2, B)]),
    );
    expect(m?.motsParSource?.get(A)?.[0].texte).toBe('HISTORIQUE');
    expect(lireTranscriptionParId).toHaveBeenCalledWith(UTILISATEUR, 'ancienne');
  });

  it('un jeu ANCIEN sans lien retombe sur la dernière réussie du rush', async () => {
    /* Le repli n'existe que pour les jeux écrits avant que le lien ne soit
       posé — pas comme commodité. */
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');
    lireSetParId.mockImplementation(async (_u: string, id: string) => jeu(id, null));
    lireDerniereTranscriptionReussie.mockResolvedValue(
      transcription([mot('REPLI', 0, 2)]),
    );

    const m = await preparerCaptionsMultiSource(
      UTILISATEUR, plan([segment(1, A), segment(2, B)]),
    );
    expect(m?.motsParSource?.get(A)?.[0].texte).toBe('REPLI');
    expect(lireTranscriptionParId).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ LE DÉFAUT QUE CE LOT REFUSE DE PRODUIRE. Emprunter les mots de A pour
   * les segments de B donnerait un sous-titre bien calé, parfaitement lisible,
   * disant autre chose que ce qu'on entend — le seul défaut de la chaîne qui
   * ne se voie qu'après publication.
   */
  it('une source SANS transcription n emprunte rien à ses voisines', async () => {
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');
    lireSetParId.mockImplementation(async (_u: string, id: string) =>
      jeu(id, id === A ? 'tA' : null));
    lireTranscriptionParId.mockResolvedValue(transcription([mot('ALPHA', 0, 2)]));

    const m = await preparerCaptionsMultiSource(
      UTILISATEUR, plan([segment(1, A), segment(2, B)]),
    );
    expect(m?.motsParSource?.has(A)).toBe(true);
    expect(m?.motsParSource?.has(B)).toBe(false);
    expect(m?.sourcesSansTranscription).toEqual([B]);
  });

  it('aucune source ne parle → aucun sous-titre, pas un montage perdu', async () => {
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');
    lireSetParId.mockImplementation(async (_u: string, id: string) => jeu(id, null));
    const m = await preparerCaptionsMultiSource(
      UTILISATEUR, plan([segment(1, A), segment(2, B)]),
    );
    expect(m).toBeNull();
  });

  it('un plan MONO-RUSH suit le chemin historique, inchangé', async () => {
    const { preparerCaptionsMultiSource } =
      await import('@/lib/autopilot/analyse/captions-service');
    lireSetParId.mockResolvedValue(jeu(A, 'tA'));
    lireTranscriptionParId.mockResolvedValue(transcription([mot('SEUL', 0, 2)]));

    // Aucun segment ne porte de provenance : c'est un plan d'avant A_7a.
    const sansSource = { ordre: 1, rangClip: 1, bucket: 'v', cle: 'k',
      entreeSecondes: 0, dureeRetenueSecondes: 2 };
    const m = await preparerCaptionsMultiSource(
      UTILISATEUR, plan([sansSource], A),
    );
    expect(m?.motsParSource).toBeUndefined();
    expect(m?.mots?.[0].texte).toBe('SEUL');
    expect(m?.clips).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE CÂBLAGE : LES DEUX CHEMINS, UN SEUL PRÉPARATEUR
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7d1 — manuel et automatique parcourent le même code', () => {
  const ROUTE = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
  const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
  const ORCHESTRE = sansProse(lire('src/lib/autopilot/automatique/multi-rush.ts'));

  it('les DEUX appelants fournissent les transcriptions par source', () => {
    /* ⚠️ C'EST LA RÉSERVE D'A_7c, ET SA FERMETURE SE LIT ICI. */
    expect(ROUTE).toContain('preparerCaptionsMultiSource(userId, plan!)');
    expect(CHAINE).toContain('preparerCaptionsMultiSource(userId, plan)');
    /* Plus aucun appelant sur l'ancien préparateur : deux préparations
       divergeraient, et l'une afficherait des sous-titres que l'autre ne
       montre pas, sur le même profil. */
    expect(ROUTE).not.toMatch(/[^i]preparerCaptions\(/);
    expect(CHAINE).not.toMatch(/[^i]preparerCaptions\(/);
  });

  it('la préparation des rushes est EXTRAITE, jamais recopiée', () => {
    expect(CHAINE).toContain('export async function preparerRush(');
    expect(CHAINE).toContain('export async function preparerJeuClips(');
    /* L'orchestrateur les APPELLE. En écrire une seconde version donnerait
       deux façons d'analyser et de découper. */
    expect(ORCHESTRE).toContain('preparerRush(userId, rushId, null, null)');
    expect(ORCHESTRE).toContain('preparerJeuClips(userId, pret.analysisId, pret.candidateSetId)');
    expect(ORCHESTRE).not.toContain('executerAnalyseRush');
    expect(ORCHESTRE).not.toContain('materialiserSet');
    expect(ORCHESTRE).not.toContain('calerCoupes');
  });

  it('l orchestrateur ne décide, ne rend et ne publie RIEN', () => {
    /* A_7b décide, A_7c rend, et personne ne publie : une création
       automatique n'est pas une publication automatique. */
    for (const interdit of ['noterFenetre', 'palierDeQualite', 'entrelacerSources',
      'rendreMontage', 'argumentsRendu', 'publier', 'social']) {
      expect(ORCHESTRE, `multi-rush ne doit pas contenir « ${interdit} »`)
        .not.toContain(interdit);
    }
  });

  it('il écrit par la RPC atomique, jamais en deux temps', () => {
    expect(ORCHESTRE).toContain('persisterPlanMultiRush');
    expect(ORCHESTRE).not.toContain('ecrireSourcesPlan');
    expect(ORCHESTRE).not.toMatch(/\bcreerPlan\b/);
  });

  it('il ne débite aucun crédit — un montage à 4 rushes reste UNE vidéo', () => {
    expect(ORCHESTRE).not.toContain('@/lib/credits');
    expect(ORCHESTRE).not.toContain('debiter');
  });

  it('il ne dépend d aucun cookie ni d aucun appel HTTP interne', () => {
    /* Le cron doit pouvoir l'utiliser tel quel. */
    for (const interdit of ['getServerSession', 'cookies(', 'fetch(', 'NextRequest']) {
      expect(ORCHESTRE, `multi-rush ne doit pas contenir « ${interdit} »`)
        .not.toContain(interdit);
    }
  });

  it('il réutilise les bornes d A_7b, sans en créer de secondes', () => {
    expect(ORCHESTRE).toContain('CONCURRENCE_PREPARATION');
    expect(ORCHESTRE).toContain('SOURCES_RETENUES_MIN');
    /* Pas de `Promise.all` sur la liste entière : huit analyses d'un coup
       exposent le compte à une limite de débit. */
    expect(ORCHESTRE).toContain('parPaquets');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. L'ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════
const preparerRush = vi.fn();
const preparerJeuClips = vi.fn();
const persister = vi.fn();
const historique = vi.fn();

vi.mock('@/lib/autopilot/automatique/chaine-serveur', () => ({
  preparerRush: (...a: unknown[]) => preparerRush(...a),
  preparerJeuClips: (...a: unknown[]) => preparerJeuClips(...a),
}));
vi.mock('@/lib/autopilot/analyse/montage-service', () => ({
  lireHistoriqueSources: (...a: unknown[]) => historique(...a),
  /* `persisterPlanMultiRush` d'A_7b importe la RPC depuis ce module : la
     remplacer entierement sans elle ferait echouer l'ecriture pour une raison
     qui n'a rien a voir avec ce qui est teste. */
  creerPlanMultiRushAtomique: (...a: unknown[]) => persister(...a),
}));

const clip = (rang: number, debut: number, fin: number, score: number) => ({
  rang, debutSecondes: debut, finSecondes: fin, dureeSecondes: fin - debut,
  bucket: 'videos', cle: `c${rang}.mp4`, octets: 1000,
  debutMesureSecondes: 0, dureeMesureeSecondes: fin - debut,
  scoreMontage: score, signaux: null,
});

const jeuPret = (id: string, rushId: string) => ({
  ok: true,
  set: {
    id, version: 1, algorithme: 'm3e-v4', methodeMaterialisation: 'ffmpeg-copy',
    clips: [clip(1, 0, 8, 90), clip(2, 20, 28, 86)],
  },
  analyse: { technique: { largeur: 1920, hauteur: 1080, fps: 30 }, dureeSecondes: 120 },
  rushId,
});

describe('A_7d1 — l orchestrateur ne rend jamais un faux multi', () => {
  beforeEach(() => {
    preparerRush.mockReset(); preparerJeuClips.mockReset();
    persister.mockReset(); historique.mockReset();
    historique.mockResolvedValue({ historique: [], motif: null });
    persister.mockResolvedValue({
      plan: { id: 'plan-multi', version: 1 }, issue: 'cree',
      sources: [], empreinte: 'abcdef0123456789abcdef01', motif: null,
    });
    preparerRush.mockImplementation(async (_u: string, rushId: string) =>
      ({ analysisId: `an-${rushId}`, candidateSetId: `ca-${rushId}` }));
  });

  it('une liste vide est refusée', async () => {
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    const r = await monterMultiRush({
      userId: UTILISATEUR, rushIds: [], format: '9:16', dureeCibleSecondes: 16,
    });
    expect(r.motif).toBe('aucun_rush');
    expect(preparerRush).not.toHaveBeenCalled();
  });

  it('les doublons ne sont préparés qu une fois', async () => {
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    preparerJeuClips.mockImplementation(async (_u: string, an: string) =>
      jeuPret(`set-${an}`, `rush-${an}`));
    await monterMultiRush({
      userId: UTILISATEUR, rushIds: ['r1', 'r1', 'r2'],
      format: '9:16', dureeCibleSecondes: 16,
    });
    expect(preparerRush).toHaveBeenCalledTimes(2);
  });

  it('un seul rush préparé → source_unique, jamais un plan à une source', async () => {
    /* ⚠️ Lui donner l'identité multi-rush le ferait basculer sous l'index
       d'empreinte d'A_7M, et ses MP4 déjà rendus deviendraient introuvables. */
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    preparerJeuClips.mockImplementation(async (_u: string, an: string) =>
      (an === 'an-r1' ? jeuPret('set-1', 'r1') : { sorte: 'echec', motif: 'clips_echoues' }));

    const r = await monterMultiRush({
      userId: UTILISATEUR, rushIds: ['r1', 'r2'], format: '9:16', dureeCibleSecondes: 16,
    });
    expect(r.motif).toBe('source_unique');
    expect(r.plan).toBeNull();
    /* L'appelant repart du chemin mono-rush historique, celui dont tous les
       rendus sont en base. */
    expect(r.rushUnique).toBe('r1');
    expect(r.ecartees).toEqual([{ rushId: 'r2', motif: 'clips_echoues' }]);
  });

  it('un échec partiel n emporte pas le montage entier', async () => {
    /* Sur trois rushes, il est NORMAL qu'un fournisseur en refuse un ; faire
       tomber tout le montage punirait les deux autres. */
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    const { persisterPlanMultiRush } = await import('@/lib/autopilot/analyse/montage-pool');
    void persisterPlanMultiRush;
    preparerJeuClips.mockImplementation(async (_u: string, an: string) =>
      (an === 'an-r2'
        ? { sorte: 'echec', motif: 'analyse_echouee' }
        : jeuPret(`set-${an}`, an.replace('an-', ''))));

    const r = await monterMultiRush({
      userId: UTILISATEUR, rushIds: ['r1', 'r2', 'r3'],
      format: '9:16', dureeCibleSecondes: 16,
    });
    expect(r.ecartees).toEqual([{ rushId: 'r2', motif: 'analyse_echouee' }]);
    // Deux sources ont survécu : le montage se fait.
    expect(r.motif).not.toBe('source_unique');
  });

  it('une géométrie illisible écarte la source, sans deviner', async () => {
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    preparerJeuClips.mockImplementation(async (_u: string, an: string) => {
      const j = jeuPret(`set-${an}`, an.replace('an-', ''));
      if (an === 'an-r2') return { ...j, analyse: { technique: {}, dureeSecondes: 120 } };
      return j;
    });
    const r = await monterMultiRush({
      userId: UTILISATEUR, rushIds: ['r1', 'r2'], format: '9:16', dureeCibleSecondes: 16,
    });
    expect(r.ecartees).toEqual([{ rushId: 'r2', motif: 'geometrie_inconnue' }]);
    expect(r.motif).toBe('source_unique');
  });

  it('la préparation se fait par paquets bornés', async () => {
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    const { CONCURRENCE_PREPARATION } = await import('@/lib/autopilot/analyse/montage-pool');
    let simultanees = 0;
    let maximum = 0;
    preparerRush.mockImplementation(async (_u: string, rushId: string) => {
      simultanees += 1; maximum = Math.max(maximum, simultanees);
      await new Promise((r) => { setTimeout(r, 5); });
      simultanees -= 1;
      return { analysisId: `an-${rushId}`, candidateSetId: `ca-${rushId}` };
    });
    preparerJeuClips.mockImplementation(async (_u: string, an: string) =>
      jeuPret(`set-${an}`, an.replace('an-', '')));

    await monterMultiRush({
      userId: UTILISATEUR, rushIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
      format: '9:16', dureeCibleSecondes: 16,
    });
    expect(maximum).toBeLessThanOrEqual(CONCURRENCE_PREPARATION);
  });

  it('une panne d historique ne fait pas perdre le montage', async () => {
    /* Mais elle n'invente pas non plus une récence : la diversité travaille
       alors sans historique, et c'est dit. */
    const { monterMultiRush } = await import('@/lib/autopilot/automatique/multi-rush');
    historique.mockRejectedValue(new Error('connexion perdue'));
    preparerJeuClips.mockImplementation(async (_u: string, an: string) =>
      jeuPret(`set-${an}`, an.replace('an-', '')));

    const r = await monterMultiRush({
      userId: UTILISATEUR, rushIds: ['r1', 'r2'], format: '9:16', dureeCibleSecondes: 16,
    });
    expect(r.motif).not.toBe('plan_impossible');
  });
});
