'use client';

/**
 * CINEMA IA — DEMONSTRATION GRATUITE, SANS SCENARIO.
 *
 * Permet de voir tout de suite ce qu'un montage Cinema IA peut montrer, avant d'avoir ecrit
 * ou compose quoi que ce soit : les 4 clips d'exemple locaux (`public/cinema-demo/`, FFmpeg),
 * un par mouvement de camera. Ce ne sont PAS des videos generees par une IA, et ce composant
 * le dit. Aucun appel serveur, aucun credit : il ne fait que lire des fichiers statiques.
 */
import { useState } from 'react';
import { Play, X, Film } from 'lucide-react';
import { ratioCadre } from '@/lib/ui/lecteur-generation';
import { CLIPS_DEMO } from '@/components/cinema/ApercuStoryboard';

/** Un libelle par clip : le mouvement de camera qu'il montre (meme ordre que `CLIPS_DEMO`). */
export const LIBELLES_DEMO: ReadonlyArray<string> = ['Travelling avant', 'Panoramique', 'Suivi latéral', 'Orbite'];

export default function DemoGratuite({ surQuitter }: { surQuitter: () => void }) {
  const [i, setI] = useState(0);
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-demo="gratuite">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Play className="w-4 h-4 text-violet-400" /> 6. Démonstration
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">Démonstration</span>
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        Quatre clips d’exemple (un par mouvement de caméra). Ce ne sont pas des vidéos générées par l’IA, et rien n’est débité.
      </p>

      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
        style={{ maxWidth: 640, aspectRatio: ratioCadre('16:9') }}
      >
        <video
          key={CLIPS_DEMO[i]}
          src={CLIPS_DEMO[i]}
          className="absolute inset-0 h-full w-full"
          style={{ objectFit: 'cover' }}
          controls muted loop playsInline autoPlay
          aria-label={`Clip de démonstration : ${LIBELLES_DEMO[i]}`}
        />
        <span className="pointer-events-none absolute left-3 top-3 rounded bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
          Démonstration · {LIBELLES_DEMO[i]}
        </span>
      </div>

      <div role="group" aria-label="Clips de démonstration" className="mt-3 flex flex-wrap gap-2">
        {CLIPS_DEMO.map((url, k) => (
          <button
            key={url}
            type="button"
            onClick={() => setI(k)}
            aria-pressed={i === k}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${i === k ? 'border-violet-500/70 bg-violet-500/10 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500/50'}`}
          >
            <Film className="w-3.5 h-3.5" aria-hidden="true" /> {LIBELLES_DEMO[k]}
          </button>
        ))}
        <button
          type="button"
          onClick={surQuitter}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" /> Quitter la démonstration
        </button>
      </div>
    </section>
  );
}
