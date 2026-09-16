'use client';

import { Check, AlertTriangle } from 'lucide-react';

/**
 * LE fil d'étapes de Studiio — « où j'en suis, ce qui est fait, ce qui reste »
 * (cahier UX, §3.1). Généralise les puces de Créer, les barres de
 * l'Autopilote et le pipeline de l'avatar : une seule forme, quatre états.
 *
 * Aucune dépendance métier : l'appelant donne les étapes et leur état, le
 * composant ne décide de rien. Une étape n'est cliquable que si l'appelant la
 * déclare atteignable (et fournit `onAller`). Sur mobile, une ligne compacte
 * dit la même chose : « Étape 3 sur 5 · Entraînement — Prochaine : Aperçu ».
 */

export type EtatEtape = 'terminee' | 'active' | 'a_venir' | 'correction';

export interface Etape { cle: string; libelle: string; etat: EtatEtape }

export interface FilEtapesProps {
  etapes: Etape[];
  /** Clés cliquables (retour à une étape déjà atteinte). Sans `onAller`, rien n'est cliquable. */
  atteignables?: string[];
  onAller?: (cle: string) => void;
  accent?: string;
  /** Sans les noms sous les puces (desktop) : puces seules + ligne compacte. */
  sansNoms?: boolean;
  className?: string;
}

const LIBELLE_ETAT: Record<EtatEtape, string> = {
  terminee: 'terminée', active: 'en cours', a_venir: 'à venir', correction: 'correction nécessaire',
};

export default function FilEtapes({ etapes, atteignables = [], onAller, accent = '#7C3AED', sansNoms = false, className = '' }: FilEtapesProps) {
  const indexActive = etapes.findIndex((e) => e.etat === 'active' || e.etat === 'correction');
  const active = indexActive >= 0 ? etapes[indexActive] : undefined;
  const prochaine = indexActive >= 0 ? etapes.slice(indexActive + 1).find((e) => e.etat === 'a_venir') : etapes.find((e) => e.etat === 'a_venir');

  return (
    <nav aria-label="Étapes" data-fil-etapes className={className}>
      <ol className="flex items-center gap-2">
        {etapes.map((e, i) => {
          const cliquable = !!onAller && atteignables.includes(e.cle) && e.etat !== 'active';
          const aller = () => { if (cliquable) onAller!(e.cle); };
          const couleur = e.etat === 'terminee' || e.etat === 'active' ? accent : e.etat === 'correction' ? '#F59E0B' : '#1F2937';
          return (
            <li key={e.cle} className="flex items-center gap-2 flex-1 last:flex-none min-w-0">
              <div
                data-etape={e.cle}
                data-etape-etat={e.etat}
                aria-current={e.etat === 'active' || e.etat === 'correction' ? 'step' : undefined}
                className={`flex items-center gap-1.5 min-w-0 rounded transition ${cliquable ? 'cursor-pointer hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400' : ''}`}
                {...(cliquable
                  ? {
                    role: 'button', tabIndex: 0, 'aria-label': `Aller à l’étape ${e.libelle}`, onClick: aller,
                    onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aller(); } },
                  }
                  : {})}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{ backgroundColor: couleur, color: e.etat === 'a_venir' ? '#6B7280' : '#fff' }}
                  aria-hidden
                >
                  {e.etat === 'terminee' ? <Check className="w-3 h-3" /> : e.etat === 'correction' ? <AlertTriangle className="w-3 h-3" /> : i + 1}
                </span>
                {!sansNoms && (
                  <span className={`hidden sm:inline text-[11px] truncate ${e.etat === 'active' ? 'text-white font-medium' : e.etat === 'correction' ? 'text-amber-300 font-medium' : e.etat === 'terminee' ? 'text-gray-300' : 'text-gray-500'}`}>
                    {e.libelle}
                  </span>
                )}
                <span className="sr-only">{e.libelle}, {LIBELLE_ETAT[e.etat]}</span>
              </div>
              {i < etapes.length - 1 && (
                <div className="h-px flex-1 min-w-2" style={{ backgroundColor: e.etat === 'terminee' ? accent : '#1F2937' }} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
      {/* Mobile (ou `sansNoms`) : la même information sur une ligne. */}
      {active && (
        <p className={`${sansNoms ? '' : 'sm:hidden'} mt-2 text-[11px] text-gray-400`} data-fil-etapes-compact>
          Étape {indexActive + 1} sur {etapes.length} · <span className={active.etat === 'correction' ? 'text-amber-300' : 'text-white'}>{active.libelle}</span>
          {active.etat === 'correction' && <span> — à corriger</span>}
          {prochaine && <span> — Prochaine : {prochaine.libelle}</span>}
        </p>
      )}
    </nav>
  );
}
