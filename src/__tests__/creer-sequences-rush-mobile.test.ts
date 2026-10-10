/**
 * Ligne « Vidéo » de la section Séquences, sur mobile (390 px).
 *
 * Avec un rush, la ligne porte Changer / Temps forts / Recadrer / Retirer en
 * plus du libellé, de la durée, des flèches et de l'œil. Sur une seule ligne,
 * le libellé tombait à 0 px et les boutons sortaient de l'écran (débordement
 * horizontal de ~110 px, « Recadrer » coupé, œil invisible) — relevé au banc
 * visuel. Sous `sm`, la ligne se replie : les gestes du rush prennent leur
 * propre ligne, en dernier, et s'y replient eux-mêmes. Au-delà de `sm`, la
 * disposition d'avant est rétablie à l'identique.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const wizard = readFileSync(join(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');

describe('Séquences — ligne Vidéo sur mobile', () => {
  it('la ligne de séquence se replie sous sm, et redevient une ligne au-delà', () => {
    expect(wizard).toContain('className={`flex flex-wrap sm:flex-nowrap items-center gap-3 rounded-xl px-3 py-2.5 transition ${');
  });

  it('les gestes du rush passent sur leur propre ligne sous sm, et reviennent en place au-delà', () => {
    const m = /<div data-rush-actions className="([^"]+)">/.exec(wizard);
    expect(m).toBeTruthy();
    const classes = m![1].split(/\s+/);
    for (const c of ['flex-wrap', 'basis-full', 'order-last', 'sm:flex-nowrap', 'sm:basis-auto', 'sm:order-none', 'flex-shrink-0']) {
      expect(classes).toContain(c);
    }
    // Les quatre gestes restent dans ce groupe.
    const bloc = wizard.slice(wizard.indexOf('<div data-rush-actions'), wizard.indexOf('Repli tactile et clavier'));
    for (const geste of ['Remplacer le rush', 'Découper les temps forts du rush', 'data-rush-recadrer', 'Retirer le rush']) {
      expect(bloc).toContain(geste);
    }
  });
});
