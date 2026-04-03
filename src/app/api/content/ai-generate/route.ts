import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// POST /api/content/ai-generate - Generate rich infographic content using Claude
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ success: false, error: 'Anthropic API not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { topic, locale = 'fr', cardCount = 3 } = body;

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ success: false, error: 'Topic is required' }, { status: 400 });
    }

    const count = Math.min(Math.max(cardCount, 2), 6);

    const systemPrompt = `Tu es un expert en création de contenu pour infographies de fitness/bien-être pour la marque Afroboost.
Tu dois générer du contenu éducatif et engageant en ${locale === 'fr' ? 'français' : 'anglais'}.

RÈGLES STRICTES:
- Chaque carte DOIT contenir un fait réel, un chiffre ou une stat vérifiable
- Le contenu doit être informatif et éducatif, pas juste promotionnel
- Les valeurs doivent être des chiffres percutants (pourcentages, durées, quantités)
- Les descriptions doivent être courtes (max 15 mots) mais impactantes
- Les emojis doivent être pertinents au sujet
- Le sous-titre doit être accrocheur et factuel
- Les phrases de vente doivent être liées au sujet spécifique

Réponds UNIQUEMENT en JSON valide, sans markdown ni commentaires.`;

    const userPrompt = `Génère du contenu d'infographie sur le sujet: "${topic}"

Format JSON requis:
{
  "title": "TITRE COURT EN MAJUSCULES (max 4 mots)",
  "subtitle": "Phrase accrocheuse factuelle sur ${topic}",
  "cards": [
    {
      "emoji": "emoji pertinent",
      "label": "LABEL COURT",
      "value": "CHIFFRE ou STAT",
      "description": "Fait éducatif court"
    }
  ],
  "salesPhrases": [
    "Phrase de vente 1 liée à ${topic}",
    "Phrase de vente 2 liée à ${topic}",
    "Phrase de vente 3 liée à ${topic}",
    "Phrase de vente 4 liée à ${topic}",
    "Phrase de vente 5 liée à ${topic}"
  ],
  "pexelsQuery": "requête de recherche Pexels en anglais pour trouver des photos liées à ${topic}"
}

Génère exactement ${count} cartes. Tout le contenu texte en ${locale === 'fr' ? 'français' : 'anglais'}.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    // Extract text content
    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ success: false, error: 'No text response from AI' }, { status: 500 });
    }

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const content = JSON.parse(jsonStr);

    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error('AI content generation error:', error);
    return NextResponse.json(
      { success: false, error: 'AI content generation failed' },
      { status: 500 }
    );
  }
}
