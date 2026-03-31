import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    // Get total users
    const { count: totalUsersCount } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Get active users (with activity in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: activeUsersCount } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gt('updated_at', thirtyDaysAgo.toISOString());

    // Get total revenue from purchases
    const { data: revenueData } = await supabaseAdmin
      .from('credit_transactions')
      .select('amount')
      .eq('type', 'purchase');

    const totalRevenue = revenueData?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;

    // Get this month's revenue
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: monthlyRevenueData } = await supabaseAdmin
      .from('credit_transactions')
      .select('amount')
      .eq('type', 'purchase')
      .gte('created_at', monthStart);

    const monthlyRevenue = monthlyRevenueData?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;

    // Get total videos
    const { count: videoCount } = await supabaseAdmin
      .from('videos')
      .select('*', { count: 'exact', head: true });

    // Get active subscriptions
    const { count: activeSubscriptions } = await supabaseAdmin
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Get new users this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { count: newUsersThisWeek } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString());

    // Get videos created this week
    const { count: videosThisWeek } = await supabaseAdmin
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString());

    const data = {
      totalUsers: totalUsersCount || 0,
      activeUsers: activeUsersCount || 0,
      totalRevenue,
      monthlyRevenue,
      totalVideos: videoCount || 0,
      activeSubscriptions: activeSubscriptions || 0,
      newUsersThisWeek: newUsersThisWeek || 0,
      videosThisWeek: videosThisWeek || 0,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
