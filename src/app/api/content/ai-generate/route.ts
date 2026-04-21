import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';

// Fast model for card generation. Haiku 4.5 is 5-10× faster than Sonnet on
// short JSON responses, which prevents client-side 8s AbortError timeouts
// during batch (batchCount=3..10) exports where we make N sequential calls.
const PRIMARY_MODEL = 'claude-haiku-4-5-20251001';
const FALLBACK_MODEL = 'claude-3-5-sonnet-20241022';
// Server-side timeout — cap each Anthropic call. Must be short enough that
// batch variations don't stall a whole export.
const AI_TIMEOUT_MS = 20_000;

async function callAnthropic(
  apiKey: string,
  body: Record<string, any>,
  model: string,
): Promise<Response> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ ...body, model }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(to);
  }
}

// POST /api/content/ai-generate - Generate rich infographic content using Claude
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[AI-Generate] ANTHROPIC_API_KEY not set');
      return NextResponse.json({ success: false, error: 'Anthropic API not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { topic, locale = 'fr', cardCount = 3, existingCards = [], videoOverlayOnly = false, fieldType, variationNonce } = body;

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ success: false, error: 'Topic is required' }, { status: 400 });
    }

    // Mode "single field" — generate one text for a specific field
    if (fieldType) {
      const fieldPrompts: Record<string, string> = {
        title: `Génère UN titre accrocheur en MAJUSCULES (3-6 mots) pour une infographie sur "${topic}". Réponse JSON: {"text":"..."}`,
        subtitle: `Génère UN sous-titre engageant (5-10 mots) pour une infographie sur "${topic}". Réponse JSON: {"text":"..."}`,
        cta: `Génère UN texte CTA court et percutant (1-3 mots) pour "${topic}". Exemples: "DÉCOUVRIR", "EN SAVOIR PLUS", "COMMENCER". Réponse JSON: {"text":"..."}`,
        ctaSub: `Génère UN sous-texte CTA (2-4 mots) pour "${topic}". Exemples: "LIEN EN BIO", "CHAT POUR PLUS D'INFOS". Réponse JSON: {"text":"..."}`,
        overlay: `Génère UN texte overlay vidéo court et accrocheur (3-8 mots, MAJUSCULES) pour "${topic}". Réponse JSON: {"text":"..."}`,
        tts: `Génère un script voix-off court (2-3 phrases, ~30 mots) pour une vidéo sur "${topic}". Ton engageant et motivant. En ${locale === 'fr' ? 'français' : 'anglais'}. Réponse JSON: {"text":"..."}`,
      };
      const prompt = fieldPrompts[fieldType] || fieldPrompts.title;
      try {
        const r = await callAnthropic(apiKey, {
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }, PRIMARY_MODEL);
        if (r.ok) {
          const d = await r.json();
          const block = d.content?.find((c: any) => c.type === 'text');
          if (block?.text) {
            const match = block.text.match(/\{[^}]*"text"\s*:\s*"([^"]+)"/);
            if (match) return NextResponse.json({ success: true, text: match[1] });
          }
        }
      } catch {}
      return NextResponse.json({ success: false, error: 'AI generation failed' }, { status: 500 });
    }

    // Mode "video overlay only" — generate just a short overlay text for the video
    if (videoOverlayOnly) {
      const overlayPrompt = `Tu es un expert en contenu pour réseaux sociaux. Génère UN SEUL texte court et percutant à afficher en overlay sur une vidéo sur le sujet: "${topic}".

Le texte doit être:
- Court (3 à 8 mots max)
- Accrocheur et engageant
- En lien avec "${topic}" et le bien-être/fitness
- En ${locale === 'fr' ? 'français' : 'anglais'}
- En MAJUSCULES

Exemples: "LE SECRET DE L'ÉNERGIE", "BOOSTE TA PERFORMANCE", "DÉCOUVRE SES BIENFAITS"

Réponds UNIQUEMENT en JSON: {"videoOverlayText": "TON TEXTE ICI"}`;

      const overlayRes = await callAnthropic(apiKey, {
        max_tokens: 256,
        messages: [{ role: 'user', content: overlayPrompt }],
      }, PRIMARY_MODEL);

      if (overlayRes.ok) {
        const overlayData = await overlayRes.json();
        const textBlock = overlayData.content?.find((c: any) => c.type === 'text');
        if (textBlock?.text) {
          try {
            let jsonStr = textBlock.text.trim();
            if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
            const s = jsonStr.indexOf('{'), e = jsonStr.lastIndexOf('}');
            if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);
            const parsed = JSON.parse(jsonStr);
            return NextResponse.json({ success: true, content: { videoOverlayText: parsed.videoOverlayText || '' } });
          } catch { /* fall through */ }
        }
      }
      // Retry with fallback model
      try {
        const retryRes = await callAnthropic(apiKey, {
          max_tokens: 256,
          messages: [{ role: 'user', content: overlayPrompt }],
        }, FALLBACK_MODEL);
        if (retryRes.ok) {
          const rd = await retryRes.json();
          const tb = rd.content?.find((c: any) => c.type === 'text');
          if (tb?.text) {
            let js = tb.text.trim();
            if (js.startsWith('```')) js = js.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
            const s2 = js.indexOf('{'), e2 = js.lastIndexOf('}');
            if (s2 !== -1 && e2 > s2) js = js.substring(s2, e2 + 1);
            const p = JSON.parse(js);
            return NextResponse.json({ success: true, content: { videoOverlayText: p.videoOverlayText || '' } });
          }
        }
      } catch { /* ignore */ }
      return NextResponse.json({ success: false, error: 'Could not generate overlay text' }, { status: 500 });
    }

    const count = Math.min(Math.max(cardCount, 1), 8);

    // Curated lucide-react icon names — must be kept in sync with ICON_MAP in
    // src/app/dashboard/creer/page.tsx. Claude must pick one of these for each card.
    const ICON_NAMES = [
      'Dumbbell','Flame','Zap','Trophy','Target','Activity','Bike',
      'Heart','Brain','Stethoscope','Pill','Cross','HeartPulse','Smile',
      'Apple','Carrot','Salad','Coffee','Pizza','Utensils','Wheat',
      'Leaf','Sun','Moon','Star','Cloud','Flower','TreePine','Sprout',
      'Laptop','Smartphone','Cpu','Wifi','Battery','Code','Bot',
      'DollarSign','TrendingUp','Gem','Briefcase','Wallet','BarChart','PieChart','Receipt',
      'Palette','Camera','Music','Mic','Video','PenTool','Brush',
      'Plane','Globe','Map','Mountain','Compass','MapPin','Hotel','Tent',
      'Award','ThumbsUp','Gift','Bell','Megaphone','PartyPopper','Sparkles',
      'Dog','Cat','Bird','Fish','Rabbit','Turtle',
      'Home','Building','Car','Train','Rocket','Ship','Bus',
      'ShoppingBag','ShoppingCart','Tag','Package','Truck','CreditCard',
      'Book','GraduationCap','Lightbulb','Library','Pencil','Ruler',
    ];

    const systemPrompt = `Tu es un expert en nutrition, santé, bien-être et fitness. Tu crées du contenu éducatif RICHE et PRÉCIS pour des infographies destinées aux réseaux sociaux.

CONTEXTE: L'utilisateur tape un sujet (ex: "moringa", "manioc", "collagène", "sommeil", etc.) et tu dois générer des VRAIES informations éducatives riches sur ce sujet. Le contenu est pour la marque Afroboost (fitness/danse/bien-être africain).

RÈGLES ABSOLUES:
1. Chaque carte DOIT contenir un VRAI fait scientifique ou nutritionnel VÉRIFIÉ sur le sujet
2. Les valeurs DOIVENT être des vrais chiffres/stats/données (ex: "60%", "2L/j", "500mg", "+30%", "48h", "3x/sem")
3. Les labels DOIVENT décrire un aspect SPÉCIFIQUE du sujet (pas générique)
4. Les descriptions DOIVENT expliquer le fait de manière claire et éducative (10-20 mots)
5. Les emojis DOIVENT être pertinents au contenu de CHAQUE carte et tous DIFFÉRENTS
6. Les phrases de vente DOIVENT mentionner le sujet spécifique et Afroboost
7. Le sous-titre DOIT être un fait accrocheur et vrai sur le sujet
8. La requête Pexels DOIT être liée au sujet réel (ex: "cassava root food" pour manioc, "moringa leaves powder" pour moringa)

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

    const existingCardsContext = existingCards.length > 0
      ? `\n\nCARTES EXISTANTES (NE PAS DUPLIQUER ces sujets, propose des aspects DIFFÉRENTS): ${existingCards.join(', ')}`
      : '';

    // Variation nonce forces genuinely different output on each batch call
    // even when the caller reuses the same topic. The model sees it as a
    // fingerprint and must treat the request as distinct.
    const nonce = typeof variationNonce === 'string' && variationNonce.trim()
      ? variationNonce.trim()
      : Math.random().toString(36).slice(2, 10);
    const variationPreamble = `\n\nIMPORTANT — VARIATION:
