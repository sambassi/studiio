'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import type { ActiveGuide, GapBadge, ElementBox, FrameFormat } from '@/lib/creer/smartGuides';

interface Props {
  /** Lignes d'alignement, affichees le temps de la coincidence. */
  guides?: ActiveGuide[];
  /** Ecarts bord-a-bord du bloc selectionne ou deplace. */
  gaps?: GapBadge[];
  /** Emprise du bloc actif — dessine son cadre de selection. */
  selection?: Pick<ElementBox, 'left' | 'top' | 'right' | 'bottom'> | null;
  /** Grille de reperage 8 × 8. */
  showGrid?: boolean;
  /** Croix de centre — le VRAI milieu du format actif. */
  showCenter?: boolean;
  /** Lignes des tiers (33 % / 66 %). */
  showThirds?: boolean;
  /** Format actif : sert au libelle, jamais aux positions. */
  format?: FrameFormat;
  /** Pastille « 9:16 » / « 16:9 » en haut a gauche. */
  showRatioLabel?: boolean;
}

/**
 * ⚠️ MAGENTA ET RIEN QUE LE NOMBRE.
 *
 * La version precedente ecrivait le nom des deux blocs sous chaque chiffre —
 * « APRES: PROTEINES ↕ BANANE », « = Cadre ». Quatre mesures autour d'un bloc,
 * c'etaient quatre phrases posees sur l'apercu : illisible, et le « = » d'un
 * NOM se confondait avec le « = » d'une EGALITE. Un instrument de mesure ne
 * commente pas, il chiffre. Le nom du voisin reste disponible en attribut
 * (`data-guide-target`) pour le diagnostic, jamais a l'ecran.
 *
 * Le magenta est la couleur de marque ; le halo sombre le garde lisible sur
 * une affiche claire comme sur un fond noir.
 */
const MAGENTA = '#D91CD2';
const WHITE = '#FFFFFF';
/** Halo sombre : c'est lui qui rend le trait net sur un fond clair. */
const HALO = '0 0 0 1px rgba(0,0,0,0.45)';
const SOFT_LINE = 'rgba(255,255,255,0.28)';
const THIRDS_LINE = 'rgba(255,255,255,0.16)';
const GRID_LINE = 'rgba(255,255,255,0.10)';
/** Longueur des reperes d'extremite, en pixels d'ECRAN. */
const TICK_PX = 8;

const EMPTY_GUIDES: ActiveGuide[] = [];
const EMPTY_GAPS: GapBadge[] = [];

/** Garde la pastille dans le cadre : le calque est `overflow: hidden`. */
const clampPct = (v: number) => Math.max(5, Math.min(95, v));

/**
 * Calque de reperes pose sur l'apercu — partage par Creer avance et
 * Creer simple.
 *
 * ⚠️ EN HTML, PAS EN SVG ETIRE. La version d'origine dessinait tout dans un
 * `viewBox="0 0 100 100"` avec `preserveAspectRatio="none"` : un carre etire
 * au format du cadre. En 9:16 cela multipliait les hauteurs par 1,78 — la
 * croix de centre devenait un « x » aplati et le texte illisible. Ici chaque
 * repere est un bloc positionne en POURCENTAGE (donc juste dans les trois
 * formats) dont les epaisseurs et la police sont en PIXELS D'ECRAN (donc
 * jamais deformees).
 *
 * `absolute inset-0 pointer-events-none` : le calque ne recoit aucun geste,
 * les poignees dessous restent saisissables.
 */
