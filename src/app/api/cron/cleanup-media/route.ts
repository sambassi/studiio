import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getFileType, getExpiresAt } from '@/lib/storage/retention';
import { storageKey, autopilotRushKeys } from '@/lib/storage/cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

/**
 * Fichiers que le nettoyage ne doit JAMAIS supprimer.
 *
 * Deux sources, et la seconde est arrivée après coup :
 *
 * 1. Les médias référencés par un post — le mécanisme d'origine.
 * 2. **La banque de rushes des Autopilotes ACTIFS.** Ces fichiers vivent
 *    dans `media/`, donc sous la rétention de 24 h, mais aucun post ne les
 *    référence tant qu'un cycle n'a pas tourné. Ils étaient donc supprimés
 *    au bout d'un jour, et le cycle suivant échouait en 404 au
 *    téléchargement du rush : l'Autopilote se vidait tout seul et ne
 *    produisait plus rien.
 *
 * Retirer un rush de la banque le rend de nouveau éligible : la protection
 * suit la référence, elle ne marque pas le fichier.
 */
async function getProtectedUrls(): Promise<Set<string>> {
  const urls = new Set<string>();

  const { data: posts } = await supabaseAdmin
    .from('scheduled_posts')
    .select('media_url, metadata')
    .in('status', ['scheduled', 'published', 'draft']);

  if (!posts) return urls;

  for (const post of posts) {
    if (post.media_url) urls.add(post.media_url);

    const meta = post.metadata as Record<string, any> | null;
    if (!meta) continue;

    const urlFields = [
      'videoUrl', 'rawVideoUrl', 'posterUrl',
      'musicUrl', 'voiceUrl', 'renderedVideoUrl',
    ];
    for (const field of urlFields) {
      if (meta[field]) urls.add(meta[field]);
    }
    if (Array.isArray(meta.rushUrls)) {
      for (const u of meta.rushUrls) {
        if (u) urls.add(u);
      }
    }
  }

  return urls;
}

/**
 * Le fichier est-il protégé, et par quoi ?
 *
 * ⚠️ LA COMPARAISON SE FAIT SUR LA CLÉ, PAS SUR L'URL. Une URL s'écrit de
 * plusieurs façons pour le même objet — avec ou sans hôte, `/public/` ou
 * `/sign/…?token=` — et deux formes différentes ne se reconnaissent pas. La
 * clé `<bucket>/<chemin>` est ce que MinIO indexe : elle est unique.
 */
function protection(
  publicUrl: string,
  protectedUrls: Set<string>,
  rushKeys: Set<string>,
): 'post' | 'rush' | null {
  const cle = storageKey(publicUrl);
  if (cle && rushKeys.has(cle)) return 'rush';
  return isProtected(publicUrl, protectedUrls) ? 'post' : null;
}

function isProtected(publicUrl: string, protectedUrls: Set<string>): boolean {
  for (const pUrl of protectedUrls) {
    if (publicUrl === pUrl || pUrl.includes(publicUrl) || publicUrl.includes(pUrl)) {
      return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const protectedUrls = await getProtectedUrls();
  // Les rushes des Autopilotes actifs, en CLÉS de stockage. `null` = lecture
  // impossible : on ne supprime alors RIEN, plutôt que de supprimer ce qu'on
  // n'a pas pu protéger.
  const banqueLue = await autopilotRushKeys();
  if (!banqueLue) {
    return NextResponse.json(
      { success: false, error: 'Banque de rushes illisible — aucune suppression tentée.' },
      { status: 503 },
    );
  }
  const rushKeys: Set<string> = banqueLue;
  const now = new Date();
  let exemptesPosts = 0;
  let exemptesRushes = 0;
  let candidats = 0;
  const buckets = ['media', 'audio'];
  const breakdown = { video: 0, audio: 0, image: 0 };
  let deleted = 0;
  let kept = 0;
  let preserved = 0;
  const errors: string[] = [];

  for (const bucket of buckets) {
    const { data: topLevel } = await supabaseAdmin.storage
      .from(bucket)
      .list('', { limit: 500 });

    if (!topLevel) continue;

    for (const userFolder of topLevel) {
      if (userFolder.id) continue;

      const { data: subFolders } = await supabaseAdmin.storage
        .from(bucket)
        .list(userFolder.name, { limit: 100 });

      if (!subFolders) continue;

      for (const sub of subFolders) {
        if (sub.id) {
          const path = `${userFolder.name}/${sub.name}`;
          await processFile(bucket, path, sub, now, protectedUrls, breakdown, errors);
          continue;
        }

        const { data: files } = await supabaseAdmin.storage
          .from(bucket)
          .list(`${userFolder.name}/${sub.name}`, { limit: 200 });

        if (!files) continue;

        for (const file of files) {
          if (!file.id) continue;
          const path = `${userFolder.name}/${sub.name}/${file.name}`;
          await processFile(bucket, path, file, now, protectedUrls, breakdown, errors);
        }
      }
    }
  }

  async function processFile(
    bucket: string,
    path: string,
    file: any,
    now: Date,
    protectedUrls: Set<string>,
    breakdown: Record<string, number>,
    errors: string[],
  ) {
    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    const publicUrl = urlData.publicUrl;
    candidats++;

    // La clé est reconstruite depuis le bucket et le chemin, PAS depuis
    // l'URL publique : `getPublicUrl` dépend de variables d'environnement et
    // peut rendre une forme relative selon le contexte d'exécution.
    const cle = `${bucket}/${path}`;
    if (rushKeys.has(cle)) {
      exemptesRushes++;
      preserved++;
      return;
    }
    if (protection(publicUrl, protectedUrls, rushKeys)) {
      exemptesPosts++;
      preserved++;
      return;
    }

    const type = getFileType(file.name);
    const createdAt = new Date((file as any).created_at || now.toISOString());
    const expiresAt = getExpiresAt(createdAt, type);

    if (now < expiresAt) {
      kept++;
      return;
    }

    const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
    if (error) {
      errors.push(`${path}: ${error.message}`);
      kept++;
    } else {
      deleted++;
      breakdown[type]++;
    }
  }

  // Le detail des exemptions, pour qu'on puisse VERIFIER en production que
  // les rushes sont protegés — et non le deviner. `exemptesRushes: 0` alors
  // qu'une banque est garnie signale que le rapprochement ne prend pas.
  console.log(
    `[CLEANUP-MEDIA] candidats=${candidats} supprimes=${deleted} `
    + `(video=${breakdown.video}, audio=${breakdown.audio}, image=${breakdown.image}) `
    + `conserves=${kept} exemptes=${preserved} `
    + `(posts=${exemptesPosts}, rushes-autopilote=${exemptesRushes}) `
    + `| banque=${rushKeys.size} cles`,
  );

  return NextResponse.json({
    success: true,
    candidats,
    deleted,
    kept,
    preserved,
    exemptes: { posts: exemptesPosts, rushesAutopilote: exemptesRushes, banque: rushKeys.size },
    breakdown,
    errors: errors.length > 0 ? errors : undefined,
  });
}
