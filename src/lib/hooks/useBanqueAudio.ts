'use client';

/**
 * A_5b — LA BANQUE AUDIO DU COMPTE, CÔTÉ ÉCRAN.
 *
 * ⚠️ ELLE NE PART PAS AU CHARGEMENT DE LA PAGE. La liste est demandée quand
 * le panneau audio s'ouvre — pas avant. Une personne qui ne touche jamais à
 * la musique ne doit pas payer une requête pour elle.
 *
 * ⚠️ ET AUCUN FICHIER N'EST TÉLÉCHARGÉ ICI. Ce qui revient, ce sont des
 * fiches : un nom, une durée, une forme d'onde de soixante-quatre octets. Les
 * octets audio, eux, ne descendent que sur un clic « écouter ».
 */
import { useCallback, useEffect, useState } from 'react';
import type { PisteAudio } from '@/lib/creatif/audio';

const ADRESSE = '/api/autopilot/banque-audio';

export interface BanqueAudioEtat {
  pistes: readonly PisteAudio[];
  chargee: boolean;
  erreur: string | null;
  /** La clé en cours d'analyse, s'il y en a une. */
  enAnalyse: string | null;
  ajouter: (cle: string, nom: string) => Promise<boolean>;
  moods: (cle: string, moods: readonly string[]) => void;
  renommer: (cle: string, nom: string) => void;
  retirer: (cle: string) => void;
  recharger: () => void;
}

export function useBanqueAudio(actif = true): BanqueAudioEtat {
  const [pistes, setPistes] = useState<readonly PisteAudio[]>([]);
  const [chargee, setChargee] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enAnalyse, setEnAnalyse] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch(ADRESSE, { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.pistes)) setPistes(j.pistes as PisteAudio[]);
    } catch {
      /* Sans réseau, le panneau marche : il n'a simplement aucune musique à
         proposer. Ce n'est pas une panne à annoncer. */
    } finally {
      setChargee(true);
    }
  }, []);

  useEffect(() => { if (actif) void charger(); }, [actif, charger]);

  const modifier = useCallback(async (corps: Record<string, unknown>) => {
    const avant = pistes;
    try {
      const r = await fetch(ADRESSE, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(corps),
      });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.pistes)) { setPistes(j.pistes as PisteAudio[]); return; }
      setPistes(avant);
      setErreur(typeof j?.error === 'string' ? j.error : 'Modification impossible.');
    } catch {
      setPistes(avant);
      setErreur('Modification impossible. Réessaie.');
    }
  }, [pistes]);

  /**
   * ⚠️ L'ANALYSE PREND QUELQUES INSTANTS, ET ON LE DIT.
   *
   * Sonder le fichier, mesurer son blanc et dessiner son onde demande une
   * seconde ou deux. Sans `enAnalyse`, le clic ne produirait rien de visible
   * et la personne recliquerait — d'où la garde d'idempotence, qui refuse un
   * second ajout de la MÊME clé pendant que le premier travaille.
   */
  const ajouter = useCallback(async (cle: string, nom: string) => {
    if (enAnalyse !== null) return false;
    setErreur(null);
    setEnAnalyse(cle);
    try {
      const r = await fetch(ADRESSE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cle, nom, droitsConfirmes: true }),
      });
      const j = await r.json();
      if (j?.ok && j.piste) {
        // Le remplacement en place évite le doublon : une clé, une fiche.
        setPistes((p) => (p.some((x) => x.cle === cle)
          ? p.map((x) => (x.cle === cle ? j.piste as PisteAudio : x))
          : [...p, j.piste as PisteAudio]));
        return true;
      }
      setErreur(typeof j?.error === 'string'
        ? j.error : 'Cette musique n’a pas pu être ajoutée.');
      return false;
    } catch {
      setErreur('Cette musique n’a pas pu être ajoutée. Réessaie.');
      return false;
    } finally {
      setEnAnalyse(null);
    }
  }, [enAnalyse]);

  return {
    pistes,
    chargee,
    erreur,
    enAnalyse,
    ajouter,
    moods: (cle, m) => {
      setErreur(null);
      setPistes((p) => p.map((x) => (x.cle === cle ? { ...x, moods: m as never } : x)));
      void modifier({ cle, moods: m });
    },
    // ⚠️ OPTIMISTE, AVEC RETOUR EN ARRIÈRE — la même règle que les favoris.
    renommer: (cle, nom) => {
      setErreur(null);
      setPistes((p) => p.map((x) => (x.cle === cle ? { ...x, nom } : x)));
      void modifier({ cle, nom });
    },
    retirer: (cle) => {
      setErreur(null);
      setPistes((p) => p.filter((x) => x.cle !== cle));
      void modifier({ cle, retirer: true });
    },
    recharger: () => { void charger(); },
  };
}
