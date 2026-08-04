import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  mapElevenLabsVoice,
  isElevenLabsVoiceId,
  fetchElevenLabsVoices,
  fetchCustomVoices,
  ELEVENLABS_VOICE_PREFIX,
} from '@/lib/types/voice';

/**
 * Fournisseur TTS ElevenLabs.
 *
 * Le précédent est HeyGen, pas OpenAI : les voix ElevenLabs sont listées à la
 * volée et n'existent donc pas dans `TTS_VOICES`. Le routage se fait sur le
 * **préfixe de l'identifiant**, pas sur une recherche dans la liste statique —
 * une voix clonée créée après le déploiement doit fonctionner sans rien
 * redéployer.
 *
 * L'invariant le moins évident est ailleurs : `ELEVENLABS_API_KEY` désigne
 * **un seul compte ElevenLabs**, partagé par tous les utilisateurs de Studiio.
 * Lister les voix de catégorie `cloned` ferait donc apparaître la voix d'un
 * utilisateur dans le sélecteur de tous les autres.
 */

const route = readFileSync(resolve(__dirname, '../app/api/tts/elevenlabs/route.ts'), 'utf-8');
const client = readFileSync(resolve(__dirname, '../lib/tts/edge-tts-client.ts'), 'utf-8');
const audioPanel = readFileSync(resolve(__dirname, '../components/creer/AudioStudioPanel.tsx'), 'utf-8');
const seqPanel = readFileSync(resolve(__dirname, '../components/creer/SequenceVoicesPanel.tsx'), 'utf-8');

afterEach(() => { vi.unstubAllGlobals(); });

describe('mapElevenLabsVoice — la forme brute varie, la sortie non', () => {
  it('préfixe l identifiant — c est lui qui route la synthèse', () => {
    const v = mapElevenLabsVoice({ voice_id: 'abc123XYZ', name: 'Rachel', category: 'premade' })!;
    expect(v.id).toBe(`${ELEVENLABS_VOICE_PREFIX}abc123XYZ`);
    expect(isElevenLabsVoiceId(v.id)).toBe(true);
  });

  it('une voix sans voice_id est écartée, pas rendue à moitié', () => {
    expect(mapElevenLabsVoice({ name: 'Sans id' })).toBeNull();
    expect(mapElevenLabsVoice({ voice_id: '   ' })).toBeNull();
    expect(mapElevenLabsVoice(null)).toBeNull();
    expect(mapElevenLabsVoice(undefined)).toBeNull();
  });

  it('sans labels — le cas de beaucoup de voix — elle reste exploitable', () => {
    const v = mapElevenLabsVoice({ voice_id: 'abc123XYZ', name: 'Rachel' })!;
    expect(v.lang).toBe('EN');
    expect(v.gender).toBe('Female');
    expect(v.flag).toBeTruthy();
  });

  it('traduit le libellé de langue en code court', () => {
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { language: 'french' } })!.lang).toBe('FR');
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { language: 'German' } })!.lang).toBe('DE');
  });

  it('accepte aussi la forme « fr-FR » et l inconnu', () => {
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { language: 'fr-FR' } })!.lang).toBe('FR');
    // Langue non répertoriée : deux lettres plutôt que rien.
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { language: 'polish' } })!.lang).toBe('PO');
  });

  it('un drapeau de repli quand la langue est inconnue', () => {
    const v = mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { language: 'polish' } })!;
    expect(v.flag).toBe('\u{1F3A4}');
  });

  it('lit le genre, et défaute au féminin', () => {
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { gender: 'male' } })!.gender).toBe('Male');
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: { gender: 'Male' } })!.gender).toBe('Male');
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', labels: {} })!.gender).toBe('Female');
  });

  it('une voix clonée se nomme « ma voix », le catalogue « ElevenLabs »', () => {
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', name: 'Sam', category: 'cloned' })!.name).toBe('Sam (ma voix)');
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa', name: 'Sam', category: 'premade' })!.name).toBe('Sam (ElevenLabs)');
  });

  it('« professional » est une voix clonée, elle aussi', () => {
    // C'est un clonage haute fidélité : elle appartient à quelqu'un.
    const v = mapElevenLabsVoice({ voice_id: 'aaaaaaaa', name: 'Sam', category: 'professional' })!;
    expect(v.cloned).toBe(true);
  });

  it('une voix sans nom ne sort pas anonyme', () => {
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa' })!.name).toBe('Voix (ElevenLabs)');
  });

  it('le fournisseur est marqué — le sélecteur en a besoin', () => {
    expect(mapElevenLabsVoice({ voice_id: 'aaaaaaaa' })!.provider).toBe('elevenlabs');
  });
});

