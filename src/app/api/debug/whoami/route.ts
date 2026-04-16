import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ loggedIn: false });
  }
  const info: any = {
    loggedIn: true,
    session: {
      id: (session.user as any).id,
      email: session.user.email,
      name: session.user.name,
      plan: (session.user as any).plan,
    },
  };
  if (session.user.email) {
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('id, email, name, credits, plan, created_at')
      .eq('email', session.user.email)
      .maybeSingle();
    info.userByEmail = userRow;
    info.idMatches = userRow?.id === (session.user as any).id;
    if (userRow?.id) {
      const { data: byEmail } = await supabaseAdmin
        .from('social_accounts')
        .select('platform, connected')
        .eq('user_id', userRow.id);
      info.socialAccountsByEmailUser = byEmail;
    }
    const sid = (session.user as any).id;
    if (sid) {
      const { data: bySession } = await supabaseAdmin
        .from('social_accounts')
        .select('platform, connected')
        .eq('user_id', sid);
      info.socialAccountsBySessionUser = bySession;
    }
  }
  return NextResponse.json(info);
}
