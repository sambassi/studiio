/**
 * VALIDATION AVANT RENDU — Créer (#500).
 *
 * Rendu réel DANSE (7) : 5 cartes au script, 5 fenêtres planifiées… et AUCUNE
 * carte à l'écran, sans un mot : les cartes avaient perdu leur titre en
 * route (vidéo Autopilote rouverte dans Créer) et un badge sans titre n'est
 * pas affiché (#499). Et le CTA saisi dans le brief n'apparaissait pas.
 *
 * Ici, deux règles PURES, appelées par le Wizard avant toute réservation :
 *  - chaque carte doit être complète (titre + valeur) et avoir sa fenêtre ;
 *  - le CTA du brief, s'il est rempli, est l'action finale réellement rendue.
 */
import { badgeValide } from '@/lib/creer/surimpressions-mise-en-page';

export interface BilanCartes {
  attendues: number;
  valides: number;
  /** Rangs (1..N) des cartes sans titre ou sans valeur. */
  incompletes: number[];
  /** Rangs (1..N) des cartes complètes sans fenêtre d'affichage. */
  sansFenetre: number[];
}

export function bilanCartesSurimpression(
  cartes: ReadonlyArray<{ title?: string | null; value?: string | null }>,
  fenetres: ReadonlyArray<{ index: number }>,
): BilanCartes {
  const avecFenetre = new Set(fenetres.map((f) => f.index));
  const incompletes: number[] = [];
  const sansFenetre: number[] = [];
  cartes.forEach((c, i) => {
    if (!badgeValide(c)) incompletes.push(i + 1);
    else if (!avecFenetre.has(i)) sansFenetre.push(i + 1);
  });
  return { attendues: cartes.length, valides: cartes.length - incompletes.length, incompletes, sansFenetre };
}

/** Message d'arrêt (aucune réservation, aucun débit) ; `null` si tout va bien. */
export function erreurCartesSurimpression(b: BilanCartes): string | null {
  if (!b.incompletes.length) return null;
  const liste = b.incompletes.join(', ');
  return `${b.incompletes.length > 1 ? 'Les cartes' : 'La carte'} ${liste} ${b.incompletes.length > 1 ? 'n’ont' : 'n’a'} pas de titre ou de valeur : `
    + 'elle ne pourrait pas s’afficher sur la vidéo. Complétez-la ou supprimez-la à l’étape Contenu. Rien n’a été composé ni débité.';
}

/**
 * CTA réellement rendu. Le CTA du BRIEF (« Appel à l'action ») est l'action
 * finale : il devient la ligne d'action, sous la headline générée (gardée).
 * Brief vide : le contenu tel quel. Jamais remplacé par un texte plus générique.
 */
export function avecCtaDuBrief<T extends { cta: string; ctaSub: string }>(contenu: T, brief: { cta?: string | null } | null | undefined): T {
  const action = (brief?.cta ?? '').trim();
  if (!action) return contenu;
  const memes = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (memes(contenu.cta, action) || memes(contenu.ctaSub, action)) return contenu;
  if (!contenu.cta.trim()) return { ...contenu, cta: action };
  return { ...contenu, ctaSub: action };
}
