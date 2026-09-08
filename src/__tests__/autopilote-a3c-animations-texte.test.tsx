/**
 * A_3c1 — LES ANIMATIONS DE TEXTE, RÉELLEMENT RENDUES.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE LOT CHANGE
 * ---------------------------------------------------------------------------
 *
 * Le texte apparaissait d'un coup et disparaissait de même : un `drawtext`
 * statique, allumé par `enable`. Le profil portait bien `animations.texteId`,
 * validé et persisté — et consommé par personne, comme les textes avant A_1.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : que le mouvement soit RÉEL. Les
 * trois leviers ont été mesurés sur ce binaire avant d'être utilisés, et les
 * tests mesurent la POSITION et la TAILLE, pas seulement l'intensité.
 *
 * ⚠️ ET LA PREMIÈRE MESURE ÉTAIT FAUSSE : comparer la luminance MOYENNE ne
 * détecte pas un déplacement — un texte qui glisse a exactement la même
 * moyenne. Il a fallu mesurer le barycentre vertical. C'est pour ça que ces
 * tests ne se contentent jamais d'une moyenne.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ANIMATIONS_TEXTE, ANIMATION_TEXTE_IDS, ANIMATION_TEXTE_DEFAUT,
  animationTexteParId, expressionsAnimation, VERSION_ANIMATIONS_TEXTE,
  TYPES_ANIMATION,
} from '@/lib/creatif/animations-texte';
import { CATEGORIES_CREATIVES } from '@/lib/creatif/catalogue-contrat';
import {
  preparerCouches, filtreDrawtext, empreinteCouches, type SourcesTexte,
} from '@/lib/autopilot/analyse/rendu-texte';
import { normaliserProfilCreatif } from '@/lib/autopilot/analyse/profil-creatif';

const Bibliotheque = (await import('@/components/creer/BibliothequeAnimationsTexte')).default;
const { imagesClesGeste } = await import('@/components/creer/BibliothequeAnimationsTexte');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const MOTEUR = lire('src/lib/creatif/animations-texte.ts');
const GRILLE = lire('src/components/creer/BibliothequeAnimationsTexte.tsx');

const ctx = {
  debutSecondes: 0, finSecondes: 4, taillePx: 48,
  largeurCadre: 1080, hauteurCadre: 1920, y: 1200,
};

const sources = (texteId: string | null): SourcesTexte => ({
  profil: {
    typographie: {
      policeTitreId: null, policeTexteId: null, graisse: 'grasse', styleTexteId: null,
    },
    couleurs: { primaire: null, accent: null, texte: '#ffffff' },
    texte: {
      actif: true, titre: 'Bouge', sousTitre: null, libre: null,
      position: 'bas', debutSecondes: 0, dureeSecondes: 4,
    },
    ctaVisuel: { actif: false, dureeSecondes: 3, position: 'bas' },
    animations: { texteId },
  },
  appelAction: null,
  dureeTotaleSecondes: 30,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le catalogue', () => {
  it('1.1 dix-neuf animations, dont dix-huit qui bougent', () => {
    expect(ANIMATIONS_TEXTE.length).toBe(19);
    const qui_bougent = ANIMATIONS_TEXTE.filter((a) => a.id !== 'aucune');
    expect(qui_bougent.length).toBe(18);
    expect(new Set(ANIMATION_TEXTE_IDS).size).toBe(ANIMATION_TEXTE_IDS.length);
  });

  it('1.2 aucune carte morte : chacune produit au moins une expression', () => {
    /* ⚠️ LE TEST QUI INTERDIT DE GONFLER LE CHIFFRE. Une animation qui ne
       produirait aucune expression serait une carte cliquable qui ne change
       rien — découverte à l'ouverture du MP4. */
    for (const a of ANIMATIONS_TEXTE) {
      const e = expressionsAnimation(a, ctx);
      const bouge = e.alpha !== null || e.x !== null || e.y !== null || e.fontsize !== null;
      if (a.id === 'aucune') {
        expect(bouge, a.id).toBe(false);
        continue;
      }
      expect(bouge, `${a.id} ne produit aucune expression`).toBe(true);
    }
  });

  it('1.3 catégories, familles et versions viennent du contrat commun', () => {
    for (const a of ANIMATIONS_TEXTE) {
      expect(CATEGORIES_CREATIVES, a.id).toContain(a.categorie);
      expect(a.famille).toBe('animation-texte');
      expect(TYPES_ANIMATION, a.id).toContain(a.type);
      expect(a.rendu).toBe(true);
      expect(a.version).toBe(VERSION_ANIMATIONS_TEXTE);
    }
  });

  it('1.4 un identifiant inconnu retombe sur « Aucune »', () => {
    for (const v of ['inexistant', '', null, 42]) {
      expect(animationTexteParId(v as never).id, String(v)).toBe('aucune');
    }
    expect(ANIMATION_TEXTE_DEFAUT.id).toBe('aucune');
  });

  it('1.5 les anciens identifiants décoratifs retombent aussi sur « Aucune »', () => {
    /* ⚠️ AUCUNE VIDÉO NE CHANGE EN SILENCE. `fade`, `slide-up`, `pop`… ne
       rendaient RIEN avant ce lot : les remapper vers les nouvelles
       animations aurait animé des vidéos que personne n'a demandé d'animer. */
    for (const ancien of ['none', 'fade', 'slide-up', 'scale', 'bounce-soft']) {
      expect(animationTexteParId(ancien).id, ancien).toBe('aucune');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le temps est local et borné', () => {
  it('2.1 les expressions partent du DÉBUT de la couche, pas du montage', () => {
    const e = expressionsAnimation(animationTexteParId('fondu-entree'),
      { ...ctx, debutSecondes: 12, finSecondes: 16 });
    expect(e.alpha).toContain('t-12.000');
  });

  it('2.2 elles sont saturées : jamais avant, jamais après', () => {
    /* Sans `min`/`max`, une expression continuerait de croître hors de la
       fenêtre — `enable` le cacherait, mais le texte sauterait au moment où
       il s'allume. */
    const e = expressionsAnimation(animationTexteParId('glisse-haut'), ctx);
    expect(e.y).toContain('min(1,max(0,');
  });

  it('2.3 une entrée plus longue que la couche est raccourcie', () => {
    // Sinon l'animation n'aurait jamais le temps de finir : le texte
    // resterait à mi-chemin puis disparaîtrait.
    const e = expressionsAnimation(animationTexteParId('fondu-lent'),
      { ...ctx, debutSecondes: 0, finSecondes: 1 });
    expect(e.alpha).toContain('/0.500');
  });

  it('2.4 « Aucune » ne produit rien du tout', () => {
    expect(expressionsAnimation(animationTexteParId('aucune'), ctx))
      .toEqual({ alpha: null, x: null, y: null, fontsize: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La position finale reste celle des marges sûres', () => {
  it('3.1 le décalage est un état de DÉPART, ramené à zéro', () => {
    /* ⚠️ UNE ANIMATION NE PEUT PAS FINIR HORS DU CADRE, quelle que soit son
       amplitude : le terme de décalage est multiplié par `(1-u)`, donc nul
       à la fin. */
    const e = expressionsAnimation(animationTexteParId('glisse-haut'), ctx);
    expect(e.y).toContain(`${ctx.y.toFixed(3)}+`);
    expect(e.y).toContain('*(1-min(1,max(0,');
  });

  it('3.2 le déplacement est proportionnel au cadre, pas en pixels fixes', () => {
    /* Un déplacement de 500 px pensé pour 1080×1920 traverserait l'écran en
       16:9. */
    const vertical = expressionsAnimation(animationTexteParId('glisse-haut'), ctx);
    const horizontal = expressionsAnimation(animationTexteParId('glisse-haut'),
      { ...ctx, hauteurCadre: 1080 });
    expect(vertical.y).not.toBe(horizontal.y);
    expect(vertical.y).toContain('153.600');   // 8 % de 1920
    expect(horizontal.y).toContain('86.400');  // 8 % de 1080
  });

  it('3.3 le décalage horizontal reste centré autour du milieu', () => {
    const e = expressionsAnimation(animationTexteParId('glisse-gauche'), ctx);
    expect(e.x).toContain('(w-text_w)/2+');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le filtre reçoit les expressions, et remplace les constantes', () => {
  const filtre = (id: string) => filtreDrawtext({
    fichierTexte: '/tmp/t.txt', fichierPolice: '/f.ttf', taillePx: 48,
    couleur: '#ffffff', y: 1200, debutSecondes: 0, finSecondes: 4,
    animation: expressionsAnimation(animationTexteParId(id), ctx),
  });

  it('4.1 un fondu ajoute `alpha`', () => {
    expect(filtre('fondu-entree')).toContain("alpha='(0.000+");
  });

  it('4.2 une glisse remplace `y`, elle ne s’y ajoute pas', () => {
    /* ⚠️ ÉCRIRE LES DEUX FERAIT GAGNER LA DERNIÈRE OCCURRENCE : ça
       marcherait par accident, et casserait au premier réordonnancement. */
    const f = filtre('glisse-haut');
    expect(f).toContain("y='1200.000+");
    expect(f).not.toContain('y=1200:');
    expect((f.match(/(^|:)y=/g) ?? []).length).toBe(1);
  });

  it('4.3 un zoom remplace `fontsize`', () => {
    const f = filtre('zoom-avant');
    expect(f).toContain("fontsize=48.000*(");
    expect((f.match(/(^|:)fontsize=/g) ?? []).length).toBe(1);
  });

  it('4.4 sans animation, le filtre est exactement celui d’avant', () => {
    const avant = filtreDrawtext({
      fichierTexte: '/tmp/t.txt', fichierPolice: '/f.ttf', taillePx: 48,
      couleur: '#ffffff', y: 1200, debutSecondes: 0, finSecondes: 4,
    });
    expect(avant).toContain('x=(w-text_w)/2');
    expect(avant).toContain('y=1200');
    expect(avant).not.toContain('alpha=');
  });

  it('4.5 aucune expression ne vient du navigateur', () => {
    /* Le client n'envoie qu'un identifiant : une expression reçue serait un
       langage exécuté par ffmpeg sur nos machines. */
    expect(sansProse(MOTEUR)).not.toContain('expression:');
    expect(MOTEUR).toContain('animationTexteParId');
    const rendu = lire('src/lib/autopilot/analyse/rendu-style.ts');
    expect(rendu).toContain('expressionsAnimation(animationTexteParId(t.animationId)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le pop dépasse vraiment', () => {
  it('5.1 son échelle passe au-dessus de 1 avant de se poser', () => {
    /* MESURÉ SUR UN VRAI RENDU : largeur du texte 198 px à t=0, 282 px au
       pic, 264 px à l'arrivée. Le dépassement n'est pas une intention, c'est
       une bosse `sin` bornée qui retombe exactement à 1. */
    const e = expressionsAnimation(animationTexteParId('pop'), ctx);
    expect(e.fontsize).toContain('sin(PI*');
    expect(e.fontsize).toContain('0.180*');
  });

  it('5.2 les animations sans dépassement n’en ont pas', () => {
    expect(expressionsAnimation(animationTexteParId('zoom-avant'), ctx).fontsize)
      .not.toContain('sin(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. L’animation entre dans l’identité', () => {
  it('6.1 changer d’animation change l’empreinte des couches', () => {
    const a = empreinteCouches(preparerCouches(sources('aucune')));
    const b = empreinteCouches(preparerCouches(sources('pop')));
    expect(a).not.toBe(b);
  });

  it('6.2 l’identifiant est porté par chaque couche', () => {
    expect(preparerCouches(sources('pop'))[0].animationId).toBe('pop');
  });

  it('6.3 le profil valide, persiste et relit l’animation', () => {
    const p = normaliserProfilCreatif({ animations: { texteId: 'pop' } } as never);
    expect(p.animations.texteId).toBe('pop');
  });

  it('6.4 un identifiant inconnu est refusé à l’écriture', () => {
    const p = normaliserProfilCreatif({ animations: { texteId: 'pirate' } } as never);
    expect(p.animations.texteId).toBe('aucune');
  });

  it('6.5 sans animation, l’empreinte est celle d’avant', () => {
    // Une couche sans `animationId` ne doit rien ajouter à la chaîne hachée.
    const sans = preparerCouches(sources(null));
    expect(sans[0].animationId).toBe('aucune');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’aperçu dérive du même geste', () => {
  it('7.1 opacité, décalage et échelle viennent de la définition', () => {
    for (const a of ANIMATIONS_TEXTE) {
      const { depart, dureeMs } = imagesClesGeste(a);
      expect(depart.opacity, a.id).toBe(a.geste.alphaDepart);
      expect(String(depart.transform), a.id)
        .toContain(`scale(${a.geste.echelleDepart})`);
      expect(String(depart.transform), a.id)
        .toContain(`translate(${a.geste.decalageXPct}%, ${a.geste.decalageYPct}%)`);
      expect(dureeMs, a.id).toBeGreaterThanOrEqual(120);
    }
  });

  it('7.2 l’aperçu ne réécrit aucune règle à la main', () => {
    /* Une animation CSS écrite à part finirait par montrer un mouvement que
       le MP4 ne fait pas. */
    expect(GRILLE).toContain('imagesClesGeste');
    expect(GRILLE).toContain('anim.geste');
  });

  it('7.3 `prefers-reduced-motion` fige la carte, pas le rendu', () => {
    expect(GRILLE).toContain('prefers-reduced-motion');
    expect(GRILLE).toContain('animation: none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. La grille', () => {
  const monter = (props: Record<string, unknown> = {}) => {
    const choisir = vi.fn();
    render(<Bibliotheque animationActive={null} onChoisir={choisir} {...props} />);
    return { choisir };
  };
  const cartes = () => Array.from(document.querySelectorAll('[data-animation-carte]'))
    .map((e) => e.getAttribute('data-animation-carte'));

  it('8.1 « Pour vous » n’étale pas les dix-neuf', () => {
    monter();
    expect(cartes().length).toBeLessThanOrEqual(10);
    fireEvent.click(document.querySelector('[data-animations-rayon="tout"]')!);
    expect(cartes().length).toBe(ANIMATIONS_TEXTE.length);
  });

  it('8.2 la carte montre le texte de la personne', () => {
    monter({ exemple: 'Bouge avec nous' });
    expect(document.querySelector('[data-animation-apercu]')?.textContent)
      .toBe('Bouge avec nous');
  });

  it('8.3 la recherche trouve par tag', () => {
    monter();
    fireEvent.change(document.querySelector('[data-animations-recherche]')!,
      { target: { value: 'slide' } });
    expect(cartes().length).toBeGreaterThan(2);
  });

  it('8.4 choisir remonte l’identifiant', () => {
    const { choisir } = monter();
    fireEvent.click(document.querySelector('[data-animations-rayon="tout"]')!);
    fireEvent.click(document.querySelector('[data-animation-carte="pop"]')!);
    expect(choisir).toHaveBeenCalledWith('pop');
  });

  it('8.5 sans animation choisie, « Aucune » est marquée', () => {
    monter({ animationActive: null });
    expect(document.querySelector('[data-animation-carte="aucune"]')
      ?.getAttribute('aria-pressed')).toBe('true');
  });

  it('8.6 chaque carte est un vrai bouton, nommé', () => {
    monter();
    const c = document.querySelector('[data-animation-carte]')!;
    expect(c.tagName).toBe('BUTTON');
    expect(c.getAttribute('aria-label')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Ce que ce lot n’a pas touché', () => {
  it('9.1 les bibliothèques de looks et de styles sont intactes', () => {
    expect(lire('src/lib/creatif/looks.ts')).toContain('VERSION_LOOKS');
    expect(lire('src/lib/creatif/styles-texte.ts')).toContain('VERSION_STYLES_TEXTE');
  });

  it('9.2 le moteur éditorial, l’audio et la LUT n’ont pas bougé', () => {
    const rendu = lire('src/lib/autopilot/analyse/rendu.ts');
    expect(lire('src/lib/autopilot/analyse/coupe-contrat.ts')).toContain("'m3e-v4'");
    expect(rendu).toContain('couperSilenceInitialMusique');
    expect(rendu).toContain('resoudreLut(profil?.lut ?? null)');
  });

  it('9.3 l’animation n’redéfinit ni couleur, ni police, ni style', () => {
    // Elle anime la couche ; le branding reste au style et au profil.
    const code = sansProse(MOTEUR);
    for (const interdit of ['fontcolor', 'fontfile', 'borderw', 'boxcolor']) {
      expect(code, interdit).not.toContain(interdit);
    }
  });
});
