import { buildAutoFillText, SEQUENCE_KEYS, type SequenceKey } from '@/lib/types/voice';
import { voiceSequenceSeconds } from '@/lib/creer/voiceFit';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * La voix off de l'Autopilote.
 *
 * ⚠️ LE TEXTE VIENT DU MÊME COMPOSEUR QUE LE MANUEL. `buildAutoFillText`
 * assemble déjà, pour chaque séquence, ce que le panneau des voix pré-remplit
 * à l'écran : titre + sous-titre, puis les cartes, puis le CTA. Réécrire cet
 * assemblage ici aurait donné une narration différente de celle qu'un
 * utilisateur obtient en cliquant « générer » — deux textes pour un seul
 * montage.
 *
 * ⚠️ ET C'EST L'AUTOPILOTE QUI APPLIQUE LE CALAGE DE DURÉE. La Phase 8 avait
 * établi que la règle « la séquence s'allonge à sa voix » est un effet de
 * l'ÉDITEUR : il écrit la durée dans le design quand une voix est attachée,
 * et le rendu ne la recalcule pas. Ici il n'y a pas d'éditeur — personne
 * n'écrira cette durée si l'Autopilote ne le fait pas. La règle
 * (`voiceSequenceSeconds`) reste la même, seul l'endroit où on l'applique
 * change.
 *
 * ⚠️ AUCUN ÉCHEC NE REMONTE. Edge TTS est un service public non officiel :
 * il tombe, et il refuse parfois les adresses de centres de données. Une
 * voix manquante rend un montage muet — un cycle interrompu ne rend rien du
 * tout.
 */

/** Voix française par défaut du service gratuit — celle du manuel. */
export const AUTOPILOT_TTS_VOICE = 'fr-FR-DeniseNeural';

/**
 * Délai maximal d'une synthèse, tout compris.
 *
 * ⚠️ C'EST LE CORRECTIF DU GEL, ET IL COUVRE L'OUVERTURE DE CONNEXION.
 *
 * La version précédente posait des délais sur les ÉVÉNEMENTS DU FLUX, donc
 * après `setMetadata()` — or c'est `setMetadata()` qui ouvre le WebSocket, et
 * c'est LÀ que ça pendait. Depuis une adresse de centre de données, Microsoft
 * ne refuse pas la connexion : il ne répond jamais. Le `await` ne rendait
 * donc pas la main, aucun de mes délais n'était encore armé, et le cycle
 * entier restait suspendu — aucune vidéo produite, la requête du cron sans
 * fin.
 *
 * Un délai posé APRÈS l'appel qui peut pendre ne protège de rien : celui-ci
 * enveloppe la synthèse ENTIÈRE.
 */
export const TTS_TIMEOUT_MS = 15_000;

/** Modèle et format ElevenLabs — les mêmes que la route du manuel. */
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const ELEVENLABS_OUTPUT = 'mp3_44100_128';

/**
 * Voix ElevenLabs utilisée par l'Autopilote.
 *
 * Surchargeable par l'environnement : le compte de chacun n'expose pas les
 * mêmes voix, et une valeur en dur ferait échouer la synthèse chez qui ne
 * l'aurait pas.
 */
function elevenLabsVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || '21m00Tcm4TlvDq8ikWAM';
}

/**
 * Fournisseur de synthèse.
 *
 * ⚠️ LE CHOIX N'EST PAS UNE PRÉFÉRENCE, C'EST UNE CONTRAINTE DE RÉSEAU.
 *
 * - `edge` — gratuit, mais Microsoft filtre les plages de centres de
 *   données. Il marche donc depuis le NAVIGATEUR de l'utilisateur (adresse
 *   résidentielle), pas depuis le serveur. Le manuel le garde.
 * - `elevenlabs` — payant à l'usage, mais en HTTPS simple, sans WebSocket, et
 *   sans filtrage d'adresse. C'est le seul qui réponde depuis le serveur, donc
 *   le seul utilisable par l'Autopilote.
 */
export type TtsProvider = 'edge' | 'elevenlabs';

