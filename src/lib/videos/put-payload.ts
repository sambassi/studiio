/**
 * Liste blanche de `PUT /api/videos/[id]`.
 *
 * Vit hors de `route.ts` : un fichier de route Next ne peut exporter que ses
 * gestionnaires, et le schema ne serait sinon testable qu'a travers un appel
 * HTTP simule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE LISTE CORRIGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route faisait `.update(body)` : la charge utile entiere partait vers
 * PostgREST. Le seul garde-fou etait le `WHERE user_id = <session>`, qui
 * borne la LIGNE visee mais ne dit rien des COLONNES ecrites. Un porteur de
 * session pouvait donc, sur SA propre video :
 *
 *   - `credits_used`   : reecrire le cout facture d'un rendu ;
 *   - `render_job_id`  : pointer le travail de rendu d'un tiers ;
 *   - `status`         : se declarer `completed` sans qu'aucun rendu ait eu
 *                        lieu, ou `published` sans publication ;
 *   - `video_url`      : substituer l'URL produite par le worker ;
 *   - `user_id`        : CEDER la video a un autre compte — le `WHERE`
 *                        portant sur l'ancien proprietaire, l'ecriture
 *                        passait, et le `SET` designait le nouveau.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI FILTRER SILENCIEUSEMENT, ET NON REFUSER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun appelant n'existe aujourd'hui dans le depot (`library`, `creer` et
 * `infographic` n'utilisent que GET, POST, DELETE et les sous-routes
 * `/export`, `/duplicate`, `/repost`). La route est une surface dormante.
 *
 * Un futur appelant relira vraisemblablement la ligne via `GET`, qui fait
 * `select('*')`, et la renverra entiere — comme les cinq appelants du
 * Calendrier le font deja sur `PUT /api/posts`. Un schema `.strict()`
 * repondrait alors 422 a une intention parfaitement legitime.
 *
 * Un objet NEUF est donc construit a partir de la seule liste blanche ; ce
 * qui n'y figure pas est ECARTE SANS BRUIT, sans erreur et sans message —
 * la reponse garde exactement la forme actuelle, `{ success, data }`.
 */

import { z } from 'zod';
// Detection generique des cles de detournement de prototype, deja utilisee
// par `PATCH /api/posts/[id]` et `PUT /api/posts`. La reutiliser plutot que
// la recopier.
import { findDangerousKey } from '@/lib/posts/patch-payload';

/**
 * Colonnes modifiables par le PROPRIETAIRE de la video.
 *
 * Volontairement minimale : trois colonnes, et uniquement celles dont la
 * valeur n'a aucune consequence sur le rendu, la facturation ou la
 * publication.
 *
 *   - `title`       : le nom affiche dans la Bibliotheque. Le renommage est
 *                     le geste d'edition evident d'une video.
 *   - `description` : texte libre de l'utilisateur, sans lecteur cote
 *                     serveur.
 *   - `metadata`    : le design et les medias de la video. FUSIONNE, jamais
 *                     remplace — voir `@/lib/videos/metadata`.
 *
 * Ce qui n'y est PAS, et pourquoi — au-dela des colonnes serveur listees
 * dans `VIDEO_PUT_FORBIDDEN_COLUMNS` :
 *
 *   - `format` : il fixe le cout d'un rendu (10 credits en `reel`, 15 en
 *                `tv`, `lib/stripe/constants`). Le modifier apres coup ferait
 *                diverger la ligne de ce qui a ete debite dans
 *                `credit_transactions`. Aucune interface ne le change.
 *   - `objective_id` : cle etrangere vers `objectives`. L'ouvrir exigerait
 *                de verifier que l'objectif vise appartient bien a l'appelant
 *                — un controle de propriete supplementaire, pour un besoin
 *                que rien n'exprime aujourd'hui.
 *   - `script` : entree de creation, jamais reeditee par une interface.
 *   - `thumbnail_url` : ecrite par le worker de rendu
 *                (`lib/render/worker.ts`) en meme temps que `video_url`.
 *
 * Ces quatre-la sont ecartes non parce qu'ils seraient dangereux, mais parce
 * qu'ouvrir une colonne « puisqu'elle existe » rouvre de la surface sans
 * besoin. Ils s'ajouteront le jour ou un appelant reel les demandera.
 */
export const VIDEO_PUT_ALLOWED_COLUMNS = ['title', 'description', 'metadata'] as const;

