import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SequenceVoicesPanel } from '@/components/creer/SequenceVoicesPanel';
import { emptySequenceVoices, emptySequenceVoicesUserEdited } from '@/lib/types/voice';
import { voiceSequenceSeconds } from '@/lib/creer/voiceFit';

/**
 * « Adapter la durée à la voix » — l'action EXPLICITE du panneau des voix.
 *
 * Observé en prod : « Voix 5,1 s < séquence 6 s : raccourcir de 0,9 s
 * (séquence à 6 s pour coller) ». La cible proposée était la durée déjà en
 * place, et une voix un peu plus courte était présentée comme une erreur.
 *
 * Ce que ces tests verrouillent :
 *  - la cible affichée et appliquée est `voiceSequenceSeconds` (voix + marge,
 *    au dixième) — une seule règle, jamais la durée courante ;
 *  - l'action n'écrit la durée QUE sur clic : sans clic, la durée réglée à la
 *    main est conservée ;
 *  - une voix plus courte est une information (pas un avertissement) ; seule
 *    la voix qui déborde — et coupe l'audio — est un avertissement.
 */

vi.mock('@/lib/tts/edge-tts-client', () => ({
  TTS_VOICES: [{ id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'FR', gender: 'F', flag: '🇫🇷' }],
  synthesize: vi.fn(),
}));

function monter(opts: { audio: number; seq: number; onSequenceDurationChange?: (k: string, s: number) => void }) {
  const voices = emptySequenceVoices();
  voices.titre = { text: 'Bonjour', audioUrl: 'https://cdn/titre.mp3', source: 'tts', duration: opts.audio };
  return render(
    <SequenceVoicesPanel
      sequenceVoices={voices}
      userEdited={emptySequenceVoicesUserEdited()}
      onChange={() => {}}
      onUserEditedChange={() => {}}
      onResetText={() => {}}
      introDuration={opts.seq}
      cardsDuration={6}
      videoDuration={0}
      ctaDuration={4}
      hasCardsContent={false}
      hasVideoOverlay={false}
      batchCount={1}
      onSequenceDurationChange={opts.onSequenceDurationChange}
    />,
  );
}

describe('Adapter la durée à la voix', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('propose la cible voix + marge, jamais la durée courante (cas de prod 5,1 s / 6 s)', () => {
    monter({ audio: 5.1, seq: 6, onSequenceDurationChange: () => {} });
    const fit = screen.getByTestId('voice-fit-titre');
    expect(fit.textContent).toContain('5,4 s');
    expect(fit.textContent).not.toMatch(/séquence à 6 s/);
    // Information, pas avertissement : la voix tient, il reste du silence.
    expect(fit.getAttribute('data-severity')).toBe('info');
  });

  it('n écrit la durée QUE sur clic, avec la cible de `voiceSequenceSeconds`', () => {
    const onSequenceDurationChange = vi.fn();
    monter({ audio: 5.1, seq: 6, onSequenceDurationChange });
    // Sans clic : aucune écriture — la durée réglée à la main est conservée.
    expect(onSequenceDurationChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('voice-fit-apply-titre'));
    expect(onSequenceDurationChange).toHaveBeenCalledTimes(1);
    const [cle, secondes] = onSequenceDurationChange.mock.calls[0];
    expect(cle).toBe('titre');
    expect(secondes).toBe(voiceSequenceSeconds(5.1));
    expect(secondes).toBeCloseTo(5.4, 5);
  });

  it('signale la COUPURE quand la voix déborde — avertissement', () => {
    monter({ audio: 7.2, seq: 4, onSequenceDurationChange: () => {} });
    const fit = screen.getByTestId('voice-fit-titre');
    expect(fit.getAttribute('data-severity')).toBe('warning');
    expect(fit.textContent).toContain('coupée');
    expect(fit.textContent).toContain('7,5 s');
    expect(screen.getByTestId('voice-fit-apply-titre')).toBeTruthy();
  });

  it('une séquence déjà calée est OK : ni bouton, ni avertissement', () => {
    monter({ audio: 5.1, seq: voiceSequenceSeconds(5.1), onSequenceDurationChange: () => {} });
    const fit = screen.getByTestId('voice-fit-titre');
    expect(fit.getAttribute('data-severity')).toBe('ok');
    expect(screen.queryByTestId('voice-fit-apply-titre')).toBeNull();
    // La durée décimale s'affiche telle quelle, pas tronquée à l'entier.
    expect(fit.parentElement?.textContent).toContain('5.4s');
  });

  it('sans callback, l indicateur reste mais l action n est pas proposée', () => {
    monter({ audio: 5.1, seq: 6 });
    expect(screen.getByTestId('voice-fit-titre')).toBeTruthy();
    expect(screen.queryByTestId('voice-fit-apply-titre')).toBeNull();
  });
});
