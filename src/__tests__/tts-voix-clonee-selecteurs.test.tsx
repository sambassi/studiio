import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { AudioStudioPanel } from '@/components/creer/AudioStudioPanel';
import { SequenceVoicesPanel } from '@/components/creer/SequenceVoicesPanel';
import { emptySequenceVoices, emptySequenceVoicesUserEdited } from '@/lib/types/voice';

/**
 * Les deux sélecteurs de voix TTS de Créer et la voix CLONÉE.
 *
 * Trois régressions observées, trois verrous :
 *
 *  1. Au rechargement, `localStorage['tts.voiceId'] = 'elevenlabs-…'` était
 *     rejeté (seuls HeyGen et le catalogue statique passaient) et l'effet
 *     de persistance réécrivait aussitôt la clé avec « Denise » : la voix
 *     clonée choisie disparaissait sans un mot.
 *  2. Sans choix enregistré, le sélecteur restait sur « Denise » alors que
 *     le compte possède une voix clonée — celle que l'utilisateur cherche.
 *  3. Le choix ne vivait que dans localStorage : le wizard ne pouvait ni le
 *     lire pour le brouillon, ni le rendre. D'où les props contrôlées.
 */

const CLONEE = 'elevenlabs-abc123';
const CLONEE_HEYGEN = 'heygen-zzz';
const DEFAUT = 'fr-FR-DeniseNeural';

let voixClonees: Array<Record<string, unknown>>;

function installerFetch() {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    const rep = (corps: unknown) => ({ ok: true, status: 200, json: async () => corps } as unknown as Response);
    if (u.includes('/api/tts/elevenlabs')) return rep({ voices: voixClonees, configured: false });
    if (u.includes('/api/tts/heygen')) return rep({ voices: [] });
    return rep({ success: true });
  }) as unknown as typeof fetch;
}

const voixBassi = (id = CLONEE) => ({
  id, name: 'Bassi (ma voix)', lang: 'FR', gender: 'Neutral', flag: '🎤', provider: 'elevenlabs', cloned: true,
});

const noop = () => {};

function monterAudio(extra: Partial<React.ComponentProps<typeof AudioStudioPanel>> = {}) {
  return render(
    <AudioStudioPanel
      musicUrl={null} musicName="" voiceUrl={null} voiceName=""
      musicVolume={0.5} voiceVolume={1}
      onMusicChange={noop} onVoiceChange={noop}
      onMusicVolumeChange={noop} onVoiceVolumeChange={noop}
      introDuration={4} cardsDuration={6} videoDuration={0} ctaDuration={4}
      onIntroDurationChange={noop} onCardsDurationChange={noop}
      onVideoDurationChange={noop} onCtaDurationChange={noop}
      hasRush={false}
      {...extra}
    />,
  );
}

function monterSequences(extra: Partial<React.ComponentProps<typeof SequenceVoicesPanel>> = {}) {
  return render(
    <SequenceVoicesPanel
      sequenceVoices={emptySequenceVoices()}
      userEdited={emptySequenceVoicesUserEdited()}
      onChange={noop} onUserEditedChange={noop} onResetText={noop}
      introDuration={4} cardsDuration={6} videoDuration={0} ctaDuration={4}
      hasCardsContent={false} hasVideoOverlay={false} batchCount={1}
      {...extra}
    />,
  );
}

const selecteurAudio = () => screen.getByTestId('tts-voice-select') as HTMLSelectElement;
const selecteurSequences = () => screen.getByTestId('seq-tts-voice-select') as HTMLSelectElement;
const cleLocale = () => window.localStorage.getItem('tts.voiceId');

/** Laisse la liste des voix arriver et les effets se poser. */
const attendre = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  window.localStorage.clear();
  voixClonees = [voixBassi()];
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('1. Une voix clonée enregistrée survit au rechargement', () => {
  it('AudioStudioPanel garde l identifiant elevenlabs-* et ne réécrit pas localStorage', async () => {
    window.localStorage.setItem('tts.voiceId', CLONEE);
    monterAudio();
    // L'option n'existe qu'une fois la liste arrivée : on attend qu'elle
    // soit là, puis on vérifie que rien n'a été réécrit entre-temps.
    await waitFor(() => expect(selecteurAudio().value).toBe(CLONEE));
    await attendre();
    expect(selecteurAudio().value).toBe(CLONEE);
    expect(cleLocale()).toBe(CLONEE);
  });

  it('SequenceVoicesPanel — même règle', async () => {
    window.localStorage.setItem('tts.voiceId', CLONEE);
    monterSequences();
    await waitFor(() => expect(selecteurSequences().value).toBe(CLONEE));
    await attendre();
    expect(selecteurSequences().value).toBe(CLONEE);
    expect(cleLocale()).toBe(CLONEE);
  });

  it('un identifiant inconnu (ni préfixé, ni du catalogue) retombe sur Denise, comme avant', async () => {
    window.localStorage.setItem('tts.voiceId', 'Google français');
    voixClonees = [];
    monterAudio();
    await attendre();
    expect(selecteurAudio().value).toBe(DEFAUT);
    expect(cleLocale()).toBe(DEFAUT);
  });
});

