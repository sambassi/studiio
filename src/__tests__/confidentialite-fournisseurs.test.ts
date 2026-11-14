/**
 * CONFIDENTIALITÉ DES FOURNISSEURS — non-régression sur ce que lit le
 * NAVIGATEUR d'un utilisateur ordinaire.
 *
 * Les gestionnaires sont APPELÉS (jamais grepés : cf. tasks/lessons.md,
 * « grepper le source ne prouve rien ») avec une session valide et AUCUNE clé
 * de fournisseur en environnement — le chemin « service non configuré », le
 * plus bavard historiquement. Le corps JSON rendu est ensuite confronté à la
 * liste des marques interdites.
 *
 * Ce test attrape les deux fuites : nommer le prestataire, et relayer son
 * message d'erreur brut.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NOMS_FOURNISSEURS_INTERDITS } from '@/lib/fournisseurs/messages-neutres';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/service-alerts', () => ({
  detectAndReportServiceError: vi.fn(),
  reportServiceAlert: vi.fn(),
}));
vi.mock('@/lib/voice/profil', () => ({ texteParleDuCompte: async (t: string) => t }));

const CLES = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
  'HEYGEN_API_KEY', 'REPLICATE_API_TOKEN',
];

/** Toute marque interdite présente dans le texte rendu. */
function marquesTrouvees(texte: string): string[] {
  const bas = texte.toLowerCase();
  return NOMS_FOURNISSEURS_INTERDITS.filter((n) => bas.includes(n));
}

const CAS: Array<{ nom: string; charger: () => Promise<{ POST: (r: Request) => Promise<Response> }>; corps: unknown }> = [
  { nom: '/api/content/icon-suggest', charger: () => import('@/app/api/content/icon-suggest/route') as never, corps: { title: 'Sommeil' } },
  { nom: '/api/content/generate-icon', charger: () => import('@/app/api/content/generate-icon/route') as never, corps: { prompt: 'une goutte' } },
  { nom: '/api/tts/openai', charger: () => import('@/app/api/tts/openai/route') as never, corps: { text: 'bonjour', voice: 'nova' } },
  { nom: '/api/tts/elevenlabs', charger: () => import('@/app/api/tts/elevenlabs/route') as never, corps: { text: 'bonjour', voiceId: 'x' } },
  { nom: '/api/tts/heygen', charger: () => import('@/app/api/tts/heygen/route') as never, corps: { text: 'bonjour', voiceId: 'x' } },
];

describe('aucun nom de fournisseur dans les réponses au navigateur', () => {
  const sauvegarde: Record<string, string | undefined> = {};

  beforeEach(() => {
    authMock.mockReset();
    authMock.mockResolvedValue({ user: { id: 'u-1', email: 'personne@example.com' } });
    for (const c of CLES) { sauvegarde[c] = process.env[c]; delete process.env[c]; }
  });

  afterEach(() => {
    for (const c of CLES) {
      if (sauvegarde[c] === undefined) delete process.env[c];
      else process.env[c] = sauvegarde[c];
    }
  });

  for (const cas of CAS) {
    it(`${cas.nom} — service non configuré, réponse neutre`, async () => {
      const mod = await cas.charger();
      const reponse = await mod.POST(new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cas.corps),
      }) as never);
      const texte = await reponse.text();
      expect(reponse.status).toBeGreaterThanOrEqual(400);
      expect(marquesTrouvees(texte), `${cas.nom} → ${texte}`).toEqual([]);
      // Et le message reste utile : il dit que le service n'est pas configuré.
      expect(texte.toLowerCase()).toContain('configur');
    });
  }
});

describe('libellés affichés à l’utilisateur', () => {
  it('aucun nom de fournisseur dans les groupes de voix', async () => {
    const { VOICE_GROUP_LABELS } = await import('@/lib/types/voice');
    expect(marquesTrouvees(Object.values(VOICE_GROUP_LABELS).join(' '))).toEqual([]);
  });

  it('aucun nom de fournisseur dans les noms de voix proposés', async () => {
    const { TTS_VOICES } = await import('@/lib/tts/edge-tts-client');
    const noms = (TTS_VOICES as ReadonlyArray<{ name: string }>).map((v) => v.name).join(' ');
    expect(marquesTrouvees(noms)).toEqual([]);
  });

  it('aucun nom de modèle de fournisseur dans les qualités d’avatar offertes', async () => {
    const { qualitesMonAvatar } = await import('@/lib/avatar/moteurs');
    const offres = qualitesMonAvatar(null, 'video') as ReadonlyArray<Record<string, unknown>>;
    // `moteur` reste (clé technique serveur) ; aucun LIBELLÉ ne doit le nommer.
    const affiche = offres.map((o) => [o.libelle, o.description, o.motif].filter(Boolean).join(' ')).join(' ');
    expect(affiche).not.toMatch(/Avatar I{2,3}V?|Avatar V/);
    expect(offres.some((o) => 'moteurLibelle' in o)).toBe(false);
  });

  it('le prompt de l’assistant ne nomme aucun fournisseur et interdit de le faire', async () => {
    const { getSystemPrompt } = await import('@/lib/chat/system-prompts');
    for (const locale of ['fr', 'en', 'de']) {
      const p = getSystemPrompt(locale);
      expect(marquesTrouvees(p), locale).toEqual([]);
    }
    expect(getSystemPrompt('fr')).toMatch(/Ne nomme JAMAIS un prestataire/);
  });
});
