/**
 * A_3d2 — LA BIBLIOTHÈQUE DE TRANSITIONS, ET SES APERÇUS RÉELS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUE CES TESTS TIENNENT
 * ---------------------------------------------------------------------------
 *
 * Qu'une carte affichée corresponde à une transition que le moteur sait
 * produire, et que son aperçu sorte du MÊME ffmpeg avec le MÊME filtre. Un
 * `circleopen` ou un `pixelize` approchés en CSS montreraient un mouvement que
 * la vidéo ne fait pas — c'est exactement ce que ce lot refuse.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI UN GIF ET PAS UN WEBP
 * ---------------------------------------------------------------------------
 *
 * Le WebP animé pesait quatre fois moins (4 Ko contre 35), mais ffmpeg ne sait
 * pas le relire et `libwebp_anim` écrit des cadences fausses : sans `-r`,
 * 669 ms par image au lieu de 62 ; avec `-r`, plus aucune durée. Mesuré, pas
 * supposé. Le GIF se relit par ffmpeg comme par n'importe quel outil — c'est
 * ce qui rend ce chemin VÉRIFIABLE, et c'est ce qui a décidé.
 *
 * Mesures du chemin retenu, sur les deux images de démonstration :
 * 23 images, 36 à 80 Ko, ~50 ms par aperçu.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  TRANSITIONS_CREATIVES, TRANSITION_CREATIVE_IDS, VERSION_TRANSITIONS,
  XFADE_AUTORISES, transitionCreativeParId,
} from '@/lib/creatif/transitions';

const Bibliotheque = (await import('@/components/creer/BibliothequeTransitions')).default;
const { adresseApercu, APERCUS_IMMEDIATS } =
  await import('@/components/creer/BibliothequeTransitions');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const GRILLE = lire('src/components/creer/BibliothequeTransitions.tsx');
const ROUTE = lire('src/app/api/creatif/transitions/[transitionId]/apercu/route.ts');
const PANNEAU = lire('src/components/creer/MonStylePanel.tsx');
const STYLE = lire('src/lib/autopilot/analyse/rendu-style.ts');

afterEach(() => { cleanup(); });

const rendre = (actif: string | null = null, extra = {}) => render(
  <Bibliotheque transitionActive={actif} onChoisir={() => {}} {...extra} />,
);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La grille', () => {
  it('1.1 « Tout » montre les vingt-neuf, aucune carte morte', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-transitions-rayon="tout"]') as HTMLElement);
    const cartes = container.querySelectorAll('[data-transition-carte]');
    expect(cartes.length).toBe(TRANSITIONS_CREATIVES.length);
    expect(cartes.length).toBe(29);
  });

  it('1.2 la transition ACTIVE est la première de « Pour vous »', () => {
    const { container } = rendre('lamelles');
    const premiere = container.querySelector('[data-transition-carte]');
    expect(premiere?.getAttribute('data-transition-carte')).toBe('lamelles');
    expect(premiere?.getAttribute('aria-pressed')).toBe('true');
  });

  it('1.3 sans choix, « Coupe franche » est ce qui est montré comme actif', () => {
    const { container } = rendre(null);
    const carte = container.querySelector('[data-transition-carte="cut"]');
    expect(carte?.getAttribute('aria-pressed')).toBe('true');
  });

  it('1.4 la recherche marche en français, sans accent obligatoire', () => {
    const { container } = rendre();
    const champ = container.querySelector('[data-transitions-recherche]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: 'glisse gauche' } });
    const cartes = container.querySelectorAll('[data-transition-carte]');
    expect(cartes.length).toBe(1);
    expect(cartes[0].getAttribute('data-transition-carte')).toBe('glisse-gauche');
    fireEvent.change(champ, { target: { value: 'eloignement' } });
    expect(container.querySelectorAll('[data-transition-carte]').length).toBe(1);
  });

  it('1.5 une recherche sans résultat le dit', () => {
    const { container } = rendre();
    fireEvent.change(
      container.querySelector('[data-transitions-recherche]') as HTMLInputElement,
      { target: { value: 'zzzz' } },
    );
    expect(container.querySelector('[data-transitions-vide]')).not.toBeNull();
  });

  it('1.6 les rayons couvrent les catégories réellement présentes', () => {
    const { container } = rendre();
    for (const c of new Set(TRANSITIONS_CREATIVES.map((t) => t.categorie))) {
      const rayon = container.querySelector(`[data-transitions-rayon="${c}"]`) as HTMLElement;
      expect(rayon).not.toBeNull();
      fireEvent.click(rayon);
      const cartes = container.querySelectorAll('[data-transition-carte]');
      expect(cartes.length).toBeGreaterThan(0);
    }
  });

  it('1.7 favoris et récents ont leurs rayons, et le favori se bascule', () => {
    const bascules: string[] = [];
    const { container } = render(
      <Bibliotheque
        transitionActive={null}
        favoris={['pixels']}
        recents={['zoom-avant']}
        onBasculerFavori={(id) => bascules.push(id)}
        onChoisir={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-transitions-rayon="favoris"]') as HTMLElement);
    expect(container.querySelectorAll('[data-transition-carte]').length).toBe(1);
    fireEvent.click(container.querySelector('[data-transitions-rayon="recents"]') as HTMLElement);
    expect(container.querySelector('[data-transition-carte="zoom-avant"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-transition-favori="zoom-avant"]') as HTMLElement);
    expect(bascules).toEqual(['zoom-avant']);
  });

  it('1.8 choisir remonte l’identifiant ET le rythme naturel de la transition', () => {
    const choix: [string, number][] = [];
    const { container } = render(
      <Bibliotheque
        transitionActive={null}
        onChoisir={(id, ms) => choix.push([id, ms])}
      />,
    );
    fireEvent.click(container.querySelector('[data-transitions-rayon="tout"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-transition-carte="iris-noir"]') as HTMLElement);
    expect(choix[0][0]).toBe('iris-noir');
    expect(choix[0][1]).toBe(transitionCreativeParId('iris-noir')!.dureeDefautMs);
  });

  it('1.9 chaque carte est un bouton, atteignable au clavier et décrit', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-transitions-rayon="tout"]') as HTMLElement);
    const carte = container.querySelector('[data-transition-carte="fondu"]') as HTMLElement;
    expect(carte.tagName).toBe('BUTTON');
    expect(carte.getAttribute('aria-label')).toContain('Fondu enchaîné');
    expect(carte.getAttribute('title')).toBeTruthy();
  });

  it('1.10 aucun paramètre de moteur à l’écran', () => {
    const visible = GRILLE.match(/>[^<>{}]{4,}</g) ?? [];
    for (const t of visible) {
      expect(t).not.toMatch(/xfade|ffmpeg|filter_complex|offset|palettegen/i);
    }
    for (const nom of XFADE_AUTORISES) {
      for (const t of visible) expect(t.toLowerCase()).not.toContain(nom);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le chargement différé', () => {
  it('2.1 les six premières chargent, les autres attendent', () => {
    const { container } = rendre();
    const cartes = [...container.querySelectorAll('[data-transition-carte]')];
    const chargees = cartes.filter((c) => c.getAttribute('data-transition-chargee') === 'oui');
    // La carte active est toujours chargée : elle peut être au-delà du rang.
    expect(chargees.length).toBeLessThanOrEqual(APERCUS_IMMEDIATS + 1);
    expect(chargees.length).toBeGreaterThan(0);
    expect(cartes.length).toBeGreaterThan(chargees.length);
  });

  it('2.2 ⚠️ vingt-neuf aperçus ne partent PAS sur le réseau au premier affichage', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-transitions-rayon="tout"]') as HTMLElement);
    const images = container.querySelectorAll('[data-transition-apercu]');
    // Hors « Pour vous », seule la carte active charge.
    expect(images.length).toBeLessThanOrEqual(2);
  });

  it('2.3 survoler ou tabuler réveille une carte, et elle le reste', () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-transitions-rayon="tout"]') as HTMLElement);
    const carte = container.querySelector('[data-transition-carte="lamelles"]') as HTMLElement;
    expect(carte.getAttribute('data-transition-chargee')).toBe('non');
    fireEvent.mouseEnter(carte);
    expect(
      (container.querySelector('[data-transition-carte="lamelles"]') as HTMLElement)
        .getAttribute('data-transition-chargee'),
    ).toBe('oui');
    // Et le clavier fait la même chose que la souris.
    const autre = container.querySelector('[data-transition-carte="pixels"]') as HTMLElement;
    fireEvent.focus(autre);
    expect(
      (container.querySelector('[data-transition-carte="pixels"]') as HTMLElement)
        .getAttribute('data-transition-chargee'),
    ).toBe('oui');
  });

  it('2.4 l’image elle-même est différée par le navigateur', () => {
    const { container } = rendre();
    const img = container.querySelector('[data-transition-apercu]') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le cache des aperçus', () => {
  it('3.1 l’adresse est déterministe : deux fois la même demande, la même URL', () => {
    expect(adresseApercu('fondu', 500)).toBe(adresseApercu('fondu', 500));
  });

  it('3.2 elle porte la version du catalogue — une v2 ne resservira pas la v1', () => {
    expect(adresseApercu('fondu', 500)).toContain(`v=${VERSION_TRANSITIONS}`);
  });

  it('3.3 la durée en fait partie : le même effet plus lent est un autre aperçu', () => {
    expect(adresseApercu('fondu', 300)).not.toBe(adresseApercu('fondu', 700));
  });

  it('3.4 l’analyse en fait partie : deux comptes ne partagent pas une vignette', () => {
    expect(adresseApercu('fondu', 500, 'a1')).not.toBe(adresseApercu('fondu', 500, 'a2'));
    expect(adresseApercu('fondu', 500, null)).not.toContain('analyse');
  });

  it('3.5 l’identifiant est échappé — il ne peut pas fabriquer un chemin', () => {
    expect(adresseApercu('../../secret', 500)).not.toContain('../');
  });

  it('3.6 la réponse est cachée longtemps, et en privé', () => {
    expect(ROUTE).toContain("'Cache-Control': 'private, max-age=86400, immutable'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’aperçu est le vrai moteur', () => {
  it('4.1 il passe par le même ffmpeg que le rendu', () => {
    expect(sansProse(ROUTE)).toContain("from '@/lib/ffmpeg/binaires'");
    expect(sansProse(ROUTE)).toContain('cheminFfmpeg()');
  });

  it('4.2 ⚠️ il applique la MÊME règle par famille que `filtreTransition`', () => {
    const r = sansProse(ROUTE);
    // Un recouvrement pour les `xfade`…
    expect(r).toContain('xfade=transition=${tr.xfadeId}');
    // …et deux fondus internes puis un `concat` pour les historiques, ce qui
    // est justement leur différence visible.
    expect(r).toContain('fade=t=out:st=');
    expect(r).toContain('fade=t=in:st=0');
    expect(r).toContain('concat=n=2:v=1:a=0');
    // La même couleur que le moteur : noir pour l'un, blanc pour l'autre.
    expect(sansProse(STYLE)).toContain("crossfade: 'black'");
    expect(sansProse(STYLE)).toContain("flash: 'white'");
    expect(r).toContain("tr.id === 'flash' ? 'white' : 'black'");
  });

  it('4.3 aucune animation CSS ne remplace un filtre', () => {
    expect(sansProse(GRILLE)).not.toContain('@keyframes');
    expect(sansProse(GRILLE)).not.toMatch(/animationName|transition:\s*transform/);
  });

  it('4.4 les vingt-neuf sont toutes prévisualisables', () => {
    // La route accepte chaque identifiant du catalogue, et chacun tombe dans
    // l'une des trois familles qu'elle sait dessiner.
    for (const id of TRANSITION_CREATIVE_IDS) {
      const tr = transitionCreativeParId(id);
      expect(tr).not.toBeNull();
      expect(['xfade', 'fondu-couleur', 'coupe']).toContain(tr!.moteur);
    }
    expect(TRANSITION_CREATIVE_IDS.length).toBe(29);
  });

  it('4.5 aucun média tiers n’entre dans ce chemin', () => {
    const r = sansProse(ROUTE);
    expect(r).not.toMatch(/https?:\/\//);
    expect(r).toContain('gradients=');
    // Les deux dégradés sont aux couleurs de la marque.
    expect(r).toContain('0x7C3AED');
    expect(r).toContain('0x0A0A0F');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Rien d’arbitraire ne vient du navigateur', () => {
  it('5.1 un identifiant inconnu ne produit aucun nom de filtre', () => {
    expect(transitionCreativeParId('slideleft')).toBeNull();
    expect(transitionCreativeParId('../../etc/passwd')).toBeNull();
    expect(sansProse(ROUTE)).toContain('transitionCreativeParId(params.transitionId)');
    expect(sansProse(ROUTE)).toContain("status: 404");
  });

  it('5.2 la durée reçue est bornée avant d’entrer dans la commande', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('DUREE_TRANSITION_MAX_MS');
    expect(r).toContain('DUREE_TRANSITION_MIN_MS');
    expect(r).toContain('Number.isFinite(brut)');
  });

  it('5.3 la route exige une session, et la propriété est vérifiée par le service', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('await auth()');
    expect(r).toContain("status: 401");
    // L'identité de la session est ce qui atteint le service, sans détour.
    expect(r).toContain('vignettes(session.user.id');
    expect(r).toContain('resoudreVignette(userId, analyseId, rang)');
  });

  it('5.4 aucun message d’erreur ne peut porter un chemin', () => {
    expect(sansProse(ROUTE)).toContain("error: 'Aperçu indisponible'");
    expect(sansProse(ROUTE)).not.toMatch(/error:\s*String\(|e\.message/);
  });

  it('5.5 la commande part en TABLEAU, jamais par un shell', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('spawn(cheminFfmpeg(), args)');
    expect(r).not.toMatch(/sh\s+-c|shell:\s*true|execSync/);
  });

  it('5.6 le processus a une laisse : il ne peut pas tourner indéfiniment', () => {
    expect(sansProse(ROUTE)).toContain("proc.kill('SIGKILL')");
    expect(sansProse(ROUTE)).toContain('TIMEOUT_MS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Dans « Mon style »', () => {
  it('6.1 la bibliothèque a remplacé les trois boutons', () => {
    expect(PANNEAU).toContain('BibliothequeTransitions');
    expect(PANNEAU).not.toContain('TRANSITIONS_RENDUES');
    expect(PANNEAU).not.toContain('data-mon-style-transition=');
  });

  it('6.2 la vitesse se choisit par trois mots, pas par un curseur', () => {
    expect(PANNEAU).toContain('VITESSES_TRANSITION');
    expect(PANNEAU).toContain('Rapide');
    expect(PANNEAU).toContain('Doux');
    expect(PANNEAU).not.toContain('data-mon-style-transition-duree');
  });

  it('6.3 « Normal » vaut le rythme de la transition choisie, pas un nombre fixe', () => {
    expect(PANNEAU).toContain("{ libelle: 'Normal', ms: null }");
    expect(PANNEAU).toContain('dureeDefautMs');
  });

  it('6.4 choisir une transition écrit AUSSI sa durée dans le profil', () => {
    expect(PANNEAU).toContain('dureeMs: dureeDefautMs');
  });

  it('6.5 les transitions ont leurs propres favoris et récents', () => {
    expect(PANNEAU).toContain('favorisTransitions');
    expect(PANNEAU).toContain('recentsTransitions');
  });
});