describe('isElevenLabsVoiceId', () => {
  it('ne reconnaît que le préfixe attendu', () => {
    expect(isElevenLabsVoiceId('elevenlabs-abc')).toBe(true);
    expect(isElevenLabsVoiceId('heygen-abc')).toBe(false);
    expect(isElevenLabsVoiceId('openai-nova')).toBe(false);
    expect(isElevenLabsVoiceId('fr-FR-DeniseNeural')).toBe(false);
    expect(isElevenLabsVoiceId(null)).toBe(false);
    expect(isElevenLabsVoiceId(undefined)).toBe(false);
  });
});

describe('fetchElevenLabsVoices — le sélecteur ne casse jamais', () => {
  const stub = (impl: () => Promise<unknown>) => vi.stubGlobal('fetch', impl);

  it('rend les voix reçues', async () => {
    stub(async () => ({ ok: true, json: async () => ({ voices: [{ id: 'elevenlabs-a' }] }) }) as any);
    expect(await fetchElevenLabsVoices()).toHaveLength(1);
  });

  it('une réponse en erreur rend une liste vide, pas une exception', async () => {
    stub(async () => ({ ok: false, json: async () => ({}) }) as any);
    expect(await fetchElevenLabsVoices()).toEqual([]);
  });

  it('un réseau coupé rend une liste vide', async () => {
    stub(async () => { throw new Error('offline'); });
    expect(await fetchElevenLabsVoices()).toEqual([]);
  });

  it('un corps sans tableau `voices` rend une liste vide', async () => {
    stub(async () => ({ ok: true, json: async () => ({ voices: 'nope' }) }) as any);
    expect(await fetchElevenLabsVoices()).toEqual([]);
  });
});

describe('fetchCustomVoices — un seul point d entrée pour les sélecteurs', () => {
  it('réunit les deux fournisseurs', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      json: async () => ({
        voices: url.includes('heygen') ? [{ id: 'heygen-1' }] : [{ id: 'elevenlabs-1' }],
      }),
    }) as any);
    const voices = await fetchCustomVoices();
    expect(voices.map((v) => v.id)).toEqual(['heygen-1', 'elevenlabs-1']);
  });

  it('un fournisseur en panne ne prive pas du second', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('heygen')) throw new Error('heygen down');
      return { ok: true, json: async () => ({ voices: [{ id: 'elevenlabs-1' }] }) } as any;
    });
    expect((await fetchCustomVoices()).map((v) => v.id)).toEqual(['elevenlabs-1']);
  });

  it('les deux appels partent EN PARALLÈLE', async () => {
    // En séquence, le sélecteur attendrait la somme des deux latences.
    let enVol = 0;
    let maxEnVol = 0;
    vi.stubGlobal('fetch', async () => {
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      await new Promise((r) => setTimeout(r, 10));
      enVol -= 1;
      return { ok: true, json: async () => ({ voices: [] }) } as any;
    });
    await fetchCustomVoices();
    expect(maxEnVol).toBe(2);
  });
});

describe('La route parle bien à ElevenLabs', () => {
  it('synthèse : POST /v1/text-to-speech/{voice_id}', () => {
    expect(route).toContain('`${ELEVENLABS_BASE}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`');
    expect(route).toContain("const ELEVENLABS_BASE = 'https://api.elevenlabs.io';");
  });

  it('liste : GET /v2/voices — v2, pas v1', () => {
    // `/v1/voices` existe encore mais ne porte ni `category` ni pagination.
    expect(route).toContain('/v2/voices?page_size=100');
  });

  it('authentification par xi-api-key, jamais par Bearer', () => {
    // Hors des commentaires : seuls les en-têtes réellement envoyés comptent.
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain("'xi-api-key': key");
    expect(code).not.toContain('Authorization');
    expect(code).not.toContain('Bearer');
  });

  it('modèle multilingue — un texte français lu en français', () => {
    expect(route).toContain("const MODEL_ID = 'eleven_multilingual_v2';");
    expect(route).toContain('model_id: MODEL_ID');
  });

  it('la clé ne quitte jamais le serveur', () => {
    expect(route).toContain('process.env.ELEVENLABS_API_KEY');
    expect(route).not.toContain('NEXT_PUBLIC_');
  });
});

describe('Le compte ElevenLabs est PARTAGÉ — les voix clonées ne fuitent pas', () => {
  it('seules les catégories du catalogue sont listées', () => {
    expect(route).toContain(
      "const SHARED_CATEGORIES = new Set(['premade', 'default', 'famous', 'high_quality']);",
    );
    expect(route).toContain("SHARED_CATEGORIES.has(String(raw?.category ?? ''))");
  });

  it('« cloned » n est dans aucune liste partagée', () => {
    const bloc = route.slice(route.indexOf('SHARED_CATEGORIES'), route.indexOf('SHARED_CATEGORIES') + 200);
    expect(bloc).not.toContain("'cloned'");
    expect(bloc).not.toContain("'professional'");
  });
});

