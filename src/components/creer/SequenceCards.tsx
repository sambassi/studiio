import React from 'react';
import { CardIcon } from '@/components/ui/CardIcon';
import { cardRatios, CARDS_FRAME, CARD_RATIO_LANDSCAPE } from '@/lib/creer/designSpec';

/**
 * Les cartes du montage — composant PARTAGÉ par les deux moteurs de rendu.
 *
 * C'est la pièce qui rend la parité possible « par construction » : Remotion
 * rend du React dans son propre Chromium, donc **le même composant produit la
 * même image** dans l'aperçu et dans le rendu serveur. Ni redessin parallèle,
 * ni photographie à recaler.
 *
 * ⚠️ LA SÉPARATION QUI COMMANDE TOUT : la PRÉSENTATION d'un côté, les AIDES
 * D'ÉDITION de l'autre.
 *
 * Le bloc d'origine mêlait les deux — liseré de sélection, curseur de
 * glissement, teinte de groupe, `zIndex`. Ces aides n'existent QUE dans
 * l'éditeur ; côté serveur il n'y a ni pointeur ni sélection. Elles passent
 * donc par `interaction`, absent du rendu serveur — ce qui garantit qu'aucune
 * ne peut se glisser dans la vidéo.
 *
 * Toutes les mesures viennent de `designSpec` : aucune valeur en dur ici.
 *
 * ⚠️ AUCUNE CLASSE TAILWIND — et c'est la deuxième condition de la parité,
 * découverte en rendant : Remotion a son propre bundle webpack, sans la
 * feuille Tailwind de l'application. Les classes n'y produisaient RIEN, et les
 * cartes sortaient invisibles — conteneur en `position: static`, donc cadre
 * ignoré, et pas de `display: flex`.
 *
 * Partager le composant ne suffit donc pas : il doit être AUTONOME, sans
 * dépendance à la chaîne CSS de son hôte. Chaque classe est traduite en style
 * en ligne équivalent, ce qui rend le résultat identique des deux côtés par
 * construction plutôt que par configuration.
 */

export interface SequenceCard {
  id: string;
  icon: string;
  title: string;
  value?: string;
  description?: string;
}

export interface CardBox { x: number; y: number; w: number; h: number }

/** Aides d'édition — présentes dans l'aperçu, ABSENTES du rendu serveur. */
export interface CardsInteraction {
  onCardDragStart?: (id: string, e: React.PointerEvent) => void;
  onDragMove?: (e: React.PointerEvent) => void;
  onDragEnd?: () => void;
  draggingCard?: string | null;
  selectedCards?: Set<string>;
  groupedCards?: Record<string, string>;
  /** Pendant la photo des cartes : aucune aide n'est peinte. */
  capturing?: boolean;
  /** Convertit des pixels d'écran en pixels du plateau réduit. */
  uiPx?: (n: number) => number;
  /** Teinte du filet de groupe. */
  groupTint?: string;
}

export interface SequenceCardsProps {
  cards: SequenceCard[];
  /** Positions libres, ou `null` pour la disposition en flux. */
  cardBoxes?: Record<string, CardBox> | null;
  /**
   * Largeur de référence des mesures — la largeur VIDÉO, pas la largeur
   * affichée. Le plateau de l'aperçu fait déjà 1080 px de large et n'est
   * réduit que par un `transform: scale`, si bien que la même valeur sert des
   * deux côtés.
   */
  containerWidth: number;
  /** Le format est-il paysage ? Il a sa propre table de mesures. */
  landscape: boolean;
  /** Couleur de la valeur — la fin du dégradé de marque. */
  valueColor: string;
  interaction?: CardsInteraction;
  containerRef?: React.RefObject<HTMLDivElement>;
}

