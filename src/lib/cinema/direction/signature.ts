/**
 * CINEMA IA — SOUS QUELLE DIRECTION UN MEDIA A ETE GENERE, et quels plans sont perimes.
 *
 * Un media genere porte la signature de la direction (style, camera) de sa generation. Si le
 * style ou la camera du plan change ensuite, la signature courante differe : le plan est « a
 * regenerer ». L'ancien media est CONSERVE (jamais supprime ni remplace sans demande), mais il
 * n'est plus presente comme issu de la direction actuelle. Rien ici ne lance de generation.
 *
 * L'IMAGE ne depend que du style ; la VIDEO, du style et de la camera. Un media sans signature
 * (genere avant la fonction) vaut « aucun style, camera d'origine » : un film d'avant n'est donc
 * signale que si l'utilisateur change reellement sa direction.
 */
import type { Film, GenreMedia, PlanCinema } from '@/lib/cinema/types';
import { directionDuPlan } from '@/lib/cinema/direction/prompt';

export function signatureDirection(film: Film, planId: string, genre: GenreMedia): string {
  const d = directionDuPlan(film, planId);
  const style = d.style?.id ?? '';
  return genre === 'video' ? `s:${style}|c:${d.camera ? d.camera.effective : 'origine'}` : `s:${style}`;
}

/** La signature d'un media d'avant la fonction. */
export const signatureAncienne = (genre: GenreMedia): string => (genre === 'video' ? 's:|c:origine' : 's:');

/** Plans dont le media genere ne correspond plus a la direction actuelle. */
export function plansARegenerer(film: Film): Array<{ planId: string; sceneId: string }> {
  const out: Array<{ planId: string; sceneId: string }> = [];
  for (const s of film.scenes) {
    for (const p of s.plans as PlanCinema[]) {
      const m = p.media;
      if (!m || m.origine !== 'genere') continue;
      if ((m.direction ?? signatureAncienne(m.genre)) !== signatureDirection(film, p.id, m.genre)) {
        out.push({ planId: p.id, sceneId: s.id });
      }
    }
  }
  return out;
}
