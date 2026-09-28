/**
 * POST /api/pawapay/deposit — initie un achat de crédits en Mobile Money.
 *
 * Corps : `{ pack, pays, devise?, telephone? }`.
 *
 * Tout ce qui compte est décidé CÔTÉ SERVEUR : crédits et prix viennent du
 * pack (`PACKS_PAWAPAY`), la devise du pays réellement ouvert sur le compte
 * (`/v2/active-conf`), le montant local des taux fournis par le serveur.
 *
 * Ordre imposé : le `depositId` (UUID) est généré ici, la ligne `en_attente`
 * est enregistrée, et SEULEMENT ENSUITE PawaPay est appelé. Si le réseau
 * lâche après l'envoi, la ligne permet au rattrapage de retrouver le dépôt.
 *
 * Le compte PawaPay est partagé avec d'autres sites : la page de paiement
 * porte la métadonnée `app: "studiio"`, et la confirmation ne dépend d'aucun
 * callback — elle se fait par interrogation (`/api/pawapay/status/[id]`) et
 * par le rattrapage (`/api/cron/pawapay-reconcile`).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { creerPagePaiement, genererDepositId } from '@/lib/payment/pawapay/client';
import { calculerDevis, urlDeBaseConfiguree } from '@/lib/payment/pawapay/devis';
import { obtenirDependances, pawapayActif } from '@/lib/payment/pawapay/store';
import { PawapayErreur } from '@/lib/payment/pawapay/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!pawapayActif()) {
    return NextResponse.json({ error: 'Paiement Mobile Money indisponible' }, { status: 503 });
  }
  const deps = obtenirDependances();
  if (!deps) {
    return NextResponse.json({ error: 'Paiement Mobile Money indisponible' }, { status: 503 });
  }
  const base = urlDeBaseConfiguree();
  if (!base) {
    console.error('[PAWAPAY_DEPOT] NEXTAUTH_URL / NEXT_PUBLIC_APP_URL absents : URL de retour impossible');
    return NextResponse.json({ error: 'Paiement Mobile Money indisponible' }, { status: 503 });
  }

  let corps: Record<string, unknown>;
  try {
    const brut = await req.json();
    corps = typeof brut === 'object' && brut !== null ? brut as Record<string, unknown> : {};
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { telephone } = corps;
  // Même calcul que `/api/pawapay/quote` : le prix affiché est le prix encaissé.
  const resultat = await calculerDevis({ pack: corps.pack, pays: corps.pays, devise: corps.devise });
  if (!resultat.ok) {
    return NextResponse.json(
      { error: resultat.erreur, ...(resultat.devises ? { devises: resultat.devises } : {}) },
      { status: resultat.status },
    );
  }
  const { pack, pays, devise, montant, credits } = resultat.devis;
  const depositId = genererDepositId();

  // 1) La trace d'abord.
  try {
    await deps.store.enregistrer({
      depositId,
      userId,
      pack,
      credits,
      montant,
      devise,
      pays,
      statut: 'en_attente',
      creeLe: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[PAWAPAY_DEPOT] Enregistrement impossible (${depositId}) :`, e);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }

  // 2) PawaPay ensuite.
  try {
    const { redirectUrl } = await creerPagePaiement({
      depositId,
      montant,
      devise,
      pays,
      motif: `Studiio - ${credits} credits`,
      urlRetour: `${base}/dashboard/billing?pawapay=${depositId}`,
      telephone: typeof telephone === 'string' ? telephone : undefined,
      metadata: [{ app: 'studiio' }, { pack }],
    });
    return NextResponse.json({ depositId, redirectUrl, montant, devise, credits });
  } catch (e) {
    // Un refus EXPLICITE de PawaPay (failureCode) prouve qu'aucun paiement
    // n'existera : la ligne passe en échec. Sinon (réseau, réponse
    // illisible), le dépôt existe peut-être : il reste `en_attente` et le
    // rattrapage tranchera par relecture.
    if (e instanceof PawapayErreur && e.failureCode) {
      try { await deps.store.marquerEchec(depositId); } catch { /* le rattrapage tranchera */ }
    }
    console.error(`[PAWAPAY_DEPOT] Payment Page refusée (${depositId}) :`, (e as Error)?.message);
    return NextResponse.json({ error: 'Paiement Mobile Money indisponible', depositId }, { status: 502 });
  }
}
