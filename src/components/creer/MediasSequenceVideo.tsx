'use client';

/**
 * « Médias de la séquence Vidéo » — Créer multi-sources, en manuel.
 *
 * La liste ORDONNÉE des médias que la séquence « Vidéo » enchaîne : rushes,
 * avatar, vidéos et photos suggérées, médiathèque. Chaque média est une carte
 * visuelle (vignette, durée, libellé en mots de l'utilisateur — jamais un nom
 * de fichier ni de fournisseur, gardés en infobulle) avec ses gestes :
 * aperçu, déplacer, remplacer, recadrer, supprimer. Le menu « Ajouter »
 * ouvre la bonne source.
 *
 * Composant de PRÉSENTATION : il ne lit ni n'écrit rien lui-même. Le wizard
 * possède l'état (`medias-video.ts`) et branche chaque geste.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Crop, Film, FolderOpen, Images, Loader2, Minus, Play, Plus, RefreshCw, Trash2, UserRound,
} from 'lucide-react';
import {
  bornesDuree, dureeEffective, formatSecondes, libelleMedia, titreMedia, type MediaVideo,
} from '@/lib/creer/medias-video';

export type EtatAvatarListe = 'pret' | 'absent' | 'chargement' | 'inconnu';

export interface MediasSequenceVideoProps {
  medias: ReadonlyArray<MediaVideo>;
  /** Un import / une sonde est en cours : les gestes attendent. */
  occupe?: boolean;
  /** Le média (par URL) a-t-il un recadrage actif ? */
  estRecadre?: (url: string) => boolean;
  /** Disponibilité de l'avatar du compte (lecture seule, aucun fournisseur). */
  etatAvatar: EtatAvatarListe;
  /** Vignette de l'avatar (source de sa version active), si elle existe. */
  vignetteAvatar?: { url: string; type: 'photo' | 'video' } | null;
  /** Média sélectionné pour l'aperçu (id). */
  selectionId?: string | null;
  /**
   * « Aperçu » : le wizard peut le montrer dans son panneau ; sans branchement
   * (`apercuInterne`), l'aperçu s'affiche sous la liste.
   */
  onApercu: (m: MediaVideo | null) => void;
  apercuInterne?: boolean;
  onDeplacer: (i: number, delta: number) => void;
  onRemplacer: (i: number) => void;
  onSupprimer: (i: number) => void;
  /**
   * Durée choisie du média `i` (s) — photo 1–30 s, vidéo raccourcie (jamais
   * au-delà de sa durée mesurée). Absent : aucun réglage de durée affiché.
   */
  onDuree?: (i: number, secondes: number) => void;
  onRecadrer: (m: MediaVideo) => void;
  onAjouterMonRush: () => void;
  onAjouterAvatar: () => void;
  onAjouterSuggere: () => void;
  onAjouterMediatheque: () => void;
  /** Le menu « Ajouter » s'ouvre (le wizard lit alors la disponibilité de l'avatar). */
  onOuvrirMenu?: () => void;
  /** Lien « Configurer mon avatar ». */
  lienAvatar?: string;
}

