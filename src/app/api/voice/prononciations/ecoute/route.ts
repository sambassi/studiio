/**
 * POST /api/voice/prononciations/ecoute — l'icône haut-parleur d'une ligne
 * de prononciation : quelques secondes de LA voix du compte, sur ce mot.
 *
 * Le navigateur envoie `{ affiche }` et RIEN d'autre n'est lu : aucun texte
 * libre, aucune voix, aucune durée. Le serveur :
 *   1. résout la voix du compte (`resoudreVoixDuCompte`) — sans voix → 409 ;
 *   2. retrouve l'entrée dans les prononciations DU COMPTE (`cleAffiche`) —
 *      absente → 404 ;
 *   3. fabrique lui-même le mini-texte : l'`affiche` de l'entrée, passé par
 *      le vrai chemin (`scriptParle`, donc prononciations + normalisation),
 *      puis borné à `MAX_CARACTERES_PREECOUTE` (coupé au mot) ;
 *   4. limiteur par compte (429 + Retry-After), petit cache mémoire, puis la
 *      même synthèse que « Écouter ma voix » (`synthetiserAvecVoix`).
 * Réponse : l'audio brut, `private, no-store`. Aucun stockage, aucune URL
 * publique, aucun crédit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { resoudreVoixDuCompte, MESSAGES_VOIX } from '@/lib/voice/profil';
import { cleAffiche, scriptParle } from '@/lib/voice/prononciations';
import { synthetiserAvecVoix, cleElevenLabs } from '@/lib/voice/synthese';
import { couperAuMot, MAX_CARACTERES_PREECOUTE } from '@/lib/voice/preecoute';
import {
  refusDebit, reponseEchecSynthese, reponseAudio, lireCachePreecoute, ecrireCachePreecoute,
} from '@/lib/voice/preecoute-serveur';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  let affiche: unknown = null;
  try { affiche = ((await req.json()) as { affiche?: unknown } | null)?.affiche ?? null; } catch { affiche = null; }
  const cle = typeof affiche === 'string' ? cleAffiche(affiche) : '';
  if (!cle) return NextResponse.json({ success: false, error: 'Prononciation à écouter manquante.', code: 'affiche_manquante' }, { status: 400 });

  const voix = await resoudreVoixDuCompte(userId);
  if (!voix.ok) {
    if ('motif' in voix) return NextResponse.json({ success: false, error: MESSAGES_VOIX[voix.motif], code: voix.motif }, { status: 409 });
    console.error('[Voice][prononciation-ecoute] voix illisible :', voix.erreur);
    return NextResponse.json({ success: false, error: 'Votre voix n’a pas pu être lue.' }, { status: 500 });
  }

  const entree = voix.prononciations.find((p) => cleAffiche(p.affiche) === cle);
  if (!entree) {
    return NextResponse.json({ success: false, error: 'Cette prononciation n’existe plus.', code: 'prononciation_introuvable' }, { status: 404 });
  }
  const spoken = couperAuMot(scriptParle(entree.affiche, voix.prononciations), MAX_CARACTERES_PREECOUTE);
  if (!spoken) {
    return NextResponse.json({ success: false, error: 'Cette prononciation n’existe plus.', code: 'prononciation_introuvable' }, { status: 404 });
  }

  const refus = refusDebit(userId);
  if (refus) return refus;

  // Le cache ne sert que si l'écoute est réellement branchée : sans clé, on
  // dit « indisponible », jamais un ancien audio.
  const enCache = cleElevenLabs() ? lireCachePreecoute(userId, voix.providerVoiceId, spoken) : null;
  if (enCache) return reponseAudio(enCache.audio, enCache.contentType, voix.voix.id, spoken);

  const synthese = await synthetiserAvecVoix({ providerVoiceId: voix.providerVoiceId, texte: spoken });
  if (!synthese.ok) return reponseEchecSynthese(synthese, 'prononciation-ecoute');
  ecrireCachePreecoute(userId, voix.providerVoiceId, spoken, synthese.audio, synthese.contentType);
  return reponseAudio(synthese.audio, synthese.contentType, voix.voix.id, spoken);
}
