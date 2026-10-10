import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_CONFIG, decideRun, sanitizeConfig, statusMessage } from '@/lib/autopilot/rules';
import { validerEtapeRushes, contenuRendu, avatarPorteLaProduction, MESSAGES_RUSHES } from '@/lib/autopilot/medias-prevus';
import { analyserCouvertureRushes, plansAutopilote, AVATAR_PRINCIPAL } from '@/lib/stock/couverture';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * L'AVATAR, PERSONNAGE PRINCIPAL DE L'AUTOPILOTE — côté serveur et règles.
 *
 *   - le moteur accepte déjà un montage avec jumeau et SANS rush ;
 *   - avec le jumeau, le rendu ne monte AUCUN rush : l'avatar tient seul la
 *     séquence « Vidéo » (dit tel quel à l'écran) ;
 *   - LE DEVIS = LES DÉBITS : rendu + avatar (si jumeau) + affiche (si
 *     référence), annoncés par le GET, contrôlés par le POST, débités par
 *     `produireUnMontage` + `genererVideoJumeau` — jamais deux fois.
 *
 * ⚠️ AUCUN APPEL FOURNISSEUR : rendu, sondes, voix, tarifs, crédits et jumeau
 * sont doublés ; `fetch` lève s'il est appelé.
 */

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let configEnBase: Record<string, unknown> | null;
let posts: Array<Record<string, unknown>>;
let insertions: Array<Record<string, unknown>>;

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const chaine: Record<string, unknown> = {};
    const self = () => chaine;
    Object.assign(chaine, {
      select: self, eq: self, order: self, in: self,
      async limit() {
        if (table === 'autopilot_config') return { data: configEnBase ? [configEnBase] : [], error: null };
        if (table === 'scheduled_posts') return { data: posts, error: null };
        return { data: [], error: null };
      },
      async maybeSingle() { return { data: null, error: null }; },
      insert(row: Record<string, unknown>) {
        if (table !== 'scheduled_posts') throw new Error(`insertion inattendue : ${table}`);
        insertions.push(row);
        const id = `p${insertions.length}`;
        posts.push({ ...row, id });
        return { async select() { return { data: [{ id }], error: null }; } };
      },
      then(onOk: (v: unknown) => unknown) {
        if (table === 'scheduled_posts') return Promise.resolve({ data: posts, error: null }).then(onOk);
        return Promise.resolve({ data: [], error: null }).then(onOk);
      },
    });
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

/** Une grille VOLONTAIREMENT différente des défauts : on prouve que les prix viennent d'elle. */
const GRILLE: Record<string, number> = { 'render.reel': 12, 'avatar.jumeau': 33, 'autopilot.poster_reference': 7 };
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async (k: string) => GRILLE[k] ?? 0 }));

let credits = 500;
const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => credits,
  deductCredits: (...args: unknown[]) => deductCredits(...args),
  getVideoRenderCost: () => 10,
}));
vi.mock('@/lib/facturation/politique', () => ({
  politiqueDeLUtilisateur: async () => ({ politique: 'credits', role: 'user' }),
}));

const renderAndUpload = vi.fn(async (..._a: unknown[]) => ({ videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 }));
vi.mock('@/lib/autopilot/render', () => ({ renderAndUpload: (...a: unknown[]) => renderAndUpload(...a) }));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));
const genererAfficheReference = vi.fn(async () => ({ ok: true, url: 'https://cdn.test/affiche-ia.jpg' }));
vi.mock('@/lib/ai/affiche-reference', () => ({ genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...(a as [])) }));
const buildAutopilotVoices = vi.fn(async () => ({}));
vi.mock('@/lib/autopilot/voice', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autopilot/voice')>('@/lib/autopilot/voice');
  return { ...actual, buildAutopilotVoices: (...a: unknown[]) => buildAutopilotVoices(...(a as [])) };
});
/** Le lancement du jumeau : capturé, jamais un fournisseur. */
const lancerJumeauMontage = vi.fn(async (..._a: unknown[]) => ({ ok: true, generationId: 'g1', attenteId: 'a1', dejaEnFile: false }));
vi.mock('@/lib/autopilot/jumeau-async', () => ({ lancerJumeauMontage: (...a: unknown[]) => lancerJumeauMontage(...a) }));

