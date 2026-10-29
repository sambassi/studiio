'use client';

/**
 * CINEMA IA — L'APERCU : ce qu'on VOIT, et ce qu'on ne voit PAS encore.
 *
 * Avant ce lot, le lecteur dessinait la « carte » du plan (degrade violet + titre de scene +
 * description) meme quand aucun media n'existait : on croyait regarder une video, on lisait
 * un texte. Ici :
 *   - un plan SANS media est un storyboard honnete (cadre sombre, « media manquant ») ;
 *   - un plan AVEC media montre le VRAI fichier, cale sur la chronologie du montage (lecture,
 *     pause, position), avec son son quand le plan le garde ;
 *   - un mode DEMONSTRATION remplace, A L'ECRAN SEULEMENT, les medias manquants par des clips
 *     d'exemple locaux : rien n'est enregistre, rien n'est genere, aucun cout.
 *
 * Aucune generation ni aucun appel reseau n'est declenche d'ici.
 */
import { useEffect, useRef } from 'react';
import { ImageOff, Film, Image as ImageIcon } from 'lucide-react';
import { ratioCadre } from '@/lib/ui/lecteur-generation';

/** Le strict necessaire d'un segment du montage pour l'afficher. */
export interface SegmentVue {
  sceneIndex: number; planId: string; cadre: string; titreScene: string;
  texte: string; locuteur: string | null; debutS: number; finS: number; dureeS: number;
  media: { url: string; genre: 'image' | 'video'; sonActif?: boolean } | null;
  /** Vrai quand le media affiche est un clip d'exemple (mode demonstration), pas celui du film. */
  demo?: boolean;
}

/** Clips d'exemple locaux (FFmpeg, `public/cinema-demo/`) : jamais des videos generees par une IA. */
export const CLIPS_DEMO: ReadonlyArray<string> = [1, 2, 3, 4].map((n) => `/cinema-demo/demo-${n}.mp4`);

export function urlMedia(url: string): string { return url.startsWith('/') ? url : `/${url}`; }

/** Le media du film, ou un clip d'exemple (mode demonstration) a sa place. */
export function appliquerDemo<T extends SegmentVue>(segments: readonly T[], demo: boolean): T[] {
  if (!demo) return [...segments];
  let n = 0;
  return segments.map((s) => (s.media ? s : { ...s, media: { url: CLIPS_DEMO[n++ % CLIPS_DEMO.length], genre: 'video' as const }, demo: true }));
}

export interface BilanMedias { total: number; avecMedia: number; manquants: number; aucun: boolean }
/** Compte sur les segments REELS du film (jamais ceux de la demonstration). */
export function bilanMedias(segments: ReadonlyArray<Pick<SegmentVue, 'media'>>): BilanMedias {
  const avecMedia = segments.filter((s) => s.media).length;
  return { total: segments.length, avecMedia, manquants: segments.length - avecMedia, aucun: segments.length > 0 && avecMedia === 0 };
}

/**
 * Le VRAI media du plan. Une image est posee telle quelle ; une video est CALEE sur la
 * chronologie : elle joue quand le montage joue, se met en pause avec lui, et suit la position
 * quand on la deplace. Son son n'est audible que si le plan le garde (`sonActif`) et que
 * l'utilisateur ne l'a pas coupe.
 */
export function MediaDuPlan({ segment, tempsS, joue, son }: { segment: SegmentVue; tempsS: number; joue: boolean; son: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const media = segment.media;
  const cible = Math.max(0, tempsS - segment.debutS);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !(joue && son && media?.sonActif);
    if (joue) {
      // Corrige une derive notable ; sinon la lecture native garde ses mouvements fluides.
      if (Number.isFinite(v.duration) && v.duration > 0) {
        const attendu = cible % v.duration;
        if (Math.abs(v.currentTime - attendu) > 0.6) v.currentTime = attendu;
      }
      v.play().catch(() => { /* lecture refusee par le navigateur : l'image reste affichee */ });
    } else {
      v.pause();
      if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = cible % v.duration;
    }
    // `cible` change a chaque trame pendant la lecture : on ne relance que sur ce qui compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joue, son, segment.planId, media?.url, joue ? 0 : Math.round(cible * 10)]);

  if (!media) return null;
  const style = { objectFit: 'cover' as const };
  return media.genre === 'image' ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={urlMedia(media.url)} alt="" className="absolute inset-0 h-full w-full" style={style} />
  ) : (
    <video
      key={`${segment.planId}-${media.url}`}
      ref={ref}
      src={urlMedia(media.url)}
      className="absolute inset-0 h-full w-full"
      style={style}
      muted playsInline loop preload="auto"
      onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.duration > 0) v.currentTime = cible % v.duration; }}
    />
  );
}

/** Un plan SANS media : un emplacement de storyboard, clairement vide. Rien n'imite une video. */
export function EmplacementVide({ segment, grand }: { segment: SegmentVue; grand: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center" style={{ background: '#0d0f16' }}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-slate-600 text-slate-500">
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className={`${grand ? 'text-sm' : 'text-xs'} font-medium text-slate-300`}>Média manquant</p>
      <p className="text-[11px] text-slate-500">Plan {segment.cadre} · importez une image ou une vidéo</p>
    </div>
  );
}

/** Le storyboard : un plan par vignette, cliquable pour s'y placer. */
export function Storyboard({ segments, courantId, portrait, surChoisir }: {
  segments: ReadonlyArray<SegmentVue>; courantId: string | undefined; portrait: boolean; surChoisir: (s: SegmentVue) => void;
}) {
  return (
    <ol aria-label="Storyboard du film" className="mt-4 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
      {segments.map((s, i) => {
        const actif = s.planId === courantId;
        return (
          <li key={s.planId} className="shrink-0" style={{ width: portrait ? 56 : 104 }}>
            <button
              type="button"
              onClick={() => surChoisir(s)}
              aria-label={`Plan ${i + 1}, scène ${s.sceneIndex + 1}${s.media ? (s.demo ? ', média d’exemple' : '') : ', média manquant'}`}
              aria-current={actif ? 'true' : undefined}
              className={`relative block w-full overflow-hidden rounded-md border transition-colors ${actif ? 'border-violet-500 ring-1 ring-violet-500/50' : 'border-slate-800 hover:border-slate-600'}`}
              style={{ aspectRatio: ratioCadre(portrait ? '9:16' : '16:9'), background: '#0d0f16' }}
            >
              {s.media ? (
                s.media.genre === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urlMedia(s.media.url)} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: 'cover' }} />
                ) : (
                  <video src={`${urlMedia(s.media.url)}#t=0.1`} className="absolute inset-0 h-full w-full" style={{ objectFit: 'cover' }} muted playsInline preload="metadata" />
                )
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-slate-600"><ImageOff className="h-4 w-4" aria-hidden="true" /></span>
              )}
              <span className="absolute left-1 top-1 rounded bg-slate-950/80 px-1 text-[9px] text-slate-300">{i + 1}</span>
              {s.demo && <span className="absolute bottom-1 left-1 rounded bg-amber-500/80 px-1 text-[8px] font-bold uppercase text-slate-950">démo</span>}
              {s.media && (
                <span className="absolute bottom-1 right-1 text-slate-200">
                  {s.media.genre === 'video' ? <Film className="h-3 w-3" aria-hidden="true" /> : <ImageIcon className="h-3 w-3" aria-hidden="true" />}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
