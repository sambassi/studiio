// @vitest-environment node
/**
 * M3-H (H5-C) — L'ORCHESTRATION ET LES ROUTES, RÉELLEMENT EXÉCUTÉES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La revue H5 a joué des mutations sur le code de M3-H et regardé si la suite
 * rougissait. Deux gardes ont survécu à leur propre suppression :
 *
 *   1. LA COMPENSATION de `rendreEtPublier`. La fonction était IMPORTÉE et
 *      jamais APPELÉE — TypeScript le disait lui-même (`TS6133`) — et le test
 *      de publication réimplémentait la publication dans une doublure. On
 *      vérifiait donc la doublure, pas le code. Retirer `await compenser(...)`
 *      laissait la suite verte, alors que c'est la machinerie d'atomicité,
 *      la raison d'être du lot.
 *   2. LES TROIS ROUTES. Aucune n'était invoquée : leur comportement était
 *      asserté par expressions régulières sur leur propre source. Changer
 *      `rendu.etat !== 'reussie'` en `!rendu` laissait la suite verte — et un
 *      rendu EN COURS aurait servi ses octets.
 *
 * Une garde qu'on ne peut pas casser dans un test n'est pas prouvée. Ici, on
 * appelle le vrai code : `rendreEtPublier` sur de vraies vidéos encodées par
 * ffmpeg, et les trois `GET`/`POST` sur de vraies requêtes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createReadStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

const execFileP = promisify(execFile);

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const AUTRUI = 'ffffffff-1a63-445c-aa5d-8a00296bd4a3';
const RID = '55555555-5555-4555-8555-000000000001';
const PLAN = '77777777-7777-4777-8777-000000000001';

// ───────────────────────────────────────────────────────────────────────────
// Le stockage, doublé : il LIT des fixtures locales et ÉCRIT en mémoire
// ───────────────────────────────────────────────────────────────────────────
const objets = new Map<string, string>();
const objetsEcrits: Array<{ bucket: string; cle: string; taille: number }> = [];
const objetsSupprimes: Array<{ bucket: string; cle: string }> = [];
let putCasse = false;
let removeCasse = false;
/** Ce que `ouvrirRendu` rendra : un flux, ou rien. */
let fluxLecture: (() => NodeJS.ReadableStream) | null = null;

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  clientMinio: () => ({
    putObject: async (bucket: string, cle: string, flux: unknown, taille: number) => {
      const f = flux as { on?: (e: string, h: () => void) => void; destroy?: () => void };
      f?.on?.('error', () => {});
      f?.destroy?.();
      if (putCasse) throw new Error('echec ecriture studiio-minio:9000');
      objetsEcrits.push({ bucket, cle, taille });
      return {};
    },
    statObject: async (bucket: string, cle: string) => {
      const vu = objetsEcrits.find((o) => o.bucket === bucket && o.cle === cle);
      if (!vu) throw new Error('objet absent studiio-minio:9000');
      return { size: vu.taille };
    },
    removeObject: async (bucket: string, cle: string) => {
      if (removeCasse) throw new Error('echec suppression studiio-minio:9000');
      objetsSupprimes.push({ bucket, cle });
      return {};
    },
  }),
  lecteurMinio: () => ({
    getObject: async (_bucket: string, cle: string) => {
      if (fluxLecture) return fluxLecture();
      const fichier = objets.get(cle);
      if (!fichier) throw new Error('objet absent studiio-minio:9000');
      return createReadStream(fichier);
    },
  }),
}));

// ───────────────────────────────────────────────────────────────────────────
// La session, et la base : doublées pour que les ROUTES tournent vraiment
// ───────────────────────────────────────────────────────────────────────────
let session: { user: { id: string } } | null = { user: { id: UID } };
vi.mock('@/lib/auth/config', () => ({ auth: async () => session }));

/**
 * Ce que ffprobe rapportera, quand on veut éprouver un DÉSACCORD entre la
 * mesure et ce que les sondes annonçaient.
 *
 * ⚠️ SEUL `mesurer` EST DÉTOURNÉ, et seulement quand ce drapeau est posé. Le
 * reste du moteur — arguments, encodage, téléversement — est le vrai. C'est la
 * seule façon de produire un montage qui sortirait muet alors que ses sources
 * étaient sonores : aucun fichier de test ne peut fabriquer cette panne, et
 * c'est précisément celle contre laquelle la garde existe.
 */
