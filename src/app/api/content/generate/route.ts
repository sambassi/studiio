import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { generateSmartContent } from '@/lib/smart-content';

// Available topics from knowledge base
const TOPICS = [
  'eau', 'crampe', 'sommeil', 'calorie', 'stress', 'protein', 'nutrition',
  'cardio', 'communaut', 'horaire', 'debut', 'musique', 'poids', 'energie',
  'souplesse', 'confiance', 'echauffement', 'recuperation', 'cours',
  'motivation', 'danse', 'silent', 'respiration', 'magnesium', 'feculent',
  'vitamine', 'fer', 'zinc', 'omega', 'sucre',
  'ananas', 'mangue', 'avocat', 'gingembre', 'citron', 'curcuma', 'banane',
];

// POST /api/content/generate - Generate infographic content for a topic
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { topic, batchIndex, seed } = body;

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Topic is required' },
        { status: 400 }
      );
    }

    // Prefer an explicit seed; otherwise fall back to batchIndex for pool
    // rotation across the N iterations of a batch export. Un-seeded calls
    // keep the legacy random behavior.
    const effectiveSeed = typeof seed === 'number'
      ? seed
      : typeof batchIndex === 'number' ? batchIndex : undefined;

    const result = generateSmartContent(topic, effectiveSeed);
    // Cap to 3 cards — the editor's default — so a fallback path can't sneak
    // in 5 cards from the local knowledge-base templates.
    if (result && Array.isArray(result.cards)) {
      result.cards = result.cards.slice(0, 3);
    }

    return NextResponse.json({
      success: true,
      content: result,
    });
  } catch (error) {
    console.error('Content generation error:', error);
    return NextResponse.json(
      { success: false, error: 'Content generation failed' },
      { status: 500 }
    );
  }
}

// GET /api/content/generate - List available topics
export async function GET() {
  return NextResponse.json({
    success: true,
    topics: TOPICS,
    count: TOPICS.length,
  });
}
