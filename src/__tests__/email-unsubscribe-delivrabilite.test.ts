import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Non-regression : desabonnement email et delivrabilite.
 *
 * Verrouille les regles de CLAUDE.md (« Delivrabilite email — REGLE ABSOLUE ») :
 *   - le jeton de desabonnement est un HMAC de l'adresse, verifie a temps constant ;
 *   - aucun en-tete `List-Unsubscribe` tant que la table `email_suppressions`
 *     n'est pas exploitable, ni pour un envoi transactionnel ;
 *   - `RESEND_FROM` est obligatoire : sans lui, l'envoi est annule ;
 *   - une version texte accompagne toujours le HTML.
 *
 * Tout est simule : Supabase (`supabaseAdmin`), `fetch` (API Resend) et les
 * variables d'environnement. Aucune base, aucun reseau, aucun email reel.
 *
 * `suppressionStoreReady()` memoise son resultat AU NIVEAU DU MODULE : chaque
 * test reimporte donc les modules apres `vi.resetModules()`.
 */

// ── Doublure de supabaseAdmin ─────────────────────────────────────────────
const db = vi.hoisted(() => ({
  /** Erreur renvoyee par la sonde `select('email').limit(1)`. */
  probeError: null as null | { message: string },
  /** La sonde leve au lieu de renvoyer une erreur. */
  probeThrows: false,
  /** Adresses presentes dans `email_suppressions`. */
  suppressed: [] as string[],
  /** Erreur renvoyee par la lecture `select('email').in(...)`. */
  readError: null as null | { message: string },
  /** La lecture leve. */
  readThrows: false,
  /** Erreur renvoyee par `upsert`. */
  upsertError: null as null | { message: string },
  upserts: [] as Array<{ row: unknown; opts: unknown }>,
  probeCalls: 0,
  tables: [] as string[],
}));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      db.tables.push(table);
      return {
        select: () => ({
          limit: async () => {
            db.probeCalls += 1;
            if (db.probeThrows) throw new Error('base injoignable');
            return { data: [], error: db.probeError };
          },
          in: async (_col: string, values: string[]) => {
            if (db.readThrows) throw new Error('base injoignable');
            if (db.readError) return { data: null, error: db.readError };
            return {
              data: db.suppressed.filter((e) => values.includes(e)).map((email) => ({ email })),
              error: null,
            };
          },
        }),
        upsert: async (row: unknown, opts: unknown) => {
          db.upserts.push({ row, opts });
          return { error: db.upsertError };
        },
      };
    },
  },
}));

// ── Environnement ─────────────────────────────────────────────────────────
const ENV_KEYS = [
  'UNSUBSCRIBE_SECRET',
  'AUTH_SECRET',
  'UNSUBSCRIBE_MAILTO',
  'RESEND_FROM',
  'RESEND_API_KEY',
  'RESEND_REPLY_TO',
  'NEXT_PUBLIC_APP_URL',
] as const;
const savedEnv: Record<string, string | undefined> = {};

const SECRET = 'secret-de-test-desabonnement';
const FROM = 'Studiio <notifications@studiio.test>';

// ── Doublure de fetch (API Resend) ────────────────────────────────────────
type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[] = [];
let fetchResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { id: 'em_test_1' },
};

function lastPayload(): Record<string, unknown> {
  const call = fetchCalls[fetchCalls.length - 1];
  return JSON.parse(String(call.init.body));
}

async function loadUnsubscribe() {
  return import('@/lib/email/unsubscribe');
}
async function loadResend() {
  return import('@/lib/email/resend');
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.UNSUBSCRIBE_SECRET = SECRET;
  process.env.RESEND_FROM = FROM;
  process.env.RESEND_API_KEY = 're_test_factice';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.studiio.test';

  db.probeError = null;
  db.probeThrows = false;
  db.suppressed = [];
  db.readError = null;
  db.readThrows = false;
  db.upsertError = null;
  db.upserts = [];
  db.probeCalls = 0;
  db.tables = [];

  fetchCalls = [];
  fetchResponse = { ok: true, status: 200, body: { id: 'em_test_1' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return {
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        json: async () => fetchResponse.body,
      };
    }),
  );

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Remet a zero la memoisation de `suppressionStoreReady()`.
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

