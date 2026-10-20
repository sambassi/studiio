/**
 * AUTOPILOTE — alternance avatar / plans de coupe, pertinence du stock,
 * compteur de la banque, budget du script de l'avatar.
 *
 *  1. Un plan ENREGISTRÉ court (1 créneau stock) avec avatar ne laisse plus
 *     tout le reliquat à l'avatar : avatar et plans de coupe alternent.
 *  2. Les médias stock retenus portent leur sujet : un autre sujet n'est
 *     jamais pioché, un sujet inconnu passe en dernier.
 *  3. L'en-tête de la banque distingue rushes personnels et vidéos suggérées.
 *  4. Le script de l'avatar est dimensionné au débit RÉEL de sa voix clonée.
 */
import { describe, it, expect } from 'vitest';
import { planMultiSources, avatarSynchronise } from '@/lib/autopilot/plan-multi-sources';
import {
  mediasDesSources, normaliserConfigSources, libelleBanqueRushes, sujetsCourants,
  type ConfigSources, type ConfigPourSources, type MediaStockRetenu,
} from '@/lib/autopilot/sources';
import { scriptPourDuree, debitParoleAvatar } from '@/lib/autopilot/duree-cible';
import { estimerParoleJumeau } from '@/lib/autopilot/durees-sequences';
import { sourcesPertinentes, avatarAvecAutresSources } from '@/lib/autopilot/sources';
import { planCompletAutopilote, segmentsDuPlan, entreeDepuisResume } from '@/lib/autopilot/plan-complet';
import { scriptJumeauMontage } from '@/lib/autopilot/script-jumeau';
import type { RushSegment } from '@/lib/creer/multi-rush';

const AV = 'https://minio.test/videos/u1/avatar/gen-1.mp4';
const R1 = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-a.mp4';
const SV1 = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-111.mp4';
const SV2 = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-222.mp4';
const SV3 = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-333.mp4';
const SV4 = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-444.mp4';
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const P2 = 'https://images.unsplash.com/photo-2?w=1080';

const blocsAvatar = (plan: RushSegment[]) => plan.filter((s) => s.kind === 'avatar').map((s) => s.fin - s.debut);
const genres = (plan: RushSegment[]) => plan.filter((s) => s.kind !== 'avatar').map((s) => s.kind);

