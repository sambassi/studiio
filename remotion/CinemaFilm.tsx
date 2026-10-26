/**
 * CINEMA IA — la composition Remotion du film.
 *
 * Elle ne DECIDE rien : l'ordre, les durees et les couleurs viennent de
 * `monterFilm` (`src/lib/cinema/montage.ts`). Une composition qui recalculerait
 * sa chronologie finirait par ne plus montrer ce que l'aperçu annonce.
 *
 * Trois etats de plan, du plus riche au plus pauvre :
 *   1. `mediaUrl` video  → `OffthreadVideo` (le plan filme ou genere) ;
 *   2. `mediaUrl` image  → `Img` avec une lente derive (effet Ken Burns) ;
 *   3. aucun media       → CARTE DE PLAN dessinee ici, cout zero.
 *
 * L'etat 3 est celui du prototype : il est honnete (on voit le plan, son
 * cadre, sa replique) et il ne pretend pas etre une image generee.
 */
import React from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import type { MontageFilm, SegmentMontage } from '../src/lib/cinema/montage';
import { framesDe } from '../src/lib/cinema/montage';

const POLICE = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const LIBELLE_CADRE: Record<string, string> = {
  ensemble: "PLAN D'ENSEMBLE",
  moyen: 'PLAN MOYEN',
  rapproche: 'PLAN RAPPROCHE',
  insert: 'INSERT',
};

/**
 * Une URL de media : les fichiers produits localement vivent dans `public/`
 * et doivent passer par `staticFile`, les URL distantes partent telles quelles.
 */
const source = (url: string) => (/^(https?:|data:|blob:)/.test(url) ? url : staticFile(url.replace(/^\//, '')));

const estImage = (url: string) => /\.(png|jpe?g|webp|avif)(\?|$)/i.test(url);

/** Fondu d'entree et de sortie d'un plan — 6 frames, assez court pour ne pas manger la parole. */
const FONDU = 6;

function opaciteDe(frame: number, duree: number): number {
  return Math.min(
    interpolate(frame, [0, FONDU], [0, 1], { extrapolateRight: 'clamp' }),
    interpolate(frame, [duree - FONDU, duree], [1, 0], { extrapolateLeft: 'clamp' }),
  );
}

const Plan: React.FC<{ segment: SegmentMontage; duree: number; indexPlan: number; total: number }> = ({
  segment, duree, indexPlan, total,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const opacite = opaciteDe(frame, duree);
  // Derive lente : le plan n'est jamais parfaitement fixe, comme au cinema.
  const echelle = interpolate(frame, [0, duree], [1, 1.06], { extrapolateRight: 'clamp' });
  const portrait = height > width;
  const [c1, c2] = segment.couleurs;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0A0A0F', fontFamily: POLICE, opacity: opacite }}>
      {/* Fond : media s'il existe, sinon le degrade de la scene. */}
      {segment.mediaUrl ? (
        estImage(segment.mediaUrl) ? (
          <Img src={source(segment.mediaUrl)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${echelle})` }} />
        ) : (
          <OffthreadVideo src={source(segment.mediaUrl)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
        )
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(130% 110% at 25% 15%, ${c1} 0%, ${c2} 55%, #0A0A0F 100%)`,
            transform: `scale(${echelle})`,
          }}
        />
      )}

      {/* Voile : le texte reste lisible quel que soit le fond. */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(10,10,15,0.55) 0%, rgba(10,10,15,0.15) 45%, rgba(10,10,15,0.85) 100%)' }} />

      {/* En-tete : scene, lieu, cadre. */}
      <div style={{ position: 'absolute', top: portrait ? 90 : 56, left: 56, right: 56 }}>
        <div style={{ color: '#EC4899', fontSize: portrait ? 30 : 24, letterSpacing: 4, fontWeight: 700 }}>
          SCENE {segment.sceneIndex + 1} · {segment.intention.toUpperCase()}
        </div>
        <div style={{ color: '#FFFFFF', fontSize: portrait ? 56 : 46, fontWeight: 800, marginTop: 10, letterSpacing: 1 }}>
          {segment.titreScene}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: portrait ? 28 : 22, marginTop: 6 }}>
          {segment.lieu} — {LIBELLE_CADRE[segment.cadre] ?? segment.cadre.toUpperCase()}
        </div>
      </div>

      {/* Le texte du plan : la replique, ou ce que l'on voit. */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: portrait ? '0 80px' : '0 180px' }}>
        <div style={{ textAlign: 'center' }}>
          {segment.locuteur && (
            <div style={{
              display: 'inline-block', color: '#0A0A0F', background: '#EC4899', fontWeight: 800,
              fontSize: portrait ? 30 : 26, letterSpacing: 3, padding: '8px 18px', borderRadius: 999, marginBottom: 22,
            }}>
              {segment.locuteur.toUpperCase()}
            </div>
          )}
          <div style={{
            color: '#FFFFFF', fontSize: portrait ? 60 : 54, lineHeight: 1.25, fontWeight: 700,
            textShadow: '0 4px 24px rgba(0,0,0,0.65)',
          }}>
            {segment.texte}
          </div>
          {segment.apparence && (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: portrait ? 24 : 20, marginTop: 20, fontStyle: 'italic' }}>
              {segment.apparence}
            </div>
          )}
        </div>
      </AbsoluteFill>

      {/* Pied : progression dans le film. */}
      <div style={{ position: 'absolute', bottom: portrait ? 96 : 52, left: 56, right: 56, display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.65)', fontSize: portrait ? 26 : 20 }}>
        <span>PLAN {indexPlan + 1} / {total}</span>
        <span>STUDIIO CINEMA IA</span>
      </div>

      {/* La voix du plan, quand elle a ete synthetisee. */}
      {segment.voixUrl && <Audio src={source(segment.voixUrl)} />}
    </AbsoluteFill>
  );
};

export const CinemaFilm: React.FC<{ montage: MontageFilm }> = ({ montage }) => {
  const segments = montage?.segments ?? [];
  return (
    <AbsoluteFill style={{ backgroundColor: '#0A0A0F' }}>
      {segments.map((segment, i) => {
        const { from, duree } = framesDe(segment, montage.fps);
        return (
          <Sequence key={segment.planId} from={from} durationInFrames={duree}>
            <Plan segment={segment} duree={duree} indexPlan={i} total={segments.length} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
