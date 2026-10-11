/**
 * CRÉER MULTI-SOURCES — la séquence « Vidéo » combine, dans l'ordre choisi,
 * Mes rushes, Mon avatar, Vidéos suggérées, Photos suggérées, Ma médiathèque.
 *
 *  - liste déduite d'un brouillon d'avant = IDENTIQUE (rien n'est écrit) ;
 *  - gestes : ajouter / déplacer / retirer / remplacer / recadrer par source ;
 *  - « Mon avatar » désactivé tant que l'avatar n'est pas prêt ;
 *  - plan dans l'ordre (Mon avatar → Mon rush → Vidéo suggérée → Mon avatar →
 *    Photo suggérée), invariant lip-sync de l'avatar ;
 *  - compositeur : photo en Ken Burns, garde #518 sur un média manquant,
 *    avatar seul à parler (plans de coupe muets) ;
 *  - jumeau produit UNE fois, prix inchangé ;
 *  - aucun nom de fournisseur ni de fichier dans les libellés visibles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, fireEvent, act } from '@testing-library/react';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import {
  listeDepuisRushs, rushsDeListe, estListeEnrichie, ajouterMedia, deplacerMedia, retirerMedia, remplacerMedia,
  poserVideoAvatar, planDepuisListe, planDetaille, dureeListe, libelleMedia, libelleSource, sanitizeMediasVideo, reconcilierListe,
  urlsRecadrables, avatarAProduire, listeDepuisSegments, estVideoJumeau, DUREE_PHOTO_DEFAUT, type MediaVideo,
} from '@/lib/creer/medias-video';
import { avatarSynchronise } from '@/lib/autopilot/plan-multi-sources';
import { estPlanMontage, rushSegmentsDepuisMetadata, type RushItem } from '@/lib/creer/multi-rush';
import { sanitizeDraft as sanitizeDraftBrut, DRAFT_VERSION } from '@/lib/creer/draft';

const DEPS = {
  themeIds: ['fitness'], toneIds: ['pro'], formats: ['9:16'], maxStep: 3,
  defaults: {
    themeId: 'fitness', toneId: 'pro', format: '9:16',
    titleStyle: {}, subtitleStyle: {}, ctaStyle: {},
    sequences: [{ key: 'intro', enabled: true }],
    durations: { intro: 4, cards: 6, video: 8, cta: 4 },
  },
};
const sanitizeDraft = (raw: Record<string, unknown>) => sanitizeDraftBrut({ version: DRAFT_VERSION, ...raw }, DEPS as never);
import {
  composeVideo, drawVideoSeq, recadrageImageKenBurns, estMontageMixte, mediasMixtesManquants, ajusterPlanMixte,
  MESSAGE_PHOTO_INDISPONIBLE, type ComposerOptions,
} from '@/lib/video-composer';
import { MediaIndisponibleError } from '@/lib/rendus/medias-requis';
import { ZOOM_KEN_BURNS } from '@/lib/creer/ken-burns';
import MediasSequenceVideo, { type MediasSequenceVideoProps } from '@/components/creer/MediasSequenceVideo';

const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-plage.mp4';
const STOCK_V = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-123.mp4';
const PHOTO = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg';
const AVATAR = '/storage/v1/object/public/media/u1/avatar/gen-42.mp4';

const rushs: RushItem[] = [
  { url: RUSH, name: 'rush-plage.mp4', secondes: 4 },
  { url: STOCK_V, name: 'stock-pexels-video-123.mp4', secondes: 5 },
];

/** L'exemple visible : Mon avatar → Mon rush → Vidéo suggérée → Mon avatar → Photo suggérée. */
function exemple(avatarUrl?: string, avatarDuree?: number): MediaVideo[] {
  const a = (id: string): MediaVideo => ({ id, source: 'avatar', type: 'video', ...(avatarUrl ? { url: avatarUrl } : {}), duree: avatarDuree ?? null });
  return [
    a('a1'),
    { id: 'r1', source: 'rush', type: 'video', url: RUSH, duree: 4, nom: 'rush-plage.mp4' },
    { id: 's1', source: 'stock-video', type: 'video', url: STOCK_V, duree: 5, nom: 'stock-pexels-video-123.mp4' },
    a('a2'),
    { id: 'p1', source: 'stock-photo', type: 'image', url: PHOTO, duree: DUREE_PHOTO_DEFAUT },
  ];
}

