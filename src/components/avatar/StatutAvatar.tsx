'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, UserSquare2, ShieldCheck, Eye } from 'lucide-react';

/**
 * Le STATUT GLOBAL de l'avatar, dit en un mot, en tête de la colonne de
 * travail — la même logique que « Créer une vidéo » : où j'en suis, quoi
 * faire maintenant, en un coup d'œil.
 *
 * Purement présentationnel : l'état vient du serveur (dérivé par la page),
 * les gestes sont ceux qui existent déjà. Ce bloc n'ajoute aucune règle.
 */
export type StatutAvatarCle = 'aucun' | 'consentement' | 'entrainement' | 'a_valider' | 'pret' | 'erreur';

/** Un lien SECONDAIRE (jamais un second CTA principal : la page n'en montre qu'un, cahier #409). */
export interface LienStatut {
  libelle: string;
  href: string;
  attributs?: Record<string, string>;
}

export interface StatutAvatarProps {
  statut: StatutAvatarCle;
  /** Une phrase, jamais de jargon. */
  texte?: string;
  /** Un lien secondaire vers la suite (ex. « Utiliser dans Créer »). */
  lien?: LienStatut | null;
  /** Ce qui l'accompagne (barre d'envoi, etc.). */
  children?: ReactNode;
  className?: string;
}

const RENDU: Record<StatutAvatarCle, { libelle: string; icone: ReactNode; classe: string }> = {
  aucun: { libelle: 'Aucun avatar', icone: <UserSquare2 className="w-4 h-4" />, classe: 'text-gray-300 bg-gray-800/80 ring-gray-700' },
  consentement: { libelle: 'Consentement à donner', icone: <ShieldCheck className="w-4 h-4" />, classe: 'text-amber-200 bg-amber-500/10 ring-amber-500/30' },
  entrainement: { libelle: 'En entraînement', icone: <Loader2 className="w-4 h-4 animate-spin" />, classe: 'text-purple-200 bg-purple-500/10 ring-purple-500/30' },
  a_valider: { libelle: 'À valider', icone: <Eye className="w-4 h-4" />, classe: 'text-sky-200 bg-sky-500/10 ring-sky-500/30' },
  pret: { libelle: 'Prêt', icone: <CheckCircle2 className="w-4 h-4" />, classe: 'text-emerald-200 bg-emerald-500/10 ring-emerald-500/30' },
  erreur: { libelle: 'Erreur', icone: <AlertTriangle className="w-4 h-4" />, classe: 'text-red-200 bg-red-500/10 ring-red-500/30' },
};

export default function StatutAvatar({ statut, texte, lien, children, className = '' }: StatutAvatarProps) {
  const r = RENDU[statut];
  return (
    <div data-avatar-statut={statut} className={`card-base p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 ${className}`}>
      <div className="min-w-0 flex-1 space-y-1">
        <span data-avatar-statut-libelle className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${r.classe}`}>
          {r.icone}
          {r.libelle}
        </span>
        {texte && <p data-avatar-statut-texte className="text-sm text-gray-400">{texte}</p>}
        {children}
      </div>
      {lien && (
        <a
          href={lien.href}
          {...(lien.attributs ?? {})}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-purple-300 hover:text-purple-200 underline-offset-4 hover:underline"
        >
          {lien.libelle}
        </a>
      )}
    </div>
  );
}
