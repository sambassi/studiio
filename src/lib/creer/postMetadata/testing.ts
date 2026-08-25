/**
 * Outils de manipulation profonde, exposes POUR LES TESTS.
 *
 * `internal.ts` est un detail d'implementation : rien ne garantit sa surface
 * d'un lot a l'autre. Mais les tests du contrat — et ceux des routes qui
 * l'utiliseront — ont besoin de figer une entree pour prouver qu'aucune
 * fonction ne la mute. Les faire importer `./internal` par un chemin profond
 * aurait grave ce detail dans quatre fichiers.
 *
 * Ce point d'entree est donc separe de `index.ts` A DESSEIN : l'API de
 * production ne doit pas offrir des outils dont elle n'a pas l'usage, et un
 * import depuis du code applicatif se repere ici d'un seul grep.
 */

export { deepClone, deepFreeze } from './internal';
export type { OpenRecord } from './internal';
