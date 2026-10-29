'use client';

/**
 * CINEMA IA — LES QUATRE MOUVEMENTS DE CAMERA, sous l'apercu.
 *
 * Quatre petites vignettes : un clic montre le plan filme correspondant dans l'APERCU
 * PRINCIPAL (jamais dans un second lecteur). Rien n'est choisi pour le film : ce bloc
 * explique un vocabulaire, il ne regle pas le projet — le mouvement d'un plan se choisit
 * plan par plan, a l'etape Scenes. Aucun appel, aucun credit.
 */
import { Video } from 'lucide-react';
import { MENTION_MOUVEMENTS, MOUVEMENTS_CAMERA } from '@/lib/cinema/mouvements-camera';
import { ratioCadre } from '@/lib/ui/lecteur-generation';

export default function ChoixMouvements({ actif, surChoisir }: {
  actif: string | null;
  surChoisir: (camera: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4" data-bloc="mouvements">
      <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Video className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" /> Mouvements de caméra
      </h3>
      <p className="mb-2 text-[11px] text-slate-500">
        Quatre plans filmés, un par mouvement : ils s’affichent dans l’aperçu ci-dessus.
      </p>
      <div role="group" aria-label="Mouvements de caméra" className="grid grid-cols-2 gap-2">
        {MOUVEMENTS_CAMERA.map((m) => (
          <button
            key={m.camera}
            type="button"
            onClick={() => surChoisir(m.camera)}
            aria-pressed={actif === m.camera}
            title={m.quoiRegarder}
            className={`overflow-hidden rounded-lg border text-left transition-colors ${
              actif === m.camera ? 'border-violet-500/80 ring-1 ring-violet-500/40' : 'border-slate-800 hover:border-violet-500/40'
            }`}
          >
            <span className="relative block overflow-hidden bg-slate-950" style={{ aspectRatio: ratioCadre('16:9') }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.poster} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(5,6,10,0) 0%, rgba(5,6,10,0.85) 100%)' }} />
              <span className="absolute bottom-1 left-2 right-2 block truncate text-[11px] font-semibold text-white">{m.libelle}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">{MENTION_MOUVEMENTS}</p>
    </section>
  );
}