// ══════════════════════════════════════════════════════════════════════════
describe('Jeton HMAC de desabonnement', () => {
  it('signe puis verifie la meme adresse', async () => {
    const { signRecipient, verifyRecipient } = await loadUnsubscribe();
    const token = signRecipient('alice@example.com');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(token.length).toBeGreaterThan(20);
    expect(verifyRecipient('alice@example.com', token)).toBe(true);
  });

  it('normalise l\'adresse : casse et espaces ne changent pas le jeton', async () => {
    const { signRecipient, verifyRecipient } = await loadUnsubscribe();
    const token = signRecipient('alice@example.com');
    expect(signRecipient('  ALICE@Example.COM ')).toBe(token);
    expect(verifyRecipient(' Alice@EXAMPLE.com', token)).toBe(true);
  });

  it('est deterministe et depend du secret', async () => {
    const first = (await loadUnsubscribe()).signRecipient('alice@example.com');
    expect((await loadUnsubscribe()).signRecipient('alice@example.com')).toBe(first);

    process.env.UNSUBSCRIBE_SECRET = 'un-autre-secret';
    vi.resetModules();
    expect((await loadUnsubscribe()).signRecipient('alice@example.com')).not.toBe(first);
  });

  it('se rabat sur AUTH_SECRET quand UNSUBSCRIBE_SECRET est absent', async () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    process.env.AUTH_SECRET = SECRET;
    const { signRecipient, verifyRecipient } = await loadUnsubscribe();
    const token = signRecipient('alice@example.com');
    expect(token).not.toBe('');
    expect(verifyRecipient('alice@example.com', token)).toBe(true);
  });

  it('sans aucun secret : jeton vide, rien n\'est verifiable', async () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    delete process.env.AUTH_SECRET;
    const { signRecipient, verifyRecipient, canSignRecipient } = await loadUnsubscribe();
    expect(signRecipient('alice@example.com')).toBe('');
    expect(verifyRecipient('alice@example.com', '')).toBe(false);
    expect(verifyRecipient('alice@example.com', 'nimporte-quoi')).toBe(false);
    expect(canSignRecipient('alice@example.com')).toBe(false);
  });
});

describe('Jeton invalide ou falsifie', () => {
  it('refuse un jeton vide', async () => {
    const { verifyRecipient } = await loadUnsubscribe();
    expect(verifyRecipient('alice@example.com', '')).toBe(false);
  });

  it('refuse un jeton de longueur differente sans lever', async () => {
    const { verifyRecipient, signRecipient } = await loadUnsubscribe();
    const token = signRecipient('alice@example.com');
    expect(verifyRecipient('alice@example.com', 'court')).toBe(false);
    expect(verifyRecipient('alice@example.com', `${token}x`)).toBe(false);
  });

  it('refuse un jeton falsifie d\'un seul caractere', async () => {
    const { verifyRecipient, signRecipient } = await loadUnsubscribe();
    const token = signRecipient('alice@example.com');
    const last = token[token.length - 1];
    const forged = token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect(forged).toHaveLength(token.length);
    expect(verifyRecipient('alice@example.com', forged)).toBe(false);
  });

  it('refuse le jeton d\'une autre adresse', async () => {
    const { verifyRecipient, signRecipient } = await loadUnsubscribe();
    const tokenBob = signRecipient('bob@example.com');
    expect(verifyRecipient('alice@example.com', tokenBob)).toBe(false);
  });

  it('refuse un jeton signe avec un autre secret', async () => {
    process.env.UNSUBSCRIBE_SECRET = 'secret-attaquant';
    const forged = (await loadUnsubscribe()).signRecipient('alice@example.com');

    process.env.UNSUBSCRIBE_SECRET = SECRET;
    vi.resetModules();
    expect((await loadUnsubscribe()).verifyRecipient('alice@example.com', forged)).toBe(false);
  });
});