/** Le fournisseur du rendu serveur. */
export const SERVER_TTS_PROVIDER: TtsProvider = 'elevenlabs';

/**
 * Applique un délai maximal à une promesse.
 *
 * `onTimeout` sert à libérer la ressource — fermer le WebSocket, interrompre
 * la requête. Sans ça, la connexion resterait ouverte derrière nous et le
 * processus ne se terminerait pas.
 */
export async function withTimeout<T>(
  promesse: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T | null> {
  let minuteur: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesse,
      new Promise<null>((resolve) => {
        minuteur = setTimeout(() => {
          try { onTimeout?.(); } catch { /* liberation best-effort */ }
          resolve(null);
        }, ms);
      }),
    ]);
  } catch {
    // Une synthèse ratée vaut une synthèse absente : le montage sort muet.
    return null;
  } finally {
    if (minuteur) clearTimeout(minuteur);
  }
}

/** Au-delà, la narration ne tient plus dans une séquence lisible. */
const MAX_CHARS = 600;

export interface VoixDeSequence {
  url: string;
  /** Durée mesurée du clip, en secondes. */
  seconds: number;
}

export type VoixParSequence = Partial<Record<SequenceKey, VoixDeSequence>>;

/**
 * Textes à dire, par séquence.
 *
 * Une séquence sans texte n'est pas narrée : mieux vaut le silence qu'un
 * clip vide qui décalerait la durée.
 */
export function voiceTexts(post: PreparedPost): Partial<Record<SequenceKey, string>> {
  const tous = buildAutoFillText({
    title: post.title,
    subtitle: post.content.subtitle,
    cards: post.content.cards.map((c) => ({
      label: c.title, value: c.value, description: c.description,
    })),
    ctaMainText: post.content.tagLine,
  });
  const out: Partial<Record<SequenceKey, string>> = {};
  for (const cle of SEQUENCE_KEYS) {
    const t = (tous[cle] || '').trim();
    if (t) out[cle] = t.slice(0, MAX_CHARS);
  }
  return out;
}

/** Synthèse ElevenLabs — HTTPS simple, ce qui passe depuis le serveur. */
async function synthetiserElevenLabs(texte: string): Promise<Buffer | null> {
  const cle = process.env.ELEVENLABS_API_KEY?.trim();
  if (!cle) {
    console.warn('[Autopilote/Voix] ELEVENLABS_API_KEY absente — montage sans voix');
    return null;
  }
  const controleur = new AbortController();
  const res = await withTimeout(
    fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId()}`
      + `?output_format=${ELEVENLABS_OUTPUT}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': cle, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: texte, model_id: ELEVENLABS_MODEL }),
        signal: controleur.signal,
        cache: 'no-store',
      },
    ),
    TTS_TIMEOUT_MS,
    () => controleur.abort(),
  );
  if (!res) { console.warn('[Autopilote/Voix] ElevenLabs : delai depasse'); return null; }
  if (!res.ok) {
    console.error('[Autopilote/Voix] ElevenLabs', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 0 ? buf : null;
}

/**
 * Synthèse Edge — gratuite, gardée pour les contextes où elle répond.
 *
 * ⚠️ L'OUVERTURE DE CONNEXION EST DANS LE TIMEOUT. `setMetadata()` établit le
 * WebSocket, et c'est cet appel qui pend depuis un centre de données. Il est
 * donc DANS la promesse enveloppée, pas avant.
 */
async function synthetiserEdge(texte: string): Promise<Buffer | null> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  const travail = (async () => {
    await tts.setMetadata(AUTOPILOT_TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(texte);
    const morceaux: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (c: Buffer) => morceaux.push(c));
      audioStream.on('end', () => resolve());
      audioStream.on('error', (e: Error) => reject(e));
    });
    return Buffer.concat(morceaux);
  })();
  const buf = await withTimeout(travail, TTS_TIMEOUT_MS, () => {
    try { tts.close(); } catch { /* deja ferme */ }
  });
  try { tts.close(); } catch { /* deja ferme */ }
  if (!buf) { console.warn('[Autopilote/Voix] Edge : delai depasse'); return null; }
  return buf.length > 0 ? buf : null;
}

