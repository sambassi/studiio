import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/lib/auth/config';
import { offrePack, offrePlan } from '@/lib/stripe/prix';
import { CREDIT_PACKAGES, STRIPE_PLANS } from '@/lib/stripe/constants';
import { PLANS_PAYANTS } from '@/lib/billing/plan-choisi';
import {
  issueCredite, ISSUES_DEMO, LIBELLE_ISSUE_DEMO,
  MESSAGE_SIMULATION_FERMEE, paiementSimuleOuvert, PREFIXE_DEMO,
  type IssueDemo,
} from '@/lib/paiements/demonstration';
import { crediterPaiementSimule } from '@/lib/paiements/demonstration-credit';

/**
 * `POST /api/demonstration/paiement` — parcourir un achat jusqu'au bout,
 * sans prestataire et sans argent.
 *
 * ⚠️ CE N'EST PAS UN PAIEMENT PAR CARTE, et ce n'est pas Stripe. Aucun
 * identifiant Stripe n'est fabriqué, aucune carte n'est évoquée. La route
 * n'existe pas en production : `paiementSimuleOuvert` exige
 * `NODE_ENV !== 'production'`.
 *
 * L'appelant choisit l'ISSUE — confirmé, refusé, annulé, en attente. C'est
 * le point : seule l'issue confirmée crédite, et les trois autres doivent
 * pouvoir être observées. Le prix et les crédits viennent de la base, jamais
 * de la requête.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!paiementSimuleOuvert()) {
    return NextResponse.json(
      { success: false, code: 'simulation_fermee', error: MESSAGE_SIMULATION_FERMEE },
      { status: 404 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const corps = (await req.json().catch(() => null)) as {
    offre?: unknown; cle?: unknown; cycle?: unknown; issue?: unknown;
  } | null;

  const offre = corps?.offre === 'plan' ? 'plan' : 'pack';
  const cle = typeof corps?.cle === 'string' ? corps.cle : '';
  const annuel = corps?.cycle === 'yearly';
  const issue = (ISSUES_DEMO as readonly string[]).includes(String(corps?.issue))
    ? (corps!.issue as IssueDemo)
    : 'reussi';

  const connue = offre === 'plan'
    ? (PLANS_PAYANTS as readonly string[]).includes(cle)
    : Object.prototype.hasOwnProperty.call(CREDIT_PACKAGES, cle);
  if (!connue) {
    return NextResponse.json({ success: false, error: 'Offre inconnue' }, { status: 400 });
  }

  // Prix et crédits : la BASE fait foi, comme pour un vrai achat. Une
  // démonstration qui inventerait ses montants ne démontrerait pas le
  // parcours réel.
  let credits = 0;
  let cents = 0;
  try {
    if (offre === 'plan') {
      const o = await offrePlan(cle as (typeof PLANS_PAYANTS)[number]);
      credits = o.credits;
      cents = annuel ? o.yearly_price_cents : o.price_cents;
    } else {
      const o = await offrePack(cle as keyof typeof CREDIT_PACKAGES);
      credits = o.amount;
      cents = o.price_cents;
    }
  } catch {
    return NextResponse.json({ success: false, error: 'Offre illisible' }, { status: 503 });
  }
  if (!(credits > 0) || !(cents > 0)) {
    return NextResponse.json({ success: false, error: 'Offre incomplète' }, { status: 503 });
  }

  const nom = offre === 'plan'
    ? (STRIPE_PLANS as Record<string, { name?: string }>)[cle]?.name ?? cle
    : (CREDIT_PACKAGES as Record<string, { name?: string }>)[cle]?.name ?? cle;

  // Issue autre que confirmée : RIEN n'est écrit. Pas de ligne, pas de
  // crédit — le refus doit être un vrai non-événement.
  if (!issueCredite(issue)) {
    return NextResponse.json({
      success: true,
      simule: true,
      issue,
      libelle: LIBELLE_ISSUE_DEMO[issue],
      credits: 0,
      creditsAttendus: credits,
      prixCents: cents,
      offre: nom,
    });
  }

  try {
    const r = await crediterPaiementSimule(
      session.user.id,
      credits,
      `${PREFIXE_DEMO}${randomUUID()}`,
      `Paiement simulé — ${nom}`,
    );
    return NextResponse.json({
      success: true,
      simule: true,
      issue,
      libelle: LIBELLE_ISSUE_DEMO[issue],
      credits,
      solde: r.solde,
      dejaCredite: r.dejaCredite,
      prixCents: cents,
      offre: nom,
    });
  } catch (e) {
    console.error('[demonstration] crédit impossible :', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, error: 'Le paiement simulé n’a pas pu être enregistré.' },
      { status: 503 },
    );
  }
}
