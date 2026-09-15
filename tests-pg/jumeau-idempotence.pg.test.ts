/**
 * JUMEAU — idempotence STRICTE du moteur, sur un VRAI PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE SEULE LA BASE PEUT PROUVER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux requêtes strictement simultanées (`Promise.all`) pour le même jumeau
 * — même compte, même avatar, même version, même voix, même SPOKEN, même
 * format — doivent donner UNE synthèse ElevenLabs, UN dépôt HeyGen, UNE
 * vidéo HeyGen, UN débit, UNE génération en vol, et le MÊME identifiant
 * pour les deux appelants. Mesuré avant l'index : 2 / 2 / 2 / 2 / 2.
 *
 * C'est l'index unique partiel `avatar_generations_jumeau_en_vol_uidx`
 * (`2026-09-15-avatar-jumeau-en-vol.sql`) qui tranche. Un double en mémoire
 * qui « simule » un 23505 ne prouverait que sa propre simulation : ici la
 * migration est jouée TELLE QU'ELLE PARTIRA EN PRODUCTION, et le MOTEUR
 * RÉEL (`genererVideoJumeau`) tourne sur de VRAIES connexions distinctes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST DOUBLÉ, ET POURQUOI C'EST HONNÊTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * - Le TRANSPORT vers la base : le code parle à PostgREST par supabase-js.
 *   Le harnais n'a pas de PostgREST ; un petit adaptateur traduit le
 *   sous-ensemble du constructeur de requêtes utilisé sur ce chemin
 *   (`from/select/insert/update/eq/is/in/order/limit/single`, `rpc`) en SQL
 *   exécuté sur une CONNEXION PRISE DANS UN POOL — chaque instruction sur sa
 *   propre connexion, comme PostgREST. Les erreurs remontent avec leur
 *   `code` SQLSTATE, comme PostgREST les rend (23505 compris). Aucune
 *   logique métier n'y vit.
 * - Les FOURNISSEURS : ElevenLabs et HeyGen sont interceptés au niveau du
 *   `fetch`, les vrais clients s'exécutent ; on compte les appels.
 * - Les crédits ne sont PAS doublés : `deductCredits` → `debiter_credits_operation`
 *   réelle, journal réel.
 *
 * `user_settings` n'a pas de migration dans le dépôt (table historique de
 * production) : le harnais la crée avec les seules colonnes lues par
 * `lib/voice/profil.ts` (`user_id`, `creator_preferences`).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { join } from 'node:path';
import { Pool, types, type Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, urlBase, RACINE } from './harness';

// PostgREST rend les horodatages en texte : le contrat avatar (`texteOuNull`)
// l'exige. `pg`, lui, fabrique des `Date` — on garde le texte brut.
types.setTypeParser(1184, (v) => v);
types.setTypeParser(1114, (v) => v);

const MIGRATIONS_AVATAR = [
  join(RACINE, 'migrations/2026-07-28-user-avatars.sql'),
  join(RACINE, 'migrations/2026-07-28-avatar-type.sql'),
  join(RACINE, 'migrations/2026-08-04-user-voices.sql'),
  join(RACINE, 'migrations/2026-09-15-avatar-schema-foundation.sql'),
  join(RACINE, 'migrations/2026-09-15-avatar-one-active-per-user.sql'),
];
const MIGRATION = join(RACINE, 'migrations/2026-09-15-avatar-jumeau-en-vol.sql');

// ─────────────────────────────────────────────────────────────────────────
// L'adaptateur supabase-js → SQL, sur un pool de connexions réelles
// ─────────────────────────────────────────────────────────────────────────

type Ligne = Record<string, unknown>;
interface Filtre { col: string; op: 'eq' | 'is' | 'in'; val: unknown }
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

const pool = vi.hoisted(() => ({ courant: null as Pool | null }));

function construire(table: string) {
  const filtres: Filtre[] = [];
  let colonnes = '*';
  let ordre: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let insertion: Ligne | null = null;
  let patch: Ligne | null = null;

  const exec = async (): Promise<{ data: Ligne[] | null; error: { code?: string; message: string } | null }> => {
    const params: unknown[] = [];
    const where = filtres.length === 0 ? '' : ' where ' + filtres.map((f) => {
      if (f.op === 'is') return `${q(f.col)} is ${f.val === null ? 'null' : 'not null'}`;
      params.push(f.op === 'in' ? f.val : f.val);
      return f.op === 'in' ? `${q(f.col)} = any($${params.length})` : `${q(f.col)} = $${params.length}`;
    }).join(' and ');
    let sql: string;
    if (insertion) {
      const cles = Object.keys(insertion);
      sql = `insert into public.${q(table)} (${cles.map(q).join(', ')}) values (${cles.map((_, i) => `$${i + 1}`).join(', ')}) returning ${colonnes}`;
      params.splice(0, params.length, ...cles.map((k) => insertion![k]));
    } else if (patch) {
      const cles = Object.keys(patch);
      const set = cles.map((k, i) => `${q(k)} = $${params.length + i + 1}`).join(', ');
      params.push(...cles.map((k) => patch![k]));
      sql = `update public.${q(table)} set ${set}${where} returning ${colonnes}`;
    } else {
      sql = `select ${colonnes} from public.${q(table)}${where}`
        + (ordre ? ` order by ${q(ordre.col)} ${ordre.asc ? 'asc' : 'desc'}` : '')
        + (limite !== null ? ` limit ${limite}` : '');
    }
    const client = await pool.courant!.connect();
    try {
      const { rows } = await client.query(sql, params);
      return { data: rows as Ligne[], error: null };
    } catch (e) {
      const err = e as { code?: string; message: string };
      return { data: null, error: { code: err.code, message: err.message } };
    } finally {
      client.release();
    }
  };

  const api = {
    select(c?: string) { colonnes = c && c !== '*' ? c.split(',').map((x) => q(x.trim())).join(', ') : '*'; return api; },
    insert(v: Ligne) { insertion = v; return api; },
    update(p: Ligne) { patch = p; return api; },
    eq(col: string, val: unknown) { filtres.push({ col, op: 'eq', val }); return api; },
    is(col: string, val: unknown) { filtres.push({ col, op: 'is', val }); return api; },
    in(col: string, val: unknown[]) { filtres.push({ col, op: 'in', val }); return api; },
    order(col: string, o?: { ascending?: boolean }) { ordre = { col, asc: o?.ascending !== false }; return api; },
    async limit(n: number) { limite = n; return exec(); },
    async single() {
      const r = await exec();
      if (r.error) return { data: null, error: r.error };
      const rows = r.data ?? [];
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: `${rows.length} rows` } };
    },
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return exec().then(resolve, reject); },
  };
  return api;
}

async function rpc(fn: string, params: Record<string, unknown>) {
  const cles = Object.keys(params);
  const sql = `select * from public.${q(fn)}(${cles.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')})`;
  const client = await pool.courant!.connect();
  try {
    const { rows } = await client.query(sql, cles.map((k) => params[k]));
    return { data: rows, error: null };
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { data: null, error: { code: err.code, message: err.message } };
  } finally {
    client.release();
  }
}

vi.mock('@/lib/db/supabase', () => {
  const client = { from: construire, rpc };
  return { supabase: client, supabaseAdmin: client };
});
vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));

// ─────────────────────────────────────────────────────────────────────────
// Les fournisseurs, interceptés au réseau — on compte
// ─────────────────────────────────────────────────────────────────────────

const reseau = { appels: [] as string[], eleven: 200, heygenVideos: 200 };
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  reseau.appels.push(u);
  // Un fournisseur met du temps : la fenêtre de course reste ouverte.
  await dormir(15);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    if (reseau.eleven !== 200) return new Response('quota', { status: reseau.eleven });
    return new Response(Buffer.from('MP3-VOIX-PERSO'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  if (u === 'https://api.heygen.com/v3/assets') {
    expect(init?.body).toBeInstanceOf(FormData);
    return new Response(JSON.stringify({ data: { asset_id: `asset-${reseau.appels.length}` } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u === 'https://api.heygen.com/v3/videos') {
    if (reseau.heygenVideos !== 200) return new Response(JSON.stringify({ error: { message: 'audio refuse' } }), { status: reseau.heygenVideos });
    const corps = JSON.parse(String(init?.body));
    expect(corps.audio_asset_id).toMatch(/^asset-/);
    expect(corps.script).toBeUndefined();
    expect(corps.voice_id).toBeUndefined();
    return new Response(JSON.stringify({ data: { video_id: `vid-${reseau.appels.length}`, status: 'waiting' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;
const appelsVers = (prefixe: string) => reseau.appels.filter((a) => a.startsWith(prefixe));

process.env.HEYGEN_API_KEY = 'cle-heygen-test';
process.env.ELEVENLABS_API_KEY = 'cle-eleven-test';
process.env.JUMEAU_MOTEUR_ACTIVE = '1';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { genererVideoJumeau } = await import('@/lib/avatar/moteur-jumeau');
const { AVATAR_VIDEO_COST } = await import('@/lib/stripe/constants');

// ─────────────────────────────────────────────────────────────────────────
// La base
// ─────────────────────────────────────────────────────────────────────────

let db: Client;
const TEXTE = 'Bienvenue chez Afroboost à Neuchâtel.';
const SPOKEN = 'Bienvenue chez Afro-boust à Neu-cha-tel.';

beforeAll(async () => {
  db = await connecter();
  pool.courant = new Pool({ connectionString: urlBase(), max: 8 });
  await preparerBase(db);
  for (const m of MIGRATIONS_AVATAR) await appliquerMigration(db, m);
  await db.query(`create table if not exists public.user_settings (
    user_id uuid primary key references public.users(id) on delete cascade,
    creator_preferences jsonb not null default '{}'::jsonb,
    updated_at timestamptz default now()
  )`);
  await appliquerMigration(db, MIGRATION);
});
afterAll(async () => { await pool.courant?.end(); if (db) await db.end(); });

let compteur = 0;
/** Un compte avec un jumeau PRÊT : avatar validé (v3), voix ElevenLabs, deux prononciations. */
async function compteAvecJumeau(credits: number, email?: string): Promise<{ userId: string; avatarId: string; voixId: string }> {
  compteur += 1;
  const { rows: [u] } = await db.query<{ id: string }>(
    'insert into public.users (id, email, credits) values (gen_random_uuid(), $1, $2) returning id',
    [email ?? `jumeau${compteur}@test.local`, credits],
  );
  const { rows: [a] } = await db.query<{ id: string }>(
    `insert into public.user_avatars (user_id, provider_avatar_id, provider_asset_id, status, consent_at, consent_text, avatar_type, source_object_key, subject_type, consent_version, validated_at, version, name)
     values ($1, 'hg-avatar-1', 'as-1', 'completed', now(), 'x', 'video', $2, 'self', 'v1', now(), 3, 'Bassi') returning id`,
    [u.id, `${u.id}/avatar/source-1-${'a'.repeat(32)}.mp4`],
  );
  const { rows: [v] } = await db.query<{ id: string }>(
    `insert into public.user_voices (user_id, provider, provider_voice_id, name, lang, consent_at, consent_text)
     values ($1, 'elevenlabs', $2, 'Bassi', 'fr', now(), 'x') returning id`,
    [u.id, `pvid_perso_${compteur}`],
  );
  await db.query(
    `insert into public.user_settings (user_id, creator_preferences) values ($1, $2::jsonb)`,
    [u.id, JSON.stringify({ voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }] } })],
  );
  return { userId: u.id, avatarId: a.id, voixId: v.id };
}

