import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normaliserPourTTS, nombreEnLettres } from '@/lib/voice/normalisation-tts';
import { scriptParle, scripts, type Prononciation } from '@/lib/voice/prononciations';
import { scriptsDuJumeau } from '@/lib/avatar/jumeau';

/**
 * Prononciation TTS (fr-FR) — le texte DIT, jamais le texte AFFICHÉ.
 *
 * `normaliserPourTTS` réécrit chiffres, pourcentages, symboles et
 * abréviations pour le moteur vocal. `scriptParle` la combine aux
 * prononciations du compte, sans jamais renormaliser leurs formes dites.
 */

const n = normaliserPourTTS;

describe('normaliserPourTTS — les exemples du cahier des charges', () => {
  it.each([
    ['76%', '76 pour cent'],
    ['+2%', 'plus 2 pour cent'],
    ['-76%', 'moins 76 pour cent'],
    ['3-en-1', 'trois en un'],
    ['+2%/an', 'plus 2 pour cent par an'],
    ['300+', 'plus de 300'],
    ['10 ans', '10 ans'],
  ])('%s → %s', (entree, attendu) => {
    expect(n(entree)).toBe(attendu);
  });

  it('dans une phrase réelle de carte', () => {
    expect(n('76% des femmes réduisent leur stress avec le 3-en-1'))
      .toBe('76 pour cent des femmes réduisent leur stress avec le trois en un');
    expect(n('Croissance : +2%/an depuis 10 ans, 300+ clients'))
      .toBe('Croissance : plus 2 pour cent par an depuis 10 ans, plus de 300 clients');
  });
});

describe('normaliserPourTTS — pourcentages et signes', () => {
  it('espace normale, insécable ou fine avant %', () => {
    expect(n('76 % des gens')).toBe('76 pour cent des gens');
    expect(n('76\u00a0% des gens')).toBe('76 pour cent des gens');
    expect(n('76\u202f% des gens')).toBe('76 pour cent des gens');
  });
  it('décimales : point anglais → virgule française', () => {
    expect(n('2.5%')).toBe('2,5 pour cent');
    expect(n('2,5 %')).toBe('2,5 pour cent');
  });
  it('signe moins typographique et parenthèses', () => {
    expect(n('\u221276%')).toBe('moins 76 pour cent');
    expect(n('(-20%)')).toBe('(moins 20 pour cent)');
  });
  it('un tiret dans un mot n’est jamais un signe moins', () => {
    expect(n('Vidéo-3 et top-10')).toBe('Vidéo-3 et top-10');
  });
});

describe('normaliserPourTTS — plus, intervalles, opérations', () => {
  it('« N+ » → « plus de N », milliers compris', () => {
    expect(n('2 300+ membres')).toBe('plus de 2 300 membres');
    expect(n('300 + bonus')).toBe('300 plus bonus');
  });
  it('addition et multiplication entre nombres', () => {
    expect(n('2+2')).toBe('2 plus 2');
    expect(n('3x4')).toBe('3 fois 4');
    expect(n('2x par semaine, x3 résultats')).toBe('2 fois par semaine, fois 3 résultats');
  });
  it('intervalle « 10-20 » → « 10 à 20 », mais pas une date', () => {
    expect(n('10-20 min')).toBe('10 à 20 minutes');
    expect(n('Le 2026-10-07')).toBe('Le 2026-10-07');
  });
  it('« N-en-N » au-delà de 99 garde ses chiffres', () => {
    expect(n('2-en-1')).toBe('deux en un');
    expect(n('100-en-1')).toBe('100 en un');
  });
  it('C++ n’est pas un nombre', () => {
    expect(n('C++')).toBe('C++');
  });
});

describe('normaliserPourTTS — unités, monnaies, heures', () => {
  it.each([
    ['50€', '50 euros'],
    ['1 €', '1 euro'],
    ['€20', '20 euros'],
    ['1,5M€', '1,5 million d’euros'],
    ['2 M€', '2 millions d’euros'],
    ['3 k€', '3 mille euros'],
    ['10k abonnés', '10 mille abonnés'],
    ['19 CHF', '19 francs suisses'],
    ['CHF 1', '1 franc suisse'],
    ['20$', '20 dollars'],
    ['300 kcal', '300 kilocalories'],
    ['45 min', '45 minutes'],
    ['1 min', '1 minute'],
    ['5 km', '5 kilomètres'],
    ['12 km/h', '12 kilomètres par heure'],
    ['2.5 kg', '2,5 kilos'],
    ['10.000 pas', '10000 pas'],
    ['10h', '10 heures'],
    ['1 h de sport', '1 heure de sport'],
    ['10h30', '10 heures 30'],
    ['24h/24 et 7j/7', '24 heures sur 24 et 7 jours sur 7'],
    ['20°C', '20 degrés'],
    ['5 repas/jour', '5 repas par jour'],
    ['3 séances/sem', '3 séances par semaine'],
  ])('%s → %s', (entree, attendu) => {
    expect(n(entree)).toBe(attendu);
  });

  it('« j’ai » après un nombre n’est pas un jour', () => {
    expect(n('En 3 j’ai tout compris')).toBe('En 3 j’ai tout compris');
  });
  it('« 10 heures », « 20 hommes » restent tels quels', () => {
    expect(n('10 heures et 20 hommes')).toBe('10 heures et 20 hommes');
  });
});

