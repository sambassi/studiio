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
 * Trie le lien d'entrée.
 *
 * Règles, dans l'ordre :
 *   - `postId` absent -> création (le cas de tous les liens d'aujourd'hui) ;
 *   - `postId` répété (`?postId=a&postId=b`) -> lien ambigu, refusé : choisir le
 *     premier serait parier sur le contenu que l'utilisateur veut ouvrir, et le
 *     mauvais post s'ouvrirait sans que rien ne le signale ;
 *   - `postId` vide ou fait d'espaces -> lien abîmé, refusé ;
 *   - sinon -> modification, identifiant détouré de ses espaces.
 *
 * La lecture est faite avec `Object.prototype.hasOwnProperty` : une query n'est
 * pas un objet de confiance, et une propriété héritée ne doit pas pouvoir se
 * faire passer pour un identifiant.
 *
 * Fonction PURE : elle ne modifie jamais son argument.
 */
export function readEditTarget(searchParams?: SearchParams): EditTarget {
  if (!searchParams || !Object.prototype.hasOwnProperty.call(searchParams, 'postId')) {
    return { kind: 'create' };
  }

  const brut = searchParams.postId;

  if (Array.isArray(brut)) {
    if (brut.length !== 1) return { kind: 'invalid' };
    const seul = (brut[0] ?? '').trim();
    return seul ? { kind: 'edit', postId: seul } : { kind: 'invalid' };
  }

  const valeur = (brut ?? '').trim();
  return valeur ? { kind: 'edit', postId: valeur } : { kind: 'invalid' };
}
