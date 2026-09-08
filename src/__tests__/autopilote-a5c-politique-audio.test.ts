/**
 * A_5c — VARIER LA MUSIQUE SANS TIRER AU SORT.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI `Math.random()` EST INTERDIT ICI AUSSI
 * ---------------------------------------------------------------------------
 *
 * La recette entre dans l'identité du rendu. Avec du hasard, chaque tentative
 * d'un cron qui réessaie changerait de bande-son — donc d'identité — et
 * `lireRenduReussiIdentique` ne retrouverait jamais rien.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ET POURQUOI C'EST UNE POLITIQUE À PART
 * ---------------------------------------------------------------------------
 *
 * Une LUT est une entrée d'un catalogue partagé ; une musique est un FICHIER
 * du compte, avec une durée, des droits et une existence propre. Les fondre
 * aurait obligé `StylePreset` à porter une clé de stockage — donc à refuser
 * chaque preset personnel déjà enregistré.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MODES_AUDIO, LIBELLES_MODE_AUDIO, DESCRIPTIONS_MODE_AUDIO,
  resoudreMusiqueEffective, historiqueAudioDepuisUsages,
} from '@/lib/autopilot/analyse/politique-audio';
import { graineCreative } from '@/lib/autopilot/analyse/politique-creative';
import {
  POLITIQUE_STRICTE, politiqueValide, politiqueVide, bibliothequeValide,
} from '@/lib/creatif/bibliotheque';
import {
  RECETTE_AUDIO_DEFAUT, recetteCanonique, normaliserRecette,
} from '@/lib/autopilot/analyse/recette-audio';
import type { PisteAudio } from '@/lib/creatif/audio';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const POLITIQUE = lire('src/lib/autopilot/analyse/politique-audio.ts');
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');
const ROUTE_MANUEL = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');

const U = 'user-42';
const cle = (n: string) => `${U}/musiques/${n}.mp3`;
const piste = (n: string): PisteAudio => ({
  cle: cle(n), nom: n, moods: [], dureeMs: 180_000, silenceInitialMs: 0,
  octets: 4_000_000, empreinte: `4000000-${n}`,
  droitsConfirmesLe: '2026-09-08T10:00:00.000Z',
});
const BANQUE = ['a', 'b', 'c', 'd'].map(piste);
const COURANTE = { bucket: 'audio', cle: cle('a') };

const resoudre = (
  autorisees: string[], graine: string, historique: string[] = [],
  courante: typeof COURANTE | null = COURANTE,
) => resoudreMusiqueEffective(courante, 'varier', autorisees, BANQUE, { graine, historique });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les deux modes', () => {
  it('1.1 deux modes, nommés en français', () => {
    expect([...MODES_AUDIO]).toEqual(['fixe', 'varier']);
    for (const m of MODES_AUDIO) {
      expect(LIBELLES_MODE_AUDIO[m].length).toBeGreaterThan(5);
      expect(DESCRIPTIONS_MODE_AUDIO[m].length).toBeGreaterThan(20);
    }
  });

  it('1.2 le défaut est « fixe » : rien ne change pour personne', () => {
    expect(POLITIQUE_STRICTE.audioMode).toBe('fixe');
    expect(politiqueValide({}).audioMode).toBe('fixe');
    expect(politiqueValide({ audioMode: 'chaos' }).audioMode).toBe('fixe');
    expect(politiqueVide(POLITIQUE_STRICTE)).toBe(true);
    expect(politiqueVide({ ...POLITIQUE_STRICTE, audioMode: 'varier' })).toBe(false);
  });

  it('1.3 ⚠️ IL EST SÉPARÉ DU MODE CRÉATIF', () => {
    // Quelqu'un peut vouloir une marque strictement fixe ET des musiques qui
    // tournent — ou l'inverse.
    const p = politiqueValide({ mode: 'marque-stricte', audioMode: 'varier' });
    expect(p.mode).toBe('marque-stricte');
    expect(p.audioMode).toBe('varier');
  });

  it('1.4 en mode FIXE, la recette part telle quelle', () => {
    const r = resoudreMusiqueEffective(COURANTE, 'fixe', [cle('b')], BANQUE,
      { graine: 'g', historique: [] });
    expect(r.musique).toBe(COURANTE);
    expect(r.varie).toBe(false);
    expect(r.raison).toContain('fixe');
  });

  it('1.5 ⚠️ LA CHAÎNE NE TOUCHE À RIEN dans ce mode', () => {
    expect(sansProse(CHAINE)).toContain("biblio.automatisation.audioMode !== 'fixe'");
    expect(sansProse(CHAINE)).toContain('let recetteEffective = d.recette;');
  });

  it('1.6 il survit à l’aller-retour de persistance', () => {
    const b = bibliothequeValide({
      automatisation: { mode: 'marque-stricte', audioMode: 'varier' },
    }, U);
    expect(b.automatisation.audioMode).toBe('varier');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le déterminisme', () => {
  it('2.1 ⚠️ AUCUN HASARD', () => {
    expect(sansProse(POLITIQUE)).not.toMatch(/Math\.random|Date\.now|new Date\(/);
  });

  it('2.2 ⚠️ MÊME GRAINE, MÊME HISTORIQUE → MÊME MUSIQUE (le retry)', () => {
    const g = graineCreative(U, 'plan-7', 2, 'politique-v1');
    const h = [cle('b')];
    const a = resoudre(BANQUE.map((p) => p.cle), g, h);
    const b = resoudre(BANQUE.map((p) => p.cle), g, h);
    expect(a.musique?.cle).toBe(b.musique?.cle);
    expect(a.raison).toBe(b.raison);
  });

  it('2.3 des plans différents peuvent donner des musiques différentes', () => {
    const vues = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      vues.add(resoudre(BANQUE.map((p) => p.cle),
        graineCreative(U, `plan-${i}`, 1, 'v')).musique!.cle);
    }
    // ⚠️ PAS « TOUTES DIFFÉRENTES » : quatre options, douze tirages. Ce qui
    // est inacceptable, c'est douze fois la MÊME.
    expect(vues.size).toBeGreaterThan(1);
  });

  it('2.4 ⚠️ DOUZE VIDÉOS NE DONNENT PAS DOUZE FOIS LE MÊME MORCEAU', () => {
    const historique: string[] = [];
    const vues = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      const r = resoudre(BANQUE.map((p) => p.cle),
        graineCreative(U, `plan-${i}`, 1, 'v'), [...historique]);
      historique.unshift(r.musique!.cle);
      vues.add(r.musique!.cle);
    }
    expect(vues.size).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Ce qui est autorisé, et rien d’autre', () => {
  it('3.1 ⚠️ UNE MUSIQUE HORS LISTE N’EST JAMAIS CHOISIE', () => {
    for (let i = 0; i < 30; i += 1) {
      const r = resoudre([cle('b'), cle('c')], `g${i}`);
      expect([cle('b'), cle('c')]).toContain(r.musique!.cle);
    }
  });

  it('3.2 une seule autorisée : toujours celle-là', () => {
    for (let i = 0; i < 8; i += 1) {
      expect(resoudre([cle('d')], `g${i}`).musique!.cle).toBe(cle('d'));
    }
  });

  it('3.3 ⚠️ DEUX AUTORISÉES : PAS DE CUL-DE-SAC AU TROISIÈME RENDU', () => {
    // Une pénalité PLATE interdirait tout ce qui a servi et bloquerait ici.
    const historique: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = resoudre([cle('a'), cle('b')], graineCreative(U, `p${i}`, 1, 'v'),
        [...historique]);
      expect(r.musique).not.toBeNull();
      historique.unshift(r.musique!.cle);
    }
    expect(new Set(historique).size).toBe(2);
  });

  it('3.4 ⚠️ UNE CLÉ AUTORISÉE MAIS RETIRÉE DE LA BANQUE EST IGNORÉE', () => {
    // Choisir une musique introuvable perdrait le montage pour une liste
    // qu'on a oublié de nettoyer.
    const r = resoudre([cle('disparue'), cle('c')], 'g');
    expect(r.musique!.cle).toBe(cle('c'));
  });

  it('3.5 aucune autorisée disponible : la musique du compte est conservée', () => {
    const r = resoudre([cle('disparue')], 'g');
    expect(r.musique).toBe(COURANTE);
    expect(r.varie).toBe(false);
    expect(r.raison).toContain('Aucune musique autorisée');
  });

  it('3.6 aucune autorisée ET aucune musique : le montage reste sans musique', () => {
    const r = resoudre([], 'g', [], null);
    expect(r.musique).toBeNull();
    expect(r.raison).toContain('sans musique');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’anti-répétition', () => {
  it('4.1 ⚠️ UNE MUSIQUE RÉCENTE COÛTE PLUS CHER', () => {
    const g = graineCreative(U, 'plan-3', 1, 'v');
    const seule = resoudre(BANQUE.map((p) => p.cle), g).musique!.cle;
    const apres = resoudre(BANQUE.map((p) => p.cle), g, [seule]).musique!.cle;
    expect(apres).not.toBe(seule);
  });

  it('4.2 la pénalité est GRADUÉE : l’ancienneté la fait fondre', () => {
    const g = graineCreative(U, 'plan-5', 1, 'v');
    const recent = resoudre(BANQUE.map((p) => p.cle), g).musique!.cle;
    // Le même morceau, mais dix vidéos plus tôt : il redevient éligible.
    const vieux = Array.from({ length: 10 }, (_, i) => cle(`x${i}`));
    const r = resoudre(BANQUE.map((p) => p.cle), g, [...vieux, recent]);
    expect(r.musique).not.toBeNull();
  });

  it('4.3 l’historique se lit dans `usage.creatif`, pas dans une liste à part', () => {
    expect(historiqueAudioDepuisUsages([
      { creatif: { musicTrackId: cle('b') } },
      {},
      { creatif: { musicTrackId: null } },
      { creatif: { musicTrackId: cle('a') } },
    ])).toEqual([cle('b'), cle('a')]);
  });

  it('4.4 ⚠️ L’HISTORIQUE N’EST LU QU’UNE FOIS POUR LES DEUX POLITIQUES', () => {
    const c = sansProse(CHAINE);
    expect((c.match(/listerCreatifsRecents\(userId\)/g) ?? []).length).toBe(1);
    expect(c).toContain('historiqueAudioDepuisUsages(historiqueUsages)');
    expect(c).toContain('historiqueDepuisUsages(historiqueUsages)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. L’identité du rendu', () => {
  it('5.1 ⚠️ SANS VERSION, LA CHAÎNE CANONIQUE EST CELLE D’AVANT CE LOT', () => {
    // C'est ce qui préserve les rendus déjà réussis.
    expect(recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: cle('a') },
    })).toContain(`musique=audio:${cle('a')}`);
    expect(recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: cle('a') },
    })).not.toContain('@');
  });

  it('5.2 ⚠️ DEUX FICHIERS SOUS LA MÊME CLÉ = DEUX IDENTITÉS', () => {
    const v1 = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT,
      musique: { bucket: 'audio', cle: cle('a'), version: '1000-aaa' },
    });
    const v2 = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT,
      musique: { bucket: 'audio', cle: cle('a'), version: '2000-bbb' },
    });
    expect(v1).not.toBe(v2);
    expect(v1).toContain('@1000-aaa');
  });

  it('5.3 la version traverse la normalisation', () => {
    const n = normaliserRecette({
      ...RECETTE_AUDIO_DEFAUT,
      musique: { bucket: 'audio', cle: cle('a'), version: 'v1' },
    });
    expect(n.musique?.version).toBe('v1');
  });

  it('5.4 deux musiques différentes = deux identités', () => {
    const a = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: cle('a') },
    });
    const b = recetteCanonique({
      ...RECETTE_AUDIO_DEFAUT, musique: { bucket: 'audio', cle: cle('b') },
    });
    expect(a).not.toBe(b);
  });

  it('5.5 le choix effectif entre dans l’identité du rendu automatique', () => {
    const c = sansProse(CHAINE);
    expect(c).toContain('methodeRendu(recetteEffective, profilEffectif, appelAction)');
    expect(c).toContain('recette: recetteEffective');
  });

  it('5.6 l’empreinte accompagne le choix retenu', () => {
    const r = resoudre([cle('c')], 'g');
    expect(r.musique?.version).toBe('4000000-c');
    expect(r.empreinte).toBe('4000000-c');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La trace, et le chemin manuel', () => {
  it('6.1 le rendu mémorise la piste et sa version', () => {
    const m = sansProse(MOTEUR);
    expect(m).toContain('musicTrackId:');
    expect(m).toContain('musicAssetVersion:');
  });

  it('6.2 ⚠️ AUCUNE URL DANS LA TRACE — `usage` la refuserait de toute façon', () => {
    expect(sansProse(MOTEUR)).not.toMatch(/musicUrl|usage[^\n]*https?:/);
  });

  it('6.3 ⚠️ LE CHEMIN MANUEL NE VARIE RIEN', () => {
    const manuel = sansProse(ROUTE_MANUEL);
    expect(manuel).not.toContain('resoudreMusiqueEffective');
    expect(manuel).toContain('methodeRendu(recette, profil, appelAction)');
  });

  it('6.4 seul le chemin automatique résout la politique', () => {
    expect(sansProse(CHAINE)).toContain('resoudreMusiqueEffective(');
  });

  it('6.5 les deux raisons voyagent ensemble', () => {
    expect(sansProse(CHAINE)).toContain('variationAudio.raison');
  });

  it('6.6 la politique est PURE', () => {
    expect(sansProse(POLITIQUE)).not.toMatch(/supabase|node:fs|fetch\(/);
  });
});
