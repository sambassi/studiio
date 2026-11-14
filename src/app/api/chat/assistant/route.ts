import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getSystemPrompt } from '@/lib/chat/system-prompts';
import { blocContexteCommercial } from '@/lib/chat/contexte-commercial';
import { lirePortefeuille } from '@/lib/chat/portefeuille';
import { MESSAGE_IA_NON_CONFIGUREE, MESSAGE_IA_INDISPONIBLE } from '@/lib/fournisseurs/messages-neutres';

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
      return NextResponse.json({ error: MESSAGE_IA_NON_CONFIGUREE }, { status: 503 });
    }

    // Plan, solde et TARIFS RÉELS du compte, lus sur le serveur à chaque
    // message : l'assistant chiffre un projet sans jamais inventer un prix.
    // Une lecture en échec ne bloque pas la réponse — le prompt repart sans
    // le bloc, et l'assistant renvoie alors vers les écrans de prix.
    let portefeuille: string | undefined;
    try {
      portefeuille = blocContexteCommercial(await lirePortefeuille(session.user.id));
    } catch (e) {
      console.error('[Assistant] portefeuille illisible :', e instanceof Error ? e.message : e);
    }
    const systemPrompt = getSystemPrompt(locale, portefeuille);
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
      console.error('[Assistant] appel IA en echec :', res.status, err);
      return NextResponse.json({ error: MESSAGE_IA_INDISPONIBLE }, { status: 502 });
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
    // Jamais `error.message` au navigateur : il peut venir du fournisseur.
    return NextResponse.json({ error: MESSAGE_IA_INDISPONIBLE }, { status: 500 });
  }
}
