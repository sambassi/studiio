'use client';

/**
 * A_3e3 — « STYLE DE MES VIDÉOS » : CE QUE L'AUTOPILOTE A LE DROIT DE VARIER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ IL VIT DANS L'AUTOMATISATION, PAS AVANT « CRÉER MA VIDÉO »
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce réglage ne concerne QUE les vidéos que Studiio fabrique tout seul.
 * Le mettre sur le chemin manuel poserait une question — « faut-il varier ? »
 * — à quelqu'un qui vient justement de choisir lui-même.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ FAVORI N'EST PAS AUTORISÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aimer un effet et laisser une machine le choisir sont deux gestes
 * différents : on peut adorer un flash blanc et ne pas vouloir le retrouver
 * un lundi matin sur une vidéo d'entreprise. Le bouton « Utiliser mes
 * favoris » COPIE la liste, il ne la lie pas.
 */
import { Check } from 'lucide-react';
import {
  MODES_CREATIFS, LIBELLES_MODE, DESCRIPTIONS_MODE, LIBELLES_FAMILLE,
  FAMILLES_BIBLIOTHEQUE, idsFamille,
  type ModeCreatif, type PolitiqueCreative, type FamilleBibliotheque,
  type FavorisCreatifs,
} from '@/lib/creatif/bibliotheque';
import { PRESETS_STUDIIO, type PresetPersonnel } from '@/lib/creatif/presets';
import { LOOKS_CREATIFS } from '@/lib/creatif/looks';
import { STYLES_TEXTE } from '@/lib/creatif/styles-texte';
import { ANIMATIONS_TEXTE } from '@/lib/creatif/animations-texte';
import { ANIMATIONS_CONTENU } from '@/lib/creatif/animations-contenu';
import { TRANSITIONS_CREATIVES } from '@/lib/creatif/transitions';
import { STYLES_CAPTION } from '@/lib/creatif/captions';
import type { EntreeCreative } from '@/lib/creatif/catalogue-contrat';

/** Les familles que l'Autopilote peut reellement faire varier. */
/* ⚠️ NI LES SOUS-TITRES NI LES MUSIQUES. Les premiers sont un reglage de
   lisibilite ; les secondes ont leur PROPRE politique — un fichier du compte
   ne se regle pas comme un effet du catalogue. */
const FAMILLES_VARIABLES = FAMILLES_BIBLIOTHEQUE
  .filter((f) => f !== 'caption' && f !== 'audio');

const CATALOGUES: Record<Exclude<FamilleBibliotheque, 'audio'>, readonly EntreeCreative[]> = {
  lut: LOOKS_CREATIFS,
  styleTexte: STYLES_TEXTE,
  animationBloc: ANIMATIONS_TEXTE,
  animationContenu: ANIMATIONS_CONTENU,
  transition: TRANSITIONS_CREATIVES,
  caption: STYLES_CAPTION,
};

/** Le nom d'un identifiant, ou l'identifiant si le catalogue ne le connaît plus. */
export function nomEntree(famille: FamilleBibliotheque, id: string): string {
  if (famille === 'audio') return id;
  return CATALOGUES[famille].find((x) => x.id === id)?.nom ?? id;
}

export interface PanneauStyleAutomatiqueProps {
  politique: PolitiqueCreative;
  favoris: FavorisCreatifs;
  presetsPersonnels: readonly PresetPersonnel[];
  onChanger: (suivante: PolitiqueCreative) => void;
}

