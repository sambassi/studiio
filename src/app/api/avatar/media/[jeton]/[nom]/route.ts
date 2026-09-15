/**
 * GET /api/avatar/media/<jeton>/<nom> — diffuse un objet PRIVÉ du dossier
 * avatar à qui présente un jeton signé et non expiré (`jeton-media.ts`).
 *
 * C'est l'adresse que le fournisseur D-ID reçoit en `source_url` /
 * `audio_url` : pas de session (le fournisseur n'en a pas), mais une
 * signature HMAC liée à LA clé et à une expiration courte. Rien d'autre
 * n'ouvre : un jeton faux, périmé, ou une clé hors du dossier privé →
 * 404, sans détail. Le nom final n'est qu'un suffixe d'extension pour le
 * fournisseur ; la clé vient du jeton, jamais du chemin.
 *
 * Pas de `Range` : les objets font quelques dizaines de Mo au plus.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { clePourJetonMedia } from '@/lib/avatar/jeton-media';
import { typeObjetPriveAvatar, BUCKET_AVATAR } from '@/lib/avatar/source';
import { clientMinio, lecteurMinio } from '@/lib/storage/minio-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const introuvable = () => NextResponse.json({ success: false, error: 'Introuvable.' }, { status: 404 });

const ENTETES = {
  'Content-Disposition': 'inline',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
};

export async function GET(_req: NextRequest, ctx: { params: { jeton: string; nom: string } }) {
  const cle = clePourJetonMedia(ctx.params?.jeton);
  if (!cle) return introuvable();
  // Le nom du chemin doit être celui de l'objet : une URL ne se « renomme » pas.
  if (ctx.params.nom !== cle.slice(cle.lastIndexOf('/') + 1)) return introuvable();
  const type = typeObjetPriveAvatar(cle);
  if (!type) return introuvable();
  try {
    const stat = await clientMinio().statObject(BUCKET_AVATAR, cle);
    if (!stat || stat.size <= 0) return introuvable();
    const flux = await lecteurMinio().getObject(BUCKET_AVATAR, cle);
    return new NextResponse(Readable.toWeb(Readable.from(flux)) as ReadableStream, {
      status: 200,
      headers: { ...ENTETES, 'Content-Type': type, 'Content-Length': String(stat.size) },
    });
  } catch {
    return introuvable();
  }
}

export async function HEAD(req: NextRequest, ctx: { params: { jeton: string; nom: string } }) {
  const cle = clePourJetonMedia(ctx.params?.jeton);
  if (!cle || ctx.params.nom !== cle.slice(cle.lastIndexOf('/') + 1)) return new NextResponse(null, { status: 404 });
  const type = typeObjetPriveAvatar(cle);
  if (!type) return new NextResponse(null, { status: 404 });
  void req;
  try {
    const stat = await clientMinio().statObject(BUCKET_AVATAR, cle);
    if (!stat || stat.size <= 0) return new NextResponse(null, { status: 404 });
    return new NextResponse(null, { status: 200, headers: { ...ENTETES, 'Content-Type': type, 'Content-Length': String(stat.size) } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
