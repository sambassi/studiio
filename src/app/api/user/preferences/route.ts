import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// Creator preferences — saved per user for infographic/audio studio
export interface CreatorPreferences {
  // Infographic
  format?: '9:16' | '16:9';
  selectedTheme?: string;
  destination?: string;
  // Sequence durations
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  // Branding (also saved in localStorage via useBranding, but this is the server backup)
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  watermarkText?: string;
  borderColor?: string;
  borderEnabled?: boolean;
  // Media URLs (Supabase Storage URLs that persist)
  savedLogoUrl?: string;
  savedLogoName?: string;
  // Audio Studio
  musicVolume?: number;
  voiceVolume?: number;
  exportDest?: string;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('creator_preferences')
        .eq('user_id', session.user.id)
        .single();

      if (error || !data) {
        return NextResponse.json({ success: true, preferences: null });
      }

      return NextResponse.json({ success: true, preferences: data.creator_preferences || null });
    } catch {
      return NextResponse.json({ success: true, preferences: null });
    }
  } catch (error) {
    console.error('Preferences GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load preferences' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const preferences = await req.json();

    try {
      // First try to update existing row
      const { data: existing } = await supabase
        .from('user_settings')
        .select('creator_preferences')
        .eq('user_id', session.user.id)
        .single();

      if (existing) {
        // Merge with existing preferences (don't overwrite other fields)
        const merged = { ...(existing.creator_preferences || {}), ...preferences };
        const { error } = await supabase
          .from('user_settings')
          .update({ creator_preferences: merged, updated_at: new Date().toISOString() })
          .eq('user_id', session.user.id);

        if (error) {
          console.warn('Could not update creator preferences:', error.message);
        }
      } else {
        // Insert new row
        const { error } = await supabase
          .from('user_settings')
          .upsert(
            {
              user_id: session.user.id,
              creator_preferences: preferences,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );

        if (error) {
          console.warn('Could not save creator preferences:', error.message);
        }
      }
    } catch (dbError) {
      console.warn('DB error saving creator preferences:', dbError);
      // Fall through — localStorage is the fallback
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Preferences POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save preferences' }, { status: 500 });
  }
}
