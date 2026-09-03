'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  lireAnalyse, vignettesAffichables, type AnalyseEcran, type VignetteAffichable,
} from '@/lib/autopilot/analyse/passerelle';
import { lireCandidats, type GenerationEcran } from '@/lib/autopilot/analyse/candidat-passerelle';

/**
 * LE CONTENU DU TIROIR « VOIR L'ANALYSE » — VISUEL, ET EN LECTURE SEULE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ IL NE DECLENCHE RIEN
 * ---------------------------------------------------------------------------
 *
 * Deux `GET`, et pas une seule ecriture. C'est la garde qui rend ce tiroir
 * SUR : `PassagesSuggeres` vit ailleurs sur la meme page et porte, lui, le
 * droit de lancer une generation. Si ce tiroir savait aussi la declencher,
 * l'ouvrir pendant qu'une recherche tourne en lancerait une seconde — deux
 * appels au modele pour un seul geste, et l'ecran ne saurait plus laquelle il
 * regarde. Ouvrir un panneau de consultation ne doit rien produire.
 *
 * ---------------------------------------------------------------------------
 * CE QU'ON MONTRE, ET DANS QUEL ORDRE
 * ---------------------------------------------------------------------------
 *
 * Les passages D'ABORD, avec leur image : c'est ce que quelqu'un vient voir.
 * Chaque passage prend la vignette la plus proche de son debut — les huit
 * vignettes existent deja, aucune image n'est fabriquee pour l'occasion.
 * Le releve technique vient apres, replie : il sert au diagnostic, pas au
 * choix.
 */

function mmss(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** La vignette dont la seconde est la plus proche du debut du passage. */
function vignettePour(
  vignettes: VignetteAffichable[], seconde: number,
): string | null {
  let meilleure: VignetteAffichable | null = null;
  let ecart = Infinity;
  for (const v of vignettes) {
    if (v.seconde === null) continue;
    const d = Math.abs(v.seconde - seconde);
    if (d < ecart) { ecart = d; meilleure = v; }
  }
  return meilleure?.url ?? vignettes[0]?.url ?? null;
}

interface Props {
  rushId: string;
  /** Nom affiche dans l'en-tete du tiroir, pour situer ce qu'on lit. */
  nom?: string;
}

export default function ContenuAnalyse({ rushId }: Props) {
  const [analyse, setAnalyse] = useState<AnalyseEcran | null>(null);
  const [generation, setGeneration] = useState<GenerationEcran | null>(null);
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [sansImage, setSansImage] = useState(false);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setMessage(null);
    setAnalyse(null);
    setGeneration(null);
    (async () => {
      const a = await lireAnalyse(rushId);
      if (annule) return;
      if (a.sorte !== 'trouvee') {
        setMessage(a.sorte === 'aucune'
          ? 'Ce rush n’a pas encore été analysé.'
          : a.message);
        setChargement(false);
        return;
      }
      setAnalyse(a.analyse);
      if (a.analyse.etat === 'reussie') {
        const c = await lireCandidats(a.analyse.id);
        if (annule) return;
        if (c.sorte === 'trouvee') setGeneration(c.generation);
      }
      setChargement(false);
    })();
    return () => { annule = true; };
  }, [rushId]);

  if (chargement) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Lecture de l’analyse…
      </p>
    );
  }

  if (message) return <p className="text-[12px] text-gray-400" data-analyse-drawer-message>{message}</p>;
  if (!analyse) return null;

  const vignettes = vignettesAffichables(
    analyse.id, analyse.vignettes.nombre, analyse.vignettes.secondes,
  );
  const candidats = generation?.candidats ?? [];

  return (
    <div className="space-y-5" data-analyse-drawer>
      {/* ── Les passages, en images ─────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-gray-500">
          Passages suggérés
          {candidats.length > 0 && (
            <span className="ml-1 text-gray-400" data-passages-compte>
              · {candidats.length}
            </span>
          )}
        </h3>
        {candidats.length === 0 ? (
          <p className="text-[12px] text-gray-500" data-passages-vide>
            Aucun passage proposé pour l’instant.
          </p>
        ) : (
          <ul className="space-y-2" data-passages-liste>
            {candidats.map((c) => {
              const img = sansImage ? null : vignettePour(vignettes, c.debutSecondes);
              return (
                <li
                  key={`${c.rang}-${c.secondeReference}`}
                  data-passage-rang={c.rang}
                  className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-2"
                >
                  <span
                    className="flex w-24 shrink-0 items-center justify-center overflow-hidden
                      rounded-md bg-black/40"
                    style={{ aspectRatio: '16 / 9' }}
                  >
                    {img && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={() => setSansImage(true)}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-gray-200">
                        {mmss(c.debutSecondes)} → {mmss(c.finSecondes)}
                      </span>
                      <span className="text-[11px] text-gray-500">{c.scoreMontage}/100</span>
                    </span>
                    {/* Deux lignes au plus : le tiroir reste lisible d'un coup
                        d'oeil, le texte complet vit dans l'attribut `title`. */}
                    <span
                      title={c.raison}
                      className="mt-0.5 block overflow-hidden text-[11px] leading-relaxed text-gray-400"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                    >
                      {c.raison}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Le relevé technique, replié ─────────────────────────────────── */}
      <details data-analyse-technique-repli>
        <summary className="flex min-h-[28px] cursor-pointer list-none items-center
          text-[11px] text-gray-500 hover:text-gray-300">
          Détails de la mesure
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {[
            ['Durée', analyse.dureeSecondes ? `${Math.round(analyse.dureeSecondes)} s` : '—'],
            ['État', analyse.etat],
            ['Aperçus', String(analyse.vignettes.nombre)],
          ].map(([libelle, valeur]) => (
            <div key={libelle} className="min-w-0">
              <dt className="truncate text-[10px] uppercase tracking-wide text-gray-500">{libelle}</dt>
              <dd className="truncate text-[11px] text-gray-200">{valeur}</dd>
            </div>
          ))}
        </dl>
      </details>

      {generation?.modele && (
        <p className="text-[10px] text-gray-600">Proposé par {generation.modele}.</p>
      )}
    </div>
  );
}
