import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

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

    if (!video.video_url) {
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
        // Platform-specific publishing logic
        let publishResult: { success: boolean; platformPostId?: string; platformUrl?: string; error?: string };

        switch (platform) {
          case 'instagram':
            publishResult = await publishToInstagram(account, video, caption, hashtags);
            break;
          case 'facebook':
            publishResult = await publishToFacebook(account, video, caption, hashtags);
            break;
          case 'tiktok':
            publishResult = await publishToTikTok(account, video, caption, hashtags);
            break;
          case 'youtube':
            publishResult = await publishToYouTube(account, video, caption, hashtags);
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
        .eq('id', scheduledPostId);
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

    return { success: false, error: publishData.error?.message || 'Failed to publish' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Instagram API error' };
  }
}

async function publishToFacebook(
  account: any,
  video: any,
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
    // Step 1: Initialize resumable upload
    const initRes = await fetch(
      `https://graph.facebook.com/v24.0/${pageId}/videos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'start',
          file_size: 0, // Will be determined by Facebook from URL
          access_token: accessToken,
        }),
      }
    );

    const initData = await initRes.json();
    if (!initData.upload_session_id) {
      // Fallback: direct video URL posting
      const directRes = await fetch(
        `https://graph.facebook.com/v24.0/${pageId}/videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_url: video.video_url,
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
      return { success: false, error: directData.error?.message || 'Facebook upload failed' };
    }

    return { success: true, platformPostId: initData.video_id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Facebook API error' };
  }
}

async function publishToTikTok(
  account: any,
  video: any,
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
            video_url: video.video_url,
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
        privacyStatus: 'private', // Start as private for safety
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
      return {
        success: false,
        error: errData.error?.message || `YouTube API error: ${initRes.status}`,
      };
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      return { success: false, error: 'YouTube did not return upload URL' };
    }

    // Download video and upload to YouTube
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

    return {
      success: false,
      error: uploadData.error?.message || 'YouTube upload failed',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'YouTube API error' };
  }
}
