/**
 * Liste blanche de `POST /api/videos`.
 *
 * Pendant de `put-payload.ts`, pour la CREATION. Meme raison de vivre hors de
 * `route.ts` : un fichier de route Next ne peut exporter que ses gestionnaires,
 * et le schema ne serait sinon testable qu'a travers un appel HTTP simule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE LISTE CORRIGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route faisait `.insert({ ...body, user_id, status: body.status || 'draft' })`.
 * Seul `user_id` etait protege — parce qu'il etait reecrit APRES l'etalement.
 * Tout le reste du corps atteignait PostgREST tel quel. Un porteur de session
 * pouvait donc creer, sur son propre compte :
 *
 *   - `status: 'completed'`  : une video declaree terminee sans qu'aucun rendu
 *                              n'ait eu lieu — la Bibliotheque l'affiche comme
 *                              livree, les filtres la comptent ;
 *   - `video_url`            : n'importe quelle URL, y compris hors de notre
 *                              stockage, servie ensuite par nos ecrans ;
 *   - `credits_used`         : un cout facture arbitraire, `0` compris ;
 *   - `render_job_id`        : le travail de rendu d'un tiers.
 *
 * L'ironie de l'etat d'avant : `VIDEO_PUT_FORBIDDEN_COLUMNS` interdisait
 * exactement ces colonnes en modification, en expliquant pourquoi — pendant
 * que la meme surface restait grande ouverte a la creation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SERVEUR IMPOSE, ET QUE LE CLIENT NE PEUT PLUS DISCUTER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `user_id` vient de la session. `status` vaut `'draft'` a la creation, sans
 * exception : une ligne ne peut pas naitre terminee. Le passage a
 * `rendering`, `completed` ou `failed` appartient au chemin qui a REELLEMENT
 * rendu — `src/lib/render/worker.ts` — et a lui seul.
 *
 * Consequence assumee, et c'est le prix de la garantie : les deux appelants
 * de cette route (`dashboard/infographic`, `AgentIAModal`) composent leur
 * montage DANS le navigateur puis televersent le fichier ; ils sont donc les
 * seuls a connaitre l'URL du montage. En la refusant, leurs lignes naissent
 * `draft` avec `video_url` nulle. L'URL n'est pas perdue pour autant : les
 * deux appelants la portent AUSSI dans `metadata.renderedVideoUrl`, qui
 * traverse la liste blanche.
 *
 * Un appelant serveur qui aurait legitimement besoin des colonnes protegees
 * ne doit PAS passer par cette route HTTP : il ecrit directement, cote
 * serveur, comme le font deja `api/render/route.ts` et
 * `api/videos/[id]/duplicate/route.ts`. Ces colonnes ne se rouvrent jamais au
 * navigateur.
 */
import { z } from 'zod';
import { findDangerousKey } from '@/lib/posts/patch-payload';

/**
 * Colonnes qu'un client a le droit de proposer a la creation.
 *
 * Aucune n'a de consequence sur la facturation, le rendu ou la publication :
 *
 *   - `title`       : obligatoire en base (`NOT NULL`), c'est le nom que
 *                     l'utilisateur donne a sa video ;
 *   - `description` : texte libre, defaut `''` ;
 *   - `format`      : `reel` ou `tv`. Il fixe le TARIF d'un rendu serveur, ce
 *                     qui l'exclut de la liste blanche du PUT — mais a la
 *                     creation, c'est le client qui vient de composer au bon
 *                     format, et aucun debit n'est declenche par cette route.
 *                     Le refuser ferait naitre toutes les infographies 16:9
 *                     en `reel`, le defaut SQL ;
 *   - `metadata`    : les metadonnees du montage. Objet ouvert : elles
 *                     portent trois formes distinctes selon leur origine
 *                     (rendu Remotion, infographie, agent IA) et des
 *                     extensions que personne ne declare.
 */
export const VIDEO_POST_ALLOWED_COLUMNS = ['title', 'description', 'format', 'metadata'] as const;

