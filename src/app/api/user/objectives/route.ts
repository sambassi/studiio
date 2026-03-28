import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabase } from '@/lib/db/supabase';
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

    const { data, error } = await supabase
      .from('objectives')
      .select('*')
      .eq('user_id', session.user.id);

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch objectives' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { successallalse, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { data, error } = await supabase
      .from('objectives')
      .insert({
        ...body,
        user_id: session.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to create objective' },
      { status: 500 }
    );
  }
}