const ligne = (extra: Record<string, unknown> = {}) => ({
  user_id: 'u1', enabled: true, mode: 'review', platforms: [], cadence: 'daily', count_per_cycle: 1,
  credit_floor: 0, rush_urls: ['https://cdn.test/a.mp4', 'https://cdn.test/b.mp4'], topics: ['yoga'],
  run_hour: 8, run_timezone: 'Europe/Paris', voice_enabled: true, jumeau_avatar: false, ...extra,
});

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  configEnBase = ligne();
  posts = [];
  insertions = [];
  credits = 500;
  deductCredits.mockClear();
  renderAndUpload.mockClear();
  buildAutopilotVoices.mockClear();
  lancerJumeauMontage.mockClear();
  genererAfficheReference.mockClear();
  globalThis.fetch = vi.fn(async () => { throw new Error('aucun appel réseau attendu'); }) as unknown as typeof fetch;
});
afterEach(() => { vi.resetModules(); });

async function route() {
  vi.resetModules();
  return import('@/app/api/autopilot/produire-maintenant/route');
}

/** La somme débitée par `produireUnMontage` (rendu + affiche), par références. */
function debits(): Array<{ montant: number; type: string; ref: string }> {
  return deductCredits.mock.calls.map((c) => ({ montant: Number(c[1]), type: String(c[2]), ref: String(c[3]) }));
}

function postPrepare(rushUrl: string | null): PreparedPost {
  return {
    title: 'Yoga du matin', topic: 'yoga', rushUrl, scheduledDate: '2026-10-11', scheduledTime: '18:00',
    platforms: [], caption: 'c', hashtags: [],
    content: { title: 'Yoga du matin', subtitle: 's', tagLine: 'Rejoins-nous', cards: [] },
  } as unknown as PreparedPost;
}

describe('Règles — validation de l étape Rushes', () => {
  it('E : 0 rush, avatar OFF → blocage historique', () => {
    expect(validerEtapeRushes({ nbRushes: 0, avatarDemande: false, avatarPret: true }))
      .toEqual({ bloque: true, motif: 'sans-rush', message: MESSAGES_RUSHES.sansRush });
  });
  it('F : 0 rush, avatar OFF (stock ON ne compte pas) → bloqué', () => {
    expect(validerEtapeRushes({ nbRushes: 0, avatarDemande: false, avatarPret: null }).bloque).toBe(true);
  });
  it('C/D : 0 rush, avatar ON et prêt → valide', () => {
    expect(validerEtapeRushes({ nbRushes: 0, avatarDemande: true, avatarPret: true }).bloque).toBe(false);
  });
  it('G : avatar demandé mais pas prêt → bloqué, explicitement, même avec des rushes', () => {
    expect(validerEtapeRushes({ nbRushes: 0, avatarDemande: true, avatarPret: false }).motif).toBe('avatar-non-pret');
    expect(validerEtapeRushes({ nbRushes: 2, avatarDemande: true, avatarPret: false }).motif).toBe('avatar-non-pret');
  });
  it('avatar en vérification : bloque seulement sans rush', () => {
    expect(validerEtapeRushes({ nbRushes: 0, avatarDemande: true, avatarPret: null }).motif).toBe('avatar-en-verification');
    expect(validerEtapeRushes({ nbRushes: 2, avatarDemande: true, avatarPret: null }).bloque).toBe(false);
  });
  it('A : 2 rushes, avatar OFF → rien ne change', () => {
    expect(validerEtapeRushes({ nbRushes: 2, avatarDemande: false, avatarPret: null }).bloque).toBe(false);
    expect(avatarPorteLaProduction(false, true)).toBe(false);
  });
  it('le contenu du rendu est dit tel que le moteur le produit', () => {
    expect(contenuRendu({ nbRushes: 0, avatar: true }).cas).toBe('avatar-seul');
    expect(contenuRendu({ nbRushes: 2, avatar: true }).cas).toBe('avatar-rushes-en-repli');
    expect(contenuRendu({ nbRushes: 2, avatar: false }).cas).toBe('rushes');
    expect(contenuRendu({ nbRushes: 0, avatar: false }).cas).toBe('rien');
  });
});

describe('Couverture — l avatar d abord, le stock en complément', () => {
  const plans = plansAutopilote('yoga', 'respirer');
  it('0 rush + avatar : l avatar tient l accroche, le stock ne comble que les 2 plans restants', () => {
    const c = analyserCouvertureRushes({ plans, rushes: [{ url: AVATAR_PRINCIPAL, origine: 'avatar' }], sujet: 'yoga' });
    expect(c.affectations).toEqual([{ sequence: 'plan-1', rushUrl: AVATAR_PRINCIPAL, origine: 'avatar' }]);
    expect(c.manques.map((m) => m.sequence)).toEqual(['plan-2', 'plan-3']);
    expect(c.manques.map((m) => m.role)).toEqual(['BUILD', 'PEAK']);
    expect(c.manques[0].raison).toContain('avatar');
    expect(c.rushesPersonnels).toBe(0);
  });
  it('priorité avatar > rushes > stock, l avatar listé après les rushes compris', () => {
    const c = analyserCouvertureRushes({
      plans,
      rushes: [
        { url: 'https://x/stock-pexels-video-1.mp4', origine: 'stock' },
        { url: 'https://x/a.mp4', origine: 'utilisateur' },
        { url: AVATAR_PRINCIPAL, origine: 'avatar' },
      ],
    });
    expect(c.affectations.map((a) => a.origine)).toEqual(['avatar', 'utilisateur', 'stock']);
    expect(c.couvertureSuffisante).toBe(true);
    expect(c.rushesPersonnels).toBe(1);
  });
  it('sans avatar : l analyse d avant, à l identique', () => {
    const c = analyserCouvertureRushes({ plans, rushes: [] });
    expect(c.manques).toHaveLength(3);
    expect(c.manques[0].raison).toBe('aucun rush disponible');
  });
});

