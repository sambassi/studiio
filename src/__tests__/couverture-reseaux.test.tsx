/**
 * Miniature / couverture pour tous les réseaux + réglages TikTok.
 *
 * Une couverture Studiio (`auto` | `frame` | `upload`) traduite par réseau
 * selon ce que Zernio accepte réellement (docs.zernio.com, 2026-10-08).
 * Aucun appel réel : Zernio, la base et l'extraction d'image sont simulés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import {
  reglagesCouverture, tiktokSettings, validerTiktok, lireCouverture, lireReglagesTiktok,
  resumeCouverture, besoinImageExtraite, type Couverture, type ReglagesTiktok,
} from '@/lib/social/couverture';

const IMG = 'https://cdn.example/couv.jpg';
const FRAME: Couverture = { mode: 'frame', frameMs: 2500 };
const UPLOAD: Couverture = { mode: 'upload', imageUrl: IMG };
const TT: ReglagesTiktok = { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: false, allow_stitch: false, consentement: true };

describe('traduction par réseau (pure)', () => {
  it('auto / absente : aucun réglage', () => {
    for (const r of ['instagram', 'facebook', 'tiktok', 'youtube'] as const) {
      for (const c of [null, { mode: 'auto' } as Couverture]) {
        const p = reglagesCouverture(r, c, { format: 'tv' });
        expect(p).toEqual({ reseau: r, applique: 'auto', repli: null });
      }
    }
  });
  it('Instagram : image → instagramThumbnail ; moment → thumbOffset', () => {
    expect(reglagesCouverture('instagram', UPLOAD).platformSpecificData).toEqual({ instagramThumbnail: IMG });
    expect(reglagesCouverture('instagram', FRAME).platformSpecificData).toEqual({ thumbOffset: 2500 });
  });
  it('TikTok : image → video_cover_image_url ; moment → video_cover_timestamp_ms, dans tiktokSettings complet', () => {
    expect(tiktokSettings(TT, reglagesCouverture('tiktok', UPLOAD))).toEqual({
      privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: false, allow_stitch: false,
      content_preview_confirmed: true, express_consent_given: true, video_cover_image_url: IMG,
    });
    expect(tiktokSettings(TT, reglagesCouverture('tiktok', FRAME))).toMatchObject({ video_cover_timestamp_ms: 2500 });
  });
  it('Facebook / YouTube vidéo : image → mediaItems.thumbnail ; moment → image EXTRAITE', () => {
    for (const r of ['facebook', 'youtube'] as const) {
      expect(reglagesCouverture(r, UPLOAD, { format: 'tv' }).miniatureMedia).toBe(IMG);
      const p = reglagesCouverture(r, FRAME, { format: 'tv', imageExtraite: 'https://s/x.jpg' });
      expect(p).toMatchObject({ applique: 'image-extraite', miniatureMedia: 'https://s/x.jpg', repli: null });
    }
  });
  it('moment sans image extraite : repli automatique, dit en clair', () => {
    const p = reglagesCouverture('facebook', FRAME, { imageExtraite: null });
    expect(p.applique).toBe('auto');
    expect(p.repli).toContain('automatiquement');
  });
  it('YouTube Short (format reel) : jamais de miniature, repli expliqué', () => {
    const p = reglagesCouverture('youtube', UPLOAD, { format: 'reel' });
    expect(p.applique).toBe('auto');
    expect(p.miniatureMedia).toBeUndefined();
    expect(p.repli).toContain('Shorts');
    expect(resumeCouverture('youtube', UPLOAD, 'reel')).toBe('YouTube Short : couverture choisie automatiquement par YouTube');
  });
  it('image extraite seulement si un réseau en a besoin', () => {
    expect(besoinImageExtraite(['instagram', 'tiktok'], FRAME, 'reel')).toBe(false);
    expect(besoinImageExtraite(['youtube'], FRAME, 'reel')).toBe(false);
    expect(besoinImageExtraite(['facebook'], FRAME, 'reel')).toBe(true);
    expect(besoinImageExtraite(['youtube'], FRAME, 'tv')).toBe(true);
    expect(besoinImageExtraite(['facebook'], UPLOAD, 'tv')).toBe(false);
  });
});

describe('TikTok : consentement explicite', () => {
  it('sans réglages ou sans case cochée : refus AVANT le fournisseur', () => {
    expect(validerTiktok(null).ok).toBe(false);
    const r = validerTiktok({ ...TT, consentement: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toContain('Je confirme avoir vérifié ce contenu');
  });
  it('jamais true sans consentement', () => {
    const s = tiktokSettings({ ...TT, consentement: false }, null);
    expect(s.content_preview_confirmed).toBe(false);
    expect(s.express_consent_given).toBe(false);
  });
  it('lecture stricte des métadonnées', () => {
    expect(lireReglagesTiktok({ tiktok: { ...TT, privacy_level: 'TOUT_LE_MONDE' } })).toBeNull();
    expect(lireReglagesTiktok({ tiktok: { ...TT, consentement: 'oui' } })?.consentement).toBe(false);
  });
});

describe('modèle : lecture et persistance', () => {
  it('couverture invalide → null (ancien comportement)', () => {
    expect(lireCouverture({})).toBeNull();
    expect(lireCouverture({ cover: { mode: 'upload', imageUrl: 'data:image/png;base64,xx' } })).toBeNull();
    expect(lireCouverture({ cover: { mode: 'frame', frameMs: -5 } })).toBeNull();
    expect(lireCouverture({ cover: { mode: 'frame', frameMs: 1234.6 } })).toEqual({ mode: 'frame', frameMs: 1235 });
  });
  it('brouillon Créer : couverture conservée, consentement TikTok JAMAIS restauré', () => {
    const src = readFileSync(resolve(__dirname, '../lib/creer/draft.ts'), 'utf-8');
    expect(src).toContain('couverture: lireCouverture({ cover: raw.couverture }) ?? undefined');
    expect(src).toContain('return r ? { ...r, consentement: false } : undefined;');
    // La même lecture que celle du brouillon : le consentement est retiré.
    const r = lireReglagesTiktok({ tiktok: TT });
    expect(r ? { ...r, consentement: false } : null).toMatchObject({ consentement: false, privacy_level: 'PUBLIC_TO_EVERYONE' });
  });
  it('Calendrier : « Réessayer » conserve metadata (dont cover et tiktok)', () => {
    const cal = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');
    expect(cal).toContain('metadata: { ...post.metadata, error: null, cron_publish_results: null },');
    expect(cal).toContain('cover: lireCouverture(editFormData.metadata),');
  });
  it('Créer : la couverture et TikTok partent dans la métadonnée du post', () => {
    const w = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(w).toContain("...(couverture && couverture.mode !== 'auto' ? { cover: couverture } : null),");
    expect(w).toContain("...(programmationEffective && reseauxProgrammes.includes('tiktok') && reglagesTiktok ? { tiktok: reglagesTiktok } : null),");
  });
});

// ── publierViaZernio : la requête réellement envoyée ──────────────────────
type Ligne = Record<string, any>;
const base: Record<string, Ligne[]> = {};
vi.mock('@/lib/db/supabase', () => {
  const chaine = (table: string) => {
    const filtres: Array<(l: Ligne) => boolean> = [];
    let maj: Ligne | null = null;
    const exec = () => {
      const lignes = (base[table] ?? []).filter((l) => filtres.every((f) => f(l)));
      if (maj) for (const l of lignes) Object.assign(l, maj);
      return { data: lignes.map((l) => ({ ...l })), error: null };
    };
    const b: any = {
      select: () => b, update: (v: Ligne) => { maj = v; return b; },
      eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return b; },
      limit: () => b,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };
  const client = { from: (t: string) => chaine(t) };
  return { supabaseAdmin: client, supabase: client };
});
vi.mock('@/lib/admin', () => ({ isAdmin: () => true }));
const createPost = vi.fn();
vi.mock('@/lib/social/zernio', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/zernio')>()),
  zernioConfigured: () => true,
  uploadMedia: vi.fn(async () => 'https://zernio.example/tmp/video.mp4'),
  createPost: (...a: unknown[]) => createPost(...a),
}));
const imageDepuisVideo = vi.fn(async () => 'https://studiio.test/storage/v1/object/public/media/u1/couvertures/frame.jpg');
vi.mock('@/lib/social/imageDepuisVideo', () => ({ imageDepuisVideo: (...a: unknown[]) => imageDepuisVideo(...(a as [])) }));

const COMPTES = ['instagram', 'facebook', 'tiktok', 'youtube'].map((p) => ({ user_id: 'u1', account_id: `acc-${p}`, platform: p, username: p, status: 'connected' }));
async function publier(platforms: string[], metadata: Ligne, format = 'tv') {
  base.scheduled_posts = [{ id: 'p1', metadata }];
  const { publierViaZernio } = await import('@/lib/social/publishViaZernio');
  return publierViaZernio({ id: 'p1', userId: 'u1', caption: 'x', mediaUrl: 'https://cdn.example/m.mp4', platforms, format });
}
const corps = (i = 0) => createPost.mock.calls[i]?.[0] as { platforms: Array<Record<string, any>>; mediaUrl?: string };
/** Miniature posée sur le média d'UNE entrée (`customMedia`), ou `undefined`. */
const miniatureDe = (entree: Record<string, any> | undefined) => entree?.customMedia?.[0]?.thumbnail as string | undefined;
const aucuneMiniature = (i = 0) => corps(i).platforms.every((p) => p.customMedia === undefined);

