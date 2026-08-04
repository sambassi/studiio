import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  pickRecorderMimeType,
  formatDuration,
  recordingQuality,
  recordingAdvice,
  micErrorMessage,
  RECORDER_MIME_CANDIDATES,
  MIN_RECORDING_SECONDS,
  MAX_RECORDING_SECONDS,
} from '@/lib/voice/recording';

/**
 * Enregistrement micro pour le clonage vocal.
 *
 * Le composant lui-même ne peut pas être exercé ici : jsdom n'a ni micro ni
 * `MediaRecorder`. Les règles qui comptent vivent donc dans un module pur,
 * vérifiable sur des valeurs — et ce qui reste dans le composant (libération
 * du micro, révocation des URL d'objet) est verrouillé sur la source, parce
 * que l'oubli de ces deux gestes ne se voit pas : le voyant « micro actif »
 * reste simplement allumé après qu'on a quitté la page.
 */

const composant = readFileSync(
  resolve(__dirname, '../components/voice/VoiceCloneRecorder.tsx'),
  'utf-8',
);
const page = readFileSync(resolve(__dirname, '../app/dashboard/avatar/page.tsx'), 'utf-8');

describe('pickRecorderMimeType — Chrome ET Safari', () => {
  it('préfère opus quand il est supporté', () => {
    expect(pickRecorderMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('retombe sur MP4 quand WebM est refusé — le cas de Safari', () => {
    // Sans ce second choix, l'enregistrement serait mort sur Safari.
    expect(pickRecorderMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
  });

  it('rend undefined quand rien n est supporté', () => {
    // `MediaRecorder` choisit alors son type par défaut, ce qui vaut mieux
    // que de lui en imposer un qu'il refuse — la construction échouerait.
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
  });

  it('rend undefined quand la fonction de test n existe pas', () => {
    expect(pickRecorderMimeType(undefined)).toBeUndefined();
  });

  it('une sonde qui lève ne fait pas tomber le choix', () => {
    expect(pickRecorderMimeType((t) => {
      if (t.includes('webm')) throw new Error('boom');
      return t === 'audio/mp4';
    })).toBe('audio/mp4');
  });

  it('tous les candidats sont des types audio', () => {
    for (const t of RECORDER_MIME_CANDIDATES) expect(t.startsWith('audio/')).toBe(true);
  });
});

describe('formatDuration', () => {
  it('affiche m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('ne montre jamais de durée négative ni NaN', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('tronque les fractions de seconde', () => {
    expect(formatDuration(59.9)).toBe('0:59');
  });
});

describe('La qualité attendue est un AVERTISSEMENT, pas un verrou', () => {
  it('en deçà du minimum, elle le dit', () => {
    expect(recordingQuality(0)).toBe('trop-court');
    expect(recordingQuality(MIN_RECORDING_SECONDS - 1)).toBe('trop-court');
  });

  it('le seuil est inclusif', () => {
    expect(recordingQuality(MIN_RECORDING_SECONDS)).toBe('acceptable');
  });

  it('une minute est le confort', () => {
    expect(recordingQuality(60)).toBe('bon');
    expect(recordingQuality(120)).toBe('bon');
  });

  it('le conseil change avec la durée', () => {
    expect(recordingAdvice(10)).toContain(String(MIN_RECORDING_SECONDS));
    expect(recordingAdvice(45)).toContain('utilisable');
    expect(recordingAdvice(90)).toContain('idéale');
  });

  it('rien n interdit d envoyer un enregistrement court', () => {
    // Bloquer à 29 secondes serait arbitraire : la route accepte, et
    // l'utilisateur reste maître de son choix.
    expect(composant).toContain('Enregistrement court : le clone sera moins fidèle.');
    expect(composant).toContain('const pret = !!blob && name.trim().length > 0 && consent && !sending;');
  });
});

describe('micErrorMessage — dire ce qui cloche VRAIMENT', () => {
  it('un refus demande d autoriser', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' })).toContain('Autorisez');
    expect(micErrorMessage({ name: 'SecurityError' })).toContain('Autorisez');
  });

  it('un micro absent ne demande PAS d autoriser', () => {
    // Dire « autorisez le micro » à quelqu'un qui n'en a pas l'envoie
    // chercher un réglage qui n'existe pas.
    const msg = micErrorMessage({ name: 'NotFoundError' });
    expect(msg).toContain('Aucun micro');
    expect(msg).not.toContain('Autorisez');
  });

  it('un micro occupé le dit', () => {
    expect(micErrorMessage({ name: 'NotReadableError' })).toContain('déjà utilisé');
  });

  it('un cas inconnu reste compréhensible', () => {
    expect(micErrorMessage(null)).toBeTruthy();
    expect(micErrorMessage(new Error('x'))).toBeTruthy();
    expect(micErrorMessage(undefined)).toBeTruthy();
  });
});

describe('Le micro est vraiment relâché', () => {
  it('les pistes sont arrêtées — pas seulement le MediaRecorder', () => {
    // `recorder.stop()` n'éteint pas le voyant « micro actif » : seules les
    // pistes du flux le font.
    expect(composant).toContain("streamRef.current?.getTracks().forEach((t) => t.stop());");
  });

  it('à la fin de l enregistrement ET au démontage', () => {
    const onstop = composant.slice(composant.indexOf('recorder.onstop'), composant.indexOf('recorder.start()'));
    expect(onstop).toContain('releaseMic();');
    const nettoyage = composant.slice(composant.indexOf('return () => {'), composant.indexOf('}, [clearTimer, releaseMic]);'));
    expect(nettoyage).toContain('clearTimer();');
    expect(nettoyage).toContain('releaseMic();');
    expect(nettoyage).toContain('URL.revokeObjectURL(urlRef.current)');
  });

  it('même si l ouverture du micro échoue', () => {
    // `getUserMedia` peut réussir puis `MediaRecorder` échouer : le flux
    // serait alors ouvert sans que rien ne l'utilise.
    const attrape = composant.slice(composant.indexOf('} catch (err) {'), composant.indexOf('setError(micErrorMessage(err));') + 40);
    expect(attrape).toContain('releaseMic();');
  });

  it('l URL de l objet est révoquée avant d en créer une autre', () => {
    // Sinon chaque prise garde son blob en mémoire.
    const onstop = composant.slice(composant.indexOf('recorder.onstop'), composant.indexOf('recorder.start()'));
    expect(onstop.indexOf('URL.revokeObjectURL')).toBeLessThan(onstop.indexOf('URL.createObjectURL'));
  });
});

describe('Le chrono', () => {
  it('s arrête tout seul au plafond', () => {
    expect(composant).toContain('if (next >= MAX_RECORDING_SECONDS) stopRecording();');
    expect(MAX_RECORDING_SECONDS).toBe(120);
  });

  it('l intervalle est nettoyé, jamais laissé courir', () => {
    expect(composant).toContain('clearInterval(timerRef.current);');
    expect(composant).toContain('timerRef.current = null;');
  });

  it('il est annoncé aux lecteurs d écran', () => {
    expect(composant).toContain('aria-live="polite"');
  });
});

describe('L envoi', () => {
  it('part en multipart, avec le champ `files` de la route', () => {
    expect(composant).toContain("form.append('files', blob,");
    expect(composant).toContain("form.append('name', name.trim());");
    expect(composant).toContain("form.append('consent', consent ? 'true' : 'false');");
  });

  it('aucun Content-Type à la main — le navigateur pose la frontière', () => {
    const envoi = composant.slice(composant.indexOf("fetch('/api/voice/clone', { method: 'POST'"), composant.indexOf('const data = await res.json();'));
    expect(envoi).not.toContain('Content-Type');
  });

  it('l extension du fichier suit le type réellement enregistré', () => {
    expect(composant).toContain("const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';");
  });

  it('le message réel d ElevenLabs est montré, pas avalé', () => {
    // C'est lui qui dit ce que l'enregistrement a de fautif.
    expect(composant).toContain("[data?.error, data?.detail].filter(Boolean).join(' — ')");
  });

  it('le consentement et le nom conditionnent le bouton', () => {
    expect(composant).toContain('disabled={!pret}');
  });

  it('un double clic ne lance pas deux clonages', () => {
    expect(composant).toContain('if (!blob || sending) return;');
  });

  it('la liste est rechargée après un clonage réussi', () => {
    expect(composant).toContain('await loadVoices();');
  });

  it('une vérification demandée par ElevenLabs est dite', () => {
    expect(composant).toContain('data.requiresVerification');
  });
});

describe('Intégration dans « Mon avatar »', () => {
  it('la section est montée sur la page', () => {
    expect(page).toContain("import VoiceCloneRecorder from '@/components/voice/VoiceCloneRecorder';");
    expect(page).toContain('<VoiceCloneRecorder />');
  });

  it('elle s affiche même sans avatar', () => {
    // Le clonage vocal alimente le sélecteur de TOUS les montages : il ne
    // dépend pas de l'existence d'un avatar.
    const bloc = page.slice(page.indexOf('<VoiceCloneRecorder />') - 400, page.indexOf('<VoiceCloneRecorder />'));
    expect(bloc).not.toContain('{avatar &&');
  });

  it('des icônes lucide, jamais un emoji', () => {
    expect(composant).toContain("from 'lucide-react'");
    expect(composant).toMatch(/<Mic className=/);
    expect(composant).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('le texte de consentement est celui que la route conserve', () => {
    expect(composant).toContain('Je certifie que la voix enregistrée est la mienne');
  });
});
