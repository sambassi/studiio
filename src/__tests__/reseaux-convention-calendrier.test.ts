import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  libelleCalendrier, normaliserPlateformesCalendrier, reseauDepuisLibelle, RESEAUX,
} from '@/lib/social/etatReseaux';

/**
 * UNE convention pour `scheduled_posts.platforms` vue du Calendrier.
 *
 * Le Calendrier écrit et compare ses libellés (« Instagram ») ; l'Autopilote
 * écrit des identifiants (« instagram »). Le cron accepte les deux, mais un
 * post programmé avec l'identifiant n'apparaissait ni sélectionné ni coloré
 * dans le Calendrier. Désormais : Créer écrit le libellé ; le Calendrier
 * normalise ce qu'il lit ; le cron ne change pas.
 */

describe('libelleCalendrier ↔ reseauDepuisLibelle', () => {
  it('aller-retour exact sur les quatre réseaux', () => {
    for (const r of RESEAUX) expect(reseauDepuisLibelle(libelleCalendrier(r))).toBe(r);
    expect(libelleCalendrier('tiktok')).toBe('TikTok');
    expect(libelleCalendrier('youtube')).toBe('YouTube');
  });
});

describe('normaliserPlateformesCalendrier', () => {
  it('identifiants → libellés ; libellés et canaux hors réseaux inchangés ; sans doublon', () => {
    expect(normaliserPlateformesCalendrier(['instagram', 'TikTok', 'Email', 'youtube'])).toEqual(['Instagram', 'TikTok', 'Email', 'YouTube']);
    expect(normaliserPlateformesCalendrier(['instagram', 'Instagram'])).toEqual(['Instagram']);
    expect(normaliserPlateformesCalendrier(['WhatsApp', 'Afroboost.com'])).toEqual(['WhatsApp', 'Afroboost.com']);
  });

  it('tolère null, undefined et les valeurs non textuelles', () => {
    expect(normaliserPlateformesCalendrier(null)).toEqual([]);
    expect(normaliserPlateformesCalendrier(undefined)).toEqual([]);
    expect(normaliserPlateformesCalendrier([42, null, 'facebook'])).toEqual(['Facebook']);
  });
});

describe('câblage', () => {
  const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
  const calendrier = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');
  const cron = readFileSync(resolve(__dirname, '../app/api/cron/publish/route.ts'), 'utf-8');

  it('Créer écrit les libellés du Calendrier', () => {
    expect(wizard).toContain('reseauxProgrammes.map(libelleCalendrier)');
  });

  it('le Calendrier normalise les plateformes à la lecture', () => {
    expect(calendrier).toContain('platforms: normaliserPlateformesCalendrier(p.platforms),');
  });

  it('le cron continue d accepter les deux conventions (casse abaissée)', () => {
    expect(cron).toContain('platform.toLowerCase()');
  });
});