describe('publierViaZernio : requête par réseau', () => {
  beforeEach(() => {
    base.users = [{ id: 'u1', email: 'a@b', publishing_enabled: true, zernio_profile_id: 'p' }];
    base.zernio_accounts = COMPTES.map((c) => ({ ...c }));
    createPost.mockReset();
    createPost.mockImplementation(async () => ({ _id: 'zp-1' }));
    imageDepuisVideo.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('sans couverture (et sans TikTok) : la requête d’avant, au champ près', async () => {
    await publier(['Instagram', 'Facebook', 'YouTube'], {});
    expect(corps().platforms).toEqual([
      { platform: 'instagram', accountId: 'acc-instagram' },
      { platform: 'facebook', accountId: 'acc-facebook' },
      { platform: 'youtube', accountId: 'acc-youtube' },
    ]);
    expect(aucuneMiniature()).toBe(true);
    expect(imageDepuisVideo).not.toHaveBeenCalled();
  });

  it('image : Instagram instagramThumbnail, Facebook/YouTube mediaItems.thumbnail, TikTok video_cover_image_url', async () => {
    const r = await publier(['Instagram', 'Facebook', 'TikTok', 'YouTube'], { cover: UPLOAD, tiktok: TT });
    expect(r.ok).toBe(true);
    const [ig, fb, tt, yt] = corps().platforms;
    expect(ig.platformSpecificData).toEqual({ instagramThumbnail: IMG });
    expect(fb.platformSpecificData).toBeUndefined();
    expect(yt.platformSpecificData).toBeUndefined();
    expect(tt.platformSpecificData.tiktokSettings).toMatchObject({ video_cover_image_url: IMG, express_consent_given: true, privacy_level: 'PUBLIC_TO_EVERYONE' });
    // Facebook et YouTube : la même vidéo, avec SA miniature ; Instagram/TikTok : pas de customMedia.
    expect(fb.customMedia).toEqual([{ type: 'video', url: 'https://zernio.example/tmp/video.mp4', thumbnail: IMG }]);
    expect(miniatureDe(yt)).toBe(IMG);
    expect(ig.customMedia).toBeUndefined();
    expect(tt.customMedia).toBeUndefined();
  });

  it('moment : Instagram/TikTok reçoivent le moment ; Facebook/YouTube l’image EXTRAITE (une seule extraction)', async () => {
    await publier(['Instagram', 'Facebook', 'TikTok', 'YouTube'], { cover: FRAME, tiktok: TT });
    const [ig, , tt] = corps().platforms;
    expect(ig.platformSpecificData).toEqual({ thumbOffset: 2500 });
    expect(tt.platformSpecificData.tiktokSettings.video_cover_timestamp_ms).toBe(2500);
    expect(imageDepuisVideo).toHaveBeenCalledTimes(1);
    expect(imageDepuisVideo).toHaveBeenCalledWith('https://cdn.example/m.mp4', 2500, 'u1');
    expect(miniatureDe(corps().platforms[1])).toContain('/couvertures/frame.jpg');
    expect(miniatureDe(corps().platforms[3])).toContain('/couvertures/frame.jpg');
  });

  it('YouTube Short : pas de miniature, publication normale, repli enregistré', async () => {
    const r = await publier(['YouTube'], { cover: UPLOAD }, 'reel');
    expect(r.ok).toBe(true);
    expect(aucuneMiniature()).toBe(true);
    expect(base.scheduled_posts[0].metadata.avertissementsPublication.join(' ')).toContain('Shorts');
  });

  it('Facebook + YouTube Short dans le même post : Facebook GARDE sa miniature, le Short n’en reçoit aucune', async () => {
    const r = await publier(['Facebook', 'YouTube'], { cover: UPLOAD }, 'reel');
    expect(r.ok).toBe(true);
    expect(createPost).toHaveBeenCalledTimes(1);
    const [fb, yt] = corps().platforms;
    expect(miniatureDe(fb)).toBe(IMG);
    expect(yt.customMedia).toBeUndefined();
    expect(corps().mediaUrl).toBe('https://zernio.example/tmp/video.mp4');
  });

  it('TikTok SANS consentement, seul : bloqué avant le fournisseur, message clair', async () => {
    const r = await publier(['TikTok'], { tiktok: { ...TT, consentement: false } });
    expect(createPost).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toContain('Je confirme avoir vérifié ce contenu');
  });

  it('TikTok avec consentement : réglages complets, sans couverture', async () => {
    await publier(['TikTok'], { tiktok: TT });
    expect(corps().platforms[0].platformSpecificData.tiktokSettings).toEqual({
      privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: false, allow_stitch: false,
      content_preview_confirmed: true, express_consent_given: true,
    });
  });

  it('couverture refusée par le réseau (400) : renvoi SANS couverture, la vidéo part, repli noté', async () => {
    const { ZernioError } = await import('@/lib/social/zernio');
    createPost.mockImplementationOnce(async () => { throw new ZernioError('x', 400, undefined, 'VALIDATION', 'thumbnail too large'); });
    const r = await publier(['Instagram', 'YouTube'], { cover: UPLOAD });
    expect(r.ok).toBe(true);
    expect(createPost).toHaveBeenCalledTimes(2);
    expect(corps(1).platforms[0].platformSpecificData).toBeUndefined();
    expect(aucuneMiniature(1)).toBe(true);
    expect(base.scheduled_posts[0].metadata.avertissementsPublication.join(' ')).toContain('Couverture refusée');
  });

  it('refus d’autorisation (403) : PAS de renvoi — ce n’est pas la couverture', async () => {
    const { ZernioError } = await import('@/lib/social/zernio');
    createPost.mockImplementationOnce(async () => { throw new ZernioError('x', 403, undefined, 'ACCOUNT_DISCONNECTED', 'Account acc-instagram (instagram) is disconnected'); });
    const r = await publier(['Instagram'], { cover: UPLOAD });
    expect(r.ok).toBe(false);
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it('extraction impossible : publication quand même, couverture automatique', async () => {
    imageDepuisVideo.mockImplementationOnce(async () => null as never);
    const r = await publier(['Facebook'], { cover: FRAME });
    expect(r.ok).toBe(true);
    expect(aucuneMiniature()).toBe(true);
  });
});

describe('écran : zone unique, résumé par réseau, TikTok honnête', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('contrôle des images : type et poids', async () => {
    const { verifierImageCouverture } = await import('@/components/social/ReglagesPublicationReseaux');
    expect(verifierImageCouverture({ type: 'image/gif', size: 10 })).toContain('Format');
    expect(verifierImageCouverture({ type: 'image/png', size: 11 * 1024 * 1024 })).toContain('trop lourde');
    expect(verifierImageCouverture({ type: 'image/jpeg', size: 1000 })).toBeNull();
  });
  it('réglages TikTok indisponibles : « Moi uniquement » annoncé, consentement NON coché', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, fiable: false, confidentialites: ['SELF_ONLY'], interactions: null }) })));
    const { default: Zone } = await import('@/components/social/ReglagesPublicationReseaux');
    let valeur = { cover: null as Couverture | null, tiktok: null as ReglagesTiktok | null };
    const { rerender } = render(<Zone reseaux={['tiktok', 'youtube']} format="reel" value={valeur} onChange={(m) => { valeur = { ...valeur, ...m }; }} />);
    await waitFor(() => expect(valeur.tiktok).not.toBeNull());
    rerender(<Zone reseaux={['tiktok', 'youtube']} format="reel" value={valeur} onChange={(m) => { valeur = { ...valeur, ...m }; }} />);
    expect(valeur.tiktok).toMatchObject({ privacy_level: 'SELF_ONLY', consentement: false, allow_comment: false });
    expect(screen.getByText(/TikTok sera publié en « Moi uniquement »/)).toBeTruthy();
    expect((document.querySelector('[data-tiktok-consentement]') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('YouTube Short : couverture choisie automatiquement')).toBeTruthy();
  });
  it('la lecture TikTok (asynchrone) n’efface JAMAIS une couverture choisie entre-temps', async () => {
    let repondre: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { repondre = r; })));
    const { default: Zone } = await import('@/components/social/ReglagesPublicationReseaux');
    const modifs: Array<Record<string, unknown>> = [];
    render(<Zone reseaux={['tiktok']} format="reel" value={{ cover: null, tiktok: null }} onChange={(m) => modifs.push(m)} />);
    (document.querySelector('[data-couverture-mode="frame"]') as HTMLElement).click();
    repondre({ json: async () => ({ fiable: false, confidentialites: ['SELF_ONLY'], interactions: null }) });
    await waitFor(() => expect(modifs.some((m) => 'tiktok' in m)).toBe(true));
    for (const m of modifs) expect(Object.keys(m).length).toBe(1);
    expect(modifs.find((m) => 'tiktok' in m)).not.toHaveProperty('cover');
  });
  it('Créer (pas de montage) : « image dans la vidéo » renvoie vers le Calendrier', async () => {
    const { default: Zone } = await import('@/components/social/ReglagesPublicationReseaux');
    render(<Zone reseaux={['instagram']} format="tv" videoUrl={null} value={{ cover: FRAME, tiktok: null }} onChange={() => {}} />);
    expect(document.querySelector('[data-couverture-frame-indisponible]')?.textContent).toContain('Calendrier');
    expect(screen.getByText('Instagram : moment choisi dans la vidéo')).toBeTruthy();
  });
});
