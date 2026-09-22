import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/lib/auth/config';
import { deductCredits, getUserCredits } from '@/lib/credits/system';
import { referenceOperation } from '@/lib/credits/atomique';
import { detectAndReportServiceError, reportServiceAlert } from '@/lib/service-alerts';
import { supabaseAdmin } from '@/lib/db/supabase';
import Replicate from 'replicate';
import { extractText } from '@/lib/ai/extract-text';
import { erreurReplicateSanitisee } from '@/lib/ai/replicate-erreur';
import { detecterSignatureImage, MAX_AFFICHE_IA_BYTES } from '@/lib/storage/image-signature';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // AI models can take up to 2 min

// ── Affiche IA (`generate-bg`) : constantes du chemin durable ──
//
// Formats acceptes, STRICTS : c'est la valeur envoyee telle quelle a
// Replicate (`aspect_ratio`), donc pas question d'y laisser passer une chaine
// libre. Absent → 9:16, le seul format que l'ancien client envoyait.
const FORMATS_AFFICHE_IA = ['9:16', '1:1', '16:9'] as const;
type FormatAfficheIA = (typeof FORMATS_AFFICHE_IA)[number];
const PROMPT_AFFICHE_IA_MAX = 1000;
/** Delai maximal accorde a Replicate pour produire l'image. */
const DELAI_GENERATION_MS = 90_000;
/** Delai maximal du telechargement d'une sortie URL « legacy ». */
const DELAI_TELECHARGEMENT_MS = 30_000;
const BUCKET_AFFICHE_IA = 'media';

/**
 * Erreur du chemin Affiche IA qui a DEJA son statut HTTP et son message
 * utilisateur, et qui ne concerne PAS le fournisseur : une sortie illisible,
 * un delai depasse, un stockage en panne. Elle est repondue telle quelle,
 * sans alerte Replicate. Les vraies erreurs Replicate, elles, remontent au
 * `catch` general de la route.
 */
class ErreurAfficheIA extends Error {
  constructor(public readonly status: number, message: string, public readonly etape: string) {
    super(message);
    this.name = 'ErreurAfficheIA';
  }
}

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

function translateFrPromptToEn(prompt: string): string {
  let result = prompt;
  for (const [pattern, replacement] of FR_TO_EN_PROMPTS) {
    result = result.replace(pattern, replacement);
  }
  return result.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Affiche IA (`generate-bg`) — chemin durable
//
// Avant : la route renvoyait l'URL temporaire `replicate.delivery` telle
// quelle. Replicate l'efface au bout d'une heure : l'affiche disparaissait du
// projet, des exports et du calendrier, alors que les credits etaient bien
// partis. Maintenant les octets sont rapatries cote serveur, verifies, ecrits
// dans NOTRE stockage, et c'est cette URL-la qui est renvoyee — et facturee.
//
// Ordre : validation → generation (avec delai) → octets → signature → upload
// → URL publique absolue → debit → reponse. Tout echec AVANT le debit ne
// coute rien a l'utilisateur ; un echec du debit efface l'objet ecrit.
// ═══════════════════════════════════════════════════════════════════════════

/** Lit un flux en le bornant : au-dela de `max` octets, on arrete et on refuse. */
async function lireFluxBorne(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        throw new ErreurAfficheIA(502, 'L\'image générée est trop volumineuse. Réessayez.', 'taille');
      }
      morceaux.push(value);
    }
  } finally {
    // Un flux abandonne (trop gros) doit etre ferme, sinon la connexion
    // sous-jacente reste ouverte.
    try { await reader.cancel(); } catch { /* deja ferme */ }
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const m of morceaux) { out.set(m, offset); offset += m.byteLength; }
  return out;
}

