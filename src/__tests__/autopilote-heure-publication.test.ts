import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sanitizePublishTime, sanitizeConfig, DEFAULT_CONFIG, DEFAULT_PUBLISH_TIME, PUBLISH_TIME_RE,
  intentionDiffusion, patchPourIntention, statusForMode, INTENTIONS, INTENTION_MODE,
  INTENTION_LABELS, MODE_LABELS, MODE_HINTS,
  type AutopilotConfig,
} from '@/lib/autopilot/rules';
import { preparePosts, toPostRow, slotDate, slotKey, DEFAULT_SLOT_TIME } from '@/lib/autopilot/engine';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';

/**
 * L'heure de PUBLICATION de l'Autopilote — à la minute, dans le fuseau de
 * l'utilisateur — et les trois intentions de diffusion.
 *
 * ⚠️ DEUX HEURES QUI N'EN FAISAIENT QU'UNE À L'ÉCRAN. `runHour` (entier) dit
 * quand le moteur PRODUIT ; la publication des posts produits était écrite
 * 18:00 EN DUR (`DEFAULT_SLOT_TIME`), le lendemain, à la date locale du
 * SERVEUR, sans fuseau dans les métadonnées — donc relue par le cron de
 * publication comme une heure de Paris. L'écran, lui, annonçait « chaque
 * jour à 08:00 … publiée automatiquement ».
 *
 * Ce que ce fichier verrouille :
 * - `publishTime` « HH:MM » strict, minutes conservées, 18:00 par défaut ;
 * - le moteur l'écrit dans `scheduled_time` ET dans le jeton de créneau ;
 * - « demain » se lit dans `runTimezone`, y compris un jour de changement
 *   d'heure ; les métadonnées portent le fuseau que le cron relit ;
 * - la route de configuration ne lit/n'écrit `publish_time` que si la
 *   colonne existe, et le dit ;
 * - trois intentions ↔ `(mode, platforms)`, sans nouveau statut.
 */

const T0 = Date.parse('2026-08-04T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG,
  enabled: true,
  platforms: ['instagram'],
  rushUrls: ['https://cdn.test/a.mp4', 'https://cdn.test/b.mp4'],
  ...p,
});

describe('sanitizePublishTime', () => {
  it('conserve les minutes telles quelles', () => {
    expect(sanitizePublishTime('18:45')).toBe('18:45');
    expect(sanitizePublishTime('19:15')).toBe('19:15');
    expect(sanitizePublishTime('00:00')).toBe('00:00');
    expect(sanitizePublishTime('23:59')).toBe('23:59');
    expect(sanitizePublishTime('  07:05 ')).toBe('07:05');
  });

  it('retombe sur 18:00 — la valeur qui était en dur — pour tout le reste', () => {
    expect(DEFAULT_PUBLISH_TIME).toBe('18:00');
    for (const brut of ['18h', '25:00', '18:60', '8:00', '18:00:00', '', null, undefined, 1845, {}]) {
      expect(sanitizePublishTime(brut), String(brut)).toBe('18:00');
    }
  });

  it('la forme est celle que le cron compare — « HH:MM », 24 h', () => {
    expect(PUBLISH_TIME_RE.test('18:45')).toBe(true);
    expect(PUBLISH_TIME_RE.test('24:00')).toBe(false);
  });
});

describe('La configuration', () => {
  it('porte l heure de publication, 18:00 par défaut', () => {
    expect(DEFAULT_CONFIG.publishTime).toBe('18:00');
  });

  it('une colonne absente vaut le défaut — aucune configuration existante ne change de créneau', () => {
    expect(sanitizeConfig({}).publishTime).toBe('18:00');
    expect(sanitizeConfig({ publishTime: undefined }).publishTime).toBe('18:00');
  });

  it('les minutes survivent à l aller-retour', () => {
    expect(sanitizeConfig({ publishTime: '18:45' }).publishTime).toBe('18:45');
    expect(sanitizeConfig(sanitizeConfig({ publishTime: '19:15' })).publishTime).toBe('19:15');
  });

  it('une valeur illisible est ramenée au défaut, sans lever', () => {
    expect(sanitizeConfig({ publishTime: '18h30' }).publishTime).toBe('18:00');
  });
});

