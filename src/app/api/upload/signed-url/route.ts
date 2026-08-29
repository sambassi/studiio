import { NextRequest, NextResponse } from 'next/server';
import { purposeAcceptable } from '@/lib/storage/acces-objet';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { sanitizeStorageFilename } from '@/lib/storage/sanitize-filename';
import { Client as MinioClient } from 'minio';

export const dynamic = 'force-dynamic';

/**
 * Durée de validité d'une URL présignée, en secondes.
 *
 * Quinze minutes : de quoi téléverser 75 Mo sur une connexion médiocre, sans
 * laisser traîner une autorisation d'écriture au-delà de l'envoi qu'elle sert.
 */
const PRESIGNED_TTL_S = 900;

/**
 * Client MinIO pointant sur l'endpoint PUBLIC.
 *
 * ⚠️ CE N'EST PAS LE CLIENT DU SERVEUR. Celui de `s3-client.ts` vise
 * `studiio-minio:9000`, un hostname interne que le navigateur ne sait pas
 * résoudre — une URL présignée fabriquée avec lui serait injouable dehors.
 * La signature porte l'hôte : il faut donc signer AVEC le nom public.
 *
 * ⚠️ LA RÉGION EST FIXÉE, ET CE N'EST PAS COSMÉTIQUE. Sans elle, le SDK
 * MinIO va DEMANDER la région du compartiment au serveur avant de signer —
 * une requête réseau sortante depuis l'application vers l'hôte public, à
 * chaque appel. Elle coûte une latence à chaque envoi, et surtout elle
 * échoue si l'application ne peut pas joindre ce nom (DNS interne, sortie
 * réseau filtrée) : le repli renverrait alors tout le monde vers le relais,
 * et le correctif aurait l'air de ne pas marcher, sans rien dans les
 * journaux du navigateur pour le dire. Avec une région fixée, la signature
 * est purement locale. `us-east-1` est la valeur par défaut de MinIO.
 *
 * Rend `null` tant que `MINIO_PUBLIC_ENDPOINT` n'est pas configuré : l'envoi
 * repasse alors par le relais applicatif, exactement comme avant.
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

// POST /api/upload/signed-url — Generate a signed upload URL for direct Supabase Storage upload
// This bypasses Vercel's 4.5MB body size limit for serverless functions
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { filename, contentType, purpose } = await req.json();

    if (!filename || !contentType) {
      return NextResponse.json({ success: false, error: 'Missing filename or contentType' }, { status: 400 });
    }

    const bucket = contentType.startsWith('audio/') ? 'audio' : 'media';
    const timestamp = Date.now();
    const safeFilename = sanitizeStorageFilename(filename);
    // `purpose` entre TEL QUEL dans la clé : il doit être refusé s'il vise
    // l'espace de noms réservé aux vignettes d'analyse, sans quoi le serveur
    // délivrerait une clé que la lecture publique refuse ensuite.
    const usage = typeof purpose === 'string' && purpose.length > 0 ? purpose : 'rush';
    if (!purposeAcceptable(usage)) {
      return NextResponse.json(
        { success: false, error: 'purpose invalide' }, { status: 422 },
      );
    }
    const storagePath = `${session.user.id}/${usage}/${timestamp}-${safeFilename}`;

    // Quand on est sur S3/MinIO (Hetzner), on ne peut pas exposer un
    // presigned URL MinIO direct au browser : le hostname interne
    // `studiio-minio:9000` n'est pas résolvable depuis l'extérieur.
    // On retourne plutôt un URL pointant vers notre proxy PUT côté
    // Next.js (/api/storage/upload) qui authentifie via session cookie
    // et stream vers MinIO en interne.
    if ((process.env.STORAGE_PROVIDER || '').toLowerCase() === 's3') {
      /**
       * URL de LECTURE — inchangée, et volontairement.
       *
       * Elle passe par la route de l'application, qui relaie MinIO en interne.
       * La faire pointer sur l'endpoint public supposerait que le compartiment
       * autorise la lecture anonyme : si ce n'est pas le cas, TOUS les
       * fichiers déposés deviendraient illisibles — un bug bien pire que
       * celui qu'on corrige, et invisible avant qu'un utilisateur ne rouvre
       * son montage.
       *
       * La bascule reste possible sans toucher au code : `PUBLIC_STORAGE_URL`
       * existe déjà pour ça (voir `s3-client.ts`), et sera la seule chose à
       * changer le jour où la lecture anonyme est ouverte.
       */
      const publicUrl = `/storage/v1/object/public/${bucket}/${storagePath}`;

      // ── Envoi DIRECT, quand l'endpoint public est déployé ───────────────
      // Le navigateur écrit dans MinIO sans traverser l'application : c'est
      // ce qui supprime les 502 sur les gros fichiers, où Traefik coupait la
      // connexion pendant que l'app relayait 75 Mo.
      const publicClient = clientPublic();
      if (publicClient) {
        try {
          const signedUrl = await publicClient.presignedPutObject(
            bucket, storagePath, PRESIGNED_TTL_S,
          );
          return NextResponse.json({
            success: true,
            signedUrl,
            mode: 'direct',
            token: '',
            path: storagePath,
            publicUrl,
            bucket,
          });
        } catch (presignError) {
          // Une signature ratée ne doit pas bloquer l'envoi : on retombe sur
          // le relais, qui marche pour tout ce qui tient dans le délai.
          console.error('[SignedUrl] presignedPutObject a échoué, repli sur le relais :', presignError);
        }
      }

      // ── Repli : le relais applicatif, comportement historique ───────────
      const proxyUrl = `/api/storage/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`;
      return NextResponse.json({
        success: true,
        signedUrl: proxyUrl, // PUT vers cet URL avec credentials: 'include'
        mode: 'proxy',
        token: '',
        path: storagePath,
        publicUrl,
        bucket,
      });
    }

    // Sinon (Supabase legacy), comportement historique
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error('[SignedUrl] Error creating signed URL:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      success: true,
      signedUrl: data.signedUrl,
      // Supabase signe aussi une URL d'écriture directe : du point de vue de
      // l'appelant, c'est le même geste qu'un présigné MinIO.
      mode: 'direct',
      token: data.token,
      path: storagePath,
      publicUrl: urlData.publicUrl,
      bucket,
    });
  } catch (error) {
    console.error('[SignedUrl] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create signed URL' }, { status: 500 });
  }
}
