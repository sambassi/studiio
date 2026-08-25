/**
 * Liste blanche de `PUT /api/posts`.
 *
 * Vit hors de `route.ts` : un fichier de route Next ne peut exporter que ses
 * gestionnaires.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI FILTRER, ET NON REFUSER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les CINQ appelants du Calendrier envoient l'objet post ENTIER, relu de
 * `GET /api/posts` qui fait `select('*')` :
 *
 *   calendar/page.tsx:1250  `{ ...post, status: 'scheduled' }`
 *   calendar/page.tsx:1289  `{ ...editFormData, status: editTab }`
 *   calendar/page.tsx:1338  `{ ...post, scheduled_date }`
 *   calendar/page.tsx:1906  `{ ...updatedPost, status, scheduled_date, scheduled_time }`
 *   calendar/page.tsx:2465  `{ ...post, media_url, media_type, metadata }`
 *
 * Ces charges utiles portent donc `user_id`, `created_at`, `updated_at`,
 * `video_id`, `agent_generated`… sans que l'interface ait l'intention de les
 * modifier. Un schema `.strict()` repondrait 422 aux cinq : ce serait casser
 * le Calendrier pour corriger une faille.
 *
 * Un objet NEUF est donc construit a partir de la seule liste blanche, et ce
 * qui en sort est ignore — puis annonce dans la reponse, pour que le
 * filtrage reste observable au lieu d'etre muet.
 */

import { z } from 'zod';
// Detection generique des cles de detournement de prototype, deja utilisee
// par `PATCH /api/posts/[id]`. La reutiliser plutot que la recopier.
import { findDangerousKey } from '@/lib/posts/patch-payload';

/**
 * Champs modifiables depuis le Calendrier.
 *
 * Strictement ceux que les cinq appelants modifient reellement. `video_id`
 * en est ABSENT : il existe dans le type et dans la table, mais aucune
 * interface ne le change — l'ouvrir « parce qu'il existe » serait rouvrir de
 * la surface sans besoin.
 */
export const PUT_ALLOWED_COLUMNS = [
  'title',
  'caption',
  'media_url',
  'media_type',
  'format',
  'platforms',
  'scheduled_date',
  'scheduled_time',
  'status',
  'metadata',
] as const;

/**
 * Colonnes nommement interdites au client.
 *
 * Elles seraient de toute facon ecartees comme n'importe quelle cle hors
 * liste blanche ; les nommer sert a documenter la surface fermee et a
 * produire un message explicite.
 *
 *   - `user_id`      : l'identite du proprietaire. La reecrire permettait de
 *                      CEDER un post programme a un tiers, dont le cron
 *                      publiait ensuite le contenu avec SES jetons sociaux
 *                      (`api/cron/publish/route.ts`, comptes selectionnes
 *                      par `post.user_id`).
 *   - `id`           : sert a CIBLER le post, jamais a le modifier.
 *   - `approved_by` / `approved_at` : champs d'un flux d'approbation ; aucun
 *                      code ne les lit aujourd'hui, rien ne doit les ecrire.
 *   - `agent_generated`, `agent_plan_id` : poses par l'agent, cote serveur.
 *   - `published_at` : atteste d'une publication reelle.
 *   - `created_at`, `updated_at` : horodatages, dont le second sert de jeton
 *                      de version au controle de concurrence.
 *   - `platform_post_id`, `platform_post_url` : identifiants renvoyes par les
 *                      plateformes apres publication.
 *   - `video_id`     : lien vers `videos`, jamais modifie par l'interface.
 */
export const PUT_FORBIDDEN_COLUMNS = [
  'id',
  'user_id',
  'owner_id',
  'created_at',
  'updated_at',
  'published_at',
  'approved_by',
  'approved_at',
  'agent_plan_id',
  'agent_generated',
  'platform_post_id',
  'platform_post_url',
  'video_id',
] as const;

