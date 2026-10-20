/**
 * AUTOPILOTE — pertinence, diversité, cadrages, textes hors du visage,
 * aucun chiffre inventé.
 *
 * Cas réel (production 4725f49, sujet « Voyage », 30 s) : une vidéo de
 * cuisine ouvrait le montage et revenait à 23 s ; la carte « -40% vols -40% »
 * répétait sa valeur ; cartes et CTA posés sur la bouche de l'avatar.
 */
import { describe, it, expect } from 'vitest';
import { planMultiSources, avatarSynchronise, REPRISES_MAX_PAR_MEDIA } from '@/lib/autopilot/plan-multi-sources';
import { descriptionMediaStock, pertinenceMedia, pertinencesPourPlan, scenarioPertinence } from '@/lib/autopilot/pertinence-medias';
import { mediasDesSources, type MediaStockRetenu } from '@/lib/autopilot/sources';
import {
  carteSansChiffresInventes, chiffresAutorises, texteSansChiffresInventes, titreSansChiffresInventes, titreSansValeur, valeurSansChiffresInventes,
} from '@/lib/contenu/chiffres-sources';
import { generateSmartContent } from '@/lib/smart-content';
import { appliquerMiseEnPageSurimpression, ZONE_TEXTE_AVATAR_916, hauteurCta } from '@/lib/creer/surimpressions-mise-en-page';
import { FONT_RATIO, TEXT_LAYOUT } from '@/lib/creer/designSpec';
import type { RushSegment } from '@/lib/creer/multi-rush';

const AV = 'https://studiio.pro/storage/v1/object/public/media/u1/jumeau.mp4';
const CUISINE = 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-1001.mp4';
const BATEAU = 'https://images.pexels.com/photos/2001/a.jpeg';
const PONTON = 'https://images.pexels.com/photos/2002/b.jpeg';
const VALISE = 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-1003.mp4';
const PLAT = 'https://images.pexels.com/photos/2004/d.jpeg';

const fiche = (url: string, type: 'video' | 'photo', page: string, sujet = 'Voyage'): MediaStockRetenu => ({
  url, type, provider: 'pexels', providerAssetId: url.slice(-6), auteur: 'x', sourceUrl: page, licence: 'Pexels', vignetteUrl: '', sujet,
});
const STOCK = [
  fiche(CUISINE, 'video', 'https://www.pexels.com/video/a-chef-cooking-seafood-on-the-beach-1001/'),
  fiche(BATEAU, 'photo', 'https://www.pexels.com/photo/boat-near-a-tropical-island-2001/'),
  fiche(PONTON, 'photo', 'https://www.pexels.com/photo/wooden-pier-with-palm-trees-2002/'),
  fiche(VALISE, 'video', 'https://www.pexels.com/video/woman-packing-a-suitcase-for-travel-1003/'),
  fiche(PLAT, 'photo', 'https://www.pexels.com/photo/gougeres-on-a-plate-2004/'),
];
const VOYAGE = scenarioPertinence({ sujets: ['Voyage'], textes: ['TRAVEL', 'Voyager change ta vie. Voici comment le faire malin.', 'BAGAGE CABINE', 'LUMIÈRE DORÉE'] });

