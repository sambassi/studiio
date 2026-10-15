import React from 'react';
import { Audio, Sequence, delayRender, continueRender } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { sampleKeyframes, type AudioKeyframe } from '../src/lib/creer/audioDucking';
import { facteurFonduEntreeMusique, passesMusiqueEnBoucle } from '../src/lib/render/silence-tete-pur';

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
  /**
   * Niveau du son du rush, quand il est reglé explicitement.
   *
   * ⚠️ ABSENT = LE DEFAUT DU COMPOSITEUR, pas zero. Le montage manuel ne
   * transmettait rien ici et comptait sur `defaultRushVolume` ; poser un
   * niveau par defaut de 0 aurait rendu muets tous les montages existants.
   * Seul l'Autopilote le renseigne aujourd'hui, depuis son mixeur.
   */
  rushVolume?: number;
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
    rush: kf ? kf.rushVolume : (o.rushVolume ?? defaultRushVolume(o.hasMixAudio)),
  };
}

/**
 * A2 — LA VOIX DU JUMEAU AU PREMIER PLAN.
 *
 * Recopie du compositeur canvas (`rushAudioRequis`, `DUCK_MUSIQUE_JUMEAU`,
 * `RAMPE_DUCK_S` de `video-composer.ts`) : pendant la séquence « Vidéo » d'un
 * jumeau, la musique est MULTIPLIÉE par 0,1 (−20 dB), par-dessus les réglages
 * et images-clés de l'utilisateur, qui reviennent tels quels à la sortie.
 * Rampes linéaires de 0,25 s : descente qui s'ACHÈVE au début de la fenêtre,
 * remontée qui COMMENCE à sa fin. Un test vérifie que les valeurs n'ont pas
 * dérivé du compositeur.
 */
export const DUCK_MUSIQUE_JUMEAU = 0.1;
export const RAMPE_DUCK_JUMEAU_S = 0.25;

/** Fenêtre (secondes) pendant laquelle le jumeau parle — `null` : aucune. */
export interface FenetreJumeau { debut: number; fin: number }

/** Facteur appliqué à la musique à l'instant `t` (1 hors de la fenêtre). */
export function facteurMusiqueJumeau(t: number, fenetre: FenetreJumeau | null): number {
  if (!fenetre || !(fenetre.fin > fenetre.debut)) return 1;
  const { debut, fin } = fenetre;
  const r = RAMPE_DUCK_JUMEAU_S;
  if (t <= debut - r || t >= fin + r) return 1;
  if (t < debut) return 1 + (DUCK_MUSIQUE_JUMEAU - 1) * ((t - (debut - r)) / r);
  if (t <= fin) return DUCK_MUSIQUE_JUMEAU;
  return DUCK_MUSIQUE_JUMEAU + (1 - DUCK_MUSIQUE_JUMEAU) * ((t - fin) / r);
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
  /**
   * A6 — départ (s) dans le fichier : son silence de tête, sauté UNE fois,
   * au début de la vidéo, avec un fondu d'entrée de 0,15 s. Les repasses de
   * la boucle repartent du début du fichier, comme le `loop` du canvas.
   * Absent ou 0 : rendu d'avant, exactement.
   */
  debutSecondes?: number;
}> = ({ src, fps, totalFrames, volume: volumeBrut, debutSecondes }) => {
  const debutFrames = typeof debutSecondes === 'number' && debutSecondes > 0 ? Math.round(debutSecondes * fps) : 0;
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
  const passes = passesMusiqueEnBoucle(boucleFrames, totalFrames, debutFrames);
  // Fondu d'entrée seulement si le silence de tête est réellement sauté.
  const volume = passes[0].trimBefore > 0
    ? (f: number) => volumeBrut(f) * facteurFonduEntreeMusique(f / fps, debutSecondes)
    : volumeBrut;
  // Morceau plus long que le montage, ou duree inconnue : une seule passe.
  if (passes.length === 1) {
    const p = passes[0];
    return p.trimBefore > 0
      ? <Audio src={src} volume={volume} trimBefore={p.trimBefore} />
      : <Audio src={src} volume={volume} />;
  }

  // ⚠️ PAS `<Loop>` : la fonction de volume y recevrait la frame de la
  // BOUCLE, remise a zero a chaque passe. Une attenuation posee a la
  // trentieme seconde du montage se rejouerait alors a chaque tour. Les
  // passes sont donc posees a la main, chacune avec son decalage, ce qui
  // rend la frame ABSOLUE recuperable (`passesMusiqueEnBoucle` : A6, la
  // premiere passe saute le silence de tete, les suivantes repartent de 0).
  return (
    <>
      {passes.map(({ from, duree, trimBefore }, i) => (
        <Sequence key={from} from={from} durationInFrames={duree} name={`musique-${i + 1}`}>
          {trimBefore > 0
            ? <Audio src={src} volume={(f) => volume(from + f)} trimBefore={trimBefore} />
            : <Audio src={src} volume={(f) => volume(from + f)} />}
        </Sequence>
      ))}
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