describe('Le moteur', () => {
  it('écrit l heure choisie, minutes comprises, dans scheduled_time', () => {
    const p = preparePosts({ config: cfg({ publishTime: '18:45' }), topic: 'yoga', count: 2, now: T0 });
    expect(p.map((x) => x.scheduledTime)).toEqual(['18:45', '18:45']);
  });

  it('sans champ (ancienne configuration), 18:00 — le comportement d avant', () => {
    const sans = { ...cfg() } as Record<string, unknown>;
    delete sans.publishTime;
    const p = preparePosts({ config: sans as unknown as AutopilotConfig, topic: 'yoga', count: 1, now: T0 });
    expect(p[0].scheduledTime).toBe(DEFAULT_SLOT_TIME);
    expect(DEFAULT_SLOT_TIME).toBe(DEFAULT_PUBLISH_TIME);
  });

  it('le jeton de créneau porte l heure choisie — un changement d heure est un nouveau créneau', () => {
    const c = cfg({ publishTime: '18:45' });
    const post = preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 })[0];
    const row = toPostRow({
      userId: 'u1', post, config: c, videoUrl: 'https://cdn.test/r.mp4', metadata: {},
    });
    expect(row.scheduled_time).toBe('18:45');
    expect(row.metadata.slotKey).toBe(slotKey('u1', post.scheduledDate, '18:45'));
    expect(String(row.metadata.slotKey)).toContain('|18:45');
  });

  it('le statut suit toujours le mode — aucun statut nouveau', () => {
    expect(statusForMode('auto')).toBe('scheduled');
    expect(statusForMode('review')).toBe('draft');
  });
});

describe('« Demain » se lit dans le fuseau de l utilisateur', () => {
  it('sans fuseau : la date locale du serveur, comme avant', () => {
    expect(slotDate(new Date(T0), 0)).toBe('2026-08-05');
  });

  it('avec un fuseau très en avance, demain est déjà le surlendemain de l UTC', () => {
    // 2026-08-04 à 23:30 UTC = 2026-08-05 13:30 à Kiritimati (UTC+14).
    const t = Date.parse('2026-08-04T23:30:00.000Z');
    expect(slotDate(new Date(t), 0, 'Pacific/Kiritimati')).toBe('2026-08-06');
    expect(slotDate(new Date(t), 0, 'UTC')).toBe('2026-08-05');
  });

  it('avec un fuseau très en retard, demain est encore le jour UTC', () => {
    // 2026-08-05 à 02:00 UTC = 2026-08-04 16:00 à Honolulu (UTC-10).
    const t = Date.parse('2026-08-05T02:00:00.000Z');
    expect(slotDate(new Date(t), 0, 'Pacific/Honolulu')).toBe('2026-08-05');
    expect(slotDate(new Date(t), 0, 'UTC')).toBe('2026-08-06');
  });

  it('un jour de changement d heure ne décale pas la date', () => {
    // Passage à l'heure d'été à Paris : dimanche 2026-03-29 (journée de 23 h).
    // 2026-03-29 à 00:30 UTC = 01:30 à Paris, AVANT le saut de 02:00 → 03:00.
    const ete = Date.parse('2026-03-29T00:30:00.000Z');
    expect(slotDate(new Date(ete), 0, 'Europe/Paris')).toBe('2026-03-30');
    expect(slotDate(new Date(ete), 1, 'Europe/Paris')).toBe('2026-03-31');
    // Retour à l'heure d'hiver : dimanche 2026-10-25 (journée de 25 h).
    const hiver = Date.parse('2026-10-25T00:30:00.000Z');
    expect(slotDate(new Date(hiver), 0, 'Europe/Paris')).toBe('2026-10-26');
    expect(slotDate(new Date(hiver), 6, 'Europe/Paris')).toBe('2026-11-01');
  });

  it('le passage de mois et d année est correct', () => {
    expect(slotDate(new Date(Date.parse('2026-08-31T12:00:00Z')), 0, 'Europe/Paris')).toBe('2026-09-01');
    expect(slotDate(new Date(Date.parse('2026-12-31T12:00:00Z')), 0, 'Europe/Paris')).toBe('2027-01-01');
  });

  it('un fuseau illisible ne lève pas — la date serveur, comme avant', () => {
    expect(() => slotDate(new Date(T0), 0, 'Mars/Olympus')).not.toThrow();
    expect(slotDate(new Date(T0), 0, 'Mars/Olympus')).toBe(slotDate(new Date(T0), 0));
  });

  it('preparePosts passe le fuseau de la configuration', () => {
    const t = Date.parse('2026-08-04T23:30:00.000Z');
    const p = preparePosts({ config: cfg({ runTimezone: 'Pacific/Kiritimati' }), topic: 'yoga', count: 1, now: t });
    expect(p[0].scheduledDate).toBe('2026-08-06');
  });
});

