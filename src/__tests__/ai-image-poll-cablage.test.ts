import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * RACINE A — le correctif est CÂBLÉ sur toute la chaîne image de Créer.
 *
 * On vérifie, sur la source réelle de `/api/ai/image`, que :
 *  - le mode `poll` est bien posé sur l'appel Replicate partagé ;
 *  - les retouches (gomme, édition, transfert de style, calques, détourage,
 *    upscale) et la génération d'affiche (texte + « partir de ma photo ») passent
 *    TOUTES par `genererAvecDelai` (donc : poll + délai + erreurs distinctes),
 *    et n'appellent plus `replicate.run(MODELS['…'])` en direct (mode block).
 *  - seuls `image-to-video` (vidéo, budget de temps différent) et `ocr` (texte,
 *    déjà rapide) restent en direct — hors périmètre de ce lot, signalés.
 */

const src = readFileSync(resolve(__dirname, '../app/api/ai/image/route.ts'), 'utf8');

describe('AI Image — câblage du correctif poll', () => {
  it('l’appel Replicate partagé pose `wait: { mode: \'poll\' }`', () => {
    expect(src).toContain("wait: { mode: 'poll' }");
  });

  it('la chaîne image de Créer NE fait plus d’appel direct block-mode', () => {
    // Ces modèles doivent passer par le helper, jamais par un run() direct.
    expect(src).not.toContain("replicate.run(MODELS['generate-bg']");
    expect(src).not.toContain("replicate.run(MODELS['image-edit']");
    expect(src).not.toContain("replicate.run(MODELS['remove-bg']");
    expect(src).not.toContain("replicate.run(MODELS['upscale']");
  });

  it('les retouches + affiche passent par `genererAvecDelai` (≥ 7 usages)', () => {
    const n = (src.match(/genererAvecDelai\(replicate/g) || []).length;
    expect(n).toBeGreaterThanOrEqual(7);
  });

  it('seuls image-to-video et ocr restent en direct (hors périmètre, connus)', () => {
    const directs = (src.match(/replicate\.run\(MODELS\['([^']+)'\]/g) || [])
      .map((m) => m.replace(/.*MODELS\['/, '').replace(/'\]/, ''));
    // Aucun modèle de la chaîne image ne doit rester en direct.
    for (const restant of directs) {
      expect(['image-to-video', 'ocr']).toContain(restant);
    }
  });
});
