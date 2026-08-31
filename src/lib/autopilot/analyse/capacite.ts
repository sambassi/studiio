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
 * C'est la durée MAXIMALE pendant laquelle une place peut rester prise.
 *
 * ⚠️ ELLE VIENT DU MOTEUR, PAS DE LA PLATEFORME.
 *
 * Ce commentaire a d'abord dit que la place était libérée au plus tard par le
 * `maxDuration = 300` de la route, « au-delà duquel la requête qui la détient
 * n'existe plus ». C'était faux : sur Coolify, le serveur Node autonome
 * n'applique pas `maxDuration` (`docs/infra.md`), et le `Dockerfile` lance un
 * simple `node server.js`. Rien ne tue la requête à 300 s ; la place n'est
 * rendue que par le `finally` de la route, donc seulement quand le travail
 * revient. Un `statObject` sur un stockage muet ne revenait jamais : la place
 * — il n'y en a qu'UNE — restait prise, et toutes les analyses suivantes
 * recevaient 429 jusqu'au redémarrage du conteneur.
 *
 * C'est le bornage réseau de `analyse/extraction.ts` qui rend cette valeur
 * vraie : il garantit que le travail revient, donc que le `finally` s'exécute.
 *
 * Ce qui la libère est le budget INTERNE du moteur, borné par ses propres
 * délais : `BUDGET_EXTRACTION_MS` dans `analyse/extraction.ts` vaut 290 s au
 * pire cas, et reste sous les 300 s annoncés ici. Annoncer la borne exacte du
 * moteur ferait mentir l'en-tête le jour où une vignette de plus est ajoutée ;
 * annoncer 300 s laisse cette marge, et un test vérifie que le pire cas ne la
 * dépasse pas.
 *
 * Annoncer une valeur trop courte est pire que ne rien annoncer : le client
 * reviendrait pile pour se faire refuser de nouveau, et compterait ce
 * deuxième refus comme une panne.
 *
 * `autopilote-m3b2-capacite.test.ts` vérifie que cette valeur reste égale au
 * `maxDuration` de la route — les deux ne peuvent pas diverger en silence.
 */
export const RETRY_APRES_SECONDES = 480;

/**
 * ⚠️ POURQUOI 480 ET NON PLUS 360 — M3-D1.
 *
 * La mesure audio locale s'exécute elle aussi DANS la même requête, avant la
 * clôture. Le pire cas devient `BUDGET_EXTRACTION_MS` (290 s) plus
 * `TIMEOUT_VISUEL_MS` (60 s) plus `BUDGET_AUDIO_MS` (130 s), soit 480 s.
 *
 * Elle coûte plus cher qu'une vignette pour une raison de nature, pas de
 * réglage : l'audio est entrelacé sur toute la durée du fichier, il ne se lit
 * pas par requêtes `Range`. La passe traverse donc le rush entier.
 *
 * Laisser 360 aurait fait mentir l'en-tête `Retry-After` exactement comme le
 * décrit le commentaire ci-dessus. Un test additionne les trois budgets et
 * vérifie que la somme tient sous cette valeur — ils ne peuvent pas diverger
 * en silence.
 */

/**
 * ⚠️ POURQUOI 360 ET NON PLUS 300 — M3-B4.
 *
 * L'analyse ne s'arrête plus à l'extraction : l'étape `visuel` s'exécute dans
 * la même requête. Le pire cas est donc `BUDGET_EXTRACTION_MS` (290 s) plus
 * `TIMEOUT_VISUEL_MS` (60 s), soit 350 s — au-dessus des 300 s annoncées
 * jusqu'ici.
 *
 * Laisser 300 aurait fait mentir l'en-tête `Retry-After` exactement comme le
 * décrit le commentaire ci-dessus : le client serait revenu pile pour se faire
 * refuser de nouveau, et aurait compté ce deuxième refus comme une panne.
 * `maxDuration` de la route suit la même valeur — un test vérifie que les deux
 * ne peuvent pas diverger en silence.
 */

/**
 * Le motif rendu à l'appelant. Une constante, parce qu'un écran le teste et
 * qu'une chaîne recopiée à deux endroits finit par différer d'un accent.
 */
export const MOTIF_CAPACITE_SATUREE = 'analyse_capacite_saturee';

/** Ce que voit l'utilisateur. Aucune mention d'un détail d'infrastructure. */
export const MESSAGE_CAPACITE_SATUREE =
  'Une autre analyse occupe déjà le serveur. Relancez celle-ci dans un moment.';

