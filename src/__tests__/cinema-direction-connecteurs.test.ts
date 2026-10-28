// @vitest-environment node
/**
 * CINEMA IA — style et camera jusqu'a la REQUETE HTTP envoyee par chaque connecteur.
 *
 * La chaine reelle : film → atelier (`genererMediaPlan`) → connecteur → corps de la requete.
 * Le reseau est simule : le corps de chaque soumission est CAPTURE, puis la generation est
 * terminee en echec « non facture » — aucun appel sortant, aucune depense.
 *
 * Les deux tests video ont besoin d'une VRAIE image (ffprobe controle l'image source avant
 * tout appel) : ils ne tournent que si ffmpeg et ffprobe sont disponibles.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const r = vi.hoisted(() => ({ entrees: [] as Array<{ modele: string; input: Record<string, unknown> }> }));

// Client Replicate simule : capture le modele et l'entree, puis echoue (aucune prediction).
vi.mock('replicate', () => ({
  default: class {
    async run(modele: string, o: { input: Record<string, unknown> }) {
      r.entrees.push({ modele, input: o.input });
      throw new Error('double de test : aucune prediction');
    }
  },
}));

const { genererMediaPlan } = await import('@/lib/cinema/generation/atelier');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { ID_HIGGSFIELD_IMAGE, ID_HIGGSFIELD_VIDEO, MODELE_IMAGE_HF, MODELE_VIDEO_HF, BASE_HIGGSFIELD, reseauMedia } = await import('@/lib/cinema/generation/higgsfield');
const { ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO, MODELE_IMAGE, MODELE_VIDEO } = await import('@/lib/cinema/generation/replicate');
const { fichierDuMedia } = await import('@/lib/cinema/medias');
const { executer } = await import('@/lib/cinema/rendu-local');
const { cheminFfmpeg, cheminFfprobe } = await import('@/lib/ffmpeg/binaires');
const { blocStyle } = await import('@/lib/cinema/direction/prompt');
const { styleCinema } = await import('@/lib/cinema/direction/styles');
const { cameraCinema } = await import('@/lib/cinema/direction/camera');
import type { Film } from '@/lib/cinema/types';

const OUTILS = spawnSync(cheminFfmpeg(), ['-version']).status === 0 && spawnSync(cheminFfprobe(), ['-version']).status === 0;
const ENV0 = { ...process.env };
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Le jour se leve sur la salle vide.';
const UUID = '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71';

const reponse = (statut: number, corps: unknown) => ({
  ok: statut >= 200 && statut < 300, status: statut, json: async () => corps,
  get body() { return new Response(new Uint8Array(2048)).body; },
} as unknown as Response);

const unFilm = (extra: Partial<Film> = {}): Film => ({
  ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }], idFilm: 'film-conn' }),
  proprietaire: 'u1', ...extra,
});

let racine = '';
beforeEach(() => { racine = mkdtempSync(join(tmpdir(), 'cinema-dir-')); r.entrees.length = 0; });
afterEach(() => {
  process.env = { ...ENV0 }; vi.unstubAllGlobals(); reseauMedia.envoyer = undefined; reseauMedia.resoudre = undefined;
  rmSync(racine, { recursive: true, force: true });
});

/** Pose une vraie image sur le premier plan, comme si elle avait deja ete generee. */
async function avecImage(film: Film): Promise<Film> {
  const plan = film.scenes[0].plans[0];
  plan.media = { url: 'cinema/film-conn/medias/p1.png', genre: 'image', largeur: 64, hauteur: 64, dureeS: null, octets: 500, origine: 'import' } as never;
  const url = (plan.media as unknown as { url: string }).url;
  const fichier = fichierDuMedia(racine, url);
  mkdirSync(dirname(fichier), { recursive: true });
  const ff = await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', '-y', fichier], { timeoutMs: 20_000 });
  expect(ff.code).toBe(0);
  return film;
}

