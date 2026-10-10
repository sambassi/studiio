import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { dependancesParDefaut, ErreurFournisseurStock } from '@/lib/stock/fournisseurs';
import { ErreurImport, importerMediaStock } from '@/lib/stock/importer';

/**
 * Sélection RÉELLE d'un média stock — `POST /api/stock/importer`
 * `{ provider, type, providerAssetId }`.
 *
 * Le corps ne porte JAMAIS d'URL : le serveur relit le média chez le
 * fournisseur par son identifiant. Une vidéo Pexels est rangée dans la
 * Médiathèque de l'utilisateur ; une photo reste servie par le fournisseur
 * (Unsplash : téléchargement signalé, comme l'exigent ses règles).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const STATUT: Record<ErreurImport['code'], number> = {
  invalide: 400, introuvable: 404, trop_lourd: 413, telechargement: 502, hote: 502,
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const corps = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = corps.provider === 'pexels' || corps.provider === 'unsplash' ? corps.provider : null;
  const type = corps.type === 'video' || corps.type === 'photo' ? corps.type : null;
  const providerAssetId = typeof corps.providerAssetId === 'string' ? corps.providerAssetId.trim() : '';
  if (!provider || !type || !providerAssetId) {
    return NextResponse.json({ success: false, error: 'invalide' }, { status: 400 });
  }

  try {
    const { uploadBufferToStorage } = await import('@/lib/storage/upload');
    const r = await importerMediaStock(userId, { provider, type, providerAssetId }, dependancesParDefaut(), {
      televerser: ({ chemin, contenu, contentType }) => uploadBufferToStorage({ buffer: contenu, bucket: 'media', storagePath: chemin, contentType }),
    });
    return NextResponse.json({ success: true, url: r.url, importe: r.importe, media: r.media });
  } catch (e) {
    if (e instanceof ErreurImport) {
      return NextResponse.json({ success: false, error: e.code }, { status: STATUT[e.code] });
    }
    if (e instanceof ErreurFournisseurStock) {
      return NextResponse.json({ success: false, error: e.motif }, { status: e.motif === 'quota' ? 429 : 502 });
    }
    console.error('[stock/importer]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'indisponible' }, { status: 502 });
  }
}