describe('pertinence de CONTENU des médias stock', () => {
  it('lit la description dans la page Pexels / Unsplash', () => {
    expect(descriptionMediaStock(STOCK[0])).toBe('a chef cooking seafood on the beach');
    expect(descriptionMediaStock({ sourceUrl: 'https://unsplash.com/photos/a-boat-on-a-lake-AbC1dEf?utm_source=studiio' })).toBe('a boat on a lake');
    expect(descriptionMediaStock({ sourceUrl: 'https://www.pexels.com/video/1234567/' })).toBe('');
  });

  it('voyage : la cuisine est HORS sujet, le bateau et le ponton sont des décors, la valise est pertinente', () => {
    const p = pertinencesPourPlan(STOCK, VOYAGE);
    expect(p[CUISINE].niveau).toBe('hors');
    expect(p[PLAT].niveau).toBe('hors');
    expect(p[BATEAU].niveau).toBe('decor');
    expect(p[PONTON].niveau).toBe('decor');
    expect(p[VALISE].niveau).toBe('pertinent');
    expect(p[VALISE].score).toBeGreaterThan(p[BATEAU].score);
  });

  it('voyage GASTRONOMIQUE : le plat devient « limite » (le script en parle)', () => {
    const gastro = scenarioPertinence({ sujets: ['Voyage'], textes: ['Voyage gastronomique : goûte la cuisine locale'] });
    expect(pertinenceMedia('gougeres on a plate', gastro).niveau).toBe('limite');
  });

  it('sujet hors taxonomie ou média sans description : inconnu (aucun filtrage)', () => {
    const inconnu = scenarioPertinence({ sujets: ['Astrologie'] });
    expect(pertinenceMedia('a chef cooking', inconnu).niveau).toBe('inconnu');
    expect(pertinenceMedia('', VOYAGE).niveau).toBe('inconnu');
  });

  it('cause racine : un plat retenu PENDANT une recherche « voyage » (sujet noté « Voyage ») n’est plus pioché', () => {
    const m = mediasDesSources({
      rushUrls: [CUISINE, VALISE], jumeauAvatar: true, topics: ['Voyage'], brief: { objectif: 'Voyage', message: null },
      designStyle: { sources: { actives: { rushes: true, avatar: true, stock: true }, stock: STOCK, gabarit: [] } },
    });
    expect(m.videosStock).toEqual([VALISE]);
    expect(m.photosStock).not.toContain(PLAT);
    expect(m.photosStock).toEqual(expect.arrayContaining([BATEAU, PONTON]));
  });

  it('un média FORCÉ dans le plan reste disponible, même hors sujet', () => {
    const m = mediasDesSources({
      rushUrls: [CUISINE], jumeauAvatar: true, topics: ['Voyage'],
      designStyle: { sources: { actives: { rushes: true, avatar: true, stock: true }, stock: STOCK, gabarit: [{ id: 's1', type: 'stock', media: CUISINE }] } },
    });
    expect(m.videosStock).toContain(CUISINE);
  });
});

