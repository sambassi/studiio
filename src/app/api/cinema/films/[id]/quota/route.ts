/**
 * CINEMA IA — quota de l'abonnement et DEVIS GLOBAL du projet, AVANT toute generation.
 *
 * GET  : lecture seule. Selon le regime decide cote serveur (`abonnement/regime.ts`) :
 *   - `credits`      : rien de nouveau (comportement actuel) ;
 *   - `abonnement`   : films et minutes utilises / inclus, scenes, plans, duree du projet,
 *                      disponibilite, part du budget que le projet utiliserait, budget
 *                      approuve — SANS montant fournisseur ;
 *   - `cout_reel`    : administrateur — le devis complet en USD ;
 *   - `indisponible` : la situation n'est pas verifiable, avec son message.
 * POST : APPROUVER le budget du projet (`{ perimetre: 'images' | 'complet' }`). Le
 *        serveur recalcule le devis ; aucun montant n'est lu dans la requete.
 */
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { fournisseurServeur } from '@/lib/cinema/garde';
import { devisGeneration } from '@/lib/cinema/generation/couts';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { regimeCinema, MESSAGE_PERIODE, type RegimeCinema } from '@/lib/cinema/abonnement/regime';
import { lireConsommation } from '@/lib/cinema/abonnement/depot';
import { approuverBudget, devisProjet, quotaAbonne, type Perimetre } from '@/lib/cinema/abonnement/devis';
import type { Film } from '@/lib/cinema/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SANS_CACHE = { 'Cache-Control': 'private, no-store' };
const json = (corps: unknown, status = 200) => NextResponse.json(corps, { status, headers: SANS_CACHE });

type Contexte =
  | { cas: 'reponse'; corps: Record<string, unknown> }
  | { cas: 'regime'; film: Film; regime: Extract<RegimeCinema, { type: 'cout_reel' | 'abonnement' }>; idImage: string; idVideo: string; plafondUsd: number; userId: string };

async function contexte(id: string): Promise<NextResponse | Contexte> {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(id, s.userId);
  if (!lu) return filmInconnu();
  const image = fournisseurServeur('image', s.userId);
  const video = fournisseurServeur('video', s.userId);
  // Sans generation REELLE, rien n'est facturable : aucun quota n'est en jeu.
  if (!image || image.mode !== 'reelle' || !video) return { cas: 'reponse', corps: { ok: true, regime: 'credits' } };
  const regime = await regimeCinema(s.userId);
  if (regime.type === 'credits') return { cas: 'reponse', corps: { ok: true, regime: 'credits' } };
  if (regime.type === 'refus') return { cas: 'reponse', corps: { ok: true, regime: 'indisponible', message: regime.message } };
  return { cas: 'regime', film: lu.film, regime, idImage: image.id, idVideo: video.id, plafondUsd: ctx.plafondUsd, userId: s.userId };
}

async function lectureAbonne(c: Extract<Contexte, { cas: 'regime' }>) {
  if (c.regime.type !== 'abonnement') return null;
  if (!c.regime.periode) return { erreur: MESSAGE_PERIODE } as const;
  const conso = await lireConsommation(c.userId, c.regime.periode.debut, c.film.id);
  if (!conso) return { erreur: 'Votre quota n’a pas pu etre lu. Reessayez dans un instant.' } as const;
  const premiere = c.film.scenes.flatMap((x) => x.plans)[0];
  const usdPremiereImage = premiere ? devisGeneration(c.idImage, [{ planId: premiere.id, operations: ['image'] }]).totalUsd : null;
  return { formule: c.regime.formule, consommation: conso, usdPremiereImage } as const;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const c = await contexte(params.id);
  if (c instanceof NextResponse) return c;
  if (c.cas === 'reponse') return json(c.corps);

  const devis = devisProjet(c.film, c.idImage, c.idVideo);
  if (c.regime.type === 'cout_reel') {
    return json({
      ok: true, regime: 'cout_reel', devis, plafondFilmUsd: c.plafondUsd,
      budgetApprouve: c.film.budgetApprouve ?? null, supplement: null,
    });
  }
  const a = await lectureAbonne(c);
  if (!a || 'erreur' in a) return json({ ok: true, regime: 'indisponible', message: a?.erreur ?? MESSAGE_PERIODE });
  return json({ ok: true, ...quotaAbonne({ ...a, film: c.film, devis }) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await contexte(params.id);
  if (c instanceof NextResponse) return c;
  if (c.cas === 'reponse') {
    // Regime credits : la confirmation se fait generation par generation, comme avant.
    return json({ ok: false, erreur: c.corps.regime === 'indisponible' ? c.corps.message : 'aucun budget de projet a approuver ici' }, 409);
  }
  const corps = await req.json().catch(() => null);
  const perimetre = corps?.perimetre === 'images' || corps?.perimetre === 'complet' ? (corps.perimetre as Perimetre) : null;
  if (!perimetre) return json({ ok: false, erreur: 'perimetre attendu : images ou complet' }, 400);

  const devis = devisProjet(c.film, c.idImage, c.idVideo);
  const a = c.regime.type === 'abonnement' ? await lectureAbonne(c) : null;
  if (a && 'erreur' in a) return json({ ok: false, erreur: a.erreur }, 409);
  const r = approuverBudget({
    regime: c.regime.type, film: c.film, perimetre, devis, plafondFilmUsd: c.plafondUsd,
    ...(a ? { abonnement: a } : null),
  });
  if (!r.ok) return json({ ok: false, erreur: r.message }, 409);

  const ecrit = await modifierFilm(contexteCinema().films, c.film.id, c.userId, (f) => ({ ...f, budgetApprouve: r.budget }))
    .catch(() => null);
  if (!ecrit) return json({ ok: false, erreur: 'le budget n’a pas pu etre enregistre' }, 500);
  // L'abonne ne recoit pas le montant ; l'administrateur, si.
  return json({
    ok: true,
    budgetApprouve: c.regime.type === 'cout_reel' ? r.budget : { perimetre: r.budget.perimetre, approuveLe: r.budget.approuveLe },
  });
}
