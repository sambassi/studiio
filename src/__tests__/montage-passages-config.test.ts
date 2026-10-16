/**
 * M3-a PR1 — interrupteur ÉTEINT et AUCUN branchement : ni Créer, ni
 * l'Autopilote, ni les plans multi-sources ne demandent le mode passages.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { montagePassagesActif } from '@/lib/creer/montage-passages-config';

const RACINE = join(__dirname, '..', '..');
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.(ts|tsx|js|mjs)$/.test(n) ? [p] : [];
  });
}
const SOURCES = fichiers(join(RACINE, 'src')).filter((p) => !p.includes(`${join('src', '__tests__')}`));
const AUTORISES = new Set(['src/lib/creer/montage-passages-config.ts', 'src/lib/creer/passages-rush.ts', 'src/lib/creer/smart-montage.ts']);

describe('interrupteur STUDIIO_MONTAGE_PASSAGES_ENABLED', () => {
  it('"true" exactement active ; tout le reste éteint', () => {
    expect(montagePassagesActif({ STUDIIO_MONTAGE_PASSAGES_ENABLED: 'true' })).toBe(true);
    for (const v of [undefined, '', '1', 'TRUE', 'True', 'yes', ' true', 'true ']) {
      expect(montagePassagesActif({ STUDIIO_MONTAGE_PASSAGES_ENABLED: v })).toBe(false);
    }
    expect(montagePassagesActif({})).toBe(false);
  });
});

describe('garde : aucun appelant ne lit l\'interrupteur ni ne demande le mode passages', () => {
  it('l\'interrupteur n\'est lu nulle part hors de son module', () => {
    const lecteurs = SOURCES.filter((p) => readFileSync(p, 'utf8').includes('STUDIIO_MONTAGE_PASSAGES_ENABLED') || readFileSync(p, 'utf8').includes('montage-passages-config'))
      .map((p) => relative(RACINE, p));
    expect(lecteurs).toEqual(['src/lib/creer/montage-passages-config.ts']);
  });

  it('passages-rush n\'est importé que par le moteur', () => {
    const importeurs = SOURCES.filter((p) => /from '@\/lib\/creer\/passages-rush'|from '\.\/passages-rush'/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(RACINE, p));
    expect(importeurs).toEqual(['src/lib/creer/smart-montage.ts']);
  });

  it('aucun fichier ne passe `selection` ni `entreesPassages` à planMontage (Créer, Autopilote, multi-sources compris)', () => {
    const fautifs = SOURCES.filter((p) => !AUTORISES.has(relative(RACINE, p)))
      .filter((p) => /selection\s*:\s*['"`]passages|entreesPassages/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(RACINE, p));
    expect(fautifs).toEqual([]);
    for (const f of ['src/app/dashboard/creer/AssistantWizard.tsx', 'src/lib/autopilot/produire.ts', 'src/lib/autopilot/plan-multi-sources.ts']) {
      const t = readFileSync(join(RACINE, f), 'utf8');
      expect(t.includes('passages'), f).toBe(false);
    }
  });
});
