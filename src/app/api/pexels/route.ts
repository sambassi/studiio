import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

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

const FR_TO_EN: Record<string, string> = {
  // People / gender
  'femme': 'woman', 'femmes': 'women', 'homme': 'man', 'hommes': 'men',
  'personne': 'person', 'gens': 'people',
  // Ethnicity — enrich for diversity (Afroboost audience)
  'noir': 'black african-american', 'noire': 'black african-american',
  'noirs': 'black african-american', 'noires': 'black african-american',
  'blanc': 'white', 'blanche': 'white',
  'africain': 'african', 'africaine': 'african',
  'africains': 'african', 'africaines': 'african',
  'afro': 'afro african-american', 'afrodescendant': 'african-american',
  // Sport / fitness
  'athlet': 'athlete', 'athlète': 'athlete', 'athlètes': 'athletes',
  'sportif': 'sporty athletic', 'sportive': 'sporty athletic',
  'sportifs': 'sporty athletic', 'sportives': 'sporty athletic',
  'danse': 'dance', 'danseuse': 'dancer', 'danseur': 'dancer',
  'musculation': 'weightlifting gym', 'course': 'running',
  'yoga': 'yoga', 'fitness': 'fitness', 'gym': 'gym',
  'entraînement': 'training workout', 'entrainement': 'training workout',
  'séance': 'session workout', 'seance': 'session workout',
  'pilates': 'pilates', 'boxe': 'boxing', 'crossfit': 'crossfit',
  'stretching': 'stretching', 'étirement': 'stretching',
  'natation': 'swimming', 'vélo': 'cycling bike', 'velo': 'cycling bike',
  // Class / group
  'cours': 'class fitness class', 'collectif': 'group class',
  'collective': 'group class', 'collectifs': 'group classes',
  'collectives': 'group classes', 'groupe': 'group', 'équipe': 'team',
  'ensemble': 'together', 'communauté': 'community',
  // Food
  'cuisine': 'cooking food', 'nourriture': 'food', 'manger': 'eating food',
  'fruit': 'fruit', 'fruits': 'fruits', 'légume': 'vegetable',
  'légumes': 'vegetables', 'manioc': 'cassava', 'riz': 'rice',
  'poulet': 'chicken', 'poisson': 'fish', 'repas': 'meal',
  'petit-déjeuner': 'breakfast', 'déjeuner': 'lunch', 'dîner': 'dinner',
  'smoothie': 'smoothie', 'salade': 'salad', 'boisson': 'drink beverage',
  // Health / wellness
  'santé': 'health wellness', 'bien-être': 'wellness', 'bienêtre': 'wellness',
  'énergie': 'energy', 'force': 'strength power', 'corps': 'body',
  'sommeil': 'sleep rest', 'repos': 'rest relaxation', 'stress': 'stress',
  'méditation': 'meditation', 'cardio': 'cardio', 'mental': 'mental health',
  'relaxation': 'relaxation', 'détente': 'relaxation', 'calme': 'calm',
  // Audio / tech
  'musique': 'music', 'casque': 'headphones wireless', 'casques': 'headphones wireless',
  'audio': 'audio', 'écouteurs': 'earphones earbuds', 'ecouteurs': 'earphones earbuds',
  'sans': 'wireless', 'fil': 'wireless', 'sans-fil': 'wireless',
  'microphone': 'microphone mic', 'micro': 'microphone mic',
  // Places / nature
  'nature': 'nature', 'plage': 'beach', 'montagne': 'mountain',
  'ville': 'city', 'nuit': 'night', 'soleil': 'sun sunshine',
  'eau': 'water', 'feu': 'fire', 'forêt': 'forest', 'parc': 'park',
  'studio': 'studio', 'salle': 'room', 'maison': 'home house',
  // People / social
  'enfant': 'child kid', 'enfants': 'children kids', 'bébé': 'baby',
  'famille': 'family', 'ami': 'friend', 'amis': 'friends',
  'sourire': 'smile happy', 'joie': 'joy happiness', 'heureux': 'happy',
  'heureuse': 'happy', 'fête': 'party celebration', 'mariage': 'wedding',
  // Style / beauty
  'mode': 'fashion', 'beauté': 'beauty', 'cheveux': 'hair',
  'maquillage': 'makeup', 'peau': 'skin', 'portrait': 'portrait',
  'marché': 'market',
  // Business / other
  'sport': 'sport', 'voyage': 'travel',
  'crypto': 'cryptocurrency bitcoin', 'gaming': 'gaming esports',
  'immobilier': 'real estate house', 'voiture': 'car automobile',
  'auto': 'car automobile', 'animal': 'animal pet', 'animaux': 'animals pets',
  'éducation': 'education learning', 'productivité': 'productivity workspace',
  'finance': 'finance money investment', 'code': 'coding programming laptop',
  // Stopwords (stripped)
  'avec': '', 'dans': '', 'les': '', 'des': '', 'un': '', 'une': '',
  'et': '', 'le': '', 'la': '', 'du': '', 'au': '', 'aux': '', 'pour': '',
  'de': '', 'sur': '', 'en': '', 'à': '', 'a': '', 'par': '',
};

