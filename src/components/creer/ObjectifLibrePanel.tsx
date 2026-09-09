'use client';

/**
 * CREER_PREMIUM_3C — L'OBJECTIF EN UNE PHRASE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI DISPARAÎT, ET POURQUOI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'objectif se déclarait en trois étapes — but, priorités, confirmation.
 * Trois écrans pour dire ce qu'une phrase exprime, et un parcours qu'il fallait
 * mener jusqu'au bout : tant qu'il restait ouvert sans être validé, « Créer ma
 * vidéo » refusait de partir. Une aide devenue un obstacle.
 *
 * ⚠️ LE MOTEUR NE PERD RIEN. `objectifDepuisTexte` rend exactement le contrat
 * que le parcours produisait — même `ObjectifCommunication`, même
 * `politiqueDePlan`, même `objectif-score`. Seule l'entrée change.
 *
 * ⚠️ ET LE CHAMP EST FACULTATIF. Vide, la phrase donne un objectif générique,
 * c'est-à-dire le comportement de tous les comptes qui n'ont rien déclaré. Rien
 * n'est bloqué : c'est le point qui manquait le plus au parcours précédent.
 */
import { useEffect, useRef, useState } from 'react';
import { Target } from 'lucide-react';
import {
  objectifDepuisTexte, texteDepuisObjectif, EXEMPLES_OBJECTIF,
} from '@/lib/autopilot/analyse/objectif-texte-libre';
import type { ObjectifCommunication } from '@/lib/autopilot/analyse/objectif-communication';

export interface ObjectifLibrePanelProps {
  /** L'objectif DÉJÀ appliqué à la vidéo en cours, s'il y en a un. */
  objectifCetteVideo?: ObjectifCommunication | null;
  /** Applique l'objectif à CETTE vidéo. N'écrit rien côté compte. */
  onAppliquerACetteVideo?: (objectif: ObjectifCommunication | null) => void;
}

const LIMITE = 300;

export default function ObjectifLibrePanel({
  objectifCetteVideo = null, onAppliquerACetteVideo,
}: ObjectifLibrePanelProps) {
  const [texte, setTexte] = useState(() => texteDepuisObjectif(objectifCetteVideo));
  const [enregistre, setEnregistre] = useState(false);
  const champRef = useRef<HTMLTextAreaElement>(null);

  /**
   * ⚠️ RESYNCHRONISÉ SUR LE TEXTE, PAS SUR L'OBJET. `objectifCetteVideo`
   * change d'identité à chaque normalisation ; se caler dessus réinitialiserait
   * la phrase en cours de frappe. Et on ne réécrit que si la valeur DIFFÈRE :
   * sans cette garde, chaque rendu du parent écraserait la saisie.
   */
  const texteAmont = texteDepuisObjectif(objectifCetteVideo);
  useEffect(() => {
    setTexte((actuel) => (actuel === texteAmont ? actuel : texteAmont));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texteAmont]);

  /**
   * ⚠️ LA CLASSIFICATION SE FAIT ICI, PAS À CHAQUE FRAPPE. Elle est
   * déterministe et sans réseau, mais l'appeler à chaque caractère ferait
   * remonter un objectif neuf au parent trente fois par phrase — donc autant
   * d'écritures de brouillon.
   */
  const appliquer = (valeur: string) => {
    const propre = valeur.trim();
    onAppliquerACetteVideo?.(propre.length === 0 ? null : objectifDepuisTexte(propre));
    setEnregistre(true);
  };

  useEffect(() => {
    if (!enregistre) return undefined;
    const t = setTimeout(() => setEnregistre(false), 2000);
    return () => clearTimeout(t);
  }, [enregistre]);

  const choisirExemple = (phrase: string) => {
    setTexte(phrase);
    appliquer(phrase);
    champRef.current?.focus();
  };

  return (
    <section className="space-y-2" data-objectif-libre>
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Objectif de cette vidéo
        </h3>
        {enregistre && (
          <span className="text-[10px] text-emerald-400" data-objectif-enregistre>
            Enregistré
          </span>
        )}
      </div>

      <label className="block text-[11px] text-gray-400" htmlFor="objectif-libre">
        Quel est l’objectif de cette vidéo ?
      </label>
      <textarea
        id="objectif-libre"
        ref={champRef}
        value={texte}
        maxLength={LIMITE}
        rows={2}
        onChange={(e) => setTexte(e.target.value)}
        /* ⚠️ AU RELÂCHEMENT DU CHAMP, pas à la frappe. */
        onBlur={() => appliquer(texte)}
        data-objectif-champ
        placeholder="Ex. Montrer l’énergie de mon cours et donner envie de réserver un essai."
        className="w-full resize-none rounded-lg border border-gray-800 bg-gray-900/60 px-3
          py-2 text-xs text-gray-200 placeholder:text-gray-600
          focus-visible:border-purple-500/50 focus-visible:outline-none"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-gray-600">Exemples :</span>
        {EXEMPLES_OBJECTIF.map((e) => (
          <button
            key={e.libelle}
            type="button"
            onClick={() => choisirExemple(e.phrase)}
            data-objectif-exemple={e.libelle}
            title={e.phrase}
            className="rounded-full border border-gray-800 px-2 py-0.5 text-[10px]
              text-gray-400 transition hover:border-purple-500/40 hover:text-gray-200"
          >
            {e.libelle}
          </button>
        ))}
      </div>

      {/* ⚠️ DIT, PARCE QU'UN CHAMP VIDE INQUIÈTE. Sans cette ligne, on croit
          qu'il manque quelque chose, et on cherche une étape à finir. */}
      <p className="text-[10px] text-gray-600">
        Facultatif — sans objectif, Studiio monte de façon neutre.
      </p>
    </section>
  );
}
