/**
 * A2.3 — GARDE D'ISOLEMENT : le rendu serveur n'est branché NULLE PART.
 *
 * Aucun écran (dashboard, composants, Calendrier), aucun client de rendu
 * navigateur, ni l'Autopilote, ni la publication sociale, ni les crons
 * n'importent `moteur-export-serveur` ni n'appellent `/api/render/jobs/…/serveur`.
 * Et le client navigateur des rendus n'appelle que les routes d'avant.
 *
 * Le contrat « Autopilote inchangé » est aussi tenu par
 * `spec-rendu-branchement.contract.test.ts` et `rendu-parite-baseline.contract.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = process.cwd();
const PERIMETRE = [
  'src/app/dashboard', 'src/components', 'src/lib/rendus/client.ts', 'src/lib/rendus/composer.ts',
  'src/lib/autopilot', 'src/lib/social', 'src/app/api/social', 'src/app/api/cron',
];

function fichiers(chemin: string): string[] {
  const abs = join(RACINE, chemin);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [chemin];
  return readdirSync(abs).flatMap((n) => fichiers(join(chemin, n)));
}

const SOURCES = PERIMETRE.flatMap(fichiers).filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f));
const APPEL_SERVEUR = /render\/jobs\/[^\n'"`]*\/serveur/;

describe('Le rendu serveur A2.3 n’est branché sur aucun parcours', () => {
  it('le périmètre est bien parcouru (Calendrier compris)', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES).toContain('src/app/dashboard/calendar/page.tsx');
    expect(SOURCES).toContain('src/lib/rendus/client.ts');
    expect(SOURCES.some((f) => f.startsWith('src/lib/autopilot/'))).toBe(true);
  });

  it('aucun import de moteur-export-serveur, aucun appel à /serveur', () => {
    const fautifs = SOURCES.filter((f) => {
      const src = readFileSync(join(RACINE, f), 'utf-8');
      return src.includes('moteur-export-serveur') || APPEL_SERVEUR.test(src);
    });
    expect(fautifs).toEqual([]);
  });

  it('le client navigateur des rendus n’appelle que jobs, upload, confirm, cancel', () => {
    const src = readFileSync(join(RACINE, 'src/lib/rendus/client.ts'), 'utf-8');
    const litteraux = [...src.matchAll(/fetch\(\s*(['"`])(.*?)\1/g)].map((m) => m[2]);
    expect(litteraux.length).toBeGreaterThan(0);
    const autorise = /^\/api\/render\/jobs(\/\$\{[^}]+\}\/(upload|confirm|cancel))?$/;
    expect(litteraux.filter((u) => !autorise.test(u))).toEqual([]);
    // Le seul fetch non littéral vise l'URL d'envoi rendue par le serveur.
    const dynamiques = [...src.matchAll(/fetch\(\s*([^'"`\s][^,)]*)/g)].map((m) => m[1].trim());
    expect(dynamiques).toEqual(['tentative.uploadUrl']);
    expect(src).not.toMatch(/\/serveur\b/);
  });
});