export default function SmartGuides({
  guides = EMPTY_GUIDES,
  gaps = EMPTY_GAPS,
  selection = null,
  showGrid = false,
  showCenter = false,
  showThirds = false,
  format = '9:16',
  showRatioLabel = false,
}: Props) {
  /**
   * Centre du format atteint ?
   *
   * Se deduit des mesures elles-memes : etre a egale distance des DEUX bords
   * du cadre, c'est la definition d'etre centre sur cet axe. Un etat separe
   * dirait la meme chose avec un risque de desaccord en plus.
   */
  const centredOn = (a: GapBadge['side'], b: GapBadge['side']) =>
    gaps.some((g) => g.side === a && g.target === 'frame' && g.equal)
    && gaps.some((g) => g.side === b && g.target === 'frame' && g.equal);
  const centeredX = centredOn('left', 'right');
  const centeredY = centredOn('top', 'bottom');

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      {showGrid &&
        Array.from({ length: 7 }, (_, i) => {
          const p = (100 / 8) * (i + 1);
          return (
            <React.Fragment key={`grid-${i}`}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${p}%`, borderLeft: `1px solid ${GRID_LINE}` }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: `${p}%`, borderTop: `1px solid ${GRID_LINE}` }} />
            </React.Fragment>
          );
        })}

      {showThirds &&
        [100 / 3, 200 / 3].map((p, i) => (
          <React.Fragment key={`thirds-${i}`}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${p}%`, borderLeft: `1px dashed ${THIRDS_LINE}` }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${p}%`, borderTop: `1px dashed ${THIRDS_LINE}` }} />
          </React.Fragment>
        ))}

      {/* Croix de centre — 50 % de la largeur et 50 % de la hauteur du cadre
          REEL, donc le vrai milieu en 9:16 comme en 16:9. Discrete au repos,
          pleine et magenta des que le bloc y est pose. */}
      {showCenter && (
        <>
          <div
            data-guide-center-x
            data-guide-centered={centeredX ? 'true' : 'false'}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              borderLeft: centeredX ? `2px solid ${MAGENTA}` : `1px dashed ${SOFT_LINE}`,
              boxShadow: centeredX ? HALO : undefined,
            }}
          />
          <div
            data-guide-center-y
            data-guide-centered={centeredY ? 'true' : 'false'}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              borderTop: centeredY ? `2px solid ${MAGENTA}` : `1px dashed ${SOFT_LINE}`,
              boxShadow: centeredY ? HALO : undefined,
            }}
          />
          <div
            data-guide-center-mark
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              color: centeredX || centeredY ? MAGENTA : SOFT_LINE,
              filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.9))',
              lineHeight: 0,
            }}
          >
            <Plus size={12} strokeWidth={2} />
          </div>
        </>
      )}

      {showRatioLabel && (
        <div data-guide-ratio style={{ ...chipBase, left: 6, top: 6 }}>
          {format}
        </div>
      )}

      {/* Cadre de selection — le bloc actif, entoure de magenta avec ses
          quatre coins. Il vit dans le calque plutot que sur chaque element :
          les deux editeurs l'obtiennent ainsi a l'identique. */}
      {selection && (
        <>
          <div
            data-guide-selection
            style={{
              position: 'absolute',
              left: `${selection.left}%`,
              top: `${selection.top}%`,
              width: `${Math.max(0, selection.right - selection.left)}%`,
              height: `${Math.max(0, selection.bottom - selection.top)}%`,
              border: `1px solid ${MAGENTA}`,
              boxShadow: HALO,
            }}
          />
          {([
            [selection.left, selection.top],
            [selection.right, selection.top],
            [selection.left, selection.bottom],
            [selection.right, selection.bottom],
          ] as const).map(([x, y], i) => (
            <div
              key={`corner-${i}`}
              data-guide-corner
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: 6,
                height: 6,
                marginLeft: -3,
                marginTop: -3,
                borderRadius: 1,
                background: WHITE,
                border: `1px solid ${MAGENTA}`,
                boxShadow: HALO,
              }}
            />
          ))}
        </>
      )}

      {guides.map((g, i) => (
        <div
          key={`guide-${g.axis}-${g.source}-${i}`}
          data-guide-line={g.source}
          style={{
            position: 'absolute',
            boxShadow: HALO,
            ...(g.axis === 'x'
              ? { top: 0, bottom: 0, left: `${g.pos}%`, borderLeft: `1px solid ${MAGENTA}` }
              : { left: 0, right: 0, top: `${g.pos}%`, borderTop: `1px solid ${MAGENTA}` }),
          }}
        />
      ))}

      {gaps.map((b, i) => (
        <GapMeasure key={`gap-${b.side}-${b.targetKey ?? 'frame'}-${i}`} badge={b} />
      ))}
    </div>
  );
}

const chipBase: React.CSSProperties = {
  position: 'absolute',
  padding: '1px 5px',
  borderRadius: 9,
  background: MAGENTA,
  color: WHITE,
  fontSize: 10,
  fontWeight: 700,
  lineHeight: '14px',
  whiteSpace: 'nowrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  boxShadow: '0 1px 3px rgba(0,0,0,0.55)',
};

/**
 * Un ecart : le trait qui couvre EXACTEMENT le vide, ses deux reperes
 * d'extremite, et la pastille qui porte le NOMBRE — rien d'autre.
 *
 * ⚠️ PLUS DE SIGNE « = ». Un badge n'existe desormais QUE dans une paire
 * d'ecarts egaux : le signe serait sur tous, donc ne distinguerait plus rien.
 * Ce qui dit « reparti egalement », c'est la repetition du MEME NOMBRE de
 * part et d'autre — la seule chose que l'oeil ait besoin de comparer.
 */
function GapMeasure({ badge }: { badge: GapBadge }) {
  const span = Math.abs(badge.gapPct);
  const half = span / 2;
  const vertical = badge.axis === 'y';

  const line: React.CSSProperties = vertical
    ? {
        position: 'absolute',
        left: `${badge.midXPct}%`,
        top: `${badge.midYPct - half}%`,
        height: `${span}%`,
        borderLeft: `1px solid ${MAGENTA}`,
        boxShadow: HALO,
      }
    : {
        position: 'absolute',
        top: `${badge.midYPct}%`,
        left: `${badge.midXPct - half}%`,
        width: `${span}%`,
        borderTop: `1px solid ${MAGENTA}`,
        boxShadow: HALO,
      };

  /** Repere d'extremite, pose sur le bord mesure et perpendiculaire au trait. */
  const tick = (at: number): React.CSSProperties => vertical
    ? {
        position: 'absolute',
        left: `${badge.midXPct}%`,
        top: `${at}%`,
        width: TICK_PX,
        marginLeft: -TICK_PX / 2,
        borderTop: `1px solid ${MAGENTA}`,
        boxShadow: HALO,
      }
    : {
        position: 'absolute',
        top: `${badge.midYPct}%`,
        left: `${at}%`,
        height: TICK_PX,
        marginTop: -TICK_PX / 2,
        borderLeft: `1px solid ${MAGENTA}`,
        boxShadow: HALO,
      };

  const debut = vertical ? badge.midYPct - half : badge.midXPct - half;
  const fin = vertical ? badge.midYPct + half : badge.midXPct + half;

  return (
    <>
      <div style={line} />
      <div style={tick(debut)} />
      <div style={tick(fin)} />
      <div
        data-guide-gap={badge.side}
        // Diagnostic seulement : le nom du voisin ne s'ecrit plus a l'ecran.
        data-guide-target={badge.targetKey ?? 'frame'}
        style={{
          ...chipBase,
          left: `${clampPct(badge.midXPct)}%`,
          top: `${clampPct(badge.midYPct)}%`,
          transform: 'translate(-50%, -50%)',
        }}
      >
        {badge.gapPx}
      </div>
    </>
  );
}
