'use client';

import React from 'react';
import { Equal, Plus } from 'lucide-react';
import type { ActiveGuide, GapBadge, FrameFormat } from '@/lib/creer/smartGuides';

interface Props {
  /** Lignes magnetiques, affichees pendant un glissement. */
  guides?: ActiveGuide[];
  /** Ecarts bord-a-bord de l'element mis en avant. */
  gaps?: GapBadge[];
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

const MAGENTA = '#D91CD2';
const EQUAL_GREEN = '#34D399';
const CENTER_LINE = 'rgba(168,85,247,0.45)';
const THIRDS_LINE = 'rgba(168,85,247,0.22)';
const GRID_LINE = 'rgba(255,255,255,0.10)';

const EMPTY_GUIDES: ActiveGuide[] = [];
const EMPTY_GAPS: GapBadge[] = [];

/**
 * Calque de reperes pose sur l'apercu — partage par Creer avance et
 * Creer simple.
 *
 * ⚠️ EN HTML, PAS EN SVG ETIRE. La version precedente dessinait tout dans un
 * `viewBox="0 0 100 100"` avec `preserveAspectRatio="none"` : un carre etire
 * au format du cadre. En 9:16 cela multipliait les hauteurs par 1,78 — la
 * croix de centre devenait un « x » aplati, les pastilles de mesure des
 * rectangles etires et le texte illisible. Ici chaque repere est un bloc
 * positionne en POURCENTAGE (donc juste dans les deux formats) dont les
 * epaisseurs et la police sont en PIXELS D'ECRAN (donc jamais deformees).
 *
 * `absolute inset-0 pointer-events-none` : le calque ne recoit aucun geste,
 * les poignees dessous restent saisissables.
 */
export default function SmartGuides({
  guides = EMPTY_GUIDES,
  gaps = EMPTY_GAPS,
  showGrid = false,
  showCenter = false,
  showThirds = false,
  format = '9:16',
  showRatioLabel = false,
}: Props) {
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
          REEL, donc le vrai milieu en 9:16 comme en 16:9. Le marqueur central
          leve l'ambiguite quand une autre ligne passe au meme endroit. */}
      {showCenter && (
        <>
          <div data-guide-center-x style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: `1px dashed ${CENTER_LINE}` }} />
          <div data-guide-center-y style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: `1px dashed ${CENTER_LINE}` }} />
          <div
            data-guide-center-mark
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              color: CENTER_LINE,
              lineHeight: 0,
            }}
          >
            <Plus size={14} strokeWidth={2} />
          </div>
        </>
      )}

      {showRatioLabel && (
        <div
          data-guide-ratio
          style={{
            position: 'absolute',
            left: 6,
            top: 6,
            padding: '2px 6px',
            borderRadius: 6,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#E9D5FF',
            background: 'rgba(17,17,24,0.75)',
            border: '1px solid rgba(168,85,247,0.35)',
          }}
        >
          {format}
        </div>
      )}

      {guides.map((g, i) => (
        <div
          key={`guide-${g.axis}-${i}`}
          style={
            g.axis === 'x'
              ? { position: 'absolute', top: 0, bottom: 0, left: `${g.pos}%`, borderLeft: `1px dashed ${g.source === 'equal-gap' ? EQUAL_GREEN : MAGENTA}` }
              : { position: 'absolute', left: 0, right: 0, top: `${g.pos}%`, borderTop: `1px dashed ${g.source === 'equal-gap' ? EQUAL_GREEN : MAGENTA}` }
          }
        />
      ))}

      {gaps.map((b, i) => (
        <GapMeasure key={`gap-${b.side}-${i}`} badge={b} />
      ))}
    </div>
  );
}

/**
 * Un ecart : le trait qui couvre EXACTEMENT le vide mesure, et sa pastille.
 *
 * La pastille est un bloc HTML a police fixe : elle garde la meme forme quel
 * que soit le format du cadre. Vert avec un signe « egal » lorsque l'ecart
 * oppose vaut le meme — c'est la confirmation visuelle du centrage.
 */
function GapMeasure({ badge }: { badge: GapBadge }) {
  const color = badge.equal ? EQUAL_GREEN : MAGENTA;
  // Pointilles quand rien ne se trouve en vis-a-vis. Le chiffre reste un vrai
  // ecart bord-a-bord, mais il ne doit pas se lire comme un alignement.
  const trait = badge.aligned ? 'solid' : 'dashed';
  const half = Math.abs(badge.gapPct) / 2;
  const line: React.CSSProperties =
    badge.axis === 'y'
      ? {
          position: 'absolute',
          left: `${badge.midXPct}%`,
          top: `${badge.midYPct - half}%`,
          height: `${Math.abs(badge.gapPct)}%`,
          borderLeft: `1px ${trait} ${color}`,
        }
      : {
          position: 'absolute',
          top: `${badge.midYPct}%`,
          left: `${badge.midXPct - half}%`,
          width: `${Math.abs(badge.gapPct)}%`,
          borderTop: `1px ${trait} ${color}`,
        };

  return (
    <>
      <div style={line} />
      <div
        data-guide-gap={badge.side}
        data-guide-target={badge.targetKey ?? 'frame'}
        style={{
          position: 'absolute',
          left: `${badge.midXPct}%`,
          top: `${badge.midYPct}%`,
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 5px',
          borderRadius: 5,
          background: color,
          color: '#0A0A0F',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: '14px',
          whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {badge.equal && <Equal size={10} strokeWidth={3} />}
        {`${badge.gapPx} px`}
      </div>
    </>
  );
}
