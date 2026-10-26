/**
 * CINEMA IA — ce qu'une production COUTERAIT, et si le serveur l'autorise.
 *
 * Partage par la route (refus immediat, avant de creer un travail) et par
 * l'executeur (re-verification avant le premier octet de travail : le film a
 * pu changer entre-temps). Le PLAFOND vient du serveur, jamais d'une requete.
 *
 * Un tarif inconnu est REFUSE : `verifierPlafond` ne traite jamais `null`
 * comme zero.
 */
import type { Film } from '@/lib/cinema/types';
import { empreinteScene } from '@/lib/cinema/empreinte';
import { coutPaye, devisFilm, type DevisFilm } from '@/lib/cinema/couts';
import { verifierPlafond, type VerificationPlafond } from '@/lib/cinema/generation/couts';
import { cleScene } from '@/lib/cinema/stockage/cles';
import type { StockageObjets } from '@/lib/cinema/stockage/objets';

export interface EvaluationProduction {
  /** Scenes a (re)rendre : objet absent pour l'empreinte COURANTE, ou demandees. */
  aProduire: string[];
  /** Scenes dont le MP4 existe deja pour cette empreinte : rien n'est recalcule. */
  reutilisees: string[];
  devis: DevisFilm;
  verification: VerificationPlafond;
}

export async function evaluerProduction(args: {
  film: Film; proprietaire: string; objets: StockageObjets; demandees: readonly string[]; plafondUsd: number;
}): Promise<EvaluationProduction> {
  const { film, proprietaire, objets } = args;
  const demandees = new Set(args.demandees);
  const aProduire: string[] = [];
  const reutilisees: string[] = [];
  for (const s of film.scenes) {
    const cle = cleScene(proprietaire, film.id, s.id, empreinteScene(s, film.personnages));
    if (!cle) throw new Error(`cle de scene refusee (${s.id})`);
    // Pas d'objet = pas de film, quoi que dise le champ `empreinte` de la scene.
    const present = await objets.existe(cle);
    if (!present || demandees.has(s.id)) aProduire.push(s.id); else reutilisees.push(s.id);
  }
  const devis = devisFilm(film, aProduire);
  const verification = verifierPlafond({
    dejaDepenseUsd: (film.coutGenerationUsd ?? 0) + coutPaye(film),
    coutProposeUsd: devis.totalUsd,
    plafondUsd: args.plafondUsd,
  });
  return { aProduire, reutilisees, devis, verification };
}
