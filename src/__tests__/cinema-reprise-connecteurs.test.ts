// @vitest-environment node
/**
 * CINEMA IA — les connecteurs ecrivent l'identifiant de la demande AVANT d'attendre, et
 * savent RELIRE une demande sans jamais en soumettre une nouvelle. Reseau entierement
 * simule : aucun appel sortant.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const r = vi.hoisted(() => ({
  progressId: 'p1abc2def3ghi4' as string | null,
  surRun: null as null | (() => Promise<void>),
}));

// Client Replicate simule : `run` appelle `progress` des la creation, comme le SDK 1.4.
vi.mock('replicate', () => ({
  default: class {
    async run(_m: string, _o: unknown, progress?: (p: { id: string }) => void) {
      if (progress && r.progressId) progress({ id: r.progressId });
      if (r.surRun) await r.surRun();
      return ['https://replicate.delivery/sortie.webp'];
    }
  },
}));

const { FOURNISSEUR_HIGGSFIELD_IMAGE, consulterHiggsfield, BASE_HIGGSFIELD, MODELE_IMAGE_HF, reseauMedia } = await import('@/lib/cinema/generation/higgsfield');
const { FOURNISSEUR_REPLICATE_IMAGE, consulterReplicate } = await import('@/lib/cinema/generation/replicate');

/**
 * RESEAU SIMULE des transferts de medias Higgsfield : la resolution DNS est simulee et
 * l'envoi passe par le `fetch` remplace de chaque test, APRES la verification d'adresse de
 * `lookupSur` — comme la connexion reelle. Rien ne sort de la machine.
 */
const resoudreSimule = async (hote: string) => [{ address: DNS[hote] ?? '93.184.216.34', family: 4 }];
const DNS: Record<string, string> = {};
const envoiSimule = (url: string, init: unknown, lookup: unknown) => new Promise<Response>((ok, ko) => {
  (lookup as (h: string, o: object, cb: (e: Error | null) => void) => void)(new URL(url).hostname, { all: true }, (e) => {
    if (e) { ko(e); return; }
    Promise.resolve((globalThis.fetch as unknown as (u: string, i: unknown) => Promise<Response>)(url, init)).then(ok, ko);
  });
});
beforeEach(() => {
  for (const k of Object.keys(DNS)) delete DNS[k];
  reseauMedia.envoyer = envoiSimule as never;
  reseauMedia.resoudre = resoudreSimule;
});

const ENV0 = { ...process.env };
const UUID = '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71';
afterEach(() => { process.env = { ...ENV0 }; vi.unstubAllGlobals(); r.surRun = null; reseauMedia.envoyer = undefined; reseauMedia.resoudre = undefined; });

const json = (statut: number, corps: unknown) => ({
  ok: statut >= 200 && statut < 300, status: statut, json: async () => corps,
  get body() { return new Response(new Uint8Array(4096)).body; },
} as unknown as Response);
const media = () => new Response(new Uint8Array(4096), { status: 200 });

