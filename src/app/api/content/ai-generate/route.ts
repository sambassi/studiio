import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { shortenForCard } from '@/lib/smart-content';
import { briefPourPrompt } from '@/lib/creer/brief';
import { detectAndReportServiceError } from '@/lib/service-alerts';
import { carteSansChiffresInventes, chiffresAutorises, CONSIGNE_SANS_CHIFFRES, texteSansChiffresInventes } from '@/lib/contenu/chiffres-sources';
import {
  DELAI_TEXTE_MS, MODELE_TEXTE_PRIMAIRE, MODELE_TEXTE_REPLI,
  appelerModeleTexte, genererTexteIA,
} from '@/lib/ia/texte';

// Modeles, delai et appel HTTP : le moteur de texte PARTAGE (`lib/ia/texte.ts`), extrait
// de ce fichier pour que l'aide a la redaction de Cinema IA passe par le MEME chemin —
// meme cle serveur, memes modeles, meme repli. Les valeurs n'ont pas change.
const PRIMARY_MODEL = MODELE_TEXTE_PRIMAIRE;
const FALLBACK_MODEL = MODELE_TEXTE_REPLI;
const AI_TIMEOUT_MS = DELAI_TEXTE_MS;

async function callAnthropic(
  apiKey: string,
  body: Record<string, any>,
  model: string,
): Promise<Response> {
  return appelerModeleTexte(apiKey, body, model, AI_TIMEOUT_MS);
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

    const body = await req.json().catch(() => ({}));
    console.log('[AI-Generate] body received:', JSON.stringify(body).slice(0, 400));
    let topic: string = typeof body?.topic === 'string' ? body.topic.trim() : '';
    const { locale = 'fr', cardCount = 3, existingCards = [], existingTitles = [], videoOverlayOnly = false, fieldType, variationNonce } = body;
    // Le brief de la video — objectif, message, public, CTA. `''` sans brief :
    // le prompt reste alors EXACTEMENT celui d'avant, pour tous les appels
    // qui n'en envoient pas.
    const briefContext = briefPourPrompt(body?.brief);

    // Coerce missing/invalid topic to a usable default for single-field
    // calls (title/subtitle/cta/etc.) so the user who just clicked a
    // button gets something back rather than a silent 400. Non-field
    // calls still validate strictly.
    if (!topic) {
      if (fieldType) {
        console.warn('[AI-Generate] topic missing for fieldType', fieldType, '— defaulting to "fitness"');
        topic = 'fitness';
      } else {
        console.warn('[AI-Generate] 400: topic missing. body keys:', Object.keys(body));
        return NextResponse.json({ success: false, error: 'Topic is required' }, { status: 400 });
      }
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
        salesPhraseRewrite: `Reformule cette phrase de vente pour la rendre plus accrocheuse et concise (max 120 caractères). Garde l'idée principale mais améliore le punch : "${topic}". Réponds UNIQUEMENT en JSON: {"text":"..."}`,
      };
      // Le brief vient APRES la consigne de format : on la repete donc, pour
      // que la derniere ligne lue par le modele reste la forme attendue.
      const prompt = (fieldPrompts[fieldType] || fieldPrompts.title)
        + (briefContext ? `${briefContext}\nRéponds UNIQUEMENT en JSON: {"text":"..."}` : '');
      // Le moteur partage essaie le modele rapide, retombe sur Sonnet, et s'arrete net sur
      // une erreur de facturation. Les reponses HTTP ci-dessous sont celles d'avant.
      const issue = await genererTexteIA({ cleApi: apiKey, prompt, maxTokens: 256 });
      if (issue.ok) return NextResponse.json({ success: true, text: issue.texte });
      if (issue.motif === 'indisponible') {
        console.warn('[AI-Generate] Anthropic billing error — signaling local fallback');
        return NextResponse.json({
          success: false,
          error: 'Service IA temporairement indisponible, utilisation du mode local',
          useLocalFallback: true,
        }, { status: 503 });
      }
      if (issue.motif === 'reponse') {
        console.error('[AI-Generate] field call unusable:', fieldType, issue.detail);
        return NextResponse.json({
          success: false,
          error: issue.statut ? `AI status ${issue.statut}` : (issue.detail === 'reponse vide' ? 'Empty AI response' : 'Could not parse AI response'),
        }, { status: 502 });
      }
      console.error('[AI-Generate] field call threw:', fieldType, issue.detail);
      return NextResponse.json({ success: false, error: issue.detail }, { status: 500 });
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
2. ${CONSIGNE_SANS_CHIFFRES}
3. Les labels DOIVENT décrire un aspect SPÉCIFIQUE du sujet (pas générique)
4. Les descriptions DOIVENT expliquer le fait de manière claire et éducative (10-20 mots)
5. Les emojis DOIVENT être pertinents au contenu de CHAQUE carte et tous DIFFÉRENTS
6. Les phrases de vente DOIVENT mentionner le sujet spécifique et Afroboost
7. Le sous-titre DOIT être un fait accrocheur et vrai sur le sujet
8. La requête Pexels DOIT être liée au sujet réel (ex: "cassava root food" pour manioc, "moringa leaves powder" pour moringa)

EXEMPLES DE QUALITÉ ATTENDUE (aucun chiffre inventé):

Sujet "manioc":
- 🥔 ÉNERGIE DURABLE | CARBURANT | "Riche en glucides complexes, il nourrit tes séances longues."
- 🌿 SANS GLUTEN | NATUREL | "Une alternative simple pour les personnes qui évitent le gluten."
- 💪 DIGESTION | FIBRES | "Ses fibres accompagnent une digestion régulière au quotidien."

Sujet "moringa":
- 🌿 PROTÉINES VÉGÉTALES | VÉGÉTAL | "Ses feuilles séchées apportent des protéines végétales."
- 🦴 MINÉRAUX | ESSENTIEL | "Une source de calcium et de fer à intégrer à tes repas."
- 🧠 ANTIOXYDANTS | PROTECTION | "Des antioxydants naturels pour accompagner ton équilibre."

Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans commentaires.`;

    const existingCardsContext = existingCards.length > 0
      ? `\n\nCARTES EXISTANTES (NE PAS DUPLIQUER ces sujets, propose des aspects DIFFÉRENTS): ${existingCards.join(', ')}`
      : '';
    const existingTitlesContext = Array.isArray(existingTitles) && existingTitles.length > 0
      ? `\n\nTITRES DÉJÀ UTILISÉS (INTERDITS — trouve un titre CLAIREMENT DIFFÉRENT): ${existingTitles.map((t: string) => `"${t}"`).join(', ')}`
      : '';

    // Variation nonce forces genuinely different output on each batch call
    // even when the caller reuses the same topic. The model sees it as a
    // fingerprint and must treat the request as distinct.
    const nonce = typeof variationNonce === 'string' && variationNonce.trim()
      ? variationNonce.trim()
      : Math.random().toString(36).slice(2, 10);

    // The batch loop in /creer sends aiTopic as "${topic} (angle: ${angle})"
    // Pull the angle out so we can cite it explicitly in the title rule.
    // Without this, Claude keeps defaulting to the same natural title
    // phrasing regardless of which angle the nonce supposedly selects.
    const angleRegex = /\(angle:\s*([^)]+)\)/i;
    const angleMatch = angleRegex.exec(topic);
    const extractedAngle = angleMatch ? angleMatch[1].trim() : null;
    const angleDirective = extractedAngle
      ? `\n- L'angle de CE post est : « ${extractedAngle} ». Le "title" ET le "subtitle" DOIVENT refléter CET angle précis — pas un titre générique.`
      : '';
    const variationPreamble = `\n\nIMPORTANT — VARIATION OBLIGATOIRE:
- Chaque appel DOIT produire un "title" et un "subtitle" ENTIÈREMENT DIFFÉRENTS des sorties précédentes. Ne répète JAMAIS le même titre deux fois pour un batch.
- Titres génériques INTERDITS : "BOOST NATUREL", "BIENFAITS NATURELS", "LE GUIDE". Trouve un angle plus spécifique.
- Le titre doit être un HOOK frappant et SPÉCIFIQUE à l'angle (ex: "30 JOURS CHRONO", "CE QUE TU IGNORES", "MATIN VS SOIR", "L'ERREUR #1").${angleDirective}
- Même sujet, angle et formulations DIFFÉRENTS pour chaque appel (jamais de chiffre inventé).
- Nonce de variation (ne pas mentionner dans la sortie): ${nonce}`;

    const userPrompt = `Génère du contenu d'infographie RICHE et ÉDUCATIF sur: "${topic}"${variationPreamble}

Le contenu doit être 100% axé sur "${topic}" — pas de contenu générique fitness.
Chaque carte = un fait utile sur "${topic}", sans chiffre que l\'utilisateur n\'a pas donné.
Les phrases de vente doivent promouvoir "${topic}" avec Afroboost.${existingCardsContext}${existingTitlesContext}${briefContext}

JSON requis (${locale === 'fr' ? 'tout en français' : 'tout en anglais'}):
{
  "title": "TITRE UNIQUE EN MAJUSCULES (2-4 mots). Doit évoquer l'ANGLE SPÉCIFIQUE du post, pas juste ${topic}. Évite les titres génériques type BOOST/BIENFAITS/GUIDE. Préfère un hook percutant (ex: ÉNERGIE EXPRESS, 30 JOURS CHRONO, CE QUE TU IGNORES, MATIN VS SOIR, L'ERREUR #1).",
  "subtitle": "Fait accrocheur DIFFÉRENT du title et vrai sur ${topic} — relié à l'angle et à la santé/performance (max 15 mots).",
  "cards": [
    {
      "iconName": "nom d'icône lucide-react pertinent — OBLIGATOIRE — choisi UNIQUEMENT parmi: [${ICON_NAMES.join(', ')}]",
      "emoji": "emoji de fallback (utilisé seulement si iconName invalide)",
      "label": "ASPECT SPÉCIFIQUE DE ${topic.toUpperCase()} (2-4 mots)",
      "value": "MOT COURT SANS CHIFFRE (ex: CLÉ, MALIN, ASTUCE) — un nombre seulement s\'il figure dans le sujet ou le brief. JAMAIS la redite du label, d\'un de ses mots ni de son début tronqué (\"DOPA\" pour \"DOPAMINE\" est interdit). Rien de neuf à dire : chaîne VIDE \"\" (jamais \"-\")",
      "description": "PHRASE COMPLÈTE de 8 à 15 mots MAXIMUM, finit par un point, jamais tronquée, ≤ 80 caractères"
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
      // 1024 is plenty for a 5-card payload with icon + 8-12 word description
      // each and trims response latency meaningfully on Haiku.
      max_tokens: 1024,
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
        return parseAndReturn(retryData, topic, count, ICON_NAMES, chiffresAutorises(topic, briefContext));
      }

      return NextResponse.json({ success: false, error: `AI API error: ${response.status}` }, { status: 500 });
    }

    const data = await response.json();
    return parseAndReturn(data, topic, count, ICON_NAMES, chiffresAutorises(topic, briefContext));

  } catch (error: any) {
    console.error('[AI-Generate] Error:', error?.message || error);
    detectAndReportServiceError('anthropic', error);
    return NextResponse.json(
      { success: false, error: 'AI content generation failed: ' + (error?.message || 'unknown') },
      { status: 500 }
    );
  }
}

function parseAndReturn(data: any, topic: string, count: number, iconNames: string[], autorises: ReadonlySet<string> = chiffresAutorises(topic)) {
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
    // Normalize description to ≤ 80 chars, complete sentence. This is a
    // safety net — the prompt already asks for 8-15 words, but the model
    // sometimes overshoots. Truncating server-side prevents the preview's
    // 40-char `truncate` CSS from cutting a word mid-phrase.
    // AUCUN CHIFFRE INVENTÉ : filet après le prompt — un nombre absent du
    // sujet et du brief de l'utilisateur est retiré (`chiffres-sources.ts`).
    const propre = carteSansChiffresInventes({ label: String(card.label || 'INFO'), value: String(card.value ?? ''), description: String(card.description || '') }, autorises);
    return {
      iconName,
      emoji: card.emoji || '📊',
      label: propre.label || 'INFO',
      // Vide = carte titre + icône (`badgeValide`) ; plus de « - » affiché
      // comme une valeur. Une valeur qui redit le libellé est déjà vidée
      // (`valeurRedondante`, dans `carteSansChiffresInventes`).
      value: propre.value ?? '',
      description: shortenForCard(propre.description || '', 80),
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

  if (typeof content.subtitle === 'string') content.subtitle = texteSansChiffresInventes(content.subtitle, autorises);

  // Ensure pexelsQuery exists
  if (!content.pexelsQuery) {
    content.pexelsQuery = topic;
  }

  console.log(`[AI-Generate] Success: ${content.cards.length} cards, ${content.salesPhrases.length} phrases, pexels: "${content.pexelsQuery}"`);
  return NextResponse.json({ success: true, content });
}
