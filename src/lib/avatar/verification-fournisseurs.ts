/**
 * Vérification NON PAYANTE du jumeau chez les fournisseurs, avant tout rendu
 * (docs/FEATURE_LOCKS.md, règle « fournisseurs ») : une valeur en base ne
 * prouve jamais que la ressource existe encore chez le fournisseur.
 *
 *  - D-ID      : GET /scenes/avatars/{id}  (lecture d'état, gratuite)
 *  - ElevenLabs: GET /v1/voices/{id}       (lecture de la voix, gratuite)
 *  - stockage  : présence de la source d'enrôlement (statObject)
 *
 * Aucune génération, aucune synthèse, aucun identifiant fournisseur rendu.
 */
import { resoudreJumeauDuCompte } from '@/lib/avatar/jumeau';
import { lireAvatarDid, DidError, type DepsDid } from '@/lib/providers/did/client';
import { sourceAvatarPresente } from '@/lib/avatar/source';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';

export type EtatRessource = 'pret' | 'introuvable' | 'non_pret' | 'refuse' | 'non_verifiable';

export interface VerificationJumeau {
  avatar: EtatRessource;
  voix: EtatRessource;
  sourcePresente: boolean;
  /** Détail lisible, sans identifiant. */
  details: string[];
}

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

export async function verifierVoixElevenLabs(providerVoiceId: string, deps: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<EtatRessource> {
  const env = deps.env ?? process.env;
  const cle = env.ELEVENLABS_API_KEY?.trim();
  if (!cle) return 'non_verifiable';
  try {
    const res = await (deps.fetch ?? fetch)(`${ELEVENLABS_BASE}/v1/voices/${encodeURIComponent(providerVoiceId)}`, {
      method: 'GET', headers: { 'xi-api-key': cle, Accept: 'application/json' }, cache: 'no-store',
    });
    if (res.ok) return 'pret';
    if (res.status === 404 || res.status === 400) return 'introuvable';
    if (res.status === 401 || res.status === 403) return 'refuse';
    return 'non_verifiable';
  } catch {
    return 'non_verifiable';
  }
}

export async function verifierAvatarDid(providerAvatarId: string, deps: DepsDid = {}): Promise<EtatRessource> {
  try {
    const { statut } = await lireAvatarDid(providerAvatarId, { timeoutMs: 15_000, ...deps });
    return statut === 'done' ? 'pret' : 'non_pret';
  } catch (e) {
    if (e instanceof DidError && e.httpStatus === 404) return 'introuvable';
    if (e instanceof DidError && e.code === 'did_unauthorized') return 'refuse';
    return 'non_verifiable';
  }
}

export async function verifierJumeauChezFournisseurs(userId: string): Promise<VerificationJumeau | { motif: string }> {
  const r = await resoudreJumeauDuCompte(userId);
  if (!r.ok) return { motif: 'motif' in r ? r.motif : 'lecture_impossible' };
  const details: string[] = [];
  const avatar = r.prive.fournisseurAvatar === 'did' ? await verifierAvatarDid(r.prive.providerAvatarId) : 'non_verifiable';
  if (r.prive.fournisseurAvatar !== 'did') details.push('Vérification d’avatar disponible pour D-ID uniquement.');
  const voix = await verifierVoixElevenLabs(r.prive.providerVoiceId);
  const lecture = await avatarVivantDuCompte(userId);
  const cle = lecture.ok ? (lecture.avatar as { source_object_key?: string | null } | null)?.source_object_key : null;
  const sourcePresente = cle ? await sourceAvatarPresente(userId, cle) : false;
  if (!sourcePresente) details.push('La vidéo source de l’avatar est absente du stockage : l’aperçu ne peut pas s’afficher.');
  return { avatar, voix, sourcePresente, details };
}
