/**
 * Synthèse ElevenLabs avec UNE voix donnée — le même appel que
 * `/api/tts/elevenlabs` (endpoint vérifié : `POST /v1/text-to-speech/{voice_id}`,
 * en-tête `xi-api-key`, audio brut en retour), isolé ici pour que l'écoute
 * de la voix personnelle passe par le serveur avec un `voice_id` que lui
 * seul a résolu. Rien n'est simulé : sans clé, `indisponible` ; sans
 * réponse audio, `echec`.
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const TIMEOUT_MS = 45_000;
export const MAX_TEXTE_ECOUTE = 600;

export function cleElevenLabs(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.ELEVENLABS_API_KEY?.trim() || null;
}

export type ResultatSynthese =
  | { ok: true; audio: Buffer; contentType: string }
  | { ok: false; motif: 'indisponible' }
  | { ok: false; motif: 'echec'; statut: number | null; detail: string };

export async function synthetiserAvecVoix(
  args: { providerVoiceId: string; texte: string },
  deps: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<ResultatSynthese> {
  const key = cleElevenLabs(deps.env);
  if (!key) return { ok: false, motif: 'indisponible' };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(args.providerVoiceId)) return { ok: false, motif: 'echec', statut: null, detail: 'voice_id invalide' };
  const faireFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await faireFetch(`${ELEVENLABS_BASE}/v1/text-to-speech/${args.providerVoiceId}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: args.texte, model_id: MODEL_ID }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { ok: false, motif: 'echec', statut: res.status, detail };
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0) return { ok: false, motif: 'echec', statut: res.status, detail: 'audio vide' };
    const type = res.headers.get('content-type') || '';
    return { ok: true, audio, contentType: type.startsWith('audio/') ? type : 'audio/mpeg' };
  } catch (e) {
    return { ok: false, motif: 'echec', statut: null, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