let mesureTruquee: Partial<MesureRendu> | null = null;
vi.mock('@/lib/autopilot/analyse/rendu-ffmpeg', async (orig) => {
  const vrai = await orig<Record<string, unknown>>();
  const mesurer = vrai.mesurer as (f: string) => Promise<{ mesure: MesureRendu | null }>;
  return {
    ...vrai,
    mesurer: async (fichier: string) => {
      const r = await mesurer(fichier);
      if (!mesureTruquee || !r.mesure) return r;
      return { ...r, mesure: { ...r.mesure, ...mesureTruquee } };
    },
  };
});

/** Ce que la persistance rendra, appel par appel. */
const base = {
  planParId: null as unknown,
  reussiIdentique: { rendu: null as unknown, motif: null as string | null },
  actif: { rendu: null as unknown, motif: null as string | null },
  creation: { rendu: null as unknown, motif: null as string | null },
  parId: { rendu: null as unknown, motif: null as string | null },
};
const majs: Array<Record<string, unknown>> = [];

vi.mock('@/lib/autopilot/analyse/montage-service', () => ({
  lirePlanParId: async () => ({ plan: base.planParId, motif: null }),
}));

vi.mock('@/lib/autopilot/analyse/rendu-service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lireRenduReussiIdentique: async () => base.reussiIdentique,
  lireRenduActif: async () => base.actif,
  lireRenduParId: async () => base.parId,
  creerRendu: async () => base.creation,
  majRendu: async (_u: string, _r: string, patch: Record<string, unknown>) => {
    majs.push(patch);
    return { rendu: null, motif: 'rendu_absent' };
  },
}));

