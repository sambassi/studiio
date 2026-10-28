/**
 * CINEMA IA — lancer la generation IA du media d'un plan (image, ou video depuis l'image).
 *
 * ⚠️ LE FOURNISSEUR EST CHOISI PAR LE SERVEUR (`fournisseurServeur`), jamais par le corps
 * de la requete : une generation REELLE depense de l'argent. Par defaut, rien n'est
 * disponible et la route repond 409.
 *
 * ⚠️ LE PLAFOND EST CELUI DU SERVEUR. Le corps de la requete peut tout au plus
 * le RABAISSER (`plafondUsd`) : jamais le relever.
 *
 * ⚠️ LA ROUTE N'ATTEND PLUS LE FOURNISSEUR. Une video prend une a plusieurs minutes :
 * tenir la requete ouverte faisait abandonner le navigateur pendant que le serveur
 * continuait — et un second clic payait une seconde fois. La route :
 *   1. valide (session, film, plan, operation, fournisseur, plafond) ;
 *   2. RESERVE la generation du film (`suivi.ts`) — atomique, UNE seule active par
 *      film : un double clic recoit la generation deja en cours, sans debit (409) ;
 *   3. lance l'execution en arriere-plan (`executeur-generation.ts`), qui porte TOUTE
 *      la logique financiere (plafonds, debit au dernier moment, remboursement) ;
 *   4. repond 202 avec l'identifiant. L'ecran suit l'etat en relisant le film.
 */
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { idPlanValide } from '@/lib/cinema/acces';
import { fournisseurServeur } from '@/lib/cinema/garde';
import { reserverGeneration, generationsDuFilm } from '@/lib/cinema/generation/suivi';
import { lancerGeneration, solderGenerationsInterrompues } from '@/lib/cinema/generation/executeur-generation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  // Un `fournisseurId` recu dans le corps est simplement ignore.

  if (!planId || !idPlanValide(planId)) return NextResponse.json({ ok: false, erreur: 'planId requis' }, { status: 400 });
  if (!operation || !OPERATIONS_VALIDES.has(operation)) {
    return NextResponse.json({ ok: false, erreur: 'operation invalide (image ou video attendu)' }, { status: 400 });
  }
  const plan = film.scenes.flatMap((x) => x.plans).find((p) => p.id === planId);
  if (!plan) return NextResponse.json({ ok: false, erreur: 'plan inconnu' }, { status: 400 });
  if (operation === 'video' && plan.media?.genre !== 'image') {
    return NextResponse.json({ ok: false, erreur: 'une video se genere depuis une image : generez d’abord une image pour ce plan' }, { status: 400 });
  }

  const choix = fournisseurServeur(operation as 'image' | 'video', s.userId);
  if (!choix) {
    return NextResponse.json(
      { ok: false, erreur: 'la generation de medias par IA n’est pas disponible sur ce serveur' },
      { status: 409 },
    );
  }

  // Le client peut rabaisser le plafond, jamais le relever.
  let plafondUsd = ctx.plafondUsd;
  if (corps?.plafondUsd !== undefined) {
    const v = typeof corps.plafondUsd === 'number' ? corps.plafondUsd : Number.NaN;
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ ok: false, erreur: 'plafondUsd invalide' }, { status: 400 });
    plafondUsd = Math.min(v, ctx.plafondUsd);
  }

  // Ce qu'une interruption du serveur aurait laisse pris : rendu avant tout nouveau geste.
  await solderGenerationsInterrompues(ctx, film.id, s.userId, film).catch(() => {});

  const reserve = await reserverGeneration(ctx.films, film.id, s.userId, {
    planId, operation: operation as 'image' | 'video', mode: choix.mode,
  }).catch(() => ({ ok: false as const, raison: 'absent' as const }));
  if (!reserve.ok) {
    if (reserve.raison === 'en_cours') {
      return NextResponse.json({
        ok: false, enCours: true, generation: reserve.generation,
        erreur: 'une generation est deja en cours pour ce film — rien de nouveau n’a ete lance ni debite',
      }, { status: 409 });
    }
    return filmInconnu();
  }

  // Executee HORS de la requete : la reponse part tout de suite.
  void lancerGeneration({
    ctx, userId: s.userId, filmId: film.id, generation: reserve.generation, fournisseurId: choix.id, plafondUsd,
  });

  const apres = await ctx.films.lire(film.id, s.userId);
  return NextResponse.json({
    ok: true,
    generation: reserve.generation,
    generations: apres ? generationsDuFilm(apres.film) : [reserve.generation],
  }, { status: 202 });
}
