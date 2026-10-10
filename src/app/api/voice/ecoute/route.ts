/**
 * POST /api/voice/ecoute — « Écouter ma voix » : un VRAI audio ElevenLabs,
 * avec LA voix personnelle du compte, sur le texte RÉELLEMENT PRONONCÉ.
 *
 * Le navigateur envoie `{ texte }` (le texte affiché). Le serveur :
 *   1. résout la voix du compte (`resoudreVoixDuCompte`) — jamais un
 *      identifiant reçu ; sans voix → 409 avec le motif ;
 *   2. calcule le SPOKEN_SCRIPT avec les prononciations du compte ;
 *   3. refuse (400 `texte_trop_long`) un texte dit de plus de
 *      `MAX_CARACTERES_PREECOUTE` (≈ 5 s) : c'est une PRÉ-ÉCOUTE gratuite,
 *      jamais un audio long — la borne de l'écran n'est pas crue ;
 *   4. limiteur par compte, commun avec l'écoute des prononciations (429) ;
 *   5. synthétise chez ElevenLabs ; sans clé → 503 « pas encore
 *      disponible » ; erreur fournisseur → 502, jamais un faux succès, jamais
 *      une voix générique à la place.
 * Répond l'audio brut, plus `X-Studiio-Spoken` (le texte dit, encodé) pour
 * que l'écran montre ce qui a été prononcé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { resoudreVoixDuCompte, MESSAGES_VOIX } from '@/lib/voice/profil';
import { scriptParle } from '@/lib/voice/prononciations';
import { synthetiserAvecVoix, MAX_TEXTE_ECOUTE } from '@/lib/voice/synthese';
import { MAX_CARACTERES_PREECOUTE, MESSAGE_TEXTE_TROP_LONG } from '@/lib/voice/preecoute';
import { refusDebit, reponseEchecSynthese, reponseAudio } from '@/lib/voice/preecoute-serveur';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let texte = '';
  try { texte = String(((await req.json()) as { texte?: unknown } | null)?.texte ?? '').trim(); } catch { texte = ''; }
  if (!texte) return NextResponse.json({ success: false, error: 'Le texte à écouter est vide.' }, { status: 400 });
  // Garde grossière avant tout travail ; la vraie borne porte sur le texte dit.
  if (texte.length > MAX_TEXTE_ECOUTE) {
    return NextResponse.json({ success: false, error: MESSAGE_TEXTE_TROP_LONG, code: 'texte_trop_long' }, { status: 400 });
  }

  const voix = await resoudreVoixDuCompte(session.user.id);
  if (!voix.ok) {
    if ('motif' in voix) return NextResponse.json({ success: false, error: MESSAGES_VOIX[voix.motif], code: voix.motif }, { status: 409 });
    console.error('[Voice][ecoute] voix illisible :', voix.erreur);
    return NextResponse.json({ success: false, error: 'Votre voix n’a pas pu être lue.' }, { status: 500 });
  }

  const spoken = scriptParle(texte, voix.prononciations);
  if (spoken.length > MAX_CARACTERES_PREECOUTE) {
    return NextResponse.json({ success: false, error: MESSAGE_TEXTE_TROP_LONG, code: 'texte_trop_long' }, { status: 400 });
  }

  const refus = refusDebit(session.user.id);
  if (refus) return refus;

  const synthese = await synthetiserAvecVoix({ providerVoiceId: voix.providerVoiceId, texte: spoken });
  if (!synthese.ok) return reponseEchecSynthese(synthese, 'ecoute');
  return reponseAudio(synthese.audio, synthese.contentType, voix.voix.id, spoken);
}
