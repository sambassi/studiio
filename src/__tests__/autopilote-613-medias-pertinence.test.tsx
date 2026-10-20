import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import CompleterRushesStock, { classerCandidats } from '@/components/creer/CompleterRushesStock';
import {
  accepteAutomatiquement, corpsExpose, MESSAGE_PEU_PERTINENTS, pertinenceMedia, scenarioPertinence,
} from '@/lib/autopilot/pertinence-medias';
import { mediasDesSources, type ConfigPourSources, type MediaStockRetenu } from '@/lib/autopilot/sources';
import type { MediaStock } from '@/lib/stock/types';

/**
 * #613 — « inconnu » n'est JAMAIS posé automatiquement.
 *
 * Constat : un torse nu noir et blanc ouvrait une vidéo « Motivation » — un
 * média dont la description ne dit rien du sujet était accepté par la règle
 * d'avant. Ici, sur quatre sujets réels (motivation, nutrition, voyage,
 * danse) et des titres Pexels réalistes :
 *   - la sélection AUTOMATIQUE (propositions, moteur) ne prend que
 *     pertinent / décor / limite ;
 *   - un CHOIX EXPLICITE (retenu pour ce sujet, forcé dans le plan, rush
 *     personnel) est respecté ;
 *   - le fitness est inchangé (torse en salle pour « Musculation »).
 */

const niveau = (sujet: string, description: string, textes: string[] = []) =>
  pertinenceMedia(description, scenarioPertinence({ sujets: [sujet], textes })).niveau;

/** Jeux de titres (slugs Pexels lus en mots) par sujet : [description, accepté automatiquement ?]. */
const JEUX: Record<string, Array<[string, boolean]>> = {
  Motivation: [
    ['man running up stairs at sunrise', true],
    ['woman writing goals in notebook', true],
    ['boxer training in the gym', true],
    ['hiker reaching mountain summit', true],
    ['shirtless man in black and white', false],
    ['muscular torso black and white', false],
    ['close up of a coffee cup', false],
    ['abstract light bokeh', false],
  ],
  Nutrition: [
    ['woman eating a fresh salad', true],
    ['smoothie bowl with fruits', true],
    ['fresh vegetables on a market stall', true],
    ['shirtless man drinking water', false],
    ['woman in lingerie on a bed', false],
    ['people dancing at a party', false],
    ['city traffic at night', false],
  ],
  Voyage: [
    ['tourist with a suitcase at the airport', true],
    ['sailboat on a turquoise lagoon', true],
    ['palm trees on a tropical beach', true],
    ['old town street with market', true],
    ['shirtless man posing', false],
    ['man lifting dumbbells in gym', false],
    ['close up of a keyboard', false],
  ],
  Danse: [
    ['group of dancers on stage', true],
    ['woman dancing in a studio', true],
    ['shirtless dancer performing', true],
    ['chef cooking pasta in a kitchen', false],
    ['laptop on a desk', false],
    ['abstract light bokeh', false],
  ],
};

