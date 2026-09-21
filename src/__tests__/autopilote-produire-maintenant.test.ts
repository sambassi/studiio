import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { creneauImmediat, sanitizeConfig, DEFAULT_CONFIG } from '@/lib/autopilot/rules';
import { slotKey } from '@/lib/autopilot/engine';

/**
 * « Produire un brouillon maintenant » — `POST /api/autopilot/produire-maintenant`.
 *
 * Le MOTEUR DU CRON, appelé une fois pour le compte de la session, avec deux
 * choses FORCÉES quoi que dise la configuration : statut `draft` et réseaux
 * `[]` — aucune publication sociale possible. Le créneau est « aujourd'hui,
 * maintenant + 5 min arrondi » chez l'utilisateur, PAS l'heure de
 * publication configurée.
 *
 * Ce que ce fichier verrouille :
 * - session requise (401) ; aucun rush (422) et crédits insuffisants (402)
 *   refusés AVANT tout rendu, sans rien débiter ;
 * - brouillon forcé, réseaux vides, jeton `manuel:`, métadonnées ;
 * - UN rendu et UN débit par clic — deux appels SIMULTANÉS : le second
 *   répond 409 sans avoir rendu ni débité ; un second appel dans le même
 *   créneau, après coup : 409 aussi ;
 * - aucun appel de publication ; le devis (`GET`) annonce le même coût que
 *   le débit.
 *
 * ⚠️ AUCUN RENDU RÉEL : `renderAndUpload`, les sondages réseau et la voix
 * sont doublés.
 */

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/** La ligne `autopilot_config` du compte, ou `null`. */
let configEnBase: Record<string, unknown> | null;
/** Les posts `scheduled_posts` du compte — remplis par les insertions. */
let posts: Array<Record<string, unknown>>;
/** Les lignes insérées, dans l'ordre. */
let insertions: Array<Record<string, unknown>>;

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const chaine: Record<string, unknown> = {};
    const self = () => chaine;
    Object.assign(chaine, {
      select: self, eq: self, order: self,
      async limit() {
        if (table === 'autopilot_config') return { data: configEnBase ? [configEnBase] : [], error: null };
        if (table === 'scheduled_posts') return { data: posts, error: null };
        return { data: [], error: null };
      },
      async maybeSingle() {
        if (table === 'users') return { data: { role: 'user' }, error: null };
        return { data: null, error: null };
      },
      insert(row: Record<string, unknown>) {
        if (table !== 'scheduled_posts') throw new Error(`insertion inattendue : ${table}`);
        insertions.push(row);
        const id = `p${insertions.length}`;
        posts.push({ ...row, id });
        return {
          async select() { return { data: [{ id }], error: null }; },
        };
      },
      // `creneauxExistants` termine par `.eq()` puis `await` : la chaîne doit
      // être thenable.
      then(onOk: (v: unknown) => unknown) {
        if (table === 'scheduled_posts') return Promise.resolve({ data: posts, error: null }).then(onOk);
        return Promise.resolve({ data: [], error: null }).then(onOk);
      },
    });
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

let credits = 500;
const deductCredits = vi.fn(async () => true);
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => credits,
  deductCredits: (...args: unknown[]) => deductCredits(...(args as [])),
  getVideoRenderCost: () => 10,
}));

vi.mock('@/lib/facturation/politique', () => ({
  politiqueDeLUtilisateur: async () => ({ politique: 'credits', role: 'user' }),
}));

let delaiRendu = 0;
const renderAndUpload = vi.fn(async (): Promise<import('@/lib/autopilot/render').RenderedMontage> => {
  if (delaiRendu) await new Promise((r) => setTimeout(r, delaiRendu));
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({ renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [])) }));

vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

const buildAutopilotVoices = vi.fn(async () => ({}));
vi.mock('@/lib/autopilot/voice', async () => {
  // Le reste du module (durées avec voix, textes) est pur : on ne double que
  // la synthèse, qui est payante.
  const actual = await vi.importActual<typeof import('@/lib/autopilot/voice')>('@/lib/autopilot/voice');
  return { ...actual, buildAutopilotVoices: (...a: unknown[]) => buildAutopilotVoices(...(a as [])) };
});

