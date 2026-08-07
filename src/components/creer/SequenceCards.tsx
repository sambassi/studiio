import React from 'react';
import { isFrameless } from '@/lib/creer/cardStyles';
import { fontStack } from '@/lib/fonts/catalog';
import {
  cssTextTransform, cssTextDecoration,
  DECORATION_THICKNESS_RATIO, UNDERLINE_OFFSET_RATIO,
  type TextCase, type TextAlign,
} from '@/lib/creer/textFormat';
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
/**
 * Typographie du texte des cartes.
 *
 * ⚠️ TOUT EST OPTIONNEL, ET L'ABSENCE EST LE RENDU D'AUJOURD'HUI. Les cartes
 * n'avaient aucun reglage : libelle en 600, valeur en 700, taille derivee du
 * seul format. Une propriete absente ne doit donc rien changer.
 *
 * ⚠️ ET CE COMPOSANT SUFFIT A LA PARITE. « Creer simple » PHOTOGRAPHIE ce
 * conteneur (`cardsSnapshot`) et le compositeur blitte l'image telle quelle ;
 * l'Autopilote, lui, rend ce meme composant sous Remotion. Les deux moteurs
 * lisent donc le meme JSX — il n'y a pas de seconde implementation a recaler.
 */
export interface CardsTypography {
  font?: string;
  /** Echelle du texte ET de l'icone. 1 = la taille d'aujourd'hui. */
  scale?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textCase?: TextCase;
  align?: TextAlign;
}

