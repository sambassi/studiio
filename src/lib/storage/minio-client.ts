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

export interface ObjetStocke {
  size: number;
  metaData?: Record<string, string>;
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
 */
export function signeurInterne(): { presignedGetObject(b: string, c: string, t: number): Promise<string> } | null {
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');
  return new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT || 'studiio-minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
    // Region FIXEE, pour la meme raison que dans `signeurPublic` : sans elle
    // le SDK la demande au serveur avant de signer, soit une requete de plus
    // a chaque analyse.
    region: process.env.MINIO_REGION || 'us-east-1',
  });
}

export function clientMinio(): ClientStockage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: MinioClient } = require('minio');
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) throw new Error('MINIO_SECRET_KEY/MINIO_ROOT_PASSWORD manquant (env)');
  return new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT || 'studiio-minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
  });
}
