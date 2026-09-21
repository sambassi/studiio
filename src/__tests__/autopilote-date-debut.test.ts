import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sanitizeStartDate, sanitizeConfig, DEFAULT_CONFIG, START_DATE_RE, localDate, isBeforeStartDate,
  decideRun, slotDate, creneauImmediat, statusMessage, ajouterJours,
  type AutopilotConfig,
} from '@/lib/autopilot/rules';
import { preparePosts, toPostRow, slotDate as slotDateMoteur, slotKey } from '@/lib/autopilot/engine';

/**
 * La DATE DE DÉBUT de l'Autopilote, et le créneau d'une production immédiate.
 *
 * ⚠️ TROIS RÉGLAGES, TROIS QUESTIONS. `runHour` dit à quelle heure le moteur
 * PRODUIT, `publishTime` à quelle heure les posts sont PROGRAMMÉS, et
 * `startDate` à partir de QUAND. Deux effets, et deux seulement :
 *
 *   1. `decideRun` refuse de produire AVANT ce jour, lu dans `runTimezone`
 *      (`avant-la-date-de-debut`, silencieux comme `pas-encore`) ;
 *   2. la première publication est programmée AU PLUS TÔT ce jour
 *      (`slotDate` : premier = max(demain, startDate)).
 *
 * Ce que ce fichier verrouille : la forme « YYYY-MM-DD » stricte et VALIDE
 * (« 2026-02-30 » est rejetée, pas corrigée), `null` = dès le prochain
 * passage (le comportement d'avant), les deux effets, les changements
 * d'heure de Paris 2026, le fuseau, et la route de configuration qui ne
 * lit/n'écrit `start_date` que si la colonne existe.
 */

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG,
  enabled: true,
  platforms: ['instagram'],
  rushUrls: ['https://cdn.test/a.mp4', 'https://cdn.test/b.mp4'],
  ...p,
});

/** 2026-08-06 à 06:00 UTC = 08:00 à Paris (heure d'été). */
const T_08H_PARIS = Date.parse('2026-08-06T06:00:00.000Z');

describe('sanitizeStartDate', () => {
  it('accepte une date valide, rognée', () => {
    expect(sanitizeStartDate('2026-10-05')).toBe('2026-10-05');
    expect(sanitizeStartDate('  2026-10-05 ')).toBe('2026-10-05');
    expect(sanitizeStartDate('2028-02-29')).toBe('2028-02-29');
  });

  it('rejette tout le reste — `null`, jamais une date corrigée', () => {
    for (const brut of [
      '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29',
      '05/10/2026', '2026-10-5', '20261005', '2026-10-05T00:00:00Z', '', null, undefined, 20261005, {},
    ]) {
      expect(sanitizeStartDate(brut), String(brut)).toBeNull();
    }
  });

  it('la forme est celle du champ `date` et de la colonne `date`', () => {
    expect(START_DATE_RE.test('2026-10-05')).toBe(true);
    expect(START_DATE_RE.test('2026-10-5')).toBe(false);
  });
});

describe('La configuration', () => {
  it('n a pas de date de début par défaut — dès le prochain passage, comme avant', () => {
    expect(DEFAULT_CONFIG.startDate).toBeNull();
    expect(sanitizeConfig({}).startDate).toBeNull();
    expect(sanitizeConfig({ startDate: undefined }).startDate).toBeNull();
    expect(sanitizeConfig({ startDate: '' }).startDate).toBeNull();
  });

  it('conserve une date valide à l aller-retour, jette une date invalide', () => {
    expect(sanitizeConfig({ startDate: '2026-10-05' }).startDate).toBe('2026-10-05');
    expect(sanitizeConfig(sanitizeConfig({ startDate: '2026-10-05' })).startDate).toBe('2026-10-05');
    expect(sanitizeConfig({ startDate: '2026-02-30' }).startDate).toBeNull();
  });
});