const publication = vi.fn();
vi.mock('@/lib/social/publish', () => ({
  publishToInstagram: publication, publishToTikTok: publication, publishToFacebook: publication, publishToYouTube: publication,
}));

const configComplete = () => ({
  user_id: 'u1',
  enabled: false,
  // ⚠️ « Publier automatiquement » sur deux réseaux : la route doit FORCER
  // brouillon + aucun réseau malgré cela.
  mode: 'auto',
  platforms: ['instagram', 'tiktok'],
  cadence: 'daily',
  count_per_cycle: 3,
  credit_floor: 50,
  rush_urls: ['https://cdn.test/a.mp4', 'https://cdn.test/b.mp4'],
  topics: ['yoga'],
  run_hour: 8,
  run_timezone: 'Europe/Paris',
  publish_time: '18:45',
  start_date: '2027-01-01',
  voice_enabled: false,
});

/** 2026-08-04 à 09:02 UTC = 11:02 à Paris → créneau 11:10. */
const MAINTENANT = Date.parse('2026-08-04T09:02:00.000Z');

async function chargerRoute() {
  vi.resetModules();
  return import('@/app/api/autopilot/produire-maintenant/route');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  configEnBase = configComplete();
  posts = [];
  insertions = [];
  credits = 500;
  delaiRendu = 0;
  deductCredits.mockClear();
  renderAndUpload.mockClear();
  buildAutopilotVoices.mockClear();
  publication.mockClear();
  globalThis.fetch = vi.fn(async () => { throw new Error('aucun appel réseau attendu'); }) as unknown as typeof fetch;
});
afterEach(() => { vi.useRealTimers(); });

