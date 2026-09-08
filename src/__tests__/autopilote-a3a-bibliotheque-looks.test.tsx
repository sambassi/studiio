/**
 * A_3a — LA BIBLIOTHÈQUE DE LOOKS.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE LOT CHANGE
 * ---------------------------------------------------------------------------
 *
 * Quatre looks, présentés par quatre boutons de texte. Quatre noms ne disent
 * rien de ce qu'un look FAIT, et quatre choix ne ressemblent pas à un studio.
 * Il y en a trente-quatre, rangés, cherchables, et chacun montre sa propre
 * vignette — calculée par le moteur, sur le rush de la personne.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : qu'aucune carte ne mente. Une
 * vignette approchée en CSS montrerait un look que la vidéo ne produira pas,
 * et chaque écart passerait pour un bug. Et un look sans `.cube` serait une
 * carte cliquable qui ne change rien — pire qu'une absence, parce qu'elle se
 * découvre après le rendu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  LOOKS_CREATIFS, LOOK_IDS, lookParId, VERSION_LOOKS,
} from '@/lib/creatif/looks';
import {
  chercher, trierEntrees, normaliserRecherche,
  CATEGORIES_CREATIVES, FAMILLES_CREATIVES,
} from '@/lib/creatif/catalogue-contrat';
import { LUTS_AUTORISEES } from '@/lib/autopilot/analyse/catalogues-creatifs';
import { resoudreLut } from '@/lib/autopilot/analyse/rendu-lut';

const BibliothequeLooks = (await import('@/components/creer/BibliothequeLooks')).default;

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const GRILLE = lire('src/components/creer/BibliothequeLooks.tsx');
const ROUTE = lire('src/app/api/creatif/looks/[lutId]/apercu/route.ts');

function monter(props: Record<string, unknown> = {}) {
  const choisir = vi.fn();
  const favori = vi.fn();
  render(
    <BibliothequeLooks
      lookActif="neutral"
      onChoisir={choisir}
      onBasculerFavori={favori}
      {...props}
    />,
  );
  return { choisir, favori };
}

const cartes = () => Array.from(document.querySelectorAll('[data-look-carte]'))
  .map((e) => e.getAttribute('data-look-carte'));
const rayon = (c: string) => fireEvent.click(document.querySelector(`[data-looks-rayon="${c}"]`)!);
const chercherDans = (q: string) => fireEvent.change(
  document.querySelector('[data-looks-recherche]')!, { target: { value: q } },
);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le catalogue est réel, pas décoratif', () => {
  it('1.1 trente-quatre looks, chacun avec son fichier', () => {
    expect(LOOKS_CREATIFS.length).toBe(34);
    for (const l of LOOKS_CREATIFS) {
      if (l.id === 'neutral') { expect(l.fichier).toBeNull(); continue; }
      expect(l.fichier, l.id).not.toBeNull();
      expect(existsSync(path.join(process.cwd(), 'public/luts', l.fichier!)), l.id).toBe(true);
    }
  });

  it('1.2 aucun `.cube` orphelin, aucune entrée sans fichier', () => {
    /* ⚠️ LES DEUX SENS COMPTENT. Une entrée sans fichier est une carte qui
       ment ; un fichier sans entrée est du poids mort dans l'image Docker. */
    const surDisque = readdirSync(path.join(process.cwd(), 'public/luts'))
      .filter((f) => f.endsWith('.cube')).sort();
    const attendus = LOOKS_CREATIFS
      .map((l) => l.fichier).filter((f): f is string => f !== null).sort();
    expect(surDisque).toEqual(attendus);
  });

  it('1.3 les identifiants sont uniques', () => {
    expect(new Set(LOOK_IDS).size).toBe(LOOK_IDS.length);
  });

  it('1.4 chaque look est réellement rendable par le moteur', () => {
    for (const l of LOOKS_CREATIFS) {
      const r = resoudreLut({ active: true, lutId: l.id, intensite: 1 });
      if (l.id === 'neutral') {
        // « Aucun look » s'abstient : c'est un choix, pas un échec.
        expect(r.sorte).toBe('aucune');
        continue;
      }
      expect(r.sorte, l.id).toBe('appliquee');
    }
  });

  it('1.5 toutes les catégories déclarées existent, et portent du monde', () => {
    for (const l of LOOKS_CREATIFS) {
      expect(CATEGORIES_CREATIVES, l.id).toContain(l.categorie);
      expect(l.famille).toBe('lut');
      expect(FAMILLES_CREATIVES).toContain(l.famille);
    }
    for (const c of CATEGORIES_CREATIVES) {
      expect(LOOKS_CREATIFS.filter((l) => l.categorie === c).length, c)
        .toBeGreaterThan(0);
    }
  });

  it('1.6 chacun porte une version — sans quoi un rendu d’hier mentirait', () => {
    expect(VERSION_LOOKS).toBe('look-v1');
    for (const l of LOOKS_CREATIFS) expect(l.version, l.id).toBe(VERSION_LOOKS);
  });

  it('1.7 le profil accepte tous les looks du catalogue', () => {
    /* Deux listes divergeraient : l'écran proposerait un look que le
       validateur du profil refuserait, sans que rien ne le dise. */
    expect(LUTS_AUTORISEES.map((l) => l.id)).toEqual(LOOK_IDS);
  });

  it('1.8 les quatre looks d’avant ce lot n’ont pas bougé', () => {
    // Changer leur `.cube` changerait le rendu de tous les comptes qui les
    // utilisent, sans que personne ne l'ait demandé.
    for (const id of ['clean', 'vibrant', 'cinema-warm', 'cinema-cool']) {
      expect(lookParId(id), id).toBeDefined();
      expect(lookParId(id)!.fichier).toBe(`${id}.cube`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Chercher, ranger', () => {
  it('2.1 « cinema » trouve « Cinéma » — les accents ne bloquent pas', () => {
    /* ⚠️ C'EST LE PREMIER MOT QU'ON TAPE, et c'était le premier échec
       possible : « cinema » sans accent ne trouvait rien. */
    expect(normaliserRecherche('Cinéma')).toBe('cinema');
    const r = chercher(LOOKS_CREATIFS, 'cinema');
    expect(r.length).toBeGreaterThan(4);
    expect(r.some((l) => l.id === 'cinema-warm')).toBe(true);
  });

  it('2.2 la recherche porte aussi sur les tags', () => {
    expect(chercher(LOOKS_CREATIFS, 'sport').some((l) => l.id === 'energie')).toBe(true);
    expect(chercher(LOOKS_CREATIFS, 'visage').every((l) => l.categorie === 'portrait')).toBe(true);
    expect(chercher(LOOKS_CREATIFS, 'monochrome').map((l) => l.id)).toEqual(['noir']);
  });

  it('2.3 deux mots restreignent, ils n’élargissent pas', () => {
    const un = chercher(LOOKS_CREATIFS, 'cinema');
    const deux = chercher(LOOKS_CREATIFS, 'cinema chaud');
    expect(deux.length).toBeLessThan(un.length);
    expect(deux.length).toBeGreaterThan(0);
  });

  it('2.4 une requête vide rend tout', () => {
    // Vider sa saisie ne doit pas donner l'impression d'avoir tout cassé.
    expect(chercher(LOOKS_CREATIFS, '')).toHaveLength(LOOKS_CREATIFS.length);
    expect(chercher(LOOKS_CREATIFS, '   ')).toHaveLength(LOOKS_CREATIFS.length);
  });

  it('2.5 l’ordre est déterministe : catégorie, puis nom', () => {
    const a = trierEntrees(LOOKS_CREATIFS).map((l) => l.id);
    const b = trierEntrees([...LOOKS_CREATIFS].reverse()).map((l) => l.id);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La grille', () => {
  it('3.1 « Pour vous » ne montre pas les trente-quatre d’un coup', () => {
    /* Trente-quatre vignettes d'entrée seraient un mur, pas une
       bibliothèque. Douze, puis « Tout » pour qui veut fouiller. */
    monter();
    expect(cartes().length).toBeLessThanOrEqual(12);
    rayon('tout');
    expect(cartes().length).toBe(LOOKS_CREATIFS.length);
  });

  it('3.2 chaque rayon filtre sur sa catégorie', () => {
    monter();
    rayon('portrait');
    const ids = cartes();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(lookParId(id!)!.categorie, id!).toBe('portrait');
  });

  it('3.3 la recherche ignore le rayon en cours', () => {
    /* Chercher « nuit » depuis « Portrait » et ne rien trouver donnerait
       l'impression que le look n'existe pas. */
    monter();
    rayon('portrait');
    chercherDans('nuit');
    expect(cartes()).toContain('nuit');
  });

  it('3.4 une recherche sans résultat le DIT', () => {
    monter();
    chercherDans('xyzzy');
    expect(cartes()).toHaveLength(0);
    expect(document.querySelector('[data-looks-vide]')).not.toBeNull();
  });

  it('3.5 choisir remonte l’identifiant', () => {
    const { choisir } = monter();
    rayon('tout');
    fireEvent.click(document.querySelector('[data-look-carte="noir"]')!);
    expect(choisir).toHaveBeenCalledWith('noir');
  });

  it('3.6 le look actif est marqué pour un lecteur d’écran', () => {
    monter({ lookActif: 'vintage' });
    rayon('tout');
    expect(document.querySelector('[data-look-carte="vintage"]')
      ?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-look-carte="noir"]')
      ?.getAttribute('aria-pressed')).toBe('false');
  });

  it('3.7 chaque carte est nommée, pas seulement colorée', () => {
    monter();
    const c = document.querySelector('[data-look-carte]')!;
    expect(c.getAttribute('aria-label')).toBeTruthy();
    expect(c.getAttribute('title')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Favoris et récents', () => {
  it('4.1 le rayon Favoris n’apparaît qu’une fois qu’il y en a', () => {
    monter();
    expect(document.querySelector('[data-looks-rayon="favoris"]')).toBeNull();
    cleanup();
    monter({ favoris: ['noir'] });
    expect(document.querySelector('[data-looks-rayon="favoris"]')).not.toBeNull();
  });

  it('4.2 les favoris se retrouvent dans leur rayon', () => {
    monter({ favoris: ['noir', 'vintage'] });
    rayon('favoris');
    expect(cartes().sort()).toEqual(['noir', 'vintage']);
  });

  it('4.3 basculer un favori remonte l’identifiant', () => {
    const { favori } = monter();
    fireEvent.click(document.querySelector('[data-look-favori]')!);
    expect(favori).toHaveBeenCalledTimes(1);
  });

  it('4.4 les récents gardent leur ordre — c’est l’information', () => {
    monter({ recents: ['vintage', 'noir', 'ete'] });
    rayon('recents');
    expect(cartes()).toEqual(['vintage', 'noir', 'ete']);
  });

  it('4.5 « Pour vous » part des favoris, puis des récents', () => {
    /* ⚠️ AUCUN MODÈLE, AUCUNE DEVINETTE : une règle déterministe, qu'on peut
       expliquer à la personne dont on range les affaires. */
    monter({ favoris: ['neon'], recents: ['vintage'] });
    const vus = cartes();
    expect(vus[0]).toBe('neon');
    expect(vus[1]).toBe('vintage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Les aperçus ne mentent pas', () => {
  it('5.1 aucune approximation CSS', () => {
    /* `filter: saturate(1.3)` coûte trois lignes et ment : le navigateur ne
       connaît ni `lut3d`, ni l'interpolation tétraédrique. */
    for (const interdit of ['filter:', 'saturate(', 'sepia(', 'contrast(']) {
      expect(sansProse(GRILLE), interdit).not.toContain(interdit);
    }
  });

  it('5.2 chaque vignette vient de la route du moteur', () => {
    monter();
    const img = document.querySelector('[data-look-apercu]');
    expect(img?.getAttribute('src')).toMatch(/^\/api\/creatif\/looks\/[a-z-]+\/apercu/);
  });

  it('5.3 la route applique LE fichier du rendu, avec le MÊME filtre', () => {
    expect(ROUTE).toContain('resoudreLut(');
    expect(ROUTE).toContain("lut3d=file='${issue.lut.chemin}':interp=tetrahedral");
  });

  it('5.4 « Sans look » n’appelle rien : il n’y a rien à calculer', () => {
    monter();
    rayon('tout');
    const neutre = document.querySelector('[data-look-carte="neutral"]')!;
    expect(neutre.querySelector('[data-look-neutre]')).not.toBeNull();
    expect(neutre.querySelector('[data-look-apercu]')).toBeNull();
  });

  it('5.5 l’aperçu suit le rush choisi', () => {
    // « Comment MON image réagit », et non « comment une photo
    // d'illustration réagirait ».
    monter({ analyseApercuId: 'a-1' });
    expect(document.querySelector('[data-look-apercu]')?.getAttribute('src'))
      .toContain('?analyse=a-1');
  });

  it('5.6 les images sont paresseuses — pas trente-quatre requêtes d’entrée', () => {
    monter();
    rayon('tout');
    const imgs = Array.from(document.querySelectorAll('[data-look-apercu]'));
    expect(imgs.length).toBeGreaterThan(20);
    for (const i of imgs) expect(i.getAttribute('loading')).toBe('lazy');
  });

  it('5.7 la route ne sert que ce qui appartient à la personne', () => {
    /* La propriété est vérifiée par `resoudreVignette`, le même contrôle que
       la route des vignettes — et non une seconde lecture qui pourrait en
       oublier une moitié. */
    expect(ROUTE).toContain('await auth()');
    expect(ROUTE).toContain('resoudreVignette(userId, analyseId, 0)');
    // Aucun média tiers : la mire de repli est fabriquée par ffmpeg.
    expect(ROUTE).toContain('smptebars');
    expect(sansProse(ROUTE)).not.toContain('http');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Ce que ce lot n’a pas touché', () => {
  it('6.1 le moteur de rendu est intact', () => {
    const rendu = lire('src/lib/autopilot/analyse/rendu.ts');
    expect(rendu).toContain('resoudreLut(profil?.lut ?? null)');
    expect(rendu).toContain('couperSilenceInitialMusique');
    expect(rendu).toContain('preparerCouches({');
    expect(lire('src/lib/autopilot/analyse/coupe-contrat.ts')).toContain("'m3e-v4'");
  });

  it('6.2 la bibliothèque ne rend aucun effet elle-même', () => {
    // Elle NOMME et MONTRE ; c'est le moteur qui produit.
    expect(sansProse(GRILLE)).not.toContain('lut3d=');
    expect(sansProse(GRILLE)).not.toContain('ffmpeg');
  });
});