import { rendreEtPublier, type Finalisation, type IssueConsignation } from '@/lib/autopilot/analyse/rendu';
import {
  BUCKET_RENDUS_MONTAGE, METHODE_RENDU, cleRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';
import {
  prendrePlaceRendu, reinitialiserCapacite, rendusMontageEnCoursMaintenant,
} from '@/lib/autopilot/analyse/capacite';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { MontagePlan, PlanMontage } from '@/lib/autopilot/analyse/montage-contrat';
import type { RenduMontage } from '@/lib/autopilot/analyse/rendu-service';
import type { MesureRendu } from '@/lib/autopilot/analyse/rendu-ffmpeg';

import { GET as getFichier } from '@/app/api/autopilot/rendus-montage/[renduId]/fichier/route';
import { GET as getEtat } from '@/app/api/autopilot/rendus-montage/[renduId]/route';
import { POST as postRendu } from '@/app/api/autopilot/montages/[montagePlanId]/rendu/route';

const CLE = cleRendu(UID, RID);

const MESURE: MesureRendu = {
  octets: 4242, dureeMesureeSecondes: 9, largeur: 1080, hauteur: 1920,
  fpsMesure: 30, codecVideo: 'h264', pixelFormat: 'yuv420p',
  aAudio: true, codecAudio: 'aac', frequenceAudio: 48_000,
};

function unRendu(over: Partial<RenduMontage> = {}): RenduMontage {
  return {
    id: RID, userId: UID, montagePlanId: PLAN, montagePlanVersion: 1,
    methodeRendu: METHODE_RENDU, etat: 'en_attente', etape: null,
    resultat: null, motifEchec: null, usage: {},
    createdAt: '2026-09-06T10:00:00Z', startedAt: null, completedAt: null,
    updatedAt: '2026-09-06T10:00:00Z',
    ...over,
  } as RenduMontage;
}

/** Un rendu réellement servable : réussi, et dont le résultat tient debout. */
const reussi = (over: Partial<RenduMontage> = {}) => unRendu({
  etat: 'reussie',
  resultat: { ...MESURE, bucket: BUCKET_RENDUS_MONTAGE, cle: CLE } as never,
  completedAt: '2026-09-06T10:05:00Z',
  ...over,
});

beforeEach(() => {
  reinitialiserCapacite();
  objetsEcrits.length = 0;
  objetsSupprimes.length = 0;
  majs.length = 0;
  putCasse = false;
  removeCasse = false;
  fluxLecture = null;
  session = { user: { id: UID } };
  base.planParId = null;
  base.reussiIdentique = { rendu: null, motif: null };
  base.actif = { rendu: null, motif: null };
  base.creation = { rendu: null, motif: null };
  base.parId = { rendu: null, motif: null };
});

// ═════════════════════════════════════════════════════════════════════════
// PARTIE 1 — `rendreEtPublier`, sur un vrai montage
// ═════════════════════════════════════════════════════════════════════════

function outilPresent(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-hide_banner', '-version'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}
const OUTILS = outilPresent(cheminFfmpeg()) && outilPresent(cheminFfprobe());
let atelier = '';

/** Les mêmes formes que la suite du moteur : le plan réel, pas une esquisse. */
function unPlan(over: Partial<PlanMontage> & { ordre: number }): PlanMontage {
  return {
    rangClip: over.ordre, bucket: 'videos',
    cle: `${UID}/autopilote/clips/jeu/rang-0${over.ordre}.mp4`,
    entreeSecondes: 0, dureeRetenueSecondes: 3, debutTimelineSecondes: 0,
    raccourci: false, recadrage: { x: 0.341797, y: 0, largeur: 0.316406, hauteur: 1 },
    strategieRecadrage: 'centre-largeur',
    largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe',
    ...over,
  } as PlanMontage;
}

function unMontage(plans: PlanMontage[]): MontagePlan {
  const total = plans.reduce((t, p) => t + p.dureeRetenueSecondes, 0);
  return {
    id: 'r1', userId: UID, montagePlanId: PLAN, clipSetId: 'c1', clipSetVersion: 1,
    candidateSetId: 'cs1', analysisId: 'a1', algorithme: 'm3e-v1',
    methodeMaterialisation: 'x264-crf23-v1', algorithmePlan: 'm3g-v1',
    format: '9:16', dureeCibleSecondes: total, version: 1,
    largeurCible: 1080, hauteurCible: 1920, fps: 30,
    plans, dureeTotaleSecondes: total, ecartSecondes: 0, clipsEcartes: 0,
    usage: { plansRetenus: plans.length }, createdAt: '', updatedAt: '',
  } as unknown as MontagePlan;
}

/** Deux clips 1920×1080 sonores, servis par le stockage doublé. */
async function fabriquerClips(): Promise<void> {
  for (const i of [1, 2]) {
    const fichier = join(atelier, `clip${i}.mp4`);
    await execFileP(cheminFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${i === 1 ? 'green' : 'blue'}:s=1920x1080:d=5:r=30`,
      '-f', 'lavfi', '-i', `sine=frequency=${300 * i}:duration=5:sample_rate=48000`,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', '5', fichier,
    ], { timeout: 120_000 });
    objets.set(`${UID}/autopilote/clips/jeu/rang-0${i}.mp4`, fichier);
  }
}

/** La finalisation, doublée — mais c'est le VRAI `rendreEtPublier` qui l'appelle. */
function finalisation(issue: IssueConsignation | 'jette' = 'consigne'): {
  f: Finalisation; consignes: unknown[]; clotures: Array<{ motif: string }>;
} {
  const consignes: unknown[] = [];
  const clotures: Array<{ motif: string }> = [];
  return {
    consignes, clotures,
    f: {
      consigner: async (bucket, cle, mesure, usage) => {
        consignes.push({ bucket, cle, mesure, usage });
        if (issue === 'jette') throw new Error('connect ECONNREFUSED postgres 10.0.0.4:5432');
        return issue;
      },
      clore: async (motif) => { clotures.push({ motif }); },
    },
  };
}

describe.skipIf(!OUTILS)('1-10. `rendreEtPublier` : le VRAI chemin, et ses compensations', () => {
  beforeAll(async () => {
    atelier = mkdtempSync(join(tmpdir(), 'm3h-finalisation-'));
    await fabriquerClips();
  }, 180_000);
  afterAll(() => { if (atelier) rmSync(atelier, { recursive: true, force: true }); });

  const demande = () => ({
    userId: UID,
    plan: unMontage([unPlan({ ordre: 1 }), unPlan({ ordre: 2 })]),
  });

  it('TOUT RÉUSSIT : l’objet est monté, consigné, et NON retiré', async () => {
    const { f, consignes, clotures } = finalisation('consigne');
    const r = await rendreEtPublier(demande(), RID, f);

    expect(r.ok).toBe(true);
    expect(objetsEcrits).toHaveLength(1);
    expect(objetsEcrits[0]).toMatchObject({ bucket: BUCKET_RENDUS_MONTAGE, cle: CLE });
    expect(consignes).toHaveLength(1);
    // ⚠️ RIEN N'EST COMPENSÉ SUR UNE RÉUSSITE. Retirer l'objet ici serait le
    // pire des défauts : la ligne dirait `reussie` et le fichier n'existerait
    // plus.
    expect(objetsSupprimes).toHaveLength(0);
    expect(clotures).toHaveLength(0);
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  }, 240_000);

  it('LA BASE REFUSE : l’objet est RETIRÉ, et le motif n’accuse pas le stockage', async () => {
    // ⚠️ LA MUTATION QUE CE TEST TUE. Retirer `await compenser(objet, ...)`
    // laissait la suite verte : le montage restait dans le stockage sans
    // aucune ligne pour le nommer.
    const { f, clotures } = finalisation('non_consigne');
    const r = await rendreEtPublier(demande(), RID, f);

    expect(r.ok).toBe(false);
    expect(objetsEcrits).toHaveLength(1);
    expect(objetsSupprimes).toEqual([{ bucket: BUCKET_RENDUS_MONTAGE, cle: CLE }]);
    // ⚠️ ET SURTOUT PAS `televersement_echoue` : l'envoi a réussi, sa taille a
    // même été relue. C'est la base qui a dit non.
    expect(r.motif).toBe('rendu_interrompu');
    expect(clotures).toEqual([{ motif: 'rendu_interrompu' }]);
  }, 240_000);

  it('LA CONSIGNATION JETTE : même compensation, jamais un faux succès', async () => {
    const { f, clotures } = finalisation('jette');
    const r = await rendreEtPublier(demande(), RID, f);

    expect(r.ok).toBe(false);
    expect(objetsSupprimes).toEqual([{ bucket: BUCKET_RENDUS_MONTAGE, cle: CLE }]);
    expect(clotures).toEqual([{ motif: 'rendu_interrompu' }]);
  }, 240_000);

  it('LA LIGNE A DISPARU : l’objet est retiré, et RIEN n’est écrit', async () => {
    const { f, clotures } = finalisation('rendu_absent');
    const r = await rendreEtPublier(demande(), RID, f);

    expect(r.abandonne).toBe(true);
    expect(objetsSupprimes).toEqual([{ bucket: BUCKET_RENDUS_MONTAGE, cle: CLE }]);
    // ⚠️ AUCUNE CLÔTURE. Écrire sur une ligne fermée la ressusciterait.
    expect(clotures).toHaveLength(0);
  }, 240_000);

  it('LE RETRAIT ÉCHOUE : l’orphelin est TRACÉ dans le relevé et au journal', async () => {
    removeCasse = true;
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { f } = finalisation('non_consigne');
      const r = await rendreEtPublier(demande(), RID, f);
      expect(r.usage.orphelins).toEqual([{ bucket: BUCKET_RENDUS_MONTAGE, cle: CLE }]);
      expect(journal.mock.calls.flat().join(' ')).toContain('orphelin non supprimé');
    } finally { journal.mockRestore(); }
  }, 240_000);

  it('UN JET APRÈS LE TÉLÉVERSEMENT NE LAISSE PAS L’OBJET DERRIÈRE', async () => {
    // ⚠️ LE `catch` DE `rendreEtPublier`, ÉPROUVÉ POUR DE VRAI. La libération
    // de la place est le dernier geste de `produireMontage` : la faire jeter
    // est la seule façon honnête de provoquer une exception APRÈS que l'objet
    // est monté, sans truquer le moteur.
    const place = prendrePlaceRendu()!;
    const explosive = {
      liberer: () => { place.liberer(); throw new Error('libération impossible'); },
    };
    const { f } = finalisation('consigne');

    await expect(rendreEtPublier(demande(), RID, f, explosive))
      .rejects.toThrow('libération impossible');
    expect(objetsEcrits).toHaveLength(1);
    expect(objetsSupprimes).toEqual([{ bucket: BUCKET_RENDUS_MONTAGE, cle: CLE }]);
  }, 240_000);

  it('LE TÉLÉVERSEMENT ÉCHOUE : aucun objet, aucune consignation', async () => {
    putCasse = true;
    const { f, consignes, clotures } = finalisation('consigne');
    const r = await rendreEtPublier(demande(), RID, f);

    expect(r.ok).toBe(false);
    expect(r.motif).toBe('televersement_echoue');
    expect(objetsEcrits).toHaveLength(0);
    expect(objetsSupprimes).toHaveLength(0);
    expect(consignes).toHaveLength(0);
    expect(clotures).toEqual([{ motif: 'televersement_echoue' }]);
  }, 240_000);

  it('UN MONTAGE SONORE QUI SORTIRAIT MUET N’EST PAS CONFORME', async () => {
    // ⚠️ LA PROMESSE DE LA SONDE, TENUE JUSQU'AU BOUT. Les deux sources ont du
    // son : le graphe entrelace les pistes, donc le fichier DOIT sortir
    // sonore. Ne regarder que `mesure.aAudio` — « s'il y en a, il doit être
    // aac » — laissait passer l'inverse exact du défaut que la sonde avait
    // été écrite pour empêcher : la bande son perdue en route, et un montage
    // déclaré conforme sans un mot.
    mesureTruquee = { aAudio: false, codecAudio: null, frequenceAudio: null };
    try {
      const { f, clotures } = finalisation('consigne');
      const r = await rendreEtPublier(demande(), RID, f);

      expect(r.ok).toBe(false);
      expect(r.motif).toBe('resultat_invalide');
      // ⚠️ ET RIEN N'EST MONTÉ. Le livreur n'est appelé qu'après la mesure :
      // un fichier non conforme ne peut pas devenir un résultat publié.
      expect(objetsEcrits).toHaveLength(0);
      expect(clotures).toEqual([{ motif: 'resultat_invalide' }]);
    } finally { mesureTruquee = null; }
  }, 240_000);

  it('UN MONTAGE MUET QUI SORTIRAIT SONORE N’EST PAS CONFORME NON PLUS', async () => {
    // L'autre sens du croisement : des sources muettes partent en `-an`, et
    // une piste apparue en chemin voudrait dire qu'on a produit autre chose
    // que ce qu'on annonce.
    for (const i of [1, 2]) {
      const muet = join(atelier, `muet${i}.mp4`);
      await execFileP(cheminFfmpeg(), [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=gray:s=1920x1080:d=5:r=30`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-an', '-t', '5', muet,
      ], { timeout: 120_000 });
      objets.set(`${UID}/autopilote/clips/jeu/rang-0${i}.mp4`, muet);
    }
    try {
      // Sans truquage, le montage muet est CONFORME : le silence total est
      // légitime, et c'est ce que `usage.montageMuet` déclare.
      const droit = finalisation('consigne');
      const bon = await rendreEtPublier(demande(), RID, droit.f);
      expect(bon.ok).toBe(true);
      expect(bon.usage.montageMuet).toBe(true);

      objetsEcrits.length = 0;
      mesureTruquee = { aAudio: true, codecAudio: 'aac', frequenceAudio: 48_000 };
      const { f, clotures } = finalisation('consigne');
      const r = await rendreEtPublier(demande(), RID, f);
      expect(r.ok).toBe(false);
      expect(r.motif).toBe('resultat_invalide');
      expect(clotures).toEqual([{ motif: 'resultat_invalide' }]);
    } finally {
      mesureTruquee = null;
      await fabriquerClips();
    }
  }, 240_000);

  it('UNE DURÉE QUI NE CORRESPOND PAS AU PLAN est refusée avant tout envoi', async () => {
    const d = demande();
    (d.plan as { dureeTotaleSecondes: number }).dureeTotaleSecondes = 30;
    const { f, clotures } = finalisation('consigne');
    const r = await rendreEtPublier(d, RID, f);

    expect(r.ok).toBe(false);
    expect(r.motif).toBe('resultat_invalide');
    expect(objetsEcrits).toHaveLength(0);
    expect(clotures).toEqual([{ motif: 'resultat_invalide' }]);
  }, 240_000);
});