describe('La date locale', () => {
  it('se lit dans le fuseau demandé', () => {
    // 2026-08-04 à 23:30 UTC : déjà le 5 à Paris et à Kiritimati, encore le 4 à Honolulu.
    const t = Date.parse('2026-08-04T23:30:00.000Z');
    expect(localDate(t, 'Europe/Paris')).toBe('2026-08-05');
    expect(localDate(t, 'Pacific/Kiritimati')).toBe('2026-08-05');
    expect(localDate(t, 'Pacific/Honolulu')).toBe('2026-08-04');
    expect(localDate(t, 'UTC')).toBe('2026-08-04');
  });

  it('un fuseau illisible retombe sur Paris, sans lever', () => {
    const t = Date.parse('2026-08-04T23:30:00.000Z');
    expect(() => localDate(t, 'Mars/Olympus')).not.toThrow();
    expect(localDate(t, 'Mars/Olympus')).toBe('2026-08-05');
    expect(localDate(t, '')).toBe('2026-08-05');
  });

  it('ajouterJours passe les mois, les années et les jours de changement d heure', () => {
    expect(ajouterJours('2026-08-31', 1)).toBe('2026-09-01');
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(ajouterJours('2026-03-28', 1)).toBe('2026-03-29');
    expect(ajouterJours('2026-10-24', 2)).toBe('2026-10-26');
    expect(ajouterJours('2026-10-05', 0)).toBe('2026-10-05');
  });
});

describe('Le moteur refuse de produire AVANT la date de début', () => {
  const base = { credits: 500, costPerVideo: 10, now: T_08H_PARIS };

  it('la veille, même à l heure : il passe son tour, en silence', () => {
    const d = decideRun({ ...base, config: cfg({ runHour: 8, startDate: '2026-08-07' }) });
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('avant-la-date-de-debut');
  });

  it('le jour dit : il produit', () => {
    expect(decideRun({ ...base, config: cfg({ runHour: 8, startDate: '2026-08-06' }) }).run).toBe(true);
  });

  it('une date passée ne change rien', () => {
    expect(decideRun({ ...base, config: cfg({ runHour: 8, startDate: '2026-01-01' }) }).run).toBe(true);
  });

  it('sans date : comme avant', () => {
    expect(decideRun({ ...base, config: cfg({ runHour: 8, startDate: null }) }).run).toBe(true);
  });

  it('le JOUR se lit dans le fuseau de l utilisateur, pas en UTC', () => {
    // 2026-08-06 à 22:30 UTC : encore le 6 à Honolulu (12:30), déjà le 7 à Paris (00:30).
    const t = Date.parse('2026-08-06T22:30:00.000Z');
    expect(isBeforeStartDate({ startDate: '2026-08-07', runTimezone: 'Pacific/Honolulu' }, t)).toBe(true);
    expect(isBeforeStartDate({ startDate: '2026-08-07', runTimezone: 'Europe/Paris' }, t)).toBe(false);
  });

  it('le manque de crédits et la banque vide restent prioritaires — il faut le DIRE', () => {
    const avant = cfg({ runHour: 8, startDate: '2026-09-01' });
    const c = decideRun({ ...base, credits: 0, config: avant });
    if (!c.run) expect(c.reason).toBe('credits');
    const r = decideRun({ ...base, config: { ...avant, rushUrls: [] } });
    if (!r.run) expect(r.reason).toBe('sans-rush');
  });

  it('et la date passe AVANT l heure : un refus silencieux, pas deux', () => {
    const d = decideRun({ ...base, config: cfg({ runHour: 15, startDate: '2026-09-01' }) });
    if (!d.run) expect(d.reason).toBe('avant-la-date-de-debut');
  });

  it('le message d état annonce la date plutôt que « au prochain passage »', () => {
    const m = statusMessage(cfg({ startDate: '2026-09-01' }), T_08H_PARIS, (d) => d.toISOString().slice(0, 10));
    expect(m).toContain('à partir du 2026-09-01');
    expect(statusMessage(cfg({ startDate: '2026-01-01' }), T_08H_PARIS, String)).toContain('au prochain passage');
  });
});

