/**
 * GET /api/avatar/sources/apercu?cle=… — relire une source (originale ou
 * préparée) DU COMPTE CONNECTÉ, pour l'aperçu de l'éditeur.
 *
 * Le compte vient de la session ; la clé, reçue du navigateur, n'est qu'une
 * DEMANDE : elle doit être une source de CE compte (`cleSourceAvatarDuCompte`)
 * avant le moindre appel au stockage. Mêmes en-têtes que `GET
 * /api/avatar/source` (type décidé par la clé, `nosniff`, CSP vide, jamais en
 * cache partagé), et `Range` honoré : un lecteur vidéo doit pouvoir se
 * positionner dans la coupe.
 *
 * 404 PARTOUT, et c'est volontaire : clé absente, d'autrui, vidéo générée,
 * objet absent — une seule réponse.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { cleSourceAvatarDuCompte } from '@/lib/avatar/source';
import { reponseSourceAvatar, sourceIntrouvable as introuvable } from '@/lib/avatar/servir-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const cle = req.nextUrl.searchParams.get('cle');
    if (!cleSourceAvatarDuCompte(cle, userId)) return introuvable();
    return await reponseSourceAvatar(cle, req.headers.get('range'));
  } catch (e: unknown) {
    console.error('[Avatar][sources/apercu] lecture impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500 });
  }
}
