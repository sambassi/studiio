import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { lireSignedRequest, secretsMeta, signerPourTest } from '@/lib/rgpd/meta-signed-request';
import { estFichierDurable } from '@/lib/storage/bibliotheque';

/**
 * Adaptateurs réels de la suppression, branchés sur un FAUX client MinIO et
 * un FAUX supabaseAdmin. Aucun stockage, aucune base, aucun réseau.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const objets = new Map<string, string>(); // `${bucket}/${cle}` → contenu
const appelsListe: { bucket: string; prefixe: string; recursif: boolean }[] = [];
let erreursSuppression: Array<null | { Error?: { Code?: string } }> = [];

const fauxClient = {
  listObjectsV2(bucket: string, prefixe: string, recursif: boolean) {
    appelsListe.push({ bucket, prefixe, recursif });
    const e = new EventEmitter() as EventEmitter & { destroy: () => void };
    e.destroy = () => undefined;
    setTimeout(() => {
      for (const k of [...objets.keys()].sort()) {
        if (k.startsWith(`${bucket}/${prefixe}`)) e.emit('data', { name: k.slice(bucket.length + 1) });
      }
      e.emit('end');
    }, 0);
    return e;
  },
  async removeObjects(bucket: string, noms: string[]) {
    for (const n of noms) objets.delete(`${bucket}/${n}`);
    return erreursSuppression;
  },
  async putObject(bucket: string, cle: string, corps: Buffer) { objets.set(`${bucket}/${cle}`, corps.toString()); },
  async getObject(bucket: string, cle: string) {
    const v = objets.get(`${bucket}/${cle}`);
    if (v === undefined) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' });
    return Readable.from([Buffer.from(v)]);
  },
  async removeObject(bucket: string, cle: string) { objets.delete(`${bucket}/${cle}`); },
};
vi.mock('@/lib/storage/minio-client', () => ({ clientMinio: () => fauxClient }));

const requetes: { table: string; op: string; filtres: [string, string, unknown][] }[] = [];
let erreurBase: { code: string } | null = null;
function constructeur(table: string, op: string) {
  const filtres: [string, string, unknown][] = [];
  const q: any = {
    eq(c: string, v: unknown) { filtres.push(['eq', c, v]); return q; },
    in(c: string, v: unknown) { filtres.push(['in', c, v]); return q; },
    then(res: (v: unknown) => void) { requetes.push({ table, op, filtres }); res({ data: [], error: erreurBase }); },
  };
  return q;
}
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      delete: () => constructeur(table, 'delete'),
      update: () => constructeur(table, 'update'),
      select: () => constructeur(table, 'select'),
    }),
  },
}));

const ad = await import('@/lib/rgpd/adaptateurs');

beforeEach(() => {
  objets.clear();
  appelsListe.length = 0;
  requetes.length = 0;
  erreursSuppression = [];
  erreurBase = null;
  vi.stubEnv('STORAGE_PROVIDER', 's3');
});

describe('stockage MinIO', () => {
  it('liste RÉCURSIVEMENT sous le préfixe, borné', async () => {
    for (let i = 0; i < 5; i++) objets.set(`media/${A}/d${i}/f.jpg`, 'x');
    objets.set(`media/${B}/f.jpg`, 'x');
    const cles = await ad.stockageMinio().lister('media', `${A}/`, 3);
    expect(cles.length).toBe(3);
    expect(cles.every((c) => c.startsWith(`${A}/`))).toBe(true);
    expect(appelsListe[0].recursif).toBe(true);
  });

  it('refuse un préfixe vide ou sans séparateur final', async () => {
    await expect(ad.stockageMinio().lister('media', '', 10)).rejects.toThrow();
    await expect(ad.stockageMinio().lister('media', A, 10)).rejects.toThrow();
  });

  it('une seule erreur de suppression → exception (jamais un succès silencieux)', async () => {
    erreursSuppression = [{ Error: { Code: 'AccessDenied' } }];
    await expect(ad.stockageMinio().supprimer('media', [`${A}/x`])).rejects.toThrow();
    erreursSuppression = [{ Error: { Code: 'NoSuchKey' } }, null];
    await expect(ad.stockageMinio().supprimer('media', [`${A}/x`])).resolves.toBeUndefined();
  });

  it('sans STORAGE_PROVIDER=s3 → exception (pas de faux « terminé »)', async () => {
    vi.stubEnv('STORAGE_PROVIDER', '');
    await expect(ad.stockageMinio().lister('media', `${A}/`, 10)).rejects.toThrow('stockage_non_configure');
  });
});

describe('registre et liens Meta', () => {
  it('registre : aller-retour sous media/suppressions/<code>.json, code malformé ignoré', async () => {
    const r = ad.registreMinio();
    const code = 'a'.repeat(32);
    await r.ecrire({ code } as any);
    expect(objets.has(`media/suppressions/${code}.json`)).toBe(true);
    expect((await r.lire(code))?.code).toBe(code);
    expect(await r.lire('../x')).toBeNull();
    expect(await r.lire('b'.repeat(32))).toBeNull();
  });

  it('liens : enregistrés à la connexion, résolus, retirés pour un compte sans toucher les autres', async () => {
    ad.enregistrerLienMetaSilencieux('facebook', '1000001', A);
    ad.enregistrerLienMetaSilencieux('facebook', '1000002', B);
    await new Promise((r) => setTimeout(r, 10));
    const l = ad.liensMetaMinio();
    expect(await l.resoudre('facebook', '1000001')).toBe(A);
    expect(await l.resoudre('instagram', '1000001')).toBeNull();
    // L'identifiant Meta n'apparaît jamais en clair dans les clés.
    expect([...objets.keys()].some((k) => k.includes('1000001'))).toBe(false);
    await l.supprimerPourCompte(A);
    expect(await l.resoudre('facebook', '1000001')).toBeNull();
    expect(await l.resoudre('facebook', '1000002')).toBe(B);
    // Toutes les clés restantes sont durables (épargnées par la rétention).
    for (const k of objets.keys()) expect(estFichierDurable(k), k).toBe(true);
  });

  it('lien ignoré si identifiant ou uid invalide, ou sans stockage S3', async () => {
    ad.enregistrerLienMetaSilencieux('facebook', 'abc', A);
    ad.enregistrerLienMetaSilencieux('facebook', '1', 'pas-un-uuid');
    vi.stubEnv('STORAGE_PROVIDER', '');
    ad.enregistrerLienMetaSilencieux('facebook', '1000001', A);
    await new Promise((r) => setTimeout(r, 10));
    expect(objets.size).toBe(0);
  });
});

describe('base PostgREST', () => {
  it('jamais de DELETE/UPDATE sans filtre', async () => {
    const b = ad.baseSupabase();
    expect((await b.supprimer('videos', [])).erreur).toBe('sans_filtre');
    expect((await b.mettreAJour('users', { name: '' }, [])).erreur).toBe('sans_filtre');
    expect(requetes.length).toBe(0);
  });

  it('applique les filtres ; table absente stricte (42P01/PGRST205), colonne absente = erreur', async () => {
    const b = ad.baseSupabase();
    await b.supprimer('social_accounts', [{ colonne: 'user_id', op: 'eq', valeur: A }, { colonne: 'platform', op: 'in', valeur: ['facebook'] }]);
    expect(requetes[0].filtres).toEqual([['eq', 'user_id', A], ['in', 'platform', ['facebook']]]);
    erreurBase = { code: 'PGRST205' };
    expect(await b.supprimer('chat_logs', [{ colonne: 'user_id', op: 'eq', valeur: A }])).toEqual({ erreur: 'PGRST205', tableAbsente: true });
    erreurBase = { code: '42703' };
    expect((await b.supprimer('videos', [{ colonne: 'user_id', op: 'eq', valeur: A }])).tableAbsente).toBe(false);
  });
});

describe('signed_request Meta', () => {
  const S = 'secret-fb';
  it('signature valide → appli + identifiant ; secret Instagram distinct reconnu', () => {
    expect(lireSignedRequest(signerPourTest({ algorithm: 'HMAC-SHA256', user_id: '42' }, S), [{ appli: 'facebook', secret: S }]))
      .toEqual({ ok: true, appli: 'facebook', metaUserId: '42', emisLe: null });
    const env = { FACEBOOK_CLIENT_SECRET: S, META_INSTAGRAM_APP_SECRET: 'secret-ig' } as any;
    const r = lireSignedRequest(signerPourTest({ algorithm: 'HMAC-SHA256', user_id: 7 }, 'secret-ig'), secretsMeta(env));
    expect(r).toMatchObject({ ok: true, appli: 'instagram', metaUserId: '7' });
  });

  it.each([
    [undefined, 'absente'], ['', 'absente'], ['a.b.c', 'malformee'], ['x'.repeat(5000), 'malformee'],
    ['!!.??', 'malformee'],
  ])('%j → %s', (v, raison) => {
    expect(lireSignedRequest(v, [{ appli: 'facebook', secret: S }])).toEqual({ ok: false, raison });
  });

  it('sans secret configuré → refus', () => {
    expect(lireSignedRequest('a.b', [])).toEqual({ ok: false, raison: 'sans_secret' });
  });

  it('user_id non numérique refusé', () => {
    expect(lireSignedRequest(signerPourTest({ algorithm: 'HMAC-SHA256', user_id: '../1' }, S), [{ appli: 'facebook', secret: S }]))
      .toEqual({ ok: false, raison: 'sans_utilisateur' });
  });
});
