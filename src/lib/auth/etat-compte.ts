/**
 * État d'un compte pour la SESSION : un compte supprimé (RGPD) ne doit plus
 * rien ouvrir avec un ancien JWT encore valide.
 *
 * Appelé par le callback `jwt` d'Auth.js à chaque lecture de session — donc
 * aussi dans le middleware (Edge) : ce module n'importe que `supabaseAdmin`
 * (fetch), aucun module Node.
 *
 * Règles :
 *  - FAIL-CLOSED seulement sur une preuve explicite de suppression :
 *    `users.deleted_at` renseigné, ou adresse anonymisée
 *    `supprime-…@supprime.invalid` (posée par l'étape `compte` de
 *    `lib/rgpd/suppression-donnees.ts`) ;
 *  - FAIL-OPEN sur l'indisponibilité : base en panne, ligne introuvable,
 *    réponse illisible → `inconnu`, la session continue. Une panne ne doit
 *    jamais déconnecter les autres utilisateurs ;
 *  - `blocked` (bannissement admin, réversible) N'EST PAS lu ici : il n'a
 *    jamais coupé la session jusqu'ici, l'appliquer serait un changement de
 *    comportement hors de la suppression RGPD (voir la doc RGPD).
 *
 * Cache court en mémoire (par instance) : 60 s pour un compte actif, sans
 * limite pour un compte supprimé (l'état est définitif), rien en cas d'échec.
 *
 * Lecture BORNÉE (`DELAI_LECTURE_ETAT_MS`) : une base gelée ne doit jamais
 * suspendre les sessions. Au-delà du délai → `inconnu`, et la vérification
 * est suspendue `PAUSE_APRES_DELAI_MS` pour ce compte, afin que chaque
 * requête ne paie pas le délai pendant la panne.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

export type EtatCompteSession = 'actif' | 'supprime' | 'inconnu';

export const DUREE_CACHE_ETAT_MS = 60_000;
const TAILLE_CACHE_MAX = 5_000;
export const DELAI_LECTURE_ETAT_MS = 1_500;
export const PAUSE_APRES_DELAI_MS = 15_000;

const DELAI_DEPASSE = Symbol('delai');

function borne<T>(p: Promise<T>, ms: number): Promise<T | typeof DELAI_DEPASSE> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<typeof DELAI_DEPASSE>((r) => { minuteur = setTimeout(() => r(DELAI_DEPASSE), ms); });
  return Promise.race([p, delai]).finally(() => clearTimeout(minuteur));
}

const EMAIL_ANONYMISE = /^supprime-[0-9a-f-]{36}@supprime\.invalid$/i;

export function estEmailAnonymise(email: unknown): boolean {
  return typeof email === 'string' && EMAIL_ANONYMISE.test(email.trim());
}

/** Décision pure, à partir de la ligne `users` lue. */
export function etatDepuisLigne(ligne: Record<string, unknown> | null | undefined): EtatCompteSession {
  if (!ligne) return 'inconnu';
  if (ligne.deleted_at !== null && ligne.deleted_at !== undefined && ligne.deleted_at !== '') return 'supprime';
  if (estEmailAnonymise(ligne.email)) return 'supprime';
  return 'actif';
}

const cache = new Map<string, { etat: EtatCompteSession; expire: number }>();

/** Réservé aux tests. */
export function viderCacheEtatCompte(): void {
  cache.clear();
}

/** Après une suppression : la session du compte tombe sans attendre le cache. */
export function marquerCompteSupprime(uid: string): void {
  cache.set(uid, { etat: 'supprime', expire: Number.POSITIVE_INFINITY });
}

async function lireLigne(uid: string): Promise<Record<string, unknown> | null | 'erreur'> {
  const r = await supabaseAdmin.from('users').select('email, deleted_at').eq('id', uid).limit(1);
  if (!r.error) return (Array.isArray(r.data) ? (r.data[0] as Record<string, unknown>) : null) ?? null;
  // Colonne `deleted_at` absente d'une base ancienne (42703) : l'adresse
  // anonymisée suffit à reconnaître un compte supprimé.
  if ((r.error as { code?: string }).code === '42703') {
    const r2 = await supabaseAdmin.from('users').select('email').eq('id', uid).limit(1);
    if (!r2.error) return (Array.isArray(r2.data) ? (r2.data[0] as Record<string, unknown>) : null) ?? null;
  }
  return 'erreur';
}

export async function etatCompteSession(uid: string, maintenant: number = Date.now()): Promise<EtatCompteSession> {
  const c = cache.get(uid);
  if (c && c.expire > maintenant) return c.etat;
  if (c && c.etat === 'inconnu') cache.delete(uid); // pause écoulée : on réessaie
  let etat: EtatCompteSession;
  try {
    const ligne = await borne(lireLigne(uid), DELAI_LECTURE_ETAT_MS);
    if (ligne === DELAI_DEPASSE) {
      // Base gelée : la session continue, sans repayer le délai à chaque requête.
      if (cache.size >= TAILLE_CACHE_MAX) cache.clear();
      cache.set(uid, { etat: 'inconnu', expire: maintenant + PAUSE_APRES_DELAI_MS });
      return 'inconnu';
    }
    etat = ligne === 'erreur' ? 'inconnu' : etatDepuisLigne(ligne);
  } catch {
    etat = 'inconnu';
  }
  if (etat === 'inconnu') return etat; // erreur franche : pas de cache, on réessaie
  if (cache.size >= TAILLE_CACHE_MAX) cache.clear();
  cache.set(uid, { etat, expire: etat === 'supprime' ? Number.POSITIVE_INFINITY : maintenant + DUREE_CACHE_ETAT_MS });
  return etat;
}
