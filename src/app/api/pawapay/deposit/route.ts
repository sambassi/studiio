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
import { creerPagePaiement, genererDepositId, paysActifs } from '@/lib/payment/pawapay/client';
import { obtenirDependances, obtenirTauxChf } from '@/lib/payment/pawapay/store';
import { DeviseSansTauxErreur, PACKS_PAWAPAY, estPackId, prixLocal } from '@/lib/payment/pawapay/tarifs';
import { PawapayErreur } from '@/lib/payment/pawapay/types';

export const dynamic = 'force-dynamic';

const PAYS_RX = /^[A-Z]{3}$/;

function urlDeBase(req: Request): string {
  const configuree = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  return (configuree || new URL(req.url).origin).replace(/\/+$/, '');
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deps = obtenirDependances();
  if (!deps) {
    return NextResponse.json({ error: 'Paiement Mobile Money indisponible' }, { status: 503 });
  }

  let corps: Record<string, unknown>;
  try {
    const brut = await req.json();
    corps = typeof brut === 'object' && brut !== null ? brut as Record<string, unknown> : {};
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { pack, pays, devise: deviseDemandee, telephone } = corps;
  if (!estPackId(pack)) return NextResponse.json({ error: 'Pack invalide' }, { status: 400 });
  if (typeof pays !== 'string' || !PAYS_RX.test(pays)) {
    return NextResponse.json({ error: 'Pays invalide' }, { status: 400 });
  }

  const taux = await obtenirTauxChf();
  if (!taux) return NextResponse.json({ error: 'Taux de change indisponibles' }, { status: 503 });

  let devise: string;
  let montant: string;
  try {
    const actif = (await paysActifs()).find((p) => p.pays === pays);
    if (!actif) return NextResponse.json({ error: 'Pays non disponible' }, { status: 400 });
    if (typeof deviseDemandee === 'string' && deviseDemandee) {
      if (!actif.devises.includes(deviseDemandee)) {
        return NextResponse.json({ error: 'Devise non disponible pour ce pays' }, { status: 400 });
      }
      devise = deviseDemandee;
    } else if (actif.devises.length === 1) {
      devise = actif.devises[0];
    } else {
      return NextResponse.json({ error: 'Devise à préciser', devises: actif.devises }, { status: 400 });
    }
    montant = prixLocal(pack, devise, taux);
  } catch (e) {
    if (e instanceof DeviseSansTauxErreur) {
      return NextResponse.json({ error: 'Devise non disponible' }, { status: 400 });
    }
    console.error('[PAWAPAY_DEPOT] Configuration du compte illisible :', (e as Error)?.message);
    return NextResponse.json({ error: 'Service Mobile Money injoignable' }, { status: 502 });
  }

  const { credits } = PACKS_PAWAPAY[pack];
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
      urlRetour: `${urlDeBase(req)}/dashboard/billing?pawapay=${depositId}`,
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
