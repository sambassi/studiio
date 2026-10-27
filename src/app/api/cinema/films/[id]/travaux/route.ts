/** CINEMA IA — le dernier travail de production d'un film (actif, sinon le plus recent). */
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema, dependancesExecuteur } from '@/lib/cinema/contexte';
import { filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { presenterTravail } from '@/lib/cinema/travaux/types';
import { reprendreOrphelins } from '@/lib/cinema/travaux/lanceur';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  if (!(await ctx.films.lire(params.id, s.userId))) return filmInconnu();
  reprendreOrphelins(ctx.travaux, () => dependancesExecuteur(ctx)).catch(() => {});
  const t = await ctx.travaux.dernierDuFilm(params.id, s.userId);
  return NextResponse.json({ ok: true, travail: t ? presenterTravail(t) : null });
}
