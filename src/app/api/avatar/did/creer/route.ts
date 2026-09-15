/**
 * POST /api/avatar/did/creer — crée le V3 Instant Avatar chez D-ID à partir
 * de la source privée du compte, une fois le consentement ACCEPTÉ. La source
 * part par une URL signée et expirante. Un seul avatar par version (CAS).
 */
import { NextResponse } from 'next/server';
import { creerAvatarVideoDid } from '@/lib/avatar/did';
import { compteCourant, reponseDid } from '../reponse';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  try {
    return reponseDid(await creerAvatarVideoDid(c.userId));
  } catch (e) {
    console.error('[Avatar][D-ID] création :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'La création de l’avatar vidéo a échoué.' }, { status: 500 });
  }
}