/**
 * Chemin « legacy » : le SDK a rendu une URL nue au lieu d'un `FileOutput`
 * (`useFileOutput: false`, ou ancienne version). On la telecharge nous-memes,
 * avec des garde-fous stricts : https uniquement, hote `replicate.delivery`
 * exclusivement, aucun identifiant dans l'URL, aucune redirection suivie,
 * delai et taille bornes. Cette URL vient du SDK, JAMAIS du corps de la
 * requete.
 */
async function telechargerSortieLegacy(urlBrute: string): Promise<Uint8Array> {
  let url: URL;
  try { url = new URL(urlBrute); } catch {
    throw new ErreurAfficheIA(502, 'Le modèle IA a renvoyé une sortie illisible. Réessayez.', 'url-invalide');
  }
  const hote = url.hostname.toLowerCase();
  const hoteAutorise = hote === 'replicate.delivery' || hote.endsWith('.replicate.delivery');
  if (url.protocol !== 'https:' || !hoteAutorise || url.username || url.password) {
    throw new ErreurAfficheIA(502, 'Le modèle IA a renvoyé une sortie inattendue. Réessayez.', 'url-refusee');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DELAI_TELECHARGEMENT_MS);
  try {
    const res = await fetch(url.toString(), { redirect: 'manual', signal: ctrl.signal });
    // `redirect: 'manual'` : une 3xx arrive ici avec son statut (ou en
    // reponse opaque, statut 0). Dans les deux cas on refuse — on ne suit
    // jamais un lien vers un hote qu'on n'a pas verifie.
    if (!res.ok || !res.body) {
      throw new ErreurAfficheIA(502, 'Le modèle IA a renvoyé une sortie inaccessible. Réessayez.', 'telechargement');
    }
    return await lireFluxBorne(res.body as ReadableStream<Uint8Array>, MAX_AFFICHE_IA_BYTES);
  } catch (err) {
    if (err instanceof ErreurAfficheIA) throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new ErreurAfficheIA(504, 'Le téléchargement de l\'image a pris trop de temps. Réessayez.', 'telechargement-delai');
    }
    throw new ErreurAfficheIA(502, 'Le modèle IA a renvoyé une sortie inaccessible. Réessayez.', 'telechargement');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Obtient les octets de la PREMIERE sortie du modele, cote serveur.
 *
 * SDK Replicate 1.x : un `FileOutput`, qui `extends ReadableStream` et
 * expose `.blob()` et `.url()`. On lit le flux en le bornant quand c'est
 * possible (`getReader`), sinon `.blob()`. Une chaine nue passe par le
 * chemin legacy garde. Tout le reste est illisible.
 */
async function lireOctetsSortie(output: unknown): Promise<Uint8Array> {
  const premiere = Array.isArray(output) ? output[0] : output;
  if (premiere == null) {
    throw new ErreurAfficheIA(502, 'Le modèle IA n\'a renvoyé aucune image. Réessayez.', 'sortie-vide');
  }
  if (typeof premiere === 'string') return telechargerSortieLegacy(premiere);

  if (typeof premiere === 'object') {
    const o = premiere as { getReader?: unknown; blob?: unknown };
    if (typeof o.getReader === 'function') {
      return lireFluxBorne(premiere as ReadableStream<Uint8Array>, MAX_AFFICHE_IA_BYTES);
    }
    if (typeof o.blob === 'function') {
      const blob = await (o.blob as () => Promise<Blob>)();
      if (blob.size > MAX_AFFICHE_IA_BYTES) {
        throw new ErreurAfficheIA(502, 'L\'image générée est trop volumineuse. Réessayez.', 'taille');
      }
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  throw new ErreurAfficheIA(502, 'Le modèle IA a répondu mais l\'image n\'a pas pu être lue. Réessayez.', 'sortie-illisible');
}

/**
 * Lance la generation avec un delai.
 *
 * ⚠️ Ce que `signal` fait REELLEMENT dans le SDK Replicate 1.4.0
 * (`node_modules/replicate/index.js`, `run()` l. 145-195) :
 *   - `run` destructure `signal` mais ne le transmet PAS a
 *     `predictions.create` (seul `...data` est repandu) : le POST initial,
 *     envoye avec `Prefer: wait` et tenu jusqu'a ~60 s cote Replicate, n'est
 *     donc pas interruptible ;
 *   - il n'est pas transmis non plus aux `predictions.get` de `wait()` ;
 *   - il est seulement consulte dans le rappel `stop` du polling (toutes les
 *     500 ms), puis declenche `predictions.cancel(id)`.
 * Donc `signal` annule bien la prediction (on arrete de payer Replicate),
 * mais il ne peut pas raccourcir une requete HTTP en cours. D'ou la course
 * ci-dessous : le handler repond au bout de DELAI_GENERATION_MS quoi qu'il
 * arrive ; la promesse du SDK finit sa requete en cours puis annule.
 */
async function genererAvecDelai(
  replicate: Replicate,
  input: Record<string, unknown>,
  // Modèle à exécuter. Défaut : `generate-bg` (flux-schnell, texte → image).
  // `image-edit` (flux-kontext-pro) est le chemin « partir de ma photo » : une
  // image de référence + une consigne, pour préserver le sujet (visage,
  // vêtements, identité). Même délai, même rapatriement durable, même débit.
  modelKey: 'generate-bg' | 'image-edit' = 'generate-bg',
): Promise<unknown> {
  const ctrl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const delai = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new ErreurAfficheIA(504, 'La génération a pris trop de temps. Réessayez.', 'delai'));
    }, DELAI_GENERATION_MS);
  });
  try {
    return await Promise.race([
      replicate.run(MODELS[modelKey], { input, signal: ctrl.signal }),
      delai,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Efface un objet ecrit qu'on ne peut finalement pas facturer. Best-effort. */
async function effacerObjet(key: string): Promise<void> {
  try {
    await supabaseAdmin.storage.from(BUCKET_AFFICHE_IA).remove([key]);
  } catch {
    // On ne remonte rien : l'utilisateur a deja sa reponse d'erreur, et un
    // objet orphelin sera balaye par la retention. Pas de secret a logger.
    console.warn('[AI Image][generate-bg] effacement impossible', { key });
  }
}

/** URL publique absolue de l'objet, ou `null` si elle est inutilisable. */
function urlPubliqueAbsolue(key: string): string | null {
  const brute = supabaseAdmin.storage.from(BUCKET_AFFICHE_IA).getPublicUrl(key)?.data?.publicUrl;
  if (typeof brute !== 'string' || !brute) return null;
  let candidate = brute;
  if (candidate.startsWith('/')) {
    // Le shim renvoie un chemin RELATIF quand NEXT_PUBLIC_APP_URL manque :
    // inutilisable par le client, et surtout par le rendu serveur.
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
    if (!base) return null;
    candidate = `${base}${candidate}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Non autorisé' }, { status: 401 });
    }

    const { action, imageUrl, prompt, style, format } = await req.json();

    if (!action || !AI_CREDITS[action]) {
      return NextResponse.json({ success: false, error: 'Action invalide' }, { status: 400 });
    }

    // Affiche IA : validation AVANT la lecture du solde. Un prompt vide ou un
    // format hors liste est un 400 franc, sans aucun appel.
    let promptAfficheIA = '';
    let formatAfficheIA: FormatAfficheIA = '9:16';
    if (action === 'generate-bg') {
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return NextResponse.json({ success: false, error: 'prompt requis' }, { status: 400 });
      }
      promptAfficheIA = prompt.trim();
      if (promptAfficheIA.length > PROMPT_AFFICHE_IA_MAX) {
        return NextResponse.json({
          success: false,
          error: `prompt trop long (${PROMPT_AFFICHE_IA_MAX} caractères max)`,
        }, { status: 400 });
      }
      if (format !== undefined && format !== null) {
        if (typeof format !== 'string' || !(FORMATS_AFFICHE_IA as readonly string[]).includes(format)) {
          return NextResponse.json({
            success: false,
            error: `format invalide (attendu : ${FORMATS_AFFICHE_IA.join(', ')})`,
          }, { status: 400 });
        }
        formatAfficheIA = format as FormatAfficheIA;
      }
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
      // Vu en prod : « Service IA non configuré » sous le bouton Generer,
      // sans qu'aucun administrateur en soit averti — cette branche sort
      // AVANT le `catch` general qui alerte. Le message utilisateur dit ce
      // qu'il manque cote serveur ; l'alerte nomme la variable (jamais sa
      // valeur, il n'y en a pas). Aucun credit n'est touche.
      reportServiceAlert(
        'replicate',
        'critical',
        '🔑 Replicate — REPLICATE_API_TOKEN absent',
        'La variable REPLICATE_API_TOKEN n’est pas definie sur le serveur (Coolify → studiio-app → Environment Variables). L’Affiche IA et les retouches IA repondent 503 tant qu’elle manque.',
      );
      return NextResponse.json({
        success: false,
        error: 'Service IA non configuré sur le serveur (clé Replicate absente). Aucun crédit débité — contactez l’administrateur.',
        code: 'ia_non_configuree',
      }, { status: 503 });
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

      // ── 6. Generate Background / Affiche IA (Flux Schnell) ──
      // Repond ici et ne descend PAS dans l'extraction d'URL commune : la
      // sortie est rapatriee, verifiee et stockee chez nous (voir le bloc
      // « Affiche IA — chemin durable » plus haut).
      case 'generate-bg': {
        const userId = session.user.id;
        // Identifiant genere ICI, cote serveur : il nomme l'objet stocke et
        // la reference de debit. Deux POST = deux identifiants = deux debits.
        // L'idempotence de `deductCredits` ne joue qu'au sein de CET appel
        // (un rejeu interne avec la meme reference ne debite pas deux fois) ;
        // on ne pretend a aucune idempotence entre requetes.
        const generationId = randomUUID();
        let key: string | null = null;

        try {
          // « Partir de ma photo » : si une image de référence est fournie, on
          // passe par flux-kontext-pro (image + consigne → image), qui préserve
          // le sujet (visage, vêtements, identité). Sinon, texte → image comme
          // avant. MÊME suite : validation, rapatriement durable, débit.
          const reference = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null;
          const output = reference
            ? await genererAvecDelai(replicate, {
              input_image: reference,
              prompt: translateFrPromptToEn(promptAfficheIA),
              // La sortie prend le FORMAT de la vidéo (9:16…), pas celui de la
              // photo de référence — l'affiche doit tenir dans le montage.
              aspect_ratio: formatAfficheIA,
              output_format: 'webp',
              safety_tolerance: 2,
            }, 'image-edit')
            : await genererAvecDelai(replicate, {
              prompt: `${promptAfficheIA}, high quality, professional background, ${formatAfficheIA} aspect ratio`,
              num_outputs: 1,
              aspect_ratio: formatAfficheIA,
              output_format: 'webp',
              output_quality: 90,
            });

          // Octets cote serveur, bornes, puis signature : une page d'erreur,
          // un GIF ou du JSON n'entrent jamais dans le stockage.
          const octets = await lireOctetsSortie(output);
          const signature = detecterSignatureImage(octets);
          if (!signature) {
            throw new ErreurAfficheIA(502, 'Le modèle IA a répondu mais le résultat n\'est pas une image valide. Réessayez.', 'signature');
          }

          key = `${userId}/image/${generationId}-affiche-ia.${signature.ext}`;
          const { error: erreurUpload } = await supabaseAdmin.storage
            .from(BUCKET_AFFICHE_IA)
            .upload(key, Buffer.from(octets), { contentType: signature.mime, upsert: false });
          if (erreurUpload) {
            key = null; // rien n'a ete ecrit : rien a effacer
            console.warn('[AI Image][generate-bg] upload refuse', { generationId, message: String(erreurUpload.message ?? erreurUpload) });
            throw new ErreurAfficheIA(502, 'L\'image n\'a pas pu être enregistrée. Réessayez.', 'upload');
          }

          // Une URL inutilisable (relative sans NEXT_PUBLIC_APP_URL, ou
          // non-http) ne doit JAMAIS etre facturee : on efface et on refuse.
          const resultUrl = urlPubliqueAbsolue(key);
          if (!resultUrl) {
            await effacerObjet(key);
            key = null;
            console.warn('[AI Image][generate-bg] URL publique inutilisable', { generationId });
            throw new ErreurAfficheIA(500, 'Le stockage est mal configuré : l\'image n\'a pas pu être publiée. L\'administrateur a été notifié.', 'url-publique');
          }

          // Debit EN DERNIER, une fois l'objet ecrit et adressable. Un solde
          // insuffisant ICI est un cas LOCAL (course entre deux requetes) :
          // 402 franc, aucune alerte Replicate, et l'objet est efface.
          try {
            await deductCredits(userId, cost, `ai-${action}`, referenceOperation('ia:generate-bg', generationId));
          } catch (errDebit) {
            await effacerObjet(key);
            key = null;
            const msgDebit = errDebit instanceof Error ? errDebit.message : String(errDebit);
            if (msgDebit === 'Insufficient credits') {
              return NextResponse.json({
                success: false,
                error: `Crédits insuffisants (${cost} requis)`,
                creditsNeeded: cost,
              }, { status: 402 });
            }
            console.warn('[AI Image][generate-bg] debit refuse', { generationId, message: msgDebit.slice(0, 200) });
            return NextResponse.json({
              success: false,
              error: 'Le débit des crédits a échoué : l\'image n\'a pas été conservée. Réessayez.',
            }, { status: 500 });
          }

          // L'URL Replicate n'apparait nulle part : ni ici, ni dans les logs.
          return NextResponse.json({
            success: true,
            resultUrl,
            action,
            generationId,
            creditsUsed: cost,
            creditsRemaining: credits - cost,
            format: formatAfficheIA,
          });
        } catch (err) {
          if (err instanceof ErreurAfficheIA) {
            // Cas deja qualifie : on repond sans alerter le fournisseur. On ne
            // logge ni prompt, ni URL, ni octets — juste l'etape.
            console.warn('[AI Image][generate-bg] echec', { generationId, etape: err.etape, status: err.status });
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
          }
          // Erreur fournisseur (SDK) : assainie et mappee par le catch general.
          throw err;
        }
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
        // Debit APRES lecture reussie, comme sur le chemin image.
        //
        // ⚠️ Une image sans texte est debitee elle aussi : le modele a bien
        // tourne et nous a bien coute. Un chemin gratuit serait le seul de
        // cette route a appeler une API payante sans compteur — donc une
        // boucle sur une image blanche depenserait sans limite. Le drapeau
        // `empty` permet a l'UI de le dire clairement a l'utilisateur.
        await deductCredits(session.user.id, cost, `ai-${action}`);

        return NextResponse.json({
          success: true,
          text,
          empty: text.length === 0,
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
    // ⚠️ JAMAIS `console.error(error)` ici : une `ApiError` du SDK porte la
    // `Request` undici, dont l'inspection imprime `Authorization: Bearer
    // r8_…`. On ne logge — et on ne transmet aux alertes — que la forme
    // assainie : message caviarde et tronque, statut, code. Rien d'autre.
    const sanitised = erreurReplicateSanitisee(error);
    console.error('[AI Image] Error:', sanitised);
    const msg = sanitised.message;

    // Report to admin alert system — meme signature, message assaini.
    detectAndReportServiceError('replicate', new Error(sanitised.message));

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