describe('Les métadonnées portent le fuseau que le cron de publication relit', () => {
  const post = preparePosts({ config: cfg(), topic: 'yoga', count: 1, now: T0 })[0];
  const design = buildAutopilotDesign(post);

  it('quand il est donné', () => {
    const m = buildAutopilotMetadata({
      post, design, videoUrl: 'https://cdn.test/r.mp4', mode: 'auto', timezone: 'America/New_York',
    });
    expect(m.timezone).toBe('America/New_York');
  });

  it('absent sinon — le cron retombe alors sur Europe/Paris, comme avant', () => {
    const m = buildAutopilotMetadata({ post, design, videoUrl: 'https://cdn.test/r.mp4', mode: 'auto' });
    expect('timezone' in m).toBe(false);
  });

  it('le cron de l Autopilote le transmet, et le cron de publication le lit', () => {
    const route = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8')
      // + le montage lui-même (rush, affiche, voix, design, rendu, dépôt, débit),
      // extrait du cron dans `produireUnMontage`, partagé avec la production manuelle.
      + readFileSync(resolve(__dirname, '../lib/autopilot/produire.ts'), 'utf-8');
    expect(route).toContain('timezone: config.runTimezone,');
    expect(route).toContain('publishTime: ligne.publish_time,');
    const publish = readFileSync(resolve(__dirname, '../app/api/cron/publish/route.ts'), 'utf-8');
    expect(publish).toContain("post.metadata?.timezone || 'Europe/Paris'");
  });
});

