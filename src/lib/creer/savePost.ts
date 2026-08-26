/**
 * Enregistrement d'une modification — un `PATCH`, sur demande explicite.
 *
 * Ce module n'est appelé QUE depuis un geste de l'utilisateur. Rien ici ne rend
 * de vidéo, ne débite de crédit, ne publie ni ne programme : la route
 * `PATCH /api/posts/[id]` elle-même s'y refuse (« Ce que cette route ne fait
 * toujours pas, et ne doit jamais faire »).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE 409 MÉRITE SON PROPRE NOM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `PATCH /api/posts/[id]` protège les mises à jour portant `metadata` par un
 * contrôle optimiste sur `updated_at` : si la ligne a bougé depuis la lecture,
 * l'écriture est REFUSÉE plutôt qu'appliquée par-dessus. C'est ce qui empêche
 * deux enregistrements simultanés de s'effacer l'un l'autre.
 *
 * Sans traitement dédié côté client, ce refus passerait pour une panne
 * quelconque — et l'utilisateur repartirait en croyant avoir enregistré alors
 * que rien n'a été écrit. C'est le pire des deux mondes : un travail perdu ET la
 * conviction qu'il est sauvé. Le conflit a donc son issue, son message et son
 * geste (recharger pour repartir de la version en base).
 *
 * Aucun `user_id` n'est envoyé : le serveur le prend dans la session, et le
 * schéma de la route le refuserait de toute façon.
 */

import type { FetchLike } from './loadPost';

/** Ce qu'une modification peut mettre à jour. Aucune autre clé n'est acceptée. */
export interface CorpsModification {
  title?: string;
  caption?: string;
  scheduled_date?: string;
  metadata?: Record<string, unknown>;
}

/** Les issues d'un enregistrement, et elles seules. */
export type Enregistrement =
  | { kind: 'ok'; post: Record<string, unknown> | null }
  /** 409 — quelqu'un (ou un autre onglet) a écrit entre-temps. Rien n'a été enregistré. */
  | { kind: 'conflit' }
  | { kind: 'session' }
  | { kind: 'refuse' }
  | { kind: 'introuvable' }
  /** 422 — le serveur a refusé la charge utile. */
  | { kind: 'invalide' }
  /** La requête n'est jamais partie : coupure, hors ligne. Le formulaire est intact. */
  | { kind: 'reseau' }
  | { kind: 'erreur' };

/**
 * Envoie la modification.
 *
 * Ne jette jamais : un échec d'enregistrement doit laisser l'écran — et donc le
 * travail en cours — exactement là où il était.
 */
export async function enregistrerModification(
  postId: string,
  corps: CorpsModification,
  fetchImpl: FetchLike,
): Promise<Enregistrement> {
  const id = (postId ?? '').trim();
  if (!id) return { kind: 'erreur' };

  let res: Response;
  try {
    res = await fetchImpl(`/api/posts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
  } catch {
    return { kind: 'reseau' };
  }

  if (res.status === 409) return { kind: 'conflit' };
  if (res.status === 401) return { kind: 'session' };
  if (res.status === 403) return { kind: 'refuse' };
  if (res.status === 404) return { kind: 'introuvable' };
  if (res.status === 422) return { kind: 'invalide' };
  if (!res.ok) return { kind: 'erreur' };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    // Le serveur a repondu 2xx : l'ecriture a eu lieu. Un corps illisible ne
    // doit pas faire croire a un echec, ce qui pousserait a re-enregistrer.
    return { kind: 'ok', post: null };
  }

  const enveloppe = json as { success?: unknown; data?: unknown } | null;
  if (!enveloppe || enveloppe.success !== true) return { kind: 'erreur' };

  const data = Array.isArray(enveloppe.data) ? enveloppe.data[0] : enveloppe.data;
  return {
    kind: 'ok',
    post: data && typeof data === 'object' ? (data as Record<string, unknown>) : null,
  };
}
