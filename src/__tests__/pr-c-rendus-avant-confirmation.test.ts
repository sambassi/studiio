/**
 * PR-C — un rendu n'est ni lisible par autrui avant sa confirmation, ni
 * reecrivable apres elle.
 *
 * Ce qui etait vrai avant (audit securite/facturation, point 1) :
 *
 *   - `/api/render/jobs` remettait, DES LA RESERVATION, une URL presignee PUT
 *     valable 900 s sur la cle du rendu. MinIO ne connait pas l'etat
 *     `confirmed` : pendant tout ce temps, la meme URL reecrivait le montage
 *     deja paye.
 *
 * Ce que ces tests figent :
 *
 *   1. la reservation ne remet plus aucune URL presignee ;
 *   2. la cible directe est demandee APRES la composition (`POST …/upload`), courte
 *      (`PRESIGNE_TTL_S`, justifiee par la taille maximale), et ne vise que le
 *      DEPOT, jamais la cle du rendu ;
 *   3. `/confirm` recopie le depot sur la cle du rendu tant que la tentative
 *      est `reserved`, puis plus jamais : un envoi tardif n'atteint pas le
 *      montage confirme ;
 *   4. la cle du rendu (et son depot) ne se lit que par son proprietaire —
 *      ni anonyme, ni autre compte — sur le relais comme sur proxy-media ;
 *   5. le debit reste celui de `confirmerAvecPreuve` (une seule fois), et
 *      l'exemption admin (`partner_cost_only`) confirme toujours sans debit.
 *
 * Discriminants : sur l'ancien code, (1) la reservation rend `direct`, (2) la
 * methode `POST` de la route d'envoi n'existe pas et le TTL vaut 900, (3) la cle signee EST celle
 * du rendu, donc l'ecriture apres confirmation la remplace.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Doublures ────────────────────────────────────────────────────────────

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let ligne: Record<string, unknown> | null;
const debits: Array<{ taille: number }> = [];
const debitsSansCredit: Array<{ taille: number }> = [];
const clotures: Array<{ etat: string }> = [];

vi.mock('@/lib/rendus/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rendus/service')>('@/lib/rendus/service');
  return {
    ...actual,
    reserverRendu: async (_u: string, operation: string, format: string) => ({
      rendu: {
        id: 'job-1', bucket: 'media', cle: 'moi/rendus/job-1.webm',
        cout: 10, format, operation, politique: 'credits',
      },
    }),
    lireRendu: async (userId: string) => ({
      rendu: ligne && ligne.user_id === userId ? { ...ligne } : null,
      socleAbsent: false,
    }),
    confirmerRendu: async (_u: string, _i: string, taille: number) => {
      if (ligne?.etat === 'confirmed') {
        return { ok: true, etat: 'confirmed', solde: 90, dejaConfirme: true, motif: null };
      }
      debits.push({ taille });
      if (ligne) ligne.etat = 'confirmed';
      return { ok: true, etat: 'confirmed', solde: 90, dejaConfirme: false, motif: null };
    },
    confirmerRenduSansDebit: async (_u: string, _i: string, taille: number) => {
      debitsSansCredit.push({ taille });
      if (ligne) ligne.etat = 'confirmed';
      return { ok: true, etat: 'confirmed', dejaConfirme: false, motif: null };
    },
    cloreRendu: async (_u: string, _i: string, etat: string) => {
      clotures.push({ etat });
      if (ligne) ligne.etat = etat;
      return { ok: true, etat };
    },
  };
});

let politique: 'credits' | 'partner_cost_only' = 'credits';
vi.mock('@/lib/facturation/politique', async () => {
  const actual = await vi.importActual<typeof import('@/lib/facturation/politique')>('@/lib/facturation/politique');
  return {
    ...actual,
    politiqueDeLUtilisateur: async () => ({ politique, role: politique === 'credits' ? 'user' : 'admin' }),
  };
});

/** Un MinIO en memoire : cle -> objet. */
type Objet = { size: number; contenu: string; type: string };
const store = new Map<string, Objet>();
let statDepotEchoue = false;
const copies: Array<{ cible: string; source: string }> = [];
const signees: Array<{ cle: string; ttl: number }> = [];
let signeurActif = true;

