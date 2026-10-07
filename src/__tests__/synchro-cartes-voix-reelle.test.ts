// @vitest-environment node
/**
 * Créer / assistant-simple / cartes PLEIN ÉCRAN — chaque carte (puis sa
 * valeur) apparaît quand la voix COMMENCE à la dire.
 *
 * Source de vérité : l'alignement RÉEL d'ElevenLabs (`with-timestamps`),
 * converti côté serveur APRÈS normalisation (« NEJM » affiché, « Nèjm » dit).
 * Repli : estimation. Texte retouché : aucun calage, rendu d'avant.
 *
 * AUCUN appel réel : `fetch` est doublé par un « moteur simulé » qui rend
 * un alignement par caractère du texte qu'il reçoit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  morceauxCartes, texteDesMorceaux, segmentsDepuisAlignement, segmentsEstimes,
  calageCartes, etatApres, imageCartesA, morceauxDeLaRequete, segmentsDeLEntete,
  ENTETE_SEGMENTS, type AlignementCaracteres, type TimingVoix,
} from '@/lib/creer/synchro-cartes';
import { buildAutoFillText } from '@/lib/types/voice';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const BASSI = 'BassiVoixClonee1';

vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async () => [{ id: '44444444-4444-4444-8444-000000000001', user_id: U, provider: 'elevenlabs', provider_voice_id: BASSI, name: 'bassi', lang: 'fr', created_at: '2026-08-01' }],
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {} }));
vi.mock('@/lib/voice/profil', async (orig) => {
  const vrai = await orig<typeof import('@/lib/voice/profil')>();
  // Aucune prononciation enregistrée : seule la normalisation fr-FR s'applique.
  return { ...vrai, prononciationsDuCompte: async () => [], texteParleDuCompte: async (_u: string, t: string) => (await import('@/lib/voice/prononciations')).scriptParle(t, []) };
});

/** Moteur simulé : 0,07 s par caractère prononçable, 0,2 s par ponctuation, 0,05 s par espace. */
function alignementSimule(texte: string): AlignementCaracteres {
  const characters = [...texte];
  const start: number[] = [];
  const end: number[] = [];
  let t = 0.08; // un court silence d'attaque, comme un vrai moteur
  for (const c of characters) {
    const d = /[\p{L}\p{N}]/u.test(c) ? 0.07 : /[.!?,;:]/.test(c) ? 0.2 : 0.05;
    start.push(Math.round(t * 1000) / 1000);
    t += d;
    end.push(Math.round(t * 1000) / 1000);
  }
  return { characters, character_start_times_seconds: start, character_end_times_seconds: end };
}