describe('pertinence de contenu — quatre sujets, titres réalistes', () => {
  for (const [sujet, jeu] of Object.entries(JEUX)) {
    for (const [description, attendu] of jeu) {
      it(`${sujet} · « ${description} » → ${attendu ? 'accepté' : 'jamais automatique'}`, () => {
        expect(accepteAutomatiquement(niveau(sujet, description))).toBe(attendu);
      });
    }
  }

  it('le torse nu « Motivation » est hors sujet (pas seulement inconnu)', () => {
    expect(niveau('Motivation', 'shirtless man in black and white')).toBe('hors');
    expect(corpsExpose('shirtless man in black and white')).toBe(true);
    expect(corpsExpose('man walking on the beach')).toBe(false);
    expect(niveau('Motivation', 'shirtless man torso black and white')).toBe('hors');
  });

  it('Motivation : « muscular man training with dumbbells » n’est PAS hors sujet (muscular ≠ corps exposé)', () => {
    expect(corpsExpose('muscular man training with dumbbells')).toBe(false);
    expect(niveau('Motivation', 'muscular man training with dumbbells')).not.toBe('hors');
  });

  it('Motivation dont le brief parle d’entraînement : un torse à l’entraînement redevient acceptable', () => {
    expect(niveau('Motivation', 'shirtless man training in gym', ['Remplis ta séance d’entraînement'])).not.toBe('hors');
    expect(accepteAutomatiquement(niveau('Motivation', 'shirtless man training in gym', ['Remplis ta séance d’entraînement']))).toBe(true);
  });

  it('fitness INCHANGÉ : un torse en salle reste pertinent pour « Musculation »', () => {
    expect(niveau('Musculation', 'shirtless man lifting dumbbells in gym')).toBe('pertinent');
    expect(accepteAutomatiquement(niveau('Musculation', 'shirtless man working out in the gym'))).toBe(true);
    expect(accepteAutomatiquement(niveau('fitness', 'shirtless man doing workout'))).toBe(true);
  });

  it('sujet hors taxonomie : un titre qui NOMME le sujet l’illustre', () => {
    expect(niveau('Business', 'business meeting in a modern office')).toBe('pertinent');
    expect(niveau('Business', 'cat sleeping on a sofa')).toBe('inconnu');
  });

  it('sans description : inconnu', () => {
    expect(niveau('Voyage', '')).toBe('inconnu');
  });
});

// ── Propositions automatiques (CompleterRushesStock) ───────────────────────

function stock(id: string, description: string): MediaStock {
  return {
    id: `pexels-video-${id}`, provider: 'pexels', providerAssetId: id, type: 'video',
    largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: 12,
    vignetteUrl: `https://images.pexels.com/videos/${id}/thumb.jpg`, apercuUrl: `https://images.pexels.com/videos/${id}/a.jpg`,
    fichierUrl: `https://videos.pexels.com/video-files/${id}/hd.mp4`, sourceUrl: `https://www.pexels.com/video/${id}/`,
    auteur: `Auteur ${id}`, description, licence: 'Pexels License', attribution: `Vidéo de Auteur ${id} sur Pexels`,
  };
}

describe('classerCandidats : aucune proposition automatique « inconnu »', () => {
  const scenario = scenarioPertinence({ sujets: ['Motivation'] });
  const medias = [
    stock('T', 'shirtless man in black and white'),
    stock('C', 'close up of a coffee cup'),
    stock('R', 'man running up stairs at sunrise'),
    stock('V', ''),
  ];

  it('automatique : seul le média qui illustre le sujet est proposé', () => {
    expect(classerCandidats(medias, { orientation: 'portrait', scenario }).map((m) => m.providerAssetId)).toEqual(['R']);
  });

  it('recherche SAISIE par l’utilisateur : seul le hors sujet est écarté', () => {
    expect(classerCandidats(medias, { orientation: 'portrait', scenario, libre: true }).map((m) => m.providerAssetId))
      .toEqual(['R', 'C', 'V']);
  });
});

