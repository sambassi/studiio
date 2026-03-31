import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { ApiResponse } from '@/lib/types/api';

/**
 * Sends a test email to verify email configuration
 * POST /api/admin/email/test
 * Body: { to: string, subject: string, body: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const body = await req.json();
    const { to, subject, emailBody } = body;

    // Validate input
    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { success: false, error: 'to, subject, and emailBody are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Send test email using Resend or your email service
    const emailServiceUrl = process.env.EMAIL_SERVICE_URL || process.env.RESEND_API_URL;
    const emailServiceKey = process.env.EMAIL_SERVICE_KEY || process.env.RESEND_API_KEY;

    if (!emailServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Email service not configured' },
        { status: 503 }
      );
    }

    // Try to send via Resend (common choice for Next.js)
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${emailServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'noreply@studiio.app',
          to,
          subject,
          html: emailBody,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send email');
      }

      const result = await response.json();

      // Log the action
      await logAdminAction({
        adminEmail: session!.user.email!,
        action: 'send_test_email',
        targetType: 'email',
        details: { to, subject, messageId: result.id },
      });

      return NextResponse.json({
        success: true,
        data: { messageId: result.id, to, subject },
        message: 'Test email sent successfully',
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Still log even if email failed
      await logAdminAction({
        adminEmail: session!.user.email!,
        action: 'send_test_email_failed',
        targetType: 'email',
        details: { to, subject, error: String(emailError) },
      });

      throw emailError;
    }
  } catch (error) {
    console.error('Error in test email endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to send test email';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