const generer = (userId: string, textes: string[] = [TEXTE], aspectRatio = '9:16') => genererVideoJumeau({ userId, textes, aspectRatio });

async function etat(userId: string) {
  const { rows: [g] } = await db.query<{ en_vol: string; total: string }>(
    `select count(*) filter (where status in ('pending','processing')) as en_vol, count(*) as total
       from public.avatar_generations where user_id = $1 and voice_id like 'jumeau:%'`, [userId],
  );
  const { rows: debits } = await db.query<{ amount: number; reference_id: string | null }>(
    `select amount, reference_id from public.credit_transactions where user_id = $1 and amount < 0 order by created_at`, [userId],
  );
  const { rows: [u] } = await db.query<{ credits: number }>('select credits from public.users where id = $1', [userId]);
  return { enVol: Number(g.en_vol), total: Number(g.total), debits, solde: u.credits };
}

beforeEach(() => { reseau.appels.length = 0; reseau.eleven = 200; reseau.heygenVideos = 200; });

// ─────────────────────────────────────────────────────────────────────────

describe('1. La migration', () => {
  it('pose l index unique partiel, avec md5(script), et se rejoue sans erreur', async () => {
    const { rows: [i] } = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'avatar_generations_jumeau_en_vol_uidx'",
    );
    expect(i.indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(i.indexdef).toContain('md5(script)');
    expect(i.indexdef).toMatch(/intention = 'normale'/);
    expect(i.indexdef).toMatch(/voice_id ~~ 'jumeau:%'/);
    expect(i.indexdef).toMatch(/pending/);
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
  });

  it('⚠️ la base refuse une seconde ligne en vol pour la même identité (23505) ; une ligne échouée ou terminée libère la place', async () => {
    const c = await compteAvecJumeau(1000);
    const ligne = (status: string) => db.query(
      `insert into public.avatar_generations (user_id, user_avatar_id, avatar_version, intention, voice_id, aspect_ratio, script, status, credits_charged)
       values ($1, $2, 3, 'normale', $3, '9:16', $4, $5, 0)`, [c.userId, c.avatarId, `jumeau:${c.voixId}`, SPOKEN, status],
    );
    await ligne('pending');
    await expect(ligne('processing')).rejects.toMatchObject({ code: '23505' });
    await db.query("update public.avatar_generations set status = 'failed' where user_id = $1", [c.userId]);
    await expect(ligne('pending')).resolves.toBeTruthy();
    await db.query("update public.avatar_generations set status = 'completed' where user_id = $1", [c.userId]);
    await expect(ligne('pending')).resolves.toBeTruthy();
  });
});