describe('HIGGSFIELD : le corps de la soumission porte la direction', () => {
  const CLES = { CINEMA_FOURNISSEUR: 'higgsfield', CINEMA_GENERATION_REELLE: 'true', HIGGSFIELD_API_KEY_ID: 'k', HIGGSFIELD_API_KEY_SECRET: 's' };
  /** Simule l'API : capture les corps soumis, puis termine « non facture ». */
  function api() {
    const soumissions: Array<{ modele: string; corps: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/estimate/')) return reponse(200, { usd: '0.002' });
      if (url.endsWith('/files/generate-upload-url')) {
        return reponse(200, { upload_url: 'https://stockage.example.com/depot', public_url: 'https://stockage.example.com/src.png', upload_headers: {} });
      }
      if (url === `${BASE_HIGGSFIELD}/${MODELE_IMAGE_HF}` || url === `${BASE_HIGGSFIELD}/${MODELE_VIDEO_HF}`) {
        soumissions.push({ modele: url.slice(BASE_HIGGSFIELD.length + 1), corps: JSON.parse(String(init?.body)) });
        return reponse(200, { status: 'queued', request_id: UUID, status_url: `${BASE_HIGGSFIELD}/requests/${UUID}/status` });
      }
      if (url.endsWith('/status')) return reponse(200, { status: 'failed', error: 'double' });
      return reponse(200, {}); // depot presigne
    }));
    reseauMedia.resoudre = async () => [{ address: '93.184.216.34', family: 4 }];
    reseauMedia.envoyer = (url, init, lookup) => new Promise<Response>((ok, ko) => {
      (lookup as unknown as (h: string, o: object, cb: (e: Error | null) => void) => void)(new URL(url).hostname, { all: true }, (e) => {
        if (e) { ko(e); return; }
        Promise.resolve((globalThis.fetch as unknown as (u: string, i: unknown) => Promise<Response>)(url, init)).then(ok, ko);
      });
    });
    return soumissions;
  }

  it('IMAGE : le style du film est dans `prompt`', async () => {
    process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv;
    const soumissions = api();
    const f = unFilm({ styleCinema: 'romantique' });
    const res = await genererMediaPlan(f, f.scenes[0].plans[0].id, { fournisseurId: ID_HIGGSFIELD_IMAGE, operation: 'image', racinePublique: racine });
    expect(res.ok).toBe(false); // termine « non facture » par le double
    expect(soumissions).toHaveLength(1);
    expect(soumissions[0].modele).toBe(MODELE_IMAGE_HF);
    expect(String(soumissions[0].corps.prompt)).toContain(blocStyle(styleCinema('romantique')!));
    expect(soumissions[0].corps.aspect_ratio).toBe('16:9');
  });

  it('IMAGE : l’exception de scene prime sur le style du film, jusque dans la requete', async () => {
    process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv;
    const soumissions = api();
    const f = unFilm({ styleCinema: 'noir' });
    f.scenes[1].styleCinema = 'scifi';
    await genererMediaPlan(f, f.scenes[1].plans[0].id, { fournisseurId: ID_HIGGSFIELD_IMAGE, operation: 'image', racinePublique: racine });
    expect(String(soumissions[0].corps.prompt)).toContain(styleCinema('scifi')!.prompt.profil);
    expect(String(soumissions[0].corps.prompt)).not.toContain(styleCinema('noir')!.prompt.profil);
  });

  it.skipIf(!OUTILS)('VIDEO : la camera choisie et le style sont dans `prompt` ; le reste de la requete est inchange', async () => {
    process.env = { ...ENV0, ...CLES } as NodeJS.ProcessEnv;
    const soumissions = api();
    const f = await avecImage(unFilm({ styleCinema: 'scifi' }));
    f.scenes[0].plans[0].camera = 'orbite';
    await genererMediaPlan(f, f.scenes[0].plans[0].id, { fournisseurId: ID_HIGGSFIELD_VIDEO, operation: 'video', racinePublique: racine });
    expect(soumissions).toHaveLength(1);
    expect(soumissions[0].modele).toBe(MODELE_VIDEO_HF);
    const c = soumissions[0].corps;
    expect(String(c.prompt)).toContain(`camera: ${cameraCinema('orbite').prompt}`);
    expect(String(c.prompt)).toContain('keep the science fiction look of the input image');
    expect(String(c.prompt)).not.toContain('subtle and steady camera motion');
    // Aucun champ de camera natif n'est invente : le schema du modele ne change pas.
    expect(Object.keys(c).sort()).toEqual(['duration', 'image_url', 'prompt']);
  });
});

describe('REPLICATE : l’entree du modele porte la direction', () => {
  beforeEach(() => {
    process.env = { ...ENV0, CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_test' } as NodeJS.ProcessEnv;
  });

  it('IMAGE : le style est dans `input.prompt`', async () => {
    const f = unFilm({ styleCinema: 'publicite' });
    await genererMediaPlan(f, f.scenes[0].plans[0].id, { fournisseurId: ID_REPLICATE_IMAGE, operation: 'image', racinePublique: racine });
    expect(r.entrees).toHaveLength(1);
    expect(r.entrees[0].modele).toBe(MODELE_IMAGE);
    expect(String(r.entrees[0].input.prompt)).toContain(blocStyle(styleCinema('publicite')!));
  });

  it.skipIf(!OUTILS)('VIDEO : la camera est dans `input.prompt` ; aucun parametre de camera natif n’est invente', async () => {
    const f = await avecImage(unFilm({ styleCinema: 'noir' }));
    f.scenes[0].plans[0].camera = 'travelling_arriere';
    await genererMediaPlan(f, f.scenes[0].plans[0].id, { fournisseurId: ID_REPLICATE_VIDEO, operation: 'video', racinePublique: racine });
    expect(r.entrees).toHaveLength(1);
    expect(r.entrees[0].modele).toBe(MODELE_VIDEO);
    const input = r.entrees[0].input;
    expect(String(input.prompt)).toContain(`camera: ${cameraCinema('travelling_arriere').prompt}`);
    expect(String(input.prompt)).toContain('keep the film noir look of the input image');
    expect(Object.keys(input).sort()).toEqual(['aspect_ratio', 'image', 'prompt', 'seed']);
  });
});
