import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export async function GET() {
  const session = await auth();
  const debug: any = {
    env: {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null,
      hasServiceKey: !!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  };
  if (!session?.user) {
    return NextResponse.json({ loggedIn: false, debug });
  }
  const info: any = {
    loggedIn: true,
    session: {
      id: (session.user as any).id,
      email: session.user.email,
      name: session.user.name,
      plan: (session.user as any).plan,
    },
    debug,
  };
  try {
    const { count: userCount } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
    info.debug.totalUsersInDB = userCount;
  } catch (e: any) { info.debug.usersQueryError = e?.message; }
  try {
    const { count: saCount } = await supabaseAdmin.from('social_accounts').select('*', { count: 'exact', head: true });
    info.debug.totalSocialAccountsInDB = saCount;
  } catch (e: any) { info.debug.socialAccountsQueryError = e?.message; }
  if (session.user.email) {
    const { data: userRow, error: userErr } = await supabaseAdmin.from('users').select('id, email, name, credits, plan').eq('email', session.user.email).maybeSingle();
    info.userByEmail = userRow;
    info.userByEmailError = userErr?.message || null;
    info.idMatches = userRow?.id === (session.user as any).id;
    if (userRow?.id) {
      const { data: byEmail } = await supabaseAdmin.from('social_accounts').select('platform, connected').eq('user_id', userRow.id);
      info.socialAccountsByEmailUser = byEmail;
    }
    const sid = (session.user as any).id;
    if (sid) {
      const { data: bySession } = await supabaseAdmin.from('social_accounts').select('platform, connected').eq('user_id', sid);
      info.socialAccountsBySessionUser = bySession;
    }
  }
  return NextResponse.json(info);
}
