/**
 * POST /api/voice/prononciations/suggestion — « Suggérer » pour les cas que
 * la règle locale ne sait pas trancher (un nom propre, un sigle inconnu).
 *
 * Le navigateur envoie `{ affiche }` (le texte tel qu'il apparaît dans les
 * vidéos). Le serveur :
 *   1. exige une session (401 sinon) ;
 *   2. calcule la suggestion LOCALE (`suggererPrononciationLocale`) ; si elle
 *      est sûre, la rend telle quelle — aucun appel externe ;
 *   3. sinon, et seulement si Studiio a déjà sa clé Anthropic
 *      (`ANTHROPIC_API_KEY`, la même que l'assistant et la suggestion
 *      d'icônes), demande une forme dite au modèle déjà utilisé ailleurs,
 *      avec un limiteur par compte (429 + Retry-After) ;
 *   4. toute absence de clé, panne, réponse vide ou inutilisable → la
 *      suggestion locale, dite comme telle (`source: 'locale'`).
 *
 * RIEN n'est enregistré ici, aucun crédit n'est touché : c'est une
 * proposition que la personne modifie, écoute, puis enregistre elle-même.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { creerLimiteurMemoire } from '@/lib/securite/limiteur-memoire';
import { MAX_LONGUEUR_PRONONCIATION } from '@/lib/voice/prononciations';
import { suggererPrononciationLocale, nettoyerSuggestion } from '@/lib/voice/suggestion-prononciation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/** Le point d'accès, la version et le modèle, tels que l'assistant les utilise déjà. */
const POINT_ACCES = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2023-06-01';
const MODELE = 'claude-sonnet-4-20250514';
const JETONS_SORTIE_MAX = 60;
const DELAI_MS = 10_000;

const LIMITE_SUGGESTION_MINUTE = 10;
const LIMITE_SUGGESTION_HEURE = 60;
const limiteurSuggestion = creerLimiteurMemoire({
  fenetres: [
    { dureeMs: 60_000, max: LIMITE_SUGGESTION_MINUTE },
    { dureeMs: 3_600_000, max: LIMITE_SUGGESTION_HEURE },
  ],
});

const CONSIGNE = [
  'Tu aides une personne à régler la prononciation d’une voix de synthèse française.',
  'On te donne un mot ou une courte expression tel qu’il est écrit à l’écran.',
  'Réponds UNIQUEMENT par la façon de l’écrire pour qu’une voix française le dise correctement',
  '(orthographe phonétique simple, nombres en lettres, sigles épelés ou dits comme un mot selon l’usage).',
  'Une seule ligne, sans guillemets, sans explication, 80 caractères au plus.',
].join(' ');

const reponse = (suggestion: string, source: 'locale' | 'ia') =>
  NextResponse.json({ success: true, data: { suggestion, source } });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let affiche: unknown = null;
  try { affiche = ((await req.json()) as { affiche?: unknown } | null)?.affiche ?? null; } catch { affiche = null; }
  const texte = typeof affiche === 'string' ? affiche.replace(/\s+/g, ' ').trim() : '';
  if (!texte) return NextResponse.json({ success: false, error: 'Indiquez d’abord le texte d’origine.', code: 'affiche_manquante' }, { status: 400 });
  if (texte.length > MAX_LONGUEUR_PRONONCIATION) {
    return NextResponse.json({ success: false, error: `Le texte d’origine est limité à ${MAX_LONGUEUR_PRONONCIATION} caractères.`, code: 'trop_long' }, { status: 400 });
  }

  const locale = suggererPrononciationLocale(texte);
  if (!locale.incertain) return reponse(locale.suggestion, 'locale');

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return reponse(locale.suggestion, 'locale');

  const passage = limiteurSuggestion.consommer(session.user.id);
  if (!passage.ok) {
    return NextResponse.json(
      { success: false, error: 'Trop de suggestions, réessayez dans un instant.', code: 'trop_de_suggestions' },
      { status: 429, headers: { 'Retry-After': String(passage.reessayerDansS) } },
    );
  }

  try {
    const r = await fetch(POINT_ACCES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cle, 'anthropic-version': VERSION_API },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: JETONS_SORTIE_MAX,
        system: CONSIGNE,
        messages: [{ role: 'user', content: `Texte à l’écran : ${texte}\nProposition automatique : ${locale.suggestion}` }],
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) {
      console.error(`[Voice][suggestion] Anthropic ${r.status}`);
      return reponse(locale.suggestion, 'locale');
    }
    const d = (await r.json()) as { content?: Array<{ type?: string; text?: string }> };
    const brut = d.content?.find((c) => c.type === 'text')?.text;
    const ia = nettoyerSuggestion(brut, texte);
    return ia ? reponse(ia, 'ia') : reponse(locale.suggestion, 'locale');
  } catch {
    console.error('[Voice][suggestion] Anthropic injoignable');
    return reponse(locale.suggestion, 'locale');
  }
}
