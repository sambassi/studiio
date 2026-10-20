'use client';

/**
 * « Génération en cours » — la production Autopilote vue depuis le Calendrier.
 *
 * ⚠️ AUCUN POST N'EST CRÉÉ NI SIMULÉ ICI. Le brouillon n'existe qu'une fois le
 * MP4 final rendu, envoyé et relu : avant, le Calendrier était vide et la
 * personne croyait la production perdue (ou la relançait). Cette carte relit
 * la MÊME source que le panneau Autopilote
 * (`GET /api/autopilot/produire-maintenant/progression`) et disparaît dès que
 * rien n'est plus en cours — le Calendrier est alors relu (`onTerminee`).
 *
 * Pourcentage : seulement s'il est MESURÉ (composition). Ailleurs, des étapes
 * et une durée indicative, jamais un chiffre inventé.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ProgressStatus from '@/components/ux/ProgressStatus';
import { generationEnCoursDepuisLecture, type GenerationEnCours } from '@/lib/autopilot/progression';
import { lireProductionSuivie, parametresSuivi } from '@/lib/autopilot/etat-production-manuelle';

/** Relecture pendant une production (le panneau relit toutes les 2 s ; ici, moins souvent). */
export const DELAI_RELECTURE_GENERATION_MS = 5000;

export default function BandeauGenerationEnCours({
  onTerminee, fetcher,
}: {
  /** Appelé quand une production suivie se termine : le Calendrier relit ses posts. */
  onTerminee?: () => void;
  /** Injectable pour les tests. */
  fetcher?: typeof fetch;
}) {
  const [generation, setGeneration] = useState<GenerationEnCours | null>(null);
  const enCoursRef = useRef(false);
  const onTermineeRef = useRef(onTerminee);
  onTermineeRef.current = onTerminee;

  const lire = useCallback(async (): Promise<boolean> => {
    try {
      const f = fetcher ?? fetch;
      const r = await f(`/api/autopilot/produire-maintenant/progression${parametresSuivi(lireProductionSuivie())}`, { cache: 'no-store' });
      const g = generationEnCoursDepuisLecture(await r.json());
      setGeneration(g);
      const etait = enCoursRef.current;
      enCoursRef.current = !!g;
      if (etait && !g) onTermineeRef.current?.();
      return !!g;
    } catch {
      // Réseau : on garde la dernière lecture, on réessaiera.
      return enCoursRef.current;
    }
  }, [fetcher]);

  useEffect(() => {
    let vivant = true;
    let minuteur: ReturnType<typeof setTimeout> | null = null;
    const tour = async () => {
      const encore = await lire();
      if (!vivant) return;
      // On ne sonde QUE ce qui bouge : rien en cours → plus de relecture,
      // sauf au retour sur l'onglet.
      if (encore) minuteur = setTimeout(tour, DELAI_RELECTURE_GENERATION_MS);
    };
    void tour();
    const auRetour = () => {
      if (document.visibilityState === 'visible' && !enCoursRef.current) {
        if (minuteur) clearTimeout(minuteur);
        void tour();
      }
    };
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      vivant = false;
      if (minuteur) clearTimeout(minuteur);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [lire]);

  if (!generation) return null;
  return (
    <div className="px-4 sm:px-8 mb-4" data-calendrier-generation-en-cours data-generation-sorte={generation.sorte}>
      {generation.sorte === 'rendu' ? (
        <ProgressStatus
          titre="Génération en cours"
          statut="en_cours"
          etapes={generation.etapes}
          {...(generation.pourcentage !== undefined ? { pourcentage: generation.pourcentage } : {})}
          detail={generation.message}
          note="Autopilote — durée indicative : quelques minutes. Le brouillon apparaîtra dans le Calendrier une fois la vidéo finale vérifiée."
        />
      ) : (
        <ProgressStatus
          titre="Génération en cours"
          statut="en_cours"
          etapes={generation.etapes}
          description={generation.message}
          detail={generation.detail ?? undefined}
          {...(generation.depuis ? { debutLe: generation.depuis } : {})}
          note="Autopilote avec votre avatar — durée indicative : quelques minutes à une heure selon la file. Le brouillon apparaîtra dans le Calendrier une fois la vidéo finale montée et vérifiée."
        />
      )}
    </div>
  );
}
