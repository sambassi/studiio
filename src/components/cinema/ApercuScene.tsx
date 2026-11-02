'use client';

/**
 * CINEMA IA — L'APERCU UNIQUE DE LA SCENE SELECTIONNEE.
 *
 * ⚠️ C'EST LE SEUL ENDROIT OU L'ON PREVISUALISE UN MEDIA D'UNE SCENE. Un clic sur une scene a
 * gauche change ce qu'il montre ; il n'y a ni second lecteur, ni grande carte media dans la
 * colonne : une scene a plusieurs plans ? Le meme cadre, une navigation discrete entre ses plans.
 *
 * Il dit la VERITE sur ce qu'il montre :
 *   - un fichier importe par l'utilisateur ;
 *   - une image/video du fournisseur SIMULE (local, gratuit) : un APLAT DE COULEUR qui encode
 *     l'identite d'un personnage, pas une image de film — il porte le badge « Simulation » ;
 *   - un media genere par un vrai fournisseur ;
 *   - rien : un etat neutre explicite, jamais une couleur unie presentee comme un extrait.
 *
 * Le cadre suit le VRAI format du media (largeur x hauteur), `object-fit: contain` : rien n'est
 * rogne ni etire, quel que soit le format du projet.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, Maximize2, Minimize2 } from 'lucide-react';
import LecteurVideo from '@/components/cinema/LecteurVideo';

export interface MediaScene {
  url: string; genre: 'image' | 'video'; largeur: number; hauteur: number;
  origine: string; fournisseurGeneration?: string; sonActif?: boolean;
}
export interface PlanScene { id: string; cadre: string; description: string; dialogue: { texte: string } | null; media: MediaScene | null }
export interface SceneAffichee { id: string; index: number; titre: string; plans: PlanScene[] }

/** D'ou vient ce media, en un mot honnete. */
export function provenanceMedia(m: MediaScene | null): { cle: 'aucun' | 'import' | 'simule' | 'genere'; libelle: string } {
  if (!m) return { cle: 'aucun', libelle: 'Aucun media' };
  if (m.origine !== 'genere') return { cle: 'import', libelle: 'Media importe' };
  if (m.fournisseurGeneration === 'simule') return { cle: 'simule', libelle: 'Simulation locale (aplat de couleur)' };
  return { cle: 'genere', libelle: 'Genere par IA' };
}

export const urlMediaPlan = (filmId: string, planId: string) => `/api/cinema/films/${filmId}/medias/${planId}`;

function FenetreMedia({ titre, children, surFermer }: { titre: string; children: React.ReactNode; surFermer: () => void }) {
  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') surFermer(); };
    document.addEventListener('keydown', touche);
    const avant = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', touche); document.body.style.overflow = avant; };
  }, [surFermer]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={titre}
      className="fixed inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/95 p-3 sm:p-6"
      style={{ zIndex: 60 }}
      onClick={(e) => { if (e.target === e.currentTarget) surFermer(); }}
    >
      {children}
      <button type="button" onClick={surFermer} aria-label="Reduire (Echap)" title="Reduire (Echap)"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:border-violet-500/60">
        <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> Echap
      </button>
    </div>,
    document.body,
  );
}

export default function ApercuScene({
  filmId, formatProjet, scene, planIndex, surPlan, agrandi, surAgrandir, surReduire,
}: {
  filmId: string;
  /** Le format du PROJET : il ne sert qu'au cadre vide, jamais a deformer un media. */
  formatProjet: string;
  scene: SceneAffichee;
  planIndex: number;
  surPlan: (i: number) => void;
  agrandi: boolean;
  surAgrandir: () => void;
  surReduire: () => void;
}) {
  const i = Math.min(Math.max(0, planIndex), Math.max(0, scene.plans.length - 1));
  const plan = scene.plans[i];
  const media = plan?.media ?? null;
  const prov = provenanceMedia(media);
  const src = media && plan ? urlMediaPlan(filmId, plan.id) : null;
  const ratioMedia = media && media.largeur > 0 && media.hauteur > 0 ? media.largeur / media.hauteur : formatProjet === '9:16' ? 9 / 16 : 16 / 9;
  const style = {
    aspectRatio: `${ratioMedia}`,
    width: `min(100%, calc(var(--hauteur-cadre, 300px) * ${ratioMedia}))`,
  } as React.CSSProperties;
  const badge = prov.cle === 'simule' ? 'Simulation' : undefined;
  const titre = `Scene ${scene.index + 1} · ${scene.titre}`;

  const lecteur = (grand: boolean) => (media && src ? (
    media.genre === 'video' ? (
      <LecteurVideo
        key={src} src={src} titre={`${titre}, plan ${i + 1}`} sansSon={media.sonActif === false} autoLecture boucle ajustement="contain" badge={badge}
        agrandissable={!grand} surAgrandir={surAgrandir} agrandi={grand} surReduire={surReduire}
        className="h-full w-full"
      />
    ) : (
      <div className="relative h-full w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${titre}, plan ${i + 1}`} className="block h-full w-full" style={{ objectFit: 'contain' }} onContextMenu={(e) => e.preventDefault()} draggable={false} />
        {badge && <span className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">{badge}</span>}
        {!grand && (
          <button type="button" onClick={surAgrandir} aria-label="Agrandir" title="Agrandir"
            className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded bg-slate-950/70 text-white/90 hover:text-white">
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  ) : null);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 lg:p-4" data-apercu="scene" data-scene-id={scene.id} data-plan-id={plan?.id}>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100 lg:text-base" title={titre}>
          <span className="tabular-nums text-violet-300">{String(scene.index + 1).padStart(2, '0')}</span> · {scene.titre}
        </h2>
        {scene.plans.length > 1 && (
          <div role="group" aria-label="Plans de la scene" className="flex shrink-0 items-center gap-1">
            {scene.plans.map((p, k) => (
              <button
                key={p.id} type="button" onClick={() => surPlan(k)}
                aria-pressed={k === i} aria-label={`Plan ${k + 1} sur ${scene.plans.length}`} title={`Plan ${k + 1}`}
                className={`h-6 min-w-6 rounded border px-1 text-[11px] tabular-nums transition-colors ${k === i ? 'border-violet-400 bg-violet-500/20 text-violet-100' : p.media ? 'border-slate-600 text-slate-300 hover:border-violet-500/50' : 'border-slate-800 text-slate-500 hover:border-slate-600'}`}
              >
                {k + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto" style={style} data-cadre-plan={prov.cle} data-ratio-media={ratioMedia.toFixed(3)}>
        {media && src ? lecteur(false) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-3 text-center" data-etat="sans-media">
            <ImageOff className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-300">Aucun media pour ce plan</p>
            <p className="line-clamp-2 text-[11px] text-slate-500">{plan?.dialogue?.texte ?? plan?.description}</p>
          </div>
        )}
      </div>

      <p className="mt-2 truncate text-[11px] text-slate-500" data-provenance={prov.cle}>
        Plan {i + 1}/{scene.plans.length} · {prov.libelle}
      </p>

      {agrandi && media && src && (
        <FenetreMedia titre={`${titre}, plan ${i + 1}`} surFermer={surReduire}>
          <div style={{ aspectRatio: `${ratioMedia}`, width: `min(100%, calc((100vh - 8rem) * ${ratioMedia}))` }} data-agrandi="media">
            {lecteur(true)}
          </div>
        </FenetreMedia>
      )}
    </section>
  );
}