describe('URL de desabonnement', () => {
  it('porte l\'adresse normalisee et son jeton, sur l\'origine de l\'application', async () => {
    const { unsubscribeEndpoint, verifyRecipient } = await loadUnsubscribe();
    const url = new URL(unsubscribeEndpoint(' Alice@Example.com '));
    expect(url.origin).toBe('https://app.studiio.test');
    expect(url.pathname).toBe('/api/email/unsubscribe');
    expect(url.searchParams.get('e')).toBe('alice@example.com');
    expect(verifyRecipient('alice@example.com', url.searchParams.get('t') || '')).toBe(true);
  });

  it('retombe sur https://studiio.pro si NEXT_PUBLIC_APP_URL est invalide', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'pas une url';
    const { unsubscribeEndpoint } = await loadUnsubscribe();
    expect(unsubscribeEndpoint('alice@example.com')).toMatch(
      /^https:\/\/studiio\.pro\/api\/email\/unsubscribe\?/,
    );
  });
});

describe('filterSuppressed', () => {
  it('liste vide ou sans adresse valide : renvoie [] sans interroger la base', async () => {
    const { filterSuppressed } = await loadUnsubscribe();
    expect(await filterSuppressed([])).toEqual([]);
    expect(await filterSuppressed(['pas-une-adresse', ''])).toEqual([]);
    expect(db.tables).toEqual([]);
  });

  it('ecarte les adresses desabonnees, casse et espaces ignores', async () => {
    db.suppressed = ['bob@example.com'];
    const { filterSuppressed } = await loadUnsubscribe();
    const kept = await filterSuppressed(['alice@example.com', '  BOB@example.com ', 'carol@example.com']);
    expect(kept).toEqual(['alice@example.com', 'carol@example.com']);
    expect(db.tables).toEqual(['email_suppressions']);
  });

  it('aucune suppression : renvoie la liste d\'origine intacte', async () => {
    const { filterSuppressed } = await loadUnsubscribe();
    const input = ['alice@example.com', 'bob@example.com'];
    expect(await filterSuppressed(input)).toEqual(input);
  });

  it('table indisponible (erreur) : repli permissif, liste intacte', async () => {
    db.readError = { message: 'Could not find the table public.email_suppressions in the schema cache' };
    db.suppressed = ['bob@example.com'];
    const { filterSuppressed } = await loadUnsubscribe();
    const input = ['alice@example.com', 'bob@example.com'];
    expect(await filterSuppressed(input)).toEqual(input);
    expect(console.error).toHaveBeenCalled();
  });

  it('base injoignable (exception) : repli permissif, ne leve pas', async () => {
    db.readThrows = true;
    const { filterSuppressed } = await loadUnsubscribe();
    await expect(filterSuppressed(['alice@example.com'])).resolves.toEqual(['alice@example.com']);
  });
});

describe('isSuppressed', () => {
  it('vrai pour une adresse desabonnee, quelle que soit la casse', async () => {
    db.suppressed = ['bob@example.com'];
    const { isSuppressed } = await loadUnsubscribe();
    expect(await isSuppressed('Bob@Example.com')).toBe(true);
  });

  it('faux pour une adresse non desabonnee', async () => {
    db.suppressed = ['bob@example.com'];
    const { isSuppressed } = await loadUnsubscribe();
    expect(await isSuppressed('alice@example.com')).toBe(false);
  });

  it('faux pour une adresse malformee, sans interroger la base', async () => {
    const { isSuppressed } = await loadUnsubscribe();
    expect(await isSuppressed('pas-une-adresse')).toBe(false);
    expect(db.tables).toEqual([]);
  });

  it('faux si la table est indisponible (repli permissif)', async () => {
    db.readError = { message: 'relation does not exist' };
    db.suppressed = ['bob@example.com'];
    const { isSuppressed } = await loadUnsubscribe();
    expect(await isSuppressed('bob@example.com')).toBe(false);
  });
});

describe('recordSuppression', () => {
  it('upsert de l\'adresse normalisee sur la clef email', async () => {
    const { recordSuppression } = await loadUnsubscribe();
    expect(await recordSuppression(' Alice@Example.com ', 'link')).toBe(true);
    expect(db.upserts).toEqual([
      { row: { email: 'alice@example.com', reason: 'link' }, opts: { onConflict: 'email' } },
    ]);
  });

  it('refuse une adresse malformee sans ecrire', async () => {
    const { recordSuppression } = await loadUnsubscribe();
    expect(await recordSuppression('pas-une-adresse')).toBe(false);
    expect(db.upserts).toEqual([]);
  });

  it('renvoie false si l\'ecriture echoue (table absente)', async () => {
    db.upsertError = { message: 'Could not find the table' };
    const { recordSuppression } = await loadUnsubscribe();
    expect(await recordSuppression('alice@example.com')).toBe(false);
  });
});

