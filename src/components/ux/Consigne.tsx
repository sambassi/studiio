'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';

/**
 * LA consigne de Studiio — « quoi faire maintenant », toujours au même
 * endroit sous le fil d'étapes (cahier UX, §3.1). Généralise le bloc
 * « à faire » de l'Autopilote : une question, une aide courte, et — quand
 * l'utilisateur va produire quelque chose — des conseils ou une checklist,
 * repliables pour ne jamais devenir un gros bloc permanent.
 *
 * La checklist est informative (`ok` absent ou `null`) ou calculée par
 * l'appelant (`ok: true/false`) ; le composant ne vérifie rien lui-même.
 */

export interface PointChecklist { libelle: string; ok?: boolean | null }

export interface ConsigneProps {
  /** La question : « Que devez-vous faire ? » en une phrase. */
  titre: string;
  /** Une ligne d'aide. */
  texte?: string;
  /** Conseils pratiques (puces). */
  conseils?: string[];
  /** Checklist : informative, ou évaluée par l'appelant. */
  checklist?: PointChecklist[];
  /** Conseils/checklist repliés derrière « Conseils » (défaut : repliable, fermé). */
  repliable?: boolean;
  ouvertParDefaut?: boolean;
  libelleRepli?: string;
  className?: string;
  children?: ReactNode;
}

export default function Consigne({
  titre, texte, conseils, checklist, repliable = true, ouvertParDefaut = false, libelleRepli = 'Conseils', className = '', children,
}: ConsigneProps) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const aDuContenu = (conseils && conseils.length > 0) || (checklist && checklist.length > 0);
  const montre = !repliable || ouvert;

  return (
    <div data-consigne className={`space-y-2 ${className}`}>
      <div>
        <p className="text-sm font-medium text-white" data-consigne-titre>{titre}</p>
        {texte && <p className="text-[11px] text-gray-500 mt-0.5" data-consigne-texte>{texte}</p>}
      </div>
      {aDuContenu && repliable && (
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          className="inline-flex items-center gap-1.5 text-[11px] text-purple-300 hover:text-white transition"
          data-consigne-repli
        >
          <Lightbulb className="w-3.5 h-3.5" aria-hidden /> {libelleRepli}
          {ouvert ? <ChevronUp className="w-3 h-3" aria-hidden /> : <ChevronDown className="w-3 h-3" aria-hidden />}
        </button>
      )}
      {aDuContenu && montre && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-2" data-consigne-contenu>
          {conseils && conseils.length > 0 && (
            <ul className="list-disc pl-4 text-[12px] text-gray-300 space-y-0.5" data-conseils>
              {conseils.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
          {checklist && checklist.length > 0 && (
            <ul className="space-y-1" data-checklist>
              {checklist.map((p, i) => {
                const etat = p.ok === true ? 'ok' : p.ok === false ? 'ko' : 'info';
                return (
                  <li key={i} className="flex items-start gap-2 text-[12px]" data-checklist-point={etat}>
                    <span
                      className={`mt-0.5 w-3.5 h-3.5 rounded-sm flex items-center justify-center flex-shrink-0 border ${etat === 'ok' ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : etat === 'ko' ? 'border-amber-400 bg-amber-500/20' : 'border-gray-600'}`}
                      aria-hidden
                    >
                      {etat === 'ok' && <Check className="w-2.5 h-2.5" />}
                    </span>
                    <span className={etat === 'ko' ? 'text-amber-200' : 'text-gray-300'}>
                      {p.libelle}
                      <span className="sr-only">{etat === 'ok' ? ' — fait' : etat === 'ko' ? ' — à faire' : ''}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
