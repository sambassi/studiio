import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * P0-S — LE JETON SOCIAL NE DOIT PAS ATTEINDRE LE NAVIGATEUR.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS PROTEGENT
 * ---------------------------------------------------------------------------
 *
 * `GET /api/social/accounts` faisait `select('*')` sur `social_accounts`. La
 * table porte `access_token` et `refresh_token` — le jeton de publication
 * Meta, TikTok et YouTube. Ils partaient donc en clair dans une reponse JSON,
 * et l'ecran des reseaux les recopiait dans `localStorage`, ou ils survivaient
 * a la session. Un jeton Meta permet de publier sur la Page ; un
 * `refresh_token` Google en refabrique un indefiniment.
 *
 * La preuve recherchee n'est PAS un code de retour : c'est (1) la liste de
 * colonnes reellement transmise a PostgREST, et (2) le texte integral de la
 * reponse rendue au navigateur. Les deux, parce qu'une liste blanche juste
 * avec une serialisation qui la contourne ne protegerait rien.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CERTAINS TESTS LISENT LE SOURCE
 * ---------------------------------------------------------------------------
 *
 * `/api/cron/debug` et `/api/cron/publish` sont des handlers de plusieurs
 * centaines de lignes dont l'execution demanderait un faux client si large
 * qu'il testerait surtout lui-meme. Le depot a deja tranche ce compromis
 * (`cron-publish-brouillon.test.ts`) : pour un invariant qui se lit sur une
 * ligne, on lit la ligne.
 */

const authMock = vi.fn();

interface Appel {
  table: string;
  colonnes: string | null;
  filtres: Record<string, unknown>;
}

const appels: Appel[] = [];

/**
 * Toute ecriture qui atteint PostgREST, quelle qu'en soit la forme.
 *
 * C'est la SEULE preuve qui compte pour l'affectation de masse : ni le code de
 * retour, ni le corps rendu, mais les valeurs effectivement transmises. Un
 * tableau vide veut dire qu'aucun chemin d'ecriture n'existe.
 */
interface Ecriture { table: string; op: 'insert' | 'upsert' | 'update'; valeurs: unknown }
const ecritures: Ecriture[] = [];

let lignes: unknown[] = [];
let ligneUnique: Record<string, unknown> | null = null;

function makeQuery(table: string) {
  const appel: Appel = { table, colonnes: null, filtres: {} };
  const api: Record<string, unknown> = {
    select: (colonnes?: string) => { appel.colonnes = colonnes ?? null; return api; },
    insert: (valeurs: unknown) => { ecritures.push({ table, op: 'insert', valeurs }); return api; },
    upsert: (valeurs: unknown) => { ecritures.push({ table, op: 'upsert', valeurs }); return api; },
    update: (valeurs: unknown) => { ecritures.push({ table, op: 'update', valeurs }); return api; },
    eq: (cle: string, valeur: unknown) => { appel.filtres[cle] = valeur; return api; },
    single: async () => { appels.push(appel); return { data: ligneUnique, error: null }; },
    maybeSingle: async () => { appels.push(appel); return { data: ligneUnique, error: null }; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      appels.push(appel);
      return Promise.resolve({ data: lignes, error: null }).then(ok, ko);
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  supabase: { from: (table: string) => makeQuery(table) },
}));
vi.mock('@/lib/social/whatsapp', () => ({ canUseWhatsApp: () => false }));

const comptes = await import('@/app/api/social/accounts/route');
const statut = await import('@/app/api/social/status/route');

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';

/** Une ligne telle que la base la porte VRAIMENT, jetons compris. */
const LIGNE_COMPLETE = {
  id: 'sa-1',
  user_id: UID,
  platform: 'instagram',
  account_id: '17841400000000000',
  account_name: 'afroboost',
  access_token: 'EAAG_JETON_DE_PAGE_META_TRES_SECRET_0123456789',
  refresh_token: '1//04_JETON_DE_RAFRAICHISSEMENT_GOOGLE',
  expires_at: '2026-12-31T00:00:00.000Z',
  connected: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

/** Ce que PostgREST rendrait REELLEMENT sous la liste blanche. */
function projeter(ligne: Record<string, unknown>, colonnes: string | null) {
  if (!colonnes) return ligne;
  const gardees = colonnes.split(',').map((c) => c.trim());
  return Object.fromEntries(Object.entries(ligne).filter(([k]) => gardees.includes(k)));
}

const requete = () => new Request('https://studiio.pro/api/social/accounts') as never;

function lireSource(chemin: string): string {
  return readFileSync(resolve(process.cwd(), chemin), 'utf8');
}

beforeEach(() => {
  appels.length = 0;
  ecritures.length = 0;
  lignes = [];
  ligneUnique = null;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: UID, email: 'contact@example.com' } });
});