describe('Sonde de la table de suppression (memoisation)', () => {
  it('table prete : memoisee definitivement, plus de nouvelle sonde', async () => {
    const { suppressionStoreReady } = await loadUnsubscribe();
    expect(await suppressionStoreReady()).toBe(true);
    db.probeError = { message: 'panne ulterieure' };
    expect(await suppressionStoreReady()).toBe(true);
    expect(db.probeCalls).toBe(1);
  });

  it('table absente : echec memoise 60 s, puis nouvelle sonde', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));
    db.probeError = { message: 'Could not find the table public.email_suppressions' };
    const { suppressionStoreReady } = await loadUnsubscribe();

    expect(await suppressionStoreReady()).toBe(false);
    db.probeError = null; // migration appliquee entre-temps
    vi.setSystemTime(new Date('2026-09-28T10:00:59Z'));
    expect(await suppressionStoreReady()).toBe(false);
    expect(db.probeCalls).toBe(1);

    vi.setSystemTime(new Date('2026-09-28T10:01:01Z'));
    expect(await suppressionStoreReady()).toBe(true);
    expect(db.probeCalls).toBe(2);
  });

  it('sonde qui leve : table consideree indisponible, sans lever', async () => {
    db.probeThrows = true;
    const { suppressionStoreReady } = await loadUnsubscribe();
    await expect(suppressionStoreReady()).resolves.toBe(false);
  });

  it('le cache est bien remis a zero entre deux imports isoles', async () => {
    db.probeError = { message: 'absente' };
    expect(await (await loadUnsubscribe()).suppressionStoreReady()).toBe(false);

    db.probeError = null;
    vi.resetModules();
    expect(await (await loadUnsubscribe()).suppressionStoreReady()).toBe(true);
    expect(db.probeCalls).toBe(2);
  });
});

