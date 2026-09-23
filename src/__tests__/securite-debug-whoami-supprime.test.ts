import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * `/api/debug/whoami` était une route de diagnostic PUBLIQUE :
 *   - sans session, elle renvoyait l'URL de la base (Supabase / PostgREST) et
 *     la présence des clés de service ;
 *   - avec n'importe quelle session, le nombre total d'utilisateurs et de
 *     comptes sociaux de toute la base.
 * Aucun appelant dans le dépôt. Elle est supprimée ; ce test empêche qu'elle
 * revienne, sous ce chemin ou par un lien qui la viserait encore.
 */

const racine = resolve(__dirname, '..');

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (nom === '__tests__' || nom === 'node_modules') return [];
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin];
  });
}

describe('route /api/debug/whoami', () => {
  it('n’existe plus', () => {
    expect(existsSync(join(racine, 'app/api/debug/whoami/route.ts'))).toBe(false);
    expect(existsSync(join(racine, 'app/api/debug/whoami'))).toBe(false);
  });

  it('n’est plus référencée par le code applicatif', () => {
    const coupables = fichiers(racine)
      .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf-8').includes('/api/debug/whoami'));
    expect(coupables).toEqual([]);
  });
});
