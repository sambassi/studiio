import { NextRequest, NextResponse } from 'next/server';
import {
  verifyState, exchangeCode, fetchAccountEmail, saveDriveAccount, appUrl,
} from '@/lib/drive/oauth';

/**
 * GET /api/drive/callback — retour de consentement Google.
 *
 * ⚠️ Cette route REDIRIGE ; elle n'emet aucun HTML.
 *
 * Le callback social historique construit une page en interpolant le message
 * d'erreur dans du JavaScript inline — donc dans une chaine que le
 * fournisseur controle en partie. Rediriger vers une URL avec un code de
 * resultat supprime purement et simplement cette surface : il n'y a plus de
 * gabarit ou injecter quoi que ce soit.
 *
 * Le `userId` vient du `state` SIGNE, jamais d'un parametre en clair : sans
 * signature, appeler cette route avec l'identifiant d'un tiers rattacherait le
 * Drive de l'appelant au compte de la victime.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Codes de retour lus par l'ecran — jamais du texte libre. */
type Resultat =
  | 'ok'
  | 'refus'
  | 'etat-invalide'
  | 'etat-expire'
  | 'echange'
  | 'stockage'
  | 'inconnu';

function retour(resultat: Resultat): NextResponse {
  const url = new URL('/dashboard/creer', appUrl());
  url.searchParams.set('drive', resultat);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  try {
    // L'utilisateur a refuse, ou Google a rejete la demande.
    if (params.get('error')) {
      console.warn('[Drive/Callback] refus :', params.get('error'));
      return retour('refus');
    }

    const code = params.get('code');
    if (!code) return retour('etat-invalide');

    const etat = verifyState(params.get('state'));
    if (!etat.ok) {
      console.warn('[Drive/Callback] state rejeté :', etat.reason);
      return retour(etat.reason === 'perime' ? 'etat-expire' : 'etat-invalide');
    }

    let tokens;
    try {
      tokens = await exchangeCode(code);
    } catch (err) {
      console.error('[Drive/Callback] échange :', err instanceof Error ? err.message : err);
      return retour('echange');
    }

    // Non bloquant : sans l'adresse, la connexion marche, l'ecran affiche
    // simplement « compte Google » au lieu du courriel.
    const email = await fetchAccountEmail(tokens.accessToken);

    const range = await saveDriveAccount(etat.userId, tokens, email);
    if (!range) return retour('stockage');

    return retour('ok');
  } catch (err) {
    console.error('[Drive/Callback]', err instanceof Error ? err.message : err);
    return retour('inconnu');
  }
}