// ═════════════════════════════════════════════════════════════════════════
// PARTIE 1 bis — LE DÉLAI TUE VRAIMENT, éprouvé sur un vrai processus
// ═════════════════════════════════════════════════════════════════════════

describe('11. Le délai : un processus qui refuse de mourir meurt quand même', () => {
  it('UN PROCESSUS QUI IGNORE `SIGTERM` EST TUÉ, et la promesse se règle', async () => {
    // ⚠️ LA GARANTIE DONT TOUT M3-H DÉPEND, ET QUI N'ÉTAIT VÉRIFIÉE QUE PAR
    // UNE EXPRESSION RÉGULIÈRE. `lancer` passe `timeout` ET
    // `killSignal: 'SIGKILL'` ; retirer le second laissait la suite verte,
    // alors qu'un `SIGTERM` sur un ffmpeg bloqué peut n'être traité qu'à la
    // prochaine boucle — c'est-à-dire jamais. Le processus survivrait au
    // délai, ses tubes resteraient ouverts, la promesse ne se règlerait
    // jamais, et la place de capacité serait tenue jusqu'au redémarrage du
    // conteneur.
    //
    // On l'éprouve sur un vrai processus qui IGNORE explicitement `SIGTERM`.
    // Sans `SIGKILL`, ce test ne rougit pas : il ne se termine pas.
    const { lancer } = await import('@/lib/autopilot/analyse/extraction');
    const debut = Date.now();
    const proc = await lancer('/bin/sh', ['-c', 'trap "" TERM; sleep 30'], {
      timeoutMs: 1_500, maxSortie: 1_000_000,
    });

    expect(proc.timeout).toBe(true);
    expect(proc.signal).toBe('SIGKILL');
    // Réglée bien avant les 30 secondes du dormeur : c'est le délai qui a
    // tranché, pas la fin naturelle du processus.
    expect(Date.now() - debut).toBeLessThan(20_000);
  }, 40_000);
});

