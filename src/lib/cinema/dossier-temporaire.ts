/**
 * Un dossier de travail JETABLE sous `var/cinema/travail/`, efface a la fin quoi qu'il
 * arrive. Les medias PRIVES n'y passent que le temps d'une operation (import mesure par
 * ffprobe, apercu, generation, reprise) — jamais `public/`.
 *
 * Module sans dependance a la session ni a Next : utilisable hors requete HTTP (executeur,
 * reprise apres arret).
 */
import path from 'path';
import { randomBytes } from 'crypto';
import { mkdir, rm } from 'fs/promises';

export async function avecDossierTemporaire<T>(ctx: { dossierTravail: string }, travail: (racinePublique: string) => Promise<T>): Promise<T> {
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
