'use client';

import { useEffect, useState } from 'react';
import { obtenirVignette, vignetteEnMemoire, type VignetteVideo } from '@/lib/medias/vignette-video';

export type EtatVignetteVideo =
  | { etat: 'inactif' }
  | { etat: 'chargement' }
  | { etat: 'pret'; vignette: VignetteVideo }
  | { etat: 'echec' };

/**
 * La miniature d'une vidéo (`vignette-video.ts`) : cache mémoire, puis
 * IndexedDB, puis extraction (deux à la fois). `url` absente → `inactif`.
 *
 * Synchrone quand la vignette est déjà en mémoire : la liste ne clignote pas
 * en revenant sur un écran.
 */
export function useVignetteVideo(url: string | null | undefined): EtatVignetteVideo {
  const initial = (): EtatVignetteVideo => {
    if (!url) return { etat: 'inactif' };
    const m = vignetteEnMemoire(url);
    if (m) return { etat: 'pret', vignette: m };
    if (m === null) return { etat: 'echec' };
    return { etat: 'chargement' };
  };
  const [etat, setEtat] = useState<EtatVignetteVideo>(initial);

  useEffect(() => {
    if (!url) { setEtat({ etat: 'inactif' }); return; }
    const m = vignetteEnMemoire(url);
    if (m) { setEtat({ etat: 'pret', vignette: m }); return; }
    if (m === null) { setEtat({ etat: 'echec' }); return; }
    let vivant = true;
    setEtat({ etat: 'chargement' });
    void obtenirVignette(url).then((v) => {
      if (!vivant) return;
      setEtat(v ? { etat: 'pret', vignette: v } : { etat: 'echec' });
    });
    return () => { vivant = false; };
  }, [url]);

  return etat;
}
