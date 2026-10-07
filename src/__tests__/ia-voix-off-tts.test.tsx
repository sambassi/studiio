/**
 * Bouton IA de la « Synthèse vocale (TTS) » — Créer › Audio.
 *
 * Cause du bug : le bouton appelait `/api/content/ai-generate` en mode
 * « cartes » et lisait `data.cards` alors que la route répond
 * `{ content: { cards } }` — rien n'arrivait jamais, et l'erreur était avalée.
 * Le bouton semblait inactif.
 *
 * Verrouillé ici (aucun appel réseau réel — fetch et le modèle sont doublés) :
 *  - champ vide → « Proposer un texte » ; texte présent → « Améliorer mon texte » ;
 *  - le contexte connu (sujet, brief, titre, cartes, CTA, ton, format) part
 *    avec la demande et atteint la consigne du modèle ;
 *  - la proposition est AFFICHÉE, jamais appliquée d'office : accepter la
 *    pose, refuser garde le texte de l'utilisateur ;
 *  - un échec est visible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { modeVoixOff, promptVoixOff, corpsRequeteVoixOff, LIBELLE_MODE_VOIX_OFF } from '@/lib/creer/voix-off-ia';

vi.mock('@/lib/tts/edge-tts-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tts/edge-tts-client')>('@/lib/tts/edge-tts-client');
  return { ...actual, synthesize: vi.fn() };
});

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {} }));

const { AudioStudioPanel } = await import('@/components/creer/AudioStudioPanel');
const { POST } = await import('@/app/api/content/ai-generate/route');

const CONTEXTE = {
  sujet: 'danse afro fitness',
  titre: 'BOUGE TON CORPS',
  sousTitre: 'Brûle 500 kcal en dansant',
  cartes: ['CARDIO — +30% — Le cœur travaille sans s’en rendre compte.'],
  cta: 'RÉSERVE TON ESSAI',
  ton: 'Punchy',
  typeVideo: 'Reel vertical 9:16',
};
const BRIEF = { objectif: 'Remplir le cours d’essai de samedi', public: 'Adultes de Neuchâtel' };

describe('Consigne du modèle (module pur)', () => {
  it('mode choisi d’après le champ', () => {
    expect(modeVoixOff('')).toBe('proposer');
    expect(modeVoixOff('   ')).toBe('proposer');
    expect(modeVoixOff('Salut à tous')).toBe('ameliorer');
    expect(LIBELLE_MODE_VOIX_OFF.proposer).toBe('Proposer un texte');
    expect(LIBELLE_MODE_VOIX_OFF.ameliorer).toBe('Améliorer mon texte');
  });

  it('proposer : le contexte connu est dans la consigne', () => {
    const p = promptVoixOff({ texte: '', contexte: CONTEXTE, sujet: 'x', locale: 'fr' });
    for (const v of [CONTEXTE.sujet, CONTEXTE.titre, CONTEXTE.sousTitre, CONTEXTE.cartes[0], CONTEXTE.cta, CONTEXTE.ton, CONTEXTE.typeVideo]) {
      expect(p).toContain(v);
    }
    expect(p).toContain('voix-off');
    expect(p).not.toContain('Améliore');
  });

  it('améliorer : le texte de l’utilisateur est cité et son sens protégé', () => {
    const texte = 'Viens danser samedi a 10h, le premier cours est offert.';
    const p = promptVoixOff({ texte, contexte: CONTEXTE, locale: 'fr' });
    expect(p).toContain(texte);
    expect(p).toContain('Améliore');
    expect(p).toMatch(/même sens/);
  });
});

describe('Route /api/content/ai-generate — fieldType voixOff (modèle doublé)', () => {
  const envois: Array<{ messages: Array<{ content: string }>; max_tokens: number }> = [];
  beforeEach(() => {
    envois.length = 0;
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      envois.push(JSON.parse(String(init?.body ?? '{}')));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"text":"Bouge avec nous samedi !"}' }] }), text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('la consigne envoyée contient texte, contexte et brief ; la réponse est le texte', async () => {
    const body = corpsRequeteVoixOff({ texte: 'Viens danser samedi.', contexte: CONTEXTE, brief: BRIEF });
    const res = await POST({ json: async () => body } as never);
    const data = await res.json();
    expect(data).toEqual({ success: true, text: 'Bouge avec nous samedi !' });
    const consigne = envois[0].messages[0].content;
    expect(consigne).toContain('Viens danser samedi.');
    expect(consigne).toContain(CONTEXTE.titre);
    expect(consigne).toContain(CONTEXTE.cta);
    expect(consigne).toContain(BRIEF.objectif);
    expect(consigne).toContain(BRIEF.public);
  });
});

describe('Panneau audio — bouton IA de la synthèse vocale', () => {
  const noop = () => {};
  let appelsIa: Array<Record<string, any>>;
  let reponseIa: { status: number; corps: unknown };

  beforeEach(() => {
    appelsIa = [];
    reponseIa = { status: 200, corps: { success: true, text: 'Texte proposé par l’assistant.' } };
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/content/ai-generate')) {
        appelsIa.push(JSON.parse(String(init?.body ?? '{}')));
        return { ok: reponseIa.status < 400, status: reponseIa.status, json: async () => reponseIa.corps } as unknown as Response;
      }
      if (u.includes('/api/tts/')) return { ok: true, status: 200, json: async () => ({ voices: [] }) } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
  });
  afterEach(() => cleanup());

  const monter = () => render(
    <AudioStudioPanel
      musicUrl={null} musicName="" voiceUrl={null} voiceName=""
      musicVolume={0.5} voiceVolume={1}
      onMusicChange={noop} onVoiceChange={noop}
      onMusicVolumeChange={noop} onVoiceVolumeChange={noop}
      introDuration={4} cardsDuration={6} videoDuration={0} ctaDuration={4}
      onIntroDurationChange={noop} onCardsDurationChange={noop}
      onVideoDurationChange={noop} onCtaDurationChange={noop}
      hasRush={false}
      contentTheme="fitness"
      voixOffContexte={CONTEXTE}
      voixOffBrief={BRIEF}
    />,
  );
  const bouton = () => document.querySelector('[data-tts-ia]') as HTMLButtonElement;
  const zone = () => screen.getByPlaceholderText('Tapez votre texte ici...') as HTMLTextAreaElement;

  it('champ vide → « Proposer un texte » ; la proposition s’affiche SANS remplacer ; accepter la pose', async () => {
    monter();
    expect(bouton().textContent).toContain('Proposer un texte');
    fireEvent.click(bouton());
    await waitFor(() => expect(document.querySelector('[data-tts-ia-proposition]')).not.toBeNull());
    expect(appelsIa).toHaveLength(1);
    expect(appelsIa[0].fieldType).toBe('voixOff');
    expect(appelsIa[0].sourceText).toBe('');
    expect(appelsIa[0].contexte).toMatchObject({ sujet: CONTEXTE.sujet, titre: CONTEXTE.titre, cta: CONTEXTE.cta });
    expect(appelsIa[0].brief).toEqual(BRIEF);
    // Jamais appliqué d'office.
    expect(zone().value).toBe('');
    fireEvent.click(document.querySelector('[data-tts-ia-accepter]')!);
    expect(zone().value).toBe('Texte proposé par l’assistant.');
    expect(document.querySelector('[data-tts-ia-proposition]')).toBeNull();
  });

  it('texte présent → « Améliorer mon texte » ; refuser garde le texte de l’utilisateur', async () => {
    monter();
    fireEvent.change(zone(), { target: { value: 'mon texte a moi' } });
    expect(bouton().textContent).toContain('Améliorer mon texte');
    fireEvent.click(bouton());
    await waitFor(() => expect(document.querySelector('[data-tts-ia-proposition]')).not.toBeNull());
    expect(appelsIa[0].sourceText).toBe('mon texte a moi');
    expect(zone().value).toBe('mon texte a moi');
    fireEvent.click(document.querySelector('[data-tts-ia-refuser]')!);
    expect(zone().value).toBe('mon texte a moi');
    expect(document.querySelector('[data-tts-ia-proposition]')).toBeNull();
  });

  it('échec de l’assistant → message visible, texte intact', async () => {
    reponseIa = { status: 503, corps: { success: false, useLocalFallback: true } };
    monter();
    fireEvent.change(zone(), { target: { value: 'garde moi' } });
    fireEvent.click(bouton());
    await waitFor(() => expect(document.querySelector('[data-tts-ia-erreur]')).not.toBeNull());
    expect(document.querySelector('[data-tts-ia-erreur]')!.textContent).toMatch(/indisponible/);
    expect(zone().value).toBe('garde moi');
  });
});
