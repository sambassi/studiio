// @vitest-environment node
/**
 * #547 — la vidéo de démo de l'accueil vit sous le dossier de
 * l'administrateur (`media/<adminId>/demo/…`), que le relais ne sert plus sans
 * session. Le GET du contenu de l'accueil la remet munie d'un jeton ; le
 * PATCH de l'éditeur ne persiste JAMAIS ce jeton (il expirerait en base).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const etat = vi.hoisted(() => ({ valeur: null as unknown }));

vi.mock('@/lib/db/supabase', () => {
  const q: any = {
    select: () => q,
    eq: () => q,
    single: async () => (etat.valeur ? { data: { value: etat.valeur }, error: null } : { data: null, error: { code: 'PGRST116' } }),
    maybeSingle: async () => ({ data: etat.valeur ? { value: etat.valeur } : null, error: null }),
    upsert: async (l: { value: string }) => { etat.valeur = l.value; return { error: null }; },
  };
  return { supabaseAdmin: { from: () => q } };
});
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => ({ error: null, session: { user: { email: 'admin@studiio.pro' } } }),
  logAdminAction: async () => undefined,
}));

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
const landing = await import('@/app/api/admin/landing/route');
const { jetonRelaisValide } = await import('@/lib/storage/jeton-relais');

const ADMIN = 'aaaaaaaa-1111-4111-8111-111111111111';
const CLE = `${ADMIN}/demo/1756400000000-demo.mp4`;
const NUE = `https://studiio.pro/storage/v1/object/public/media/${CLE}`;

beforeEach(() => { etat.valeur = JSON.stringify({ hero: { title: 'T', demoVideoUrl: NUE } }); });

describe('Vidéo de démo de l accueil', () => {
  it('GET : URL munie d un jeton valide pour CETTE clé, même chemin', async () => {
    const res = await landing.GET();
    const { content } = await res.json();
    const u = new URL(content.hero.demoVideoUrl);
    expect(`${u.origin}${u.pathname}`).toBe(NUE);
    expect(jetonRelaisValide('media', CLE, u.searchParams.get('sr'))).toBe(true);
    expect(content.hero.title).toBe('T');
  });

  it('PATCH de l éditeur (qui renvoie l URL signée) : la base garde l URL NUE', async () => {
    const { content } = await (await landing.GET()).json();
    const req = new NextRequest('https://studiio.pro/api/admin/landing', {
      method: 'PATCH', body: JSON.stringify({ hero: content.hero }),
    });
    expect((await landing.PATCH(req)).status).toBe(200);
    expect(JSON.parse(etat.valeur as string).hero.demoVideoUrl).toBe(NUE);
  });

  it('URL externe : inchangée', async () => {
    etat.valeur = JSON.stringify({ hero: { demoVideoUrl: 'https://youtu.be/x' } });
    const { content } = await (await landing.GET()).json();
    expect(content.hero.demoVideoUrl).toBe('https://youtu.be/x');
  });
});
