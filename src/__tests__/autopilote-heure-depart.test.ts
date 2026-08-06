import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  localHour, isRunHour, decideRun, sanitizeConfig, DEFAULT_CONFIG,
  DEFAULT_RUN_HOUR, DEFAULT_TIMEZONE, type AutopilotConfig,
} from '@/lib/autopilot/rules';

/**
 * L'heure de départ, choisie par chaque utilisateur.
 *
 * ⚠️ DEUX JAUGES, DEUX QUESTIONS. `isRunHour` répond « est-ce l'heure ? »,
 * `isDue` répond « a-t-on assez attendu ? ». Le déclencheur passant désormais
 * TOUTES LES HEURES, sans la première un compte quotidien produirait
 * vingt-quatre fois par jour dès que la cadence le permettrait — la cadence
 * seule ne borne pas la journée, elle borne l'écart entre deux cycles.
 *
 * ⚠️ ET UN FUSEAU INVALIDE NE DOIT PAS INTERROMPRE LE CYCLE. La valeur vient
 * de la base ; `Intl` lève sur un identifiant inconnu. Une saisie fautive
 * bloquerait alors la production de TOUS les comptes traités après elle.
 */

const panneau = readFileSync(resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-06-autopilot-run-hour.sql'), 'utf-8',
);

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
  rushUrls: ['https://cdn.test/a.mp4'], ...p,
});

/** 2026-08-06 à 06:00 UTC = 08:00 à Paris (heure d'été). */
const T_08H_PARIS = Date.parse('2026-08-06T06:00:00.000Z');

describe('L heure locale', () => {
  it('elle est lue dans le fuseau demandé', () => {
    expect(localHour(T_08H_PARIS, 'Europe/Paris')).toBe(8);
    expect(localHour(T_08H_PARIS, 'UTC')).toBe(6);
    expect(localHour(T_08H_PARIS, 'America/New_York')).toBe(2);
  });

  it('un fuseau invalide retombe sur Paris, sans lever', () => {
    expect(() => localHour(T_08H_PARIS, 'Mars/Olympus')).not.toThrow();
    expect(localHour(T_08H_PARIS, 'Mars/Olympus')).toBe(8);
  });

  it('une chaîne vide aussi', () => {
    expect(localHour(T_08H_PARIS, '')).toBe(8);
  });
});

describe('La jauge d heure', () => {
  it('vrai à l heure choisie, faux sinon', () => {
    expect(isRunHour(cfg({ runHour: 8, runTimezone: 'Europe/Paris' }), T_08H_PARIS)).toBe(true);
    expect(isRunHour(cfg({ runHour: 9, runTimezone: 'Europe/Paris' }), T_08H_PARIS)).toBe(false);
  });

  it('elle suit le FUSEAU, pas l heure serveur', () => {
    // Même instant : 8 h à Paris, 2 h à New York.
    expect(isRunHour(cfg({ runHour: 2, runTimezone: 'America/New_York' }), T_08H_PARIS)).toBe(true);
    expect(isRunHour(cfg({ runHour: 8, runTimezone: 'America/New_York' }), T_08H_PARIS)).toBe(false);
  });
});

describe('Le moteur ne produit qu à l heure dite', () => {
  const base = { credits: 500, costPerVideo: 10, now: T_08H_PARIS };

  it('à l heure : il produit', () => {
    const d = decideRun({ ...base, config: cfg({ runHour: 8 }) });
    expect(d.run).toBe(true);
  });

  it('hors de l heure : il passe son tour, en silence', () => {
    const d = decideRun({ ...base, config: cfg({ runHour: 15 }) });
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('pas-l-heure');
  });

  it('le manque de crédits reste prioritaire — il faut le DIRE', () => {
    // Un utilisateur à court doit être prévenu même quand ce n'est pas son
    // heure : sinon il ne l'apprend qu'au prochain cycle.
    const d = decideRun({ ...base, credits: 0, config: cfg({ runHour: 15 }) });
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('credits');
  });

  it('une banque vide aussi', () => {
    const d = decideRun({ ...base, config: cfg({ runHour: 15, rushUrls: [] }) });
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('sans-rush');
  });

  it('la cadence continue de jouer, à l heure venue', () => {
    const d = decideRun({
      ...base,
      config: cfg({ runHour: 8, cadence: 'weekly', lastRunAt: new Date(T_08H_PARIS - 86_400_000).toISOString() }),
    });
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('pas-encore');
  });
});

describe('Rétro-compatibilité', () => {
  it('les défauts reproduisent le cron actuel', () => {
    expect(DEFAULT_CONFIG.runHour).toBe(8);
    expect(DEFAULT_CONFIG.runTimezone).toBe('Europe/Paris');
    expect(DEFAULT_RUN_HOUR).toBe(8);
    expect(DEFAULT_TIMEZONE).toBe('Europe/Paris');
  });

  it('des colonnes absentes valent les défauts', () => {
    // Tant que la migration n'est pas appliquée, PostgREST rend `undefined`.
    const c = sanitizeConfig({});
    expect(c.runHour).toBe(8);
    expect(c.runTimezone).toBe('Europe/Paris');
  });

  it('une heure hors plage est ramenée dans la plage', () => {
    // Hors 0–23, elle ne correspondrait à aucune heure : l'Autopilote ne
    // partirait jamais, sans rien dire.
    expect(sanitizeConfig({ runHour: 99 }).runHour).toBe(23);
    expect(sanitizeConfig({ runHour: -4 }).runHour).toBe(0);
    expect(sanitizeConfig({ runHour: 'midi' }).runHour).toBe(8);
    expect(sanitizeConfig({ runHour: 7.9 }).runHour).toBe(7);
  });

  it('un fuseau vide retombe sur le défaut', () => {
    expect(sanitizeConfig({ runTimezone: '   ' }).runTimezone).toBe('Europe/Paris');
    expect(sanitizeConfig({ runTimezone: 'UTC' }).runTimezone).toBe('UTC');
  });
});

describe('L écran', () => {
  it('propose les 24 heures, et les enregistre', () => {
    expect(panneau).toContain('data-autopilot-hour');
    expect(panneau).toContain('enregistrer({ runHour: Number(e.target.value) })');
    expect(panneau).toContain('Array.from({ length: 24 }');
  });

  it('le récapitulatif annonce l heure choisie, plus « 08:00 » en dur', () => {
    expect(panneau).toContain("['Heure de départ', `${heureLisible(config.runHour)}");
    expect(panneau).not.toContain('chaque jour à 08:00');
  });

  it('le prochain départ cherche l INSTANT, pas l heure', () => {
    // Ajouter « runHour heures » à minuit local supposerait des journées de
    // 24 h : les jours de changement d'heure elles en font 23 ou 25.
    expect(panneau).toContain('for (let i = 0; i < 48 && heureLocale(d) !== runHour');
    expect(panneau).toContain('d.setHours(d.getHours() + 1);');
  });

  it('et il est toujours STRICTEMENT dans le futur', () => {
    expect(panneau).toContain('// Toujours STRICTEMENT dans le futur');
  });
});

describe('La migration', () => {
  it('ajoute les deux colonnes avec les défauts actuels', () => {
    expect(migration).toContain("add column if not exists run_hour smallint not null default 8");
    expect(migration).toContain("run_timezone text not null default 'Europe/Paris'");
  });

  it('et n oublie pas les deux étapes de PostgREST', () => {
    expect(migration).toContain('grant all on table public.autopilot_config to public');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});