describe('alternance avatar ↔ plans de coupe avec un plan enregistré', () => {
  // Vidéos stock non sondées (durée inconnue : 3 s supposées), deux photos.
  const sources = {
    avatar: { url: AV, secondes: 39.5 },
    stockVideos: [{ url: SV1, secondes: null }, { url: SV2, secondes: null }],
    photos: [P1, P2],
    cible: 39.5,
  };

  it('plan enregistré d’UN créneau stock : plusieurs alternances, aucun bloc d’avatar > 8 s', () => {
    const r = planMultiSources({ ...sources, gabarit: [{ id: 's1', type: 'stock' }] });
    expect(r.duree).toBe(39.5);
    expect(r.plan.at(-1)!.kind).toBe('avatar');
    const coupes = r.plan.filter((s) => s.kind !== 'avatar');
    expect(coupes.length).toBeGreaterThanOrEqual(5);
    blocsAvatar(r.plan).forEach((d) => expect(d).toBeLessThanOrEqual(8 + 1e-6));
    expect(avatarSynchronise(r.plan)).toBe(true);
    // Jamais deux fois de suite le même plan de coupe.
    for (let i = 1; i < coupes.length; i++) expect(coupes[i].url).not.toBe(coupes[i - 1].url);
    // Plans de coupe de 2 à 4 s.
    coupes.forEach((s) => { expect(s.fin - s.debut).toBeGreaterThanOrEqual(2 - 1e-6); expect(s.fin - s.debut).toBeLessThanOrEqual(4 + 1e-6); });
  });

  it('plan enregistré avatar → stock → avatar : accroche, alternance, CTA (plus de bloc de 13 s)', () => {
    const r = planMultiSources({ ...sources, gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'stock' }, { id: 'c', type: 'avatar' }] });
    expect(r.plan[0].kind).toBe('avatar');
    expect(r.plan[0].fin).toBeLessThanOrEqual(4 + 1e-6);
    expect(r.plan.at(-1)!.kind).toBe('avatar');
    blocsAvatar(r.plan).forEach((d) => expect(d).toBeLessThanOrEqual(8 + 1e-6));
    expect(r.plan.filter((s) => s.kind !== 'avatar').length).toBeGreaterThanOrEqual(5);
    expect(avatarSynchronise(r.plan)).toBe(true);
    expect(r.plan.at(-1)!.fin).toBe(39.5);
  });

  it('les rushes personnels passent AVANT le stock dans l’alternance', () => {
    const r = planMultiSources({ ...sources, rushes: [{ url: R1, secondes: 20 }], gabarit: [{ id: 's1', type: 'stock' }] });
    const coupes = r.plan.filter((s) => s.kind !== 'avatar');
    // Créneau 1 = le stock imposé ; ensuite les rushes d'abord.
    expect(coupes[0].source).toBe('stock');
    expect(coupes[1].source).toBe('rush');
  });

  it('gabarit « avatar seul » explicite : l’avatar tient toute la parole, comme avant', () => {
    const r = planMultiSources({ ...sources, gabarit: [{ id: 'a', type: 'avatar' }] });
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0]).toMatchObject({ kind: 'avatar', debut: 0, fin: 39.5 });
  });

  it('sans avatar, le gabarit garde ses durées égales (comportement d’avant)', () => {
    const r = planMultiSources({ stockVideos: [{ url: SV1, secondes: 10 }, { url: SV2, secondes: 10 }], cible: 10, gabarit: [{ id: 'a', type: 'stock' }, { id: 'b', type: 'stock' }] });
    expect(r.plan.map((s) => s.fin)).toEqual([5, 10]);
  });
});

describe('photos et vidéos stock alternent', () => {
  it('avec avatar, sans gabarit : vidéo, photo, vidéo, photo', () => {
    const r = planMultiSources({ avatar: { url: AV, secondes: 30 }, stockVideos: [{ url: SV1, secondes: 10 }, { url: SV2, secondes: 10 }], photos: [P1, P2], cible: 30 });
    expect(genres(r.plan).slice(0, 4)).toEqual(['video', 'image', 'video', 'image']);
  });

  it('sans avatar : vidéo, photo, vidéo, photo (plus « toutes les vidéos puis les photos »)', () => {
    const r = planMultiSources({ stockVideos: [{ url: SV1, secondes: 10 }, { url: SV2, secondes: 10 }], photos: [P1, P2], cible: 12 });
    expect(genres(r.plan)).toEqual(['video', 'image', 'video', 'image']);
  });

  it('créneaux « stock » d’un gabarit : genres alternés', () => {
    const r = planMultiSources({
      stockVideos: [{ url: SV1, secondes: 10 }, { url: SV2, secondes: 10 }], photos: [P1, P2], cible: 12,
      gabarit: [{ id: 'a', type: 'stock' }, { id: 'b', type: 'stock' }, { id: 'c', type: 'stock' }],
    });
    expect(genres(r.plan)).toEqual(['video', 'image', 'video']);
  });
});

