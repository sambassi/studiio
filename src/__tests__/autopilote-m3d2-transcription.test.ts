// @vitest-environment node
/**
 * M3-D2 — LA TRANSCRIPTION À LA DEMANDE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE EN PRIORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois défauts coûteraient cher, et ce sont eux que les tests visent :
 *
 *   1. PAYER DEUX FOIS. Deux requêtes simultanées, un double clic, une ligne
 *      abandonnée qui bloque à jamais — l'idempotence est en base, et elle
 *      est vérifiée en base.
 *   2. LAISSER UN FICHIER. M3-D2 est le premier lot qui ÉCRIT sur le disque
 *      du conteneur. Un `finally` manqué le remplit, silencieusement, une
 *      transcription à la fois.
 *   3. APPELER SANS LE VOULOIR. Drapeau ouvert, modèle absent, clé absente,
 *      rush muet : dans les quatre cas, zéro octet doit sortir.
 *
 * ⚠️ AUCUN APPEL GROQ. Le transport est injecté, le lancement de processus
 * est doublé, et un test prouve que `fetch` global n'est jamais touché.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ───────────────────────────────────────────────────────────────────────────
// Stockage, authentification, ffmpeg — tous doublés
// ───────────────────────────────────────────────────────────────────────────
const URL_SIGNEE = 'http://studiio-minio:9000/media/A/rush/p.mp4?X-Amz-Signature=deadbeef';
let signeurCasse = false;

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  signeurInterne: () => (signeurCasse ? null : {
    presignedGetObject: async () => URL_SIGNEE,
  }),
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'A' } }) }));

/** Quand vrai, `rm` échoue — comme un `EBUSY` ou un volume en lecture seule. */
let rmCasse = false;
/** Les répertoires que `rm` s'est vu demander de supprimer. */
const rmDemandes: string[] = [];

