import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Le mp4 du rendu serveur doit être lisible par un navigateur.
 *
 * ⚠️ DEUX CAUSES SOUVENT CITÉES SONT ÉCARTÉES, MESURES À L'APPUI.
 *
 * - **`yuv444p` / High 4:4:4** : faux. `pixelFormat: 'yuv420p'` est passé
 *   depuis toujours, et ffprobe confirme du 4:2:0 sur un rendu réel.
 * - **`moov` en fin de fichier** : faux. Sur un rendu réel, l'ordre des
 *   atomes est `ftyp moov free mdat` — l'index est déjà en tête, le
 *   démarrage progressif fonctionne sans post-traitement `+faststart`.
 *
 * La seule déviation mesurée était la **plage de couleur**. `pixelFormat`
 * fixe le sous-échantillonnage, pas la plage : les images venant d'un
 * Chromium en RGB pleine échelle, x264 étiquetait le flux
 * `yuvj420p(pc, bt470bg/unknown/unknown)`. Correct en 4:2:0, mais avec une
 * signalisation que la vidéo web n'utilise pas.
 *
 * `colorSpace: 'bt709'` donne `yuv420p(tv, bt709)` — vérifié par ffprobe sur
 * deux rendus, avant et après.
 */

const worker = readFileSync(resolve(__dirname, '../lib/render/worker.ts'), 'utf-8');

describe('Les options d encodage du rendu serveur', () => {
  it('h264 + 4:2:0 : ce que les navigateurs décodent', () => {
    expect(worker).toContain("codec: 'h264',");
    expect(worker).toContain("pixelFormat: 'yuv420p',");
  });

  it('et la plage de couleur STANDARD', () => {
    // `pixelFormat` ne la fixe pas : sans cette ligne, la sortie est en
    // `yuvj420p` pleine échelle, avec une matrice non renseignée.
    expect(worker).toContain("colorSpace: 'bt709',");
  });

  it('la raison est écrite là où on la cherchera', () => {
    expect(worker).toContain('LA SORTIE EST EN `yuvj420p`');
  });
});

describe('Aucun autre chemin ne produit un format non lisible', () => {
  it('tous les encodages du dépôt sont en 4:2:0', () => {
    // Un seul `yuv444p` quelque part suffirait à produire un fichier que le
    // navigateur refuse.
    for (const f of [
      '../lib/ffmpeg/transcode-to-mp4.ts',
      '../lib/ffmpeg-montage.ts',
      '../app/api/cron/publish/route.ts',
    ]) {
      const src = readFileSync(resolve(__dirname, f), 'utf-8');
      expect(src, f).not.toContain('yuv444');
      expect(src, f).toContain('yuv420p');
    }
  });
});