export default function PanneauStyleAutomatique({
  politique, favoris, presetsPersonnels, onChanger,
}: PanneauStyleAutomatiqueProps) {
  const changerMode = (mode: ModeCreatif) => onChanger({ ...politique, mode });

  const basculerAutorise = (famille: FamilleBibliotheque, id: string) => {
    const liste = politique.autorises[famille];
    onChanger({
      ...politique,
      autorises: {
        ...politique.autorises,
        [famille]: liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id],
      },
    });
  };

  const basculerPreset = (id: string) => {
    const liste = politique.presetsAutorises;
    onChanger({
      ...politique,
      presetsAutorises: liste.includes(id)
        ? liste.filter((x) => x !== id) : [...liste, id],
    });
  };

  return (
    <div className="space-y-3" data-style-automatique data-style-automatique-mode={politique.mode}>
      <div>
        <p className="mb-1.5 text-xs font-medium text-gray-300">Style de mes vidéos</p>
        <div className="grid gap-1.5">
          {MODES_CREATIFS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changerMode(m)}
              aria-pressed={politique.mode === m}
              data-mode-creatif={m}
              className={`rounded-lg border px-2 py-1.5 text-left transition
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                politique.mode === m
                  ? 'border-purple-500/50 bg-gray-800'
                  : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span className="flex items-center gap-1 text-[11px] text-gray-200">
                {politique.mode === m && (
                  <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />
                )}
                {LIBELLES_MODE[m]}
              </span>
              <span className="block text-[10px] text-gray-500">{DESCRIPTIONS_MODE[m]}</span>
            </button>
          ))}
        </div>
      </div>

      {politique.mode === 'varier-elements' && (
        <div className="space-y-2" data-autorises>
          {/* ⚠️ LES SOUS-TITRES NE SONT PAS PROPOSES ICI. C'est un reglage de
              LISIBILITE, pas d'ambiance : personne n'a demande que le style de
              ses sous-titres change d'une video a l'autre. La famille existe
              pour les favoris et la recherche ; la variation la reconduit. */}
          {FAMILLES_VARIABLES.map((famille) => {
            const autorises = politique.autorises[famille];
            const mesFavoris = favoris[famille];
            return (
              <div key={famille}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {LIBELLES_FAMILLE[famille]}
                    <span className="ml-1 font-normal normal-case text-gray-600">
                      {autorises.length === 0
                        ? '— ne varie pas' : `— ${autorises.length} autorisé(s)`}
                    </span>
                  </p>
                  {mesFavoris.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onChanger({
                        ...politique,
                        autorises: { ...politique.autorises, [famille]: [...mesFavoris] },
                      })}
                      data-utiliser-favoris={famille}
                      className="shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-[10px]
                        text-gray-400 transition hover:text-gray-200"
                    >
                      Utiliser mes {mesFavoris.length} favoris
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {idsFamille(famille).map((id) => {
                    const coche = autorises.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => basculerAutorise(famille, id)}
                        aria-pressed={coche}
                        data-autorise={`${famille}:${id}`}
                        className={`rounded-full px-2 py-0.5 text-[10px] leading-none transition ${
                          coche
                            ? 'bg-purple-500/20 text-purple-300'
                            : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {nomEntree(famille, id)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* ⚠️ RIEN COCHÉ NE BLOQUE PAS : la famille garde le choix actif du
              compte. Refuser de produire parce qu'une case manque serait
              punir quelqu'un qui n'a rien demandé. */}
          <p className="text-[10px] text-gray-600">
            Une famille sans case cochée garde ton choix actuel.
          </p>
        </div>
      )}

      {politique.mode === 'varier-presets' && (
        <div className="space-y-1" data-presets-autorises>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Presets autorisés
            <span className="ml-1 font-normal normal-case text-gray-600">
              {politique.presetsAutorises.length === 0
                ? '— aucun, ton style actuel est conservé'
                : `— ${politique.presetsAutorises.length} choisi(s)`}
            </span>
          </p>
          <div className="flex flex-wrap gap-1">
            {[...PRESETS_STUDIIO.map((x) => ({ id: x.id, nom: x.nom })),
              ...presetsPersonnels.map((x) => ({ id: x.id, nom: x.nom }))].map((x) => {
              const coche = politique.presetsAutorises.includes(x.id);
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => basculerPreset(x.id)}
                  aria-pressed={coche}
                  data-preset-autorise={x.id}
                  className={`rounded-full px-2 py-0.5 text-[10px] leading-none transition ${
                    coche
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {x.nom}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