describe('P0-S — GET /api/social/accounts', () => {
  it('ne demande a la base AUCUNE colonne de jeton', async () => {
    lignes = [LIGNE_COMPLETE];
    await comptes.GET(requete());

    const appel = appels.find((a) => a.table === 'social_accounts');
    expect(appel).toBeDefined();
    expect(appel!.colonnes).toBeTruthy();
    expect(appel!.colonnes).not.toContain('*');
    expect(appel!.colonnes).not.toContain('access_token');
    expect(appel!.colonnes).not.toContain('refresh_token');
  });

  it('ne rend `access_token` ni comme cle ni comme valeur', async () => {
    lignes = [projeter(LIGNE_COMPLETE, comptes.SELECT_COMPTE_PUBLIC)];
    const reponse = await comptes.GET(requete());
    const texte = JSON.stringify(await reponse.json());

    expect(texte).not.toContain('access_token');
    expect(texte).not.toContain(LIGNE_COMPLETE.access_token);
  });

  it('ne rend `refresh_token` ni comme cle ni comme valeur', async () => {
    lignes = [projeter(LIGNE_COMPLETE, comptes.SELECT_COMPTE_PUBLIC)];
    const reponse = await comptes.GET(requete());
    const texte = JSON.stringify(await reponse.json());

    expect(texte).not.toContain('refresh_token');
    expect(texte).not.toContain(LIGNE_COMPLETE.refresh_token);
  });

  it('rend malgre tout de quoi AFFICHER la connexion', async () => {
    lignes = [projeter(LIGNE_COMPLETE, comptes.SELECT_COMPTE_PUBLIC)];
    const reponse = await comptes.GET(requete());
    const corps = await reponse.json() as { success: boolean; accounts: Record<string, unknown>[] };

    expect(corps.success).toBe(true);
    expect(corps.accounts).toHaveLength(1);
    expect(corps.accounts[0]).toMatchObject({
      platform: 'instagram',
      account_name: 'afroboost',
      connected: true,
      expires_at: '2026-12-31T00:00:00.000Z',
    });
  });

  it('reste filtre sur l utilisateur de la session', async () => {
    lignes = [];
    await comptes.GET(requete());

    const appel = appels.find((a) => a.table === 'social_accounts');
    expect(appel!.filtres).toEqual({ user_id: UID });
  });

  it('refuse une requete sans session', async () => {
    authMock.mockResolvedValue(null);
    const reponse = await comptes.GET(requete());

    expect(reponse.status).toBe(401);
    expect(appels).toHaveLength(0);
  });

});

describe('P0-S — aucune regression sur l etat des connexions', () => {
  it('/api/social/status continue d annoncer les quatre reseaux, sans jeton', async () => {
    lignes = [LIGNE_COMPLETE];
    const reponse = await statut.GET(requete());
    const corps = await reponse.json() as {
      success: boolean;
      platforms: Record<string, { connected: boolean; username: string | null; available: boolean }>;
    };
    const texte = JSON.stringify(corps);

    expect(corps.success).toBe(true);
    for (const reseau of ['instagram', 'facebook', 'tiktok', 'youtube']) {
      expect(corps.platforms[reseau]).toBeDefined();
    }
    // La connexion reste VUE comme connectee : c'est l'invariant produit.
    expect(corps.platforms.instagram.connected).toBe(true);
    expect(corps.platforms.instagram.username).toBe('afroboost');
    // ...et le jeton qui a servi a la decider ne sort pas.
    expect(texte).not.toContain('access_token');
    expect(texte).not.toContain(LIGNE_COMPLETE.access_token);
  });
});

describe('P0-S — les jetons ne fuient plus par les ecrans de diagnostic', () => {
  it('/api/cron/debug ne lit plus la colonne du jeton et n en rend plus de fragment', () => {
    const source = lireSource('src/app/api/cron/debug/route.ts');
    const requeteComptes = source.slice(
      source.indexOf("from('social_accounts')"),
      source.indexOf("from('social_accounts')") + 300,
    );

    expect(requeteComptes).not.toContain('access_token');
    // Le fragment `substring(0, 10)...substring(len - 5)` a disparu.
    expect(source).not.toMatch(/access_token:\s*a\.access_token/);
  });
});