describe('Higgsfield : suivi de la soumission', () => {
  beforeEach(() => {
    process.env = { ...ENV0, CINEMA_FOURNISSEUR: 'higgsfield', CINEMA_GENERATION_REELLE: 'true', HIGGSFIELD_API_KEY_ID: 'k', HIGGSFIELD_API_KEY_SECRET: 's' } as NodeJS.ProcessEnv;
  });

  it('la cle d’idempotence ECRITE par l’appelant est celle envoyee, et l’identifiant est enregistre AVANT la premiere attente', async () => {
    const journal: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/estimate/')) return json(200, { usd: '0.002' });
      if (url.endsWith(MODELE_IMAGE_HF)) {
        journal.push(`soumission:${(init?.headers as Record<string, string>)['Idempotency-Key']}`);
        return json(200, { status: 'queued', request_id: UUID, status_url: `${BASE_HIGGSFIELD}/requests/${UUID}/status` });
      }
      if (url.endsWith('/status')) { journal.push('attente'); return json(200, { status: 'completed', images: [{ url: 'https://cdn.example/i.jpg' }] }); }
      return media();
    }));
    const res = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage({
      promptPlan: 'p', promptConstruit: 'a shot', personnages: [], format: '16:9', graine: 1,
      suivi: { cleIdempotence: 'cle-ecrite-avant', surAcceptation: async (id) => { journal.push(`acceptee:${id}`); } },
    });
    expect(res.ok).toBe(true);
    expect(journal).toEqual(['soumission:cle-ecrite-avant', `acceptee:${UUID}`, 'attente']);
  });

  it('un echec d’ecriture de l’identifiant n’interrompt pas la generation deja payee', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/estimate/')) return json(200, { usd: '0.002' });
      if (url.endsWith(MODELE_IMAGE_HF)) return json(200, { status: 'queued', request_id: UUID, status_url: `${BASE_HIGGSFIELD}/requests/${UUID}/status` });
      if (url.endsWith('/status')) return json(200, { status: 'completed', images: [{ url: 'https://cdn.example/i.jpg' }] });
      return media();
    }));
    const res = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage({
      promptPlan: 'p', promptConstruit: 'a', personnages: [], format: '16:9', graine: 1,
      suivi: { cleIdempotence: 'c', surAcceptation: async () => { throw new Error('base injoignable'); } },
    });
    expect(res.ok).toBe(true);
  });

  it.each([
    [{ status: 'queued' }, 'en_cours'],
    [{ status: 'in_progress' }, 'en_cours'],
    [{ status: 'failed' }, 'echec'],
    [{ status: 'nsfw' }, 'echec'],
    [{ status: 'canceled' }, 'echec'],
    [{ status: 'completed', images: [] }, 'echec'],
    [{ status: 'quelque-chose' }, 'injoignable'],
  ])('consulter %j → %s, par une simple LECTURE de statut', async (corps, attendu) => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(200, corps));
    vi.stubGlobal('fetch', f);
    const e = await consulterHiggsfield(UUID, 'image');
    expect(e.etat).toBe(attendu);
    if (e.etat === 'echec') expect(e.nonFacture).toBe(corps.status !== 'completed');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(`${BASE_HIGGSFIELD}/requests/${UUID}/status`);
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'GET' });
  });

  it('termine : le media est rapatrie en local', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/status')
      ? json(200, { status: 'completed', images: [{ url: 'https://cdn.example/i.jpg' }] }) : media())));
    expect((await consulterHiggsfield(UUID, 'image')).etat).toBe('termine');
  });

  it('404 : introuvable ; reseau coupe : injoignable ; identifiant hors forme : jamais envoye', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, null)));
    expect((await consulterHiggsfield(UUID, 'image')).etat).toBe('introuvable');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect((await consulterHiggsfield(UUID, 'image')).etat).toBe('injoignable');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await consulterHiggsfield('../../estimate/x', 'image')).etat).toBe('introuvable');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('Replicate : suivi de la prediction', () => {
  beforeEach(() => {
    process.env = { ...ENV0, CINEMA_GENERATION_REELLE: 'true', REPLICATE_API_TOKEN: 'r8_test' } as NodeJS.ProcessEnv;
    vi.stubGlobal('fetch', vi.fn(async () => media()));
  });

  it('l’identifiant est enregistre DES la creation, pendant que la prediction tourne encore', async () => {
    const journal: string[] = [];
    r.surRun = async () => { journal.push('prediction en cours'); };
    const res = await FOURNISSEUR_REPLICATE_IMAGE.genererImage({
      promptPlan: 'p', promptConstruit: 'a', personnages: [], format: '9:16', graine: 1,
      suivi: { cleIdempotence: 'c', surAcceptation: async (id) => { journal.push(`acceptee:${id}`); } },
    });
    expect(res.ok).toBe(true);
    expect(journal).toEqual(['acceptee:p1abc2def3ghi4', 'prediction en cours']);
  });

  it('sans suivi : comportement d’avant, inchange', async () => {
    const res = await FOURNISSEUR_REPLICATE_IMAGE.genererImage({ promptPlan: 'p', promptConstruit: 'a', personnages: [], format: '9:16', graine: 1 });
    expect(res.ok).toBe(true);
  });

  const client = (p: unknown, erreur?: unknown) => ({
    predictions: { get: vi.fn(async () => { if (erreur) throw erreur; return p; }) },
  }) as never;

  it.each([
    [{ status: 'starting' }, 'en_cours'],
    [{ status: 'processing' }, 'en_cours'],
    [{ status: 'succeeded', output: ['https://replicate.delivery/x.webp'] }, 'termine'],
    [{ status: 'failed' }, 'echec'],
    [{ status: 'canceled' }, 'echec'],
  ])('consulter %j → %s ; un echec reste suppose FACTURE', async (p, attendu) => {
    const e = await consulterReplicate('p1abc2def3ghi4', 'image', { client: client(p) });
    expect(e.etat).toBe(attendu);
    if (e.etat === 'echec') expect(e.nonFacture).toBe(false);
  });

  it('404 : introuvable ; autre erreur : injoignable ; identifiant hors forme : jamais lu', async () => {
    expect((await consulterReplicate('p1abc2def3ghi4', 'image', { client: client(null, { response: { status: 404 } }) })).etat).toBe('introuvable');
    expect((await consulterReplicate('p1abc2def3ghi4', 'image', { client: client(null, new Error('timeout')) })).etat).toBe('injoignable');
    const c = client({ status: 'succeeded' });
    expect((await consulterReplicate('../x', 'image', { client: c })).etat).toBe('introuvable');
    expect((c as unknown as { predictions: { get: ReturnType<typeof vi.fn> } }).predictions.get).not.toHaveBeenCalled();
  });
});

