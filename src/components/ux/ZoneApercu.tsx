'use client';

import type { ReactNode } from 'react';
import { Loader2, AlertTriangle, ImageOff } from 'lucide-react';

/**
 * LA zone d'aperçu de Studiio — le même cadre, la même logique d'états sur
 * Créer, Autopilote et Mon avatar (cahier UX, §2.5 / §3.1).
 *
 * Quatre états : `vide` (rien à montrer, et POURQUOI), `chargement` (ce qui
 * se prépare), `erreur` (ce qui manque, et la sortie), `pret` (le média —
 * fourni par l'appelant en `children` — et l'action suivante mise en avant).
 * Le composant ne connaît aucun lecteur métier : il encadre.
 */

export interface ActionApercu {
  libelle: string;
  onClick: () => void;
  principale?: boolean;
  disabled?: boolean;
  /** Attributs `data-*` de l'appelant (ses propres repères de test), posés sur le bouton. */
  attributs?: Record<`data-${string}`, string>;
}

export type EtatApercu =
  | { statut: 'vide'; message: string; action?: ActionApercu }
  | { statut: 'chargement'; message: string; detail?: string }
  | { statut: 'erreur'; message: string; detail?: string; action?: ActionApercu }
  | { statut: 'pret'; legende?: string; actionSuivante?: ActionApercu; actionsSecondaires?: ActionApercu[] };

export interface ZoneApercuProps {
  titre?: string;
  etat: EtatApercu;
  /** Le média (vidéo, image, montage) — seulement lu quand `etat.statut === 'pret'`. */
  children?: ReactNode;
  /** Ratio du cadre vide/chargement (ex. '9 / 16'). */
  ratio?: string;
  className?: string;
}

const Bouton = ({ a }: { a: ActionApercu }) => (
  <button type="button" onClick={a.onClick} disabled={a.disabled} className={`${a.principale === false ? 'button-ghost' : 'button-primary'} text-[13px] px-3 py-1.5 disabled:opacity-40`} data-apercu-action={a.libelle} {...(a.attributs ?? {})}>
    {a.libelle}
  </button>
);

export default function ZoneApercu({ titre = 'Aperçu', etat, children, ratio = '9 / 16', className = '' }: ZoneApercuProps) {
  return (
    <section data-apercu={etat.statut} aria-label={titre} className={`card-base p-4 space-y-3 ${className}`}>
      <h2 className="text-sm font-semibold text-white" data-apercu-titre>{titre}</h2>

      {etat.statut === 'pret' ? (
        <div className="space-y-3">
          <div data-apercu-media className="rounded-xl overflow-hidden bg-black">{children}</div>
          {etat.legende && <p className="text-[12px] text-gray-400" data-apercu-legende>{etat.legende}</p>}
          {(etat.actionSuivante || (etat.actionsSecondaires && etat.actionsSecondaires.length > 0)) && (
            <div className="flex flex-wrap items-center gap-2" data-apercu-actions>
              {etat.actionSuivante && <Bouton a={{ ...etat.actionSuivante, principale: true }} />}
              {etat.actionsSecondaires?.map((a) => <Bouton key={a.libelle} a={{ ...a, principale: false }} />)}
            </div>
          )}
        </div>
      ) : (
        <div
          className="w-full max-w-sm mx-auto rounded-xl border border-dashed border-gray-700 bg-gray-900/40 flex flex-col items-center justify-center gap-2 p-6 text-center"
          style={{ aspectRatio: ratio, maxHeight: 420 }}
          role={etat.statut === 'erreur' ? 'alert' : 'status'}
        >
          {etat.statut === 'vide' && <ImageOff className="w-6 h-6 text-gray-600" aria-hidden />}
          {etat.statut === 'chargement' && <Loader2 className="w-6 h-6 text-purple-300 animate-spin" aria-hidden />}
          {etat.statut === 'erreur' && <AlertTriangle className="w-6 h-6 text-amber-300" aria-hidden />}
          <p className={`text-[13px] ${etat.statut === 'erreur' ? 'text-amber-200' : 'text-gray-300'}`} data-apercu-message>{etat.message}</p>
          {'detail' in etat && etat.detail && <p className="text-[11px] text-gray-500" data-apercu-detail>{etat.detail}</p>}
          {'action' in etat && etat.action && <div className="pt-1"><Bouton a={etat.action} /></div>}
        </div>
      )}
    </section>
  );
}
