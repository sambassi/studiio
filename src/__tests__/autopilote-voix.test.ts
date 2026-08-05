import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { voiceTexts, voiceUrls, sequenceSecondsWithVoice, AUTOPILOT_TTS_VOICE } from '@/lib/autopilot/voice';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { voiceSequenceSeconds } from '@/lib/creer/voiceFit';
import { DEFAULT_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';

/**
 * La voix off de l'Autopilote.
 *
 * ⚠️ LE TTS N'ÉTAIT PAS CASSÉ. `CLAUDE.md` le donnait pour hors service, et
 * le correctif attendu était l'ajout du token `Sec-MS-GEC`. Vérification
 * faite : `msedge-tts@2.0.4` **l'implémente déjà**, et un appel réel rend
 * 4,08 s de parole (mp3 24 kHz, moyenne −21,2 dB). La note était périmée.
 *
 * ⚠️ LE CALAGE DE DURÉE CHANGE D'ENDROIT, PAS DE RÈGLE. La Phase 8 avait
 * établi que « la séquence s'allonge à sa voix » est un effet de l'ÉDITEUR,
 * qui écrit la durée dans le design — et qu'un rendu ne doit surtout pas la
 * recalculer, sous peine d'écraser un réglage manuel. L'Autopilote n'a pas
 * d'éditeur : personne n'écrirait cette durée. C'est donc lui qui applique
 * `voiceSequenceSeconds`, à la fabrication du design — la même règle, au
 * seul endroit qui reste.
 */

const voix = readFileSync(resolve(__dirname, '../lib/autopilot/voice.ts'), 'utf-8');
const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [], ...p,
});
const unPost = () => preparePosts({ config: cfg(), topic: 'routine du matin', count: 1, now: T0 })[0];

describe('Le texte dit est celui du MANUEL', () => {
  it('il vient de `buildAutoFillText`, pas d un second assembleur', () => {
    // Le réécrire aurait donné une narration différente de celle qu'un
    // utilisateur obtient en cliquant « générer » dans le panneau des voix.
    expect(voix).toContain("from '@/lib/types/voice'");
    expect(voix).toContain('buildAutoFillText({');
  });

  it('titre, cartes et CTA sont narrés', () => {
    const t = voiceTexts(unPost());
    expect(t.titre).toContain('outine du matin');
    expect(t.cartes && t.cartes.length).toBeGreaterThan(20);
    expect(t.cta).toBeTruthy();
  });

  it('une séquence sans texte n est pas narrée', () => {
    // Un clip vide décalerait la durée pour rien : ici, pas de rush, donc
    // pas de texte d'incrustation.
    expect(voiceTexts(unPost()).video).toBeUndefined();
  });

  it('un texte trop long est tronqué', () => {
    const t = voiceTexts(unPost());
    for (const v of Object.values(t)) expect((v as string).length).toBeLessThanOrEqual(600);
  });
});

describe('Le calage de durée — la règle du Mode simple', () => {
  const avec = (s: number) => ({ titre: { url: 'u', seconds: s } });

  it('la séquence s allonge à la voix', () => {
    // 7,2 s de parole → 8 s de séquence (arrondi supérieur + marge de 0,3 s).
    expect(sequenceSecondsWithVoice(avec(7.2), 'titre', 4)).toBe(voiceSequenceSeconds(7.2));
    expect(sequenceSecondsWithVoice(avec(7.2), 'titre', 4)).toBe(8);
  });

  it('mais ne RÉTRÉCIT jamais sous la durée voulue', () => {
    // Une voix de 2 s ne doit pas écourter une séquence réglée à 4 s.
    expect(sequenceSecondsWithVoice(avec(2), 'titre', 4)).toBe(4);
  });

  it('sans voix, la durée demandée passe telle quelle', () => {
    expect(sequenceSecondsWithVoice({}, 'titre', 4)).toBe(4);
  });

  it('le design applique la règle sur les trois séquences', () => {
    const d = buildAutopilotDesign(unPost(), {
      voices: {
        titre: { url: 'a', seconds: 9 },
        cartes: { url: 'b', seconds: 2 },
        cta: { url: 'c', seconds: 11 },
      },
    });
    expect(d.introDuration).toBe(10);                                   // 9 s → 10
    expect(d.cardsDuration).toBe(DEFAULT_SEQUENCE_SECONDS.cards);       // voix courte
    expect(d.ctaDuration).toBe(12);                                     // 11 s → 12
  });

  it('et transmet les URL au rendu serveur', () => {
    const d = buildAutopilotDesign(unPost(), {
      voices: { titre: { url: 'https://cdn/t.mp3', seconds: 3 } },
    });
    expect(d.sequenceVoiceUrls).toEqual({ titre: 'https://cdn/t.mp3' });
  });

  it('sans voix, aucun champ voix — montage muet, comme avant', () => {
    expect(buildAutopilotDesign(unPost()).sequenceVoiceUrls).toBeUndefined();
    expect(voiceUrls({})).toBeUndefined();
  });
});

describe('Rien ne peut faire échouer un cycle', () => {
  it('une synthèse ratée rend `null`, pas une exception', () => {
    expect(voix).toContain('return null;');
    expect(voix).toContain('[Autopilote/Voix] synthese echouee');
  });

  it('une durée illisible fait ignorer la voix', () => {
    // Sans durée mesurée on ne peut pas caler la séquence : la narration
    // serait coupée. Mieux vaut ne pas l'utiliser.
    expect(voix).toContain('duree illisible pour');
  });

  it('le flux a deux délais de garde', () => {
    // Un flux qui s'arrête au milieu ne doit pas laisser le cycle pendu.
    expect(voix).toContain("new Error('aucune donnee')");
    expect(voix).toContain("new Error('flux interrompu')");
  });

  it('la voix est générée AVANT le design — ce sont ses durées qui calent', () => {
    const bloc = cron.slice(cron.indexOf('const jobId ='));
    expect(bloc.indexOf('buildAutopilotVoices')).toBeLessThan(bloc.indexOf('buildAutopilotDesign'));
  });
});

describe('La voix reste celle du manuel', () => {
  it('même service, même voix française', () => {
    expect(AUTOPILOT_TTS_VOICE).toBe('fr-FR-DeniseNeural');
    const client = readFileSync(resolve(__dirname, '../lib/tts/edge-tts-client.ts'), 'utf-8');
    expect(client).toContain('fr-FR-DeniseNeural');
  });

  it('et le service gère déjà le token exigé par Microsoft', () => {
    // `Sec-MS-GEC` : le correctif attendu était de l'ajouter. Il est déjà là.
    const lib = readFileSync(resolve(__dirname, '../../node_modules/msedge-tts/dist/MsEdgeTTS.js'), 'utf-8');
    expect(lib).toContain('Sec-MS-GEC');
    expect(lib).toContain('Sec-MS-GEC-Version');
  });
});
