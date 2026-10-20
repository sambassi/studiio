/**
 * UNE SEULE VÉRITÉ — le même projet, lu par TOUS les étages.
 *
 * 3 rushes configurés : R1 valide, R2 expiré (403), R_AUTRE refusé par la
 * garde de sécurité (objet d'un autre compte). Écran (compteur, « Médias
 * prévus »), résumé (`statusMessage`), contrôle avant production (cron :
 * `decideRun` ; « Produire maintenant »), plan et entrée de rendu disent
 * TOUS : configurés = 3, utilisables = 1. Le refusé n'est jamais sondé ni
 * signé.
 *
 * Et des rushes configurés mais tous inutilisables valent une banque VIDE :
 * sans autre source, refus avant production (« Aucun média utilisable pour
 * ce montage. ») — jamais un montage titre/cartes/CTA seul.
 *
 * Moteur, routes et écran RÉELS ; seuls le HEAD (`sonderSur`), le rendu, la
 * base et les signatures sont doublés. Aucun fournisseur, aucun réseau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, decideRun, statusMessage, type AutopilotConfig } from '@/lib/autopilot/rules';
import { aUneSourceVisuelle, etatSourcesServeur } from '@/lib/autopilot/sources';
import {
  etatsDepuisReponseVerifier, rushesUtilisables, rushesUtilisablesServeur,
} from '@/lib/autopilot/validite-rush';
import type { RushSegment } from '@/lib/creer/multi-rush';

const PUB = 'https://studiio.pro/storage/v1/object/public';
const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const AUTRE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const R1 = `${PUB}/media/${U}/library/rush-valide.mp4`;
const R2 = `${PUB}/media/${U}/library/rush-expire.mp4`;
const R_AUTRE = `${PUB}/media/${AUTRE}/library/rush-prive.mp4`;
const BANQUE = [R1, R2, R_AUTRE];

// ── Le HEAD sûr, seule sonde doublée ────────────────────────────────────────
const STATUTS = new Map<string, number>();
// #547 : la sonde reçoit l'URL munie du jeton du relais ; statut indexé sur l'URL nue.
const sonderSur = vi.fn(async (url: string) => ({ status: STATUTS.get(url.split('?')[0]) ?? 200, url, sauts: 0, entetes: {} }));
vi.mock('@/lib/securite/fetch-sur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/securite/fetch-sur')>();
  return { ...actual, sonderSur: (u: string) => sonderSur(u) };
});

// `rushEncorePresent` RÉEL ; durée et affiche doublées.
vi.mock('@/lib/autopilot/poster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/poster')>();
  return { ...actual, probeRushSeconds: async () => 15, pickPosterUrl: async () => 'https://cdn.test/affiche.jpg', pickCustomPoster: () => null };
});
vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});
// La garde `mediaLisiblePar` reste RÉELLE ; l'analyse est doublée (aucun ffmpeg).
vi.mock('@/lib/creer/analyse-rush-serveur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return { ...actual, analyserRushServeurCache: async () => null, analyserMusiqueServeur: async () => null };
});
vi.mock('@/lib/render/proxy-rendu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: async (url: string) => ({ url, proxy: false, cree: false }) };
});

// ── Rendu : on capture l'entrée ─────────────────────────────────────────────
let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

// ── Signatures : aucune ne doit viser le rush refusé ─────────────────────────
const presignedGetObject = vi.fn(async (b: string, c: string) => `http://studiio-minio:9000/${b}/${c}`);
vi.mock('@/lib/storage/minio-client', () => ({
  signeurInterne: () => ({ presignedGetObject: (b: string, c: string) => presignedGetObject(b, c) }),
  clientMinio: () => ({ statObject: async () => ({ size: 1 }) }),
}));
const createSignedUrl = vi.fn(async (..._a: unknown[]) => ({ data: { signedUrl: 'https://signe.test/x' }, error: null }));

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async () => 10 }));
vi.mock('@/lib/credits/system', () => ({
  getVideoRenderCost: () => 10, deductCredits: async () => true, getUserCredits: async () => 0,
}));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));

// ── Base en mémoire : la ligne `autopilot_config` du projet ─────────────────
let ligneConfig: Record<string, unknown>;
let insertions: Array<Record<string, unknown>>;
vi.mock('@/lib/db/supabase', () => {
  const lecture = (table: string) => {
    const resultat = () => ({ data: table === 'autopilot_config' ? [ligneConfig] : [], error: null });
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'is', 'order', 'neq', 'not']) b[m] = () => b;
    b.limit = async () => resultat();
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(resultat()).then(res);
    return b;
  };
  const from = (table: string) => ({
    select: () => lecture(table),
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
  });
  const storage = { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a) }) };
  return { supabaseAdmin: { from, storage }, supabase: { from, storage } };
});

import { produireUnMontage } from '@/lib/autopilot/produire';
import { POST as verifier } from '@/app/api/autopilot/rush/verifier/route';
import { POST as produireMaintenant } from '@/app/api/autopilot/produire-maintenant/route';
import { rushEncorePresent } from '@/lib/autopilot/poster';
import { mediaLisiblePar } from '@/lib/creer/analyse-rush-serveur';
import AutopilotPanel from '@/components/creer/AutopilotPanel';

const T0 = Date.parse('2026-10-12T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], voiceEnabled: false, cadence: 'daily', ...p,
});
const ligneDe = (c: AutopilotConfig) => ({ user_id: U, enabled: c.enabled, rush_urls: c.rushUrls, jumeau_avatar: c.jumeauAvatar, voice_enabled: false });
const requete = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest;

/** Le refusé n'a JAMAIS été sondé, lu ni signé — par aucun étage. */
function jamaisTouche() {
  expect(sonderSur.mock.calls.map((c) => String(c[0]).split('?')[0])).not.toContain(R_AUTRE);
  expect(JSON.stringify(sonderSur.mock.calls)).not.toContain(AUTRE);
  expect(presignedGetObject.mock.calls.filter((c) => JSON.stringify(c).includes(AUTRE))).toHaveLength(0);
  expect(createSignedUrl).toHaveBeenCalledTimes(0);
}

