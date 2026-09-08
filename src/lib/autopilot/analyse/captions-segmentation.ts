/**
 * A_4b — DÉCOUPER LA PAROLE EN BLOCS LISIBLES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UNE TRANSCRIPTION N'EST PAS UN SOUS-TITRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Poser trente secondes de parole en un bloc donne un mur de texte que
 * personne ne lit. Découper tous les N mots donne « je vais vous / montrer »
 * — une coupe au milieu d'un groupe, qui oblige à relire.
 *
 * Ce module coupe donc PAR PRIORITÉ :
 *
 *   1. la ponctuation forte  (. ! ? …)     — une phrase finit
 *   2. la ponctuation faible (, ; :)        — un souffle
 *   3. une PAUSE réelle entre deux mots     — la personne s'est arrêtée
 *   4. la longueur maximale du style        — le dernier recours
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ET IL NE COUPE JAMAIS À TRAVERS DEUX PLANS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un bloc à cheval sur une coupe afficherait, sur la seconde image, des mots
 * dits dans un autre plan. Chaque bloc appartient donc à UN plan.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UNE SEULE PISTE, UN SEUL BLOC À LA FOIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A_4a laisse volontairement les mots de deux plans se chevaucher pendant une
 * transition, pour ne perdre aucune parole. C'est ICI que le conflit se
 * résout : un bloc ne commence jamais avant la fin du précédent. Deux blocs
 * superposés seraient deux phrases l'une sur l'autre, illisibles toutes les
 * deux.
 *
 * MODULE PUR.
 */
import type { MotMonte } from './captions-timeline';

/** Au-delà, ce n'est plus une respiration, c'est un silence. */
export const PAUSE_SECONDES = 0.35;
/** Un bloc plus court que ça n'a pas le temps d'être lu. */
export const BLOC_MIN_SECONDES = 0.5;
/** Au-delà, un bloc reste trop longtemps figé à l'écran. */
export const BLOC_MAX_SECONDES = 6;

/** Un bloc de sous-titre : ce qui s'affiche d'un coup. */
export interface BlocCaption {
  mots: readonly MotMonte[];
  debutSecondes: number;
  finSecondes: number;
  ordrePlan: number;
}

const PONCTUATION_FORTE = /[.!?…]["'»)\]]*$/u;
const PONCTUATION_FAIBLE = /[,;:]["'»)\]]*$/u;

const arrondir = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Les blocs, dans l'ordre du montage.
 *
 * `motsMax` vient du style : deux mots pour une grosse caption plein écran,
 * neuf pour un sous-titre de film.
 */
export function decouperEnBlocs(
  mots: readonly MotMonte[], motsMax: number,
): BlocCaption[] {
  const plafond = Math.max(1, Math.round(motsMax));
  const blocs: BlocCaption[] = [];
  let courant: MotMonte[] = [];

  const fermer = () => {
    if (courant.length === 0) return;
    blocs.push({
      mots: courant,
      debutSecondes: courant[0].debutSecondes,
      finSecondes: courant[courant.length - 1].finSecondes,
      ordrePlan: courant[0].ordrePlan,
    });
    courant = [];
  };

  for (const m of mots) {
    const precedent = courant[courant.length - 1];
    if (precedent) {
      // ⚠️ UN BLOC N'ENJAMBE JAMAIS DEUX PLANS.
      if (m.ordrePlan !== precedent.ordrePlan) fermer();
      else if (m.debutSecondes - precedent.finSecondes >= PAUSE_SECONDES) fermer();
      else if (m.debutSecondes - courant[0].debutSecondes >= BLOC_MAX_SECONDES) fermer();
    }
    courant.push(m);

    const texte = m.texte;
    if (PONCTUATION_FORTE.test(texte)) { fermer(); continue; }
    if (courant.length >= plafond) { fermer(); continue; }
    /* Une virgule ne ferme QUE si le bloc est déjà bien rempli : couper à
       « Bonjour, » laisserait un bloc d'un mot suivi d'un bloc plein, et le
       rythme de lecture sauterait. */
    if (PONCTUATION_FAIBLE.test(texte) && courant.length >= Math.ceil(plafond / 2)) {
      fermer();
    }
  }
  fermer();

  return resoudreChevauchements(blocs);
}

/**
 * ⚠️ UN SEUL BLOC À LA FOIS, ET C'EST ICI QUE ÇA SE DÉCIDE.
 *
 * Pendant une transition, deux plans parlent : leurs blocs se chevauchent
 * dans le temps. Le bloc entrant commence donc à la fin du précédent, et un
 * bloc qui n'aurait plus le temps d'être lu est retiré plutôt que de
 * clignoter — sa parole reste dans le fichier, elle n'est simplement pas
 * réaffichée par-dessus une autre.
 */
function resoudreChevauchements(blocs: readonly BlocCaption[]): BlocCaption[] {
  const sortie: BlocCaption[] = [];
  for (const b of blocs) {
    const dernier = sortie[sortie.length - 1];
    const debut = dernier ? Math.max(b.debutSecondes, dernier.finSecondes) : b.debutSecondes;
    if (!(b.finSecondes - debut >= BLOC_MIN_SECONDES)) {
      // Trop court une fois recalé : on ne l'affiche pas.
      if (!dernier || b.finSecondes <= dernier.finSecondes + 1e-9) continue;
    }
    sortie.push({
      ...b,
      debutSecondes: arrondir(debut),
      finSecondes: arrondir(Math.max(debut, b.finSecondes)),
    });
  }
  return sortie;
}

/**
 * Le texte d'un bloc, mis en forme.
 *
 * ⚠️ LA CASSE EST UNE TRANSFORMATION D'AFFICHAGE. Le texte SOURCE n'est
 * jamais réécrit : c'est la transcription de ce qui a été dit, et la mettre
 * en majuscules en base la rendrait fausse pour tout le reste.
 */
export function texteBloc(
  bloc: BlocCaption, casse: 'normale' | 'majuscules',
): string {
  const brut = bloc.mots.map((m) => m.texte).join(' ');
  return casse === 'majuscules' ? brut.toLocaleUpperCase('fr') : brut;
}

/**
 * Où couper en deux lignes — après le mot qui équilibre le mieux.
 *
 * ⚠️ ÉQUILIBRÉ, PAS « LA MOITIÉ DES MOTS ». « Je vais vous montrer comment »
 * coupé après trois mots donne deux lignes de largeurs très différentes ;
 * l'équilibre se mesure en CARACTÈRES, ce qui approche la largeur réelle sans
 * avoir à mesurer la police.
 */
export function couperEnLignes(
  texte: string, lignesMax: 1 | 2, caracteresParLigne: number,
): string[] {
  if (lignesMax === 1 || texte.length <= caracteresParLigne) return [texte];
  const mots = texte.split(' ');
  if (mots.length < 2) return [texte];

  let meilleur = 1;
  let ecartMin = Number.POSITIVE_INFINITY;
  for (let i = 1; i < mots.length; i += 1) {
    const a = mots.slice(0, i).join(' ').length;
    const b = mots.slice(i).join(' ').length;
    const ecart = Math.abs(a - b);
    if (ecart < ecartMin) { ecartMin = ecart; meilleur = i; }
  }
  return [mots.slice(0, meilleur).join(' '), mots.slice(meilleur).join(' ')];
}