const appels = vi.hoisted(() => ({ urls: [] as string[], corps: [] as Array<Record<string, unknown>>, alignementCasse: false }));
globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (!u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) throw new Error(`fetch inattendu ${u}`);
  appels.urls.push(u);
  const corps = JSON.parse(String(init?.body)) as { text: string };
  appels.corps.push(corps);
  if (u.includes('/with-timestamps')) {
    const alignment = alignementSimule(appels.alignementCasse ? `${corps.text}!` : corps.text);
    return new Response(JSON.stringify({ audio_base64: Buffer.from('AUDIO-MP3').toString('base64'), alignment, normalized_alignment: alignment }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(Buffer.from('AUDIO-MP3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}) as unknown as typeof fetch;

process.env.ELEVENLABS_API_KEY = 'cle-de-test';
const { POST } = await import('@/app/api/tts/elevenlabs/route');

const CARTES = [
  { id: 'c1', title: 'Cardio', description: 'Brûle les graisses', value: '76%' },
  { id: 'c2', title: 'Étude NEJM', description: 'Publiée en 2024', value: '+2%/an' },
  { id: 'c3', title: 'Souffle', description: '', value: '3x' },
];
const MORCEAUX = morceauxCartes(CARTES);
const TEXTE = texteDesMorceaux(MORCEAUX);

const synth = (corps: Record<string, unknown>) => POST(new NextRequest('https://studiio.pro/api/tts/elevenlabs', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: `elevenlabs-${BASSI}`, ...corps }),
}));

/** Tolérance explicite entre le début réel d'un morceau et l'apparition calée. */
const TOLERANCE_S = 0.001;

beforeEach(() => { appels.urls.length = 0; appels.corps.length = 0; appels.alignementCasse = false; });

describe('morceaux — la structure réelle d’une carte', () => {
  it('titre, description (dite, jamais affichée), valeur — dans l’ordre de lecture', () => {
    expect(MORCEAUX.map((m) => `${m.carte}:${m.role}`)).toEqual([
      '0:titre', '0:description', '0:valeur', '1:titre', '1:description', '1:valeur', '2:titre', '2:valeur',
    ]);
  });

  it('le texte narré est EXACTEMENT celui d’avant (buildAutoFillText)', () => {
    const avant = buildAutoFillText({ title: 't', cards: CARTES.map((c) => ({ label: c.title, description: c.description, value: c.value })) }).cartes;
    expect(TEXTE).toBe(avant);
  });
});

describe('route ElevenLabs — horodatage RÉEL, après normalisation', () => {
  it('avec morceaux : with-timestamps, même voix, même modèle ; MP3 binaire + segments compacts', async () => {
    const res = await synth({ text: TEXTE, morceaux: MORCEAUX.map(({ texte, apres }) => ({ texte, apres })) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('AUDIO-MP3');
    expect(appels.urls[0]).toContain(`/v1/text-to-speech/${BASSI}/with-timestamps?output_format=mp3_44100_128`);
    expect(appels.corps[0].model_id).toBe('eleven_multilingual_v2');
    const segments = segmentsDeLEntete(res.headers.get(ENTETE_SEGMENTS), MORCEAUX.length);
    expect(segments).not.toBeNull();
    // Compact : un couple par morceau, pas l'alignement par caractère.
    expect(res.headers.get(ENTETE_SEGMENTS)!.length).toBeLessThan(300);
  });

  it('4-5. NEJM : affiché « NEJM », DIT « Nèjm » — et les segments suivent le texte DIT', async () => {
    const res = await synth({ text: TEXTE, morceaux: MORCEAUX.map(({ texte, apres }) => ({ texte, apres })) });
    const dit = String(appels.corps[0].text);
    expect(dit).toContain('Étude Nèjm');
    expect(dit).not.toContain('NEJM');
    expect(dit).toContain('76 pour cent');
    // Le texte AFFICHÉ (morceaux, cartes) n'a pas bougé.
    expect(MORCEAUX[3].texte).toBe('Étude NEJM');
    expect(CARTES[1].title).toBe('Étude NEJM');
    // Le segment du morceau 3 commence là où « Étude Nèjm » commence DANS le texte dit.
    const segments = segmentsDeLEntete(res.headers.get(ENTETE_SEGMENTS), MORCEAUX.length)!;
    const al = alignementSimule(dit);
    expect(segments[3][0]).toBeCloseTo(al.character_start_times_seconds[dit.indexOf('Étude Nèjm')], 3);
  });

  it('sans morceaux : la requête d’AVANT, inchangée (pas de with-timestamps, pas d’en-tête)', async () => {
    const res = await synth({ text: TEXTE });
    expect(appels.urls[0]).not.toContain('with-timestamps');
    expect(res.headers.get(ENTETE_SEGMENTS)).toBeNull();
  });

  it('morceaux qui ne recollent pas le texte : ignorés, requête d’avant', async () => {
    await synth({ text: `${TEXTE} et plus`, morceaux: MORCEAUX.map(({ texte, apres }) => ({ texte, apres })) });
    expect(appels.urls[0]).not.toContain('with-timestamps');
  });

  it('6. alignement inexploitable : audio rendu, AUCUN segment (le client estimera)', async () => {
    appels.alignementCasse = true;
    const res = await synth({ text: TEXTE, morceaux: MORCEAUX.map(({ texte, apres }) => ({ texte, apres })) });
    expect(res.status).toBe(200);
    expect(res.headers.get(ENTETE_SEGMENTS)).toBeNull();
  });
});

describe('1-3. horodatage réel → apparition, morceau par morceau', () => {
  it('carte 1 / 2 / 3 au début RÉEL de leur titre ; chaque valeur au début RÉEL de sa valeur', async () => {
    const res = await synth({ text: TEXTE, morceaux: MORCEAUX.map(({ texte, apres }) => ({ texte, apres })) });
    const segments = segmentsDeLEntete(res.headers.get(ENTETE_SEGMENTS), MORCEAUX.length)!;
    const timing: TimingVoix = { source: 'elevenlabs', morceaux: MORCEAUX.map(({ texte, apres }) => ({ texte, apres })), segments };
    const calage = calageCartes(CARTES, { textAtGeneration: TEXTE, duration: 99, timing })!;
    expect(calage.source).toBe('elevenlabs');

    const debutDe = (carte: number, role: string) => segments[MORCEAUX.findIndex((m) => m.carte === carte && m.role === role)][0];
    const etape = (carte: number, element: string) => calage.etapes.find((e) => e.carte === carte && e.element === element)!.debut;
    for (const carte of [0, 1, 2]) {
      expect(Math.abs(etape(carte, 'carte') - debutDe(carte, 'titre'))).toBeLessThanOrEqual(TOLERANCE_S);
      expect(Math.abs(etape(carte, 'valeur') - debutDe(carte, 'valeur'))).toBeLessThanOrEqual(TOLERANCE_S);
    }
    // Ordre strict : la carte 2 n'apparaît pas avant que la voix ait fini la valeur de la carte 1.
    expect(etape(1, 'carte')).toBeGreaterThan(segments[2][1]);

    // Ce que montre chaque étape : jamais une carte ou une valeur pas encore dite.
    const e1 = etatApres(calage, 1);
    expect([...e1.cartes]).toEqual([0]);
    expect([...e1.valeurs]).toEqual([]);
    const e2 = etatApres(calage, 2);
    expect([...e2.valeurs]).toEqual([0]);

    // Le compositeur choisit l'image de l'étape en cours à chaque instant.
    const etats = calage.etapes.map((e, i) => ({ debut: e.debut, image: `etape-${i}` }));
    expect(imageCartesA(etats, 0)).toBeNull();
    expect(imageCartesA(etats, debutDe(0, 'titre'))).toBe('etape-0');
    expect(imageCartesA(etats, debutDe(1, 'titre') - 0.01)).toBe('etape-1');
    expect(imageCartesA(etats, debutDe(1, 'titre'))).toBe('etape-2');
    expect(imageCartesA(etats, debutDe(2, 'titre'))).toBe('etape-4');
    expect(imageCartesA(etats, 1e6)).toBe(`etape-${etats.length - 1}`);
  });
});

describe('replis', () => {
  it('6. voix sans horodatage (Edge, ou ancien audio) → ESTIMATION sur la durée mesurée', () => {
    const calage = calageCartes(CARTES, { textAtGeneration: TEXTE, duration: 12 })!;
    expect(calage.source).toBe('estimation');
    expect(calage.etapes[0]).toMatchObject({ carte: 0, element: 'carte', debut: 0 });
    expect(calage.etapes.at(-1)!.debut).toBeLessThan(12);
  });

  it('horodatage enregistré pour d’AUTRES morceaux → estimation, jamais un calage faux', () => {
    const timing: TimingVoix = { source: 'elevenlabs', morceaux: [{ texte: 'Autre', apres: '' }], segments: [[0, 1]] };
    expect(calageCartes(CARTES, { textAtGeneration: TEXTE, duration: 12, timing })!.source).toBe('estimation');
  });

  it('7. texte de la voix retouché à la main → AUCUN calage (rendu d’avant)', () => {
    expect(calageCartes(CARTES, { textAtGeneration: 'Mon propre texte sur le cardio.', duration: 12 })).toBeNull();
  });

  it('cartes modifiées depuis la génération de la voix → aucun calage', () => {
    const autres = [{ ...CARTES[0], value: '80%' }, CARTES[1], CARTES[2]];
    expect(calageCartes(autres, { textAtGeneration: TEXTE, duration: 12 })).toBeNull();
  });

  it('pas de voix, ou durée inconnue sans horodatage → aucun calage', () => {
    expect(calageCartes(CARTES, null)).toBeNull();
    expect(calageCartes(CARTES, { textAtGeneration: TEXTE })).toBeNull();
  });

  it('alignement qui ne correspond pas au texte dit → null (on ne devine pas)', () => {
    const dits = MORCEAUX.map(({ texte, apres }) => ({ texte, apres }));
    expect(segmentsDepuisAlignement(dits, alignementSimule(texteDesMorceaux(dits)))).not.toBeNull();
    expect(segmentsDepuisAlignement(dits, alignementSimule(`${texteDesMorceaux(dits)} `))).toBeNull();
    expect(segmentsDepuisAlignement(dits, null)).toBeNull();
  });

  it('morceaux de requête validés strictement', () => {
    expect(morceauxDeLaRequete([{ texte: 'A', apres: '. ' }, { texte: 'B', apres: '' }], 'A. B')).not.toBeNull();
    expect(morceauxDeLaRequete([{ texte: 'A', apres: '<script>' }], 'A<script>')).toBeNull();
    expect(morceauxDeLaRequete('x', 'x')).toBeNull();
    expect(segmentsEstimes([], 3)).toBeNull();
  });
});
