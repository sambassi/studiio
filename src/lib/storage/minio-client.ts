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
