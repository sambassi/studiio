/**
 * CINEMA IA — lire la voix d'un plan, pour son proprietaire seulement.
 * Meme doctrine que `…/medias/[planId]` : la cle se RECALCULE depuis le film
 * (texte + voix), elle ne vient jamais du navigateur.
 */
import { NextRequest } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { sessionCinema } from '@/lib/cinema/routes-aide';
import { idPlanValide } from '@/lib/cinema/acces';
import { cleVoix } from '@/lib/cinema/stockage/cles';
import { reponseIntrouvable, servirObjet } from '@/lib/cinema/stockage/servir';
import { empreinteVoix } from '@/lib/cinema/travaux/apercu';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return reponseIntrouvable();
  if (!idPlanValide(params.planId)) return reponseIntrouvable();
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return reponseIntrouvable();
  const e = empreinteVoix(lu.film, params.planId);
  const cle = e ? cleVoix(s.userId, lu.film.id, params.planId, e) : null;
  return cle ? servirObjet(req, cle, ctx.objets) : reponseIntrouvable();
}
