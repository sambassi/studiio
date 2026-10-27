/**
 * CINEMA IA — lire le media d'un plan, pour son proprietaire seulement.
 *
 * Le navigateur nomme un film et un plan ; la CLE est lue dans le film, en
 * base, sous le proprietaire de la session. Aucune cle, aucun compartiment,
 * aucun chemin ne peut entrer. 404 partout : film d'autrui, plan sans media,
 * objet absent — une seule reponse.
 */
import { NextRequest } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { sessionCinema } from '@/lib/cinema/routes-aide';
import { idPlanValide } from '@/lib/cinema/acces';
import { cleMedia } from '@/lib/cinema/stockage/cles';
import { reponseIntrouvable, servirObjet } from '@/lib/cinema/stockage/servir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return reponseIntrouvable();
  if (!idPlanValide(params.planId)) return reponseIntrouvable();
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  const media = lu?.film.scenes.flatMap((x) => x.plans).find((p) => p.id === params.planId)?.media;
  if (!lu || !media) return reponseIntrouvable();
  const cle = cleMedia(s.userId, lu.film.id, media.url);
  return cle ? servirObjet(req, cle, ctx.objets) : reponseIntrouvable();
}
