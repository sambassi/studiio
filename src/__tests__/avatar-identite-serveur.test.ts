// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * IDENTITÉ AVATAR — côté serveur et règles pures.
 *
 *   - le rendu récent est TOUJOURS une génération terminée de la VERSION
 *     ACTIVE, jamais une ancienne ;
 *   - la version épinglée à une génération remonte par le statut (lecture
 *     seule, aucun fournisseur pour une génération terminée) ;
 *   - Créer et l'Autopilote relisent l'avatar courant à chaque génération :
 *     aucune version ni identifiant fournisseur n'est figé dans la config.
 *
 * Tout est mocké : AUCUN fournisseur, AUCUN crédit.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const g = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const RELAIS = 'https://studiio.pro/storage/v1/object/public/media';
const urlDe = (id: string) => `${RELAIS}/${U}/avatar/${id}.mp4`;

const base = vi.hoisted(() => ({ generations: [] as Array<Record<string, unknown>>, filtres: [] as string[] }));
const fournisseur = vi.hoisted(() => ({ appels: 0 }));

vi.mock('@/lib/db/supabase', () => {
  const from = () => {
    const conds: Array<[string, unknown]> = [];
    let limite = Infinity;
    const lire = () => base.generations
      .filter((l) => conds.every(([k, v]) => l[k] === v))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limite);
    const chaine: Record<string, unknown> = {
      select: () => chaine,
      eq: (k: string, v: unknown) => { conds.push([k, v]); base.filtres.push(k); return chaine; },
      order: () => chaine,
      limit: (n: number) => { limite = n; return chaine; },
      single: async () => ({ data: lire()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: lire(), error: null }).then(ok),
    };
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: {} };
});
vi.mock('@/lib/avatar/heygen', () => ({
  getVideoStatus: async () => { fournisseur.appels += 1; return { status: 'processing' }; },
  downloadVideo: async () => { fournisseur.appels += 1; return Buffer.from(''); },
}));
vi.mock('@/lib/providers/did/client', () => ({
  lireScene: async () => { fournisseur.appels += 1; return { status: 'processing' }; },
  telechargerResultat: async () => { fournisseur.appels += 1; return Buffer.from(''); },
}));
vi.mock('@/lib/credits/system', () => ({ addCredits: async () => ({}) }));

import {
  choisirRenduRecent, generationDepuisRush, versionPerimee, libelleAvatarActif, libelleCreeAvecVersion, type LigneRendu,
} from '@/lib/avatar/identite';
import { renduRecentDuClone } from '@/lib/avatar/apercu';
import { avancerStatutGeneration } from '@/lib/avatar/statut';

beforeEach(() => {
  base.generations = [];
  base.filtres = [];
  fournisseur.appels = 0;
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
});

const ligne = (n: number, over: Partial<LigneRendu> = {}): LigneRendu => ({
  id: g(n), user_avatar_id: A, avatar_version: 3, status: 'completed', video_url: urlDe(g(n)), created_at: `2026-10-0${n}T10:00:00Z`, ...over,
});

describe('libellés — une terminologie, trois objets distincts', () => {
  it('« Avatar actif · v3 » et « Créé avec Avatar v2 »', () => {
    expect(libelleAvatarActif(3)).toBe('Avatar actif · v3');
    expect(libelleCreeAvecVersion(2)).toBe('Créé avec Avatar v2');
  });
});

describe('choisirRenduRecent — la version ACTIVE uniquement', () => {
  const vraie = (url: unknown, id: string) => url === urlDe(id);
  it('⚠️ ne choisit JAMAIS une génération d’une ancienne version, même plus récente', () => {
    const lignes = [ligne(1), ligne(5, { avatar_version: 2 }), ligne(6, { avatar_version: 1 })];
    expect(choisirRenduRecent(lignes, { avatarId: A, version: 3 }, vraie)?.generationId).toBe(g(1));
  });
  it('la plus récente de la version active ; ignore en cours, échec, URL étrangère, autre avatar', () => {
    const lignes = [
      ligne(1), ligne(2),
      ligne(3, { status: 'processing' }), ligne(4, { status: 'failed' }),
      ligne(5, { video_url: 'https://fournisseur.example/v.mp4' }),
      ligne(6, { user_avatar_id: '99999999-9999-4999-8999-999999999999' }),
    ];
    expect(choisirRenduRecent(lignes, { avatarId: A, version: 3 }, vraie)).toEqual({ generationId: g(2), url: urlDe(g(2)), version: 3, creeLe: '2026-10-02T10:00:00Z' });
  });
  it('aucune génération de la version active → null (rien n’est inventé)', () => {
    expect(choisirRenduRecent([ligne(1, { avatar_version: 2 })], { avatarId: A, version: 3 }, vraie)).toBeNull();
    expect(choisirRenduRecent([], { avatarId: A, version: 3 }, vraie)).toBeNull();
  });
});

