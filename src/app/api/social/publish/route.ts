import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getValidToken } from '@/lib/social/token-refresh';
import { isWhatsAppEnabled, canUseWhatsApp, broadcastWhatsApp, resolveRecipients, formatBroadcastFailures } from '@/lib/social/whatsapp';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { resolvePublishableUrl } from '@/lib/videos/playable-url';

// POST /api/social/publish - Publish a video to social platforms
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { videoId, platforms, caption, hashtags, scheduledPostId } = body;

    if (!videoId) {
      return NextResponse.json({ success: false, error: 'videoId is required' }, { status: 400 });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one platform is required' }, { status: 400 });
    }

    // Get video details
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', session.user.id)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    // ── URL a publier ────────────────────────────────────────────────
    // La colonne d'abord, puis le montage compose dans le navigateur
    // (`metadata.renderedVideoUrl`) — que `POST /api/videos` refuse en
    // colonne, a raison. JAMAIS le rush brut : publier la video source a la
    // place du montage est irreversible, le fichier part chez un tiers sous
    // le nom de l'utilisateur.
    //
    // L'URL est validee avant d'aller plus loin : elle peut venir des
    // metadonnees, donc d'un navigateur. Et le publieur YouTube TELECHARGE le
    // fichier depuis notre serveur — une URL non verifiee y deviendrait une
    // requete sortante vers le reseau interne.
    //
    // Ce refus precede tout appel reseau et toute ecriture en base : le
    // statut de la video n'est pas touche, aucun credit n'est engage.
    const mediaUrl = resolvePublishableUrl(video);
    if (!mediaUrl) {
      return NextResponse.json(
        { success: false, error: 'Video has no output URL. Complete rendering first.' },
        { status: 400 }
      );
    }

    // Get user's connected social accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('connected', true);

    if (accountsError) {
      return NextResponse.json({ success: false, error: 'Failed to fetch social accounts' }, { status: 500 });
    }

    const results: Array<{
      platform: string;
      success: boolean;
      message: string;
      publishingHistoryId?: string;
    }> = [];

    for (const platformName of platforms) {
      const platform = platformName.toLowerCase();

      // ── Canaux SANS compte social ────────────────────────────────────
      // Traites avant la recherche de compte, comme dans le cron : sinon ils
      // tomberaient sur « non connecte » puis sur le `default` du switch.
      if (platform === 'whatsapp') {
        if (!canUseWhatsApp(session.user.email)) {
          results.push({
            platform: platformName,
            success: false,
            message: isWhatsAppEnabled()
              ? 'WhatsApp : canal reserve au detenteur du compte Meta.'
              : 'WhatsApp : canal pas encore configure.',
          });
          continue;
        }
        // `metadata.whatsappTo` du post si on en a un ; sinon le numero
        // d'environnement (auto-test). Requete faite ici seulement, pour ne
        // rien couter aux publications qui ne visent pas WhatsApp.
        let waMeta: unknown = null;
        if (scheduledPostId) {
          const { data: sp } = await supabase
            .from('scheduled_posts')
            .select('metadata')
            .eq('id', scheduledPostId)
            // Filtre de propriete : `supabaseAdmin` contourne la RLS, sans lui
            // un utilisateur connaissant l'id d'un post d'un autre compte
            // declencherait des envois vers SA liste de destinataires.
            .eq('user_id', session.user.id)
            .single();
          waMeta = sp?.metadata ?? null;
        }
        const recipients = await resolveRecipients(waMeta, { ownerEmail: session.user.email });
        if (recipients.length === 0) {
          results.push({ platform: platformName, success: false, message: 'WhatsApp : aucun destinataire configure.' });
          continue;
        }
        // Une seule variable : le modele attend {{1}}. Un ecart de nombre ou
        // d'ordre renvoie l'erreur Meta 132018.
        const var1 = String(video?.title || caption || 'Nouvelle publication').slice(0, 900);
        const bc = await broadcastWhatsApp(recipients, { templateParams: [var1] });
        results.push({
          platform: platformName,
          success: bc.success,
          // Meme detail que le cron : code et message Meta, plus le numero
          // reellement vise apres normalisation.
          message: [
            bc.success
              ? `WhatsApp : ${bc.sent} envoye(s), ${bc.failed} echec(s).`
              : `WhatsApp : ${bc.failed} envoi(s) en echec.`,
            formatBroadcastFailures(bc),
            bc.truncated > 0 ? `${bc.truncated} destinataire(s) ignore(s) (plafond).` : null,
          ]
            .filter(Boolean)
            .join(' '),
        });
        continue;
      }

      const account = accounts?.find((a) => a.platform === platform);

      if (!account) {
        results.push({
          platform: platformName,
          success: false,
          message: `${platformName} non connecte. Connectez votre compte dans Reseaux Sociaux.`,
        });
        continue;
      }

      // Create publishing history record
      const { data: publishRecord } = await supabase
        .from('publishing_history')
        .insert({
          video_id: videoId,
          social_account_id: account.id,
          scheduled_post_id: scheduledPostId || null,
          platform,
          status: 'publishing',
        })
        .select()
        .single();

      try {
        // Rafraichissement du token AVANT publication. `getValidToken` ne
        // rafraichit que si `expires_at` est proche (buffer 5 min) et persiste
        // le nouveau token ; pour une plateforme qu'il ne gere pas, il rend le
        // token existant. Il THROW en cas d'echec : on rattrape ici pour que la
        // plateforme echoue seule, sans faire tomber les autres.
        // DEFAULT SAFE : si le refresh echoue, on publie avec le token
        // STOCKE, exactement comme avant ce changement. Laisser le throw
        // remonter empecherait la tentative alors qu'elle reussissait.
        //
        // Le cas Meta l'impose : le callback ecrit `expires_at` a +60 jours
        // alors qu'un Page Access Token n'expire pas. Passe ce delai, chaque
        // publication IG/FB declencherait `refreshMetaToken`, qui echange un
        // PAGE token via fb_exchange_token — au mieux une erreur, au pire un
        // USER token persiste a la place du page token, cassant IG/FB
        // jusqu'a reconnexion. Le repli neutralise ce risque tout en gardant
        // le benefice sur YouTube et TikTok, qui ont un vrai refresh_token.
        let freshToken = account.access_token;
        try {
          freshToken = await getValidToken(account.id);
        } catch (refreshErr) {
          console.warn(
            `[publish] Refresh token echoue pour ${platform}, on garde le token stocke:`,
            refreshErr instanceof Error ? refreshErr.message : refreshErr,
          );
        }
        const authedAccount = { ...account, access_token: freshToken };

        // Platform-specific publishing logic
        let publishResult: { success: boolean; platformPostId?: string; platformUrl?: string; error?: string };

        switch (platform) {
          case 'instagram':
            publishResult = await publishToInstagram(authedAccount, video, mediaUrl, caption, hashtags);
            break;
          case 'facebook':
            publishResult = await publishToFacebook(authedAccount, video, mediaUrl, caption, hashtags);
            break;
          case 'tiktok':
            publishResult = await publishToTikTok(authedAccount, video, mediaUrl, caption, hashtags);
            break;
          case 'youtube':
            publishResult = await publishToYouTube(authedAccount, video, mediaUrl, caption, hashtags);
            break;
          default:
            publishResult = { success: false, error: `Plateforme non supportee: ${platformName}` };
        }

        // Update publishing history
        if (publishRecord) {
          await supabase
            .from('publishing_history')
            .update({
              status: publishResult.success ? 'published' : 'failed',
              platform_post_id: publishResult.platformPostId,
              platform_url: publishResult.platformUrl,
              error_message: publishResult.error,
              published_at: publishResult.success ? new Date().toISOString() : null,
            })
            .eq('id', publishRecord.id);
        }

        results.push({
          platform: platformName,
          success: publishResult.success,
          message: publishResult.success
            ? `Publie sur ${platformName}`
            : publishResult.error || 'Echec de publication',
          publishingHistoryId: publishRecord?.id,
        });
      } catch (error) {
        console.error(`Error publishing to ${platformName}:`, error);
        if (publishRecord) {
          await supabase
            .from('publishing_history')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
            })
            .eq('id', publishRecord.id);
        }
        results.push({
          platform: platformName,
          success: false,
          message: `Erreur: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Update video status if at least one platform succeeded
    const anySuccess = results.some((r) => r.success);
    if (anySuccess) {
      await supabase
        .from('videos')
        .update({ status: 'published' })
        .eq('id', videoId);
    }

    // Update scheduled post if provided
    if (scheduledPostId && anySuccess) {
      await supabase
        .from('scheduled_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .eq('id', scheduledPostId)
        // Filtre de propriete, meme motif que la lecture plus haut.
        // Sans lui, un compte inscrit pouvait marquer « publie » le post d'un
        // AUTRE compte : le cron ne ramasse que les `scheduled`, la victime ne
        // publiait donc jamais. Le defaut preexistait, mais il fallait un
        // compte OAuth connecte ET une publication reelle reussie pour
        // l'atteindre. Le canal WhatsApp, qui reussit sans aucun compte
        // social, le rendait declenchable en un appel.
        .eq('user_id', session.user.id);
    }

    // Echec total : on PERSISTE le detail sur le post, sinon il ne vit que
    // dans la reponse HTTP et le Calendrier n'affiche rien. Meme forme que le
    // cron (`cron_publish_results`), pour que l'UI existante le rende sans
    // modification.
    if (scheduledPostId && !anySuccess && results.length > 0) {
      const { data: current } = await supabase
        .from('scheduled_posts')
        .select('metadata')
        .eq('id', scheduledPostId)
        .eq('user_id', session.user.id)
        .single();

      if (current) {
        await supabase
          .from('scheduled_posts')
          .update({
            metadata: {
              ...(current.metadata || {}),
              cron_publish_results: results.map((r) => ({
                platform: r.platform,
                success: r.success,
                error: r.message,
              })),
              cron_published_at: new Date().toISOString(),
            },
          })
          .eq('id', scheduledPostId)
          .eq('user_id', session.user.id);
      }
    }

    return NextResponse.json({
      success: anySuccess,
      results,
      summary: {
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (error) {
    console.error('Social publish error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
// PLATFORM-SPECIFIC PUBLISHING FUNCTIONS
// Ported from desktop social-publisher.ts
// ══════════════════════════════════════════════════════════════

async function publishToInstagram(
  account: any,
  video: any,
  /** URL deja resolue ET validee par `resolvePublishableUrl`. */
  mediaUrl: string,
  caption?: string,
  hashtags?: string[],
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const igAccountId = account.account_id;

  if (!accessToken || !igAccountId) {
    return { success: false, error: 'Instagram credentials missing' };
  }

  const fullCaption = [
    caption || video.title,
    '',
    hashtags?.join(' ') || '',
  ].join('\n').trim();

  try {
    const publicVideoUrl = await ensurePublicUrl(mediaUrl);

    // Step 1: Create media container (Reels)
    const createRes = await fetch(
      `https://graph.facebook.com/v24.0/${igAccountId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: publicVideoUrl,
          caption: fullCaption,
          share_to_feed: true,
          access_token: accessToken,
        }),
      }
    );

    const createData = await createRes.json();
    if (!createData.id) {
      console.error('[SOCIAL_PUBLISH_ERROR]', {
        platform: 'instagram',
        step: 'container_create',
        code: createData.error?.code,
        message: createData.error?.message,
        fbtrace_id: createData.error?.fbtrace_id,
        response: createData,
      });
      return { success: false, error: createData.error?.message || 'Failed to create media container' };
    }

    const containerId = createData.id;

    // Step 2: Poll until processing is complete (max 60 attempts, 5s each)
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status === 'IN_PROGRESS' && attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const statusRes = await fetch(
        `https://graph.facebook.com/v24.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );
      const statusData = await statusRes.json();
      status = statusData.status_code;
      attempts++;
    }

    if (status !== 'FINISHED') {
      return { success: false, error: `Instagram processing failed. Status: ${status}` };
    }

    // Step 3: Publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v24.0/${igAccountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    );

    const publishData = await publishRes.json();
    if (publishData.id) {
      return {
        success: true,
        platformPostId: publishData.id,
        platformUrl: `https://www.instagram.com/p/${publishData.id}/`,
      };
    }

    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'instagram',
      step: 'media_publish',
      code: publishData.error?.code,
      message: publishData.error?.message,
      fbtrace_id: publishData.error?.fbtrace_id,
      response: publishData,
    });
    return { success: false, error: publishData.error?.message || 'Failed to publish' };
  } catch (error) {
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'instagram',
      step: 'exception',
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Instagram API error' };
  }
}

