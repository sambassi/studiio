import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { deductCredits, getUserCredits } from '@/lib/credits/system';
import { detectAndReportServiceError } from '@/lib/service-alerts';
import Replicate from 'replicate';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // AI models can take up to 2 min

// ── Credit costs per AI action ──
const AI_CREDITS: Record<string, number> = {
  'remove-bg': 2,
  'magic-eraser': 3,
  'magic-edit': 5,
  'upscale': 3,
  'image-to-video': 15,
  'generate-bg': 5,
  'magic-layers': 3,
  'style-transfer': 5,
  // OCR : modele CPU a ~0,0003 $ le run, de loin le moins cher du lot.
  'ocr': 1,
};

// ── Replicate model IDs ──
// Community models need version hash (owner/model:hash), Official models don't
const MODELS: Record<string, `${string}/${string}`> = {
  'remove-bg': 'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003', // ✅ Warm, 11M runs (community — needs version hash)
  'upscale': 'nightmareai/real-esrgan',                       // ✅ Warm, Official, 89M runs
  'image-edit': 'black-forest-labs/flux-kontext-pro',         // ✅ Warm, Official, 49.7M runs, $0.04/img
  'generate-bg': 'black-forest-labs/flux-schnell',             // ✅ Warm, Official, 655M runs
  'image-to-video': 'wan-video/wan-2.2-i2v-fast',             // ✅ Warm, Official, 10.6M runs
  // ✅ Warm, 91.4M runs — le modele OCR le plus utilise de Replicate.
  // Communautaire → hash de version OBLIGATOIRE (une seule version publiee,
  // relevee sur replicate.com/abiruyt/text-extract-ocr/versions).
  // Entree : { image: <url> }. Sortie : du TEXTE, pas une image.
  'ocr': 'abiruyt/text-extract-ocr:a524caeaa23495bc9edc805ab08ab5fe943afd3febed884a4f3747aa32e9cd61',
};