describe('renduRecentDuClone — lecture en base, filtrée par avatar ET version', () => {
  it('⚠️ rend la vidéo de la version active ; filtre user_id, user_avatar_id, avatar_version, status', async () => {
    base.generations = [
      { ...ligne(1), user_id: U, intention: 'normale' },
      { ...ligne(4, { avatar_version: 2 }), user_id: U, intention: 'normale' },
    ];
    const r = await renduRecentDuClone(U, A, 3);
    expect(r?.generationId).toBe(g(1));
    expect(base.filtres).toEqual(expect.arrayContaining(['user_id', 'user_avatar_id', 'avatar_version', 'status']));
  });
  it('seulement des générations v2 alors que l’avatar est v3 → null', async () => {
    base.generations = [{ ...ligne(4, { avatar_version: 2 }), user_id: U, intention: 'normale' }];
    expect(await renduRecentDuClone(U, A, 3)).toBeNull();
  });
  it('version invalide → null, aucune lecture', async () => {
    expect(await renduRecentDuClone(U, A, 0)).toBeNull();
    expect(base.filtres).toEqual([]);
  });
});

describe('version épinglée d’une génération — statut', () => {
  it('⚠️ génération terminée v2 : avatarVersion 2 rendu, AUCUN appel fournisseur', async () => {
    base.generations = [{ ...ligne(1, { avatar_version: 2 }), user_id: U, provider: 'heygen', provider_video_id: 'pv', credits_charged: 0, credits_refunded: false }];
    const r = await avancerStatutGeneration(U, g(1));
    expect(r).toEqual({ status: 'completed', videoUrl: urlDe(g(1)), avatarVersion: 2 });
    expect(fournisseur.appels).toBe(0);
  });
  it('version absente en base : la forme du résultat est inchangée (pas de clé avatarVersion)', async () => {
    base.generations = [{ ...ligne(1), avatar_version: undefined, user_id: U, provider: 'heygen', provider_video_id: 'pv', credits_charged: 0, credits_refunded: false }];
    expect(await avancerStatutGeneration(U, g(1))).toEqual({ status: 'completed', videoUrl: urlDe(g(1)) });
  });
});

describe('rush d’un brouillon → génération, et comparaison de versions', () => {
  it('reconnaît une vidéo de jumeau re-hébergée, rien d’autre', () => {
    expect(generationDepuisRush(urlDe(g(7)))).toBe(g(7));
    expect(generationDepuisRush(`${urlDe(g(7))}?v=1`)).toBe(g(7));
    expect(generationDepuisRush(`${RELAIS}/${U}/rushes/plage.mp4`)).toBeNull();
    expect(generationDepuisRush(null)).toBeNull();
  });
  it('périmée seulement sur preuve : deux versions connues et différentes', () => {
    expect(versionPerimee(2, 3)).toBe(true);
    expect(versionPerimee(3, 3)).toBe(false);
    expect(versionPerimee(null, 3)).toBe(false);
    expect(versionPerimee(2, null)).toBe(false);
  });
});

describe('Autopilote et Créer — l’avatar courant relu à chaque génération', () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  it('⚠️ la configuration Autopilote ne fige ni version ni identifiant fournisseur', () => {
    const config = lire('app/api/autopilot/config/route.ts');
    expect(config).not.toMatch(/avatar_version|provider_avatar_id|user_avatar_id/);
  });
  it('⚠️ la génération du jumeau (Créer comme Autopilote) passe par resoudreJumeauDuCompte et épingle avatar + version', () => {
    const moteur = lire('lib/avatar/moteur-jumeau.ts');
    expect(moteur).toContain('const jumeau = await resoudreJumeauDuCompte(args.userId);');
    expect(moteur).toMatch(/user_avatar_id: avatar\.id, avatar_version: avatar\.version/);
    expect(lire('lib/autopilot/jumeau-async.ts')).toContain("import { genererVideoJumeau, reconcilierLancement } from '@/lib/avatar/moteur-jumeau';");
  });
  it('⚠️ aucun code d’identité n’écrit dans les posts ni dans les générations (anciens rendus inchangés)', () => {
    for (const p of ['lib/avatar/identite.ts', 'app/api/avatar/apercu/route.ts']) {
      const src = lire(p);
      expect(src, p).not.toMatch(/\.(update|insert|upsert|delete)\(/);
      expect(src, p).not.toContain('scheduled_posts');
    }
  });
});