/**
 * Colonnes nommement interdites au client.
 *
 * Elles seraient de toute facon ecartees comme n'importe quelle cle hors
 * liste blanche : le filtrage ne consulte QUE la liste blanche. Les nommer
 * sert a documenter la surface fermee — et a donner aux tests une liste a
 * parcourir, pour qu'une reouverture accidentelle echoue bruyamment.
 *
 *   - `id`            : sert a CIBLER la ligne, jamais a la modifier.
 *   - `user_id`       : l'identite du proprietaire. Elle vient de la session.
 *   - `credits_used`  : montant reellement debite au rendu
 *                       (`api/render/route.ts`), contrepartie d'une ligne de
 *                       `credit_transactions`.
 *   - `render_job_id` : pose par le serveur apres creation du travail de
 *                       rendu ; c'est le lien vers `render_jobs`.
 *   - `status`        : pilote par le rendu (`rendering` -> `completed` /
 *                       `failed`, `lib/render/worker.ts`) et par la
 *                       publication sociale (`published`,
 *                       `api/social/publish/route.ts`). Aucune de ces
 *                       transitions n'appartient au client.
 *   - `video_url`     : URL de sortie produite par le worker.
 *   - `thumbnail_url` : ecrite par le meme worker.
 *   - `published_at`  : la colonne n'existe pas sur `videos`
 *                       (`002_complete_schema.sql`) mais existe sur
 *                       `scheduled_posts` ; une charge utile recopiee d'un
 *                       post la porterait. Elle atteste d'une publication
 *                       reelle : elle ne s'ecrit pas depuis un client.
 *   - `created_at`    : horodatage de creation.
 *   - `updated_at`    : horodatage pose par le declencheur
 *                       `update_videos_updated_at`, et utilise ici comme
 *                       jeton de version. Le laisser ecrire briserait le
 *                       controle de concurrence.
 *   - `objective_id`, `script`, `format` : voir la note de la liste blanche.
 *
 * `type` n'y figure pas, et c'est un DOUTE ASSUME, pas un oubli : la table
 * `videos` de `002_complete_schema.sql` ne declare aucune colonne `type`,
 * alors que `POST /api/videos` etale un corps portant `type: 'infographic'`
 * (`dashboard/infographic/page.tsx`) et `type: 'creator'`
 * (`components/creer/AgentIAModal.tsx`). Ces appels sont enveloppes dans un
 * `try/catch` qui ignore l'echec, et la reponse n'est jamais verifiee : que
 * la colonne existe ou que l'insertion echoue en silence, le symptome est le
 * meme cote client. Trancher demanderait d'interroger la base de production,
 * ce que cette correction s'interdit. `type` reste donc simplement HORS de
 * la liste blanche : s'il s'avere etre une colonne, il est fixe a la creation
 * et rien ne justifie de le rendre modifiable ensuite ; s'il n'en est pas
 * une, la question ne se pose pas. La cle `type` a l'INTERIEUR de `metadata`
 * n'est pas concernee — elle traverse la fusion comme n'importe quelle autre.
 */
export const VIDEO_PUT_FORBIDDEN_COLUMNS = [
  'id',
  'user_id',
  'credits_used',
  'render_job_id',
  'status',
  'video_url',
  'thumbnail_url',
  'published_at',
  'created_at',
  'updated_at',
  'objective_id',
  'script',
  'format',
  'type',
] as const;

/**
 * Schema par champ.
 *
 * Un champ dont la VALEUR est invalide est ECARTE comme une cle inconnue, il
 * ne fait pas tomber la requete : le filtrage reste uniformement silencieux.
 *
 * Les valeurs ne sont pas contraintes au-dela de leur type. `title` est un
 * `VARCHAR(500)` en base : la contrainte y reste l'autorite, la recopier ici
 * la ferait diverger a la premiere migration.
 *
 * `metadata` est un `z.record` et non un schema ferme : les metadonnees des
 * videos portent trois formes distinctes selon leur origine (rendu Remotion,
 * infographie, agent IA) et des extensions que personne ne declare. Les
 * refuser reviendrait a les perdre. `null` est refuse : effacer TOUT le
 * `metadata` n'est pas une mise a jour partielle.
 */
const FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  title: z.string(),
  description: z.string(),
  metadata: z.record(z.unknown()),
};

export type VideoPutPayloadResult =
  | { ok: true; updates: Record<string, unknown>; hasMetadata: boolean; ignored: string[] }
  | { ok: false; error: string; status: 400 | 422 };

/**
 * Valide une charge utile brute de `PUT /api/videos/[id]`.
 *
 * Regles, dans l'ordre :
 *
 * 1. corps non-objet, ou portant une cle de detournement de prototype a
 *    n'importe quelle profondeur -> refus ferme, avant toute requete ;
 * 2. chaque cle de la liste blanche est validee INDIVIDUELLEMENT ; celle qui
 *    echoue est ecartee sans faire tomber le reste ;
 * 3. toute autre cle est ecartee, silencieusement.
 *
 * `updates` peut donc etre VIDE, et c'est un resultat valide : c'est a
 * l'appelant de n'ecrire alors rien du tout. Le distinguer d'une erreur
 * evite de repondre 422 a un client qui a simplement renvoye la ligne
 * entiere sans y avoir touche.
 *
 * `ignored` n'est pas destine au client — la reponse n'en dit rien. Il rend
 * le filtrage OBSERVABLE par les tests.
 */
export function parsePutVideoPayload(raw: unknown): VideoPutPayloadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Le corps de la requete doit etre un objet JSON.', status: 422 };
  }

  const dangerous = findDangerousKey(raw);
  if (dangerous) {
    return { ok: false, error: `Cle interdite dans la charge utile : ${dangerous}`, status: 422 };
  }

  const body = raw as Record<string, unknown>;
  const allowed = new Set<string>(VIDEO_PUT_ALLOWED_COLUMNS);
  const updates: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const key of Object.getOwnPropertyNames(body)) {
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

  return {
    ok: true,
    updates,
    hasMetadata: Object.prototype.hasOwnProperty.call(updates, 'metadata'),
    ignored,
  };
}
