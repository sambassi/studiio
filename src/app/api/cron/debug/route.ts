import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// POST /api/cron/debug - Reset a failed post back to "scheduled" so the cron picks it up again
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { postId, action } = body;

    if (action === 'retry' && postId) {
      const { data, error } = await supabase
        .from('scheduled_posts')
        .update({ status: 'scheduled' })
        .eq('id', postId)
        .eq('user_id', session.user.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Post "${data.title}" reset to "scheduled". The cron will pick it up within 1 minute.`,
        post: { id: data.id, title: data.title, status: data.status, scheduled: `${data.scheduled_date} ${data.scheduled_time}` },
      });
    }

    if (action === 'retry_all') {
      const { data, error } = await supabase
        .from('scheduled_posts')
        .update({ status: 'scheduled' })
        .eq('user_id', session.user.id)
        .eq('status', 'failed')
        .select();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `${data?.length || 0} failed post(s) reset to "scheduled".`,
        posts: data?.map((p) => ({ id: p.id, title: p.title })),
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use "retry" with postId or "retry_all".' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

// GET /api/cron/debug - Debug scheduled posts and social accounts (authenticated users only)
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // 1. Get all scheduled posts for this user
    const { data: posts, error: postsError } = await supabase
      .from('scheduled_posts')
      .select('id, title, caption, media_url, media_type, format, platforms, scheduled_date, scheduled_time, status, video_id, metadata')
      .eq('user_id', userId)
      .order('scheduled_date', { ascending: false })
      .limit(10);

    // 2. Get all connected social accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('social_accounts')
      .select('id, platform, account_id, account_name, connected, expires_at, access_token')
      .eq('user_id', userId);

    // Mask tokens for security
    const safeAccounts = accounts?.map((a) => ({
      ...a,
      access_token: a.access_token ? `${a.access_token.substring(0, 10)}...${a.access_token.substring(a.access_token.length - 5)}` : 'NULL',
      token_expired: a.expires_at ? new Date(a.expires_at) < new Date() : 'no_expiry_set',
    }));

    // 3. Get publishing history
    const { data: history, error: historyError } = await supabase
      .from('publishing_history')
      .select('id, platform, status, error_message, platform_post_id, published_at, created_at, scheduled_post_id')
      .eq('video_id', posts?.[0]?.video_id || '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: false })
      .limit(10);

    // 4. Get recent publishing history for ALL posts of this user
    const postIds = posts?.map((p) => p.id) || [];
    const { data: allHistory } = await supabase
      .from('publishing_history')
      .select('id, platform, status, error_message, scheduled_post_id, created_at')
      .in('scheduled_post_id', postIds.length > 0 ? postIds : ['none'])
      .order('created_at', { ascending: false })
      .limit(20);

    // 5. Check if videos exist for posts with video_id
    const videoIds = posts?.filter((p) => p.video_id).map((p) => p.video_id) || [];
    let videos: any[] = [];
    if (videoIds.length > 0) {
      const { data: vids } = await supabase
        .from('videos')
        .select('id, title, video_url, status')
        .in('id', videoIds);
      videos = vids || [];
    }

    // 6. Timezone check
    const now = new Date();
    const parisFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parisTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false });

    // 7. Diagnose issues for each post
    const diagnostics = posts?.map((post) => {
      const issues: string[] = [];

      // Check status
      if (post.status !== 'scheduled') {
        issues.push(`Status is "${post.status}" — must be "scheduled" for cron to pick it up`);
      }

      // Check media
      if (!post.video_id && !post.media_url) {
        issues.push('No video_id and no media_url — post has no media to publish');
      }

      const video = videos.find((v) => v.id === post.video_id);
      if (post.video_id && !video) {
        issues.push(`video_id ${post.video_id} not found in videos table`);
      }
      if (video && !video.video_url) {
        issues.push(`Video exists but video_url is null — video not rendered yet`);
      }

      // Check platforms
      if (!post.platforms || post.platforms.length === 0) {
        issues.push('No platforms selected');
      }

      // Check social accounts for each platform
      for (const platform of (post.platforms || [])) {
        const account = accounts?.find((a) => a.platform === platform.toLowerCase() && a.connected);
        if (!account) {
          issues.push(`No connected account for "${platform}"`);
        } else if (account.expires_at && new Date(account.expires_at) < new Date()) {
          issues.push(`Token expired for "${platform}" (expired: ${account.expires_at})`);
        }
      }

      // Check time
      const userTz = post.metadata?.timezone || 'Europe/Paris';
      const userDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const userTime = new Intl.DateTimeFormat('en-GB', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      const isDue = post.scheduled_date < userDate || (post.scheduled_date === userDate && post.scheduled_time <= userTime);
      if (!isDue && post.status === 'scheduled') {
        issues.push(`Not yet due. Scheduled: ${post.scheduled_date} ${post.scheduled_time}, Current (${userTz}): ${userDate} ${userTime}`);
      }

      // Check publishing history
      const postHistory = allHistory?.filter((h) => h.scheduled_post_id === post.id) || [];

      if (issues.length === 0) {
        issues.push('No issues found — post looks ready to publish');
      }

      return {
        postId: post.id,
        title: post.title,
        status: post.status,
        platforms: post.platforms,
        scheduled: `${post.scheduled_date} ${post.scheduled_time}`,
        has_video_id: !!post.video_id,
        has_media_url: !!post.media_url,
        media_url_preview: post.media_url ? post.media_url.substring(0, 80) + '...' : null,
        video: video ? { id: video.id, has_url: !!video.video_url, status: video.status } : null,
        timezone: post.metadata?.timezone || 'Europe/Paris (default)',
        issues,
        recent_publish_attempts: postHistory,
      };
    });

    return NextResponse.json({
      success: true,
      server_time_utc: now.toISOString(),
      server_time_paris: `${parisFmt.format(now)} ${parisTimeFmt.format(now)}`,
      user_id: userId,
      posts_count: posts?.length || 0,
      social_accounts: safeAccounts,
      post_diagnostics: diagnostics,
      errors: {
        posts: postsError?.message,
        accounts: accountsError?.message,
        history: historyError?.message,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
