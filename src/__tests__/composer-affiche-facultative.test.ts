/**
 * NON-RÉGRESSION — staging 01/10 (test Créer #494) : une affiche introuvable
 * (404, fichier supprimé avec un ancien post) faisait échouer TOUT le montage
 * (« La composition du montage a échoué »), rushes et plan pourtant prêts.
 * L'affiche est facultative : le rendu continue sur le fond dégradé, et
 * l'utilisateur est prévenu.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const composer = readFileSync(resolve(process.cwd(), 'src/lib/video-composer.ts'), 'utf-8');
const wizard = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

describe('affiche facultative', () => {
  it('une affiche introuvable n\'arrête plus le rendu', () => {
    expect(composer).not.toContain("throw new Error(`Impossible de charger l'image de fond");
    const bloc = composer.slice(composer.indexOf('if (posterUrl && !posterImg) {'), composer.indexOf('if (posterUrl && !posterImg) {') + 400);
    expect(bloc).not.toMatch(/throw /);
    expect(bloc).toContain('options.onAvertissement?.(message);');
  });

  it('sans affiche, chaque séquence a son fond dégradé (chemin existant)', () => {
    // drawIntro / drawCards / drawCTA : `if (posterImg|seqBgImg) … else paintSeqBackdrop(…)`.
    expect(composer).toContain("paintSeqBackdrop(ctx, w, h, 'intro', design, _accent);");
    expect(composer).toContain("paintSeqBackdrop(ctx, w, h, 'cards', design, accent);");
    expect(composer).toContain("paintSeqBackdrop(ctx, w, h, 'cta', design, accent);");
  });

  it('Créer prévient l\'utilisateur au lieu d\'échouer', () => {
    expect(wizard).toContain('onAvertissement: (message) => setMontageNotice(message),');
  });
});
