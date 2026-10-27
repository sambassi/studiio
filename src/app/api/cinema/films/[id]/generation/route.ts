/**
 * CINEMA IA — generer le media d'un plan par IA (fournisseur SIMULE).
 *
 * ⚠️ AUCUNE GENERATION PAYANTE N'EST POSSIBLE PAR CETTE ROUTE. Le seul
 * fournisseur ACTIF est `simule` (local, gratuit, ffmpeg). Un fournisseur
 * declare mais eteint est refuse par `genererMediaPlan` avant toute
 * construction de prompt — c'est le registre qui decide, pas cette route.
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

// Import pour sa SEULE presence : il enregistre le fournisseur simule dans le registre.
import '@/lib/cinema/generation/simule';

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
  const fournisseurId = typeof corps?.fournisseurId === 'string' ? corps.fournisseurId : 'simule';

  if (!planId || !idPlanValide(planId)) return NextResponse.json({ ok: false, erreur: 'planId requis' }, { status: 400 });
  if (!operation || !OPERATIONS_VALIDES.has(operation)) {
    return NextResponse.json({ ok: false, erreur: 'operation invalide (image ou video attendu)' }, { status: 400 });
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
    // Un refus de plafond ou de fournisseur eteint n'est PAS une erreur serveur.
    const status = resultat.verification ? 402 : 400;
    return NextResponse.json({ ok: false, erreur: resultat.erreur, verification: resultat.verification ?? null }, { status });
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