describe('liste déduite d’un brouillon d’avant', () => {
  it('rushes seuls : vue des rushes, aller-retour identique, jamais « enrichie »', () => {
    const l = listeDepuisRushs(rushs);
    expect(l.map((m) => [m.source, m.type, m.url, m.duree])).toEqual([
      ['rush', 'video', RUSH, 4],
      ['stock-video', 'video', STOCK_V, 5],
    ]);
    expect(estListeEnrichie(l)).toBe(false);
    expect(rushsDeListe(l)).toEqual(rushs.map((r) => ({ url: r.url, name: r.name, secondes: r.secondes })));
    // Dérivation stable : mêmes ids d'un rendu à l'autre.
    expect(listeDepuisRushs(rushs).map((m) => m.id)).toEqual(l.map((m) => m.id));
  });

  it('un brouillon d’avant se relit SANS `mediasVideo` (brouillon identique)', () => {
    const d = sanitizeDraft({ rushUrl: RUSH, rushName: 'a.mp4', rushSecondes: 4, rushSuivants: [{ url: STOCK_V, name: 'b', secondes: 5 }] });
    expect(d?.mediasVideo).toBeUndefined();
    expect(d?.rushUrl).toBe(RUSH);
  });

  it('la vidéo du jumeau posée comme rush (parcours d’avant) se lit « Mon avatar » sans changer de nature', () => {
    const l = listeDepuisRushs([{ url: AVATAR, name: 'Mon jumeau (v3)', secondes: 10 }]);
    expect(l[0].source).toBe('rush');
    expect(l[0].meta?.jumeau).toBe(true);
    expect(estListeEnrichie(l)).toBe(false);
    expect(libelleMedia(l[0])).toBe('Mon avatar · 0:10');
    expect(estVideoJumeau({ url: RUSH, name: 'x' })).toBe(false);
  });
});

describe('gestes par source', () => {
  const base = listeDepuisRushs(rushs);
  it('ajouter une photo / un avatar rend la liste enrichie ; les vidéos restent les rushes', () => {
    const l1 = ajouterMedia(base, { id: 'p', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3 });
    expect(estListeEnrichie(l1)).toBe(true);
    expect(rushsDeListe(l1).map((r) => r.url)).toEqual([RUSH, STOCK_V]);
    const l2 = ajouterMedia(l1, { id: 'a', source: 'avatar', type: 'video', duree: null }, 0);
    expect(l2[0].source).toBe('avatar');
    expect(avatarAProduire(l2)).toBe(true);
    expect(rushsDeListe(l2).map((r) => r.url)).toEqual([RUSH, STOCK_V]);
  });
  it('déplacer, retirer, remplacer (même place)', () => {
    const l = exemple();
    expect(deplacerMedia(l, 4, -1).map((m) => m.id)).toEqual(['a1', 'r1', 's1', 'p1', 'a2']);
    expect(deplacerMedia(l, 0, -1).map((m) => m.id)).toEqual(l.map((m) => m.id));
    expect(retirerMedia(l, 1).map((m) => m.id)).toEqual(['a1', 's1', 'a2', 'p1']);
    const r = remplacerMedia(l, 2, { id: 'm1', source: 'mediatheque', type: 'image', url: '/media/u1/plage.jpg', duree: 3 });
    expect(r.map((m) => m.id)).toEqual(['a1', 'r1', 'm1', 'a2', 'p1']);
    // Retirer toutes les photos et l'avatar : la liste redevient la vue des rushes.
    expect(estListeEnrichie(l.filter((m) => m.source !== 'avatar' && m.type !== 'image'))).toBe(false);
  });
  it('recadrer : vidéos ET photos (jamais l’avatar), recadrage conservé au brouillon', () => {
    const l = exemple(AVATAR, 20);
    expect(urlsRecadrables(l)).toEqual([RUSH, STOCK_V, PHOTO]);
    const d = sanitizeDraft({
      mediasVideo: l,
      rushUrl: RUSH,
      rushTransforms: { [PHOTO]: { scale: 1.5, offsetX: 0.1, offsetY: 0 }, 'https://x/mort.mp4': { scale: 2, offsetX: 0, offsetY: 0 } },
    });
    expect(d?.rushTransforms?.[PHOTO]).toEqual({ scale: 1.5, offsetX: 0.1, offsetY: 0 });
    expect(d?.rushTransforms?.['https://x/mort.mp4']).toBeUndefined();
  });
  it('brouillon : placeholder d’avatar gardé, `blob:` / `javascript:` écartés, forme bornée', () => {
    const s = sanitizeMediasVideo([
      { id: 'a', source: 'avatar', type: 'video' },
      { id: 'b', source: 'rush', type: 'video', url: 'blob:https://studiio.pro/1' },
      { id: 'c', source: 'stock-photo', type: 'image', url: 'javascript:alert(1)' },
      { id: 'd', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3, meta: { ia: true, autre: 1 } },
      { id: 'e', source: 'inconnue', type: 'video', url: RUSH },
    ]);
    expect(s?.map((m) => m.id)).toEqual(['a', 'd']);
    expect(s?.[1].meta).toEqual({ ia: true });
    expect(sanitizeMediasVideo([])).toBeUndefined();
  });
  it('les gestes d’avant sur les rushes s’accordent à la liste (retrait, ajout en fin, durée)', () => {
    const l = exemple();
    const r = reconcilierListe(l, [{ url: RUSH, name: 'rush-plage.mp4', secondes: 6 }, { url: '/m/nouveau.mp4', name: 'nouveau.mp4', secondes: 3 }]);
    expect(r.map((m) => m.source)).toEqual(['avatar', 'rush', 'avatar', 'stock-photo', 'rush']);
    expect(r[1].duree).toBe(6);
    // Rien ne change : la MÊME liste (aucun rendu inutile).
    expect(reconcilierListe(l, [{ url: RUSH, name: '', secondes: 4 }, { url: STOCK_V, name: '', secondes: 5 }])).toBe(l);
  });
});