beforeEach(() => {
  STATUTS.clear();
  STATUTS.set(R2, 403);
  insertions = [];
  lastDesign = null;
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
  for (const k of ['log', 'warn', 'info'] as const) vi.spyOn(console, k).mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Même projet, 3 rushes (1 valide, 1 expiré, 1 refusé) : 3 configurés, 1 utilisable — partout', () => {
  it('serveur : vérification, résumé, décision avant production, plan et rendu', async () => {
    const config = cfg({ rushUrls: BANQUE });
    ligneConfig = ligneDe(config);
    expect(config.rushUrls).toHaveLength(3);

    // 1. Route de vérification (ce que lit l'écran).
    const corps = await (await verifier(requete({ urls: BANQUE }))).json();
    const etats = etatsDepuisReponseVerifier(corps);
    expect(etats).toEqual({ [R1]: 'utilisable', [R2]: 'expire', [R_AUTRE]: 'refuse' });
    const ecran = rushesUtilisables(config.rushUrls, etats);
    expect(ecran).toEqual([R1]);

    // 2. Résumé.
    expect(statusMessage(config, T0, () => 'demain', ecran.length)).toContain('1 rush disponible');

    // 3. Contrôle avant production — le câblage du cron : MÊMES rushes.
    const serveur = await rushesUtilisablesServeur(config.rushUrls, (u) => mediaLisiblePar(u, U), rushEncorePresent);
    expect(serveur).toEqual(ecran);
    expect(etatSourcesServeur({ ...config, rushUrls: serveur }).rushesPersonnels).toBe(1);
    const decision = decideRun({ config: { ...config, rushUrls: serveur }, credits: 1000, costPerVideo: 10, now: Date.parse('2026-10-12T08:30:00.000Z') });
    expect(decision).not.toEqual({ run: false, reason: 'sans-rush' });

    // « Produire maintenant » : le contrôle des sources PASSE (le refus suivant
    // est celui des crédits, à 0 ici — jamais `sans-rush`).
    const rep = await produireMaintenant();
    expect(rep.status).toBe(402);
    expect((await rep.json()).code).toBe('credits');

    // 4. Plan et entrée de rendu : seul R1, même si le créneau visait l'expiré.
    const post = { ...preparePosts({ config, topic: 'routine du matin', count: 1, now: T0 })[0], rushUrl: R2 };
    const rendu = await produireUnMontage({ userId: U, config, post, rang: 0, now: T0, jobId: 'job-1' });
    expect(rendu.rushUrl).toBe(R1);
    const entree = JSON.stringify(renderAndUpload.mock.calls);
    expect(entree).toContain(R1);
    expect(entree).not.toContain('rush-expire');
    expect(entree).not.toContain(AUTRE);
    const plan = ((lastDesign as Record<string, unknown>).montage ?? []) as RushSegment[];
    expect(plan.every((s) => s.url === R1)).toBe(true);

    jamaisTouche();
  });

  it('écran : « 1 rush prêt », 2 indisponibles, Médias prévus = 1', async () => {
    const config = cfg({ rushUrls: BANQUE });
    ligneConfig = ligneDe(config);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      // L'écran lit la VRAIE route de vérification.
      if (u.startsWith('/api/autopilot/rush/verifier')) {
        const r = await verifier(requete(JSON.parse(String(init?.body ?? '{}'))));
        return { ok: true, json: async () => r.json() };
      }
      if (u.startsWith('/api/autopilot/config')) return { ok: true, json: async () => ({ success: true, ready: true, config }) };
      if (u.startsWith('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: [] }) };
      return { ok: true, json: async () => ({ success: true }) };
    }));
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
    const compteur = () => document.querySelector('[data-autopilot-rushes-utilisables]') as HTMLElement | null;
    await waitFor(() => expect(compteur()?.getAttribute('data-autopilot-rushes-utilisables')).toBe('1'));
    expect(compteur()!.textContent).toContain('1 rush personnel');
    expect(document.querySelector('[data-autopilot-rushes-indisponibles="2"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-medias-rushes]')?.getAttribute('data-autopilot-medias-rushes')).toBe('1');
    expect(document.body.textContent).not.toContain(AUTRE);
    jamaisTouche();
  });
});

