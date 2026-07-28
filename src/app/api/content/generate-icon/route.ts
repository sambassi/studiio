import { NextRequest, NextResponse } from 'next/server';

// POST /api/content/generate-icon
// Body: { prompt: string }
// Returns: { icon: string } — un NOM D'ICONE LUCIDE (ex. 'Droplet').
//
// Cette route renvoyait un emoji unicode. Regle projet (CLAUDE.md) : aucun
// emoji dans le contenu genere. Le nom retourne est valide contre une liste
// blanche ; toute reponse hors liste retombe sur 'Sparkles', jamais un emoji.
export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY missing' }, { status: 500 });
    }

    // Liste blanche : sous-ensemble de CARD_ICON_MAP (src/components/ui/CardIcon.tsx).
    // Volontairement dupliquee ici — importer le composant client tirerait
    // lucide-react dans le bundle serveur.
    const ALLOWED = [
      'Heart', 'Brain', 'Flame', 'Zap', 'Dumbbell', 'Activity', 'Trophy', 'Target',
      'Apple', 'Carrot', 'Salad', 'Coffee', 'Utensils', 'Wheat', 'Milk', 'Egg', 'Fish',
      'Droplet', 'Leaf', 'Sun', 'Moon', 'Star', 'Sprout', 'TreeDeciduous', 'Waves',
      'Clock', 'Timer', 'Calendar', 'Hourglass', 'Rocket', 'Sparkles', 'Lightbulb',
      'TrendingUp', 'BarChart3', 'Wallet', 'Coins', 'PiggyBank', 'Landmark', 'Receipt',
      'Shield', 'ShieldCheck', 'Lock', 'Key', 'Bone', 'Pill', 'Stethoscope', 'HeartPulse',
      'Thermometer', 'Eye', 'Users', 'User', 'Baby', 'PersonStanding', 'Smile',
      'Music', 'Headphones', 'Camera', 'Video', 'Palette', 'Book', 'GraduationCap',
      'Plane', 'Map', 'Compass', 'Home', 'Car', 'Bike', 'Globe', 'Gift', 'Crown',
      'Gem', 'Medal', 'Award', 'Bell', 'Megaphone', 'Package', 'ShoppingBag',
      'Laptop', 'Smartphone', 'Code', 'Database', 'Wifi', 'Battery', 'Gamepad2',
    ];

    const system =
      "Tu recois un mot ou une courte description. Retourne UNIQUEMENT le nom d'une icone lucide-react pertinente, choisi STRICTEMENT dans cette liste : "
      + ALLOWED.join(', ')
      + ". Reponds avec le nom exact, rien d'autre. Jamais d'emoji.";

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: prompt.slice(0, 200) }],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Anthropic API error: ${res.status} ${errTxt.slice(0, 200)}` },
        { status: 500 },
      );
    }

    const data = await res.json();
    const txt: string = Array.isArray(data?.content)
      ? data.content
          .map((c: any) => (c?.type === 'text' ? c.text : ''))
          .join('')
          .trim()
      : '';
    // Validation stricte : un nom hors liste blanche ne doit jamais atteindre
    // le client, sinon CardIcon rendrait le texte brut du nom.
    const candidate = txt.replace(/[^A-Za-z0-9]/g, '');
    const icon = ALLOWED.find((n) => n.toLowerCase() === candidate.toLowerCase()) || 'Sparkles';
    return NextResponse.json({ icon });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'generation failed' }, { status: 500 });
  }
}
