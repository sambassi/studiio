'use client';

import { Info, Pencil } from 'lucide-react';
import {
  BRIEF_KEYS, BRIEF_LABELS, BRIEF_PLACEHOLDERS, BRIEF_MAX_CHARS, briefRempli,
  type BriefKey, type VideoBrief,
} from '@/lib/creer/brief';
import { SEQUENCE_KEYS, type SequenceKey } from '@/lib/types/voice';

/**
 * Le « Brief de la vidéo » — objectif, message, public, CTA.
 *
 * Quatre champs OPTIONNELS. Le composant ne possède aucun état : il rend le
 * brief qu'on lui donne et remonte chaque frappe. C'est le parent qui le
 * persiste — brouillon de « Créer », configuration de l'Autopilote — et qui
 * décide de ce qu'il en fait ; ici, rien n'est généré et rien n'est facturé.
 *
 * Le même composant sert aux deux parcours : dans Créer, c'est le brief de
 * CETTE vidéo ; dans l'Autopilote, le brief RÉCURRENT de toutes les vidéos.
 * `titre` et `aide` disent lequel.
 */
export default function BriefVideo({
  brief,
  onChange,
  onCommit,
  disabled = false,
  titre = 'Brief de la vidéo',
  aide = 'Un thème ne dit pas ce que la vidéo doit transmettre. Ces quatre lignes guident le contenu généré et la narration.',
  idPrefix = 'brief',
}: {
  brief: VideoBrief;
  onChange: (brief: VideoBrief) => void;
  /**
   * Appelé quand un champ perd le focus — pour un parent qui ENREGISTRE
   * côté serveur (Autopilote) et ne veut pas un appel par frappe. Le
   * brouillon de Créer, lui, écoute `onChange` : sa minuterie suffit.
   */
  onCommit?: (brief: VideoBrief) => void;
  disabled?: boolean;
  titre?: string;
  aide?: string;
  /** Préfixe des `id` des champs — deux instances sur une même page ne doivent pas se lier. */
  idPrefix?: string;
}) {
  const poser = (cle: BriefKey, valeur: string) => {
    // La borne s'applique à la frappe : au-delà, le brouillon rognerait de
    // toute façon (`sanitizeBrief`), et l'écran doit montrer ce qui sera gardé.
    const suivant: VideoBrief = { ...brief, [cle]: valeur.slice(0, BRIEF_MAX_CHARS) };
    onChange(suivant);
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2.5" data-brief-video>
      <div>
        <div className="text-sm font-medium text-white">{titre}</div>
        <p className="text-[11px] text-gray-500 mt-0.5">{aide}</p>
      </div>
      {BRIEF_KEYS.map((cle) => {
        const id = `${idPrefix}-${cle}`;
        const valeur = brief[cle] ?? '';
        return (
          <div key={cle}>
            <label htmlFor={id} className="block text-xs font-medium text-gray-300 mb-1">
              {BRIEF_LABELS[cle]}
              <span className="text-gray-600 font-normal"> · facultatif</span>
            </label>
            <textarea
              id={id}
              value={valeur}
              onChange={(e) => poser(cle, e.target.value)}
              onBlur={() => onCommit?.(brief)}
              placeholder={BRIEF_PLACEHOLDERS[cle]}
              disabled={disabled}
              rows={cle === 'cta' ? 1 : 2}
              maxLength={BRIEF_MAX_CHARS}
              data-brief-field={cle}
              className="w-full resize-none rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
            />
          </div>
        );
      })}
    </div>
  );
}

const SEQUENCE_LABELS: Record<SequenceKey, string> = {
  titre: 'Titre',
  cartes: 'Cartes',
  video: 'Vidéo',
  cta: 'CTA',
};

/**
 * « Ce que la vidéo dira » — le texte EXACT de la narration, par séquence.
 *
 * Ce sont les textes de `SequenceVoicesPanel` (étape Contenu), ni plus ni
 * moins : ce composant ne les recompose pas, il les montre. Le bouton mène
 * là où ils se modifient. Tant qu'aucun contenu n'est généré, il n'y a rien
 * à montrer — et on le dit, sans rien générer.
 */
export function NarrationRecap({
  textes,
  onModifier,
  brief,
}: {
  /** Les textes courants par séquence ; `null` tant que rien n'est généré. */
  textes: Partial<Record<SequenceKey, string>> | null;
  onModifier?: () => void;
  brief?: VideoBrief;
}) {
  const lignes = textes
    ? SEQUENCE_KEYS.map((k) => [k, (textes[k] ?? '').trim()] as const).filter(([, t]) => t.length > 0)
    : [];
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2" data-brief-narration>
      <div className="text-sm font-medium text-white">Ce que la vidéo dira</div>
      {lignes.length > 0 ? (
        <ul className="space-y-1.5">
          {lignes.map(([k, t]) => (
            <li key={k} className="text-xs" data-brief-narration-sequence={k}>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">{SEQUENCE_LABELS[k]}</span>
              <span className="text-gray-300">{t}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-500" data-brief-narration-vide>
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            La narration est pré-remplie à partir du contenu généré à l’étape Contenu
            {briefRempli(brief) ? ', en tenant compte de ce brief' : ''}. Rien n’est généré ni facturé ici.
          </span>
        </p>
      )}
      {onModifier && (
        <button
          type="button"
          onClick={onModifier}
          data-brief-modifier-narration
          className="inline-flex items-center gap-1.5 text-[11px] text-purple-300 hover:text-white transition-colors"
        >
          <Pencil className="w-3 h-3" />
          Modifier le texte de la narration (étape Contenu)
        </button>
      )}
    </div>
  );
}

/**
 * « Ce que dira chaque vidéo » — la version AUTOPILOTE.
 *
 * Ici il n'y a pas de texte exact à montrer : la narration de chaque vidéo
 * est produite à sa production, à partir du brief récurrent et du sujet du
 * jour, et son audio n'existe qu'après le rendu payant. Ce bloc montre donc
 * le brief, dit ce qui manque, et ne génère rien.
 */
export function BriefRecurrentRecap({ brief }: { brief: VideoBrief }) {
  const rempli = briefRempli(brief);
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2" data-autopilot-brief-recap>
      <div className="text-sm font-medium text-white">Ce que dira chaque vidéo</div>
      {rempli ? (
        <ul className="space-y-1">
          {BRIEF_KEYS.filter((k) => (brief[k] ?? '').trim()).map((k) => (
            <li key={k} className="text-xs" data-autopilot-brief-recap-champ={k}>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">{BRIEF_LABELS[k]}</span>
              <span className="text-gray-300">{brief[k]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-gray-500" data-autopilot-brief-recap-vide>
          Aucun brief : chaque vidéo ne dira que ce que son sujet du jour inspire.
        </p>
      )}
      <p className="flex items-start gap-1.5 text-[11px] text-gray-500" data-autopilot-brief-recap-note>
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          La narration exacte de chaque vidéo est produite à chaque cycle, à partir de ce brief et du
          sujet du jour. Aucun audio n’existe avant le rendu — rien n’est généré ni facturé ici.
        </span>
      </p>
    </div>
  );
}
