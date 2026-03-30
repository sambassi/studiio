import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { count: userCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
const { count: videoCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });

    const { count: subscriptionCount } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const data = {
      totalUsers: userCount || 0,
      totalVideos: videoCount || 0,
      activeSubscriptions: subscriptionCount || 0,
      monthlyRevenue: 0,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
