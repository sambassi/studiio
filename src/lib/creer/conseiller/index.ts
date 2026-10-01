/**
 * CONSEILLER ÉDITORIAL — « Conseils pour améliorer cette vidéo ».
 *
 * Assemble les conseils textes, lisibilité / placement et montage en UN
 * rapport, du plus important au moins important. Ne modifie RIEN : le
 * rapport est écrit dans les métadonnées du post et affiché tel quel.
 */
import type { RushSegment } from '@/lib/creer/multi-rush';
import type { AnalyseRush } from '@/lib/creer/smart-montage';
import type { Conseil, RapportConseils, SectionConseil } from '@/lib/creer/conseiller/types';
import { conseilsTextes, type TextesVideo } from '@/lib/creer/conseiller/textes';
import { conseilsMontage } from '@/lib/creer/conseiller/montage';
import { conseilsLisibilite, type ElementLisibilite } from '@/lib/creer/conseiller/lisibilite';

export type { Conseil, RapportConseils } from '@/lib/creer/conseiller/types';

const ORDRE_PRIORITE = { IMPORTANTE: 0, MOYENNE: 1, FAIBLE: 2 } as const;
export const ORDRE_SECTIONS: SectionConseil[] = ['Montage', 'Rushes', 'Rythme', 'Textes', 'CTA'];

export function conseillerVideo(input: {
  profil: string;
  textes: TextesVideo;
  plan?: ReadonlyArray<RushSegment> | null;
  analyses?: ReadonlyArray<AnalyseRush> | null;
  rythme?: { beats: number[]; forts: number[]; impacts?: Array<{ t: number; force: number }> } | null;
  /** Mesures du rendu hybride ; `null` = non mesurées (rendu complet). */
  lisibilite?: ReadonlyArray<ElementLisibilite> | null;
}): RapportConseils {
  const textes = conseilsTextes(input.textes);
  const lisibilite = input.lisibilite?.length ? conseilsLisibilite(input.lisibilite) : [];
  const montage = input.plan?.length && input.analyses?.length
    ? conseilsMontage({ profil: input.profil, plan: input.plan, analyses: input.analyses, rythme: input.rythme ?? null })
    : null;

  // Le placement MESURÉ complète le conseil texte du même élément.
  for (const c of textes) {
    if (c.placementRecommande) continue;
    const mesure = lisibilite.find((l) => l.cible === c.cible && l.placementRecommande);
    if (mesure) c.placementRecommande = mesure.placementRecommande;
  }

  const conseils: Conseil[] = [...textes, ...lisibilite, ...(montage?.conseils ?? [])]
    .sort((a, b) => ORDRE_PRIORITE[a.priorite] - ORDRE_PRIORITE[b.priorite]
      || ORDRE_SECTIONS.indexOf(a.section) - ORDRE_SECTIONS.indexOf(b.section));
  return {
    version: 1,
    profil: input.profil,
    conseils,
    couverture: {
      textes: true,
      lisibilite: !!input.lisibilite?.length,
      placement: !!input.lisibilite?.length,
      couleur: montage?.couleur ?? false,
      repetition: montage?.repetition ?? false,
      rythme: montage?.rythme ?? false,
      visages: false,
    },
    scoreDifferenceVisuelle: montage?.score ?? null,
  };
}

/** Relit un rapport écrit dans les métadonnées (tolérant). */
export function conseilsDepuisMetadata(v: unknown): RapportConseils | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<RapportConseils>;
  if (r.version !== 1 || !Array.isArray(r.conseils)) return null;
  return r as RapportConseils;
}