describe('Les refus — sans rien débiter ni rendre', () => {
  it('sans session : 401', async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(401);
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('sans rush : 422', async () => {
    configEnBase = { ...configComplete(), rush_urls: [] };
    const { POST } = await chargerRoute();
    const res = await POST();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('sans-rush');
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('sans configuration du tout : 422 aussi (les défauts n ont pas de rush)', async () => {
    configEnBase = null;
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(422);
  });

  it('crédits insuffisants : 402, avec le montant', async () => {
    credits = 4;
    const { POST } = await chargerRoute();
    const res = await POST();
    expect(res.status).toBe(402);
    const corps = await res.json();
    expect(corps.code).toBe('credits');
    expect(corps.cout).toBe(10);
    expect(corps.solde).toBe(4);
    expect(corps.manque).toBe(6);
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('un rendu qui échoue : 500, rien débité', async () => {
    renderAndUpload.mockRejectedValueOnce(new Error('Chromium absent'));
    const { POST } = await chargerRoute();
    const res = await POST();
    expect(res.status).toBe(500);
    expect(deductCredits).not.toHaveBeenCalled();
    expect(insertions).toHaveLength(0);
  });
});

describe('Le brouillon forcé', () => {
  it('statut draft, aucun réseau, quoi que dise la configuration', async () => {
    const { POST } = await chargerRoute();
    const res = await POST();
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.success).toBe(true);
    expect(corps.status).toBe('draft');
    expect(corps.platforms).toEqual([]);

    expect(insertions).toHaveLength(1);
    const ligne = insertions[0];
    expect(ligne.status).toBe('draft');
    expect(ligne.platforms).toEqual([]);
    expect(ligne.agent_generated).toBe(true);
    expect(ligne.media_url).toBe('https://cdn.test/rendu.mp4');
    const meta = ligne.metadata as Record<string, unknown>;
    expect(meta.source).toBe('autopilote');
    expect(meta.autopilotMode).toBe('review');
    expect(meta.production).toBe('manuelle');
    expect(meta.timezone).toBe('Europe/Paris');
  });

  it('le créneau est « aujourd hui, maintenant arrondi » chez l utilisateur — PAS l heure de publication', async () => {
    const { POST } = await chargerRoute();
    const corps = await (await POST()).json();
    const attendu = creneauImmediat(MAINTENANT, 'Europe/Paris');
    expect(attendu).toEqual({ date: '2026-08-04', time: '11:10' });
    expect(corps.scheduledDate).toBe('2026-08-04');
    expect(corps.scheduledTime).toBe('11:10');
    expect(corps.timezone).toBe('Europe/Paris');
    expect(insertions[0].scheduled_date).toBe('2026-08-04');
    expect(insertions[0].scheduled_time).toBe('11:10');
    // Ni 18:45, ni demain, ni la date de début de 2027.
    expect(insertions[0].scheduled_time).not.toBe('18:45');
  });

  it('le jeton de créneau est distinct de ceux du cron — préfixe `manuel:`', async () => {
    const { POST } = await chargerRoute();
    await POST();
    const meta = insertions[0].metadata as Record<string, unknown>;
    expect(meta.slotKey).toBe(`manuel:${slotKey('u1', '2026-08-04', '11:10')}`);
  });

  it('rend UNE vidéo, la débite UNE fois, au coût annoncé, avec une référence stable', async () => {
    const { POST } = await chargerRoute();
    const corps = await (await POST()).json();
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledWith(
      'u1', 10, 'render', 'autopilote:autopilote-manuel-u1-2026-08-04-1110',
    );
    expect(corps.cout).toBe(10);
    expect(corps.debite).toBe(true);
    expect(corps.postId).toBe('p1');
    expect(corps.calendrierUrl).toBe('/dashboard/calendar');
  });

  it('le débit vient APRÈS l insertion', async () => {
    const ordre: string[] = [];
    deductCredits.mockImplementationOnce(async () => { ordre.push('debit'); return true; });
    renderAndUpload.mockImplementationOnce(async () => {
      ordre.push('rendu');
      return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: null, durationFrames: 1 };
    });
    const { POST } = await chargerRoute();
    await POST();
    expect(ordre).toEqual(['rendu', 'debit']);
  });

  it('aucune voix quand elle n est pas demandée, et AUCUN appel de publication', async () => {
    const { POST } = await chargerRoute();
    await POST();
    expect(buildAutopilotVoices).not.toHaveBeenCalled();
    expect(publication).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('la production ne consulte pas la décision du cron — en pause, avant la date de début : elle produit quand même', async () => {
    configEnBase = { ...configComplete(), enabled: false, start_date: '2030-01-01' };
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(200);
  });
});

describe('Un clic = un rendu = un débit', () => {
  it('deux appels SIMULTANÉS : un seul rendu, un seul débit, le second répond 409', async () => {
    delaiRendu = 30;
    vi.useRealTimers();
    const { POST } = await chargerRoute();
    const [a, b] = await Promise.all([POST(), POST()]);
    const statuts = [a.status, b.status].sort();
    expect(statuts).toEqual([200, 409]);
    const refuse = a.status === 409 ? a : b;
    expect((await refuse.json()).code).toBe('en-cours');
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(insertions).toHaveLength(1);
  });

  it('un second appel dans le MÊME créneau, après coup : 409, rien de plus', async () => {
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(200);
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('deja-produit');
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('le verrou est relâché après une erreur — on peut réessayer', async () => {
    renderAndUpload.mockRejectedValueOnce(new Error('Chromium absent'));
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(500);
    expect((await POST()).status).toBe(200);
  });

  it('un créneau plus tard est un nouveau brouillon', async () => {
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(200);
    vi.setSystemTime(MAINTENANT + 10 * 60_000);
    expect((await POST()).status).toBe(200);
    expect(insertions).toHaveLength(2);
    expect(insertions[1].scheduled_time).toBe('11:20');
  });
});

describe('Le devis', () => {
  it('annonce le MÊME coût que le débit, la politique et le solde', async () => {
    const { GET } = await chargerRoute();
    const corps = await (await GET()).json();
    expect(corps.success).toBe(true);
    expect(corps.cout).toBe(10);
    expect(corps.politique).toBe('credits');
    expect(corps.solde).toBe(500);
    expect(corps.enCours).toBe(false);
  });

  it('exige une session', async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await chargerRoute();
    expect((await GET()).status).toBe(401);
  });
});

describe('Le moteur partagé', () => {
  it('le cron et la route appellent la MÊME fonction, et le cron n en garde pas de copie', () => {
    const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
    const route = readFileSync(resolve(__dirname, '../app/api/autopilot/produire-maintenant/route.ts'), 'utf-8');
    for (const src of [cron, route]) {
      expect(src).toContain("from '@/lib/autopilot/produire'");
      expect(src).toContain('await produireUnMontage({');
      // Aucun des deux ne rend, n'insère ni ne débite lui-même.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const interdit of ['renderAndUpload(', "from('scheduled_posts')", 'deductCredits(', 'buildAutopilotDesign(']) {
        expect(code, interdit).not.toContain(interdit);
      }
    }
    // Le cron garde le tarif comme constante partagée, pas une seconde lecture.
    expect(cron).toContain('COST_PER_VIDEO');
    expect(cron).not.toContain("getVideoRenderCost('reel');");
  });

  it('la route ne publie rien — et le dit', () => {
    const route = readFileSync(resolve(__dirname, '../app/api/autopilot/produire-maintenant/route.ts'), 'utf-8');
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const interdit of ['publishToInstagram', 'publishToTikTok', '/api/cron/publish', "status: 'scheduled'"]) {
      expect(code, interdit).not.toContain(interdit);
    }
    expect(code).toContain("mode: 'review' as const, platforms: [] as string[]");
  });

  it('configDepuisLigne relit une ligne comme la route de configuration — colonnes futures comprises', async () => {
    const { configDepuisLigne } = await import('@/lib/autopilot/produire');
    const ligne = {
      ...configComplete(),
      card_gradient_start: '#111111', card_gradient_end: '#222222', title_color: '#333333',
      cards_show_poster: true, music_url: 'https://cdn.test/m.mp3', voice_id: 'elevenlabs-x',
      keep_rush_audio: true, music_volume: 0.5, voice_volume: 0.7, rush_volume: 0.2,
      design_style: {}, poster_urls: ['https://cdn.test/p.jpg'], poster_mode: 'custom',
      last_run_at: '2026-08-01T00:00:00.000Z', last_rush_url: 'https://cdn.test/a.mp4',
    };
    const attendu = sanitizeConfig({
      enabled: ligne.enabled, mode: ligne.mode, cadence: ligne.cadence, countPerCycle: ligne.count_per_cycle,
      platforms: ligne.platforms, creditFloor: ligne.credit_floor, rushUrls: ligne.rush_urls, topics: ligne.topics,
      runHour: ligne.run_hour, runTimezone: ligne.run_timezone, publishTime: ligne.publish_time,
      startDate: ligne.start_date, lastRunAt: ligne.last_run_at, lastRushUrl: ligne.last_rush_url,
      voiceEnabled: ligne.voice_enabled, cardGradientStart: ligne.card_gradient_start,
      cardGradientEnd: ligne.card_gradient_end, titleColor: ligne.title_color, cardsShowPoster: ligne.cards_show_poster,
      musicUrl: ligne.music_url, voiceId: ligne.voice_id, keepRushAudio: ligne.keep_rush_audio,
      musicVolume: ligne.music_volume, voiceVolume: ligne.voice_volume, rushVolume: ligne.rush_volume,
      designStyle: ligne.design_style, posterUrls: ligne.poster_urls, posterMode: ligne.poster_mode,
    });
    expect(configDepuisLigne(ligne)).toEqual(attendu);
    expect(configDepuisLigne(ligne).startDate).toBe('2027-01-01');
    expect(configDepuisLigne(ligne).publishTime).toBe('18:45');
    expect(configDepuisLigne(null)).toEqual(DEFAULT_CONFIG);
  });
});
