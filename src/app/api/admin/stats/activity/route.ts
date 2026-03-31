import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/stats/activity - Last 10 actions feed
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const activities: any[] = [];

    // Recent signups
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    users?.forEach((u) => {
      activities.push({
        type: 'signup',
        message: `${u.name || u.email} s'est inscrit`,
        email: u.email,
        timestamp: u.created_at,
      });
    });

    // Recent payments
    const { data: payments } = await supabase
      .from('credit_transactions')
      .select('id, user_id, amount, type, created_at')
      .in('type', ['purchase', 'subscription'])
      .order('created_at', { ascending: false })
      .limit(5);

    payments?.forEach((p) => {
      activities.push({
        type: 'payment',
        message: `Paiement de ${Math.abs(p.amount)} credits (${p.type})`,
        timestamp: p.created_at,
      });
    });

    // Recent videos
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    videos?.forEach((v) => {
      activities.push({
        type: 'video',
        message: `Video "${v.title}" - ${v.status}`,
        timestamp: v.created_at,
      });
    });

    // Sort by timestamp and take 10 most recent
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ success: true, data: activities.slice(0, 10) });
  } catch (error) {
    console.error('Activity feed error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch activity' }, { status: 500 });
  }
}