describe('CompleterRushesStock : peu de médias pertinents → on le dit', () => {
  let reponse: MediaStock[];
  beforeEach(() => {
    reponse = [stock('T', 'shirtless man in black and white'), stock('C', 'close up of a coffee cup')];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/stock/recherche')) {
        return { ok: true, status: 200, json: async () => ({ success: true, medias: reponse, echecs: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('aucun résultat pertinent : rien n’est proposé, message « peu de médias pertinents » (pas « indisponible »)', async () => {
    render(<CompleterRushesStock sujet="Motivation" rushUrls={[]} accent="#7C3AED" onConserver={() => {}} />);
    await screen.findByText(MESSAGE_PEU_PERTINENTS);
    expect(document.querySelector('[data-autopilot-stock-indisponible]')).toBeNull();
    expect(document.querySelectorAll('[data-autopilot-stock-vignette]').length).toBe(0);
    expect(document.querySelector('[data-autopilot-stock-proposes]')!.textContent).toContain('0');
  });

  it('un résultat pertinent : il est proposé, jamais le torse', async () => {
    reponse = [stock('T', 'shirtless man in black and white'), stock('R', 'man running up stairs at sunrise')];
    render(<CompleterRushesStock sujet="Motivation" rushUrls={[]} accent="#7C3AED" onConserver={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-autopilot-stock-vignette="R"]')).not.toBeNull());
    expect(document.querySelector('[data-autopilot-stock-vignette="T"]')).toBeNull();
  });
});

// ── Moteur (mediasDesSources) : auto vs choix explicite ────────────────────

const S = 'https://studiio.pro/storage/v1/object/public/media/u/library/';
const PERSO = 'https://studiio.pro/storage/v1/object/public/media/u/perso.mp4';
const retenu = (id: string, slug: string, sujet?: string): MediaStockRetenu => ({
  url: `${S}stock-pexels-video-${id}.mp4`, type: 'video', provider: 'pexels', providerAssetId: id, auteur: 'A',
  sourceUrl: slug ? `https://www.pexels.com/video/${slug}-${id}/` : '', licence: 'Pexels', vignetteUrl: '',
  ...(sujet ? { sujet } : {}),
});
const cfg = (topics: string[], stockRetenu: MediaStockRetenu[], gabarit: Array<{ id: string; type: 'stock'; media: string }> = []): ConfigPourSources => ({
  rushUrls: [PERSO, ...stockRetenu.map((m) => m.url)],
  jumeauAvatar: true,
  topics,
  designStyle: { sources: { actives: { rushes: true, avatar: true, stock: true }, stock: stockRetenu, gabarit } },
});

describe('mediasDesSources : « inconnu » jamais pioché, choix explicites respectés', () => {
  it('Motivation : le torse nu (retenu sans sujet) n’est jamais pioché ; le pertinent l’est ; le rush perso reste', () => {
    const torse = retenu('101', 'shirtless-man-in-black-and-white');
    const escaliers = retenu('102', 'man-running-up-stairs-at-sunrise');
    const r = mediasDesSources(cfg(['motivation'], [torse, escaliers]));
    expect(r.videosStock).toEqual([escaliers.url]);
    expect(r.rushesPersonnels).toEqual([PERSO]);
  });

  it('une description qui ne dit RIEN du sujet (retenue sans sujet) : jamais piochée, même seule', () => {
    const tasse = retenu('103', 'close-up-of-a-coffee-cup');
    expect(mediasDesSources(cfg(['voyage'], [tasse])).videosStock).toEqual([]);
  });

  it('moins de médias pertinents = moins de plans de coupe : le reste n’est pas comblé par de l’inconnu', () => {
    const plage = retenu('104', 'palm-trees-on-a-tropical-beach');
    const clavier = retenu('105', 'close-up-of-a-keyboard');
    expect(mediasDesSources(cfg(['voyage'], [plage, clavier])).videosStock).toEqual([plage.url]);
  });

  it('CHOIX EXPLICITE : retenu pendant que le sujet était courant → respecté même si son titre ne dit rien', () => {
    const tasse = retenu('106', 'close-up-of-a-coffee-cup', 'Nutrition');
    expect(mediasDesSources(cfg(['nutrition'], [tasse])).videosStock).toEqual([tasse.url]);
  });

  it('CHOIX EXPLICITE : forcé dans le plan → toujours disponible, même le torse', () => {
    const torse = retenu('107', 'shirtless-man-in-black-and-white', 'Motivation');
    expect(mediasDesSources(cfg(['motivation'], [torse])).videosStock).toEqual([]);
    expect(mediasDesSources(cfg(['motivation'], [torse], [{ id: 'a', type: 'stock', media: torse.url }])).videosStock).toEqual([torse.url]);
  });

  it('danse : un danseur torse nu reste pertinent ; une cuisine, jamais', () => {
    const danseur = retenu('108', 'shirtless-dancer-performing');
    const chef = retenu('109', 'chef-cooking-pasta-in-a-kitchen');
    expect(mediasDesSources(cfg(['danse'], [danseur, chef])).videosStock).toEqual([danseur.url]);
  });

  it('fiche ancienne SANS description lisible : impossible à juger — gardée comme avant (repli)', () => {
    const ancien = retenu('110', '');
    expect(mediasDesSources(cfg(['voyage'], [ancien])).videosStock).toEqual([ancien.url]);
  });
});
