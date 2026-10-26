/**
 * CINEMA IA — SUPPRIMER UN FILM, sans jamais toucher a autre chose.
 *
 * Un film possede, dans MinIO, UN dossier : `<compte>/cinema/<film>/`
 * (medias importes, references, voix, MP4 de scene, MP4 final). Les medias ne
 * sont jamais partages entre films — l'import COPIE — donc tout ce qui est
 * sous ce dossier est a ce film, et rien d'autre ne l'est.
 *
 * Les garde-fous, dans l'ordre :
 *   1. le film doit exister ET appartenir au compte (sinon `inconnu`, la meme
 *      reponse qu'un film d'autrui) ;
 *   2. un travail actif refuse la suppression (`travail_en_cours`) : on ne
 *      detruit pas les fichiers qu'un rendu est en train d'ecrire ;
 *   3. le prefixe est fabrique par `prefixeFilm` (jamais fourni par le client)
 *      et le port refuse tout prefixe qui n'est pas « un dossier de film » ;
 *   4. chaque cle listee est RE-VERIFIEE (`cleDuCompteStrict` + prefixe) avant
 *      d'etre supprimee ; une cle etrangere est ignoree et comptee, jamais effacee ;
 *   5. la ligne du film part EN DERNIER : si un objet ne se supprime pas, le
 *      film reste et l'operation se rejoue (elle est idempotente). L'inverse
 *      laisserait des objets orphelins que plus rien ne designe.
 */
import { cleDuCompteStrict } from '@/lib/storage/acces-objet';
import { prefixeFilm } from '@/lib/cinema/stockage/cles';
import type { ContexteCinema } from '@/lib/cinema/contexte';

export type ResultatSuppression =
  | { ok: true; objetsSupprimes: number; objetsIgnores: number }
  | { ok: false; motif: 'inconnu' | 'travail_en_cours' | 'echec_stockage'; objetsSupprimes?: number };

export async function supprimerFilm(
  ctx: Pick<ContexteCinema, 'films' | 'travaux' | 'objets'>, proprietaire: string, filmId: string,
): Promise<ResultatSuppression> {
  const prefixe = prefixeFilm(proprietaire, filmId);
  if (!prefixe) return { ok: false, motif: 'inconnu' };
  if (!(await ctx.films.lire(filmId, proprietaire))) return { ok: false, motif: 'inconnu' };

  const dernier = await ctx.travaux.dernierDuFilm(filmId, proprietaire);
  if (dernier && (dernier.statut === 'en_attente' || dernier.statut === 'en_cours')) {
    return { ok: false, motif: 'travail_en_cours' };
  }

  let supprimes = 0;
  let ignores = 0;
  try {
    for (const cle of await ctx.objets.lister(prefixe)) {
      if (!cle.startsWith(prefixe) || !cleDuCompteStrict(cle, proprietaire)) { ignores += 1; continue; }
      await ctx.objets.supprimer(cle);
      supprimes += 1;
    }
  } catch (e) {
    console.error('[cinema] suppression : echec de stockage', e instanceof Error ? e.message : e);
    return { ok: false, motif: 'echec_stockage', objetsSupprimes: supprimes };
  }

  await ctx.travaux.oublierDuFilm(filmId, proprietaire);
  await ctx.films.supprimer(filmId, proprietaire);
  return { ok: true, objetsSupprimes: supprimes, objetsIgnores: ignores };
}
