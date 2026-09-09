'use client';

import { useMemo, useState } from 'react';
import { Ear, ChevronDown, ChevronUp } from 'lucide-react';
import { texteParle } from '@/lib/voice/pipeline';
import type { Prononciation } from '@/lib/voice/prononciations';
import type { LangueParlee } from '@/lib/voice/spoken-text';

/**
 * A_8d — CE QUE LA VOIX VA RÉELLEMENT DIRE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI CET APERÇU EXISTE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * « 25 CHF à 18h30 » ne se prononce pas comme il s'écrit. La transformation
 * est juste, mais elle est INVISIBLE : on ne découvre le résultat qu'en
 * écoutant — c'est-à-dire, pour un clone vidéo, après avoir dépensé une
 * génération. Cet encart le montre avant.
 *
 * ⚠️ IL N'APPELLE AUCUN MOTEUR DE SYNTHÈSE. La normalisation est une fonction
 * pure : l'afficher ne coûte rien et ne consomme aucun crédit. Écouter, si un
 * jour c'est proposé, restera un geste explicite.
 *
 * ⚠️ ET IL NE MODIFIE RIEN. Le texte de gauche reste celui de la personne —
 * c'est lui qui sera affiché, édité, sous-titré, publié.
 */

interface Props {
  /** Le texte tel qu'il est écrit. Jamais modifié par ce composant. */
  displayScript: string;
  prononciations?: readonly Prononciation[];
  langue?: LangueParlee;
  /**
   * La voix clonée du compte, si elle existe.
   *
   * ⚠️ `null` N'AUTORISE AUCUN REPLI. Faire parler une voix de catalogue en
   * l'appelant « votre voix » serait un mensonge que personne ne pourrait
   * vérifier à l'oreille.
   */
  voixClonee?: { nom: string } | null;
}

export default function ApercuPrononciation({
  displayScript, prononciations = [], langue, voixClonee = null,
}: Props) {
  const [ouvert, setOuvert] = useState(false);

  const parle = useMemo(
    () => texteParle(displayScript, { langue, prononciations }),
    [displayScript, langue, prononciations],
  );

  const differe = parle.length > 0 && parle !== displayScript.trim();
  if (displayScript.trim().length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40" data-apercu-prononciation>
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        data-apercu-basculer
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200"
      >
        <Ear className="w-3.5 h-3.5" />
        <span>Voir la prononciation</span>
        {differe && (
          <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
            adaptée
          </span>
        )}
        {ouvert ? <ChevronUp className="w-3.5 h-3.5 ml-auto" />
          : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>

      {ouvert && (
        <div className="px-3 pb-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-gray-500 mb-1">Texte</div>
              <p className="text-gray-300 whitespace-pre-wrap" data-apercu-display>
                {displayScript}
              </p>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Prononciation</div>
              <p className="text-gray-200 whitespace-pre-wrap" data-apercu-spoken>
                {parle}
              </p>
            </div>
          </div>

          {/* ⚠️ SANS VOIX CLONÉE, ON LE DIT — on ne substitue pas. */}
          {voixClonee === null ? (
            <p className="text-[11px] text-gray-500" data-apercu-sans-voix>
              Configurez votre voix pour écouter cet aperçu.
            </p>
          ) : (
            <p className="text-[11px] text-gray-500">
              Sera dit avec votre voix : {voixClonee.nom}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
