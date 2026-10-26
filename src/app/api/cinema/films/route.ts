/**
 * CINEMA IA — liste et creation de films.
 *
 * ⚠️ `/api/cinema/*` n'est PAS couvert par le `matcher` du middleware : la
 * session est verifiee ICI, dans chaque route, et non deleguee.
 */
import { NextRequest, NextResponse } from 'next/server';
import { preparerFilm } from '@/lib/cinema/atelier';
import { devisFilm } from '@/lib/cinema/couts';
import { monterFilm } from '@/lib/cinema/montage';
import { contexteCinema } from '@/lib/cinema/contexte';
import { FILMS_MAX_PAR_COMPTE, sessionCinema } from '@/lib/cinema/routes-aide';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import type { FormatFilm, NiveauQualite } from '@/lib/cinema/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  // Les films d'AUTRES comptes ne sont pas listes : l'identifiant d'un film
  // suffirait ensuite a le lire.
  return NextResponse.json({ ok: true, films: await contexteCinema().films.lister(s.userId) });
}

export async function POST(req: NextRequest) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();

  const corps = await req.json().catch(() => null);
  const histoire = typeof corps?.histoire === 'string' ? corps.histoire.trim() : '';
  if (histoire.length < 40) {
    return NextResponse.json({ ok: false, erreur: 'histoire trop courte (40 caracteres minimum)' }, { status: 400 });
  }
  if (histoire.length > 20_000) {
    return NextResponse.json({ ok: false, erreur: 'histoire trop longue (20 000 caracteres maximum)' }, { status: 400 });
  }
  const personnages = Array.isArray(corps?.personnages) ? corps.personnages.slice(0, 6) : [];
  if (personnages.length === 0) {
    return NextResponse.json({ ok: false, erreur: 'au moins un personnage est requis' }, { status: 400 });
  }
  if ((await ctx.films.lister(s.userId)).length >= FILMS_MAX_PAR_COMPTE) {
    return NextResponse.json({ ok: false, erreur: `${FILMS_MAX_PAR_COMPTE} films maximum par compte` }, { status: 409 });
  }

  const film = preparerFilm({
    titre: typeof corps?.titre === 'string' ? corps.titre : null,
    histoire,
    format: (corps?.format === '9:16' ? '9:16' : '16:9') as FormatFilm,
    qualite: (['brouillon', 'standard', 'cinema'].includes(corps?.qualite) ? corps.qualite : 'standard') as NiveauQualite,
    nbScenes: Number.isFinite(corps?.nbScenes) ? Number(corps.nbScenes) : null,
    personnages: personnages.map((p: any) => ({
      nom: String(p?.nom ?? '').slice(0, 40),
      role: String(p?.role ?? '').slice(0, 40),
      description: String(p?.description ?? '').slice(0, 300),
      // Aucune adresse libre a la creation : l'image d'un personnage
      // s'importe ensuite par POST …/references.
      urlImage: null,
    })).filter((p: { nom: string }) => p.nom.length > 0),
  });

  // Le proprietaire est pose par le DEPOT, a partir de la session.
  const r = await ctx.films.creer(film, s.userId);
  if (!r.ok) return NextResponse.json({ ok: false, erreur: 'creation impossible, reessayez' }, { status: 409 });
  const cree = { ...film, proprietaire: s.userId };
  return NextResponse.json({
    ok: true,
    film: cree,
    montage: presenterMontage(monterFilm(cree), cree.id),
    // Le devis part AVEC la creation : le cout est annonce avant tout rendu.
    devis: devisFilm(cree, cree.scenes.map((x) => x.id)),
  });
}
