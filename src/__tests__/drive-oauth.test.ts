import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Connexion Google Drive — OAuth.
 *
 * Le connecteur social historique transporte le `userId` en clair dans le
 * `state` (`userId:timestamp:random`) et son callback le reprend tel quel :
 * appeler ce callback avec l'identifiant d'un tiers rattache le compte de
 * l'appelant à la victime. Un correctif est en cours ailleurs sur ce
 * connecteur — il n'y avait aucune raison d'introduire le même défaut ici.
 *
 * Deux décisions en découlent, et ces tests les verrouillent :
 *
 * 1. Le `state` est **signé** et vérifié en temps constant.
 * 2. Le callback **redirige** au lieu d'émettre du HTML : il n'y a plus de
 *    gabarit où injecter le message d'erreur du fournisseur.
 */

const oauthSrc = readFileSync(resolve(__dirname, '../lib/drive/oauth.ts'), 'utf-8');
const callback = readFileSync(resolve(__dirname, '../app/api/drive/callback/route.ts'), 'utf-8');
const connect = readFileSync(resolve(__dirname, '../app/api/drive/connect/route.ts'), 'utf-8');
const statut = readFileSync(resolve(__dirname, '../app/api/drive/status/route.ts'), 'utf-8');
const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-04-user-drive.sql'),
  'utf-8',
);
const schema = readFileSync(
  resolve(__dirname, '../lib/db/migrations/002_complete_schema.sql'),
  'utf-8',
);

// Le module lit `process.env` à l'appel, pas au chargement.
const ENV = { ...process.env };
beforeEach(() => {
  process.env.AUTH_SECRET = 'secret-de-test-suffisamment-long';
  process.env.NEXTAUTH_URL = 'https://studiio.pro';
  process.env.GOOGLE_CLIENT_ID = 'client-test.apps.googleusercontent.com';
});
afterEach(() => { process.env = { ...ENV }; vi.useRealTimers(); });

const mod = async () => import('@/lib/drive/oauth');

describe('Le state est signé', () => {
  it('un state fraîchement émis se vérifie', async () => {
    const { signState, verifyState } = await mod();
    const s = signState('utilisateur-42')!;
    expect(verifyState(s)).toEqual({ ok: true, userId: 'utilisateur-42' });
  });

  it('un state fabriqué à la main est REFUSÉ', async () => {
    // C'est précisément l'attaque : `state=<id victime>:0:x` sur le
    // connecteur social rattachait le compte de l'appelant à la victime.
    const { verifyState } = await mod();
    expect(verifyState('victime:0:x').ok).toBe(false);
    expect(verifyState('victime.0.x.signature-inventee')).toMatchObject({
      ok: false, reason: 'signature',
    });
  });

  it('une signature valide pour un AUTRE utilisateur ne vaut pas pour celui-ci', async () => {
    const { signState, verifyState } = await mod();
    const s = signState('utilisateur-a')!;
    const falsifie = s.replace('utilisateur-a', 'utilisateur-b');
    expect(verifyState(falsifie).ok).toBe(false);
  });

  it('un state absent ou malformé est refusé, avec le motif', async () => {
    const { verifyState } = await mod();
    expect(verifyState(null)).toMatchObject({ ok: false, reason: 'absent' });
    expect(verifyState('')).toMatchObject({ ok: false, reason: 'absent' });
    expect(verifyState('a.b.c')).toMatchObject({ ok: false, reason: 'malforme' });
    expect(verifyState('...')).toMatchObject({ ok: false, reason: 'malforme' });
  });

  it('un state périmé est refusé', async () => {
    const { signState, verifyState } = await mod();
    const s = signState('utilisateur-42')!;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    expect(verifyState(s)).toMatchObject({ ok: false, reason: 'perime' });
  });

  it('sans secret, aucun state n est émis NI accepté', async () => {
    // Émettre un state invérifiable reviendrait à ouvrir le callback.
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const { signState, verifyState } = await mod();
    expect(signState('x')).toBeNull();
    expect(verifyState('a.b.c.d')).toMatchObject({ ok: false, reason: 'secret' });
  });

  it('la comparaison se fait à temps constant', () => {
    // Une comparaison ordinaire fuit la signature attendue octet par octet.
    expect(oauthSrc).toContain('timingSafeEqual');
    expect(oauthSrc).toContain('if (a.length !== b.length || !timingSafeEqual(a, b))');
  });
});

