/**
 * « Ma voix & prononciations » — le profil vocal du compte, côté serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE SEULE AUTORITÉ : LE SERVEUR, QUI RELIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les voix personnelles vivent dans `user_voices` (clonées chez ElevenLabs,
 * consentement daté). Le CHOIX de la voix et les prononciations vivent dans
 * `user_settings.creator_preferences.voixPersonnelle` — l'endroit canonique
 * des préférences du compte, sans nouvelle table.
 *
 * ⚠️ CE QUI EST STOCKÉ N'EST JAMAIS CRU SUR PAROLE. À chaque lecture, le
 * choix (`userVoiceId`) est CONFRONTÉ à `user_voices` : la voix doit exister,
 * appartenir au compte, être chez un fournisseur que l'on sait appeler, et
 * porter un identifiant fournisseur de forme valide. Sinon elle est
 * inutilisable — même si le navigateur, ou une écriture directe dans les
 * préférences, a mis n'importe quoi. Le navigateur ne désigne jamais un
 * `provider_voice_id` : il ne connaît que `user_voices.id`, et encore le
 * serveur le revérifie.
 *
 * `resoudreVoixDuCompte()` est la fonction que Créer et l'Autopilote
 * réutiliseront : elle rend la voix utilisable, ou un motif nommé.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { listUserVoices, type UserVoice } from '@/lib/voice/store';
import { lirePrononciations, type Prononciation } from '@/lib/voice/prononciations';

/** Les fournisseurs pour lesquels une synthèse est RÉELLEMENT câblée. */
export const FOURNISSEURS_VOIX_CABLES = ['elevenlabs'] as const;

/** La forme d'un voice_id ElevenLabs — il part dans le chemin de l'URL. */
const PROVIDER_VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VoixPersonnelle {
  /** `user_voices.id` — le seul identifiant que l'écran manipule. */
  id: string;
  nom: string;
  fournisseur: string;
  langue: string | null;
  creeeLe: string;
  /** Utilisable = fournisseur câblé + identifiant fournisseur de forme valide. */
  utilisable: boolean;
}

export type MotifVoix = 'aucune_voix' | 'choix_requis' | 'voix_inexistante' | 'voix_inutilisable';

export const MESSAGES_VOIX: Record<MotifVoix, string> = {
  aucune_voix: 'Aucune voix personnelle n’est enregistrée sur votre compte.',
  choix_requis: 'Plusieurs voix sont enregistrées : choisissez celle à utiliser.',
  voix_inexistante: 'La voix choisie n’existe plus sur votre compte.',
  voix_inutilisable: 'La voix choisie ne peut pas être utilisée pour le moment.',
};

export interface ProfilVoix {
  voix: VoixPersonnelle[];
  /** Le `user_voices.id` enregistré, tel quel (peut désigner une voix disparue). */
  choix: string | null;
  /** La voix qui parlera, ou le motif qui l'empêche. */
  resolution: { ok: true; voix: VoixPersonnelle } | { ok: false; motif: MotifVoix };
  prononciations: Prononciation[];
}

/** Une voix de `user_voices` est-elle utilisable pour parler ? */
export function voixUtilisable(v: Pick<UserVoice, 'provider' | 'provider_voice_id'>): boolean {
  return (FOURNISSEURS_VOIX_CABLES as readonly string[]).includes(v.provider)
    && typeof v.provider_voice_id === 'string' && PROVIDER_VOICE_ID.test(v.provider_voice_id);
}

const presenter = (v: UserVoice): VoixPersonnelle => ({
  id: v.id, nom: v.name, fournisseur: v.provider, langue: v.lang ?? null, creeeLe: v.created_at, utilisable: voixUtilisable(v),
});

/**
 * La RÈGLE de résolution, pure :
 *   - aucune voix → `aucune_voix` ;
 *   - un choix enregistré → il doit désigner une voix du compte
 *     (`voix_inexistante`) et utilisable (`voix_inutilisable`) ;
 *   - pas de choix : une seule voix utilisable → elle ; plusieurs →
 *     `choix_requis`.
 */
