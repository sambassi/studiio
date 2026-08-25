/**
 * Validation de la charge utile de `PATCH /api/user/profile`.
 *
 * Vit hors de `route.ts` : un fichier de route Next ne peut exporter que ses
 * gestionnaires, donc un schema qui y resterait ne serait testable qu'a
 * travers un appel HTTP simule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE LISTE BLANCHE EST SI COURTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route faisait `.update(body)` avec le corps client, via la cle de
 * service, sur la table `users`. Tout compte connecte pouvait donc s'ecrire
 * `credits`, `plan`, `role`, `blocked`, `email` ou `stripe_customer_id` —
 * cette derniere donnant acces au portail de facturation Stripe d'un tiers
 * (`api/stripe/create-portal/route.ts:13`).
 *
 * Recensement de ce que l'interface modifie REELLEMENT :
 *
 *   - `dashboard/settings/page.tsx` n'emet AUCUN appel reseau : il affiche
 *     `session.user.name` en lecture seule (ligne 139) ;
 *   - les avatars vivent dans la table `user_avatars` (`api/avatar/*`), pas
 *     dans `users` ;
 *   - le kit de marque vit dans `localStorage` et dans `user_settings`
 *     (`api/user/preferences`), pas dans `users` ;
 *   - `users.avatar_url` et `users.name` ne sont ecrits que par
 *     `lib/auth/config.ts` (lignes 65 et 132), depuis le fournisseur OAuth ;
 *   - `credits`, `plan` et `stripe_customer_id` ne sont ecrits que par le
 *     webhook Stripe, `credits/purchase-pack` et `credits/system`.
 *
 * `UpdateUserRequest` (`lib/types/api.ts:33`) annonce `{ name?, avatar_url? }`,
 * mais ce type n'est importe NULLE PART : c'est une intention, pas un usage.
 * `name` est donc volontairement HORS de la liste blanche — l'y mettre par
 * anticipation ouvrirait un champ que rien ne demande. Le jour ou un
 * formulaire de profil existera, une ligne suffira a l'ajouter.
 */

import { z } from 'zod';
// Detection generique des cles de detournement de prototype. Elle est
// aujourd'hui hebergee dans le module des posts, faute d'un troisieme
// consommateur qui justifierait un module partage. La reutiliser plutot que
// la recopier : deux implementations divergeraient.
import { findDangerousKey } from '@/lib/posts/patch-payload';

/** Le seul champ que l'utilisateur peut modifier sur sa propre ligne. */
export const PROFILE_ALLOWED_FIELDS = ['avatar_url'] as const;

/**
 * Colonnes de `users` nommement interdites au client.
 *
 * Elles seraient de toute facon filtrees comme n'importe quelle cle hors
 * liste blanche : les nommer sert a produire un message explicite et a
 * documenter la surface exacte que cette correction ferme.
 */
export const PROFILE_PROTECTED_FIELDS = [
  'id',
  'user_id',
  'email',
  'credits',
  'plan',
  'role',
  'is_admin',
  'blocked',
  'deleted_at',
  'stripe_customer_id',
  'subscription',
  'created_at',
  'updated_at',
] as const;

/** Longueur maximale acceptee pour une URL d'avatar. */
export const AVATAR_URL_MAX_LENGTH = 2048;

/** Prefixe des medias servis par le proxy interne (post-migration MinIO). */
const LOCAL_STORAGE_PREFIX = '/storage/v1/object/public/';

/** Hotes pour lesquels `http://` reste acceptable — developpement local uniquement. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * L'URL d'avatar est-elle d'une forme que l'application produit reellement ?
 *
 * Trois formes legitimes, relevees dans le code :
 *
 *   1. **chaine vide** — `lib/auth/config.ts:65` ecrit `avatar_url: ''` quand
 *      le fournisseur OAuth ne donne pas d'image. C'est donc la valeur qui
 *      « retire » un avatar, pas une absence de valeur ;
 *   2. **chemin relatif** `/storage/v1/object/public/...` — la forme par
 *      defaut depuis la migration MinIO (`lib/storage/s3-client.ts:34-38`,
 *      quand `PUBLIC_STORAGE_URL` et `NEXT_PUBLIC_APP_URL` sont absents) ;
 *   3. **URL absolue `https://`** — images des fournisseurs OAuth, et
 *      stockage Supabase historique.
 *
 * `http://` n'est tolere que sur un hote local : en developpement,
 * `NEXT_PUBLIC_APP_URL` vaut `http://localhost:3000` et les URL publiques en
 * heritent (`s3-client.ts:36`). L'imposer en `https://` seul casserait le
 * developpement local sans rien apporter en production.
 *
 * Tout le reste est refuse — `javascript:`, `data:`, `blob:`, `file:`, les
 * URL protocole-relatives `//hote/...`, et `http://` vers un hote distant.
 */