// ── French → English translation pour les prompts IA ──
// FLUX Kontext est principalement entraîné sur l'anglais. Si le user
// type "le titre" en français, l'interpréter comme "title text" évite
// que le modèle confonde avec une instruction générique ("remove le titre"
// matched as "remove background-like-element").
//
// Map des termes les plus courants tapés par l'utilisateur français.
// L'ordre compte : les expressions multi-mots passent AVANT les single mots.
const FR_TO_EN_PROMPTS: Array<[RegExp, string]> = [
  // Multi-mots d'abord
  [/\b(le |la |les |l')?\s*titre principal\b/gi, 'main title text'],
  [/\b(le |la |les |l')?\s*sous-titres?\b/gi, 'subtitle text'],
  [/\b(le |la |les |l')?\s*arrière-plans?\b/gi, 'background'],
  [/\b(le |la |les |l')?\s*arrière plans?\b/gi, 'background'],
  [/\b(le |la |les |l')?\s*plan derrière\b/gi, 'background'],
  // Puis single mots
  [/\b(le |la |les |l')?\s*titres?\b/gi, 'title text'],
  [/\b(le |la |les |l')?\s*textes?\b/gi, 'text'],
  [/\b(le |la |les |l')?\s*logos?\b/gi, 'logo'],
  [/\b(le |la |les |l')?\s*fonds?\b/gi, 'background'],
  [/\b(le |la |les |l')?\s*personnes?\b/gi, 'person'],
  [/\b(le |la |les |l')?\s*personnages?\b/gi, 'character'],
  [/\b(le |la |les |l')?\s*visages?\b/gi, 'face'],
  [/\b(le |la |les |l')?\s*ciels?\b/gi, 'sky'],
  [/\b(le |la |les |l')?\s*objet[s]?\b/gi, 'object'],
  [/\bsupprimer?\b/gi, 'remove'],
  [/\beffacer?\b/gi, 'erase'],
  [/\bremplacer?\b/gi, 'replace'],
  [/\bchanger?\b/gi, 'change'],
  [/\bajouter?\b/gi, 'add'],
];

/**
 * Lit la sortie TEXTE d'un modele Replicate (action `ocr`).
 *
 * Trois formes possibles selon le modele et le SDK :
 *   - `string` — le cas de abiruyt/text-extract-ocr ;
 *   - `string[]` — sortie declaree `Iterator[str]` : `replicate.run` rend les
 *     morceaux streames dans l'ordre, a recoller sans separateur ;
 *   - objet avec `toString()` (FileOutput du SDK 1.x).
 *
 * Renvoie `null` si rien n'est lisible (a distinguer de `''`, qui veut dire
 * « lu correctement, mais aucun texte dans l'image »).
 */
export function extractText(output: unknown): string | null {
  if (output == null) return null;
  if (typeof output === 'string') return output.trim();
  if (Array.isArray(output)) {
    const parts = output.filter((p) => typeof p === 'string') as string[];
    if (parts.length !== output.length) return null;
    return parts.join('').trim();
  }
  if (typeof output === 'object') {
    const obj = output as { toString?: () => string };
    if (typeof obj.toString === 'function') {
      const str = obj.toString();
      // `[object Object]` = pas de toString utile → illisible.
      if (str && !str.startsWith('[object ')) return str.trim();
    }
  }
  return null;
}

function translateFrPromptToEn(prompt: string): string {
  let result = prompt;
  for (const [pattern, replacement] of FR_TO_EN_PROMPTS) {
    result = result.replace(pattern, replacement);
  }
  return result.trim();
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Non autorisé' }, { status: 401 });
    }

    const { action, imageUrl, prompt, style } = await req.json();

    if (!action || !AI_CREDITS[action]) {
      return NextResponse.json({ success: false, error: 'Action invalide' }, { status: 400 });
    }

    // Check credits
    const credits = await getUserCredits(session.user.id);
    const cost = AI_CREDITS[action];
    if (credits < cost) {
      return NextResponse.json({
        success: false,
        error: `Crédits insuffisants (${credits} dispo, ${cost} requis)`,
        creditsNeeded: cost,
        creditsAvailable: credits,
      }, { status: 402 });
    }

    // Validate REPLICATE_API_TOKEN
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ success: false, error: 'Service IA non configuré' }, { status: 503 });
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    let output: unknown;

    switch (action) {
      // ── 1. Remove Background ──
      case 'remove-bg': {
        if (!imageUrl) return NextResponse.json({ success: false, error: 'imageUrl requis' }, { status: 400 });
        output = await replicate.run(MODELS['remove-bg'], {
          input: { image: imageUrl },
        });
        break;
      }

      // ── 2. Magic Eraser (FLUX Kontext Pro — remove elements) ──
      case 'magic-eraser': {
        if (!imageUrl || !prompt) return NextResponse.json({ success: false, error: 'imageUrl et prompt requis' }, { status: 400 });
        // FLUX Kontext est principalement entraîné sur l'anglais. Traduire
        // les termes français courants évite que "le titre" → "Remove le
        // titre" soit mal interprété et déclenche un background removal
        // global au lieu de l'effacement ciblé du titre.
        const target = translateFrPromptToEn(prompt);
        // Prompt structuré pour le modèle :
        //  1. ACTION explicite (Erase, pas Remove qui est ambigu vs bg-removal)
        //  2. CIBLE précise
        //  3. PRÉSERVATION du reste (anti-régression sur la composition)
        //  4. INPAINT pixel-level (anti-flat-fill)
        output = await replicate.run(MODELS['image-edit'], {
          input: {
            input_image: imageUrl,
            prompt: `Erase only the ${target} from this image. Keep the subject, background, lighting, and overall composition exactly identical. Inpaint the erased area to seamlessly continue the surrounding pixels — do NOT replace the background.`,
            aspect_ratio: 'match_input_image',
            output_format: 'png',
            safety_tolerance: 2,
          },
        });
        if (Array.isArray(output)) output = output[0];
        break;
      }

      // ── 3. Magic Edit (FLUX Kontext Pro — text-based editing) ──
      case 'magic-edit': {
        if (!imageUrl || !prompt) return NextResponse.json({ success: false, error: 'imageUrl et prompt requis' }, { status: 400 });
        // Same translation pour les prompts français
        const editPrompt = translateFrPromptToEn(prompt);
        output = await replicate.run(MODELS['image-edit'], {
          input: {
            input_image: imageUrl,
            prompt: editPrompt,
            aspect_ratio: 'match_input_image',
            output_format: 'png',
            safety_tolerance: 2,
          },
        });
        if (Array.isArray(output)) output = output[0];
        break;
      }

      // ── 4. Upscale (Real-ESRGAN) ──
      case 'upscale': {
        if (!imageUrl) return NextResponse.json({ success: false, error: 'imageUrl requis' }, { status: 400 });
        output = await replicate.run(MODELS['upscale'], {
          input: {
            image: imageUrl,
            scale: 2,
            face_enhance: true,
          },
        });
        break;
      }

      // ── 5. Image to Video (Wan 2.2 Fast) ──
      case 'image-to-video': {
        if (!imageUrl) return NextResponse.json({ success: false, error: 'imageUrl requis' }, { status: 400 });
        output = await replicate.run(MODELS['image-to-video'], {
          input: {
            image: imageUrl,
            prompt: prompt || 'smooth gentle motion, professional video',
          },
        });
        break;
      }

      // ── 6. Generate Background (Flux Schnell) ──
      case 'generate-bg': {
        if (!prompt) return NextResponse.json({ success: false, error: 'prompt requis' }, { status: 400 });
        output = await replicate.run(MODELS['generate-bg'], {
          input: {
            prompt: `${prompt}, high quality, professional background, 9:16 aspect ratio`,
            num_outputs: 1,
            aspect_ratio: '9:16',
            output_format: 'webp',
            output_quality: 90,
          },
        });
        if (Array.isArray(output)) output = output[0];
        break;
      }

      // ── 7. Magic Layers (Segment + Remove BG — rembg) ──
      case 'magic-layers': {
        if (!imageUrl) return NextResponse.json({ success: false, error: 'imageUrl requis' }, { status: 400 });
        output = await replicate.run(MODELS['remove-bg'], {
          input: { image: imageUrl },
        });
        break;
      }

      // ── 8. Style Transfer (FLUX Kontext Pro) ──
      case 'style-transfer': {
        if (!imageUrl || !style) return NextResponse.json({ success: false, error: 'imageUrl et style requis' }, { status: 400 });
        output = await replicate.run(MODELS['image-edit'], {
          input: {
            input_image: imageUrl,
            prompt: `Transform this image into ${style} style. Make it artistic and professional while keeping the same composition and subject.`,
            aspect_ratio: 'match_input_image',
            output_format: 'png',
            safety_tolerance: 2,
          },
        });
        if (Array.isArray(output)) output = output[0];
        break;
      }

      // ── 9. OCR / Capture de texte ──
      // SEULE action dont la sortie est du texte. Elle repond ici et ne
      // descend PAS dans l'extraction d'URL ci-dessous : le chemin image des
      // huit autres outils reste strictement inchange.
      case 'ocr': {
        if (!imageUrl) return NextResponse.json({ success: false, error: 'imageUrl requis' }, { status: 400 });
        const ocrOutput = await replicate.run(MODELS['ocr'], {
          input: { image: imageUrl },
        });

        const text = extractText(ocrOutput);
        if (text === null) {
          console.error('[AI Image][OCR] Sortie illisible. Type:', typeof ocrOutput, 'Constructor:', (ocrOutput as { constructor?: { name?: string } })?.constructor?.name);
          return NextResponse.json({
            success: false,
            error: 'Le modèle OCR a répondu mais le texte n\'a pas pu être lu. Réessayez.',
          }, { status: 500 });
        }
        if (text.length === 0) {
          // Aucun texte trouve : ce n'est pas une panne, mais on ne facture
          // pas un resultat vide.
          return NextResponse.json({
            success: true,
            text: '',
            empty: true,
            action,
            creditsUsed: 0,
            creditsRemaining: credits,
          });
        }

        // Debit APRES lecture reussie, comme sur le chemin image.
        await deductCredits(session.user.id, cost, `ai-${action}`);

        return NextResponse.json({
          success: true,
          text,
          action,
          creditsUsed: cost,
          creditsRemaining: credits - cost,
        });
      }

      default:
        return NextResponse.json({ success: false, error: 'Action inconnue' }, { status: 400 });
    }

    // Extract URL from output BEFORE deducting credits — si l'extraction
    // échoue, on ne facture pas le user pour rien.
    //
    // ⚠️ Replicate JS SDK 1.x retourne des `FileOutput` objects qui :
    //   - extends ReadableStream
    //   - ont une MÉTHODE `.url()` (pas une propriété) qui retourne URL
    //   - ont `.toString()` qui retourne la string URL
    //
    // L'ancien code faisait `output.url` (récupère la FONCTION, pas l'URL)
    // ET `output instanceof ReadableStream` matchait FileOutput → resultUrl
    // était soit garbage soit null. C'est pourquoi tous les outils IA
    // semblaient "ne pas fonctionner" alors que Replicate répondait OK.
    const extractUrl = (item: unknown): string | null => {
      if (item == null) return null;
      if (typeof item === 'string') return item;
      if (typeof item === 'object') {
        const obj = item as { url?: unknown; toString?: () => string };
        // Cas FileOutput SDK 1.x : url est une METHODE
        if (typeof obj.url === 'function') {
          try {
            const u = (obj.url as () => unknown)();
            if (u instanceof URL) return u.toString();
            if (typeof u === 'string') return u;
          } catch { /* fallthrough */ }
        }
        // Cas où url est directement une string ou URL property
        if (typeof obj.url === 'string') return obj.url;
        if (obj.url instanceof URL) return obj.url.toString();
        // Dernier recours : toString() de FileOutput retourne la URL
        if (typeof obj.toString === 'function') {
          const str = obj.toString();
          if (str.startsWith('http://') || str.startsWith('https://')) return str;
        }
      }
      return null;
    };

    let resultUrl: string | null = null;
    if (Array.isArray(output)) {
      // Certains modèles retournent un tableau (ex: flux-schnell num_outputs > 1)
      resultUrl = extractUrl(output[0]);
    } else {
      resultUrl = extractUrl(output);
    }

    if (!resultUrl) {
      console.error('[AI Image] Unable to extract URL from output. Type:', typeof output, 'Constructor:', output?.constructor?.name);
      return NextResponse.json({
        success: false,
        error: 'Le modèle IA a répondu mais le résultat n\'a pas pu être extrait. Réessayez ou contactez le support.',
      }, { status: 500 });
    }

    // Deduct credits AFTER successful extraction
    await deductCredits(session.user.id, cost, `ai-${action}`);

    return NextResponse.json({
      success: true,
      resultUrl,
      action,
      creditsUsed: cost,
      creditsRemaining: credits - cost,
    });
  } catch (error) {
    console.error('[AI Image] Error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur inconnue';

    // Report to admin alert system
    detectAndReportServiceError('replicate', error);

    // User-friendly error messages
    if (msg.includes('402') || msg.includes('Insufficient credit') || msg.includes('less than')) {
      return NextResponse.json({
        success: false,
        error: 'Service IA temporairement indisponible (crédits API épuisés). L\'administrateur a été notifié.',
      }, { status: 503 });
    }
    if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('throttled') || msg.includes('rate limit')) {
      return NextResponse.json({
        success: false,
        error: 'Trop de requêtes IA simultanées. Veuillez patienter quelques secondes et réessayer.',
      }, { status: 429 });
    }
    if (msg.includes('404') || msg.includes('Not Found') || msg.includes('not be found')) {
      return NextResponse.json({
        success: false,
        error: 'Modèle IA temporairement indisponible. L\'administrateur a été notifié.',
      }, { status: 503 });
    }
    if (msg.includes('422') || msg.includes('Invalid version')) {
      return NextResponse.json({
        success: false,
        error: 'Modèle IA temporairement indisponible. Réessayez plus tard.',
      }, { status: 503 });
    }

    return NextResponse.json({ success: false, error: 'Une erreur est survenue avec le service IA. Réessayez plus tard.' }, { status: 500 });
  }
}