describe('2. Sans choix, la voix clonée du compte est présélectionnée', () => {
  it('AudioStudioPanel : rien d enregistré → la première voix clonée, une fois la liste arrivée', async () => {
    monterAudio();
    expect(selecteurAudio().value).toBe(DEFAUT);
    await waitFor(() => expect(selecteurAudio().value).toBe(CLONEE));
    expect(cleLocale()).toBe(CLONEE);
  });

  it('SequenceVoicesPanel : même présélection', async () => {
    monterSequences();
    await waitFor(() => expect(selecteurSequences().value).toBe(CLONEE));
  });

  it('la voix enregistrée est Denise (le défaut) → la voix clonée prend la place', async () => {
    window.localStorage.setItem('tts.voiceId', DEFAUT);
    monterAudio();
    await waitFor(() => expect(selecteurAudio().value).toBe(CLONEE));
  });

  it('⚠️ un choix explicite hors défaut n est PAS écrasé', async () => {
    window.localStorage.setItem('tts.voiceId', 'fr-FR-HenriNeural');
    monterAudio();
    await attendre();
    await attendre();
    expect(selecteurAudio().value).toBe('fr-FR-HenriNeural');
    expect(cleLocale()).toBe('fr-FR-HenriNeural');
  });

  it('sans voix clonée dans la liste, Denise reste', async () => {
    voixClonees = [{ ...voixBassi('elevenlabs-catalogue'), name: 'Rachel (ElevenLabs)', cloned: false }];
    monterAudio();
    await attendre();
    await attendre();
    expect(selecteurAudio().value).toBe(DEFAUT);
  });

  it('la première voix CLONÉE, pas la première de la liste', async () => {
    voixClonees = [
      { ...voixBassi('elevenlabs-catalogue'), name: 'Rachel (ElevenLabs)', cloned: false },
      voixBassi(CLONEE_HEYGEN),
      voixBassi(),
    ];
    monterAudio();
    await waitFor(() => expect(selecteurAudio().value).toBe(CLONEE_HEYGEN));
  });
});

describe('3. Props contrôlées : le wizard tient la voix', () => {
  it('AudioStudioPanel affiche `voiceId` plutôt que localStorage', async () => {
    window.localStorage.setItem('tts.voiceId', 'fr-FR-HenriNeural');
    monterAudio({ voiceId: CLONEE, onVoiceIdChange: noop });
    await waitFor(() => expect(selecteurAudio().value).toBe(CLONEE));
    await attendre();
    expect(selecteurAudio().value).toBe(CLONEE);
  });

  it('un changement remonte par `onVoiceIdChange` — et le parent décide', async () => {
    const onVoiceIdChange = vi.fn();
    voixClonees = [];
    monterAudio({ voiceId: DEFAUT, onVoiceIdChange });
    await attendre();
    await act(async () => { fireEvent.change(selecteurAudio(), { target: { value: 'fr-FR-HenriNeural' } }); });
    expect(onVoiceIdChange).toHaveBeenCalledWith('fr-FR-HenriNeural');
    // Contrôlé : sans mise à jour du parent, l'affichage ne bouge pas.
    expect(selecteurAudio().value).toBe(DEFAUT);
  });

  it('la présélection de la voix clonée passe elle aussi par `onVoiceIdChange`', async () => {
    const onVoiceIdChange = vi.fn();
    monterAudio({ voiceId: DEFAUT, onVoiceIdChange });
    await waitFor(() => expect(onVoiceIdChange).toHaveBeenCalledWith(CLONEE));
  });

  it('une voix restaurée par le parent n est pas remplacée par la présélection', async () => {
    const onVoiceIdChange = vi.fn();
    monterAudio({ voiceId: 'fr-FR-HenriNeural', onVoiceIdChange });
    await attendre();
    await attendre();
    expect(onVoiceIdChange).not.toHaveBeenCalled();
    expect(selecteurAudio().value).toBe('fr-FR-HenriNeural');
  });

  it('SequenceVoicesPanel accepte les mêmes props', async () => {
    const onVoiceIdChange = vi.fn();
    monterSequences({ voiceId: CLONEE, onVoiceIdChange });
    await waitFor(() => expect(selecteurSequences().value).toBe(CLONEE));
    await act(async () => { fireEvent.change(selecteurSequences(), { target: { value: DEFAUT } }); });
    expect(onVoiceIdChange).toHaveBeenCalledWith(DEFAUT);
  });
});
