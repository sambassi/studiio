// @vitest-environment node
/**
 * A_8d — LE TEXTE AFFICHÉ N'EST JAMAIS RÉÉCRIT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA RÈGLE, ET CE QU'ELLE PROTÈGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le texte parlé est une VUE : fabriquée au moment de parler, envoyée au
 * moteur, jetée. Le texte affiché — celui que la personne a écrit — alimente
 * l'interface, l'édition, l'historique, les sous-titres et la publication.
 *
 * Confondre les deux ne casserait rien tout de suite. Cela se verrait plus
 * tard, dans des sous-titres qui annoncent « vingt-cinq pour cent » là où la
 * vidéo montre « 25 % ».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { texteParle } from '@/lib/voice/pipeline';
import {
  appliquerPrononciations, prononciationsValides, prononciationValide,
  PRONONCIATIONS_MAX, PRONONCIATION_LONGUEUR_MAX,
} from '@/lib/voice/prononciations';
import { bibliothequeValide, BIBLIOTHEQUE_VIDE } from '@/lib/creatif/bibliotheque';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const VOIX_OFF = sansProse(lire('src/app/api/autopilot/voix-off/route.ts'));
const TTS = sansProse(lire('src/app/api/tts/elevenlabs/route.ts'));
const PIPELINE = sansProse(lire('src/lib/voice/pipeline.ts'));
const U = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';

// ═══════════════════════════════════════════════════════════════════════════
describe('1. L’entrée ressort intacte', () => {
  it('1.1 ⚠️ LE TEXTE AFFICHÉ EST PRÉSERVÉ OCTET POUR OCTET', () => {
    const display = 'Profitez de -25 % dès 18h30, seulement 25 CHF.';
    const copie = String(display);
    const parle = texteParle(display);
    expect(display).toBe(copie);
    expect(parle).not.toBe(display);
    expect(parle).toContain('vingt-cinq pour cent');
  });

  it('1.2 la fonction est pure : deux appels, même résultat', () => {
    const t = 'Rendez-vous à 8h pour 1,5 CHF.';
    expect(texteParle(t)).toBe(texteParle(t));
  });

  it('1.3 aucune persistance dans le pipeline', () => {
    // Un texte parlé rangé en base finirait par être réaffiché.
    expect(PIPELINE).not.toMatch(/supabase|insert\(|update\(|localStorage/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les prononciations du compte', () => {
  const regles = [{ display: 'Studiio', spoken: 'Studio' }];

  it('2.1 elles changent le parlé, jamais l’affiché', () => {
    const display = 'Bienvenue chez Studiio.';
    const parle = texteParle(display, { prononciations: regles });
    expect(parle).toBe('Bienvenue chez Studio.');
    expect(display).toBe('Bienvenue chez Studiio.');
  });

  it('2.2 ⚠️ APPLIQUÉES APRÈS LA NORMALISATION, ET C’EST DÉLIBÉRÉ', () => {
    /* Devant, un alias contenant un chiffre serait repassé dans les règles
       structurelles : « Studio deux » verrait son « deux » relu. */
    const parle = texteParle('Offre Studiio à 25 CHF', {
      prononciations: [{ display: 'Studiio', spoken: 'Studio 2' }],
    });
    expect(parle).toContain('Studio 2');
    expect(parle).toContain('vingt-cinq francs suisses');
    // Le « 2 » de l'alias n'a PAS été converti en « deux ».
    expect(parle).not.toContain('Studio deux');
  });

  it('2.3 la règle la plus longue gagne', () => {
    /* Sans cet ordre, « Studiio » mangerait le début de « Studiio Pro » et
       l'ordre de saisie déciderait du résultat. */
    const parle = appliquerPrononciations('Studiio Pro et Studiio', [
      { display: 'Studiio', spoken: 'Studio' },
      { display: 'Studiio Pro', spoken: 'Studio Professionnel' },
    ]);
    expect(parle).toBe('Studio Professionnel et Studio');
  });

  it('2.4 la recherche ignore la casse', () => {
    expect(appliquerPrononciations('STUDIIO et studiio', regles)).toBe('Studio et Studio');
  });

  it('2.5 ⚠️ LE REMPLACEMENT EST LITTÉRAL, JAMAIS UNE EXPRESSION RÉGULIÈRE', () => {
    /* Une regex fournie par un utilisateur peut se rendre exponentielle sur
       une entrée choisie (ReDoS) et bloquer le serveur. */
    const parle = appliquerPrononciations('coût (a+)+ final', [
      { display: '(a+)+', spoken: 'a plus' },
    ]);
    expect(parle).toBe('coût a plus final');
  });

  it('2.6 sans règle, le texte ne bouge pas', () => {
    expect(appliquerPrononciations('Bonjour', [])).toBe('Bonjour');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La table est bornée et relue', () => {
  it('3.1 une règle incomplète est refusée, pas réparée', () => {
    for (const v of [
      null, {}, { display: 'a' }, { spoken: 'b' },
      { display: '   ', spoken: 'b' }, { display: 'a', spoken: '  ' },
      { display: 'a\nb', spoken: 'c' },
      { display: 'x'.repeat(PRONONCIATION_LONGUEUR_MAX + 1), spoken: 'y' },
    ]) {
      expect(prononciationValide(v), JSON.stringify(v)).toBeNull();
    }
    expect(prononciationValide({ display: ' Studiio ', spoken: ' Studio ' }))
      .toEqual({ display: 'Studiio', spoken: 'Studio' });
  });

  it('3.2 la liste est plafonnée et dédoublonnée', () => {
    const trop = Array.from({ length: 250 }, (_, i) => ({ display: `m${i}`, spoken: `s${i}` }));
    expect(prononciationsValides(trop)).toHaveLength(PRONONCIATIONS_MAX);
    const doublons = [
      { display: 'Studiio', spoken: 'Studio' },
      { display: 'studiio', spoken: 'Autre' },
    ];
    expect(prononciationsValides(doublons)).toHaveLength(1);
    expect(prononciationsValides('pas une liste')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le stockage réutilise l’existant', () => {
  it('4.1 ⚠️ AUCUNE TABLE NOUVELLE, AUCUNE MIGRATION', () => {
    /* Ce sont des préférences créatives du compte, comme les favoris et les
       presets qui les entourent : le même document JSON les porte déjà, avec
       le même validateur et le même chemin d'écriture atomique. */
    const b = bibliothequeValide(
      { prononciations: [{ display: 'Studiio', spoken: 'Studio' }] }, U,
    );
    expect(b.prononciations).toHaveLength(1);
    expect(BIBLIOTHEQUE_VIDE.prononciations).toEqual([]);
  });

  it('4.2 une bibliothèque sans prononciation reste vide', () => {
    expect(bibliothequeValide({}, U).prononciations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Les deux chemins de synthèse passent par la même porte', () => {
  it('5.1 ⚠️ LA VOIX-OFF ENVOIE LE TEXTE PARLÉ', () => {
    expect(VOIX_OFF).toContain('text: texteParle(script');
    expect(VOIX_OFF).not.toMatch(/text: script,/);
  });

  it('5.2 ⚠️ MAIS PERSISTE LE TEXTE AFFICHÉ', () => {
    /* `script` reste ce que la personne a écrit : il alimente les sous-titres
       et l'historique. */
    expect(VOIX_OFF).toMatch(/^\s+script,$/m);
  });

  it('5.3 la route TTS générale aussi', () => {
    expect(TTS).toContain('text: texteParle(text');
    expect(TTS).not.toMatch(/JSON\.stringify\(\{ text, model_id/);
  });

  it('5.4 les deux lisent les prononciations du compte', () => {
    for (const [nom, src] of [['voix-off', VOIX_OFF], ['tts', TTS]] as const) {
      expect(src, nom).toContain('prononciations');
      expect(src, nom).toContain('lireBibliothequeUtilisateur');
    }
  });

  it('5.5 ⚠️ UNE SEULE PORTE, PAS UN NORMALISEUR PAR ÉCRAN', () => {
    /* Si chaque chemin préparait son texte à sa façon, la même phrase se
       prononcerait différemment selon l'écran qui l'a demandée. */
    for (const src of [VOIX_OFF, TTS]) {
      expect(src).toContain("from '@/lib/voice/pipeline'");
      expect(src).not.toContain("from '@/lib/voice/spoken-text'");
    }
  });
});
