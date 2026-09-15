/**
 * GET /api/voice/profil — « Ma voix & prononciations », tel que le serveur le voit.
 *
 * Voix du compte (`user_voices`), choix enregistré, voix résolue (ou motif),
 * prononciations, et si l'ÉCOUTE est réellement disponible : une voix
 * utilisable ET une clé fournisseur configurée. Rien n'est inventé.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireProfilVoix, MESSAGES_VOIX } from '@/lib/voice/profil';
import { cleElevenLabs } from '@/lib/voice/synthese';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const lecture = await lireProfilVoix(session.user.id);
  if (!lecture.ok) {
    console.error('[Voice][profil] lecture impossible :', lecture.erreur);
    return NextResponse.json({ success: false, error: 'Votre profil vocal n’a pas pu être lu.' }, { status: 500 });
  }
  const p = lecture.profil;
  return NextResponse.json({
    success: true,
    data: {
      voix: p.voix,
      choix: p.choix,
      voixResolue: p.resolution.ok ? p.resolution.voix : null,
      motifVoix: p.resolution.ok ? null : p.resolution.motif,
      messageVoix: p.resolution.ok ? null : MESSAGES_VOIX[p.resolution.motif],
      prononciations: p.prononciations,
      ecouteDisponible: p.resolution.ok && cleElevenLabs() !== null,
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
