/**
 * SERVIR UNE SOURCE D'AVATAR — la réponse HTTP commune aux routes qui relisent
 * une source (photo ou vidéo d'enrôlement) DU COMPTE CONNECTÉ :
 * `/api/avatar/sources/apercu` (éditeur) et
 * `/api/avatars/versions/:id/source` (historique des versions).
 *
 * L'appelant a DÉJÀ vérifié que la clé est une source de CE compte
 * (`cleSourceAvatarDuCompte`). Ici : type décidé par la clé, `nosniff`, CSP
 * vide, jamais en cache partagé, et `Range` honoré (un lecteur vidéo doit
 * pouvoir se positionner). 404 partout où quelque chose manque.
 */
import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { BUCKET_AVATAR, typeSourceAvatar } from '@/lib/avatar/source';
import { clientMinio, lecteurMinio } from '@/lib/storage/minio-client';
import {
  enteteContentRange, enteteContentRangeInsatisfiable, lirePlageOctets,
} from '@/lib/http/plage-octets';

export const sourceIntrouvable = () => NextResponse.json(
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

export async function reponseSourceAvatar(cle: string, range: string | null): Promise<NextResponse> {
  const type = typeSourceAvatar(cle);
  if (!type) return sourceIntrouvable();

  let taille: number;
  try {
    taille = (await clientMinio().statObject(BUCKET_AVATAR, cle)).size;
  } catch {
    return sourceIntrouvable();
  }
  if (!(taille > 0)) return sourceIntrouvable();

  const plage = lirePlageOctets(range, taille);
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
}
