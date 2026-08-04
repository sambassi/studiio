import React from 'react';
import { CardIcon } from '@/components/ui/CardIcon';

/**
 * Les elements libres du montage — composant PARTAGE par les deux moteurs.
 *
 * Meme methode que les cartes (Phase 2) et que le titre / le CTA (Phase 4) :
 * un seul composant monte par l'apercu ET par la composition Remotion, donc
 * parite par construction plutot que par recalage.
 *
 * ⚠️ CE COMPOSANT PORTE UNE DEPENDANCE QUE LES PRECEDENTS N'AVAIENT PAS.
 *
 * L'export navigateur ne rasterise pas ces icones depuis les donnees : il va
 * LIRE LE SVG DANS LE DOM DE L'APERCU, par
 * `document.querySelector('[data-free-element="<id>"] svg')`, puis le serialise
 * en `data:image/svg+xml` pour le blitter au canvas. Deux consequences qui ne
 * se rattrapent pas :
 *
 * 1. L'attribut `data-free-element` est un CONTRAT, pas une commodite de test.
 *    Le retirer ou le renommer ne casse rien a la compilation : l'export perd
 *    simplement tous les elements, en silence.
 * 2. Le SVG doit rester un enfant direct du meme noeud. Un conteneur
 *    intermediaire ne generait pas la requete, mais toute bascule vers un
 *    rendu non-SVG (image, police d'icones) coupe l'export sans prevenir.
 *
 * Les aides d'edition — anneau de selection, poignees de coin, bouton de
 * suppression — passent par `interaction`, absent cote serveur : aucune ne
 * peut se graver dans la video. Le `zIndex` en fait partie ; il n'existe que
 * pour garder un element saisissable par-dessus le titre et le CTA.
 *
 * Aucune classe Tailwind : le bundle Remotion n'a pas la feuille de
 * l'application (lecon de la Phase 2).
 */

export interface FreeElement {
  id: string;
  iconName: string;
  /** Centre de l'element, en % du PLATEAU — la composition entiere. */
  x: number;
  y: number;
  /**
   * Cote de l'icone, en % de la LARGEUR du plateau.
   *
   * En pourcentage et non en pixels : un montage change de format sans changer
   * d'elements, et une taille en px vaudrait le double en 16:9.
   */
  sizePct: number;
  color: string;
}

/** Aides d'edition — presentes dans l'apercu, ABSENTES du rendu serveur. */
export interface FreeElementsInteraction {
  onElementDragStart?: (id: string, e: React.PointerEvent) => void;
  onDragMove?: (e: React.PointerEvent) => void;
  onDragEnd?: () => void;
  selectedElementId?: string | null;
  /** Pendant la photo des cartes : aucune aide n'est peinte. */
  capturing?: boolean;
  /** Convertit des pixels d'ecran en pixels du plateau reduit. */
  uiPx?: (n: number) => number;
  /**
   * Poignees et bouton de suppression, rendus par l'appelant.
   *
   * Ils vivent dans le repere de l'element — d'ou le passage par ce composant
   * plutot qu'a cote : les recreer dehors demanderait de redire ici la regle
   * de placement, et c'est exactement la divergence que la Phase 5 supprime.
   */
  renderChrome?: (el: FreeElement) => React.ReactNode;
}

export interface FreeElementsLayerProps {
  elements: FreeElement[];
  /**
   * Largeur de reference — la largeur VIDEO, pas la largeur affichee. Le
   * plateau de l'apercu fait deja 1080 px et n'est reduit que par un
   * `transform: scale`, si bien que la meme valeur sert des deux cotes.
   */
  containerWidth: number;
  interaction?: FreeElementsInteraction;
}

/**
 * Cote de l'icone, en pixels de composition.
 *
 * La MEME regle que `freeElementRect` du compositeur canvas
 * (`(sizePct / 100) * w`), verifiee par test : c'est elle qui decide si un
 * element sort a la bonne taille dans la video.
 */
export function freeElementSizePx(sizePct: number, containerWidth: number): number {
  return Math.round((sizePct / 100) * containerWidth);
}

export default function FreeElementsLayer({
  elements,
  containerWidth,
  interaction,
}: FreeElementsLayerProps) {
  const it = interaction;
  const editable = !!it?.onElementDragStart;

  return (
    <>
      {(elements ?? []).map((el) => (
        <div
          key={el.id}
          // ⚠️ Contrat de l'export navigateur — voir l'en-tete.
          data-free-element={el.id}
          onPointerDown={it?.onElementDragStart ? (e) => it.onElementDragStart!(el.id, e) : undefined}
          onPointerMove={it?.onDragMove}
          onPointerUp={it?.onDragEnd}
          onPointerCancel={it?.onDragEnd}
          onLostPointerCapture={it?.onDragEnd}
          title={editable ? 'Glisser pour déplacer l’élément' : undefined}
          style={{
            position: 'absolute',
            // `x` / `y` designent le CENTRE, comme `freeElementRect` cote
            // canvas, qui retranche la moitie du cote.
            left: `${el.x}%`,
            top: `${el.y}%`,
            transform: 'translate(-50%, -50%)',
            // Sans cela, la boite de ligne ajouterait quelques pixels sous
            // l'icone et decalerait son centre vers le haut.
            lineHeight: 0,
            // ── Aides d'edition ──────────────────────────────────────────
            cursor: editable ? 'grab' : undefined,
            touchAction: editable ? 'none' : undefined,
            // Au-dessus du titre et du CTA (zIndex 2) : un element depose sur
            // eux doit rester saisissable. Purement editorial.
            zIndex: it ? 4 : undefined,
            outline:
              it && !it.capturing && it.selectedElementId === el.id
                ? `${(it.uiPx ?? ((n: number) => n))(2)}px solid #FFFFFF`
                : undefined,
            outlineOffset: it ? (it.uiPx ?? ((n: number) => n))(2) : undefined,
          }}
        >
          <CardIcon
            name={el.iconName}
            size={freeElementSizePx(el.sizePct, containerWidth)}
            color={el.color}
            className=""
          />
          {it?.renderChrome?.(el)}
        </div>
      ))}
    </>
  );
}
