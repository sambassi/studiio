/**
 * CINEMA IA — demander l'arret d'un travail.
 * En attente : annule tout de suite. En cours : l'executeur s'arrete a la
 * prochaine note de progression ; les scenes deja rendues RESTENT durables et
 * un nouveau travail les reprend sans les refaire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { sessionCinema } from '@/lib/cinema/routes-aide';
import { presenterTravail } from '@/lib/cinema/travaux/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: { params: { id: string; travailId: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  if (!UUID.test(params.travailId)) return NextResponse.json({ ok: false, erreur: 'travail inconnu' }, { status: 404 });
  const ctx = contexteCinema();
  const t = await ctx.travaux.demanderAnnulation(params.travailId, s.userId);
  if (!t || t.filmId !== params.id) return NextResponse.json({ ok: false, erreur: 'travail inconnu' }, { status: 404 });
  return NextResponse.json({ ok: true, travail: presenterTravail(t) });
}
