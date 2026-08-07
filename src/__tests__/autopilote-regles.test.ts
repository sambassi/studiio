import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  decideRun, isDue, nextRunAt, statusForMode, pickRush, sanitizeConfig, statusMessage,
  DEFAULT_CONFIG, DEFAULT_CREDIT_FLOOR, MAX_PER_CYCLE, CADENCE_DAYS,
  type AutopilotConfig,
} from '@/lib/autopilot/rules';

/**
 * Autopilote — les règles, avant le moteur.
 *
 * Ce lot livre la configuration ; le moteur récurrent suit. Les règles sont
 * écrites d'abord parce qu'elles fixent le contrat qu'il devra respecter — et
 * parce qu'elles décident de choses qui, autrement, ne se constateraient qu'en
 * production : un cron qui génère trop souvent, ou qui vide un solde.
 *
 * Deux décisions valent d'être lues :
 *
 * 1. **Le défaut est « me laisser valider ».** Publier sans demander ne se
 *    rattrape pas.
 * 2. **Le solde est vérifié AVANT la cadence.** Un utilisateur à court de
 *    crédits doit l'apprendre même le jour où il n'était de toute façon pas
 *    temps de générer — sinon il ne le découvre qu'au cycle suivant, une
 *    semaine plus tard, devant un calendrier vide.
 */

const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-04-autopilot-config.sql'),
  'utf-8',
);
const route = readFileSync(resolve(__dirname, '../app/api/autopilot/config/route.ts'), 'utf-8');
const panneau = readFileSync(resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const JOUR = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-08-04T09:00:00.000Z');

/**
 * ⚠️ `runHour` EST CALÉE SUR `T0`. Depuis que le déclencheur passe toutes les
 * heures, `decideRun` refuse hors de l'heure choisie (`pas-l-heure`). Ces
 * tests portent sur les crédits, le plancher et la cadence : sans ce calage,
 * ils échoueraient sur une jauge qu'ils n'examinent pas. `T0` vaut 09:00 UTC,
 * soit 11:00 à Paris.
 */
const HEURE_DE_T0 = 11;

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG,
  enabled: true,
  rushUrls: ['https://cdn.test/a.mp4'],
  runHour: HEURE_DE_T0,
  ...p,
});

describe('Le défaut protège l utilisateur', () => {
  it('l Autopilote est éteint tant qu on ne l allume pas', () => {
    expect(DEFAULT_CONFIG.enabled).toBe(false);
    expect(decideRun({ config: DEFAULT_CONFIG, credits: 9999, costPerVideo: 10, now: T0 }))
      .toEqual({ run: false, reason: 'desactive' });
  });

  it('le mode par défaut LAISSE LA MAIN', () => {
    // Publier sans demander ne se rattrape pas.
    expect(DEFAULT_CONFIG.mode).toBe('review');
    expect(statusForMode('review')).toBe('draft');
    expect(statusForMode('auto')).toBe('scheduled');
  });

  it('un plancher de crédits existe par défaut', () => {
    expect(DEFAULT_CREDIT_FLOOR).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.creditFloor).toBe(DEFAULT_CREDIT_FLOOR);
  });
});

describe('La cadence', () => {
  it('un compte qui n a jamais tourné est dû immédiatement', () => {
    expect(isDue('weekly', null, T0)).toBe(true);
    expect(nextRunAt('weekly', null, T0).getTime()).toBe(T0);
  });

  it('respecte l intervalle de chaque cadence', () => {
    for (const [cadence, jours] of Object.entries(CADENCE_DAYS)) {
      const dernier = new Date(T0).toISOString();
      const c = cadence as keyof typeof CADENCE_DAYS;
      expect(isDue(c, dernier, T0 + jours * JOUR - 1000), c).toBe(false);
      expect(isDue(c, dernier, T0 + jours * JOUR), c).toBe(true);
    }
  });

  it('une date de dernier passage illisible ne bloque pas la production', () => {
    // Bloquer indéfiniment sur une valeur abîmée serait pire que de générer.
    expect(isDue('weekly', 'pas-une-date', T0)).toBe(true);
    expect(isDue('weekly', '', T0)).toBe(true);
  });
});

