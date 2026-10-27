/**
 * CINEMA IA — l'etat REEL d'un travail (progression, scenes, resultat).
 *
 * Interrogee en boucle par l'ecran. Elle ne rend ni cle d'objet ni chemin du
 * serveur (`presenterTravail`). A chaque lecture, elle relance ce qu'un
 * redemarrage a laisse sans executeur (espacement de 30 s par processus).
 */
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema, dependancesExecuteur } from '@/lib/cinema/contexte';
import { sessionCinema } from '@/lib/cinema/routes-aide';
import { presenterTravail } from '@/lib/cinema/travaux/types';
import { reprendreOrphelins } from '@/lib/cinema/travaux/lanceur';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: { id: string; travailId: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  if (!UUID.test(params.travailId)) return NextResponse.json({ ok: false, erreur: 'travail inconnu' }, { status: 404 });
  const ctx = contexteCinema();
  const t = await ctx.travaux.lire(params.travailId, s.userId);
  if (!t || t.filmId !== params.id) return NextResponse.json({ ok: false, erreur: 'travail inconnu' }, { status: 404 });
  reprendreOrphelins(ctx.travaux, () => dependancesExecuteur(ctx)).catch(() => {});
  return NextResponse.json({ ok: true, travail: presenterTravail(t) });
}
