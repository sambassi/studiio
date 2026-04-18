import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getSystemPrompt } from '@/lib/chat/system-prompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messages, locale = 'fr' } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Assistant non configuré, contacte l\'admin' }, { status: 503 });
    }

    const systemPrompt = getSystemPrompt(locale);
    const claudeMessages = messages.slice(-20).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    const lastUserMsg = claudeMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: systemPrompt,
        messages: claudeMessages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Assistant] Claude error:', res.status, err);
      return NextResponse.json({ error: 'AI response failed' }, { status: 502 });
    }

    const data = await res.json();
    const reply = data.content?.find((c: any) => c.type === 'text')?.text || '';

    // Log to chat_logs (best-effort, ignore errors)
    try {
      await supabaseAdmin.from('chat_logs').insert({
        user_id: session.user.id,
        locale,
        user_message: lastUserMsg,
        assistant_message: reply,
      });
    } catch {}

    return NextResponse.json({ reply });
  } catch (error: any) {
    console.error('[Assistant] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
