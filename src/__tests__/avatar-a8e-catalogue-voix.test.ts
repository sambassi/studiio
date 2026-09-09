/**
 * A_8e — LE CATALOGUE DE VOIX NE PART PLUS POUR RIEN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTEGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `GET /api/avatar/create` chargeait le catalogue de voix HeyGen a CHAQUE
 * ouverture de la page. Ce catalogue appartient au parcours PHOTO historique :
 * la page « Mon clone video » ne s'en sert pas.
 *
 * En local, sans cle, l'appel echouait proprement — et laissait croire, douze
 * lignes de journal par visite, qu'un fournisseur etait mal configure. Avec une
 * cle, il aurait consomme du quota pour rien, a chaque affichage.
 *
 * ⚠️ LA GARDE EST UNE ABSENCE D'APPEL, PAS UN CACHE. Les tests comptent donc
 * les appels reels au module fournisseur.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';

let avatars: Ligne[] = [];
/** ⚠️ LE COMPTEUR DU LOT : il doit rester a zero sur la page clone video. */
let appelsCatalogue = 0;
let appelsEntrainement = 0;

function requete() {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => ({ data: avatars[0] ?? null, error: null }),
    single: async () => ({ data: avatars[0] ?? null, error: null }),
    update: () => api,
    then: (resoudre: (v: unknown) => unknown) => resoudre({ data: avatars, error: null }),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => requete(), storage: { from: () => ({}) } },
  supabase: { from: () => requete() },
}));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => ({ user: { id: UID } }),
}));
vi.mock('@/lib/avatar/heygen', () => ({
  listVoices: async () => { appelsCatalogue += 1; return []; },
  getAvatarTrainingStatus: async () => { appelsEntrainement += 1; return { status: 'processing' }; },
  pickDefaultVoice: () => null,
  uploadAsset: async () => { throw new Error('non attendu'); },
  createAvatarFromAsset: async () => { throw new Error('non attendu'); },
  HeyGenError: class extends Error { httpStatus = 500; },
  HEYGEN_ASSET_MAX_BYTES: 32 * 1024 * 1024,
}));

import { GET } from '@/app/api/avatar/create/route';

const appeler = (url: string) => GET({ url } as never);

beforeEach(() => {
  appelsCatalogue = 0;
  appelsEntrainement = 0;
  avatars = [{
    id: 'cccccccc-3333-4333-8333-333333333333', user_id: UID,
    status: 'source_ready', provider_avatar_id: null, avatar_type: 'video',
    source_object_key: `${UID}/avatar/source-1.mp4`, created_at: '2026-09-09T10:00:00Z',
  }];
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La page « Mon clone vidéo »', () => {
  it('1.1 ⚠️ N’ATTEINT PAS LE CATALOGUE DE VOIX', async () => {
    const res = await appeler('http://local/api/avatar/create');
    expect(res.status).toBe(200);
    expect(appelsCatalogue).toBe(0);
  });

  it('1.2 ⚠️ N’INTERROGE PAS L’ENTRAÎNEMENT D’UN AVATAR QUI N’EN A PAS', async () => {
    /* `source_ready` avec `provider_avatar_id` à NULL : il n'y a rien à
       demander, et demander enverrait `null` sur le réseau. */
    await appeler('http://local/api/avatar/create');
    expect(appelsEntrainement).toBe(0);
  });

  it('1.3 la réponse reste complète, avec une liste de voix vide', async () => {
    const json = await (await appeler('http://local/api/avatar/create')).json();
    expect(json.success).toBe(true);
    expect(json.data.voices).toEqual([]);
    expect(json.data.avatar.status).toBe('source_ready');
  });

  it('1.4 ⚠️ L’APERÇU EST NULL, ET C’EST LA BONNE RÉPONSE', async () => {
    /* Aucune generation n'est rattachee a ce clone : la route rend `null`
       plutot qu'une URL de remplacement. C'est sur cette valeur que l'ecran
       decide de ne rien montrer. */
    const json = await (await appeler('http://local/api/avatar/create')).json();
    expect(json.data).toHaveProperty('apercuUrl');
    expect(json.data.apercuUrl).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le parcours photo historique, quand il le demande', () => {
  it('2.1 ⚠️ `?voices=1` CHARGE LE CATALOGUE — UNE FOIS', async () => {
    // La garde ne doit pas AVOIR SUPPRIME la fonctionnalite : le mode photo
    // a toujours besoin d'un vrai choix de voix.
    await appeler('http://local/api/avatar/create?voices=1');
    expect(appelsCatalogue).toBe(1);
  });

  it('2.2 aucune autre valeur du paramètre n’ouvre la porte', async () => {
    for (const q of ['?voices=0', '?voices=true', '?voices=', '?voix=1']) {
      await appeler(`http://local/api/avatar/create${q}`);
    }
    expect(appelsCatalogue).toBe(0);
  });
});
