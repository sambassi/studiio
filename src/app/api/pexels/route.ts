import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

const THEME_QUERIES: Record<string, string> = {
  // Créer page objectives
  promotion: 'fitness dance energy workout',
  abonnement: 'gym membership fitness class',
  motivation: 'athlete motivation sport training',
  bienfaits: 'wellness health yoga meditation',
  nutrition: 'healthy food nutrition fruits',
  cardio: 'cardio dance aerobics',
  // Infographie content themes
  'sommeil-sport': 'sleep recovery fitness rest athlete',
  'nutrition-danse': 'healthy food dance nutrition energy',
  'energie-cardio': 'cardio energy workout running fitness',
  'stress-mental': 'meditation mental health yoga calm relax',
  'communaute': 'group fitness community dance class together',
  default: 'fitness dance workout',
};

// GET /api/pexels?query=fitness&count=5
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!PEXELS_API_KEY) {
      return NextResponse.json({ success: false, error: 'Pexels API not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || 'fitness dance';
    const count = Math.min(parseInt(searchParams.get('count') || '5'), 15);
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1);
    const objective = searchParams.get('objective');
    const theme = searchParams.get('theme');

    const searchQuery = theme ? (THEME_QUERIES[theme] || THEME_QUERIES.default)
      : objective ? (THEME_QUERIES[objective] || THEME_QUERIES.default)
      : query;

    // Pexels works best with English queries — translate common French terms
    const FR_TO_EN: Record<string, string> = {
      'femme': 'woman', 'homme': 'man', 'noir': 'black', 'noire': 'black',
      'blanc': 'white', 'blanche': 'white', 'athlet': 'athlete', 'athlète': 'athlete',
      'sportif': 'sporty athletic', 'sportive': 'sporty athletic',
      'danse': 'dance', 'danseuse': 'dancer', 'danseur': 'dancer',
      'musculation': 'weightlifting gym', 'course': 'running',
      'yoga': 'yoga', 'fitness': 'fitness', 'cuisine': 'cooking food',
      'nourriture': 'food', 'manger': 'eating food', 'fruit': 'fruit',
      'légume': 'vegetable', 'santé': 'health wellness', 'bien-être': 'wellness',
      'énergie': 'energy', 'force': 'strength power', 'corps': 'body',
      'entraînement': 'training workout', 'entrainement': 'training workout',
      'musique': 'music', 'africain': 'african', 'africaine': 'african',
      'afro': 'afro african', 'nature': 'nature', 'plage': 'beach',
      'montagne': 'mountain', 'ville': 'city', 'nuit': 'night',
      'soleil': 'sun sunshine', 'eau': 'water', 'feu': 'fire',
      'groupe': 'group', 'équipe': 'team', 'enfant': 'child kid',
      'bébé': 'baby', 'famille': 'family', 'ami': 'friend',
      'sourire': 'smile happy', 'joie': 'joy happiness',
      'manioc': 'cassava', 'riz': 'rice', 'poulet': 'chicken',
      'poisson': 'fish', 'marché': 'market', 'fête': 'party celebration',
      'mariage': 'wedding', 'mode': 'fashion', 'beauté': 'beauty',
      'cheveux': 'hair', 'maquillage': 'makeup', 'peau': 'skin',
      'sommeil': 'sleep rest', 'repos': 'rest relaxation',
      'stress': 'stress', 'méditation': 'meditation', 'cardio': 'cardio',
    };

    // Translate French words to English for better Pexels results
    const translatedQuery = searchQuery.split(/\s+/).map((word: string) => {
      const lower = word.toLowerCase().replace(/[éèê]/g, 'e').replace(/[àâ]/g, 'a').replace(/[ùû]/g, 'u').replace(/[ôö]/g, 'o').replace(/[îï]/g, 'i');
      // Check exact match first, then normalized match
      return FR_TO_EN[word.toLowerCase()] || FR_TO_EN[lower] || word;
    }).join(' ');

    const orientation = searchParams.get('orientation') || 'portrait';

    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(translatedQuery)}&per_page=${count}&page=${page}&orientation=${orientation}`,
      {
        headers: { Authorization: PEXELS_API_KEY },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ success: false, error: 'Pexels API error' }, { status: 502 });
    }

    const data = await res.json();
    const photos = data.photos?.map((p: any) => ({
      id: p.id,
      url: p.src.large2x || p.src.large,
      medium: p.src.medium,
      small: p.src.small,
      photographer: p.photographer,
      alt: p.alt,
    })) || [];

    return NextResponse.json({ success: true, photos });
  } catch (error) {
    console.error('Pexels API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch photos' }, { status: 500 });
  }
}
