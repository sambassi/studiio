// @vitest-environment jsdom
/**
 * #613 — côté écran : une production sans avatar relue de la BASE (autre
 * onglet, redémarrage) est suivie par son créneau, et une issue
 * « interrompue » propose une RELANCE.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  suivreProductionDuServeur, lireProductionSuivie, noterProductionSuivie, oublierProductionSuivie,
  lireProgressionServeur, libelleBoutonProduire,
} from '@/lib/autopilot/etat-production-manuelle';

beforeEach(() => { oublierProductionSuivie(); });

describe('suivreProductionDuServeur', () => {
  it('note le créneau de la production en cours que ce navigateur ne suivait pas', () => {
    suivreProductionDuServeur({ progression: { etape: 'composition' }, production: { date: '2026-10-20', time: '14:10' } });
    expect(lireProductionSuivie()).toMatchObject({ date: '2026-10-20', time: '14:10' });
  });
  it('ne remplace jamais un suivi existant, ignore une réponse sans production', () => {
    noterProductionSuivie({ date: '2026-10-20', time: '13:00' });
    suivreProductionDuServeur({ production: { date: '2026-10-20', time: '14:10' } });
    suivreProductionDuServeur({ progression: null });
    expect(lireProductionSuivie()).toMatchObject({ time: '13:00' });
  });
});

describe('issue « interrompue » relue de la base', () => {
  it('devient un résultat en échec, et le bouton propose de RELANCER', () => {
    const l = lireProgressionServeur({ progression: null, resultat: { success: false, error: 'Production interrompue…', code: 'interrompue' } });
    expect(l).toMatchObject({ cas: 'resultat', resultat: { code: 'interrompue' } });
    expect(libelleBoutonProduire({ etat: 'erreur', message: 'x', code: 'interrompue' })).toBe('Relancer la production');
  });
  it('le panneau transmet le code d échec et suit un 409 en-cours', () => {
    const panneau = readFileSync(resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf8');
    expect(panneau).toContain("...(typeof data?.code === 'string' ? { code: data.code } : {})");
    expect(panneau).toContain("issue.status === 409 && accepte.code === 'en-cours' && accepte.scheduledDate");
    expect(panneau.match(/suivreProductionDuServeur\(d\)/g)?.length).toBe(2);
  });
});
