import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';

// GET /api/terms
// Public endpoint - no authentication required
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value, updated_at')
      .eq('key', 'terms_content')
      .single();

    if (error) {
      console.error('Error fetching terms:', error);
      return NextResponse.json(
        { success: false, content: '', updatedAt: '' },
        { status: 404 }
      );
    }

    const content = typeof data?.value === 'string'
      ? JSON.parse(data.value)
      : data?.value || '';

    return NextResponse.json({
      success: true,
      content,
      updatedAt: data?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Unexpected error fetching terms:', error);
    return NextResponse.json(
      { success: false, content: '', updatedAt: '' },
      { status: 500 }
    );
  }
}