export function resoudreVoix(voix: UserVoice[], choix: string | null): ProfilVoix['resolution'] {
  if (voix.length === 0) return { ok: false, motif: 'aucune_voix' };
  if (choix) {
    const v = voix.find((x) => x.id === choix);
    if (!v) return { ok: false, motif: 'voix_inexistante' };
    if (!voixUtilisable(v)) return { ok: false, motif: 'voix_inutilisable' };
    return { ok: true, voix: presenter(v) };
  }
  const utilisables = voix.filter(voixUtilisable);
  if (utilisables.length === 1) return { ok: true, voix: presenter(utilisables[0]) };
  if (utilisables.length === 0) return { ok: false, motif: 'voix_inutilisable' };
  return { ok: false, motif: 'choix_requis' };
}

// ─────────────────────────────────────────────────────────────────────────
// Persistance : `user_settings.creator_preferences.voixPersonnelle`
// ─────────────────────────────────────────────────────────────────────────

const CLE_PREFERENCE = 'voixPersonnelle';

interface PreferenceVoix { userVoiceId: string | null; prononciations: Prononciation[] }

function lirePreference(brut: unknown): PreferenceVoix {
  const o = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const userVoiceId = typeof o.userVoiceId === 'string' && UUID.test(o.userVoiceId) ? o.userVoiceId : null;
  return { userVoiceId, prononciations: lirePrononciations(o.prononciations) };
}

async function lirePreferences(userId: string): Promise<{ ok: true; toutes: Record<string, unknown>; voix: PreferenceVoix } | { ok: false; erreur: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('creator_preferences')
    .eq('user_id', userId)
    .limit(1);
  if (error) return { ok: false, erreur: error.message };
  const toutes = ((data?.[0] as { creator_preferences?: unknown } | undefined)?.creator_preferences ?? {}) as Record<string, unknown>;
  return { ok: true, toutes: toutes && typeof toutes === 'object' ? toutes : {}, voix: lirePreference(toutes[CLE_PREFERENCE]) };
}

async function ecrirePreference(userId: string, valeur: PreferenceVoix): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const actuelles = await lirePreferences(userId);
  if (!actuelles.ok) return actuelles;
  // Les AUTRES préférences du compte sont conservées : on ne réécrit que notre clé.
  const fusion = { ...actuelles.toutes, [CLE_PREFERENCE]: valeur };
  const { error } = await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: userId, creator_preferences: fusion, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return { ok: false, erreur: error.message };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Lecture et écriture, toujours confrontées à `user_voices`
// ─────────────────────────────────────────────────────────────────────────

export async function lireProfilVoix(userId: string): Promise<{ ok: true; profil: ProfilVoix } | { ok: false; erreur: string }> {
  if (!UUID.test(userId)) return { ok: false, erreur: 'compte invalide' };
  const [voix, prefs] = await Promise.all([listUserVoices(userId), lirePreferences(userId)]);
  if (!prefs.ok) return prefs;
  return {
    ok: true,
    profil: {
      voix: voix.map(presenter),
      choix: prefs.voix.userVoiceId,
      resolution: resoudreVoix(voix, prefs.voix.userVoiceId),
      prononciations: prefs.voix.prononciations,
    },
  };
}

/**
 * Enregistre le choix d'une voix. `userVoiceId` vient du navigateur : il
 * n'est accepté que s'il désigne une voix DU COMPTE, utilisable. `null`
 * efface le choix.
 */
export async function choisirVoix(userId: string, userVoiceId: unknown): Promise<
  { ok: true; profil: ProfilVoix } | { ok: false; motif: 'identifiant_invalide' | 'voix_inexistante' | 'voix_inutilisable' } | { ok: false; erreur: string }
