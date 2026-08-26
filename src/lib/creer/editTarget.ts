/**
 * Ce que le lien d'entrée de `/dashboard/creer` demande.
 *
 * Une seule question, posée à la query et à rien d'autre : NOUVELLE création,
 * MODIFICATION d'un contenu existant, ou lien abîmé ? Ce module ne lit aucune
 * base, n'appelle aucune API, ne décide d'aucun rendu et ne connaît pas le
 * wizard. Il trie, c'est tout.
 *
 * Pourquoi ce triage mérite son propre module plutôt qu'un `searchParams.postId`
 * lu au vol : c'est la seule chose qui distingue un montage vierge d'un contenu
 * perdu. S'y tromper ne produit AUCUNE erreur visible — l'écran s'ouvre vide, et
 * l'utilisateur croit son travail effacé. Une décision de cette nature doit être
 * nommée, testée, et lisible sans ouvrir un composant de 8 500 lignes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PÉRIMÈTRE : `postId` SEULEMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `postId` désigne un `scheduled_posts.id` — c'est ce que lit déjà l'éditeur
 * avancé, et ce que sert `GET /api/posts/[id]`.
 *
 * `id`, lui, désigne une VIDÉO (`videos.id`) : il est porté par le bouton
 * « Modifier » de la Bibliothèque (`library/page.tsx`), qui alimente sa liste
 * depuis `/api/videos`. Personne ne le lit aujourd'hui — pas même l'éditeur
 * avancé vers lequel ce bouton pointe. Modifier une vidéo (un fichier rendu)
 * n'a pas le même sens que modifier un post (un montage et ses métadonnées), et
 * ce contrat n'est défini nulle part dans le dépôt. Il est donc traité ici comme
 * n'importe quel paramètre inconnu : IGNORÉ. Le deviner reviendrait à inventer
 * un comportement produit ; ce sera un lot à part.
 */

import type { SearchParams } from '@/lib/routing/legacy-redirect';

/** Message affiché quand le lien porte un `postId` inexploitable. */
export const LIEN_INCOMPLET = 'Ce lien de modification est incomplet.';

/**
 * Les trois issues possibles, et elles seules.
 *
 * `invalid` existe parce que la quatrième issue — « on ne sait pas, ouvrons une
 * création » — est précisément celle qui fait croire à une perte de contenu.
 */
export type EditTarget =
  | { kind: 'create' }
  | { kind: 'edit'; postId: string }
  | { kind: 'invalid' };

/**
 * Le coeur de la décision, appelé par les deux entrées.
 *
 * `valeurs` est la liste des `postId` trouvés — vide s'il n'y en a pas, à
 * plusieurs entrées si le paramètre est répété.
 *
 *   - aucune valeur -> création (le cas de tous les liens d'aujourd'hui) ;
 *   - plusieurs valeurs -> lien ambigu, refusé : choisir la première serait
 *     parier sur le contenu que l'utilisateur veut ouvrir, et le mauvais post
 *     s'ouvrirait sans que rien ne le signale ;
 *   - une valeur vide ou faite d'espaces -> lien abîmé, refusé ;
 *   - sinon -> modification, identifiant détouré de ses espaces.
 */
function trier(valeurs: string[]): EditTarget {
  if (valeurs.length === 0) return { kind: 'create' };
  if (valeurs.length !== 1) return { kind: 'invalid' };
  const seul = (valeurs[0] ?? '').trim();
  return seul ? { kind: 'edit', postId: seul } : { kind: 'invalid' };
}

/**
 * Trie le lien d'entrée, tel que Next le passe à une page SERVEUR.
 *
 * La lecture est faite avec `Object.prototype.hasOwnProperty` : une query n'est
 * pas un objet de confiance, et une propriété héritée ne doit pas pouvoir se
 * faire passer pour un identifiant.
 *
 * Fonction PURE : elle ne modifie jamais son argument.
 */
export function readEditTarget(searchParams?: SearchParams): EditTarget {
  if (!searchParams || !Object.prototype.hasOwnProperty.call(searchParams, 'postId')) {
    return trier([]);
  }
  const brut = searchParams.postId;
  if (brut === undefined) return trier([]);
  return trier(Array.isArray(brut) ? brut : [brut]);
}

/**
 * Même triage, depuis l'URL telle que la voit le NAVIGATEUR.
 *
 * `useSearchParams()` rend un `URLSearchParams` : `getAll` y remplace la lecture
 * de propriété, et c'est lui qui révèle un paramètre répété.
 *
 * Deux entrées, une seule règle — celle de `trier`. Deux implémentations
 * divergeraient, et l'écart ne se verrait que sur le chemin qu'on ne teste pas
 * ce jour-là.
 */
export function readEditTargetFromQuery(
  params?: { getAll(cle: string): string[] } | null,
): EditTarget {
  return trier(params ? params.getAll('postId') : []);
}
