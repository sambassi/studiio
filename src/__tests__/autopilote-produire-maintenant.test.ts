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

/**
 * `autopilot_jumeau_attente` : une VRAIE table en mémoire (unicité
 * `(user_id, slot_key)` comprise) — la réservation persistante d'une
 * production sans avatar s'y écrit. Hissée : survit à `vi.resetModules()`
 * comme une base survit au redémarrage du processus.
 */
const fileAttente = vi.hoisted(() => ({ base: null as null | ReturnType<typeof import('./helpers/fausse-base')['creerFausseBase']> }));

vi.mock('@/lib/db/supabase', async () => {
  const { creerFausseBase } = await import('./helpers/fausse-base');
  fileAttente.base ??= creerFausseBase();
  const from = (table: string) => {
    if (table === 'autopilot_jumeau_attente') return fileAttente.base!.supabaseAdmin.from(table);
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
        // La relecture de PREUVE du post déposé (`postVisibleDansCalendrier`).
        if (table === 'scheduled_posts') return { data: posts[posts.length - 1] ?? null, error: null };
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

/**
 * Le rendu tourne EN ARRIÈRE-PLAN (202) : on attend son résultat, relu
 * comme le fait l'écran, et on le rend sous forme de réponse (200 / 500).
 * Une réponse autre que 202 (refus, 409…) est rendue telle quelle.
 */
async function attendreResultat(): Promise<Response> {
  const { lireResultat } = await import('@/lib/autopilot/progression');
  for (let i = 0; i < 400; i += 1) {
    const r = lireResultat('u1');
    if (r) return new Response(JSON.stringify(r), { status: r.success ? 200 : 500 });
    await new Promise((ok) => setTimeout(ok, 5));
  }
  throw new Error('rendu en arrière-plan jamais terminé');
}

async function produire(POST: () => Promise<Response>): Promise<Response> {
  const res = await POST();
  return res.status === 202 ? attendreResultat() : res;
}

beforeEach(() => {
  fileAttente.base?.vider();
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
    expect((await produire(POST)).status).toBe(401);
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('sans rush : 422', async () => {
    configEnBase = { ...configComplete(), rush_urls: [] };
    const { POST } = await chargerRoute();
    const res = await produire(POST);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('sans-rush');
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('sans configuration du tout : 422 aussi (les défauts n ont pas de rush)', async () => {
    configEnBase = null;
    const { POST } = await chargerRoute();
    expect((await produire(POST)).status).toBe(422);
  });

  it('crédits insuffisants : 402, avec le montant', async () => {
    credits = 4;
    const { POST } = await chargerRoute();
    const res = await produire(POST);
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
    const res = await produire(POST);
    expect(res.status).toBe(500);
    expect(deductCredits).not.toHaveBeenCalled();
    expect(insertions).toHaveLength(0);
  });
});

describe('Le brouillon forcé', () => {
  it('statut draft, aucun réseau, quoi que dise la configuration', async () => {
    const { POST } = await chargerRoute();
    const res = await produire(POST);
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
    const corps = await (await produire(POST)).json();
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
    await produire(POST);
    const meta = insertions[0].metadata as Record<string, unknown>;
    expect(meta.slotKey).toBe(`manuel:${slotKey('u1', '2026-08-04', '11:10')}`);
  });

  it('rend UNE vidéo, la débite UNE fois, au coût annoncé, avec une référence stable', async () => {
    const { POST } = await chargerRoute();
    const corps = await (await produire(POST)).json();
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
    await produire(POST);
    expect(ordre).toEqual(['rendu', 'debit']);
  });

  it('aucune voix quand elle n est pas demandée, et AUCUN appel de publication', async () => {
    const { POST } = await chargerRoute();
    await produire(POST);
    expect(buildAutopilotVoices).not.toHaveBeenCalled();
    expect(publication).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('la production ne consulte pas la décision du cron — en pause, avant la date de début : elle produit quand même', async () => {
    configEnBase = { ...configComplete(), enabled: false, start_date: '2030-01-01' };
    const { POST } = await chargerRoute();
    expect((await produire(POST)).status).toBe(200);
  });
});

describe('Un clic = un rendu = un débit', () => {
  it('deux appels SIMULTANÉS : un seul rendu, un seul débit, le second répond 409', async () => {
    delaiRendu = 30;
    vi.useRealTimers();
    const { POST } = await chargerRoute();
    const [a, b] = await Promise.all([POST(), POST()]);
    const statuts = [a.status, b.status].sort();
    // 202 : le premier est lancé en arrière-plan ; le second, refusé.
    expect(statuts).toEqual([202, 409]);
    const refuse = a.status === 409 ? a : b;
    expect((await refuse.json()).code).toBe('en-cours');
    expect((await attendreResultat()).status).toBe(200);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(insertions).toHaveLength(1);
  });

  it('un second appel dans le MÊME créneau, après coup : 409, rien de plus', async () => {
    const { POST } = await chargerRoute();
    expect((await produire(POST)).status).toBe(200);
    const res = await produire(POST);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('deja-produit');
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('le verrou est relâché après une erreur — on peut réessayer', async () => {
    renderAndUpload.mockRejectedValueOnce(new Error('Chromium absent'));
    const { POST } = await chargerRoute();
    expect((await produire(POST)).status).toBe(500);
    expect((await produire(POST)).status).toBe(200);
  });

  it('un créneau plus tard est un nouveau brouillon', async () => {
    const { POST } = await chargerRoute();
    expect((await produire(POST)).status).toBe(200);
    vi.setSystemTime(MAINTENANT + 10 * 60_000);
    expect((await produire(POST)).status).toBe(200);
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
      // Le cron attend le montage ; la route le lance en arrière-plan.
      expect(src).toMatch(/(await|void) produireUnMontage\(\{/);
      // Aucun des deux ne rend, n'insère ni ne débite lui-même.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const interdit of ['renderAndUpload(', "from('scheduled_posts')", 'deductCredits(', 'buildAutopilotDesign(']) {
        expect(code, interdit).not.toContain(interdit);
      }
    }
    // Le cron lit le tarif par la fonction partagée (grille centrale), pas une seconde définition.
    expect(cron).toContain('coutMontage()');
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

describe('1 clic = 1 rendu : la production tourne en ARRIÈRE-PLAN', () => {
  it('réponse immédiate 202 ; tant que le rendu tourne, un nouvel appel est refusé (409 en-cours)', async () => {
    delaiRendu = 60;
    vi.useRealTimers();
    const { POST } = await chargerRoute();
    const premier = await POST();
    expect(premier.status).toBe(202);
    expect((await premier.json()).enCours).toBe(true);
    // Le rendu n'est pas fini : un deuxième clic (ou une requête rejouée
    // après une coupure) ne lance RIEN.
    const second = await POST();
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe('en-cours');
    expect((await attendreResultat()).status).toBe(200);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(insertions).toHaveLength(1);
  });

  it('l écran relit avancement puis résultat par /progression', async () => {
    const { POST } = await chargerRoute();
    expect((await POST()).status).toBe(202);
    await attendreResultat();
    const { GET } = await import('@/app/api/autopilot/produire-maintenant/progression/route');
    const corps = await (await GET()).json();
    expect(corps.progression).toBeNull();
    expect(corps.resultat.success).toBe(true);
    expect(corps.resultat.postId).toBeDefined();
  });

  it('le panneau suit le rendu lancé et le retrouve après un rechargement', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const panel = readFileSync(require('path').resolve(process.cwd(), 'src/components/creer/AutopilotPanel.tsx'), 'utf-8');
    // 202 / 409 « en-cours » → suivre : `suiteEnvoi` (etat-production-manuelle).
    expect(panel).toContain('const suite = suiteEnvoi(issue);');
    // Reprise au montage : rendu en cours OU montage-jumeau en préparation
    // (comportement monté et vérifié dans autopilote-faux-succes-ecran).
    expect(panel).toContain("if (reprise === 'en-cours') setProduire((e) => (e.etat === 'repos' ? { etat: 'en-cours' } : e));");
    expect(panel).toContain("else if (reprise === 'jumeau') setProduire((e) => (e.etat === 'repos' ? { etat: 'jumeau' } : e));");
    expect(panel).toContain('if (!p && r) appliquerResultat(r);');
  });
});

describe('A4 v3 — avatar seul, durée < 20 s : rien sans confirmation', () => {
  const lancer = vi.fn(async (..._a: unknown[]) => ({ ok: true, generationId: 'g', attenteId: 'a', dejaEnFile: false }));
  const avecLancerSimule = async () => {
    vi.resetModules();
    vi.doMock('@/lib/autopilot/jumeau-async', async () => {
      const actual = await vi.importActual<typeof import('@/lib/autopilot/jumeau-async')>('@/lib/autopilot/jumeau-async');
      return { ...actual, lancerJumeauMontage: (...a: unknown[]) => lancer(...a) };
    });
    const route = await import('@/app/api/autopilot/produire-maintenant/route');
    return route;
  };
  afterEach(() => { vi.doUnmock('@/lib/autopilot/jumeau-async'); lancer.mockClear(); });

  it('15 s sans confirmation → 409 duree_a_confirmer, message clair, aucune génération, aucun rendu, aucun débit', async () => {
    configEnBase = { ...configComplete(), jumeau_avatar: true, brief: { duree: 15 } };
    const { POST } = await avecLancerSimule();
    const res = await produire(POST);
    expect(res.status).toBe(409);
    const corps = await res.json();
    expect(corps.code).toBe('duree_a_confirmer');
    expect(corps.error).toBe('Avec votre avatar, 15 s est trop court pour un message complet. Passez à 30 s pour lancer la génération.');
    expect(lancer).not.toHaveBeenCalled();
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it('après « Passer à 30 s » (config à 30 s) → le jumeau est lancé, à 30 s', async () => {
    configEnBase = { ...configComplete(), jumeau_avatar: true, brief: { duree: 30 } };
    const { POST } = await avecLancerSimule();
    const res = await produire(POST);
    expect(res.status).toBeLessThan(300);
    expect(lancer).toHaveBeenCalledTimes(1);
    const arg = lancer.mock.calls[0][0] as { post: { brief?: { duree?: number } } };
    expect(arg.post.brief?.duree).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #613 — sans avatar, l'état et le verrou survivent au processus
// ─────────────────────────────────────────────────────────────────────────────

/** Un « processus » neuf : modules (donc Maps et `enVol`) rechargés ; `nouvelleInstance` = redémarrage. */
async function processus(nouvelleInstance = false) {
  vi.resetModules();
  if (nouvelleInstance) delete (globalThis as { __studiioInstanceAutopilote?: string }).__studiioInstanceAutopilote;
  const route = await import('@/app/api/autopilot/produire-maintenant/route');
  const progression = await import('@/app/api/autopilot/produire-maintenant/progression/route');
  return { POST: route.POST, GET: route.GET, PROGRESSION: progression.GET };
}

const ligneDirecte = () => fileAttente.base!.table('autopilot_jumeau_attente').find((l) => l.slot_key === 'manuel-direct') as Record<string, unknown> | undefined;

async function attendreStatut(statuts: string[]): Promise<Record<string, unknown>> {
  for (let i = 0; i < 400; i += 1) {
    const l = ligneDirecte();
    if (l && statuts.includes(String(l.statut))) return l;
    await new Promise((ok) => setTimeout(ok, 5));
  }
  throw new Error(`statut jamais atteint : ${statuts.join(', ')}`);
}

describe('#613 — production sans avatar : état et verrou PERSISTANTS', () => {
  it('deux POST SIMULTANÉS dans deux processus distincts (mémoires séparées) : un seul rendu, un seul débit', async () => {
    delaiRendu = 30;
    const a = await processus();
    const b = await processus();
    const [r1, r2] = await Promise.all([a.POST(), b.POST()]);
    expect([r1.status, r2.status].sort()).toEqual([202, 409]);
    const refus = r1.status === 409 ? r1 : r2;
    expect((await refus.json()).code).toBe('en-cours');
    await attendreStatut(['direct_rendu']);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('la réservation est écrite AVANT le rendu, et ignore la file jumeau (statut direct_*, génération nulle)', async () => {
    let ligneAuRendu: Record<string, unknown> | undefined;
    renderAndUpload.mockImplementationOnce(async () => {
      ligneAuRendu = { ...ligneDirecte() };
      return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
    });
    const p = await processus();
    expect((await p.POST()).status).toBe(202);
    const fin = await attendreStatut(['direct_rendu']);
    expect(ligneAuRendu).toMatchObject({ user_id: 'u1', statut: 'direct_en_cours', generation_id: '00000000-0000-0000-0000-000000000000' });
    expect(fin.post_id).toBe('p1');
    expect(fin.job_id).toBe(String((deductCredits.mock.calls[0] as unknown[] | undefined)?.[3] ?? '').replace(/^autopilote:/, ''));
  });

  it('REDÉMARRAGE pendant le rendu (Maps vides) : la progression est relue de la base, un nouveau clic est refusé', async () => {
    let finir: (() => void) | null = null;
    renderAndUpload.mockImplementationOnce(() => new Promise((ok) => {
      finir = () => ok({ videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 });
    }));
    const avant = await processus();
    const lance = await avant.POST();
    expect(lance.status).toBe(202);
    const { scheduledDate, scheduledTime } = await lance.json();
    for (let i = 0; i < 200 && !finir; i += 1) await new Promise((ok) => setTimeout(ok, 5));

    const apres = await processus(true);
    const lu = await (await apres.PROGRESSION(new Request(`http://x/p?date=${scheduledDate}&time=${encodeURIComponent(scheduledTime)}`))).json();
    expect(lu.progression).toMatchObject({ etape: expect.any(String) });
    expect(lu.production).toEqual({ date: scheduledDate, time: scheduledTime });
    // Le Calendrier voit la même chose (bandeau « Génération en cours »).
    const { generationEnCoursDepuisLecture } = await import('@/lib/autopilot/progression');
    expect(generationEnCoursDepuisLecture(lu)).toMatchObject({ sorte: 'rendu' });
    // Nouveau clic, même après le redémarrage : refusé, il SUIT la production en cours.
    const refus = await apres.POST();
    expect(refus.status).toBe(409);
    expect(await refus.json()).toMatchObject({ code: 'en-cours', scheduledDate, scheduledTime });
    expect((await (await apres.GET()).json()).enCours).toBe(true);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    (finir as unknown as () => void)();
    await attendreStatut(['direct_rendu']);
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('réservation ORPHELINE (processus mort) : libérée — issue « interrompue » pour le créneau suivi, relance possible, un débit par rendu', async () => {
    renderAndUpload.mockImplementationOnce(() => new Promise(() => { /* le processus meurt pendant le rendu */ }));
    const mort = await processus();
    const lance = await mort.POST();
    const { scheduledDate, scheduledTime } = await lance.json();
    await new Promise((ok) => setTimeout(ok, 20));
    expect(ligneDirecte()?.statut).toBe('direct_en_cours');

    // Redémarrage, puis 4 min sans signe de vie de l'ancien processus.
    vi.setSystemTime(MAINTENANT + 4 * 60_000);
    const neuf = await processus(true);
    const lu = await (await neuf.PROGRESSION(new Request(`http://x/p?date=${scheduledDate}&time=${encodeURIComponent(scheduledTime)}`))).json();
    expect(lu.progression).toBeNull();
    expect(lu.resultat).toMatchObject({ success: false, code: 'interrompue' });
    expect(String(lu.resultat.error)).toContain('Aucun crédit n’est débité');
    expect(ligneDirecte()?.statut).toBe('direct_echec');

    const relance = await neuf.POST();
    expect(relance.status).toBe(202);
    await attendreStatut(['direct_rendu']);
    expect(renderAndUpload).toHaveBeenCalledTimes(2);
    // Le rendu mort n'a jamais déposé ni débité : un seul débit, celui de la relance.
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('même processus, silence > 30 min : orpheline aussi ; un brouillon déjà déposé pour son créneau → « déposé », jamais « échec »', async () => {
    const p = await processus();
    const { reserverProductionDirecte } = await import('@/lib/autopilot/suivi-jumeau-manuel');
    expect(await reserverProductionDirecte('u1', { jobId: 'autopilote-manuel-u1-2026-08-04-1110', date: '2026-08-04', time: '11:10' })).toEqual({ ok: true });
    // Le post du créneau existe (le processus est mort APRÈS le dépôt).
    posts.push({ id: 'p9', user_id: 'u1', status: 'draft', scheduled_date: '2026-08-04', scheduled_time: '11:10:00', media_url: 'https://cdn.test/rendu.mp4', metadata: { slotKey: 'manuel:u1:2026-08-04:11:10' } });
    vi.setSystemTime(MAINTENANT + 31 * 60_000);
    const lu = await (await p.PROGRESSION(new Request('http://x/p?date=2026-08-04&time=11%3A10'))).json();
    expect(lu.resultat).toMatchObject({ success: true, postId: 'p9' });
    expect(ligneDirecte()).toMatchObject({ statut: 'direct_rendu', post_id: 'p9' });
  });

  it('une issue en base n est rendue QUE pour le créneau suivi (jamais celle d une autre production)', async () => {
    const p = await processus();
    expect((await p.POST()).status).toBe(202);
    await attendreStatut(['direct_rendu']);
    const q = await processus(true);
    const autre = await (await q.PROGRESSION(new Request('http://x/p?date=2026-08-03&time=09%3A00'))).json();
    expect(autre.resultat).toBeNull();
    const sans = await (await q.PROGRESSION(new Request('http://x/p'))).json();
    expect(sans.resultat).toBeNull();
  });

  it('base en panne à la réservation : 503, rien rendu ni débité', async () => {
    const p = await processus();
    const fromOrig = fileAttente.base!.supabaseAdmin.from;
    fileAttente.base!.supabaseAdmin.from = ((t: string) => {
      const q = fromOrig(t) as Record<string, unknown>;
      const ins = q.insert as (l: unknown) => unknown;
      q.insert = (l: unknown) => { ins(l); return { select: async () => ({ data: null, error: { code: '08006', message: 'connexion perdue' } }) }; };
      return q;
    }) as typeof fromOrig;
    try {
      const r = await p.POST();
      expect(r.status).toBe(503);
      expect(renderAndUpload).not.toHaveBeenCalled();
      expect(deductCredits).not.toHaveBeenCalled();
    } finally {
      fileAttente.base!.supabaseAdmin.from = fromOrig;
    }
  });
});
