'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * L'AIDE DE L'AUTOPILOTE — TROIS LIGNES, A LA DEMANDE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ELLE DIT LE CONTRAT REEL, PAS UNE PROMESSE
 * ---------------------------------------------------------------------------
 *
 * Le moteur part d'UN rush : un jeu de coupes vient d'une analyse, qui vient
 * d'un rush. L'ecran montrait plusieurs rushes cote a cote sans jamais dire
 * lequel serait monte — et on pouvait raisonnablement croire qu'ils le
 * seraient tous. Cette aide le dit en une phrase, et annonce le multi-rush
 * comme ce qu'il est : pas encore la.
 *
 * ⚠️ ET ELLE NE PREND AUCUNE PLACE TANT QU'ON NE LA DEMANDE PAS. Un encart
 * permanent de trois etapes serait relu mille fois par quelqu'un qui les
 * connait deja.
 */

const ETAPES = [
  'Choisis le rush à monter.',
  'Studiio en sélectionne les meilleurs passages.',
  'Il crée la vidéo avec ton format, ta durée et ton audio.',
];

export default function AideAutopilote() {
  const [ouvert, setOuvert] = useState(false);
  const racineRef = useRef<HTMLDivElement>(null);
  const boutonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e: MouseEvent) => {
      if (!racineRef.current?.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOuvert(false); boutonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  return (
    <div ref={racineRef} className="relative shrink-0">
      <button
        ref={boutonRef}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-label="Comment fonctionne l’Autopilote"
        title="Comment ça marche"
        aria-expanded={ouvert}
        aria-controls={ouvert ? id : undefined}
        data-aide-autopilote
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500
          hover:bg-white/5 hover:text-white focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>

      {ouvert && (
        <div
          id={id}
          role="dialog"
          aria-label="Comment fonctionne l’Autopilote"
          data-aide-panneau
          className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-white/10
            bg-[#12121a]/95 p-3 shadow-xl backdrop-blur"
        >
          <ol className="space-y-1.5">
            {ETAPES.map((texte, i) => (
              <li key={texte} className="flex gap-2 text-[12px] leading-relaxed text-gray-300">
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center
                  rounded-full border border-white/15 text-[9px] text-gray-400">
                  {i + 1}
                </span>
                {texte}
              </li>
            ))}
          </ol>
          {/* Dit maintenant ce qui, sinon, se decouvre par deception. */}
          <p className="mt-2 border-t border-white/10 pt-2 text-[11px] text-gray-500">
            Une vidéo est montée depuis un seul rush. Le montage multi-rush
            arrivera plus tard.
          </p>
        </div>
      )}
    </div>
  );
}
