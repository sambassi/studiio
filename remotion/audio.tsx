import React from 'react';
import { Audio, Sequence, delayRender, continueRender } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { sampleKeyframes, type AudioKeyframe } from '../src/lib/creer/audioDucking';

/**
 * L'audio du montage, cote rendu serveur — Phase 8.
 *
 * ⚠️ C'EST LE COMPOSITEUR CANVAS QUI FAIT FOI. Ce module reproduit son
 * mixage ; ses valeurs par defaut sont recopiees, et un test verifie qu'elles
 * n'ont pas derive de `video-composer.ts`.
 *
 * ── LES DUREES NE SE RECALCULENT PAS ICI ────────────────────────────────
 *
 * L'allongement d'une sequence a la duree de sa voix (`voiceSequenceSeconds`)
 * est un effet de l'EDITEUR : quand une voix est attachee, il ECRIT la duree
 * dans le design, une seule fois, et l'utilisateur peut ensuite la corriger a
 * la main. La duree qui arrive au rendu est donc DEJA calee.
 *
 * La reappliquer au rendu serait un bug, pas une securite : elle ecraserait
 * le reglage manuel de l'utilisateur, et le serveur produirait une video plus
 * longue que celle du navigateur. La regle partagee est la duree elle-meme,
 * pas la fonction qui l'a calculee.
 */

/** Volume de la musique quand rien n'est demande — `video-composer.ts`. */
export function defaultMusicVolume(hasVoice: boolean): number {
  return hasVoice ? 0.5 : 0.8;
}

/** Volume du rush quand rien n'est demande — `video-composer.ts`. */
export function defaultRushVolume(hasMixAudio: boolean): number {
  return hasMixAudio ? 0.5 : 1.0;
}

export interface MixOptions {
  musicVolume?: number;
  voiceVolume?: number;
  keyframes?: AudioKeyframe[];
  hasVoice: boolean;
  hasMixAudio: boolean;
}

/**
 * Volumes a un instant donne, en secondes.
 *
 * Les images-cles REMPLACENT le volume statique — elles ne le multiplient
 * pas : le compositeur automatise le meme `GainNode` par `setValueAtTime`.
 * Seule la voix combine les deux, parce que le canvas garde `voiceVolume` sur
 * chaque source et automatise le BUS commun par-dessus.
 */
export function mixAt(t: number, o: MixOptions): { music: number; voice: number; rush: number } {
  const kf = o.keyframes && o.keyframes.length > 0 ? sampleKeyframes(o.keyframes, t) : null;
  const voiceBase = o.voiceVolume ?? 1;
  return {
    music: kf ? kf.musicVolume : (o.musicVolume ?? defaultMusicVolume(o.hasVoice)),
    voice: voiceBase * (kf ? kf.voiceVolume : 1),
    rush: kf ? kf.rushVolume : defaultRushVolume(o.hasMixAudio),
  };
}

/**
 * Musique de fond, en boucle sur toute la video.
 *
 * ⚠️ LA BOUCLE OBLIGE A CONNAITRE LA DUREE DU MORCEAU. Le canvas pose
 * `musicEl.loop = true` et laisse le navigateur reboucler ; Remotion rend
 * image par image et n'a pas de lecteur : sans la duree, un morceau plus
 * court que le montage laisserait un silence sur la fin, et la parite
 * s'arreterait la ou personne ne regarde.
 *
 * Le rendu est donc RETENU (`delayRender`) le temps de sonder le fichier. En
 * cas d'echec — reseau, format illisible — on joue le morceau une seule fois
 * plutot que de faire echouer tout le rendu : mieux vaut une fin silencieuse
 * qu'aucune video.
 */
export const MusiqueEnBoucle: React.FC<{
  src: string;
  fps: number;
  totalFrames: number;
  volume: (frame: number) => number;
}> = ({ src, fps, totalFrames, volume }) => {
  const [jeton] = React.useState(() => delayRender(`Duree de la musique : ${src}`));
  const [boucleFrames, setBoucleFrames] = React.useState<number | null>(null);

  React.useEffect(() => {
    let vivant = true;
    getAudioDurationInSeconds(src)
      .then((secondes) => {
        if (!vivant) return;
        const images = Math.max(1, Math.round(secondes * fps));
        setBoucleFrames(images);
        continueRender(jeton);
      })
      .catch(() => {
        if (!vivant) return;
        // Une seule passe : le morceau s'arretera peut-etre avant la fin,
        // mais le rendu aboutit.
        setBoucleFrames(0);
        continueRender(jeton);
      });
    return () => { vivant = false; };
  }, [src, fps, jeton]);

  if (boucleFrames === null) return null;
  // Morceau plus long que le montage, ou duree inconnue : une seule passe.
  if (boucleFrames === 0 || boucleFrames >= totalFrames) {
    return <Audio src={src} volume={volume} />;
  }

  // ⚠️ PAS `<Loop>` : la fonction de volume y recevrait la frame de la
  // BOUCLE, remise a zero a chaque passe. Une attenuation posee a la
  // trentieme seconde du montage se rejouerait alors a chaque tour. Les
  // passes sont donc posees a la main, chacune avec son decalage, ce qui
  // rend la frame ABSOLUE recuperable.
  const passes = Math.ceil(totalFrames / boucleFrames);
  return (
    <>
      {Array.from({ length: passes }, (_, i) => {
        const depart = i * boucleFrames;
        return (
          <Sequence
            key={depart}
            from={depart}
            durationInFrames={Math.min(boucleFrames, totalFrames - depart)}
            name={`musique-${i + 1}`}
          >
            <Audio src={src} volume={(f) => volume(depart + f)} />
          </Sequence>
        );
      })}
    </>
  );
};

/**
 * Voix d'une sequence, posee a son debut NOMINAL.
 *
 * ⚠️ PAS AU DEBUT DE LA `TransitionSeries.Sequence`. Depuis la Phase 6, une
 * sequence autre que la premiere demarre la duree de transition PLUS TOT :
 * c'est le chevauchement qui porte le raccord. Une voix placee dans cette
 * sequence partirait donc 0,8 s trop tot, et le decalage s'accumulerait
 * raccord apres raccord.
 *
 * Le canvas, lui, declenche la voix a `seqStarts[idx]` — le debut nominal —
 * et l'arrete a la fin de la sequence. Les voix vivent donc a la RACINE de
 * la composition, ou ces offsets sont deja calcules.
 */
export const VoixDeSequence: React.FC<{
  src: string;
  from: number;
  durationInFrames: number;
  volume: (frame: number) => number;
}> = ({ src, from, durationInFrames, volume }) => (
  // La sequence borne la voix a sa propre duree : une voix plus longue que
  // sa sequence est COUPEE, exactement comme le `stopMs` du canvas. C'est
  // voulu — l'editeur cale la duree sur la voix, et s'il reste un
  // debordement, c'est que l'utilisateur a raccourci la sequence a la main.
  <Sequence from={from} durationInFrames={durationInFrames} name={`voix-${from}`}>
    <Audio src={src} volume={volume} />
  </Sequence>
);
