/**
 * « Ma voix clonée » dans Créer > Audio — carte, groupes du sélecteur,
 * audio périmé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REPRODUIT EN PRODUCTION (2026-09-21 14:57 UTC)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `GET /api/tts/elevenlabs` rendait 22 voix dont « Bassi (ma voix) »
 * (`cloned: true`) en tête ; l'étape Audio affichait pourtant « Henri » :
 * `localStorage['tts.voiceId'] = 'fr-FR-HenriNeural'` (choix hors défaut,
 * donc la présélection ne s'applique pas), et la voix clonée était noyée
 * dans un <select> plat de ~130 entrées. L'Autopilote, lui, a un bloc
 * dédié — Créer n'en avait pas.
 *
 * Ce fichier verrouille, sur les VRAIS composants :
 *  1. la carte : voix clonée listée avec son badge, « utilisée » quand c'est
 *     la voix courante, « Utiliser ma voix » qui remonte l'identifiant, le
 *     lien vers le parcours existant, l'état de chargement, le cas « aucune » ;
 *  2. les <optgroup> des deux sélecteurs — voix clonée EN TÊTE, ids inchangés ;
 *  3. « Audio périmé — régénérer » : voix changée ou texte changé → badge ;
 *     régénération → le badge disparaît ; jamais de génération automatique.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import MaVoixClonee, { LIEN_GERER_MA_VOIX } from '@/components/creer/MaVoixClonee';
import { AudioStudioPanel } from '@/components/creer/AudioStudioPanel';
import { SequenceVoicesPanel } from '@/components/creer/SequenceVoicesPanel';
import { synthesize, TTS_VOICES, type TtsVoice } from '@/lib/tts/edge-tts-client';
import {
  emptySequenceVoices,
  emptySequenceVoicesUserEdited,
  grouperVoixPourSelecteur,
  audioSequencePerime,
  VOICE_GROUP_LABELS,
  type SequenceKey,
  type SequenceVoice,
  type SequenceVoices,
} from '@/lib/types/voice';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

vi.mock('@/lib/tts/edge-tts-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tts/edge-tts-client')>('@/lib/tts/edge-tts-client');
  return { ...actual, synthesize: vi.fn() };
});

const CLONEE = 'elevenlabs-ohwPBassi';
const HENRI = 'fr-FR-HenriNeural';

const voixBassi = (over: Partial<TtsVoice> = {}): TtsVoice => ({
  id: CLONEE, name: 'Bassi (ma voix)', lang: 'FR', gender: 'Neutral', flag: '🎤', provider: 'elevenlabs', cloned: true, ...over,
});
const voixCatalogue = (id: string, name: string): TtsVoice => ({
  id, name, lang: 'EN', gender: 'Female', flag: '🇺🇸', provider: 'elevenlabs', cloned: false,
});
const voixHeyGen = (id: string, name: string, cloned = false): TtsVoice => ({
  id, name, lang: 'FR', gender: 'Male', flag: '🇫🇷', provider: 'heygen', cloned,
});

let voixElevenLabs: TtsVoice[];
let voixHeygen: TtsVoice[];
let appels: Array<{ url: string; method: string }>;

function installerFetch() {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: init?.method ?? 'GET' });
    const rep = (corps: unknown, status = 200) => ({
      ok: status < 400, status, json: async () => corps, headers: new Headers({ 'content-length': '20000' }),
    } as unknown as Response);
    if (u.includes('/api/tts/elevenlabs')) return rep({ voices: voixElevenLabs, configured: true });
    if (u.includes('/api/tts/heygen')) return rep({ voices: voixHeygen });
    if (u.includes('/api/upload/signed-url')) return rep({ success: true, signedUrl: 'https://cdn/put', publicUrl: `https://cdn/voix-${appels.length}.mp3` });
    return rep({ success: true });
  }) as unknown as typeof fetch;
}

/** jsdom ne charge aucun média : `probeDuration` attend `loadedmetadata`, on le simule. */
class FauxAudio extends EventTarget {
  preload = '';
  duration = 3.2;
  set src(_v: string) { setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0); }
}

const noop = () => {};
const attendre = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  window.localStorage.clear();
  voixElevenLabs = [voixBassi(), voixCatalogue('elevenlabs-rachel', 'Rachel (ElevenLabs)')];
  voixHeygen = [voixHeyGen('heygen-paul', 'Paul')];
  installerFetch();
  (globalThis as unknown as { Audio: unknown }).Audio = FauxAudio;
  vi.mocked(synthesize).mockReset();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// 1. La carte