async function publishToFacebook(
  account: any,
  video: any,
  /** URL deja resolue ET validee par `resolvePublishableUrl`. */
  mediaUrl: string,
  caption?: string,
  hashtags?: string[],
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const pageId = account.account_id;

  if (!accessToken || !pageId) {
    return { success: false, error: 'Facebook credentials missing' };
  }

  const fullCaption = [caption || video.title, '', hashtags?.join(' ') || ''].join('\n').trim();

  try {
    const publicVideoUrl = await ensurePublicUrl(mediaUrl);

    // Post video directly by file_url (simpler + works for most FB page video uploads)
    const directRes = await fetch(
      `https://graph.facebook.com/v24.0/${pageId}/videos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: publicVideoUrl,
          description: fullCaption,
          access_token: accessToken,
        }),
      }
    );
    const directData = await directRes.json();
    if (directData.id) {
      return {
        success: true,
        platformPostId: directData.id,
        platformUrl: `https://www.facebook.com/${pageId}/videos/${directData.id}`,
      };
    }
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'facebook',
      step: 'video_post',
      code: directData.error?.code,
      message: directData.error?.message,
      fbtrace_id: directData.error?.fbtrace_id,
      response: directData,
    });
    return { success: false, error: directData.error?.message || 'Facebook upload failed' };
  } catch (error) {
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'facebook',
      step: 'exception',
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Facebook API error' };
  }
}