/** Synthétise un texte et rend le MP3, ou `null` — jamais d'exception. */
async function synthetiser(texte: string, provider: TtsProvider): Promise<Buffer | null> {
  try {
    return provider === 'elevenlabs'
      ? await synthetiserElevenLabs(texte)
      : await synthetiserEdge(texte);
  } catch (err) {
    console.error('[Autopilote/Voix] synthese echouee :', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Durée d'un MP3 déjà écrit sur disque, en secondes — `null` si illisible. */
async function dureeSecondes(cheminFichier: string): Promise<number | null> {
  try {
    const { parseMedia } = await import('@remotion/media-parser');
    const { durationInSeconds } = await parseMedia({
      src: cheminFichier,
      fields: { durationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    return typeof durationInSeconds === 'number' && durationInSeconds > 0
      ? durationInSeconds
      : null;
  } catch {
    return null;
  }
}

/**
 * Génère et téléverse la voix de chaque séquence.
 *
 * Rend `{}` si rien n'a pu être produit — l'appelant compose alors un montage
 * muet, exactement comme avant.
 */
export async function buildAutopilotVoices(input: {
  userId: string;
  jobId: string;
  post: PreparedPost;
  /** Fournisseur — `elevenlabs` cote serveur, seul a repondre. */
  provider?: TtsProvider;
}): Promise<VoixParSequence> {
  const provider = input.provider ?? SERVER_TTS_PROVIDER;
  const { writeFile, unlink } = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const { uploadToStorage } = await import('@/lib/storage/upload');

  const textes = voiceTexts(input.post);
  const out: VoixParSequence = {};

  for (const cle of SEQUENCE_KEYS) {
    const texte = textes[cle];
    if (!texte) continue;
    const mp3 = await synthetiser(texte, provider);
    if (!mp3) continue;

    const local = path.join(os.tmpdir(), `studiio-voix-${input.jobId}-${cle}.mp3`);
    try {
      await writeFile(local, mp3);
      // La durée AVANT le téléversement : `uploadToStorage` supprime le
      // fichier temporaire une fois en ligne.
      const seconds = await dureeSecondes(local);
      const url = await uploadToStorage({
        filePath: local,
        bucket: 'audio',
        storagePath: `${input.userId}/autopilote-${input.jobId}-${cle}.mp3`,
      });
      if (seconds) out[cle] = { url, seconds };
      else {
        // Sans durée mesurée, on ne peut pas caler la séquence : la voix
        // serait coupée. On préfère ne pas l'utiliser.
        console.warn(`[Autopilote/Voix] duree illisible pour ${cle}, voix ignoree`);
      }
    } catch (err) {
      console.error(`[Autopilote/Voix] ${cle} non televersee :`, err instanceof Error ? err.message : err);
      try { await unlink(local); } catch { /* deja supprime */ }
    }
  }
  return out;
}

/** Carte d'URL attendue par le rendu serveur. */
export function voiceUrls(voix: VoixParSequence): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const cle of SEQUENCE_KEYS) {
    const v = voix[cle];
    if (v) out[cle] = v.url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Durée d'une séquence, calée sur sa voix si elle en a une.
 *
 * `voiceSequenceSeconds` est LA règle du Mode simple — arrondi à la seconde
 * supérieure, plus une marge d'un tiers de seconde pour que la coupure ne
 * s'entende pas. Sans voix, la durée demandée est rendue telle quelle.
 */
export function sequenceSecondsWithVoice(
  voix: VoixParSequence,
  cle: SequenceKey,
  parDefaut: number,
): number {
  const v = voix[cle];
  if (!v) return parDefaut;
  // La séquence ne RÉTRÉCIT jamais sous sa durée voulue : une voix courte ne
  // doit pas écourter un montage que l'utilisateur a réglé plus long.
  return Math.max(parDefaut, voiceSequenceSeconds(v.seconds));
}