> {
  if (!UUID.test(userId)) return { ok: false, erreur: 'compte invalide' };
  let choix: string | null;
  if (userVoiceId === null) {
    choix = null;
  } else {
    if (typeof userVoiceId !== 'string' || !UUID.test(userVoiceId)) return { ok: false, motif: 'identifiant_invalide' };
    const voix = await listUserVoices(userId);
    const v = voix.find((x) => x.id === userVoiceId);
    if (!v) return { ok: false, motif: 'voix_inexistante' };
    if (!voixUtilisable(v)) return { ok: false, motif: 'voix_inutilisable' };
    choix = v.id;
  }
  const prefs = await lirePreferences(userId);
  if (!prefs.ok) return prefs;
  const ecriture = await ecrirePreference(userId, { userVoiceId: choix, prononciations: prefs.voix.prononciations });
  if (!ecriture.ok) return ecriture;
  return lireProfilVoix(userId);
}

/** Remplace la liste des prononciations du compte (déjà validée par l'appelant, relue tolérante ici). */
export async function enregistrerPrononciations(userId: string, liste: Prononciation[]): Promise<{ ok: true; profil: ProfilVoix } | { ok: false; erreur: string }> {
  if (!UUID.test(userId)) return { ok: false, erreur: 'compte invalide' };
  const prefs = await lirePreferences(userId);
  if (!prefs.ok) return prefs;
  const ecriture = await ecrirePreference(userId, { userVoiceId: prefs.voix.userVoiceId, prononciations: lirePrononciations(liste) });
  if (!ecriture.ok) return ecriture;
  return lireProfilVoix(userId);
}

/**
 * Résout un IDENTIFIANT DE VOIX reçu d'ailleurs (une configuration Autopilote,
 * un réglage enregistré) vers le `provider_voice_id` d'une voix DU COMPTE.
 *
 * Deux formes sont reconnues, et seulement elles :
 *   - `elevenlabs-<provider_voice_id>` — l'identifiant Studiio que le
 *     navigateur manipule (GET /api/voice/clone) ;
 *   - un UUID `user_voices.id` — ce qu'une configuration plus ancienne a pu
 *     enregistrer (le Jumeau posait l'identifiant interne).
 * Dans les deux cas la voix doit APPARTENIR à `userId` et être utilisable ;
 * une voix d'un autre compte, un identifiant inconnu ou forgé rendent `null`.
 * L'appelant ne parle alors PAS au fournisseur : il n'y a rien de vrai à dire.
 */
export async function resoudreVoixParIdentifiant(userId: string, voiceId: string | null | undefined): Promise<{ providerVoiceId: string; userVoiceId: string } | null> {
  if (!UUID.test(userId)) return null;
  const brut = (voiceId ?? '').trim();
  if (!brut) return null;
  const voix = await listUserVoices(userId);
  let ligne: UserVoice | undefined;
  if (brut.startsWith('elevenlabs-')) {
    const nu = brut.slice('elevenlabs-'.length);
    if (!PROVIDER_VOICE_ID.test(nu)) return null;
    ligne = voix.find((v) => v.provider === 'elevenlabs' && v.provider_voice_id === nu);
  } else if (UUID.test(brut)) {
    ligne = voix.find((v) => v.id === brut);
  } else {
    return null;
  }
  if (!ligne || !voixUtilisable(ligne)) return null;
  return { providerVoiceId: ligne.provider_voice_id, userVoiceId: ligne.id };
}

/**
 * LA voix qui parlera pour ce compte — relue à l'instant, jamais mise en
 * cache, jamais reçue du navigateur. Avec son `provider_voice_id`, que seul
 * le serveur voit. C'est ce que Créer et l'Autopilote appelleront.
 */
export async function resoudreVoixDuCompte(userId: string): Promise<
  { ok: true; voix: VoixPersonnelle; providerVoiceId: string; prononciations: Prononciation[] } | { ok: false; motif: MotifVoix } | { ok: false; erreur: string }
> {
  if (!UUID.test(userId)) return { ok: false, erreur: 'compte invalide' };
  const [voix, prefs] = await Promise.all([listUserVoices(userId), lirePreferences(userId)]);
  if (!prefs.ok) return prefs;
  const resolution = resoudreVoix(voix, prefs.voix.userVoiceId);
  if (!resolution.ok) return resolution;
  const ligne = voix.find((v) => v.id === resolution.voix.id)!;
  return { ok: true, voix: resolution.voix, providerVoiceId: ligne.provider_voice_id, prononciations: prefs.voix.prononciations };
}
