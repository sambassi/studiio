import { NextRequest, NextResponse } from 'next/server';
import { recordSuppression, verifyRecipient, normalizeEmail } from '@/lib/email/unsubscribe';
import { notifyAfroboostUnsubscribe } from '@/lib/social/subscribers';

/**
 * Desabonnement email.
 *
 *   POST /api/email/unsubscribe?e=<adresse>&t=<jeton>
 *     Desabonnement « un clic », declenche par Gmail via l'en-tete
 *     `List-Unsubscribe-Post`. Doit repondre 200.
 *
 *   GET  /api/email/unsubscribe?e=<adresse>&t=<jeton>
 *     Page de confirmation pour un humain qui clique le lien visible.
 *     AUCUN effet de bord : les antivirus et previsualiseurs de liens
 *     visitent les URL contenues dans les emails, et desabonneraient les gens
 *     a leur insu. Le bouton de la page envoie le POST.
 *
 * Route publique par necessite (Gmail poste sans session). L'authentification
 * repose entierement sur le HMAC de l'adresse : sans jeton valide, rien n'est
 * ecrit.
 */

// `crypto` (HMAC) et l'acces base : runtime Node, pas Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readParams(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = normalizeEmail(searchParams.get('e') || '');
  const token = searchParams.get('t') || '';
  return { email, token, valid: !!email && verifyRecipient(email, token) };
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(title)}</title></head>
<body style="margin:0;background:#0A0A0F;color:#E5E7EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:64px auto;padding:32px;background:#14141B;border-radius:16px;">
${body}
</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function POST(req: NextRequest) {
  const { email, valid } = readParams(req);

  if (!valid) {
    // Jeton absent ou faux : refus. Sans cela, n'importe qui desabonnerait
    // n'importe quelle adresse en devinant l'URL.
    return new NextResponse('Lien de desabonnement invalide.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const stored = await recordSuppression(email, 'one-click');
  // Relai afroboost : best-effort, jamais bloquant (cf. notifyAfroboostUnsubscribe).
  await notifyAfroboostUnsubscribe(email, 'email');

  if (!stored) {
    // La suppression locale n'a pas pu etre ecrite (migration pas encore
    // appliquee, base injoignable). On le journalise, mais on repond 200 :
    // un 5xx ferait reessayer Gmail en boucle et degraderait la reputation
    // du domaine, sans rien resoudre.
    console.error(`[Unsubscribe] ${email} : desabonnement NON persiste localement.`);
  }

  return new NextResponse('Desabonnement enregistre.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const { email, token, valid } = readParams(req);

  if (!valid) {
    return page(
      'Lien invalide',
      `<h1 style="margin:0 0 12px;font-size:20px;color:#fff;">Lien invalide</h1>
       <p style="margin:0;color:#9CA3AF;font-size:14px;line-height:1.6;">
         Ce lien de desabonnement est incomplet ou a expire. Repondez simplement
         a l'email recu avec le mot « STOP » et nous vous retirons de la liste.
       </p>`,
      400,
    );
  }

  const action = `/api/email/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
  return page(
    'Se desabonner',
    `<h1 style="margin:0 0 12px;font-size:20px;color:#fff;">Se desabonner</h1>
     <p style="margin:0 0 24px;color:#9CA3AF;font-size:14px;line-height:1.6;">
       Confirmez pour ne plus recevoir nos publications a l'adresse
       <strong style="color:#E5E7EB;">${esc(email)}</strong>.
     </p>
     <form method="post" action="${esc(action)}">
       <button type="submit" style="background:#7C3AED;color:#fff;border:0;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">
         Confirmer le desabonnement
       </button>
     </form>`,
  );
}
