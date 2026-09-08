'use client';

/**
 * A_3e2 — LES PRESETS : UN CLIC POUR UN UNIVERS ENTIER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE LA CARTE MONTRE EST CE QUE LE PRESET FAIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pas de nouveau MP4, pas de nouvelle route : la vignette est l'aperçu du
 * LOOK du preset — celui que la route A_3a rend déjà avec le vrai `.cube` —
 * et le nom du style de texte est écrit dessous. Fabriquer un aperçu vidéo
 * par preset aurait été douze rendus pour une information que la personne
 * lit en deux mots.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ APPLIQUER N'EST PAS ENREGISTRER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cliquer un preset modifie le BROUILLON. C'est le bouton « Enregistrer »
 * du panneau qui décide, comme pour n'importe quel autre réglage — sinon un
 * essai de preset redéfinirait l'identité visuelle du compte.
 */
import { useState } from 'react';
import { Check, Trash2, Pencil, Plus } from 'lucide-react';
import {
  PRESETS_STUDIIO, type StylePreset, type PresetPersonnel,
} from '@/lib/creatif/presets';
import { styleTexteParId } from '@/lib/creatif/styles-texte';
import { transitionCreativeParId } from '@/lib/creatif/transitions';

export interface PanneauPresetsProps {
  onAppliquer: (style: StylePreset) => void;
  presetsPersonnels: readonly PresetPersonnel[];
  onEnregistrer: (nom: string) => void;
  onRenommer: (id: string, nom: string) => void;
  onSupprimer: (id: string) => void;
  /** Le preset dont le style correspond exactement au brouillon, s'il y en a un. */
  actif?: string | null;
  limiteAtteinte?: boolean;
}

/** Le résumé d'un preset en deux mots : style de texte, puis transition. */
export function resumePreset(style: StylePreset): string {
  const t = styleTexteParId(style.styleTexteId)?.nom ?? 'Texte';
  const tr = transitionCreativeParId(style.transitionId)?.nom ?? 'Coupe';
  return `${t} · ${tr}`;
}

export default function PanneauPresets({
  onAppliquer, presetsPersonnels, onEnregistrer, onRenommer, onSupprimer,
  actif = null, limiteAtteinte = false,
}: PanneauPresetsProps) {
  const [nouveau, setNouveau] = useState('');
  const [renomme, setRenomme] = useState<string | null>(null);
  const [nomRenomme, setNomRenomme] = useState('');

  return (
    <div className="space-y-2" data-panneau-presets>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Univers Studiio
      </p>
      <ul className="grid grid-cols-2 gap-1.5">
        {PRESETS_STUDIIO.map((preset) => {
          const choisi = actif === preset.id;
          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onAppliquer(preset.style)}
                aria-pressed={choisi}
                aria-label={`${preset.nom} — ${preset.description}`}
                title={preset.description}
                data-preset-studiio={preset.id}
                className={`block w-full overflow-hidden rounded-lg border text-left transition
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                  choisi
                    ? 'border-purple-500/70 bg-purple-500/[0.06]'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                <span
                  className="flex items-center justify-center overflow-hidden bg-black/50"
                  style={{ aspectRatio: '16 / 9' }}
                >
                  {/* L'aperçu du LOOK, rendu par le vrai `.cube` — la route
                      A_3a, sans en fabriquer une seconde. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/creatif/looks/${encodeURIComponent(preset.style.lutId)}/apercu`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    data-preset-apercu={preset.id}
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="block px-1.5 py-1">
                  <span className="flex items-center gap-1">
                    {choisi && <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />}
                    <span className="truncate text-[10px] text-gray-300">{preset.nom}</span>
                  </span>
                  <span className="block truncate text-[9px] text-gray-500">
                    {resumePreset(preset.style)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Mes presets
      </p>
      {presetsPersonnels.length === 0 ? (
        <p data-presets-personnels-vide className="text-[11px] text-gray-500">
          Enregistre le style courant pour le retrouver en un clic.
        </p>
      ) : (
        <ul className="space-y-1">
          {presetsPersonnels.map((preset) => (
            <li key={preset.id} className="flex items-center gap-1">
              {renomme === preset.id ? (
                <>
                  <input
                    value={nomRenomme}
                    onChange={(e) => setNomRenomme(e.target.value)}
                    aria-label={`Nouveau nom de ${preset.nom}`}
                    data-preset-renommer-champ={preset.id}
                    className="min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900/60
                      px-2 py-1 text-[11px] text-gray-200 focus:border-purple-500/50
                      focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onRenommer(preset.id, nomRenomme);
                      setRenomme(null);
                    }}
                    data-preset-renommer-valider={preset.id}
                    className="shrink-0 rounded-lg border border-gray-800 px-2 py-1
                      text-[10px] text-gray-300 hover:border-gray-700"
                  >
                    OK
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onAppliquer(preset.style)}
                    aria-pressed={actif === preset.id}
                    title={resumePreset(preset.style)}
                    data-preset-personnel={preset.id}
                    className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-left text-[11px]
                      transition focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-purple-500 ${
                      actif === preset.id
                        ? 'border-purple-500/70 text-purple-200'
                        : 'border-gray-800 text-gray-300 hover:border-gray-700'
                    }`}
                  >
                    <span className="block truncate">{preset.nom}</span>
                    <span className="block truncate text-[9px] text-gray-500">
                      {resumePreset(preset.style)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRenomme(preset.id); setNomRenomme(preset.nom); }}
                    aria-label={`Renommer ${preset.nom}`}
                    data-preset-renommer={preset.id}
                    className="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-200"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSupprimer(preset.id)}
                    aria-label={`Supprimer ${preset.nom}`}
                    data-preset-supprimer={preset.id}
                    className="shrink-0 rounded-full p-1 text-gray-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1">
        <input
          value={nouveau}
          onChange={(e) => setNouveau(e.target.value)}
          placeholder="Nom du preset — ex. Mon énergie"
          aria-label="Nom du nouveau preset"
          data-preset-nouveau-nom
          disabled={limiteAtteinte}
          className="min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900/60 px-2 py-1
            text-[11px] text-gray-200 placeholder:text-gray-600 focus:border-purple-500/50
            focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => { onEnregistrer(nouveau); setNouveau(''); }}
          disabled={nouveau.trim() === '' || limiteAtteinte}
          data-preset-enregistrer
          className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-800 px-2 py-1
            text-[10px] text-gray-300 transition hover:border-gray-700 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Enregistrer
        </button>
      </div>
      {limiteAtteinte && (
        <p data-presets-limite className="text-[10px] text-amber-400">
          Tu as atteint le nombre maximum de presets. Supprimes-en un pour en ajouter.
        </p>
      )}
    </div>
  );
}
