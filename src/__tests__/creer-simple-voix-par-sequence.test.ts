import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  estimateSpeechSeconds,
  estimateLabel,
  voiceSequenceSeconds,
  VOICE_SEQUENCE_MARGIN_S,
  SPEECH_CHARS_PER_SECOND,
} from '@/lib/creer/voiceFit';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Voix off PAR SÉQUENCE — Mode simple.
 *
 * Chaque séquence porte son texte et sa voix, et sa **durée se cale sur la
 * durée réelle de son audio** : c'est ce qui garantit qu'un texte rentre
 * exactement dans sa séquence, au lieu d'être coupé ou suivi de silence.
 *
 * Deux pièges que ces tests verrouillent, parce qu'ils échouent **en
 * silence** :
 *
 * 1. Le compositeur attend `sequenceVoiceUrls` — une carte d'URL — et non
 *    l'état `sequenceVoices`. Lui passer le mauvais objet ne lève pas : le
 *    montage sort simplement sans voix.
 * 2. Le calage de durée doit s'appliquer **une fois par durée de voix**. Sans
 *    registre, l'effet se redéclencherait sur son propre changement et
 *    écraserait tout réglage manuel à chaque rendu.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);
const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const panel = readFileSync(resolve(__dirname, '../components/creer/SequenceVoicesPanel.tsx'), 'utf-8');

