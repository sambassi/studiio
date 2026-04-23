'use client';

import React from 'react';
import type { ActiveGuide, DistanceBadge } from '@/lib/creer/smartGuides';

interface Props {
  guides: ActiveGuide[];
  distanceBadges: DistanceBadge[];
  /** Whether to draw the 8×8 grid overlay */
  showGrid: boolean;
}

const MAGENTA = '#D91CD2';

/**
 * SVG overlay layered over the /creer preview. Renders the magnetic
 * alignment lines (magenta) when the user is dragging an element close
 * to an alignment target, plus the distance badges between the dragged
 * element and its nearest neighbours. Also renders an optional 8×8
 * alignment grid (light white lines at 0.1 opacity) when `showGrid`.
 *
 * Positioned with `absolute inset-0 pointer-events-none` so it never
 * interferes with the underlying drag handlers.
 */
export default function SmartGuides({ guides, distanceBadges, showGrid }: Props) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30"
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {showGrid && (
        <g stroke="rgba(255,255,255,0.1)" strokeWidth="0.08" vectorEffect="non-scaling-stroke">
          {Array.from({ length: 7 }, (_, i) => {
            const p = (100 / 8) * (i + 1);
            return <line key={`gx-${i}`} x1={p} y1="0" x2={p} y2="100" />;
          })}
          {Array.from({ length: 7 }, (_, i) => {
            const p = (100 / 8) * (i + 1);
            return <line key={`gy-${i}`} x1="0" y1={p} x2="100" y2={p} />;
          })}
        </g>
      )}

      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <line
            key={`guide-x-${i}`}
            x1={g.pos}
            y1="0"
            x2={g.pos}
            y2="100"
            stroke={MAGENTA}
            strokeWidth="0.4"
            strokeDasharray="1.5 1"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <line
            key={`guide-y-${i}`}
            x1="0"
            y1={g.pos}
            x2="100"
            y2={g.pos}
            stroke={MAGENTA}
            strokeWidth="0.4"
            strokeDasharray="1.5 1"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}

      {distanceBadges.map((b, i) => (
        <DistanceLabel key={`dist-${i}`} badge={b} />
      ))}
    </svg>
  );
}

function DistanceLabel({ badge }: { badge: DistanceBadge }) {
  // SVG-native text sits in the viewBox coordinate system (0..100).
  // Keep the text big enough to read (~3.5 viewBox units high), white on
  // a semi-opaque black chip.
  const text = `${badge.distancePx} px`;
  const width = text.length * 1.5 + 2;
  const height = 3.4;
  const x = Math.max(1, Math.min(100 - width - 1, badge.midX - width / 2));
  const y = Math.max(1, Math.min(100 - height - 1, badge.midY - height / 2));
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={0.8}
        ry={0.8}
        fill="rgba(217, 28, 210, 0.85)"
      />
      <text
        x={x + width / 2}
        y={y + height * 0.72}
        textAnchor="middle"
        fontFamily="monospace"
        fontSize="2.3"
        fill="#fff"
        fontWeight="700"
      >
        {text}
      </text>
    </g>
  );
}
