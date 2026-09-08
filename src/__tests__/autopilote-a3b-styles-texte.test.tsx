/**
 * A_3b — LA BIBLIOTHÈQUE DE STYLES DE TEXTE.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE LOT CHANGE
 * ---------------------------------------------------------------------------
 *
 * Il fallait choisir une police, puis une graisse, puis une taille, puis une
 * ombre — c'est-à-dire reconstruire un style à chaque vidéo. Il y a
 * désormais vingt-six styles prêts, et le choix de typographie tient en un
 * clic.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : qu'aucun style ne promette ce
 * que `drawtext` ne sait pas faire. Chaque champ est adossé à une option
 * réelle — `borderw`, `box`, `shadowx/y`, `fontsize`, `fontfile` — et un
 * style qui annoncerait un dégradé ou un arrondi serait une carte morte,
 * découverte à l'ouverture du MP4.
 *
 * Et que le style par défaut reproduise EXACTEMENT le rendu d'avant : livrer
 * une bibliothèque ne doit changer aucune vidéo existante.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STYLES_TEXTE, STYLE_TEXTE_IDS, STYLE_TEXTE_DEFAUT, styleTexteParId,
  VERSION_STYLES_TEXTE,
} from '@/lib/creatif/styles-texte';
import {
  preparerCouches, filtreDrawtext, empreinteCouches, HABILLAGE_HISTORIQUE,
  type SourcesTexte,
} from '@/lib/autopilot/analyse/rendu-texte';
import { normaliserProfilCreatif } from '@/lib/autopilot/analyse/profil-creatif';
import { CATEGORIES_CREATIVES } from '@/lib/creatif/catalogue-contrat';

const BibliothequeStylesTexte = (await import('@/components/creer/BibliothequeStylesTexte')).default;
const { apparenceStyle } = await import('@/components/creer/BibliothequeStylesTexte');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const CATALOGUE = lire('src/lib/creatif/styles-texte.ts');
const GRILLE = lire('src/components/creer/BibliothequeStylesTexte.tsx');

const sources = (styleTexteId: string | null, o: Partial<SourcesTexte> = {}): SourcesTexte => ({
  profil: {
    typographie: {
      policeTitreId: 'anton', policeTexteId: 'poppins', graisse: 'normale', styleTexteId,
    },
    couleurs: { primaire: '#7c3aed', accent: '#ec4899', texte: '#ffffff' },
    texte: {
      actif: true, titre: 'Bouge. Danse.', sousTitre: null, libre: null,
      position: 'bas', debutSecondes: 0, dureeSecondes: 3,
    },
    ctaVisuel: { actif: false, dureeSecondes: 3, position: 'bas' },
  },
  appelAction: null,
  dureeTotaleSecondes: 30,
  ...o,
});

const filtre = (habillage: Parameters<typeof filtreDrawtext>[0]['habillage']) => filtreDrawtext({
  fichierTexte: '/tmp/t.txt', fichierPolice: '/f.ttf', taillePx: 40,
  couleur: '#ffffff', y: 100, debutSecondes: 0, finSecondes: 3, habillage,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le catalogue est réel', () => {
  it('1.1 vingt-six styles, identifiants uniques', () => {
    expect(STYLES_TEXTE.length).toBe(26);
    expect(new Set(STYLE_TEXTE_IDS).size).toBe(STYLE_TEXTE_IDS.length);
  });

  it('1.2 chaque champ est une option que `drawtext` sait produire', () => {
    /* ⚠️ AUCUNE PROMESSE HORS MOTEUR. Un dégradé, un arrondi, une rotation
       n'existent pas dans `drawtext` : les proposer ferait des cartes
       mortes, découvertes à l'ouverture du MP4. */
    for (const st of STYLES_TEXTE) {
      expect(['sans', 'serif', 'mono'], st.id).toContain(st.police);
      expect(['normale', 'grasse'], st.id).toContain(st.graisse);
      expect(['normale', 'majuscules'], st.id).toContain(st.casse);
      expect(st.echelle, st.id).toBeGreaterThanOrEqual(0.7);
      expect(st.echelle, st.id).toBeLessThanOrEqual(1.6);
      for (const aide of [st.contour, st.ombre, st.fond]) {
        if (aide) expect(['noir', 'blanc'], st.id).toContain(aide.teinte);
      }
    }
  });

  it('1.3 aucun style n’impose une couleur de marque', () => {
    /* La couleur vient du profil : un catalogue qui la repeindrait ferait
       perdre son identité au compte pour un choix de forme. */
    for (const st of STYLES_TEXTE) {
      expect(JSON.stringify(st), st.id).not.toMatch(/#[0-9a-f]{6}/i);
    }
  });

  it('1.4 les catégories sont celles du contrat commun', () => {
    for (const st of STYLES_TEXTE) {
      expect(CATEGORIES_CREATIVES, st.id).toContain(st.categorie);
      expect(st.famille).toBe('style-texte');
      expect(st.rendu).toBe(true);
      expect(st.version).toBe(VERSION_STYLES_TEXTE);
    }
  });

  it('1.5 un identifiant inconnu retombe sur le défaut, sans erreur', () => {
    for (const v of ['inexistant', '', null, 42, {}]) {
      expect(styleTexteParId(v as never).id, String(v)).toBe('defaut');
    }
    expect(STYLE_TEXTE_DEFAUT.id).toBe('defaut');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le défaut ne change RIEN au rendu d’avant', () => {
  it('2.1 le style par défaut porte exactement l’habillage historique', () => {
    /* ⚠️ LA GARANTIE QUI PERMET DE LIVRER. Un compte qui n'a jamais ouvert
       la bibliothèque ne doit voir aucune de ses vidéos changer. */
    expect(STYLE_TEXTE_DEFAUT.ombre).toEqual(HABILLAGE_HISTORIQUE.ombre);
    expect(STYLE_TEXTE_DEFAUT.contour).toBeNull();
    expect(STYLE_TEXTE_DEFAUT.fond).toBeNull();
    expect(STYLE_TEXTE_DEFAUT.echelle).toBe(1);
    expect(STYLE_TEXTE_DEFAUT.casse).toBe('normale');
  });

  it('2.2 sans style choisi, le filtre est celui d’avant, à la lettre', () => {
    const avant = filtre(undefined);
    const avec = filtre({
      contour: null, ombre: STYLE_TEXTE_DEFAUT.ombre, fond: null,
    });
    expect(avec).toBe(avant);
    expect(avant).toContain('shadowcolor=0x000000@0.65');
    expect(avant).toContain('shadowx=2:shadowy=2');
    expect(avant).not.toContain('borderw');
    expect(avant).not.toContain('box=1');
  });

  it('2.3 le profil accepte l’absence de style', () => {
    const p = normaliserProfilCreatif({});
    expect(p.typographie.styleTexteId).toBeNull();
  });

  it('2.4 un identifiant inconnu est refusé à l’écriture', () => {
    const p = normaliserProfilCreatif({ typographie: { styleTexteId: 'pirate' } } as never);
    expect(p.typographie.styleTexteId).toBeNull();
  });

  it('2.5 un identifiant connu survit à la normalisation', () => {
    const p = normaliserProfilCreatif({ typographie: { styleTexteId: 'boxed' } } as never);
    expect(p.typographie.styleTexteId).toBe('boxed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le style atteint vraiment le filtre', () => {
  it('3.1 un contour émet `borderw` et sa couleur', () => {
    const f = filtre({ contour: { largeur: 4, teinte: 'noir' }, ombre: null, fond: null });
    expect(f).toContain('borderw=4');
    expect(f).toContain('bordercolor=0x000000');
  });

  it('3.2 un fond émet `box`, sa couleur et sa marge', () => {
    const f = filtre({ contour: null, ombre: null, fond: { opacite: 0.7, marge: 12, teinte: 'noir' } });
    expect(f).toContain('box=1');
    expect(f).toContain('boxcolor=0x000000@0.70');
    expect(f).toContain('boxborderw=12');
  });

  it('3.3 le blanc est une teinte d’aide, comme le noir', () => {
    const f = filtre({ contour: { largeur: 3, teinte: 'blanc' }, ombre: null, fond: null });
    expect(f).toContain('bordercolor=0xffffff');
  });

  it('3.4 aucun habillage : aucune option superflue', () => {
    const f = filtre({ contour: null, ombre: null, fond: null });
    for (const opt of ['borderw', 'shadowx', 'box=1']) expect(f, opt).not.toContain(opt);
  });

  it('3.5 les valeurs aberrantes sont bornées, pas transmises', () => {
    // Une opacité à 5 ou une marge négative sortiraient de ce que ffmpeg
    // accepte, et feraient échouer le rendu entier.
    const f = filtre({
      contour: { largeur: -3, teinte: 'noir' },
      ombre: { decalage: -1, opacite: 5, teinte: 'noir' },
      fond: { opacite: -2, marge: -8, teinte: 'noir' },
    });
    expect(f).toContain('borderw=0');
    expect(f).toContain('shadowx=0');
    expect(f).toContain('@1.00');
    expect(f).toContain('@0.00');
    expect(f).toContain('boxborderw=0');
  });

  it('3.6 la casse est appliquée au TEXTE, pas seulement à son apparence', () => {
    /* `drawtext` ne sait pas mettre en capitales : le fichier doit déjà
       l'être, sinon la carte promet une casse que la vidéo n'aura pas. */
    const c = preparerCouches(sources('bold-social'));
    expect(c[0].texte).toBe('BOUGE. DANSE.');
    expect(preparerCouches(sources('defaut'))[0].texte).toBe('Bouge. Danse.');
  });

  it('3.7 l’échelle multiplie la taille de base', () => {
    const base = preparerCouches(sources('defaut'))[0].taillePct;
    const grand = preparerCouches(sources('statement'))[0].taillePct;
    expect(grand).toBeCloseTo(base * 1.5, 6);
  });

  it('3.8 le style impose sa police, quel que soit l’ancien réglage', () => {
    // Le fixture demande « anton » ; le style « Éditorial » est serif.
    expect(preparerCouches(sources('editorial'))[0].police).toBe('serif');
    expect(preparerCouches(sources('machine'))[0].police).toBe('mono');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’identité du rendu suit le style', () => {
  it('4.1 changer de style change l’empreinte des couches', () => {
    const a = empreinteCouches(preparerCouches(sources('defaut')));
    const b = empreinteCouches(preparerCouches(sources('boxed')));
    expect(a).not.toBe(b);
  });

  it('4.2 le style entre dans le profil, donc dans l’identité du rendu', () => {
    /* `styleTexteId` vit dans `typographie`, que `profilCreatifCanonique`
       hache : deux styles donnent donc deux identités, et aucun ancien MP4
       n'est resservi pour un style nouveau. */
    const p = normaliserProfilCreatif({ typographie: { styleTexteId: 'boxed' } } as never);
    expect(JSON.stringify(p.typographie)).toContain('boxed');
  });

  it('4.3 l’habillage compte dans l’empreinte', () => {
    // Deux styles de même police et même taille mais d'habillage différent
    // ne doivent pas partager une identité.
    const a = empreinteCouches(preparerCouches(sources('contour-fin')));
    const b = empreinteCouches(preparerCouches(sources('defaut')));
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. L’aperçu traduit le contrat, il ne l’invente pas', () => {
  it('5.1 contour, ombre et fond se retrouvent en CSS', () => {
    const contour = apparenceStyle(styleTexteParId('bold-social'), '#ffffff');
    expect(contour.WebkitTextStroke).toContain('rgb(0,0,0)');
    const fond = apparenceStyle(styleTexteParId('boxed'), '#ffffff');
    expect(String(fond.backgroundColor)).toContain('rgba(0,0,0');
    const ombre = apparenceStyle(styleTexteParId('defaut'), '#ffffff');
    expect(String(ombre.textShadow)).toContain('rgba(0,0,0,0.65)');
  });

  it('5.2 la casse et la police suivent aussi', () => {
    expect(apparenceStyle(styleTexteParId('bold-social'), '#fff').textTransform)
      .toBe('uppercase');
    expect(String(apparenceStyle(styleTexteParId('machine'), '#fff').fontFamily))
      .toContain('Mono');
  });

  it('5.3 la couleur affichée est celle de la marque', () => {
    expect(apparenceStyle(styleTexteParId('defaut'), '#ec4899').color).toBe('#ec4899');
  });

  it('5.4 aucune promesse hors moteur dans l’aperçu', () => {
    /* Un dégradé ou un arrondi passeraient pour un réglage disponible. */
    for (const interdit of ['linear-gradient', 'borderRadius', 'rotate(', 'blur(']) {
      expect(GRILLE, interdit).not.toContain(interdit);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La grille', () => {
  const monter = (props: Record<string, unknown> = {}) => {
    const choisir = vi.fn();
    render(
      <BibliothequeStylesTexte styleActif={null} onChoisir={choisir} {...props} />,
    );
    return { choisir };
  };
  const cartes = () => Array.from(document.querySelectorAll('[data-style-carte]'))
    .map((e) => e.getAttribute('data-style-carte'));

  it('6.1 « Pour vous » n’étale pas les vingt-six', () => {
    monter();
    expect(cartes().length).toBeLessThanOrEqual(10);
    fireEvent.click(document.querySelector('[data-styles-rayon="tout"]')!);
    expect(cartes().length).toBe(STYLES_TEXTE.length);
  });

  it('6.2 la carte montre LE texte de la personne', () => {
    /* « Aa » ne dit rien : ni la casse, ni la longueur, ni ce que le style
       fait d'une vraie phrase. */
    monter({ exemple: 'Bouge. Danse.' });
    expect(document.querySelector('[data-style-apercu]')?.textContent).toBe('Bouge. Danse.');
  });

  it('6.3 sans accroche saisie, un exemple court — jamais un alphabet', () => {
    monter();
    const t = document.querySelector('[data-style-apercu]')?.textContent ?? '';
    expect(t.length).toBeGreaterThan(3);
    expect(t).not.toBe('Aa');
  });

  it('6.4 la recherche trouve par tag', () => {
    monter();
    fireEvent.change(document.querySelector('[data-styles-recherche]')!,
      { target: { value: 'fond' } });
    expect(cartes().length).toBeGreaterThan(0);
    for (const id of cartes()) expect(styleTexteParId(id!).fond, id!).not.toBeNull();
  });

  it('6.5 choisir remonte l’identifiant', () => {
    const { choisir } = monter();
    fireEvent.click(document.querySelector('[data-styles-rayon="tout"]')!);
    fireEvent.click(document.querySelector('[data-style-carte="elegant"]')!);
    expect(choisir).toHaveBeenCalledWith('elegant');
  });

  it('6.6 sans style choisi, c’est « Standard » qui est marqué', () => {
    // Sinon rien ne paraît sélectionné alors qu'un rendu est bien en place.
    monter({ styleActif: null });
    expect(document.querySelector('[data-style-carte="defaut"]')
      ?.getAttribute('aria-pressed')).toBe('true');
  });

  it('6.7 chaque carte est nommée pour un lecteur d’écran', () => {
    monter();
    const c = document.querySelector('[data-style-carte]')!;
    expect(c.getAttribute('aria-label')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Ce que ce lot n’a pas touché', () => {
  it('7.1 le moteur éditorial et l’audio sont intacts', () => {
    expect(lire('src/lib/autopilot/analyse/coupe-contrat.ts')).toContain("'m3e-v4'");
    expect(lire('src/lib/autopilot/analyse/rendu.ts')).toContain('couperSilenceInitialMusique');
  });

  it('7.2 la bibliothèque de looks n’a pas bougé', () => {
    expect(lire('src/lib/creatif/looks.ts')).toContain('VERSION_LOOKS');
    expect(lire('src/lib/autopilot/analyse/rendu.ts')).toContain('resoudreLut(profil?.lut ?? null)');
  });

  it('7.3 le catalogue ne rend rien lui-même', () => {
    expect(CATALOGUE).not.toContain('drawtext=');
    expect(CATALOGUE).not.toContain('ffmpeg');
  });
});
