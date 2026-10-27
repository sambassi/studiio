/**
 * CINEMA IA — lecture et modification d'un film (scenes, repliques, casting).
 *
 * Le PATCH ne prend que ce qui a un sens d'etre modifie a la main. Il ne
 * recalcule RIEN : les empreintes diront d'elles-memes quelles scenes doivent
 * etre reproduites. Il s'applique SOUS CONTROLE DE VERSION : si un rendu a
 * scelle des scenes entre la lecture et l'ecriture, la modification est
 * rejouee sur le film le plus recent (`modifierFilm`), jamais ecrasee.
 */
import { NextRequest, NextResponse } from 'next/server';
import { monterFilm } from '@/lib/cinema/montage';
import { scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm } from '@/lib/cinema/couts';
import { contexteCinema, dependancesExecuteur } from '@/lib/cinema/contexte';
import { filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { supprimerFilm } from '@/lib/cinema/stockage/suppression';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { appliquerPatch, erreurPatch } from '@/lib/cinema/patch';
import { reprendreOrphelins } from '@/lib/cinema/travaux/lanceur';
import type { Film } from '@/lib/cinema/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function reponse(film: Film) {
  const aProduire = scenesAReproduire(film).map((s) => s.id);
  return NextResponse.json({
    ok: true,
    film,
    montage: presenterMontage(monterFilm(film), film.id),
    scenesAProduire: aProduire,
    devis: devisFilm(film, aProduire),
  });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  // Un film qui ne lui appartient pas rend « inconnu », pas « interdit ».
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return filmInconnu();
  // Rouvrir un film est l'occasion de relancer ce qu'un redemarrage a laisse en plan.
  reprendreOrphelins(ctx.travaux, () => dependancesExecuteur(ctx)).catch(() => {});
  return reponse(lu.film);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  if (!(await ctx.films.lire(params.id, s.userId))) return filmInconnu();

  const corps = await req.json().catch(() => null);
  const refus = erreurPatch(corps);
  if (refus) return NextResponse.json({ ok: false, erreur: refus }, { status: 400 });

  let suivant: Film | null;
  try {
    suivant = await modifierFilm(ctx.films, params.id, s.userId, (f) => appliquerPatch(f, corps));
  } catch {
    return NextResponse.json({ ok: false, erreur: 'film modifie en parallele, reessayez' }, { status: 409 });
  }
  if (!suivant) return filmInconnu();
  return reponse(suivant);
}

/**
 * Supprime le film ET ses objets prives (voir `stockage/suppression.ts`).
 * 404 si le film n'est pas a ce compte, 409 tant qu'un rendu est actif,
 * 502 si le stockage a refuse (le film reste, on peut rejouer).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const r = await supprimerFilm(contexteCinema(), s.userId, params.id);
  if (r.ok) return NextResponse.json({ ok: true, objetsSupprimes: r.objetsSupprimes });
  if (r.motif === 'inconnu') return filmInconnu();
  if (r.motif === 'travail_en_cours') {
    return NextResponse.json({ ok: false, erreur: 'un rendu est en cours : arretez-le avant de supprimer le film' }, { status: 409 });
  }
  return NextResponse.json({ ok: false, erreur: 'le stockage n\'a pas pu supprimer tous les fichiers ; le film est conserve, reessayez' }, { status: 502 });
}
