import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { addCredits, deductCredits } from '@/lib/credits/system';
import { ApiResponse } from '@/lib/types/api';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const userId = params.id;
    const body = await req.json();
    const { amount, reason, type } = body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid amount. Must be a positive number.' },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Reason is required.' },
        { status: 400 }
      );
    }

    if (!type || !['bonus', 'refund', 'deduction'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Type must be "bonus", "refund", or "deduction".' },
        { status: 400 }
      );
    }

    // Apply credits based on type
    if (type === 'deduction') {
      await deductCredits(userId, amount, reason);
    } else if (type === 'bonus' || type === 'refund') {
      await addCredits(userId, amount, type);
    }

    // Log the action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'credit_transaction',
      targetType: 'user',
      targetId: userId,
      details: { amount, reason, type },
    });

    return NextResponse.json({
      success: true,
      message: `Credits ${type === 'deduction' ? 'deducted' : 'added'} successfully`,
      data: { amount, type, reason },
    });
  } catch (error) {
    console.error('Error managing credits:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to manage credits';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
