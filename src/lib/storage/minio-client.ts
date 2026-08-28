/**
 * Le client MinIO, derriere une couture.
 *
 * `require('minio')` a l'interieur d'une fonction n'est pas interceptable par
 * les tests : le module est resolu au moment de l'appel, hors du graphe que
 * le lanceur de tests controle. Sortir la construction ici donne un point de
 * substitution NET — les tests remplacent ce module, pas le paquet externe.
 *
 * C'est aussi ce qui permet de tester la verification d'objet sans stockage :
 * la preuve est ce que `statObject` repond, et un test doit pouvoir dire quoi.
 */

import type { ClientRequest, RequestOptions } from 'http';

export interface ObjetStocke {
  size: number;
  metaData?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────
// Le bornage reseau — OPTIONNEL, et jamais impose au client partage
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ce qu'un appelant demande quand il refuse d'attendre indefiniment.
 *
 * ⚠️ CE N'EST PAS UN REGLAGE GLOBAL, ET CE NE DOIT PAS LE DEVENIR.
 *
 * Un envoi de rush de vingt gigaoctets et un `statObject` n'ont pas les memes
 * delais : borner le second protege l'analyse, borner le premier casserait
 * l'envoi. C'est donc l'APPELANT qui declare sa borne, operation par
 * operation. Sans cet argument, `clientMinio()` et `signeurInterne()` se
 * comportent EXACTEMENT comme avant — c'est la retro-compatibilite du reste
 * de Studiio (relais de televersement, `verifier-objet`, rendus).
 */
export interface BorneReseau {
  /** Delai maximal d'UNE requete HTTP vers MinIO, en millisecondes. */
  timeoutMs: number;
}

/** Le message porte par l'erreur de coupure. Sans URL, jamais. */
export const RAISON_TIMEOUT_MINIO = 'delai reseau MinIO depasse';

/**
 * Le transport HTTP borne : la seule chose de ce fichier qui ARRETE l'I/O.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MECANISME-LA, ET AUCUN DES DEUX AUTRES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le paquet `minio@8.0.7` n'offre AUCUNE annulation par operation : ses
 * methodes rendent des promesses ordinaires, sans `AbortSignal`, et
 * `setRequestOptions()` n'accepte qu'une liste fermee de proprietes TLS
 * (`node_modules/minio/dist/main/internal/client.d.ts`) ou `timeout` ne
 * figure pas. Restent trois voies, et une seule tient :
 *
 * 1. `Promise.race` autour de l'appel — REJETE. La promesse perdante rend la
 *    main a l'appelant, mais la socket reste ouverte et les octets continuent
 *    d'arriver. C'est une borne en trompe-l'oeil : on cesse d'attendre sans
 *    cesser de payer.
 *
 * 2. `transportAgent: new http.Agent({ timeout })` — REJETE aussi. Node arme
 *    bien `socket.setTimeout`, mais l'evenement `'timeout'` ne DETRUIT rien :
 *    la documentation Node est explicite, la socket doit etre detruite a la
 *    main. Un agent seul ne borne donc rien non plus.
 *
 * 3. `transport` — RETENU. C'est une option officielle du constructeur
 *    (`ClientOptions.transport?: Transport`, ou
 *    `Transport = Pick<typeof http, 'request'>` dans `internal/type.d.ts`),
 *    validee a la construction et utilisee par TOUTES les requetes du client
 *    (`requestWithRetry(this.transport, …)` dans `internal/client.js`). En
 *    l'interceptant, on tient l'objet `ClientRequest` lui-meme — donc
 *    `destroy(err)`, qui ferme la socket ET fait rejeter la promesse de
 *    `minio` par son propre `requestObj.on('error', reject)`.
 *
 * L'echeance est ABSOLUE, armee des l'appel, et non une inactivite : un
 * serveur qui livre un octet par seconde ne declenche jamais d'inactivite et
 * ferait pourtant depasser toutes les bornes annoncees. Elle couvre aussi la
 * resolution DNS et l'etablissement de connexion, qui precedent la socket.
 *
 * Le minuteur est `unref` : il ne retient jamais la boucle d'evenements, et
 * il est desarme des que la requete se termine — une requete rapide ne laisse
 * donc rien derriere elle.
 */
export function transportMinioBorne(useSSL: boolean, timeoutMs: number): {
  request(options: RequestOptions, rappel: (reponse: unknown) => void): ClientRequest;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const socle = useSSL ? require('https') : require('http');
  return {
    request(options: RequestOptions, rappel: (reponse: unknown) => void): ClientRequest {
      const requete: ClientRequest = socle.request(options, rappel);
      const couper = () => {
        if (requete.destroyed) return;
        // L'erreur ne porte ni hote, ni chemin, ni parametre de requete :
        // elle finit dans un journal, et une URL signee ne doit pas y aller.
        requete.destroy(new Error(`${RAISON_TIMEOUT_MINIO} (${timeoutMs} ms)`));
      };
      const echeance = setTimeout(couper, timeoutMs);
      if (typeof echeance.unref === 'function') echeance.unref();
      const desarmer = () => clearTimeout(echeance);
      requete.once('close', desarmer);
      requete.once('error', desarmer);
      return requete;
    },
  };
}

/**
 * Les options a ajouter au constructeur quand une borne est demandee.
 *
 * Les trois vont ensemble, et aucune n'est un extra :
 *
 * • `transport` — le seul mecanisme qui ARRETE l'I/O. Voir ci-dessus.
 *
 * • `retryOptions: { disableRetry: true }` — sans lui, `requestWithRetry`
 *   rejoue UNE fois toute requete qui rend 408/429/499/5xx
 *   (`node_modules/minio/dist/main/internal/request.js`), backoff compris :
 *   la borne annoncee serait fausse d'un facteur deux. C'est aussi ce que dit
 *   deja le contrat du moteur d'extraction — « aucune reprise automatique ».
 *
 * • `region` — sans elle, le SDK demande la region au serveur (`GET
 *   ?location`) AVANT chaque premiere operation d'un client. C'est une
 *   requete de plus, donc une attente de plus a borner, sur un point ou la
 *   reponse est connue d'avance. `signeurPublic` et `signeurInterne` la
 *   fixent deja pour cette raison exacte ; ici elle n'est posee QUE sur un
 *   client borne, pour ne rien changer aux clients partages.
 */
function optionsBornees(useSSL: boolean, borne: BorneReseau): Record<string, unknown> {
  return {
    transport: transportMinioBorne(useSSL, borne.timeoutMs),
    retryOptions: { disableRetry: true },
    region: process.env.MINIO_REGION || 'us-east-1',
  };
}

export interface ClientStockage {
  statObject(bucket: string, cle: string): Promise<ObjetStocke>;
  /**
   * Ecrit un objet. Le flux vient de la requete, la cle vient de la base.
   *
   * Presente ici pour la meme raison que `statObject` : le relais de
   * televersement doit etre testable sans stockage, et c'est le seul point
   * ou l'application ecrit dans MinIO pour le compte d'un rendu.
   */
  putObject(
    bucket: string, cle: string, flux: unknown,
    taille?: number, entetes?: Record<string, string>,
  ): Promise<unknown>;
}

/**
 * Le client de SIGNATURE, sur le nom PUBLIC.
 *
 * Ce n'est pas le meme que celui du serveur : la signature porte l'hote, et
 * signer avec `studiio-minio:9000` produit une URL injouable dehors -- c'est
 * exactement ce qui a bloque un envoi en production. Rend `null` tant que
 * `MINIO_PUBLIC_ENDPOINT` n'est pas configure : l'envoi passe alors par le
 * relais de l'application.
 *
 * La region est FIXEE : sans elle le SDK va la demander au serveur avant de
 * signer, une requete sortante a chaque envoi, qui echoue si l'application
 * ne joint pas ce nom.
 */
export function signeurPublic(): { presignedPutObject(b: string, c: string, t: number): Promise<string> } | null {
  const endPoint = process.env.MINIO_PUBLIC_ENDPOINT;
  if (!endPoint) return null;
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) return null;
  const useSSL = process.env.MINIO_PUBLIC_USE_SSL !== 'false';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');
  return new MinioClient({
    endPoint,
    port: useSSL ? 443 : 80,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
    region: process.env.MINIO_REGION || 'us-east-1',
  });
}

