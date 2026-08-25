/**
 * Fusion partielle de `videos.metadata`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN ADAPTATEUR, ET NON UN APPEL DIRECT AU CONTRAT CANONIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `videos.metadata` n'est PAS `scheduled_posts.metadata`. La colonne est un
 * `JSONB DEFAULT '{}'` sans schema, et trois ecrivains y deposent trois
 * formes distinctes :
 *
 *   - `api/render/route.ts`            : `{ compositionId, batchIndex,
 *                                          batchTotal, ...inputProps }` —
 *                                        parametres de composition Remotion ;
 *   - `dashboard/infographic/page.tsx` : `{ title, subtitle, salesPhrase,
 *                                          posterPhotoUrl, characterUrl,
 *                                          characterImageUrl, rushUrls,
 *                                          musicUrl, voiceUrl,
 *                                          renderedVideoUrl }` ;
 *   - `components/creer/AgentIAModal.tsx` : la meme forme, plus `objective`,
 *                                        et `type: 'creator'`.
 *
 * Le recouvrement avec le contrat canonique est donc PARTIEL. `rushUrls`,
 * `musicUrl`, `voiceUrl`, `renderedVideoUrl`, `characterUrl` et `type` sont
 * des champs geres par `MANAGED_FIELDS` ; `compositionId`, `inputProps`,
 * `batchIndex`, `batchTotal`, `posterPhotoUrl`, `characterImageUrl`,
 * `salesPhrase` cote video, `objective` et le `title` interne aux
 * metadonnees n'en font pas partie.
 *
 * D'ou cet adaptateur, plutot qu'un appel direct depuis la route : le nom
 * dit ce qui est fusionne, et le commentaire dit ce qu'on attend de la
 * brique reutilisee. Ce qu'on lui emprunte, ce n'est PAS une interpretation
 * du design — c'est sa mecanique de fusion, qui est purement structurelle :
 *
 *   - `fromPostMetadata` ne fait AUCUNE coercition : elle deep-clone les
 *     valeurs et se contente de classer les cles en « gerees » et
 *     « passthrough ». Une cle propre a `videos` traverse donc intacte, y
 *     compris quand elle porte un nom que le contrat connait par ailleurs ;
 *   - `toPostMetadata` n'ecrit un champ gere que s'il etait REELLEMENT
 *     present dans l'entrant (`present` fait foi), et n'injecte aucun
 *     defaut ;
 *   - la fusion se fait au PREMIER NIVEAU : un objet imbrique envoye par le
 *     client remplace l'ancien au lieu de s'y melanger. C'est le meme
 *     contrat que `PUT /api/posts`, et il est volontaire : une fusion
 *     profonde interdirait de retirer une cle imbriquee et rendrait le sort
 *     des tableaux ambigu.
 *
 * Garanties, verifiees par `videos-put-whitelist.test.ts` — qui echouera si
 * la semantique cote posts derive un jour :
 *
 *   1. rien n'est jamais supprime : une cle presente dans l'existant et
 *      absente de l'entrant survit telle quelle ;
 *   2. les cles INCONNUES du contrat survivent, des deux cotes ;
 *   3. `0`, `false`, `''`, `null` et `[]` envoyes par le client sont ecrits
 *      fidelement — ce sont des valeurs, pas des absences ;
 *   4. aucune cle n'est INTRODUITE : ce qui n'etait ni dans l'existant ni
 *      dans l'entrant n'apparait pas ;
 *   5. ni `existing` ni `incoming` ne sont modifies ;
 *   6. la fusion est idempotente : n mises a jour successives ne produisent
 *      aucune derive.
 */

import { mergePostMetadata } from '@/lib/creer/postMetadata';

/**
 * Fusionne des metadonnees PARTIELLES dans celles d'une video.
 *
 * @param existing metadonnees actuelles de la ligne. Une colonne vide vaut
 *                 `null` en base et une video ancienne peut porter n'importe
 *                 quoi : tout ce qui n'est pas un objet nu est traite comme
 *                 un objet vide, jamais comme une erreur.
 * @param incoming le fragment envoye par le client, deja valide comme objet
 *                 par `parsePutVideoPayload`.
 */
export function mergeVideoMetadata(existing: unknown, incoming: unknown): Record<string, unknown> {
  return mergePostMetadata(existing ?? {}, incoming);
}