const nonTrouve = () => Object.assign(new Error('Not Found'), { code: 'NotFound' });

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (b: string, c: string) => {
      if (statDepotEchoue && c.includes('.depot.')) throw new Error('connect ECONNREFUSED');
      const o = store.get(`${b}/${c}`);
      if (!o) throw nonTrouve();
      return { size: o.size, metaData: { 'content-type': o.type } };
    },
    putObject: async (b: string, c: string) => {
      store.set(`${b}/${c}`, { size: 2_000_000, contenu: 'relais', type: 'video/webm' });
      return {};
    },
    copyObject: async (b: string, c: string, source: string) => {
      const o = store.get(source.replace(/^\//, ''));
      if (!o) throw nonTrouve();
      copies.push({ cible: `${b}/${c}`, source });
      store.set(`${b}/${c}`, { ...o });
      return {};
    },
    removeObject: async (b: string, c: string) => { store.delete(`${b}/${c}`); },
  }),
  signeurPublic: () => (signeurActif ? {
    presignedPutObject: async (b: string, c: string, ttl: number) => {
      signees.push({ cle: c, ttl });
      return `https://minio.studiio.pro/${b}/${c}?X-Amz-Expires=${ttl}&X-Amz-Signature=zz`;
    },
  } : null),
}));

const { POST: RESERVER } = await import('@/app/api/render/jobs/route');
const { POST: CONFIRMER } = await import('@/app/api/render/jobs/[id]/confirm/route');
// `POST` = « ou envoyer ? » (PR-C), `PUT` = le relais.
const { PUT: RELAIS, POST: CIBLE } = await import('@/app/api/render/jobs/[id]/upload/route');
const { PRESIGNE_TTL_S, TAILLE_MAXIMALE, cleDepot } = await import('@/lib/rendus/cible-upload');
const { lectureRelaisAutorisee } = await import('@/lib/storage/politique-relais');
const { clePossedeePar } = await import('@/lib/storage/acces-objet');

const reserver = async () => {
  const r = await RESERVER({ json: async () => ({ operation: 'apercu', format: 'reel' }) } as never);
  return { status: r.status, body: await r.json() };
};
const cible = async (id = 'job-1') => {
  const r = await CIBLE({} as never, { params: { id } });
  return { status: r.status, body: await r.json() };
};
const confirmer = async (id = 'job-1') => {
  const r = await CONFIRMER({} as never, { params: { id } });
  return { status: r.status, body: await r.json() };
};

