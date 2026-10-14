/**
 * Doublures partagées des contrats PUBLICATION RÉSEAUX.
 *
 * ⚠️ AUCUN RÉSEAU, AUCUNE BASE, AUCUNE PUBLICATION RÉELLE. Zernio, PostgREST,
 * le stockage, FFmpeg et l'email sont simulés. La base en mémoire ÉVALUE les
 * filtres PostgREST que le cron utilise (`eq`, `lt`, `in`, `is`,
 * `metadata->>cle`) : le claim atomique `scheduled → publishing` et le reset
 * des posts bloqués s'y comportent comme en base.
 *
 * Usage (les `vi.mock` restent dans chaque fichier de test, ils sont hissés) :
 *   vi.mock('@/lib/db/supabase', async () => (await import('./helpers/socialHarness')).moduleSupabase());
 */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

export type Ligne = Record<string, any>;

export const etat = {
  base: { scheduled_posts: [] as Ligne[], zernio_accounts: [] as Ligne[], users: [] as Ligne[] } as Record<string, Ligne[]>,
  /** Comptes Zernio connectés renvoyés par `comptesConnectes`. */
  comptes: [] as Array<{ platform: string; accountId: string; username?: string | null }>,
  /** Chaque `update` exécuté, dans l'ordre : table, valeurs, ids touchés. */
  ecritures: [] as Array<{ table: string; maj: Ligne; ids: string[] }>,
  /** Injection de panne : renvoyer un `{ error }` au lieu d'écrire. */
  panneEcriture: null as null | ((table: string, maj: Ligne) => boolean),
  /** Fichiers « téléversés » dans le stockage (chemin → octets). */
  stockage: new Map<string, unknown>(),
};

function valeur(l: Ligne, col: string): unknown {
  const m = col.match(/^(\w+)->>(\w+)$/);
  if (m) {
    const v = l[m[1]]?.[m[2]];
    return v === undefined || v === null ? null : String(v);
  }
  return l[col];
}