// ────────────────────────────────────────────────────────────────────────────

describe('1. La carte « Ma voix clonée »', () => {
  const voices = [voixBassi(), voixCatalogue('elevenlabs-rachel', 'Rachel (ElevenLabs)')];

  it('liste la voix clonée avec son badge, et seulement elle', () => {
    render(<MaVoixClonee voices={voices} loading={false} voiceId={HENRI} onVoiceIdChange={noop} />);
    const carte = document.querySelector('[data-ma-voix-clonee]')!;
    expect(carte.textContent).toContain('Ma voix clonée');
    expect(carte.textContent).toContain('Bassi (ma voix)');
    expect(carte.textContent).toContain('voix clonée');
    expect(carte.textContent).not.toContain('Rachel');
    expect(document.querySelectorAll('[data-ma-voix-clonee-voix]')).toHaveLength(1);
  });

  it('« Utiliser ma voix » remonte l identifiant de la voix clonée — rien d autre', () => {
    const onVoiceIdChange = vi.fn();
    render(<MaVoixClonee voices={voices} loading={false} voiceId={HENRI} onVoiceIdChange={onVoiceIdChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser ma voix' }));
    expect(onVoiceIdChange).toHaveBeenCalledTimes(1);
    expect(onVoiceIdChange).toHaveBeenCalledWith(CLONEE);
    // La carte ne clone rien : aucun appel réseau, en particulier pas POST /api/voice/clone.
    expect(appels.filter((a) => a.url.includes('/api/voice/clone'))).toHaveLength(0);
  });

  it('marque « utilisée » quand la voix courante est la voix clonée — le bouton disparaît', () => {
    render(<MaVoixClonee voices={voices} loading={false} voiceId={CLONEE} onVoiceIdChange={noop} />);
    const ligne = document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)!;
    expect(ligne.getAttribute('data-utilisee')).toBe('true');
    expect(ligne.textContent).toContain('utilisée');
    expect(screen.queryByRole('button', { name: 'Utiliser ma voix' })).toBeNull();
  });

  it('renvoie vers le parcours EXISTANT de gestion de la voix (Mon avatar, section « Ma voix »)', () => {
    render(<MaVoixClonee voices={voices} loading={false} voiceId={HENRI} onVoiceIdChange={noop} />);
    const lien = document.querySelector('[data-ma-voix-clonee-gerer]') as HTMLAnchorElement;
    expect(lien.textContent).toBe('Gérer / cloner ma voix');
    expect(lien.getAttribute('href')).toBe(LIEN_GERER_MA_VOIX);
    expect(LIEN_GERER_MA_VOIX).toBe('/dashboard/avatar#ma-voix');
    // La cible existe : la section « Ma voix » de Mon avatar porte cet id.
    const pageAvatar = readFileSync(join(process.cwd(), 'src/app/dashboard/avatar/page.tsx'), 'utf8');
    expect(pageAvatar).toContain('<section id="ma-voix"');
  });

  it('sans voix clonée : « Aucune voix clonée sur ce compte » + le même lien', () => {
    render(<MaVoixClonee voices={[voixCatalogue('elevenlabs-rachel', 'Rachel (ElevenLabs)')]} loading={false} voiceId={HENRI} onVoiceIdChange={noop} />);
    expect(document.querySelector('[data-ma-voix-clonee-aucune]')!.textContent).toBe('Aucune voix clonée sur ce compte.');
    expect(document.querySelector('[data-ma-voix-clonee-gerer]')!.getAttribute('href')).toBe(LIEN_GERER_MA_VOIX);
    expect(screen.queryByRole('button', { name: 'Utiliser ma voix' })).toBeNull();
  });

  it('pendant le chargement : ni « aucune », ni liste — un état d attente', () => {
    render(<MaVoixClonee voices={[]} loading voiceId={HENRI} onVoiceIdChange={noop} />);
    expect(document.querySelector('[data-ma-voix-clonee-chargement]')).not.toBeNull();
    expect(document.querySelector('[data-ma-voix-clonee-aucune]')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La carte dans le VRAI panneau audio (cas de prod : Henri en localStorage)
// ────────────────────────────────────────────────────────────────────────────

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

const selecteurAudio = () => screen.getByTestId('tts-voice-select') as HTMLSelectElement;
const selecteurSequences = () => screen.getByTestId('seq-tts-voice-select') as HTMLSelectElement;

describe('La carte dans AudioStudioPanel', () => {
  it('cas de prod : Henri choisi, une voix clonée sur le compte → la carte la montre, un clic la fait passer', async () => {
    const onVoiceIdChange = vi.fn();
    monterAudio({ voiceId: HENRI, onVoiceIdChange, clonedVoiceCard: true });
    // Chargement d'abord, puis la voix — jamais « aucune » entre les deux.
    expect(document.querySelector('[data-ma-voix-clonee-chargement]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)).not.toBeNull());
    expect(document.querySelector('[data-ma-voix-clonee-aucune]')).toBeNull();
    // Henri reste la voix courante : la carte ne remplace pas un choix explicite.
    expect(selecteurAudio().value).toBe(HENRI);
    expect(onVoiceIdChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser ma voix' }));
    expect(onVoiceIdChange).toHaveBeenCalledWith(CLONEE);
  });

  it('un seul appel aux voix : la carte reçoit la liste du panneau, elle ne la redemande pas', async () => {
    monterAudio({ voiceId: HENRI, onVoiceIdChange: noop, clonedVoiceCard: true });
    await waitFor(() => expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)).not.toBeNull());
    expect(appels.filter((a) => a.url.includes('/api/tts/elevenlabs'))).toHaveLength(1);
    expect(appels.filter((a) => a.url.includes('/api/tts/heygen'))).toHaveLength(1);
    expect(appels.filter((a) => a.url.includes('/api/voice/clone'))).toHaveLength(0);
  });

  it('la carte est ABSENTE par défaut : les autres appelants gardent leur écran', async () => {
    monterAudio({ voiceId: HENRI, onVoiceIdChange: noop });
    await attendre();
    expect(document.querySelector('[data-ma-voix-clonee]')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Les groupes des deux sélecteurs
// ────────────────────────────────────────────────────────────────────────────

describe('2. <optgroup> : la voix clonée en tête, les ids inchangés', () => {
  it('grouperVoixPourSelecteur : clonée / ElevenLabs / HeyGen / OpenAI / Edge, groupes vides omis', () => {
    const groupes = grouperVoixPourSelecteur([
      voixCatalogue('elevenlabs-rachel', 'Rachel'),
      voixHeyGen('heygen-paul', 'Paul'),
      voixHeyGen('heygen-moi', 'Moi', true),
      voixBassi(),
      ...TTS_VOICES,
    ]);
    expect(groupes.map((g) => g.label)).toEqual([
      VOICE_GROUP_LABELS.cloned, VOICE_GROUP_LABELS.elevenlabs, VOICE_GROUP_LABELS.heygen,
      VOICE_GROUP_LABELS.openai, VOICE_GROUP_LABELS.edge,
    ]);
    // Les deux voix clonées, quel que soit le fournisseur, dans l'ordre reçu.
    expect(groupes[0].voices.map((v) => v.id)).toEqual(['heygen-moi', CLONEE]);
    expect(groupes[1].voices.map((v) => v.id)).toEqual(['elevenlabs-rachel']);
    expect(groupes[2].voices.map((v) => v.id)).toEqual(['heygen-paul']);
    expect(groupes[3].voices.every((v) => v.id.startsWith('openai-'))).toBe(true);
    expect(groupes[4].voices.every((v) => !v.provider || v.provider === 'edge')).toBe(true);
    // Rien de perdu, rien d'inventé.
    const tous = groupes.flatMap((g) => g.voices.map((v) => v.id));
    expect(tous).toHaveLength(4 + TTS_VOICES.length);
    expect(grouperVoixPourSelecteur([])).toEqual([]);
  });

  for (const [nom, monter, selecteur] of [
    ['AudioStudioPanel', () => monterAudio({ voiceId: HENRI, onVoiceIdChange: noop }), selecteurAudio],
    ['SequenceVoicesPanel', () => render(
      <SequenceVoicesPanel
        sequenceVoices={emptySequenceVoices()} userEdited={emptySequenceVoicesUserEdited()}
        onChange={noop} onUserEditedChange={noop} onResetText={noop}
        introDuration={4} cardsDuration={6} videoDuration={0} ctaDuration={4}
        hasCardsContent={false} hasVideoOverlay={false} batchCount={1}
        voiceId={HENRI} onVoiceIdChange={noop}
      />,
    ), selecteurSequences],
  ] as const) {
    it(`${nom} : « Ma voix clonée » est le premier groupe, puis ElevenLabs, HeyGen, OpenAI, Edge`, async () => {
      monter();
      await waitFor(() => expect(Array.from(selecteur().options).some((o) => o.value === CLONEE)).toBe(true));
      const groupes = Array.from(selecteur().querySelectorAll('optgroup'));
      expect(groupes.map((g) => g.label)).toEqual([
        VOICE_GROUP_LABELS.cloned, VOICE_GROUP_LABELS.elevenlabs, VOICE_GROUP_LABELS.heygen,
        VOICE_GROUP_LABELS.openai, VOICE_GROUP_LABELS.edge,
      ]);
      // La voix clonée est la TOUTE première option du sélecteur.
      expect(selecteur().options[0].value).toBe(CLONEE);
      expect(groupes[0].querySelectorAll('option')).toHaveLength(1);
      // Les identifiants sont exactement ceux des voix : le regroupement n'en change aucun.
      const ids = Array.from(selecteur().options).map((o) => o.value);
      expect(ids).toEqual([CLONEE, 'elevenlabs-rachel', 'heygen-paul', ...TTS_VOICES.filter((v) => v.provider === 'openai').map((v) => v.id), ...TTS_VOICES.filter((v) => !v.provider || v.provider === 'edge').map((v) => v.id)]);
      expect(new Set(ids).size).toBe(ids.length);
      // Henri reste sélectionnable et sélectionné : rien n'est perdu.
      expect(selecteur().value).toBe(HENRI);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Audio périmé
// ────────────────────────────────────────────────────────────────────────────

describe('3a. audioSequencePerime — la règle', () => {
  const base: Pick<SequenceVoice, 'audioUrl' | 'source' | 'ttsVoice' | 'text' | 'textAtGeneration'> = {
    audioUrl: 'https://cdn/a.mp3', source: 'tts', ttsVoice: HENRI, text: 'Bonjour', textAtGeneration: 'Bonjour',
  };
  it('à jour : même voix, même texte', () => {
    expect(audioSequencePerime(base, HENRI)).toEqual({ perime: false, motif: null });
  });
  it('voix changée → périmé (voix)', () => {
    expect(audioSequencePerime(base, CLONEE)).toEqual({ perime: true, motif: 'voix' });
  });
  it('texte changé → périmé (texte) ; les espaces autour ne comptent pas', () => {
    expect(audioSequencePerime({ ...base, text: 'Bonsoir' }, HENRI)).toEqual({ perime: true, motif: 'texte' });
    expect(audioSequencePerime({ ...base, text: '  Bonjour \n' }, HENRI).perime).toBe(false);
  });
  it('sans audio : jamais périmé', () => {
    expect(audioSequencePerime({ ...base, audioUrl: null, text: 'autre' }, CLONEE).perime).toBe(false);
  });
  it('audio antérieur au champ (pas de textAtGeneration) : seule la voix compte', () => {
    expect(audioSequencePerime({ ...base, textAtGeneration: undefined, text: 'autre' }, HENRI).perime).toBe(false);
    expect(audioSequencePerime({ ...base, textAtGeneration: undefined }, CLONEE).motif).toBe('voix');
  });
  it('un enregistrement au micro n a pas de voix TTS : changer la voix ne le périme pas', () => {
    expect(audioSequencePerime({ ...base, source: 'record', ttsVoice: undefined, textAtGeneration: undefined }, CLONEE).perime).toBe(false);
  });
});

/** Parent minimal : tient `sequenceVoices` et la voix comme le wizard. */
function Parent({ initial, voiceInitial, onGenere }: { initial: SequenceVoices; voiceInitial: string; onGenere?: () => void }) {
  const [voices, setVoices] = useState(initial);
  const [voiceId, setVoiceId] = useState(voiceInitial);
  return (
    <>
      <button type="button" data-changer-voix onClick={() => setVoiceId(CLONEE)}>changer voix</button>
      <SequenceVoicesPanel
        sequenceVoices={voices} userEdited={emptySequenceVoicesUserEdited()}
        onChange={(key: SequenceKey, patch: Partial<SequenceVoice>) => {
          if (patch.audioUrl) onGenere?.();
          setVoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
        }}
        onUserEditedChange={noop} onResetText={noop}
        introDuration={4} cardsDuration={6} videoDuration={0} ctaDuration={4}
        hasCardsContent={false} hasVideoOverlay={false} batchCount={1}
        voiceId={voiceId} onVoiceIdChange={setVoiceId}
      />
    </>
  );
}

const avecAudioTitre = (over: Partial<SequenceVoice> = {}): SequenceVoices => {
  const v = emptySequenceVoices();
  v.titre = { text: 'Bonjour à tous', audioUrl: 'https://cdn/titre.mp3', source: 'tts', ttsVoice: HENRI, duration: 2, textAtGeneration: 'Bonjour à tous', ...over };
  return v;
};
const badge = () => document.querySelector('[data-voice-stale="titre"]');

describe('3b. SequenceVoicesPanel — « Audio périmé — régénérer »', () => {
  it('audio à jour : pas de badge', async () => {
    render(<Parent initial={avecAudioTitre()} voiceInitial={HENRI} />);
    await attendre();
    expect(badge()).toBeNull();
  });

  it('la voix change (« Utiliser ma voix ») → badge « périmé », l audio est CONSERVÉ, rien n est régénéré', async () => {
    render(<Parent initial={avecAudioTitre()} voiceInitial={HENRI} />);
    await attendre();
    await act(async () => { fireEvent.click(document.querySelector('[data-changer-voix]')!); });
    expect(badge()).not.toBeNull();
    expect(badge()!.getAttribute('data-voice-stale-motif')).toBe('voix');
    expect(badge()!.textContent).toContain('Audio périmé — régénérer');
    expect(badge()!.textContent).toContain('Henri');
    // L'audio est toujours là (lecteur présent), et aucune synthèse n'est partie toute seule.
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('le texte change → badge « périmé » (texte), sans génération automatique', async () => {
    render(<Parent initial={avecAudioTitre()} voiceInitial={HENRI} />);
    await attendre();
    const zone = screen.getAllByPlaceholderText('Texte de la voix-off…')[0] as HTMLTextAreaElement; // titre = 1re séquence
    await act(async () => { fireEvent.change(zone, { target: { value: 'Bonjour à toutes et à tous' } }); });
    expect(badge()).not.toBeNull();
    expect(badge()!.getAttribute('data-voice-stale-motif')).toBe('texte');
    expect(synthesize).not.toHaveBeenCalled();
    // Retour au texte d'origine : plus rien à signaler.
    await act(async () => { fireEvent.change(zone, { target: { value: 'Bonjour à tous' } }); });
    expect(badge()).toBeNull();
  });

  it('audio antérieur au champ (sans textAtGeneration) : un texte retouché n est pas signalé à tort', async () => {
    render(<Parent initial={avecAudioTitre({ textAtGeneration: undefined })} voiceInitial={HENRI} />);
    await attendre();
    const zone = screen.getAllByPlaceholderText('Texte de la voix-off…')[0] as HTMLTextAreaElement; // titre = 1re séquence
    await act(async () => { fireEvent.change(zone, { target: { value: 'Autre chose' } }); });
    expect(badge()).toBeNull();
  });

  it('« Régénérer » relance la synthèse avec la voix courante et le texte courant → le badge disparaît', async () => {
    vi.mocked(synthesize).mockResolvedValue(new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }));
    const onGenere = vi.fn();
    render(<Parent initial={avecAudioTitre()} voiceInitial={HENRI} onGenere={onGenere} />);
    await attendre();
    await act(async () => { fireEvent.click(document.querySelector('[data-changer-voix]')!); });
    expect(badge()).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Régénérer' })); });
    await waitFor(() => expect(onGenere).toHaveBeenCalledTimes(1));
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledWith('Bonjour à tous', CLONEE);
    await waitFor(() => expect(badge()).toBeNull());
  });
});

describe('3c. AudioStudioPanel — TTS global : « généré avec » + périmé', () => {
  function ParentAudio({ voiceInitial }: { voiceInitial: string }) {
    const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
    const [voiceName, setVoiceName] = useState('');
    const [voiceId, setVoiceId] = useState(voiceInitial);
    return (
      <>
        <button type="button" data-changer-voix onClick={() => setVoiceId(CLONEE)}>changer voix</button>
        <AudioStudioPanel
          musicUrl={null} musicName="" voiceUrl={voiceUrl} voiceName={voiceName}
          musicVolume={0.5} voiceVolume={1}
          onMusicChange={noop} onVoiceChange={(url, name) => { setVoiceUrl(url); setVoiceName(name); }}
          onMusicVolumeChange={noop} onVoiceVolumeChange={noop}
          introDuration={4} cardsDuration={6} videoDuration={0} ctaDuration={4}
          onIntroDurationChange={noop} onCardsDurationChange={noop}
          onVideoDurationChange={noop} onCtaDurationChange={noop}
          hasRush={false}
          voiceId={voiceId} onVoiceIdChange={setVoiceId}
        />
      </>
    );
  }
  const badgeGlobal = () => document.querySelector('[data-voice-generated-with]');

  it('après génération : « Généré avec Henri » ; la voix change → périmé ; jamais de régénération seule', async () => {
    vi.mocked(synthesize).mockResolvedValue(new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }));
    render(<ParentAudio voiceInitial={HENRI} />);
    await attendre();
    expect(badgeGlobal()).toBeNull();
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Tapez votre texte ici...'), { target: { value: 'Salut' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Générer/ })); });
    await waitFor(() => expect(badgeGlobal()).not.toBeNull());
    expect(badgeGlobal()!.getAttribute('data-voice-generated-with')).toContain('Henri');
    expect(badgeGlobal()!.getAttribute('data-voice-stale')).toBe('false');
    expect(synthesize).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(document.querySelector('[data-changer-voix]')!); });
    expect(badgeGlobal()!.getAttribute('data-voice-stale')).toBe('true');
    expect(badgeGlobal()!.textContent).toContain('Audio périmé');
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('voix off restaurée d un brouillon (« TTS — Bassi (ma voix) ») : le nom seul fait foi', async () => {
    monterAudio({ voiceUrl: 'https://cdn/v.mp3', voiceName: 'TTS — Bassi (ma voix)', voiceId: CLONEE, onVoiceIdChange: noop });
    await waitFor(() => expect(badgeGlobal()).not.toBeNull());
    await waitFor(() => expect(badgeGlobal()!.getAttribute('data-voice-stale')).toBe('false'));
    cleanup();
    monterAudio({ voiceUrl: 'https://cdn/v.mp3', voiceName: 'TTS — Bassi (ma voix)', voiceId: HENRI, onVoiceIdChange: noop });
    await waitFor(() => expect(badgeGlobal()!.getAttribute('data-voice-stale')).toBe('true'));
  });

  it('une voix off importée (pas « TTS — ») n a pas de badge', async () => {
    monterAudio({ voiceUrl: 'https://cdn/v.mp3', voiceName: 'mon-enregistrement.mp3', voiceId: HENRI, onVoiceIdChange: noop });
    await attendre();
    expect(badgeGlobal()).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Le brouillon relit `textAtGeneration` — avec l'audio seulement
// ────────────────────────────────────────────────────────────────────────────

describe('sanitizeDraft — sequenceVoices.textAtGeneration', () => {
  const DEPS: SanitizeDeps = {
    themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16'], maxStep: 3,
    defaults: {
      themeId: 'sommeil', toneId: 'punchy', format: '9:16',
      titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
      subtitleStyle: { font: null, color: null, scale: 1 },
      ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
      sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: false }, { key: 'cta', enabled: true }],
      durations: { intro: 4, cards: 6, video: 0, cta: 4 },
    },
  };
  const lire = (sequenceVoices: unknown) => sanitizeDraft({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1, themeId: 'sommeil', toneId: 'punchy', format: '9:16',
    titleStyle: DEPS.defaults.titleStyle, subtitleStyle: DEPS.defaults.subtitleStyle, ctaStyle: DEPS.defaults.ctaStyle,
    sequences: DEPS.defaults.sequences, sequenceVoices,
  }, DEPS)!.sequenceVoices;

  it('relu avec l audio, tronqué à 2000 caractères', () => {
    const d = lire({ titre: { text: 'Bonjour', audioUrl: 'https://cdn/a.mp3', source: 'tts', ttsVoice: HENRI, textAtGeneration: 'Bonjour' } });
    expect(d?.titre.textAtGeneration).toBe('Bonjour');
    const long = lire({ titre: { text: 'x', audioUrl: 'https://cdn/a.mp3', textAtGeneration: 'a'.repeat(3000) } });
    expect(long?.titre.textAtGeneration).toHaveLength(2000);
  });
  it('sans audio ou mal typé : absent — un brouillon antérieur se relit à l identique', () => {
    expect(lire({ titre: { text: 'Bonjour', textAtGeneration: 'Bonjour' } })?.titre).toEqual({ text: 'Bonjour' });
    expect(lire({ titre: { text: 'Bonjour', audioUrl: 'https://cdn/a.mp3', textAtGeneration: 42 } })?.titre).not.toHaveProperty('textAtGeneration');
    expect(lire({ titre: { text: 'Bonjour', audioUrl: 'https://cdn/a.mp3' } })?.titre).not.toHaveProperty('textAtGeneration');
  });
});
