'use client';

import type { ReactNode } from 'react';
import { Check, Info, AlertTriangle, XCircle, X } from 'lucide-react';

/**
 * LA notification de Studiio — une seule forme pour Créer, Autopilote et
 * Mon avatar (cahier UX, §2.3 / §3.1).
 *
 * Un message en trois temps : ce qui s'est passé (`titre`), pourquoi / quoi
 * vérifier (`detail`, `conseils`), quoi faire (`actionPrincipale`,
 * `actionSecondaire`). Le détail technique (`motif`) est replié : il sert au
 * support, jamais à la compréhension. Quatre niveaux, distincts à l'œil ET
 * au texte : succès et information ne se ressemblent pas.
 *
 * Aucune logique métier : le composant affiche ce qu'on lui donne.
 */

export type NiveauNotification = 'succes' | 'info' | 'avertissement' | 'erreur';

export interface ActionNotification {
  libelle: string;
  onClick: () => void;
  /** Pendant le geste (requête en vol) : le bouton ne rejoue rien. */
  disabled?: boolean;
}

export interface NotificationProps {
  niveau: NiveauNotification;
  /** Ce qui s'est passé — une phrase, sans jargon. */
  titre: string;
  /** Pourquoi, ou quoi vérifier. Une liste devient des puces numérotées. */
  detail?: string | string[];
  /** Conseils pratiques, en puces. */
  conseils?: string[];
  /** Le motif technique (code, message fournisseur) — replié, jamais un secret. */
  motif?: string | null;
  actionPrincipale?: ActionNotification;
  actionSecondaire?: ActionNotification;
  onFermer?: () => void;
  className?: string;
  children?: ReactNode;
}

const STYLES: Record<NiveauNotification, { boite: string; icone: ReactNode; libelle: string; role: 'status' | 'alert' }> = {
  succes: { boite: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100', icone: <Check className="w-5 h-5 text-emerald-300" aria-hidden />, libelle: 'Succès', role: 'status' },
  info: { boite: 'border-sky-500/30 bg-sky-500/10 text-sky-100', icone: <Info className="w-5 h-5 text-sky-300" aria-hidden />, libelle: 'Information', role: 'status' },
  avertissement: { boite: 'border-amber-500/30 bg-amber-500/10 text-amber-100', icone: <AlertTriangle className="w-5 h-5 text-amber-300" aria-hidden />, libelle: 'Attention', role: 'alert' },
  erreur: { boite: 'border-red-500/30 bg-red-500/10 text-red-100', icone: <XCircle className="w-5 h-5 text-red-300" aria-hidden />, libelle: 'Erreur', role: 'alert' },
};

export default function Notification({
  niveau, titre, detail, conseils, motif, actionPrincipale, actionSecondaire, onFermer, className = '', children,
}: NotificationProps) {
  const s = STYLES[niveau];
  const details = detail === undefined ? [] : Array.isArray(detail) ? detail : [detail];
  return (
    <div
      role={s.role}
      data-notification={niveau}
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${s.boite} ${className}`}
    >
      <div className="flex-shrink-0 mt-0.5">{s.icone}</div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* Le niveau est aussi DIT, pas seulement coloré. */}
        <p className="font-medium">
          <span className="sr-only">{s.libelle} : </span>
          <span data-notification-titre>{titre}</span>
        </p>
        {details.length === 1 && <p className="text-[13px] opacity-90" data-notification-detail>{details[0]}</p>}
        {details.length > 1 && (
          <ol className="list-decimal pl-5 text-[13px] opacity-90 space-y-0.5" data-notification-detail>
            {details.map((d, i) => <li key={i}>{d}</li>)}
          </ol>
        )}
        {conseils && conseils.length > 0 && (
          <ul className="list-disc pl-5 text-[13px] opacity-90 space-y-0.5" data-notification-conseils>
            {conseils.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
        {children}
        {(actionPrincipale || actionSecondaire) && (
          <div className="flex flex-wrap items-center gap-3 pt-1" data-notification-actions>
            {actionPrincipale && (
              <button type="button" onClick={actionPrincipale.onClick} disabled={actionPrincipale.disabled} className="button-primary text-[13px] px-3 py-1.5 disabled:opacity-40" data-notification-action="principale">
                {actionPrincipale.libelle}
              </button>
            )}
            {actionSecondaire && (
              <button type="button" onClick={actionSecondaire.onClick} className="button-ghost text-[13px] px-3 py-1.5" data-notification-action="secondaire">
                {actionSecondaire.libelle}
              </button>
            )}
          </div>
        )}
        {motif && (
          <details className="text-[11px] opacity-70" data-notification-motif>
            <summary className="cursor-pointer select-none">Détail technique</summary>
            <p className="mt-1 break-words">{motif}</p>
          </details>
        )}
      </div>
      {onFermer && (
        <button type="button" onClick={onFermer} aria-label="Masquer ce message" className="flex-shrink-0 opacity-60 hover:opacity-100 transition" data-notification-fermer>
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
