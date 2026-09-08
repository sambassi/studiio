/**
 * A_3c2 — L'APPARITION DU TEXTE, RÉELLEMENT RENDUE.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE LOT CHANGE
 * ---------------------------------------------------------------------------
 *
 * A_3c1 animait le BLOC : le texte entier montait, grandissait, se fondait.
 * Le CONTENU, lui, arrivait toujours d'un coup — pas de machine à écrire, pas
 * de mot à mot, pas de mot en surbrillance. `drawtext` ne sait pas révéler
 * une sous-chaîne : il n'a aucune option temporelle sur le texte lui-même.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI A ÉTÉ MESURÉ AVANT D'ÊTRE ÉCRIT
 * ---------------------------------------------------------------------------
 *
 * 1. `--enable-libass` est présent sur le binaire embarqué ET dans le
 *    conteneur de production, avec les polices Liberation.
 *
 * 2. Écrire les mots au fur et à mesure (un événement par état du texte)
 *    RECENTRE la ligne à chaque étape : le bord gauche glissait de 83 à
 *    183 px. Avec le texte complet et l'alpha, il reste à 115 px aux trois
 *    instants mesurés pendant que la largeur passe de 67 à 489 px.
 *
 * 3. La surbrillance déplace bien l'intensité : mesurée par tiers de ligne,
 *    la clarté passe de [786, 384, 380] à [440, 598, 391] puis
 *    [440, 352, 669]. Le mot actif traverse la ligne.
 *
 * 4. Injection : `{\c&H0000FF&}ROUGE` rendu par le document produit
 *    11 002 pixels clairs à RGB = (246, 246, 246) — du BLANC. La commande
 *    n'a pas été exécutée ; si elle l'avait été, le texte serait rouge.
 *
 * ⚠️ CES TESTS NE MESURENT PAS DE MOYENNE GLOBALE. Une moyenne ne voit ni un
 * déplacement ni une révélation ; c'est la leçon de A_3c1, et le test 6 va
 * chercher le bord gauche et la largeur, pas la luminance.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import {
  ANIMATIONS_CONTENU, ANIMATION_CONTENU_IDS, animationContenuParId,
  decouperContenu, echapperAss, couleurAss, VERSION_ANIMATIONS_CONTENU,
  CARACTERES_MAX_FRAPPE, PROGRESSIONS, REVELATIONS,
  type AnimationContenuCreative,
} from '@/lib/creatif/animations-contenu';
import {
  documentAss, filtreSousTitres, texteEvenement, tempsAss, POLICE_ASS,
  type CoucheAss,
} from '@/lib/autopilot/analyse/rendu-ass';
import { ANIMATIONS_TEXTE } from '@/lib/creatif/animations-texte';
import {
  ANIMATION_CONTENU_IDS as IDS_CONTRAT,
} from '@/lib/autopilot/analyse/catalogues-creatifs';
import {
  PROFIL_CREATIF_DEFAUT, normaliserProfilCreatif, lireProfilCreatif,
  profilCreatifCanonique,
} from '@/lib/autopilot/analyse/profil-creatif';
import {
  preparerCouches, empreinteCouches, type SourcesTexte,
} from '@/lib/autopilot/analyse/rendu-texte';
import {
  construireStyle, STYLE_NEUTRE,
  type ContexteStyle, type TexteAPoser,
} from '@/lib/autopilot/analyse/rendu-style';

const Bibliotheque = (await import('@/components/creer/BibliothequeAnimationsContenu')).default;
const { calendrierApercu } = await import('@/components/creer/BibliothequeAnimationsContenu');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
/** Le code SANS les commentaires : une phrase n'est pas une instruction. */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const MOTEUR = lire('src/lib/creatif/animations-contenu.ts');
const ASS = lire('src/lib/autopilot/analyse/rendu-ass.ts');
const GRILLE = lire('src/components/creer/BibliothequeAnimationsContenu.tsx');
const PANNEAU = lire('src/components/creer/MonStylePanel.tsx');

const FF = (ffmpegPath as unknown as string) || 'ffmpeg';

const anim = (id: string): AnimationContenuCreative => {
  const a = animationContenuParId(id);
  if (a === null) throw new Error(`animation absente : ${id}`);
  return a;
};

const couche = (id: string, texte: string, extra: Partial<CoucheAss> = {}): CoucheAss => ({
  texte, animation: anim(id),
  police: 'sans', graisse: 'grasse', taillePx: 60, couleur: '#FFFFFF',
  xCentre: 360, yCentre: 320, debutSecondes: 0, finSecondes: 3,
  ...extra,
});