// ═════════════════════════════════════════════════════════════════════════
// PARTIE 2 — Les trois routes, réellement invoquées
// ═════════════════════════════════════════════════════════════════════════

const requete = (url = 'http://localhost/x') =>
  new Request(url) as unknown as Parameters<typeof getEtat>[0];

describe('9-16. `GET .../fichier` : ce qui sort, et ce qui ne sort pas', () => {
  it('SANS SESSION : 401, et aucune lecture du stockage', async () => {
    session = null;
    let lu = false;
    fluxLecture = () => { lu = true; return Readable.from(['x']); };
    const rep = await getFichier(requete(), { params: { renduId: RID } });
    expect(rep.status).toBe(401);
    expect(lu).toBe(false);
  });

  it('UN RENDU `en_cours` NE SERT PAS SES OCTETS', async () => {
    // ⚠️ LA MUTATION QUE CE TEST TUE. Remplacer la garde par le seul
    // `if (!rendu)` laissait la suite verte, et un montage à moitié écrit
    // partait au navigateur — la ligne porte déjà `resultat` dès que la
    // consignation commence.
    base.parId = {
      rendu: unRendu({
        etat: 'en_cours', etape: 'televersement',
        resultat: { ...MESURE, bucket: BUCKET_RENDUS_MONTAGE, cle: CLE } as never,
      }),
      motif: null,
    };
    let lu = false;
    fluxLecture = () => { lu = true; return Readable.from(['x']); };
    const rep = await getFichier(requete(), { params: { renduId: RID } });
    expect(rep.status).toBe(404);
    expect(lu).toBe(false);
  });

  it('UN RENDU `echouee` PORTANT UN RÉSULTAT NE SERT RIEN NON PLUS', async () => {
    base.parId = {
      rendu: unRendu({
        etat: 'echouee', motifEchec: 'encodage_echoue',
        resultat: { ...MESURE, bucket: BUCKET_RENDUS_MONTAGE, cle: CLE } as never,
      }),
      motif: null,
    };
    expect((await getFichier(requete(), { params: { renduId: RID } })).status).toBe(404);
  });

  it('LE RENDU D’AUTRUI EST INDISTINGUABLE D’UN INCONNU', async () => {
    // La requête filtre `user_id` : la lecture ne rend rien, et la route ne
    // dit pas laquelle des deux raisons s'applique.
    base.parId = { rendu: null, motif: null };
    const rep = await getFichier(requete(), { params: { renduId: RID } });
    expect(rep.status).toBe(404);
    expect(await rep.json()).toEqual({ ok: false, error: 'Rendu introuvable' });
  });

  it('UNE CLÉ HORS DU PRÉFIXE DE LA SESSION EST REFUSÉE, même venant de la BASE', async () => {
    // ⚠️ REVALIDÉE MÊME PERSISTÉE. Une ligne écrite par une version future,
    // ou à la main, ne doit pas pouvoir faire lire l'espace d'un tiers.
    base.parId = {
      rendu: reussi({
        resultat: {
          ...MESURE, bucket: BUCKET_RENDUS_MONTAGE, cle: cleRendu(AUTRUI, RID),
        } as never,
      }),
      motif: null,
    };
    let lu = false;
    fluxLecture = () => { lu = true; return Readable.from(['x']); };
    const rep = await getFichier(requete(), { params: { renduId: RID } });
    expect(rep.status).toBe(404);
    expect(lu).toBe(false);
  });

  it('UN RENDU RÉUSSI EST SERVI, avec ses en-têtes de confinement', async () => {
    base.parId = { rendu: reussi(), motif: null };
    fluxLecture = () => Readable.from([Buffer.alloc(MESURE.octets, 0x66)]);
    const rep = await getFichier(requete(), { params: { renduId: RID } });

    expect(rep.status).toBe(200);
    expect(rep.headers.get('Content-Type')).toBe('video/mp4');
    expect(rep.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(rep.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(rep.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(rep.headers.get('Accept-Ranges')).toBe('none');
    expect(rep.headers.get('Content-Length')).toBe(String(MESURE.octets));
    // Ni compartiment ni clé ne partent dans les en-têtes.
    expect(JSON.stringify([...rep.headers])).not.toContain(UID);
    expect(JSON.stringify([...rep.headers])).not.toContain('videos');
  });

  it('UN OBJET INTROUVABLE AU STOCKAGE reste un 404, jamais un 200 vide', async () => {
    base.parId = { rendu: reussi(), motif: null };
    fluxLecture = null;
    objets.delete(CLE);
    expect((await getFichier(requete(), { params: { renduId: RID } })).status).toBe(404);
  });

  it('UN IDENTIFIANT MALFORMÉ n’atteint ni la base ni le stockage', async () => {
    let lu = false;
    fluxLecture = () => { lu = true; return Readable.from(['x']); };
    const rep = await getFichier(requete(), { params: { renduId: '../../etc/passwd' } });
    expect(rep.status).toBe(404);
    expect(lu).toBe(false);
  });
});

describe('17-20. `GET .../rendus-montage/:id` : l’état, et rien de plus', () => {
  it('SANS SESSION : 401', async () => {
    session = null;
    expect((await getEtat(requete(), { params: { renduId: RID } })).status).toBe(401);
  });

  it('UN IDENTIFIANT MALFORMÉ : 422, sans lecture', async () => {
    const rep = await getEtat(requete(), { params: { renduId: 'zzz' } });
    expect(rep.status).toBe(422);
    expect((await rep.json()).motif).toBe('identifiant_invalide');
  });

  it('LA PROJECTION PUBLIQUE, et AUCUN champ interne', async () => {
    base.parId = {
      rendu: reussi({ usage: { orphelins: [{ bucket: 'videos', cle: 'secret' }] } }),
      motif: null,
    };
    const rep = await getEtat(requete(), { params: { renduId: RID } });
    expect(rep.status).toBe(200);
    const corps = await rep.json();
    expect(corps.rendu.video.chemin).toBe(`/api/autopilot/rendus-montage/${RID}/fichier`);
    const texte = JSON.stringify(corps);
    expect(texte).not.toContain('secret');
    expect(texte).not.toContain('videos');
    expect(texte).not.toContain(METHODE_RENDU);
    expect(texte).not.toMatch(/https?:\/\//);
    expect(rep.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('LE SOCLE ABSENT EST DIT, jamais traduit en « aucun rendu »', async () => {
    base.parId = { rendu: null, motif: 'socle_absent' };
    const rep = await getEtat(requete(), { params: { renduId: RID } });
    expect(rep.status).toBe(503);
    expect((await rep.json()).motif).toBe('socle_absent');
  });
});

describe('21-26. `POST .../rendu` : réutiliser, refuser, ou lancer', () => {
  const post = (corps?: unknown) => postRendu(
    new Request('http://localhost/x', {
      method: 'POST',
      ...(corps === undefined ? {} : {
        body: JSON.stringify(corps), headers: { 'Content-Type': 'application/json' },
      }),
    }) as unknown as Parameters<typeof postRendu>[0],
    { params: { montagePlanId: PLAN } },
  );

  const unPlanPersiste = { id: PLAN, version: 1, plans: [], usage: {} };

  it('SANS SESSION : 401, et aucune capacité prise', async () => {
    session = null;
    const rep = await post();
    expect(rep.status).toBe(401);
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('UN CHAMP INTERDIT : 422, et le plan n’est même pas lu', async () => {
    base.planParId = unPlanPersiste;
    const rep = await post({ force: true });
    expect(rep.status).toBe(422);
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('UN RENDU RÉUSSI IDENTIQUE EST SERVI, sans capacité ni ligne', async () => {
    base.planParId = unPlanPersiste;
    base.reussiIdentique = { rendu: reussi(), motif: null };
    const rep = await post();
    const corps = await rep.json();

    expect(rep.status).toBe(200);
    expect(corps.reutilise).toBe(true);
    expect(corps.rendu.video.chemin).toBe(`/api/autopilot/rendus-montage/${RID}/fichier`);
    // ⚠️ AUCUN TRAVAIL. Ni place, ni ligne, ni octet.
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
    expect(majs).toHaveLength(0);
    expect(objetsEcrits).toHaveLength(0);
  });

  it('UNE LIGNE DÉGRADÉE N’EST PAS RÉUTILISÉE : le plan ne se bloque pas', async () => {
    // ⚠️ LE DÉFAUT CORRIGÉ ICI. `lireRenduReussiIdentique` demande bien
    // `etat = 'reussie'` à la base, mais la relecture RÉTROGRADE une réussite
    // dont le résultat ne repasse pas la revalidation. La route se contentait
    // de « la requête a rendu quelque chose » : elle répondait
    // `reutilise: true` avec `video: null`, et l'index unique interdisant d'en
    // créer un autre, le plan devenait DÉFINITIVEMENT irrendable.
    base.planParId = unPlanPersiste;
    base.reussiIdentique = { rendu: unRendu({ etat: 'echouee', resultat: null }), motif: null };
    base.creation = { rendu: unRendu(), motif: null };

    const rep = await post();
    expect(rep.status).toBe(202);
    expect((await rep.json()).reutilise).toBe(false);
  });

  it('UNE IDENTITÉ QUI NE CORRESPOND PAS N’EST PAS RÉUTILISÉE NON PLUS', async () => {
    base.planParId = unPlanPersiste;
    base.reussiIdentique = { rendu: reussi({ methodeRendu: 'x264-crf28-vieux' }), motif: null };
    base.creation = { rendu: unRendu(), motif: null };
    expect((await post()).status).toBe(202);
  });

  it('LA CAPACITÉ SATURÉE : 429, avec un `Retry-After` dérivé du budget', async () => {
    base.planParId = unPlanPersiste;
    const tenue = prendrePlaceRendu()!;
    try {
      const rep = await post();
      expect(rep.status).toBe(429);
      expect((await rep.json()).motif).toBe('capacite_saturee');
      expect(Number(rep.headers.get('Retry-After'))).toBeGreaterThan(0);
    } finally { tenue.liberer(); }
  });
});
