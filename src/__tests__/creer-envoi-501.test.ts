/**
 * #501 — régression staging : en « Modifier », l'étape Envoi demandait une
 * date. Cause : la règle #497 (date de brouillon LOCAL passée → vide) était
 * aussi appliquée à la date du POST rouvert. Et l'envoi exigeait une date
 * même en brouillon.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { dateRestauree, dateRequiseManquante, envoiPossible } from '@/lib/creer/envoi';

const LE_5_OCTOBRE = new Date(2026, 9, 5, 9, 0);

describe('date restaurée', () => {
  it('Modifier → la date du post est gardée telle quelle, même passée (brouillon sans date demandée)', () => {
    expect(dateRestauree('2026-09-30', true, LE_5_OCTOBRE)).toBe('2026-09-30');
  });
  it('brouillon local → règle #497 inchangée (date passée vidée, future gardée)', () => {
    expect(dateRestauree('2026-09-30', false, LE_5_OCTOBRE)).toBe('');
    expect(dateRestauree('2026-10-20', false, LE_5_OCTOBRE)).toBe('2026-10-20');
  });
});

describe('envoi', () => {
  it('brouillon : jamais de date exigée', () => {
    expect(envoiPossible({ intention: 'brouillon', date: '', reseaux: 0 })).toBe(true);
    expect(dateRequiseManquante('brouillon', '')).toBe(false);
  });
  it('programmer : date ET réseau obligatoires', () => {
    expect(envoiPossible({ intention: 'programmer', date: '', reseaux: 1 })).toBe(false);
    expect(envoiPossible({ intention: 'programmer', date: '2026-10-10', reseaux: 0 })).toBe(false);
    expect(envoiPossible({ intention: 'programmer', date: '2026-10-10', reseaux: 1 })).toBe(true);
    expect(dateRequiseManquante('programmer', '')).toBe(true);
  });
  it('câblage : le Wizard n’exige plus `scheduledDate` pour un brouillon', () => {
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(w).toContain('!envoiPossible({ intention: envoiIntention, date: scheduledDate, reseaux: reseauxProgrammes.length })');
    expect(w).not.toContain('actif(VERROU.serie) || !scheduledDate');
    expect(w).toContain('setScheduledDate(dateRestauree(draft.scheduledDate, !!editPostId))');
  });
});
