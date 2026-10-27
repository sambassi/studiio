/**
 * CINEMA IA — produire le film.
 *
 *   rendre: false (defaut) → APERCU : voix + durees alignees, synchrone, sans
 *                            Chromium ni minutes.
 *   rendre: true           → lance un TRAVAIL en arriere-plan et rend son
 *                            identifiant (202). Le navigateur n'attend rien :
 *                            il interroge `…/travaux/<id>`.
 *
 * Le travail est IDEMPOTENT : un second clic, un second onglet ou un client
 * qui rejoue la requete RETROUVE le travail actif du film (`dejaEnCours`) au
 * lieu d'en lancer un deuxieme. Le plafond de depense est celui du SERVEUR,
 * verifie ici avant de creer le travail et re-verifie par l'executeur.
 */
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema, dependancesExecuteur } from '@/lib/cinema/contexte';
import { avecDossierTemporaire, filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { preparerApercu } from '@/lib/cinema/travaux/apercu';
import { evaluerProduction } from '@/lib/cinema/travaux/plafond';
import { demarrerTravail } from '@/lib/cinema/travaux/lanceur';
import { TRAVAUX_ACTIFS_MAX_PAR_COMPTE, cleTravail, presenterTravail, scenesValides } from '@/lib/cinema/travaux/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  // Meme regle que GET/PATCH : un film d'un autre compte est « inconnu ».
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return filmInconnu();
  const film = lu.film;

  const corps = await req.json().catch(() => ({}));
  const rendre = corps?.rendre === true;
  const demandees = scenesValides(film, corps?.scenes);

  if (!rendre) {
    try {
      const a = await avecDossierTemporaire(ctx, (racinePublique) =>
        preparerApercu({ film, proprietaire: s.userId, objets: ctx.objets, racinePublique }));
      return NextResponse.json({
        ok: true,
        film: a.film,
        montage: presenterMontage(a.montage, film.id, a.voix),
        devis: a.devis,
        scenesAProduire: a.scenesAProduire,
        voix: { moteur: a.moteur, motifRepli: null, produites: a.voixProduites, echecs: [] },
        scenesRendues: [],
        scenesReutilisees: [],
        mp4: null,
        avertissements: a.avertissements,
      });
    } catch (e) {
      const reference = Math.random().toString(36).slice(2, 10);
      console.error(`[cinema/apercu] ${reference} —`, e instanceof Error ? e.stack ?? e.message : e);
      return NextResponse.json({ ok: false, erreur: `echec de l'apercu (reference ${reference})`, reference }, { status: 500 });
    }
  }

  // ── Production : refus immediat si le serveur ne l'autorise pas ─────────
  const evaluation = await evaluerProduction({
    film, proprietaire: s.userId, objets: ctx.objets, demandees, plafondUsd: ctx.plafondUsd,
  });
  if (!evaluation.verification.autorise) {
    return NextResponse.json(
      { ok: false, erreur: evaluation.verification.motif ?? 'plafond de depenses atteint', verification: evaluation.verification },
      { status: 402 },
    );
  }

  const r = await ctx.travaux.creerOuRetrouver({
    film, proprietaire: s.userId, cle: cleTravail(film, demandees), scenesDemandees: demandees,
    maxActifs: TRAVAUX_ACTIFS_MAX_PAR_COMPTE,
  });
  if (r.motif === 'film_absent') return filmInconnu();
  if (r.motif === 'trop_de_travaux') {
    return NextResponse.json({ ok: false, erreur: 'trop de productions en cours, attendez la fin de l\'une d\'elles' }, { status: 429 });
  }

  if (!r.travail) return filmInconnu();

  if (r.cree) demarrerTravail(r.travail.id, s.userId, () => dependancesExecuteur(ctx));
  return NextResponse.json(
    { ok: true, dejaEnCours: !r.cree, travail: presenterTravail(r.travail), devis: evaluation.devis },
    { status: r.cree ? 202 : 200 },
  );
}