describe('En-tetes List-Unsubscribe', () => {
  it('table prete + secret : en-tetes un-clic avec URL signee et mailto de RESEND_FROM', async () => {
    const { listUnsubscribeHeaders, unsubscribeEndpoint } = await loadUnsubscribe();
    const headers = await listUnsubscribeHeaders('Alice@Example.com');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toBe(
      `<${unsubscribeEndpoint('alice@example.com')}>, <mailto:notifications@studiio.test?subject=unsubscribe>`,
    );
  });

  it('UNSUBSCRIBE_MAILTO valide l\'emporte sur RESEND_FROM', async () => {
    process.env.UNSUBSCRIBE_MAILTO = 'desabo@studiio.test';
    const { listUnsubscribeHeaders } = await loadUnsubscribe();
    const headers = await listUnsubscribeHeaders('alice@example.com');
    expect(headers['List-Unsubscribe']).toContain('<mailto:desabo@studiio.test?subject=unsubscribe>');
  });

  it('sans mailto exploitable : seule l\'URL est annoncee', async () => {
    process.env.RESEND_FROM = 'pas-une-adresse';
    const { listUnsubscribeHeaders } = await loadUnsubscribe();
    const headers = await listUnsubscribeHeaders('alice@example.com');
    expect(headers['List-Unsubscribe']).not.toContain('mailto:');
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.studiio\.test\/api\/email\/unsubscribe\?[^>]+>$/);
  });

  it('table indisponible : aucun en-tete, aucun pied de page', async () => {
    db.probeError = { message: 'Could not find the table public.email_suppressions' };
    const { listUnsubscribeHeaders, canUnsubscribe, unsubscribeFooter } = await loadUnsubscribe();
    expect(await listUnsubscribeHeaders('alice@example.com')).toEqual({});
    expect(await canUnsubscribe('alice@example.com')).toBe(false);
    expect(await unsubscribeFooter('alice@example.com')).toBe('');
  });

  it('aucun secret : aucun en-tete, et la base n\'est meme pas sondee', async () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    delete process.env.AUTH_SECRET;
    const { listUnsubscribeHeaders } = await loadUnsubscribe();
    expect(await listUnsubscribeHeaders('alice@example.com')).toEqual({});
    expect(db.probeCalls).toBe(0);
  });

  it('adresse malformee : aucun en-tete', async () => {
    const { listUnsubscribeHeaders } = await loadUnsubscribe();
    expect(await listUnsubscribeHeaders('pas-une-adresse')).toEqual({});
  });

  it('pied de page : lien signe echappe, insere avant </body>', async () => {
    const { unsubscribeFooter, appendToHtmlBody } = await loadUnsubscribe();
    const footer = await unsubscribeFooter('alice@example.com');
    expect(footer).toContain('Se désabonner');
    expect(footer).toContain('/api/email/unsubscribe?e=alice%40example.com&amp;t=');
    expect(appendToHtmlBody('<html><body><p>x</p></BODY ></html>', footer)).toBe(
      `<html><body><p>x</p>${footer}</body></html>`,
    );
    expect(appendToHtmlBody('<p>x</p>', 'F')).toBe('<p>x</p>F');
    expect(appendToHtmlBody('<p>x</p>', '')).toBe('<p>x</p>');
    // `$&` ne doit pas etre interprete par String.replace.
    expect(appendToHtmlBody('<body></body>', '$&')).toBe('<body>$&</body>');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('sendEmail — delivrabilite', () => {
  it('RESEND_FROM absent : envoi annule, aucun appel a Resend', async () => {
    delete process.env.RESEND_FROM;
    const { sendEmail } = await loadResend();
    const res = await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' });
    expect(res).toEqual({ success: false, error: 'RESEND_FROM not set', data: null });
    expect(fetchCalls).toHaveLength(0);
  });

  it('RESEND_FROM vide ou blanc : envoi annule aussi', async () => {
    process.env.RESEND_FROM = '   ';
    const { sendEmail } = await loadResend();
    const res = await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('RESEND_FROM not set');
    expect(fetchCalls).toHaveLength(0);
  });

  it('RESEND_API_KEY absente : envoi ignore, aucun appel a Resend', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendEmail } = await loadResend();
    const res = await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' });
    expect(res).toEqual({ success: false, error: 'RESEND_API_KEY not set', data: null });
    expect(fetchCalls).toHaveLength(0);
  });

  it('envoi nominal : from = RESEND_FROM, cle en Bearer, version texte derivee', async () => {
    const { sendEmail } = await loadResend();
    const res = await sendEmail({ to: 'alice@example.com', subject: 'Bonjour', html: '<p>Salut</p>' });
    expect(res).toEqual({ success: true, data: { id: 'em_test_1' }, error: null });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://api.resend.com/emails');
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_factice');
    const payload = lastPayload();
    expect(payload.from).toBe(FROM);
    expect(payload.to).toEqual(['alice@example.com']);
    expect(payload.text).toBe('Salut');
    expect(payload).not.toHaveProperty('reply_to');
  });

  it('transactionnel (unsubscribable par defaut false) : aucun en-tete, aucune sonde', async () => {
    const { sendEmail } = await loadResend();
    await sendEmail({ to: 'alice@example.com', subject: 'Recu', html: '<p>Merci</p>' });
    expect(lastPayload()).not.toHaveProperty('headers');
    expect(db.probeCalls).toBe(0);
  });

  it('unsubscribable=true, un destinataire, table prete : en-tetes injectes', async () => {
    const { sendEmail } = await loadResend();
    await sendEmail({
      to: 'alice@example.com',
      subject: 'Actu',
      html: '<p>News</p>',
      unsubscribable: true,
    });
    const headers = lastPayload().headers as Record<string, string>;
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toContain('https://app.studiio.test/api/email/unsubscribe?e=alice%40example.com&t=');
  });

  it('unsubscribable=true mais table indisponible : aucun en-tete, envoi maintenu', async () => {
    db.probeError = { message: 'Could not find the table public.email_suppressions' };
    const { sendEmail } = await loadResend();
    const res = await sendEmail({
      to: 'alice@example.com',
      subject: 'Actu',
      html: '<p>News</p>',
      unsubscribable: true,
    });
    expect(res.success).toBe(true);
    expect(lastPayload()).not.toHaveProperty('headers');
  });

  it('unsubscribable=true avec plusieurs destinataires : aucun en-tete (jeton lie a une adresse)', async () => {
    const { sendEmail } = await loadResend();
    await sendEmail({
      to: ['alice@example.com', 'bob@example.com'],
      subject: 'Actu',
      html: '<p>News</p>',
      unsubscribable: true,
    });
    expect(lastPayload()).not.toHaveProperty('headers');
    expect(db.probeCalls).toBe(0);
  });

  it('les en-tetes de l\'appelant l\'emportent sur l\'injection', async () => {
    const { sendEmail } = await loadResend();
    await sendEmail({
      to: 'alice@example.com',
      subject: 'Actu',
      html: '<p>News</p>',
      unsubscribable: true,
      headers: { 'List-Unsubscribe': '<https://ailleurs.test/u>', 'X-Campagne': 'c1' },
    });
    const headers = lastPayload().headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toBe('<https://ailleurs.test/u>');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['X-Campagne']).toBe('c1');
  });

  it('version texte fournie : utilisee (rognee) a la place de la derivation', async () => {
    const { sendEmail } = await loadResend();
    await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>HTML</p>', text: '  Texte maison  ' });
    expect(lastPayload().text).toBe('Texte maison');
  });

  it('version texte blanche : derivee du HTML', async () => {
    const { sendEmail } = await loadResend();
    await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>HTML</p>', text: '   ' });
    expect(lastPayload().text).toBe('HTML');
  });

  it('RESEND_REPLY_TO renseigne : reply_to transmis', async () => {
    process.env.RESEND_REPLY_TO = ' support@studiio.test ';
    const { sendEmail } = await loadResend();
    await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' });
    expect(lastPayload().reply_to).toBe('support@studiio.test');
  });

  it('erreur de l\'API Resend : echec remonte sans lever', async () => {
    fetchResponse = { ok: false, status: 422, body: { message: 'Invalid from' } };
    const { sendEmail } = await loadResend();
    const res = await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' });
    expect(res).toEqual({ success: false, error: 'Invalid from', data: null });
  });

  it('fetch qui leve : echec remonte, sendEmailSilent ne leve pas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('reseau coupe'); }));
    const { sendEmail, sendEmailSilent } = await loadResend();
    const res = await sendEmail({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' });
    expect(res).toEqual({ success: false, error: 'reseau coupe', data: null });
    await expect(
      sendEmailSilent({ to: 'alice@example.com', subject: 'S', html: '<p>x</p>' }),
    ).resolves.toBeUndefined();
  });
});

