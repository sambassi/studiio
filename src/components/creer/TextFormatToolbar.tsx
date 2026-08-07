'use client';

import {
  Bold, Italic, Underline, Strikethrough, CaseSensitive,
  AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react';
import {
  TEXT_ALIGNS, TEXT_CASES, type TextAlign, type TextCase,
} from '@/lib/creer/textFormat';

/**
 * La barre de formatage du texte — gras, italique, souligné, barré, casse,
 * alignement.
 *
 * ⚠️ EXTRAITE UNE FOIS, MONTÉE DEUX FOIS. « Créer simple » et l'Autopilote
 * règlent le même texte, avec les mêmes valeurs et les mêmes bornes ; deux
 * barres recopiées auraient fini par proposer des options différentes, et
 * l'utilisateur aurait attribué l'écart à un bug de l'Autopilote. Le dépôt a
 * déjà payé ce prix avec deux sélecteurs de photos désynchronisés dans
 * `/creer` (cf. `tasks/lessons.md`, 2026-05-01).
 *
 * ⚠️ ICÔNES SVG LUCIDE, JAMAIS D'EMOJI — règle absolue du dépôt.
 *
 * ⚠️ `undefined` N'EST PAS `false`. Un réglage jamais touché doit rester
 * ABSENT : c'est ce qui laisse le rendu retomber sur son défaut historique
 * (capitales pour le titre et le CTA). D'où `valeurs` en `Partial` et un
 * `onChange` qui ne pose que ce qu'on change.
 */

export interface TextFormatValues {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textCase?: TextCase;
  align?: TextAlign;
}

/** Libellés de la bascule de casse — dans l'ordre du cycle. */
const CASE_LABELS: Record<TextCase, string> = {
  none: 'Normal',
  uppercase: 'MAJUSCULES',
  lowercase: 'minuscules',
};

const ALIGN_ICONS: Record<TextAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

const ALIGN_LABELS: Record<TextAlign, string> = {
  left: 'Aligner à gauche',
  center: 'Centrer',
  right: 'Aligner à droite',
};

export default function TextFormatToolbar({
  zone,
  valeurs,
  defauts,
  onChange,
  showBoldItalic = true,
}: {
  /** Sert aux `data-*` et aux libellés d'accessibilité. */
  zone: string;
  valeurs: TextFormatValues;
  /**
   * Ce que le RENDU applique quand la propriété est absente.
   *
   * ⚠️ INDISPENSABLE POUR NE PAS MENTIR. Le titre est en capitales par
   * défaut : afficher « Normal » tant que l'utilisateur n'a rien choisi
   * annoncerait l'inverse de ce que la vidéo produit.
   */
  defauts: Required<Pick<TextFormatValues, 'textCase' | 'align'>> & TextFormatValues;
  onChange: (patch: TextFormatValues) => void;
  /** Gras et italique sont déjà réglés ailleurs dans certains panneaux. */
  showBoldItalic?: boolean;
}) {
  const casse = valeurs.textCase ?? defauts.textCase;
  const align = valeurs.align ?? defauts.align;
  const gras = valeurs.bold ?? defauts.bold ?? true;
  const italique = valeurs.italic ?? defauts.italic ?? false;

  /** Bascule Normal → MAJUSCULES → minuscules → Normal. */
  const casseSuivante = (): TextCase => {
    const i = TEXT_CASES.indexOf(casse);
    return TEXT_CASES[(i + 1) % TEXT_CASES.length];
  };

  const bouton = (
    actif: boolean,
    onClick: () => void,
    titre: string,
    jeton: string,
    contenu: React.ReactNode,
  ) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      aria-label={`${titre} — ${zone}`}
      title={titre}
      data-format={`${jeton}-${zone}`}
      className={`flex h-7 min-w-7 items-center justify-center gap-1 rounded-lg border px-1.5 text-xs transition-colors ${
        actif
          ? 'border-purple-500 bg-gray-800 text-white'
          : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
      }`}
    >
      {contenu}
    </button>
  );

  return (
    <div className="space-y-1.5" data-format-toolbar={zone}>
      <div className="flex flex-wrap items-center gap-1">
        {showBoldItalic && (
          <>
            {bouton(gras, () => onChange({ bold: !gras }), 'Gras', 'bold', <Bold className="w-3.5 h-3.5" />)}
            {bouton(italique, () => onChange({ italic: !italique }), 'Italique', 'italic', <Italic className="w-3.5 h-3.5" />)}
          </>
        )}
        {bouton(
          !!valeurs.underline,
          () => onChange({ underline: !valeurs.underline }),
          'Souligné', 'underline', <Underline className="w-3.5 h-3.5" />,
        )}
        {bouton(
          !!valeurs.strike,
          () => onChange({ strike: !valeurs.strike }),
          'Barré', 'strike', <Strikethrough className="w-3.5 h-3.5" />,
        )}
        {/* ── CASSE ────────────────────────────────────────────────────
            Une BASCULE et non trois boutons : la casse est un choix unique
            parmi trois, et trois boutons de plus dans une barre déjà dense
            l'auraient rendue illisible. L'état courant est écrit à côté de
            l'icône — sans quoi « aA » ne dit pas ce qu'il fait. */}
        {bouton(
          casse !== 'none',
          () => onChange({ textCase: casseSuivante() }),
          `Casse : ${CASE_LABELS[casse]} — cliquer pour changer`,
          'case',
          <>
            <CaseSensitive className="w-3.5 h-3.5" />
            <span className="text-[10px]">{casse === 'none' ? 'Aa' : casse === 'uppercase' ? 'AA' : 'aa'}</span>
          </>,
        )}
      </div>
      <div className="flex items-center gap-1">
        {TEXT_ALIGNS.map((a) => {
          const Icone = ALIGN_ICONS[a];
          return bouton(
            align === a,
            () => onChange({ align: a }),
            ALIGN_LABELS[a],
            `align-${a}`,
            <Icone className="w-3.5 h-3.5" />,
          );
        })}
      </div>
    </div>
  );
}