export default function SequenceCards({
  cards,
  cardBoxes = null,
  containerWidth,
  landscape,
  valueColor,
  interaction,
  containerRef,
}: SequenceCardsProps) {
  const vw = containerWidth;
  const CR = cardRatios(landscape);
  const it = interaction;
  const uiPx = it?.uiPx ?? ((n: number) => n);
  const editable = !!it?.onCardDragStart;

  return (
    <div
      ref={containerRef}
      data-cards-grid
      style={{
        position: 'absolute',
        ...(cardBoxes
          ? null
          : landscape
            ? { display: 'grid' }
            : { display: 'flex', flexDirection: 'column' as const, justifyContent: 'center' }),
        ...CARDS_FRAME,
        // En mode libre chaque carte porte sa position : l'ecart du flux n'a
        // plus lieu d'etre.
        gap: cardBoxes ? undefined : vw * CR.gap,
        // Paysage : une GRILLE de trois colonnes. Empilees en colonne, cinq
        // cartes formaient une pile deux fois plus haute que leur conteneur —
        // et ce conteneur est photographie puis blitte, donc la video sortait
        // avec des cartes rognees en haut et en bas.
        ...(landscape && !cardBoxes
          ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignContent: 'center' as const }
          : null),
      }}
    >
      {cards.map((c) => {
        const box = cardBoxes?.[c.id];
        return (
          <div
            key={c.id}
            data-card-id={c.id}
            onPointerDown={it?.onCardDragStart ? (e) => it.onCardDragStart!(c.id, e) : undefined}
            onPointerMove={it?.onDragMove}
            onPointerUp={it?.onDragEnd}
            onPointerCancel={it?.onDragEnd}
            onLostPointerCapture={it?.onDragEnd}
            title={editable ? 'Glisser pour déplacer la carte' : undefined}
            // En grille, la carte s'empile comme la carte « Compact » du
            // compositeur : icone, libelle, valeur. En ligne sur un tiers de
            // largeur, le libelle serait reduit a deux caracteres et une
            // ellipse.
            style={{
              display: 'flex',
              ...(landscape && !cardBoxes
                ? {
                    flexDirection: 'column' as const,
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center' as const,
                  }
                : { alignItems: 'center' }),
              backgroundColor: 'rgba(255,255,255,0.08)',
              gap: vw * CR.gap,
              borderRadius: vw * CR.radius,
              padding: `${vw * CR.padY}px ${vw * CR.padX}px`,
              ...(box
                // La HAUTEUR mesuree est reappliquee : sans elle, une carte
                // absolue se retrecirait a son contenu au moment meme de la
                // bascule.
                ? {
                    position: 'absolute' as const,
                    left: `${box.x}%`, top: `${box.y}%`,
                    width: `${box.w}%`, height: `${box.h}%`,
                  }
                : null),
              // ── Aides d'edition ────────────────────────────────────────
              // Toutes conditionnees a `interaction` : cote serveur, aucune
              // ne peut se retrouver dans la video.
              cursor: editable ? (it!.draggingCard === c.id ? 'grabbing' : 'grab') : undefined,
              touchAction: editable ? 'none' : undefined,
              zIndex: it?.draggingCard === c.id ? 1 : undefined,
              // Glissement : pointille, comme le titre et le CTA.
              // Selection : trait plein BLANC — le fond du plateau EST le
              // degrade d'accent par defaut, un lisere accent y serait
              // invisible.
              outline: !it || it.capturing
                ? undefined
                : it.draggingCard === c.id
                  ? `${uiPx(1)}px dashed rgba(255,255,255,0.7)`
                  : it.selectedCards?.has(c.id)
                    ? `${uiPx(2)}px solid #FFFFFF`
                    : undefined,
              boxShadow: !it || it.capturing
                ? undefined
                : it.draggingCard !== c.id && it.selectedCards?.has(c.id)
                  ? `0 0 0 ${uiPx(3)}px rgba(0,0,0,0.5)`
                  // Groupe : un filet lateral discret, du cote gauche.
                  : it.groupedCards?.[c.id] && it.groupTint
                    ? `inset ${uiPx(3)}px 0 0 0 ${it.groupTint}`
                    : undefined,
              outlineOffset: it ? uiPx(2) : undefined,
            }}
          >
            <CardIcon
              name={c.icon}
              size={Math.round(vw * CR.icon)}
              color="#FFFFFF"
              className=""
            />
            <span
              style={{
                // `truncate` de Tailwind = ces trois proprietes.
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                color: '#FFFFFF',
                ...(landscape && !cardBoxes ? { maxWidth: '100%' } : { flex: '1 1 0%' }),
                fontSize: vw * CR.text,
                lineHeight: landscape ? CARD_RATIO_LANDSCAPE.line : undefined,
              }}
            >
              {c.title}
            </span>
            {c.value && (
              <span
                style={{
                  fontWeight: 700,
                  ...(landscape && !cardBoxes ? null : { flexShrink: 0 }),
                  fontSize: vw * CR.value,
                  lineHeight: landscape ? CARD_RATIO_LANDSCAPE.line : undefined,
                  color: valueColor,
                }}
              >
                {c.value}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
