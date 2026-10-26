/**
 * CINEMA IA — generer le media d'un plan par IA (lot 3, preparation).
 *
 * ⚠️ AUCUNE GENERATION PAYANTE N'EST POSSIBLE PAR CETTE ROUTE. Le seul
 * fournisseur ACTIF est `simule` (local, gratuit, ffmpeg). Un `fournisseurId`
 * qui designe un fournisseur declare mais eteint (tout vrai fournisseur
 * payant, aujourd'hui) est refuse par `genererMediaPlan` avant la moindre
 * construction de prompt — ce n'est pas cette route qui le decide, c'est le
 * registre (`generation/fournisseur.ts`), pour qu'aucun appelant ne puisse
 * le contourner en passant par un autre chemin.
 *
 * Le PLAFOND de depense est verifie AVANT tout appel fournisseur
 * (`generation/couts.ts`) — meme pour le fournisseur simule, gratuit, afin
 * que le MECANISME soit exerce des ce lot, pas seulement documente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { appartientA } from '@/lib/cinema/acces';
import { lireFilm, enregistrerFilm } from '@/lib/cinema/store';
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { PLAFOND_USD_PAR_FILM_DEFAUT } from '@/lib/cinema/generation/couts';
import { monterFilm } from '@/lib/cinema/montage';
import { scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm } from '@/lib/cinema/couts';

// Import pour sa SEULE presence : c'est lui qui enregistre le fournisseur
// simule dans le registre partage au chargement du module. Sans cet import,
// un deploiement qui ne charge jamais `simule.ts` ailleurs verrait le
// registre vide et toute generation refusee — ce qui est le comportement
// SUR dans ce cas, mais autant l'assurer explicitement ici.
import '@/lib/cinema/generation/simule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const OPERATIONS_VALIDES = new Set(['image', 'video']);
/** Fournisseurs que CETTE route a le droit de nommer dans sa reponse d'erreur. Le registre reste la source. */
const PLAFOND_MAX_ACCEPTE = 1000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });

  const racine = process.cwd();
  const film = await lireFilm(racine, params.id);
  if (!film || !appartientA(film, session.user.id)) {
    return NextResponse.json({ ok: false, erreur: 'film inconnu' }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const planId = typeof corps?.planId === 'string' ? corps.planId : null;
  const operation = typeof corps?.operation === 'string' ? corps.operation : null;
  const fournisseurId = typeof corps?.fournisseurId === 'string' ? corps.fournisseurId : 'simule';

  if (!planId) return NextResponse.json({ ok: false, erreur: 'planId requis' }, { status: 400 });
  if (!operation || !OPERATIONS_VALIDES.has(operation)) {
    return NextResponse.json({ ok: false, erreur: 'operation invalide (image ou video attendu)' }, { status: 400 });
  }

  // Un plafond EXPLICITE reste un nombre fini, positif, borne — jamais une
  // chaine, jamais l'infini. Absent : le defaut du module.
  let plafondUsd = PLAFOND_USD_PAR_FILM_DEFAUT;
  if (corps?.plafondUsd !== undefined) {
    const v = Number(corps.plafondUsd);
    if (!Number.isFinite(v) || v < 0 || v > PLAFOND_MAX_ACCEPTE) {
      return NextResponse.json({ ok: false, erreur: 'plafondUsd invalide' }, { status: 400 });
    }
    plafondUsd = v;
  }

  const resultat = await genererMediaPlan(film, planId, {
    fournisseurId,
    operation: operation as 'image' | 'video',
    racinePublique: `${racine}/public`,
    plafondUsd,
  });

  if (!resultat.ok) {
    // Un refus de plafond ou de fournisseur eteint n'est PAS une erreur
    // serveur : 402 (paiement requis / cout refuse) pour le plafond, 400
    // pour le reste. Aucune des deux ne laisse deviner un detail interne.
    const status = resultat.verification ? 402 : 400;
    return NextResponse.json({ ok: false, erreur: resultat.erreur, verification: resultat.verification ?? null }, { status });
  }

  await enregistrerFilm(racine, resultat.film);
  const aProduire = scenesAReproduire(resultat.film).map((s) => s.id);
  return NextResponse.json({
    ok: true,
    media: resultat.media,
    film: resultat.film,
    montage: monterFilm(resultat.film),
    scenesAProduire: aProduire,
    devis: devisFilm(resultat.film, aProduire),
  });
}
