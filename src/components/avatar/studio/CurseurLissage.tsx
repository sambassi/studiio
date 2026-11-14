'use client';

/**
 * « Lissage du visage » — UN curseur continu de 0 à 100 %, commun à la photo
 * et à la vidéo. Les repères (Aucun, Naturel, Doux, Lissé, Maximum) aident à
 * se situer ; toute valeur intermédiaire est réellement appliquée.
 */
import { LISSAGE_MAX, LISSAGE_MIN, REPERES_LISSAGE, bornerLissage, libelleLissage } from '@/lib/avatar/preparation-source-regles';
import { useTranslations } from '@/i18n/client';

export default function CurseurLissage(props: { valeur: number; onChange: (v: number) => void; disabled?: boolean; onReinitialiser?: () => void }) {
  const tUi = useTranslations('ui.componentsAvatarStudioCurseurLissage');
  const v = bornerLissage(props.valeur);
  return (
    <div data-curseur-lissage className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="curseur-lissage" className="text-sm text-white">{tUi('lissage_du_visage')}</label>
        <span data-curseur-lissage-valeur className="text-xs tabular-nums text-purple-200">Lissage : {libelleLissage(v)}</span>
      </div>
      <input
        id="curseur-lissage"
        data-curseur-lissage-entree
        type="range"
        min={LISSAGE_MIN}
        max={LISSAGE_MAX}
        step={1}
        value={v}
        disabled={props.disabled}
        aria-valuetext={libelleLissage(v)}
        onChange={(e) => props.onChange(bornerLissage(e.target.value))}
        className="w-full accent-purple-500"
      />
      <div className="relative h-4 text-[10px] text-gray-400" aria-hidden>
        {REPERES_LISSAGE.map((r) => (
          <button
            key={r.valeur}
            type="button"
            tabIndex={-1}
            disabled={props.disabled}
            data-curseur-lissage-repere={r.valeur}
            onClick={() => props.onChange(r.valeur)}
            className={`absolute -translate-x-1/2 whitespace-nowrap hover:text-white ${v === r.valeur ? 'text-purple-200' : ''}`}
            style={{ left: `${r.valeur}%`, transform: r.valeur === 0 ? 'none' : r.valeur === 100 ? 'translateX(-100%)' : undefined }}
          >
            {tUi.fr(r.libelle)}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400">{tUi('peau_lissee_rides_et_petites_imperfect')}</p>
      {props.onReinitialiser && (
        <button type="button" data-curseur-lissage-reinitialiser onClick={props.onReinitialiser} disabled={props.disabled} className="button-ghost !min-h-[30px] !text-xs">{tUi('reinitialiser')}</button>
      )}
    </div>
  );
}
