/**
 * CINEMA IA — importer un media (image ou video) sur un plan.
 *
 * La route recoit des OCTETS, jamais une URL. Le fichier est ecrit dans un
 * dossier de travail jetable, MESURE par ffprobe, puis depose dans le
 * stockage prive du compte (`<compte>/cinema/<film>/medias/…`). Il ne passe
 * jamais par `public/`.
 */
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { importerMedia, remplacerMedia, fichierDuMedia, TAILLE_MAX_MEDIA } from '@/lib/cinema/medias';
import { monterFilm } from '@/lib/cinema/montage';
import { scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm } from '@/lib/cinema/couts';
import { contexteCinema } from '@/lib/cinema/contexte';
import { avecDossierTemporaire, filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { cleMedia } from '@/lib/cinema/stockage/cles';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { typeContenuDepuisCle } from '@/lib/storage/acces-objet';
import type { Film } from '@/lib/cinema/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return filmInconnu();

  // ⚠️ LA TAILLE EST REFUSEE AVANT D'ETRE LUE. `req.formData()` charge tout le
  // corps en memoire : verifier APRES, c'est avoir deja accepte les octets.
  const annonce = req.headers.get('content-length');
  const octetsAnnonces = annonce === null ? null : Number(annonce);
  if (octetsAnnonces === null || !Number.isFinite(octetsAnnonces)) {
    return NextResponse.json({ ok: false, erreur: 'taille du corps non annoncee' }, { status: 411 });
  }
  if (octetsAnnonces > TAILLE_MAX_MEDIA + 64 * 1024) {
    return NextResponse.json({ ok: false, erreur: 'fichier trop volumineux (200 Mo maximum)' }, { status: 413 });
  }

  let formulaire: FormData;
  try { formulaire = await req.formData(); }
  catch { return NextResponse.json({ ok: false, erreur: 'corps multipart attendu' }, { status: 400 }); }

  const planId = formulaire.get('planId');
  const fichier = formulaire.get('fichier');
  if (typeof planId !== 'string' || !(fichier instanceof File)) {
    return NextResponse.json({ ok: false, erreur: 'planId et fichier sont requis' }, { status: 400 });
  }
  if (fichier.size > TAILLE_MAX_MEDIA) {
    return NextResponse.json({ ok: false, erreur: 'fichier trop volumineux (200 Mo maximum)' }, { status: 413 });
  }

  const ancienneUrl = lu.film.scenes.flatMap((x) => x.plans).find((p) => p.id === planId)?.media?.url ?? null;

  const resultat = await avecDossierTemporaire(ctx, async (racinePublique) => {
    const r = await importerMedia({
      film: lu.film, planId,
      // `basename` : un nom de fichier qui porterait un chemin ne sert qu'a en sortir.
      nomOrigine: path.basename(fichier.name || 'media'),
      donnees: Buffer.from(await fichier.arrayBuffer()),
      racinePublique,
    });
    if (!r.ok) return r;
    const cle = cleMedia(s.userId, lu.film.id, r.media.url);
    if (!cle) return { ok: false as const, erreur: 'chemin de media refuse' };
    await ctx.objets.deposerFichier(cle, fichierDuMedia(racinePublique, r.media.url), typeContenuDepuisCle(cle));
    return r;
  });
  if (!resultat.ok) return NextResponse.json({ ok: false, erreur: resultat.erreur }, { status: 400 });

  let film: Film | null;
  try {
    film = await modifierFilm(ctx.films, params.id, s.userId, (f) => remplacerMedia(f, planId, resultat.media));
  } catch { film = null; }
  if (!film) {
    // Le film a disparu ou ne se laisse pas ecrire : l'objet depose n'a plus de proprietaire.
    const cle = cleMedia(s.userId, params.id, resultat.media.url);
    if (cle) await ctx.objets.supprimer(cle).catch(() => {});
    return NextResponse.json({ ok: false, erreur: 'film modifie en parallele, reessayez' }, { status: 409 });
  }

  // L'ancien media n'est plus designe par aucun plan : on le retire du stockage.
  if (ancienneUrl && ancienneUrl !== resultat.media.url && !film.scenes.some((x) => x.plans.some((p) => p.media?.url === ancienneUrl))) {
    const ancienne = cleMedia(s.userId, params.id, ancienneUrl);
    if (ancienne) await ctx.objets.supprimer(ancienne).catch(() => {});
  }

  const aProduire = scenesAReproduire(film).map((x) => x.id);
  return NextResponse.json({
    ok: true,
    media: { ...resultat.media, url: undefined },
    film,
    montage: presenterMontage(monterFilm(film), film.id),
    scenesAProduire: aProduire,
    devis: devisFilm(film, aProduire),
  });
}
