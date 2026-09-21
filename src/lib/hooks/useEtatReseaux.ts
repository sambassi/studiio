'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deriverTousLesReseaux,
  type EntreeZernio,
  type EtatDerive,
  type Reseau,
  type StatutDirect,
} from '@/lib/social/etatReseaux';

/**
 * Une seule lecture de l'état des réseaux, partagée par l'écran « Réseaux
 * sociaux » et le Calendrier IA. Les deux sources sont lues, la dérivation
 * est pure (`etatReseaux.ts`). L'indisponibilité de l'une ne casse pas l'autre :
 * sans réponse, on garde « sans information » — jamais un faux « connecté ».
 */
export interface EtatReseauxCharge {
  chargement: boolean;
  reseaux: Record<Reseau, EtatDerive> | null;
  /** Droit Zernio, pour les messages « activez l'option » / « coupé ». */
  zernio: EntreeZernio | null;
  /** Canaux hors réseaux (email, whatsapp…) — inchangé, pour le Calendrier. */
  canaux: Record<string, boolean>;
  /**
   * Les statuts DIRECTS bruts (`/api/social/status` → `platforms`), pour les
   * badges « bientôt » / « OAuth non configuré » de l'écran Réseaux : la même
   * lecture que la dérivation, jamais une seconde requête.
   */
  plateformes: Record<string, StatutDirect> | null;
  recharger: () => void;
}

/**
 * @param actif — `false` suspend la lecture : rien n'est appelé tant que
 * l'écran n'a pas besoin de l'état des réseaux (l'étape « Envoi » de
 * l'Assistant, par exemple, alors que le wizard est monté dès « Sujet »).
 * `true` par défaut : l'écran Réseaux et le Calendrier lisent au montage,
 * comme avant. Repasse à `true` → la lecture part alors.
 */
export function useEtatReseaux(actif: boolean = true): EtatReseauxCharge {
  const [chargement, setChargement] = useState(true);
  const [reseaux, setReseaux] = useState<Record<Reseau, EtatDerive> | null>(null);
  const [zernio, setZernio] = useState<EntreeZernio | null>(null);
  const [canaux, setCanaux] = useState<Record<string, boolean>>({});
  const [plateformes, setPlateformes] = useState<Record<string, StatutDirect> | null>(null);
  const [tick, setTick] = useState(0);

  const recharger = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!actif) return undefined;
    let vivant = true;
    (async () => {
      let direct: Record<string, StatutDirect> | undefined;
      let z: EntreeZernio | undefined;
      try {
        const r = await fetch('/api/social/status');
        const d = r.ok ? await r.json() : null;
        if (d?.success && d.platforms) {
          direct = d.platforms;
          if (d.channels) {
            const map: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(d.channels as Record<string, { available?: boolean }>)) {
              map[k] = !!v?.available;
            }
            if (vivant) setCanaux(map);
          }
        }
      } catch { /* sans information : la dérivation reste prudente */ }
      try {
        const r = await fetch('/api/social/zernio/accounts');
        const d = r.ok ? await r.json() : null;
        if (d?.success) {
          z = { autorise: !!d.autorise, raison: d.raison ?? null, comptes: Array.isArray(d.comptes) ? d.comptes : [] };
        }
      } catch { /* idem */ }
      if (!vivant) return;
      setZernio(z ?? null);
      setPlateformes(direct ?? null);
      setReseaux(deriverTousLesReseaux(direct, z));
      setChargement(false);
    })();
    return () => { vivant = false; };
  }, [tick, actif]);

  return { chargement, reseaux, zernio, canaux, plateformes, recharger };
}