describe('La première publication part AU PLUS TÔT le jour de début', () => {
  // 2026-08-04 à 09:00 UTC = 11:00 à Paris.
  const T0 = Date.parse('2026-08-04T09:00:00.000Z');

  it('la règle : premier = max(demain, startDate), puis un jour par montage', () => {
    // Date de début à venir : on part d'elle.
    expect(slotDate(new Date(T0), 0, 'Europe/Paris', '2026-08-10')).toBe('2026-08-10');
    expect(slotDate(new Date(T0), 1, 'Europe/Paris', '2026-08-10')).toBe('2026-08-11');
    expect(slotDate(new Date(T0), 2, 'Europe/Paris', '2026-08-10')).toBe('2026-08-12');
  });

  it('une date de début passée, ou égale à aujourd hui ou à demain, ne change rien', () => {
    for (const debut of ['2026-01-01', '2026-08-04', '2026-08-05']) {
      expect(slotDate(new Date(T0), 0, 'Europe/Paris', debut), debut).toBe('2026-08-05');
    }
  });

  it('sans date de début : demain, exactement comme avant', () => {
    expect(slotDate(new Date(T0), 0, 'Europe/Paris', null)).toBe('2026-08-05');
    expect(slotDate(new Date(T0), 0, 'Europe/Paris', undefined)).toBe('2026-08-05');
    expect(slotDate(new Date(T0), 0, 'Europe/Paris')).toBe('2026-08-05');
    // Une date illisible vaut « pas de date ».
    expect(slotDate(new Date(T0), 0, 'Europe/Paris', '2026-02-30')).toBe('2026-08-05');
  });

  it('« demain » se lit toujours dans le fuseau de l utilisateur', () => {
    const t = Date.parse('2026-08-04T23:30:00.000Z');
    expect(slotDate(new Date(t), 0, 'Pacific/Kiritimati')).toBe('2026-08-06');
    expect(slotDate(new Date(t), 0, 'Pacific/Honolulu')).toBe('2026-08-05');
    // Et la date de début compare des JOURS : à Kiritimati le 6 est déjà
    // demain, donc « 2026-08-06 » ne décale rien.
    expect(slotDate(new Date(t), 0, 'Pacific/Kiritimati', '2026-08-06')).toBe('2026-08-06');
    expect(slotDate(new Date(t), 0, 'Pacific/Honolulu', '2026-08-06')).toBe('2026-08-06');
  });

  it('le passage à l heure d été de Paris (dimanche 2026-03-29, 23 h) ne décale rien', () => {
    // Vendredi 27 mars, 10:00 à Paris ; date de début le dimanche du changement.
    const t = Date.parse('2026-03-27T09:00:00.000Z');
    expect(slotDate(new Date(t), 0, 'Europe/Paris', '2026-03-29')).toBe('2026-03-29');
    expect(slotDate(new Date(t), 1, 'Europe/Paris', '2026-03-29')).toBe('2026-03-30');
    expect(slotDate(new Date(t), 2, 'Europe/Paris', '2026-03-29')).toBe('2026-03-31');
    // Et une date de début la VEILLE du changement : le n-ième traverse le saut.
    expect(slotDate(new Date(t), 1, 'Europe/Paris', '2026-03-28')).toBe('2026-03-29');
    expect(slotDate(new Date(t), 2, 'Europe/Paris', '2026-03-28')).toBe('2026-03-30');
    // Le jour même du changement, 01:30 à Paris, avant le saut : demain = 30.
    const ete = Date.parse('2026-03-29T00:30:00.000Z');
    expect(slotDate(new Date(ete), 0, 'Europe/Paris', '2026-03-29')).toBe('2026-03-30');
  });

  it('le retour à l heure d hiver de Paris (dimanche 2026-10-25, 25 h) non plus', () => {
    const t = Date.parse('2026-10-23T09:00:00.000Z');
    expect(slotDate(new Date(t), 0, 'Europe/Paris', '2026-10-25')).toBe('2026-10-25');
    expect(slotDate(new Date(t), 1, 'Europe/Paris', '2026-10-25')).toBe('2026-10-26');
    expect(slotDate(new Date(t), 7, 'Europe/Paris', '2026-10-25')).toBe('2026-11-01');
    expect(slotDate(new Date(t), 1, 'Europe/Paris', '2026-10-24')).toBe('2026-10-25');
    // Le jour du changement, 02:30 heure d'hiver (01:30 UTC), après le retour : demain = 26.
    const hiver = Date.parse('2026-10-25T01:30:00.000Z');
    expect(slotDate(new Date(hiver), 0, 'Europe/Paris', '2026-10-25')).toBe('2026-10-26');
  });

  it('preparePosts transmet la date de début, et le jeton la porte', () => {
    const c = cfg({ startDate: '2026-08-10', publishTime: '18:45' });
    const p = preparePosts({ config: c, topic: 'yoga', count: 2, now: T0 });
    expect(p.map((x) => x.scheduledDate)).toEqual(['2026-08-10', '2026-08-11']);
    expect(p.map((x) => x.scheduledTime)).toEqual(['18:45', '18:45']);
    const row = toPostRow({ userId: 'u1', post: p[0], config: c, videoUrl: 'https://cdn.test/r.mp4', metadata: {} });
    expect(row.scheduled_date).toBe('2026-08-10');
    expect(row.metadata.slotKey).toBe(slotKey('u1', '2026-08-10', '18:45'));
  });

  it('sans date de début, preparePosts programme demain — rien ne change pour l existant', () => {
    const p = preparePosts({ config: cfg(), topic: 'yoga', count: 1, now: T0 });
    expect(p[0].scheduledDate).toBe('2026-08-05');
  });

  it('le moteur réexporte la MÊME fonction que les règles', () => {
    expect(slotDateMoteur).toBe(slotDate);
  });

  it('toPostRow accepte un jeton de créneau imposé — et garde le sien sinon', () => {
    const c = cfg();
    const post = preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 })[0];
    const impose = toPostRow({ userId: 'u1', post, config: c, videoUrl: 'https://x/r.mp4', metadata: {}, slotKey: 'manuel:u1|2026-08-04|11:05' });
    expect(impose.metadata.slotKey).toBe('manuel:u1|2026-08-04|11:05');
    const defaut = toPostRow({ userId: 'u1', post, config: c, videoUrl: 'https://x/r.mp4', metadata: {} });
    expect(defaut.metadata.slotKey).toBe(slotKey('u1', post.scheduledDate, post.scheduledTime));
  });
});

