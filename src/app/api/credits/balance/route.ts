import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getUserCredits } from '@/lib/credits/system';
import { ApiResponse } from '@/lib/types/api';

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse<{ credits: number }>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const credits = await getUserCredits(session.user.id);

    return NextResponse.json({ success: true, data: { credits } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch credits balance' },
      { status: 500 }
    );
  }
}
