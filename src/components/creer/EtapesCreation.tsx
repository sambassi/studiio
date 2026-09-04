'use client';

import { Check, Loader2 } from 'lucide-react';

/**
 * LA PROGRESSION D'UNE CREATION — DES ETAPES REELLES, AUCUN POURCENTAGE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI PAS DE BARRE EN POURCENTS
 * ---------------------------------------------------------------------------
 *
 * Aucune des routes ne sait dire ou elle en est DANS son travail : elles
 * savent seulement LAQUELLE elles font. Un « 73 % » serait donc fabrique a
 * partir du nom de l'etape — une mesure sans mesure, qui avance quand rien
 * ne bouge et se fige quand tout va bien. Ce composant montre donc ce qui est
 * su : l'etape franchie, l'etape en cours, celles qui restent. L'attente a
 * l'interieur d'une etape est une animation INDETERMINEE, parce que c'est
 * exactement ce que le serveur nous laisse dire.
 *
 * ---------------------------------------------------------------------------
 * QUATRE ETAPES, ET ELLES VIENNENT DU CONTRAT
 * ---------------------------------------------------------------------------
 *
 * Le parcours reel compte sept jalons : `decoupage`, `montage`, `rendu` cote
 * chaine ; `source`, `encodage`, `mesure`, `televersement` cote moteur. Sept
 * lignes ne se lisent pas d'un coup d'oeil — elles sont donc REGROUPEES, sans
 * jamais en inventer une : chaque etape affichee correspond a des jalons qui
 * existent, et le tableau ci-dessous dit lesquels.
 */

export const ETAPES_CREATION = [
  { cle: 'decoupage', libelle: 'Découpage des passages' },
  { cle: 'montage', libelle: 'Préparation du montage' },
  { cle: 'encodage', libelle: 'Montage de la vidéo' },
  { cle: 'finalisation', libelle: 'Finalisation' },
] as const;

export type EtapeCreation = (typeof ETAPES_CREATION)[number]['cle'];

/**
 * Le jalon reel -> l'etape affichee.
 *
 * ⚠️ AUCUNE ENTREE INVENTEE. Les cles de gauche sont exactement celles de
 * `EtapeChaine` (chaine-passerelle) et de `ETAPES_RENDU` (rendu-contrat).
 */
const CORRESPONDANCE: Record<string, EtapeCreation> = {
  // La chaine, cote navigateur.
  decoupage: 'decoupage',
  montage: 'montage',
  rendu: 'encodage',
  // Le moteur, cote serveur.
  source: 'encodage',
  encodage: 'encodage',
  mesure: 'finalisation',
  televersement: 'finalisation',
};

export function etapeAffichee(jalon: string | null | undefined): EtapeCreation {
  return (jalon && CORRESPONDANCE[jalon]) || 'decoupage';
}

interface Props {
  /** Le jalon reel en cours, tel que la chaine ou le moteur l'annonce. */
  jalon: string | null;
  /** Le titre du bloc. Il dit ce qui se passe, pas une rubrique. */
  titre?: string;
}

export default function EtapesCreation({ jalon, titre = 'Création de votre vidéo' }: Props) {
  const active = etapeAffichee(jalon);
  const indice = ETAPES_CREATION.findIndex((e) => e.cle === active);

  return (
    <section className="space-y-2" data-etapes-creation data-etape-active={active}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] uppercase tracking-wide text-gray-500">{titre}</h4>
        {/* Un compte d'etapes, pas un pourcentage : il est exact. */}
        <span className="text-[11px] tabular-nums text-gray-400" data-etapes-compte>
          {indice + 1}/{ETAPES_CREATION.length}
        </span>
      </div>

      {/* La barre suit le nombre d'etapes FRANCHIES. Elle ne bouge donc que
          quand quelque chose s'est reellement passe. */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/10" data-etapes-barre>
        <div
          className="h-full rounded-full bg-purple-500 transition-[width] duration-500"
          style={{ width: `${((indice + 1) / ETAPES_CREATION.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-1" data-etapes-liste>
        {ETAPES_CREATION.map((e, i) => {
          const etat = i < indice ? 'faite' : i === indice ? 'encours' : 'attente';
          return (
            <li
              key={e.cle}
              data-etape={e.cle}
              data-etape-etat={etat}
              className={`flex items-center gap-2 text-[11px] ${
                etat === 'attente' ? 'text-gray-600' : 'text-gray-300'}`}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {etat === 'faite' && <Check className="h-3 w-3 text-gray-400" aria-hidden="true" />}
                {etat === 'encours' && (
                  <Loader2 className="h-3 w-3 animate-spin text-purple-400" aria-hidden="true" />
                )}
                {etat === 'attente' && (
                  <span className="h-1.5 w-1.5 rounded-full border border-gray-700" aria-hidden="true" />
                )}
              </span>
              {e.libelle}
              {etat === 'encours' && <span className="sr-only"> — en cours</span>}
              {etat === 'faite' && <span className="sr-only"> — terminé</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