describe('2. Le moteur réel, deux requêtes STRICTEMENT simultanées', () => {
  it('⚠️ utilisateur normal : 1 ElevenLabs, 1 dépôt, 1 vidéo, 1 débit (lié à la génération), 1 génération en vol, même generationId', async () => {
    const c = await compteAvecJumeau(1000);
    const [a, b] = await Promise.all([generer(c.userId), generer(c.userId)]);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.generationId).toBe(b.generationId);
    expect([a.dejaEnCours, b.dejaEnCours].sort()).toEqual([false, true]);
    expect(a.spoken).toBe(SPOKEN);
    expect(appelsVers('https://api.elevenlabs.io/v1/text-to-speech/')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/assets')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toHaveLength(1);
    const e = await etat(c.userId);
    expect(e.enVol).toBe(1);
    expect(e.total).toBe(1);
    expect(e.debits).toEqual([{ amount: -AVATAR_VIDEO_COST, reference_id: `jumeau:${a.generationId}` }]);
    expect(e.solde).toBe(1000 - AVATAR_VIDEO_COST);
  });

  it('⚠️ quatre requêtes simultanées : toujours une seule chaîne fournisseur, un seul débit, un seul identifiant', async () => {
    const c = await compteAvecJumeau(1000);
    const r = await Promise.all([1, 2, 3, 4].map(() => generer(c.userId)));
    const ids = new Set(r.map((x) => (x.ok ? x.generationId : `KO:${JSON.stringify(x)}`)));
    expect(ids.size).toBe(1);
    expect(r.filter((x) => x.ok && !x.dejaEnCours)).toHaveLength(1);
    expect(appelsVers('https://api.elevenlabs.io/v1/text-to-speech/')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/assets')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toHaveLength(1);
    const e = await etat(c.userId);
    expect(e.enVol).toBe(1);
    expect(e.debits).toHaveLength(1);
    expect(e.solde).toBe(1000 - AVATAR_VIDEO_COST);
  });

  it('⚠️ compte admin (exempté de débit) : l idempotence ne dépend PAS des crédits — même index, même résultat, zéro débit', async () => {
    const c = await compteAvecJumeau(10, 'contact.artboost@gmail.com');
    const [a, b] = await Promise.all([generer(c.userId), generer(c.userId)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.generationId).toBe(b.generationId);
    expect(appelsVers('https://api.elevenlabs.io/v1/text-to-speech/')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/assets')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toHaveLength(1);
    const e = await etat(c.userId);
    expect(e.enVol).toBe(1);
    expect(e.debits).toEqual([]);
    expect(e.solde).toBe(10);
  });

  it('⚠️ le perdant rend la génération EN VOL, jamais une plus récente échouée', async () => {
    const c = await compteAvecJumeau(1000);
    const poser = (status: string, quand: string) => db.query<{ id: string }>(
      `insert into public.avatar_generations (user_id, user_avatar_id, avatar_version, intention, voice_id, aspect_ratio, script, status, credits_charged, created_at)
       values ($1, $2, 3, 'normale', $3, '9:16', $4, $5, 0, $6::timestamptz) returning id`, [c.userId, c.avatarId, `jumeau:${c.voixId}`, SPOKEN, status, quand],
    );
    const { rows: [enVol] } = await poser('processing', '2026-09-15T10:00:00Z');
    await poser('failed', '2026-09-15T11:00:00Z');
    const r = await generer(c.userId);
    expect(r.ok && r.dejaEnCours && r.generationId).toBe(enVol.id);
    expect(r.ok && r.status).toBe('processing');
    expect(reseau.appels).toEqual([]);
    expect((await etat(c.userId)).debits).toEqual([]);
  });

  it('rejeu séquentiel pendant le vol → la même génération ; un autre format → une autre ; après échec → une nouvelle, avec remboursement', async () => {
    const c = await compteAvecJumeau(1000);
    const r1 = await generer(c.userId);
    const r2 = await generer(c.userId);
    expect(r1.ok && r2.ok && r2.generationId).toBe(r1.ok && r1.generationId);
    expect(r2.ok && r2.dejaEnCours).toBe(true);
    const r3 = await generer(c.userId, [TEXTE], '16:9');
    expect(r3.ok && !r3.dejaEnCours).toBe(true);
    expect((await etat(c.userId)).enVol).toBe(2);
    // HeyGen refuse la vidéo : la génération échoue, elle est remboursée, la place est libre.
    reseau.heygenVideos = 500;
    const r4 = await generer(c.userId, ['Un autre texte.']);
    expect(r4.ok).toBe(false);
    expect(r4.ok ? '' : r4.motif).toBe('fournisseur_avatar');
    reseau.heygenVideos = 200;
    const r5 = await generer(c.userId, ['Un autre texte.']);
    expect(r5.ok && !r5.dejaEnCours).toBe(true);
    const e = await etat(c.userId);
    expect(e.enVol).toBe(3);
    // 4 débits (r1, r3, r4, r5), 1 remboursement : 1000 − 4×40 + 40.
    expect(e.debits).toHaveLength(4);
    expect(e.solde).toBe(1000 - 3 * AVATAR_VIDEO_COST);
  });

  it('ElevenLabs échoue sous deux requêtes simultanées : aucun HeyGen, un seul débit remboursé, aucune génération en vol', async () => {
    const c = await compteAvecJumeau(1000);
    reseau.eleven = 429;
    const [a, b] = await Promise.all([generer(c.userId), generer(c.userId)]);
    // Le gagnant échoue (fournisseur_voix) ; le perdant a relu la génération
    // gagnante pendant qu'elle était en vol, ou l'a vue échouée et a retenté.
    expect([a, b].filter((x) => !x.ok && x.motif === 'fournisseur_voix').length).toBeGreaterThanOrEqual(1);
    expect(appelsVers('https://api.heygen.com')).toEqual([]);
    const e = await etat(c.userId);
    expect(e.enVol).toBe(0);
    expect(e.solde).toBe(1000);
  });
});
