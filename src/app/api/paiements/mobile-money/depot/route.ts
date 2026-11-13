import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/lib/auth/config';
import { lireTarifs } from '@/lib/tarifs/serveur';
import { offrePack, offrePlan } from '@/lib/stripe/prix';
import { CREDIT_PACKAGES, STRIPE_PLANS } from '@/lib/stripe/constants';
import { annonceConversion, convertirChfVersCfa, estDeviseCfa } from '@/lib/paiements/cfa';
import { etatMobileMoney } from '@/lib/paiements/mobile-money';
import {
  creerDepot, depotsOuvertsDuCompte, MAX_DEPOTS_OUVERTS,
  SocleAbsent, MESSAGE_SOCLE_ABSENT,
} from '@/lib/paiements/pawapay/depots';
import {
  creerPagePaiement, enProduction, fournisseurSimule,
  ErreurPrestataire, MESSAGE_PRESTATAIRE_INJOIGNABLE,
} from '@/lib/paiements/pawapay/client';

/**
 * OUVRIR UN PAIEMENT MOBILE MONEY — `POST /api/paiements/mobile-money/depot`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE NAVIGATEUR N'A PAS LE DROIT DE DIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni le montant, ni la devise de facturation, ni le nombre de crédits. Il
 * n'envoie que la CLÉ de l'offre, le pays et sa devise. Le prix vient de la
 * base, la conversion est faite ici, les crédits viennent de l'offre. Un
 * client qui fixerait son prix n'est pas un client.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ORDRE DES OPÉRATIONS, QUI N'EST PAS NÉGOCIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. prix lu en base ;
 *   2. conversion serveur, avec un taux daté — refus s'il manque ;
 *   3. DÉPÔT ÉCRIT dans notre journal, avant tout appel réseau ;
 *   4. seulement ensuite, création de la page de paiement.
 *
 * Si l'étape 4 échoue ou se perd, l'étape 3 a laissé une trace : la
 * réconciliation retrouvera le paiement s'il a malgré tout abouti.
 */
export const dynamic = 'force-dynamic';

