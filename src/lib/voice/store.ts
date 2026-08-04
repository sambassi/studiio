/**
 * Voix clonees d'un utilisateur — rattachement et regles d'envoi.
 *
 * Le fait structurant : `ELEVENLABS_API_KEY` designe UN compte ElevenLabs,
 * partage par tous les utilisateurs de Studiio. `GET /v2/voices` renvoie donc
 * les voix clonees de TOUT LE MONDE, sans notion de proprietaire. C'est la
 * table `user_voices` — et elle seule — qui dit a qui appartient quoi.
 *
 * Les regles de validation vivent ici, en fonctions PURES : elles gardent
 * l'acces a une API payante et a une donnee biometrique, ce qui merite d'etre
 * verifiable sur des valeurs plutot que lu dans une route de 200 lignes.
 */

import { supabaseAdmin } from '@/lib/db/supabase';

/** Une voix clonee, telle qu'elle est rangee et relue. */
export interface UserVoice {
  id: string;
  user_id: string;
  provider: string;
  provider_voice_id: string;
  name: string;
  lang: string | null;
  created_at: string;
}

/**
 * Texte de consentement stocke avec la voix — preuve datee.
 *
 * Meme exigence que pour l'avatar : la voix est une donnee biometrique, et
 * ElevenLabs impose contractuellement que le donneur ait consenti.
 */
export const VOICE_CONSENT_TEXT =
  "Je certifie que la voix enregistree est la mienne et j'autorise Studiio et ElevenLabs a en creer un clone.";

/** Duree minimale conseillee d'un echantillon, en secondes. */
export const MIN_SAMPLE_SECONDS = 30;

/** Poids maximal accepte pour un echantillon. */
export const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;

/** Nombre maximal d'echantillons par clonage. */
export const MAX_SAMPLES = 4;

/**
 * Types audio transmis a ElevenLabs.
 *
 * `audio/webm` est ce que produit `MediaRecorder` sur Chrome, `audio/mp4` sur
 * Safari : les deux doivent passer, sinon l'enregistrement in-app ne sert a
 * rien sur la moitie des navigateurs. La documentation d'ElevenLabs ne publie
 * pas de liste fermee — en cas de refus, la route relaie le message reel du
 * fournisseur plutot qu'une erreur generique, pour que le cas se diagnostique
 * en une seule tentative.
 */
export const ACCEPTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/m4a',
  'audio/x-m4a',
];

/** Description minimale d'un echantillon, pour la validation. */
export interface SampleLike {
  type: string;
  size: number;
}

export type CloneRefusal =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Le clonage peut-il partir ?
 *
 * Renvoie le refus EXACT a rendre au client — code HTTP compris — plutot qu'un
 * booleen : un « non » sans motif obligerait l'utilisateur a deviner ce qui
 * cloche dans son enregistrement.
 */
export function validateCloneRequest(input: {
  name: unknown;
  consent: unknown;
  samples: SampleLike[];
}): CloneRefusal {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { ok: false, status: 400, error: 'Donnez un nom à votre voix.' };
  }
  if (name.length > 60) {
    return { ok: false, status: 400, error: 'Le nom de la voix est trop long (60 caractères maximum).' };
  }
  // Le consentement n'est pas une case decorative : sans lui, on cree une
  // empreinte biometrique sans autorisation.
  if (input.consent !== true && input.consent !== 'true') {
    return { ok: false, status: 400, error: 'Le consentement est obligatoire pour cloner une voix.' };
  }
  if (input.samples.length === 0) {
    return { ok: false, status: 400, error: 'Aucun enregistrement reçu.' };
  }
  if (input.samples.length > MAX_SAMPLES) {
    return { ok: false, status: 400, error: `${MAX_SAMPLES} enregistrements au maximum.` };
  }
  for (const sample of input.samples) {
    if (sample.size <= 0) {
      return { ok: false, status: 400, error: 'Un enregistrement est vide.' };
    }
    if (sample.size > MAX_SAMPLE_BYTES) {
      return { ok: false, status: 413, error: 'Enregistrement trop lourd (10 Mo maximum).' };
    }
    // Le type peut porter des parametres de codec (`audio/webm;codecs=opus`).
    const base = sample.type.split(';')[0].trim().toLowerCase();
    if (!ACCEPTED_AUDIO_TYPES.includes(base)) {
      return { ok: false, status: 400, error: `Format audio non supporté (${base || 'inconnu'}).` };
    }
  }
  return { ok: true };
}

/**
 * Sonde de disponibilite de la table, memoisee.
 *
 * Meme dispositif que la liste de suppression des emails : tant que la
 * migration n'est pas appliquee, on le sait sans faire echouer une requete
 * utilisateur sur une erreur illisible de PostgREST.
 */
let storeProbe: { ready: boolean; at: number } | null = null;
const STORE_PROBE_TTL_MS = 60_000;

export async function voiceStoreReady(): Promise<boolean> {
  const now = Date.now();
  // Une fois prete, la table ne disparait pas : on ne re-sonde plus.
  if (storeProbe?.ready) return true;
  if (storeProbe && now - storeProbe.at < STORE_PROBE_TTL_MS) return false;

  let ready = false;
  try {
    const { error } = await supabaseAdmin.from('user_voices').select('id').limit(1);
    ready = !error;
    if (error) {
      console.error(
        `[Voice] Table user_voices indisponible (${error.message}) — clonage DESACTIVE. ` +
          'Appliquer migrations/2026-08-04-user-voices.sql puis ' +
          '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Voice] Sonde user_voices impossible :', err);
  }

  storeProbe = { ready, at: now };
  return ready;
}

/**
 * Voix clonees d'UN utilisateur.
 *
 * Ne leve jamais : une panne de base ne doit pas vider le selecteur des voix
 * du catalogue, qui, elles, ne dependent pas de cette table.
 */
export async function listUserVoices(userId: string): Promise<UserVoice[]> {
  if (!userId || !(await voiceStoreReady())) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('user_voices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[Voice] Lecture user_voices echouee :', error.message);
      return [];
    }
    return (data ?? []) as UserVoice[];
  } catch (err) {
    console.error('[Voice] Lecture user_voices impossible :', err);
    return [];
  }
}

/** Rattache une voix fraichement clonee a son proprietaire. */
export async function saveUserVoice(input: {
  userId: string;
  providerVoiceId: string;
  name: string;
  lang?: string | null;
  provider?: string;
}): Promise<UserVoice | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_voices')
      .insert({
        user_id: input.userId,
        provider: input.provider ?? 'elevenlabs',
        provider_voice_id: input.providerVoiceId,
        name: input.name,
        lang: input.lang ?? null,
        consent_at: new Date().toISOString(),
        consent_text: VOICE_CONSENT_TEXT,
      })
      .select()
      .single();
    if (error) {
      console.error('[Voice] Ecriture user_voices echouee :', error.message);
      return null;
    }
    return data as UserVoice;
  } catch (err) {
    console.error('[Voice] Ecriture user_voices impossible :', err);
    return null;
  }
}
