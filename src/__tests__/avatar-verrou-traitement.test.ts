import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prendreVerrouSource, libererVerrouSource } from '@/lib/avatar/verrou-traitement';

/** Un seul envoi / traitement de source vidéo à la fois par compte. */
describe('Verrou de traitement des sources', () => {
  it('⚠️ un second appel du MÊME compte est refusé tant que le premier tourne ; un autre compte passe', () => {
    expect(prendreVerrouSource('u1')).toBe(true);
    expect(prendreVerrouSource('u1')).toBe(false);
    expect(prendreVerrouSource('u2')).toBe(true);
    libererVerrouSource('u1');
    expect(prendreVerrouSource('u1')).toBe(true);
    libererVerrouSource('u1'); libererVerrouSource('u2');
  });

  it('⚠️ les deux routes prennent le verrou et le rendent dans `finally` (même en erreur)', () => {
    for (const f of ['src/app/api/avatar/sources/route.ts', 'src/app/api/avatar/sources/traiter/route.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/if \(!prendreVerrouSource\(userId\)\) return refus\(429/);
      expect(src).toMatch(/finally \{\n\s+if \(verrouille\) libererVerrouSource\(verrouille\);/);
    }
  });
});
