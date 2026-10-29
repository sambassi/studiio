/**
 * CINEMA IA — AIDE A LA REDACTION : une proposition de texte, rien d'autre.
 *
 * Cette route ne cree rien, ne modifie aucun film et ne genere aucune image ni video : elle
 * rend un TEXTE que l'ecran montre en apercu, que l'utilisateur accepte ou rejette.
 *
 * Elle passe par le moteur de texte PARTAGE de Studiio (`lib/ia/texte.ts`, celui de
 * « Creer ») : meme fournisseur, meme cle serveur, memes modeles, meme repli. Aucun nouveau
 * fournisseur, aucun credit debite, aucun plafond Cinema touche — ces plafonds bornent la
 * generation d'IMAGES et de VIDEOS, qui ne passe pas par ici.
 *
 * ⚠️ `/api/cinema/*` n'est pas couvert par le `matcher` du middleware : la session est
 * verifiee ICI (`sessionCinema`, qui ferme aussi la route quand le module est eteint).
 */
import { NextRequest, NextResponse } from 'next/server';
import { sessionCinema } from '@/lib/cinema/routes-aide';
import { diagnostiquerProposition, estActionRedaction, promptRedaction, type ContexteRedaction } from '@/lib/cinema/redaction';
import { genererTexteIA } from '@/lib/ia/texte';
import { detectAndReportServiceError } from '@/lib/service-alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Un recit de quelques phrases : plus large que les champs courts de « Creer », et borne. */
const MAX_TOKENS = 1_200;

export async function POST(req: NextRequest) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;

  const corps = await req.json().catch(() => null);
  const action = corps?.action;
  if (!estActionRedaction(action)) {
    return NextResponse.json({ ok: false, erreur: 'action de redaction inconnue' }, { status: 400 });
  }
  const contexte: ContexteRedaction = {
    histoire: typeof corps?.histoire === 'string' ? corps.histoire : '',
    personnages: Array.isArray(corps?.personnages) ? corps.personnages : [],
    styleCinema: typeof corps?.styleCinema === 'string' ? corps.styleCinema : null,
    nbScenes: corps?.nbScenes,
    format: typeof corps?.format === 'string' ? corps.format : undefined,
    titre: typeof corps?.titre === 'string' ? corps.titre : '',
  };

  const cleApi = process.env.ANTHROPIC_API_KEY;
  if (!cleApi) {
    // Dit, pas masque : sans cle, l'aide locale (une phrase par ligne, replique) reste utilisable.
    return NextResponse.json({ ok: false, indisponible: true, erreur: 'L’aide IA n’est pas configuree sur ce serveur.' }, { status: 503 });
  }

  const issue = await genererTexteIA({
    cleApi,
    prompt: promptRedaction(action, contexte),
    maxTokens: MAX_TOKENS,
    // Un recit depasse de loin 200 caracteres : sans cela, une reponse en texte brut
    // (sans JSON) serait jetee alors qu'elle est parfaitement utilisable.
    longueurMaxBrute: 6_000,
  });

  if (issue.ok) {
    return NextResponse.json({
      ok: true,
      action,
      texte: issue.texte,
      // Ce que le decoupage du serveur ferait de cette proposition : l'ecran l'affiche AVANT
      // toute acceptation (nombre de plans, repliques, prenoms hors casting).
      diagnostic: diagnostiquerProposition(issue.texte, contexte),
    });
  }

  if (issue.motif === 'indisponible') {
    return NextResponse.json({
      ok: false, indisponible: true,
      erreur: 'Le service IA est momentanement indisponible. Votre texte n’a pas ete modifie.',
    }, { status: 503 });
  }
  if (issue.motif === 'appel') detectAndReportServiceError('anthropic', new Error(issue.detail));
  return NextResponse.json({
    ok: false,
    erreur: `L’aide IA n’a pas pu repondre (${issue.detail}). Votre texte n’a pas ete modifie.`,
  }, { status: 502 });
}
