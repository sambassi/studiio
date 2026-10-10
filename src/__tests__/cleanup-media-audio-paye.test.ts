import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #541 — l'audio complet PAYÉ est durable : jamais purgé par la rétention
 * temporaire (un re-téléchargement ne coûte ni fournisseur ni crédit).
 * Socle repris du test des rushes de brouillon.
 *
 * Ce que ce fichier prouve, et qu'aucune assertion de texte ne peut prouver :
 *   - un rush de brouillon EXPIRÉ par la rétention (vidéo > 24 h) mais
 *     RÉFÉRENCÉ dans `creer_draft_rushes` n'est PAS supprimé ;
 *   - un rush voisin, tout aussi expiré mais NON référencé, l'est ;
 *   - si `creer_draft_rushes` est illisible, le cron ne supprime RIEN (503).
 *
 * Le stockage et PostgREST sont simulés ; le journal des `remove` est la seule
 * preuve qui vaille.
 */

const VIEUX = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
const TROIS_JOURS = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

// Résultats programmables des quatre lectures d'exemption.
let scheduledPosts: unknown[] = [];
let autopilotRows: unknown[] = [];
let rushesRows: unknown[] = [];
let analysesRows: unknown[] = [];
let draftRows: unknown[] | null = [];
let draftError: unknown = null;

// Contenu simulé du stockage : prefixe → entrées.
let listing: Record<string, Array<{ name: string; id?: string; created_at?: string }>> = {};
const removed: string[] = [];

function tableResult(table: string): { data: unknown; error: unknown } {
  switch (table) {
    case 'scheduled_posts': return { data: scheduledPosts, error: null };
    case 'autopilot_config': return { data: autopilotRows, error: null };
    case 'rushes': return { data: rushesRows, error: null };
    case 'rush_analyses': return { data: analysesRows, error: null };
    case 'creer_draft_rushes': return { data: draftRows, error: draftError };
    default: throw new Error(`table inattendue: ${table}`);
  }
}

function builder(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    in: () => api,
    eq: () => api,
    gt: () => api,
    order: () => api,
    range: () => api,
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(tableResult(table)).then(onOk, onErr),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({ data: listing[`${bucket}:${prefix}`] ?? [], error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${path}` },
        }),
        remove: async (paths: string[]) => { removed.push(...paths); return { data: paths.map(() => ({})), error: null }; },
      }),
    },
  },
}));

const { GET } = await import('@/app/api/cron/cleanup-media/route');

const req = () => ({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer secret' : null) } }) as never;

beforeEach(() => {
  process.env.CRON_SECRET = 'secret';
  scheduledPosts = [];
  autopilotRows = [];
  rushesRows = [];
  analysesRows = [];
  draftRows = [];
  draftError = null;
  removed.length = 0;
  // Un dossier `media/u1/library` avec deux rushes vidéo tous deux expirés.
  listing = {
    'media:': [{ name: 'u1' }],
    'media:u1': [{ name: 'library' }],
    'media:u1/library': [
      { name: 'recent.mp4', id: 'r', created_at: TROIS_JOURS },
      { name: 'old.mp4', id: 'o', created_at: TROIS_JOURS },
    ],
    'audio:': [{ name: 'u1' }, { name: 'audio-complet' }],
    'audio:u1': [{ name: 'voice' }],
    'audio:u1/voice': [
      // Un nom IMITÉ dans le dossier utilisateur (envoi navigateur) : temporaire.
      { name: 'audio-complet-0123456789abcdef01234567.mp3', id: 'i', created_at: VIEUX },
      { name: 'voix-sequence.mp3', id: 'b', created_at: VIEUX },
    ],
    'audio:audio-complet': [{ name: 'u1' }],
    'audio:audio-complet/u1': [{ name: '0123456789abcdef01234567.mp3', id: 'a', created_at: VIEUX }],
  };
  listing['media:'] = [{ name: 'u1' }, { name: 'stock-attributions' }];
  listing['media:stock-attributions'] = [{ name: 'u1' }];
  listing['media:stock-attributions/u1'] = [{ name: 'stock-pexels-video-42.mp4.json', id: 'j', created_at: VIEUX }];
});

import { estFichierDurable } from '@/lib/storage/bibliotheque';

describe('Audio complet payé : durable', () => {
  it('⚠️ l’audio payé (90 jours) et l’attribution stock survivent ; un audio ordinaire expiré part', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(removed).not.toContain('audio-complet/u1/0123456789abcdef01234567.mp3');
    // ⚠️ Le nom imité par un client dans SON dossier n'est PAS protégé.
    expect(removed).toContain('u1/voice/audio-complet-0123456789abcdef01234567.mp3');
    expect(removed).not.toContain('stock-attributions/u1/stock-pexels-video-42.mp4.json');
    expect(removed).toContain('u1/voice/voix-sequence.mp3');
    expect(body.exemptes.durables).toBe(2);
  });

  it('le motif est strict : seul le préfixe serveur est durable, jamais un nom imité dans un dossier utilisateur', () => {
    expect(estFichierDurable('audio/audio-complet/u1/0123456789abcdef01234567.mp3')).toBe(true);
    expect(estFichierDurable('audio/u1/voice/audio-complet-0123456789abcdef01234567.mp3')).toBe(false);
    expect(estFichierDurable('audio/u1/voice/audio-complet-xyz.mp3')).toBe(false);
    expect(estFichierDurable('media/audio-complet/u1/0123456789abcdef01234567.mp3')).toBe(false);
    expect(estFichierDurable('audio/audio-complet/u1/0123456789abcdef01234567.mp3.exe')).toBe(false);
  });
});
