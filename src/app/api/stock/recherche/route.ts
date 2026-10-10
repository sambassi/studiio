import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { searchStockMedia } from '@/lib/stock/service';
import type { FormatStock, FournisseurStock, TypeStock } from '@/lib/stock/types';

/**
 * Recherche STOCK commune (Créer + Autopilote) —
 * `GET /api/stock/recherche?requete&type=photo|video&format=9:16|16:9|1:1&fournisseurs=pexels,unsplash&page`.
 *
 * Métadonnées et vignettes seulement : aucun fichier HD n'est téléchargé ici.
 * Un fournisseur en panne figure dans `echecs`, jamais en erreur HTTP : le
 * stock reste un complément. La route historique `/api/pexels` (recherche
 * manuelle de photos) est inchangée.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORMATS: FormatStock[] = ['9:16', '16:9', '1:1'];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const p = new URL(req.url).searchParams;
  const requete = (p.get('requete') || '').trim();
  if (!requete) return NextResponse.json({ success: false, error: 'requete_vide' }, { status: 400 });
  const type: TypeStock = p.get('type') === 'video' ? 'video' : 'photo';
  const formatBrut = p.get('format') as FormatStock | null;
  const format: FormatStock = formatBrut && FORMATS.includes(formatBrut) ? formatBrut : '9:16';
  const fournisseurs = (p.get('fournisseurs') || '')
    .split(',')
    .filter((f): f is FournisseurStock => f === 'pexels' || f === 'unsplash');
  const page = Math.max(1, Math.min(20, parseInt(p.get('page') || '1', 10) || 1));

  const r = await searchStockMedia({ requete, type, format, fournisseurs, page, parPage: 12 });
  return NextResponse.json({ success: true, ...r });
}
