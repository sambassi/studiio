import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import {
  buildAutopilotSample, sampleTopic, sampleSeed, samplePosterVisible,
} from '@/lib/autopilot/sample';
import { AUTOPILOT_GRADIENT_OPACITY } from '@/lib/autopilot/brand';
import { THEMES } from '@/lib/themes';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';

// jsdom ne connait pas `ResizeObserver`, dont l'apercu se sert pour mesurer
// son plateau. Un double inerte suffit : la mise a l'echelle ne concerne pas
// ces tests.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));

// Le catalogue de polices declenche des requetes reseau : inutile ici.
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

/**
 * L'aperçu de l'Autopilote — un ÉCHANTILLON, pas une prédiction.
 *
 * ⚠️ LA COLONNE DE DROITE ÉTAIT VIDE. Elle sert l'assistant « Créer simple »,
 * qui n'a rien généré tant qu'on n'a pas cliqué « Commencer » : on réglait les
 * couleurs et le fond des cartes de l'Autopilote devant un cadre en
 * pointillés. C'était le seul endroit du produit où l'on choisit un style sans
 * jamais le voir.
 *
 * Ce qui est vérifié ici, dans l'ordre d'importance :
 *
 * 1. L'aperçu **dit** que c'est un exemple. Sans ce libellé, l'utilisateur le
 *    lit comme la prochaine vidéo et s'étonne d'en recevoir une autre.
 * 2. La portée de l'affiche suit **la règle du rendu**. Un aperçu qui montre
 *    les cartes sur une photo alors que la vidéo les pose sur les couleurs
 *    vaut moins que pas d'aperçu du tout.
 * 3. L'assistant n'est **pas** touché.
 */

// ── Le réseau, neutralisé ────────────────────────────────────────────────
// L'aperçu va chercher une affiche chez Pexels ; le panneau lit sa
// configuration. Aucun des deux ne doit faire échouer un test d'interface.
let configServeur: AutopilotConfig = DEFAULT_CONFIG;