describe('Les trois intentions ↔ (mode, réseaux)', () => {
  it('se dérivent de la configuration', () => {
    expect(intentionDiffusion({ mode: 'auto', platforms: ['instagram'] })).toBe('publier');
    expect(intentionDiffusion({ mode: 'auto', platforms: [] })).toBe('publier');
    expect(intentionDiffusion({ mode: 'review', platforms: ['tiktok'] })).toBe('valider');
    expect(intentionDiffusion({ mode: 'review', platforms: [] })).toBe('produire');
    expect(intentionDiffusion(DEFAULT_CONFIG)).toBe('produire');
  });

  it('« produire seulement » vide les réseaux dans le MÊME patch que le mode', () => {
    expect(patchPourIntention('produire')).toEqual({ mode: 'review', platforms: [] });
  });

  it('les deux autres ne touchent pas aux réseaux', () => {
    expect(patchPourIntention('publier')).toEqual({ mode: 'auto' });
    expect(patchPourIntention('valider')).toEqual({ mode: 'review' });
  });

  it('chaque intention se ramène à un mode existant, et le statut ne change pas', () => {
    for (const i of INTENTIONS) {
      const mode = INTENTION_MODE[i];
      expect(['auto', 'review']).toContain(mode);
      expect(statusForMode(mode)).toBe(mode === 'auto' ? 'scheduled' : 'draft');
    }
    expect(statusForMode(INTENTION_MODE.produire)).toBe('draft');
  });

  it('l aller-retour est stable', () => {
    for (const i of INTENTIONS) {
      const c = sanitizeConfig({ ...cfg(), ...patchPourIntention(i) });
      // « valider » exige des réseaux ; `cfg()` en a un.
      expect(intentionDiffusion(c)).toBe(i);
    }
  });

  it('les libellés des deux premières SONT ceux des modes', () => {
    expect(INTENTION_LABELS.publier).toBe(MODE_LABELS.auto);
    expect(INTENTION_LABELS.valider).toBe(MODE_LABELS.review);
    expect(INTENTION_LABELS.produire).toMatch(/télécharg/i);
  });

  it('l indice du mode auto ne confond plus production et publication', () => {
    expect(MODE_HINTS.auto).not.toContain('à l’heure prévue');
    expect(MODE_HINTS.auto).toMatch(/heure de publication/);
    expect(MODE_HINTS.auto).toMatch(/lendemain/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// La route de configuration : `publish_time` lue et écrite SEULEMENT si la
// colonne existe — sinon l'upsert entier échouerait.
// ───────────────────────────────────────────────────────────────────────────

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/** Colonnes que la base « connaît ». Tout `select` d'une autre échoue. */
let colonnesConnues: Set<string>;
let ligneEnBase: Record<string, unknown> | null;
const upserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'autopilot_config') throw new Error(`table inattendue : ${table}`);
    let selection = '';
    const chaine = {
      select(cols: string) {
        selection = cols;
        return chaine;
      },
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
  'design_style', 'poster_urls', 'poster_mode',
];

/** La route, RECHARGÉE : ses sondes de colonnes sont mémoïsées au niveau du module. */
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

  it('lit publish_time quand la colonne existe, et dit qu elle est enregistrable', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'publish_time']);
    ligneEnBase = { user_id: 'u1', mode: 'review', publish_time: '18:45', run_hour: 8 };
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.success).toBe(true);
    expect(corps.publishTimeReady).toBe(true);
    expect(corps.config.publishTime).toBe('18:45');
  });

  it('sans la colonne : 18:00, et l écran est prévenu', async () => {
    colonnesConnues = new Set(COLONNES_DE_BASE);
    ligneEnBase = { user_id: 'u1', mode: 'review', run_hour: 8 };
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.publishTimeReady).toBe(false);
    expect(corps.config.publishTime).toBe('18:00');
  });

  it('écrit publish_time, minutes comprises, quand la colonne existe', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'publish_time']);
    const { PUT } = await chargerRoute();
    const res = await PUT(requetePut({ ...DEFAULT_CONFIG, publishTime: '19:15' }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.success).toBe(true);
    expect(corps.publishTimeReady).toBe(true);
    expect(corps.config.publishTime).toBe('19:15');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].publish_time).toBe('19:15');
  });

  it('⚠️ sans la colonne, l upsert part SANS publish_time — et réussit', async () => {
    // Écrire une colonne absente ferait échouer l'upsert ENTIER : plus rien
    // ne s'enregistrerait, pas même la cadence.
    colonnesConnues = new Set(COLONNES_DE_BASE);
    const { PUT } = await chargerRoute();
    const res = await PUT(requetePut({ ...DEFAULT_CONFIG, publishTime: '19:15', cadence: 'daily' }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.success).toBe(true);
    expect(corps.publishTimeReady).toBe(false);
    expect(upserts).toHaveLength(1);
    expect('publish_time' in upserts[0]).toBe(false);
    expect(upserts[0].cadence).toBe('daily');
  });

  it('une heure illisible est ramenée à 18:00 avant d être écrite', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'publish_time']);
    const { PUT } = await chargerRoute();
    await PUT(requetePut({ ...DEFAULT_CONFIG, publishTime: '25:99' }));
    expect(upserts[0].publish_time).toBe('18:00');
  });

  it('« produire seulement » s écrit comme review + aucun réseau — rien de plus en base', async () => {
    colonnesConnues = new Set([...COLONNES_DE_BASE, 'publish_time']);
    const { PUT } = await chargerRoute();
    await PUT(requetePut({ ...DEFAULT_CONFIG, platforms: ['instagram'], ...patchPourIntention('produire') }));
    expect(upserts[0].mode).toBe('review');
    expect(upserts[0].platforms).toEqual([]);
    expect(Object.keys(upserts[0])).not.toContain('intention');
  });
});

describe('La migration', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../migrations/2026-09-21-autopilot-publish-time.sql'), 'utf-8',
  );

  it('ajoute la colonne avec le défaut actuel, et la contraint à « HH:MM »', () => {
    expect(migration).toContain("add column if not exists publish_time text not null default '18:00'");
    expect(migration).toMatch(/check \(publish_time ~ '\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$'\)/);
  });

  it('et n oublie pas les deux étapes de PostgREST', () => {
    expect(migration).toContain('grant all on table public.autopilot_config to public');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});
