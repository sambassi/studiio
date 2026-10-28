/**
 * CINEMA IA — GET : quota de l'abonnement et devis du projet, AVANT toute generation.
 *
 * Lecture seule : rien n'est reserve ni debite. Le regime est decide cote serveur
 * (`abonnement/regime.ts`) ; la reponse depend de lui :
 *   - `credits`      : rien de nouveau a montrer (comportement actuel) ;
 *   - `abonnement`   : films et minutes utilises / inclus, duree du projet, disponibilite,
 *                      couverture du projet — SANS montant fournisseur ;
 *   - `cout_reel`    : administrateur — le cout fournisseur estime, en USD ;
 *   - `indisponible` : la situation n'est pas verifiable, avec son message.
 */
import { NextResponse } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { fournisseurServeur } from '@/lib/cinema/garde';
import { devisGeneration } from '@/lib/cinema/generation/couts';
import { regimeCinema, MESSAGE_PERIODE } from '@/lib/cinema/abonnement/regime';
import { lireConsommation } from '@/lib/cinema/abonnement/depot';
import { devisProjet, quotaAbonne } from '@/lib/cinema/abonnement/devis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SANS_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return filmInconnu();
  const film = lu.film;
  const json = (corps: unknown) => NextResponse.json({ ok: true, ...(corps as object) }, { headers: SANS_CACHE });

  const image = fournisseurServeur('image', s.userId);
  const video = fournisseurServeur('video', s.userId);
  // Sans generation REELLE, rien n'est facturable : aucun quota n'est en jeu.
  if (!image || image.mode !== 'reelle' || !video) return json({ regime: 'credits' });

  const regime = await regimeCinema(s.userId);
  if (regime.type === 'credits') return json({ regime: 'credits' });
  if (regime.type === 'refus') return json({ regime: 'indisponible', message: regime.message });

  const devis = devisProjet(film, image.id, video.id);
  if (regime.type === 'cout_reel') {
    return json({ regime: 'cout_reel', devis, supplement: null });
  }

  if (!regime.periode) return json({ regime: 'indisponible', message: MESSAGE_PERIODE });
  const conso = await lireConsommation(s.userId, regime.periode.debut, film.id);
  if (!conso) return json({ regime: 'indisponible', message: 'Votre quota n’a pas pu etre lu. Reessayez dans un instant.' });
  const premiere = film.scenes.flatMap((x) => x.plans)[0];
  const usdPremiereImage = premiere
    ? devisGeneration(image.id, [{ planId: premiere.id, operations: ['image'] }]).totalUsd
    : null;
  return json(quotaAbonne({ formule: regime.formule, consommation: conso, film, devis, usdPremiereImage }));
}