const sources = (contenuId: string | null): SourcesTexte => ({
  profil: {
    typographie: {
      policeTitreId: null, policeTexteId: null, graisse: 'grasse', styleTexteId: null,
    },
    couleurs: { primaire: null, accent: null, texte: '#ffffff' },
    texte: {
      actif: true, titre: 'Bouge avec nous', sousTitre: null, libre: null,
      position: 'bas', debutSecondes: 0, dureeSecondes: 4,
    },
    ctaVisuel: { actif: false, dureeSecondes: 3, position: 'bas' },
    animations: { texteId: null, texteContenuId: contenuId },
  },
  appelAction: null,
  dureeTotaleSecondes: 30,
});

const contexte = (extra: Partial<ContexteStyle> = {}): ContexteStyle => ({
  cible: { largeur: 1080, hauteur: 1920 },
  clips: [{ dureeSecondes: 3 }, { dureeSecondes: 3 }],
  dureeTotaleSecondes: 6,
  logo: null,
  indicePremiereEntree: 2,
  ...extra,
});

const texteAPoser = (extra: Partial<TexteAPoser> = {}): TexteAPoser => ({
  fichierTexte: '/tmp/rendu/texte-0.txt',
  fichierPolice: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  taillePx: 60, couleur: '#FFFFFF', ancre: 'bas',
  debutSecondes: 0, finSecondes: 3,
  ...extra,
});

