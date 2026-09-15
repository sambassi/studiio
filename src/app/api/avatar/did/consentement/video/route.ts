/**
 * POST /api/avatar/did/consentement/video — la vidéo de consentement lue à la
 * caméra (multipart, champ `file`). Déposée en PRIVÉ, puis transmise à D-ID
 * par une URL signée et expirante. MP4/MOV, 50 Mo maximum (limite D-ID).
 */
import { NextRequest, NextResponse } from 'next/server';
import { deposerVideoConsentementDid, MAX_VIDEO_CONSENTEMENT_OCTETS } from '@/lib/avatar/did';
import { compteCourant, reponseDid } from '../../reponse';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  let file: File | null;
  try {
    const fd = await req.formData();
    file = fd.get('file') as File | null;
  } catch {
    return NextResponse.json({ success: false, error: 'Aucun fichier fourni.' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ success: false, error: 'Aucun fichier fourni.' }, { status: 400 });
  if (file.size > MAX_VIDEO_CONSENTEMENT_OCTETS) {
    return NextResponse.json({ success: false, error: 'Vidéo trop lourde (50 Mo maximum).', code: 'fichier_trop_lourd' }, { status: 413 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    return reponseDid(await deposerVideoConsentementDid(c.userId, { buffer, type: file.type, taille: file.size, nom: file.name || 'consentement' }));
  } catch (e) {
    console.error('[Avatar][D-ID] vidéo de consentement :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'La vidéo de consentement n’a pas pu être traitée.' }, { status: 500 });
  }
}
