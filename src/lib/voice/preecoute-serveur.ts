/**
 * Pré-écoute de la voix personnelle — ce que les deux routes d'écoute
 * partagent côté serveur (`/api/voice/ecoute` et
 * `/api/voice/prononciations/ecoute`) :
 *
 *   - UN limiteur par compte, commun aux deux routes : 10 pré-écoutes par
 *     minute et 60 par heure. Au-delà → 429 avec `Retry-After` ;
 *   - la traduction d'un échec de synthèse en réponse honnête (503 sans
 *     clé, 502 erreur fournisseur — jamais un faux succès) ;
 *   - la réponse audio : `private, no-store`, aucun envoi au stockage,
 *     aucune URL publique, aucun crédit.
 *
 * La synthèse elle-même reste `synthetiserAvecVoix` (même voix, même
 * modèle) : rien n'est dupliqué ici.
 */
import { NextResponse } from 'next/server';
import { creerLimiteurMemoire } from '@/lib/securite/limiteur-memoire';
import { MESSAGE_TROP_D_ECOUTES } from '@/lib/voice/preecoute';
import type { ResultatSynthese } from '@/lib/voice/synthese';

export const LIMITE_PREECOUTE_MINUTE = 10;
export const LIMITE_PREECOUTE_HEURE = 60;

export const limiteurPreecoute = creerLimiteurMemoire({
  fenetres: [
    { dureeMs: 60_000, max: LIMITE_PREECOUTE_MINUTE },
    { dureeMs: 3_600_000, max: LIMITE_PREECOUTE_HEURE },
  ],
});

/** 429 si le compte a épuisé sa fenêtre ; `null` si le passage est compté. */
export function refusDebit(userId: string): NextResponse | null {
  const r = limiteurPreecoute.consommer(userId);
  if (r.ok) return null;
  return NextResponse.json(
    { success: false, error: MESSAGE_TROP_D_ECOUTES, code: 'trop_d_ecoutes' },
    { status: 429, headers: { 'Retry-After': String(r.reessayerDansS) } },
  );
}

/** Un échec de synthèse, dit honnêtement. */
export function reponseEchecSynthese(synthese: Extract<ResultatSynthese, { ok: false }>, journal: string): NextResponse {
  if (synthese.motif === 'indisponible') {
    return NextResponse.json(
      { success: false, error: 'L’écoute de votre voix personnelle n’est pas encore disponible.', code: 'ecoute_indisponible' },
      { status: 503 },
    );
  }
  console.error(`[Voice][${journal}] ElevenLabs ${synthese.statut ?? 'sans statut'} : ${synthese.detail}`);
  return NextResponse.json(
    { success: false, error: 'L’écoute de votre voix n’a pas pu être générée. Réessayez.', code: 'ecoute_echec' },
    { status: 502 },
  );
}

/** L'audio brut, privé, jamais mis en cache par le navigateur ni stocké. */
export function reponseAudio(audio: Buffer, contentType: string, voixId: string, spoken: string): NextResponse {
  return new NextResponse(new Uint8Array(audio) as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(audio.length),
      'Cache-Control': 'private, no-store',
      'X-Studiio-Voice': voixId,
      'X-Studiio-Spoken': encodeURIComponent(spoken),
    },
  });
}

/**
 * Petit cache mémoire des pré-écoutes de prononciation : un même mot,
 * cliqué plusieurs fois, n'est synthétisé qu'une fois. Clé = compte + voix
 * fournisseur + texte dit ; quelques minutes ; taille bornée (le plus
 * ancien sort). Mémoire du processus seulement, jamais servi à un autre
 * compte.
 */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 100;
const cache = new Map<string, { audio: Buffer; contentType: string; expire: number }>();

const cleCache = (userId: string, providerVoiceId: string, spoken: string) => `${userId}\u0000${providerVoiceId}\u0000${spoken}`;

export function lireCachePreecoute(userId: string, providerVoiceId: string, spoken: string, maintenant = Date.now()) {
  const cle = cleCache(userId, providerVoiceId, spoken);
  const entree = cache.get(cle);
  if (!entree) return null;
  if (entree.expire <= maintenant) { cache.delete(cle); return null; }
  return entree;
}

export function ecrireCachePreecoute(userId: string, providerVoiceId: string, spoken: string, audio: Buffer, contentType: string, maintenant = Date.now()) {
  const cle = cleCache(userId, providerVoiceId, spoken);
  cache.delete(cle);
  while (cache.size >= CACHE_MAX) {
    const plusAncienne = cache.keys().next().value;
    if (plusAncienne === undefined) break;
    cache.delete(plusAncienne);
  }
  cache.set(cle, { audio, contentType, expire: maintenant + CACHE_TTL_MS });
}

/** Tests : remet compteurs et cache à zéro. */
export function reinitialiserPreecoute() {
  limiteurPreecoute.reinitialiser();
  cache.clear();
}