function chaine(table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let maj: Ligne | null = null;
  let limite = Infinity;
  const executer = () => {
    const lignes = (etat.base[table] ?? []).filter((l) => filtres.every((f) => f(l)));
    if (maj) {
      if (etat.panneEcriture?.(table, maj)) {
        return { data: null, error: { message: 'panne simulee', code: '57014' } };
      }
      for (const l of lignes) Object.assign(l, maj, { updated_at: new Date().toISOString() });
      etat.ecritures.push({ table, maj, ids: lignes.map((l) => l.id) });
    }
    return { data: lignes.slice(0, limite).map((l) => ({ ...l })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (v: Ligne) => { maj = v; return b; },
    insert: () => b,
    upsert: () => b,
    eq: (c: string, v: unknown) => { filtres.push((l) => valeur(l, c) === v); return b; },
    lt: (c: string, v: string) => { filtres.push((l) => String(valeur(l, c)) < v); return b; },
    is: (c: string, v: null) => { filtres.push((l) => valeur(l, c) === v); return b; },
    in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(valeur(l, c))); return b; },
    // La fenêtre large (UTC+14) de la requête SQL n'est pas reproduite : tous
    // les posts `scheduled` remontent, et c'est le filtre JS par fuseau du
    // cron — celui que les contrats verrouillent — qui décide.
    or: () => b,
    order: () => b,
    limit: (n: number) => { limite = n; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(executer()).then(res, rej),
  };
  return b;
}

export function moduleSupabase() {
  const client = {
    from: (t: string) => chaine(t),
    storage: {
      from: () => ({
        upload: async (chemin: string, octets: unknown) => { etat.stockage.set(chemin, octets); return { error: null }; },
        getPublicUrl: (chemin: string) => ({ data: { publicUrl: `https://cdn.example/media/${chemin}` } }),
      }),
    },
  };
  return { supabaseAdmin: client, supabase: client };
}

// ── Zernio : tout est simulé, la classe d'erreur est la vraie ─────────────
export const zernio = {
  createPost: vi.fn(async (_input: any) => ({ _id: 'zernio-post-1' })),
  uploadMedia: vi.fn(async (_url: string, _nom: string, _type: string, _user: string) => 'https://zernio.example/tmp/media.mp4'),
};

export const autres = {
  sendEmail: vi.fn(async (_m: any) => ({ success: true })),
  downloadMediaToFile: vi.fn(async (_url: string, _chemin: string, _o?: unknown) => ({ sizeBytes: 1024 })),
  transcode: vi.fn(async (..._a: unknown[]) => ({ attempt: '1080p CRF28', stderr: '', elapsedMs: 1 })),
  execFile: vi.fn((..._a: unknown[]) => undefined),
};

export const SECRET = 'secret-cron-contrat';
export const WEBHOOK_SECRET = 'secret-webhook-contrat';
export const IL_Y_A_UNE_HEURE = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

export function post(id: string, extra: Ligne = {}): Ligne {
  return {
    id,
    user_id: 'user-1',
    title: `Titre ${id}`,
    caption: `Légende ${id}`,
    platforms: ['Instagram'],
    status: 'scheduled',
    scheduled_date: '2026-01-01',
    scheduled_time: '08:00',
    updated_at: new Date().toISOString(),
    video_id: null,
    videos: null,
    format: null,
    users: { email: 'auteur@test.local', name: 'Auteur' },
    media_url: 'https://cdn.example/rendus/montage.mp4',
    metadata: { renderedVideoUrl: 'https://cdn.example/rendus/montage.mp4' },
    ...extra,
  };
}

export async function lancerCron(force = false) {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(new NextRequest(`http://localhost:3000/api/cron/publish${force ? '?force=true' : ''}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  }));
  return res.json();
}

export async function webhook(evenement: Record<string, unknown>) {
  const { POST } = await import('@/app/api/social/zernio/webhook/route');
  const corps = JSON.stringify(evenement);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(corps, 'utf8').digest('hex');
  return POST(new NextRequest('http://localhost:3000/api/social/zernio/webhook', {
    method: 'POST', body: corps, headers: { 'x-zernio-signature': signature },
  }));
}

/** Simule « Réessayer » / « Reprogrammer » du Calendrier côté base : statut `scheduled`, metadata conservée. */
export function reprogrammer(id: string) {
  const l = etat.base.scheduled_posts.find((p) => p.id === id)!;
  l.status = 'scheduled';
  l.metadata = { ...(l.metadata || {}), error: null, cron_publish_results: null };
}

export function ligne(id: string): Ligne {
  return etat.base.scheduled_posts.find((p) => p.id === id)!;
}

export function reinitialiser() {
  process.env.CRON_SECRET = SECRET;
  process.env.ZERNIO_WEBHOOK_SECRET = WEBHOOK_SECRET;
  etat.base.scheduled_posts = [];
  etat.base.zernio_accounts = [];
  etat.base.users = [];
  etat.comptes = [{ platform: 'instagram', accountId: 'acc-ig' }];
  etat.ecritures = [];
  etat.panneEcriture = null;
  etat.stockage.clear();
  zernio.createPost.mockReset().mockImplementation(async () => ({ _id: 'zernio-post-1' }));
  zernio.uploadMedia.mockReset().mockImplementation(async () => 'https://zernio.example/tmp/media.mp4');
  autres.sendEmail.mockReset().mockImplementation(async () => ({ success: true }));
  autres.downloadMediaToFile.mockReset().mockImplementation(async () => ({ sizeBytes: 1024 }));
  autres.transcode.mockReset().mockImplementation(async () => ({ attempt: '1080p CRF28', stderr: '', elapsedMs: 1 }));
  autres.execFile.mockReset().mockImplementation((...a: unknown[]) => {
    const cb = a[a.length - 1];
    if (typeof cb === 'function') (cb as (e: null, r: { stdout: string; stderr: string }) => void)(null, { stdout: '', stderr: '' });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Filet : tout fetch réel est une faute de test.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('reseau ferme en test'); }));
}
