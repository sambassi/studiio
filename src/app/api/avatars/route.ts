/**
 * GET /api/avatars — « Mes avatars » : les identités du compte, leur
 * version active, la candidate éventuelle et l'historique.
 *
 * Forme PUBLIQUE uniquement : aucun identifiant fournisseur, aucune clé de
 * stockage. `capacite.nouvelAvatarVideo` dit AVANT tout envoi si un nouvel
 * avatar vidéo peut être créé (emplacements du compte fournisseur).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { isAdmin } from '@/lib/admin';
import {
  listerIdentites, versionsDe, candidateDe, identitesVideoAvecGroupe, emplacementsVideo,
} from '@/lib/avatar/versions';
import { versionPublique } from '@/lib/avatar/actions-version';
import { jumeauVideoAutorise } from '@/lib/avatar/fournisseurs';
import { qualitesDisponibles } from '@/lib/avatar/moteurs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const l = await listerIdentites(userId);
  if (!l.ok) return NextResponse.json({ success: false, error: 'Vos avatars n’ont pas pu être lus.' }, { status: 500 });
  let versions;
  try {
    versions = await versionsDe(userId, l.identites.map((i) => i.id));
  } catch {
    return NextResponse.json({ success: false, error: 'Vos avatars n’ont pas pu être lus.' }, { status: 500 });
  }
  const avatars = l.identites.map((i) => {
    const siennes = versions.filter((v) => v.user_avatar_id === i.id);
    const active = siennes.find((v) => v.id === i.active_version_id) ?? null;
    const candidate = candidateDe(i, siennes);
    return {
      id: i.id,
      nom: i.name ?? 'Mon avatar',
      parDefaut: i.is_default,
      type: i.avatar_type === 'video' ? 'video' : 'photo',
      utilisable: !!active,
      versionActive: active ? versionPublique(active) : null,
      candidate: candidate ? versionPublique(candidate) : null,
      historique: siennes
        .filter((v) => v.id !== active?.id && v.id !== candidate?.id)
        .map(versionPublique),
    };
  });
  const video = jumeauVideoAutorise(isAdmin(session.user.email));
  const libres = emplacementsVideo() - identitesVideoAvecGroupe(l.identites);
  return NextResponse.json({
    success: true,
    data: {
      avatars,
      capacite: {
        nouvelAvatarPhoto: true,
        nouvelAvatarVideo: video && libres > 0,
        emplacementsVideoLibres: video ? Math.max(0, libres) : 0,
      },
      qualites: qualitesDisponibles(),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
