/**
 * A_3d1 — LES TRANSITIONS, RÉELLEMENT ASSEMBLÉES.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI CE LOT N'EXISTAIT PAS AVANT
 * ---------------------------------------------------------------------------
 *
 * `rendu-style` disait pourquoi, et il avait raison : « un `xfade` fait se
 * chevaucher deux plans : il raccourcit le montage de (n-1) x duree, ce qui
 * reecrit le plan et fait echouer la mesure ». `resultatConforme` compare la
 * duree MESUREE a `plan.dureeTotaleSecondes` — un montage recouvert etait donc
 * refuse.
 *
 * Ce lot ne desactive pas cette verification : il lui APPREND le
 * recouvrement. La duree attendue devient « celle du plan moins le
 * recouvrement », si bien que la mesure controle desormais AUSSI que le
 * recouvrement a bien eu lieu.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI A ÉTÉ MESURÉ AVANT D'ÊTRE ÉCRIT
 * ---------------------------------------------------------------------------
 *
 * 1. `ffmpeg -h filter=xfade` rend la MÊME liste de 47 effets sur le binaire
 *    embarqué (6.0) et dans le conteneur de production (5.1.9). Zéro
 *    divergence.
 *
 * 2. Vingt-neuf candidats rendus sur la même paire de plans, comparés deux à
 *    deux par l'écart moyen absolu par pixel à trois instants (25/50/75 %).
 *    Sur 406 paires, une seule sous 8/255 — `rectcrop` ~ `circlecrop`, tous
 *    deux noirs à mi-parcours. `rectcrop` a été retiré.
 *
 * 3. Chaîne réelle sur 2, 3 et 5 plans : les offsets cumulés mesurés sont
 *    1,5 / 4 / 5,5 / 8 s pour des plans de 2, 3, 2, 3, 2 s et un
 *    recouvrement de 0,5 s. Durée attendue 10,000 s, mesurée 10,033 s —
 *    une image à 30 i/s, constante quel que soit le nombre de jonctions.
 *
 * 4. Coût : 154 ms en coupe contre 240 ms en fondu sur trois plans, soit
 *    x1,55. Le garde du lot est x10.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  TRANSITIONS_CREATIVES, TRANSITION_CREATIVE_IDS, transitionCreativeParId,
  XFADE_AUTORISES, TRANSITIONS_HERITEES, VERSION_TRANSITIONS,
  DUREE_TRANSITION_MIN_MS, DUREE_TRANSITION_MAX_MS, MOTEURS_TRANSITION,
} from '@/lib/creatif/transitions';
import {
  planTransitions, PLAN_TRANSITIONS_COUPE, PART_MAX_CLIP, DUREE_MIN_SECONDES,
  SEUIL_COURBE_EXP_SECONDES,
} from '@/lib/autopilot/analyse/transition-plan';
import {
  TRANSITIONS_AUTORISEES, TRANSITION_IDS,
} from '@/lib/autopilot/analyse/catalogues-creatifs';
import {
  construireStyle, STYLE_NEUTRE, TRANSITIONS_NON_RENDUES,
  type ContexteStyle,
} from '@/lib/autopilot/analyse/rendu-style';
import {
  argumentsRendu, type SourceLocale, type CibleRendu,
} from '@/lib/autopilot/analyse/rendu-ffmpeg';
import {
  PROFIL_CREATIF_DEFAUT, normaliserProfilCreatif, lireProfilCreatif,
  profilCreatifCanonique, type ProfilCreatifAutopilote,
} from '@/lib/autopilot/analyse/profil-creatif';
import { methodeRendu } from '@/lib/autopilot/analyse/rendu-contrat';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import {
  CATEGORIES_CREATIVES, trierEntrees, chercher,
} from '@/lib/creatif/catalogue-contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CATALOGUE = lire('src/lib/creatif/transitions.ts');
const PLANIF = lire('src/lib/autopilot/analyse/transition-plan.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu-ffmpeg.ts');

const CIBLE: CibleRendu = { largeur: 1080, hauteur: 1920, fps: 30 };

const source = (ordre: number, duree = 3, aAudio = true): SourceLocale => ({
  ordre, chemin: `/tmp/src-${ordre}.mp4`, entreeSecondes: 0,
  dureeRetenueSecondes: duree,
  crop: { largeur: 1080, hauteur: 1920, x: 0, y: 0 }, aAudio,
});

const contexte = (durees: number[], extra: Partial<ContexteStyle> = {}): ContexteStyle => ({
  cible: { largeur: 1080, hauteur: 1920 },
  clips: durees.map((d) => ({ dureeSecondes: d })),
  dureeTotaleSecondes: durees.reduce((a, b) => a + b, 0),
  logo: null,
  indicePremiereEntree: durees.length,
  ...extra,
});

const profilT = (id: string, dureeMs = 500): ProfilCreatifAutopilote => normaliserProfilCreatif({
  transitions: { active: id !== 'cut', transitionId: id, dureeMs, intensite: 0.5 },
} as never);

const graphe = (durees: number[], id: string, dureeMs = 500) => {
  const style = construireStyle(profilT(id, dureeMs), contexte(durees));
  const total = durees.reduce((a, b) => a + b, 0);
  const args = argumentsRendu(
    durees.map((d, i) => source(i, d)), CIBLE, '/tmp/out.mp4',
    { recette: RECETTE_AUDIO_DEFAUT, musique: null, dureeSecondes: total }, style,
  );
  return { style, args, filtre: args[args.indexOf('-filter_complex') + 1] };
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le catalogue', () => {
  it('1.1 vingt-neuf transitions, toutes rendues — bien au-delà des douze demandées', () => {
    expect(TRANSITIONS_CREATIVES.length).toBe(29);
    expect(TRANSITIONS_CREATIVES.every((t) => t.rendu)).toBe(true);
    expect(new Set(TRANSITION_CREATIVE_IDS).size).toBe(TRANSITION_CREATIVE_IDS.length);
  });

  it('1.2 aucune carte morte : chaque entrée sait par quel moteur elle passe', () => {
    for (const t of TRANSITIONS_CREATIVES) {
      expect(MOTEURS_TRANSITION).toContain(t.moteur);
      // Un `xfade` sans nom d'effet serait une carte qui ne rend rien.
      if (t.moteur === 'xfade') expect(typeof t.xfadeId).toBe('string');
      else expect(t.xfadeId).toBeNull();
      expect(CATEGORIES_CREATIVES).toContain(t.categorie);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.version).toBe(VERSION_TRANSITIONS);
    }
  });

  it('1.3 vingt-six effets xfade, tous distincts les uns des autres', () => {
    const x = TRANSITIONS_CREATIVES.filter((t) => t.moteur === 'xfade');
    expect(x.length).toBe(26);
    expect(new Set(x.map((t) => t.xfadeId)).size).toBe(26);
  });

  it('1.4 quatre familles au moins, pour que la grille ait des rayons', () => {
    const familles = new Set(TRANSITIONS_CREATIVES.map((t) => t.categorie));
    expect(familles.size).toBeGreaterThanOrEqual(4);
  });

  it('1.5 des noms français, jamais le nom du filtre', () => {
    for (const t of TRANSITIONS_CREATIVES) {
      /* Le garde vise le NOM DU FILTRE, pas un mot français qui lui
         ressemble : « Diagonale » est du français, `diagtl` ne l'est pas. */
      for (const nom of XFADE_AUTORISES) {
        expect(t.nom.toLowerCase()).not.toContain(nom);
      }
      expect(t.nom).not.toMatch(/xfade|acrossfade/i);
    }
    const noms = TRANSITIONS_CREATIVES.map((t) => t.nom);
    expect(noms).toContain('Glisse vers la gauche');
    expect(noms).toContain('Coupe franche');
    expect(new Set(noms).size).toBe(noms.length);
  });

  it('1.6 ⚠️ `custom` est exclu : il prendrait une expression', () => {
    expect(XFADE_AUTORISES.has('custom')).toBe(false);
    expect(CATALOGUE).not.toContain("'custom'");
  });

  it('1.7 les noms d’effet vivent ICI, et le moteur ne fait que les relire', () => {
    // Le graphe n'écrit aucun nom en dur : il interpole `tr.xfadeId`.
    expect(sansProse(MOTEUR)).toContain('xfade=transition=${tr.xfadeId}');
    for (const nom of XFADE_AUTORISES) {
      expect(sansProse(MOTEUR)).not.toContain(`transition=${nom}`);
    }
  });

  it('1.8 le catalogue du profil dérive de la bibliothèque, il ne la recopie pas', () => {
    expect(sansProse(lire('src/lib/autopilot/analyse/catalogues-creatifs.ts')))
      .toContain('TRANSITIONS_CREATIVES.map');
    for (const t of TRANSITIONS_CREATIVES) expect(TRANSITION_IDS).toContain(t.id);
  });

  it('1.9 il se cherche et se trie comme les autres familles créatives', () => {
    expect(trierEntrees(TRANSITIONS_CREATIVES).length).toBe(29);
    const r = chercher(TRANSITIONS_CREATIVES, 'glisse gauche');
    expect(r.map((x) => x.id)).toEqual(['glisse-gauche']);
    // Sans accent, et ça doit marcher quand même.
    expect(chercher(TRANSITIONS_CREATIVES, 'eloignement').length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La rétro-compatibilité — rien ne change pour personne', () => {
  it('2.1 les quatre identifiants hérités restent acceptés par le contrat', () => {
    for (const id of TRANSITIONS_HERITEES) {
      expect(TRANSITION_IDS).toContain(id);
      const r = lireProfilCreatif({ transitions: { active: true, transitionId: id } });
      expect(r.ok).toBe(true);
    }
  });

  it('2.2 ⚠️ ils restent rendus COMME AVANT : une coupe, tracée', () => {
    for (const id of TRANSITIONS_HERITEES) {
      const { style, filtre } = graphe([3, 3], id);
      expect(style.transition).toBeNull();
      expect(filtre).not.toContain('xfade');
      expect(style.transitionsNonRendues).toContain(id);
    }
    // Le catalogue des non-rendues n'a pas bougé.
    expect([...TRANSITIONS_NON_RENDUES]).toEqual([...TRANSITIONS_HERITEES]);
  });

  it('2.3 ils ne sont PAS dans la bibliothèque — c’étaient des cartes mortes', () => {
    for (const id of TRANSITIONS_HERITEES) {
      expect(TRANSITION_CREATIVE_IDS).not.toContain(id);
    }
  });

  it('2.4 `cut` produit exactement le graphe d’avant ce lot', () => {
    const sources = [source(0), source(1)];
    const avant = argumentsRendu(sources, CIBLE, '/tmp/out.mp4');
    const apres = argumentsRendu(sources, CIBLE, '/tmp/out.mp4', null, STYLE_NEUTRE);
    expect(apres).toEqual(avant);
    const { filtre } = graphe([3, 3], 'cut');
    expect(filtre).toContain('concat=n=2');
    expect(filtre).not.toContain('xfade');
  });

  it('2.5 les deux transitions historiques gardent leur fondu interne', () => {
    for (const id of ['crossfade', 'flash']) {
      const { style, filtre } = graphe([3, 3], id);
      // Aucun recouvrement : la durée du montage reste celle du plan.
      expect(style.transition).toBeNull();
      expect(filtre).toContain('concat=n=2');
      expect(filtre).toContain('fade=t=out');
    }
    expect(transitionCreativeParId('crossfade')!.moteur).toBe('fondu-couleur');
    expect(transitionCreativeParId('flash')!.moteur).toBe('fondu-couleur');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les instants de recouvrement', () => {
  it('3.1 ⚠️ les offsets sont CUMULATIFS, et ça ne se voit qu’au 3e plan', () => {
    const p = planTransitions([2, 3, 2, 3, 2], 0.5);
    expect(p.offsetsSecondes.map((o) => Number(o.toFixed(3))))
      .toEqual([1.5, 4, 5.5, 8]);
    // L'erreur classique — « début du plan i moins la durée » — donnerait
    // 1,5 / 4,5 / 6,5 / 9,5 : juste pour la première, fausse ensuite.
    expect(p.offsetsSecondes[1]).not.toBeCloseTo(4.5, 3);
  });

  it('3.2 le montage perd exactement (n-1) x durée', () => {
    for (const n of [2, 3, 5, 8]) {
      const p = planTransitions(Array(n).fill(3), 0.5);
      expect(p.offsetsSecondes.length).toBe(n - 1);
      expect(p.recoupementTotalSecondes).toBeCloseTo(0.5 * (n - 1), 6);
    }
  });

  it('3.3 la durée finale se recalcule bien depuis les offsets', () => {
    const durees = [2, 3, 2, 3, 2];
    const p = planTransitions(durees, 0.5);
    const somme = durees.reduce((a, b) => a + b, 0);
    // Le dernier recouvrement finit à offset + durée, et le dernier plan
    // continue ensuite jusqu'au bout.
    const fin = p.offsetsSecondes[p.offsetsSecondes.length - 1]
      + p.dureeSecondes + (durees[durees.length - 1] - p.dureeSecondes);
    expect(fin).toBeCloseTo(somme - p.recoupementTotalSecondes, 6);
  });

  it('3.4 un seul plan n’a aucune jonction', () => {
    expect(planTransitions([5], 0.5)).toEqual(PLAN_TRANSITIONS_COUPE);
    const { style, filtre } = graphe([5], 'fondu');
    expect(style.transition).toBeNull();
    expect(filtre).not.toContain('xfade');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Les plans courts — jamais une erreur de filtre', () => {
  it('4.1 la durée est rabotée par le plan le plus court', () => {
    const p = planTransitions([4, 1, 4], 0.9);
    expect(p.dureeSecondes).toBeCloseTo(PART_MAX_CLIP * 1, 6);
    expect(p.reduite).toBe(true);
    expect(p.abandonnee).toBe(false);
  });

  it('4.2 ⚠️ un plan du MILIEU est mordu des deux côtés, et ça tient', () => {
    const durees = [4, 1, 4];
    const p = planTransitions(durees, 0.9);
    // La contrainte réelle : deux recouvrements ne peuvent pas dépasser le
    // plan qu'ils encadrent.
    expect(2 * p.dureeSecondes).toBeLessThanOrEqual(Math.min(...durees) + 1e-9);
    expect(PART_MAX_CLIP).toBeLessThanOrEqual(0.5);
  });

  it('4.3 trop court pour se voir : on revient à la coupe, et on le trace', () => {
    const p = planTransitions([0.3, 3], 0.5);
    expect(p.dureeSecondes).toBe(0);
    expect(p.abandonnee).toBe(true);
    const { style, filtre } = graphe([0.3, 3], 'fondu');
    expect(style.transition).toBeNull();
    expect(filtre).toContain('concat=n=2');
    expect(style.transitionsNonRendues).toContain('fondu');
  });

  it('4.4 la durée demandée est bornée des deux côtés par le moteur', () => {
    /* ⚠️ DEUX BORNAGES, ET ILS NE FONT PAS LA MÊME CHOSE. Le contrat borne
       `dureeMs` à [0, 3000] et retombe sur le défaut au-delà ; le moteur, lui,
       borne à ce qui se VOIT — au moins 150 ms, au plus 900. Le second reste
       nécessaire : une valeur de 10 ms est parfaitement valide pour le
       contrat et invisible à l'écran. */
    const court = construireStyle(profilT('fondu', 10), contexte([10, 10]));
    const long = construireStyle(profilT('fondu', 2500), contexte([10, 10]));
    expect(court.transition!.dureeSecondes)
      .toBeCloseTo(DUREE_TRANSITION_MIN_MS / 1000, 6);
    expect(long.transition!.dureeSecondes)
      .toBeCloseTo(DUREE_TRANSITION_MAX_MS / 1000, 6);
  });

  it('4.5 aucune durée négative ou absurde ne passe', () => {
    expect(planTransitions([3, 3], 0).dureeSecondes).toBe(0);
    expect(planTransitions([3, 3], -1).dureeSecondes).toBe(0);
    expect(planTransitions([], 0.5)).toEqual(PLAN_TRANSITIONS_COUPE);
    expect(DUREE_MIN_SECONDES).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le graphe', () => {
  it('5.1 la chaîne xfade remplace le concat, elle ne s’y ajoute pas', () => {
    const { filtre } = graphe([3, 3, 3], 'glisse-gauche');
    expect(filtre).not.toContain('concat=');
    expect((filtre.match(/xfade=/g) ?? []).length).toBe(2);
    expect(filtre).toContain('transition=slideleft');
    expect(filtre).toContain('[vout]');
  });

  it('5.2 les offsets écrits dans le graphe sont ceux du planificateur', () => {
    const { style, filtre } = graphe([2, 3, 2, 3, 2], 'fondu');
    for (const o of style.transition!.offsetsSecondes) {
      // Le graphe écrit les nombres comme `duree()` : sans zéros inutiles.
      expect(filtre).toContain(`:offset=${String(Number(o.toFixed(3)))}`);
    }
    expect((filtre.match(/xfade=/g) ?? []).length).toBe(4);
  });

  it('5.3 ⚠️ le fondu audio dure EXACTEMENT comme le recouvrement vidéo', () => {
    const { style, filtre } = graphe([3, 3, 3], 'fondu');
    const d = style.transition!.dureeSecondes;
    expect((filtre.match(/acrossfade=/g) ?? []).length).toBe(2);
    const dd = String(Number(d.toFixed(3)));
    expect(filtre).toContain(`acrossfade=d=${dd}`);
    expect(filtre).toContain(`xfade=transition=fade:duration=${dd}`);
  });

  it('5.4 la courbe audio change avec la durée, jamais la durée elle-même', () => {
    const bref = construireStyle(profilT('pixels', 300), contexte([3, 3]));
    const ample = construireStyle(profilT('iris-noir', 700), contexte([5, 5]));
    expect(bref.transition!.courbeAudio).toBe('tri');
    expect(ample.transition!.courbeAudio).toBe('exp');
    expect(SEUIL_COURBE_EXP_SECONDES).toBeGreaterThan(0);
  });

  it('5.5 un montage muet ne fabrique pas de chaîne audio', () => {
    const style = construireStyle(profilT('fondu'), contexte([3, 3]));
    const args = argumentsRendu(
      [source(0, 3, false), source(1, 3, false)], CIBLE, '/tmp/out.mp4',
      { recette: RECETTE_AUDIO_DEFAUT, musique: null, dureeSecondes: 6 }, style,
    );
    const filtre = args[args.indexOf('-filter_complex') + 1];
    expect(filtre).toContain('xfade=');
    expect(filtre).not.toContain('acrossfade=');
    expect(args).toContain('-an');
  });

  it('5.6 ⚠️ la musique suit la durée RÉELLE, pas celle du plan', () => {
    const durees = [3, 3, 3];
    const style = construireStyle(profilT('fondu'), contexte(durees));
    const args = argumentsRendu(
      durees.map((d, i) => source(i, d)), CIBLE, '/tmp/out.mp4',
      {
        recette: { ...RECETTE_AUDIO_DEFAUT, musique: true } as never,
        musique: { chemin: '/tmp/m.mp3' }, dureeSecondes: 9,
      }, style,
    );
    const filtre = args[args.indexOf('-filter_complex') + 1];
    const reelle = 9 - style.transition!.recoupementTotalSecondes;
    expect(filtre).toContain(`atrim=duration=${String(Number(reelle.toFixed(3)))}`);
    expect(filtre).not.toMatch(/atrim=duration=9\b/);
    // Elle reste CONTINUE : une seule entrée, un seul trim, aucun découpage
    // par jonction.
    expect((filtre.match(/stream_loop/g) ?? []).length).toBe(0);
    expect(args.filter((a) => a === '-stream_loop').length).toBe(1);
    expect((filtre.match(/atrim=duration=/g) ?? []).length).toBe(1);
  });

  it('5.7 le fondu de fin de musique se recale sur la durée réelle', () => {
    const style = construireStyle(profilT('fondu'), contexte([3, 3, 3]));
    const args = argumentsRendu(
      [source(0), source(1), source(2)], CIBLE, '/tmp/out.mp4',
      {
        recette: { ...RECETTE_AUDIO_DEFAUT, musique: true } as never,
        musique: { chemin: '/tmp/m.mp3' }, dureeSecondes: 9,
      }, style,
    );
    const filtre = args[args.indexOf('-filter_complex') + 1];
    const reelle = 9 - style.transition!.recoupementTotalSecondes;
    const st = Number(/afade=t=out:st=([\d.]+)/.exec(filtre)![1]);
    expect(st).toBeLessThan(reelle);
    expect(st).toBeGreaterThan(reelle - 2.01);
  });

  it('5.8 le look reste appliqué à chaque plan, AVANT la transition', () => {
    const p = normaliserProfilCreatif({
      lut: { active: true, lutId: 'vibrant', intensite: 1 },
      transitions: { active: true, transitionId: 'fondu', dureeMs: 400 },
    } as never);
    const style = construireStyle(p, contexte([3, 3]));
    // Le look vit dans la branche du plan ; la transition assemble ensuite.
    expect(style.fragmentsParClip[0]).toContain('eq=');
    expect(style.transition).not.toBeNull();
  });

  it('5.9 le branding est posé APRÈS l’assemblage, jamais dans une branche', () => {
    const style = construireStyle(profilT('fondu', 400), contexte([3, 3], {
      textes: [{
        fichierTexte: '/tmp/t.txt', fichierPolice: '/tmp/f.ttf', taillePx: 60,
        couleur: '#FFFFFF', ancre: 'bas', debutSecondes: 0, finSecondes: 3,
      }],
    }));
    expect(style.post).toContain('drawtext=');
    for (const f of style.fragmentsParClip) expect(f).not.toContain('drawtext=');
    const args = argumentsRendu(
      [source(0), source(1)], CIBLE, '/tmp/out.mp4',
      { recette: RECETTE_AUDIO_DEFAUT, musique: null, dureeSecondes: 6 }, style,
    );
    const filtre = args[args.indexOf('-filter_complex') + 1];
    // ⚠️ LE BRANDING VIENT APRÈS : sinon il serait coupé par le recouvrement.
    expect(filtre.indexOf('xfade=')).toBeLessThan(filtre.indexOf('drawtext='));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La durée, comptée et vérifiée', () => {
  it('6.1 le recouvrement est transporté jusqu’au moteur', () => {
    const style = construireStyle(profilT('fondu'), contexte([3, 3, 3]));
    expect(style.transition!.recoupementTotalSecondes).toBeCloseTo(1.0, 6);
  });

  it('6.2 ⚠️ la vérification de durée en tient compte — sinon tout serait refusé', () => {
    const rendu = sansProse(lire('src/lib/autopilot/analyse/rendu.ts'));
    expect(rendu).toContain('plan.dureeTotaleSecondes - recoupementSecondes');
    expect(rendu).toContain('style.transition?.recoupementTotalSecondes ?? 0');
  });

  it('6.3 l’écart est tracé dans `usage`, jamais caché', () => {
    const rendu = sansProse(lire('src/lib/autopilot/analyse/rendu.ts'));
    for (const cle of ['transitionRendue', 'transitionDureeSecondes',
      'recoupementTotalSecondes', 'dureeAttendueSecondes']) {
      expect(rendu).toContain(`usage.${cle}`);
    }
  });

  it('6.4 sans transition, la durée attendue est intacte', () => {
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte([3, 3]));
    expect(style.transition).toBeNull();
    expect(STYLE_NEUTRE.transition).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’identité', () => {
  it('7.1 changer de transition change l’identité du rendu', () => {
    const a = methodeRendu(RECETTE_AUDIO_DEFAUT, profilT('cut'), null);
    const b = methodeRendu(RECETTE_AUDIO_DEFAUT, profilT('fondu'), null);
    const c = methodeRendu(RECETTE_AUDIO_DEFAUT, profilT('glisse-gauche'), null);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('7.2 changer la DURÉE change aussi l’identité : le résultat diffère', () => {
    const a = methodeRendu(RECETTE_AUDIO_DEFAUT, profilT('fondu', 300), null);
    const b = methodeRendu(RECETTE_AUDIO_DEFAUT, profilT('fondu', 700), null);
    expect(a).not.toBe(b);
  });

  it('7.3 chacune des vingt-neuf donne une identité distincte', () => {
    const vues = new Set(TRANSITION_CREATIVE_IDS.map(
      (id) => profilCreatifCanonique(profilT(id)),
    ));
    expect(vues.size).toBe(TRANSITION_CREATIVE_IDS.length);
  });

  it('7.4 le manuel et l’automatique lisent le MÊME champ', () => {
    // Un seul champ dans le profil, donc aucun moyen de diverger.
    expect(sansProse(lire('src/lib/autopilot/analyse/rendu-style.ts')))
      .toContain('profil.transitions.transitionId');
    expect(PROFIL_CREATIF_DEFAUT.transitions.transitionId).toBe('cut');
    expect(PROFIL_CREATIF_DEFAUT.transitions.active).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Rien d’arbitraire ne vient du navigateur', () => {
  it('8.1 un identifiant inconnu est refusé par le contrat', () => {
    expect(lireProfilCreatif({ transitions: { transitionId: 'xfade=custom' } }).ok).toBe(false);
    expect(lireProfilCreatif({ transitions: { transitionId: 'hblur' } }).ok).toBe(false);
  });

  it('8.2 un identifiant hors catalogue ne produit AUCUNE transition', () => {
    const p = { ...PROFIL_CREATIF_DEFAUT,
      transitions: { active: true, transitionId: 'slideleft', dureeMs: 500, intensite: 0.5 } };
    const style = construireStyle(p as ProfilCreatifAutopilote, contexte([3, 3]));
    expect(style.transition).toBeNull();
  });

  it('8.3 la durée est bornée par le contrat ET par le moteur', () => {
    // Hors bornes, le contrat REFUSE — il ne rabote pas en silence.
    expect(lireProfilCreatif({
      transitions: { active: true, transitionId: 'fondu', dureeMs: 99999 },
    }).ok).toBe(false);
    // Et même une valeur acceptée par le contrat est re-bornée par le moteur.
    const style = construireStyle(profilT('fondu', 2900), contexte([30, 30]));
    expect(style.transition!.dureeSecondes)
      .toBeLessThanOrEqual(DUREE_TRANSITION_MAX_MS / 1000);
  });

  it('8.4 aucune expression, aucun filtre libre dans le graphe', () => {
    const { filtre } = graphe([3, 3], 'fondu');
    expect(filtre).not.toContain('expr');
    expect(filtre).not.toContain('custom');
    // Ce qui suit `transition=` est un mot du catalogue, et rien d'autre.
    for (const m of filtre.match(/transition=([a-z]+)/g) ?? []) {
      expect(XFADE_AUTORISES.has(m.slice('transition='.length))).toBe(true);
    }
  });

  it('8.5 le planificateur ne touche ni au disque ni au réseau', () => {
    expect(sansProse(PLANIF)).not.toMatch(/node:fs|fetch\(|require\(/);
    expect(sansProse(CATALOGUE)).not.toMatch(/node:fs|fetch\(|require\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Ce que ce lot ne devait pas toucher', () => {
  it('9.1 la sélection des plans n’a pas bougé', () => {
    const style = construireStyle(profilT('fondu'), contexte([3, 3, 3]));
    // Le style ne connaît que des durées ; il ne rejuge aucun plan.
    expect(sansProse(lire('src/lib/autopilot/analyse/rendu-style.ts')))
      .not.toMatch(/planifierMontage|choisirCandidats|scoreObjectif/);
  });

  it('9.2 le rendu du texte animé n’est pas touché', () => {
    const p = normaliserProfilCreatif({
      transitions: { active: true, transitionId: 'fondu', dureeMs: 400 },
      animations: { texteContenuId: 'mot-par-mot' },
      texte: { actif: true, titre: 'Bouge avec nous', position: 'bas' },
    } as never);
    const style = construireStyle(p, contexte([3, 3], {
      fichierAss: '/tmp/rendu/textes.ass',
      textes: [{
        fichierTexte: '/tmp/t.txt', fichierPolice: '/tmp/f.ttf', taillePx: 60,
        couleur: '#FFFFFF', ancre: 'bas', debutSecondes: 0, finSecondes: 3,
        animationContenuId: 'mot-par-mot', texte: 'Bouge avec nous', police: 'sans',
      }],
    }));
    expect(style.transition).not.toBeNull();
    expect(style.post).toContain('subtitles=');
    expect(style.documentAss).toContain('Bouge');
  });

  it('9.3 les autres familles créatives sont intactes', async () => {
    const { LOOKS_CREATIFS } = await import('@/lib/creatif/looks');
    const { STYLES_TEXTE } = await import('@/lib/creatif/styles-texte');
    const { ANIMATIONS_TEXTE } = await import('@/lib/creatif/animations-texte');
    const { ANIMATIONS_CONTENU } = await import('@/lib/creatif/animations-contenu');
    expect(LOOKS_CREATIFS.length).toBe(34);
    expect(STYLES_TEXTE.length).toBe(26);
    expect(ANIMATIONS_TEXTE.length).toBe(19);
    expect(ANIMATIONS_CONTENU.length).toBe(8);
  });
});
