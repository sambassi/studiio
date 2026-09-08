/**
 * A_3e2 — LES PRESETS : UNE COMBINAISON, PAS UN EFFET DE PLUS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ
 * ---------------------------------------------------------------------------
 *
 * 1. Qu'aucun preset ne cite un effet qui n'existe pas. Un preset qui
 *    nommerait un identifiant futur s'appliquerait à moitié : la personne
 *    verrait « appliqué » et une image qui ne ressemble pas à sa vignette.
 *
 * 2. Qu'un preset NE TOUCHE PAS à la marque. Les couleurs, le logo, le texte
 *    du CTA et le lien appartiennent au compte, pas au preset. « Cinéma
 *    événement » qui repeindrait une charte en noir ferait perdre son
 *    identité à un compte pour un choix d'ambiance.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PRESETS_STUDIIO, PRESET_STUDIIO_IDS, presetStudiioParId, VERSION_PRESETS,
  PRESETS_PERSONNELS_MAX, NOM_PRESET_MAX,
  stylePresetValide, nomPresetValide, presetsPersonnelsValides,
  appliquerPreset, styleDepuisProfil, type StylePreset,
} from '@/lib/creatif/presets';
import { LOOK_IDS, lookParId } from '@/lib/creatif/looks';
import { STYLE_TEXTE_IDS } from '@/lib/creatif/styles-texte';
import { ANIMATION_TEXTE_IDS } from '@/lib/creatif/animations-texte';
import { ANIMATION_CONTENU_IDS } from '@/lib/creatif/animations-contenu';
import {
  TRANSITION_CREATIVE_IDS, transitionCreativeParId,
  DUREE_TRANSITION_MIN_MS, DUREE_TRANSITION_MAX_MS,
} from '@/lib/creatif/transitions';
import { bibliothequeValide, BIBLIOTHEQUE_VIDE } from '@/lib/creatif/bibliotheque';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';
import {
  PROFIL_CREATIF_DEFAUT, normaliserProfilCreatif, lireProfilCreatif,
} from '@/lib/autopilot/analyse/profil-creatif';
import { CATEGORIES_CREATIVES, chercher } from '@/lib/creatif/catalogue-contrat';

const Panneau = (await import('@/components/creer/PanneauPresets')).default;
const { resumePreset } = await import('@/components/creer/PanneauPresets');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CATALOGUE = lire('src/lib/creatif/presets.ts');
const PANNEAU = lire('src/components/creer/MonStylePanel.tsx');

const CONTENUS = ANIMATION_CONTENU_IDS.includes('aucune')
  ? ANIMATION_CONTENU_IDS : ['aucune', ...ANIMATION_CONTENU_IDS];

afterEach(() => { cleanup(); });

const STYLE_TEST: StylePreset = {
  lutId: 'vibrant', lutIntensite: 0.8, styleTexteId: 'bold-social',
  animationBlocId: 'pop', animationContenuId: 'mot-par-mot',
  transitionId: 'fondu', transitionDureeMs: 500,
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les presets Studiio', () => {
  it('1.1 douze presets, bien au-delà des huit demandés', () => {
    expect(PRESETS_STUDIIO.length).toBe(12);
    expect(new Set(PRESET_STUDIIO_IDS).size).toBe(12);
  });

  it('1.2 ⚠️ AUCUNE RÉFÉRENCE MORTE — chaque identifiant existe', () => {
    for (const preset of PRESETS_STUDIIO) {
      const st = preset.style;
      expect(LOOK_IDS, preset.id).toContain(st.lutId);
      expect(STYLE_TEXTE_IDS, preset.id).toContain(st.styleTexteId);
      expect(ANIMATION_TEXTE_IDS, preset.id).toContain(st.animationBlocId);
      expect(CONTENUS, preset.id).toContain(st.animationContenuId);
      expect(TRANSITION_CREATIVE_IDS, preset.id).toContain(st.transitionId);
    }
  });

  it('1.3 les nombres sont dans les bornes du moteur', () => {
    for (const preset of PRESETS_STUDIIO) {
      const st = preset.style;
      expect(st.lutIntensite).toBeGreaterThan(0);
      expect(st.lutIntensite).toBeLessThanOrEqual(1);
      if (st.transitionId === 'cut') {
        expect(st.transitionDureeMs).toBe(0);
      } else {
        expect(st.transitionDureeMs).toBeGreaterThanOrEqual(DUREE_TRANSITION_MIN_MS);
        expect(st.transitionDureeMs).toBeLessThanOrEqual(DUREE_TRANSITION_MAX_MS);
      }
    }
  });

  it('1.4 aucun preset n’est le sosie d’un autre', () => {
    const vus = new Set(PRESETS_STUDIIO.map((x) => JSON.stringify(x.style)));
    expect(vus.size).toBe(PRESETS_STUDIIO.length);
  });

  it('1.5 chacun se décrit, se catégorise et porte sa version', () => {
    for (const preset of PRESETS_STUDIIO) {
      expect(CATEGORIES_CREATIVES).toContain(preset.categorie);
      expect(preset.description.length).toBeGreaterThan(10);
      expect(preset.version).toBe(VERSION_PRESETS);
      expect(preset.famille).toBe('preset');
      expect(preset.tags.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('1.6 les univers demandés sont là, et ils sont cohérents', () => {
    const fitness = presetStudiioParId('fitness-energie')!;
    expect(lookParId(fitness.style.lutId)!.categorie).toBe('energie');
    expect(fitness.style.animationBlocId).toBe('pop-rapide');

    const cinema = presetStudiioParId('cinema-evenement')!;
    expect(lookParId(cinema.style.lutId)!.categorie).toBe('cinema');
    expect(transitionCreativeParId(cinema.style.transitionId)!.categorie).toBe('cinema');

    // Témoignage : peau naturelle, texte lisible, mouvement discret.
    const temoin = presetStudiioParId('temoignage')!;
    expect(lookParId(temoin.style.lutId)!.categorie).toBe('portrait');
    expect(temoin.style.animationBlocId).toBe('fondu-entree');

    const clean = presetStudiioParId('createur-epure')!;
    expect(lookParId(clean.style.lutId)!.categorie).toBe('sobre');
    expect(clean.style.animationContenuId).toBe('aucune');
  });

  it('1.7 ils se cherchent comme les autres familles créatives', () => {
    expect(chercher(PRESETS_STUDIIO, 'fitness').map((x) => x.id)).toContain('fitness-energie');
    // Sans accent, et ça marche quand même.
    expect(chercher(PRESETS_STUDIIO, 'evenement').length).toBeGreaterThan(0);
  });

  it('1.8 le catalogue ne lit ni base ni disque', () => {
    expect(sansProse(CATALOGUE)).not.toMatch(/node:fs|supabase|fetch\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Appliquer — et ne toucher à rien d’autre', () => {
  it('2.1 les quatre blocs du preset sont écrits', () => {
    const r = appliquerPreset(PROFIL_CREATIF_DEFAUT, STYLE_TEST);
    expect(r.lut.lutId).toBe('vibrant');
    expect(r.lut.active).toBe(true);
    expect(r.lut.intensite).toBe(0.8);
    expect(r.typographie.styleTexteId).toBe('bold-social');
    expect(r.animations.texteId).toBe('pop');
    expect(r.animations.texteContenuId).toBe('mot-par-mot');
    expect(r.transitions.transitionId).toBe('fondu');
    expect(r.transitions.active).toBe(true);
    expect(r.transitions.dureeMs).toBe(500);
  });

  it('2.2 ⚠️ LES COULEURS DE MARQUE NE BOUGENT PAS', () => {
    const marque = normaliserProfilCreatif({
      couleurs: {
        primaire: '#FF0000', secondaire: '#00FF00', accent: '#0000FF',
        fond: '#101010', texte: '#FEFEFE',
      },
    } as never);
    const apres = appliquerPreset(marque, STYLE_TEST);
    expect(apres.couleurs).toEqual(marque.couleurs);
  });

  it('2.3 ⚠️ LE MESSAGE DU CTA ET LE TEXTE NE BOUGENT PAS', () => {
    const avec = normaliserProfilCreatif({
      texte: {
        actif: true, titre: 'Mon accroche', sousTitre: 'à moi', libre: null,
        position: 'bas', debutSecondes: 0, dureeSecondes: 3,
      },
      ctaVisuel: { actif: true, modeleId: null, dureeSecondes: 3, position: 'bas' },
    } as never);
    const apres = appliquerPreset(avec, STYLE_TEST);
    expect(apres.texte).toEqual(avec.texte);
    expect(apres.ctaVisuel).toEqual(avec.ctaVisuel);
    expect(apres.marque).toEqual(avec.marque);
    expect(apres.margesSures).toEqual(avec.margesSures);
  });

  it('2.4 les DOUZE presets laissent la marque intacte', () => {
    const marque = normaliserProfilCreatif({
      couleurs: { primaire: '#123456', accent: '#654321', texte: '#FFFFFF' },
    } as never);
    for (const preset of PRESETS_STUDIIO) {
      const apres = appliquerPreset(marque, preset.style);
      expect(apres.couleurs, preset.id).toEqual(marque.couleurs);
      expect(apres.marque, preset.id).toEqual(marque.marque);
      expect(apres.ctaVisuel, preset.id).toEqual(marque.ctaVisuel);
    }
  });

  it('2.5 ⚠️ `neutral` ÉTEINT la LUT au lieu de l’activer sur l’identité', () => {
    const r = appliquerPreset(PROFIL_CREATIF_DEFAUT, { ...STYLE_TEST, lutId: 'neutral' });
    expect(r.lut.active).toBe(false);
    expect(r.lut.lutId).toBe('neutral');
  });

  it('2.6 `cut` éteint la transition et laisse la durée en place', () => {
    const avant = normaliserProfilCreatif({
      transitions: { active: true, transitionId: 'fondu', dureeMs: 700, intensite: 0.5 },
    } as never);
    const r = appliquerPreset(avant, { ...STYLE_TEST, transitionId: 'cut', transitionDureeMs: 0 });
    expect(r.transitions.active).toBe(false);
    expect(r.transitions.dureeMs).toBe(700);
  });

  it('2.7 le résultat reste un profil que le contrat accepte', () => {
    for (const preset of PRESETS_STUDIIO) {
      const r = appliquerPreset(PROFIL_CREATIF_DEFAUT, preset.style);
      expect(lireProfilCreatif(r).ok, preset.id).toBe(true);
    }
  });

  it('2.8 aller-retour : capturer puis appliquer ne change rien', () => {
    const profil = appliquerPreset(PROFIL_CREATIF_DEFAUT, STYLE_TEST);
    expect(styleDepuisProfil(profil)).toEqual(STYLE_TEST);
  });

  it('2.9 le panneau n’écrit QUE les quatre blocs', () => {
    expect(PANNEAU).toContain('lut: suivant.lut');
    expect(PANNEAU).toContain('transitions: suivant.transitions');
    expect(PANNEAU).not.toMatch(/couleurs: suivant\.couleurs|ctaVisuel: suivant\./);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les presets personnels', () => {
  const p = (id: string, nom: string, style = STYLE_TEST) => ({ id, nom, style });

  it('3.1 ils sont relus, nommés et bornés', () => {
    expect(PRESETS_PERSONNELS_MAX).toBe(20);
    const trop = Array.from({ length: 30 }, (_, i) => p(`p${i}`, `Preset ${i}`));
    expect(presetsPersonnelsValides(trop).length).toBe(PRESETS_PERSONNELS_MAX);
  });

  it('3.2 ⚠️ UN SEUL CHAMP MORT SUFFIT À REFUSER LE PRESET', () => {
    expect(stylePresetValide({ ...STYLE_TEST, lutId: 'look-de-2027' })).toBeNull();
    expect(stylePresetValide({ ...STYLE_TEST, styleTexteId: 'inconnu' })).toBeNull();
    expect(stylePresetValide({ ...STYLE_TEST, transitionId: 'slideleft' })).toBeNull();
    // Et un preset refusé disparaît de la liste, sans casser les autres.
    const r = presetsPersonnelsValides([
      p('a', 'Bon'), p('b', 'Mort', { ...STYLE_TEST, lutId: 'x' }), p('c', 'Bon aussi'),
    ]);
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('3.3 les nombres sont bornés, pas refusés', () => {
    const r = stylePresetValide({ ...STYLE_TEST, lutIntensite: 9, transitionDureeMs: 99999 })!;
    expect(r.lutIntensite).toBe(1);
    expect(r.transitionDureeMs).toBe(DUREE_TRANSITION_MAX_MS);
  });

  it('3.4 un nom vide, un nom à rallonge, un nom avec retours à la ligne', () => {
    expect(nomPresetValide('   ')).toBeNull();
    expect(nomPresetValide(42)).toBeNull();
    expect(nomPresetValide('a'.repeat(200))!.length).toBe(NOM_PRESET_MAX);
    expect(nomPresetValide('Mon\nstyle')).toBe('Mon style');
  });

  it('3.5 un identifiant douteux ne passe pas', () => {
    expect(presetsPersonnelsValides([p('../../etc', 'Bad')]).length).toBe(0);
    expect(presetsPersonnelsValides([p('ok-1_A', 'Bon')]).length).toBe(1);
  });

  it('3.6 les doublons d’identifiant s’effondrent', () => {
    expect(presetsPersonnelsValides([p('a', 'Un'), p('a', 'Deux')]).length).toBe(1);
  });

  it('3.7 ils survivent à l’aller-retour de persistance', () => {
    const style = sanitizeDesignStyle({
      bibliothequeCreative: { presets: [p('mien', 'Afroboost Energy')] },
    });
    expect(style.bibliothequeCreative?.presets[0].nom).toBe('Afroboost Energy');
    expect(bibliothequeValide(style.bibliothequeCreative).presets.length).toBe(1);
  });

  it('3.8 un compte sans preset ni favori reste « vide »', () => {
    expect(BIBLIOTHEQUE_VIDE.presets).toEqual([]);
    expect(sanitizeDesignStyle({ bibliothequeCreative: { presets: [] } })
      .bibliothequeCreative).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le panneau', () => {
  const monter = (extra = {}) => render(
    <Panneau
      onAppliquer={() => {}}
      presetsPersonnels={[]}
      onEnregistrer={() => {}}
      onRenommer={() => {}}
      onSupprimer={() => {}}
      {...extra}
    />,
  );

  it('4.1 les douze univers Studiio sont là, avec leur aperçu de look', () => {
    const { container } = monter();
    expect(container.querySelectorAll('[data-preset-studiio]').length).toBe(12);
    const img = container.querySelector('[data-preset-apercu]') as HTMLImageElement;
    // ⚠️ AUCUNE ROUTE DE PLUS : c'est l'aperçu du look, rendu par le vrai
    // `.cube`, que A_3a fabrique déjà.
    expect(img.getAttribute('src')).toContain('/api/creatif/looks/');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('4.2 appliquer remonte le STYLE, pas l’identifiant', () => {
    const recus: StylePreset[] = [];
    const { container } = monter({ onAppliquer: (s: StylePreset) => recus.push(s) });
    fireEvent.click(container.querySelector('[data-preset-studiio="temoignage"]') as HTMLElement);
    expect(recus[0]).toEqual(presetStudiioParId('temoignage')!.style);
  });

  it('4.3 chaque carte dit ce qu’elle contient, en français', () => {
    const r = resumePreset(presetStudiioParId('fitness-energie')!.style);
    expect(r).toContain('Sport');
    expect(r).toContain('Zoom avant');
    expect(r).not.toMatch(/xfade|slideleft|drawtext/i);
  });

  it('4.4 créer, renommer, appliquer, supprimer', () => {
    const crees: string[] = [];
    const renommes: [string, string][] = [];
    const supprimes: string[] = [];
    const appliques: StylePreset[] = [];
    const { container } = monter({
      presetsPersonnels: [{ id: 'mien', nom: 'Afroboost Energy', style: STYLE_TEST }],
      onEnregistrer: (n: string) => crees.push(n),
      onRenommer: (id: string, n: string) => renommes.push([id, n]),
      onSupprimer: (id: string) => supprimes.push(id),
      onAppliquer: (s: StylePreset) => appliques.push(s),
    });

    fireEvent.change(
      container.querySelector('[data-preset-nouveau-nom]') as HTMLInputElement,
      { target: { value: 'Mon univers' } },
    );
    fireEvent.click(container.querySelector('[data-preset-enregistrer]') as HTMLElement);
    expect(crees).toEqual(['Mon univers']);

    fireEvent.click(container.querySelector('[data-preset-personnel="mien"]') as HTMLElement);
    expect(appliques).toEqual([STYLE_TEST]);

    fireEvent.click(container.querySelector('[data-preset-renommer="mien"]') as HTMLElement);
    fireEvent.change(
      container.querySelector('[data-preset-renommer-champ="mien"]') as HTMLInputElement,
      { target: { value: 'Afroboost Clean' } },
    );
    fireEvent.click(container.querySelector('[data-preset-renommer-valider="mien"]') as HTMLElement);
    expect(renommes).toEqual([['mien', 'Afroboost Clean']]);

    fireEvent.click(container.querySelector('[data-preset-supprimer="mien"]') as HTMLElement);
    expect(supprimes).toEqual(['mien']);
  });

  it('4.5 un nom vide n’enregistre rien', () => {
    const crees: string[] = [];
    const { container } = monter({ onEnregistrer: (n: string) => crees.push(n) });
    const bouton = container.querySelector('[data-preset-enregistrer]') as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
    fireEvent.click(bouton);
    expect(crees).toEqual([]);
  });

  it('4.6 au plafond, on le DIT au lieu de refuser en silence', () => {
    const { container } = monter({ limiteAtteinte: true });
    expect(container.querySelector('[data-presets-limite]')).not.toBeNull();
    expect((container.querySelector('[data-preset-enregistrer]') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('4.7 sans preset personnel, on explique au lieu de montrer un vide', () => {
    const { container } = monter();
    expect(container.querySelector('[data-presets-personnels-vide]')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Dans « Mon style »', () => {
  it('5.1 le panneau est branché, avec ses quatre actions', () => {
    expect(PANNEAU).toContain('PanneauPresets');
    expect(PANNEAU).toContain('onEnregistrer');
    expect(PANNEAU).toContain('onRenommer');
    expect(PANNEAU).toContain('onSupprimer');
  });

  it('5.2 ⚠️ « ACTIF » SE DÉDUIT DU BROUILLON, il ne se stocke pas', () => {
    // Retenir « le dernier preset cliqué » mentirait dès que la personne
    // change une transition juste après.
    expect(PANNEAU).toContain('const presetActif = useMemo(');
    expect(PANNEAU).toContain('styleDepuisProfil(brouillon)');
    expect(PANNEAU).not.toContain('setPresetActif');
  });

  it('5.3 l’identifiant d’un preset personnel est FABRIQUÉ, jamais saisi', () => {
    expect(PANNEAU).toContain('id: `p${Date.now().toString(36)}`');
  });

  it('5.4 appliquer modifie le BROUILLON, pas la base', () => {
    // C'est « Enregistrer » qui décide, comme pour tout autre réglage.
    const i = PANNEAU.indexOf('onAppliquer={(style)');
    expect(PANNEAU.slice(i, i + 500)).toContain('modifier({');
    expect(PANNEAU.slice(i, i + 500)).not.toContain('fetch(');
  });
});