describe('Les gardes de la route', () => {
  it('l authentification passe avant tout le reste', () => {
    const post = route.slice(route.indexOf('export async function POST'));
    expect(post.indexOf('const session = await auth();')).toBeLessThan(post.indexOf('apiKey()'));
    expect(post).toContain("return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });");
  });

  it('le voice_id est validé — il part dans le CHEMIN de l URL', () => {
    // Sans garde, une valeur comme « ../../ » fabriquerait une requête vers un
    // tout autre endpoint de l'API.
    expect(route).toContain('!/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)');
  });

  it('le préfixe est retiré avant l appel — ElevenLabs attend l id nu', () => {
    expect(route).toContain('voice.replace(new RegExp(`^${ELEVENLABS_VOICE_PREFIX}`), \'\').trim()');
  });

  it('un audio vide est une erreur, pas un fichier de zéro octet', () => {
    expect(route).toContain("return NextResponse.json({ error: 'ElevenLabs returned empty audio' }, { status: 500 });");
  });

  it('le texte est borné', () => {
    expect(route).toContain('const MAX_TEXT_LENGTH = 5000;');
    expect(route).toContain('text.length > MAX_TEXT_LENGTH');
  });

  it('un appel qui traîne est coupé, et le dit en 504', () => {
    expect(route).toContain('const TTS_TIMEOUT_MS = 45_000;');
    expect(route).toContain("return NextResponse.json({ error: 'ElevenLabs TTS timed out' }, { status: 504 });");
  });

  it('une panne remonte à l alerte de service', () => {
    expect(route).toContain("detectAndReportServiceError(\n        'elevenlabs',");
  });
});

describe('Default-safe : sans clé, rien ne se dégrade', () => {
  it('la liste répond « non configuré », pas une erreur', () => {
    // Le sélecteur garde alors les voix Edge, OpenAI et HeyGen.
    expect(route).toContain('return NextResponse.json({ voices: [], configured: false });');
  });

  it('la synthèse, elle, le dit franchement', () => {
    expect(route).toContain("{ error: 'ELEVENLABS_API_KEY not configured' }");
  });

  it('une panne de liste ne vide pas le sélecteur pendant 5 minutes', () => {
    expect(route).toContain('if (voices.length > 0) voicesCache = { at: Date.now(), voices };');
  });
});

describe('Le routage client', () => {
  it('route sur le PRÉFIXE, pas sur une recherche dans TTS_VOICES', () => {
    // Une voix clonée créée après le déploiement n'est dans aucune liste
    // statique : la chercher dans `TTS_VOICES` ne la trouverait jamais.
    expect(client).toContain('if (isElevenLabsVoiceId(voiceId)) {');
    const branche = client.indexOf('isElevenLabsVoiceId(voiceId)');
    const recherche = client.indexOf('const voice = TTS_VOICES.find((v) => v.id === voiceId);');
    expect(branche).toBeLessThan(recherche);
  });

  it('appelle la bonne route, avec l identifiant préfixé', () => {
    expect(client).toContain("await fetch('/api/tts/elevenlabs'");
    expect(client).toContain("body: JSON.stringify({ text, voice: voiceId }),");
  });

  it('un échec rend null — il ne retombe pas sur Edge', () => {
    // Edge rejetterait un id `elevenlabs-*` : ce serait un aller-retour perdu.
    const branche = client.slice(
      client.indexOf('if (isElevenLabsVoiceId(voiceId)) {'),
      client.indexOf('// ── OpenAI provider branch'),
    );
    expect(branche).toContain("console.warn('[TTS] ElevenLabs failed:'");
    expect(branche.match(/return null;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(branche).not.toContain('/api/tts/edge');
  });

  it('le fournisseur est déclaré dans le type de voix', () => {
    expect(client).toContain("provider?: 'edge' | 'openai' | 'heygen' | 'elevenlabs';");
  });
});

describe('Les deux sélecteurs proposent les mêmes voix', () => {
  it('ils passent par le point d entrée unique', () => {
    for (const [nom, source] of [['AudioStudioPanel', audioPanel], ['SequenceVoicesPanel', seqPanel]] as const) {
      expect(source, nom).toContain('fetchCustomVoices().then((voices) => {');
      expect(source, nom).toContain('const allVoices: TtsVoice[] = [...customVoices, ...TTS_VOICES];');
      // Plus d'appel direct au seul HeyGen : sinon un panneau proposerait la
      // voix clonée et l'autre non.
      expect(source, nom).not.toContain('fetchHeyGenVoices()');
    }
  });

  it('les voix listées à la volée passent AVANT le catalogue statique', () => {
    // La voix de l'utilisateur est celle qu'il cherche en premier.
    for (const source of [audioPanel, seqPanel]) {
      expect(source).toContain('[...customVoices, ...TTS_VOICES]');
    }
  });
});
