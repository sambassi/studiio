/**
 * Validation de la charge utile de `PATCH /api/posts/[id]`.
 *
 * Vit hors de `route.ts` parce qu'un fichier de route Next ne peut exporter
 * que ses gestionnaires : sans ce module, le schema ne serait testable qu'a
 * travers un appel HTTP simule.
 *
 * Deux exigences opposees se rencontrent ici :
 *
 *   - **ne rien casser** : les appelants existants (`calendar/page.tsx`,
 *     lignes 806, 1056 et 1379) doivent continuer de passer a l'identique ;
 *   - **ne plus tout accepter** : la route faisait `.update(body)` sur la
 *     ligne entiere, ce qui laissait un client reecrire `user_id`, `status`,
 *     `published_at` ou `id`.
 *
 * D'ou une liste blanche de colonnes, et un refus explicite du reste.
 */

import { z } from 'zod';

/**
 * Colonnes que le client a le droit de modifier.
 *
 * Toutes celles qu'un appelant du depot envoie aujourd'hui, plus celles
 * qu'une edition de post touche legitimement. Les valeurs ne sont PAS
 * contraintes au-dela de leur type : `format`, `media_type` et `status`
 * portent deja une contrainte `CHECK` en base, qui reste l'autorite. Un
 * enum recopie ici divergerait au premier ajout — `status` connait deja une
 * cinquieme valeur applicative, `publishing`, absente du `CHECK`.
 */
export const PATCH_ALLOWED_COLUMNS = [
  'title',
  'caption',
  'media_url',
  'media_type',
  'format',
  'platforms',
  'scheduled_date',
  'scheduled_time',
  'status',
  'video_id',
  'metadata',
] as const;

/**
 * Colonnes explicitement HORS de portee d'un client.
 *
 * Listees pour produire un message clair — `.strict()` les refuserait de
 * toute facon comme n'importe quelle cle inconnue.
 *
 * `user_id` en tete : l'appartenance se verifie contre la session, jamais
 * contre ce que le client affirme.
 */
export const PATCH_FORBIDDEN_COLUMNS = [
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'published_at',
  'approved_by',
  'approved_at',
  'agent_plan_id',
  'agent_generated',
] as const;

/** Cles interdites a toute profondeur. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Cherche une cle de detournement de prototype, a n'importe quelle profondeur.
 *
 * Pourquoi avant Zod : `JSON.parse` cree une cle PROPRE nommee `__proto__`,
 * et toute recopie naive de ce dictionnaire (`cible[cle] = valeur`) appelle
 * le mutateur de prototype au lieu de creer une propriete. Le refus arrive
 * donc avant qu'un quelconque code ne parcoure l'objet.
 *
 * @returns le chemin de la premiere cle fautive, ou `null`.
 */
export function findDangerousKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findDangerousKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  for (const key of Object.getOwnPropertyNames(value)) {
    const here = path ? `${path}.${key}` : key;
    if (DANGEROUS_KEYS.has(key)) return here;
    const found = findDangerousKey((value as Record<string, unknown>)[key], here);
    if (found) return found;
  }
  return null;
}

/**
 * Schema de la charge utile.
 *
 * `.strict()` : toute cle hors liste blanche fait echouer la validation, au
 * lieu d'etre transmise a la base.
 *
 * Chaque champ est `.optional()` et AUCUN ne porte de `.default()` ni de
 * transformation : un champ absent reste absent, `false`, `0` et `''` sont
 * transmis tels quels, et `null` n'est accepte que la ou la colonne est
 * nullable en base.
 */
export const patchPostPayloadSchema = z
  .object({
    title: z.string().optional(),
    caption: z.string().optional(),
    media_url: z.string().nullable().optional(),
    media_type: z.string().optional(),
    format: z.string().optional(),
    platforms: z.array(z.string()).optional(),
    scheduled_date: z.string().optional(),
    scheduled_time: z.string().optional(),
    status: z.string().optional(),
    video_id: z.string().nullable().optional(),
    /**
     * Objet libre : le contrat canonique se charge de sa fusion. `z.record`
     * et non un schema ferme — les metadonnees portent des extensions que
     * personne ne declare, et les refuser reviendrait a les perdre.
     *
     * `null` est refuse : effacer TOUT le `metadata` d'un post n'est pas une
     * mise a jour partielle, c'est le geste que cette phase corrige.
     */
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type PatchPostPayload = z.infer<typeof patchPostPayloadSchema>;

export type PatchPayloadResult =
  | { ok: true; data: PatchPostPayload; hasMetadata: boolean }
  | { ok: false; error: string; details?: string[] };

/**
 * Valide une charge utile brute.
 *
 * `hasMetadata` distingue « `metadata` absent » de « `metadata` present mais
 * vide » : le premier laisse les metadonnees intactes sans les relire, le
 * second declenche une fusion — qui, avec `{}`, ne change rien, mais suit le
 * meme chemin, y compris son controle de concurrence.
 */
export function parsePatchPostPayload(raw: unknown): PatchPayloadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Le corps de la requete doit etre un objet JSON.' };
  }

  const dangerous = findDangerousKey(raw);
  if (dangerous) {
    return { ok: false, error: `Cle interdite dans la charge utile : ${dangerous}` };
  }

  const forbidden = PATCH_FORBIDDEN_COLUMNS.filter((column) =>
    Object.prototype.hasOwnProperty.call(raw, column),
  );
  if (forbidden.length > 0) {
    return {
      ok: false,
      error: 'Champs non modifiables',
      details: forbidden.map((column) => `${column} ne peut pas etre modifie par le client`),
    };
  }

  const parsed = patchPostPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Charge utile invalide',
      details: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`,
      ),
    };
  }

  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, error: 'Aucun champ a modifier.' };
  }

  return {
    ok: true,
    data: parsed.data,
    hasMetadata: Object.prototype.hasOwnProperty.call(parsed.data, 'metadata'),
  };
}