describe('normaliserPourTTS — ordinaux, abréviations, symboles', () => {
  it('ordinaux', () => {
    expect(n('Le 1er cours, la 1re fois, la 1ère, le 2e, le 3ème, le 5e, le 9e, le 21e, les 2es'))
      .toBe('Le premier cours, la première fois, la première, le deuxième, le troisième, le cinquième, le neuvième, le vingt et unième, les deuxièmes');
  });
  it('abréviations', () => {
    expect(n('RDV à 18h')).toBe('rendez-vous à 18 heures');
    expect(n('Mme Dupont vs Dr Martin')).toBe('Madame Dupont contre Docteur Martin');
    expect(n('Squats, fentes, etc.')).toBe('Squats, fentes, et cetera.');
    expect(n('env. 30 personnes, ex. Paul')).toBe('environ 30 personnes, par exemple Paul');
    expect(n('n°1 en Suisse')).toBe('numéro 1 en Suisse');
  });
  it('symboles', () => {
    expect(n('Force & souplesse')).toBe('Force et souplesse');
    expect(n('Avant → après')).toBe('Avant, après');
    expect(n('#fitness #coach')).toBe('fitness coach');
    expect(n('et/ou')).toBe('et ou');
  });
  it('emojis retirés (le moteur les lirait à voix haute)', () => {
    expect(n('Go 🔥💪')).toBe('Go');
  });
});

describe('normaliserPourTTS — pauses et espaces', () => {
  it('une fin de ligne sans ponctuation devient un point ; les puces disparaissent', () => {
    expect(n('Ligne 1\nLigne 2\n- puce')).toBe('Ligne 1. Ligne 2. puce');
    expect(n('Titre :\nSuite.')).toBe('Titre : Suite.');
  });
  it('espaces multiples réduits, pas d’espace avant virgule ou point', () => {
    expect(n('Bonjour   à tous ,  merci .')).toBe('Bonjour à tous, merci.');
  });
});

describe('normaliserPourTTS — garanties', () => {
  const CORPUS = [
    '76% des gens', '+2%/an', '-76%', '3-en-1', '300+ clients', '10 ans', 'Rdv à 10h30 & 18h',
    '50€ ou 1,5M€ ou 10k abonnés', '24h/24 7j/7', 'Le 1er cours, le 21e', '10-20 min', '2026-10-07',
    '2x par semaine', '300 kcal en 45 min', '12 km/h', '19 CHF', '10.000 pas et 2.5 kg',
    'Ligne 1\nLigne 2', 'etc.', 'n°1 🔥', '(-20%)', 'Bienvenue au cours Afroboost à Neuchâtel.',
  ];
  it('IDEMPOTENTE : l’appliquer deux fois ne change rien', () => {
    for (const s of CORPUS) expect(n(n(s)), s).toBe(n(s));
  });
  it('un texte ordinaire est rendu tel quel', () => {
    for (const s of ['Bonjour', 'Bienvenue au cours Afroboost à Neuchâtel.', 'Top 5 des exercices', 'Le 2 et le 3', 'Il a 10 ans.']) {
      expect(n(s)).toBe(s);
    }
  });
  it('vide ou non textuel → chaîne vide, jamais d’exception', () => {
    expect(n('')).toBe('');
    expect(n(undefined as unknown as string)).toBe('');
    expect(n(42 as unknown as string)).toBe('');
  });
  it('nombreEnLettres : 0–99, orthographe traditionnelle', () => {
    expect([0, 1, 7, 16, 17, 21, 70, 71, 77, 80, 81, 91, 99].map((x) => nombreEnLettres(x))).toEqual([
      'zéro', 'un', 'sept', 'seize', 'dix-sept', 'vingt et un', 'soixante-dix', 'soixante et onze',
      'soixante-dix-sept', 'quatre-vingts', 'quatre-vingt-un', 'quatre-vingt-onze', 'quatre-vingt-dix-neuf',
    ]);
    expect(nombreEnLettres(100)).toBeNull();
    expect(nombreEnLettres(-1)).toBeNull();
    expect(nombreEnLettres(1.5)).toBeNull();
  });
});