/** Ce que ferait MinIO d'un PUT sur l'URL presignee rendue au navigateur. */
const putSurUrlSignee = (url: string, contenu: string, size: number) => {
  const u = new URL(url);
  store.set(decodeURIComponent(u.pathname.replace(/^\//, '')), { size, contenu, type: 'video/webm' });
};

const FINAL = 'media/moi/rendus/job-1.webm';

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
  ligne = {
    id: 'job-1', user_id: 'moi', bucket: 'media', cle_objet: 'moi/rendus/job-1.webm',
    etat: 'reserved', cout: 10, format: 'reel', operation: 'apercu', politique: 'credits',
  };
  politique = 'credits';
  store.clear();
  copies.length = 0;
  signees.length = 0;
  debits.length = 0;
  debitsSansCredit.length = 0;
  clotures.length = 0;
  statDepotEchoue = false;
  signeurActif = true;
  process.env.MINIO_PUBLIC_ENDPOINT = 'minio.studiio.pro';
});
afterEach(() => { delete process.env.MINIO_PUBLIC_ENDPOINT; });

// ────────────────────────────────────────────────────────────────────────────

describe('1. Reservation : aucune URL presignee, aucune URL lisible par autrui', () => {
  it('rend le relais same-origin, jamais une URL presignee, meme avec un endpoint public', async () => {
    const r = await reserver();
    expect(r.status).toBe(200);
    expect(r.body.uploadMode).toBe('relais');
    expect(r.body.uploadUrl).toBe('/api/render/jobs/job-1/upload');
    expect(JSON.stringify(r.body)).not.toMatch(/X-Amz|minio\.studiio\.pro/);
    expect(signees).toHaveLength(0);
  });

  it("l'URL de lecture rendue n'est lisible ni anonymement, ni par un autre compte", async () => {
    const r = await reserver();
    const m = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(r.body.publicUrl);
    expect(m).toBeTruthy();
    const [, bucket, cle] = m!;
    expect(await lectureRelaisAutorisee({ bucket, cle, session: async () => null })).toBe(false);
    expect(await lectureRelaisAutorisee({
      bucket, cle, session: async () => ({ userId: 'autrui', email: 'autrui@exemple.test' }),
    })).toBe(false);
    // Un jeton forge ne suffit pas.
    expect(await lectureRelaisAutorisee({ bucket, cle, jeton: 'faux', session: async () => null })).toBe(false);
    // Le proprietaire, lui, lit son montage.
    expect(await lectureRelaisAutorisee({
      bucket, cle, session: async () => ({ userId: 'moi', email: 'moi@exemple.test' }),
    })).toBe(true);
  });

  it("en mode direct, rien n'est a la cle du rendu avant la confirmation", async () => {
    const c = await cible();
    putSurUrlSignee(c.body.uploadUrl, 'montage', 2_000_000);
    expect(store.has(FINAL)).toBe(false);
  });

  it('proxy-media refuse la cle du rendu (et son depot) a un autre compte', () => {
    for (const cle of ['moi/rendus/job-1.webm', cleDepot('moi/rendus/job-1.webm')]) {
      expect(clePossedeePar(cle, 'autrui'), cle).toBe(false);
      expect(clePossedeePar(cle, 'moi'), cle).toBe(true);
    }
  });
});

describe('2. Presignee courte, demandee apres la composition, vers le depot', () => {
  it('la duree couvre le plus gros montage a 20 Mbit/s avec marge, et pas davantage', () => {
    const envoiS = (TAILLE_MAXIMALE * 8) / 20_000_000;
    expect(PRESIGNE_TTL_S).toBeGreaterThanOrEqual(Math.ceil(envoiS));
    expect(PRESIGNE_TTL_S).toBeLessThanOrEqual(300);
  });

  it('POST …/upload rend une URL presignee de PRESIGNE_TTL_S vers le DEPOT', async () => {
    const c = await cible();
    expect(c.status).toBe(200);
    expect(c.body.uploadMode).toBe('direct');
    expect(c.body.expireDansS).toBe(PRESIGNE_TTL_S);
    expect(signees).toEqual([{ cle: 'moi/rendus/job-1.depot.webm', ttl: PRESIGNE_TTL_S }]);
    expect(signees[0].cle).not.toBe('moi/rendus/job-1.webm');
  });

  it("sans endpoint public, POST …/upload rend le relais", async () => {
    signeurActif = false;
    const c = await cible();
    expect(c.body).toMatchObject({ ok: true, uploadMode: 'relais', uploadUrl: '/api/render/jobs/job-1/upload' });
  });

  it('la tentative d un autre compte est introuvable', async () => {
    authMock.mockResolvedValue({ user: { id: 'autrui' } });
    const c = await cible();
    expect(c.status).toBe(404);
    expect(signees).toHaveLength(0);
  });

  it('sans session : 401', async () => {
    authMock.mockResolvedValue(null);
    expect((await cible()).status).toBe(401);
  });

  ['confirmed', 'cancelled', 'failed'].forEach((etat) => {
    it(`tentative « ${etat} » : aucune nouvelle URL d'ecriture`, async () => {
      ligne!.etat = etat;
      const c = await cible();
      expect(c.status).toBe(409);
      expect(c.body.motif).toBe('non_reserve');
      expect(signees).toHaveLength(0);
    });
  });

  it('une vraie signature MinIO porte X-Amz-Expires = PRESIGNE_TTL_S et la cle du depot', async () => {
    const { Client } = await vi.importActual<typeof import('minio')>('minio');
    const reel = new Client({
      endPoint: 'minio.studiio.pro', port: 443, useSSL: true,
      accessKey: 'test', secretKey: 'test-secret', region: 'us-east-1',
    });
    const { cibleTeleversement } = await import('@/lib/rendus/cible-upload');
    const c = await cibleTeleversement('job-1', 'media', 'moi/rendus/job-1.webm', reel as never);
    expect(c.mode).toBe('direct');
    const u = new URL(c.url);
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(PRESIGNE_TTL_S));
    expect(u.pathname).toBe('/media/moi/rendus/job-1.depot.webm');
  });
});

