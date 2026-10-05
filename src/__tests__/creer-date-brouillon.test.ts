/**
 * NON-RÉGRESSION — staging 01/10 (#496) : Créer « ne produisait rien dans le
 * Calendrier ». Les posts étaient bien créés (CARDIO_DANCE, vidéo,
 * surimpressions, brouillon) mais DATÉS DU 30/09 : la date d'un brouillon de
 * la veille était reprise telle quelle, et le Calendrier du mois courant
 * affichait « 0 total ».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { dateBrouillonReprise, batchDates } from '@/lib/creer/batch';

const LE_1ER_OCTOBRE = new Date(2026, 9, 1, 15, 28);

describe('date d\'un brouillon repris', () => {
  it('une date passée (hier, 30/09) n\'est pas reprise : le post part aujourd\'hui', () => {
    expect(dateBrouillonReprise('2026-09-30', LE_1ER_OCTOBRE)).toBe('');
    // Le rendu retombe alors sur aujourd'hui (comportement existant, date vide).
    expect(batchDates(LE_1ER_OCTOBRE, 1)).toEqual(['2026-10-01']);
  });
  it('aujourd\'hui et le futur sont gardés ; une valeur invalide est ignorée', () => {
    expect(dateBrouillonReprise('2026-10-01', LE_1ER_OCTOBRE)).toBe('2026-10-01');
    expect(dateBrouillonReprise('2026-10-15', LE_1ER_OCTOBRE)).toBe('2026-10-15');
    expect(dateBrouillonReprise('hier', LE_1ER_OCTOBRE)).toBe('');
    expect(dateBrouillonReprise(undefined, LE_1ER_OCTOBRE)).toBe('');
  });
  it('Créer applique la règle à la reprise du brouillon (CARDIO_DANCE, vidéo, musique : même chemin)', () => {
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    // #501 : la règle passe par `dateRestauree` — #497 pour un brouillon
    // local, la date du post telle quelle en modification.
    expect(w).toContain('if (draft.scheduledDate) setScheduledDate(dateRestauree(draft.scheduledDate, !!editPostId));');
    expect(w).not.toContain('if (draft.scheduledDate) setScheduledDate(draft.scheduledDate);');
  });
});