afterEach(() => { cleanup(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le catalogue des apparitions', () => {
  it('1.1 huit apparitions réelles, toutes rendues par le moteur', () => {
    expect(ANIMATIONS_CONTENU.length).toBe(8);
    expect(ANIMATIONS_CONTENU.every((a) => a.rendu)).toBe(true);
    expect(new Set(ANIMATION_CONTENU_IDS).size).toBe(ANIMATION_CONTENU_IDS.length);
  });

  it('1.2 avec les mouvements de bloc, plus de vingt-cinq animations de texte', () => {
    // Le lot demandait « plus de 25 » au total, les deux familles réunies.
    expect(ANIMATIONS_TEXTE.length + ANIMATIONS_CONTENU.length).toBeGreaterThan(25);
  });

  it('1.3 les trois techniques sont couvertes, aucune n’est décorative', () => {
    const p = new Set(ANIMATIONS_CONTENU.map((a) => a.progression));
    const r = new Set(ANIMATIONS_CONTENU.map((a) => a.revelation));
    for (const x of PROGRESSIONS) expect(p.has(x)).toBe(true);
    for (const x of REVELATIONS) expect(r.has(x)).toBe(true);
  });

  it('1.4 des noms français, jamais le jargon du moteur', () => {
    for (const a of ANIMATIONS_CONTENU) {
      expect(a.nom).not.toMatch(/typewriter|word|highlight|fade|reveal|ass|drawtext/i);
      expect(a.description.length).toBeGreaterThan(10);
    }
    expect(ANIMATIONS_CONTENU.map((a) => a.nom)).toContain('Machine à écrire');
    expect(ANIMATIONS_CONTENU.map((a) => a.nom)).toContain('Mot par mot');
  });

  it('1.5 une version, pour que le cache ne resserve pas la vidéo d’hier', () => {
    expect(VERSION_ANIMATIONS_CONTENU).toBe('anim-contenu-v1');
    expect(ANIMATIONS_CONTENU.every((a) => a.version === VERSION_ANIMATIONS_CONTENU)).toBe(true);
  });

  it('1.6 le contrat du profil dérive du catalogue, il ne le recopie pas', () => {
    expect(IDS_CONTRAT).toEqual(['aucune', ...ANIMATIONS_CONTENU.map((a) => a.id)]);
    expect(sansProse(lire('src/lib/autopilot/analyse/catalogues-creatifs.ts')))
      .toContain('ANIMATIONS_CONTENU.map');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le séquenceur — le rythme suit le texte', () => {
  it('2.1 trois mots ne mettent pas le même temps que douze', () => {
    const court = decouperContenu(anim('mot-par-mot'), 'Un deux trois', 0, 6);
    const long = decouperContenu(anim('mot-par-mot'),
      'Un deux trois quatre cinq six sept huit neuf dix onze douze', 0, 6);
    expect(court.etapes.length).toBe(3);
    expect(long.etapes.length).toBe(12);
    // La révélation tient dans la même part de la couche : c'est le PAS qui
    // se resserre, pas la durée totale qui déborde.
    const pasCourt = court.etapes[1].debutSecondes - court.etapes[0].debutSecondes;
    const pasLong = long.etapes[1].debutSecondes - long.etapes[0].debutSecondes;
    expect(pasLong).toBeLessThan(pasCourt);
  });

  it('2.2 la dernière étape tient jusqu’au bout : le texte ne clignote pas', () => {
    for (const a of ANIMATIONS_CONTENU) {
      const d = decouperContenu(a, 'Bouge avec nous maintenant', 2, 7);
      expect(d.etapes[d.etapes.length - 1].finSecondes).toBe(7);
      expect(d.etapes[0].debutSecondes).toBe(2);
      expect(d.etapes[d.etapes.length - 1].revelees).toBe(d.unites.length);
    }
  });

  it('2.3 au-delà du seuil, la frappe passe aux mots — le message reste entier', () => {
    const longTexte = 'A'.repeat(CARACTERES_MAX_FRAPPE + 20).replace(/A{5}/g, 'AAAA ');
    const d = decouperContenu(anim('machine-a-ecrire'), longTexte, 0, 4);
    expect(d.separateur).toBe(' ');
    expect(d.unites.join(' ')).toBe(longTexte.trim());
    expect(d.etapes.length).toBeLessThan(30);
    // Sous le seuil, elle frappe bien lettre par lettre.
    const court = decouperContenu(anim('machine-a-ecrire'), 'Bouge', 0, 4);
    expect(court.unites).toEqual(['B', 'o', 'u', 'g', 'e']);
    expect(court.separateur).toBe('');
  });

  it('2.4 par groupes : deux mots à la fois, et le reste s’il est impair', () => {
    const d = decouperContenu(anim('groupe-par-groupe'), 'un deux trois quatre cinq', 0, 4);
    expect(d.etapes.map((e) => e.revelees)).toEqual([2, 4, 5]);
  });

  it('2.5 un texte vide ou une durée nulle ne produisent rien, sans lever', () => {
    expect(decouperContenu(anim('mot-par-mot'), '   ', 0, 4).etapes).toEqual([]);
    expect(decouperContenu(anim('mot-par-mot'), 'Bouge', 4, 4).etapes).toEqual([]);
  });

  it('2.6 pure : deux appels identiques rendent exactement la même chose', () => {
    const a = decouperContenu(anim('mot-fondu'), 'Bouge avec nous', 1, 5);
    const b = decouperContenu(anim('mot-fondu'), 'Bouge avec nous', 1, 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. L’échappement — aucune saisie ne devient une commande', () => {
  it('3.1 les trois caractères dangereux d’ASS sont neutralisés', () => {
    const sortie = echapperAss('{\\c&H0000FF&}ROUGE\nsaut');
    expect(sortie).not.toContain('{');
    expect(sortie).not.toContain('}');
    expect(sortie).not.toContain('\\');
    expect(sortie).not.toContain('\n');
    // Le texte reste LISIBLE : on remplace, on ne supprime pas.
    expect(sortie).toContain('ROUGE');
    expect(sortie).toContain('saut');
  });

  it('3.2 un texte ordinaire — apostrophes, pourcents, virgules — passe intact', () => {
    const brut = "C'est l'énergie ! 50 % aujourd'hui, promis.";
    expect(echapperAss(brut)).toBe(brut);
  });

  it('3.3 le document n’ouvre de bloc que sur des balises que NOUS écrivons', () => {
    const doc = documentAss({ largeur: 720, hauteur: 640 },
      [couche('mot-par-mot', '{\\c&H0000FF&}ROUGE {\\an7}HAUT \\N saut')]);
    const dialogues = doc.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(dialogues.length).toBeGreaterThan(0);
    for (const d of dialogues) {
      // Chaque accolade ouvrante du document est suivie d'un antislash de
      // NOTRE fabrication : `\pos`, `\alpha`, `\t`. Aucune autre.
      const blocs = d.match(/\{[^}]*\}/g) ?? [];
      expect(blocs.length).toBeGreaterThan(0);
      for (const b of blocs) {
        expect(b).toMatch(/^\{\\(pos|alpha|t)\(?/);
      }
      expect(d).not.toContain('\\c&H0000FF&');
      expect(d).not.toContain('{\\an7}');
    }
  });

  it('3.4 l’échappement est DANS le séquenceur, seul chemin partagé', () => {
    // L'aperçu du navigateur n'appelle pas le générateur ASS ; il n'appelle
    // que `decouperContenu`. Échapper ailleurs ferait diverger les deux.
    expect(sansProse(MOTEUR)).toMatch(/echapperAss\(texte[\s\S]{0,80}\)\.trim\(\)/);
    expect(sansProse(ASS)).not.toContain('echapperAss');
    const d = decouperContenu(anim('mot-par-mot'), 'Prix {net} \\N ici', 0, 3);
    expect(d.unites.join(' ')).not.toContain('{');
    expect(d.unites.join(' ')).not.toContain('\\');
  });

  it('3.5 une couleur du profil devient du BGR, jamais du texte libre', () => {
    expect(couleurAss('#FF8800')).toBe('&H0088FF&');
    // Une valeur qui n'est pas une couleur retombe sur le blanc.
    expect(couleurAss('rouge; DROP')).toBe('&HFFFFFF&');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le document — la mise en page est celle du texte final', () => {
  const doc = documentAss({ largeur: 1080, hauteur: 1920 },
    [couche('mot-par-mot', 'Bouge avec nous', { xCentre: 540, yCentre: 1500 })]);
  const dialogues = doc.split('\n').filter((l) => l.startsWith('Dialogue:'));

  it('4.1 chaque événement porte TOUS les mots — rien n’est absent', () => {
    expect(dialogues.length).toBe(3);
    for (const d of dialogues) {
      expect(d).toContain('Bouge');
      expect(d).toContain('avec');
      expect(d).toContain('nous');
    }
  });

  it('4.2 ce qui n’est pas révélé est TRANSPARENT, et ça se compte', () => {
    const invisibles = dialogues.map((d) => (d.match(/\\alpha&HFF&/g) ?? []).length);
    // Trois mots : deux cachés, puis un, puis aucun.
    expect(invisibles).toEqual([2, 1, 0]);
  });

  it('4.3 la position est IDENTIQUE d’un événement à l’autre', () => {
    const positions = new Set(dialogues.map((d) => d.match(/\{\\pos\([^)]*\)\}/)?.[0]));
    expect(positions.size).toBe(1);
    expect([...positions][0]).toBe('{\\pos(540,1500)}');
  });

  it('4.4 les pixels du cadre sont les coordonnées du document', () => {
    expect(doc).toContain('PlayResX: 1080');
    expect(doc).toContain('PlayResY: 1920');
    // Alignement 5 : `\pos` désigne le CENTRE, donc la longueur du texte ne
    // déplace pas la ligne.
    expect(doc).toMatch(/^Style: S0,.*,5,0,0,0,1$/m);
  });

  it('4.5 le même réglage donne la même place en 9:16 et en 16:9', () => {
    const vertical = documentAss({ largeur: 1080, hauteur: 1920 },
      [couche('mot-par-mot', 'Bouge', { xCentre: 540, yCentre: 1500 })]);
    const horizontal = documentAss({ largeur: 1920, hauteur: 1080 },
      [couche('mot-par-mot', 'Bouge', { xCentre: 960, yCentre: 840 })]);
    expect(vertical).toContain('PlayResY: 1920');
    expect(horizontal).toContain('PlayResY: 1080');
    expect(horizontal).toContain('{\\pos(960,840)}');
    // La police garde la même taille en PIXELS : c'est le moteur qui la
    // calcule en part de la hauteur, avant d'arriver ici.
    expect(vertical).toMatch(/^Style: S0,Liberation Sans,60,/m);
  });

  it('4.6 la surbrillance garde tout lisible ; seule l’intensité bouge', () => {
    const d = documentAss({ largeur: 720, hauteur: 640 },
      [couche('mot-actif', 'un deux trois')]);
    const evts = d.split('\n').filter((l) => l.startsWith('Dialogue:'));
    for (const e of evts) {
      expect(e).not.toContain('\\alpha&HFF&');
      // Un seul mot en pleine intensité par étape.
      expect((e.match(/\\alpha&H00&/g) ?? []).length).toBe(1);
    }
  });

  it('4.7 le fondu anime DANS l’événement, avec `\\t` en millisecondes', () => {
    const d = documentAss({ largeur: 720, hauteur: 640 },
      [couche('mot-fondu', 'un deux')]);
    expect(d).toMatch(/\\t\(0,\d+,\\alpha&H00&\)/);
  });

  it('4.8 le style du texte descend dans le document : police, graisse, ombre', () => {
    const d = documentAss({ largeur: 720, hauteur: 640 }, [couche('mot-par-mot', 'un', {
      police: 'mono', graisse: 'normale', couleur: '#FF0000',
      habillage: {
        contour: { largeur: 3, teinte: 'blanc' },
        ombre: null, fond: null,
      },
    })]);
    const style = d.split('\n').find((l) => l.startsWith('Style:'))!;
    expect(style).toContain(POLICE_ASS.mono);
    expect(style).toContain('&H0000FF&');       // rouge, en BGR
    expect(style).toContain('&HFFFFFF&');       // contour blanc
    expect(style.split(',')[7]).toBe('0');      // Bold = 0
    expect(style.split(',')[15]).toBe('1');     // BorderStyle : contour
    expect(style.split(',')[16]).toBe('3');     // Outline = 3
  });

  it('4.9 un fond de style devient une boîte opaque, pas un contour', () => {
    const d = documentAss({ largeur: 720, hauteur: 640 }, [couche('mot-par-mot', 'un', {
      habillage: {
        contour: null, ombre: null,
        fond: { opacite: 0.5, marge: 12, teinte: 'noir' },
      },
    })]);
    const style = d.split('\n').find((l) => l.startsWith('Style:'))!;
    expect(style.split(',')[15]).toBe('3');     // BorderStyle : boîte
    expect(style.split(',')[16]).toBe('12');
  });

  it('4.10 les temps sont au format d’ASS, au centième', () => {
    expect(tempsAss(0)).toBe('0:00:00.00');
    expect(tempsAss(65.437)).toBe('0:01:05.44');
    expect(tempsAss(-3)).toBe('0:00:00.00');
  });

  it('4.11 deux couches font deux styles, jamais un seul partagé', () => {
    const d = documentAss({ largeur: 720, hauteur: 640 }, [
      couche('mot-par-mot', 'un', { couleur: '#FF0000' }),
      couche('machine-a-ecrire', 'deux', { couleur: '#00FF00', yCentre: 500 }),
    ]);
    expect(d.split('\n').filter((l) => l.startsWith('Style:')).length).toBe(2);
    expect(d).toMatch(/^Dialogue: 0,[^,]*,[^,]*,S0,/m);
    expect(d).toMatch(/^Dialogue: 0,[^,]*,[^,]*,S1,/m);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le graphe — un seul filtre, aucune saisie dedans', () => {
  it('5.1 une couche animée sort du `drawtext` et entre dans `subtitles`', () => {
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte({
      fichierAss: '/tmp/rendu/textes.ass',
      dossierPolices: '/usr/share/fonts/truetype/liberation',
      textes: [texteAPoser({
        animationContenuId: 'mot-par-mot', texte: 'Bouge avec nous',
        police: 'sans', graisse: 'grasse',
      })],
    }));
    expect(style.post).toContain('subtitles=');
    expect(style.post).not.toContain('drawtext=');
    expect(style.documentAss).not.toBeNull();
    expect(style.documentAss).toContain('Bouge');
  });

  it('5.2 exactement UN filtre pour toutes les couches animées', () => {
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte({
      fichierAss: '/tmp/rendu/textes.ass',
      textes: [
        texteAPoser({ animationContenuId: 'machine-a-ecrire', texte: 'Un', police: 'sans' }),
        texteAPoser({ animationContenuId: 'mot-par-mot', texte: 'Deux et trois', police: 'sans' }),
        texteAPoser({ animationContenuId: 'mot-actif', texte: 'Quatre cinq', police: 'sans' }),
      ],
    }));
    expect((style.post.match(/subtitles=/g) ?? []).length).toBe(1);
    expect(style.documentAss!.split('\n').filter((l) => l.startsWith('Style:')).length).toBe(3);
  });

  it('5.3 une couche NON animée reste sur `drawtext` — rien n’a bougé pour elle', () => {
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte({
      fichierAss: '/tmp/rendu/textes.ass',
      textes: [texteAPoser({ texte: 'Bouge' })],
    }));
    expect(style.post).toContain('drawtext=');
    expect(style.post).not.toContain('subtitles=');
    expect(style.documentAss).toBeNull();
  });

  it('5.4 les deux familles cohabitent dans le même graphe', () => {
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte({
      fichierAss: '/tmp/rendu/textes.ass',
      textes: [
        texteAPoser({ texte: 'Fixe' }),
        texteAPoser({ animationContenuId: 'mot-par-mot', texte: 'Animé ici', police: 'sans' }),
      ],
    }));
    expect(style.post).toContain('drawtext=');
    expect(style.post).toContain('subtitles=');
    expect(style.post).toContain('[vout]');
  });

  it('5.5 le texte saisi n’entre JAMAIS dans le graphe de filtres', () => {
    const hostile = "Réserve : 50% ; c'est [aujourd'hui] !";
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte({
      fichierAss: '/tmp/rendu/textes.ass',
      textes: [texteAPoser({
        animationContenuId: 'mot-par-mot', texte: hostile, police: 'sans',
      })],
    }));
    expect(style.post).not.toContain('Réserve');
    expect(style.post).not.toContain('50%');
    expect(style.post).not.toContain("aujourd'hui");
    // Il est bien DANS le document, lui.
    expect(style.documentAss).toContain('Réserve');
  });

  it('5.6 sans chemin de document, aucune couche n’est perdue en silence', () => {
    // `fichierAss` absent : la couche retombe sur `drawtext`, donc du texte
    // fixe — jamais du vide.
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte({
      textes: [texteAPoser({ animationContenuId: 'mot-par-mot', texte: 'Bouge' })],
    }));
    expect(style.post).toContain('drawtext=');
    expect(style.documentAss).toBeNull();
  });

  it('5.7 les deux-points d’un chemin sont échappés', () => {
    const f = filtreSousTitres('/tmp/C:etrange/textes.ass', '/tmp/po:lices');
    expect(f).toContain('C\\:etrange');
    expect(f).toContain('po\\:lices');
    expect(f).toContain('fontsdir=');
  });

  it('5.8 le style neutre est resté neutre', () => {
    expect(STYLE_NEUTRE.documentAss).toBeNull();
    expect(STYLE_NEUTRE.post).toBe('');
  });

  it('5.9 le moteur écrit le document AVANT ffmpeg', () => {
    const moteur = sansProse(lire('src/lib/autopilot/analyse/rendu.ts'));
    const iEcriture = moteur.indexOf("textes.ass'), style.documentAss");
    const iEncodage = moteur.indexOf('await encoder(');
    expect(iEcriture).toBeGreaterThan(-1);
    expect(iEcriture).toBeLessThan(iEncodage);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Le rendu réel — mesuré sur des images, pas déduit', () => {
  const dossier = mkdtempSync(path.join(tmpdir(), 'a3c2-'));

  /** Bord gauche, bord droit et encre d’une image en niveaux de gris. */
  function etendue(fichier: string) {
    const brut = execFileSync('cat', [fichier]);
    let i = 0; let nl = 0;
    while (nl < 3 && i < brut.length) { if (brut[i] === 10) nl += 1; i += 1; }
    const px = brut.subarray(i);
    const W = 720; const H = 400;
    let gauche = -1; let droite = -1; let encre = 0;
    for (let x = 0; x < W; x += 1) {
      let col = 0;
      for (let y = 0; y < H; y += 1) col += px[y * W + x];
      if (col > 4000) { if (gauche < 0) gauche = x; droite = x; }
      encre += col;
    }
    return { gauche, largeur: droite - gauche, encre };
  }

  function image(nom: string, doc: string, t: number) {
    const ass = path.join(dossier, `${nom}.ass`);
    writeFileSync(ass, doc, 'utf8');
    const sortie = path.join(dossier, `${nom}-${t}.pgm`);
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi',
      '-i', 'color=c=black:s=720x400:d=4',
      '-vf', `${filtreSousTitres(ass, null)},format=gray`,
      '-ss', String(t), '-frames:v', '1', sortie]);
    return etendue(sortie);
  }

  it('6.1 le binaire sait lire un document ASS', () => {
    const conf = execFileSync(FF, ['-hide_banner', '-buildconf']).toString();
    expect(conf).toContain('--enable-libass');
  }, 30000);

  it('6.2 le texte se révèle vraiment, et la ligne NE BOUGE PAS', () => {
    const doc = documentAss({ largeur: 720, hauteur: 400 },
      [couche('machine-a-ecrire', 'BOUGE AVEC NOUS', { yCentre: 200 })]);
    const a = image('frappe', doc, 0.15);
    const b = image('frappe', doc, 1.0);
    const c = image('frappe', doc, 2.9);

    // Ce qui est écrit grandit.
    expect(b.largeur).toBeGreaterThan(a.largeur + 100);
    expect(c.largeur).toBeGreaterThan(b.largeur + 100);
    expect(c.encre).toBeGreaterThan(a.encre * 3);

    // ⚠️ LE BORD GAUCHE NE BOUGE PAS D'UN PIXEL. C'est la garantie du lot :
    // la mise en page est celle du texte final dès la première image.
    expect(b.gauche).toBe(a.gauche);
    expect(c.gauche).toBe(a.gauche);
  }, 60000);

  it('6.3 le mot par mot révèle aussi sans déplacer la ligne', () => {
    const doc = documentAss({ largeur: 720, hauteur: 400 },
      [couche('mot-par-mot', 'BOUGE AVEC NOUS', { yCentre: 200 })]);
    const a = image('mots', doc, 0.15);
    const c = image('mots', doc, 2.9);
    expect(c.largeur).toBeGreaterThan(a.largeur);
    expect(c.gauche).toBe(a.gauche);
  }, 60000);

  it('6.4 la surbrillance déplace l’intensité sans changer la ligne', () => {
    const doc = documentAss({ largeur: 720, hauteur: 400 },
      [couche('mot-actif', 'BOUGE AVEC NOUS', { yCentre: 200 })]);
    const a = image('actif', doc, 0.15);
    const c = image('actif', doc, 2.9);
    // Tout est lisible du début à la fin : la largeur ne change pas.
    expect(Math.abs(c.largeur - a.largeur)).toBeLessThan(8);
    expect(c.gauche).toBe(a.gauche);
    // Mais l'image, elle, n'est pas la même.
    expect(Math.abs(c.encre - a.encre)).toBeGreaterThan(20000);
  }, 60000);

  it('6.5 ⚠️ un texte hostile reste du texte : rien n’est exécuté', () => {
    const doc = documentAss({ largeur: 720, hauteur: 400 },
      [couche('mot-par-mot', '{\\c&H0000FF&}ROUGE ici', { yCentre: 200 })]);
    const ass = path.join(dossier, 'hostile.ass');
    writeFileSync(ass, doc, 'utf8');
    const png = path.join(dossier, 'hostile.rgb');
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi',
      '-i', 'color=c=black:s=720x400:d=4',
      '-vf', filtreSousTitres(ass, null),
      '-ss', '2.9', '-frames:v', '1', '-pix_fmt', 'rgb24',
      '-f', 'rawvideo', png]);
    const d = execFileSync('cat', [png]);
    let n = 0; let r = 0; let v = 0; let b = 0;
    for (let p = 0; p + 2 < d.length; p += 3) {
      if (d[p] + d[p + 1] + d[p + 2] > 450) { r += d[p]; v += d[p + 1]; b += d[p + 2]; n += 1; }
    }
    expect(n).toBeGreaterThan(500);
    // Le texte est BLANC. Si `\c&H0000FF&` avait été exécuté, il serait rouge.
    const moy = [r / n, v / n, b / n];
    expect(Math.abs(moy[0] - moy[2])).toBeLessThan(12);
    expect(moy[2]).toBeGreaterThan(180);
  }, 60000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Le contrat du profil — rétro-compatible par défaut', () => {
  it('7.1 le défaut est « aucune » : un profil d’hier rend comme hier', () => {
    expect(PROFIL_CREATIF_DEFAUT.animations.texteContenuId).toBe('aucune');
    const sansChamp = normaliserProfilCreatif({ animations: { texteId: 'aucune' } } as never);
    expect(sansChamp.animations.texteContenuId).toBe('aucune');
  });

  it('7.2 un identifiant inconnu est refusé, pas deviné', () => {
    const r = lireProfilCreatif({ animations: { texteContenuId: 'karaoke-maison' } });
    expect(r.ok).toBe(false);
  });

  it('7.3 un identifiant du catalogue est accepté et conservé', () => {
    const r = lireProfilCreatif({ animations: { texteContenuId: 'machine-a-ecrire' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profil.animations.texteContenuId).toBe('machine-a-ecrire');
  });

  it('7.4 le champ entre dans la forme canonique — donc dans l’identité du rendu', () => {
    const a = normaliserProfilCreatif({ animations: { texteContenuId: 'aucune' } } as never);
    const b = normaliserProfilCreatif({ animations: { texteContenuId: 'mot-par-mot' } } as never);
    expect(profilCreatifCanonique(a)).not.toBe(profilCreatifCanonique(b));
  });

  it('7.5 il ne remplace pas le mouvement du bloc : les deux se cumulent', () => {
    const r = lireProfilCreatif({
      animations: { texteId: 'fondu-doux', texteContenuId: 'mot-par-mot' },
    });
    if (r.ok) {
      expect(r.profil.animations.texteId).toBe('fondu-doux');
      expect(r.profil.animations.texteContenuId).toBe('mot-par-mot');
    } else {
      // Si `fondu-doux` n'existe pas dans le catalogue de blocs, au moins le
      // refus doit venir de LUI, pas du nouveau champ.
      expect(JSON.stringify(r)).not.toContain('texteContenuId');
    }
  });

  it('7.6 la couche transporte le réglage, et l’empreinte le voit', () => {
    const sans = preparerCouches(sources(null));
    const avec = preparerCouches(sources('mot-par-mot'));
    expect(sans[0].animationContenuId).toBeUndefined();
    expect(avec[0].animationContenuId).toBe('mot-par-mot');
    expect(empreinteCouches(sans)).not.toBe(empreinteCouches(avec));
  });

  it('7.7 un réglage inconnu arrivé jusqu’ici ne fabrique pas d’animation', () => {
    const c = preparerCouches(sources('inconnue-du-catalogue'));
    expect(c[0].animationContenuId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. La bibliothèque à l’écran', () => {
  const choisi: string[] = [];
  const rendre = (actif: string | null = null, exemple = 'Bouge avec nous') => render(
    <Bibliotheque
      animationActive={actif}
      exemple={exemple}
      onChoisir={(id) => choisi.push(id)}
    />,
  );

  it('8.1 elle montre les apparitions, « Aucune » comprise', () => {
    const { container } = rendre();
    const cartes = container.querySelectorAll('[data-contenu-carte]');
    expect(cartes.length).toBeGreaterThan(4);
    expect(container.querySelector('[data-contenu-carte="aucune"]')).not.toBeNull();
  });

  it('8.2 l’apparition ACTIVE est la première de « Pour vous »', () => {
    const { container } = rendre('mot-actif-lent');
    const premiere = container.querySelector('[data-contenu-carte]');
    expect(premiere?.getAttribute('data-contenu-carte')).toBe('mot-actif-lent');
    expect(premiere?.getAttribute('aria-pressed')).toBe('true');
  });

  it('8.3 la recherche accepte le mot français, sans accent obligatoire', () => {
    const { container } = rendre();
    const champ = container.querySelector('[data-contenu-recherche]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: 'machine a ecrire' } });
    const cartes = container.querySelectorAll('[data-contenu-carte]');
    expect(cartes.length).toBe(1);
    expect(cartes[0].getAttribute('data-contenu-carte')).toBe('machine-a-ecrire');
  });

  it('8.4 une recherche sans résultat le dit, elle ne montre pas une grille vide', () => {
    const { container } = rendre();
    const champ = container.querySelector('[data-contenu-recherche]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: 'zzzz' } });
    expect(container.querySelector('[data-contenu-vide]')).not.toBeNull();
  });

  it('8.5 choisir remonte l’identifiant, jamais un objet', () => {
    const { container } = rendre();
    const carte = container.querySelector('[data-contenu-carte="mot-par-mot"]') as HTMLElement;
    fireEvent.click(carte);
    expect(choisi[choisi.length - 1]).toBe('mot-par-mot');
  });

  it('8.6 les favoris ouvrent leur propre rayon', () => {
    const bascules: string[] = [];
    const { container } = render(
      <Bibliotheque
        animationActive={null}
        favoris={['mot-fondu']}
        onBasculerFavori={(id) => bascules.push(id)}
        onChoisir={() => {}}
      />,
    );
    const rayon = container.querySelector('[data-contenu-rayon="favoris"]') as HTMLElement;
    expect(rayon).not.toBeNull();
    fireEvent.click(rayon);
    const cartes = container.querySelectorAll('[data-contenu-carte]');
    expect(cartes.length).toBe(1);
    expect(cartes[0].getAttribute('data-contenu-carte')).toBe('mot-fondu');
    fireEvent.click(container.querySelector('[data-contenu-favori="mot-fondu"]') as HTMLElement);
    expect(bascules).toEqual(['mot-fondu']);
  });

  it('8.7 ⚠️ l’aperçu découpe le texte avec LE MÊME séquenceur que le moteur', () => {
    const { container } = rendre('mot-par-mot', 'Bouge avec nous');
    const carte = container.querySelector('[data-contenu-carte="mot-par-mot"]');
    expect(carte?.getAttribute('data-contenu-unites')).toBe('3');
    const carteFrappe = container.querySelector('[data-contenu-carte="machine-a-ecrire"]');
    // « Bouge avec nous » fait 15 caractères : sous le seuil, donc 15 unités.
    expect(carteFrappe?.getAttribute('data-contenu-unites')).toBe('15');
  });

  it('8.8 les délais de l’aperçu sortent de `decouperContenu`, pas d’un tableau écrit à la main', () => {
    const cal = calendrierApercu(anim('mot-par-mot'), 'un deux trois');
    const d = decouperContenu(anim('mot-par-mot'), 'un deux trois', 0, 2.4);
    expect(cal.delaisMs).toEqual(d.etapes.map((e) => Math.round(e.debutSecondes * 1000)));
    expect(sansProse(GRILLE)).toContain('decouperContenu');
  });

  it('8.9 l’aperçu affiche le texte tel que le rendu le montrera', () => {
    const cal = calendrierApercu(anim('mot-par-mot'), 'Prix {net}');
    // L'accolade est déjà devenue la parenthèse que la vidéo affichera.
    expect(cal.unites.join(' ')).toBe('Prix (net)');
  });

  it('8.10 la carte se fige quand le système demande moins de mouvement', () => {
    const { container } = rendre();
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*animation: none/);
  });

  it('8.11 chaque carte est atteignable au clavier et se décrit', () => {
    const { container } = rendre();
    const carte = container.querySelector('[data-contenu-carte="mot-fondu"]') as HTMLElement;
    expect(carte.tagName).toBe('BUTTON');
    expect(carte.getAttribute('aria-label')).toContain('Mots en fondu');
    expect(carte.getAttribute('title')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Les deux réglages sont nommés, et distincts', () => {
  it('9.1 « Mon style » porte les deux sections, en français', () => {
    expect(PANNEAU).toContain('Mouvement du bloc');
    expect(PANNEAU).toContain('Apparition du texte');
    expect(PANNEAU).toContain('BibliothequeAnimationsContenu');
    expect(PANNEAU).toContain('texteContenuId');
  });

  it('9.2 les deux bibliothèques ont leurs propres favoris et récents', () => {
    expect(PANNEAU).toContain('favorisContenu');
    expect(PANNEAU).toContain('recentsContenu');
    expect(PANNEAU).toContain('favorisAnimations');
  });

  it('9.3 aucun jargon de moteur à l’écran', () => {
    const visible = GRILLE.match(/>[^<>{}]{4,}</g) ?? [];
    for (const t of visible) {
      expect(t).not.toMatch(/\bASS\b|libass|drawtext|subtitles|alpha&H/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('10. Aucune régression de structure', () => {
  it('10.1 le générateur ne touche pas au disque : le build client en dépend', () => {
    expect(sansProse(ASS)).not.toMatch(/from\s+'node:fs'|require\('node:fs'\)/);
    expect(sansProse(MOTEUR)).not.toMatch(/from\s+'node:fs'|require\('node:fs'\)/);
  });

  it('10.2 aucun chemin de police ne vient du navigateur', () => {
    // Le document ne nomme que des FAMILLES, jamais des fichiers.
    const d = documentAss({ largeur: 720, hauteur: 400 }, [couche('mot-par-mot', 'un')]);
    expect(d).not.toContain('/');
    expect(Object.values(POLICE_ASS)).toContain('Liberation Sans');
  });

  it('10.3 le catalogue des blocs n’a pas été touché par ce lot', () => {
    expect(ANIMATIONS_TEXTE.length).toBe(19);
  });
});
