'use client';

/**
 * M3-a PR3 — APERÇU RAPIDE du plan de montage (Créer, interrupteur admin).
 *
 * - `LecteurPlanApercu` : l'image courante du `<video>` (hors DOM) que le
 *   pilote du compositeur désigne, copiée dans un `<canvas>` à résolution
 *   LIMITÉE (`APERCU_COTE_MAX`), recadrée comme l'export (`rectangleRush`,
 *   recadrage DE L'EXTRAIT courant), filigrane peint dans les pixels.
 * - `CoucheSurimpressionsApercu` : titre / cartes / CTA en surimpression, le
 *   composant même que l'export photographie (`PlateauSurimpression`), avec
 *   la formule de fondu et de glissement du compositeur.
 * - `FiligraneApercu` : couche DOM du MÊME motif, AU-DESSUS de tout (titres,
 *   cartes, CTA, surimpressions) — le canvas n'en couvre que la vidéo.
 *
 * Aucun enregistrement, aucun fichier : rien ici n'appelle MediaRecorder,
 * captureStream, toBlob/toDataURL ni un téléchargement.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { PlateauSurimpression, type PlateauSurimpressionProps } from '@/components/creer/PlateauSurimpression';
import {
  dimensionsApercu, etatSurimpression, occurrencesFiligrane, motifFiligrane, peindreFiligrane, rectangleImageApercu,
  FILIGRANE_ANGLE, FILIGRANE_OPACITE, FILIGRANE_TEXTE, VOILE_SURIMPRESSION_CSS, type MoteurApercuPlan,
} from '@/lib/creer/apercu-plan-lecteur';
import type { OverlaysMontage } from '@/lib/creer/overlays';
import type { RecadragesRush } from '@/lib/creer/recadrage-rush';

type Format = '9:16' | '1:1' | '16:9';

const maintenant = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function LecteurPlanApercu({ moteur, secondes, lecture, format, recadrages }: {
  moteur: MoteurApercuPlan;
  /** Temps DANS la séquence Vidéo (s). */
  secondes: number;
  /** `false` : image figée (positionnement exact, sans lecture). */
  lecture: boolean;
  format: Format;
  recadrages: RecadragesRush;
}) {
  const { w, h } = dimensionsApercu(format);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Dernière image VIDÉO (sans filigrane) : gardée tant que la suivante n'est pas décodée. */
  const tamponRef = useRef<HTMLCanvasElement | null>(null);
  const etat = useRef<{ s: number; lecture: boolean }>({ s: secondes, lecture });
  etat.current = { s: secondes, lecture };

  const peindre = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = moteur.image(etat.current.s, etat.current.lecture);
    if (!tamponRef.current) {
      tamponRef.current = document.createElement('canvas');
      tamponRef.current.width = w;
      tamponRef.current.height = h;
    }
    const tampon = tamponRef.current;
    if (tampon.width !== w || tampon.height !== h) { tampon.width = w; tampon.height = h; }
    const tctx = tampon.getContext('2d');
    if (img && tctx && img.el.readyState >= 2) {
      const r = rectangleImageApercu(img.el, img.source, w, h, recadrages);
      if (r) {
        tctx.fillStyle = '#0A0A0F';
        tctx.fillRect(0, 0, w, h);
        try { tctx.drawImage(img.el, r.x, r.y, r.l, r.h); } catch { /* image indisponible : on garde la précédente */ }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tampon, 0, 0);
    peindreFiligrane(ctx, w, h, maintenant());
    if (img) {
      c.dataset.planIndex = String(img.index);
      c.dataset.planSource = img.source;
      c.dataset.planDepuis = String(img.depuis);
      c.dataset.planCible = img.cible.toFixed(3);
      c.dataset.planT = img.el.currentTime.toFixed(3);
      c.dataset.planPret = img.el.readyState >= 2 && !img.el.seeking && Math.abs(img.el.currentTime - img.cible) < 0.05 ? 'oui' : 'non';
    }
  };

  // À chaque instant de l'horloge (SequencePlayback se re-rend à chaque image).
  useLayoutEffect(peindre);
  // Une image arrive (positionnement terminé, données chargées) : on repeint,
  // indispensable pour l'image FIGÉE, que rien d'autre ne fait avancer.
  useEffect(() => moteur.surImage(() => peindre()), [moteur]); // eslint-disable-line react-hooks/exhaustive-deps
  // Démonté (pause, fin de la séquence Vidéo) : les lecteurs s'arrêtent.
  useEffect(() => () => moteur.suspendre(), [moteur]);

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      data-apercu-canvas
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'auto' }}
    />
  );
}

/** Surimpressions actives à `secondes`, à la résolution vidéo, réduites par `displayScale`. */
export function CoucheSurimpressionsApercu({ fenetres, secondes, base, displayScale }: {
  fenetres: OverlaysMontage;
  secondes: number;
  base: Omit<PlateauSurimpressionProps, 'element'>;
  displayScale: number;
}) {
  const actives: Array<{ cle: string; element: PlateauSurimpressionProps['element']; opacite: number; decalage: number }> = [];
  const voir = (cle: string, element: PlateauSurimpressionProps['element'], d: number, f: number) => {
    const e = etatSurimpression(secondes, d, f);
    if (e) actives.push({ cle, element, ...e });
  };
  if (fenetres.titre) voir('titre', 'titre', fenetres.titre[0], fenetres.titre[1]);
  for (const c of fenetres.cartes) voir(`carte-${c.index}`, { carte: c.index }, c.debut, c.fin);
  if (fenetres.cta) voir('cta', 'cta', fenetres.cta[0], fenetres.cta[1]);
  return (
    <div
      data-apercu-surimpressions={actives.map((a) => a.cle).join(' ')}
      style={{ position: 'absolute', top: 0, left: 0, width: base.largeur, height: base.hauteur, transform: `scale(${displayScale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
    >
      {actives.map((a) => (
        <div key={a.cle} data-apercu-surimpression={a.cle} style={{ position: 'absolute', inset: 0, opacity: a.opacite }}>
          <div style={{ position: 'absolute', inset: 0, background: VOILE_SURIMPRESSION_CSS }} />
          <div style={{ position: 'absolute', inset: 0, transform: `translateY(${a.decalage}px)` }}>
            <PlateauSurimpression {...base} element={a.element} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Filigrane DOM, même motif que celui du canvas (positions proportionnelles à
 * la largeur, même horloge murale), PAR-DESSUS toutes les couches.
 */
export function FiligraneApercu({ largeur, hauteur }: { largeur: number; hauteur: number }) {
  const { police } = motifFiligrane(largeur, hauteur);
  const pts = occurrencesFiligrane(largeur, hauteur, maintenant());
  return (
    <svg
      data-apercu-filigrane
      aria-hidden
      viewBox={`0 0 ${largeur} ${hauteur}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 30 }}
    >
      {pts.map((p, i) => (
        <text
          key={i}
          x={p.x}
          y={p.y}
          transform={`rotate(${FILIGRANE_ANGLE} ${p.x} ${p.y})`}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="Inter, Arial, sans-serif"
          fontWeight={700}
          fontSize={police}
          fill="#FFFFFF"
          stroke="#000000"
          strokeWidth={Math.max(1, police / 9)}
          paintOrder="stroke"
          opacity={FILIGRANE_OPACITE}
        >
          {FILIGRANE_TEXTE}
        </text>
      ))}
    </svg>
  );
}