export function isAcceptableAvatarUrl(value: string): boolean {
  if (value === '') return true;
  if (value.length > AVATAR_URL_MAX_LENGTH) return false;
  // Les blancs de tete masqueraient un schema : `\njavascript:…` est traite
  // comme `javascript:…` par certains analyseurs.
  if (value !== value.trim()) return false;

  if (value.startsWith('/')) {
    // `//hote/chemin` est une URL protocole-relative, pas un chemin local.
    if (value.startsWith('//')) return false;
    return value.startsWith(LOCAL_STORAGE_PREFIX);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') return LOCAL_HOSTS.has(parsed.hostname);
  return false;
}

/**
 * Schema du seul champ modifiable.
 *
 * `.strict()` n'est PAS utilise ici : les cles inconnues sont retirees en
 * amont, deliberement (voir `parseProfilePayload`).
 */
export const profilePayloadSchema = z.object({
  avatar_url: z
    .string()
    .max(AVATAR_URL_MAX_LENGTH, `avatar_url depasse ${AVATAR_URL_MAX_LENGTH} caracteres`)
    .refine(isAcceptableAvatarUrl, {
      message: 'avatar_url doit etre une URL https, un chemin /storage/v1/object/public/…, ou une chaine vide',
    })
    .optional(),
});

export type ProfileUpdate = z.infer<typeof profilePayloadSchema>;

export type ProfilePayloadResult =
  | { ok: true; updates: ProfileUpdate; ignored: string[] }
  | { ok: false; error: string; ignored: string[] };

/**
 * Valide une charge utile brute de mise a jour de profil.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FILTRAGE PLUTOT QUE REFUS — et pourquoi
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun appelant de cette route n'existe dans le depot (`grep` sur
 * `api/user/profile` hors de la route : zero resultat). Un client ancien ou
 * externe reste neanmoins possible, et un `.strict()` lui repondrait 422
 * pour un champ qu'il envoyait sans y tenir.
 *
 * Les champs hors liste blanche sont donc **retires**, et la reponse dit
 * lesquels. La propriete de securite est identique — retire signifie jamais
 * transmis a PostgREST —, mais rien ne casse et le comportement reste
 * observable.
 *
 * Deux exceptions, refusees fermement parce qu'elles ne peuvent pas etre le
 * fait d'un client legitime : les cles de detournement de prototype, et un
 * corps qui n'est pas un objet.
 *
 * Et si, apres filtrage, il ne reste RIEN a ecrire, la fonction echoue :
 * l'appelant recoit un message clair au lieu d'une reussite silencieuse qui
 * n'aurait rien fait — et la route n'emet aucune requete.
 */
export function parseProfilePayload(raw: unknown): ProfilePayloadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Le corps de la requete doit etre un objet JSON.', ignored: [] };
  }

  const dangerous = findDangerousKey(raw);
  if (dangerous) {
    return { ok: false, error: `Cle interdite dans la charge utile : ${dangerous}`, ignored: [] };
  }

  const allowed = new Set<string>(PROFILE_ALLOWED_FIELDS);
  const picked: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const key of Object.getOwnPropertyNames(raw)) {
    if (allowed.has(key)) {
      picked[key] = (raw as Record<string, unknown>)[key];
    } else {
      ignored.push(key);
    }
  }

  const parsed = profilePayloadSchema.safeParse(picked);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join(' ; '),
      ignored,
    };
  }

  if (Object.keys(parsed.data).length === 0) {
    return {
      ok: false,
      error: `Aucun champ modifiable. Seul ${PROFILE_ALLOWED_FIELDS.join(', ')} peut etre modifie ici.`,
      ignored,
    };
  }

  return { ok: true, updates: parsed.data, ignored };
}
