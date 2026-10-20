'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { demanderMp4Durable } from '@/lib/rendus/mp4-durable-client';

/**
 * Avis NON BLOQUANT : la conversion MP4 durable de ce montage a échoué, la
 * vidéo reste au format WebM. « Réessayer » relance `POST /api/posts/[id]/mp4`.
 * Rien n'est masqué ni empêché : le post reste lisible et modifiable.
 */
export default function AvisMp4Indisponible({ postId, onReussi }: { postId: string; onReussi?: () => void }) {
  const [etat, setEtat] = useState<'repos' | 'encours' | 'echec' | 'ok'>('repos');
  if (etat === 'ok') return null;
  const reessayer = async () => {
    setEtat('encours');
    // Un seul essai : l'utilisateur relance lui-même s'il le souhaite.
    const r = await demanderMp4Durable(postId, { essais: 1 });
    if (r.ok) { setEtat('ok'); onReussi?.(); } else setEtat('echec');
  };
  return (
    <div
      data-avis-mp4-indisponible
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-black/80 px-3 py-2 text-xs text-amber-200 backdrop-blur-sm"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        MP4 indisponible — la vidéo reste au format WebM.
        {etat === 'echec' && ' Nouvel essai sans succès.'}
      </span>
      <button
        type="button"
        onClick={() => { void reessayer(); }}
        disabled={etat === 'encours'}
        data-avis-mp4-reessayer
        className="ml-1 flex items-center gap-1 rounded-md border border-amber-400/50 px-2 py-0.5 text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
      >
        {etat === 'encours' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {etat === 'encours' ? 'Conversion…' : 'Réessayer'}
      </button>
    </div>
  );
}
