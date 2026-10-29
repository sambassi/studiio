'use client';

/**
 * CINEMA IA — REGLAGES DE DIRECTION ARTISTIQUE : style du film, exception par scene,
 * mouvement de camera par plan.
 *
 * Choisir ne coute RIEN et ne lance RIEN : ces composants n'appellent que `surChoisir`. Le
 * choix s'applique a la PROCHAINE generation du plan (image ou video) — ce que l'ecran dit.
 * Les miniatures sont des illustrations de reference, pas des resultats generes ; la
 * camera est une indication donnee au modele, pas une garantie.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowLeft, ArrowRight, Info, Lock, MoveHorizontal, Orbit, Palette, RefreshCw, Sparkles, ZoomIn, ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { STYLES_CINEMA, styleCinema } from '@/lib/cinema/direction/styles';
import { EXTRAITS_STYLES, MENTION_EXTRAITS } from '@/lib/cinema/extraits-styles';
import LecteurVideo from '@/components/cinema/LecteurVideo';
import { CAMERAS_CINEMA, cameraCinema } from '@/lib/cinema/direction/camera';
import type { IdCameraCinema, IdStyleCinema } from '@/lib/cinema/types';
import { ratioCadre } from '@/lib/ui/lecteur-generation';

const ICONES_CAMERA: Record<IdCameraCinema, LucideIcon> = {
  auto: Sparkles, fixe: Lock, travelling_avant: ZoomIn, travelling_arriere: ZoomOut,
  pano_gauche: ArrowLeft, pano_droite: ArrowRight, suivi_lateral: MoveHorizontal, orbite: Orbit,
};

/** Le detail replie derriere une icone d'information (UX premium : l'ecran reste epure). */
function Info2({ libelle, texte }: { libelle: string; texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <button type="button" onClick={() => setOuvert((v) => !v)} aria-label={libelle} aria-expanded={ouvert}
        className="text-slate-500 hover:text-violet-300 transition-colors">
        <Info className="w-3.5 h-3.5" />
      </button>
      {ouvert && <span className="text-[11px] text-slate-400">{texte}</span>}
    </span>
  );
}

/**
 * Style GLOBAL du film : six cartes, chacune avec le PHOTOGRAMME de son extrait.
 *
 * Un clic fait deux choses, et seulement deux : il choisit le style, et il montre l'extrait
 * correspondant SOUS la grille. Il ne touche ni au scenario, ni a l'apercu du film de
 * l'utilisateur (qui vit dans l'autre colonne), et ne lance aucune generation.
 * Reclic sur le style actif = aucun style impose.
 */