describe('Le solde passe AVANT la cadence', () => {
  it('un solde sous le plancher refuse, même si ce n était pas l heure', () => {
    // Le motif renvoyé est « credits » et non « pas-encore » : c'est lui qui
    // permet de prévenir l'utilisateur au lieu de le laisser découvrir un
    // calendrier vide une semaine plus tard.
    const d = decideRun({
      config: cfg({ creditFloor: 50, lastRunAt: new Date(T0).toISOString() }),
      credits: 40, costPerVideo: 10, now: T0 + 60_000,
    });
    expect(d).toEqual({ run: false, reason: 'credits' });
  });

  it('le plancher est un plancher : il faut pouvoir payer AU-DESSUS', () => {
    // 50 crédits pile avec un plancher à 50, c'est zéro disponible.
    expect(decideRun({ config: cfg({ creditFloor: 50 }), credits: 50, costPerVideo: 10, now: T0 }))
      .toEqual({ run: false, reason: 'credits' });
    expect(decideRun({ config: cfg({ creditFloor: 50 }), credits: 60, costPerVideo: 10, now: T0 }))
      .toMatchObject({ run: true });
  });

  it('le nombre est ramené à ce que le solde permet', () => {
    // Générer trois montages avec de quoi en payer un laisserait deux échecs
    // et un solde à zéro.
    const d = decideRun({
      config: cfg({ countPerCycle: 3, creditFloor: 50 }),
      credits: 70, costPerVideo: 10, now: T0,
    });
    expect(d).toMatchObject({ run: true, count: 2 });
  });

  it('un coût nul ou aberrant ne fait pas générer à l infini', () => {
    const d = decideRun({ config: cfg({ countPerCycle: 5 }), credits: 60, costPerVideo: 0, now: T0 });
    expect(d).toMatchObject({ run: true });
    if (d.run) expect(d.count).toBeLessThanOrEqual(MAX_PER_CYCLE);
  });
});

describe('La banque de rushes', () => {
  it('sans rush, on ne génère pas — et on dit pourquoi', () => {
    expect(decideRun({ config: cfg({ rushUrls: [] }), credits: 999, costPerVideo: 10, now: T0 }))
      .toEqual({ run: false, reason: 'sans-rush' });
  });

  it('sauf si l appelant l autorise explicitement', () => {
    expect(decideRun({
      config: cfg({ rushUrls: [] }), credits: 999, costPerVideo: 10, now: T0, allowWithoutRush: true,
    })).toMatchObject({ run: true });
  });

  it('la rotation évite de reprendre le rush précédent', () => {
    // Deux montages d'affilée sur la même image, c'est ce que la banque
    // existe pour éviter.
    const rushes = ['a', 'b', 'c'];
    expect(pickRush(rushes, 'a')).toBe('b');
    expect(pickRush(rushes, 'c')).toBe('a');
  });

  it('elle avance d un cran par montage du cycle', () => {
    const rushes = ['a', 'b', 'c'];
    expect(pickRush(rushes, 'a', 0)).toBe('b');
    expect(pickRush(rushes, 'a', 1)).toBe('c');
    expect(pickRush(rushes, 'a', 2)).toBe('a');
  });

  it('avec un seul rush, on le reprend — mieux que rien', () => {
    expect(pickRush(['seul'], 'seul')).toBe('seul');
  });

  it('sans rush exploitable, elle rend null', () => {
    expect(pickRush([], null)).toBeNull();
    expect(pickRush(['', null as never], null)).toBeNull();
  });

  it('un dernier rush disparu de la banque ne bloque pas la rotation', () => {
    expect(pickRush(['a', 'b'], 'supprime')).toBe('a');
  });
});

describe('sanitizeConfig', () => {
  it('rejette une cadence ou un mode inconnus', () => {
    const c = sanitizeConfig({ cadence: 'toutes-les-heures', mode: 'sauvage' });
    expect(c.cadence).toBe(DEFAULT_CONFIG.cadence);
    expect(c.mode).toBe(DEFAULT_CONFIG.mode);
  });

  it('borne le nombre par cycle', () => {
    expect(sanitizeConfig({ countPerCycle: 99 }).countPerCycle).toBe(MAX_PER_CYCLE);
    expect(sanitizeConfig({ countPerCycle: 0 }).countPerCycle).toBe(1);
    expect(sanitizeConfig({ countPerCycle: -3 }).countPerCycle).toBe(1);
    expect(sanitizeConfig({ countPerCycle: 'trois' }).countPerCycle).toBe(1);
  });

  it('refuse un plancher négatif — il autoriserait un solde négatif', () => {
    expect(sanitizeConfig({ creditFloor: -10 }).creditFloor).toBe(DEFAULT_CREDIT_FLOOR);
    expect(sanitizeConfig({ creditFloor: 0 }).creditFloor).toBe(0);
    expect(sanitizeConfig({ creditFloor: 999999 }).creditFloor).toBe(10_000);
  });

  it('ne garde que des rushes en http(s), dédoublonnés', () => {
    const c = sanitizeConfig({
      rushUrls: ['https://a/1.mp4', 'https://a/1.mp4', 'blob:http://x/y', '', 42],
    });
    expect(c.rushUrls).toEqual(['https://a/1.mp4']);
  });

  it('« activé » exige un vrai booléen', () => {
    // `'false'` venu d'un formulaire ne doit pas allumer l'Autopilote.
    expect(sanitizeConfig({ enabled: 'true' }).enabled).toBe(false);
    expect(sanitizeConfig({ enabled: true }).enabled).toBe(true);
  });

  it('une entrée aberrante rend la configuration par défaut', () => {
    for (const v of [null, undefined, 'nope', 42]) {
      expect(sanitizeConfig(v).mode, JSON.stringify(v)).toBe(DEFAULT_CONFIG.mode);
    }
  });
});

