/**
 * POST /api/avatar/did/apercu — l'aperçu de validation d'un avatar D-ID :
 * MA voix (ElevenLabs personnelle, SPOKEN_SCRIPT avec mes prononciations) →
 * audio privé → scène D-ID sur cet audio. Offert (0 crédit), une fois par
 * version (index unique). Le suivi passe par `/api/avatar/status`, comme
 * toute génération ; la vidéo est re-hébergée chez nous.
 */
import { NextResponse } from 'next/server';
import { lancerApercuDid } from '@/lib/avatar/did';
import { compteCourant, reponseDid } from '../reponse';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  try {
    return reponseDid(await lancerApercuDid(c.userId));
  } catch (e) {
    console.error('[Avatar][D-ID] aperçu :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: "L'aperçu n'a pas pu être lancé." }, { status: 500 });
  }
}