describe('voiceSequenceSeconds — la durée qui contient la voix', () => {
  it('ajoute la marge et arrondit au-DESSUS', () => {
    // Arrondir au plus proche pourrait retomber sous la voix : la fin du
    // texte serait coupée, ce que toute la mécanique cherche à éviter.
    expect(voiceSequenceSeconds(4.0)).toBe(5);
    expect(voiceSequenceSeconds(4.5)).toBe(5);
    expect(voiceSequenceSeconds(4.8)).toBe(6);
  });

  it('la durée obtenue contient TOUJOURS la voix', () => {
    for (const d of [0.1, 1, 2.4, 3.99, 7.5, 12.01, 59.9]) {
      expect(voiceSequenceSeconds(d), String(d)).toBeGreaterThanOrEqual(d);
    }
  });

  it('jamais moins d une seconde', () => {
    expect(voiceSequenceSeconds(0.2)).toBe(1);
  });

  it('une durée absente ou aberrante rend 0 — donc aucun calage', () => {
    expect(voiceSequenceSeconds(0)).toBe(0);
    expect(voiceSequenceSeconds(-3)).toBe(0);
    expect(voiceSequenceSeconds(Number.NaN)).toBe(0);
    expect(voiceSequenceSeconds(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('la marge est réglable, et une marge négative est ignorée', () => {
    expect(voiceSequenceSeconds(4, 0)).toBe(4);
    expect(voiceSequenceSeconds(4, -5)).toBe(4);
    expect(VOICE_SEQUENCE_MARGIN_S).toBe(0.3);
  });
});

describe('L estimation avant génération', () => {
  it('suit la longueur du texte', () => {
    expect(estimateSpeechSeconds('a'.repeat(14))).toBe(1);
    expect(estimateSpeechSeconds('a'.repeat(140))).toBe(10);
    expect(SPEECH_CHARS_PER_SECOND).toBe(14);
  });

  it('un texte vide ne dit rien — pas « ≈ 0 s »', () => {
    expect(estimateSpeechSeconds('')).toBe(0);
    expect(estimateSpeechSeconds('   ')).toBe(0);
    expect(estimateSpeechSeconds(null)).toBe(0);
    expect(estimateSpeechSeconds(undefined)).toBe(0);
    expect(estimateLabel('')).toBe('');
  });

  it('l étiquette est en français, virgule décimale comprise', () => {
    expect(estimateLabel('a'.repeat(21))).toBe('≈ 1,5 s');
  });

  it('un débit absurde retombe sur le débit par défaut', () => {
    expect(estimateSpeechSeconds('a'.repeat(14), 0)).toBe(1);
    expect(estimateSpeechSeconds('a'.repeat(14), Number.NaN)).toBe(1);
  });

  it('elle s efface dès que la durée réelle est connue', () => {
    // La durée mesurée fait foi ; garder les deux serait contradictoire.
    expect(panel).toContain('{!sv.audioUrl && estimateLabel(sv.text) && (');
  });
});

describe('Le compositeur reçoit ce qu il attend VRAIMENT', () => {
  it('l option s appelle `sequenceVoiceUrls`, une carte d URL', () => {
    // Lui passer l'état `sequenceVoices` ne lèverait pas : le montage
    // sortirait simplement sans voix.
    expect(composer).toContain('sequenceVoiceUrls?: {');
    expect(composer).toContain('if (options.sequenceVoiceUrls) {');
    expect(wizard).toContain('const sequenceVoiceUrls = useMemo(');
    const appel = wizard.slice(wizard.indexOf('const composed = await composeAndUpload({'));
    expect(appel.slice(0, 3000)).toContain('sequenceVoiceUrls,');
  });

  it('aucune voix par séquence → `undefined`, donc repli sur la voix unique', () => {
    // C'est le comportement de tous les montages antérieurs.
    expect(wizard).toContain('return une ? out : undefined;');
    expect(wizard).toContain('voiceUrl: voiceUrl || undefined,');
  });

  it('le montage est déclaré sonore quand seules les voix par séquence existent', () => {
    // Sans cela, le Calendrier croirait le montage muet.
    expect(wizard).toContain(
      "hasAudio: !!(musicUrl || voiceUrl || sequenceVoiceUrls || (rushUrl && seqDuration('video') > 0)),",
    );
  });

  it('les métadonnées du post les conservent', () => {
    const meta = wizard.slice(wizard.indexOf('voiceUrl: persistableUrl(voiceUrl),'));
    expect(meta.slice(0, 200)).toContain('sequenceVoiceUrls,');
  });
});

describe('Le calage des durées', () => {
  it('chaque séquence pilote SA durée', () => {
    expect(wizard).toContain('titre: setIntroDuration,');
    expect(wizard).toContain('cartes: setCardsDuration,');
    expect(wizard).toContain('video: setVideoDuration,');
    expect(wizard).toContain('cta: setCtaDuration,');
  });

  it('il part de la durée MESURÉE par le panneau, pas d une seconde mesure', () => {
    // Deux sondes de la même valeur finiraient par ne plus dire la même chose.
    expect(wizard).toContain('const dur = sv.audioUrl ? sv.duration : undefined;');
    expect(panel).toContain('const duration = await probeDuration(');
  });

  it('il s applique UNE FOIS par durée de voix', () => {
    // Sans registre, l'effet se redéclencherait sur son propre changement et
    // écraserait tout réglage manuel à chaque rendu.
    expect(wizard).toContain('const appliedVoiceDurations = useRef<Partial<Record<SequenceKey, number>>>({});');
    expect(wizard).toContain('if (appliedVoiceDurations.current[key] === dur) continue;');
    expect(wizard).toContain('appliedVoiceDurations.current[key] = dur;');
  });

  it('retirer la voix ne touche PAS à la durée réglée', () => {
    // L'utilisateur garde ce qu'il avait ; on oublie seulement la valeur
    // appliquée, pour qu'une prochaine voix puisse recaler.
    expect(wizard).toContain('delete appliedVoiceDurations.current[key];');
    const bloc = wizard.slice(
      wizard.indexOf('delete appliedVoiceDurations.current[key];') - 400,
      wizard.indexOf('delete appliedVoiceDurations.current[key];') + 60,
    );
    expect(bloc).toContain('continue;');
  });

  it('une durée nulle ou aberrante ne cale rien', () => {
    expect(wizard).toContain("if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0) {");
  });
});

describe('Le pré-remplissage des textes', () => {
  it('vient du contenu généré', () => {
    expect(wizard).toContain('const auto = buildAutoFillText({');
    expect(wizard).toContain('if (!generated) return;');
  });

  it('les cartes du Mode simple sont traduites vers `label`', () => {
    // `buildAutoFillText` attend `label` là où le Mode simple dit `title` :
    // sans cette traduction, le texte des cartes sortirait vide.
    expect(wizard).toContain('label: c.title,');
  });

  it('un texte repris à la main n est jamais réécrit', () => {
    expect(wizard).toContain('if (sequenceVoicesUserEdited[key]) continue;');
  });

  it('« réinitialiser » relâche le drapeau et laisse le pré-remplissage agir', () => {
    expect(wizard).toContain('setSequenceVoicesUserEdited((prev) => ({ ...prev, [key]: false }));');
  });

  it('le panneau est monté là où le contenu EXISTE', () => {
    // Le Mode simple génère son contenu APRÈS l'étape Audio : monté là-bas,
    // le panneau n'aurait aucun texte à proposer.
    const contenu = wizard.slice(
      wizard.indexOf('{step === S.contenu && ('),
      wizard.indexOf('{step === S.envoi && ('),
    );
    expect(contenu).toContain('<SequenceVoicesPanel');
    const audio = wizard.slice(
      wizard.indexOf('{step === S.audio && ('),
      wizard.indexOf('{step === S.contenu && ('),
    );
    expect(audio).not.toContain('<SequenceVoicesPanel');
  });
});

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'],
  toneIds: ['punchy'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
const lire = (extra: Record<string, unknown>) =>
  sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

const URL_OK = 'https://cdn.studiio.pro/voix/titre.mp3';

describe('Persistance des voix par séquence', () => {
  it('un brouillon sans voix par séquence se relit comme avant', () => {
    expect(lire({}).sequenceVoices).toBeUndefined();
    expect(lire({}).sequenceVoicesUserEdited).toBeUndefined();
  });

  it('relit texte et URL', () => {
    const d = lire({ sequenceVoices: { titre: { text: 'Bonjour', audioUrl: URL_OK, source: 'tts' } } });
    expect(d.sequenceVoices?.titre).toEqual({ text: 'Bonjour', audioUrl: URL_OK, source: 'tts' });
  });

  it('la DURÉE n est jamais relue — elle est remesurée sur l audio', () => {
    // Une durée relue pourrait ne plus correspondre au fichier, et calerait
    // la séquence sur une valeur fausse.
    const d = lire({ sequenceVoices: { titre: { text: 'x', audioUrl: URL_OK, duration: 99 } } });
    expect(JSON.stringify(d.sequenceVoices?.titre)).not.toContain('duration');
    expect(wizard).toContain('// Duree volontairement absente : elle sera remesuree.');
  });

  it('une URL éphémère est écartée, mais le TEXTE survit', () => {
    // Réécrire un texte parce qu'un fichier a expiré serait pénible ;
    // regénérer l'audio ne l'est pas.
    const d = lire({ sequenceVoices: { cartes: { text: 'Mon texte', audioUrl: 'blob:http://x/y' } } });
    expect(d.sequenceVoices?.cartes).toEqual({ text: 'Mon texte' });
  });

  it('une entrée sans texte NI audio n est pas écrite', () => {
    expect(lire({ sequenceVoices: { cta: { text: '' } } }).sequenceVoices).toBeUndefined();
  });

  it('`source` ne survit jamais sans son audio', () => {
    const d = lire({ sequenceVoices: { cta: { text: 'x', source: 'record' } } });
    expect(d.sequenceVoices?.cta).toEqual({ text: 'x' });
  });

  it('une `source` inconnue retombe sur « tts »', () => {
    const d = lire({ sequenceVoices: { cta: { text: 'x', audioUrl: URL_OK, source: 'magie' } } });
    expect(d.sequenceVoices?.cta?.source).toBe('tts');
  });

  it('les clés inconnues sont ignorées', () => {
    const d = lire({ sequenceVoices: { pirate: { text: 'x', audioUrl: URL_OK } } });
    expect(d.sequenceVoices).toBeUndefined();
  });

  it('une forme aberrante ne fait pas tomber la relecture', () => {
    for (const v of ['nope', 42, [], null, { titre: 'pas un objet' }]) {
      expect(() => lire({ sequenceVoices: v }), JSON.stringify(v)).not.toThrow();
    }
  });

  it('un texte démesuré est tronqué — le quota du stockage local est fini', () => {
    const d = lire({ sequenceVoices: { titre: { text: 'a'.repeat(5000) } } });
    expect(d.sequenceVoices?.titre?.text.length).toBe(2000);
  });

  it('les drapeaux « repris à la main » ne retiennent que `true`', () => {
    const d = lire({ sequenceVoicesUserEdited: { titre: true, cartes: false, pirate: true } });
    expect(d.sequenceVoicesUserEdited).toEqual({ titre: true });
  });

  it('le brouillon écrit bien les deux champs', () => {
    expect(wizard).toContain('sequenceVoices: Object.fromEntries(');
    expect(wizard).toContain('sequenceVoicesUserEdited,');
    expect(wizard).toContain('if (draft.sequenceVoices) {');
  });
});

describe('Default-safe', () => {
  it('un nouveau montage repart sans voix par séquence', () => {
    const debut = wizard.indexOf('const reset = ()');
    const reset = wizard.slice(debut, wizard.indexOf('\n  };', debut));
    expect(reset).toContain('setSequenceVoices(emptySequenceVoices());');
    expect(reset).toContain('setSequenceVoicesUserEdited(emptySequenceVoicesUserEdited());');
    // Sans cela, la durée calée du montage précédent survivrait à la remise
    // à zéro alors que sa voix, elle, a disparu.
    expect(reset).toContain('appliedVoiceDurations.current = {};');
  });

  it('la voix unique reste en place, comme repli', () => {
    expect(wizard).toContain('const [voiceUrl, setVoiceUrl] = useState<string | null>(null);');
  });

  it('le compositeur garde la voix unique quand aucune voix par séquence n existe', () => {
    expect(composer).toContain('voiceUrl?: string | null;');
  });
});
