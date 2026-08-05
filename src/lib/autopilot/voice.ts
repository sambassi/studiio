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

/** Voix française par défaut — celle que le manuel propose en tête de liste. */
export const AUTOPILOT_TTS_VOICE = 'fr-FR-DeniseNeural';

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

/** Synthétise un texte et rend le MP3, ou `null`. */
async function synthetiser(texte: string): Promise<Buffer | null> {
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    try {
      // Le meme format que la route `/api/tts/edge` — mp3 24 kHz mono.
      await tts.setMetadata(AUTOPILOT_TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(texte);
      const morceaux: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        // Deux délais : un pour le premier octet, un entre deux morceaux. Un
        // flux qui s'arrête au milieu ne doit pas laisser le cycle pendu.
        let minuteur = setTimeout(() => reject(new Error('aucune donnee')), 30_000);
        audioStream.on('data', (c: Buffer) => {
          clearTimeout(minuteur);
          minuteur = setTimeout(() => reject(new Error('flux interrompu')), 20_000);
          morceaux.push(c);
        });
        audioStream.on('end', () => { clearTimeout(minuteur); resolve(); });
        audioStream.on('error', (e: Error) => { clearTimeout(minuteur); reject(e); });
      });
      const buf = Buffer.concat(morceaux);
      return buf.length > 0 ? buf : null;
    } finally {
      try { tts.close(); } catch { /* fermeture sans conséquence */ }
    }
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
}): Promise<VoixParSequence> {
  const { writeFile, unlink } = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const { uploadToStorage } = await import('@/lib/storage/upload');

  const textes = voiceTexts(input.post);
  const out: VoixParSequence = {};

  for (const cle of SEQUENCE_KEYS) {
    const texte = textes[cle];
    if (!texte) continue;
    const mp3 = await synthetiser(texte);
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