describe('3. Confirmation : le depot est promu une fois, puis plus jamais', () => {
  it('upload direct -> confirm : le montage arrive a la cle du rendu, debite UNE fois', async () => {
    const c = await cible();
    putSurUrlSignee(c.body.uploadUrl, 'montage-paye', 2_000_000);
    const r = await confirmer();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, etat: 'confirmed', politique: 'credits' });
    expect(store.get(FINAL)?.contenu).toBe('montage-paye');
    expect(debits).toEqual([{ taille: 2_000_000 }]);
    // Le depot est retire.
    expect(store.has('media/moi/rendus/job-1.depot.webm')).toBe(false);
  });

  it('ecriture APRES confirmation avec la meme URL (encore valide) : le rendu paye ne change pas', async () => {
    const c = await cible();
    putSurUrlSignee(c.body.uploadUrl, 'montage-paye', 2_000_000);
    expect((await confirmer()).status).toBe(200);

    // L'URL presignee ne se revoque pas : on la rejoue apres la confirmation.
    putSurUrlSignee(c.body.uploadUrl, 'autre-montage', 720);
    const again = await confirmer();
    expect(again.body).toMatchObject({ ok: true, dejaConfirme: true });
    expect(store.get(FINAL)).toEqual({ size: 2_000_000, contenu: 'montage-paye', type: 'video/webm' });
    expect(copies).toHaveLength(1);
    expect(debits).toHaveLength(1);
  });

  it('ecriture apres confirmation par le relais : refusee (409), rien n est ecrit', async () => {
    ligne!.etat = 'confirmed';
    store.set(FINAL, { size: 2_000_000, contenu: 'montage-paye', type: 'video/webm' });
    const req = {
      headers: { get: (k: string) => ({ 'content-type': 'video/webm', 'content-length': '720' } as Record<string, string>)[k.toLowerCase()] ?? null },
      body: new ReadableStream({ start(ctl) { ctl.enqueue(new Uint8Array([1])); ctl.close(); } }),
    };
    const r = await RELAIS(req as never, { params: { id: 'job-1' } });
    expect(r.status).toBe(409);
    expect(store.get(FINAL)?.contenu).toBe('montage-paye');
  });

  it('flux relais (aucun depot) : confirmation inchangee', async () => {
    store.set(FINAL, { size: 3_000_000, contenu: 'relais', type: 'video/webm' });
    const r = await confirmer();
    expect(r.status).toBe(200);
    expect(copies).toHaveLength(0);
    expect(debits).toEqual([{ taille: 3_000_000 }]);
  });

  it('aucun objet nulle part : echec, tentative close, aucun debit', async () => {
    const r = await confirmer();
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('objet_absent');
    expect(clotures).toEqual([{ etat: 'failed' }]);
    expect(debits).toHaveLength(0);
  });

  it('stockage injoignable sur le depot : 503, tentative laissee ouverte, aucun debit', async () => {
    statDepotEchoue = true;
    const r = await confirmer();
    expect(r.status).toBe(503);
    expect(r.body.motif).toBe('stockage_injoignable');
    expect(clotures).toHaveLength(0);
    expect(debits).toHaveLength(0);
  });

  it("tentative annulee : le depot n'est jamais promu, et reste illisible pour autrui", async () => {
    const c = await cible();
    putSurUrlSignee(c.body.uploadUrl, 'montage', 2_000_000);
    ligne!.etat = 'cancelled';
    await confirmer();
    expect(copies).toHaveLength(0);
    expect(store.has(FINAL)).toBe(false);
    const depot = cleDepot('moi/rendus/job-1.webm');
    expect(await lectureRelaisAutorisee({ bucket: 'media', cle: depot, session: async () => null })).toBe(false);
    expect(await lectureRelaisAutorisee({
      bucket: 'media', cle: depot, session: async () => ({ userId: 'autrui', email: 'a@exemple.test' }),
    })).toBe(false);
  });

  it('exemption admin : promu et confirme SANS debit de credits', async () => {
    politique = 'partner_cost_only';
    ligne!.politique = 'partner_cost_only';
    const c = await cible();
    putSurUrlSignee(c.body.uploadUrl, 'montage-admin', 2_000_000);
    const r = await confirmer();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, politique: 'partner_cost_only', balance: null });
    expect(store.get(FINAL)?.contenu).toBe('montage-admin');
    expect(debits).toHaveLength(0);
    expect(debitsSansCredit).toEqual([{ taille: 2_000_000 }]);
  });

  it("sans endpoint public configure, la confirmation ne tente aucune promotion", async () => {
    delete process.env.MINIO_PUBLIC_ENDPOINT;
    store.set('media/moi/rendus/job-1.depot.webm', { size: 2_000_000, contenu: 'x', type: 'video/webm' });
    store.set(FINAL, { size: 3_000_000, contenu: 'relais', type: 'video/webm' });
    await confirmer();
    expect(copies).toHaveLength(0);
    expect(store.get(FINAL)?.contenu).toBe('relais');
  });
});

