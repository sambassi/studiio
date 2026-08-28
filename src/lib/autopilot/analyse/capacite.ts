/**
 * Le nombre d'extractions qui ont le droit de tourner EN MÊME TEMPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE PROTÈGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une extraction n'est pas une requête ordinaire : elle télécharge un rush qui
 * peut peser des gigaoctets et le fait lire par ffmpeg, jusqu'à neuf fois
 * (un sondage, puis huit vignettes). Deux d'entre elles côte à côte ne sont
 * pas deux fois plus lentes — elles se disputent le CPU et la bande passante
 * du MÊME conteneur, celui qui sert aussi toutes les pages. Trois suffisent à
 * faire échouer le healthcheck Docker, et Coolify redémarre alors le service
 * pendant que les analyses tournent : elles restent `en_cours` pour toujours.
 *
 * La borne est donc là pour le SERVEUR, pas pour l'utilisateur. Elle est
 * globale, et non par compte : ce qui sature est une machine, pas un quota.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA GARANTIE EST CELLE D'UN PROCESSUS, ET ELLE EN VAUT UNE ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le compteur ci-dessous vit dans la mémoire du processus Node. Il ne borne
 * donc que les requêtes servies PAR CE PROCESSUS. C'est une garantie réelle
 * tant que la production tourne sur un seul, ce qui est le cas aujourd'hui :
 *
 *   - `Dockerfile` finit par `CMD ["node", "server.js"]` — un processus, sans
 *     `cluster`, sans pm2, sans `NODE_OPTIONS` qui en lancerait plusieurs ;
 *   - `next.config.js` déclare `output: 'standalone'`, dont le `server.js`
 *     est un serveur HTTP mono-processus ;
 *   - `docs/infra.md` : un seul service Coolify `studiio-app`, et
 *     « Vercel n'héberge plus rien » — donc pas de fonction sans état
 *     dupliquée à chaque requête ;
 *   - aucun `docker-compose`, aucune déclaration de `replicas` dans le dépôt.
 *
 * SI CE JOUR VIENT — plusieurs conteneurs `studiio-app` derrière le même
 * domaine — ce compteur ne serait plus une garantie mais une illusion :
 * N conteneurs feraient N extractions simultanées en croyant en faire une.
 * Il faudrait alors un verrou en BASE (une ligne prise en `update ... where`
 * conditionnel, avec expiration), pas un compteur en mémoire. Le nombre de
 * répliques se règle dans l'interface Coolify, pas dans ce dépôt : c'est le
 * seul point que ce fichier ne peut pas vérifier lui-même.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NI FILE D'ATTENTE, NI ATTENTE TOUT COURT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `prendrePlaceExtraction` rend `null` immédiatement quand c'est plein. Elle
 * n'attend jamais. Faire patienter la seconde requête consommerait son propre
 * budget de 300 s à ne rien faire, et l'utilisateur verrait un chargement
 * interminable au lieu d'un refus qu'il peut comprendre — puis, une fois le
 * budget épuisé, une requête tuée AVANT même d'avoir commencé à mesurer.
 *
 * Un refus tout de suite est une information ; une attente muette n'en est
 * pas une.
 */

/**
 * Politique V1 : UNE extraction à la fois sur ce serveur.
 *
 * Volontairement le minimum : on borne d'abord, on desserre ensuite avec des
 * mesures. Monter ce nombre sans avoir observé la charge d'une extraction
 * réelle reviendrait à choisir la borne au hasard.
 */
export const MAX_EXTRACTIONS_SIMULTANEES = 1;

/**
 * Ce que l'appelant doit attendre avant de retenter, en secondes.
 *
 * C'est la durée MAXIMALE pendant laquelle une place peut rester prise : le
 * budget de la route (`maxDuration = 300`), au-delà duquel la requête qui la
 * détient n'existe plus. Le moteur, lui, s'arrête bien avant — 30 s de
 * sondage plus huit vignettes de 20 s au pire, soit ~220 s — mais annoncer sa
 * borne à lui ferait mentir l'en-tête le jour où une vignette de plus est
 * ajoutée.
 *
 * Annoncer une valeur trop courte est pire que ne rien annoncer : le client
 * reviendrait pile pour se faire refuser de nouveau, et compterait ce
 * deuxième refus comme une panne.
 *
 * `autopilote-m3b2-capacite.test.ts` vérifie que cette valeur reste égale au
 * `maxDuration` de la route — les deux ne peuvent pas diverger en silence.
 */
export const RETRY_APRES_SECONDES = 300;

/**
 * Le motif rendu à l'appelant. Une constante, parce qu'un écran le teste et
 * qu'une chaîne recopiée à deux endroits finit par différer d'un accent.
 */
export const MOTIF_CAPACITE_SATUREE = 'analyse_capacite_saturee';

/** Ce que voit l'utilisateur. Aucune mention d'un détail d'infrastructure. */
export const MESSAGE_CAPACITE_SATUREE =
  'Une autre analyse occupe déjà le serveur. Relancez celle-ci dans un moment.';

/**
 * Le compteur. Un entier, et rien d'autre.
 *
 * Pas de `Set` d'identifiants : ce qu'on borne est un NOMBRE de travaux
 * simultanés, et une structure plus riche inviterait à y lire un état
 * (« qui tourne ? ») qui ne serait vrai que jusqu'au prochain crash.
 */
let enCours = 0;

/**
 * La place prise, et le seul moyen de la rendre.
 *
 * Le jeton est un OBJET plutôt qu'un booléen exprès : il n'y a aucune façon
 * de rendre une place qu'on n'a pas prise, et aucune de la rendre deux fois.
 */
export interface PlaceExtraction {
  /** Rend la place. Sans effet si elle a déjà été rendue. */
  liberer(): void;
}

/**
 * Prend une place, ou rend `null` si elles sont toutes prises.
 *
 * NE JAMAIS appeler cette fonction avant d'avoir refusé ce qui doit l'être —
 * session absente, rush d'autrui, rush non vérifié. Prendre la place d'abord
 * ferait refuser en 429 une requête destinée à finir en 401 ou en 404, et
 * l'appelant croirait le serveur saturé alors qu'il n'avait tout simplement
 * pas le droit.
 *
 * Et TOUJOURS l'appeler avant `creerAnalyse` : la place refusée ne doit
 * laisser aucune ligne derrière elle. Une analyse créée puis refusée
 * occuperait le verrou d'unicité du rush et interdirait la relance — le
 * refus le plus bénin de tous produirait le blocage le plus durable.
 */
export function prendrePlaceExtraction(): PlaceExtraction | null {
  if (enCours >= MAX_EXTRACTIONS_SIMULTANEES) return null;
  enCours += 1;

  let rendue = false;
  return {
    liberer() {
      // Une double libération décrémenterait deux fois et finirait par rendre
      // le compteur négatif — c'est-à-dire par ouvrir des places qui
      // n'existent pas. Le jeton se souvient donc de son propre état.
      if (rendue) return;
      rendue = true;
      enCours -= 1;
    },
  };
}

/** Le nombre d'extractions en cours sur ce processus. Pour les tests et le journal. */
export function extractionsEnCours(): number {
  return enCours;
}

/**
 * Remet le compteur à zéro — POUR LES TESTS, et pour eux seuls.
 *
 * Même esprit que `definirMoteurExtraction` : la couture est exportée pour que
 * chaque test parte d'un serveur vide, et personne ne l'appelle en production.
 * L'appeler à chaud y libérerait des places encore occupées par de vraies
 * extractions, ce que la borne existe précisément pour empêcher.
 */
export function reinitialiserCapacite(): void {
  enCours = 0;
}