vi.mock('fs/promises', async (orig) => {
  const reel = await orig<typeof import('fs/promises')>();
  return {
    ...reel,
    rm: async (chemin: string, options?: object) => {
      rmDemandes.push(chemin);
      if (rmCasse) {
        // Le message d'un vrai échec système PORTE le chemin — c'est
        // précisément ce qui ne doit jamais ressortir.
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, rm '${chemin}'`), { code: 'EBUSY' },
        );
      }
      return reel.rm(chemin, options as never);
    },
  };
});

/** Les chemins que ffmpeg s'est vu demander d'écrire. Pour prouver la suppression. */
const cheminsProduits: string[] = [];
/** Ce que le faux ffmpeg doit faire. */
let ffmpeg: { code: number; introuvable?: boolean; timeout?: boolean; octets?: number } =
  { code: 0, octets: 4096 };

vi.mock('@/lib/autopilot/analyse/extraction', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lancer: async (_b: string, args: string[]) => {
    const sortie = args[args.length - 1];
    cheminsProduits.push(sortie);
    // Un vrai ffmpeg écrit le fichier. Le doubler sans l'écrire ferait passer
    // le test de suppression sur un fichier qui n'a jamais existé.
    if (ffmpeg.code === 0 && !ffmpeg.introuvable && !ffmpeg.timeout) {
      writeFileSync(sortie, Buffer.alloc(ffmpeg.octets ?? 4096, 0x66));
    }
    return {
      code: ffmpeg.code, codeSysteme: null, signal: null,
      stdout: Buffer.alloc(0), stderr: '',
      timeout: Boolean(ffmpeg.timeout), introuvable: Boolean(ffmpeg.introuvable),
    };
  },
}));

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec les index uniques APPLIQUÉS
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
const tentativesInsertion: Array<{ table: string; valeurs: Ligne }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };
const doublon = (i: string) => ({
  code: '23505', message: `duplicate key value violates unique constraint "${i}"`,
});
const actif = (e: unknown) => e === 'en_attente' || e === 'en_cours';

/** Les deux index uniques de `rush_transcriptions`, appliqués. */
function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const memeRush = (tables.rush_transcriptions ?? []).filter((l) => l.rush_id === valeurs.rush_id);
  if (memeRush.some((l) => l.version === valeurs.version)) {
    return doublon('rush_transcriptions_rush_version_unique');
  }
  if (actif(valeurs.etat) && memeRush.some((l) => actif(l.etat))) {
    return doublon('rush_transcriptions_active_unique');
  }
  return null;
}

const maintenantIso = () => new Date().toISOString();

function anterieurA(valeur: unknown, borne: unknown): boolean {
  const a = Date.parse(String(valeur));
  const b = Date.parse(String(borne));
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const filtresIn: Array<[string, unknown[]]> = [];
  const filtresLt: Array<[string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMettreAJour: Ligne | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v)
        && filtresIn.every(([c, vs]) => vs.includes(l[c]))
        && filtresLt.every(([c, v]) => anterieurA(l[c], v)),
    );
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.colonne] ?? 0); const y = Number(b[tri!.colonne] ?? 0);
        return tri!.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = () => {
    if (tableAbsente === table) return { data: null, error: erreurTable };

    if (aInserer) {
      const valeurs: Ligne = { version: 1, etat: 'en_attente', ...aInserer };
      tentativesInsertion.push({ table, valeurs: aInserer });
      if (table === 'rush_transcriptions') {
        // La clé étrangère COMPOSITE : le rush doit exister ET être à lui.
        const rush = (tables.rushes ?? []).find(
          (r) => r.id === valeurs.rush_id && r.user_id === valeurs.user_id,
        );
        if (!rush) {
          return {
            data: null,
            error: {
              code: '23503',
              message: 'violates foreign key constraint "rush_transcriptions_rush_proprietaire"',
            },
          };
        }
        const refus = refusUnicite(valeurs);
        if (refus) return { data: null, error: refus };
      }
      const ligne: Ligne = {
        id: `t-${(tables[table] ?? []).length + 1}`,
        etape: null, fournisseurs: {}, presente: false, langue: null, texte: '',
        segments: [], mots: [], usage: {}, motif_echec: null,
        created_at: maintenantIso(), started_at: null, completed_at: null,
        updated_at: maintenantIso(),
        ...valeurs,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      const cibles = lignes() ?? [];
      if (cibles.length === 0) return { data: null, error: null };
      const patch = aMettreAJour;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      const misAJour = (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null;
      return { data: misAJour, error: null };
    }

    const l = lignes();
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { filtresIn.push([c, vs]); return api; },
    lt: (c: string, v: unknown) => { filtresLt.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => { aInserer = valeurs; return api; },
    update: (valeurs: Ligne) => { aMettreAJour = valeurs; return api; },
    maybeSingle: async () => executer(),
    // ⚠️ UN `update(...).select()` AWAITÉ SANS `maybeSingle` DOIT ÉCRIRE.
    //
    // `recupererTranscriptionsInterrompues` est exactement de cette forme.
    // Une doublure qui traiterait ce `then` comme une simple lecture ferait
    // passer le test de péremption sans que rien n'ait jamais été fermé —
    // le pire des tests, celui qui rassure à tort.
    then: (resoudre: (v: unknown) => unknown) => {
      if (aInserer || aMettreAJour) {
        const cibles = lignes() ?? [];
        const r = executer() as { data: unknown; error: unknown };
        if (r.error) return resoudre({ data: null, error: r.error });
        return resoudre({ data: aMettreAJour ? cibles : [r.data], error: null });
      }
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

import {
  normaliserIntervalles, lireReponseTranscription, transcriptionPourBase,
  langueValide, transcriptionSansAudio, intervalleValide,
  SEGMENTS_MAX, MOTS_MAX, TEXTE_MAX, SEGMENT_TEXTE_MAX, MOT_TEXTE_MAX,
  FLAC_OCTETS_MAX, REPONSE_MAX_OCTETS, PEREMPTION_TRANSCRIPTION_MS,
  seuilPeremptionTranscription, MOTIFS_TRANSCRIPTION, FOURNISSEUR_TRANSCRIPTION,
  MOTIF_NETTOYAGE_ECHOUE, CLE_USAGE_NETTOYAGE,
} from '@/lib/autopilot/analyse/transcription-contrat';
import {
  argumentsFlac, avecAudioFlac, TIMEOUT_FLAC_MS, BUDGET_FLAC_MS, FREQUENCE_HZ, CANAUX,
} from '@/lib/autopilot/analyse/transcription-audio';
import {
  definirFournisseurTranscription, TIMEOUT_TRANSCRIPTION_MS, SECONDES_MIN_FACTUREES,
} from '@/lib/autopilot/analyse/transcription';
import {
  fournisseurTranscriptionGroq, transcriptionGroqActive,
  ConfigurationTranscriptionInvalide, type TransportTranscription,
} from '@/lib/autopilot/analyse/transcription-groq';
import {
  creerTranscription, recupererTranscriptionsInterrompues,
  MOTIF_TRANSCRIPTION_INTERROMPUE,
} from '@/lib/autopilot/analyse/transcription-service';
import {
  reinitialiserCapacite, prendrePlaceTranscription, transcriptionsEnCoursMaintenant,
  MAX_TRANSCRIPTIONS_SIMULTANEES,
} from '@/lib/autopilot/analyse/capacite';

const { POST, GET, maxDuration } = await import(
  '@/app/api/autopilot/rushes/[id]/transcription/route'
);

const MIGRATION = resolve(process.cwd(), 'migrations/2026-09-03-rush-transcriptions.sql');
const SOURCE_ROUTE = resolve(
  process.cwd(), 'src/app/api/autopilot/rushes/[id]/transcription/route.ts',
);
const SOURCES = [
  'src/lib/autopilot/analyse/transcription-contrat.ts',
  'src/lib/autopilot/analyse/transcription-audio.ts',
  'src/lib/autopilot/analyse/transcription.ts',
  'src/lib/autopilot/analyse/transcription-groq.ts',
  'src/lib/autopilot/analyse/transcription-service.ts',
  'src/lib/autopilot/analyse/moteur-transcription.ts',
].map((p) => resolve(process.cwd(), p));

const RUSH: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/p.mp4', nom_origine: 'p.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: 38.165, rang: 0, etat: 'verifie',
  metadata: {}, created_at: maintenantIso(), updated_at: maintenantIso(),
};

/** Une réponse `verbose_json` telle que la documentation la décrit. */
function verboseJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    task: 'transcribe',
    language: 'french',
    duration: 38.165,
    text: 'Bonjour tout le monde. On danse.',
    segments: [
      { id: 0, start: 0.5, end: 2.2, text: 'Bonjour tout le monde.' },
      { id: 1, start: 2.4, end: 4.0, text: 'On danse.' },
    ],
    words: [
      { word: 'Bonjour', start: 0.5, end: 1.0 },
      { word: 'tout', start: 1.0, end: 1.3 },
      { word: 'danse', start: 3.2, end: 4.0 },
    ],
    ...over,
  });
}

function post(id = 'r-a') {
  return POST(
    new Request('http://x/api', { method: 'POST' }) as never, { params: { id } },
  );
}

const ENV_GARDES = [
  'AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED',
  'AUTOPILOT_TRANSCRIPTION_GROQ_MODEL',
  'GROQ_API_KEY',
] as const;
const envInitial: Record<string, string | undefined> = {};

beforeEach(() => {
  tables = { rushes: [{ ...RUSH }], rush_analyses: [], rush_transcriptions: [] };
  tableAbsente = null;
  tentativesInsertion.length = 0;
  cheminsProduits.length = 0;
  ffmpeg = { code: 0, octets: 4096 };
  signeurCasse = false;
  rmCasse = false;
  rmDemandes.length = 0;
  reinitialiserCapacite();
  definirFournisseurTranscription(null);
  for (const k of ENV_GARDES) { envInitial[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of ENV_GARDES) {
    if (envInitial[k] === undefined) delete process.env[k];
    else process.env[k] = envInitial[k];
  }
  definirFournisseurTranscription(null);
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-7. Le contrat : rien de ce que le fournisseur rend n’est cru', () => {
  it('1. une réponse `verbose_json` conforme donne texte, langue, segments et mots', () => {
    const r = lireReponseTranscription(verboseJson(), 38.165);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transcription.presente).toBe(true);
    expect(r.transcription.langue).toBe('french');
    expect(r.transcription.texte).toBe('Bonjour tout le monde. On danse.');
    expect(r.transcription.segments).toEqual([
      { debutSecondes: 0.5, finSecondes: 2.2, texte: 'Bonjour tout le monde.' },
      { debutSecondes: 2.4, finSecondes: 4, texte: 'On danse.' },
    ]);
    expect(r.transcription.mots).toHaveLength(3);
  });

  it('2. `NaN` et `±Infinity` ne franchissent jamais le contrat', () => {
    const s = normaliserIntervalles([
      { debutSecondes: Number.NaN, finSecondes: 3, texte: 'a' },
      { debutSecondes: 1, finSecondes: Number.POSITIVE_INFINITY, texte: 'b' },
      { debutSecondes: Number.NEGATIVE_INFINITY, finSecondes: 2, texte: 'c' },
      { debutSecondes: 2, finSecondes: 4, texte: 'd' },
    ], 10, SEGMENTS_MAX, SEGMENT_TEXTE_MAX);
    expect(s).toEqual([{ debutSecondes: 2, finSecondes: 4, texte: 'd' }]);
    // Ce qui entre en base doit survivre à un aller-retour JSON.
    const base = transcriptionPourBase(
      { presente: true, langue: 'french', texte: 'x', segments: s, mots: [] }, 10,
    );
    expect(JSON.parse(JSON.stringify(base))).toEqual(base);
  });

  it('3. les bornes du rush sont respectées, et un intervalle vide est refusé', () => {
    const s = normaliserIntervalles([
      { debutSecondes: -3, finSecondes: 2, texte: 'avant' },
      { debutSecondes: 36, finSecondes: 99, texte: 'apres' },
      { debutSecondes: 5, finSecondes: 5, texte: 'vide' },
      { debutSecondes: 9, finSecondes: 4, texte: 'inverse' },
    ], 38.165, SEGMENTS_MAX, SEGMENT_TEXTE_MAX);
    expect(s).toEqual([
      { debutSecondes: 0, finSecondes: 2, texte: 'avant' },
      { debutSecondes: 36, finSecondes: 38.165, texte: 'apres' },
    ]);
    for (const x of s) {
      expect(x.debutSecondes).toBeGreaterThanOrEqual(0);
      expect(x.debutSecondes).toBeLessThan(x.finSecondes);
      expect(x.finSecondes).toBeLessThanOrEqual(38.165);
    }
  });

  it('3bis. les instants sont arrondis à trois décimales', () => {
    expect(normaliserIntervalles(
      [{ debutSecondes: 1.99995, finSecondes: 3.00007, texte: 'a' }], 10, 10, 100,
    )).toEqual([{ debutSecondes: 2, finSecondes: 3, texte: 'a' }]);
  });

  it('4-5. segments et mots sont TRIÉS, jamais fusionnés', () => {
    const s = normaliserIntervalles([
      { debutSecondes: 8, finSecondes: 9, texte: 'trois' },
      { debutSecondes: 1, finSecondes: 3, texte: 'un' },
      // Deux mots qui se recouvrent restent DEUX mots : fusionner y perdrait
      // du texte, le seul contenu qu'on soit venu chercher.
      { debutSecondes: 2, finSecondes: 4, texte: 'deux' },
    ], 10, SEGMENTS_MAX, SEGMENT_TEXTE_MAX);
    expect(s.map((x) => x.texte)).toEqual(['un', 'deux', 'trois']);
    expect(s).toHaveLength(3);
  });

  it('6. les textes et les listes sont bornés', () => {
    const trop = Array.from({ length: SEGMENTS_MAX + 500 }, (_, i) => ({
      debutSecondes: i * 0.01, finSecondes: i * 0.01 + 0.005, texte: 'x'.repeat(3000),
    }));
    const s = normaliserIntervalles(trop, 1000, SEGMENTS_MAX, SEGMENT_TEXTE_MAX);
    expect(s).toHaveLength(SEGMENTS_MAX);
    expect(s[0].texte.length).toBe(SEGMENT_TEXTE_MAX);

    const base = transcriptionPourBase({
      presente: true, langue: 'french', texte: 'y'.repeat(TEXTE_MAX + 1000),
      segments: [], mots: trop.slice(0, 50).map((x) => ({ ...x, texte: 'z'.repeat(500) })),
    }, 1000);
    expect(base.texte.length).toBe(TEXTE_MAX);
    expect(base.mots[0].texte.length).toBe(MOT_TEXTE_MAX);
    expect(MOTS_MAX).toBeGreaterThan(SEGMENTS_MAX);
  });

  it('6bis. la réponse est refusée sur sa taille AVANT d’être analysée', () => {
    const enorme = `{"text":"${'a'.repeat(REPONSE_MAX_OCTETS)}"}`;
    const r = lireReponseTranscription(enorme, 10);
    expect(r).toMatchObject({ ok: false, motif: 'reponse_illisible' });
  });

  it('6ter. une réponse hors forme est un REFUS, jamais un rattrapage', () => {
    for (const brut of ['', 'pas du json', '[]', '{"nope":1}', 'null']) {
      const r = lireReponseTranscription(brut, 10);
      expect(r.ok).toBe(false);
    }
  });

  it('`presente` est DÉDUIT, jamais recopié du fournisseur', () => {
    // Un fournisseur qui annoncerait de la parole sans en rendre ferait
    // croire à un texte que personne n'a entendu.
    const menteur = transcriptionPourBase(
      { presente: true, langue: 'french', texte: '  ', segments: [], mots: [] }, 10,
    );
    expect(menteur.presente).toBe(false);
    expect(transcriptionPourBase(transcriptionSansAudio(), 10).presente).toBe(false);
  });

  it('la langue est bornée en FORME, pas enfermée dans un `enum`', () => {
    // `verbose_json` rend le NOM de la langue, pas un code ISO.
    expect(langueValide('French')).toBe('french');
    expect(langueValide('haitian creole')).toBe('haitian creole');
    expect(langueValide('')).toBeNull();
    expect(langueValide('x'.repeat(80))).toBeNull();
    expect(langueValide('fr; drop table')).toBeNull();
    expect(langueValide(42)).toBeNull();
  });

  it('7. aucune URL, aucun secret, aucun en-tête ne peut entrer en base', () => {
    // Des champs que le fournisseur pourrait ajouter : ils n'ont aucun chemin
    // vers la sortie, qui est RECONSTRUITE champ par champ.
    const pollue = {
      presente: true,
      langue: 'french',
      texte: 'texte',
      segments: [{ debutSecondes: 0, finSecondes: 1, texte: 'ok' }],
      mots: [],
      x_groq: { id: 'req_123' },
      url: URL_SIGNEE,
    };
    const base = transcriptionPourBase(pollue as never, 10);
    expect(Object.keys(base).sort())
      .toEqual(['langue', 'mots', 'presente', 'segments', 'texte']);
    const texte = JSON.stringify(base);
    expect(texte).not.toContain('X-Amz');
    expect(texte).not.toContain('studiio-minio');
    expect(texte).not.toContain('x_groq');
    expect(intervalleValide({ debutSecondes: 0, finSecondes: 1, texte: 'ok' })).toBe(true);
    expect(intervalleValide({ debutSecondes: 1, finSecondes: 1, texte: 'ok' })).toBe(false);
  });

  it('le vocabulaire des motifs est FERMÉ', () => {
    expect(new Set(MOTIFS_TRANSCRIPTION).size).toBe(MOTIFS_TRANSCRIPTION.length);
    expect(MOTIFS_TRANSCRIPTION).toContain('audio_trop_long');
    expect(MOTIFS_TRANSCRIPTION).toContain('transcription_interrompue');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('8-14. La base, et rien qu’elle, porte propriété et concurrence', () => {
  it('8. le rush d’autrui : la CLÉ ÉTRANGÈRE refuse, pas un `if`', async () => {
    // La cohérence n'est pas une convention applicative qu'un futur appelant
    // pourrait oublier : c'est le moteur qui refuse.
    await expect(creerTranscription('B', 'r-a')).rejects.toThrowError(
      /rush_transcriptions_rush_proprietaire/,
    );
    expect(tables.rush_transcriptions).toHaveLength(0);
    // Et l'insertion a bien été TENTÉE : aucun `select` préalable ne s'est
    // substitué à la garantie de la base.
    expect(tentativesInsertion.filter((t) => t.table === 'rush_transcriptions')).toHaveLength(1);
  });

  it('8bis. la route refuse le rush d’autrui en 404, sans rien écrire', async () => {
    tables.rushes = [{ ...RUSH, user_id: 'B' }];
    const rep = await post();
    expect(rep.status).toBe(404);
    expect(tables.rush_transcriptions).toHaveLength(0);
  });

  it('9. version 1 puis version 2', async () => {
    definirFournisseurTranscription(async () => ({
      reponse: verboseJson(), modele: 'modele-test',
    }));
    const a = await post();
    expect(a.status).toBe(201);
    const b = await post();
    expect(b.status).toBe(201);
    expect(tables.rush_transcriptions.map((l) => l.version)).toEqual([1, 2]);
  });

  it('10-11. deux créations concurrentes : la BASE en refuse une', async () => {
    const [x, y] = await Promise.allSettled([
      creerTranscription('A', 'r-a'), creerTranscription('A', 'r-a'),
    ]);
    const motifs = [x, y].map(
      (r) => (r.status === 'fulfilled' ? r.value.motif : 'leve'),
    );
    // L'une passe, l'autre est refusée — et ce refus vient de l'index unique,
    // pas d'un `if` : les deux insertions ont été TENTÉES.
    expect(motifs.filter((m) => m === null)).toHaveLength(1);
    expect(motifs).toContain('transcription_active_existante');
    expect(tentativesInsertion.filter((t) => t.table === 'rush_transcriptions')).toHaveLength(2);
    expect(tables.rush_transcriptions.filter((l) => actif(l.etat))).toHaveLength(1);
  });

  it('12. une transcription active RÉCENTE bloque, et n’est pas fermée', async () => {
    tables.rush_transcriptions = [{
      id: 't-vieille', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'en_cours',
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    const r = await creerTranscription('A', 'r-a');
    expect(r.motif).toBe('transcription_active_existante');
    expect(tables.rush_transcriptions[0].etat).toBe('en_cours');
    expect(tables.rush_transcriptions[0].motif_echec).toBeUndefined();
  });

  it('13-14. une transcription active PÉRIMÉE est fermée, et la suivante passe', async () => {
    const vieux = new Date(Date.now() - PEREMPTION_TRANSCRIPTION_MS - 60_000).toISOString();
    tables.rush_transcriptions = [{
      id: 't-morte', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'en_cours',
      created_at: vieux, updated_at: vieux,
    }];
    const r = await creerTranscription('A', 'r-a');
    expect(r.motif).toBeNull();
    expect(r.transcription?.version).toBe(2);

    const morte = tables.rush_transcriptions.find((l) => l.id === 't-morte')!;
    expect(morte.etat).toBe('echouee');
    expect(morte.motif_echec).toBe(MOTIF_TRANSCRIPTION_INTERROMPUE);
    // Aucun texte inventé : une transcription interrompue n'a rien produit.
    expect(morte.texte).toBeUndefined();
  });

  it('13bis. la péremption ne touche ni le rush d’autrui, ni un autre rush', async () => {
    const vieux = new Date(Date.now() - PEREMPTION_TRANSCRIPTION_MS - 60_000).toISOString();
    tables.rush_transcriptions = [
      { id: 't1', rush_id: 'r-a', user_id: 'B', version: 1, etat: 'en_cours', created_at: vieux },
      { id: 't2', rush_id: 'r-z', user_id: 'A', version: 1, etat: 'en_cours', created_at: vieux },
    ];
    const r = await recupererTranscriptionsInterrompues('A', 'r-a');
    expect(r.fermees).toBe(0);
    expect(tables.rush_transcriptions.every((l) => l.etat === 'en_cours')).toBe(true);
  });

  it('le seuil de péremption est franchement au-dessus du pire cas de la route', () => {
    // Le fermer trop tôt ferait payer un second appel pendant le premier.
    expect(PEREMPTION_TRANSCRIPTION_MS)
      .toBeGreaterThan(BUDGET_FLAC_MS + TIMEOUT_TRANSCRIPTION_MS);
    expect(Date.parse(seuilPeremptionTranscription())).toBeLessThan(Date.now());
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(BUDGET_FLAC_MS + TIMEOUT_TRANSCRIPTION_MS);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('15-17, 21-22. Quatre façons de NE PAS appeler le fournisseur', () => {
  let transport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = vi.fn(async () => ({ ok: true, status: 200, text: async () => verboseJson() }));
  });

  it('15. drapeau absent → aucun appel, et la route le DIT', async () => {
    const rep = await post();
    expect(rep.status).toBe(503);
    expect((await rep.json()).motif).toBe('fournisseur_absent');
    expect(transport).not.toHaveBeenCalled();
    // Aucun octet extrait non plus : le fournisseur est chargé avant.
    expect(cheminsProduits).toHaveLength(0);
    // La ligne existe et se clôt — elle ne reste pas active pour toujours.
    expect(tables.rush_transcriptions[0].etat).toBe('echouee');
    expect(tables.rush_transcriptions[0].motif_echec).toBe('fournisseur_absent');
  });

  it('15bis. l’interrupteur est le SEUL à ouvrir, et `"true"` seul le pose', () => {
    for (const v of [undefined, 'false', '1', 'oui', 'TRUE']) {
      if (v === undefined) delete process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED;
      else process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED = v;
      expect(transcriptionGroqActive()).toBe(false);
      expect(fournisseurTranscriptionGroq(transport as never)).toBeNull();
    }
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED = 'true';
    expect(transcriptionGroqActive()).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it('16. modèle absent → `modele_absent`, aucun appel, aucun défaut caché', () => {
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED = 'true';
    process.env.GROQ_API_KEY = 'gsk-test';
    expect(() => fournisseurTranscriptionGroq(transport as never))
      .toThrowError(ConfigurationTranscriptionInvalide);
    try { fournisseurTranscriptionGroq(transport as never); } catch (e) {
      expect((e as ConfigurationTranscriptionInvalide).motif).toBe('modele_absent');
    }
    expect(transport).not.toHaveBeenCalled();

    // Et le source ne porte AUCUN nom de modèle en dur : choisir à la place
    // de l'exploitant, c'est choisir ce qu'il paie.
    const src = readFileSync(SOURCES[3], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/whisper-large/);
    expect(src).toContain('process.env.AUTOPILOT_TRANSCRIPTION_GROQ_MODEL');
  });

  it('17. clé absente → `cle_absente`, aucun appel', () => {
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED = 'true';
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_MODEL = 'modele-test';
    try {
      fournisseurTranscriptionGroq(transport as never);
      throw new Error('aurait dû lever');
    } catch (e) {
      expect((e as ConfigurationTranscriptionInvalide).motif).toBe('cle_absente');
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('21. rush SANS piste (M3-D1) → aucun appel, et un RÉSULTAT `reussie`', async () => {
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'reussie', etape: 'visuel',
      duree_secondes: 38.165, technique: {}, resume: null, textes_visibles: [],
      parole: {}, audio: { present: false, etatMesure: 'absente' }, qualite: {},
      vignettes: [], usage: {}, fournisseurs: {}, motif_echec: null,
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    definirFournisseurTranscription(async () => { throw new Error('ne doit pas être appelé'); });

    const rep = await post();
    expect(rep.status).toBe(201);
    const corps = await rep.json();
    // Un RÉSULTAT, pas un échec : ce rush ne contient pas de parole, et cette
    // réponse ne changera pas — le fichier ne change pas.
    expect(corps.transcription.etat).toBe('reussie');
    expect(corps.transcription.presente).toBe(false);
    expect(corps.transcription.motifEchec).toBeNull();
    expect(corps.transcription.fournisseurs).toEqual({});
    expect(cheminsProduits).toHaveLength(0);
  });

  it('21bis. une mesure D1 INDISPONIBLE n’est PAS « pas de piste »', async () => {
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'reussie', etape: 'visuel',
      duree_secondes: 38.165, technique: {}, resume: null, textes_visibles: [], parole: {},
      // C'est la distinction que M3-D1 a été écrit pour porter.
      audio: { present: true, etatMesure: 'indisponible', motif: 'timeout' },
      qualite: {}, vignettes: [], usage: {}, fournisseurs: {}, motif_echec: null,
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    const appele = vi.fn(async () => ({ reponse: verboseJson(), modele: 'modele-test' }));
    definirFournisseurTranscription(appele);

    const rep = await post();
    expect(rep.status).toBe(201);
    // On ne sait pas : on essaie. Confondre les deux ferait sauter la
    // transcription d'un rush parlé sur une simple panne de mesure.
    expect(appele).toHaveBeenCalledTimes(1);
  });

  it('22. GET n’appelle personne et n’écrit rien', async () => {
    definirFournisseurTranscription(async () => { throw new Error('ne doit pas être appelé'); });
    const rep = await GET(
      { nextUrl: new URL('http://x/api') } as never, { params: { id: 'r-a' } },
    );
    expect(rep.status).toBe(200);
    expect((await rep.json()).transcription).toBeNull();
    expect(tables.rush_transcriptions).toHaveLength(0);
    expect(rep.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('18-20. L’appel, la réponse, et le fichier temporaire', () => {
  it('18. une réponse invalide ferme la ligne en `echouee`, sans texte', async () => {
    definirFournisseurTranscription(async () => ({
      reponse: '{"pas":"la bonne forme"}', modele: 'modele-test',
    }));
    const rep = await post();
    expect(rep.status).toBe(500);
    expect((await rep.json()).motif).toBe('resultat_transcription_invalide');
    const ligne = tables.rush_transcriptions[0];
    expect(ligne.etat).toBe('echouee');
    expect(ligne.texte).toBe('');
    expect(ligne.presente).toBe(false);
    expect(ligne.completed_at).toBeTruthy();
  });

  it('18bis. un fournisseur qui lève donne `fournisseur_en_erreur`, sans reprise', async () => {
    const appele = vi.fn(async () => { throw new Error('boom'); });
    definirFournisseurTranscription(appele as never);
    const rep = await post();
    expect(rep.status).toBe(502);
    expect((await rep.json()).motif).toBe('fournisseur_en_erreur');
    // UN SEUL appel : réessayer double l'attente et la facture.
    expect(appele).toHaveBeenCalledTimes(1);
  });

  it('19. le fichier temporaire est supprimé APRÈS un succès', async () => {
    definirFournisseurTranscription(async (d) => {
      // Pendant l'appel, il existe — c'est bien lui qu'on envoie.
      expect(existsSync(d.chemin)).toBe(true);
      expect(d.octets).toBe(4096);
      return { reponse: verboseJson(), modele: 'modele-test' };
    });
    const rep = await post();
    expect(rep.status).toBe(201);
    expect(cheminsProduits).toHaveLength(1);
    expect(existsSync(cheminsProduits[0])).toBe(false);
  });

  it('20. le fichier temporaire est supprimé même quand le fournisseur LÈVE', async () => {
    definirFournisseurTranscription(async () => { throw new Error('boom'); });
    await post();
    expect(cheminsProduits).toHaveLength(1);
    expect(existsSync(cheminsProduits[0])).toBe(false);
  });

  it('20bis. et même quand le travail rend un refus contrôlé', async () => {
    ffmpeg = { code: 1 };
    const r = await avecAudioFlac(
      { bucket: 'media', cleObjet: 'A/rush/p.mp4', userId: 'A' },
      async () => 'jamais',
    );
    expect(r).toMatchObject({ ok: false, motif: 'audio_illisible', nettoyage: 'ok' });
    expect(existsSync(cheminsProduits[0])).toBe(false);
  });

  it('le FLAC trop lourd est refusé AVANT l’appel — donc avant le coût', async () => {
    ffmpeg = { code: 0, octets: FLAC_OCTETS_MAX + 1 };
    const appele = vi.fn();
    const r = await avecAudioFlac(
      { bucket: 'media', cleObjet: 'A/rush/p.mp4', userId: 'A' },
      async () => { appele(); return 'x'; },
    );
    expect(r).toMatchObject({ ok: false, motif: 'audio_trop_long', nettoyage: 'ok' });
    expect(appele).not.toHaveBeenCalled();
    expect(existsSync(cheminsProduits[0])).toBe(false);
  });

  it('les arguments d’extraction sont ceux que la documentation recommande', () => {
    const args = argumentsFlac(URL_SIGNEE, '/tmp/x/piste.flac');
    expect(args).toContain('-protocol_whitelist');
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('http,https,tcp,tls');
    expect(args[args.indexOf('-ar') + 1]).toBe(String(FREQUENCE_HZ));
    expect(args[args.indexOf('-ac') + 1]).toBe(String(CANAUX));
    expect(args[args.indexOf('-c:a') + 1]).toBe('flac');
    // Une seule piste, choisie par nous — le fournisseur n'en transcrit
    // qu'une de toute façon.
    expect(args[args.indexOf('-map') + 1]).toBe('0:a:0');
    expect(args).toContain('-vn');
    expect(args[args.length - 1]).toBe('/tmp/x/piste.flac');
  });

  it('une clé hors périmètre est refusée avant tout accès', async () => {
    for (const cle of ['B/rush/p.mp4', 'A/../B/p.mp4', 'https://ailleurs/p.mp4']) {
      const r = await avecAudioFlac({ bucket: 'media', cleObjet: cle, userId: 'A' }, async () => 1);
      expect(r).toMatchObject({ ok: false, motif: 'cle_hors_perimetre', nettoyage: 'ok' });
    }
    expect(cheminsProduits).toHaveLength(0);
  });

  it('un stockage non configuré n’extrait rien', async () => {
    signeurCasse = true;
    const r = await avecAudioFlac(
      { bucket: 'media', cleObjet: 'A/rush/p.mp4', userId: 'A' }, async () => 1,
    );
    expect(r).toMatchObject({ ok: false, motif: 'stockage_injoignable', nettoyage: 'ok' });
    expect(cheminsProduits).toHaveLength(0);
  });

  it('le succès consigne fournisseur, modèle, langue et usage LOCAL', async () => {
    definirFournisseurTranscription(async () => ({
      reponse: verboseJson(), modele: 'modele-test',
    }));
    const rep = await post();
    expect(rep.status).toBe(201);
    const t = (await rep.json()).transcription;
    expect(t.etat).toBe('reussie');
    expect(t.presente).toBe(true);
    expect(t.langue).toBe('french');
    expect(t.fournisseurs).toEqual({
      transcription: { ...FOURNISSEUR_TRANSCRIPTION, modele: 'modele-test' },
    });
    // ⚠️ `usage` est CALCULÉ chez nous : la durée vient de ffprobe, les octets
    // de notre extraction, le minimum facturé d'une règle publiée. Laisser le
    // fournisseur le déclarer, ce serait lui laisser écrire notre comptabilité.
    expect(t.usage).toEqual({
      octetsEnvoyes: 4096, secondesAudio: 38.165,
      secondesFacturees: Math.max(SECONDES_MIN_FACTUREES, 39),
    });
    expect(t.startedAt).toBeTruthy();
    expect(t.completedAt).toBeTruthy();
  });

  it('l’adaptateur envoie un multipart conforme, et ne pose pas de content-type', async () => {
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED = 'true';
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_MODEL = 'modele-test';
    process.env.GROQ_API_KEY = 'gsk-secret-a-ne-pas-fuir';

    let vu: { url: string; init: RequestInit } | null = null;
    const transport: TransportTranscription = async (url, init) => {
      vu = { url, init };
      return { ok: true, status: 200, text: async () => verboseJson() };
    };
    const f = fournisseurTranscriptionGroq(transport)!;
    expect(f).toBeTruthy();

    // Un vrai fichier, écrit par la doublure de ffmpeg.
    await avecAudioFlac(
      { bucket: 'media', cleObjet: 'A/rush/p.mp4', userId: 'A' },
      async (fichier) => f({ chemin: fichier.chemin, octets: fichier.octets }),
    );

    expect(vu!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    const corps = vu!.init.body as FormData;
    expect(corps.get('model')).toBe('modele-test');
    expect(corps.get('response_format')).toBe('verbose_json');
    expect(corps.get('temperature')).toBe('0');
    expect(corps.getAll('timestamp_granularities[]')).toEqual(['segment', 'word']);
    // Le nom de fichier est un LITTÉRAL À NOUS : reprendre le chemin
    // temporaire y ferait voyager un répertoire du serveur.
    expect((corps.get('file') as File).name).toBe('piste.flac');
    // ⚠️ AUCUN `content-type` posé à la main : `FormData` porte sa frontière.
    const entetes = vu!.init.headers as Record<string, string>;
    expect(Object.keys(entetes)).toEqual(['authorization']);
  });

  it('une erreur du fournisseur ne rend que son STATUT', async () => {
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED = 'true';
    process.env.AUTOPILOT_TRANSCRIPTION_GROQ_MODEL = 'modele-test';
    process.env.GROQ_API_KEY = 'gsk-secret-a-ne-pas-fuir';
    const transport: TransportTranscription = async () => ({
      ok: false, status: 429,
      text: async () => 'rate limited for key gsk-secret-a-ne-pas-fuir at https://api.groq.com/x',
    });
    const f = fournisseurTranscriptionGroq(transport)!;
    await expect(
      avecAudioFlac(
        { bucket: 'media', cleObjet: 'A/rush/p.mp4', userId: 'A' },
        async (fichier) => f({ chemin: fichier.chemin, octets: fichier.octets }),
      ),
    ).rejects.toThrowError(/^fournisseur_http_429$/);
  });

  it('les délais s’emboîtent : réseau < processus < appel < péremption', () => {
    expect(TIMEOUT_FLAC_MS).toBeLessThan(TIMEOUT_TRANSCRIPTION_MS);
    expect(BUDGET_FLAC_MS).toBeGreaterThan(TIMEOUT_FLAC_MS);
    expect(TIMEOUT_TRANSCRIPTION_MS).toBeLessThan(PEREMPTION_TRANSCRIPTION_MS);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('La capacité, et les refus qui n’écrivent rien', () => {
  it('une seule transcription à la fois, et le refus ne laisse aucune ligne', async () => {
    expect(MAX_TRANSCRIPTIONS_SIMULTANEES).toBe(1);
    const prise = prendrePlaceTranscription();
    expect(prise).not.toBeNull();
    expect(prendrePlaceTranscription()).toBeNull();

    const rep = await post();
    expect(rep.status).toBe(429);
    expect(rep.headers.get('Retry-After')).toBeTruthy();
    // Aucune écriture : une place refusée ne doit occuper aucun verrou.
    expect(tables.rush_transcriptions).toHaveLength(0);

    prise!.liberer();
    expect(transcriptionsEnCoursMaintenant()).toBe(0);
  });

  it('la place est rendue même quand la transcription échoue', async () => {
    definirFournisseurTranscription(async () => { throw new Error('boom'); });
    await post();
    expect(transcriptionsEnCoursMaintenant()).toBe(0);
  });

  it('un rush non vérifié est refusé sans rien écrire', async () => {
    tables.rushes = [{ ...RUSH, etat: 'indexe' }];
    const rep = await post();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('rush_non_verifie');
    expect(tables.rush_transcriptions).toHaveLength(0);
  });

  it('une durée inconnue est refusée : rien ne bornerait les instants', async () => {
    tables.rushes = [{ ...RUSH, duree_secondes: null }];
    const rep = await post();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('duree_inconnue');
    expect(tables.rush_transcriptions).toHaveLength(0);
  });

  it('la migration absente se dit, et ne ressemble pas à une panne', async () => {
    tableAbsente = 'rush_transcriptions';
    const rep = await post();
    expect(rep.status).toBe(503);
    expect((await rep.json()).motif).toBe('socle_absent');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('La PAROLE peut contenir une URL — la STRUCTURE ne peut rien contenir', () => {
  /** Une réponse où la personne filmée dit une adresse de site. */
  const PHRASE = 'Retrouvez-nous sur https://studiio.pro';

  function reponseAvecUrlEtPollution() {
    return JSON.stringify({
      language: 'french',
      text: PHRASE,
      segments: [{ id: 0, start: 1, end: 3, text: PHRASE }],
      words: [{ word: 'https://studiio.pro', start: 2, end: 3 }],
      // ── Ce que le fournisseur pourrait ajouter, et qui ne doit JAMAIS
      //    entrer : des champs annexes portant exactement ce qu'on protège.
      x_groq: { id: 'req_01hxyz', region: 'us-east-1' },
      url: URL_SIGNEE,
      headers: { authorization: 'Bearer gsk-secret', 'x-amz-signature': 'deadbeef' },
      debug: { chemin: '/tmp/studiio-m3d2-abc/piste.flac' },
    });
  }

  it('une URL PRONONCÉE est conservée telle quelle, jusqu’en base', async () => {
    definirFournisseurTranscription(async () => ({
      reponse: reponseAvecUrlEtPollution(), modele: 'modele-test',
    }));

    const rep = await post();
    // Le texte de quelqu'un ne fait pas échouer sa transcription.
    expect(rep.status).toBe(201);
    const t = (await rep.json()).transcription;
    expect(t.etat).toBe('reussie');
    expect(t.presente).toBe(true);
    expect(t.texte).toBe(PHRASE);
    expect(t.segments[0].texte).toBe(PHRASE);

    // Et la ligne écrite en base la porte aussi : aucune contrainte lexicale
    // ne l'a refusée.
    const ligne = tables.rush_transcriptions[0];
    expect(ligne.texte).toBe(PHRASE);
    expect(JSON.stringify(ligne.segments)).toContain('https://studiio.pro');
  });

  it('les champs ANNEXES du fournisseur n’ont AUCUN chemin vers la base', async () => {
    definirFournisseurTranscription(async () => ({
      reponse: reponseAvecUrlEtPollution(), modele: 'modele-test',
    }));
    await post();

    const ligne = tables.rush_transcriptions[0];
    // Les seules colonnes de contenu écrites, et rien d'autre.
    expect(ligne.x_groq).toBeUndefined();
    expect(ligne.headers).toBeUndefined();
    expect(ligne.debug).toBeUndefined();
    expect(ligne.url).toBeUndefined();

    const tout = JSON.stringify(ligne);
    // ⚠️ LA SÉPARATION QU'ON VERROUILLE : l'URL DITE survit, l'URL SIGNÉE non.
    expect(tout).toContain('https://studiio.pro');
    expect(tout).not.toContain('X-Amz');
    expect(tout).not.toContain('x-amz-signature');
    expect(tout).not.toContain('studiio-minio');
    expect(tout).not.toContain('gsk-secret');
    expect(tout).not.toContain('req_01hxyz');
    expect(tout).not.toContain('/tmp/studiio-m3d2-');
    expect(tout).not.toContain('authorization');
  });

  it('le contrat, seul, suffit à établir la séparation', () => {
    const lu = lireReponseTranscription(reponseAvecUrlEtPollution(), 10);
    expect(lu.ok).toBe(true);
    if (!lu.ok) return;
    const base = transcriptionPourBase(lu.transcription, 10);
    expect(Object.keys(base).sort())
      .toEqual(['langue', 'mots', 'presente', 'segments', 'texte']);
    expect(base.texte).toBe(PHRASE);
    expect(JSON.stringify(base)).not.toContain('x_groq');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('Un nettoyage raté se VOIT, et ne se déguise en rien', () => {
  it('rm en échec : la transcription reste `reussie`, et le fait est consigné', async () => {
    const appele = vi.fn(async () => ({ reponse: verboseJson(), modele: 'modele-test' }));
    definirFournisseurTranscription(appele);
    rmCasse = true;

    const rep = await post();

    // ⚠️ LA TRANSCRIPTION EST VALIDE ET DÉJÀ PAYÉE : la rejeter obligerait à
    // repayer pour retrouver un texte qu'on tenait déjà.
    expect(rep.status).toBe(201);
    const corps = await rep.json();
    expect(corps.transcription.etat).toBe('reussie');
    expect(corps.transcription.texte).toBe('Bonjour tout le monde. On danse.');

    // Exactement UN appel, et aucune seconde transcription.
    expect(appele).toHaveBeenCalledTimes(1);
    expect(tables.rush_transcriptions).toHaveLength(1);

    // L'échec est OBSERVABLE : dans la réponse, et consigné dans `usage`.
    expect(corps.nettoyage).toBe('echoue');
    expect(corps.transcription.usage[CLE_USAGE_NETTOYAGE]).toBe('echoue');
    expect(tables.rush_transcriptions[0].usage)
      .toMatchObject({ [CLE_USAGE_NETTOYAGE]: 'echoue' });

    // ⚠️ CE N'EST PAS UN ÉCHEC DE TRANSCRIPTION. `motif_echec` répond à
    // « pourquoi ça a échoué » ; y écrire un `rm` raté inviterait à relancer.
    expect(corps.transcription.motifEchec).toBeNull();
    expect(corps.motif).toBeUndefined();

    // Et aucun chemin temporaire ne ressort, nulle part.
    const tout = JSON.stringify(corps);
    expect(tout).not.toContain('/tmp/');
    expect(tout).not.toContain('studiio-m3d2-');
    expect(tout).not.toContain('EBUSY');
    expect(MOTIF_NETTOYAGE_ECHOUE).toBe('nettoyage_temporaire_echoue');
  });

  it('rm en échec APRÈS une panne fournisseur : la vraie cause l’emporte', async () => {
    const appele = vi.fn(async () => { throw new Error('boom'); });
    definirFournisseurTranscription(appele as never);
    rmCasse = true;

    const rep = await post();
    const corps = await rep.json();

    // Le motif reste celui de la VRAIE cause…
    expect(rep.status).toBe(502);
    expect(corps.motif).toBe('fournisseur_en_erreur');
    expect(tables.rush_transcriptions[0].motif_echec).toBe('fournisseur_en_erreur');
    // …et le nettoyage raté s'AJOUTE, il ne remplace pas.
    expect(corps.nettoyage).toBe('echoue');
    expect(tables.rush_transcriptions[0].usage)
      .toMatchObject({ [CLE_USAGE_NETTOYAGE]: 'echoue' });
    // Toujours un seul appel : aucune reprise, jamais.
    expect(appele).toHaveBeenCalledTimes(1);
  });

  it('un nettoyage réussi ne laisse AUCUNE trace dans `usage`', async () => {
    definirFournisseurTranscription(async () => ({
      reponse: verboseJson(), modele: 'modele-test',
    }));
    const rep = await post();
    const corps = await rep.json();
    expect(corps.nettoyage).toBe('ok');
    expect(corps.transcription.usage[CLE_USAGE_NETTOYAGE]).toBeUndefined();
    // Le répertoire a bien été demandé à la suppression, et il a disparu.
    expect(rmDemandes).toHaveLength(1);
    expect(existsSync(cheminsProduits[0])).toBe(false);
  });

  it('un refus AVANT toute création de répertoire ne prétend rien nettoyer', async () => {
    const r = await avecAudioFlac(
      { bucket: 'inconnu', cleObjet: 'A/rush/p.mp4', userId: 'A' }, async () => 1,
    );
    expect(r).toMatchObject({ ok: false, motif: 'cle_hors_perimetre', nettoyage: 'ok' });
    // Rien n'a été créé, donc rien n'avait à être supprimé.
    expect(rmDemandes).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('23-27. Ce que ce lot ne touche pas, et ce que la migration promet', () => {
  it('23. aucune analyse n’est modifiée', async () => {
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'reussie', etape: 'visuel',
      duree_secondes: 38.165, technique: {}, resume: 'intact', textes_visibles: [],
      parole: {}, audio: { present: true, etatMesure: 'mesuree' }, qualite: {},
      vignettes: [], usage: {}, fournisseurs: {}, motif_echec: null,
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    const avant = JSON.stringify(tables.rush_analyses);
    definirFournisseurTranscription(async () => ({
      reponse: verboseJson(), modele: 'modele-test',
    }));
    await post();
    expect(JSON.stringify(tables.rush_analyses)).toBe(avant);

    // Et le source n'écrit sur aucune analyse : il ne fait que la LIRE.
    const route = readFileSync(SOURCE_ROUTE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(route).not.toContain('majAnalyse');
    expect(route).toContain('lireDerniereAnalyse');
  });

  it('24. M3-C et M3-D1 ne sont pas touchés', () => {
    const route = readFileSync(SOURCE_ROUTE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const interdit of ['candidat', 'mesurerAudio', 'audioPourBase', 'anthropic']) {
      expect(route.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
  });

  it('25. aucun crédit sur ce chemin — couplage, pas présence lexicale', () => {
    for (const f of [SOURCE_ROUTE, ...SOURCES]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toContain("from '@/lib/credits");
      expect(src).not.toContain('debiter_credits');
    }
  });

  it('26. la migration porte la FK composite, les deux index, et rien de destructif', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('create table if not exists public.rush_transcriptions');
    expect(sql).toMatch(/foreign key \(rush_id, user_id\)\s*\n\s*references public\.rushes \(id, user_id\)/);
    expect(sql).toContain('on delete cascade');
    expect(sql).toContain('rush_transcriptions_rush_version_unique');
    expect(sql).toContain('rush_transcriptions_active_unique');
    expect(sql).toContain("where etat in ('en_attente', 'en_cours')");
    // Rien de destructif, et rien sur les tables existantes.
    expect(sql).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i);
    expect(sql).not.toMatch(/alter\s+table\s+public\.(rush_analyses|rushes|rush_candidate_sets)/i);
  });

  it('26bis. la table borne ce qu’elle accepte — mais PAS le vocabulaire parlé', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('length(texte) <= 60000');
    expect(sql).toContain("etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee')");
    expect(sql).toContain("etape in ('extraction_audio', 'transcription')");

    // ⚠️ AUCUNE CONTRAINTE LEXICALE SUR LES URL, et c'est une différence de
    // NATURE avec `vignettes` et `candidats`. Une vignette est une clé que le
    // serveur fabrique ; une transcription est la PAROLE de quelqu'un.
    // « Retrouvez-nous sur https://studiio.pro » est une phrase ordinaire, et
    // la refuser ferait échouer une transcription sur ce qui a été DIT.
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toContain("not like '%://%'");
    // La sécurité est structurelle, et elle est vérifiée par le comportement
    // — voir « la parole peut contenir une URL » plus haut.
  });

  it('27. aucun droit ouvert à `public`', () => {
    const sql = readFileSync(MIGRATION, 'utf8').replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it('aucun `fetch` global n’est touché par ce lot', async () => {
    const vrai = globalThis.fetch;
    const espion = vi.fn(async () => { throw new Error('appel sortant interdit'); });
    globalThis.fetch = espion as never;
    try {
      definirFournisseurTranscription(async () => ({
        reponse: verboseJson(), modele: 'modele-test',
      }));
      const rep = await post();
      expect(rep.status).toBe(201);
      expect(espion).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = vrai;
    }
  });
});
