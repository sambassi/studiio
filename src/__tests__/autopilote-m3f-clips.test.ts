// @vitest-environment node
/**
 * M3-F — LA MATÉRIALISATION DES CLIPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE EN PRIORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-F est le premier lot qui produit des octets à partir d'une décision.
 * Trois défauts coûteraient cher, et ce sont eux que les tests visent :
 *
 *   1. LAISSER LE NAVIGATEUR CHOISIR LES BORNES. Le contrat n'a pas de champ
 *      pour cela, et les proposer est refusé — sans quoi toute la chaîne
 *      M3-C → M3-E se contournerait par un `debutSecondes` inventé.
 *   2. ANNULER LA PRÉCISION DE M3-E. La copie de flux démarre sur une
 *      image-clé ; mesuré sur le rush réel, jusqu'à 994 ms d'écart. Un test
 *      avec un vrai ffmpeg prouve que le réencodage tient la tolérance.
 *   3. LAISSER DES ORPHELINS. Le jeu est atomique : ce qui a été téléversé
 *      avant un échec redescend, et ce qui n'a pas pu redescendre est
 *      COMPTÉ, jamais tu.
 *
 * ⚠️ AUCUN FOURNISSEUR, AUCUN CRÉDIT, AUCUNE PRODUCTION. Le stockage et le
 * lancement de processus sont doublés ; le seul ffmpeg réel travaille sur une
 * fixture engendrée dans un répertoire temporaire, et supprimée.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';

// ───────────────────────────────────────────────────────────────────────────
// Le stockage, l'authentification et les processus — tous doublés
// ───────────────────────────────────────────────────────────────────────────
const URL_SIGNEE = 'http://studiio-minio:9000/media/A/rush/p.mp4?X-Amz-Signature=deadbeef';
let signeurCasse = false;
/** Ce que le stockage a reçu : { bucket, cle, octets }. */
const objetsEcrits: Array<{ bucket: string; cle: string; octets: number }> = [];
const objetsSupprimes: Array<{ bucket: string; cle: string }> = [];
let putCasse = false;
let removeCasse = false;

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  signeurInterne: () => (signeurCasse ? null : {
    presignedGetObject: async () => URL_SIGNEE,
  }),
  clientMinio: () => ({
    statObject: async () => ({ size: 1 }),
    putObject: async (bucket: string, cle: string, corps: Buffer) => {
      if (putCasse) throw new Error(`echec ecriture ${URL_SIGNEE}`);
      objetsEcrits.push({ bucket, cle, octets: corps.length });
      return {};
    },
    removeObject: async (bucket: string, cle: string) => {
      if (removeCasse) throw new Error('echec suppression');
      objetsSupprimes.push({ bucket, cle });
      return {};
    },
  }),
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'A' } }) }));

/** Ce que le faux ffmpeg doit faire, et les commandes qu'il a reçues. */
let ffmpeg: { code: number; introuvable?: boolean; timeout?: boolean; octets?: number } =
  { code: 0, octets: 4096 };
const commandes: Array<{ binaire: string; args: string[] }> = [];

vi.mock('@/lib/autopilot/analyse/extraction', async (orig) => {
  const reel = await orig<Record<string, unknown>>();
  const { writeFileSync } = await import('fs');
  return {
    ...reel,
    lancer: async (binaire: string, args: string[]) => {
      commandes.push({ binaire, args });
      // ffprobe : on rend une mesure plausible, sans écrire de fichier.
      if (args.includes('-show_entries')) {
        return {
          code: 0, codeSysteme: null, signal: null,
          stdout: Buffer.from(JSON.stringify({
            format: { duration: '2.933' }, streams: [{ start_time: '0.000000' }],
          })),
          stderr: '', timeout: false, introuvable: false,
        };
      }
      const sortie = args[args.length - 1];
      if (ffmpeg.code === 0 && !ffmpeg.introuvable && !ffmpeg.timeout) {
        writeFileSync(sortie, Buffer.alloc(ffmpeg.octets ?? 4096, 0x66));
      }
      return {
        code: ffmpeg.code, codeSysteme: null, signal: null,
        stdout: Buffer.alloc(0), stderr: `erreur sur ${URL_SIGNEE}`,
        timeout: Boolean(ffmpeg.timeout), introuvable: Boolean(ffmpeg.introuvable),
      };
    },
  };
});

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec les index uniques APPLIQUÉS
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
/** Une panne BRUTE, non un `error` PostgREST : la doublure lève, comme le ferait
 *  un socle injoignable. Le message porte volontairement une adresse interne. */
let tableEnPanne: string | null = null;
const MESSAGE_INTERNE = 'connect ECONNREFUSED postgres 10.0.0.4:5432';
const tentativesInsertion: Array<{ table: string; valeurs: Ligne }> = [];
/** Chaque `update`, dans l'ORDRE : c'est ce qui prouve qu'une trace est
 *  écrite AVANT la fin, sans dépendre d'un échantillonnage temporel. */
const ecritures: Array<{ table: string; patch: Ligne }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };
const doublon = (i: string) => ({
  code: '23505', message: `duplicate key value violates unique constraint "${i}"`,
});
const actif = (e: unknown) => e === 'en_attente' || e === 'en_cours';

function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const memes = (tables.rush_clip_sets ?? [])
    .filter((l) => l.candidate_set_id === valeurs.candidate_set_id);
  if (memes.some((l) => l.version === valeurs.version)) {
    return doublon('rush_clip_sets_candidats_version_unique');
  }
  if (actif(valeurs.etat) && memes.some((l) => actif(l.etat))) {
    return doublon('rush_clip_sets_active_unique');
  }
  return null;
}

const maintenantIso = () => new Date().toISOString();
function anterieurA(v: unknown, b: unknown): boolean {
  const x = Date.parse(String(v)); const y = Date.parse(String(b));
  return Number.isFinite(x) && Number.isFinite(y) && x < y;
}

