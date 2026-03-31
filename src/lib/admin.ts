import { auth } from '@/lib/auth/config';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';

const ADMIN_EMAILS = ['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'];

export function isAdmin(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes(email?.toLowerCase() || '');
}

/**
 * Verify admin access for API routes.
 * Returns the session if admin, or a 403 response.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }), session: null };
  }
  if (!isAdmin(session.user.email)) {
    return { error: NextResponse.json({ success: false, error: 'Forbidden: admin access required' }, { status: 403 }), session: null };
  }
  return { error: null, session };
}

/**
 * Log an admin action to the audit_log table.
 */
export async function logAdminAction(params: {
  adminEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, any>;
}) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      admin_email: params.adminEmail,
      action: params.action,
      target_type: params.targetType || null,
      target_id: params.targetId || null,
      details: params.details || null,
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
}