describe('htmlToText', () => {
  it('retire style/script, garde les liens sous la forme « libelle (url) »', async () => {
    const { htmlToText } = await loadResend();
    const html =
      '<style>.a{color:red}</style><script>alert(1)</script>' +
      '<h1>Titre</h1><p>Voir <a href="https://studiio.pro/x"><b>le site</b></a></p>' +
      '<p><a href="https://studiio.pro/nu"></a></p>';
    expect(htmlToText(html)).toBe(
      'Titre\nVoir le site (https://studiio.pro/x)\nhttps://studiio.pro/nu',
    );
  });

  it('gere <br>, listes, entites et lignes vides en trop', async () => {
    const { htmlToText } = await loadResend();
    const html =
      '<div>Ligne 1<br/>Ligne 2</div><ul><li>Un</li><li>Deux</li></ul>' +
      '<p>A&nbsp;&amp;&nbsp;B &lt;ok&gt; &quot;x&quot; &#39;y&#39;</p><p></p><p></p><p>Fin</p>';
    expect(htmlToText(html)).toBe(
      'Ligne 1\nLigne 2\n- Un\n- Deux\nA & B <ok> "x" \'y\'\n\nFin',
    );
  });

  it('entree vide : chaine vide', async () => {
    const { htmlToText } = await loadResend();
    expect(htmlToText('')).toBe('');
  });
});