const PLANS_PAYANTS = ['starter', 'pro', 'enterprise'] as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const etat = etatMobileMoney();
  if (!etat.actif) {
    return NextResponse.json({ success: false, code: etat.motif, error: etat.message }, { status: 503 });
  }

  const corps = (await req.json().catch(() => null)) as {
    offre?: unknown; cle?: unknown; devise?: unknown; pays?: unknown; telephone?: unknown;
  } | null;

  const offre = corps?.offre === 'plan' ? 'plan' : 'pack';
  const cle = typeof corps?.cle === 'string' ? corps.cle : '';
  const pays = typeof corps?.pays === 'string' ? corps.pays.trim().toUpperCase() : '';
  const telephone = typeof corps?.telephone === 'string' && corps.telephone.trim()
    ? corps.telephone.trim() : null;

  if (!estDeviseCfa(corps?.devise)) {
    return NextResponse.json({ success: false, error: 'Devise non prise en charge.' }, { status: 400 });
  }
  if (!/^[A-Z]{3}$/.test(pays)) {
    return NextResponse.json({ success: false, error: 'Pays invalide.' }, { status: 400 });
  }

  const connue = offre === 'plan'
    ? (PLANS_PAYANTS as readonly string[]).includes(cle)
    : Object.prototype.hasOwnProperty.call(CREDIT_PACKAGES, cle);
  if (!connue) {
    return NextResponse.json({ success: false, error: 'Offre inconnue.' }, { status: 400 });
  }

  // 1. Le prix et les crédits viennent de la BASE, jamais de la requête.
  const [config, montantEtCredits] = await Promise.all([
    lireTarifs(),
    offre === 'plan'
      ? offrePlan(cle as (typeof PLANS_PAYANTS)[number]).then((o) => ({ cents: o.price_cents, credits: o.credits }))
      : offrePack(cle as keyof typeof CREDIT_PACKAGES).then((o) => ({ cents: o.price_cents, credits: o.amount })),
  ]);
  if (!(montantEtCredits.cents > 0) || !(montantEtCredits.credits > 0)) {
    console.error('[mobile money] offre invalide en base', { offre, cle });
    return NextResponse.json({ success: false, error: 'Offre indisponible : tarif à vérifier.' }, { status: 503 });
  }

  // 2. Conversion SERVEUR, avec un taux daté. Sans lui, on refuse.
  const conversion = convertirChfVersCfa({
    chfCentimes: montantEtCredits.cents,
    devise: corps!.devise,
    tauxEurParChf: config.changeEur?.eurParChf ?? null,
    tauxLe: config.changeEur?.le ?? null,
  });
  if (!conversion.ok) {
    return NextResponse.json(
      { success: false, code: conversion.motif, error: conversion.message },
      { status: 409 },
    );
  }
  const c = conversion.conversion;

  // 3. BORNER LES PAIEMENTS OUVERTS. La file de réconciliation est partagée
  //    par tous les comptes : un seul compte qui ouvrirait des paiements sans
  //    jamais les honorer la remplirait, et les crédits des autres
  //    arriveraient en retard, voire plus du tout.
  try {
    const ouverts = await depotsOuvertsDuCompte(session.user.id);
    if (ouverts >= MAX_DEPOTS_OUVERTS) {
      return NextResponse.json({
        success: false,
        code: 'trop_de_paiements_ouverts',
        error: 'Tu as déjà plusieurs paiements en cours. Termine-les ou attends quelques minutes avant d’en ouvrir un autre.',
      }, { status: 429 });
    }
  } catch (e) {
    if (e instanceof SocleAbsent) {
      return NextResponse.json(
        { success: false, code: 'socle_absent', error: MESSAGE_SOCLE_ABSENT },
        { status: 503 },
      );
    }
    throw e;
  }

  // 4. LE DÉPÔT D'ABORD. Un identifiant que NOUS générons : il nous permet de
  //    reconnaître nos propres paiements parmi ceux du compte marchand.
  const depositId = randomUUID();
  const nomOffre = offre === 'plan'
    ? (STRIPE_PLANS as Record<string, { name?: string }>)[cle]?.name ?? cle
    : (CREDIT_PACKAGES as Record<string, { name?: string }>)[cle]?.name ?? cle;

  try {
    await creerDepot({
      deposit_id: depositId,
      user_id: session.user.id,
      offre_type: offre,
      offre_cle: cle,
      credits: montantEtCredits.credits,
      montant_local: c.montant,
      devise: c.devise,
      pays,
      prix_chf_cents: montantEtCredits.cents,
      taux_eur_par_chf: c.tauxEurParChf,
      taux_le: c.tauxLe,
      sandbox: !enProduction(),
    });
  } catch (e) {
    if (e instanceof SocleAbsent) {
      console.error('[mobile money] migration non appliquée — aucun dépôt créé');
      return NextResponse.json({ success: false, code: 'socle_absent', error: MESSAGE_SOCLE_ABSENT }, { status: 503 });
    }
    console.error('[mobile money] dépôt non enregistré :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: MESSAGE_PRESTATAIRE_INJOIGNABLE }, { status: 503 });
  }

  const annonce = annonceConversion(c, montantEtCredits.credits);
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const retourUrl = `${base}/paiement/mobile-money/retour?depot=${depositId}`;

  // 4. En SIMULATION, aucun appel ne part : la page locale tient lieu de page
  //    hébergée, et c'est elle qui permet d'éprouver chaque issue.
  if (fournisseurSimule()) {
    return NextResponse.json({
      success: true, depositId, simule: true,
      urlRedirection: `${base}/paiement/mobile-money/simulation?depot=${depositId}`,
      montant: c.montant, devise: c.devise, credits: montantEtCredits.credits, annonce,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  try {
    const page = await creerPagePaiement({
      depositId,
      pays,
      devise: c.devise,
      montant: c.montant,
      motif: `Studiio — ${nomOffre}`,
      retourUrl,
      telephone,
    });
    if (!page.ok || !page.urlRedirection) {
      console.error('[mobile money] page de paiement refusée', { depositId, refus: page.refus, motif: page.motifEchec });
      return NextResponse.json({ success: false, error: MESSAGE_PRESTATAIRE_INJOIGNABLE }, { status: 502 });
    }
    return NextResponse.json({
      success: true, depositId, simule: false,
      urlRedirection: page.urlRedirection,
      montant: c.montant, devise: c.devise, credits: montantEtCredits.credits, annonce,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    const detail = e instanceof ErreurPrestataire ? e.etape : (e instanceof Error ? e.message : String(e));
    console.error('[mobile money] création impossible', { depositId, detail });
    return NextResponse.json({ success: false, error: MESSAGE_PRESTATAIRE_INJOIGNABLE }, { status: 502 });
  }
}
