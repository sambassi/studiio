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
    const { topic, locale = 'fr', cardCount = 5 } = body;

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ success: false, error: 'Topic is required' }, { status: 400 });
    }

    const count = Math.min(Math.max(cardCount, 3), 8);

    const systemPrompt = `Tu es un expert en nutrition, santé, bien-être et fitness. Tu crées du contenu éducatif RICHE et PRÉCIS pour des infographies destinées aux réseaux sociaux.

CONTEXTE: L'utilisateur tape un sujet (ex: "moringa", "manioc", "collagène", "sommeil", etc.) et tu dois générer des VRAIES informations éducatives riches sur ce sujet. Le contenu est pour la marque Afroboost (fitness/danse/bien-être africain).

RÈGLES ABSOLUES:
1. Chaque carte DOIT contenir un VRAI fait scientifique ou nutritionnel VÉRIFIÉ sur le sujet
2. Les valeurs DOIVENT être des vrais chiffres/stats/données (ex: "60%", "2L/j", "500mg", "+30%", "48h", "3x/sem")
3. Les labels DOIVENT décrire un aspect SPÉCIFIQUE du sujet (pas générique)
4. Les descriptions DOIVENT expliquer le fait de manière claire et éducative (10-20 mots)
5. Les emojis DOIVENT être pertinents au contenu de CHAQUE carte (pas tous les mêmes)
6. Les phrases de vente DOIVENT mentionner le sujet spécifique et Afroboost
7. Le sous-titre DOIT être un fait accrocheur et vrai sur le sujet
8. La requête Pexels DOIT être liée au sujet réel (ex: "cassava root food" pour manioc)

EXEMPLES DE QUALITÉ ATTENDUE:

Sujet "manioc":
- 🥔 ÉNERGIE PURE | 160kcal | "160 kcal pour 100g de manioc cuit, carburant idéal avant le sport"
- 🌿 SANS GLUTEN | 100% | "Alternative parfaite pour les intolérants, riche en amidon naturel"
- 💪 FIBRES DIGESTIVES | 1.8g | "1.8g de fibres pour 100g, améliore ta digestion au quotidien"
- 🛡️ VITAMINE C | 20mg | "20mg de vitamine C pour 100g, renforce ton système immunitaire"
- ⚡ GLUCIDES LENTS | 38g | "38g de glucides complexes pour une énergie longue durée"

Sujet "moringa":
- 🌿 PROTÉINES VÉGÉTALES | 27g | "27g de protéines pour 100g de feuilles séchées, plus que les oeufs"
- 🦴 CALCIUM NATUREL | 2000mg | "4x plus de calcium que le lait, renforce tes os pour la danse"
- ⚡ FER PUISSANT | 28mg | "28mg de fer pour 100g, combat la fatigue et booste ton énergie"
- 🧠 ANTIOXYDANTS | 46x | "46 antioxydants identifiés, protège tes cellules du stress"
- 💧 DÉTOX NATUREL | 7j | "Purifie ton organisme en 7 jours de cure, effet visible"

Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans commentaires.`;

    const userPrompt = `Génère du contenu d'infographie RICHE et ÉDUCATIF sur: "${topic}"

Le contenu doit être 100% axé sur "${topic}" — pas de contenu générique fitness.
Chaque carte = un vrai fait/chiffre sur "${topic}".
Les phrases de vente doivent promouvoir "${topic}" avec Afroboost.

JSON requis (${locale === 'fr' ? 'tout en français' : 'tout en anglais'}):
{
  "title": "TITRE EN MAJUSCULES (2-4 mots, contenant ${topic})",
  "subtitle": "Fait accrocheur et vrai sur ${topic} en lien avec la santé/performance (max 15 mots)",
  "cards": [
    {
      "emoji": "emoji unique et pertinent au contenu de cette carte",
      "label": "ASPECT SPÉCIFIQUE DE ${topic.toUpperCase()} (2-4 mots)",
      "value": "CHIFFRE RÉEL (ex: 27g, +40%, 2L/j, 48h)",
      "description": "Explication éducative courte du fait (10-20 mots)"
    }
  ],
  "salesPhrases": [
    "Phrase de vente mentionnant ${topic} et Afroboost",
    "Autre phrase promotionnelle sur les bienfaits de ${topic}",
    "Phrase incitative avec ${topic}",
    "Phrase engageante sur ${topic} et le bien-être",
    "Call-to-action avec ${topic}"
  ],
  "pexelsQuery": "requête Pexels EN ANGLAIS pour trouver des photos du vrai sujet ${topic} (pas fitness générique)"
}

Génère exactement ${count} cartes. IMPORTANT: chaque carte = un emoji DIFFÉRENT et pertinent.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
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
    // Remove any leading/trailing non-JSON characters
    const jsonStart = jsonStr.indexOf('{');
    const jsonEnd = jsonStr.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
    }

    const content = JSON.parse(jsonStr);

    // Validate the content has the expected structure
    if (!content.title || !content.cards || !Array.isArray(content.cards)) {
      return NextResponse.json({ success: false, error: 'Invalid AI response structure' }, { status: 500 });
    }

    // Ensure each card has required fields
    content.cards = content.cards.map((card: any) => ({
      emoji: card.emoji || '📊',
      label: card.label || 'INFO',
      value: card.value || '-',
      description: card.description || '',
    }));

    // Ensure salesPhrases exists
    if (!content.salesPhrases || !Array.isArray(content.salesPhrases)) {
      content.salesPhrases = [
        `Découvre les bienfaits de ${topic} avec Afroboost`,
        `${topic} + Afroboost = ta meilleure version`,
        `Booste ta santé avec ${topic}`,
      ];
    }

    // Ensure pexelsQuery exists
    if (!content.pexelsQuery) {
      content.pexelsQuery = topic;
    }

    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error('AI content generation error:', error);
    return NextResponse.json(
      { success: false, error: 'AI content generation failed' },
      { status: 500 }
    );
  }
}
