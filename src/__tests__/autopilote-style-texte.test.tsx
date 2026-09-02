import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  sanitizeDesignStyle, designStyleIsEmpty,
  SCALE_MIN, SCALE_MAX, LETTER_SPACING_MAX, LINE_HEIGHT_MAX,
} from '@/lib/autopilot/textStyle';
import { sanitizeConfig, DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { FONT_CATALOG } from '@/lib/fonts/catalog';
import { ALL_LUCIDE_NAMES } from '@/lib/icons/library';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * Police, taille, positions et icônes — réglés UNE fois, hérités par toutes
 * les vidéos.
 *
 * ⚠️ LA CONTRAINTE DE CETTE FONCTIONNALITÉ N'EST PAS TECHNIQUE, ELLE EST
 * SPATIALE. Sept réglages fois trois zones, empilés dans la colonne de
 * gauche, auraient doublé la hauteur de l'étape « Style & médias » — ou
 * imposé une septième étape. Ils vivent donc SUR l'aperçu : double-clic pour
 * les panneaux, glisser pour déplacer, poignées pour agrandir. Ce que ces
 * tests protègent en priorité, c'est donc autant l'ergonomie que le rendu.
 *
 * ⚠️ ET `{}` DOIT RESTER LE RENDU D'AVANT. Une propriété absente n'est jamais
 * remplacée par un défaut inventé : c'est ce qui rend l'ajout
 * rétro-compatible pour toutes les configurations existantes, et pour toute
 * configuration relue avant que la migration ne soit appliquée.
 */

// jsdom ne connait pas `ResizeObserver`, dont l'apercu se sert pour mesurer
// son plateau.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

const POST: PreparedPost = {
  title: 'sommeil',
  caption: '',
  scheduledDate: '2026-08-08',
  scheduledTime: '18:00',
  platforms: [],
  rushUrl: null,
  content: {
    subtitle: 'Un sous-titre',
    tagLine: 'Un CTA',
    cards: [
      { icon: 'Moon', title: 'A', description: 'a', value: '1' },
      { icon: 'Zap', title: 'B', description: 'b', value: '2' },
    ],
  } as PreparedPost['content'],
};

const POLICE = FONT_CATALOG[FONT_CATALOG.length - 1].family;

function config(designStyle: unknown): AutopilotConfig {
  return sanitizeConfig({ ...DEFAULT_CONFIG, designStyle });
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — sanitizeDesignStyle ne laisse passer que du réglable', () => {
  it('une police HORS CATALOGUE est ignorée', () => {
    // ⚠️ ELLE NE SERAIT CHARGEE NI PAR L'APERCU NI PAR LE RENDU SERVEUR : le
    // montage sortirait dans la police par defaut de Chromium, sans la
    // moindre erreur. Mieux vaut garder le defaut connu.
    expect(sanitizeDesignStyle({ title: { font: 'Comic Sans MS' } })).toEqual({});
    expect(sanitizeDesignStyle({ title: { font: POLICE } })).toEqual({ title: { font: POLICE } });
  });

  it('l échelle est bornée', () => {
    expect(sanitizeDesignStyle({ title: { scale: 99 } }).title?.scale).toBe(SCALE_MAX);
    expect(sanitizeDesignStyle({ title: { scale: -4 } }).title?.scale).toBe(SCALE_MIN);
    expect(sanitizeDesignStyle({ title: { scale: 1.4 } }).title?.scale).toBe(1.4);
    expect(sanitizeDesignStyle({ title: { scale: 'gros' } })).toEqual({});
  });

  it('les positions sont bornées à 0–100', () => {
    expect(sanitizeDesignStyle({ cta: { x: 900, y: -30 } }).cta).toEqual({ x: 100, y: 0 });
  });

  it('interlettrage et interligne sont bornés', () => {
    const s = sanitizeDesignStyle({ title: { letterSpacing: 999, lineHeight: 999 } });
    expect(s.title?.letterSpacing).toBe(LETTER_SPACING_MAX);
    expect(s.title?.lineHeight).toBe(LINE_HEIGHT_MAX);
  });

  it('une icône INCONNUE est ignorée, une icône lucide est gardée', () => {
    // ⚠️ UN NOM INCONNU REND UNE ICONE VIDE : la carte sortirait du montage
    // avec un trou a la place de son pictogramme.
    expect(sanitizeDesignStyle({ cardIcons: { 0: 'PasUneIcone' } })).toEqual({});
    expect(sanitizeDesignStyle({ cardIcons: { 0: '🔥' } })).toEqual({});
    const bonne = ALL_LUCIDE_NAMES[0];
    expect(sanitizeDesignStyle({ cardIcons: { 0: bonne } }).cardIcons).toEqual({ 0: bonne });
  });

  it('un rang de carte absurde est ignoré', () => {
    const bonne = ALL_LUCIDE_NAMES[0];
    expect(sanitizeDesignStyle({ cardIcons: { '-1': bonne, 999: bonne, x: bonne } })).toEqual({});
  });

  it('le sous-titre n a PAS de position — le rendu n en a pas', () => {
    // ⚠️ `SequenceTitle` le rend DANS le cadre du titre et le montage n'expose
    // aucun `subtitlePos` : accepter un x/y ici ecrirait un reglage que le
    // rendu ignore, et l'utilisateur retrouverait son sous-titre au meme
    // endroit dans la video.
    const s = sanitizeDesignStyle({ subtitle: { x: 10, y: 10, scale: 1.2 } });
    expect(s.subtitle).toEqual({ scale: 1.2 });
  });

  it('n importe quoi rend `{}`, jamais une exception', () => {
    for (const brut of [null, undefined, 42, 'oui', [], { title: 'non' }]) {
      expect(sanitizeDesignStyle(brut)).toEqual({});
    }
    expect(designStyleIsEmpty(sanitizeDesignStyle(null))).toBe(true);
  });

  it('elle est IDEMPOTENTE — l écran ré-assainit ce que le serveur lui rend', () => {
    const une = sanitizeDesignStyle({ title: { font: POLICE, scale: 1.2, x: 10, y: 20 } });
    expect(sanitizeDesignStyle(une)).toEqual(une);
  });

  it('`sanitizeConfig` la branche, et son défaut est vide', () => {
    expect(DEFAULT_CONFIG.designStyle).toEqual({});
    expect(config({ title: { scale: 50 } }).designStyle.title?.scale).toBe(SCALE_MAX);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — le moteur applique le style à CHAQUE vidéo', () => {
  it('SANS style, le design est celui d avant — au champ près', () => {
    // ⚠️ C'EST LA RETRO-COMPATIBILITE. Une propriete absente ne doit pas etre
    // ECRITE `undefined` : un design « vide » passerait pour un design regle.
    const d = buildAutopilotDesign(POST, { config: config({}) }) as unknown as Record<string, unknown>;
    for (const champ of ['titleFont', 'titleScale', 'titlePos', 'ctaFont', 'ctaPos', 'subtitleFont']) {
      expect(champ in d, champ).toBe(false);
    }
  });

  it('la police et la taille du titre sont transmises', () => {
    const d = buildAutopilotDesign(POST, {
      config: config({ title: { font: POLICE, scale: 1.5 } }),
    });
    expect(d.titleFont).toBe(POLICE);
    expect(d.titleScale).toBe(1.5);
  });

  it('la position devient `titlePos` / `ctaPos`', () => {
    const d = buildAutopilotDesign(POST, {
      config: config({ title: { x: 20, y: 30 }, cta: { x: 40, y: 80 } }),
    });
    expect(d.titlePos).toEqual({ x: 20, y: 30 });
    expect(d.ctaPos).toEqual({ x: 40, y: 80 });
  });

  it('une position INCOMPLÈTE n en écrit aucune', () => {
    // Un `x` sans `y` donnerait un cadre a moitie place — pire qu'aucun.
    const d = buildAutopilotDesign(POST, { config: config({ title: { x: 20 } }) }) as unknown as Record<string, unknown>;
    expect('titlePos' in d).toBe(false);
  });

  it('le sous-titre reçoit police et taille, jamais de position', () => {
    const d = buildAutopilotDesign(POST, {
      config: config({ subtitle: { font: POLICE, scale: 0.8 } }),
    }) as unknown as Record<string, unknown>;
    expect(d.subtitleFont).toBe(POLICE);
    expect(d.subtitleScale).toBe(0.8);
    expect('subtitlePos' in d).toBe(false);
  });

  it('graisse, italique, interlettrage et interligne passent', () => {
    const d = buildAutopilotDesign(POST, {
      config: config({ cta: { bold: false, italic: true, letterSpacing: 4, lineHeight: 1.6 } }),
    });
    expect(d.ctaBold).toBe(false);
    expect(d.ctaItalic).toBe(true);
    expect(d.ctaLetterSpacing).toBe(4);
    expect(d.ctaLineHeight).toBe(1.6);
  });

  it('l icône du compte remplace celle du contenu, rang par rang', () => {
    // ⚠️ C'EST LE PARTAGE QUE L'AUTOPILOTE PROMET : le contenu varie, l'icone
    // non. Les rangs non regles gardent celle du generateur.
    const bonne = ALL_LUCIDE_NAMES[0];
    const d = buildAutopilotDesign(POST, { config: config({ cardIcons: { 0: bonne } }) });
    expect(d.cards?.[0].icon).toBe(bonne);
    expect(d.cards?.[1].icon).toBe('Zap');
  });

  it('« false » est un réglage, pas une absence', () => {
    // `bold: false` doit ETRE ecrit : le confondre avec « non regle »
    // rendrait impossible de retirer la graisse par defaut.
    const d = buildAutopilotDesign(POST, { config: config({ title: { bold: false } }) }) as unknown as Record<string, unknown>;
    expect('titleBold' in d).toBe(true);
    expect(d.titleBold).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — l aperçu de l Autopilote est ÉDITABLE', () => {
  let configServeur: AutopilotConfig = DEFAULT_CONFIG;
  let envois: AutopilotConfig[] = [];

  beforeEach(() => {
    configServeur = DEFAULT_CONFIG;
    envois = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/pexels')) {
        return { ok: true, json: async () => ({ success: true, photos: [] }) };
      }
      if (u.startsWith('/api/autopilot/config')) {
        if (init?.method === 'PUT') {
          configServeur = sanitizeConfig(JSON.parse(String(init.body)));
          envois.push(configServeur);
          return { ok: true, json: async () => ({ success: true, brandingReady: true, styleReady: true, config: configServeur }) };
        }
        return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, styleReady: true, config: configServeur }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const monter = async () => {
    render(<AssistantWizard />);
    return waitFor(() => document.querySelector('[data-autopilot-apercu]') as HTMLElement);
  };

  it('le titre est saisissable et annonce ses gestes', async () => {
    const apercu = await monter();
    const titre = apercu.querySelector('[data-title-block]') as HTMLElement;
    expect(titre).toBeTruthy();
    expect(titre.getAttribute('title')).toContain('Glisser');
    expect(titre.getAttribute('title')).toContain('double-clic');
  });

  it('les poignées de coin apparaissent AU SURVOL, pas en permanence', async () => {
    // ⚠️ ELLES ETAIENT PERMANENTES. Quatre petits carres autour de chaque
    // bloc, en continu : l'apercu ressemblait a une planche de montage.
    const apercu = await monter();
    expect(apercu.querySelector('[data-text-handle]')).toBeNull();

    fireEvent.pointerEnter(apercu.querySelector('[data-title-block]') as Element);
    for (const coin of ['nw', 'ne', 'sw', 'se']) {
      expect(apercu.querySelector(`[data-text-handle="title-${coin}"]`)).toBeTruthy();
    }
    // Et celles du CTA restent absentes : une seule zone a la fois.
    expect(apercu.querySelector('[data-text-handle="cta-se"]')).toBeNull();

    fireEvent.pointerLeave(apercu.querySelector('[data-title-block]') as Element);
    fireEvent.pointerEnter(apercu.querySelector('[data-cta-block]') as Element);
    expect(apercu.querySelector('[data-text-handle="cta-se"]')).toBeTruthy();
  });

  it('double-cliquer le titre ouvre son panneau de police et de taille', async () => {
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-title-block]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-autopilot-texte-panneau="title"]')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-font="title"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-scale="title"]')).toBeTruthy();
  });

  it('choisir une police l enregistre — et l aperçu la porte', async () => {
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-title-block]') as Element);
    const select = await waitFor(() =>
      document.querySelector('[data-autopilot-font="title"]') as HTMLSelectElement);
    fireEvent.change(select, { target: { value: POLICE } });
    await waitFor(() => {
      expect(envois.at(-1)?.designStyle.title?.font).toBe(POLICE);
    });
  });

  it('changer la taille l enregistre en ÉCHELLE, pas en pour-cent', async () => {
    // ⚠️ L'ECRAN AFFICHE DES POUR-CENT, LA BASE STOCKE UNE ECHELLE. Envoyer
    // 150 au lieu de 1,5 serait borne a 3 par `sanitizeDesignStyle` — un
    // titre trois fois trop gros, silencieusement.
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-title-block]') as Element);
    const curseur = await waitFor(() =>
      document.querySelector('[data-autopilot-scale="title"]') as HTMLInputElement);
    fireEvent.change(curseur, { target: { value: '150' } });
    await waitFor(() => expect(envois.at(-1)?.designStyle.title?.scale).toBeCloseTo(1.5, 5));
  });

  it('double-cliquer une carte ouvre le choix de son icône', async () => {
    const apercu = await monter();
    const carte = apercu.querySelector('[data-card-id]') as HTMLElement;
    expect(carte.getAttribute('title')).toContain('icône');
    fireEvent.doubleClick(carte);
    await waitFor(() =>
      expect(document.querySelector('[data-autopilot-icone-panneau]')).toBeTruthy());
  });

  it('choisir une icône l enregistre pour ce rang', async () => {
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-card-id]') as Element);
    const bonne = ALL_LUCIDE_NAMES[0];
    const bouton = await waitFor(() =>
      document.querySelector(`[data-autopilot-icone-panneau] [data-element-pick="${bonne}"]`) as HTMLElement);
    fireEvent.click(bouton);
    await waitFor(() => expect(envois.at(-1)?.designStyle.cardIcons?.['0']).toBe(bonne));
  });

  /**
   * jsdom rend des rectangles NULS : `pointToPct` diviserait par zero et
   * rendrait `NaN`. On pose donc une geometrie fixe — 400x711, le rapport
   * 9:16 — pour que la conversion pixels → pourcentages ait un sens.
   */
  const avecGeometrie = (fn: () => void) => {
    const vrai = HTMLElement.prototype.getBoundingClientRect;
    const rect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height,
      right: left + width, bottom: top + height, toJSON: () => ({}),
    }) as DOMRect;
    HTMLElement.prototype.getBoundingClientRect = function fake(this: HTMLElement) {
      // ⚠️ LE BLOC DOIT ETRE PLUS PETIT QUE LE PLATEAU. Rendre le meme
      // rectangle pour les deux ferait un bloc de 100 % x 100 %, que
      // `clampToBox` ramenerait invariablement en (0, 0) — le test aurait
      // mesure le bornage, pas le deplacement.
      if (this.hasAttribute('data-title-block') || this.hasAttribute('data-cta-block')) {
        return rect(32, 57, 336, 85);
      }
      return rect(0, 0, 400, 711);
    };
    try { fn(); } finally { HTMLElement.prototype.getBoundingClientRect = vrai; }
  };

  it('GLISSER le titre écrit sa position, au relâchement seulement', async () => {
    // ⚠️ AU RELACHEMENT. Un glissement emet des dizaines de positions par
    // seconde : enregistrer a chaque `pointermove` inonderait la route de
    // configuration pour un seul geste.
    const apercu = await monter();
    const titre = apercu.querySelector('[data-title-block]') as HTMLElement;
    avecGeometrie(() => {
      fireEvent.pointerDown(titre, { button: 0, isPrimary: true, pointerId: 1, clientX: 32, clientY: 57 });
      fireEvent.pointerMove(titre, { pointerId: 1, buttons: 1, pointerType: 'mouse', clientX: 200, clientY: 300 });
    });
    // Rien n'est parti tant que le doigt est pose.
    expect(envois.length).toBe(0);
    avecGeometrie(() => fireEvent.pointerUp(titre, { pointerId: 1 }));
    await waitFor(() => {
      const pose = envois.at(-1)?.designStyle.title;
      expect(pose?.x).toBeDefined();
      expect(pose?.y).toBeDefined();
      // Le titre a bien BOUGE depuis son defaut (8 / 8).
      expect(pose!.y).toBeGreaterThan(8);
    });
  });

  it('TIRER un coin écrit une échelle bornée', async () => {
    const apercu = await monter();
    // Les poignees n'apparaissent qu'au survol.
    fireEvent.pointerEnter(apercu.querySelector('[data-title-block]') as Element);
    const poignee = apercu.querySelector('[data-text-handle="title-se"]') as HTMLElement;
    avecGeometrie(() => {
      fireEvent.pointerDown(poignee, { button: 0, isPrimary: true, pointerId: 2, clientX: 210, clientY: 360 });
      fireEvent.pointerMove(poignee, { pointerId: 2, buttons: 1, pointerType: 'mouse', clientX: 390, clientY: 700 });
      fireEvent.pointerUp(poignee, { pointerId: 2 });
    });
    await waitFor(() => {
      const echelle = envois.at(-1)?.designStyle.title?.scale;
      expect(echelle).toBeDefined();
      expect(echelle!).toBeGreaterThanOrEqual(SCALE_MIN);
      expect(echelle!).toBeLessThanOrEqual(SCALE_MAX);
    });
  });

  it('un clic DROIT ne saisit rien', async () => {
    const apercu = await monter();
    const titre = apercu.querySelector('[data-title-block]') as HTMLElement;
    avecGeometrie(() => {
      fireEvent.pointerDown(titre, { button: 2, isPrimary: true, pointerId: 3, clientX: 32, clientY: 57 });
      fireEvent.pointerMove(titre, { pointerId: 3, buttons: 2, pointerType: 'mouse', clientX: 200, clientY: 300 });
      fireEvent.pointerUp(titre, { pointerId: 3 });
    });
    expect(envois.length).toBe(0);
  });

  it('l écran DIT comment régler — un geste qu on ignore n existe pas', async () => {
    await monter();
    const aide = document.querySelector('[data-autopilot-apercu-aide]') as HTMLElement;
    // Insensible a la casse : l'indice est devenu un encart et la phrase a
    // ete recoupee — ce qui compte est que les trois gestes y soient nommes.
    const texte = (aide.textContent ?? '').toLowerCase();
    expect(texte).toContain('double-cliquez');
    expect(texte).toContain('glissez');
    expect(texte).toContain('coins');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — la contrainte tenue : six étapes, colonne de gauche intacte', () => {
  const panneau = readFileSync(
    resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

  it('le wizard a toujours SIX étapes', () => {
    const liste = panneau.slice(panneau.indexOf('const ETAPES = ['), panneau.indexOf('] as const;'));
    expect(liste.split('{ titre:').length - 1).toBe(6);
  });

  it('aucun champ de police, de taille ou d icône dans la colonne de gauche', () => {
    // ⚠️ C'EST LA CONTRAINTE, ET ELLE SE VERIFIE ICI. Ces sept reglages fois
    // trois zones, empiles sous les couleurs, auraient double la hauteur de
    // l'etape « Style & medias ». Ils vivent sur l'apercu.
    expect(panneau).not.toContain('FONT_GROUPS');
    expect(panneau).not.toContain('IconPicker');

    // ⚠️ `designStyle` N'EST PLUS INTERDIT EN BLOC — et la contrainte n'a pas
    // bougé pour autant.
    //
    // Le panneau y enregistre depuis le LOT 1 le format et la durée du
    // montage : deux valeurs que le moteur des rushes honore vraiment, et qui
    // n'ont rien de typographique. Ce qui reste interdit, c'est d'éditer ICI
    // les ZONES de texte — police, taille, casse, icônes — qui se règlent sur
    // l'aperçu et empileraient sept contrôles fois trois zones sous les
    // couleurs.
    const style = panneau.slice(panneau.indexOf('designStyle'));
    for (const zone of ['title:', 'subtitle:', 'cta:', 'cards:', 'cardIcons', 'cardStyle']) {
      expect(style, `la colonne de gauche ne doit pas écrire ${zone}`)
        .not.toContain(zone);
    }
  });

  it('les panneaux de réglage sont FLOTTANTS, ouverts au double-clic', () => {
    const apercu = wizard.slice(
      wizard.indexOf('function AutopilotPreview('),
      wizard.indexOf('export default function AssistantWizard()'),
    );
    expect(apercu).toContain('<FloatingPanel');
    expect(apercu).toContain('onTextDoubleClick');
    expect(apercu).toContain('onCardDoubleClick');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — l assistant manuel n est PAS modifié', () => {
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
  const corpsWizard = wizard.slice(wizard.indexOf('export default function AssistantWizard()'));

  it('son aperçu ouvre lui aussi les réglages au double-clic', () => {
    // ⚠️ CE TEST DISAIT L'INVERSE, ET C'ETAIT JUSTE A L'EPOQUE : l'assistant
    // reglait tout depuis sa colonne de gauche. L'utilisateur a demande
    // depuis a pouvoir regler CHAQUE sequence en double-cliquant dessus, des
    // deux cotes. Ce qui reste vrai, c'est qu'il n'a pas de poignees de
    // TEXTE : sa taille se regle au curseur, et lui en ajouter changerait son
    // ergonomie sans qu'on l'ait demande.
    const principal = corpsWizard.slice(
      corpsWizard.indexOf('<Preview\n          {...previewShared}'),
      corpsWizard.indexOf('/>', corpsWizard.indexOf('<Preview\n          {...previewShared}')),
    );
    expect(principal.length).toBeGreaterThan(0);
    expect(principal).not.toContain('onTextResizeStart');
    expect(principal).toContain('onTextDoubleClick={ouvrirZone}');
    expect(principal).toContain('onCardDoubleClick');
  });

  it('les nouvelles props de `Preview` sont TOUTES optionnelles', () => {
    // Absentes, aucune poignee, aucun gestionnaire : les autres appelants —
    // fenetre agrandie, tests, Calendrier — rendent ce qu'ils rendaient.
    for (const prop of ['onTextResizeStart?:', 'onTextDoubleClick?:', 'onCardDoubleClick?:']) {
      expect(wizard).toContain(prop);
    }
  });

  it('la migration n ajoute qu une colonne, avec ses deux étapes PostgREST', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../migrations/2026-08-07-autopilot-text-style.sql'), 'utf-8');
    expect(migration).toContain('add column if not exists design_style jsonb not null default');
    expect(migration).toContain("'{}'::jsonb");
    expect(migration).toContain('grant all on table public.autopilot_config to public;');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
    expect(migration).not.toMatch(/drop\s+(table|column)/i);
  });
});