- Chaque appel doit produire un contenu NOUVEAU. Même sujet, angle, chiffres et formulations DIFFÉRENTS.
- Ne recopie pas tes sorties précédentes. Utilise des chiffres/études/exemples variés.
- Nonce de variation (ne pas mentionner dans la sortie): ${nonce}`;

    const userPrompt = `Génère du contenu d'infographie RICHE et ÉDUCATIF sur: "${topic}"${variationPreamble}

Le contenu doit être 100% axé sur "${topic}" — pas de contenu générique fitness.
Chaque carte = un vrai fait/chiffre sur "${topic}".
Les phrases de vente doivent promouvoir "${topic}" avec Afroboost.${existingCardsContext}

JSON requis (${locale === 'fr' ? 'tout en français' : 'tout en anglais'}):
{
  "title": "TITRE EN MAJUSCULES (2-4 mots, contenant ${topic})",
  "subtitle": "Fait accrocheur et vrai sur ${topic} en lien avec la santé/performance (max 15 mots)",
  "cards": [
    {
      "iconName": "nom d'icône lucide-react pertinent — OBLIGATOIRE — choisi UNIQUEMENT parmi: [${ICON_NAMES.join(', ')}]",
      "emoji": "emoji de fallback (utilisé seulement si iconName invalide)",
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

Retourne EXACTEMENT ${count} cartes, ni plus ni moins. IMPORTANT: chaque carte = un iconName lucide DIFFÉRENT et pertinent (choisi UNIQUEMENT dans la liste fournie). Le champ "emoji" n'est qu'un fallback — ne te repose pas dessus.`;

    console.log(`[AI-Generate] Calling Anthropic (${PRIMARY_MODEL}) for topic: "${topic}", cards: ${count}, nonce: ${nonce}`);

    const requestBody = {
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      // temperature>0 encourages per-call variation for batch exports.
      temperature: 1,
    };

    let response: Response;
    try {
      response = await callAnthropic(apiKey, requestBody, PRIMARY_MODEL);
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch-error');
      console.error(`[AI-Generate] Primary call failed (${reason}):`, e?.message || e);
      return NextResponse.json({ success: false, error: `AI API ${reason}` }, { status: 500 });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI-Generate] Anthropic API error ${response.status}:`, errorText);

      // If primary model not found / bad request, retry with a known-good model.
      if (response.status === 404 || response.status === 400) {
        console.log(`[AI-Generate] Retrying with ${FALLBACK_MODEL}...`);
        let retryResponse: Response;
        try {
          retryResponse = await callAnthropic(apiKey, requestBody, FALLBACK_MODEL);
        } catch (e: any) {
          const reason = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch-error');
          console.error(`[AI-Generate] Retry call failed (${reason}):`, e?.message || e);
          return NextResponse.json({ success: false, error: `AI API retry ${reason}` }, { status: 500 });
        }
        if (!retryResponse.ok) {
          const retryError = await retryResponse.text();
          console.error(`[AI-Generate] Retry also failed ${retryResponse.status}:`, retryError);
          return NextResponse.json({ success: false, error: `AI API error: ${retryResponse.status}` }, { status: 500 });
        }
        const retryData = await retryResponse.json();
        return parseAndReturn(retryData, topic, count, ICON_NAMES);
      }

      return NextResponse.json({ success: false, error: `AI API error: ${response.status}` }, { status: 500 });
    }

    const data = await response.json();
    return parseAndReturn(data, topic, count, ICON_NAMES);

  } catch (error: any) {
    console.error('[AI-Generate] Error:', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'AI content generation failed: ' + (error?.message || 'unknown') },
      { status: 500 }
    );
  }
}

