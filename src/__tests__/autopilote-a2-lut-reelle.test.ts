/**
 * A_2 — DE VRAIES LUT, ENFIN APPLIQUÉES.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EXISTAIT, ET CE QUE ÇA VALAIT
 * ---------------------------------------------------------------------------
 *
 * Cinq « looks » étaient proposés à l'écran, et le rendu émettait pour eux un
 * `eq`+`colorbalance` — une APPROCHE de l'intention colorimétrique, pas une
 * LUT. Les cinq entrées du catalogue portaient d'ailleurs `ressourceServeur:
 * null`, et le mot « LUT » y était un faux ami : un audit lexical aurait
 * conclu au support des LUT alors que rien n'ouvrait jamais un `.cube`.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : qu'aucun chemin de fichier ne
 * puisse venir d'un réglage. `lut3d=file=…` ouvre un fichier du serveur ; le
 * laisser choisir par un profil donnerait la lecture de n'importe quel
 * fichier de la machine, recraché en couleurs dans un MP4 publié.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  LUTS_AUTORISEES, lutParId,
} from '@/lib/autopilot/analyse/catalogues-creatifs';
import {
  lireCube, doserCube, ecrireCube, filtreLut3d,
  TAILLE_CUBE_MIN, TAILLE_CUBE_MAX, MOTIFS_CUBE,
} from '@/lib/autopilot/analyse/lut-cube';
import { resoudreLut, MOTIFS_LUT } from '@/lib/autopilot/analyse/rendu-lut';
import { methodeRendu, VERSION_LOOK } from '@/lib/autopilot/analyse/rendu-contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const STYLE = lire('src/lib/autopilot/analyse/rendu-style.ts');
const RENDU = lire('src/lib/autopilot/analyse/rendu.ts');
const RESOLUTION = lire('src/lib/autopilot/analyse/rendu-lut.ts');
const CUBE = lire('src/lib/autopilot/analyse/lut-cube.ts');

const lut = (o: Partial<{ active: boolean; lutId: string | null; intensite: number }> = {}) => ({
  active: true, lutId: 'cinema-warm', intensite: 1, ...o,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les fichiers existent, et ils sont à nous', () => {
  it('1.1 quatre `.cube` sont livrés, un par look non neutre', () => {
    for (const l of LUTS_AUTORISEES) {
      if (l.id === 'neutral') {
        // « Aucun look » ne s'applique pas : il s'abstient.
        expect(l.ressourceServeur).toBeNull();
        continue;
      }
      expect(l.ressourceServeur, l.id).not.toBeNull();
      expect(existsSync(path.join(process.cwd(), 'public/luts', l.ressourceServeur!)), l.id)
        .toBe(true);
    }
  });

  it('1.2 chacun se lit, avec la taille annoncée', () => {
    for (const l of LUTS_AUTORISEES.filter((x) => x.ressourceServeur)) {
      const r = lireCube(lire(`public/luts/${l.ressourceServeur}`));
      expect(r.ok, l.id).toBe(true);
      if (!r.ok) continue;
      expect(r.cube.taille).toBe(16);
      expect(r.cube.entrees.length).toBe(16 ** 3 * 3);
    }
  });

  it('1.3 ils disent d’où ils viennent — aucune LUT tierce', () => {
    /* ⚠️ UNE LUT TROUVÉE SUR INTERNET ARRIVE SANS LICENCE VÉRIFIABLE, et se
       retrouverait redistribuée dans chaque MP4 publié. Celles-ci sont
       produites par le dépôt, à partir de coefficients qui y vivent déjà. */
    const entete = lire('public/luts/cinema-warm.cube').split('\n').slice(0, 3).join('\n');
    expect(entete).toContain('genere par scripts/lut/generer-luts.mjs');
    expect(entete).toContain('Aucune LUT tierce');
    expect(existsSync(path.join(process.cwd(), 'scripts/lut/generer-luts.mjs'))).toBe(true);
  });

  it('1.4 ils restent légers — 16 pas, mesure à l’appui', () => {
    // 33 pas donnaient le MÊME écart maximal pour neuf fois le poids : le
    // résidu n'est pas de l'interpolation, c'est l'arrondi entre deux
    // chemins de calcul.
    for (const l of LUTS_AUTORISEES.filter((x) => x.ressourceServeur)) {
      const o = statSync(path.join(process.cwd(), 'public/luts', l.ressourceServeur!)).size;
      expect(o, l.id).toBeLessThan(200 * 1024);
    }
    expect(lire('scripts/lut/generer-luts.mjs')).toContain('TAILLE 16 → max 5/255');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Aucun chemin ne vient d’un réglage', () => {
  it('2.1 un identifiant inconnu ne produit AUCUN chemin', () => {
    for (const id of ['../../etc/passwd', '/etc/passwd', 'inconnu', '', 'clean.cube']) {
      const r = resoudreLut(lut({ lutId: id }));
      expect(r.sorte, id).toBe('aucune');
      if (r.sorte === 'aucune') expect(r.motif, id).toBe('id_inconnu');
    }
  });

  it('2.2 le nom vient du CATALOGUE, pas de l’identifiant reçu', () => {
    /* Concaténer l'identifiant reçu au chemin serait la faille ; on prend le
       nom de l'entrée trouvée, puis on le réduit à son `basename`. */
    expect(RESOLUTION).toContain('path.basename(entree.ressourceServeur)');
    expect(RESOLUTION).toContain('chemin.startsWith(RACINE_LUTS + path.sep)');
  });

  it('2.3 la racine est fixée par le serveur', () => {
    expect(sansProse(RESOLUTION)).toContain("path.join(process.cwd(), 'public', 'luts')");
  });

  it('2.4 aucune URL, aucun téléchargement', () => {
    for (const interdit of ['http://', 'https://', 'fetch(', 'download']) {
      expect(sansProse(RESOLUTION), interdit).not.toContain(interdit);
      expect(sansProse(CUBE), interdit).not.toContain(interdit);
    }
  });

  it('2.5 un fichier trop gros est refusé', () => {
    expect(RESOLUTION).toContain('TAILLE_MAX_LUT_OCTETS');
    expect(MOTIFS_LUT).toContain('fichier_trop_gros');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. L’intensité', () => {
  const table = lireCube(lire('public/luts/cinema-warm.cube'));
  const cube = table.ok ? table.cube : null;

  it('3.1 intensité nulle : AUCUN filtre, pas un filtre neutre', () => {
    /* Un `lut3d` à 0 % ferait traverser chaque image par une interpolation
       qui ne change rien : du calcul et une perte d'arrondi, pour un
       résultat censé être l'original. */
    const r = resoudreLut(lut({ intensite: 0 }));
    expect(r.sorte).toBe('aucune');
    if (r.sorte === 'aucune') expect(r.motif).toBe('inactive');
  });

  it('3.2 une intensité négative est traitée comme nulle', () => {
    expect(resoudreLut(lut({ intensite: -1 })).sorte).toBe('aucune');
  });

  it('3.3 intensité pleine : la table n’est pas touchée', () => {
    expect(cube).not.toBeNull();
    expect(doserCube(cube!, 1)).toBe(cube!);
    // Au-delà de 1, on borne plutôt que d'extrapoler une couleur.
    expect(doserCube(cube!, 5).entrees[42]).toBe(cube!.entrees[42]);
  });

  it('3.4 intensité moitié : chaque entrée est à mi-chemin de l’identité', () => {
    const dose = doserCube(cube!, 0.5);
    const pas = cube!.taille - 1;
    let verifiees = 0;
    for (let b = 0, k = 0; b < cube!.taille; b += 1) {
      for (let g = 0; g < cube!.taille; g += 1) {
        for (let r = 0; r < cube!.taille; r += 1, k += 3) {
          const attendu = r / pas + (cube!.entrees[k] - r / pas) * 0.5;
          expect(dose.entrees[k]).toBeCloseTo(attendu, 10);
          verifiees += 1;
        }
      }
    }
    expect(verifiees).toBe(cube!.taille ** 3);
  });

  it('3.5 le dosage porte sur la TABLE, pas sur l’image', () => {
    /* ⚠️ `lut3d` n'a pas d'opacité, et le look vit dans une chaîne LINÉAIRE
       de filtres : un `split`+`blend` demanderait de réécrire l'assemblage.
       L'interpolation de `lut3d` étant linéaire, doser la table donne
       exactement le même résultat. */
    expect(sansProse(STYLE)).not.toContain('split');
    expect(sansProse(STYLE)).not.toContain('blend=');
    expect(RENDU).toContain('doserCube(lu.cube, intensite)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La lecture d’un `.cube` est stricte sur les nombres', () => {
  const entete = `LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n`;
  const huit = Array.from({ length: 8 }, () => '0.5 0.5 0.5').join('\n');

  it('4.1 un fichier bien formé se lit', () => {
    const r = lireCube(`${entete}${huit}\n`);
    expect(r.ok).toBe(true);
  });

  it('4.2 commentaires, TITLE et DOMAIN sont ignorés', () => {
    const r = lireCube(`# commentaire\nTITLE "x"\n${entete}\n\n${huit}\n`);
    expect(r.ok).toBe(true);
  });

  it('4.3 sans taille, on refuse', () => {
    expect(lireCube(huit)).toEqual({ ok: false, motif: 'taille_absente' });
  });

  it('4.4 une taille aberrante est refusée', () => {
    for (const t of [1, 0, 128, 999]) {
      const r = lireCube(`LUT_3D_SIZE ${t}\n${huit}\n`);
      expect(r.ok, String(t)).toBe(false);
    }
    expect(TAILLE_CUBE_MIN).toBe(2);
    expect(TAILLE_CUBE_MAX).toBe(64);
  });

  it('4.5 une table incomplète est refusée', () => {
    /* ⚠️ UNE TABLE À MOITIÉ LUE PRODUIRAIT DES COULEURS FAUSSES SANS LEVER
       LA MOINDRE ERREUR — le genre de panne qu'on ne voit qu'à l'écran. */
    const r = lireCube(`${entete}0.5 0.5 0.5\n0.5 0.5 0.5\n`);
    expect(r).toEqual({ ok: false, motif: 'entrees_manquantes' });
  });

  it('4.6 des entrées en trop sont refusées', () => {
    const r = lireCube(`${entete}${huit}\n0.1 0.1 0.1\n`);
    expect(r).toEqual({ ok: false, motif: 'entrees_en_trop' });
  });

  it('4.7 NaN et Infinity sont refusés', () => {
    for (const v of ['nan nan nan', 'inf 0 0', '-Infinity 0 0']) {
      const r = lireCube(`${entete}${v}\n`);
      expect(r, v).toEqual({ ok: false, motif: 'valeur_invalide' });
    }
  });

  it('4.8 le vocabulaire des motifs est fermé', () => {
    expect(MOTIFS_CUBE).toEqual([
      'vide', 'taille_absente', 'taille_hors_bornes', 'entrees_manquantes',
      'entrees_en_trop', 'valeur_invalide',
    ]);
  });

  it('4.9 ce qu’on écrit, on sait le relire', () => {
    const r = lireCube(lire('public/luts/clean.cube'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const relu = lireCube(ecrireCube(doserCube(r.cube, 0.3), 'test'));
    expect(relu.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le filtre et sa place dans le graphe', () => {
  it('5.1 `lut3d` est émis avec un chemin entre quotes', () => {
    const f = filtreLut3d('/tmp/rendu/look.cube');
    expect(f).toBe("lut3d=file='/tmp/rendu/look.cube':interp=tetrahedral");
  });

  it('5.2 la LUT s’applique à l’IMAGE, avant le branding', () => {
    /* ⚠️ L'ORDRE DÉCIDE DES COULEURS DE MARQUE. Un logo ou un CTA qui
       passerait dans la LUT ne serait plus de la bonne couleur : la charte
       du compte serait recolorée par son propre look. */
    const look = STYLE.indexOf('ctx.lutFichier');
    const logo = STYLE.indexOf('rectangleLogo(profil');
    const cta = STYLE.indexOf('drawbox=x=');
    const texte = STYLE.indexOf('filtreDrawtext({');
    expect(look).toBeGreaterThan(-1);
    for (const [nom, i] of [['logo', logo], ['cta', cta], ['texte', texte]] as const) {
      expect(i, nom).toBeGreaterThan(look);
    }
  });

  it('5.3 le look reste dans le fragment PAR CLIP', () => {
    // C'est ce qui le met avant l'assemblage, donc avant tout habillage.
    expect(STYLE).toContain('const fragments = ctx.clips.map(');
    expect(STYLE).toContain('[look, transition]');
  });

  it('5.4 aucun filtre ffmpeg ne vient d’un réglage', () => {
    expect(sansProse(CUBE)).toContain("lut3d=file='${chemin}'");
    expect(sansProse(STYLE)).not.toMatch(/profil\.[a-zA-Z.]*filtre/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Le repli, et ce qu’il dit', () => {
  it('6.1 sans fichier préparé, le preset historique reprend la main', () => {
    /* Machine sans les `.cube`, identifiant inconnu, fichier illisible : le
       montage sort avec le look d'hier plutôt que sans look du tout. */
    expect(STYLE).toContain('ctx.lutFichier\n    ? filtreLut3d(ctx.lutFichier)\n    : filtreLook(profil)');
  });

  it('6.2 un échec est TRACÉ, jamais silencieux', () => {
    // Même discipline que `usage.transitionsNonRendues` et
    // `usage.textesNonRendus` : ce qui n'a pas été rendu est dit.
    expect(RENDU).toContain('usage.lutNonRendue');
    expect(RENDU).toContain('usage.lut = { id: issueLut.lut.id, intensite }');
  });

  it('6.3 une LUT absente ne fait pas échouer le montage', () => {
    const r = resoudreLut(lut({ lutId: 'cinema-warm' }));
    // Le fichier existe dans ce dépôt ; le motif « absent » reste néanmoins
    // dans le vocabulaire, pour une image où il manquerait.
    expect(r.sorte).toBe('appliquee');
    expect(MOTIFS_LUT).toContain('fichier_absent');
  });

  it('6.4 « aucun look » ne force aucune correction', () => {
    expect(resoudreLut(lut({ lutId: 'neutral' })).sorte).toBe('aucune');
    expect(resoudreLut(lut({ active: false })).sorte).toBe('aucune');
    expect(resoudreLut(null).sorte).toBe('aucune');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’identité du rendu suit le look', () => {
  const profilLut = (o = {}) => ({ lut: { active: true, lutId: 'clean', intensite: 1, ...o } });

  it('7.1 changer de LUT change l’identité', () => {
    expect(methodeRendu(null, profilLut()))
      .not.toBe(methodeRendu(null, profilLut({ lutId: 'vibrant' })));
  });

  it('7.2 changer l’intensité change l’identité', () => {
    expect(methodeRendu(null, profilLut()))
      .not.toBe(methodeRendu(null, profilLut({ intensite: 0.5 })));
  });

  it('7.3 ⚠️ LE MODE DE LOOK AUSSI, et c’est ce qui évite de resservir hier', () => {
    /* `lutId` et `intensite` étaient DÉJÀ dans l'empreinte. Mais A_2 change
       ce que ces mêmes valeurs PRODUISENT : hier un preset, aujourd'hui une
       table. Sans marqueur, un compte déjà coloré aurait retrouvé le MP4
       d'hier sous une identité réputée à jour. */
    expect(VERSION_LOOK).toBe('lut3d-v1');
    expect(lire('src/lib/autopilot/analyse/rendu-contrat.ts'))
      .toContain('${VERSION_LOOK}');
  });

  it('7.4 un profil SANS look garde exactement son empreinte d’hier', () => {
    // La rétro-compatibilité, mesurée : le marqueur n'est ajouté que si un
    // look est actif.
    const sansLook = { lut: { active: false, lutId: null, intensite: 1 } };
    const historique = methodeRendu(null, sansLook);
    expect(historique).toBe(methodeRendu(null, sansLook));
    expect(historique).not.toBe(methodeRendu(null, profilLut()));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Manuel et automatique, une seule LUT', () => {
  it('8.1 les deux chemins passent par le même profil et le même moteur', () => {
    const auto = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
    const manuel = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
    for (const src of [auto, manuel]) expect(src).toContain('lireProfilCreatifUtilisateur');
    // La résolution vit dans le moteur, pas dans les appelants : ni l'un ni
    // l'autre ne peut donc choisir une LUT différente.
    expect(auto).not.toContain('resoudreLut');
    expect(manuel).not.toContain('resoudreLut');
    expect(RENDU).toContain('resoudreLut(profil?.lut ?? null)');
  });

  it('8.2 le reste du moteur n’a pas bougé', () => {
    expect(lire('src/lib/autopilot/analyse/coupe-contrat.ts')).toContain("'m3e-v4'");
    expect(RENDU).toContain('couperSilenceInitialMusique');
    expect(RENDU).toContain('preparerCouches({');
  });
});