beforeEach(() => {
  configServeur = DEFAULT_CONFIG;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [{ id: 1, url: 'https://exemple.test/affiche.jpg', medium: 'https://exemple.test/affiche.jpg' }] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        configServeur = sanitizeConfig(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ success: true, brandingReady: true, config: configServeur }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ─────────────────────────────────────────────────────────────────────────
describe('A — le sujet de l échantillon', () => {
  it('c est le PREMIER thème coché', () => {
    // Montrer un sujet que l'utilisateur vient justement de décocher serait
    // une réponse à côté de sa question.
    expect(sampleTopic(['danse', 'nutrition'])).toBe('danse');
  });

  it('sans aucun choix, le premier de la liste représente la rotation', () => {
    expect(sampleTopic([])).toBe(THEMES[0].topic);
    expect(sampleTopic(undefined)).toBe(THEMES[0].topic);
    expect(sampleTopic(null)).toBe(THEMES[0].topic);
  });

  it('un thème PERSONNALISÉ est rendu tel quel', () => {
    // ⚠️ LE FILTRER SUR LES THÈMES CONNUS le remplacerait silencieusement par
    // « Sommeil », et l'utilisateur croirait son thème ignoré par le moteur.
    expect(sampleTopic(['récupération après le sport'])).toBe('récupération après le sport');
  });

  it('les entrées vides ne comptent pas', () => {
    expect(sampleTopic(['', '   ', 'danse'])).toBe('danse');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — le contenu d exemple est STABLE', () => {
  it('un même sujet donne toujours le même texte', () => {
    // ⚠️ C'EST LA CONDITION POUR POUVOIR COMPARER DEUX COULEURS. Une graine
    // aléatoire réécrirait tout le texte à chaque mouvement de roue
    // chromatique, et l'utilisateur ne pourrait plus juger de rien.
    expect(sampleSeed('danse')).toBe(sampleSeed('danse'));
    const a = buildAutopilotSample({ topics: ['danse'] });
    const b = buildAutopilotSample({ topics: ['danse'] });
    expect(a).toEqual(b);
  });

  it('deux sujets différents donnent des textes différents', () => {
    const a = buildAutopilotSample({ topics: ['danse'] });
    const b = buildAutopilotSample({ topics: ['finance'] });
    expect(a.topic).not.toBe(b.topic);
    expect(a.title).not.toBe(b.title);
  });

  it('il porte tout ce qu une séquence demande', () => {
    const s = buildAutopilotSample({ topics: ['nutrition'] });
    expect(s.title).toBe('NUTRITION'); // le moteur met le titre en capitales
    expect(s.subtitle).toBeTruthy();
    expect(s.cta).toBeTruthy();
    expect(s.cards.length).toBeGreaterThan(0);
    expect(s.cards.length).toBeLessThanOrEqual(5);
    expect(s.posterQuery).toBeTruthy();
  });

  it('les icônes de cartes sont des NOMS lucide, jamais des emojis', () => {
    // Règle absolue du dépôt.
    const s = buildAutopilotSample({ topics: ['sommeil'] });
    for (const c of s.cards) {
      expect(c.icon).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — la portée de l affiche suit LE RENDU, pas une seconde règle', () => {
  it('cartes sur les couleurs : la photo disparaît des cartes et du CTA', () => {
    expect(samplePosterVisible('cards', false)).toBe(false);
    expect(samplePosterVisible('cta', false)).toBe(false);
    expect(samplePosterVisible('video', false)).toBe(false);
  });

  it('la séquence titre garde l affiche en toutes circonstances', () => {
    // C'est là que la variété se voit — la retirer viderait l'aperçu de sens.
    expect(samplePosterVisible('intro', false)).toBe(true);
    expect(samplePosterVisible('intro', true)).toBe(true);
  });

  it('cartes sur l affiche : la photo revient partout', () => {
    for (const f of ['all', 'intro', 'cards', 'video', 'cta'] as const) {
      expect(samplePosterVisible(f, true)).toBe(true);
    }
  });

  it('elle reproduit EXACTEMENT `backgroundFor` du montage', () => {
    // ⚠️ DEUX RÈGLES POUR UNE MÊME QUESTION FINIRAIENT PAR DIVERGER, et
    // l'aperçu mentirait sans que rien ne le signale. Les deux tables de
    // vérité sont comparées ici, cas par cas.
    const rendu = (type: string, cardsShowPoster: boolean) =>
      cardsShowPoster !== false || type === 'intro';
    for (const cardsShowPoster of [true, false]) {
      for (const [focus, type] of [['intro', 'intro'], ['cards', 'cards'], ['cta', 'cta'], ['video', 'video']] as const) {
        expect(samplePosterVisible(focus, cardsShowPoster)).toBe(rendu(type, cardsShowPoster));
      }
    }
  });

  it('le voile est celui du montage (0,3), pas celui de l assistant (0,5)', () => {
    // `buildAutopilotDesign` ne transmet pas `gradientOpacity` : le montage
    // retombe sur `?? 0.3`. Reprendre le 0,5 de l'assistant aurait donné un
    // aperçu plus voilé que la vidéo.
    const montage = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
    expect(montage).toContain(`props.gradientOpacity ?? ${AUTOPILOT_GRADIENT_OPACITY}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — à l écran', () => {
  it('la colonne d aperçu n est plus vide avant de commencer', async () => {
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeTruthy());
  });

  it('elle DIT que c est un exemple, et nomme le thème montré', async () => {
    // ⚠️ SANS CE LIBELLÉ, l'aperçu se lit comme une prédiction.
    render(<AssistantWizard />);
    const mention = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu-mention]') as HTMLElement);
    expect(mention.textContent).toContain('exemple');
    expect(mention.textContent).toContain('changent à chaque vidéo');
    expect(mention.textContent).toContain(THEMES[0].label);
  });

  it('elle ne promet PAS que les cartes seront celles-ci', async () => {
    // ⚠️ CETTE PHRASE EST CELLE DE L'ASSISTANT, et elle y est vraie : il
    // montre le contenu qui partira au compositeur. Sous un échantillon, elle
    // promet exactement ce que l'Autopilote ne tient pas.
    render(<AssistantWizard />);
    const apercu = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu]') as HTMLElement);
    expect(apercu.textContent).not.toContain('seront exactement celles-ci');
  });

  it('le contenu d exemple est réellement peint', async () => {
    render(<AssistantWizard />);
    const apercu = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu]') as HTMLElement);
    const attendu = buildAutopilotSample({ topics: [] });
    await waitFor(() => expect(apercu.textContent).toContain(attendu.title));
  });

  it('cocher un thème change le contenu montré', async () => {
    // Le pont `onConfigChange` : sans lui, l'aperçu resterait figé sur le
    // premier thème quoi que l'utilisateur choisisse.
    render(<AssistantWizard />);
    const apercu = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu]') as HTMLElement);
    await waitFor(() => expect(apercu.textContent).toContain(buildAutopilotSample({ topics: [] }).title));

    fireEvent.click(document.querySelector('[data-autopilot-topic="finance"]') as Element);
    await waitFor(() =>
      expect(apercu.textContent).toContain(buildAutopilotSample({ topics: ['finance'] }).title));
  });

  it('changer les couleurs met l aperçu à jour SANS attendre l enregistrement', async () => {
    // ⚠️ LES COULEURS NE PARTENT AU SERVEUR QU'AU RELÂCHEMENT. Si l'aperçu
    // attendait la réponse, il serait figé pendant tout le réglage — le seul
    // moment où il sert.
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="2"]') as Element);

    const champ = await waitFor(() =>
      document.querySelector('[data-autopilot-color-start] input') as HTMLInputElement);
    fireEvent.change(champ, { target: { value: '#123456' } });

    await waitFor(() => {
      const apercu = document.querySelector('[data-autopilot-apercu]') as HTMLElement;
      // Le voile est peint en `rgba(...)` : la couleur de début du dégradé,
      // à l'opacité du montage.
      expect(apercu.innerHTML).toContain('rgba(18, 52, 86');
    });
  });

  it('l onglet Vidéo n est proposé QUE si des rushes existent', async () => {
    // Sans banque, le moteur produit titre → cartes → CTA : annoncer un
    // onglet vide promettrait une séquence que le montage ne contient pas.
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, rushUrls: ['https://x.test/a.mp4'] });
    render(<AssistantWizard />);
    const apercu = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu]') as HTMLElement);
    await waitFor(() => {
      const onglets = Array.from(apercu.querySelectorAll('[role="tab"]'));
      const video = onglets.find((o) => o.textContent === 'Vidéo') as HTMLButtonElement | undefined;
      expect(video?.disabled).toBe(false);
    });
  });

  it('sans rush, l onglet Vidéo reste hors d atteinte', async () => {
    render(<AssistantWizard />);
    const apercu = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu]') as HTMLElement);
    await waitFor(() => {
      const onglets = Array.from(apercu.querySelectorAll('[role="tab"]'));
      const video = onglets.find((o) => o.textContent === 'Vidéo') as HTMLButtonElement | undefined;
      expect(video?.disabled).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — l assistant « Créer simple » n est PAS touché', () => {
  it('démarrer l assistant rend la colonne à SON aperçu', async () => {
    // ⚠️ LE BASCULEMENT SE FAIT SUR `started`, ET SUR RIEN D'AUTRE. L'aperçu
    // de l'assistant porte ses poignées d'édition et les refs de l'export :
    // le remplacer une seule fois de trop casserait la capture des cartes.
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeTruthy());

    fireEvent.click(screen.getByText('Commencer'));
    await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeNull());
    // Son en-tête est bien revenu. Il dit « Aperçu du style » depuis P0-A :
    // il ne doit pas pouvoir être pris pour la vidéo réellement produite.
    expect(screen.getByText('Aperçu du style')).toBeTruthy();
  });

  it('le panneau Autopilote marche toujours sans consommateur d aperçu', () => {
    // `onConfigChange` est OPTIONNEL : monté seul — dans les tests, ailleurs
    // dans l'app — le panneau doit se comporter exactement comme avant.
    const panneau = readFileSync(
      resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
    expect(panneau).toContain('onConfigChange?: (config: AutopilotConfig) => void');
    expect(panneau).toContain('onConfigChange?.(config)');
  });
});
