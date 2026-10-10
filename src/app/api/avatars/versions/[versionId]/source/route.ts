/**
 * GET /api/avatars/versions/:versionId/source[?quelle=originale]
 *
 * La source qui a créé UNE version d'avatar du compte connecté — pour
 * l'historique « Versions de l'avatar » (Voir la source, miniature).
 *
 *   défaut      → la source ENVOYÉE au fournisseur (`source_object_key`) ;
 *   originale   → le fichier importé tel quel (`original_source_object_key`),
 *                 conservé à côté de la version préparée.
 *
 * Le navigateur ne désigne que la VERSION : la clé vient de la ligne, la ligne
 * est cherchée au compte de la session (`versionDuCompte`), et la clé est
 * REVALIDÉE (`cleSourceAvatarDuCompte`) avant tout appel au stockage. Aucune
 * clé n'est jamais renvoyée. 404 partout, comme `/api/avatar/source`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { versionDuCompte } from '@/lib/avatar/versions';
import { cleSourceAvatarDuCompte } from '@/lib/avatar/source';
import { reponseSourceAvatar, sourceIntrouvable } from '@/lib/avatar/servir-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { versionId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const version = await versionDuCompte(userId, params.versionId);
    if (!version) return sourceIntrouvable();
    const cle = req.nextUrl.searchParams.get('quelle') === 'originale'
      ? (version.original_source_object_key ?? version.source_object_key)
      : version.source_object_key;
    if (!cleSourceAvatarDuCompte(cle, userId)) return sourceIntrouvable();
    return await reponseSourceAvatar(cle, req.headers.get('range'));
  } catch (e: unknown) {
    console.error('[Avatar][versions/source] lecture impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500 });
  }
}