const ETHNICITY_TRIGGERS = ['noir', 'noire', 'noirs', 'noires', 'african', 'africain', 'africaine', 'afro', 'black'];

function normalizeAccents(s: string): string {
  return s.toLowerCase()
    .replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a')
    .replace(/[ùûü]/g, 'u').replace(/[ôö]/g, 'o')
    .replace(/[îï]/g, 'i').replace(/[ç]/g, 'c');
}

function translateQuery(raw: string): { query: string; needsEthnicityBoost: boolean } {
  const words = raw.split(/\s+/);
  const lowerWords = words.map((w) => w.toLowerCase());
  const normalized = lowerWords.map(normalizeAccents);
  const needsEthnicityBoost = lowerWords.some((w) => ETHNICITY_TRIGGERS.includes(w))
    || normalized.some((w) => ETHNICITY_TRIGGERS.includes(w));

  const translated = words.map((word, i) => {
    return FR_TO_EN[lowerWords[i]] ?? FR_TO_EN[normalized[i]] ?? word;
  }).filter(Boolean).join(' ').trim() || 'fitness';

  const query = needsEthnicityBoost && !/african-american|black/i.test(translated)
    ? `${translated} black african-american`
    : translated;

  return { query, needsEthnicityBoost };
}

type Photo = {
  id: string;
  url: string;
  medium: string;
  small: string;
  photographer: string;
  alt: string;
  source: 'pexels' | 'unsplash';
};

async function fetchPexels(query: string, perPage: number, page: number, orientation: string): Promise<Photo[]> {
  if (!PEXELS_API_KEY) return [];
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&orientation=${orientation}`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  return (data.photos || []).map((p: any) => ({
    id: `pexels-${p.id}`,
    url: p.src?.large2x || p.src?.large,
    medium: p.src?.medium,
    small: p.src?.small,
    photographer: p.photographer,
    alt: p.alt || '',
    source: 'pexels' as const,
  }));
}

async function fetchUnsplash(query: string, perPage: number, page: number, orientation: string): Promise<Photo[]> {
  if (!UNSPLASH_ACCESS_KEY) return [];
  // Unsplash accepts: landscape, portrait, squarish
  const orient = orientation === 'landscape' ? 'landscape' : orientation === 'squarish' ? 'squarish' : 'portrait';
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&orientation=${orient}`,
    { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } }
  );
  if (!res.ok) throw new Error(`Unsplash ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((p: any) => ({
    id: `unsplash-${p.id}`,
    url: p.urls?.regular || p.urls?.full,
    medium: p.urls?.small,
    small: p.urls?.thumb,
    photographer: p.user?.name || 'Unsplash',
    alt: p.alt_description || p.description || '',
    source: 'unsplash' as const,
  }));
}

function interleave(a: Photo[], b: Photo[]): Photo[] {
  const out: Photo[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

async function searchBoth(query: string, count: number, page: number, orientation: string): Promise<Photo[]> {
  const perSource = Math.max(count, 5);
  const [pexelsRes, unsplashRes] = await Promise.allSettled([
    fetchPexels(query, perSource, page, orientation),
    fetchUnsplash(query, perSource, page, orientation),
  ]);
  const pexels = pexelsRes.status === 'fulfilled' ? pexelsRes.value : [];
  const unsplash = unsplashRes.status === 'fulfilled' ? unsplashRes.value : [];
  if (pexelsRes.status === 'rejected') console.error('Pexels fetch failed:', pexelsRes.reason);
  if (unsplashRes.status === 'rejected') console.error('Unsplash fetch failed:', unsplashRes.reason);
  return interleave(pexels, unsplash);
}

// GET /api/pexels?query=fitness&count=5
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!PEXELS_API_KEY && !UNSPLASH_ACCESS_KEY) {
      return NextResponse.json({ success: false, error: 'No image provider configured' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || 'fitness dance';
    const count = Math.min(parseInt(searchParams.get('count') || '5'), 15);
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1);
    const objective = searchParams.get('objective');
    const theme = searchParams.get('theme');
    const orientation = searchParams.get('orientation') || 'portrait';

    const searchQuery = theme ? (THEME_QUERIES[theme] || THEME_QUERIES.default)
      : objective ? (THEME_QUERIES[objective] || THEME_QUERIES.default)
      : query;

    const { query: translatedQuery } = translateQuery(searchQuery);

    let photos = await searchBoth(translatedQuery, count, page, orientation);

    // Auto-retry with next page if too few results
    if (photos.length < 3) {
      const extra = await searchBoth(translatedQuery, count, page + 1, orientation);
      const seen = new Set(photos.map((p) => p.id));
      for (const p of extra) {
        if (!seen.has(p.id)) photos.push(p);
      }
    }

    const limited = photos.slice(0, count);
    return NextResponse.json({ success: true, photos: limited, query: translatedQuery });
  } catch (error) {
    console.error('Image search error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch photos' }, { status: 500 });
  }
}