/**
 * Politique V1 : UNE passe audio à la fois sur ce processus.
 *
 * ⚠️ POURQUOI UNE BORNE DE PLUS, PUISQU'IL N'Y A DÉJÀ QU'UNE EXTRACTION.
 *
 * Parce que les deux bornes ne protègent pas la même chose. La place
 * d'extraction est prise par la ROUTE d'analyse ; elle garantit qu'une seule
 * analyse tourne, et c'est tout. `mesurerAudio` est une fonction exportée :
 * le jour où un cron, une reprise ou un second écran l'appelle hors de cette
 * route — et ce jour arrive toujours — plus rien ne l'empêcherait de décoder
 * deux rushes entiers en parallèle sur quatre cœurs partagés avec la base et
 * le stockage.
 *
 * Une garde qu'on suppose tenue en amont est une garde absente. Celle-ci vit
 * DANS le module qui coûte cher, donc elle tient quel que soit l'appelant.
 */
export const MAX_AUDIO_SIMULTANEES = 1;

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
 * Le compteur des passes audio. SÉPARÉ de celui des extractions, exprès.
 *
 * Un compteur commun ferait refuser la mesure audio d'une analyse par la
 * place que cette même analyse détient déjà — le blocage garanti, à chaque
 * fois, pour toujours.
 */
let audioEnCours = 0;

/**
 * Prend une place de mesure audio, ou rend `null` si elle est prise.
 *
 * Un refus N'EST PAS un échec d'analyse : `mesurerAudio` le traduit en
 * `etatMesure: 'indisponible'`, motif `capacite_saturee`, et l'analyse se
 * clôt `reussie` avec son visuel intact. Faire échouer une analyse parce que
 * la mesure la moins importante n'a pas trouvé de place serait perdre le
 * travail cher pour protéger le travail bon marché.
 */
export function prendrePlaceAudio(): PlaceExtraction | null {
  if (audioEnCours >= MAX_AUDIO_SIMULTANEES) return null;
  audioEnCours += 1;

  let rendue = false;
  return {
    liberer() {
      if (rendue) return;
      rendue = true;
      audioEnCours -= 1;
    },
  };
}

/** Le nombre de passes audio en cours sur ce processus. Pour les tests. */
export function passesAudioEnCours(): number {
  return audioEnCours;
}

/**
 * Politique V1 : UNE transcription à la fois sur ce processus.
 *
 * ⚠️ ELLE BORNE DEUX CHOSES À LA FOIS, ET C'EST POURQUOI ELLE EXISTE.
 *
 * L'extraction FLAC traverse le rush ENTIER et décode sa bande son : c'est le
 * même coût machine qu'une passe M3-D1. Mais le FLAC produit est ensuite LU
 * EN MÉMOIRE pour être envoyé — jusqu'à `FLAC_OCTETS_MAX`, vingt-quatre
 * mébioctets. Deux transcriptions parallèles, ce sont deux décodages complets
 * ET deux copies en mémoire, sur un serveur qui héberge aussi la base et le
 * stockage.
 *
 * Un refus ici N'EST PAS un échec : la route rend 429 avec `Retry-After`,
 * exactement comme la capacité d'extraction, et rien n'est écrit.
 */
export const MAX_TRANSCRIPTIONS_SIMULTANEES = 1;

/**
 * Le compteur des transcriptions. SÉPARÉ des deux autres, exprès.
 *
 * Un compteur partagé avec l'analyse ferait refuser une transcription parce
 * qu'une analyse tourne, alors que les deux sont des travaux différents,
 * demandés par des écrans différents, sur des rushes potentiellement
 * différents.
 */
let transcriptionsEnCours = 0;

/**
 * Prend une place de transcription, ou rend `null` si elle est prise.
 *
 * NE JAMAIS l'appeler avant d'avoir refusé ce qui doit l'être — session
 * absente, rush d'autrui, rush non vérifié. Et TOUJOURS avant
 * `creerTranscription` : une place refusée ne doit laisser AUCUNE ligne
 * derrière elle, sans quoi le refus le plus bénin occuperait le verrou
 * d'unicité et interdirait toute relance de ce rush.
 */
export function prendrePlaceTranscription(): PlaceExtraction | null {
  if (transcriptionsEnCours >= MAX_TRANSCRIPTIONS_SIMULTANEES) return null;
  transcriptionsEnCours += 1;

  let rendue = false;
  return {
    liberer() {
      if (rendue) return;
      rendue = true;
      transcriptionsEnCours -= 1;
    },
  };
}

/** Le nombre de transcriptions en cours sur ce processus. Pour les tests. */
export function transcriptionsEnCoursMaintenant(): number {
  return transcriptionsEnCours;
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
  audioEnCours = 0;
  transcriptionsEnCours = 0;
}