export interface CardsInteraction {
  onCardDragStart?: (id: string, e: React.PointerEvent) => void;
  /**
   * Prise d'une poignee de coin sur une carte — agrandir SON texte.
   *
   * ⚠️ ABSENT = AUCUNE POIGNEE. Les poignees n'existaient que pour le titre
   * et le CTA : sur une carte, tirer un coin ne faisait rien.
   */
  onCardResizeStart?: (id: string, e: React.PointerEvent) => void;
  /**
   * Double-clic sur une carte — ouvre le choix de son icône.
   *
   * ⚠️ ABSENT = AUCUN GESTIONNAIRE, donc l'assistant manuel est inchangé : il
   * n'a pas d'icône à choisir par carte, son contenu venant du générateur.
   * L'Autopilote, lui, fige l'icône du rang N pour toutes ses vidéos.
   */
  onCardDoubleClick?: (id: string) => void;
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

/**
 * Style de carte — les memes libelles que `CARD_STYLE_OPTIONS`.
 *
 * ⚠️ SEUL « Text Only » CHANGE QUELQUE CHOSE ICI, et c'est assume. Le
 * compositeur canvas dessine cinq mises en page distinctes ; ce composant
 * n'en rend qu'une — celle qui est a l'ecran depuis toujours. Ce que
 * l'utilisateur demandait, c'est de pouvoir RETIRER le cadre : c'est
 * exactement ce que fait « Text Only », des deux cotes. Les autres libelles
 * sont acceptes et rendus comme aujourd'hui, plutot que refuses.
 */
export interface SequenceCardsProps {
  cards: SequenceCard[];
  /**
   * Style de carte. Absent = le cadre, comme depuis toujours.
   *
   * ⚠️ LE DEFAUT PORTE LA RETRO-COMPATIBILITE : tout montage deja enregistre
   * n'a pas ce champ et doit continuer a sortir avec son rectangle.
   */
  cardStyle?: string;
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
  /** Typographie du texte des cartes. Absente = le rendu d'aujourd'hui. */
  typography?: CardsTypography;
  interaction?: CardsInteraction;
  containerRef?: React.RefObject<HTMLDivElement>;
}

export default function SequenceCards({
  cards,
  cardBoxes = null,
  containerWidth,
  landscape,
  valueColor,
  cardStyle,
  typography,
  interaction,
  containerRef,
}: SequenceCardsProps) {
  const vw = containerWidth;
  const CR = cardRatios(landscape);
  const it = interaction;
  const uiPx = it?.uiPx ?? ((n: number) => n);
  const editable = !!it?.onCardDragStart;
  /**
   * « Sans cadre » : ni fond, ni arrondi, ni rembourrage.
   *
   * ⚠️ LE REMBOURRAGE PART AVEC LE FOND. Le garder laisserait un espacement
   * qui n'entoure plus rien : les cartes paraitraient flotter loin les unes
   * des autres, alors que le compositeur canvas, lui, colle le texte au bord.
   */
  const sansCadre = isFrameless(cardStyle);

  // ── Typographie des cartes ────────────────────────────────────────────
  // `??` et non `||` : une echelle de 0 serait un reglage, pas une absence.
  const echelle = typography?.scale ?? 1;
  const casse = cssTextTransform(typography?.textCase);
  const trait = cssTextDecoration(typography?.underline, typography?.strike);
  /** Style commun au libelle et a la valeur — une seule source. */
  const styleTexte = (taille: number): React.CSSProperties => ({
    fontFamily: typography?.font ? fontStack(typography.font) : undefined,
    fontStyle: typography?.italic ? 'italic' : undefined,
    textTransform: casse,
    textDecoration: trait,
    // Memes ratios que le titre et le CTA — voir `textFormat.ts`.
    textDecorationThickness: trait ? Math.max(1, taille * DECORATION_THICKNESS_RATIO) : undefined,
    textUnderlineOffset: trait ? taille * UNDERLINE_OFFSET_RATIO : undefined,
    textAlign: typography?.align,
  });

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
            onDoubleClick={it?.onCardDoubleClick ? () => it.onCardDoubleClick!(c.id) : undefined}
            title={
              it?.onCardDoubleClick
                ? 'Double-clic pour changer l’icône'
                : editable ? 'Glisser pour déplacer la carte' : undefined
            }
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
              backgroundColor: sansCadre ? undefined : 'rgba(255,255,255,0.08)',
              gap: vw * CR.gap,
              borderRadius: sansCadre ? undefined : vw * CR.radius,
              padding: sansCadre ? `${vw * CR.padY}px 0` : `${vw * CR.padY}px ${vw * CR.padX}px`,
              ...(box
                // La HAUTEUR mesuree est reappliquee : sans elle, une carte
                // absolue se retrecirait a son contenu au moment meme de la
                // bascule.
                ? {
                    position: 'absolute' as const,
                    left: `${box.x}%`, top: `${box.y}%`,
                    width: `${box.w}%`, height: `${box.h}%`,
                  }
                // ⚠️ CONTEXTE DE POSITIONNEMENT POUR LES POIGNEES. Sans lui,
                // elles se placeraient sur le plus proche ancetre positionne
                // — la GRILLE — et les quatre coins de chaque carte se
                // retrouveraient empiles aux quatre coins du bloc.
                : it?.onCardResizeStart ? { position: 'relative' as const } : null),
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
              // L'icone suit l'echelle du texte : l'agrandir seul donnerait
              // une carte au pictogramme minuscule a cote d'un texte enorme.
              size={Math.round(vw * CR.icon * echelle)}
              color="#FFFFFF"
              className=""
            />
            <span
              style={{
                // `truncate` de Tailwind = ces trois proprietes.
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                // `?? 600` : la graisse d'aujourd'hui tant que rien n'est
                // choisi. `bold: false` reste un reglage, pas une absence.
                fontWeight: typography?.bold === undefined ? 600 : (typography.bold ? 900 : 400),
                color: '#FFFFFF',
                ...(landscape && !cardBoxes ? { maxWidth: '100%' } : { flex: '1 1 0%' }),
                fontSize: vw * CR.text * echelle,
                lineHeight: landscape ? CARD_RATIO_LANDSCAPE.line : undefined,
                ...styleTexte(vw * CR.text * echelle),
              }}
            >
              {c.title}
            </span>
            {c.value && (
              <span
                style={{
                  fontWeight: typography?.bold === undefined ? 700 : (typography.bold ? 900 : 400),
                  ...(landscape && !cardBoxes ? null : { flexShrink: 0 }),
                  fontSize: vw * CR.value * echelle,
                  lineHeight: landscape ? CARD_RATIO_LANDSCAPE.line : undefined,
                  color: valueColor,
                  ...styleTexte(vw * CR.value * echelle),
                }}
              >
                {c.value}
              </span>
            )}
            {/* ── POIGNEES DE COIN ────────────────────────────────────
                ⚠️ ELLES N'EXISTAIENT QUE POUR LE TITRE ET LE CTA : sur une
                carte, tirer un coin ne faisait rien. Elles agrandissent le
                TEXTE de la carte, pas sa boite — c'est ce que l'utilisateur
                demande quand il tire sur un mot.

                Absentes sans `onCardResizeStart`, et effacees pendant la
                photo : le conteneur des cartes est justement ce que
                `modern-screenshot` capture pour la video. */}
            {it?.onCardResizeStart && !it.capturing && ([
              { coin: 'nw', top: 0, left: 0 },
              { coin: 'ne', top: 0, left: '100%' },
              { coin: 'sw', top: '100%', left: 0 },
              { coin: 'se', top: '100%', left: '100%' },
            ] as const).map((p) => (
              <span
                key={p.coin}
                data-card-handle={`${c.id}-${p.coin}`}
                onPointerDown={(e) => { e.stopPropagation(); it.onCardResizeStart!(c.id, e); }}
                onPointerMove={it.onDragMove}
                onPointerUp={it.onDragEnd}
                onPointerCancel={it.onDragEnd}
                onLostPointerCapture={it.onDragEnd}
                title="Tirer pour agrandir le texte de la carte"
                style={{
                  position: 'absolute',
                  top: p.top,
                  left: p.left,
                  width: uiPx(9),
                  height: uiPx(9),
                  marginTop: -uiPx(4.5),
                  marginLeft: -uiPx(4.5),
                  backgroundColor: '#FFFFFF',
                  border: `${uiPx(1)}px solid rgba(0,0,0,0.5)`,
                  borderRadius: uiPx(2),
                  cursor: p.coin === 'nw' || p.coin === 'se' ? 'nwse-resize' : 'nesw-resize',
                  touchAction: 'none',
                  zIndex: 5,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