describe('Moteur — jumeau sans rush (existant)', () => {
  const now = Date.parse('2026-10-10T06:00:00.000Z'); // 08:00 à Paris
  it('decideRun accepte 0 rush avec le jumeau, refuse sans', () => {
    const avec = sanitizeConfig({ ...DEFAULT_CONFIG, enabled: true, rushUrls: [], jumeauAvatar: true, runHour: 8, runTimezone: 'Europe/Paris', creditFloor: 0 });
    expect(decideRun({ config: avec, credits: 500, costPerVideo: 45, now, allowWithoutRush: avec.jumeauAvatar }).run).toBe(true);
    const sans = { ...avec, jumeauAvatar: false };
    expect(decideRun({ config: sans, credits: 500, costPerVideo: 12, now, allowWithoutRush: sans.jumeauAvatar }))
      .toEqual({ run: false, reason: 'sans-rush' });
  });
  it('le message d état ne dit plus « aucun rush » quand l avatar porte la production', () => {
    const avec = sanitizeConfig({ ...DEFAULT_CONFIG, enabled: true, rushUrls: [], jumeauAvatar: true });
    expect(statusMessage(avec, now, () => 'x')).toContain('avec votre avatar');
    expect(statusMessage({ ...avec, jumeauAvatar: false }, now, () => 'x')).toContain('aucun rush');
  });
  it('le cron autorise 0 rush SEULEMENT avec le jumeau, et facture la même somme que le devis', () => {
    const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
    expect(cron).toContain('allowWithoutRush: config.jumeauAvatar');
    expect(cron).toContain("(config.jumeauAvatar ? (await prixDe('avatar.jumeau')) + coutRendu : coutRendu)");
    expect(cron).toContain('+ await coutAfficheDuDevis(config)');
  });
});

describe('Rendu — ce que le montage contient vraiment', () => {
  it('jumeau + 2 rushes : AUCUN rush monté, pas de voix off, la vidéo du jumeau en séquence Vidéo, seul le rendu débité', async () => {
    const { produireUnMontage, configDepuisLigne } = await import('@/lib/autopilot/produire');
    const config = configDepuisLigne(ligne({ jumeau_avatar: true }));
    const r = await produireUnMontage({
      userId: 'u1', config, post: postPrepare('https://cdn.test/a.mp4'), rang: 0, now: Date.now(),
      jobId: 'job-j', slotKey: 'k', jumeauVideoUrl: 'https://cdn.test/jumeau.mp4',
    });
    expect(r.rushUrl).toBeNull();
    expect(buildAutopilotVoices).not.toHaveBeenCalled();
    const design = JSON.stringify(renderAndUpload.mock.calls[0]);
    expect(design).toContain('https://cdn.test/jumeau.mp4');
    expect(design).not.toContain('https://cdn.test/a.mp4');
    expect(design).not.toContain('https://cdn.test/b.mp4');
    expect(debits()).toEqual([{ montant: 12, type: 'render', ref: expect.stringContaining('job-j') }]);
  });

  it('jumeau + 0 rush : avatar seul en séquence Vidéo', async () => {
    const { produireUnMontage, configDepuisLigne } = await import('@/lib/autopilot/produire');
    const config = configDepuisLigne(ligne({ jumeau_avatar: true, rush_urls: [] }));
    const r = await produireUnMontage({
      userId: 'u1', config, post: postPrepare(null), rang: 0, now: Date.now(),
      jobId: 'job-0', slotKey: 'k0', jumeauVideoUrl: 'https://cdn.test/jumeau.mp4',
    });
    expect(r.rushUrl).toBeNull();
    expect(JSON.stringify(renderAndUpload.mock.calls[0])).toContain('https://cdn.test/jumeau.mp4');
    expect((insertions[0].metadata as Record<string, unknown>).jumeau).toBe(true);
  });
});