describe('pertinence : le sujet des médias stock retenus', () => {
  const m = (url: string, type: 'video' | 'photo', sujet?: string): MediaStockRetenu => ({
    url, type, provider: 'pexels', providerAssetId: url.slice(-6), auteur: 'A', sourceUrl: '', licence: 'Pexels License', vignetteUrl: '',
    ...(sujet ? { sujet } : {}),
  });
  const cfg = (stock: MediaStockRetenu[], extra: Partial<ConfigSources> = {}, rushUrls: string[] = []) => ({
    rushUrls, jumeauAvatar: false, topics: ['nutrition'], brief: {},
    designStyle: { sources: { actives: { rushes: true, avatar: false, stock: true }, stock, gabarit: [], ...extra } },
  });

  it('le sujet courant = les libellés des thèmes, sinon le brief', () => {
    expect(sujetsCourants({ topics: ['nutrition'] })).toEqual(['Nutrition']);
    expect(sujetsCourants({ topics: [], brief: { objectif: 'Courir plus vite' } })).toEqual(['Courir plus vite']);
  });

  it('autre sujet EXCLU ; sujet inconnu écarté dès qu’un média du sujet existe ; rushes perso intacts', () => {
    const c = cfg(
      [m(SV2, 'video', 'Finance'), m(SV3, 'video'), m(SV1, 'video', 'nutrition'), m(P1, 'photo', 'Nutrition'), m(P2, 'photo', 'Danse')],
      {}, [R1, SV4, SV2, SV3, SV1],
    );
    const r = mediasDesSources(c);
    expect(r.videosStock).toEqual([SV1]);
    expect(r.photosStock).toEqual([P1]);
    expect(r.rushesPersonnels).toEqual([R1]);
  });

  it('aucun média du sujet : les inconnus restent, retenus d’abord, anciens imports de la banque en DERNIER', () => {
    const c = cfg([m(SV2, 'video', 'Finance'), m(SV3, 'video')], {}, [SV4, SV2, SV3]);
    expect(mediasDesSources(c).videosStock).toEqual([SV3, SV4]);
  });

  it('un média FORCÉ dans le plan reste disponible, même d’un autre sujet', () => {
    const c = cfg([m(SV1, 'video', 'nutrition'), m(SV2, 'video', 'Finance')], { gabarit: [{ id: 'a', type: 'stock', media: SV2 }] }, [SV1, SV2]);
    expect(mediasDesSources(c).videosStock).toEqual([SV1, SV2]);
  });

  it('anciennes données (aucun sujet nulle part) : rien n’est exclu', () => {
    const c = cfg([m(SV1, 'video'), m(P1, 'photo')], {}, [SV4, SV1]);
    const r = mediasDesSources(c);
    expect(r.videosStock).toEqual([SV1, SV4]);
    expect(r.photosStock).toEqual([P1]);
  });

  it('le sujet survit au nettoyage de la configuration', () => {
    const n = normaliserConfigSources({ actives: { stock: true }, stock: [m(P1, 'photo', 'Nutrition'), m(P2, 'photo')] });
    expect(n!.stock[0].sujet).toBe('Nutrition');
    expect('sujet' in n!.stock[1]).toBe(false);
  });
});

describe('en-tête de la banque : rushes personnels et vidéos suggérées à part', () => {
  it('libellés', () => {
    expect(libelleBanqueRushes(0, 2)).toBe('0 rush personnel · 2 vidéos suggérées');
    expect(libelleBanqueRushes(1, 1)).toBe('1 rush personnel · 1 vidéo suggérée');
    expect(libelleBanqueRushes(3, 0)).toBe('3 rushes personnels');
  });
});

describe('budget du script de l’avatar : débit réel de la voix clonée', () => {
  const cartes = Array.from({ length: 8 }, (_, i) => ({ icon: 'Zap', title: `Idée numéro ${i + 1}`, description: `Une explication concrète et utile pour la vidéo, point ${i + 1}.`, value: '' }));
  it('30 s visées : le script tient en 30 s au débit de l’avatar (≈ 10,6 car./s)', () => {
    expect(debitParoleAvatar('normal')).toBe(10.6);
    const script = scriptPourDuree({ titre: 'Bien manger le matin', cartes, cta: 'Abonne-toi pour la suite', brief: { duree: 30 } })!;
    expect(script.length).toBeLessThanOrEqual(Math.round(30 * 10.6));
    expect(estimerParoleJumeau(script)).toBeLessThanOrEqual(30);
    // L'ancien budget (14 car./s) aurait donné ≈ 40 s de parole réelle.
    expect(script.length).toBeLessThan(30 * 14);
  });
});