describe('Higgsfield : l’API ne redirige JAMAIS (ses appels portent les cles)', () => {
  const UUID2 = '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71';
  beforeEach(() => {
    process.env = { ...ENV0, CINEMA_FOURNISSEUR: 'higgsfield', CINEMA_GENERATION_REELLE: 'true', HIGGSFIELD_API_KEY_ID: 'k', HIGGSFIELD_API_KEY_SECRET: 's' } as NodeJS.ProcessEnv;
  });

  it('estimation, soumission, statut : tous demandent `redirect: error`', async () => {
    const options: Array<{ url: string; redirect: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      options.push({ url, redirect: init?.redirect });
      if (url.includes('/estimate/')) return json(200, { usd: '0.002' });
      if (url.endsWith(MODELE_IMAGE_HF)) return json(200, { status: 'queued', request_id: UUID2, status_url: `${BASE_HIGGSFIELD}/requests/${UUID2}/status` });
      if (url.endsWith('/status')) return json(200, { status: 'completed', images: [{ url: 'https://cdn.example/i.jpg' }] });
      return media();
    }));
    await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage({ promptPlan: 'p', promptConstruit: 'a', personnages: [], format: '16:9', graine: 1 });
    await consulterHiggsfield(UUID2, 'image');
    const api = options.filter((o) => o.url.startsWith(BASE_HIGGSFIELD));
    expect(api.length).toBeGreaterThanOrEqual(4);
    for (const o of api) expect(o.redirect, o.url).toBe('error');
  });

  it('une redirection a la SOUMISSION est un echec prudent : `incertain`, jamais « rien n’est parti »', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/estimate/')) return json(200, { usd: '0.002' });
      if (url.endsWith(MODELE_IMAGE_HF)) throw new TypeError('fetch failed: unexpected redirect');
      return media();
    }));
    const r = await FOURNISSEUR_HIGGSFIELD_IMAGE.genererImage({ promptPlan: 'p', promptConstruit: 'a', personnages: [], format: '16:9', graine: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.incertain).toBe(true); expect(r.jamaisEnvoye).toBeFalsy(); }
  });
});