describe('Devis = débits — avatar ON avec ou sans rushes, sans double facturation', () => {
  it('le moteur du jumeau débite avatar.jumeau UNE fois par génération (référence jumeau:<id>)', () => {
    const src = readFileSync(resolve(__dirname, '../lib/avatar/moteur-jumeau.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src.match(/deductCredits\(/g)).toHaveLength(1);
    expect(src).toContain("const coutJumeau = await prixDe('avatar.jumeau');");
    expect(src).toContain("deductCredits(args.userId, coutJumeau, 'avatar', referenceOperation('jumeau', generationId))");
  });

  for (const [nom, rushes] of [['avec 2 rushes', ['https://cdn.test/a.mp4', 'https://cdn.test/b.mp4']], ['sans rush', []]] as const) {
    it(`avatar ON ${nom} : GET = POST = avatar (lancement) + rendu (finalisation)`, async () => {
      configEnBase = ligne({ jumeau_avatar: true, rush_urls: [...rushes] });
      const { GET, POST } = await route();
      const devis = await (await GET()).json();
      expect(devis.cout).toBe(33 + 12);
      expect(devis.detail).toEqual({ rendu: 12, avatar: 33, affiche: 0 });

      // POST : contrôle le même total, LANCE le jumeau, ne rend ni ne débite rien lui-même.
      credits = 44;
      const refus = await POST();
      expect(refus.status).toBe(402);
      expect((await refus.json()).cout).toBe(devis.cout);
      credits = 45;
      const res = await POST();
      expect(res.status).toBe(200);
      expect((await res.json()).cout).toBe(devis.cout);
      expect(lancerJumeauMontage).toHaveBeenCalledTimes(1);
      expect(renderAndUpload).not.toHaveBeenCalled();
      expect(deductCredits).not.toHaveBeenCalled();

      // Finalisation (comme `rendreMontage`) : le rendu, débité une fois.
      const snap = lancerJumeauMontage.mock.calls[0][0] as { config: never; post: PreparedPost; jobId: string; slotKey: string };
      const { produireUnMontage } = await import('@/lib/autopilot/produire');
      await produireUnMontage({
        userId: 'u1', config: snap.config, post: snap.post, rang: 0, now: Date.now(),
        jobId: snap.jobId, slotKey: snap.slotKey, jumeauVideoUrl: 'https://cdn.test/jumeau.mp4',
      });
      // + la génération du jumeau, débitée par `genererVideoJumeau` au tarif avatar.jumeau (33).
      const total = debits().reduce((t, d) => t + d.montant, 0) + GRILLE['avatar.jumeau'];
      expect(total).toBe(devis.cout);
      expect(debits()).toHaveLength(1);
      // Aucune voix off synthétisée (le jumeau porte la voix) : aucun coût audio caché.
      expect(buildAutopilotVoices).not.toHaveBeenCalled();
    });
  }

  it('avatar ON + affiche de référence : la grille entière, débitée poste par poste', async () => {
    configEnBase = ligne({ jumeau_avatar: true, rush_urls: [], poster_mode: 'reference', poster_urls: ['https://cdn.test/moi.jpg'] });
    const { GET } = await route();
    const devis = await (await GET()).json();
    expect(devis.cout).toBe(12 + 33 + 7);
    const { produireUnMontage, configDepuisLigne } = await import('@/lib/autopilot/produire');
    await produireUnMontage({
      userId: 'u1', config: configDepuisLigne(configEnBase), post: postPrepare(null), rang: 0, now: Date.now(),
      jobId: 'job-r', slotKey: 'kr', jumeauVideoUrl: 'https://cdn.test/jumeau.mp4',
    });
    expect(debits().map((d) => d.montant).sort()).toEqual([12, 7].sort());
    expect(debits().reduce((t, d) => t + d.montant, 0) + GRILLE['avatar.jumeau']).toBe(devis.cout);
  });

  it('avatar OFF : le devis et le débit d avant (rendu seul), aucun lancement de jumeau', async () => {
    const { GET, POST } = await route();
    const devis = await (await GET()).json();
    expect(devis.cout).toBe(12);
    const res = await POST();
    expect(res.status).toBe(202);
    for (let i = 0; i < 400 && deductCredits.mock.calls.length === 0; i += 1) await new Promise((ok) => setTimeout(ok, 5));
    expect(debits().reduce((t, d) => t + d.montant, 0)).toBe(devis.cout);
    expect(lancerJumeauMontage).not.toHaveBeenCalled();
  });

  it('avatar OFF et 0 rush : refus 422 inchangé, rien débité', async () => {
    configEnBase = ligne({ rush_urls: [] });
    const { POST } = await route();
    const res = await POST();
    expect(res.status).toBe(422);
    expect(deductCredits).not.toHaveBeenCalled();
  });
});
