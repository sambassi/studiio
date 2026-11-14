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
import { useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Info, Lock, MoveHorizontal, Orbit, Palette, RefreshCw, Sparkles, ZoomIn, ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { STYLES_CINEMA, styleCinema } from '@/lib/cinema/direction/styles';
import { EXTRAITS_STYLES } from '@/lib/cinema/extraits-styles';
import { CAMERAS_CINEMA, cameraCinema } from '@/lib/cinema/direction/camera';
import type { IdCameraCinema, IdStyleCinema } from '@/lib/cinema/types';
import { ratioCadre } from '@/lib/ui/lecteur-generation';
import { useTranslations } from '@/i18n/client';

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
 * Un clic fait deux choses, et seulement deux : il choisit le style, et il demande a l'APERCU
 * PRINCIPAL (colonne de droite) de montrer l'extrait correspondant — jamais un second lecteur
 * ici. Il ne touche ni au scenario, ni aux reglages, et ne lance aucune generation.
 * Reclic sur le style actif = aucun style impose.
 */
export function SelecteurStyleFilm({ valeur, surChoisir, surMontrerExemple, exempleVu }: {
  valeur: IdStyleCinema | null;
  surChoisir: (id: IdStyleCinema | null) => void;
  /** Absent : les cartes choisissent le style sans rien montrer (aucun apercu disponible). */
  surMontrerExemple?: (id: IdStyleCinema) => void;
  /** Le style dont l'extrait est affiche dans l'apercu principal, pour le marquer. */
  exempleVu?: IdStyleCinema | null;
}) {
  const tUi = useTranslations('ui.componentsCinemaDirectionCinema');
  const actif = styleCinema(valeur);
  return (
    <div className="mt-4" data-direction="style-film">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Palette className="w-3.5 h-3.5 text-violet-400" />
        {tUi('style_du_film')}
        <Info2
          libelle={tUi('ce_que_change_un_style')}
          texte={tUi('un_style_regle_la_lumiere_la_palette_l')}
        />
      </div>
      <div role="radiogroup" aria-label={tUi('style_cinematique_du_film')} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {STYLES_CINEMA.map((s) => {
          const choisi = valeur === s.id;
          const montre = exempleVu === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={choisi}
              aria-label={`${s.libelle}${choisi ? ' (choisi, cliquer pour retirer)' : ''}`}
              title={tUi('resume_l_exemple_s_affiche_dans_l_aper', { resume: s.resume })}
              onClick={() => { surMontrerExemple?.(s.id); surChoisir(choisi ? null : s.id); }}
              className={`overflow-hidden rounded-lg border text-left transition-colors ${choisi
                ? 'border-violet-500/80 ring-2 ring-violet-500/40 bg-violet-500/10'
                : montre ? 'border-violet-500/40' : 'border-slate-800 bg-slate-900/40 hover:border-violet-500/40'}`}
            >
              <span className="relative block overflow-hidden bg-slate-950" style={{ aspectRatio: ratioCadre('16:9') }}>
                {/* Photogramme de l'extrait : une image fixe du depot, jamais un rendu genere. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={EXTRAITS_STYLES[s.id].poster} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(5,6,10,0) 0%, rgba(5,6,10,0.8) 100%)' }} />
                <span className="absolute bottom-1 left-2 right-2 block truncate text-[11px] font-semibold text-white">{tUi.fr(s.libelle)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-[11px] text-slate-500">
        {actif ? <><span className="text-slate-300">{actif.libelle}</span> — {actif.resume}</> : tUi('aucun_style_impose_le_plan_est_genere')}
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
    </div>
  );
}

/** Exception de style pour UNE scene : discrete, un seul champ. */
export function SelecteurStyleScene({ valeur, styleFilm, surChoisir }: {
  valeur: IdStyleCinema | null; styleFilm: IdStyleCinema | null; surChoisir: (id: IdStyleCinema | null) => void;
}) {
  const tUi = useTranslations('ui.componentsCinemaDirectionCinema');
  const parDefaut = styleCinema(styleFilm);
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-400" data-direction="style-scene">
      <Palette className={`w-3.5 h-3.5 ${valeur ? 'text-violet-300' : 'text-slate-500'}`} aria-hidden="true" />
      <span className="sr-only">{tUi('style_de_cette_scene')}</span>
      <select
        value={valeur ?? ''}
        onChange={(e) => surChoisir((e.target.value || null) as IdStyleCinema | null)}
        aria-label={tUi('style_de_cette_scene')}
        className={`rounded bg-slate-950 border px-2 py-1 ${valeur ? 'border-violet-500/50 text-violet-200' : 'border-slate-700'}`}
      >
        <option value="">{parDefaut ? tUi('style_du_film_libelle', { libelle: parDefaut.libelle }) : tUi('style_du_film_aucun')}</option>
        {STYLES_CINEMA.map((s) => <option key={s.id} value={s.id}>{tUi.fr(s.libelle)}</option>)}
      </select>
    </label>
  );
}

/**
 * Exception artistique : une scene au style DIFFERENT de celui du film. Le style du film se
 * choisit une fois, a l'etape Histoire, et toutes les scenes l'heritent ; ceci est reserve aux
 * options avancees, et rien n'est applique sans validation explicite (choisir ne suffit pas).
 */
export function ExceptionStyleScene({ valeur, styleFilm, surValider }: {
  valeur: IdStyleCinema | null; styleFilm: IdStyleCinema | null; surValider: (id: IdStyleCinema | null) => void;
}) {
  const tUi = useTranslations('ui.componentsCinemaDirectionCinema');
  const [choix, setChoix] = useState<IdStyleCinema | null>(valeur);
  const hereditaire = styleCinema(styleFilm);
  const change = choix !== valeur;
  return (
    <div className="space-y-1.5" data-direction="exception-style">
      <p className="text-[11px] text-slate-400">
        {tUi('cette_scene_suit_le_style_du_film')}{hereditaire ? ` (${hereditaire.libelle})` : ''}{tUi('une_exception_reste_un_choix_artistiqu')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SelecteurStyleScene valeur={choix} styleFilm={styleFilm} surChoisir={setChoix} />
        <button
          type="button"
          onClick={() => surValider(choix)}
          disabled={!change}
          aria-label={tUi('valider_l_exception_de_style_pour_cett')}
          title={tUi('valider_l_exception_de_style_pour_cett')}
          className="inline-flex items-center gap-1 rounded-lg border border-violet-500/50 px-2 py-1 text-xs text-violet-200 transition-colors hover:bg-violet-500/10 disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> {tUi('valider')}
        </button>
      </div>
    </div>
  );
}

/** Mouvement de camera d'UN plan. `automatique` : le mouvement que l'automatique choisirait. */
export function SelecteurCamera({ valeur, automatique, ancien = false, surChoisir }: {
  valeur: IdCameraCinema; automatique: Exclude<IdCameraCinema, 'auto'>; ancien?: boolean; surChoisir: (id: IdCameraCinema) => void;
}) {
  const tUi = useTranslations('ui.componentsCinemaDirectionCinema');
  const Icone = ICONES_CAMERA[valeur];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400" data-direction="camera">
      <Icone className={`w-3.5 h-3.5 ${valeur === 'auto' ? 'text-slate-500' : 'text-violet-300'}`} aria-hidden="true" />
      <select
        value={valeur}
        onChange={(e) => surChoisir(e.target.value as IdCameraCinema)}
        aria-label={tUi('mouvement_de_camera_de_ce_plan')}
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
        libelle={tUi('a_propos_du_mouvement_de_camera')}
        texte="Indication donnee au modele video : il l’interprete et peut s’en ecarter. Elle s’applique a la prochaine animation par IA de ce plan ; l’image du plan reste fixe."
      />
    </span>
  );
}

/** Une ligne d'etat : le style du film et les scenes qui y font exception. */
export function ResumeStyle({ styleFilm, exceptions }: { styleFilm: IdStyleCinema | null; exceptions: number }) {
  const tUi = useTranslations('ui.componentsCinemaDirectionCinema');
  const s = styleCinema(styleFilm);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400" data-direction="resume">
      <Palette className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
      {tUi('style_du_film_2')} <span className="text-slate-200">{s ? s.libelle : tUi('aucun_impose')}</span>
      {exceptions > 0 && <span>· {exceptions} scene{exceptions > 1 ? 's' : ''} {tUi('avec_un_style_different')}</span>}
      <span className="inline-flex items-center gap-1 text-slate-500">
        <AlertCircle className="w-3 h-3" aria-hidden="true" /> {tUi('s_applique_aux_prochaines_generations')}
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
  const tUi = useTranslations('ui.componentsCinemaDirectionCinema');
  return (
    <span
      data-direction="a-regenerer"
      title="Ce media a ete genere avec un autre style ou une autre camera. Il est conserve ; regenerez ce plan pour appliquer la direction actuelle (devis a valider)."
      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200"
    >
      <RefreshCw className="w-3 h-3" aria-hidden="true" />
      {genre === 'video' ? 'Video' : tUi('image')} a regenerer : direction modifiee
    </span>
  );
}