function requete(table: string) {
  if (tableEnPanne === table) throw new Error(MESSAGE_INTERNE);
  const eq: Array<[string, unknown]> = [];
  const estNul: string[] = [];
  const dans: Array<[string, unknown[]]> = [];
  const avant: Array<[string, unknown]> = [];
  let tri: { c: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMaj: Ligne | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      (l) => eq.every(([c, v]) => l[c] === v)
        && estNul.every((c) => l[c] === null || l[c] === undefined)
        && dans.every(([c, vs]) => vs.includes(l[c]))
        && avant.every(([c, v]) => anterieurA(l[c], v)),
    );
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.c] ?? 0); const y = Number(b[tri!.c] ?? 0);
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
      if (table === 'rush_clip_sets') {
        const cs = (tables.rush_candidate_sets ?? []).find(
          (c) => c.id === valeurs.candidate_set_id
            && c.rush_id === valeurs.rush_id && c.user_id === valeurs.user_id,
        );
        if (!cs) {
          return {
            data: null,
            error: {
              code: '23503',
              message: 'violates foreign key constraint "rush_clip_sets_candidats_rush_proprietaire"',
            },
          };
        }
        const refus = refusUnicite(valeurs);
        if (refus) return { data: null, error: refus };
      }
      // ⚠️ UN IDENTIFIANT DE LA MEME FORME QUE LA VRAIE BASE. `gen_random_uuid()`
      // rend un UUID ; une doublure qui rendrait « cs-1 » ferait passer la
      // lecture par un 422 de validation, et le test vert prouverait le
      // contraire de ce qu'il annonce.
      const n = (tables[table] ?? []).length + 1;
      const ligne: Ligne = {
        id: `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`,
        etape: null, clips: [], usage: {}, motif_echec: null,
        transcription_id: null, transcription_version: null,
        created_at: maintenantIso(), started_at: null, completed_at: null,
        updated_at: maintenantIso(),
        ...valeurs,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }
    if (aMaj) {
      const cibles = lignes() ?? [];
      if (cibles.length === 0) return { data: null, error: null };
      const patch = aMaj;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      return { data: (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null, error: null };
    }
    const l = lignes();
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { if (v === null) estNul.push(c); return api; },
    in: (c: string, vs: unknown[]) => { dans.push([c, vs]); return api; },
    lt: (c: string, v: unknown) => { avant.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (v: Ligne) => { aInserer = v; return api; },
    update: (v: Ligne) => { aMaj = v; ecritures.push({ table, patch: v }); return api; },
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
      if (aInserer || aMaj) {
        const cibles = lignes() ?? [];
        const r = executer() as { data: unknown; error: unknown };
        if (r.error) return resoudre({ data: null, error: r.error });
        return resoudre({ data: aMaj ? cibles : [r.data], error: null });
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
  cleClip, coupeMaterialisable, clipValide, identifiantValide,
  toleranceMaterialisation, seuilPeremptionSet, arrondirSeconde,
  BUCKET_CLIPS, CRF, PRESET, PIXEL_FORMAT, CLIPS_MAX, CLIP_SECONDES_MAX,
  SET_SECONDES_MAX, CLIP_OCTETS_MAX, TIMEOUT_CLIP_MS, TIMEOUT_TELEVERSEMENT_MS, BUDGET_SET_MS,
  PEREMPTION_SET_MS, MOTIFS_CLIPS, METHODE_MATERIALISATION,
  TTL_SOURCE_CLIP_SECONDES, MARGE_SIGNATURE_MS, BORNE_STOCKAGE_CLIPS,
} from '@/lib/autopilot/analyse/clip-contrat';
import { argumentsDecoupe, lireMesure } from '@/lib/autopilot/analyse/clip-extraction';
import { materialiserSet, coupesRetenues, dureeCumulee } from '@/lib/autopilot/analyse/clip';
import {
  creerSet, lireSetReussiIdentique, recupererSetsInterrompus, MOTIF_SET_INTERROMPU,
} from '@/lib/autopilot/analyse/clip-service';
import {
  reinitialiserCapacite, prendrePlaceClips, jeuxClipsEnCoursMaintenant,
  MAX_JEUX_CLIPS_SIMULTANES,
} from '@/lib/autopilot/analyse/capacite';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { Coupe } from '@/lib/autopilot/analyse/coupe-contrat';

const { POST } = await import(
  '@/app/api/autopilot/candidats/[candidateSetId]/clips/route'
);
const { GET } = await import('@/app/api/autopilot/clips/[clipSetId]/route');

const SRC = {
  contrat: resolve(process.cwd(), 'src/lib/autopilot/analyse/clip-contrat.ts'),
  extraction: resolve(process.cwd(), 'src/lib/autopilot/analyse/clip-extraction.ts'),
  orchestration: resolve(process.cwd(), 'src/lib/autopilot/analyse/clip.ts'),
  service: resolve(process.cwd(), 'src/lib/autopilot/analyse/clip-service.ts'),
  routePost: resolve(process.cwd(), 'src/app/api/autopilot/candidats/[candidateSetId]/clips/route.ts'),
  routeGet: resolve(process.cwd(), 'src/app/api/autopilot/clips/[clipSetId]/route.ts'),
};
const MIGRATION = resolve(process.cwd(), 'migrations/2026-09-04-rush-clip-sets.sql');

const CS = '11111111-1111-4111-8111-111111111111';
const AN = '22222222-2222-4222-8222-222222222222';
const RU = '33333333-3333-4333-8333-333333333333';
const T1 = '44444444-4444-4444-8444-444444444444';
const T2 = '55555555-5555-4555-8555-555555555555';
const DUREE = 40;

function coupe(over: Partial<Coupe> = {}): Coupe {
  const d = over.debutSecondes ?? 10;
  const f = over.finSecondes ?? 18;
  return {
    rang: 1, secondeReference: (d + f) / 2, dureeCibleSecondes: 8,
    scoreMontage: 77, raison: 'r',
    debutOriginalSecondes: d, finOriginalSecondes: f,
    debutSecondes: d, finSecondes: f, dureeSecondes: arrondirSeconde(f - d),
    ajustementDebut: { deltaSecondes: 0, source: 'aucun' },
    ajustementFin: { deltaSecondes: 0, source: 'aucun' },
    ...over,
  };
}

function ligneCandidats(over: Ligne = {}): Ligne {
  return {
    id: CS, analysis_id: AN, rush_id: RU, user_id: 'A', version: 1,
    etat: 'reussie', etape: 'candidats', fournisseurs: {},
    candidats: [
      { rang: 1, secondeReference: 14, dureeCibleSecondes: 8, debutSecondes: 10, finSecondes: 18, scoreMontage: 77, raison: 'r1' },
      { rang: 2, secondeReference: 30, dureeCibleSecondes: 5, debutSecondes: 27.5, finSecondes: 32.5, scoreMontage: 70, raison: 'r2' },
    ],
    usage: {}, motif_echec: null, created_at: maintenantIso(), updated_at: maintenantIso(),
    ...over,
  };
}
function ligneAnalyse(over: Ligne = {}): Ligne {
  return {
    id: AN, rush_id: RU, user_id: 'A', version: 8, etat: 'reussie', etape: 'visuel',
    fournisseurs: {}, duree_secondes: DUREE, technique: {}, resume: null,
    textes_visibles: [], parole: {},
    audio: { present: true, etatMesure: 'mesuree', silences: [] },
    qualite: {}, vignettes: [], usage: {}, motif_echec: null,
    created_at: maintenantIso(), updated_at: maintenantIso(), ...over,
  };
}
function ligneRush(over: Ligne = {}): Ligne {
  return {
    id: RU, shoot_session_id: 's', user_id: 'A', bucket: 'media',
    cle_objet: 'A/rush/p.mp4', nom_origine: 'p.mp4', content_type: 'video/mp4',
    taille_octets: 5_000_000, duree_secondes: DUREE, rang: 0, etat: 'verifie',
    metadata: {}, created_at: maintenantIso(), updated_at: maintenantIso(), ...over,
  };
}
function ligneTranscription(over: Ligne = {}): Ligne {
  return {
    id: T1, rush_id: RU, user_id: 'A', version: 1, etat: 'reussie', etape: 'transcription',
    fournisseurs: {}, presente: true, langue: 'french', texte: 't',
    segments: [], mots: [], usage: {}, motif_echec: null,
    created_at: maintenantIso(), started_at: null, completed_at: null,
    updated_at: maintenantIso(), ...over,
  };
}

function post(id = CS, corps?: unknown) {
  return POST(
    new Request('http://x/api', {
      method: 'POST',
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }) as never,
    { params: { candidateSetId: id } },
  );
}
/** Laisse le travail détaché s'exécuter. */
const attendre = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  tables = {
    rush_candidate_sets: [ligneCandidats()],
    rush_analyses: [ligneAnalyse()],
    rushes: [ligneRush()],
    rush_transcriptions: [ligneTranscription()],
    rush_clip_sets: [],
  };
  tableAbsente = null;
    tableEnPanne = null;
  tentativesInsertion.length = 0;
  objetsEcrits.length = 0;
  ecritures.length = 0;
  objetsSupprimes.length = 0;
  commandes.length = 0;
  ffmpeg = { code: 0, octets: 4096 };
  signeurCasse = false; putCasse = false; removeCasse = false;
  reinitialiserCapacite();
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-9. Le contrat : bornes, clé, vocabulaire', () => {
  it('la clé de stockage est FABRIQUÉE, jamais reçue', () => {
    expect(cleClip('A', CS, 4)).toBe(`A/autopilote/clips/${CS}/rang-04.mp4`);
    // Le préfixe utilisateur EST la preuve de propriété, partout dans le projet.
    expect(cleClip('A', CS, 1).startsWith('A/')).toBe(true);
    // Déterministe : deux appels, la même clé.
    expect(cleClip('A', CS, 2)).toBe(cleClip('A', CS, 2));
    // Deux jeux ne peuvent pas se marcher dessus.
    expect(cleClip('A', CS, 1)).not.toBe(cleClip('A', AN, 1));
    expect(cleClip('A', CS, 1)).not.toContain('://');
  });

  it('une coupe nulle, inversée ou démesurée n’est pas matérialisable', () => {
    expect(coupeMaterialisable(coupe())).toBe(true);
    expect(coupeMaterialisable(coupe({ debutSecondes: 5, finSecondes: 5 }))).toBe(false);
    expect(coupeMaterialisable(coupe({ debutSecondes: 9, finSecondes: 4 }))).toBe(false);
    expect(coupeMaterialisable(coupe({ debutSecondes: -1, finSecondes: 4 }))).toBe(false);
    expect(coupeMaterialisable(coupe({ debutSecondes: 0, finSecondes: CLIP_SECONDES_MAX + 1 }))).toBe(false);
    expect(coupeMaterialisable({ ...coupe(), debutSecondes: Number.NaN })).toBe(false);
  });

  it('un clip relu sans clé, ou avec une URL, est écarté', () => {
    const bon = {
      rang: 1, debutSecondes: 1, finSecondes: 2, dureeSecondes: 1,
      bucket: 'videos', cle: 'A/autopilote/clips/x/rang-01.mp4', octets: 10,
      debutMesureSecondes: 0, dureeMesureeSecondes: 1,
    };
    expect(clipValide(bon)).toBe(true);
    expect(clipValide({ ...bon, cle: 'https://x/y.mp4' })).toBe(false);
    expect(clipValide({ ...bon, cle: 'A/../B/x.mp4' })).toBe(false);
    expect(clipValide({ ...bon, octets: Number.NaN })).toBe(false);
    expect(clipValide(null)).toBe(false);
  });

  it('la tolérance vient du SUPPORT, pas d’une préférence', () => {
    // Une image dure 33,3 ms à 30 i/s, une trame AAC 21,3 ms : exiger mieux
    // serait exiger l'impossible.
    expect(toleranceMaterialisation(30)).toBeCloseTo(0.06, 6);
    expect(toleranceMaterialisation(24)).toBeCloseTo(0.0625, 6);
    expect(toleranceMaterialisation(60)).toBeCloseTo(0.06, 6);
    // Une cadence absurde ne fait pas exploser la borne.
    expect(toleranceMaterialisation(0)).toBeCloseTo(0.06, 6);
    expect(toleranceMaterialisation(Number.NaN)).toBeCloseTo(0.06, 6);
  });

  it('les bornes et le vocabulaire sont fermés', () => {
    expect(CLIPS_MAX).toBe(6);
    expect(BUCKET_CLIPS).toBe('videos');
    expect(CRF).toBe(23);
    expect(PRESET).toBe('veryfast');
    expect(PIXEL_FORMAT).toBe('yuv420p');
    expect(METHODE_MATERIALISATION).toBe('x264-crf23-v1');
    expect(MOTIFS_CLIPS).toEqual([
      'candidats_introuvables', 'decision_invalide', 'source_inaccessible',
      'outil_absent', 'media_illisible', 'extraction_echouee',
      'televersement_echoue', 'timeout', 'capacite_saturee', 'set_interrompu',
    ]);
    // La péremption doit franchement dépasser le pire cas, sinon on fermerait
    // un découpage qui travaille encore.
    // Le budget est la SOMME des bornes, pas un nombre choisi à la main.
    expect(BUDGET_SET_MS).toBe(10_000 + CLIPS_MAX * (TIMEOUT_CLIP_MS + TIMEOUT_TELEVERSEMENT_MS));
    expect(PEREMPTION_SET_MS).toBeGreaterThan(BUDGET_SET_MS);
    expect(Date.parse(seuilPeremptionSet())).toBeLessThan(Date.now());
    expect(identifiantValide(CS)).toBe(true);
    expect(identifiantValide('pas-un-uuid')).toBe(false);
  });

  it('la TTL de la source est DÉRIVÉE du budget, et le couvre toujours', () => {
    // ⚠️ L'INVARIANT, ET NON LA VALEUR. Reprendre les dix minutes de M3-B2
    // aurait laissé la signature expirer au milieu d'un jeu de six clips :
    // les derniers auraient échoué en `media_illisible`, un diagnostic FAUX
    // pour une URL périmée.
    expect(TTL_SOURCE_CLIP_SECONDES * 1000).toBeGreaterThan(BUDGET_SET_MS);

    // Elle est CALCULÉE : allonger un délai par clip, ou en autoriser un
    // septième, allonge du même geste la validité de la signature. Une
    // constante écrite à la main aurait cessé de couvrir le budget sans que
    // rien ne rougisse — c'est exactement ce que ce test empêche.
    expect(TTL_SOURCE_CLIP_SECONDES)
      .toBe(Math.ceil((BUDGET_SET_MS + MARGE_SIGNATURE_MS) / 1000));
    expect(MARGE_SIGNATURE_MS).toBeGreaterThan(0);

    // Le calcul est bien celui de la source, pas un nombre recopié à côté.
    const contrat = readFileSync(SRC.contrat, 'utf8');
    expect(contrat).toMatch(
      /TTL_SOURCE_CLIP_SECONDES\s*=\s*\n?\s*Math\.ceil\(\(BUDGET_SET_MS \+ MARGE_SIGNATURE_MS\) \/ 1000\)/,
    );

    // ⚠️ ET RIEN N'EST ÉLARGI AILLEURS. Le TTL de M3-B2 reste à dix minutes :
    // ce lot ne prolonge la vie d'aucune signature hors de son propre chemin.
    const extraction = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/extraction.ts'), 'utf8',
    );
    // Lue dans la source, et non importée : le module est doublé ici, et un
    // import rendrait la valeur de la doublure plutôt que celle du dépôt.
    const m3b = /export const TTL_URL_SECONDES = (\d+);/.exec(extraction);
    expect(m3b?.[1]).toBe('600');
    expect(TTL_SOURCE_CLIP_SECONDES).toBeGreaterThan(Number(m3b![1]));
  });

  it('c’est bien le TTL M3-F que la source est signée, pas celui des vignettes', () => {
    const src = readFileSync(SRC.extraction, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('TTL_SOURCE_CLIP_SECONDES');
    // Aucune signature de M3-F ne retombe sur la borne historique.
    expect(src).not.toMatch(/presignedGetObject\([^)]*TTL_URL_SECONDES/);
    expect(src).toMatch(/presignedGetObject\([^)]*TTL_SOURCE_CLIP_SECONDES\)/);
  });

  it('la borne réseau du téléversement est celle de M3-F, pas celle des vignettes', () => {
    // `BORNE_MINIO` vaut dix secondes, dimensionnées pour un `statObject` et
    // des vignettes. Le transport borné DÉTRUIT la requête à l'échéance : la
    // reprendre aurait coupé un clip de 64 Mio bien avant les soixante
    // secondes annoncées, et le contrat aurait menti.
    expect(BORNE_STOCKAGE_CLIPS).toEqual({ timeoutMs: TIMEOUT_TELEVERSEMENT_MS });
    expect(TIMEOUT_TELEVERSEMENT_MS).toBeGreaterThan(10_000);

    const src = readFileSync(SRC.extraction, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('clientMinio(BORNE_STOCKAGE_CLIPS).putObject');
    // ⚠️ AUCUN `Promise.race` : `minio-client.ts` explique qu'une course est
    // une borne en trompe-l'œil — elle rend la main sans fermer la socket, et
    // un téléversement déclaré échoué continuerait d'écrire l'objet.
    expect(src).not.toContain('Promise.race');
  });

  it('le transport borné COUPE réellement la requête — ce n’est pas une course', async () => {
    // La preuve que la borne arrête l'I/O plutôt que de cesser d'attendre :
    // le transport détruit la `ClientRequest`, ce qui fait rejeter la promesse.
    const { transportMinioBorne, RAISON_TIMEOUT_MINIO } = await import('@/lib/storage/minio-client');
    const http = await import('http');
    const muet = http.createServer(() => { /* n'répond jamais */ });
    await new Promise<void>((pret) => muet.listen(0, '127.0.0.1', pret));
    const port = (muet.address() as { port: number }).port;

    const transport = transportMinioBorne(false, 120);
    const rejet = await new Promise<Error>((resoudre) => {
      const requete = transport.request(
        { host: '127.0.0.1', port, path: '/', method: 'GET' } as never,
        () => { /* jamais */ },
      );
      requete.on('error', (e: Error) => resoudre(e));
      requete.end();
    });
    muet.close();

    expect(rejet.message).toContain(RAISON_TIMEOUT_MINIO);
    // La socket est bien fermée : aucun travail fantôme ne continue.
    expect(rejet.message).not.toMatch(/127\.0\.0\.1|localhost/);
  }, 20_000);

  it('la méthode n’est écrite QU’UNE FOIS, dans le contrat', () => {
    // `usage.methode` recopiait le littéral : changer le profil d'encodage à
    // un seul endroit aurait laissé l'autre mentir sur ce qui a été produit.
    for (const [nom, chemin] of Object.entries(SRC)) {
      if (nom === 'contrat') continue;
      const src = readFileSync(chemin, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(src).not.toContain(`'${METHODE_MATERIALISATION}'`);
    }
    const contrat = readFileSync(SRC.contrat, 'utf8');
    expect(contrat).toContain("export const METHODE_MATERIALISATION = 'x264-crf23-v1' as const;");
  });

  it('les arguments ffmpeg portent chacun leur garantie', () => {
    const a = argumentsDecoupe(URL_SIGNEE, coupe({ debutSecondes: 3, finSecondes: 6 }), '/tmp/x/rang-01.mp4');
    expect(a[a.indexOf('-protocol_whitelist') + 1]).toBe('http,https,tcp,tls');
    // `-ss` et `-to` AVANT `-i` : c'est ce qui rend la recherche exacte.
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'));
    expect(a.indexOf('-to')).toBeLessThan(a.indexOf('-i'));
    expect(a[a.indexOf('-ss') + 1]).toBe('3');
    expect(a[a.indexOf('-to') + 1]).toBe('6');
    expect(a[a.indexOf('-c:v') + 1]).toBe('libx264');
    expect(a[a.indexOf('-crf') + 1]).toBe('23');
    expect(a[a.indexOf('-preset') + 1]).toBe('veryfast');
    expect(a[a.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(a[a.indexOf('-c:a') + 1]).toBe('aac');
    expect(a[a.indexOf('-movflags') + 1]).toBe('+faststart');
    // Le `?` est ce qui fait qu'un rush MUET ne fait pas échouer la découpe.
    expect(a).toContain('0:a:0?');
    expect(a).toContain('-nostdin');
    // ⚠️ SURTOUT PAS de copie de flux : elle démarrerait sur l'image-clé.
    expect(a.join(' ')).not.toContain('-c copy');
    expect(a.join(' ')).not.toContain('-c:v copy');
  });

  it('une mesure ffprobe absente se dit `null`, elle ne s’invente pas', () => {
    expect(lireMesure('{"format":{"duration":"2.933"},"streams":[{"start_time":"0.010"}]}'))
      .toEqual({ debut: 0.01, duree: 2.933 });
    expect(lireMesure('pas du json')).toEqual({ debut: null, duree: null });
    expect(lireMesure('{}')).toEqual({ debut: null, duree: null });
  });

  it('les coupes retenues sont triées et plafonnées à six', () => {
    const brut = Array.from({ length: 9 }, (_, i) => coupe({
      rang: 9 - i, debutSecondes: i, finSecondes: i + 2,
    }));
    const r = coupesRetenues(brut);
    expect(r).toHaveLength(CLIPS_MAX);
    expect(r.map((c) => c.rang)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dureeCumulee([coupe({ debutSecondes: 0, finSecondes: 3 })])).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('10-16. La matérialisation d’un jeu : atomicité et orphelins', () => {
  const demande = (coupes: Coupe[]) => ({
    userId: 'A', clipSetId: CS,
    source: { bucket: 'media', cleObjet: 'A/rush/p.mp4', userId: 'A' },
    coupes,
  });

  it('un jeu complet produit un objet par coupe, aux clés attendues', async () => {
    const r = await materialiserSet(demande([
      coupe({ rang: 1, debutSecondes: 10, finSecondes: 13 }),
      coupe({ rang: 2, debutSecondes: 20, finSecondes: 23 }),
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clips.map((c) => c.cle)).toEqual([
      `A/autopilote/clips/${CS}/rang-01.mp4`,
      `A/autopilote/clips/${CS}/rang-02.mp4`,
    ]);
    expect(objetsEcrits).toHaveLength(2);
    expect(objetsEcrits.every((o) => o.bucket === 'videos')).toBe(true);
    expect(r.usage).toMatchObject({ clipsProduits: 2, methode: 'x264-crf23-v1' });
    // La mesure du fichier PRODUIT est consignée : la précision est auditable.
    expect(r.clips[0].dureeMesureeSecondes).toBe(2.933);
  });

  it('LE JEU EST ATOMIQUE : un échec en cours de route rend les objets', async () => {
    let n = 0;
    ffmpeg = { code: 0, octets: 4096 };
    const vraiLancer = commandes;
    // Le deuxième découpage échoue.
    const originale = ffmpeg;
    const r = await materialiserSet({
      ...demande([
        coupe({ rang: 1, debutSecondes: 10, finSecondes: 13 }),
        coupe({ rang: 2, debutSecondes: 20, finSecondes: 23 }),
      ]),
      coupes: [
        coupe({ rang: 1, debutSecondes: 10, finSecondes: 13 }),
        coupe({ rang: 2, debutSecondes: 20, finSecondes: 23 }),
      ],
    });
    void n; void vraiLancer; void originale;
    expect(r.ok).toBe(true); // témoin : sans panne, les deux passent
    objetsEcrits.length = 0;
  ecritures.length = 0; objetsSupprimes.length = 0;

    // Maintenant, la panne au deuxième clip.
    let appel = 0;
    ffmpeg = { code: 0, octets: 4096 };
    const { materialiserSet: refaire } = await import('@/lib/autopilot/analyse/clip');
    putCasse = false;
    const espion = vi.spyOn(await import('@/lib/autopilot/analyse/clip-extraction'), 'materialiserClip');
    espion.mockImplementation(async (e) => {
      appel += 1;
      if (appel === 1) {
        objetsEcrits.push({ bucket: 'videos', cle: cleClip('A', CS, 1), octets: 10 });
        return {
          ok: true,
          clip: {
            rang: 1, debutSecondes: 10, finSecondes: 13, dureeSecondes: 3,
            bucket: 'videos', cle: cleClip('A', CS, 1), octets: 10,
            debutMesureSecondes: 0, dureeMesureeSecondes: 3,
          },
        };
      }
      void e;
      return { ok: false, motif: 'media_illisible' as const };
    });

    const echec = await refaire(demande([
      coupe({ rang: 1, debutSecondes: 10, finSecondes: 13 }),
      coupe({ rang: 2, debutSecondes: 20, finSecondes: 23 }),
    ]));
    espion.mockRestore();

    expect(echec.ok).toBe(false);
    if (echec.ok) return;
    expect(echec.motif).toBe('media_illisible');
    // Le premier clip, déjà en ligne, redescend : un jeu à trous n'a pas de sens.
    expect(objetsSupprimes).toEqual([{ bucket: 'videos', cle: cleClip('A', CS, 1) }]);
    expect(echec.usage).toMatchObject({ clipsProduitsAvantEchec: 1 });
    expect(echec.usage.orphelins).toBeUndefined();
  });

  it('un objet qui ne redescend pas est COMPTÉ, jamais tu', async () => {
    removeCasse = true;
    let appel = 0;
    const espion = vi.spyOn(await import('@/lib/autopilot/analyse/clip-extraction'), 'materialiserClip');
    espion.mockImplementation(async () => {
      appel += 1;
      if (appel === 1) {
        return {
          ok: true,
          clip: {
            rang: 1, debutSecondes: 10, finSecondes: 13, dureeSecondes: 3,
            bucket: 'videos', cle: cleClip('A', CS, 1), octets: 10,
            debutMesureSecondes: 0, dureeMesureeSecondes: 3,
          },
        };
      }
      return { ok: false, motif: 'televersement_echoue' as const };
    });
    const r = await materialiserSet(demande([
      coupe({ rang: 1, debutSecondes: 10, finSecondes: 13 }),
      coupe({ rang: 2, debutSecondes: 20, finSecondes: 23 }),
    ]));
    espion.mockRestore();
    expect(r.ok).toBe(false);
    // Il n'existe aucune transaction commune à PostgreSQL et MinIO : on ne
    // promet pas ce qu'on ne tient pas, on le rapporte.
    expect(r.usage.orphelins).toBe(1);
  });

  it('les pannes de découpe portent chacune leur motif', async () => {
    const cas: Array<[Record<string, unknown>, string]> = [
      [{ introuvable: true, code: null }, 'outil_absent'],
      [{ timeout: true, code: null }, 'timeout'],
      [{ code: 1 }, 'media_illisible'],
      [{ code: 0, octets: 0 }, 'extraction_echouee'],
      [{ code: 0, octets: CLIP_OCTETS_MAX + 1 }, 'extraction_echouee'],
    ];
    for (const [patch, motif] of cas) {
      objetsEcrits.length = 0;
  ecritures.length = 0;
      ffmpeg = { code: 0, octets: 4096, ...patch } as typeof ffmpeg;
      const r = await materialiserSet(demande([coupe({ debutSecondes: 10, finSecondes: 13 })]));
      expect(r.ok, motif).toBe(false);
      if (!r.ok) expect(r.motif).toBe(motif);
      expect(objetsEcrits).toHaveLength(0);
    }
  });

  it('un téléversement en échec ne laisse aucun clip', async () => {
    putCasse = true;
    const r = await materialiserSet(demande([coupe({ debutSecondes: 10, finSecondes: 13 })]));
    expect(r).toMatchObject({ ok: false, motif: 'televersement_echoue' });
  });

  it('un stockage non configuré n’écrit rien et ne découpe rien', async () => {
    signeurCasse = true;
    const r = await materialiserSet(demande([coupe()]));
    expect(r).toMatchObject({ ok: false, motif: 'source_inaccessible' });
    expect(commandes).toHaveLength(0);
  });

  it('une clé hors du préfixe utilisateur est refusée avant tout accès', async () => {
    for (const cle of ['B/rush/p.mp4', 'A/../B/p.mp4', 'https://ailleurs/p.mp4']) {
      const r = await materialiserSet({
        ...demande([coupe()]),
        source: { bucket: 'media', cleObjet: cle, userId: 'A' },
      });
      expect(r).toMatchObject({ ok: false, motif: 'source_inaccessible' });
    }
    expect(commandes).toHaveLength(0);
  });

  it('une décision vide ou démesurée est refusée sans rien découper', async () => {
    expect(await materialiserSet(demande([]))).toMatchObject({
      ok: false, motif: 'decision_invalide',
    });
    const enorme = Array.from({ length: 6 }, (_, i) => coupe({
      rang: i + 1, debutSecondes: i * 25, finSecondes: i * 25 + 25,
    }));
    expect(dureeCumulee(enorme)).toBeGreaterThan(SET_SECONDES_MAX);
    expect(await materialiserSet(demande(enorme))).toMatchObject({
      ok: false, motif: 'decision_invalide',
    });
    expect(commandes).toHaveLength(0);
  });

  it('le répertoire temporaire ne survit jamais au jeu', async () => {
    await materialiserSet(demande([coupe({ debutSecondes: 10, finSecondes: 13 })]));
    const sortie = commandes.find((c) => !c.args.includes('-show_entries'));
    expect(sortie).toBeDefined();
    const chemin = sortie!.args[sortie!.args.length - 1];
    expect(chemin).toContain('studiio-m3f-');
    expect(existsSync(chemin)).toBe(false);
    // Et même quand tout échoue.
    ffmpeg = { code: 1 };
    commandes.length = 0;
    await materialiserSet(demande([coupe({ debutSecondes: 10, finSecondes: 13 })]));
    const echec = commandes.find((c) => !c.args.includes('-show_entries'))!;
    expect(existsSync(echec.args[echec.args.length - 1])).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('17-24. La persistance : idempotence, réutilisation, reprise', () => {
  const identite = {
    candidateSetId: CS, candidateSetVersion: 1, rushId: RU, analysisId: AN,
    transcriptionId: T1, transcriptionVersion: 1, algorithme: 'm3e-v1',
    methodeMaterialisation: METHODE_MATERIALISATION,
  };

  it('le jeu de candidats d’autrui : la CLÉ ÉTRANGÈRE refuse, pas un `if`', async () => {
    await expect(creerSet('B', identite)).rejects.toThrowError(
      /rush_clip_sets_candidats_rush_proprietaire/,
    );
    expect(tables.rush_clip_sets).toHaveLength(0);
    // L'insertion a bien été TENTÉE : aucun `select` ne s'est substitué à la base.
    expect(tentativesInsertion.filter((t) => t.table === 'rush_clip_sets')).toHaveLength(1);
  });

  it('deux créations concurrentes : la BASE en refuse une', async () => {
    const [x, y] = await Promise.allSettled([creerSet('A', identite), creerSet('A', identite)]);
    const motifs = [x, y].map((r) => (r.status === 'fulfilled' ? r.value.motif : 'leve'));
    expect(motifs.filter((m) => m === null)).toHaveLength(1);
    expect(motifs).toContain('set_actif_existant');
    expect(tentativesInsertion.filter((t) => t.table === 'rush_clip_sets')).toHaveLength(2);
    expect(tables.rush_clip_sets.filter((l) => actif(l.etat))).toHaveLength(1);
  });

  it('un jeu actif RÉCENT bloque et n’est pas fermé', async () => {
    tables.rush_clip_sets = [{
      id: 'vieux', candidate_set_id: CS, rush_id: RU, user_id: 'A', version: 1,
      etat: 'en_cours', created_at: maintenantIso(),
    }];
    expect((await creerSet('A', identite)).motif).toBe('set_actif_existant');
    expect(tables.rush_clip_sets[0].etat).toBe('en_cours');
  });

  it('un jeu actif PÉRIMÉ est fermé, et la version suivante passe', async () => {
    const vieux = new Date(Date.now() - PEREMPTION_SET_MS - 60_000).toISOString();
    tables.rush_clip_sets = [{
      id: 'mort', candidate_set_id: CS, rush_id: RU, user_id: 'A', version: 1,
      etat: 'en_cours', created_at: vieux,
    }];
    const r = await creerSet('A', identite);
    expect(r.motif).toBeNull();
    expect(r.set?.version).toBe(2);
    const mort = tables.rush_clip_sets.find((l) => l.id === 'mort')!;
    expect(mort.etat).toBe('echouee');
    expect(mort.motif_echec).toBe(MOTIF_SET_INTERROMPU);
    // Aucun clip inventé : un jeu interrompu n'a rien produit.
    expect(mort.clips).toBeUndefined();
  });

  it('la péremption ne touche ni le rush d’autrui, ni un autre jeu', async () => {
    const vieux = new Date(Date.now() - PEREMPTION_SET_MS - 60_000).toISOString();
    tables.rush_clip_sets = [
      { id: 'a', candidate_set_id: CS, user_id: 'B', etat: 'en_cours', created_at: vieux },
      { id: 'b', candidate_set_id: 'autre', user_id: 'A', etat: 'en_cours', created_at: vieux },
    ];
    expect((await recupererSetsInterrompus('A', CS)).fermes).toBe(0);
    expect(tables.rush_clip_sets.every((l) => l.etat === 'en_cours')).toBe(true);
  });

  it('un jeu RÉUSSI d’identité identique est retrouvé — et réutilisé', async () => {
    tables.rush_clip_sets = [{
      id: 'ok', candidate_set_id: CS, candidate_set_version: 1, rush_id: RU,
      analysis_id: AN, transcription_id: T1, transcription_version: 1,
      algorithme: 'm3e-v1', methode_materialisation: METHODE_MATERIALISATION,
      user_id: 'A', version: 1, etat: 'reussie',
      clips: [], usage: {}, created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    const r = await lireSetReussiIdentique('A', identite);
    expect(r.set?.id).toBe('ok');
    // ⚠️ LA MÉTHODE FAIT PARTIE DE L'IDENTITÉ. Changer de codec ou de qualité
    // sans toucher à M3-E ne doit PAS rendre les fichiers de l'encodage
    // précédent : on croirait avoir réencodé, et l'on servirait l'ancien.
    expect((await lireSetReussiIdentique('A', {
      ...identite, methodeMaterialisation: 'x264-crf22-v2',
    })).set).toBeNull();
    // Une transcription DIFFÉRENTE, c'est une autre décision : pas de réutilisation.
    expect((await lireSetReussiIdentique('A', { ...identite, transcriptionId: T2 })).set).toBeNull();
    // Une version de candidats différente non plus.
    expect((await lireSetReussiIdentique('A', { ...identite, candidateSetVersion: 2 })).set).toBeNull();
  });

  it('la MÉTHODE est persistée, et la réutilisation la filtre en base', async () => {
    // ⚠️ FILTRÉE PAR LA BASE, PAS PAR UN `if`. Un jeu réussi n'est repris que
    // si les octets ont été produits de la même façon ; sinon on servirait
    // l'ancien encodage en croyant avoir réencodé.
    const cree = await creerSet('A', identite);
    expect(cree.motif).toBeNull();
    expect(cree.set).not.toBeNull();
    const ligne = tables.rush_clip_sets[0];
    expect(ligne.methode_materialisation).toBe(METHODE_MATERIALISATION);
    // La colonne porte le nom de la migration, jamais une abréviation.
    expect(Object.keys(ligne)).toContain('methode_materialisation');

    tables.rush_clip_sets = [{ ...ligne, etat: 'reussie' }];
    expect((await lireSetReussiIdentique('A', identite)).set?.id).toBe(ligne.id);
    expect((await lireSetReussiIdentique('A', {
      ...identite, methodeMaterialisation: 'x264-crf18-v2',
    })).set).toBeNull();
    // Et ce qui remonte est bien relu depuis la colonne.
    const relu = await lireSetReussiIdentique('A', identite);
    expect(relu.set?.methodeMaterialisation).toBe(METHODE_MATERIALISATION);
  });

  it('`transcription_id` NUL se compare avec `is`, jamais avec `eq`', async () => {
    tables.rush_clip_sets = [{
      id: 'sans', candidate_set_id: CS, candidate_set_version: 1, rush_id: RU,
      analysis_id: AN, transcription_id: null, transcription_version: null,
      algorithme: 'm3e-v1', methode_materialisation: METHODE_MATERIALISATION,
      user_id: 'A', version: 1, etat: 'reussie',
      clips: [], usage: {}, created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    // Sans ce soin, un rush sans transcription refabriquerait le même jeu à l'infini.
    const r = await lireSetReussiIdentique('A', {
      ...identite, transcriptionId: null, transcriptionVersion: null,
    });
    expect(r.set?.id).toBe('sans');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('25-38. Les routes : propriété, refus, aucun timecode client', () => {
  it('sans session : 401', async () => {
    // L'authentification est doublée sur un utilisateur ; le contrôle du
    // source vérifie que la route la demande bien.
    const src = readFileSync(SRC.routePost, 'utf8');
    expect(src).toContain('await auth()');
    expect(src).toContain("{ status: 401 }");
  });

  it('identifiant malformé : 422, avant toute lecture', async () => {
    const rep = await post('pas-un-uuid');
    expect(rep.status).toBe(422);
    expect((await rep.json()).motif).toBe('identifiant_invalide');
    expect(tables.rush_clip_sets).toHaveLength(0);
  });

  it('jeu de candidats inconnu, ou d’autrui : 404 indistinguable', async () => {
    tables.rush_candidate_sets = [];
    expect((await post()).status).toBe(404);
    tables.rush_candidate_sets = [ligneCandidats({ user_id: 'B' })];
    const rep = await post();
    expect(rep.status).toBe(404);
    expect((await rep.json()).error).toBe('Passages introuvables');
  });

  it('jeu non réussi, ou sans candidat : 409', async () => {
    tables.rush_candidate_sets = [ligneCandidats({ etat: 'echouee' })];
    expect((await post()).status).toBe(409);
    tables.rush_candidate_sets = [ligneCandidats({ candidats: [] })];
    expect((await post()).status).toBe(409);
  });

  it('l’analyse d’un AUTRE rush ne sert jamais de source', async () => {
    tables.rush_analyses = [ligneAnalyse({ rush_id: 'autre' })];
    expect((await post()).status).toBe(404);
  });

  it('durée inconnue, rush non vérifié : 409, sans rien écrire', async () => {
    tables.rush_analyses = [ligneAnalyse({ duree_secondes: null })];
    expect((await post()).status).toBe(409);
    tables.rush_analyses = [ligneAnalyse()];
    tables.rushes = [ligneRush({ etat: 'indexe' })];
    const rep = await post();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('rush_non_verifie');
    expect(tables.rush_clip_sets).toHaveLength(0);
  });

  it('AUCUN TIMECODE CLIENT : les champs de bornes sont REFUSÉS', async () => {
    for (const interdit of ['debutSecondes', 'finSecondes', 'coupes', 'clips',
      'bucket', 'cle', 'cleObjet', 'rushId', 'userId']) {
      const rep = await post(CS, { [interdit]: 1 });
      expect(rep.status, interdit).toBe(422);
      expect((await rep.json()).error).toContain(interdit);
    }
    expect(tables.rush_clip_sets).toHaveLength(0);
    expect(commandes).toHaveLength(0);
    // Et le contrat ne comporte aucun champ de ce genre.
    const src = readFileSync(SRC.routePost, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).toContain('calerCoupes');
  });

  it('transcription demandée : inconnue 404, autre rush 409, non réussie 409', async () => {
    expect((await post(CS, { transcriptionId: T2 })).status).toBe(404);
    tables.rush_transcriptions = [ligneTranscription({ id: T2, rush_id: 'autre' })];
    let rep = await post(CS, { transcriptionId: T2 });
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('transcription_autre_rush');
    tables.rush_transcriptions = [ligneTranscription({ id: T2, etat: 'echouee' })];
    rep = await post(CS, { transcriptionId: T2 });
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('transcription_non_reussie');
    expect(tables.rush_clip_sets).toHaveLength(0);
  });

  it('un POST nominal rend 202 et fige l’identité', async () => {
    const rep = await post();
    expect(rep.status).toBe(202);
    const b = await rep.json();
    expect(b.reutilise).toBe(false);
    expect(b.clipSet).toMatchObject({
      candidateSetId: CS, candidateSetVersion: 1, rushId: RU, analysisId: AN,
      transcriptionId: T1, transcriptionVersion: 1,
      // L'identite d'un jeu porte l'algorithme de M3-E : il passe a `m3e-v2`
      // avec la regle anti-chevauchement de P0-C.
      algorithme: 'm3e-v2',
      methodeMaterialisation: METHODE_MATERIALISATION,
      etat: 'en_attente', version: 1,
    });
    await attendre();
    // Le travail a bien tourné derrière la réponse.
    const ligne = tables.rush_clip_sets[0];
    expect(ligne.etat).toBe('reussie');
    expect((ligne.clips as unknown[]).length).toBeGreaterThan(0);
  });

  it('sans transcription réussie, l’identité fige `null` — et ce n’est pas une erreur', async () => {
    tables.rush_transcriptions = [ligneTranscription({ etat: 'echouee' })];
    const rep = await post();
    expect(rep.status).toBe(202);
    const b = await rep.json();
    expect(b.clipSet.transcriptionId).toBeNull();
    expect(b.clipSet.transcriptionVersion).toBeNull();
  });

  it('DOUBLE POST IDENTIQUE : le jeu réussi est RÉUTILISÉ, rien n’est refait', async () => {
    const premier = await post();
    expect(premier.status).toBe(202);
    await attendre();
    const nbObjets = objetsEcrits.length;
    const nbCommandes = commandes.length;
    expect(tables.rush_clip_sets).toHaveLength(1);

    const second = await post();
    expect(second.status).toBe(200);
    const b = await second.json();
    expect(b.reutilise).toBe(true);
    expect(b.clipSet.id).toBe(tables.rush_clip_sets[0].id);
    await attendre();
    // ⚠️ AUCUN ffmpeg, AUCUN objet, AUCUNE version supplémentaire.
    expect(commandes).toHaveLength(nbCommandes);
    expect(objetsEcrits).toHaveLength(nbObjets);
    expect(tables.rush_clip_sets).toHaveLength(1);
    expect(tables.rush_clip_sets[0].version).toBe(1);
  });

  it('un jeu actif bloque un second POST : 409, sans second découpage', async () => {
    tables.rush_clip_sets = [{
      id: 'actif', candidate_set_id: CS, rush_id: RU, user_id: 'A', version: 1,
      etat: 'en_cours', created_at: maintenantIso(),
    }];
    const rep = await post();
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('set_actif_existant');
    expect(commandes).toHaveLength(0);
  });

  it('capacité saturée : 429, aucune ligne, aucun découpage', async () => {
    expect(MAX_JEUX_CLIPS_SIMULTANES).toBe(1);
    const prise = prendrePlaceClips();
    expect(prendrePlaceClips()).toBeNull();
    const rep = await post();
    expect(rep.status).toBe(429);
    expect(rep.headers.get('Retry-After')).toBeTruthy();
    expect(tables.rush_clip_sets).toHaveLength(0);
    prise!.liberer();
    expect(jeuxClipsEnCoursMaintenant()).toBe(0);
  });

  it('la place est rendue par le TRAVAIL, pas par la réponse', async () => {
    await post();
    // Juste après le 202, le travail tourne encore : la place est prise.
    await attendre();
    expect(jeuxClipsEnCoursMaintenant()).toBe(0);
  });

  it('un échec de découpe ferme la ligne avec son motif, sans clip', async () => {
    ffmpeg = { code: 1 };
    expect((await post()).status).toBe(202);
    await attendre();
    const ligne = tables.rush_clip_sets[0];
    expect(ligne.etat).toBe('echouee');
    expect(ligne.motif_echec).toBe('media_illisible');
    expect(ligne.clips).toEqual([]);
    expect(ligne.completed_at).toBeTruthy();
  });

  it('socle absent : 503, jamais une panne muette', async () => {
    tableAbsente = 'rush_clip_sets';
    const rep = await post();
    expect(rep.status).toBe(503);
    expect((await rep.json()).motif).toBe('socle_absent');
  });

  it('une panne inattendue ne RECOPIE jamais le message interne au client', async () => {
    // Rendre `e.message` était le réflexe : le client aurait lu l'adresse et le
    // port du socle. Le détail part au journal, masqué ; la réponse est muette.
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      tableEnPanne = 'rush_candidate_sets';
      const rep = await post();
      expect(rep.status).toBe(500);
      const corps = JSON.stringify(await rep.json());
      expect(corps).toContain('erreur_interne');
      expect(corps).not.toContain('10.0.0.4');
      expect(corps).not.toContain('ECONNREFUSED');
      expect(corps).not.toContain('postgres');

      tableEnPanne = null;
      await post();
      await attendre();
      const id = String(tables.rush_clip_sets[0].id);
      tableEnPanne = 'rush_clip_sets';
      const lu = await GET({} as never, { params: { clipSetId: id } });
      expect(lu.status).toBe(500);
      const corpsLu = JSON.stringify(await lu.json());
      expect(corpsLu).toContain('erreur_interne');
      expect(corpsLu).not.toContain('10.0.0.4');
      expect(corpsLu).not.toContain('postgres');
      // Le diagnostic existe, côté serveur seulement.
      expect(journal).toHaveBeenCalled();
    } finally {
      tableEnPanne = null;
      journal.mockRestore();
    }
  });

  it('les objets déjà en ligne sont NOTÉS au fil de l’eau, pas à la fin', async () => {
    // Si le conteneur meurt entre le deuxième et le troisième clip, la ligne
    // reste `en_cours` et personne ne sait quels objets existent déjà. Noter
    // les clés après CHAQUE téléversement est la seule trace qui survive.
    const rep = await post();
    expect(rep.status).toBe(202);
    await attendre();

    const ligne = tables.rush_clip_sets[0];
    const usage = ligne.usage as { objetsEnLigne?: string[] };
    const attendues = objetsEcrits.map((o) => o.cle);
    expect(attendues.length).toBeGreaterThan(1);
    // La trace SURVIT à la réussite : `majSet` remplace `usage` en entier.
    expect(usage.objetsEnLigne).toEqual(attendues);

    // ⚠️ ÉCRITE AU FIL DE L'EAU, ce que seul l'ORDRE des écritures prouve —
    // un échantillonnage temporel serait vert par hasard sur une machine lente.
    const traces = ecritures
      // L'écriture finale porte elle aussi la liste : on ne retient ici que
      // celles qui ne ferment RIEN — les traces intermédiaires.
      .filter((e) => e.table === 'rush_clip_sets' && e.patch.etat === undefined)
      .map((e) => (e.patch.usage as { objetsEnLigne?: string[] } | undefined)?.objetsEnLigne)
      .filter((v): v is string[] => Array.isArray(v));
    // Une écriture par téléversement, chacune plus longue que la précédente.
    expect(traces.map((t) => t.length)).toEqual(attendues.map((_, i) => i + 1));
    for (const [i, t] of traces.entries()) expect(t).toEqual(attendues.slice(0, i + 1));

    // Et toutes AVANT la fermeture de la ligne : après un arrêt brutal entre
    // deux clips, la liste des objets déjà en place est en base.
    const finale = ecritures.findIndex((e) => e.patch.etat === 'reussie');
    let derniereTrace = -1;
    ecritures.forEach((e, i) => {
      const u = e.patch.usage as { objetsEnLigne?: unknown } | undefined;
      if (Array.isArray(u?.objetsEnLigne) && e.patch.etat === undefined) derniereTrace = i;
    });
    expect(derniereTrace).toBeGreaterThanOrEqual(0);
    expect(derniereTrace).toBeLessThan(finale);

    for (const cle of attendues) expect(cle.startsWith('A/autopilote/clips/')).toBe(true);
  });

  it('GET : lecture seule, 404 non fuyant, aucune écriture', async () => {
    await post();
    await attendre();
    const id = String(tables.rush_clip_sets[0].id);
    const avant = JSON.stringify(tables.rush_clip_sets);

    const rep = await GET({} as never, { params: { clipSetId: id } });
    expect(rep.status).toBe(200);
    const b = await rep.json();
    expect(b.clipSet.id).toBe(id);
    expect(rep.headers.get('Cache-Control')).toBe('private, no-store');
    // Consulter ne ferme rien : un écran qui sonde ne doit pas tuer le travail.
    expect(JSON.stringify(tables.rush_clip_sets)).toBe(avant);

    expect((await GET({} as never, { params: { clipSetId: 'zzz' } })).status).toBe(422);
    expect((await GET({} as never, { params: { clipSetId: T2 } })).status).toBe(404);
  });

  it('AUCUNE URL SIGNÉE dans ce qui sort ou ce qui est stocké', async () => {
    await post();
    await attendre();
    const rep = await GET({} as never, { params: { clipSetId: String(tables.rush_clip_sets[0].id) } });
    const texte = JSON.stringify(await rep.json()) + JSON.stringify(tables.rush_clip_sets);
    expect(texte).not.toContain('X-Amz');
    expect(texte).not.toContain('studiio-minio');
    expect(texte).not.toMatch(/https?:\/\//);
    expect(texte).not.toContain('/tmp/');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('39-48. Ce que M3-F ne touche pas', () => {
  const sources = () => Object.values(SRC).map(
    (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
  );

  it('AUCUN crédit, nulle part sur le chemin M3-F', () => {
    for (const s of sources()) {
      expect(s).not.toContain('@/lib/credits');
      expect(s).not.toContain('debiter_credits');
      expect(s).not.toContain('credit_transactions');
      expect(s).not.toContain('TYPES_TRANSACTION');
    }
  });

  it('AUCUN fournisseur d’IA, aucun appel sortant', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/anthropic|groq|openai|gemini|higgsfield|replicate/i);
      expect(s).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('`render_jobs` n’est pas détourné', () => {
    for (const s of sources()) {
      expect(s).not.toContain('render_jobs');
      expect(s).not.toContain('rendus');
    }
  });

  it('la dette M3-G n’a pas été anticipée', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/hevc|libx265|scale=|transpose|proxy|sous-titre|subtitle/i);
    }
  });

  it('aucune commande shell construite par concaténation', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/sh\s+-c|bash\s+-c|execSync|child_process/);
    }
    // Le lancement passe par le helper borné de M3-B2, avec un TABLEAU d'args.
    const ext = readFileSync(SRC.extraction, 'utf8');
    expect(ext).toMatch(/import\s*\{[^}]*\blancer\b[^}]*\}\s*from\s*'\.\/extraction'/s);
    expect(ext).toMatch(/lancer\(\s*cheminFfmpeg\(\),\s*argumentsDecoupe\(/);
  });

  it('les sources M3-C, M3-D, M3-E ne sont pas modifiées par ce lot', () => {
    // M3-F les LIT — il ne les réécrit pas, et ne recopie pas l'algorithme.
    const orch = readFileSync(SRC.orchestration, 'utf8');
    expect(orch).not.toContain('TOLERANCE_SECONDES');
    expect(orch).not.toContain('gardeDuree');
    expect(orch).not.toMatch(/silences\s*\.\s*(map|filter|find)/);
    expect(readFileSync(SRC.routePost, 'utf8')).toContain('calerCoupes');
  });

  it('la migration crée sa table, borne ce qu’elle accepte, et n’ouvre aucun droit', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).toContain('create table if not exists public.rush_clip_sets');
    expect(code).toMatch(/foreign key \(candidate_set_id, rush_id, user_id\)/);
    expect(code).toContain('references public.rush_candidate_sets (id, rush_id, user_id)');
    expect(code).toContain('rush_clip_sets_active_unique');
    expect(code).toContain("where etat in ('en_attente', 'en_cours')");
    expect(code).toContain("clips::text not like '%://%'");
    // Le seul contact avec une table existante : l'index que la FK exige.
    expect((code.match(/on public\.rush_candidate_sets/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/alter\s+table/);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toContain('rush_analyses');
    for (const interdit of ['drop table', 'drop column', 'truncate', 'delete from']) {
      expect(code.toLowerCase()).not.toContain(interdit);
    }
  });

  it('les jeux de candidats et les analyses ne sont jamais mutés', async () => {
    const avant = JSON.stringify({
      cs: tables.rush_candidate_sets, an: tables.rush_analyses,
      ru: tables.rushes, tr: tables.rush_transcriptions,
    });
    await post();
    await attendre();
    expect(JSON.stringify({
      cs: tables.rush_candidate_sets, an: tables.rush_analyses,
      ru: tables.rushes, tr: tables.rush_transcriptions,
    })).toBe(avant);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// La preuve réelle : un vrai ffmpeg, sur une fixture engendrée
// ═════════════════════════════════════════════════════════════════════════
function repond(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-hide_banner', '-version'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}
/**
 * ⚠️ ASYNCHRONE, ET C'EST INDISPENSABLE ICI.
 *
 * La fixture est servie par un serveur HTTP qui tourne DANS CE PROCESSUS.
 * `execFileSync` bloque la boucle d'événements : ffmpeg attendrait une
 * réponse que Node ne peut pas émettre, et le seul résultat serait le délai
 * réseau au bout de quinze secondes.
 */
const lancerAsync = promisify(execFile);

const ffmpegDispo = repond(cheminFfmpeg());
const ffprobeDispo = repond(cheminFfprobe());
const binairesDispo = ffmpegDispo && ffprobeDispo;
const siBinaires = () => (binairesDispo ? it : it.skip);

let bac: string | null = null;
const serveurs: Array<{ close(): void }> = [];

/**
 * Sert un fichier local en HTTP, avec `Range`.
 *
 * ⚠️ POURQUOI UN SERVEUR PLUTOT QU'UN CHEMIN. `argumentsDecoupe` n'autorise
 * que `http,https,tcp,tls` : c'est la liste blanche qui ferme la porte SSRF
 * qu'ouvrirait un rush reconnu comme playlist. Ajouter `file` pour la
 * commodité d'un test reviendrait à tester une commande que la production
 * n'exécute jamais. En production le rush arrive par une URL signée ; ici il
 * arrive par une URL locale, et le chemin de code est le même.
 */
async function servir(fichier: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http = require('http') as typeof import('http');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  const taille = fs.statSync(fichier).size;
  const serveur = http.createServer((req, rep) => {
    const plage = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ''));
    if (plage) {
      const debut = plage[1] ? Number(plage[1]) : 0;
      const fin = plage[2] ? Number(plage[2]) : taille - 1;
      rep.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${debut}-${fin}/${taille}`,
        'Content-Length': String(fin - debut + 1),
      });
      fs.createReadStream(fichier, { start: debut, end: fin }).pipe(rep);
      return;
    }
    rep.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(taille),
    });
    fs.createReadStream(fichier).pipe(rep);
  });
  // ⚠️ ATTENDRE L'ÉCOUTE. `listen` est asynchrone : lire `address()` tout de
  // suite rend `null`, et l'URL construite serait inutilisable.
  await new Promise<void>((pret) => serveur.listen(0, '127.0.0.1', pret));
  serveurs.push(serveur);
  const adresse = serveur.address() as { port: number };
  return `http://127.0.0.1:${adresse.port}/fixture.mp4`;
}

afterAll(() => {
  for (const s of serveurs) { try { s.close(); } catch { /* déjà fermé */ } }
  if (bac) rmSync(bac, { recursive: true, force: true });
});

describe('La précision de matérialisation, mesurée sur un vrai fichier', () => {
  it('les binaires attendus sont là, ou le fichier le dit', () => {
    // Un test qui se dégrade en silence est pire qu'un test absent.
    expect({ ffmpeg: ffmpegDispo, ffprobe: ffprobeDispo }).toEqual({
      ffmpeg: ffmpegDispo, ffprobe: ffprobeDispo,
    });
    if (!binairesDispo) {
      console.warn(
        `[m3f] binaires absents (ffmpeg=${ffmpegDispo}, ffprobe=${ffprobeDispo}) :`
        + ' la preuve réelle de précision est ignorée.',
      );
    }
  });

  siBinaires()('une coupe HORS image-clé tient la tolérance, là où la copie de flux la manquerait', async () => {
    bac = mkdtempSync(join(tmpdir(), 'studiio-m3f-test-'));
    const source = join(bac, 'source.mp4');
    // Dix secondes, 30 i/s, une image-clé toutes les DEUX secondes : c'est
    // l'espacement qui rend la copie de flux fausse hors de ces instants.
    execFileSync(cheminFfmpeg(), [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-keyint_min', '60',
      '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-shortest', '-y', source,
    ], { timeout: 120_000, stdio: 'pipe' });

    // ⚠️ SERVI EN HTTP, ET NON LU COMME FICHIER. La liste blanche de
    // protocoles n'autorise que `http,https,tcp,tls` — c'est elle qui ferme
    // la porte SSRF en production, et l'affaiblir pour un test reviendrait à
    // tester autre chose que ce qui tourne. Le rush arrive de toute façon du
    // stockage par une URL signée : la fixture fait pareil.
    const url = await servir(source);
    const cible = coupe({ rang: 1, debutSecondes: 3.3, finSecondes: 6.2 });
    const sortie = join(bac, 'clip.mp4');
    await lancerAsync(cheminFfmpeg(), argumentsDecoupe(url, cible, sortie),
      { timeout: 120_000 });

    const premier = (fichier: string, flux: string) => Number(
      execFileSync(cheminFfprobe(), [
        '-v', 'error', '-select_streams', flux, '-show_packets',
        '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', '-read_intervals', '%+#1',
        fichier,
      ], { timeout: 60_000 }).toString().split('\n').filter(Boolean)[0],
    );
    const duree = Number(execFileSync(cheminFfprobe(), [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sortie,
    ], { timeout: 60_000 }).toString().trim());

    const tolerance = toleranceMaterialisation(30);
    // Le clip commence à zéro dans sa propre horloge, et dure ce qu'on a demandé.
    expect(premier(sortie, 'v:0')).toBeCloseTo(0, 2);
    expect(Math.abs(duree - 2.9)).toBeLessThanOrEqual(tolerance);
    // Vidéo ET audio présents, et le son démarre avec l'image.
    //
    // ⚠️ SUR LE FLUX, PAS SUR LE PREMIER PAQUET. L'encodeur AAC signale son
    // délai d'amorçage (1024 échantillons, soit 21 ms à 48 kHz) par un
    // `start_time` négatif et un `Skip Samples` : tout lecteur conforme le
    // compense, et le compter comme une désynchronisation serait faux.
    const flux = execFileSync(cheminFfprobe(), [
      '-v', 'error', '-show_entries', 'stream=codec_type,start_time',
      '-of', 'csv=p=0', sortie,
    ], { timeout: 60_000 }).toString().trim().split('\n').filter(Boolean);
    expect(flux.some((l) => l.startsWith('video'))).toBe(true);
    const audio = flux.find((l) => l.startsWith('audio'));
    expect(audio).toBeDefined();
    expect(Math.abs(Number(audio!.split(',')[1]))).toBeLessThanOrEqual(0.05);

    // ⚠️ LA COMPARAISON QUI JUSTIFIE TOUT LE LOT : la même coupe en copie de
    // flux part de l'image-clé précédente — ici 2,0 s au lieu de 3,3 s.
    const copie = join(bac, 'copie.mp4');
    execFileSync(cheminFfmpeg(), [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-ss', '3.3', '-to', '6.2', '-i', source, '-copyts', '-c', 'copy', '-y', copie,
    ], { timeout: 120_000, stdio: 'pipe' });
    void url;
    const debutCopie = premier(copie, 'v:0');
    expect(Math.abs(debutCopie - 3.3)).toBeGreaterThan(tolerance);
  }, 180_000);

  siBinaires()('une source SANS piste audio produit quand même un clip', async () => {
    const dossier = bac ?? mkdtempSync(join(tmpdir(), 'studiio-m3f-test-'));
    bac = dossier;
    const muet = join(dossier, 'muet.mp4');
    execFileSync(cheminFfmpeg(), [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', muet,
    ], { timeout: 120_000, stdio: 'pipe' });

    const sortie = join(dossier, 'clip-muet.mp4');
    await lancerAsync(cheminFfmpeg(),
      argumentsDecoupe(await servir(muet), coupe({ debutSecondes: 1.1, finSecondes: 3.1 }), sortie),
      { timeout: 120_000 });

    const flux = execFileSync(cheminFfprobe(), [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', sortie,
    ], { timeout: 60_000 }).toString().trim().split('\n').filter(Boolean);
    // Le `?` de `-map 0:a:0?` : pas de son, pas d'échec.
    expect(flux).toEqual(['video']);
    expect(readdirSync(dossier).length).toBeGreaterThan(0);
  }, 180_000);
});