describe('P0-S — les jetons ne fuient plus par les journaux', () => {
  it('la publication Instagram ne journalise plus de fragment de jeton', () => {
    const source = lireSource('src/app/api/cron/publish/route.ts');

    expect(source).not.toContain('tokenPreview');
    expect(source).not.toMatch(/accessToken\.substring\(/);
    // Le diagnostic reste possible : la PRESENCE du jeton est toujours dite.
    expect(source).toContain('hasToken=${!!accessToken}');
  });
});

describe('P0-S — le backend garde ses jetons', () => {
  it('le rafraichissement lit et reecrit toujours les jetons', () => {
    const source = lireSource('src/lib/social/token-refresh.ts');

    expect(source).toContain("from('social_accounts')");
    expect(source).toContain('access_token');
    expect(source).toContain('refresh_token');
  });

  it('les deux chemins de publication lisent toujours le jeton du compte', () => {
    for (const chemin of [
      'src/app/api/cron/publish/route.ts',
      'src/app/api/social/publish/route.ts',
    ]) {
      expect(lireSource(chemin)).toContain('access_token');
    }
  });

  it('la decision de connexion cote serveur lit toujours le jeton', () => {
    // `status` doit distinguer un vrai jeton de `demo_token` / `env_token` :
    // il LIT le jeton, il ne le REND pas. Les deux faits doivent coexister.
    const source = lireSource('src/app/api/social/status/route.ts');
    expect(source).toContain('acc.access_token');
  });
});

describe('P0-S — POST /api/social/accounts : plus aucune surface d ecriture', () => {
  /**
   * Le corps le plus hostile qu'un client puisse envoyer : il vise le
   * proprietaire, les deux jetons, l'etat de connexion, la peremption, et une
   * colonne inventee.
   */
  const CORPS_HOSTILE = {
    user_id: 'victime-0000-0000-0000-000000000000',
    platform: 'instagram',
    account_id: 'vole',
    account_name: 'compte-du-voisin',
    access_token: 'JETON_INJECTE_PAR_LE_CLIENT',
    refresh_token: 'RAFRAICHISSEMENT_INJECTE',
    expires_at: '2099-01-01T00:00:00.000Z',
    connected: true,
    colonne_inventee: 'valeur arbitraire',
  };

  function requetePost() {
    return new Request('https://studiio.pro/api/social/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CORPS_HOSTILE),
    }) as never;
  }

  it('la route n expose plus de gestionnaire POST', () => {
    // Sans export, Next.js repond 405. La surface n'est pas surveillee :
    // elle n'existe pas.
    expect((comptes as Record<string, unknown>).POST).toBeUndefined();
  });

  it('AUCUN export de cette route n ecrit dans social_accounts, meme nourri d un corps hostile', async () => {
    // La preuve ne porte pas sur un code de retour mais sur ce qui atteint
    // PostgREST : on passe le corps hostile a TOUT ce que le module exporte,
    // et on exige zero ecriture.
    for (const valeur of Object.values(comptes)) {
      if (typeof valeur !== 'function') continue;
      try { await (valeur as (r: never) => unknown)(requetePost()); } catch { /* sans objet ici */ }
    }
    expect(ecritures).toHaveLength(0);
  });

  it('ne peut pas ecrire au nom d un autre utilisateur', async () => {
    for (const valeur of Object.values(comptes)) {
      if (typeof valeur !== 'function') continue;
      try { await (valeur as (r: never) => unknown)(requetePost()); } catch { /* sans objet ici */ }
    }
    // Aucune ecriture du tout, donc aucune ecriture pour la victime.
    expect(ecritures.some((e) => JSON.stringify(e.valeurs).includes('victime'))).toBe(false);
    // Et la seule lecture faite reste bornee a la session.
    for (const lecture of appels.filter((a) => a.table === 'social_accounts')) {
      expect(lecture.filtres.user_id ?? UID).toBe(UID);
    }
  });

  it('n ecrit ni jeton, ni peremption, ni colonne inventee', async () => {
    for (const valeur of Object.values(comptes)) {
      if (typeof valeur !== 'function') continue;
      try { await (valeur as (r: never) => unknown)(requetePost()); } catch { /* sans objet ici */ }
    }
    const tout = JSON.stringify(ecritures);
    for (const interdit of [
      'access_token', 'refresh_token', 'JETON_INJECTE_PAR_LE_CLIENT',
      'RAFRAICHISSEMENT_INJECTE', 'colonne_inventee', '2099-01-01',
    ]) {
      expect(tout).not.toContain(interdit);
    }
  });

  it('le comportement legitime de la route — la LECTURE — est intact', async () => {
    lignes = [projeter(LIGNE_COMPLETE, comptes.SELECT_COMPTE_PUBLIC)];
    const reponse = await comptes.GET(requete());
    const corps = await reponse.json() as { success: boolean; accounts: unknown[] };

    expect(corps.success).toBe(true);
    expect(corps.accounts).toHaveLength(1);
    expect(ecritures).toHaveLength(0);
  });
});

describe('P0-S — le chemin legitime de creation reste entier', () => {
  it('le callback OAuth ecrit lui-meme, avec une liste de colonnes NOMMEE', () => {
    const source = lireSource('src/app/api/social/callback/route.ts');

    // Il n'est pas passe par la route publique : il ecrit directement...
    expect(source).not.toContain('/api/social/accounts');
    expect(source).toContain("from('social_accounts')");
    expect(source).toContain('.upsert(');
    expect(source).toContain("onConflict: 'user_id,platform'");
    // ...avec des colonnes nommees une a une, jamais un etalement du corps.
    for (const colonne of ['user_id', 'platform', 'account_id', 'account_name',
      'access_token', 'refresh_token', 'expires_at', 'connected']) {
      expect(source).toContain(`${colonne}:`);
    }
    expect(source).not.toMatch(/\.upsert\(\s*\{\s*\.\.\.body/);
  });

  it('le callback expose toujours son GET — le flux OAuth n est pas casse', async () => {
    const callback = await import('@/app/api/social/callback/route');
    expect(typeof callback.GET).toBe('function');
  });
});
