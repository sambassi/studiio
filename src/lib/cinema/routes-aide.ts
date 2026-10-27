/**
 * CINEMA IA — ce que les routes ont en commun.
 *
 * Les routes `/api/cinema/*` ne sont pas couvertes par le `matcher` du
 * middleware : chacune verifie la session ELLE-MEME. Ces aides le rendent
 * court, donc difficile a oublier.
 */
import path from 'path';
import { randomBytes } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { accesCinemaAutorise, cinemaActive , stockageCinemaUtilisable } from '@/lib/cinema/garde';
import type { Film } from '@/lib/cinema/types';
import { cleMedia, cleReference } from '@/lib/cinema/stockage/cles';
import { fichierDuMedia } from '@/lib/cinema/medias';
import type { ContexteCinema } from '@/lib/cinema/contexte';

/** Un compte ne peut pas remplir le stockage de films : borne par compte. */
export const FILMS_MAX_PAR_COMPTE = 50;

export type SessionCinema = { userId: string } | { refus: NextResponse };

/** 404 si l'interrupteur general est ferme, 401 sans session, et 401 aussi si l'identifiant du compte n'est pas un segment de chemin sain. */
export async function sessionCinema(): Promise<SessionCinema> {
  // Interrupteur ferme, OU stockage non durable en production (les films seraient perdus au
  // prochain remplacement du conteneur) : le module « n'existe pas », meme pour une session valide.
  if (!cinemaActive() || !stockageCinemaUtilisable()) {
    return { refus: NextResponse.json({ ok: false, erreur: 'introuvable' }, { status: 404 }) };
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !accesCinemaAutorise(session?.user)) {
    return { refus: NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 }) };
  }
  return { userId };
}

export const filmInconnu = () => NextResponse.json({ ok: false, erreur: 'film inconnu' }, { status: 404 });

/**
 * Un dossier de travail JETABLE sous `var/cinema/travail/`, efface a la fin
 * quoi qu'il arrive. Les medias PRIVES n'y passent que le temps d'une
 * operation (import mesure par ffprobe, apercu, generation) — jamais `public/`.
 */
export async function avecDossierTemporaire<T>(ctx: Pick<ContexteCinema, 'dossierTravail'>, travail: (racinePublique: string) => Promise<T>): Promise<T> {
  const dossier = path.join(ctx.dossierTravail, `tmp-${randomBytes(6).toString('hex')}`);
  const racinePublique = path.join(dossier, 'public');
  await mkdir(racinePublique, { recursive: true });
  try {
    return await travail(racinePublique);
  } finally {
    // Le chemin est celui que NOUS venons de fabriquer, sous la base : pas de joker.
    await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}

/** Copie les medias (et references) du film depuis le stockage vers `racinePublique`. Rend les manquants. */
export async function materialiserMedias(
  ctx: Pick<ContexteCinema, 'objets'>, proprietaire: string, film: Film, racinePublique: string, planIds?: ReadonlySet<string>,
): Promise<string[]> {
  const manquants: string[] = [];
  for (const scene of film.scenes) for (const plan of scene.plans) {
    if (!plan.media || (planIds && !planIds.has(plan.id))) continue;
    const cle = cleMedia(proprietaire, film.id, plan.media.url);
    if (!cle || !(await ctx.objets.telechargerVers(cle, fichierDuMedia(racinePublique, plan.media.url)))) manquants.push(plan.id);
  }
  return manquants;
}

/** L'objet d'une reference de personnage, ou `null`. */
export function cleReferenceDe(proprietaire: string, film: Film, personnageId: string): string | null {
  const p = film.personnages.find((x) => x.id === personnageId);
  const ref = p?.references.find((r) => r.id === p.referenceActiveId) ?? p?.references.at(-1);
  return ref?.urlImage ? cleReference(proprietaire, film.id, ref.urlImage) : null;
}
