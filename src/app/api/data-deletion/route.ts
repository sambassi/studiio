import { NextRequest, NextResponse } from 'next/server';
import { lireSignedRequest, secretsMeta } from '@/lib/rgpd/meta-signed-request';
import {
  CODE_CONFIRMATION, creerDemandeMeta, executerDemande, statutPublic,
} from '@/lib/rgpd/suppression-donnees';
import { dependancesReelles } from '@/lib/rgpd/adaptateurs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/data-deletion — callback Meta « Data Deletion Request ».
 *
 * Meta envoie `signed_request` en `application/x-www-form-urlencoded`. La
 * signature HMAC-SHA256 (secret de l'application) est VÉRIFIÉE avant de
 * croire quoi que ce soit : une signature invalide est refusée (401), rien
 * n'est enregistré.
 *
 * Portée : les données obtenues via Facebook/Instagram du SEUL compte
 * rattaché à cet identifiant (lien enregistré à la connexion Facebook).
 * Jamais la suppression d'un compte Studiio entier : elle relève d'une
 * demande de l'utilisateur authentifié (`/api/user/suppression`).
 *
 * Réponse exigée par Meta : `{ url, confirmation_code }`. L'URL mène au GET
 * ci-dessous, qui rend l'état RÉEL de la demande.
 */
export async function POST(req: NextRequest) {
  let brut: unknown;
  try {
    const texte = await req.text();
    if (texte.trim().startsWith('{')) {
      brut = (JSON.parse(texte) as { signed_request?: unknown })?.signed_request;
    } else {
      brut = new URLSearchParams(texte).get('signed_request');
    }
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const lecture = lireSignedRequest(brut, secretsMeta());
  if (!lecture.ok) {
    if (lecture.raison === 'sans_secret') {
      console.error('[DATA-DELETION] secret de l’application Meta non configuré');
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
    const status = lecture.raison === 'signature_invalide' ? 401 : 400;
    console.warn('[DATA-DELETION] signed_request refusé', { raison: lecture.raison });
    return NextResponse.json({ error: 'invalid_signed_request' }, { status });
  }

  const deps = dependancesReelles();
  let code: string;
  try {
    code = (await creerDemandeMeta(lecture.appli, lecture.metaUserId, deps)).code;
  } catch (e) {
    console.error('[DATA-DELETION] demande non enregistrée :', e instanceof Error ? e.message : e);
    // Rien n'est enregistré : Meta doit pouvoir réessayer.
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  try {
    await executerDemande(code, deps);
  } catch (e) {
    // La demande EXISTE ; son statut dit où elle en est. Elle sera reprise.
    console.error('[DATA-DELETION] exécution interrompue :', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ url: urlStatut(code), confirmation_code: code });
}

/** GET /api/data-deletion?code=… — statut réel, sans aucune donnée personnelle. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') ?? '';
  const entetes = { 'Cache-Control': 'no-store' };
  if (!CODE_CONFIRMATION.test(code)) {
    return NextResponse.json({ statut: 'inconnue' }, { status: 404, headers: entetes });
  }
  try {
    const d = await dependancesReelles().registre.lire(code);
    if (!d) return NextResponse.json({ statut: 'inconnue' }, { status: 404, headers: entetes });
    return NextResponse.json(statutPublic(d), { headers: entetes });
  } catch (e) {
    console.error('[DATA-DELETION] statut illisible :', e instanceof Error ? e.message : e);
    return NextResponse.json({ statut: 'indisponible' }, { status: 503, headers: entetes });
  }
}

/** Base configurée, jamais l'en-tête `Host` fourni par l'appelant. */
function urlStatut(code: string): string {
  let base = 'https://studiio.pro';
  for (const c of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    if (!c) continue;
    try { base = new URL(c).origin; break; } catch { /* suivante */ }
  }
  return `${base}/api/data-deletion?code=${code}`;
}
