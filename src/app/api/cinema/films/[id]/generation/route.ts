/**
 * CINEMA IA — generer le media d'un plan par IA.
 *
 * ⚠️ LE FOURNISSEUR EST CHOISI PAR LE SERVEUR (`fournisseurServeur`), jamais par le corps
 * de la requete : une generation REELLE depense de l'argent. Par defaut, rien n'est
 * disponible et la route repond 409. Un fournisseur declare mais eteint est de toute facon
 * refuse par `genererMediaPlan` avant toute construction de prompt.
 *
 * ⚠️ LE PLAFOND EST CELUI DU SERVEUR. Le corps de la requete peut tout au plus
 * le RABAISSER (`plafondUsd`) : jamais le relever. Un navigateur qui pourrait
 * fixer son propre plafond n'aurait pas de plafond.
 */
import { NextRequest, NextResponse } from 'next/server';
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm } from '@/lib/cinema/couts';
import { fichierDuMedia, remplacerMedia } from '@/lib/cinema/medias';
import { contexteCinema } from '@/lib/cinema/contexte';
import { avecDossierTemporaire, filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { cleMedia } from '@/lib/cinema/stockage/cles';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { typeContenuDepuisCle } from '@/lib/storage/acces-objet';
import { idPlanValide } from '@/lib/cinema/acces';
import { fournisseurServeur } from '@/lib/cinema/garde';
import { reserverCredits, type Reservation } from '@/lib/cinema/generation/credits';

// Imports pour leur SEULE presence : ils enregistrent les fournisseurs dans le registre.
// Enregistres ne veut pas dire actifs : chacun lit son interrupteur a chaque usage.
import '@/lib/cinema/generation/simule';
import '@/lib/cinema/generation/replicate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const OPERATIONS_VALIDES = new Set(['image', 'video']);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return filmInconnu();
  const film = lu.film;

  const corps = await req.json().catch(() => null);
  const planId = typeof corps?.planId === 'string' ? corps.planId : null;
  const operation = typeof corps?.operation === 'string' ? corps.operation : null;
  // ⚠️ LE FOURNISSEUR EST CELUI DU SERVEUR. Le corps de la requete ne le choisit PAS :
  // une generation reelle depense de l'argent, et aucun navigateur ne doit pouvoir la
  // declencher en nommant un fournisseur. Un `fournisseurId` recu est simplement ignore.

  if (!planId || !idPlanValide(planId)) return NextResponse.json({ ok: false, erreur: 'planId requis' }, { status: 400 });
  if (!operation || !OPERATIONS_VALIDES.has(operation)) {
    return NextResponse.json({ ok: false, erreur: 'operation invalide (image ou video attendu)' }, { status: 400 });
  }

  const choix = fournisseurServeur(operation as 'image' | 'video', s.userId);
  if (!choix) {
    return NextResponse.json(
      { ok: false, erreur: 'la generation de medias par IA n’est pas disponible sur ce serveur' },
      { status: 409 },
    );
  }
  const fournisseurId = choix.id;

  // ── LES CREDITS PAIENT LA GENERATION REELLE, AVANT L'APPEL ──────────────
  //
  // Debiter APRES aurait laisse passer une depense superieure au solde ; debiter avant, de
  // facon atomique, fait du solde la vraie limite — y compris pour deux generations lancees
  // en meme temps. La generation SIMULEE ne coute rien et ne debite rien.
  //
  // Budget inconnu (prix illisible, migration du debit absente) : on REFUSE l'appel payant
  // au lieu de l'engager a l'aveugle.
  let reservation: Reservation | null = null;
  if (choix.mode === 'reelle') {
    const prise = await reserverCredits(s.userId, operation as 'image' | 'video');
    if (!prise.ok) {
      return NextResponse.json(
        { ok: false, erreur: prise.message, motif: prise.motif, cout: prise.cout ?? null },
        { status: prise.motif === 'solde_insuffisant' ? 402 : 409 },
      );
    }
    reservation = prise.reservation;
  }

  // Le client peut rabaisser le plafond, jamais le relever.
  let plafondUsd = ctx.plafondUsd;
  if (corps?.plafondUsd !== undefined) {
    // Un NOMBRE, pas une chaine ni `null` (`Number(null)` vaut 0).
    const v = typeof corps.plafondUsd === 'number' ? corps.plafondUsd : Number.NaN;
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ ok: false, erreur: 'plafondUsd invalide' }, { status: 400 });
    plafondUsd = Math.min(v, ctx.plafondUsd);
  }

  const resultat = await avecDossierTemporaire(ctx, async (racinePublique) => {
    // Une video se genere DEPUIS une image : on materialise celle du plan.
    const source = film.scenes.flatMap((x) => x.plans).find((p) => p.id === planId)?.media;
    if (source && source.genre === 'image') {
      const c = cleMedia(s.userId, film.id, source.url);
      if (c) await ctx.objets.telechargerVers(c, fichierDuMedia(racinePublique, source.url));
    }
    const r = await genererMediaPlan(film, planId, {
      fournisseurId, operation: operation as 'image' | 'video', racinePublique, plafondUsd,
    });
    if (!r.ok) return r;
    const cle = cleMedia(s.userId, film.id, r.media.url);
    if (!cle) return { ok: false as const, erreur: 'chemin de media refuse' };
    await ctx.objets.deposerFichier(cle, fichierDuMedia(racinePublique, r.media.url), typeContenuDepuisCle(cle));
    return r;
  });

  if (!resultat.ok) {
    // ── CREDITS : on ne garde que ce qui a ete reellement engage ──────────
    // `depenseUsd` absent ou nul = le fournisseur n'a JAMAIS ete appele (plan inconnu,
    // plafond du film atteint, fournisseur eteint) : rien n'a ete facture, on rend les
    // credits. Des que l'appel est parti, il est paye : les credits restent pris, et le
    // message le dit.
    const engage = (resultat.depenseUsd ?? 0) > 0;
    if (reservation && !engage) await reservation.rembourser(`generation refusee avant tout appel : ${resultat.erreur}`);
    // ⚠️ L'APPEL A PU ETRE FACTURE MALGRE L'ECHEC (delai depasse, resultat illisible…).
    // On l'enregistre sur le film : sans cela, chaque echec laissait le compteur intact et
    // le plafond ne serait jamais atteint — on pourrait depenser sans fin.
    if (resultat.depenseUsd && resultat.depenseUsd > 0) {
      await modifierFilm(ctx.films, params.id, s.userId, (f) => ({
        ...f,
        coutGenerationUsd: Math.round(((f.coutGenerationUsd ?? 0) + resultat.depenseUsd!) * 10_000) / 10_000,
      })).catch(() => null);
    }
    // Un refus de plafond ou de fournisseur eteint n'est PAS une erreur serveur.
    const status = resultat.verification ? 402 : 400;
    return NextResponse.json({
      ok: false,
      erreur: resultat.erreur,
      verification: resultat.verification ?? null,
      // Dire la verite sur l'argent : credits rendus, ou pris parce que l'appel est parti.
      ...(reservation && reservation.cout > 0 ? { creditsRendus: !engage, creditsPris: engage ? reservation.cout : 0 } : null),
    }, { status });
  }

  // La depense et la trace de reference s'appliquent au film LE PLUS RECENT.
  const depense = Math.round(((resultat.film.coutGenerationUsd ?? 0) - (film.coutGenerationUsd ?? 0)) * 10_000) / 10_000;
  const refsUtilisees = new Map(resultat.film.scenes.flatMap((x) => x.plans).map((p) => [p.id, p.referencesUtilisees] as const));
  const suivant = await modifierFilm(ctx.films, params.id, s.userId, (f) => {
    const avecMedia = remplacerMedia(f, planId, resultat.media);
    return {
      ...avecMedia,
      coutGenerationUsd: Math.round(((f.coutGenerationUsd ?? 0) + depense) * 10_000) / 10_000,
      scenes: avecMedia.scenes.map((x) => ({ ...x, plans: x.plans.map((p) => p.id !== planId ? p : { ...p, referencesUtilisees: refsUtilisees.get(p.id) }) })),
    };
  }).catch(() => null);
  if (!suivant) {
    const cle = cleMedia(s.userId, film.id, resultat.media.url);
    if (cle) await ctx.objets.supprimer(cle).catch(() => {});
    // Le media est jete, mais le fournisseur a bien ete paye : la depense reste comptee.
    if (depense > 0) {
      await modifierFilm(ctx.films, params.id, s.userId, (f) => ({
        ...f,
        coutGenerationUsd: Math.round(((f.coutGenerationUsd ?? 0) + depense) * 10_000) / 10_000,
      })).catch(() => null);
    }
    return NextResponse.json({ ok: false, erreur: 'film modifie en parallele, reessayez' }, { status: 409 });
  }

  const aProduire = scenesAReproduire(suivant).map((x) => x.id);
  return NextResponse.json({
    ok: true,
    media: { ...resultat.media, url: undefined },
    film: suivant,
    montage: presenterMontage(monterFilm(suivant), suivant.id),
    scenesAProduire: aProduire,
    devis: devisFilm(suivant, aProduire),
  });
}
