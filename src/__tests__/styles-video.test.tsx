/**
 * Styles vidéo (Créer) — module pur, application à l'état, default safe,
 * persistance et galerie accessible.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import {
  STYLES_VIDEO, STYLE_VIDEO_IDS, POLICES_STYLE, appliquerStyle, retouchesAuStyle, styleVideoParId,
  lireStyleVideoId, profilDuStyle, exempleStyle, type EtatStylable,
} from '@/lib/styles-video/styles';
import { TRANSITION_KEYS } from '@/lib/video-composer';
import { TEXT_ANIMATION_KEYS } from '@/lib/creer/textAnimation';
import { CARD_STYLE_NAMES } from '@/lib/creer/cardStyles';
import { findFont } from '@/lib/fonts/catalog';
import { REGLES_PROFILS, dureePlan, type AnalyseRush } from '@/lib/creer/smart-montage';
import { entreePlanMontage, clePlanMontage, preparerPlanMontage } from '@/lib/creer/preparer-plan-montage';
import { sanitizeDraft, type SanitizeDeps } from '@/lib/creer/draft';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import GalerieStylesVideo from '@/components/creer/GalerieStylesVideo';
import { existsSync, statSync } from 'fs';

const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

const ETAT: EtatStylable = {
  transition: 'crossfade',
  textAnimation: 'none',
  titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: true, letterSpacing: 0, lineHeight: 1.1 },
  ctaStyle: { font: 'Inter', color: '#FF0000', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
  cardStyle: 'Compact',
  cardsTypography: { italic: true },
  gradientOpacity: 0.5,
  habillageVideoMode: 'degrade',
};

describe('définition des styles — uniquement des leviers EXISTANTS', () => {
  it('trois styles, chacun ne vise que des clés connues des moteurs', () => {
    expect(STYLE_VIDEO_IDS).toEqual(['minimaliste', 'sport', 'cinematique']);
    for (const s of STYLES_VIDEO) {
      expect(TRANSITION_KEYS).toContain(s.transition.cle);
      expect(s.transition.secondes).toBe(0.8);
      expect(TEXT_ANIMATION_KEYS).toContain(s.animationTexte);
      expect(CARD_STYLE_NAMES).toContain(s.cartes.style);
      expect(Object.keys(REGLES_PROFILS)).toContain(s.rythme.profil);
      for (const f of [s.titre.font, s.cta.font, s.cartes.font]) {
        expect(POLICES_STYLE).toContain(f);
        expect(findFont(f)).toBeTruthy();
      }
      // L'échelle 1 garde l'ajustement automatique lisible du titre et du CTA.
      expect(s.titre.scale).toBe(1);
      expect(s.cta.scale).toBe(1);
      expect(s.habillage.voile).toBeGreaterThan(0);
      expect(s.habillage.voile).toBeLessThanOrEqual(1);
    }
  });

  it('les trois styles diffèrent sur chaque levier de montage', () => {
    for (const cle of ['rythme.profil', 'transition.cle', 'animationTexte', 'titre.font', 'cartes.style'] as const) {
      const valeurs = STYLES_VIDEO.map((s) => cle.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], s));
      expect(new Set(valeurs).size, cle).toBe(3);
    }
  });

  it('le rythme du Sport est plus court que celui du Minimaliste, lui-même plus court que le Cinématique', () => {
    const milieu = (id: string) => {
      const p = REGLES_PROFILS[profilDuStyle(id)!].phases.BUILD;
      return (p[0] + p[1]) / 2;
    };
    expect(milieu('sport')).toBeLessThan(milieu('minimaliste'));
    expect(milieu('minimaliste')).toBeLessThan(milieu('cinematique'));
  });

  it('identifiants : inconnu ou absent = aucun style', () => {
    expect(styleVideoParId('sport')?.libelle).toBe('Sport dynamique');
    expect(styleVideoParId('neon')).toBeNull();
    expect(lireStyleVideoId(42)).toBeUndefined();
    expect(profilDuStyle(null)).toBeNull();
    expect(exempleStyle('sport')).toEqual({ video: '/styles-video/sport.mp4', poster: '/styles-video/sport.jpg' });
  });
});

describe('appliquerStyle — pose des réglages, ne touche à rien d’autre', () => {
  it('pose transition, animation, typo, cartes et habillage ; garde couleurs et italique', () => {
    const avant = JSON.stringify(ETAT);
    const e = appliquerStyle(ETAT, styleVideoParId('sport')!);
    expect(JSON.stringify(ETAT)).toBe(avant); // pur
    expect(e.transition).toBe('whip-pan');
    expect(e.textAnimation).toBe('pop');
    expect(e.titleStyle).toMatchObject({ font: 'Anton', textCase: 'uppercase', color: '#FFFFFF', italic: true });
    expect(e.ctaStyle).toMatchObject({ font: 'Anton', color: '#FF0000', subColor: '' });
    expect(e.cardStyle).toBe('Stats Bold');
    expect(e.cardsTypography).toEqual({ italic: true, font: 'Poppins', scale: 1.05 });
    expect(e.gradientOpacity).toBe(0.6);
    expect(e.habillageVideoMode).toBe('degrade');
  });

  it('retouches : aucune juste après le choix, puis la retouche manuelle est signalée', () => {
    const style = styleVideoParId('cinematique')!;
    const e = appliquerStyle(ETAT, style);
    expect(retouchesAuStyle(e, style)).toEqual([]);
    expect(retouchesAuStyle({ ...e, transition: 'iris' }, style)).toEqual(['Transition']);
    expect(retouchesAuStyle({ ...e, titleStyle: { ...e.titleStyle, font: 'Poppins' }, gradientOpacity: 0.2 }, style)).toEqual(['Titre', 'Habillage']);
    // Une couleur n'est pas un réglage du style : pas une retouche.
    expect(retouchesAuStyle({ ...e, titleStyle: { ...e.titleStyle, color: '#000000' } }, style)).toEqual([]);
  });
});

describe('rythme : le profil du style entre dans le plan — default safe sans style', () => {
  const ANALYSES = danse.analyses as unknown as AnalyseRush[];
  const D = { intro: 2, cards: 3, video: 14, cta: 2 } as Record<string, number>;
  const entree = (profil?: Parameters<typeof entreePlanMontage>[0]['profil']) => entreePlanMontage({
    rushs: ANALYSES.map((a) => ({ url: a.url, secondes: a.duree })),
    ordre: ['intro', 'cards', 'video', 'cta'], duree: (k: string) => D[k] ?? 0,
    musique: null, theme: 'danse afro cardio', titre: 'DANSE', sousTitre: null, objectif: null,
    cartes: [], methode: 'A', voixDeTextes: true, format: '9:16', profil,
  });

  it('sans style : aucune clé ajoutée, clé du plan inchangée', () => {
    expect('profilImpose' in entree()).toBe(false);
    expect(clePlanMontage(entree(null))).toBe(clePlanMontage(entree()));
    expect(clePlanMontage(entree('TUTORIAL_EDUCATION'))).not.toBe(clePlanMontage(entree()));
  });

  it('sans style le profil reste déduit du thème ; avec style il est imposé et change le plan', () => {
    const acquis = { analysesBrutes: ANALYSES, rythme: null };
    const auto = preparerPlanMontage(entree(), acquis);
    const sport = preparerPlanMontage(entree(profilDuStyle('sport')), acquis);
    const cine = preparerPlanMontage(entree(profilDuStyle('cinematique')), acquis);
    expect(auto.profil).toBe('CARDIO_DANCE');
    expect(sport.profil).toBe('CARDIO_DANCE');
    expect(cine.profil).toBe('TUTORIAL_EDUCATION');
    expect(sport.plan).toEqual(auto.plan); // même profil = même plan
    const moyen = (p: typeof auto) => dureePlan(p.plan!) / p.plan!.length;
    expect(cine.plan!.length).toBeLessThan(sport.plan!.length);
    expect(moyen(cine)).toBeGreaterThan(moyen(sport) * 1.4);
  });
});

describe('persistance — brouillon et post', () => {
  const DEPS: SanitizeDeps = {
    themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16', '1:1', '16:9'], maxStep: 3,
    defaults: {
      themeId: 'sommeil', toneId: 'punchy', format: '9:16',
      titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
      subtitleStyle: { font: null, color: null, scale: 1 },
      ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
      sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: false }, { key: 'cta', enabled: true }],
      durations: { intro: 4, cards: 6, video: 0, cta: 4 },
    },
  };

  it('ancien brouillon (sans style) : rien de nouveau n’apparaît', () => {
    const d = sanitizeDraft({ version: 1, themeId: 'sommeil', titleStyle: { font: 'Anton' } }, DEPS)!;
    expect(d.styleVideo).toBeUndefined();
    expect(d.cardStyle).toBeUndefined();
    expect(d.cardsTypography).toBeUndefined();
    expect('textCase' in (d.titleStyle as object)).toBe(false);
  });

  it('style, cartes et casse relus ; valeurs inconnues écartées', () => {
    const d = sanitizeDraft({
      version: 1, styleVideo: 'cinematique', cardStyle: 'Minimal Line',
      cardsTypography: { font: 'Syne', scale: 1, lisible916: true, bogus: 1 },
      titleStyle: { font: 'Bebas Neue', textCase: 'uppercase', letterSpacing: 6 },
      ctaStyle: { font: 'Syne', textCase: 'shout' },
    }, DEPS)!;
    expect(d.styleVideo).toBe('cinematique');
    expect(d.cardStyle).toBe('Minimal Line');
    expect(d.cardsTypography).toEqual({ font: 'Syne', scale: 1 });
    expect(d.titleStyle).toMatchObject({ font: 'Bebas Neue', textCase: 'uppercase', letterSpacing: 6 });
    expect('textCase' in (d.ctaStyle as object)).toBe(false);
    const x = sanitizeDraft({ version: 1, styleVideo: 'neon', cardStyle: 'Fancy' }, DEPS)!;
    expect(x.styleVideo).toBeUndefined();
    expect(x.cardStyle).toBeUndefined();
  });

  it('« Modifier » relit le style et les cartes du post', () => {
    const d = toWizardDraft({ metadata: { styleVideo: 'sport', design: { cardStyle: 'Stats Bold', cardsTextStyle: { font: 'Poppins', scale: 1.05, lisible916: true } } } } as never);
    expect(d.styleVideo).toBe('sport');
    expect(d.cardStyle).toBe('Stats Bold');
    expect(d.cardsTypography).toEqual({ font: 'Poppins', scale: 1.05 });
    const vide = toWizardDraft({ metadata: {} } as never);
    expect(vide.styleVideo).toBeUndefined();
  });

  it('câblage Créer : profil au plan (aperçu ET export), metadata additive, brouillon', () => {
    expect(wizard.match(/profil: profilDuStyle\(styleVideo\)/g)?.length).toBe(2);
    expect(wizard).toContain('...(styleVideo ? { styleVideo } : {})');
    expect(wizard).toContain('styleVideo: styleVideo ?? undefined');
    expect(wizard).toContain('useState<StyleVideoId | null>(null)');
    // Restauration : relu, jamais réappliqué.
    expect(wizard).toContain('setStyleVideo(lireStyleVideoId(draft.styleVideo) ?? null)');
  });
});

describe('galerie accessible', () => {
  afterEach(cleanup);

  it('trois cartes, un clic choisit, re-cliquer retire ; vidéos muettes sans autoplay', () => {
    const onChoisir = vi.fn();
    const { container, rerender } = render(<GalerieStylesVideo choisi={null} retouches={[]} onChoisir={onChoisir} />);
    expect(screen.getByRole('group', { name: 'Styles vidéo' })).toBeTruthy();
    const boutons = screen.getAllByRole('button', { pressed: false }).filter((b) => b.getAttribute('aria-label')?.startsWith('Style '));
    expect(boutons).toHaveLength(3);
    fireEvent.click(boutons[1]);
    expect(onChoisir).toHaveBeenLastCalledWith('sport');
    rerender(<GalerieStylesVideo choisi="sport" retouches={['Transition']} onChoisir={onChoisir} />);
    const choisi = screen.getByRole('button', { name: /Style Sport dynamique \(choisi\)/ });
    expect(choisi.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Retouché : Transition/)).toBeTruthy();
    fireEvent.click(choisi);
    expect(onChoisir).toHaveBeenLastCalledWith(null);
    const videos = Array.from(container.querySelectorAll('video'));
    expect(videos).toHaveLength(3);
    for (const v of videos) {
      expect(v.muted).toBe(true);
      expect(v.autoplay).toBe(false);
      expect(v.getAttribute('preload')).toBe('none');
      expect(v.getAttribute('poster')).toMatch(/^\/styles-video\/.+\.jpg$/);
    }
    // Le détail derrière une icône d'information, une par style.
    expect(screen.getAllByRole('button', { name: /^Détail du style/ })).toHaveLength(3);
  });

  it('les exemples existent et restent légers', () => {
    for (const id of STYLE_VIDEO_IDS) {
      const { video, poster } = exempleStyle(id);
      const v = resolve(__dirname, '../../public', `.${video}`);
      const p = resolve(__dirname, '../../public', `.${poster}`);
      expect(existsSync(v), v).toBe(true);
      expect(existsSync(p), p).toBe(true);
      expect(statSync(v).size).toBeLessThan(400_000);
    }
  });
});
