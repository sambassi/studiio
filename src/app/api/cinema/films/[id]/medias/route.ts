/**
 * CINEMA IA — importer le media d'un plan (image ou video LOCALE).
 *
 * C'est la SEULE porte d'entree d'un media. Elle recoit des OCTETS, pas une
 * URL : rien de ce que l'appelant envoie ne devient une adresse que le
 * serveur ira chercher. Le fichier est ecrit, puis MESURE par ffprobe ; s'il
 * n'est pas lisible, il est efface et refuse.
 *
 * ⚠️ Pourquoi pas `/api/upload` ni `lib/storage` : ils televersent vers MinIO
 * / le stockage distant et supposent des variables d'environnement de
 * production. Cinema IA est encore local : son media doit etre un fichier que
 * Remotion peut lire sans credential, sous `public/cinema/<film>/medias/`.
 * Le jour du passage en service, c'est cette route-la qui deleguera au
 * stockage du depot — un seul endroit a changer.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { auth } from '@/lib/auth/config';
import { appartientA } from '@/lib/cinema/acces';
import { lireFilm, enregistrerFilm } from '@/lib/cinema/store';
import { importerMedia, TAILLE_MAX_MEDIA } from '@/lib/cinema/medias';
import { monterFilm } from '@/lib/cinema/montage';
import { scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm } from '@/lib/cinema/couts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });

  const racine = process.cwd();
  const film = await lireFilm(racine, params.id);
  if (!film || !appartientA(film, session.user.id)) {
    return NextResponse.json({ ok: false, erreur: 'film inconnu' }, { status: 404 });
  }

  let formulaire: FormData;
  try {
    formulaire = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, erreur: 'corps multipart attendu' }, { status: 400 });
  }

  const planId = formulaire.get('planId');
  const fichier = formulaire.get('fichier');
  if (typeof planId !== 'string' || !(fichier instanceof File)) {
    return NextResponse.json({ ok: false, erreur: 'planId et fichier sont requis' }, { status: 400 });
  }
  // La taille est verifiee AVANT de tout charger en memoire.
  if (fichier.size > TAILLE_MAX_MEDIA) {
    return NextResponse.json({ ok: false, erreur: 'fichier trop volumineux (200 Mo maximum)' }, { status: 413 });
  }

  const resultat = await importerMedia({
    film,
    planId,
    // `basename` : un nom de fichier qui porterait un chemin ne sert qu'a en
    // sortir. Seule l'extension sera reprise de toute façon.
    nomOrigine: path.basename(fichier.name || 'media'),
    donnees: Buffer.from(await fichier.arrayBuffer()),
    racinePublique: path.join(racine, 'public'),
  });

  if (!resultat.ok) return NextResponse.json({ ok: false, erreur: resultat.erreur }, { status: 400 });

  await enregistrerFilm(racine, resultat.film);
  const aProduire = scenesAReproduire(resultat.film).map((s) => s.id);
  return NextResponse.json({
    ok: true,
    media: resultat.media,
    film: resultat.film,
    montage: monterFilm(resultat.film),
    scenesAProduire: aProduire,
    devis: devisFilm(resultat.film, aProduire),
  });
}
