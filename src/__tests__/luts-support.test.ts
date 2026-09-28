import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

  /**
   * Le compositeur SAIT étalonner le rush (`rushLut` → `createLutGrader`),
   * mais une LUT importée n'est « appliquée au montage » que si un appelant
   * la lui TRANSMET. Sans appelant, `rendu3d` doit rester false : sinon
   * l'interface promettrait « Appliquée au montage » pour un rendu brut.
   */
  const composer = src('src/lib/video-composer.ts');
  const composerEtalonne = /createLutGrader/.test(composer) && /rushLut/.test(composer);

  /** Fichiers applicatifs (hors tests, hors compositeur) qui passent `rushLut`. */
  const appelantsRushLut = (() => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(rel);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && rel !== 'src/lib/video-composer.ts') {
          if (/\brushLut\s*[:,}]/.test(src(rel))) found.push(rel);
        }
      }
    };
    walk('src');
    return found;
  })();

  it('rendu3d = le compositeur étalonne ET un appelant lui transmet la LUT', () => {
    expect(CAPACITES_ACTUELLES.rendu3d).toBe(composerEtalonne && appelantsRushLut.length > 0);
  });

  /** Les options des QUATRE chemins du Calendrier : une fonction partagée. */
  const OPTIONS_CALENDRIER = 'src/lib/rendus/options-depuis-metadata.ts';

  it('aujourd’hui : le wizard Créer et le Calendrier sont les SEULS appelants, et rendu3d le dit', () => {
    // Un nouvel appelant doit être ajouté ICI en connaissance de cause : il
    // hérite de la promesse « Appliquée au montage ». Le Calendrier transmet
    // la LUT par sa fonction partagée, qu'il appelle sur ses quatre chemins.
    expect(composerEtalonne).toBe(true);
    expect([...appelantsRushLut].sort()).toEqual([
      'src/app/dashboard/creer/AssistantWizard.tsx',
      OPTIONS_CALENDRIER,
    ]);
    expect(src('src/app/dashboard/calendar/page.tsx').match(/preparerOptionsRendu\(post, '/g)).toHaveLength(4);
    expect(CAPACITES_ACTUELLES.rendu3d).toBe(true);
  });

  it('chaque appelant transmet une LUT RÉELLEMENT lue, et rien sans elle', () => {
    // `rendu3d` ne vaut que si la table transmise vient de la bibliothèque du
    // compte — pas d'une valeur inventée — et la clé est absente sans filtre
    // (default-safe : options identiques à l'avant-LUT).
    const wizard = src('src/app/dashboard/creer/AssistantWizard.tsx');
    const lectures = wizard.match(/const rushLut = [^;\n]*;/g) ?? [];
    expect(lectures.length).toBeGreaterThan(0);
    for (const l of lectures) expect(l).toMatch(/await chargerLutPourRendu\(/);
    const transmissions = wizard.match(/\brushLut\s*[:,}]/g) ?? [];
    const conditionnelles = wizard.match(/\.\.\.\(rushLut \? \{ rushLut \} : \{\}\)/g) ?? [];
    expect(transmissions.length).toBe(conditionnelles.length);
    expect(wizard).toMatch(/const rushLut = [^;]*await chargerLutPourRendu\(lut\)/);

    // Calendrier : lue UNE fois, seulement avec un rush, puis posée sous la
    // forme conditionnelle — la clé est absente sans filtre.
    const options = src(OPTIONS_CALENDRIER);
    expect(options.match(/await d\.chargerLutPourRendu\(meta\.lut\)/g)).toHaveLength(1);
    expect(options).toMatch(/const rushLut = meta\.rushUrls\?\.\[0\] \? await d\.chargerLutPourRendu\(meta\.lut\) : null;/);
    expect(options.match(/\.\.\.\(prep\.rushLut \? \{ rushLut: prep\.rushLut \} : \{\}\)/g)).toHaveLength(1);
  });

  it('le Calendrier étalonne sur ses QUATRE chemins de rendu', () => {
    // Régénérer, Planifier, Publier, Exporter : un chemin oublié rendrait une
    // vidéo sans le filtre, sans le moindre message. Chacun construit ses
    // options par `preparerOptionsRendu`, qui lit la LUT.
    const cal = src('src/app/dashboard/calendar/page.tsx');
    const rendus = cal.match(/composerEtFacturer\(/g) ?? [];
    const preparations = cal.match(/await preparerOptionsRendu\(post, '(regenerer|planifier|publier|exporter)'/g) ?? [];
    expect(rendus.length).toBe(4);
    expect(new Set(preparations).size).toBe(4);
    // Aucune lecture en direct : une seule source de vérité.
    expect(cal).not.toMatch(/chargerLutPourRendu\(/);
  });

  it('le compositeur libère l’étalonneur quel que soit le règlement du montage', () => {
    // Les deux boucles (fast et temps réel) : sinon `rendu3d` promettrait un
    // montage qui laisse fuir un contexte WebGL par export.
    expect(composer.match(/\}\)\.finally\(libererEtalonneur\);/g)?.length).toBe(2);
  });

  it('le compositeur n’étalonne jamais sur CPU et ne charge aucune LUT lui-même', () => {
    // CPU : des centaines de ms par frame en 1080×1920, le montage temps réel
    // perdrait ses frames. Chargement : les LUT sont privées, servies par une
    // route authentifiée — la table doit arriver déjà lue.
    expect(/applyLutToPixels|loadLut|\/api\/creatif\/luts/.test(composer)).toBe(false);
  });

  it('la 1D n’est pas annoncée au rendu tant que le 3D ne l’est pas', () => {
    expect(CAPACITES_ACTUELLES.rendu1d && !CAPACITES_ACTUELLES.rendu3d).toBe(false);
  });

  it('par défaut, supportDeLut lit CAPACITES_ACTUELLES', () => {
    expect(supportDeLut('3d')).toBe(supportDeLut('3d', CAPACITES_ACTUELLES));
    expect(supportDeLut('1d')).toBe(supportDeLut('1d', CAPACITES_ACTUELLES));
  });
});
