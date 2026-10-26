/**
 * CINEMA IA — liste et creation de films.
 *
 * ⚠️ `/api/cinema/*` n'est PAS couvert par le `matcher` du middleware (qui ne
 * liste que `/dashboard`, `/admin`, `/api/user`, `/api/credits`, `/api/admin`).
 * La session est donc verifiee ICI, dans chaque route, et non deleguee : une
 * route non listee qui fait confiance au middleware est une route ouverte.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { preparerFilm } from '@/lib/cinema/atelier';
import { devisFilm } from '@/lib/cinema/couts';
import { enregistrerFilm, listerFilms } from '@/lib/cinema/store';
import { monterFilm } from '@/lib/cinema/montage';
import type { FormatFilm, NiveauQualite } from '@/lib/cinema/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const racine = () => process.cwd();

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });
  // Les films d'AUTRES comptes ne sont pas listes : l'identifiant d'un film
  // suffirait ensuite a le lire.
  return NextResponse.json({ ok: true, films: await listerFilms(racine(), session.user.id) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });

  const corps = await req.json().catch(() => null);
  const histoire = typeof corps?.histoire === 'string' ? corps.histoire.trim() : '';
  if (histoire.length < 40) {
    return NextResponse.json({ ok: false, erreur: 'histoire trop courte (40 caracteres minimum)' }, { status: 400 });
  }
  const personnages = Array.isArray(corps?.personnages) ? corps.personnages.slice(0, 6) : [];
  if (personnages.length === 0) {
    return NextResponse.json({ ok: false, erreur: 'au moins un personnage est requis' }, { status: 400 });
  }

  const filmSansProprietaire = preparerFilm({
    titre: typeof corps?.titre === 'string' ? corps.titre : null,
    histoire,
    format: (corps?.format === '9:16' ? '9:16' : '16:9') as FormatFilm,
    qualite: (['brouillon', 'standard', 'cinema'].includes(corps?.qualite) ? corps.qualite : 'standard') as NiveauQualite,
    nbScenes: Number.isFinite(corps?.nbScenes) ? Number(corps.nbScenes) : null,
    personnages: personnages.map((p: any) => ({
      nom: String(p?.nom ?? '').slice(0, 40),
      role: String(p?.role ?? '').slice(0, 40),
      description: String(p?.description ?? '').slice(0, 300),
      urlImage: typeof p?.urlImage === 'string' ? p.urlImage : null,
    })).filter((p: { nom: string }) => p.nom.length > 0),
  });

  // Le proprietaire est pose A LA CREATION : c'est lui que GET, PATCH et
  // `produire` compareront a la session.
  const film = { ...filmSansProprietaire, proprietaire: session.user.id };
  await enregistrerFilm(racine(), film);
  return NextResponse.json({
    ok: true,
    film,
    montage: monterFilm(film),
    // Le devis part AVEC la creation : le cout est annonce avant tout rendu.
    devis: devisFilm(film, film.scenes.map((s) => s.id)),
  });
}
