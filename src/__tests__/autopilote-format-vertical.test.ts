// @vitest-environment node
/**
 * LE FORMAT VERTICAL VA JUSQU'AUX PIXELS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « L'interface dit Vertical 9:16, le MP4 fait 1920×1080. » Le soupçon était
 * legitime, et il valait une preuve dans les deux sens : le contrat de
 * dimensions d'abord, puis un VRAI encodage.
 *
 * ⚠️ UN TEST DE CONTRAT NE SUFFISAIT PAS. `dimensionsCible('9:16')` peut
 * rendre 1080×1920 pendant que le graphe ffmpeg, lui, produit autre chose —
 * une echelle inversee, un recadrage de travers, un `scale` qui garde la
 * source. La seule facon de le savoir est de mesurer le fichier produit,
 * c'est ce que fait le second bloc.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createReadStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileP = promisify(execFile);
const objets = new Map<string, string>();

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lecteurMinio: () => ({
    getObject: async (_b: string, cle: string) => {
      const f = objets.get(cle);
      if (!f) throw new Error('objet absent');
      return createReadStream(f);
    },
  }),
}));

import { dimensionsCible, FORMATS_MONTAGE } from '@/lib/autopilot/analyse/montage-contrat';
import { orientation } from '@/lib/autopilot/analyse/rendu-passerelle';
import { produireMontage } from '@/lib/autopilot/analyse/rendu';
import { reinitialiserCapacite } from '@/lib/autopilot/analyse/capacite';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { MontagePlan, PlanMontage } from '@/lib/autopilot/analyse/montage-contrat';

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';

function outilPresent(c: string) {
  try { execFileSync(c, ['-version'], { stdio: 'ignore', timeout: 10_000 }); return true; }
  catch { return false; }
}
const OUTILS = outilPresent(cheminFfmpeg()) && outilPresent(cheminFfprobe());

let atelier = '';
let clip = '';

beforeEach(() => { reinitialiserCapacite(); objets.clear(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('Le contrat de dimensions', () => {
  it('les trois formats donnent les trois cadres attendus', () => {
    expect(dimensionsCible('9:16')).toEqual({ largeur: 1080, hauteur: 1920 });
    expect(dimensionsCible('1:1')).toEqual({ largeur: 1080, hauteur: 1080 });
    expect(dimensionsCible('16:9')).toEqual({ largeur: 1920, hauteur: 1080 });
  });

  it('le vocabulaire de l’écran est exactement celui du contrat', () => {
    expect([...FORMATS_MONTAGE].sort()).toEqual(['16:9', '1:1', '9:16'].sort());
  });

  it('l’étiquette se DÉDUIT des pixels, elle n’est jamais choisie', () => {
    // C'est ce qui rend l'aperçu incapable d'annoncer « Vertical » sur un
    // fichier horizontal : le mot vient des dimensions mesurées.
    expect(orientation(1080, 1920)).toBe('Vertical');
    expect(orientation(1920, 1080)).toBe('Horizontal');
    expect(orientation(1080, 1080)).toBe('Carré');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!OUTILS)('Le MP4 réellement produit', () => {
  beforeAll(async () => {
    atelier = mkdtempSync(join(tmpdir(), 'format-vertical-'));
    clip = join(atelier, 'clip.mp4');
    // Une source HORIZONTALE : si le rendu se contentait de recopier la
    // source, le test le verrait tout de suite.
    await execFileP(cheminFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:d=6:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6:sample_rate=48000',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', '6', clip], { timeout: 180_000 });
  }, 300_000);
  afterAll(() => { if (atelier) rmSync(atelier, { recursive: true, force: true }); });

  const plan = (format: '9:16' | '1:1' | '16:9'): MontagePlan => {
    const cible = dimensionsCible(format);
    const p = {
      ordre: 1, rangClip: 1, bucket: 'videos',
      cle: `${UID}/autopilote/clips/jeu/rang-01.mp4`,
      entreeSecondes: 0, dureeRetenueSecondes: 4, debutTimelineSecondes: 0,
      raccourci: false,
      // Un rectangle au ratio de la cible, pris dans la source horizontale.
      recadrage: format === '16:9'
        ? { x: 0, y: 0, largeur: 1, hauteur: 1 }
        : { x: 0.25, y: 0, largeur: 0.5, hauteur: 1 },
      strategieRecadrage: 'centre-largeur',
      largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe',
    } as unknown as PlanMontage;
    return {
      id: 'r1', userId: UID, montagePlanId: 'p1', clipSetId: 'c1', clipSetVersion: 1,
      candidateSetId: 'cs1', analysisId: 'a1', algorithme: 'm3e-v3',
      methodeMaterialisation: 'x264-crf23-v1', algorithmePlan: 'm3g-v1',
      format, dureeCibleSecondes: 4, version: 1,
      largeurCible: cible.largeur, hauteurCible: cible.hauteur, fps: 30,
      plans: [p], dureeTotaleSecondes: 4, ecartSecondes: 0, clipsEcartes: 0,
      usage: { plansRetenus: 1 }, createdAt: '', updatedAt: '',
    } as unknown as MontagePlan;
  };

  it('Vertical 9:16 → 1080×1920, et l’étiquette dit « Vertical »', async () => {
    objets.set(`${UID}/autopilote/clips/jeu/rang-01.mp4`, clip);
    const r = await produireMontage({ userId: UID, plan: plan('9:16') });
    expect(r.motif).toBeNull();
    expect(r.ok).toBe(true);
    // ⚠️ MESURÉ SUR LE FICHIER, pas déduit du plan. `mesurer()` relit le MP4
    // avec ffprobe : c'est cette valeur-là que l'aperçu affichera.
    expect(r.mesure!.largeur).toBe(1080);
    expect(r.mesure!.hauteur).toBe(1920);
    expect(orientation(r.mesure!.largeur, r.mesure!.hauteur)).toBe('Vertical');
  }, 300_000);

  it('Horizontal 16:9 → 1920×1080 : l’autre sens ne régresse pas', async () => {
    objets.set(`${UID}/autopilote/clips/jeu/rang-01.mp4`, clip);
    const r = await produireMontage({ userId: UID, plan: plan('16:9') });
    expect(r.ok).toBe(true);
    expect(r.mesure!.largeur).toBe(1920);
    expect(r.mesure!.hauteur).toBe(1080);
    expect(orientation(r.mesure!.largeur, r.mesure!.hauteur)).toBe('Horizontal');
  }, 300_000);

  it('Carré 1:1 → 1080×1080', async () => {
    objets.set(`${UID}/autopilote/clips/jeu/rang-01.mp4`, clip);
    const r = await produireMontage({ userId: UID, plan: plan('1:1') });
    expect(r.ok).toBe(true);
    expect(r.mesure!.largeur).toBe(1080);
    expect(r.mesure!.hauteur).toBe(1080);
  }, 300_000);
});