describe('plan : l’ordre de l’utilisateur', () => {
  it('Mon avatar → Mon rush → Vidéo suggérée → Mon avatar → Photo suggérée, lip-sync', () => {
    const { plan, duree, ignores } = planDepuisListe(exemple(AVATAR, 20));
    expect(ignores).toBe(0);
    expect(plan.map((s) => s.kind)).toEqual(['avatar', 'video', 'video', 'avatar', 'image']);
    expect(plan.map((s) => s.url)).toEqual([AVATAR, RUSH, STOCK_V, AVATAR, PHOTO]);
    expect(plan.map((s) => s.source)).toEqual(['jumeau', 'rush', 'stock', 'jumeau', 'photo']);
    // Contigu, de 0 à la parole de l'avatar.
    expect(plan[0].debut).toBe(0);
    plan.slice(1).forEach((s, i) => expect(s.debut).toBe(plan[i].fin));
    expect(duree).toBe(20);
    // Plans de coupe à leur durée ; les créneaux d'avatar se partagent le reste.
    expect(plan[1].fin - plan[1].debut).toBeCloseTo(4, 3);
    expect(plan[2].fin - plan[2].debut).toBeCloseTo(5, 3);
    expect(plan[4].fin - plan[4].debut).toBeCloseTo(3, 3);
    expect(plan[0].fin - plan[0].debut).toBeCloseTo(4, 3);
    expect(avatarSynchronise(plan)).toBe(true);
    expect(plan.filter((s) => s.kind === 'avatar').every((s) => s.depuis === s.debut)).toBe(true);
    expect(plan[4].mouvement).toBe('zoomIn');
  });
  it('parole courte : AUCUN média raccourci en silence — dépassement déclaré, médias à leur durée', () => {
    const r = planDepuisListe(exemple(AVATAR, 8));
    // 4 + 5 + 3 = 12 s de médias, 8 − 2 × 1,5 = 5 s disponibles → 7 s de trop.
    expect(r.depassement).toBe(7);
    expect(r.plan.filter((x) => x.kind !== 'avatar').map((s) => s.fin - s.debut)).toEqual([4, 5, 3]);
    for (const s of r.plan.filter((x) => x.kind === 'avatar')) expect(s.fin - s.debut).toBeCloseTo(1.5, 6);
    expect(avatarSynchronise(r.plan)).toBe(true);
  });
  it('parole très courte : aucun média choisi ne disparaît du plan', () => {
    const r = planDepuisListe(exemple(AVATAR, 2));
    expect(r.plan.map((s) => s.kind)).toEqual(['avatar', 'video', 'video', 'avatar', 'image']);
    expect(r.depassement).toBe(12);
    for (const s of r.plan) expect(s.fin).toBeGreaterThan(s.debut);
  });
  it('sans avatar : chaque média joue sa durée, photo 3 s', () => {
    const l = exemple().filter((m) => m.source !== 'avatar');
    const { plan, duree } = planDepuisListe(l);
    expect(plan.map((s) => s.kind)).toEqual(['video', 'video', 'image']);
    expect(duree).toBe(12);
    expect(dureeListe(l)).toBe(12);
  });
  it('avatar pas encore produit : ignoré et compté (l’envoi le produit avant)', () => {
    expect(planDepuisListe(exemple()).ignores).toBe(2);
  });
  it('relecture : le plan écrit au post se relit en liste (photo jamais prise pour un rush)', () => {
    const { plan } = planDepuisListe(exemple(AVATAR, 20));
    const relus = rushSegmentsDepuisMetadata(JSON.parse(JSON.stringify(plan)))!;
    expect(relus.map((s) => s.kind ?? 'video')).toEqual(['avatar', 'video', 'video', 'avatar', 'image']);
    expect(estPlanMontage(relus)).toBe(true);
    const liste = listeDepuisSegments(relus)!;
    expect(liste.map((m) => m.source)).toEqual(['avatar', 'rush', 'stock-video', 'avatar', 'stock-photo']);
    expect(liste[0].duree).toBe(20);
    expect(rushsDeListe(liste).map((r) => r.url)).toEqual([RUSH, STOCK_V]);
    // Un plan de vidéos seules n'est pas une liste multi-sources.
    expect(listeDepuisSegments(relus.filter((s) => !s.kind))).toBeNull();
  });
});