describe('scriptParle — prononciations du compte PUIS normalisation', () => {
  const P: Prononciation[] = [
    { affiche: 'Afroboost', prononce: 'Afro-boust' },
    { affiche: 'HIIT', prononce: 'hit' },
  ];

  it('⚠️ DISPLAY intact, SPOKEN normalisé et prononcé', () => {
    const display = 'Afroboost : 76% de stress en moins grâce au HIIT 3-en-1, +2%/an.';
    const avant = display;
    const r = scripts(display, P);
    expect(display).toBe(avant);
    expect(r.display).toBe(display);
    expect(r.spoken).toBe('Afro-boust : 76 pour cent de stress en moins grâce au hit trois en un, plus 2 pour cent par an.');
  });

  it('sans prononciation : normalisation seule', () => {
    expect(scriptParle('76% des gens', [])).toBe('76 pour cent des gens');
  });

  it('⚠️ la forme dite du compte n’est JAMAIS renormalisée', () => {
    const p = [{ affiche: 'Studio54', prononce: 'Studio 54% & co' }];
    expect(scriptParle('Studio54 offre 20%', p)).toBe('Studio 54% & co offre 20 pour cent');
  });

  it('un mot affiché qui contient un symbole garde la prononciation du compte', () => {
    const p = [{ affiche: '3-en-1', prononce: 'le trois en un maison' }];
    expect(scriptParle('Notre 3-en-1 et un 2-en-1', p)).toBe('Notre le trois en un maison et un deux en un');
  });

  it('Jumeau : scriptsDuJumeau rend display intact et spoken normalisé', () => {
    expect(scriptsDuJumeau(['Afroboost : 300+ élèves'], P)).toEqual([
      { display: 'Afroboost : 300+ élèves', spoken: 'Afro-boust : plus de 300 élèves' },
    ]);
  });
});

describe('Branchement — chaque moteur reçoit le texte DIT', () => {
  const lire = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

  it('routes de synthèse de Créer : ElevenLabs, Edge, HeyGen, OpenAI passent par texteParleDuCompte', () => {
    // Le texte DIT ; `voice_settings` seulement avec des réglages (voix-reglages-routes.test.ts).
    expect(lire('src/app/api/tts/elevenlabs/route.ts')).toContain('body: JSON.stringify({ text: spoken, model_id: MODEL_ID, ...(voiceSettings ? { voice_settings: voiceSettings } : {}) })');
    expect(lire('src/app/api/tts/elevenlabs/route.ts')).toContain('texteParleDuCompte(session.user.id, text)');
    expect(lire('src/app/api/tts/edge/route.ts')).toContain('texteParleDuCompte(session.user.id, text).then((spoken) => synthesizeTTS(spoken');
    expect(lire('src/app/api/tts/heygen/route.ts')).toContain('text: await texteParleDuCompte(session.user.id, text)');
    expect(lire('src/app/api/tts/openai/route.ts')).toContain('input: await texteParleDuCompte(session.user.id, text)');
  });

  it('Autopilote : chaque séquence est synthétisée avec scriptParle(texte, prononciations du compte)', () => {
    const v = lire('src/lib/autopilot/voice.ts');
    expect(v).toContain('const prononciations = await prononciationsDuCompte(input.userId)');
    expect(v).toContain('const dit = scriptParle(texte, prononciations);');
    expect(v).toContain('await synthetiser(dit, provider, voixResolue)');
    expect(v).toContain("await synthetiser(dit, 'edge')");
    expect(v).not.toMatch(/synthetiser\(texte,/);
  });

  it('Jumeau et écoute : passent déjà par scriptParle (scriptsDuJumeau / ecoute)', () => {
    expect(lire('src/app/api/voice/ecoute/route.ts')).toContain('scriptParle(texte, voix.prononciations)');
    expect(lire('src/lib/avatar/moteur-jumeau.ts')).toContain('scriptsDuJumeau([display], jumeau.prive.prononciations)');
  });
});

describe('normaliserPourTTS — sigles prononcés comme un mot (NEJM)', () => {
  it('NEJM → « Nèjm » dans le texte DIT', () => {
    expect(n('NEJM')).toBe('Nèjm');
    expect(n('Selon le NEJM, 76% des patients')).toBe('Selon le Nèjm, 76 pour cent des patients');
    expect(n('(NEJM, 2024)')).toBe('(Nèjm, 2024)');
  });

  it('le texte AFFICHÉ reste exactement « NEJM »', () => {
    const visible = 'Étude publiée dans le NEJM';
    const { display, spoken } = scripts(visible, []);
    expect(display).toBe('Étude publiée dans le NEJM');
    expect(visible).toBe('Étude publiée dans le NEJM');
    expect(spoken).toBe('Étude publiée dans le Nèjm');
  });

  it('mot entier et en capitales seulement', () => {
    expect(n('NEJMX')).toBe('NEJMX');
    expect(n('nejm.org')).toBe('nejm.org');
  });

  it('idempotent, et une prononciation du compte reste prioritaire', () => {
    expect(n(n('le NEJM'))).toBe('le Nèjm');
    expect(scriptParle('le NEJM', [{ affiche: 'NEJM', prononce: 'New England Journal' }]))
      .toBe('le New England Journal');
  });
});
