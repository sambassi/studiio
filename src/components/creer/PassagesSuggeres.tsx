'use client';

/**
 * M3-C — « Passages suggérés ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pas de lecteur vidéo, pas de timeline éditable, pas de glisser-déposer,
 * pas de découpe, pas de rendu. M3-C propose des passages ; il n'en coupe
 * aucun. Un écran qui laisserait déplacer une borne laisserait croire que le
 * déplacement est enregistré quelque part — il ne le serait pas.
 *
 * ⚠️ AUCUNE VALEUR N'EST FABRIQUÉE. Un champ absent ne devient pas zéro, et
 * une génération sans candidat ne s'affiche pas comme une réussite vide : le
 * `filter(candidatValide)` de la passerelle a déjà écarté ce qui n'est pas
 * affichable, et ce qui reste vient de la base.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  lireCandidats, lancerCandidats, formaterInstant,
  type GenerationEcran,
} from '@/lib/autopilot/analyse/candidat-passerelle';

interface Props {
  /** L'analyse source. Toujours `reussie` — l'appelant s'en assure. */
  analyseId: string;
}

export default function PassagesSuggeres({ analyseId }: Props) {
  const [generation, setGeneration] = useState<GenerationEcran | null>(null);
  const [chargement, setChargement] = useState(true);
  const [indisponible, setIndisponible] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [demande, setDemande] = useState(false);

  const vivantRef = useRef(true);

  useEffect(() => {
    vivantRef.current = true;
    return () => { vivantRef.current = false; };
  }, []);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setIndisponible(null);
    setErreur(null);
    setGeneration(null);

    (async () => {
      const r = await lireCandidats(analyseId);
      if (annule || !vivantRef.current) return;
      if (r.sorte === 'indisponible') setIndisponible(r.message);
      else if (r.sorte === 'erreur') setErreur(r.message);
      else if (r.sorte === 'trouvee') setGeneration(r.generation);
      setChargement(false);
    })();

    return () => { annule = true; };
  }, [analyseId]);

  const chercher = useCallback(async () => {
    // ⚠️ UN SEUL ENVOI. Le garde local évite le double clic ; l'index unique
    // de la base est ce qui le garantit vraiment.
    if (demande) return;
    setDemande(true);
    setErreur(null);
    setIndisponible(null);

    const r = await lancerCandidats(analyseId);
    if (!vivantRef.current) return;

    if (r.sorte === 'lancee') setGeneration(r.generation);
    else if (r.sorte === 'indisponible') setIndisponible(r.message);
    else if (r.sorte === 'deja_en_cours') {
      setErreur('Une recherche est déjà en cours pour cette analyse.');
    } else setErreur(r.message);

    setDemande(false);
  }, [analyseId, demande]);

  if (chargement) return null;

  const candidats = generation?.candidats ?? [];
  const aReussi = generation?.etat === 'reussie';

  return (
    <section className="space-y-1.5" data-analyse-section="passages">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[10px] uppercase tracking-wide text-gray-500">
          Passages suggérés
        </h4>
        {!indisponible && (
          <button
            type="button"
            onClick={chercher}
            disabled={demande}
            data-passages-bouton
            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {demande
              ? 'Recherche…'
              : candidats.length > 0
                ? 'Chercher à nouveau'
                : 'Trouver les meilleurs passages'}
          </button>
        )}
      </div>

      {/* ── Pas installé : on le dit, on ne fabrique pas un faux succès ─── */}
      {indisponible && (
        <p className="text-[10px] text-gray-500 leading-relaxed" data-passages-indisponible>
          {indisponible}
        </p>
      )}

      {erreur && (
        <p className="text-[10px] text-amber-400/80 leading-relaxed" data-passages-erreur>
          {erreur}
        </p>
      )}

      {!indisponible && !erreur && candidats.length === 0 && (
        <p className="text-[10px] text-gray-500 leading-relaxed" data-passages-vide>
          Aucun passage proposé pour l’instant.
        </p>
      )}

      {candidats.length > 0 && (
        <ul className="space-y-1" data-passages-liste>
          {candidats.map((c) => (
            <li
              key={`${c.rang}-${c.secondeReference}`}
              className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5"
              data-passage-rang={c.rang}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] text-gray-200">
                  <span className="text-gray-500">#{c.rang}</span>{' '}
                  {formaterInstant(c.debutSecondes)} → {formaterInstant(c.finSecondes)}
                </span>
                <span className="text-[10px] text-gray-400">{c.scoreMontage}/100</span>
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400 leading-relaxed">{c.raison}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Le modèle qui a proposé, quand il est connu. Jamais deviné. */}
      {aReussi && generation?.modele && (
        <p className="text-[9px] text-gray-600" data-passages-modele>
          Proposé par {generation.modele}.
        </p>
      )}
    </section>
  );
}
