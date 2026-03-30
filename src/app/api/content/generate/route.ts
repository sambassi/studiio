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
];

// POST /api/content/generate - Generate infographic content for a topic
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { topic } = body;

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Topic is required' },
        { status: 400 }
      );
    }

    const result = generateSmartContent(topic);

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
