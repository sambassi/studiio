import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { Client as MinioClient } from 'minio';
import { sanitizeStorageFilename } from '@/lib/storage/sanitize-filename';

/**
 * Envoi multipart presigné — les gros fichiers, et la reprise.
 *
 * ⚠️ LE PROBLÈME N'ÉTAIT PAS LE DÉBIT, C'ÉTAIT L'ABSENCE DE REPRISE.
 *
 * Un envoi en UN SEUL `PUT` n'a pas de point de reprise : la moindre coupure
 * du réseau de l'utilisateur — quelques secondes de Wi-Fi, un basculement
 * 4G — annule la totalité du transfert, quel qu'en soit l'avancement. C'est
 * pour ça que des échecs tombaient à 39 % ou 45 % sur des fichiers courts,
 * alors que le serveur, lui, poussait 5 Mo à 14 Mio/s sans broncher.
 *
 * Découper l'envoi rend chaque morceau ré-essayable : une coupure ne coûte
 * plus que le morceau en cours.
 *
 * Une seule route, quatre actions : l'authentification, le contrôle de
 * chemin et la construction du client tiennent alors en un seul endroit —
 * quatre fichiers auraient fait quatre occasions d'oublier le contrôle.
 */

export const dynamic = 'force-dynamic';

/** Validité d'une URL de morceau : de quoi couvrir une reprise lente. */
const PART_URL_TTL_S = 3600;

const ALLOWED_BUCKETS = new Set(['media', 'audio', 'videos', 'images']);

/**
 * Client visant l'endpoint PUBLIC.
 *
 * Même raison qu'en #311 : la signature porte l'hôte, et `studiio-minio`
 * n'est pas résolvable depuis un navigateur. La région est fixée pour que la
 * signature reste locale — sans elle, le SDK va la DEMANDER au serveur avant
 * de signer, à chaque morceau.
 */
function clientPublic(): MinioClient | null {
  const endPoint = process.env.MINIO_PUBLIC_ENDPOINT;
  if (!endPoint) return null;
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  if (!secretKey) return null;
  const useSSL = process.env.MINIO_PUBLIC_USE_SSL !== 'false';
  return new MinioClient({
    endPoint,
    port: useSSL ? 443 : 80,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
    region: process.env.MINIO_REGION || 'us-east-1',
  });
}

/** Le chemin demandé appartient-il bien à l'appelant ? */
function cheminAutorise(storagePath: string, userId: string): boolean {
  return storagePath.startsWith(`${userId}/`) && !storagePath.includes('..');
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const client = clientPublic();
  if (!client) {
    // Sans endpoint public, le multipart presigné n'a pas de sens : le
    // navigateur ne peut pas écrire dans MinIO. L'appelant retombe sur
    // l'envoi en un bloc, qui garde sa propre reprise.
    return NextResponse.json(
      { success: false, error: 'multipart indisponible', unsupported: true },
      { status: 501 },
    );
  }

  let corps: Record<string, unknown>;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Corps illisible' }, { status: 400 });
  }

  const action = String(corps.action || '');
  const userId = session.user.id;

  try {
    // ── initiate ──────────────────────────────────────────────────────────
    if (action === 'initiate') {
      const contentType = String(corps.contentType || 'application/octet-stream');
      const bucket = contentType.startsWith('audio/') ? 'audio' : 'media';
      const filename = sanitizeStorageFilename(String(corps.filename || 'fichier'));
      const purpose = String(corps.purpose || 'rush');
      const key = `${userId}/${purpose}/${Date.now()}-${filename}`;
      const uploadId = await client.initiateNewMultipartUpload(bucket, key, {
        'Content-Type': contentType,
      });
      return NextResponse.json({
        success: true, uploadId, key, bucket,
        // La MÊME URL de lecture que l'envoi en un bloc — voir #311 : elle
        // passe par l'application, pas par l'endpoint public, tant que la
        // lecture anonyme n'est pas ouverte sur le compartiment.
        publicUrl: `/storage/v1/object/public/${bucket}/${key}`,
      });
    }

    // Les trois autres actions portent une clé déjà créée : on la contrôle.
    const bucket = String(corps.bucket || '');
    const key = String(corps.key || '');
    const uploadId = String(corps.uploadId || '');
    if (!ALLOWED_BUCKETS.has(bucket) || !key || !uploadId) {
      return NextResponse.json({ success: false, error: 'Paramètres manquants' }, { status: 400 });
    }
    if (!cheminAutorise(key, userId)) {
      // Sans ce contrôle, un appelant pourrait poursuivre l'envoi d'un autre.
      console.warn('[upload/multipart] chemin hors périmètre', { userId, key });
      return NextResponse.json({ success: false, error: 'Path scope mismatch' }, { status: 403 });
    }

    // ── sign-part ─────────────────────────────────────────────────────────
    if (action === 'sign-part') {
      const partNumber = Number(corps.partNumber);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
        return NextResponse.json({ success: false, error: 'partNumber invalide' }, { status: 400 });
      }
      const url = await client.presignedUrl('PUT', bucket, key, PART_URL_TTL_S, {
        uploadId, partNumber: String(partNumber),
      });
      return NextResponse.json({ success: true, url });
    }

    // ── complete ──────────────────────────────────────────────────────────
    if (action === 'complete') {
      const recus = Array.isArray(corps.parts) ? corps.parts : [];
      const parts = recus
        .map((p) => p as { PartNumber?: unknown; ETag?: unknown })
        .filter((p) => Number.isInteger(Number(p.PartNumber)) && typeof p.ETag === 'string')
        // MinIO exige des morceaux ORDONNÉS : un envoi séquentiel les produit
        // dans l'ordre, mais une reprise peut les avoir réordonnés.
        .sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber))
        .map((p) => ({ part: Number(p.PartNumber), etag: String(p.ETag).replace(/"/g, '') }));
      if (parts.length === 0) {
        return NextResponse.json({ success: false, error: 'Aucun morceau' }, { status: 400 });
      }
      await client.completeMultipartUpload(bucket, key, uploadId, parts);
      return NextResponse.json({
        success: true,
        publicUrl: `/storage/v1/object/public/${bucket}/${key}`,
        path: key, bucket,
      });
    }

    // ── abort ─────────────────────────────────────────────────────────────
    if (action === 'abort') {
      // Sans cet appel, les morceaux déjà déposés resteraient facturés et
      // invisibles : ils n'appartiennent à aucun objet tant que l'envoi n'est
      // ni terminé ni abandonné.
      await client.abortMultipartUpload(bucket, key, uploadId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: `Action inconnue : ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur multipart';
    console.error(`[upload/multipart] ${action} :`, message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