describe('plan : ouverture pertinente, diversité, reprises bornées', () => {
  const T = 30.4;
  const entree = (extra: Partial<Parameters<typeof planMultiSources>[0]> = {}) => ({
    avatar: { url: AV, secondes: T },
    stockVideos: [{ url: CUISINE, secondes: 12 }, { url: VALISE, secondes: 9 }],
    photos: [BATEAU, PONTON, PLAT],
    cible: T,
    pertinences: pertinencesPourPlan(STOCK, VOYAGE),
    ...extra,
  });
  const coupes = (plan: RushSegment[]) => plan.filter((s) => s.kind !== 'avatar');

  it('créneau stock en OUVERTURE : le média le plus pertinent, jamais la cuisine', () => {
    const r = planMultiSources(entree({ gabarit: [{ id: 's1', type: 'stock' }] }));
    expect(r.plan[0].url).toBe(VALISE);
    expect(r.plan.map((s) => s.url)).not.toContain(CUISINE);
    expect(r.plan.map((s) => s.url)).not.toContain(PLAT);
    expect(avatarSynchronise(r.plan)).toBe(true);
  });

  it('aucune reprise tant qu’un média pertinent reste inutilisé ; au plus une reprise par média ; autre passage', () => {
    const r = planMultiSources(entree({ gabarit: [{ id: 's1', type: 'stock' }] }));
    const c = coupes(r.plan);
    const premiers = new Set<string>();
    let repriseVue = false;
    for (const s of c) {
      if (premiers.has(s.url)) repriseVue = true;
      else expect(repriseVue).toBe(false);
      premiers.add(s.url);
    }
    const n = new Map<string, number>();
    c.forEach((s) => n.set(s.url, (n.get(s.url) ?? 0) + 1));
    n.forEach((k) => expect(k).toBeLessThanOrEqual(1 + REPRISES_MAX_PAR_MEDIA));
    // Une vidéo reprise joue un AUTRE passage.
    const valises = c.filter((s) => s.url === VALISE);
    if (valises.length > 1) expect(valises[1].depuis ?? 0).toBeGreaterThanOrEqual(valises[0].jusqua ?? 0);
    for (let i = 1; i < c.length; i++) expect(c[i].url).not.toBe(c[i - 1].url);
  });

  it('un média « limite » passe au plus une fois et jamais en ouverture', () => {
    const gastro = scenarioPertinence({ sujets: ['Voyage'], textes: ['cuisine locale'] });
    const r = planMultiSources(entree({ gabarit: [{ id: 's1', type: 'stock' }], pertinences: pertinencesPourPlan(STOCK, gastro) }));
    expect(r.plan[0].url).not.toBe(CUISINE);
    expect(r.plan[0].url).not.toBe(PLAT);
    expect(coupes(r.plan).filter((s) => s.url === PLAT).length).toBeLessThanOrEqual(1);
    expect(coupes(r.plan).filter((s) => s.url === CUISINE).length).toBeLessThanOrEqual(1);
  });

  it('narration : pendant « bagage cabine », la valise est préférée', () => {
    const r = planMultiSources(entree({ narration: [{ debut: 4, fin: 9, texte: 'BAGAGE CABINE Une valise bien organisée' }] }));
    const pendant = coupes(r.plan).find((s) => s.debut >= 4 - 1e-6 && s.debut < 9);
    expect(pendant?.url).toBe(VALISE);
  });

  it('cadrages de l’avatar alternés (1 / 1,15 / 1,3), accroche et CTA au cadre d’origine, lip-sync intact', () => {
    const r = planMultiSources(entree());
    const av = r.plan.filter((s) => s.kind === 'avatar');
    expect(av[0].cadrage).toBeUndefined();
    expect(av.at(-1)!.cadrage).toBeUndefined();
    expect(new Set(av.map((s) => s.cadrage ?? 1)).size).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < r.plan.length; i++) {
      const a = r.plan[i - 1]; const b = r.plan[i];
      if (a.kind === 'avatar' && b.kind === 'avatar') expect(a.cadrage ?? 1).not.toBe(b.cadrage ?? 1);
    }
    expect(avatarSynchronise(r.plan)).toBe(true);
    expect(r.duree).toBe(T);
  });

  it('sans pertinence ni narration : le plan d’avant (vidéo d’abord, ordre reçu)', () => {
    const r = planMultiSources({ avatar: { url: AV, secondes: 20 }, stockVideos: [{ url: CUISINE, secondes: 3 }], photos: [BATEAU], cible: 20 });
    expect(coupes(r.plan)[0].url).toBe(CUISINE);
  });
});

describe('textes posés sur l’avatar : jamais sur la bouche', () => {
  const design = { title: 'TRAVEL', subtitle: 'Voyager change ta vie.', ctaText: 'VOYAGE & DÉCOUVERTE', ctaSubText: 'ENREGISTRE CETTE DESTINATION', gradientEnd: '#EC4899' };
  const carteImage = (b: { y: number; h: number }) => [30 + (b.y / 100) * 48, 30 + ((b.y + b.h) / 100) * 48];

  it.each(['STANDARD', 'LIFESTYLE_BRAND', 'TUTORIAL_EDUCATION', 'CARDIO_DANCE'])('profil %s : carte et CTA dans la bande sous le menton', (profil) => {
    const d = appliquerMiseEnPageSurimpression({ ...design }, profil, { ctaBande: 'haut', avatar: true }) as Record<string, any>;
    const [haut, bas] = carteImage(d.cardBoxes.c0);
    expect(haut).toBeGreaterThanOrEqual(ZONE_TEXTE_AVATAR_916.haut - 0.1);
    expect(bas).toBeLessThanOrEqual(78);
    // CTA ancré en bas, jamais remonté sur le visage (bande « haut » ignorée).
    expect(d.ctaPos.y).toBe(ZONE_TEXTE_AVATAR_916.bas);
    const R = FONT_RATIO['9:16'];
    const h = hauteurCta({ texte: design.ctaText, sousTexte: design.ctaSubText, echelle: d.ctaScale, largeur: 1080, partLargeur: TEXT_LAYOUT.ctaWidth / 100, ratioTexte: R.cta, ratioSousTexte: R.ctaSub });
    expect(ZONE_TEXTE_AVATAR_916.bas - (h / 1920) * 100).toBeGreaterThanOrEqual(ZONE_TEXTE_AVATAR_916.haut - 0.5);
  });

  it('sans avatar : la mise en page d’avant, inchangée', () => {
    const a = appliquerMiseEnPageSurimpression({ ...design }, 'STANDARD', { ctaBande: 'bas' });
    const b = appliquerMiseEnPageSurimpression({ ...design }, 'STANDARD', { ctaBande: 'bas', avatar: false });
    expect(b).toEqual(a);
  });
});

