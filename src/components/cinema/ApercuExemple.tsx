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
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Palette, Video } from 'lucide-react';
import LecteurVideo from '@/components/cinema/LecteurVideo';
import { ratioCadre } from '@/lib/ui/lecteur-generation';
import { EXTRAITS_STYLES, MENTION_EXTRAITS } from '@/lib/cinema/extraits-styles';
import { MENTION_MOUVEMENTS, mouvementDemo } from '@/lib/cinema/mouvements-camera';
import { styleCinema } from '@/lib/cinema/direction/styles';
import type { IdStyleCinema } from '@/lib/cinema/types';

/** Ce que l'apercu principal montre a la place du film : un style, ou un mouvement. */
export type Exemple =
  | { type: 'style'; id: IdStyleCinema }
  | { type: 'mouvement'; id: string };

export interface VueExemple {
  titre: string;
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
      titre: `Exemple de style — ${s.libelle}`, sousTitre: x.sujet,
      video: x.video, poster: x.poster, mention: MENTION_EXTRAITS, credit: x.credit, icone: 'style',
    };
  }
  const m = mouvementDemo(e.id);
  if (!m) return null;
  return {
    titre: `Mouvement de caméra — ${m.libelle}`, sousTitre: m.quoiRegarder,
    video: m.video, poster: m.poster, mention: MENTION_MOUVEMENTS, credit: m.credit, icone: 'mouvement',
  };
}

export default function ApercuExemple({ exemple, format, surRevenir, surAgrandir }: {
  exemple: Exemple;
  /** Le format du projet : l'exemple est en 16:9, le cadre suit le projet sans deformer. */
  format: string;
  surRevenir: () => void;
  surAgrandir: () => void;
}) {
  const v = vueExemple(exemple);
  if (!v) return null;
  const portrait = format === '9:16';
  const Icone = v.icone === 'style' ? Palette : Video;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-apercu="exemple">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icone className="h-4 w-4 text-violet-400" aria-hidden="true" /> {v.titre}
        </h2>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">Exemple</span>
        <button
          type="button"
          onClick={surRevenir}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 transition-colors hover:border-violet-500/60 hover:text-violet-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Revenir à mon film
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-400">{v.sousTitre}</p>

      {/* Le cadre suit le format du projet ; l'extrait est en 16:9 et reste cadre sans etirement. */}
      <div className="mx-auto w-full" style={{ maxWidth: portrait ? 270 : 640, aspectRatio: ratioCadre(portrait ? '9:16' : '16:9') }}>
        <LecteurVideo
          key={v.video}
          src={v.video} poster={v.poster} titre={`${v.titre} : ${v.sousTitre}`}
          sansSon autoLecture boucle agrandissable surAgrandir={surAgrandir}
          className="h-full w-full"
        />
      </div>

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
      <LecteurVideo
        src={v.video} poster={v.poster} titre={`${v.titre} : ${v.sousTitre}`}
        sansSon autoLecture boucle agrandi surReduire={surFermer}
        className="w-full"
      />
      <p className="max-w-3xl text-center text-[11px] text-slate-400">
        {v.titre} — {v.sousTitre} {v.mention} Image : {v.credit.auteur} ({v.credit.source}). Echap pour revenir.
      </p>
    </div>,
    document.body,
  );
}