describe('Le message d état dit ce qui manque', () => {
  it('en pause, il le dit', () => {
    expect(statusMessage(cfg({ enabled: false }), T0, String)).toContain('En pause');
  });

  it('actif sans rush, il réclame des rushes plutôt que de mentir', () => {
    expect(statusMessage(cfg({ rushUrls: [] }), T0, String)).toContain('aucun rush');
  });

  it('actif, il annonce la prochaine génération et le nombre de rushes', () => {
    const m = statusMessage(
      cfg({ rushUrls: ['a', 'b'], lastRunAt: new Date(T0).toISOString(), cadence: 'weekly' }),
      T0 + JOUR,
      () => 'lundi 11 août',
    );
    expect(m).toContain('lundi 11 août');
    expect(m).toContain('2 rushes');
  });
});

describe('La table', () => {
  it('elle est NOUVELLE — aucune table existante modifiée', () => {
    expect(migration).toContain('create table if not exists autopilot_config');
    expect(migration).not.toMatch(/alter table/i);
    expect(migration).not.toMatch(/drop table/i);
  });

  it('le défaut en base est aussi « review »', () => {
    // Un défaut de base qui publierait, alors que l'écran annonce le
    // contraire, publierait dans le dos de l'utilisateur.
    expect(migration).toContain("mode text not null default 'review'");
  });

  it('elle porte le grant et le rappel du rechargement', () => {
    expect(migration).toContain('grant all on table public.autopilot_config to public;');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });

  it('une seule configuration par utilisateur, et cascade à la suppression', () => {
    expect(migration).toContain('create unique index if not exists autopilot_config_user_id_key');
    expect(migration).toContain('references users(id) on delete cascade');
  });

  it('le moteur pourra balayer les comptes actifs sans lire toute la table', () => {
    expect(migration).toContain('autopilot_config_enabled_idx');
  });
});

describe('La route de configuration', () => {
  it('elle valide à l écriture avec le MÊME code qu à la lecture', () => {
    // Une valeur refusée à l'écriture ne peut donc pas être acceptée à la
    // lecture, ni l'inverse.
    expect(route).toContain('const propre = sanitizeConfig(await req.json()');
    expect(route).toContain('return sanitizeConfig({');
  });

  it('l écran ne peut PAS réécrire ce qui appartient au moteur', () => {
    // Remettre `last_run_at` à zéro relancerait une génération en boucle.
    const put = route.slice(route.indexOf('export async function PUT'));
    expect(put).not.toContain('last_run_at:');
    expect(put).not.toContain('last_rush_url:');
  });

  it('sans migration, la lecture reste utilisable et l écriture refuse', () => {
    // ⚠️ ON VERIFIE LA REPONSE, PAS SA MISE EN PAGE. `brandingReady` s'y est
    // ajoute et la ligne a ete coupee : l'ancienne comparaison au caractere
    // pres tombait sans qu'aucun comportement n'ait change.
    const lectureDegradee = route.slice(route.indexOf('if (!(await storeReady()))'));
    expect(lectureDegradee).toContain('success: true');
    expect(lectureDegradee).toContain('ready: false');
    expect(lectureDegradee).toContain('config: DEFAULT_CONFIG');
    expect(route).toContain('la migration autopilot_config n’a pas été appliquée');
  });

  it('les deux verbes exigent une session', () => {
    expect(route.split("{ success: false, error: 'Unauthorized' }, { status: 401 }").length - 1).toBe(2);
  });
});

describe('L écran', () => {
  it('la carte n annonce plus un bouton mort', () => {
    expect(wizard).toContain('<AutopilotPanel accent={accent} />');
    expect(wizard).not.toContain('<Button variant="secondary" size="sm" disabled aria-disabled="true" className={DISABLED}>\n                      Activer');
  });

  it('il calcule son état avec les règles du MOTEUR', () => {
    // Une seconde estimation finirait par ne plus dire la même chose que la
    // décision réelle.
    expect(panneau).toContain("from '@/lib/autopilot/rules'");
    expect(panneau).toContain('statusMessage(config, Date.now()');
  });

  it('il envoie la valeur du clic, pas celle d avant', () => {
    // Un `setState` n'est pas visible dans la même tâche : lire l'état
    // enverrait la valeur précédente.
    expect(panneau).toContain('const suivant = sanitizeConfig({ ...config, ...patch });');
  });

  it('il dit quand la migration manque, au lieu d un formulaire sans effet', () => {
    expect(panneau).toContain('la migration');
    expect(panneau).toContain('disabled={!ready || saving}');
  });

  it('les libellés viennent du module, jamais recopiés', () => {
    expect(panneau).toContain('{MODE_LABELS[m]}');
    expect(panneau).toContain('{CADENCE_LABELS[c]}');
  });

  it('des icônes lucide, jamais un emoji', () => {
    expect(panneau).toContain("from 'lucide-react'");
    expect(panneau).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
