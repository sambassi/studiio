'use client';

import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * L'EN-TÊTE de section de Studiio — Créer, Autopilote, Mon avatar : la même
 * carte d'identité (cahier UX, §3.1). Généralise `CreerEntete` : icône sur
 * dégradé, titre, sous-titre ; en plus, un statut éventuel (badge) et des
 * actions secondaires (retour, aide, …) à droite.
 */

export type NiveauStatut = 'neutre' | 'succes' | 'info' | 'avertissement' | 'erreur';

export interface EnteteSectionProps {
  titre: string;
  sousTitre?: string;
  /** L'icône (lucide) ; rendue sur le dégradé Studiio. */
  icone?: ReactNode;
  /** Un badge d'état court : « Prêt », « En préparation », « À valider ». */
  statut?: { libelle: string; niveau?: NiveauStatut };
  /** Retour vers l'écran précédent. */
  retour?: { libelle: string; onClick: () => void };
  /** Actions secondaires (liens, boutons discrets) alignées à droite. */
  actions?: ReactNode;
  /** Niveau de titre HTML (h1 par défaut). */
  niveauTitre?: 1 | 2;
  className?: string;
  'data-entete'?: string;
}

const BADGE: Record<NiveauStatut, string> = {
  neutre: 'bg-gray-800 text-gray-300 ring-gray-700',
  succes: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40',
  info: 'bg-sky-500/15 text-sky-200 ring-sky-500/40',
  avertissement: 'bg-amber-500/15 text-amber-200 ring-amber-500/40',
  erreur: 'bg-red-500/15 text-red-200 ring-red-500/40',
};

export default function EnteteSection({ titre, sousTitre, icone, statut, retour, actions, niveauTitre = 1, className = '', ...reste }: EnteteSectionProps) {
  const Titre = niveauTitre === 1 ? 'h1' : 'h2';
  return (
    <header
      data-entete={reste['data-entete'] ?? titre}
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${className}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        {icone && (
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)' }}
            aria-hidden
          >
            {icone}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Titre className={`${niveauTitre === 1 ? 'text-2xl' : 'text-lg'} font-bold text-white truncate`} data-entete-titre>{titre}</Titre>
            {statut && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${BADGE[statut.niveau ?? 'neutre']}`} data-entete-statut={statut.niveau ?? 'neutre'}>
                {statut.libelle}
              </span>
            )}
          </div>
          {sousTitre && <p className="text-sm text-gray-400" data-entete-sous-titre>{sousTitre}</p>}
        </div>
      </div>
      {(retour || actions) && (
        <div className="flex items-center gap-3 flex-shrink-0 self-start sm:self-auto" data-entete-actions>
          {actions}
          {retour && (
            <button type="button" onClick={retour.onClick} data-entete-retour className="button-secondary text-sm px-3 py-2 inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" aria-hidden /> {retour.libelle}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
