/**
 * A_4c — LA BIBLIOTHÈQUE DE SOUS-TITRES, ET SES APERÇUS RÉELS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI L'APERÇU NE PEUT PAS ÊTRE DU CSS
 * ---------------------------------------------------------------------------
 *
 * Un karaoké se remplit avec `\kf`, un mot actif repeint une portion de texte
 * à l'intérieur d'un bloc dont la mise en page ne bouge pas. Ni l'un ni
 * l'autre ne s'imite dans un navigateur : la carte afficherait un mouvement
 * que la vidéo ne fait pas.
 *
 * Chaque carte passe donc par `documentCaptions` — la MÊME fonction que le
 * rendu — et par le MÊME `libass`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STYLES_CAPTION, CAPTION_IDS, VERSION_CAPTIONS, styleCaptionParId,
} from '@/lib/creatif/captions';
import {
  FAMILLES_BIBLIOTHEQUE, LIBELLES_FAMILLE, CLE_USAGE_PAR_FAMILLE,
  FAVORIS_VIDES, favorisValides, recentsDepuisUsages, idsFamille,
} from '@/lib/creatif/bibliotheque';

const Bibliotheque = (await import('@/components/creer/BibliothequeCaptions')).default;
const { adresseApercuCaption, APERCUS_IMMEDIATS } =
  await import('@/components/creer/BibliothequeCaptions');
const { grouperResultats } = await import('@/components/creer/RechercheCreative');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const GRILLE = lire('src/components/creer/BibliothequeCaptions.tsx');
const ROUTE = lire('src/app/api/creatif/captions/[styleId]/apercu/route.ts');
const PANNEAU = lire('src/components/creer/MonStylePanel.tsx');
const AUTOMATISATION = lire('src/components/creer/PanneauStyleAutomatique.tsx');
const POLITIQUE = lire('src/lib/autopilot/analyse/politique-creative.ts');

afterEach(() => { cleanup(); });

const rendre = (actif: string | null = null, extra = {}) => render(
  <Bibliotheque styleActif={actif} onChoisir={() => {}} {...extra} />,
);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La grille', () => {
  it('1.1 « Tout » montre les trente et un styles', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-captions-rayon="tout"]') as HTMLElement);
    expect(container.querySelectorAll('[data-caption-carte]').length)
      .toBe(STYLES_CAPTION.length);
  });

  it('1.2 le style ACTIF est le premier de « Pour vous »', () => {
    const { container } = rendre('challenge');
    const premiere = container.querySelector('[data-caption-carte]');
    expect(premiere?.getAttribute('data-caption-carte')).toBe('challenge');
    expect(premiere?.getAttribute('aria-pressed')).toBe('true');
  });

  it('1.3 ⚠️ « Mot actif » et « Karaoké » sont des rayons, pas des catégories', () => {
    // Ce sont des TECHNIQUES, et c'est ce qu'on vient chercher.
    const { container } = rendre();
    for (const r of ['mot-actif', 'karaoke']) {
      const rayon = container.querySelector(`[data-captions-rayon="${r}"]`) as HTMLElement;
      expect(rayon).not.toBeNull();
      fireEvent.click(rayon);
      const cartes = [...container.querySelectorAll('[data-caption-carte]')]
        .map((c) => c.getAttribute('data-caption-carte')!);
      expect(cartes.length).toBeGreaterThanOrEqual(4);
      for (const id of cartes) {
        const s = styleCaptionParId(id)!;
        if (r === 'karaoke') expect(s.surbrillance).toBe('karaoke');
        else expect(s.surbrillance.startsWith('mot-actif')).toBe(true);
      }
    }
  });

  it('1.4 la recherche marche en français, sans accent obligatoire', () => {
    const { container } = rendre();
    const champ = container.querySelector('[data-captions-recherche]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: 'karaoke bandeau' } });
    const cartes = container.querySelectorAll('[data-caption-carte]');
    expect(cartes.length).toBe(1);
    expect(cartes[0].getAttribute('data-caption-carte')).toBe('karaoke-bandeau');
    fireEvent.change(champ, { target: { value: 'cinema' } });
    expect(container.querySelectorAll('[data-caption-carte]').length).toBeGreaterThan(0);
  });

  it('1.5 une recherche sans résultat le dit', () => {
    const { container } = rendre();
    fireEvent.change(
      container.querySelector('[data-captions-recherche]') as HTMLInputElement,
      { target: { value: 'zzzz' } },
    );
    expect(container.querySelector('[data-captions-vide]')).not.toBeNull();
  });

  it('1.6 favoris et récents ont leurs rayons, et le cœur se bascule', () => {
    const bascules: string[] = [];
    const { container } = render(
      <Bibliotheque
        styleActif={null}
        favoris={['karaoke']}
        recents={['fitness']}
        onBasculerFavori={(id) => bascules.push(id)}
        onChoisir={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-captions-rayon="favoris"]') as HTMLElement);
    expect(container.querySelectorAll('[data-caption-carte]').length).toBe(1);
    fireEvent.click(container.querySelector('[data-captions-rayon="recents"]') as HTMLElement);
    expect(container.querySelector('[data-caption-carte="fitness"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-caption-favori="fitness"]') as HTMLElement);
    expect(bascules).toEqual(['fitness']);
  });

  it('1.7 chaque carte est un bouton, atteignable au clavier et décrit', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-captions-rayon="tout"]') as HTMLElement);
    const carte = container.querySelector('[data-caption-carte="karaoke"]') as HTMLElement;
    expect(carte.tagName).toBe('BUTTON');
    expect(carte.getAttribute('aria-label')).toContain('Karaoké');
    expect(carte.getAttribute('title')).toBeTruthy();
  });

  it('1.8 aucun vocabulaire de moteur à l’écran', () => {
    const visible = GRILLE.match(/>[^<>{}]{4,}</g) ?? [];
    for (const t of visible) {
      expect(t).not.toMatch(/\bASS\b|libass|\\kf|Dialogue|PlayRes|ffmpeg/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le chargement différé et le cache', () => {
  it('2.1 les six premières chargent, les autres attendent', () => {
    const { container } = rendre();
    const cartes = [...container.querySelectorAll('[data-caption-carte]')];
    const chargees = cartes.filter((c) => c.getAttribute('data-caption-chargee') === 'oui');
    expect(chargees.length).toBeLessThanOrEqual(APERCUS_IMMEDIATS + 1);
    expect(cartes.length).toBeGreaterThan(chargees.length);
  });

  it('2.2 ⚠️ trente et un aperçus ne partent PAS d’un coup sur le réseau', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-captions-rayon="tout"]') as HTMLElement);
    expect(container.querySelectorAll('[data-caption-apercu]').length).toBeLessThanOrEqual(2);
  });

  it('2.3 survoler ou tabuler réveille une carte', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-captions-rayon="tout"]') as HTMLElement);
    const carte = container.querySelector('[data-caption-carte="challenge"]') as HTMLElement;
    expect(carte.getAttribute('data-caption-chargee')).toBe('non');
    fireEvent.mouseEnter(carte);
    expect((container.querySelector('[data-caption-carte="challenge"]') as HTMLElement)
      .getAttribute('data-caption-chargee')).toBe('oui');
  });

  it('2.4 l’adresse est déterministe et porte la version du moteur', () => {
    const a = adresseApercuCaption('karaoke', 'bas', '#FFFFFF', '#EC4899');
    expect(a).toBe(adresseApercuCaption('karaoke', 'bas', '#FFFFFF', '#EC4899'));
    expect(a).toContain(`v=${VERSION_CAPTIONS}`);
  });

  it('2.5 ⚠️ CHANGER L’ACCENT CHANGE L’APERÇU', () => {
    expect(adresseApercuCaption('karaoke', 'bas', '#FFFFFF', '#EC4899'))
      .not.toBe(adresseApercuCaption('karaoke', 'bas', '#FFFFFF', '#00FF00'));
    expect(adresseApercuCaption('karaoke', 'bas', '#FFFFFF', '#EC4899'))
      .not.toBe(adresseApercuCaption('karaoke', 'haut', '#FFFFFF', '#EC4899'));
  });

  it('2.6 l’identifiant est échappé — il ne fabrique pas un chemin', () => {
    expect(adresseApercuCaption('../../secret', 'bas', '#FFF000', '#000FFF'))
      .not.toContain('../');
  });

  it('2.7 la réponse est cachée longtemps, et en privé', () => {
    expect(ROUTE).toContain("'Cache-Control': 'private, max-age=86400, immutable'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. L’aperçu est le vrai moteur', () => {
  it('3.1 ⚠️ IL PASSE PAR `documentCaptions` ET PAR `libass`', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('documentCaptions(');
    expect(r).toContain('filtreSousTitres(');
    expect(r).toContain('cheminFfmpeg()');
  });

  it('3.2 aucune animation CSS ne remplace un filtre', () => {
    expect(sansProse(GRILLE)).not.toContain('@keyframes');
    expect(sansProse(GRILLE)).not.toMatch(/animationName|transition:\s*transform/);
  });

  it('3.3 ⚠️ UNE PHRASE DE DÉMONSTRATION, PAS LA TRANSCRIPTION', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('const DEMO');
    expect(r).not.toMatch(/preparerCaptions|lireTranscription/);
  });

  it('3.4 les trente et un styles sont prévisualisables', () => {
    // La route accepte chaque identifiant du catalogue.
    for (const id of CAPTION_IDS) expect(styleCaptionParId(id)).not.toBeNull();
    expect(CAPTION_IDS.length).toBe(31);
  });

  it('3.5 un style inconnu ne produit aucune commande', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('styleCaptionParId(params.styleId)');
    expect(r).toContain('status: 404');
  });

  it('3.6 les couleurs reçues sont validées avant d’entrer dans le document', () => {
    expect(sansProse(ROUTE)).toContain('/^#[0-9a-fA-F]{6}$/.test(v)');
  });

  it('3.7 aucun média tiers, et le dossier temporaire est nettoyé', () => {
    const r = sansProse(ROUTE);
    expect(r).not.toMatch(/https?:\/\//);
    expect(r).toContain('gradients=');
    expect(r).toContain('rm(dossier, { recursive: true, force: true })');
  });

  it('3.8 la commande part en TABLEAU, avec une laisse', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('spawn(cheminFfmpeg(), args)');
    expect(r).not.toMatch(/sh\s+-c|shell:\s*true/);
    expect(r).toContain("proc.kill('SIGKILL')");
  });

  it('3.9 la session est exigée', () => {
    expect(sansProse(ROUTE)).toContain('await auth()');
    expect(sansProse(ROUTE)).toContain('status: 401');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La bibliothèque personnelle', () => {
  it('4.1 les sous-titres sont la sixième famille', () => {
    expect([...FAMILLES_BIBLIOTHEQUE]).toContain('caption');
    expect(LIBELLES_FAMILLE.caption).toBe('Sous-titres');
    expect(idsFamille('caption')).toEqual(CAPTION_IDS);
    expect(FAVORIS_VIDES.caption).toEqual([]);
  });

  it('4.2 un favori de sous-titre est validé comme les autres', () => {
    expect(favorisValides(['karaoke', 'style-de-2027'], 'caption')).toEqual(['karaoke']);
  });

  it('4.3 ⚠️ LES RÉCENTS VIENNENT DES RENDUS RÉUSSIS', () => {
    expect(CLE_USAGE_PAR_FAMILLE.caption).toBe('captionStyleId');
    const r = recentsDepuisUsages([
      { creatif: { captionStyleId: 'fitness' } },
      { creatif: { captionStyleId: 'karaoke' } },
      { creatif: { captionStyleId: 'fitness' } },
    ]);
    expect(r.caption).toEqual(['fitness', 'karaoke']);
    // Et le moteur les écrit.
    expect(sansProse(lire('src/lib/autopilot/analyse/rendu.ts')))
      .toContain('captionStyleId: profil.captions.active');
  });

  it('4.4 la recherche globale les trouve, dans leur propre groupe', () => {
    const g = grouperResultats('karaoke');
    const groupe = g.find((x) => x.famille === 'caption');
    expect(groupe).toBeDefined();
    expect(groupe!.entrees.length).toBeGreaterThanOrEqual(4);
    expect(groupe!.libelle).toBe('Sous-titres');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Ce que la variation NE fait PAS', () => {
  it('5.1 ⚠️ LES SOUS-TITRES NE VARIENT PAS, ET C’EST ASSUMÉ', () => {
    /* Les faire varier obligerait à ajouter un champ à `StylePreset` — donc à
       refuser, en « tout ou rien », chaque preset personnel déjà enregistré.
       Et c'est un réglage de LISIBILITÉ, pas d'ambiance. */
    expect(sansProse(POLITIQUE)).toContain("f === 'caption'");
    expect(sansProse(POLITIQUE)).toContain('choixCourant.caption');
  });

  it('5.2 l’écran d’automatisation ne les propose pas', () => {
    expect(sansProse(AUTOMATISATION)).toContain('FAMILLES_VARIABLES');
    expect(sansProse(AUTOMATISATION)).toContain("f !== 'caption'");
  });

  it('5.3 aucun preset Studiio ne porte de sous-titre', async () => {
    const { PRESETS_STUDIIO } = await import('@/lib/creatif/presets');
    for (const p of PRESETS_STUDIIO) {
      expect(Object.keys(p.style)).not.toContain('captionStyleId');
    }
    expect(PRESETS_STUDIIO.length).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Dans « Mon style »', () => {
  it('6.1 une section « Sous-titres », éteinte par défaut', () => {
    expect(PANNEAU).toContain('Sous-titres');
    expect(PANNEAU).toContain('data-captions-actif');
    expect(PANNEAU).toContain('BibliothequeCaptions');
  });

  it('6.2 les quatre positions sont nommées en français', () => {
    expect(PANNEAU).toContain('LIBELLES_POSITION_CAPTION');
    expect(PANNEAU).toContain("'centre-bas': 'Bas centré'");
    expect(PANNEAU).toContain('data-captions-position');
  });

  it('6.3 l’aperçu de la grille suit les couleurs de la marque', () => {
    expect(PANNEAU).toContain('couleurTexte={brouillon.couleurs.texte');
    expect(PANNEAU).toContain('couleurAccent={brouillon.couleurs.accent');
  });

  it('6.4 les favoris de sous-titres passent par la bibliothèque persistante', () => {
    expect(PANNEAU).toContain("biblio.basculer('caption', id)");
    expect(PANNEAU).toContain('biblio.recents.caption');
  });
});
