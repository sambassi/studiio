'use client';

import React from 'react';
import { ArrowLeftRight, ArrowUpDown, Equal, Plus } from 'lucide-react';
import type { ActiveGuide, GapBadge, FrameFormat } from '@/lib/creer/smartGuides';

interface Props {
  /** Lignes magnetiques, affichees pendant un glissement. */
  guides?: ActiveGuide[];
  /** Ecarts bord-a-bord du bloc selectionne. */
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

/**
 * ⚠️ LA REGLE EST BLANCHE, ET C'EST UNE CORRECTION.
 *
 * Elle etait magenta sur pastille magenta a texte NOIR (`#0A0A0F`) : sur un
 * apercu deja colore, le chiffre se lisait comme une tache sombre — au point
 * que l'utilisateur concluait que la mesure n'existait pas alors qu'elle
 * s'affichait. Un instrument de mesure se lit sur n'importe quel fond : trait
 * blanc + halo sombre, pastille sombre + texte blanc. La couleur ne porte
 * plus l'information, elle ne fait que l'accentuer — le vert est reserve a
 * l'egalite, et il reste double d'un signe « = ».
 */
const WHITE = '#FFFFFF';
const EQUAL_GREEN = '#34D399';
/** Halo sombre : c'est lui qui rend le blanc lisible sur un fond clair. */
const HALO = '0 0 0 1px rgba(0,0,0,0.55)';
const CHIP_BG = 'rgba(10,10,15,0.88)';
const SOFT_LINE = 'rgba(255,255,255,0.30)';
const THIRDS_LINE = 'rgba(255,255,255,0.18)';
const GRID_LINE = 'rgba(255,255,255,0.10)';
/** Longueur des reperes d'extremite, en pixels d'ECRAN. */
const TICK_PX = 9;

const EMPTY_GUIDES: ActiveGuide[] = [];
const EMPTY_GAPS: GapBadge[] = [];

/** Garde la pastille dans le cadre : le calque est `overflow: hidden`. */
const clampPct = (v: number) => Math.max(6, Math.min(94, v));

/**
 * Calque de reperes pose sur l'apercu — partage par Creer avance et
 * Creer simple.
 *
 * ⚠️ EN HTML, PAS EN SVG ETIRE. La version d'origine dessinait tout dans un
 * `viewBox="0 0 100 100"` avec `preserveAspectRatio="none"` : un carre etire
 * au format du cadre. En 9:16 cela multipliait les hauteurs par 1,78 — la
 * croix de centre devenait un « x » aplati et le texte illisible. Ici chaque
 * repere est un bloc positionne en POURCENTAGE (donc juste dans les deux
 * formats) dont les epaisseurs et la police sont en PIXELS D'ECRAN (donc
 * jamais deformees).
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
          REEL, donc le vrai milieu en 9:16 comme en 16:9. Pleine et nommee
          des que le bloc y est pose : l'aimantation au centre existait deja,
          mais rien ne le DISAIT. */}
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
              borderLeft: centeredX ? `2px solid ${WHITE}` : `1px dashed ${SOFT_LINE}`,
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
              borderTop: centeredY ? `2px solid ${WHITE}` : `1px dashed ${SOFT_LINE}`,
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
              color: WHITE,
              filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.9))',
              lineHeight: 0,
            }}
          >
            <Plus size={14} strokeWidth={2} />
          </div>
          {(centeredX || centeredY) && (
            <div
              data-guide-centered-label
              style={{
                ...chipBase,
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) translateY(-18px)',
                border: `1px solid ${WHITE}`,
              }}
            >
              {centeredX && centeredY ? 'Milieu' : centeredX ? 'Centré X' : 'Centré Y'}
            </div>
          )}
        </>
      )}

      {showRatioLabel && (
        <div data-guide-ratio style={{ ...chipBase, left: 6, top: 6 }}>
          {format}
        </div>
      )}

      {guides.map((g, i) => (
        <div
          key={`guide-${g.axis}-${i}`}
          style={{
            position: 'absolute',
            boxShadow: HALO,
            ...(g.axis === 'x'
              ? { top: 0, bottom: 0, left: `${g.pos}%`, borderLeft: `1px dashed ${g.source === 'equal-gap' ? EQUAL_GREEN : WHITE}` }
              : { left: 0, right: 0, top: `${g.pos}%`, borderTop: `1px dashed ${g.source === 'equal-gap' ? EQUAL_GREEN : WHITE}` }),
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
  padding: '2px 5px',
  borderRadius: 5,
  background: CHIP_BG,
  color: WHITE,
  border: '1px solid rgba(255,255,255,0.35)',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: '13px',
  whiteSpace: 'nowrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/**
 * Un ecart, rendu comme un PIED A COULISSE.
 *
 * ⚠️ LE TRAIT SEUL NE SUFFISAIT PAS. Une pastille posee au milieu de
 * l'apercu ne dit pas ce qu'elle relie : « 64 px » se lisait comme une
 * etiquette collee a la carte, pas comme le vide entre deux blocs. Trois
 * choses le rendent sans ambiguite : le trait couvre EXACTEMENT le vide, deux
 * reperes d'extremite se posent sur les bords en regard, et la pastille nomme
 * les deux blocs.
 */
function GapMeasure({ badge }: { badge: GapBadge }) {
  const accent = badge.equal ? EQUAL_GREEN : WHITE;
  // Pointilles quand rien ne se trouve en vis-a-vis. Le chiffre reste un vrai
  // ecart bord-a-bord, mais il ne doit pas se lire comme un alignement.
  const trait = badge.aligned ? 'solid' : 'dashed';
  const span = Math.abs(badge.gapPct);
  const half = span / 2;
  const vertical = badge.axis === 'y';

  const line: React.CSSProperties = vertical
    ? {
        position: 'absolute',
        left: `${badge.midXPct}%`,
        top: `${badge.midYPct - half}%`,
        height: `${span}%`,
        borderLeft: `2px ${trait} ${accent}`,
        boxShadow: HALO,
      }
    : {
        position: 'absolute',
        top: `${badge.midYPct}%`,
        left: `${badge.midXPct - half}%`,
        width: `${span}%`,
        borderTop: `2px ${trait} ${accent}`,
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
        borderTop: `2px solid ${accent}`,
        boxShadow: HALO,
      }
    : {
        position: 'absolute',
        top: `${badge.midYPct}%`,
        left: `${at}%`,
        height: TICK_PX,
        marginTop: -TICK_PX / 2,
        borderLeft: `2px solid ${accent}`,
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
        data-guide-target={badge.targetKey ?? 'frame'}
        style={{
          ...chipBase,
          left: `${clampPct(badge.midXPct)}%`,
          top: `${clampPct(badge.midYPct)}%`,
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          borderColor: badge.equal ? EQUAL_GREEN : 'rgba(255,255,255,0.35)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {badge.equal && (
            <Equal size={10} strokeWidth={3} color={EQUAL_GREEN} aria-label="même espace" />
          )}
          {`${badge.gapPx} px`}
        </span>
        {/* Qui est mesure, et jusqu'a quoi. Sans cette ligne, un chiffre pose
            entre deux blocs ne dit pas lequel des deux il concerne. */}
        <span
          data-guide-pair
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            maxWidth: 132,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 9,
            fontWeight: 600,
            opacity: 0.75,
          }}
        >
          {badge.sourceLabel}
          {vertical
            ? <ArrowUpDown size={8} strokeWidth={2.5} />
            : <ArrowLeftRight size={8} strokeWidth={2.5} />}
          {badge.targetLabel}
        </span>
      </div>
    </>
  );
}
