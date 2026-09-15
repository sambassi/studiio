/**
 * PUT /api/voice/profil/voix — choisir la voix personnelle à utiliser.
 * Corps : `{ userVoiceId: string | null }`. L'identifiant est celui de
 * `user_voices` ; le serveur vérifie qu'il désigne une voix DU COMPTE,
 * utilisable — sinon 404/409, rien n'est enregistré.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { choisirVoix, MESSAGES_VOIX } from '@/lib/voice/profil';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let corps: { userVoiceId?: unknown } = {};
  try { corps = (await req.json()) ?? {}; } catch { corps = {}; }
  if (!('userVoiceId' in corps)) return NextResponse.json({ success: false, error: 'userVoiceId manquant.' }, { status: 400 });
  const r = await choisirVoix(session.user.id, corps.userVoiceId);
  if (r.ok) return NextResponse.json({ success: true, data: { choix: r.profil.choix, voixResolue: r.profil.resolution.ok ? r.profil.resolution.voix : null } });
  if ('motif' in r) {
    if (r.motif === 'identifiant_invalide') return NextResponse.json({ success: false, error: 'Identifiant de voix invalide.', code: r.motif }, { status: 400 });
    if (r.motif === 'voix_inexistante') return NextResponse.json({ success: false, error: MESSAGES_VOIX.voix_inexistante, code: r.motif }, { status: 404 });
    return NextResponse.json({ success: false, error: MESSAGES_VOIX.voix_inutilisable, code: r.motif }, { status: 409 });
  }
  console.error('[Voice][profil] choix impossible :', r.erreur);
  return NextResponse.json({ success: false, error: 'Votre choix n’a pas pu être enregistré.' }, { status: 500 });
}