describe('écran : les médias hors sujet ne sont ni comptés ni montrés', () => {
  const m = (url: string, type: 'video' | 'photo', sujet?: string): MediaStockRetenu => ({
    url, type, provider: 'pexels', providerAssetId: 'x', auteur: 'A', sourceUrl: '', licence: 'L', vignetteUrl: '', ...(sujet ? { sujet } : {}),
  });
  const cfg = (stock: MediaStockRetenu[], rushUrls: string[], avatar = false): ConfigPourSources => ({
    rushUrls, jumeauAvatar: avatar, topics: ['nutrition'], brief: {},
    designStyle: { sources: { actives: { rushes: true, avatar, stock: true }, stock, gabarit: [] } },
  });

  it('`sourcesPertinentes` : l’ordre et le filtre du moteur, la banque sans vidéo suggérée écartée', () => {
    const r = sourcesPertinentes(cfg([m(SV2, 'video', 'Finance'), m(P1, 'photo', 'Nutrition'), m(SV1, 'video', 'nutrition')], [R1, SV1, SV2, SV4]));
    expect(r.stock.map((x) => x.url)).toEqual([SV1, P1]);
    expect(r.rushUrls).toEqual([R1, SV1]);
  });

  it('tout le stock hors sujet, aucun rush : le script de l’avatar prend le budget « avatar seul »', () => {
    const horsSujet = cfg([m(SV2, 'video', 'Finance'), m(P2, 'photo', 'Danse')], [SV2], true);
    expect(avatarAvecAutresSources(horsSujet)).toBe(false);
    const dansSujet = cfg([m(SV1, 'video', 'Nutrition')], [SV1], true);
    expect(avatarAvecAutresSources(dansSujet)).toBe(true);
    const cartes = Array.from({ length: 6 }, (_, i) => ({ title: `Idée ${i + 1}`, description: `Une explication concrète, point ${i + 1}.` }));
    const post = { title: 'Bien manger le matin', content: { cards: cartes, tagLine: 'Abonne-toi' }, brief: { duree: 30 } };
    // Avatar seul : titre, cartes et CTA plein écran sont réservés — le script est plus court.
    expect(scriptJumeauMontage(post, horsSujet).length).toBeLessThan(scriptJumeauMontage(post, dansSujet).length);
  });
});

describe('plan complet (créneaux + alternance + CTA) = le plan du moteur', () => {
  const resume = {
    gabarit: [{ id: 's1', type: 'stock' as const }],
    actives: { rushes: true, avatar: true, stock: true },
    rushesPerso: [R1],
    stock: [
      { url: SV1, type: 'video' as const, provider: 'pexels' as const, providerAssetId: '1', auteur: '', sourceUrl: '', licence: '', vignetteUrl: '' },
      { url: P1, type: 'photo' as const, provider: 'pexels' as const, providerAssetId: '2', auteur: '', sourceUrl: '', licence: '', vignetteUrl: '' },
    ],
    avatar: { disponible: true, vignette: null },
  };

  it('mêmes entrées → mêmes plans que `planMultiSources`', () => {
    const o = { cible: 30, secondesAvatar: 31.2, durees: { [R1]: 12, [SV1]: 7 } };
    const complet = planCompletAutopilote(resume, o);
    expect(complet.segments).toEqual(segmentsDuPlan(planMultiSources(entreeDepuisResume(resume, o)).plan));
    expect(complet.duree).toBe(31.2);
    expect(complet.segments[0]).toMatchObject({ genre: 'video' });
    expect(complet.segments.at(-1)).toMatchObject({ genre: 'avatar', role: 'cta', fin: 31.2 });
  });

  it('parole estimée depuis le script (`estimerParoleJumeau`) quand elle n’est pas mesurée', () => {
    const script = 'x'.repeat(212);
    expect(planCompletAutopilote(resume, { cible: 30, scriptAvatar: script }).duree).toBe(estimerParoleJumeau(script));
    expect(planCompletAutopilote(resume, { cible: 30 }).duree).toBe(30);
  });
});
