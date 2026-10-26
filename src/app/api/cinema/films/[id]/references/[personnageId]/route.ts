/** CINEMA IA — lire l'image de reference active d'un personnage, pour son proprietaire. */
import { NextRequest } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { cleReferenceDe, sessionCinema } from '@/lib/cinema/routes-aide';
import { reponseIntrouvable, servirObjet } from '@/lib/cinema/stockage/servir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string; personnageId: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return reponseIntrouvable();
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return reponseIntrouvable();
  const cle = cleReferenceDe(s.userId, lu.film, params.personnageId);
  return cle ? servirObjet(req, cle, ctx.objets) : reponseIntrouvable();
}
