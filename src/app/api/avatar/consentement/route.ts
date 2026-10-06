/**
 * /api/avatar/consentement — consentement filmé du jumeau VIDÉO (digital
 * twin), niveau 1. TEMPORAIRE et RÉSERVÉ À L'ADMIN.
 *
 *  POST : demande au fournisseur le lien de sa page d'enregistrement webcam
 *         (valable 24 h) et le rend — à l'admin uniquement.
 *  GET  : relit le statut de consentement chez le fournisseur et l'enregistre.
 *
 * Un utilisateur non admin reçoit 403, sans lien ni nom de fournisseur :
 * aucune URL fournisseur ne doit jamais lui parvenir.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { isAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { demanderConsentementJumeau, lireConsentementJumeau } from '@/lib/avatar/heygen';
import { jumeauVideoAutorise, MESSAGES_AVATAR, MESSAGES_CREATION } from '@/lib/avatar/fournisseurs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ligne = { id: string; provider?: string | null; avatar_type?: string | null; provider_group_id?: string | null; provider_group_consent?: string | null };

async function contexte() {
  const session = await auth();
  if (!session?.user?.id) return { erreur: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  if (!jumeauVideoAutorise(isAdmin(session.user.email))) {
    return { erreur: NextResponse.json({ success: false, error: MESSAGES_CREATION.videoIndisponible, code: 'jumeau_video_indisponible' }, { status: 403 }) };
  }
  const lecture = await avatarVivantDuCompte(session.user.id);
  if (!lecture.ok) return { erreur: NextResponse.json({ success: false, error: 'Votre avatar n’a pas pu être lu.' }, { status: 500 }) };
  const a = lecture.avatar as unknown as Ligne | null;
  if (!a || (a.provider ?? 'heygen') !== 'heygen' || a.avatar_type !== 'video' || !a.provider_group_id) {
    return { erreur: NextResponse.json({ success: false, error: 'Aucun avatar vidéo en attente de consentement.', code: 'pas_de_jumeau_video' }, { status: 409 }) };
  }
  return { userId: session.user.id, avatar: a as Ligne & { provider_group_id: string } };
}

export async function POST() {
  const c = await contexte();
  if ('erreur' in c) return c.erreur;
  if (c.avatar.provider_group_consent === 'accepted') {
    return NextResponse.json({ success: true, data: { statut: 'accepted', url: null } });
  }
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://studiio.pro';
    const { url } = await demanderConsentementJumeau(c.avatar.provider_group_id, `${base}/dashboard/avatar`);
    await supabaseAdmin.from('user_avatars').update({ provider_group_consent: 'pending' }).eq('id', c.avatar.id).eq('user_id', c.userId);
    return NextResponse.json({ success: true, data: { statut: 'pending', url } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[Avatar][consentement] demande refusée :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: MESSAGES_AVATAR.indisponible }, { status: 502 });
  }
}

export async function GET() {
  const c = await contexte();
  if ('erreur' in c) return c.erreur;
  try {
    const statut = await lireConsentementJumeau(c.avatar.provider_group_id);
    if (statut && statut !== c.avatar.provider_group_consent) {
      await supabaseAdmin.from('user_avatars').update({ provider_group_consent: statut }).eq('id', c.avatar.id).eq('user_id', c.userId);
    }
    return NextResponse.json({ success: true, data: { statut: statut ?? c.avatar.provider_group_consent ?? null } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[Avatar][consentement] lecture impossible :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: true, data: { statut: c.avatar.provider_group_consent ?? null } });
  }
}
