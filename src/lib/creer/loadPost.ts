/**
 * Chargement d'un contenu existant — la LECTURE, et rien d'autre.
 *
 * Ce module appelle `GET /api/posts/[id]` et traduit la réponse en une issue
 * nommée. Il ne rend rien, ne débite aucun crédit, ne publie rien, ne programme
 * rien et n'active pas l'Autopilote : ouvrir un contenu pour le regarder ne doit
 * rien coûter ni rien déclencher.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST DÉJÀ GARANTI PAR LE SERVEUR, ET QU'ON NE REFAIT PAS ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `GET /api/posts/[id]` lit la session (`auth()`) et filtre la requête sur
 * `.eq('user_id', session.user.id)`. La propriété est donc vérifiée CÔTÉ
 * SERVEUR, contre la session — aucun `user_id` ne part d'ici, et aucun ne
 * serait cru. Le contenu d'un autre utilisateur ressort en `404`, et ce module
 * n'essaie pas de deviner s'il s'agit d'une absence ou d'un refus : dans les
 * deux cas il refuse, sans rien exposer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CINQ ISSUES PLUTÔT QU'UN BOOLÉEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une session expirée se répare en se reconnectant, une coupure réseau en
 * réessayant, un contenu introuvable en revenant au Calendrier. Les confondre
 * dans « une erreur est survenue » laisse l'utilisateur sans geste possible —
 * et c'est justement l'écran sur lequel il croit son travail perdu.
 */

/** Le post tel que le serveur le renvoie. Aucune interprétation ici. */
export interface PostAModifier {
  id: string;
  [cle: string]: unknown;
}

/** Les issues possibles d'un chargement, et elles seules. */
export type ChargementPost =
  | { kind: 'ok'; post: PostAModifier }
  /** 401 — il faut se reconnecter. */
  | { kind: 'session' }
  /** 403 — le contenu appartient à quelqu'un d'autre. */
  | { kind: 'refuse' }
  /** 404 — aucun contenu sous cet identifiant (ou pas le vôtre). */
  | { kind: 'introuvable' }
  /** La requête n'est jamais arrivée : coupure, hors ligne. Se réessaie. */
  | { kind: 'reseau' }
  /** Panne serveur, ou réponse illisible. */
  | { kind: 'erreur' };

/** Le `fetch` utilisé, injectable pour les tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Charge le post à modifier.
 *
 * L'identifiant est ENCODÉ : il vient d'une URL, donc de l'extérieur. Le coller
 * tel quel laisserait un `../` ou un `?` en changer la cible.
 *
 * Ne jette jamais : un écran de modification doit pouvoir afficher ce qui s'est
 * passé, pas disparaître derrière une exception.
 */
export async function chargerPostAModifier(
  postId: string,
  fetchImpl: FetchLike,
): Promise<ChargementPost> {
  const id = (postId ?? '').trim();
  // Un identifiant vide n'atteint pas le réseau : la question n'a pas de sens,
  // et `/api/posts/` désignerait une autre route.
  if (!id) return { kind: 'erreur' };

  let res: Response;
  try {
    res = await fetchImpl(`/api/posts/${encodeURIComponent(id)}`, { method: 'GET' });
  } catch {
    return { kind: 'reseau' };
  }

  if (res.status === 401) return { kind: 'session' };
  if (res.status === 403) return { kind: 'refuse' };
  if (res.status === 404) return { kind: 'introuvable' };
  if (!res.ok) return { kind: 'erreur' };

  let corps: unknown;
  try {
    corps = await res.json();
  } catch {
    return { kind: 'erreur' };
  }

  const enveloppe = corps as { success?: unknown; data?: unknown } | null;
  if (!enveloppe || enveloppe.success !== true) return { kind: 'erreur' };

  const data = enveloppe.data;
  // Un post sans objet exploitable est illisible, jamais un montage vierge :
  // repartir de zéro ici serait exactement la perte silencieuse qu'on évite.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'erreur' };

  return { kind: 'ok', post: data as PostAModifier };
}
