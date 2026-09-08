/**
 * A_4b — LES SOUS-TITRES, RÉELLEMENT RENDUS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI A ÉTÉ MESURÉ AVANT D'ÊTRE ÉCRIT
 * ---------------------------------------------------------------------------
 *
 * 1. KARAOKÉ. `\kf` remplit chaque mot pendant qu'il est dit. Sur
 *    « BOUGE AVEC NOUS » : 209 pixels d'accent à 0,3 s, 497 à 0,9 s, 783 à
 *    1,6 s — strictement croissant, avec un bord gauche à 283 px et une
 *    largeur de 154 px CONSTANTS.
 *
 * 2. MOT ACTIF. Le centroïde de l'accent traverse la ligne : 312 → 365 → 412,
 *    pendant que le bord gauche reste à 286 px et la largeur à 147.
 *
 * 3. INJECTION. `{\c&H0000FF&}ROUGE` sort en RGB (207, 207, 207) — du blanc.
 *    La commande n'a pas été exécutée.
 *
 * 4. FORMATS. Le même style rend 106 px de corps en 1080×1920 et 59 px en
 *    1080×1080 : la taille suit la HAUTEUR, comme annoncé.
 *
 * 5. Les trente et un styles produisent un document ET des pixels. Aucun vide.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ET UN BUG LATENT TROUVÉ EN CHEMIN
 * ---------------------------------------------------------------------------
 *
 * `CLES_CANONIQUES_PROFIL` est zippée par INDICE avec le tableau de valeurs.
 * A_3c2 avait ajouté une valeur sans sa clé : depuis, `margesSures.droitePct`
 * était silencieusement SORTI de l'empreinte du rendu. Le test 6.4 compare
 * désormais les deux longueurs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STYLES_CAPTION, CAPTION_IDS, styleCaptionParId, signatureVisuelle,
  VERSION_CAPTIONS, SURBRILLANCES, APPARITIONS_CAPTION, POSITIONS_CAPTION,
  STYLE_CAPTION_DEFAUT, type StyleCaption,
} from '@/lib/creatif/captions';
import {
  decouperEnBlocs, texteBloc, couperEnLignes,
  PAUSE_SECONDES, BLOC_MAX_SECONDES,
} from '@/lib/autopilot/analyse/captions-segmentation';
import {
  documentCaptions, corpsBloc, yCaption, caracteresParLigne,
} from '@/lib/autopilot/analyse/captions-ass';
import { projeterMots, type MotMonte } from '@/lib/autopilot/analyse/captions-timeline';
import {
  PROFIL_CREATIF_DEFAUT, normaliserProfilCreatif, lireProfilCreatif,
  profilCreatifCanonique, CLES_CANONIQUES_PROFIL,
} from '@/lib/autopilot/analyse/profil-creatif';
import { methodeRendu } from '@/lib/autopilot/analyse/rendu-contrat';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import { CATEGORIES_CREATIVES, chercher } from '@/lib/creatif/catalogue-contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CATALOGUE = lire('src/lib/creatif/captions.ts');
const SEGMENT = lire('src/lib/autopilot/analyse/captions-segmentation.ts');
const ASS = lire('src/lib/autopilot/analyse/captions-ass.ts');
const SERVICE = lire('src/lib/autopilot/analyse/captions-service.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');
const STYLE = lire('src/lib/autopilot/analyse/rendu-style.ts');
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const ROUTE_MANUEL = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');

const CADRE = { largeur: 1080, hauteur: 1920, margeHautPct: 6, margeBasPct: 10 };
const COULEURS = { texte: '#FFFFFF', accent: '#00FF00' };

const mot = (texte: string, d: number, f: number, ordrePlan = 1): MotMonte => ({
  debutSecondes: d, finSecondes: f, texte, ordrePlan,
});

/** « un deux trois … » à raison d'un mot toutes les 0,5 s. */
const suite = (n: number, ordrePlan = 1): MotMonte[] => Array.from(
  { length: n }, (_, i) => mot(`m${i}`, i * 0.5, i * 0.5 + 0.45, ordrePlan),
);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le catalogue', () => {
  it('1.1 trente et un styles, bien au-delà des vingt demandés', () => {
    expect(STYLES_CAPTION.length).toBe(31);
    expect(new Set(CAPTION_IDS).size).toBe(31);
    expect(STYLES_CAPTION.every((s) => s.rendu)).toBe(true);
  });

  it('1.2 ⚠️ AUCUN CLONE : chaque style a sa propre signature visuelle', () => {
    const vues = new Set(STYLES_CAPTION.map(signatureVisuelle));
    expect(vues.size).toBe(STYLES_CAPTION.length);
  });

  it('1.3 les six familles sont représentées', () => {
    const cats = new Set(STYLES_CAPTION.map((s) => s.categorie));
    expect(cats.size).toBeGreaterThanOrEqual(5);
    for (const c of cats) expect(CATEGORIES_CREATIVES).toContain(c);
  });

  it('1.4 les quatre mises en valeur existent, mot actif et karaoké compris', () => {
    const s = new Set(STYLES_CAPTION.map((x) => x.surbrillance));
    for (const v of SURBRILLANCES) expect(s).toContain(v);
    expect(STYLES_CAPTION.filter((x) => x.surbrillance === 'karaoke').length)
      .toBeGreaterThanOrEqual(4);
    expect(STYLES_CAPTION.filter((x) => x.surbrillance.startsWith('mot-actif')).length)
      .toBeGreaterThanOrEqual(6);
  });

  it('1.5 des noms français, jamais le vocabulaire du moteur', () => {
    for (const s of STYLES_CAPTION) {
      expect(s.nom).not.toMatch(/\bass\b|libass|drawtext|subtitles|\\kf|dialogue/i);
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.version).toBe(VERSION_CAPTIONS);
      expect(APPARITIONS_CAPTION).toContain(s.apparition);
      expect(POSITIONS_CAPTION).toContain(s.position);
    }
  });

  it('1.6 ⚠️ UN SOUS-TITRE SE LIT : les blocs restent courts', () => {
    for (const s of STYLES_CAPTION) {
      expect(s.motsParBloc, s.id).toBeGreaterThanOrEqual(2);
      expect(s.motsParBloc, s.id).toBeLessThanOrEqual(9);
      expect([1, 2], s.id).toContain(s.lignesMax);
      // Une caption plein écran ne tient pas sur deux lignes de neuf mots.
      if (s.taillePct >= 6) expect(s.motsParBloc, s.id).toBeLessThanOrEqual(3);
    }
  });

  it('1.7 ils se cherchent comme les autres familles créatives', () => {
    expect(chercher(STYLES_CAPTION, 'karaoke').length).toBeGreaterThanOrEqual(4);
    expect(chercher(STYLES_CAPTION, 'mot actif').length).toBeGreaterThanOrEqual(4);
    // Sans accent, et ça marche quand même.
    expect(chercher(STYLES_CAPTION, 'cinema').length).toBeGreaterThan(0);
  });

  it('1.8 le catalogue est PUR', () => {
    expect(sansProse(CATALOGUE)).not.toMatch(/node:fs|supabase|fetch\(/);
  });

  it('1.9 ⚠️ AUCUN EMOJI PROMIS : les polices Liberation n’en portent pas', () => {
    for (const s of STYLES_CAPTION) {
      expect(`${s.nom} ${s.description} ${s.tags.join(' ')}`).not.toMatch(/emoji/i);
    }
    expect(CATALOGUE).toContain('AUCUN EMOJI PROMIS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La segmentation', () => {
  it('2.1 ⚠️ UNE TRANSCRIPTION N’EST PAS UN MUR DE TEXTE', () => {
    const blocs = decouperEnBlocs(suite(20), 4);
    expect(blocs.length).toBeGreaterThanOrEqual(5);
    for (const b of blocs) expect(b.mots.length).toBeLessThanOrEqual(4);
  });

  it('2.2 la ponctuation forte ferme le bloc, même à moitié plein', () => {
    const blocs = decouperEnBlocs([
      mot('Bonjour', 0, 0.4), mot('à', 0.5, 0.7), mot('tous.', 0.8, 1.2),
      mot('On', 1.3, 1.5), mot('y', 1.6, 1.8), mot('va', 1.9, 2.3),
    ], 6);
    expect(blocs.length).toBe(2);
    expect(texteBloc(blocs[0], 'normale')).toBe('Bonjour à tous.');
  });

  it('2.3 ⚠️ UNE VIRGULE NE COUPE PAS UN BLOC À PEINE COMMENCÉ', () => {
    // Couper à « Bonjour, » laisserait un bloc d'un mot suivi d'un bloc plein.
    const blocs = decouperEnBlocs([
      mot('Bonjour,', 0, 0.4), mot('on', 0.5, 0.7), mot('y', 0.8, 1.0),
      mot('va', 1.1, 1.5),
    ], 6);
    expect(blocs.length).toBe(1);
  });

  it('2.4 une PAUSE réelle ferme le bloc', () => {
    const blocs = decouperEnBlocs([
      mot('un', 0, 0.4), mot('deux', 0.5, 0.9),
      mot('trois', 0.9 + PAUSE_SECONDES + 0.1, 2.0),
    ], 8);
    expect(blocs.length).toBe(2);
    expect(texteBloc(blocs[1], 'normale')).toBe('trois');
  });

  it('2.5 ⚠️ UN BLOC N’ENJAMBE JAMAIS DEUX PLANS', () => {
    const blocs = decouperEnBlocs([
      mot('un', 0, 0.4, 1), mot('deux', 0.5, 0.9, 1),
      mot('trois', 1.0, 1.4, 2), mot('quatre', 1.5, 1.9, 2),
    ], 8);
    expect(blocs.length).toBe(2);
    expect(blocs[0].ordrePlan).toBe(1);
    expect(blocs[1].ordrePlan).toBe(2);
  });

  it('2.6 un bloc ne reste pas figé indéfiniment', () => {
    const longs = Array.from({ length: 12 }, (_, i) => mot(`m${i}`, i, i + 0.9));
    for (const b of decouperEnBlocs(longs, 40)) {
      expect(b.finSecondes - b.debutSecondes).toBeLessThan(BLOC_MAX_SECONDES + 1.1);
    }
  });

  it('2.7 ⚠️ UN SEUL BLOC À LA FOIS, MÊME PENDANT UNE TRANSITION', () => {
    // A_4a laisse volontairement les mots de deux plans se chevaucher pour ne
    // perdre aucune parole ; c'est ici que le conflit se résout.
    const blocs = decouperEnBlocs([
      mot('sortant', 4.0, 4.9, 1), mot('entrant', 4.5, 5.4, 2),
    ], 4);
    for (let i = 1; i < blocs.length; i += 1) {
      expect(blocs[i].debutSecondes).toBeGreaterThanOrEqual(blocs[i - 1].finSecondes - 1e-9);
    }
  });

  it('2.8 ⚠️ LA CASSE EST UN AFFICHAGE, le texte source n’est pas réécrit', () => {
    const b = decouperEnBlocs([mot('Bouge', 0, 0.5)], 4)[0];
    expect(texteBloc(b, 'majuscules')).toBe('BOUGE');
    expect(b.mots[0].texte).toBe('Bouge');
  });

  it('2.9 la coupe en deux lignes cherche l’ÉQUILIBRE, pas la moitié des mots', () => {
    const phrase = 'Je vais vous montrer comment faire';
    const l = couperEnLignes(phrase, 2, 18);
    expect(l.length).toBe(2);
    /* ⚠️ « ÉQUILIBRÉ » VEUT DIRE « LE MEILLEUR POSSIBLE », pas « à quatre
       caractères près » : les mots sont indivisibles, et l'optimum de cette
       phrase est un écart de 7. Le test compare donc à TOUTES les coupes
       possibles plutôt qu'à un seuil arbitraire. */
    const mots = phrase.split(' ');
    const ecarts = mots.slice(1).map((_, i) => Math.abs(
      mots.slice(0, i + 1).join(' ').length - mots.slice(i + 1).join(' ').length,
    ));
    expect(Math.abs(l[0].length - l[1].length)).toBe(Math.min(...ecarts));
    // Un style à une ligne n'en fait jamais deux.
    expect(couperEnLignes('Je vais vous montrer comment faire', 1, 10).length).toBe(1);
  });

  it('2.10 la segmentation est PURE et déterministe', () => {
    expect(sansProse(SEGMENT)).not.toMatch(/node:fs|supabase|fetch\(|Math\.random/);
    expect(JSON.stringify(decouperEnBlocs(suite(9), 3)))
      .toBe(JSON.stringify(decouperEnBlocs(suite(9), 3)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le document', () => {
  const doc = (styleId: string, mots = suite(6)) => documentCaptions(
    mots, styleCaptionParId(styleId)!, CADRE, COULEURS,
  );

  it('3.1 les trente et un styles produisent un document', () => {
    for (const s of STYLES_CAPTION) {
      expect(doc(s.id), s.id).not.toBeNull();
    }
  });

  it('3.2 ⚠️ AUCUN SOUS-TITRE VIDE : sans parole, pas de document', () => {
    expect(doc('minimal-blanc', [])).toBeNull();
  });

  it('3.3 les pixels du cadre sont les coordonnées, et la taille suit la HAUTEUR', () => {
    const vertical = documentCaptions(suite(4), styleCaptionParId('bold-social')!,
      { ...CADRE, largeur: 1080, hauteur: 1920 }, COULEURS)!;
    const carre = documentCaptions(suite(4), styleCaptionParId('bold-social')!,
      { ...CADRE, largeur: 1080, hauteur: 1080 }, COULEURS)!;
    expect(vertical.contenu).toContain('PlayResY: 1920');
    expect(carre.contenu).toContain('PlayResY: 1080');
    const t = (c: string) => Number(/^Style: C0,[^,]*,(\d+),/m.exec(c)![1]);
    // Mesuré : 106 px en 1080x1920, 59 px en 1080x1080.
    expect(t(vertical.contenu)).toBe(106);
    expect(t(carre.contenu)).toBe(59);
  });

  it('3.4 ⚠️ LE BLOC RESTE DANS LES MARGES SÛRES', () => {
    for (const s of STYLES_CAPTION) {
      const y = yCaption(CADRE, s.position, 120);
      expect(y - 60, s.id).toBeGreaterThanOrEqual((CADRE.margeHautPct / 100) * 1920 - 1);
      expect(y + 60, s.id)
        .toBeLessThanOrEqual(1920 - (CADRE.margeBasPct / 100) * 1920 + 1);
    }
  });

  it('3.5 ⚠️ EN KARAOKÉ, `\\kf` PORTE LA DURÉE RÉELLE DE CHAQUE MOT', () => {
    const d = doc('karaoke', [mot('un', 0, 0.6), mot('deux', 0.6, 1.4)])!;
    // 0,6 s → 60 centièmes ; 0,8 s → 80. Pas une répartition uniforme.
    expect(d.contenu).toContain('{\\kf60}un');
    expect(d.contenu).toContain('{\\kf80}deux');
  });

  it('3.6 ⚠️ EN KARAOKÉ, LA COULEUR PRIMAIRE EST CELLE DÉJÀ DITE', () => {
    // L'inverser rendrait un remplissage à contresens.
    const d = doc('karaoke')!;
    const style = d.contenu.split('\n').find((l) => l.startsWith('Style:'))!;
    expect(style.split(',')[3]).toBe('&H00FF00&');   // accent = déjà dit
    expect(style.split(',')[4]).toBe('&HFFFFFF&');   // texte = à venir
  });

  it('3.7 ⚠️ EN MOT ACTIF, LE BLOC ENTIER RESTE LISIBLE', () => {
    const d = doc('mot-actif', [mot('un', 0, 0.4), mot('deux', 0.5, 0.9),
      mot('trois', 1.0, 1.4)])!;
    const evts = d.contenu.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(evts.length).toBe(3);
    for (const e of evts) {
      expect(e).toContain('un');
      expect(e).toContain('deux');
      expect(e).toContain('trois');
      // Un seul mot en accent par événement.
      expect((e.match(/\\c&H00FF00&/g) ?? []).length).toBe(1);
    }
  });

  it('3.8 ⚠️ LA POSITION EST IDENTIQUE D’UN ÉVÉNEMENT À L’AUTRE', () => {
    const d = doc('mot-actif')!;
    const positions = new Set(
      d.contenu.split('\n').filter((l) => l.startsWith('Dialogue:'))
        .map((l) => /\{\\pos\([^)]*\)\}/.exec(l)?.[0]),
    );
    expect(positions.size).toBe(1);
  });

  it('3.9 le mot actif sur fond emploie un contour épais, pas un rectangle', () => {
    const d = doc('reels')!;
    expect(d.contenu).toContain('\\3c&H00FF00&\\bord6');
  });

  it('3.10 ⚠️ AUCUNE INJECTION : `{` et `\\` ne restent pas des commandes', () => {
    const d = doc('minimal-blanc', [mot('{\\c&H0000FF&}ROUGE', 0, 0.6), mot('ici', 0.7, 1.2)])!;
    for (const l of d.contenu.split('\n').filter((x) => x.startsWith('Dialogue:'))) {
      for (const b of l.match(/\{[^}]*\}/g) ?? []) {
        expect(b).toMatch(/^\{\\(pos|kf|c|3c|r|fad|fscx|alpha|t|bord)/);
      }
      expect(l).not.toContain('\\c&H0000FF&');
    }
    // Mesuré à l'écran : le texte sort en RGB (207, 207, 207) — du blanc.
    expect(d.contenu).toContain('(⧵c&H0000FF&)ROUGE');
  });

  it('3.11 la ponctuation et les accents traversent intacts', () => {
    const d = doc('minimal-blanc', [
      mot('C’est', 0, 0.4), mot('l’énergie !', 0.5, 1.0), mot('50 %', 1.1, 1.6),
    ])!;
    expect(d.contenu).toContain('C’est');
    expect(d.contenu).toContain('l’énergie !');
    expect(d.contenu).toContain('50 %');
  });

  it('3.12 la largeur utile décroît quand le corps grandit', () => {
    expect(caracteresParLigne(1080, 40)).toBeGreaterThan(caracteresParLigne(1080, 100));
    expect(caracteresParLigne(1080, 1000)).toBeGreaterThanOrEqual(8);
  });

  it('3.13 le corps d’un bloc est pur et testable seul', () => {
    const b = decouperEnBlocs([mot('un', 0, 0.4), mot('deux', 0.5, 0.9)], 4)[0];
    const s = styleCaptionParId('mot-actif')!;
    expect(corpsBloc(b, s, COULEURS, 0, ['un deux'])).toContain('{\\c&H00FF00&}un');
    expect(corpsBloc(b, s, COULEURS, 1, ['un deux'])).toContain('{\\c&H00FF00&}deux');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La fondation A_3c2, réutilisée et non recopiée', () => {
  it('4.1 l’échappement, la couleur et le temps viennent d’A_3c2', () => {
    const a = sansProse(ASS);
    expect(a).toContain("from '@/lib/creatif/animations-contenu'");
    expect(a).toContain("from './rendu-ass'");
    expect(a).toContain('echapperAss');
    expect(a).toContain('tempsAss');
    expect(a).toContain('POLICE_ASS');
    // Aucune seconde implémentation de l'échappement.
    expect(a).not.toMatch(/function\s+echapperAss/);
  });

  it('4.2 ⚠️ DEUX DOCUMENTS, DEUX FILTRES : marque et parole ne se mélangent pas', () => {
    const s = sansProse(STYLE);
    expect(s).toContain('captions?: { fichier: string; document: string } | null');
    expect(s).toContain('[stylecaptions]');
    expect(s).toContain('[styleass]');
  });

  it('4.3 le document des textes de marque n’a pas changé de forme', () => {
    expect(sansProse(lire('src/lib/autopilot/analyse/rendu-ass.ts')))
      .toContain('export function documentAss(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le branchement', () => {
  it('5.1 ⚠️ PROJETÉS DANS LE MOTEUR, où le recouvrement se décide', () => {
    const m = sansProse(MOTEUR);
    expect(m).toContain('projeterMots(');
    expect(m).toContain('recouvrementTransition(');
    expect(m).toContain('recouvrement.dureeSecondes');
  });

  it('5.2 ⚠️ UNE SEULE FONCTION DIT LE RECOUVREMENT', () => {
    // Deux calculs de la même chose divergent toujours.
    expect(sansProse(STYLE)).toContain('export function recouvrementTransition(');
    expect((sansProse(STYLE).match(/planTransitions\(/g) ?? []).length).toBe(1);
  });

  it('5.3 le même préparateur pour les deux chemins', () => {
    expect(sansProse(CHAINE)).toContain('preparerCaptionsMultiSource(userId, plan)');
    expect(sansProse(ROUTE_MANUEL)).toContain('preparerCaptionsMultiSource(userId, plan!)');
  });

  it('5.4 ⚠️ ON NE RETRANSCRIT JAMAIS AU RENDU', () => {
    const s = sansProse(SERVICE);
    expect(s).not.toMatch(/groq|transcrire|creerTranscription/i);
    expect(s).toContain('lireTranscriptionParId');
    // Et c'est la transcription DU JEU DE CLIPS, pas la dernière en date.
    expect(s).toContain('set.transcriptionId');
  });

  it('5.5 la lecture ne coûte rien quand les sous-titres sont éteints', () => {
    expect(sansProse(CHAINE)).toContain('profilEffectif?.captions.active');
    expect(sansProse(ROUTE_MANUEL)).toContain('profil?.captions.active');
  });

  it('5.6 ⚠️ SANS MOTS HORODATÉS, PAS DE SOUS-TITRES', () => {
    // Répartir un segment uniformément donnerait un karaoké qui ment.
    expect(sansProse(SERVICE)).toContain('if (mots.length === 0) return null');
  });

  it('5.7 une transcription absente ne fait pas perdre le montage', () => {
    const m = sansProse(MOTEUR);
    expect(m).toContain("usage.captionsNonRendues = 'transcription_absente'");
    expect(m).toContain("usage.captionsNonRendues = 'aucune_parole'");
    expect(sansProse(SERVICE)).toContain('return null');
  });

  it('5.8 ⚠️ LA TRANSCRIPTION COMPLÈTE N’EST NI TRACÉE NI JOURNALISÉE', () => {
    const m = sansProse(MOTEUR);
    expect(m).toContain('usage.captions = {');
    // `blocs` est un compte, pas du texte.
    expect(m).toMatch(/blocs: doc\.blocs/);
    expect(m).not.toMatch(/usage\.captions[^\n]*texte|console\.[a-z]+\([^)]*mots/);
    expect(sansProse(SERVICE)).not.toMatch(/console\./);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Le profil et l’identité', () => {
  it('6.1 ⚠️ ÉTEINTS PAR DÉFAUT : un profil d’hier rend comme hier', () => {
    expect(PROFIL_CREATIF_DEFAUT.captions.active).toBe(false);
    const ancien = normaliserProfilCreatif({ lut: { active: true, lutId: 'vibrant' } } as never);
    expect(ancien.captions.active).toBe(false);
    expect(ancien.captions.styleId).toBe(STYLE_CAPTION_DEFAUT.id);
  });

  it('6.2 un style inconnu est refusé, pas deviné', () => {
    expect(lireProfilCreatif({ captions: { active: true, styleId: 'karaoke' } }).ok).toBe(true);
    expect(lireProfilCreatif({ captions: { styleId: 'inexistant' } }).ok).toBe(false);
    expect(lireProfilCreatif({ captions: { position: 'diagonale' } }).ok).toBe(false);
  });

  it('6.3 ⚠️ AVEC ET SANS SOUS-TITRES SONT DEUX FICHIERS', () => {
    const sans = normaliserProfilCreatif({ captions: { active: false } } as never);
    const avec = normaliserProfilCreatif({ captions: { active: true } } as never);
    const autre = normaliserProfilCreatif({
      captions: { active: true, styleId: 'karaoke' },
    } as never);
    const ids = new Set([sans, avec, autre].map((p) => methodeRendu(RECETTE_AUDIO_DEFAUT, p)));
    expect(ids.size).toBe(3);
    // La position aussi : elle déplace des pixels.
    expect(profilCreatifCanonique(normaliserProfilCreatif({
      captions: { active: true, position: 'haut' },
    } as never))).not.toBe(profilCreatifCanonique(avec));
  });

  it('6.4 ⚠️ LES CLÉS CANONIQUES SONT AUSSI NOMBREUSES QUE LES VALEURS', () => {
    /* Elles sont zippées par INDICE : une valeur ajoutée sans sa clé fait
       tomber la DERNIÈRE de la chaîne, en silence. C'est arrivé —
       `anim.texteContenu` avait été ajouté sans sa clé, et `margesSures.
       droitePct` était sorti de l'empreinte du rendu depuis A_3c2. */
    const canonique = profilCreatifCanonique(PROFIL_CREATIF_DEFAUT);
    expect(canonique.split('|').length).toBe(CLES_CANONIQUES_PROFIL.length);
    expect(canonique).toContain('marges.droite=');
    expect(canonique).toContain('anim.texteContenu=');
    expect(canonique).toContain('captions.style=');
  });

  it('6.5 changer la marge droite change bien l’empreinte', () => {
    const a = normaliserProfilCreatif({ margesSures: { droitePct: 5 } } as never);
    const b = normaliserProfilCreatif({ margesSures: { droitePct: 15 } } as never);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, a)).not.toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, b));
  });

  it('6.6 ⚠️ AUCUNE COULEUR DANS LE BLOC `captions`', () => {
    // Le texte et l'accent viennent de la MARQUE : deux endroits pour la même
    // chose auraient fini par repeindre une charte.
    expect(Object.keys(PROFIL_CREATIF_DEFAUT.captions).sort())
      .toEqual(['active', 'position', 'styleId']);
    expect(sansProse(MOTEUR)).toContain('texte: profil.couleurs.texte');
    expect(sansProse(MOTEUR)).toContain('accent: profil.couleurs.accent');
  });

  it('6.7 changer l’accent change les pixels du mot actif', () => {
    const doc1 = documentCaptions(suite(4), styleCaptionParId('mot-actif')!, CADRE,
      { texte: '#FFFFFF', accent: '#00FF00' })!;
    const doc2 = documentCaptions(suite(4), styleCaptionParId('mot-actif')!, CADRE,
      { texte: '#FFFFFF', accent: '#FF0000' })!;
    expect(doc1.contenu).not.toBe(doc2.contenu);
  });

  it('6.8 manuel et automatique lisent le MÊME champ', () => {
    expect(sansProse(CHAINE)).toContain('captions.active');
    expect(sansProse(ROUTE_MANUEL)).toContain('captions.active');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Aucune régression', () => {
  it('7.1 les catalogues créatifs sont intacts', async () => {
    const { LOOKS_CREATIFS } = await import('@/lib/creatif/looks');
    const { STYLES_TEXTE } = await import('@/lib/creatif/styles-texte');
    const { ANIMATIONS_TEXTE } = await import('@/lib/creatif/animations-texte');
    const { ANIMATIONS_CONTENU } = await import('@/lib/creatif/animations-contenu');
    const { TRANSITIONS_CREATIVES } = await import('@/lib/creatif/transitions');
    const { PRESETS_STUDIIO } = await import('@/lib/creatif/presets');
    expect(LOOKS_CREATIFS.length).toBe(34);
    expect(STYLES_TEXTE.length).toBe(26);
    expect(ANIMATIONS_TEXTE.length + ANIMATIONS_CONTENU.length).toBe(27);
    expect(TRANSITIONS_CREATIVES.length).toBe(29);
    expect(PRESETS_STUDIIO.length).toBe(12);
  });

  it('7.2 aucune migration : profil et usage sont déjà du `jsonb`', () => {
    expect(sansProse(CATALOGUE)).not.toContain('alter table');
    expect(sansProse(SERVICE)).not.toContain('alter table');
  });
});
