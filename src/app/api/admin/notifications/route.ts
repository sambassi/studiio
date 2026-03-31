import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

interface NotificationSettings {
  adminEmail?: string;
  enableSalesAlerts?: boolean;
  enableNewUserAlerts?: boolean;
  enableErrorAlerts?: boolean;
  enableDailyDigest?: boolean;
  digestTime?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .eq('key', 'notification_settings')
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows found" - that's okay
      throw error;
    }

    const settings: NotificationSettings = data?.value || {
      adminEmail: process.env.ADMIN_EMAIL || 'contact.artboost@gmail.com',
      enableSalesAlerts: true,
      enableNewUserAlerts: true,
      enableErrorAlerts: true,
      enableDailyDigest: false,
      digestTime: '09:00',
    };

    return NextResponse.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notification settings' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const body = await req.json();
    const settings: NotificationSettings = body;

    // Validate settings
    if (settings.adminEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(settings.adminEmail)) {
        return NextResponse.json(
          { success: false, error: 'Invalid admin email address' },
          { status: 400 }
        );
      }
    }

    if (settings.digestTime) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(settings.digestTime)) {
        return NextResponse.json(
          { success: false, error: 'Invalid digest time format. Use HH:MM' },
          { status: 400 }
        );
      }
    }

    // Get current settings
    const { data: existing } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .eq('key', 'notification_settings')
      .single();

    let result;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .update({
          value: settings,
          updated_at: new Date().toISOString(),
        })
        .eq('key', 'notification_settings')
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .insert({
          key: 'notification_settings',
          value: settings,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Log the action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'update_notification_settings',
      targetType: 'settings',
      targetId: 'notification_settings',
      details: settings,
    });

    return NextResponse.json({
      success: true,
      data: settings,
      message: 'Notification settings updated successfully',
    });
  } catch (error) {
    console.error('Error updating notification settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update notification settings' },
      { status: 500 }
    );
  }
}
