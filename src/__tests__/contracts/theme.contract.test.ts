/**
 * CONTRAT C-THEME — un thème hors sport (Finance, Beauté, Cuisine, Voyage,
 * Productivité) ne reçoit JAMAIS de requête stock ni d'affiche « fitness ».
 * Validé par #563 (src/lib/stock/requetes.ts, src/lib/autopilot/poster-requete.ts).
 */
import { describe, it, expect } from 'vitest';
import { posterQuery } from '@/lib/autopilot/poster-requete';
import { construireRecherchesStock, type RoleSequence } from '@/lib/stock/requetes';
import { buildAutopilotSample } from '@/lib/autopilot/sample';

const SPORT = /fitness|workout|gym|weightlifting|athlete|training|dance/i;
const HORS_SPORT = ['finance', 'Finance', 'budget et épargne', 'beauté', 'skincare', 'cuisine', 'voyage', 'productivité'];
const ROLES: RoleSequence[] = ['titre', 'cartes', 'video', 'cta', 'HOOK', 'BUILD', 'PEAK', 'FOCUS', 'CTA'];

describe('C-THEME — affiche', () => {
  it.each(HORS_SPORT)('« %s » → requête d’affiche du thème, jamais fitness', (t) => {
    const q = posterQuery(t);
    expect(q.trim()).not.toBe('');
    expect(q).not.toMatch(SPORT);
  });
  it('Finance → finance explicitement', () => {
    expect(posterQuery('Finance')).toMatch(/finance|money|budget/);
  });
  it('aperçu Autopilote Finance : la requête d’affiche montrée est celle du thème', () => {
    expect(buildAutopilotSample({ topics: ['finance'] }).posterQuery).not.toMatch(SPORT);
  });
});

describe('C-THEME — requêtes stock', () => {
  it.each(['Finance', 'beauté', 'cuisine', 'voyage', 'productivité'])('« %s », chaque rôle et chaque visuel : aucune requête sport', (sujet) => {
    for (const role of ROLES) {
      for (const visuel of ['video', 'photo', 'arriere-plan', 'illustration'] as const) {
        const r = construireRecherchesStock({ sujet, role, visuel, texte: null });
        expect(r.requetes.length, `${sujet}/${role}/${visuel}`).toBeGreaterThan(0);
        for (const q of r.requetes) expect(q, `${sujet}/${role}/${visuel}`).not.toMatch(SPORT);
      }
    }
  });
  it('Finance + objectif « remplir ma salle de sport » : le brief ne réimpose pas le sport', () => {
    for (const role of ROLES) {
      const r = construireRecherchesStock({ sujet: 'Finance', objectif: 'remplir ma salle de sport', role, texte: 'Gérer son budget' });
      for (const q of r.requetes) expect(q, role).not.toMatch(SPORT);
    }
  });
});
