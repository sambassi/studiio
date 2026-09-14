import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  supportDeLut, CAPACITES_ACTUELLES, LIBELLES_SUPPORT,
} from '@/lib/luts/support';

/**
 * Le statut de support est DÉRIVÉ, jamais décidé dans une interface.
 *
 * Une 1D importable mais pas encore rendue ne doit ni disparaître, ni être
 * ignorée en silence : elle est conservée et son statut le dit.
 */
describe('supportDeLut — dérivation', () => {
  it('« ready » quand le rendu sait appliquer cette nature', () => {
    expect(supportDeLut('3d', { apercu: true, rendu3d: true, rendu1d: false })).toBe('ready');
    expect(supportDeLut('1d', { apercu: true, rendu3d: true, rendu1d: true })).toBe('ready');
  });

  it('« preview-only » quand seul l’aperçu sait l’appliquer', () => {
    expect(supportDeLut('1d', { apercu: true, rendu3d: true, rendu1d: false })).toBe('preview-only');
    expect(supportDeLut('3d', { apercu: true, rendu3d: false, rendu1d: false })).toBe('preview-only');
  });

  it('« unsupported-render » quand ni l’aperçu ni le rendu ne la lisent', () => {
    expect(supportDeLut('3d', { apercu: false, rendu3d: false, rendu1d: false })).toBe('unsupported-render');
    expect(supportDeLut('1d', { apercu: false, rendu3d: true, rendu1d: false })).toBe('unsupported-render');
  });

  it('le 3D et la 1D sont jugés SÉPARÉMENT — câbler lut3d ne promet rien à la 1D', () => {
    const c = { apercu: false, rendu3d: true, rendu1d: false };
    expect(supportDeLut('3d', c)).toBe('ready');
    expect(supportDeLut('1d', c)).toBe('unsupported-render');
  });

  it('chaque statut a un libellé, pour que l’interface n’invente pas le sien', () => {
    for (const s of ['ready', 'preview-only', 'unsupported-render'] as const) {
      expect(LIBELLES_SUPPORT[s].length).toBeGreaterThan(0);
    }
  });
});

/**
 * La constante dit l'état RÉEL du dépôt. Ce test la confronte au code : le
 * jour où un moteur consomme une LUT importée, il doit échouer, et c'est
 * voulu — c'est le rappel de mettre la constante à jour.
 */
describe('CAPACITES_ACTUELLES — fidèle au code', () => {
  const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('aucun aperçu étalonné n’est branché sur le wizard', () => {
    const wizard = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(/applyLutToPixels|GradedVideo|gradeFrame/.test(wizard)).toBe(CAPACITES_ACTUELLES.apercu);
  });

  it('le compositeur client n’applique aucune LUT au rendu', () => {
    const composer = src('src/lib/video-composer.ts');
    expect(/applyLutToPixels|createLutGrader|loadLut/.test(composer)).toBe(CAPACITES_ACTUELLES.rendu3d);
  });

  it('par défaut, supportDeLut lit CAPACITES_ACTUELLES', () => {
    expect(supportDeLut('3d')).toBe(supportDeLut('3d', CAPACITES_ACTUELLES));
    expect(supportDeLut('1d')).toBe(supportDeLut('1d', CAPACITES_ACTUELLES));
  });
});
