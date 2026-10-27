/**
 * CINEMA IA — lire le MP4 d'un travail termine, pour son proprietaire.
 * La cle est LUE dans la ligne du travail (sous le proprietaire de la
 * session) : le navigateur ne nomme qu'un film et un travail.
 */
import { NextRequest } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { sessionCinema } from '@/lib/cinema/routes-aide';
import { cleFilmMp4 } from '@/lib/cinema/stockage/cles';
import { reponseIntrouvable, servirObjet } from '@/lib/cinema/stockage/servir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string; travailId: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return reponseIntrouvable();
  if (!UUID.test(params.travailId)) return reponseIntrouvable();
  const ctx = contexteCinema();
  const t = await ctx.travaux.lire(params.travailId, s.userId);
  if (!t || t.filmId !== params.id || t.statut !== 'termine' || !t.resultat?.cleMp4) return reponseIntrouvable();
  // La cle de la base doit etre une cle de film de CE compte et de CE film,
  // meme si la ligne avait ete alteree : on la refabrique a partir de ses parties.
  const m = /^[^/]+\/cinema\/[^/]+\/exports\/film-([0-9a-f]{8})\.mp4$/.exec(t.resultat.cleMp4);
  const cle = m ? cleFilmMp4(s.userId, t.filmId, m[1]) : null;
  if (!cle || cle !== t.resultat.cleMp4) return reponseIntrouvable();
  return servirObjet(req, cle, ctx.objets);
}
