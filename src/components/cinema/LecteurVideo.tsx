'use client';

/**
 * CINEMA IA — LE LECTEUR VIDEO DE L'ECRAN : nos commandes, pas celles du navigateur.
 *
 * Pourquoi ne pas utiliser `controls` : la barre native de Chrome porte un menu « … » avec
 * « Telecharger » et « Enregistrer la video sous… ». Sur un ECRAN D'EXEMPLES, cela propose de
 * recuperer un fichier qui n'appartient pas a l'utilisateur ; sur l'apercu d'un film, cela
 * court-circuite l'etape Export. On rend donc des commandes SVG sobres : lecture/pause, son,
 * une barre fine, agrandir, fermer.
 *
 * ⚠️ CE N'EST PAS UNE PROTECTION CONTRE LA COPIE, et il ne faut pas le presenter comme telle :
 * `controlsList`, `disablePictureInPicture` et le menu contextuel desactive RETIRENT des
 * raccourcis de l'interface, rien de plus. L'URL du fichier reste lisible par qui regarde le
 * reseau. Le but est de ne pas PROPOSER le telechargement, pas de l'empecher.
 *
 * Le telechargement du film de l'utilisateur reste entier a l'etape Export : cet ecran ne
 * touche pas a cela.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react';

export interface LecteurVideoProps {
  src: string;
  poster?: string;
  /** Libelle pour les lecteurs d'ecran : ce que la video montre. */
  titre: string;
  /** Extrait muet (aucune piste son) : le bouton de son n'a alors rien a commander. */
  sansSon?: boolean;
  /** Lecture des l'affichage. Toujours en sourdine : un navigateur refuse l'autoplay sonore. */
  autoLecture?: boolean;
  boucle?: boolean;
  /** Affiche le bouton d'agrandissement (fenetre plein ecran de l'application). */
  agrandissable?: boolean;
  /** Rendu dans la fenetre agrandie : le bouton devient « Reduire ». */
  agrandi?: boolean;
  surAgrandir?: () => void;
  surReduire?: () => void;
  /** Coin haut droit : badge discret (« Exemple », « Démonstration »…). */
  badge?: string;
  className?: string;
}

export default function LecteurVideo({
  src, poster, titre, sansSon = false, autoLecture = false, boucle = true,
  agrandissable = false, agrandi = false, surAgrandir, surReduire, badge, className = '',
}: LecteurVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [joue, setJoue] = useState(false);
  const [muet, setMuet] = useState(true);
  const [avance, setAvance] = useState(0);

  const basculerLecture = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => { /* lecture refusee : l'affiche reste visible */ });
    else v.pause();
  }, []);

  // `controlsList` et `disablePictureInPicture` ne s'ecrivent pas en JSX : on les pose ici.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
    v.disablePictureInPicture = true;
  }, []);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 ${className}`} data-lecteur="svg">
      <video
        ref={ref}
        src={src}
        poster={poster}
        aria-label={titre}
        className="block h-full w-full"
        style={{ objectFit: 'cover' }}
        preload="none"
        playsInline
        muted={muet}
        loop={boucle}
        autoPlay={autoLecture}
        onContextMenu={(e) => e.preventDefault()}
        onPlay={() => setJoue(true)}
        onPause={() => setJoue(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setAvance(v.duration > 0 ? (v.currentTime / v.duration) * 100 : 0);
        }}
        onClick={basculerLecture}
      />

      {badge && (
        <span className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
          {badge}
        </span>
      )}

      {/* Au repos : une seule pastille de lecture au centre, rien d'autre sur l'image. */}
      {!joue && (
        <button
          type="button"
          onClick={basculerLecture}
          aria-label={`Lire : ${titre}`}
          className="absolute inset-0 flex items-center justify-center bg-slate-950/25 transition-colors hover:bg-slate-950/10"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-slate-950/60 text-white backdrop-blur-sm">
            <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />
          </span>
        </button>
      )}

      {/* Barre de commandes : fine, sombre, uniquement des icones SVG. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-slate-950/90 to-transparent px-2 pb-1.5 pt-6">
        <button
          type="button" onClick={basculerLecture}
          aria-label={joue ? 'Pause' : 'Lecture'} title={joue ? 'Pause' : 'Lecture'}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/90 hover:text-white"
        >
          {joue ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>

        {/* Barre de progression : un rail de 2 px, sans poignee. */}
        <span className="relative h-0.5 flex-1 overflow-hidden rounded bg-white/25" role="presentation">
          <span className="absolute inset-y-0 left-0 bg-violet-400" style={{ width: `${avance}%` }} />
        </span>

        {!sansSon && (
          <button
            type="button"
            onClick={() => { setMuet((m) => { const v = ref.current; if (v) v.muted = !m; return !m; }); }}
            aria-label={muet ? 'Activer le son' : 'Couper le son'} title={muet ? 'Activer le son' : 'Couper le son'}
            aria-pressed={!muet}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/90 hover:text-white"
          >
            {muet ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}

        {agrandissable && !agrandi && surAgrandir && (
          <button
            type="button" onClick={surAgrandir} aria-label="Agrandir" title="Agrandir"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/90 hover:text-white"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {agrandi && surReduire && (
          <button
            type="button" onClick={surReduire} aria-label="Reduire (Echap)" title="Reduire (Echap)"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/90 hover:text-white"
          >
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