describe('4. Navigateur : la cible vient de POST …/upload, le montage n est livre qu apres /confirm', () => {
  const vraiFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = vraiFetch; });

  const poser = (o: { cible?: unknown; put?: number; confirm?: boolean }) => {
    const appels: Array<{ m: string; u: string; cred?: string }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      appels.push({ m: String(init?.method ?? 'GET'), u, cred: init?.credentials });
      const rep = (ok: boolean, status: number, corps: unknown) => ({ ok, status, json: async () => corps });
      if (u === '/api/render/jobs') {
        return rep(true, 200, {
          ok: true, jobId: 'j1', uploadUrl: '/api/render/jobs/j1/upload', uploadMode: 'relais',
          publicUrl: '/storage/v1/object/public/media/moi/rendus/j1.webm', cout: 10,
        });
      }
      if (u.endsWith('/upload') && init?.method === 'POST') return rep(true, 200, o.cible ?? { ok: false });
      if (init?.method === 'PUT') return rep((o.put ?? 200) < 300, o.put ?? 200, {});
      if (u.endsWith('/confirm')) {
        return o.confirm === false
          ? rep(false, 402, { ok: false, etat: 'reserved', motif: 'solde_insuffisant' })
          : rep(true, 200, { ok: true, etat: 'confirmed' });
      }
      return rep(true, 200, { ok: true, etat: 'cancelled' });
    }) as unknown as typeof fetch;
    return appels;
  };
  const blob = () => new Blob(['x'.repeat(50_000)], { type: 'video/webm' });

  it('PUT vers l URL de POST …/upload, sans cookie, puis confirm, puis livraison', async () => {
    const appels = poser({ cible: { ok: true, uploadUrl: 'https://minio.studiio.pro/media/moi/rendus/j1.depot.webm?X-Amz-Expires=300', uploadMode: 'direct' } });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'apercu', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('/storage/v1/object/public/media/moi/rendus/j1.webm');
    const put = appels.find((a) => a.m === 'PUT')!;
    expect(put.u).toContain('j1.depot.webm');
    expect(put.cred).toBeUndefined();
    expect(appels.map((a) => a.u.split('?')[0].replace(/^https:\/\/[^/]+/, ''))).toEqual([
      '/api/render/jobs', '/api/render/jobs/j1/upload', '/media/moi/rendus/j1.depot.webm', '/api/render/jobs/j1/confirm',
    ]);
  });

  it('presignee expiree (403) : aucune confirmation, tentative fermee, rien livre', async () => {
    const appels = poser({ cible: { ok: true, uploadUrl: 'https://minio.studiio.pro/x?X-Amz-Expires=300', uploadMode: 'direct' }, put: 403 });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('televersement');
    expect(r.url).toBeUndefined();
    expect(appels.some((a) => a.u.endsWith('/confirm'))).toBe(false);
    expect(appels.some((a) => a.u.endsWith('/cancel'))).toBe(true);
  });

  it('serveur sans POST …/upload : repli sur le relais de la reservation, avec cookie', async () => {
    const appels = poser({ cible: { ok: false } });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'apercu', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(true);
    const put = appels.find((a) => a.m === 'PUT')!;
    expect(put.u).toBe('/api/render/jobs/j1/upload');
    expect(appels.filter((a) => a.u === '/api/render/jobs/j1/upload').map((a) => a.m)).toEqual(['POST', 'PUT']);
    expect(put.cred).toBe('include');
  });

  it('confirmation refusee : aucune URL livree', async () => {
    poser({ confirm: false });
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'apercu', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(false);
    expect(r.url).toBeUndefined();
    expect(r.blob).toBeUndefined();
  });
});