describe('L URL de consentement', () => {
  it('demande la portée la MOINS intrusive', async () => {
    // `drive.file` ne donne accès qu'aux fichiers créés par l'application.
    const { buildAuthUrl, DRIVE_SCOPE } = await mod();
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    const url = new URL(buildAuthUrl('etat')!);
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
  });

  it('demande un jeton de rafraîchissement — les DEUX paramètres', async () => {
    // Sans `access_type=offline` ET `prompt=consent`, Google n'en renvoie
    // aucun à la deuxième connexion, et l'envoi cesse une heure plus tard
    // sans que rien ne l'explique.
    const { buildAuthUrl } = await mod();
    const url = new URL(buildAuthUrl('etat')!);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('porte le state et la bonne adresse de retour', async () => {
    const { buildAuthUrl } = await mod();
    const url = new URL(buildAuthUrl('mon-etat')!);
    expect(url.searchParams.get('state')).toBe('mon-etat');
    expect(url.searchParams.get('redirect_uri')).toBe('https://studiio.pro/api/drive/callback');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('sans identifiant d application, aucune URL — et l écran le dit', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { buildAuthUrl } = await mod();
    expect(buildAuthUrl('etat')).toBeNull();
    expect(connect).toContain('needsConfig: true');
    expect(connect).toContain('ajoutez GOOGLE_CLIENT_ID');
  });

  it('l adresse de retour ne double jamais la barre oblique', async () => {
    process.env.NEXTAUTH_URL = 'https://studiio.pro/';
    const { redirectUri } = await mod();
    expect(redirectUri()).toBe('https://studiio.pro/api/drive/callback');
  });
});

describe('Le callback n émet AUCUN HTML', () => {
  it('il redirige, avec un code de résultat', () => {
    expect(callback).toContain('NextResponse.redirect(url)');
    expect(callback).toContain("url.searchParams.set('drive', resultat)");
  });

  it('aucun gabarit HTML ni script inline', () => {
    // Le callback social interpole le message du fournisseur dans du
    // JavaScript inline : il n'y a ici aucune chaîne où injecter.
    expect(callback).not.toContain('<!DOCTYPE');
    expect(callback).not.toContain('<script');
    expect(callback).not.toContain('postMessage');
  });

  it('les résultats sont des codes fermés, jamais du texte libre', () => {
    expect(callback).toContain("type Resultat =");
    expect(callback).toContain("| 'etat-invalide'");
    // Le message d'erreur de Google va au journal, pas à l'URL.
    expect(callback).toContain("console.warn('[Drive/Callback] refus :', params.get('error'))");
  });

  it('le userId vient du state vérifié, jamais d un paramètre', () => {
    expect(callback).toContain('const etat = verifyState(params.get(\'state\'));');
    expect(callback).toContain('saveDriveAccount(etat.userId, tokens, email)');
    expect(callback).not.toContain("params.get('userId')");
  });

  it('un refus de l utilisateur est distingué d une panne', () => {
    expect(callback).toContain("if (params.get('error')) {");
    expect(callback).toContain("return retour('refus');");
  });
});

describe('Les jetons', () => {
  it('un rafraîchissement absent n EFFACE pas celui en base', () => {
    // Google ne renvoie le `refresh_token` qu'au PREMIER consentement :
    // l'écraser par `null` couperait l'envoi une heure plus tard.
    expect(oauthSrc).toContain('refresh_token: tokens.refreshToken ?? existant?.refresh_token ?? null,');
  });

  it('le rafraîchissement part AVANT expiration, avec une marge', () => {
    expect(oauthSrc).toContain('const REFRESH_BUFFER_MS = 5 * 60 * 1000;');
    expect(oauthSrc).toContain('expire - Date.now() < REFRESH_BUFFER_MS');
  });

  it('un jeton expiré sans rafraîchissement rend null — pas un 401 déguisé', () => {
    expect(oauthSrc).toContain('if (!compte.refresh_token) return null;');
  });

  it('les portées réellement accordées sont conservées', () => {
    // Google peut en accorder MOINS que demandé : l'écran doit pouvoir
    // proposer une reconnexion plutôt que de tenter un envoi voué au 403.
    expect(oauthSrc).toContain('scopes: tokens.scopes ?? existant?.scopes ?? null,');
    expect(statut).toContain("scopeOk: !compte || (compte.scopes ?? '').includes(DRIVE_SCOPE)");
  });

  it('la clé secrète ne quitte jamais le serveur', () => {
    expect(oauthSrc).toContain('process.env.GOOGLE_CLIENT_SECRET');
    expect(oauthSrc).not.toContain('NEXT_PUBLIC_GOOGLE');
  });
});

describe('Le stockage', () => {
  it('une table DÉDIÉE, et voici pourquoi', () => {
    // `social_accounts.platform` porte un CHECK limité aux 4 réseaux :
    // y ranger 'gdrive' serait refusé par la base.
    expect(schema).toContain("CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'youtube'))");
    expect(migration).toContain('create table if not exists user_drive');
    expect(oauthSrc).toContain("from('user_drive')");
  });

  it('la migration ne touche à aucune table existante', () => {
    expect(migration).not.toMatch(/alter table/i);
    expect(migration).not.toMatch(/drop table/i);
  });

  it('elle donne les droits PostgREST et rappelle le rechargement', () => {
    expect(migration).toContain('grant all on table public.user_drive to public;');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });

  it('un seul Drive par utilisateur — une reconnexion remplace', () => {
    expect(migration).toContain('create unique index if not exists user_drive_user_id_key');
    expect(oauthSrc).toContain("{ onConflict: 'user_id' }");
  });

  it('supprimer un compte emporte sa connexion Drive', () => {
    expect(migration).toContain('references users(id) on delete cascade');
  });

  it('la sonde de table est mémoïsée', () => {
    expect(oauthSrc).toContain('if (storeProbe?.ready) return true;');
    expect(oauthSrc).toContain('const STORE_PROBE_TTL_MS = 60_000;');
  });
});

describe('Default-safe', () => {
  it('sans migration, la connexion refuse AVANT d envoyer consentir', () => {
    // Faire accorder un accès pour découvrir au retour qu'on ne sait pas le
    // ranger serait le pire des deux mondes.
    const post = connect.slice(connect.indexOf('export async function POST'));
    expect(post.indexOf('driveStoreReady()')).toBeLessThan(post.indexOf('signState('));
    expect(connect).toContain('la migration user_drive n’a pas été appliquée');
  });

  it('l état distingue « pas connecté » de « pas configuré »', () => {
    expect(statut).toContain('configured: !!process.env.GOOGLE_CLIENT_ID');
    expect(statut).toContain('connected: !!compte');
  });

  it('toutes les routes exigent une session', () => {
    for (const [nom, src] of [['connect', connect], ['status', statut]] as const) {
      expect(src, nom).toContain("return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });");
    }
  });

  it('la déconnexion est possible', () => {
    expect(statut).toContain('export async function DELETE()');
    expect(oauthSrc).toContain("from('user_drive').delete().eq('user_id', userId)");
  });

  it('rien de tout cela ne touche au connecteur social', () => {
    // Le correctif de `state` en cours ailleurs porte sur `api/social/*` :
    // aucun de ces fichiers n'y est.
    for (const src of [oauthSrc, callback, connect, statut]) {
      expect(src).not.toContain('social_accounts');
    }
  });
});