describe('Rushes configurés mais AUCUN utilisable = banque vide', () => {
  it('sans rush du tout : refus avant production (référence)', async () => {
    const config = cfg({ rushUrls: [] });
    ligneConfig = ligneDe(config);
    expect(decideRun({ config, credits: 1000, costPerVideo: 10, now: T0 })).toEqual({ run: false, reason: 'sans-rush' });
    const rep = await produireMaintenant();
    expect(rep.status).toBe(422);
    expect((await rep.json()).code).toBe('sans-rush');
    expect(renderAndUpload).not.toHaveBeenCalled();
  });

  it('expiré + refusé, sans stock ni avatar : MÊME refus, message clair, aucun rendu', async () => {
    const config = cfg({ rushUrls: [R2, R_AUTRE] });
    ligneConfig = ligneDe(config);
    // La configuration seule croit à 2 sources…
    expect(aUneSourceVisuelle(etatSourcesServeur(config))).toBe(true);
    // …la vérité n'en compte aucune : décision du cron = banque vide.
    const serveur = await rushesUtilisablesServeur(config.rushUrls, (u) => mediaLisiblePar(u, U), rushEncorePresent);
    expect(serveur).toEqual([]);
    expect(decideRun({ config: { ...config, rushUrls: serveur }, credits: 1000, costPerVideo: 10, now: T0 })).toEqual({ run: false, reason: 'sans-rush' });
    expect(statusMessage(config, T0, () => 'demain', serveur.length)).toContain('aucun rush');
    const rep = await produireMaintenant();
    expect(rep.status).toBe(422);
    const corps = await rep.json();
    expect(corps).toMatchObject({ success: false, code: 'sans-rush', error: 'Aucun média utilisable pour ce montage.' });
    expect(JSON.stringify(corps)).not.toContain(AUTRE);
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(insertions).toHaveLength(0);
    jamaisTouche();
  });

  it('doute réseau (5xx) : le rush reste compté, la production n est pas bloquée', async () => {
    STATUTS.set(R1, 503);
    const config = cfg({ rushUrls: [R1] });
    ligneConfig = ligneDe(config);
    expect(await rushesUtilisablesServeur(config.rushUrls, (u) => mediaLisiblePar(u, U), rushEncorePresent)).toEqual([R1]);
    expect((await produireMaintenant()).status).toBe(402);
  });
});