function parseAndReturn(data: any, topic: string, count: number, iconNames: string[]) {
  // Extract text content
  const textContent = data.content?.find((c: any) => c.type === 'text');
  if (!textContent?.text) {
    console.error('[AI-Generate] No text in response:', JSON.stringify(data).substring(0, 500));
    return NextResponse.json({ success: false, error: 'No text response from AI' }, { status: 500 });
  }

  // Parse JSON from response
  let jsonStr = textContent.text.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }

  // Extract JSON object
  const jsonStart = jsonStr.indexOf('{');
  const jsonEnd = jsonStr.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
  }

  let content;
  try {
    content = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error('[AI-Generate] JSON parse error. Raw text:', textContent.text.substring(0, 1000));
    return NextResponse.json({ success: false, error: 'Failed to parse AI response' }, { status: 500 });
  }

  // Validate structure
  if (!content.title || !content.cards || !Array.isArray(content.cards)) {
    console.error('[AI-Generate] Invalid structure:', JSON.stringify(content).substring(0, 500));
    return NextResponse.json({ success: false, error: 'Invalid AI response structure' }, { status: 500 });
  }

  // Hard-cap to the requested count — Claude occasionally returns more than asked.
  content.cards = content.cards.slice(0, count);

  // Ensure each card has required fields. iconName is validated against the
  // allowed list — if Claude returned anything off-list, we fall back to a
  // sensible default so the client doesn't render a broken icon.
  const ALLOWED = new Set(iconNames);
  content.cards = content.cards.map((card: any) => {
    const rawName = typeof card.iconName === 'string' ? card.iconName.trim() : '';
    const iconName = ALLOWED.has(rawName) ? rawName : 'Sparkles';
    return {
      iconName,
      emoji: card.emoji || '📊',
      label: card.label || 'INFO',
      value: card.value || '-',
      description: card.description || '',
    };
  });

  // Ensure salesPhrases exists
  if (!content.salesPhrases || !Array.isArray(content.salesPhrases) || content.salesPhrases.length === 0) {
    content.salesPhrases = [
      `Découvre les bienfaits de ${topic} avec Afroboost`,
      `${topic} + Afroboost = ta meilleure version`,
      `Booste ta santé avec ${topic}`,
      `Rejoins le mouvement Afroboost et profite de ${topic}`,
      `Transforme ton énergie avec ${topic} et Afroboost`,
    ];
  }

  // Ensure pexelsQuery exists
  if (!content.pexelsQuery) {
    content.pexelsQuery = topic;
  }

  console.log(`[AI-Generate] Success: ${content.cards.length} cards, ${content.salesPhrases.length} phrases, pexels: "${content.pexelsQuery}"`);
  return NextResponse.json({ success: true, content });
}