describe('jumeau : UNE génération, prix inchangé', () => {
  it('la vidéo produite va dans CHAQUE créneau « Mon avatar »', () => {
    const l = poserVideoAvatar(exemple(), AVATAR, 18, 3);
    expect(l.filter((m) => m.source === 'avatar').map((m) => [m.url, m.duree, m.meta?.avatarVersion])).toEqual([[AVATAR, 18, 3], [AVATAR, 18, 3]]);
    expect(avatarAProduire(l)).toBe(false);
  });
  it('envoi : un seul appel au moteur du jumeau, le coût total inchangé', () => {
    const src = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    const envoi = src.slice(src.indexOf('const runRenderInterne = async'), src.indexOf('const reset = () => {'));
    expect(envoi.match(/genererEtAttendreVideoJumeau\(/g)).toHaveLength(1);
    expect(envoi).toMatch(/batchCost\(cost, total\) \+ \(jumeauMode === 'avatar' \? coutJumeau : 0\)/);
    // La pose dans la liste ne produit RIEN : elle sonde la durée et remplit les créneaux.
    const pose = src.slice(src.indexOf('const poserJumeauDansListe = async'), src.indexOf('/** Protection anti-rétention 24 h'));
    expect(pose).toContain('poserVideoAvatar(courante, url, secondes, avatarVersion)');
    expect(pose).not.toMatch(/genererEtAttendreVideoJumeau|\/api\/avatar|fetch\(/);
    // La liste suit le plan déterministe (jamais le smart montage qui réordonne).
    expect(envoi).toContain('const detail = planDeListe(listePlan);');
    expect(envoi).toContain('const res = planRenduDepuis(detail);');
    expect(envoi).toContain("...(duree('video') > 0 && planListe ? { montage: planListe } : {}),");
  });
});

describe('libellés : mots de l’utilisateur seulement', () => {
  const INTERDIT = /pexels|unsplash|heygen|eleven|d-id|stock-|\.mp4|\.jpe?g|\.png|\.webm/i;
  it('chaque source × type', () => {
    const cas: MediaVideo[] = [
      ...exemple(), ...exemple(AVATAR, 12),
      { id: 'm', source: 'mediatheque', type: 'video', url: '/m/IMG_0001.mp4', duree: 8, nom: 'IMG_0001.mp4' },
      { id: 'i', source: 'mediatheque', type: 'image', url: '/m/ia-1.png', duree: 3, meta: { ia: true } },
    ];
    for (const m of cas) expect(libelleMedia(m)).not.toMatch(INTERDIT);
    expect(libelleMedia(cas[2])).toBe('Vidéo suggérée · 0:05');
    expect(libelleMedia(cas[1])).toBe('Rush personnel · 0:04');
    expect(libelleMedia(cas[4])).toBe('Photo suggérée · 0:03');
    expect(libelleMedia(cas[0])).toBe('Mon avatar · produit à l’envoi');
    expect(libelleSource(cas.at(-1)!)).toBe('Généré avec l’IA');
    expect(libelleMedia(cas.at(-2)!)).toBe('Ma médiathèque · 0:08');
  });
});

// ── Composant ────────────────────────────────────────────────────────────
function props(sur: Partial<MediasSequenceVideoProps> = {}): MediasSequenceVideoProps {
  return {
    medias: exemple(),
    etatAvatar: 'absent',
    onApercu: vi.fn(), onDeplacer: vi.fn(), onRemplacer: vi.fn(), onSupprimer: vi.fn(), onRecadrer: vi.fn(),
    onAjouterMonRush: vi.fn(), onAjouterAvatar: vi.fn(), onAjouterSuggere: vi.fn(), onAjouterMediatheque: vi.fn(),
    ...sur,
    plan: sur.plan ?? planDetaille(sur.medias ?? exemple(), { dureeParole: 20, source: 'estimee' }),
  };
}

describe('MediasSequenceVideo', () => {
  it('cartes visuelles : libellés utilisateur, nom de fichier en infobulle seulement', () => {
    const { container } = render(<MediasSequenceVideo {...props()} />);
    const items = container.querySelectorAll('[data-media-item]');
    expect(Array.from(items).map((e) => e.getAttribute('data-media-item'))).toEqual(['avatar', 'rush', 'stock-video', 'avatar', 'stock-photo']);
    expect(container.textContent).not.toMatch(/pexels|stock-|\.mp4|\.jpe?g/i);
    const libelles = container.querySelectorAll('[data-media-libelle]');
    // Média suggéré : aucun nom de fournisseur, même au survol.
    expect(libelles[2].getAttribute('title')).toBeNull();
    expect(container.querySelectorAll('[data-vignette="video"]').length).toBe(2);
    expect(container.querySelectorAll('[data-vignette="image"]').length).toBe(1);
  });
  it('gestes : aperçu, déplacer, remplacer, recadrer (pas l’avatar), supprimer', () => {
    const p = props();
    const { getByLabelText } = render(<MediasSequenceVideo {...p} />);
    fireEvent.click(getByLabelText('Aperçu du média 2'));
    expect(p.onApercu).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    fireEvent.click(getByLabelText('Descendre le média 2'));
    expect(p.onDeplacer).toHaveBeenCalledWith(1, 1);
    expect((getByLabelText('Monter le média 1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByLabelText('Remplacer le média 5'));
    expect(p.onRemplacer).toHaveBeenCalledWith(4);
    expect((getByLabelText('Recadrer le média 1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByLabelText('Recadrer le média 5'));
    expect(p.onRecadrer).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    fireEvent.click(getByLabelText('Supprimer le média 4'));
    expect(p.onSupprimer).toHaveBeenCalledWith(3);
  });
  it('« Mon avatar » désactivé tant que l’avatar n’est pas prêt, avec « Configurer mon avatar »', async () => {
    const p = props({ medias: [], onOuvrirMenu: vi.fn() });
    const { container, rerender } = render(<MediasSequenceVideo {...p} />);
    await act(async () => { fireEvent.click(container.querySelector('[data-medias-ajouter]')!); });
    expect(p.onOuvrirMenu).toHaveBeenCalled();
    const btn = container.querySelector('[data-ajouter-avatar]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.querySelector('a[href="/dashboard/avatar"]')?.textContent).toBe('Configurer mon avatar');
    rerender(<MediasSequenceVideo {...p} etatAvatar="pret" />);
    const pret = container.querySelector('[data-ajouter-avatar]') as HTMLButtonElement;
    expect(pret.disabled).toBe(false);
    fireEvent.click(pret);
    expect(p.onAjouterAvatar).toHaveBeenCalled();
    expect(container.querySelector('[data-medias-menu]')).toBeNull();
  });
  it('menu « Ajouter » : Mon rush, Média suggéré, Ma médiathèque', () => {
    const p = props({ medias: [] });
    const { container, getByText } = render(<MediasSequenceVideo {...p} />);
    fireEvent.click(container.querySelector('[data-medias-ajouter]')!);
    fireEvent.click(getByText('Mon rush'));
    fireEvent.click(container.querySelector('[data-medias-ajouter]')!);
    fireEvent.click(container.querySelector('[data-ouvrir-stock="rush"]')!);
    fireEvent.click(container.querySelector('[data-medias-ajouter]')!);
    fireEvent.click(getByText('Ma médiathèque'));
    expect(p.onAjouterMonRush).toHaveBeenCalledTimes(1);
    expect(p.onAjouterSuggere).toHaveBeenCalledTimes(1);
    expect(p.onAjouterMediatheque).toHaveBeenCalledTimes(1);
  });
});

// ── Compositeur ──────────────────────────────────────────────────────────
describe('compositeur — fonctions pures', () => {
  it('Ken Burns combiné au recadrage : zoom avant de 1 à ZOOM_KEN_BURNS', () => {
    expect(recadrageImageKenBurns(null, 'zoomIn', 0)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(recadrageImageKenBurns(null, 'zoomIn', 1).scale).toBeCloseTo(ZOOM_KEN_BURNS, 4);
    const r = recadrageImageKenBurns({ scale: 1.5, offsetX: 0.1, offsetY: -0.2 }, 'panD', 1);
    expect(r.scale).toBeCloseTo(1.5 * ZOOM_KEN_BURNS, 4);
    expect(r.offsetX).toBeGreaterThan(0.1);
    expect(r.offsetY).toBe(-0.2);
  });
  it('drawVideoSeq peint la PHOTO, agrandie au fil du plan (canvas simulé)', () => {
    const tailles: number[] = [];
    const ctx = new Proxy({
      drawImage: (_s: unknown, _x: number, _y: number, w: number) => { tailles.push(w); },
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    } as Record<string, unknown>, { get: (t, p) => (p in t ? t[p as string] : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    const img = { naturalWidth: 1000, naturalHeight: 1000, width: 1000, height: 1000 } as HTMLImageElement;
    for (const p of [0, 0.5, 1]) drawVideoSeq(ctx, 1080, 1920, null, null, 0, undefined, recadrageImageKenBurns(null, 'zoomIn', p), img, 1);
    expect(tailles).toHaveLength(3);
    expect(tailles[0]).toBeCloseTo(1920, 0); // « cover »
    expect(tailles[2] / tailles[0]).toBeCloseTo(ZOOM_KEN_BURNS, 3);
    expect(tailles[1]).toBeGreaterThan(tailles[0]);
  });
  it('plan mixte : reconnu, médias manquants listés, avatar recalé sur `depuis === debut`', () => {
    const { plan } = planDepuisListe(exemple(AVATAR, 20));
    expect(estMontageMixte(AVATAR, plan)).toHaveLength(5);
    expect(estMontageMixte(AVATAR, plan.filter((s) => s.kind === 'video'))).toBeNull();
    expect(estMontageMixte(null, plan)).toBeNull();
    expect(mediasMixtesManquants(plan, new Set([AVATAR, RUSH, STOCK_V]), new Set())).toEqual([PHOTO]);
    const ajuste = ajusterPlanMixte(plan, 10);
    expect(ajuste.at(-1)!.fin).toBe(10);
    expect(avatarSynchronise(ajuste)).toBe(true);
  });
});

// ── Bout en bout : le VRAI composeVideo sur un faux navigateur ────────────
interface Peint { source: unknown }
const NOUVELLE_IMAGE = Symbol('nouvelle image');
const peints: Peint[] = [];
let sourcesAudio: unknown[] = [];
let enregistreurs = 0;
let fauxVideos: FauxVideo[] = [];
class FauxMediaStream {
  private pistes: unknown[] = [];
  addTrack(t: unknown) { this.pistes.push(t); }
  getTracks() { return this.pistes; }
  getVideoTracks() { return []; }
  getAudioTracks() { return []; }
}
class FauxMediaRecorder {
  static isTypeSupported(t: string) { return t === 'video/webm'; }
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() { enregistreurs++; }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: 'video/webm' }) }); this.onstop?.(); }, 0);
  }
}
class FauxImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  naturalWidth = 64; naturalHeight = 64; width = 64; height = 64;
  srcDemande = '';
  set src(v: string) { this.srcDemande = v; setTimeout(() => (v.includes('manquante') ? this.onerror?.() : this.onload?.()), 0); }
  get src() { return this.srcDemande; }
}
class FauxAudioContext {
  state = 'running'; currentTime = 0; sampleRate = 48000;
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamDestination() { return { stream: new FauxMediaStream() }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { getFloatTimeDomainData(b: Float32Array) { b.fill(0.2); }, connect() {} }; }
  createMediaElementSource(el: unknown) { sourcesAudio.push(el); return { connect() {} }; }
}
class FauxVideo {
  crossOrigin: string | null = null;
  muted = false; playsInline = false; preload = ''; paused = true; currentTime = 0;
  duration = 30; readyState = 0; seeking = false; currentSrc = '';
  videoWidth = 0; videoHeight = 0; playbackRate = 1;
  oncanplaythrough: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  srcDemande = '';
  set src(v: string) { this.srcDemande = v; this.currentSrc = v; }
  get src() { return this.srcDemande; }
  load() {
    setTimeout(() => {
      if (this.srcDemande.includes('manquante')) { this.onerror?.(); return; }
      this.readyState = 4; this.videoWidth = 720; this.videoHeight = 1280;
      this.oncanplaythrough?.();
    }, 0);
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
}
const originaux: Record<string, unknown> = {};
function contexte() {
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    drawImage: (source: unknown) => { peints.push({ source }); },
    // Début d'une image du montage (`drawFrame` vide la toile) : sert à
    // découper `peints` image par image.
    clearRect: (_x: number, _y: number, w: number, h: number) => { if (w === 64 && h === 64) peints.push({ source: NOUVELLE_IMAGE }); },
    measureText: (t: string) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => null,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  const divers: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p as string] : p in divers ? divers[p as string] : () => {}),
    set: (_t, p, v) => { divers[p as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
function installer() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) originaux[k] = g[k];
  g.MediaRecorder = FauxMediaRecorder; g.MediaStream = FauxMediaStream; g.Image = FauxImage; g.AudioContext = FauxAudioContext;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) originaux[k] = proto[k];
  proto.getContext = () => contexte();
  proto.captureStream = () => new FauxMediaStream();
  proto.toBlob = (cb: (b: Blob | null) => void) => cb(new Blob(['j'], { type: 'image/jpeg' }));
  proto.toDataURL = () => 'data:image/png;base64,AAAA';
  const creer = document.createElement.bind(document);
  originaux.createElement = document.createElement;
  document.createElement = ((tag: string, opts?: ElementCreationOptions) => {
    if (tag === 'video') { const v = new FauxVideo(); fauxVideos.push(v); return v as unknown as HTMLElement; }
    return creer(tag, opts);
  }) as typeof document.createElement;
}
function retirer() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) g[k] = originaux[k];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) proto[k] = originaux[k];
  document.createElement = originaux.createElement as typeof document.createElement;
}

const A = '/media/avatar/gen-1.mp4';
const R = '/media/rush.mp4';
const P = '/media/photo.jpg';
function optionsMixtes(photo = P): ComposerOptions {
  const liste: MediaVideo[] = [
    { id: 'a1', source: 'avatar', type: 'video', url: A, duree: 1.6 },
    { id: 'r', source: 'rush', type: 'video', url: R, duree: 0.5 },
    { id: 'a2', source: 'avatar', type: 'video', url: A, duree: 1.6 },
    { id: 'p', source: 'stock-photo', type: 'image', url: photo, duree: 0.5 },
  ];
  const { plan, duree } = planDepuisListe(liste);
  return {
    width: 64, height: 64, fps: 30, title: 'T', cards: [],
    videoUrl: plan[0].url, montage: plan,
    introDuration: 0, cardsDuration: 0, videoDuration: duree, ctaDuration: 0.2,
    accentColor: '#7C3AED',
  } as ComposerOptions;
}

describe('composeVideo — plan multi-sources sur un faux navigateur', () => {
  beforeEach(() => {
    peints.length = 0; sourcesAudio = []; enregistreurs = 0; fauxVideos = [];
    installer();
    vi.spyOn(console, 'log').mockImplementation((...a) => { if (process.env.DBG) process.stdout.write(a.map(String).join(' ').slice(0, 200) + '\n'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((...a) => { if (process.env.DBG) process.stdout.write('ERR ' + a.map(String).join(' ').slice(0, 300) + '\n'); });
  });
  afterEach(() => { retirer(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('photo ET vidéos peintes (jamais de plan noir) ; seul l’avatar entre dans le mix', async () => {
    const r = await composeVideo(optionsMixtes());
    expect(r.video.size).toBeGreaterThan(0);
    const avatar = fauxVideos.find((v) => v.srcDemande === A)!;
    const rush = fauxVideos.find((v) => v.srcDemande === R)!;
    expect(avatar && rush).toBeTruthy();
    expect(peints.some((p) => (p.source as FauxImage)?.srcDemande === P)).toBe(true);
    expect(peints.some((p) => p.source === avatar)).toBe(true);
    expect(peints.some((p) => p.source === rush)).toBe(true);
    // Avatar : voix continue routée ; plan de coupe : muet, jamais routé.
    expect(sourcesAudio).toContain(avatar);
    expect(sourcesAudio).not.toContain(rush);
    expect(rush.muted).toBe(true);
  }, 20000);

  it('#518 : une photo manquante arrête le rendu AVANT tout enregistrement', async () => {
    const p = composeVideo(optionsMixtes('/media/manquante.jpg'));
    await expect(p).rejects.toBeInstanceOf(MediaIndisponibleError);
    await p.catch((e) => expect(e.message).toBe(MESSAGE_PHOTO_INDISPONIBLE));
    expect(enregistreurs).toBe(0);
    expect(document.body.querySelectorAll('canvas').length).toBe(0);
  });
  it('fondu ENTRANT vers un plan mixte : seule sa PREMIÈRE image paraît, jamais un média suivant', async () => {
    // Titre (affiche F) → Vidéo [photo 1 s → rush 4 s] → CTA, fondu par
    // défaut de 0,8 s. L'ancienne progression `t * 0,3` atteignait 1,5 s du
    // plan à la fin du fondu : le RUSH apparaissait sous le titre, avant son tour.
    const F = '/media/affiche.jpg';
    const { plan, duree } = planDepuisListe([
      { id: 'p', source: 'stock-photo', type: 'image', url: P, duree: 0.5 },
      { id: 'r', source: 'rush', type: 'video', url: R, duree: 4 },
    ]);
    // Photo : 1 s minimum → plan de 5 s ; 30 % de 5 s = 1,5 s, déjà dans le rush.
    expect(plan.map((s) => [s.url, s.debut, s.fin])).toEqual([[P, 0, 1], [R, 1, 5]]);
    await composeVideo({
      width: 64, height: 64, fps: 30, title: 'T', cards: [],
      posterUrl: F, design: { posterOnAllSequences: false },
      videoUrl: plan[0].url, montage: plan,
      introDuration: 1.2, cardsDuration: 0, videoDuration: duree, ctaDuration: 0.2,
      accentColor: '#7C3AED',
    } as ComposerOptions);
    const rush = fauxVideos.find((v) => v.srcDemande === R)!;
    expect(rush).toBeTruthy();
    // Découpe image par image ; une image de FONDU peint le titre ET la vidéo.
    const images: unknown[][] = [];
    for (const p of peints) {
      if (p.source === NOUVELLE_IMAGE) images.push([]);
      else images.at(-1)?.push(p.source);
    }
    const estAffiche = (s: unknown) => (s as FauxImage)?.srcDemande === F;
    const estPhoto = (s: unknown) => (s as FauxImage)?.srcDemande === P;
    const fondu = images.filter((im) => im.some(estAffiche) && im.some((s) => estPhoto(s) || s === rush));
    expect(fondu.length).toBeGreaterThan(3);
    for (const im of fondu) {
      expect(im.some(estPhoto)).toBe(true);
      expect(im.includes(rush)).toBe(false);
    }
    // Le rush paraît bien ensuite, à son tour (aucun plan perdu).
    expect(images.some((im) => !im.some(estAffiche) && im.includes(rush))).toBe(true);
  }, 20000);
});