describe('aucun chiffre inventé (Créer + Autopilote)', () => {
  const rien = chiffresAutorises('Voyage');

  it('la carte « VOLS -40% » ne répète plus sa valeur ; une phrase chiffrée est retirée entière, jamais réparée', () => {
    const c = carteSansChiffresInventes({ title: 'VOLS -40%', description: "Réserver mardi matin entre 6h et 8h : prix jusqu'à 40% moins chers", value: '-40%' }, rien);
    expect(c.title).toBe('VOLS');
    expect(c.value).toBe('');
    // Plus aucune phrase lisible : repli qualitatif tiré du titre.
    expect(c.description).toBe('Un point clé à garder en tête : vols.');
    expect(carteSansChiffresInventes({ title: 'BAGAGE CABINE', description: '7 kg bien organisés = 10 jours de voyage. La technique du rolling', value: '7 kg' }, rien))
      .toEqual({ title: 'BAGAGE CABINE', description: 'La technique du rolling.', value: '' });
    // Cas relevés par la QA : jamais de fragment orphelin ni de citation seule.
    expect(texteSansChiffresInventes('La danse sollicite 600 muscles. Course à pied.', rien)).toBe('');
    expect(texteSansChiffresInventes('Étude NEJM 2019 : +40% de densité osseuse par an. Étude NEJM.', rien)).toBe('');
    expect(texteSansChiffresInventes('Taux négociés au point le plus bas depuis 2021. Compare les offres avant de signer.', rien)).toBe('Compare les offres avant de signer.');
    // Noms porteurs d'un chiffre : gardés.
    expect(texteSansChiffresInventes('Les oméga-3 aident ta récupération après le sport.', rien)).toBe('Les oméga-3 aident ta récupération après le sport.');
  });

  it('un chiffre écrit par l’utilisateur reste ; la valeur n’est pas répétée dans le titre', () => {
    const a = chiffresAutorises('Promo -20% sur le coaching');
    expect(valeurSansChiffresInventes('-20%', a)).toBe('-20%');
    expect(texteSansChiffresInventes('-20% ce mois-ci', a)).toBe('-20% ce mois-ci');
    expect(titreSansValeur('PROMO -20%', '-20%')).toBe('PROMO');
    // Une valeur en MOTS peut ouvrir le titre (« GROOVE > COMPTE »).
    expect(titreSansValeur('GROOVE > COMPTE', 'GROOVE')).toBe('GROOVE > COMPTE');
  });

  it('generateSmartContent : aucun chiffre dans les valeurs, titres et descriptions des cartes (voyage, danse, sommeil, nutrition, finance)', () => {
    for (const sujet of ['voyage', 'danse afro', 'sommeil', 'nutrition', 'finance', 'hydratation', 'yoga']) {
      for (let seed = 0; seed < 6; seed++) {
        const c = generateSmartContent(sujet, seed);
        for (const k of c.cards) {
          expect(k.value, `${sujet}/${seed}`).not.toMatch(/\d/);
          expect(k.title, `${sujet}/${seed}`).not.toMatch(/\d/);
          expect(k.description, `${sujet}/${seed}`).not.toMatch(/\d/);
        }
        expect(c.subtitle, `${sujet}/${seed}`).not.toMatch(/\d/);
        expect(c.subtitle.length, `${sujet}/${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('generateSmartContent : un nombre présent dans le sujet de l’utilisateur peut rester', () => {
    const c = generateSmartContent('voyage 7 jours');
    expect(chiffresAutorises('voyage 7 jours').has('7')).toBe(true);
    for (const k of c.cards) for (const n of `${k.title} ${k.description} ${k.value}`.match(/\d+/g) ?? []) expect(n).toBe('7');
  });
});

describe('entrées démesurées : aucune regex à retour arrière', () => {
  it('slug de 50 000 caractères : traité en < 50 ms, cas usuels inchangés', () => {
    const long = `https://www.pexels.com/video/${'a1'.repeat(25_000)}!/`;
    const t0 = performance.now();
    descriptionMediaStock({ sourceUrl: long });
    descriptionMediaStock({ sourceUrl: `https://www.pexels.com/video/${'-'.repeat(50_000)}x` });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(descriptionMediaStock({ sourceUrl: 'https://www.pexels.com/video/a-chef-cooking-seafood-on-the-beach-1001/' })).toBe('a chef cooking seafood on the beach');
    expect(descriptionMediaStock({ sourceUrl: 'https://unsplash.com/photos/a-boat-on-a-lake-AbC1dEf?utm_source=studiio' })).toBe('a boat on a lake');
    expect(descriptionMediaStock({ sourceUrl: 'https://www.pexels.com/video/1234567/' })).toBe('');
  });

  it('textes générés de 50 000 caractères : filtre des chiffres en < 50 ms', () => {
    const a = chiffresAutorises('Voyage');
    const t0 = performance.now();
    texteSansChiffresInventes(`${' '.repeat(50_000)}1`, a);
    texteSansChiffresInventes(`${'=,'.repeat(25_000)}x 4`, a);
    titreSansChiffresInventes(`${'1 '.repeat(25_000)}%`, a);
    titreSansValeur('VOLS', `${'1 '.repeat(25_000)}`);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('base locale smart-content : aucun chiffre, aucune phrase orpheline (QA #612)', () => {
  const ORPHELIN = /\b(?:de|des|du|par|en|sur|à|avec|pour|le|la|les|un|une)\s*[.!?]$/i;
  it.each(['voyage', 'danse afro cardio', 'nutrition sportive', 'finance personnelle'])('%s × 40 générations', (sujet) => {
    for (let seed = 0; seed < 40; seed++) {
      const c = generateSmartContent(sujet, seed);
      const textes = [c.subtitle, ...c.cards.flatMap((k) => [k.title, k.description, k.value])];
      for (const t of textes) expect(t, `${sujet}/${seed}`).not.toMatch(/\d/);
      for (const k of c.cards) {
        for (const phrase of k.description.match(/[^.!?…]+[.!?…]*/g) ?? []) {
          const mots = phrase.trim().split(/\s+/).filter((m) => /\p{L}/u.test(m));
          expect(mots.length, `${sujet}/${seed} « ${phrase} »`).toBeGreaterThanOrEqual(4);
          expect(phrase.trim(), `${sujet}/${seed}`).not.toMatch(ORPHELIN);
          expect(phrase, `${sujet}/${seed}`).not.toMatch(/\b(?:étude|NEJM|Harvard|selon)\b/i);
        }
      }
    }
  });
});

describe('thème : « Fitness et sport à la maison » n’est pas de l’immobilier', () => {
  it('les mots de contexte (« maison ») ne choisissent plus le thème', () => {
    const textes = JSON.stringify(generateSmartContent('Fitness et sport à la maison', 0)).toLowerCase();
    expect(textes).not.toMatch(/scpi|immobili|taux d['’]effort|locatif|crédit/);
    // L'immobilier reste reconnu quand il est le sujet.
    expect(JSON.stringify(generateSmartContent('immobilier', 0)).toLowerCase()).toMatch(/immobili|pierre|locati|achat|bien/);
  });
});