/**
 * Valeurs de `status` acceptees d'un client.
 *
 * Ce sont les quatre valeurs de la contrainte `CHECK` de la table
 * (`002_complete_schema.sql:114`).
 *
 * `published` en fait partie DELIBEREMENT : l'onglet « Publié » de la modale
 * d'edition (`calendar/page.tsx:3067`) le propose a l'utilisateur, et
 * `handleSavePost` l'envoie (`:1291`). Le refuser rendrait cet onglet
 * silencieusement inoperant. Le geste reste borne aux propres posts de
 * l'utilisateur : il ne publie rien, ne debite rien, et ne fait que retirer
 * le post de la selection du cron.
 *
 * `publishing` est en revanche EXCLU. C'est l'etat transitoire que le cron
 * s'attribue de facon atomique — « flip status scheduled/draft -> publishing
 * only if no other cron invocation got there first »
 * (`api/cron/publish/route.ts`). Un client capable de l'ecrire pourrait
 * bloquer un post dans cet etat ou perturber cette prise de verrou.
 */
export const PUT_ALLOWED_STATUSES = ['draft', 'scheduled', 'published', 'failed'] as const;

/** Schema par champ : un champ invalide est ECARTE, il n'invalide pas la requete. */
const FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  title: z.string(),
  caption: z.string(),
  media_url: z.string().nullable(),
  media_type: z.string(),
  format: z.string(),
  platforms: z.array(z.string()),
  scheduled_date: z.string(),
  scheduled_time: z.string(),
  status: z.enum(PUT_ALLOWED_STATUSES),
  metadata: z.record(z.unknown()),
};

export type PutPayloadResult =
  | { ok: true; id: string; updates: Record<string, unknown>; hasMetadata: boolean; ignored: string[] }
  | { ok: false; error: string; status: 400 | 422; ignored: string[] };

/**
 * Valide une charge utile brute de `PUT /api/posts`.
 *
 * Regles, dans l'ordre :
 *
 * 1. corps non-objet ou cle de detournement de prototype -> refus ferme ;
 * 2. `id` absent ou vide -> 400, comme avant cette correction ;
 * 3. chaque cle de la liste blanche est validee INDIVIDUELLEMENT ; celle qui
 *    echoue est ecartee et signalee, sans faire tomber le reste. Un post
 *    actuellement en `publishing` peut ainsi etre deplace dans le
 *    calendrier : son `status` illegitime est ecarte, sa nouvelle date
 *    passe ;
 * 4. toute autre cle est ecartee et signalee ;
 * 5. s'il ne reste rien a ecrire, la fonction echoue — aucune requete ne
 *    doit partir pour une mise a jour vide.
 *
 * `id` n'entre JAMAIS dans `updates` : il ne sert qu'a cibler la ligne.
 */
export function parsePutPostPayload(raw: unknown): PutPayloadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Le corps de la requete doit etre un objet JSON.', status: 422, ignored: [] };
  }

  const dangerous = findDangerousKey(raw);
  if (dangerous) {
    return { ok: false, error: `Cle interdite dans la charge utile : ${dangerous}`, status: 422, ignored: [] };
  }

  const body = raw as Record<string, unknown>;

  const id = body.id;
  if (typeof id !== 'string' || id.length === 0) {
    // Meme code qu'avant la correction : les appelants existants s'y attendent.
    return { ok: false, error: 'Post ID required', status: 400, ignored: [] };
  }

  const allowed = new Set<string>(PUT_ALLOWED_COLUMNS);
  const updates: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const key of Object.getOwnPropertyNames(body)) {
    // `id` cible la ligne ; il n'est ni ecrit, ni signale comme ignore.
    if (key === 'id') continue;

    if (!allowed.has(key)) {
      ignored.push(key);
      continue;
    }

    const parsed = FIELD_SCHEMAS[key].safeParse(body[key]);
    if (!parsed.success) {
      ignored.push(key);
      continue;
    }
    updates[key] = parsed.data;
  }

  if (Object.keys(updates).length === 0) {
    return {
      ok: false,
      error: `Aucun champ modifiable. Modifiables : ${PUT_ALLOWED_COLUMNS.join(', ')}.`,
      status: 422,
      ignored,
    };
  }

  return {
    ok: true,
    id,
    updates,
    hasMetadata: Object.prototype.hasOwnProperty.call(updates, 'metadata'),
    ignored,
  };
}
