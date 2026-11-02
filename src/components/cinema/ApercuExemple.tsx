'use client';

/**
 * CINEMA IA — L'APERCU PRINCIPAL QUAND IL MONTRE UN EXEMPLE.
 *
 * ⚠️ IL N'Y A QU'UN SEUL APERCU A L'ECRAN. Avant, un extrait de style jouait sous la grille
 * pendant que l'apercu du film tournait a cote : deux videos en concurrence, et on ne savait
 * plus laquelle etait « la sienne ». Desormais la colonne de droite montre UNE chose a la
 * fois — le film de l'utilisateur, ou un exemple — et « Revenir a mon film » ramene toujours
 * au sien. Le scenario, les reglages et le montage ne sont pas touches par un exemple.
 *
 * Deux sortes d'exemples, jamais melangees : un STYLE (lumiere, palette, ambiance) et un
 * MOUVEMENT de camera. Chacun dit sa source et rappelle que ce n'est pas une video produite
 * par Studiio.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Palette, Video } from 'lucide-react';
import LecteurVideo from '@/components/cinema/LecteurVideo';
import { EXTRAITS_STYLES, MENTION_EXTRAITS } from '@/lib/cinema/extraits-styles';
import { MENTION_MOUVEMENTS, mouvementDemo } from '@/lib/cinema/mouvements-camera';
import { styleCinema } from '@/lib/cinema/direction/styles';
import { cameraCinema, estCameraCinema } from '@/lib/cinema/direction/camera';
import type { IdStyleCinema } from '@/lib/cinema/types';

/**
 * Le ratio NATIF de tous les extraits d'exemple (styles et mouvements) : 1280x720.
 * ⚠️ Le format du PROJET (9:16 ou 16:9) ne s'applique jamais a un exemple : il ne vaut que pour
 * la composition du film de l'utilisateur et son export. Un cadre 9:16 autour d'un extrait
 * 16:9 coupait le flacon de la publicite premium.
 */
export const RATIO_NATIF_EXEMPLE = '16 / 9';

/** Ce que l'apercu principal montre a la place du film : un style, ou un mouvement. */
export type Exemple =
  | { type: 'style'; id: IdStyleCinema }
  | { type: 'mouvement'; id: string };

export interface VueExemple {
  titre: string;
  /** Le nom seul (« Film noir ») : ce qui reste lisible sur une ligne de mobile. */
  court: string;
  sousTitre: string;
  video: string;
  poster: string;
  mention: string;
  credit: { auteur: string; source: string; url: string };
  icone: 'style' | 'mouvement';
}

/** Les donnees de l'exemple demande, ou `null` s'il n'existe pas (rien n'est invente). */
export function vueExemple(e: Exemple | null): VueExemple | null {
  if (!e) return null;
  if (e.type === 'style') {
    const s = styleCinema(e.id);
    const x = EXTRAITS_STYLES[e.id];
    if (!s || !x) return null;
    return {
      titre: `Exemple de style — ${s.libelle}`, court: s.libelle, sousTitre: x.sujet,
      video: x.video, poster: x.poster, mention: MENTION_EXTRAITS, credit: x.credit, icone: 'style',
    };
  }
  const m = mouvementDemo(e.id);
  if (!m) return null;
  return {
    titre: `Mouvement de caméra — ${m.libelle}`, court: m.libelle, sousTitre: m.quoiRegarder,
    video: m.video, poster: m.poster, mention: MENTION_MOUVEMENTS, credit: m.credit, icone: 'mouvement',
  };
}

