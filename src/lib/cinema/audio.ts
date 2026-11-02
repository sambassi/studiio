/**
 * CINEMA IA — QUI LIT QUOI : la regle de voix, pure (aucun acces disque ni reseau).
 *
 * Isolee de `voix.ts` (qui ecrit des fichiers cote serveur) pour que le montage et l'ecran puissent
 * l'appeler aussi : une seule regle decide, partout, de ce qui est lu et de ce qui reste muet.
 */
import type { Film, PlanCinema } from '@/lib/cinema/types';
import { VOIX_NARRATEUR } from '@/lib/cinema/personnages';
import { locuteurAmbigu } from '@/lib/cinema/fidelite';

/**
 * QUI PARLE, ET AVEC QUELLE VOIX — la regle UNIQUE, partagee par la synthese, le montage et l'apercu.
 * `null` = ce plan est MUET (son texte reste affiche).
 *
 *  - mode `personnages` : seules les repliques sont lues, chacune avec la voix DE SON personnage ;
 *    jamais de narrateur ; une replique au locuteur AMBIGU n'est pas lue (pas de voix au hasard) ;
 *  - mode `narrateur`   : seules les phrases de recit sont lues, par la voix off ; les repliques ne le sont pas ;
 *  - sans mode (film d'avant) : le comportement historique, inchange (repliques + narration, sauf
 *    `narration === false`).
 */
export function voixAJouer(film: Film, plan: PlanCinema): string | null {
  const d = plan.dialogue;
  if (!d || !d.texte.trim()) return null;
  if (film.modeAudio === 'personnages') {
    if (d.genre !== 'replique' || !d.personnageId || locuteurAmbigu(film, plan)) return null;
    return film.personnages.find((p) => p.id === d.personnageId)?.voix ?? null;
  }
  if (film.modeAudio === 'narrateur') return d.genre === 'narration' ? VOIX_NARRATEUR : null;
  if (film.narration === false && d.genre === 'narration') return null;
  return d.personnageId ? (film.personnages.find((p) => p.id === d.personnageId)?.voix ?? VOIX_NARRATEUR) : VOIX_NARRATEUR;
}
