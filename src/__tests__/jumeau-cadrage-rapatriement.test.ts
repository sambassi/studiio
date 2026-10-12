// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * JUMEAU 9:16 — le fichier HÉBERGÉ chez nous remplit son format.
 *
 * Le fournisseur rend un avatar 16:9 demandé en 9:16 avec des bandes
 * INCRUSTÉES (720×1280, image utile 720×405). Avant : ce fichier était
 * re-hébergé tel quel → rush à bandes → aperçu, MP4 et Calendrier à bandes.
 * Après : le rapatriement (`avancerStatutGeneration`) retire les bandes —
 * pour HeyGen comme pour D-ID, Créer comme l'Autopilote.
 *
 * Base et fournisseurs doublés ; ffmpeg RÉEL sur des médias synthétiques.
 */

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ?? null;
const avecFfmpeg = FFMPEG ? describe : describe.skip;

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const G = '22222222-2222-4222-8222-000000000009';

const etat = vi.hoisted(() => ({
  ligne: null as Record<string, unknown> | null,
  uploads: [] as Array<{ path: string; buf: Buffer }>,
  telecharge: Buffer.alloc(0),
}));

vi.mock('@/lib/db/supabase', () => {
  const from = () => {
    const api: Record<string, unknown> = {
      select() { return api; },
      eq() { return api; },
      single() { return Promise.resolve({ data: etat.ligne ? { ...etat.ligne } : null, error: null }); },
      update(p: Record<string, unknown>) { if (etat.ligne) Object.assign(etat.ligne, p); return api; },
      then(onF: (v: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(onF); },
    };
    return api;
  };
  const storage = {
    from: () => ({
      upload: (path: string, buf: Buffer) => { etat.uploads.push({ path, buf }); return Promise.resolve({ error: null }); },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://minio.test/media/${path}` } }),
    }),
  };
  return { supabase: {}, supabaseAdmin: { from, storage } };
});
vi.mock('@/lib/avatar/heygen', () => ({
  getVideoStatus: vi.fn(async () => ({ status: 'completed', videoUrl: 'https://heygen.tmp/v.mp4', durationSeconds: 1 })),
  downloadVideo: vi.fn(async () => etat.telecharge),
  HeyGenError: class extends Error {},
}));
vi.mock('@/lib/providers/did/client', () => ({
  lireScene: vi.fn(async () => ({ status: 'completed', videoUrl: 'https://d-id.tmp/s.mp4' })),
  telechargerResultat: vi.fn(async () => etat.telecharge),
  DidError: class extends Error {},
}));
vi.mock('@/lib/avatar/did', () => ({ FOURNISSEUR_DID: 'did' }));
vi.mock('@/lib/avatar/source', () => ({ cleAudioAvatar: () => 'k', retirerObjetPriveAvatar: vi.fn(async () => true) }));
vi.mock('@/lib/credits/system', () => ({ addCredits: vi.fn(async () => undefined) }));
vi.mock('@/lib/avatar/couts', () => ({
  calculerCoutGeneration: () => ({}), compteAdmin: async () => false, enregistrerCoutGeneration: async () => undefined,
}));

const { avancerStatutGeneration } = await import('@/lib/avatar/statut');

let dossier = '';
let banded = Buffer.alloc(0);
let propre = Buffer.alloc(0);

/** Lignes noires (luma < 20) en haut et en bas de l'image 10. */
function bandes(buf: Buffer) {
  const f = join(dossier, `m-${Math.random().toString(36).slice(2)}.mp4`);
  writeFileSync(f, buf);
  const info = String(spawnSync(FFMPEG!, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr);
  const [, w, h] = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(info)!.map(Number) as number[];
  const raw = execFileSync(FFMPEG!, ['-v', 'error', '-i', f, '-vf', 'select=eq(n\\,10),format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const noire = (y: number) => { for (let x = 0; x < w; x += 4) if (raw[y * w + x] >= 20) return false; return true; };
  let haut = 0; while (haut < h && noire(haut)) haut++;
  let bas = 0; while (bas < h && noire(h - 1 - bas)) bas++;
  return { w, h, haut, bas };
}

beforeAll(() => {
  if (!FFMPEG) return;
  dossier = mkdtempSync(join(tmpdir(), 'jumeau-rapatriement-'));
  const hb = join(dossier, 'HB.mp4');
  const v = join(dossier, 'V.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x405:rate=30', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '1',
    '-vf', 'pad=720:1280:0:(1280-405)/2:black', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', hb]);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
  banded = readFileSync(hb);
  propre = readFileSync(v);
});
afterAll(() => { if (dossier) rmSync(dossier, { recursive: true, force: true }); });

beforeEach(() => {
  etat.uploads.length = 0;
  etat.ligne = {
    id: G, user_id: U, status: 'processing', provider: 'heygen', provider_video_id: 'v1', video_url: null,
    error_message: null, credits_charged: 40, credits_refunded: false, created_at: new Date().toISOString(),
    script: 'bonjour', aspect_ratio: '9:16',
  };
});

avecFfmpeg('Rapatriement du jumeau — bandes incrustées retirées, format rempli', () => {
  for (const provider of ['heygen', 'did'] as const) {
    it(`⚠️ ${provider} : fichier 720×1280 à bandes (image 720×405) → fichier hébergé 720×1280 PLEIN, sans bande`, async () => {
      etat.ligne!.provider = provider;
      etat.telecharge = banded;
      expect(bandes(banded).haut).toBeGreaterThan(400); // le fichier fournisseur porte bien les bandes
      const r = await avancerStatutGeneration(U, G);
      expect(r.status).toBe('completed');
      expect(etat.uploads).toHaveLength(1);
      const b = bandes(etat.uploads[0].buf);
      expect(b).toEqual({ w: 720, h: 1280, haut: 0, bas: 0 });
    });
  }

  it('jumeau déjà plein cadre : hébergé OCTET POUR OCTET (aucun réencodage)', async () => {
    etat.telecharge = propre;
    await avancerStatutGeneration(U, G);
    expect(etat.uploads[0].buf).toBe(propre);
  });
});