export default function ApercuExemple({ exemple, format, surRevenir, surAgrandir }: {
  exemple: Exemple;
  /** Le format du projet : il ne change PAS le cadre de l'exemple, seulement une note. */
  format: string;
  surRevenir: () => void;
  surAgrandir: () => void;
}) {
  const v = vueExemple(exemple);
  const sansExtrait = !v && exemple.type === 'mouvement' && estCameraCinema(exemple.id) && exemple.id !== 'auto';
  const section = useRef<HTMLElement | null>(null);
  // Choisir un exemple (un mouvement sous l'apercu, une vignette de style) le MONTRE tout de suite :
  // la colonne remonte en haut, sinon sur mobile l'extrait resterait au-dessus de la zone visible.
  useEffect(() => {
    const colonne = section.current?.closest('aside');
    if (colonne) colonne.scrollTop = 0;
  }, [exemple.type, exemple.id]);
  // Un mouvement sans plan filme : on le DIT, sans lecteur vide ni faux mouvement.
  if (!v && sansExtrait) {
    const m = cameraCinema(exemple.id as never);
    return (
      <section ref={section} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 lg:p-5" data-apercu="exemple" data-exemple="indisponible">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold lg:basis-full lg:text-base">
            <Video className="h-4 w-4 shrink-0 text-violet-400" aria-hidden="true" /> <span className="truncate">{m.libelle}</span>
          </h2>
          <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">Exemple</span>
          <button type="button" onClick={surRevenir} aria-label="Revenir à mon film" title="Revenir à mon film"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:border-violet-500/60 hover:text-violet-200">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Revenir à mon film</span>
          </button>
        </div>
        <div className="mx-auto flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 px-3 text-center" style={{ aspectRatio: RATIO_NATIF_EXEMPLE }} data-ratio-exemple="16:9">
          <p className="text-sm font-semibold text-slate-200">Exemple indisponible</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-400">Aucun extrait filmé n’existe pour ce mouvement. Il sera appliqué à votre film, sans démonstration.</p>
        </div>
      </section>
    );
  }
  if (!v) return null;
  const portrait = format === '9:16';
  const Icone = v.icone === 'style' ? Palette : Video;

  return (
    <section ref={section} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 lg:p-5" data-apercu="exemple">
      {/* Compact : titre sur UNE ligne et « Revenir » en icone sur petit ecran, pour que l'extrait
          tienne en entier dans la bande d'apercu du mobile. */}
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold sm:items-start lg:basis-full lg:text-base">
          <Icone className="h-4 w-4 shrink-0 text-violet-400" aria-hidden="true" /> <span className="truncate sm:hidden">{v.court}</span><span className="hidden sm:inline">{v.titre}</span>
        </h2>
        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">Exemple</span>
        <button
          type="button"
          onClick={surRevenir}
          aria-label="Revenir à mon film"
          title="Revenir à mon film"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:border-violet-500/60 hover:text-violet-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Revenir à mon film</span>
        </button>
      </div>
      <p className="mb-2 truncate text-xs text-slate-400" title={v.sousTitre}>{v.sousTitre}</p>

      {/* Le cadre garde le ratio NATIF de l'extrait et montre toute l'image (contain). */}
      <div className="mx-auto w-full" style={{ aspectRatio: RATIO_NATIF_EXEMPLE }} data-ratio-exemple="16:9">
        <LecteurVideo
          key={v.video}
          src={v.video} poster={v.poster} titre={`${v.titre} : ${v.sousTitre}`}
          sansSon autoLecture boucle agrandissable surAgrandir={surAgrandir} ajustement="contain"
          className="h-full w-full"
        />
      </div>
      {portrait && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          L’exemple reste en 16:9 pour être vu en entier ; votre film sera composé en 9:16.
        </p>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        {v.mention} Image : {v.credit.auteur} ({v.credit.source}).
      </p>
    </section>
  );
}

/**
 * L'exemple en grand : une fenetre a part, posee dans `document.body` par un PORTAIL.
 *
 * Pourquoi un portail : la colonne de droite est `lg:sticky`, et un element `sticky` cree
 * toujours un contexte d'empilement — la barre laterale passait par-dessus la fenetre
 * (mesure le 2026-10-28). Sortir du contexte est la seule correction qui tienne.
 */
export function FenetreExemple({ exemple, surFermer }: { exemple: Exemple; surFermer: () => void }) {
  const v = vueExemple(exemple);

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') surFermer(); };
    document.addEventListener('keydown', surTouche);
    const avant = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', surTouche); document.body.style.overflow = avant; };
  }, [surFermer]);

  if (!v || typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={v.titre}
      className="fixed inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/95 p-3 sm:p-6"
      style={{ zIndex: 60 }}
      onClick={(e) => { if (e.target === e.currentTarget) surFermer(); }}
    >
      {/* Plein ecran : le plus grand cadre 16:9 qui tient, sans jamais rogner l'image. */}
      <div style={{ aspectRatio: RATIO_NATIF_EXEMPLE, width: 'min(100%, calc((100vh - 7rem) * 16 / 9))' }} data-ratio-exemple="16:9">
        <LecteurVideo
          src={v.video} poster={v.poster} titre={`${v.titre} : ${v.sousTitre}`}
          sansSon autoLecture boucle agrandi surReduire={surFermer} ajustement="contain"
          className="h-full w-full"
        />
      </div>
      <p className="max-w-3xl text-center text-[11px] text-slate-400">
        {v.titre} — {v.sousTitre} {v.mention} Image : {v.credit.auteur} ({v.credit.source}). Echap pour revenir.
      </p>
    </div>,
    document.body,
  );
}