/**
 * Le signeur de LECTURE, sur le nom INTERNE.
 *
 * L'exact inverse de `signeurPublic` : l'URL produite ici ne doit JAMAIS
 * sortir du serveur. Elle sert a donner a un processus local — ffmpeg,
 * ffprobe — un moyen de lire un objet volumineux par requetes `Range`, sans
 * que l'application ne le charge en memoire ni ne le recopie sur disque.
 *
 * Trois raisons de ne PAS ajouter `presignedGetObject` a `ClientStockage` :
 *
 * 1. `ClientStockage` decrit ce que l'application fait au stockage pour le
 *    compte d'un utilisateur : regarder un objet, en ecrire un. Signer une
 *    lecture interne n'est pas de cette nature — c'est une couture entre
 *    deux processus du serveur.
 * 2. Les doublures de test de `clientMinio` n'implementent que `statObject`
 *    et `putObject`. Elargir l'interface les rendrait toutes invalides d'un
 *    coup, pour un besoin qu'aucune d'elles n'a.
 * 3. Le nom retenu — INTERNE ici, PUBLIC la — est ce qui rend l'erreur
 *    visible a la relecture. Une seule methode sur un seul client laisserait
 *    quelqu'un signer avec le mauvais hote sans s'en apercevoir, et c'est
 *    exactement la panne que `signeurPublic` raconte plus haut.
 *
 * Rend `null` quand aucun secret n'est configure : l'appelant traduit ce
 * `null` en refus, il ne fabrique pas d'URL de repli.
 *
 * `borne` est FACULTATIF. Sans lui, rien ne change. Avec lui, toute requete
 * sortante de ce client est coupee net au-dela du delai — voir
 * `transportMinioBorne`. La region etant FIXEE ci-dessous, `presignedGetObject`
 * ne fait aujourd'hui AUCUNE requete : la borne est ce qui couvre le jour ou
 * cette region disparaitrait, car le SDK irait alors la demander au serveur.
 */
export function signeurInterne(
  borne?: BorneReseau,
): { presignedGetObject(b: string, c: string, t: number): Promise<string> } | null {
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) return null;
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');
  return new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT || 'studiio-minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
    // Region FIXEE, pour la meme raison que dans `signeurPublic` : sans elle
    // le SDK la demande au serveur avant de signer, soit une requete de plus
    // a chaque analyse.
    region: process.env.MINIO_REGION || 'us-east-1',
    ...(borne ? optionsBornees(useSSL, borne) : {}),
  });
}

/**
 * Le client de LECTURE/ECRITURE sur le nom interne.
 *
 * `borne` est FACULTATIF, et le defaut est le comportement historique : aucun
 * delai. C'est voulu — le relais de televersement pousse des montages de
 * plusieurs centaines de mega-octets par ce meme client, et une borne pensee
 * pour un `statObject` les tuerait en plein vol.
 */
export function clientMinio(borne?: BorneReseau): ClientStockage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) throw new Error('MINIO_SECRET_KEY/MINIO_ROOT_PASSWORD manquant (env)');
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  return new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT || 'studiio-minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
    ...(borne ? optionsBornees(useSSL, borne) : {}),
  });
}
