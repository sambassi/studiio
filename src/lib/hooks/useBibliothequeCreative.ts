'use client';

/**
 * A_3e1 — LES FAVORIS, VRAIMENT ENREGISTRÉS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE CŒUR RÉPOND TOUT DE SUITE, LA BASE SUIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Attendre la réponse du serveur pour noircir un cœur rendrait chaque clic
 * hésitant. L'état local change donc immédiatement — et si l'écriture échoue,
 * il REVIENT EN ARRIÈRE, avec un message. Un cœur qui reste noir sur un
 * favori qui n'a pas été enregistré est pire que pas de favori du tout : la
 * personne le retrouvera éteint au prochain chargement, sans comprendre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ON N'ÉCRIT QU'AU CLIC
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni au survol, ni au rendu, ni au changement de rayon. Une grille de
 * vingt-neuf cartes survolée en cherchant produirait autant d'écritures.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  BIBLIOTHEQUE_VIDE, FAVORIS_VIDES, basculerFavori,
  type BibliothequeCreative, type FavorisCreatifs, type FamilleBibliotheque,
} from '@/lib/creatif/bibliotheque';

export interface BibliothequeCreativeEtat {
  bibliotheque: BibliothequeCreative;
  recents: FavorisCreatifs;
  chargee: boolean;
  erreur: string | null;
  basculer: (famille: FamilleBibliotheque, id: string) => void;
  /** Remplace la bibliothèque entière — les presets s'en serviront. */
  remplacer: (suivante: BibliothequeCreative) => Promise<boolean>;
}

const ADRESSE = '/api/autopilot/bibliotheque-creative';

export function useBibliothequeCreative(): BibliothequeCreativeEtat {
  const [bibliotheque, setBibliotheque] = useState<BibliothequeCreative>(BIBLIOTHEQUE_VIDE);
  const [recents, setRecents] = useState<FavorisCreatifs>(FAVORIS_VIDES);
  const [chargee, setChargee] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const r = await fetch(ADRESSE, { credentials: 'same-origin' });
        const j = await r.json();
        if (!vivant || !j?.ok) return;
        if (j.bibliotheque) setBibliotheque(j.bibliotheque as BibliothequeCreative);
        if (j.recents) setRecents(j.recents as FavorisCreatifs);
      } catch {
        /* Sans réseau, la grille marche : elle n'a simplement ni favori ni
           récent. Ce n'est pas une panne à annoncer. */
      } finally {
        if (vivant) setChargee(true);
      }
    })();
    return () => { vivant = false; };
  }, []);

  const ecrire = useCallback(async (suivante: BibliothequeCreative): Promise<boolean> => {
    try {
      const r = await fetch(ADRESSE, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bibliotheque: suivante }),
      });
      const j = await r.json();
      return Boolean(j?.ok);
    } catch {
      return false;
    }
  }, []);

  const basculer = useCallback((famille: FamilleBibliotheque, id: string) => {
    setErreur(null);
    setBibliotheque((avant) => {
      const suivante: BibliothequeCreative = {
        ...avant, favoris: basculerFavori(avant.favoris, famille, id),
      };
      // ⚠️ LE RETOUR EN ARRIÈRE PORTE SUR `avant`, capturé ici. Relire l'état
      // dans le `catch` rendrait la valeur d'APRÈS un autre clic entre-temps.
      void ecrire(suivante).then((ok) => {
        if (!ok) {
          setBibliotheque(avant);
          setErreur('Ce favori n’a pas pu être enregistré. Réessaie.');
        }
      });
      return suivante;
    });
  }, [ecrire]);

  const remplacer = useCallback(async (suivante: BibliothequeCreative) => {
    const avant = bibliotheque;
    setBibliotheque(suivante);
    const ok = await ecrire(suivante);
    if (!ok) { setBibliotheque(avant); setErreur('Enregistrement impossible. Réessaie.'); }
    return ok;
  }, [bibliotheque, ecrire]);

  return { bibliotheque, recents, chargee, erreur, basculer, remplacer };
}