async function publishToTikTok(
  account: any,
  video: any,
  /** URL deja resolue ET validee par `resolvePublishableUrl`. */
  mediaUrl: string,
  caption?: string,
  hashtags?: string[],
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const openId = account.account_id;

  if (!accessToken || !openId) {
    return { success: false, error: 'TikTok credentials missing' };
  }

  const title = [caption || video.title, hashtags?.join(' ') || ''].join(' ').slice(0, 150);

  try {
    // TikTok Content Posting API v2
    const initRes = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title,
            privacy_level: 'SELF_ONLY', // Start as draft for safety
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: mediaUrl,
          },
        }),
      }
    );

    const initData = await initRes.json();
    if (initData.data?.publish_id) {
      return {
        success: true,
        platformPostId: initData.data.publish_id,
      };
    }

    return {
      success: false,
      error: initData.error?.message || 'TikTok upload init failed',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'TikTok API error' };
  }
}

async function publishToYouTube(
  account: any,
  video: any,
  /** URL deja resolue ET validee par `resolvePublishableUrl`. */
  mediaUrl: string,
  caption?: string,
  hashtags?: string[],
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;

  if (!accessToken) {
    return { success: false, error: 'YouTube credentials missing' };
  }

  const title = (caption || video.title).slice(0, 100);
  const description = [
    caption || video.title,
    '',
    hashtags?.join(' ') || '',
    '',
    'Powered by Afroboost - afroboost.com',
  ].join('\n');

  try {
    // YouTube Data API v3 - Insert video
    const metadata = {
      snippet: {
        title,
        description,
        tags: hashtags || [],
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus: 'public', // Publier directement en public (validé : YouTube accepte le passage public)
        selfDeclaredMadeForKids: false,
      },
    };

    // For YouTube, we need to do a resumable upload
    // First, initiate the upload
    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const errData = await initRes.json().catch(() => ({}));
      console.error('[SOCIAL_PUBLISH_ERROR]', {
        platform: 'youtube',
        step: 'upload_init',
        status: initRes.status,
        message: errData.error?.message,
        response: errData,
      });
      return {
        success: false,
        error: errData.error?.message || `YouTube API error: ${initRes.status}`,
      };
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      console.error('[SOCIAL_PUBLISH_ERROR]', { platform: 'youtube', step: 'upload_init', message: 'No Location header' });
      return { success: false, error: 'YouTube did not return upload URL' };
    }

    // Download video and upload to YouTube
    const publicVideoUrl = await ensurePublicUrl(mediaUrl);
    const videoRes = await fetch(publicVideoUrl);
    if (!videoRes.ok) {
      console.error('[SOCIAL_PUBLISH_ERROR]', { platform: 'youtube', step: 'download', status: videoRes.status });
      return { success: false, error: 'Failed to download video for YouTube upload' };
    }

    const videoBuffer = await videoRes.arrayBuffer();
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoBuffer.byteLength),
      },
      body: videoBuffer,
    });

    const uploadData = await uploadRes.json();
    if (uploadData.id) {
      return {
        success: true,
        platformPostId: uploadData.id,
        platformUrl: `https://www.youtube.com/shorts/${uploadData.id}`,
      };
    }

    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'youtube',
      step: 'upload',
      message: uploadData.error?.message,
      response: uploadData,
    });
    return {
      success: false,
      error: uploadData.error?.message || 'YouTube upload failed',
    };
  } catch (error) {
    console.error('[SOCIAL_PUBLISH_ERROR]', {
      platform: 'youtube',
      step: 'exception',
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'YouTube API error' };
  }
}

// ══════════════════════════════════════════════════════════════
// Ensure the media URL is fetchable by the platform.
// If it's a private Supabase path, create a 1h signed URL.
// Otherwise return it as-is (already public).
// ══════════════════════════════════════════════════════════════
async function ensurePublicUrl(url: string): Promise<string> {
  if (!url) return url;
  // Already a public Supabase URL or any external HTTPS URL → pass through
  if (url.includes('/storage/v1/object/public/')) return url;
  if (!url.includes('/storage/v1/object/')) return url;

  // Private Supabase path — try to derive { bucket, path } and sign for 1h
  try {
    // Pattern: .../storage/v1/object/(sign|authenticated|private)/<bucket>/<path...>?...
    const m = url.match(/\/storage\/v1\/object\/(?:sign|authenticated|private)\/([^/]+)\/([^?]+)/);
    if (!m) return url;
    const [, bucket, path] = m;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return url;
    return data.signedUrl;
  } catch {
    return url;
  }
}
