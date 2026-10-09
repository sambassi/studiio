// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import {
  bornerParametres, dossierTemporaire, infosVideo, preflightSource, retirerDossierTemporaire, traiterVideo,
} from '@/lib/avatar/preparation-source';

/**
 * INTÉGRATION — le vrai ffmpeg/ffprobe, sur une vidéo SYNTHÉTIQUE (mire +
 * sinusoïde). Sautée si les binaires ne sont pas présents sur la machine.
 * Aucun réseau, aucun stockage, aucun fournisseur.
 */

function binairesPresents(): boolean {
  try {
    execFileSync(cheminFfmpeg(), ['-version'], { stdio: 'ignore' });
    execFileSync(cheminFfprobe(), ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const present = binairesPresents();
let dossier: string | null = null;

describe.skipIf(!present)('Préparation — vrai ffmpeg', () => {
  let source = '';
  beforeAll(async () => {
    dossier = await dossierTemporaire();
    source = join(dossier, 'source.mp4');
    execFileSync(cheminFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source,
    ]);
  }, 60_000);
  afterAll(async () => { await retirerDossierTemporaire(dossier); });

  it('sonde, coupe 16 s, pivote, recadre, corrige : un MP4 H.264 + AAC conforme', async () => {
    const original = await infosVideo(source);
    expect(original).toMatchObject({ codecVideo: 'h264', codecAudio: 'aac', largeurEffective: 1280, hauteurEffective: 720 });
    expect(original.dureeS).toBeGreaterThan(19);

    const p = bornerParametres({
      debutS: 2, finS: 18, rotation: 90,
      recadrage: { x: 0, y: 0.1, largeur: 1, hauteur: 0.8 },
      amelioration: { active: true, luminosite: 0.03, contraste: 1.05, saturation: 1.02, nettete: 0.3, debruitage: true },
    }, original.dureeS, { largeur: original.largeurEffective, hauteur: original.hauteurEffective });
    const sortie = join(dossier!, 'preparee.mp4');
    await traiterVideo(source, sortie, p, original);

    const prep = await infosVideo(sortie);
    expect(prep.codecVideo).toBe('h264');
    expect(prep.codecAudio).toBe('aac');
    expect(prep.rotation).toBe(0);
    // 1280×720 tourné = 720×1280 ; 80 % de hauteur = 1024.
    expect([prep.largeurEffective, prep.hauteurEffective]).toEqual([720, 1024]);
    expect(prep.dureeS).toBeGreaterThan(15.5);
    expect(prep.dureeS).toBeLessThan(16.6);
    expect(preflightSource(prep).ok).toBe(true);
  }, 120_000);

  it('un fichier qui n’est pas une vidéo : la sonde lève', async () => {
    const faux = join(dossier!, 'faux.mp4');
    execFileSync('sh', ['-c', `printf 'pas une video' > '${faux}'`]);
    await expect(infosVideo(faux)).rejects.toThrow();
  });
});