function Vignette({ m, vignetteAvatar }: { m: MediaVideo; vignetteAvatar?: MediasSequenceVideoProps['vignetteAvatar'] }) {
  const cadre = 'relative w-12 h-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10';
  if (m.source === 'avatar' && !m.url) {
    return (
      <div className={cadre} data-vignette="avatar">
        {vignetteAvatar?.type === 'photo' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vignetteAvatar.url} alt="" className="w-full h-full object-cover" />
        ) : vignetteAvatar?.type === 'video' ? (
          <video src={`${vignetteAvatar.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400"><UserRound className="w-5 h-5" /></div>
        )}
      </div>
    );
  }
  if (m.type === 'image' && m.url) {
    return (
      <div className={cadre} data-vignette="image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.url} alt="" className="w-full h-full object-cover" loading="lazy" />
      </div>
    );
  }
  return (
    <div className={cadre} data-vignette="video">
      {m.url ? (
        <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full bg-black/55 p-1"><Play className="w-3 h-3 text-white" /></span>
      </span>
    </div>
  );
}

/**
 * « Durée [−] 3 s [+] » d'une photo ou d'une vidéo (raccourcir seulement) ;
 * « Durée liée à la voix » pour l'avatar. La valeur est `dureeEffective` —
 * la même que la légende, la chronologie, l'aperçu et le rendu.
 */
function ReglageDuree({ m, i, occupe, onDuree }: { m: MediaVideo; i: number; occupe?: boolean; onDuree?: (i: number, s: number) => void }) {
  const b = bornesDuree(m);
  if (b.mode === 'voix') {
    return <span data-media-duree="voix" className="text-[10px] text-gray-500">Durée liée à la voix</span>;
  }
  if (!onDuree || (b.mode !== 'photo' && b.mode !== 'video')) return null;
  const d = dureeEffective(m);
  const nom = m.type === 'image' ? 'la photo' : 'la vidéo';
  const pas = 'flex items-center justify-center rounded-md w-6 h-6 text-gray-300 bg-gray-800 hover:bg-gray-700 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed transition';
  return (
    <span data-media-duree={b.mode} className="flex items-center gap-1 text-[10px] text-gray-400">
      <span>Durée</span>
      <button
        type="button" className={pas} data-duree-moins
        onClick={() => onDuree(i, d - b.pas)} disabled={occupe || d <= b.min}
        title={`Raccourcir ${nom}`} aria-label={`Raccourcir ${nom} ${i + 1}`}
      ><Minus className="w-3 h-3" /></button>
      <span data-duree-valeur className="min-w-[2.5rem] text-center text-[11px] font-medium text-gray-100 tabular-nums">{formatSecondes(d)} s</span>
      <button
        type="button" className={pas} data-duree-plus
        onClick={() => onDuree(i, d + b.pas)} disabled={occupe || d >= b.max}
        title={b.mode === 'video' ? `Allonger ${nom} (jusqu’à sa durée réelle)` : `Allonger ${nom}`}
        aria-label={`Allonger ${nom} ${i + 1}`}
      ><Plus className="w-3 h-3" /></button>
    </span>
  );
}

const bouton = 'flex items-center justify-center rounded-md w-7 h-7 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-25 disabled:cursor-not-allowed transition';

export default function MediasSequenceVideo(p: MediasSequenceVideoProps) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const fermer = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, [menu]);
  const selection = p.medias.find((m) => m.id === p.selectionId) ?? null;
  const n = p.medias.length;
  const choisir = (f: () => void) => () => { setMenu(false); f(); };

  return (
    <div data-medias-video className="mt-2 rounded-xl bg-gray-900/40 ring-1 ring-emerald-500/20 p-2 space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] text-gray-400">Médias de la séquence Vidéo{n > 1 ? ', joués dans cet ordre' : ''}</span>
        {p.occupe && <Loader2 className="w-3 h-3 animate-spin text-gray-500 flex-shrink-0" />}
      </div>
      {n === 0 && (
        <p className="px-1 text-[11px] text-gray-500">Aucun média : ajoutez un rush, votre avatar ou un média suggéré.</p>
      )}
      <ol className="space-y-1.5">
        {p.medias.map((m, i) => {
          const libelle = libelleMedia(m);
          const recadrable = m.source !== 'avatar' && !!m.url;
          const recadre = recadrable && !!p.estRecadre?.(m.url!);
          const choisi = m.id === p.selectionId;
          return (
            <li
              key={m.id}
              data-media-item={m.source}
              data-media-type={m.type}
              className={`flex flex-wrap items-center gap-2 rounded-lg px-1.5 py-1.5 min-w-0 ${choisi ? 'bg-studiio-primary/15 ring-1 ring-studiio-primary/50' : 'bg-gray-900/60'}`}
            >
              <span className="text-[10px] font-bold text-emerald-300 w-4 text-center flex-shrink-0">{i + 1}</span>
              <Vignette m={m} vignetteAvatar={p.vignetteAvatar} />
              <span className="min-w-0 flex-1 text-[11px] text-gray-200 leading-tight" title={titreMedia(m)} data-media-libelle>
                {/* Deux lignes au plus : « Mon avatar · produit à l'envoi » reste lisible à 390 px. */}
                <span className="block break-words" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{libelle}</span>
              </span>
              <span className="flex items-center gap-0.5 flex-shrink-0 ml-auto" data-media-actions>
                <button
                  type="button" className={bouton}
                  onClick={() => p.onApercu(choisi ? null : m)}
                  disabled={!m.url && !(m.source === 'avatar' && p.vignetteAvatar)}
                  title="Aperçu" aria-label={`Aperçu du média ${i + 1}`} aria-pressed={choisi}
                ><Play className="w-3.5 h-3.5" /></button>
                <button type="button" className={bouton} onClick={() => p.onDeplacer(i, -1)} disabled={i === 0 || p.occupe} title="Monter" aria-label={`Monter le média ${i + 1}`}>
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" className={bouton} onClick={() => p.onDeplacer(i, 1)} disabled={i === n - 1 || p.occupe} title="Descendre" aria-label={`Descendre le média ${i + 1}`}>
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button type="button" className={bouton} onClick={() => p.onRemplacer(i)} disabled={p.occupe || m.source === 'avatar'} title="Remplacer" aria-label={`Remplacer le média ${i + 1}`}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button" data-media-recadrer
                  className={`${bouton} ${recadre ? 'bg-studiio-primary/25 text-purple-100' : ''}`}
                  onClick={() => p.onRecadrer(m)} disabled={!recadrable || p.occupe}
                  title="Recadrer : le média remplit le format, l'export utilise ce cadrage." aria-label={`Recadrer le média ${i + 1}`}
                  data-recadre={recadre ? 'oui' : 'non'}
                ><Crop className="w-3.5 h-3.5" /></button>
                <button type="button" className={`${bouton} hover:text-red-400`} onClick={() => p.onSupprimer(i)} disabled={p.occupe} title="Supprimer" aria-label={`Supprimer le média ${i + 1}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
              {/* Durée : sur sa propre ligne, alignée sous le libellé (rien ne déborde à 390 px). */}
              {(m.source === 'avatar' || (p.onDuree && (m.type === 'image' || bornesDuree(m).mode === 'video'))) && (
                <span className="basis-full flex items-center min-w-0" style={{ paddingLeft: 72 }}>
                  <ReglageDuree m={m} i={i} occupe={p.occupe} onDuree={p.onDuree} />
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {p.apercuInterne !== false && selection && (selection.url || p.vignetteAvatar) && (
        <div data-media-apercu className="rounded-lg overflow-hidden bg-black ring-1 ring-white/10 mx-auto" style={{ maxWidth: 220 }}>
          {selection.source === 'avatar' && !selection.url ? (
            p.vignetteAvatar?.type === 'video'
              ? <video src={p.vignetteAvatar.url} muted playsInline autoPlay loop controls className="w-full" style={{ maxHeight: 320 }} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={p.vignetteAvatar!.url} alt="Mon avatar" className="w-full object-cover" style={{ maxHeight: 320 }} />
          ) : selection.type === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selection.url} alt={libelleMedia(selection)} className="w-full object-cover" style={{ maxHeight: 320 }} />
          ) : (
            <video key={selection.url} src={selection.url} muted playsInline autoPlay loop controls className="w-full" style={{ maxHeight: 320 }} />
          )}
          <p className="px-2 py-1 text-[10px] text-gray-400 truncate">{libelleMedia(selection)}</p>
        </div>
      )}

      <div className="relative" ref={menuRef}>
        <button
          type="button" data-medias-ajouter
          onClick={() => { const o = !menu; setMenu(o); if (o) p.onOuvrirMenu?.(); }}
          disabled={p.occupe}
          aria-expanded={menu}
          className="flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed px-1 py-0.5"
        >
          <Plus className="w-3 h-3" />
          Ajouter
        </button>
        {menu && (
          <div role="menu" data-medias-menu className="mt-1 w-full max-w-[260px] rounded-lg bg-gray-900 ring-1 ring-white/10 shadow-xl p-1 space-y-0.5">
            <button type="button" role="menuitem" onClick={choisir(p.onAjouterMonRush)} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-gray-200 hover:bg-gray-800 text-left">
              <Film className="w-3.5 h-3.5 text-emerald-300" /> Mon rush
            </button>
            {p.etatAvatar === 'pret' ? (
              <button type="button" role="menuitem" data-ajouter-avatar onClick={choisir(p.onAjouterAvatar)} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-gray-200 hover:bg-gray-800 text-left">
                <UserRound className="w-3.5 h-3.5 text-purple-300" /> Mon avatar
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-[12px]">
                <button type="button" role="menuitem" data-ajouter-avatar disabled className="flex items-center gap-2 text-gray-500 cursor-not-allowed">
                  {p.etatAvatar === 'chargement' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserRound className="w-3.5 h-3.5" />} Mon avatar
                </button>
                {p.etatAvatar !== 'chargement' && (
                  <a href={p.lienAvatar ?? '/dashboard/avatar'} className="text-[11px] text-purple-300 underline hover:text-purple-200">Configurer mon avatar</a>
                )}
              </div>
            )}
            <button type="button" role="menuitem" data-ouvrir-stock="rush" onClick={choisir(p.onAjouterSuggere)} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-gray-200 hover:bg-gray-800 text-left">
              <Images className="w-3.5 h-3.5 text-amber-300" /> Média suggéré
            </button>
            <button type="button" role="menuitem" onClick={choisir(p.onAjouterMediatheque)} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-gray-200 hover:bg-gray-800 text-left">
              <FolderOpen className="w-3.5 h-3.5 text-cyan-300" /> Ma médiathèque
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