/**
 * Colonnes nommement fermees a la creation.
 *
 * Le filtrage ne consulte que la liste blanche : ces noms seraient ecartes de
 * toute facon. Les enumerer sert a documenter la surface fermee, et surtout a
 * donner aux tests une liste a PARCOURIR — une reouverture accidentelle fait
 * alors tomber un test, au lieu de passer inapercue.
 *
 * `type` y figure alors qu'il n'existe aucune colonne `type` sur `videos`
 * dans les migrations du depot : meme doute que dans `put-payload.ts`, meme
 * traitement. Une colonne dont on n'est pas sur ne s'ecrit pas depuis le
 * navigateur.
 */
export const VIDEO_POST_FORBIDDEN_COLUMNS = [
  'id',
  'user_id',
  'credits_used',
  'render_job_id',
  'status',
  'video_url',
  'thumbnail_url',
  'created_at',
  'updated_at',
  'objective_id',
  'script',
  'type',
] as const;

/**
 * Statut impose a toute ligne creee par cette route.
 *
 * Constante exportee, et non litteral recopie dans la route : c'est ce que
 * les tests interrogent, et il n'y a ainsi qu'un seul endroit ou la regle
 * pourrait changer.
 */
export const VIDEO_POST_FORCED_STATUS = 'draft' as const;

/**
 * Schema par champ.
 *
 * Un champ dont la VALEUR est invalide est ECARTE comme une cle inconnue : le
 * filtrage reste uniformement silencieux, sauf pour `title`, sans lequel
 * l'insert violerait le `NOT NULL` de la colonne.
 *
 * `format` est le seul a etre contraint au-dela de son type : la colonne
 * porte un `CHECK (format IN ('reel','tv'))`, et laisser passer autre chose
 * ferait echouer l'insert entier avec une erreur illisible.
 */
const FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  title: z.string().min(1),
  description: z.string(),
  format: z.enum(['reel', 'tv']),
  metadata: z.record(z.unknown()),
};

export type VideoPostPayloadResult =
  | { ok: true; values: Record<string, unknown>; ignored: string[] }
  | { ok: false; error: string; status: 422 };

/**
 * Valide une charge utile brute de `POST /api/videos`.
 *
 * Regles, dans l'ordre :
 *
 * 1. corps non-objet, ou portant une cle de detournement de prototype a
 *    n'importe quelle profondeur -> refus ferme, AVANT toute requete ;
 * 2. `title` absent ou vide -> refus ferme : la colonne est `NOT NULL`, et
 *    inventer un titre a la place de l'utilisateur serait pire que refuser ;
 * 3. chaque autre cle de la liste blanche est validee INDIVIDUELLEMENT ;
 *    celle qui echoue est ecartee sans faire tomber le reste ;
 * 4. toute autre cle est ecartee, silencieusement.
 *
 * `values` ne contient JAMAIS `user_id` ni `status` : la route les pose
 * elle-meme. Les y mettre ici laisserait croire qu'ils sont negociables.
 *
 * `ignored` n'est pas destine au client — la reponse n'en dit rien. Il rend
 * le filtrage OBSERVABLE par les tests.
 */
export function parsePostVideoPayload(raw: unknown): VideoPostPayloadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Le corps de la requete doit etre un objet JSON.', status: 422 };
  }

  const dangerous = findDangerousKey(raw);
  if (dangerous) {
    return { ok: false, error: `Cle interdite dans la charge utile : ${dangerous}`, status: 422 };
  }

  const body = raw as Record<string, unknown>;
  const allowed = new Set<string>(VIDEO_POST_ALLOWED_COLUMNS);
  const values: Record<string, unknown> = {};
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
    values[key] = parsed.data;
  }

  if (typeof values.title !== 'string' || values.title.length === 0) {
    return { ok: false, error: 'Le titre est obligatoire.', status: 422 };
  }

  return { ok: true, values, ignored };
}
