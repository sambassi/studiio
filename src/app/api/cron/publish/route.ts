import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// Verify the request comes from Vercel Cron
function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// GET /api/cron/publish - Automatically publish scheduled posts whose time has passed
export async function GET(req: NextRequest) {
  // Security: only allow Vercel Cron to trigger this
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentTime = now.toTimeString().slice(0, 5);  // HH:MM

    console.log(`[CRON] Checking scheduled posts at ${todayDate} ${currentTime}`);

    // Find all posts that are scheduled and whose date/time has passed
    // We look for:
    // 1. Posts with scheduled_date < today (past days, missed)
    // 2. Posts with scheduled_date = today AND scheduled_time <= current time
    const { data: duePosts, error: fetchError } = await supabase
      .from('scheduled_posts')
      .select('*, videos:video_id(*)')
      .eq('status', 'scheduled')
      .or(`scheduled_date.lt.${todayDate},and(scheduled_date.eq.${todayDate},scheduled_time.lte.${currentTime})`)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })
      .limit(10); // Process max 10 per run to stay within timeout

    if (fetchError) {
      console.error('[CRON] Error fetching due posts:', fetchError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    if (!duePosts || duePosts.length === 0) {
      console.log('[CRON] No posts due for publishing');
      return NextResponse.json({ success: true, published: 0, message: 'No posts due' });
    }

    console.log(`[CRON] Found ${duePosts.length} posts to publish`);

    const results: Array<{
      postId: string;
      title: string;
      platforms: string[];
      success: boolean;
      details: any;
    }> = [];

    for (const post of duePosts) {
      // Mark as "publishing" to prevent double-processing
      await supabase
        .from('scheduled_posts')
        .update({ status: 'publishing' })
        .eq('id', post.id);

      try {
        // Get the user's social accounts
        const { data: accounts } = await supabase
          .from('social_accounts')
          .select('*')
          .eq('user_id', post.user_id)
          .eq('connected', true);

        if (!accounts || accounts.length === 0) {
          await supabase
            .from('scheduled_posts')
            .update({ status: 'failed', metadata: { ...post.metadata, error: 'No connected social accounts' } })
            .eq('id', post.id);
          results.push({ postId: post.id, title: post.title, platforms: post.platforms, success: false, details: 'No social accounts' });
          continue;
        }

        // Check if post has a video with a URL
        const video = post.videos;
        if (!video || !video.video_url) {
          // If no video_id, try using media_url directly
          if (!post.media_url) {
            await supabase
              .from('scheduled_posts')
              .update({ status: 'failed', metadata: { ...post.metadata, error: 'No video or media URL' } })
              .eq('id', post.id);
            results.push({ postId: post.id, title: post.title, platforms: post.platforms, success: false, details: 'No media' });
            continue;
          }
        }

        const videoUrl = video?.video_url || post.media_url;
        const videoData = video || { title: post.title, video_url: videoUrl };

        const platformResults: Array<{ platform: string; success: boolean; error?: string }> = [];

        for (const platform of (post.platforms || [])) {
          const account = accounts.find((a: any) => a.platform === platform.toLowerCase());
          if (!account) {
            platformResults.push({ platform, success: false, error: `${platform} not connected` });
            continue;
          }

          try {
            let result: { success: boolean; platformPostId?: string; platformUrl?: string; error?: string };

            switch (platform.toLowerCase()) {
              case 'instagram':
                result = await publishToInstagram(account, videoData, post.caption);
                break;
              case 'facebook':
                result = await publishToFacebook(account, videoData, post.caption);
                break;
              case 'tiktok':
                result = await publishToTikTok(account, videoData, post.caption);
                break;
              case 'youtube':
                result = await publishToYouTube(account, videoData, post.caption);
                break;
              default:
                result = { success: false, error: `Unsupported platform: ${platform}` };
            }

            // Record in publishing_history
            await supabase
              .from('publishing_history')
              .insert({
                video_id: post.video_id || null,
                social_account_id: account.id,
                scheduled_post_id: post.id,
                platform: platform.toLowerCase(),
                status: result.success ? 'published' : 'failed',
                platform_post_id: result.platformPostId,
                platform_url: result.platformUrl,
                error_message: result.error,
                published_at: result.success ? new Date().toISOString() : null,
              });

            platformResults.push({
              platform,
              success: result.success,
              error: result.error,
            });
          } catch (err) {
            platformResults.push({
              platform,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }

        const anySuccess = platformResults.some((r) => r.success);
        const allFailed = platformResults.every((r) => !r.success);

        // Update post status
        await supabase
          .from('scheduled_posts')
          .update({
            status: allFailed ? 'failed' : 'published',
            published_at: anySuccess ? new Date().toISOString() : null,
            metadata: {
              ...post.metadata,
              cron_publish_results: platformResults,
              cron_published_at: new Date().toISOString(),
            },
          })
          .eq('id', post.id);

        // Update video status if applicable
        if (anySuccess && post.video_id) {
          await supabase
            .from('videos')
            .update({ status: 'published' })
            .eq('id', post.video_id);
        }

        results.push({
          postId: post.id,
          title: post.title,
          platforms: post.platforms,
          success: anySuccess,
          details: platformResults,
        });
      } catch (err) {
        console.error(`[CRON] Error processing post ${post.id}:`, err);
        await supabase
          .from('scheduled_posts')
          .update({
            status: 'failed',
            metadata: { ...post.metadata, error: err instanceof Error ? err.message : 'Unknown error' },
          })
          .eq('id', post.id);
        results.push({
          postId: post.id,
          title: post.title,
          platforms: post.platforms,
          success: false,
          details: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const summary = {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    console.log(`[CRON] Publishing complete:`, summary);

    return NextResponse.json({
      success: true,
      ...summary,
      results,
    });
  } catch (error) {
    console.error('[CRON] Fatal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


// ══════════════════════════════════════════════════════════════
// PLATFORM-SPECIFIC PUBLISHING FUNCTIONS (same as /api/social/publish)
// ══════════════════════════════════════════════════════════════

async function publishToInstagram(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const igAccountId = account.account_id;

  if (!accessToken || !igAccountId) {
    return { success: false, error: 'Instagram credentials missing' };
  }

  const fullCaption = caption || video.title || '';

  try {
    // Step 1: Create media container (Reels)
    const createRes = await fetch(
      `https://graph.facebook.com/v24.0/${igAccountId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: video.video_url,
          caption: fullCaption,
          share_to_feed: true,
          access_token: accessToken,
        }),
      }
    );

    const createData = await createRes.json();
    if (!createData.id) {
      return { success: false, error: createData.error?.message || 'Failed to create media container' };
    }

    const containerId = createData.id;

    // Step 2: Poll until processing is complete (max 30 attempts for cron, 5s each = 150s)
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status === 'IN_PROGRESS' && attempts < 30) {
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

    return { success: false, error: publishData.error?.message || 'Failed to publish' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Instagram API error' };
  }
}

async function publishToFacebook(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;
  const pageId = account.account_id;

  if (!accessToken || !pageId) {
    return { success: false, error: 'Facebook credentials missing' };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v24.0/${pageId}/videos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: video.video_url,
          description: caption || video.title || '',
          access_token: accessToken,
        }),
      }
    );

    const data = await res.json();
    if (data.id) {
      return {
        success: true,
        platformPostId: data.id,
        platformUrl: `https://www.facebook.com/${pageId}/videos/${data.id}`,
      };
    }
    return { success: false, error: data.error?.message || 'Facebook upload failed' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Facebook API error' };
  }
}

async function publishToTikTok(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;

  if (!accessToken) {
    return { success: false, error: 'TikTok credentials missing' };
  }

  try {
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
            title: (caption || video.title || '').slice(0, 150),
            privacy_level: 'SELF_ONLY',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: video.video_url,
          },
        }),
      }
    );

    const initData = await initRes.json();
    if (initData.data?.publish_id) {
      return { success: true, platformPostId: initData.data.publish_id };
    }
    return { success: false, error: initData.error?.message || 'TikTok upload failed' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'TikTok API error' };
  }
}

async function publishToYouTube(
  account: any,
  video: any,
  caption?: string,
): Promise<{ success: boolean; platformPostId?: string; platformUrl?: string; error?: string }> {
  const accessToken = account.access_token;

  if (!accessToken) {
    return { success: false, error: 'YouTube credentials missing' };
  }

  try {
    const metadata = {
      snippet: {
        title: (caption || video.title || '').slice(0, 100),
        description: `${caption || video.title || ''}\n\nPowered by Afroboost - afroboost.com`,
        categoryId: '22',
      },
      status: {
        privacyStatus: 'private',
        selfDeclaredMadeForKids: false,
      },
    };

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
      return { success: false, error: errData.error?.message || `YouTube API error: ${initRes.status}` };
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      return { success: false, error: 'YouTube did not return upload URL' };
    }

    const videoRes = await fetch(video.video_url);
    if (!videoRes.ok) {
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
    return { success: false, error: uploadData.error?.message || 'YouTube upload failed' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'YouTube API error' };
  }
}