export function SelecteurStyleFilm({ valeur, surChoisir }: {
  valeur: IdStyleCinema | null; surChoisir: (id: IdStyleCinema | null) => void;
}) {
  const actif = styleCinema(valeur);
  /** L'extrait montre a l'ecran — pas forcement le style choisi : on peut regarder sans choisir. */
  const [vu, setVu] = useState<IdStyleCinema | null>(null);
  const [agrandi, setAgrandi] = useState(false);
  const extrait = vu ? EXTRAITS_STYLES[vu] : null;
  const styleVu = styleCinema(vu);

  useEffect(() => {
    if (!agrandi) return;
    const surTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') setAgrandi(false); };
    document.addEventListener('keydown', surTouche);
    const avant = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', surTouche); document.body.style.overflow = avant; };
  }, [agrandi]);

  return (
    <div className="mt-4" data-direction="style-film">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Palette className="w-3.5 h-3.5 text-violet-400" />
        Style du film
        <Info2
          libelle="Ce que change un style"
          texte="Un style regle la lumiere, la palette, l’ambiance et la texture de l’image. Il ne change ni les personnages, ni les repliques, ni les lieux. Choisir un style ne lance aucune generation et ne coute rien : il s’applique a la prochaine image ou video generee."
        />
      </div>
      <div role="radiogroup" aria-label="Style cinematique du film" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {STYLES_CINEMA.map((s) => {
          const choisi = valeur === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={choisi}
              aria-label={`${s.libelle}${choisi ? ' (choisi, cliquer pour retirer)' : ''}`}
              title={s.resume}
              onClick={() => { setVu(s.id); surChoisir(choisi ? null : s.id); }}
              className={`overflow-hidden rounded-lg border text-left transition-colors ${choisi
                ? 'border-violet-500/80 ring-2 ring-violet-500/40 bg-violet-500/10'
                : 'border-slate-800 bg-slate-900/40 hover:border-violet-500/40'}`}
            >
              <span className="relative block overflow-hidden bg-slate-950" style={{ aspectRatio: ratioCadre('16:9') }}>
                {/* Photogramme de l'extrait : une image fixe du depot, jamais un rendu genere. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={EXTRAITS_STYLES[s.id].poster} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(5,6,10,0) 0%, rgba(5,6,10,0.8) 100%)' }} />
                <span className="absolute bottom-1 left-2 right-2 block truncate text-[11px] font-semibold text-white">{s.libelle}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* L'extrait du style regarde : SOUS la grille, jamais a la place de l'apercu du film. */}
      {extrait && styleVu && (
        <div className="mt-2" data-direction="extrait-style">
          <LecteurVideo
            src={extrait.video} poster={extrait.poster} sansSon badge="Exemple"
            titre={`Exemple de rendu — ${styleVu.libelle} : ${extrait.sujet}`}
            autoLecture boucle agrandissable surAgrandir={() => setAgrandi(true)}
            className="mx-auto w-full"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            <span className="text-slate-200">{styleVu.libelle}</span> — {extrait.sujet}.{' '}
            <span className="text-slate-500">{MENTION_EXTRAITS} Image : {extrait.credit.auteur} ({extrait.credit.source}).</span>
          </p>
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-slate-500">
        {actif ? <><span className="text-slate-300">{actif.libelle}</span> — {actif.resume}</> : 'Aucun style impose : le plan est genere d’apres sa seule description.'}
      </p>
      {actif && (
        <details className="mt-1 text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none text-slate-500 hover:text-violet-300">Eclairage, palette, ambiance, texture</summary>
          <ul className="mt-1 space-y-0.5 pl-4 list-disc">
            <li>Eclairage : {actif.detail.eclairage}</li>
            <li>Palette : {actif.detail.palette}</li>
            <li>Ambiance : {actif.detail.ambiance}</li>
            <li>Texture : {actif.detail.texture}</li>
          </ul>
        </details>
      )}

      {/* Fenetre separee : l'apercu du film de l'utilisateur, derriere, n'est pas remplace. */}
      {agrandi && extrait && styleVu && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog" aria-modal="true" aria-label={`Exemple de rendu — ${styleVu.libelle}`}
          className="fixed inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/95 p-3 sm:p-6"
          style={{ zIndex: 60 }}
          onClick={(e) => { if (e.target === e.currentTarget) setAgrandi(false); }}
        >
          <LecteurVideo
            src={extrait.video} poster={extrait.poster} sansSon badge="Exemple"
            titre={`Exemple de rendu — ${styleVu.libelle} : ${extrait.sujet}`}
            autoLecture boucle agrandi surReduire={() => setAgrandi(false)}
            className="w-full"
          />
          <p className="max-w-3xl text-center text-[11px] text-slate-400">
            {styleVu.libelle} — {extrait.sujet}. {MENTION_EXTRAITS} Image : {extrait.credit.auteur} ({extrait.credit.source}). Echap pour revenir.
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Exception de style pour UNE scene : discrete, un seul champ. */
export function SelecteurStyleScene({ valeur, styleFilm, surChoisir }: {
  valeur: IdStyleCinema | null; styleFilm: IdStyleCinema | null; surChoisir: (id: IdStyleCinema | null) => void;
}) {
  const parDefaut = styleCinema(styleFilm);
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-400" data-direction="style-scene">
      <Palette className={`w-3.5 h-3.5 ${valeur ? 'text-violet-300' : 'text-slate-500'}`} aria-hidden="true" />
      <span className="sr-only">Style de cette scene</span>
      <select
        value={valeur ?? ''}
        onChange={(e) => surChoisir((e.target.value || null) as IdStyleCinema | null)}
        aria-label="Style de cette scene"
        className={`rounded bg-slate-950 border px-2 py-1 ${valeur ? 'border-violet-500/50 text-violet-200' : 'border-slate-700'}`}
      >
        <option value="">{parDefaut ? `Style du film (${parDefaut.libelle})` : 'Style du film (aucun)'}</option>
        {STYLES_CINEMA.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}
      </select>
    </label>
  );
}

/** Mouvement de camera d'UN plan. `automatique` : le mouvement que l'automatique choisirait. */
export function SelecteurCamera({ valeur, automatique, ancien = false, surChoisir }: {
  valeur: IdCameraCinema; automatique: Exclude<IdCameraCinema, 'auto'>; ancien?: boolean; surChoisir: (id: IdCameraCinema) => void;
}) {
  const Icone = ICONES_CAMERA[valeur];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400" data-direction="camera">
      <Icone className={`w-3.5 h-3.5 ${valeur === 'auto' ? 'text-slate-500' : 'text-violet-300'}`} aria-hidden="true" />
      <select
        value={valeur}
        onChange={(e) => surChoisir(e.target.value as IdCameraCinema)}
        aria-label="Mouvement de camera de ce plan"
        className={`rounded bg-slate-950 border px-2 py-1 ${valeur === 'auto' ? 'border-slate-700' : 'border-violet-500/50 text-violet-200'}`}
      >
        {CAMERAS_CINEMA.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id === 'auto'
              ? (ancien ? 'Camera d’origine (douce)' : `Automatique (${cameraCinema(automatique).libelle.toLowerCase()})`)
              : c.libelle}
          </option>
        ))}
      </select>
      <Info2
        libelle="A propos du mouvement de camera"
        texte="Indication donnee au modele video : il l’interprete et peut s’en ecarter. Elle s’applique a la prochaine animation par IA de ce plan ; l’image du plan reste fixe."
      />
    </span>
  );
}

/** Une ligne d'etat : le style du film et les scenes qui y font exception. */
export function ResumeStyle({ styleFilm, exceptions }: { styleFilm: IdStyleCinema | null; exceptions: number }) {
  const s = styleCinema(styleFilm);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400" data-direction="resume">
      <Palette className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
      Style du film : <span className="text-slate-200">{s ? s.libelle : 'aucun impose'}</span>
      {exceptions > 0 && <span>· {exceptions} scene{exceptions > 1 ? 's' : ''} avec un style different</span>}
      <span className="inline-flex items-center gap-1 text-slate-500">
        <AlertCircle className="w-3 h-3" aria-hidden="true" /> s’applique aux prochaines generations
      </span>
    </p>
  );
}

/**
 * Plan dont le media genere date d'AVANT le style ou la camera actuels. Le media est conserve ;
 * il n'est simplement pas presente comme issu de la direction actuelle. Aucun bouton ici :
 * regenerer reste l'action habituelle du plan, avec son devis et sa validation.
 */
export function PlanAregenerer({ genre }: { genre: 'image' | 'video' }) {
  return (
    <span
      data-direction="a-regenerer"
      title="Ce media a ete genere avec un autre style ou une autre camera. Il est conserve ; regenerez ce plan pour appliquer la direction actuelle (devis a valider)."
      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200"
    >
      <RefreshCw className="w-3 h-3" aria-hidden="true" />
      {genre === 'video' ? 'Video' : 'Image'} a regenerer : direction modifiee
    </span>
  );
}