describe('Le créneau d une production immédiate', () => {
  it('« aujourd hui, maintenant + 5 min arrondi aux 5 min », chez l utilisateur', () => {
    // 2026-08-04 à 09:02 UTC = 11:02 à Paris → 11:10 (09:07 arrondi au-dessus).
    const t = Date.parse('2026-08-04T09:02:00.000Z');
    expect(creneauImmediat(t, 'Europe/Paris')).toEqual({ date: '2026-08-04', time: '11:10' });
    expect(creneauImmediat(t, 'UTC')).toEqual({ date: '2026-08-04', time: '09:10' });
    expect(creneauImmediat(t, 'America/New_York')).toEqual({ date: '2026-08-04', time: '05:10' });
  });

  it('les minutes sont exactes dans un fuseau à décalage non entier', () => {
    // Kolkata = UTC+5:30 : 09:02 UTC → 14:32 → arrondi 14:40.
    const t = Date.parse('2026-08-04T09:02:00.000Z');
    expect(creneauImmediat(t, 'Asia/Kolkata')).toEqual({ date: '2026-08-04', time: '14:40' });
  });

  it('deux clics dans la même fenêtre tombent sur le MÊME créneau', () => {
    const t = Date.parse('2026-08-04T09:02:00.000Z');
    expect(creneauImmediat(t, 'Europe/Paris')).toEqual(creneauImmediat(t + 90_000, 'Europe/Paris'));
  });

  it('passe minuit en changeant de date', () => {
    // 23:57 à Paris le 4 août = 21:57 UTC → +5 = 22:02 → arrondi 22:05 UTC = 00:05 le 5 à Paris.
    const t = Date.parse('2026-08-04T21:57:00.000Z');
    expect(creneauImmediat(t, 'Europe/Paris')).toEqual({ date: '2026-08-05', time: '00:05' });
  });

  it('la forme est celle de `scheduled_time` — « HH:MM »', () => {
    const { time } = creneauImmediat(Date.now(), 'Europe/Paris');
    expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// La route de configuration : `start_date` lue et écrite SEULEMENT si la
// colonne existe — sinon l'upsert entier échouerait.
// ───────────────────────────────────────────────────────────────────────────

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let colonnesConnues: Set<string>;
let ligneEnBase: Record<string, unknown> | null;
const upserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'autopilot_config') throw new Error(`table inattendue : ${table}`);
    let selection = '';
    const chaine = {
      select(cols: string) { selection = cols; return chaine; },
      eq() { return chaine; },
      async limit() {
        if (selection !== '*' && selection !== 'id' && !colonnesConnues.has(selection)) {
          return { data: null, error: { message: `column autopilot_config.${selection} does not exist` } };
        }
        return { data: ligneEnBase ? [ligneEnBase] : [], error: null };
      },
      async upsert(valeurs: Record<string, unknown>) {
        for (const k of Object.keys(valeurs)) {
          if (!['user_id', 'updated_at'].includes(k) && !colonnesConnues.has(k)) {
            return { error: { message: `column "${k}" of relation "autopilot_config" does not exist` } };
          }
        }
        upserts.push(valeurs);
        return { error: null };
      },
    };
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

const COLONNES_DE_BASE = [
  'enabled', 'mode', 'cadence', 'count_per_cycle', 'platforms', 'credit_floor', 'voice_enabled',
  'topics', 'run_hour', 'run_timezone', 'rush_urls',
  'card_gradient_start', 'card_gradient_end', 'title_color', 'cards_show_poster', 'music_url',
  'voice_id', 'keep_rush_audio', 'music_volume', 'voice_volume', 'rush_volume',
  'design_style', 'poster_urls', 'poster_mode', 'publish_time',
];

async function chargerRoute() {
  vi.resetModules();
  return import('@/app/api/autopilot/config/route');
}

function requetePut(corps: unknown) {
  return new Request('http://test/api/autopilot/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  }) as unknown as import('next/server').NextRequest;
}

describe('La route de configuration', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    upserts.length = 0;
    ligneEnBase = null;
  });

  it('lit start_date quand la colonne existe, et dit qu elle est enregistrable', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'start_date']);
    ligneEnBase = { user_id: 'u1', mode: 'review', start_date: '2026-10-05', run_hour: 8 };
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.success).toBe(true);
    expect(corps.startDateReady).toBe(true);
    expect(corps.config.startDate).toBe('2026-10-05');
  });

  it('sans la colonne : `null`, et l écran est prévenu', async () => {
    colonnesConnues = new Set(COLONNES_DE_BASE);
    ligneEnBase = { user_id: 'u1', mode: 'review', run_hour: 8 };
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.startDateReady).toBe(false);
    expect(corps.config.startDate).toBeNull();
  });

  it('écrit start_date quand la colonne existe — et `null` pour l effacer', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'start_date']);
    const { PUT } = await chargerRoute();
    const corps = await (await PUT(requetePut({ ...cfg(), startDate: '2026-10-05' }))).json();
    expect(corps.success).toBe(true);
    expect(corps.startDateReady).toBe(true);
    expect(upserts[0].start_date).toBe('2026-10-05');
    await PUT(requetePut({ ...cfg(), startDate: null }));
    expect(upserts[1].start_date).toBeNull();
  });

  it('une date invalide est écrite `null`, pas refusée ni corrigée', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'start_date']);
    const { PUT } = await chargerRoute();
    await PUT(requetePut({ ...cfg(), startDate: '2026-02-30' }));
    expect(upserts[0].start_date).toBeNull();
  });

  it('sans la colonne : l upsert OMET start_date et réussit quand même', async () => {
    colonnesConnues = new Set(COLONNES_DE_BASE);
    const { PUT } = await chargerRoute();
    const corps = await (await PUT(requetePut({ ...cfg(), startDate: '2026-10-05' }))).json();
    expect(corps.success).toBe(true);
    expect(corps.startDateReady).toBe(false);
    expect(upserts).toHaveLength(1);
    expect('start_date' in upserts[0]).toBe(false);
    // Le reste est bien écrit.
    expect(upserts[0].run_hour).toBe(8);
  });
});

describe('La migration', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../migrations/2026-09-21-autopilot-start-date.sql'), 'utf-8',
  );

  it('ajoute la colonne, NULLE par défaut — aucune configuration existante ne change', () => {
    expect(migration).toContain('add column if not exists start_date date null');
  });

  it('et n oublie pas les deux étapes de PostgREST', () => {
    expect(migration).toContain('grant all on table public.autopilot_config to public');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});
