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
import { Readable } from 'stream';
import { auth } from '@/lib/auth/config';
import { BUCKET_AVATAR, cleSourceAvatarDuCompte, typeSourceAvatar } from '@/lib/avatar/source';
import { clientMinio, lecteurMinio } from '@/lib/storage/minio-client';
import {
  enteteContentRange, enteteContentRangeInsatisfiable, lirePlageOctets,
} from '@/lib/http/plage-octets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const introuvable = () => NextResponse.json(
  { success: false, error: 'Source introuvable.' }, { status: 404 },
);

const ENTETES = {
  'Content-Disposition': 'inline',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
  'Accept-Ranges': 'bytes',
};

const versWeb = (flux: NodeJS.ReadableStream) => Readable.toWeb(Readable.from(flux)) as ReadableStream;

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const cle = req.nextUrl.searchParams.get('cle');
    if (!cleSourceAvatarDuCompte(cle, userId)) return introuvable();
    const type = typeSourceAvatar(cle);
    if (!type) return introuvable();

    let taille: number;
    try {
      taille = (await clientMinio().statObject(BUCKET_AVATAR, cle)).size;
    } catch {
      return introuvable();
    }
    if (!(taille > 0)) return introuvable();

    const plage = lirePlageOctets(req.headers.get('range'), taille);
    if (plage.sorte === 'insatisfiable') {
      return new NextResponse(null, {
        status: 416,
        headers: { ...ENTETES, 'Content-Type': type, 'Content-Range': enteteContentRangeInsatisfiable(taille), 'Content-Length': '0' },
      });
    }
    if (plage.sorte === 'plage') {
      const morceau = await lecteurMinio().getPartialObject(BUCKET_AVATAR, cle, plage.debut, plage.longueur);
      return new NextResponse(versWeb(morceau), {
        status: 206,
        headers: {
          ...ENTETES,
          'Content-Type': type,
          'Content-Range': enteteContentRange(plage.debut, plage.fin, taille),
          'Content-Length': String(plage.longueur),
        },
      });
    }
    const flux = await lecteurMinio().getObject(BUCKET_AVATAR, cle);
    return new NextResponse(versWeb(flux), {
      status: 200,
      headers: { ...ENTETES, 'Content-Type': type, 'Content-Length': String(taille) },
    });
  } catch (e: unknown) {
    console.error('[Avatar][sources/apercu] lecture impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500 });
  }
}
