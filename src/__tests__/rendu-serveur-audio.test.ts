import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { mixAt, defaultMusicVolume, defaultRushVolume } from '../../remotion/audio';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import { voiceSequenceSeconds } from '@/lib/creer/voiceFit';

/**
 * Audio du rendu serveur — Phase 8.
 *
 * ⚠️ LA DURÉE D'UNE SÉQUENCE NE SE RECALCULE PAS AU RENDU.
 *
 * L'allongement d'une séquence à la durée de sa voix (`voiceSequenceSeconds`)
 * est un effet de l'ÉDITEUR : quand une voix est attachée, il écrit la durée
 * dans le design **une seule fois**, et l'utilisateur peut ensuite la
 * corriger à la main. La durée qui arrive au rendu est donc déjà calée.
 *
 * La réappliquer côté serveur ne serait pas une sécurité mais un bug : elle
 * écraserait le réglage manuel, et la vidéo serveur serait plus longue que
 * celle du navigateur. La règle partagée est la durée elle-même, pas la
 * fonction qui l'a produite — d'où le test qui interdit son usage ici.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
const audio = readFileSync(resolve(__dirname, '../../remotion/audio.tsx'), 'utf-8');
const entree = readFileSync(resolve(__dirname, '../lib/render/creerSimple.ts'), 'utf-8');

/**
 * Le CODE seul, commentaires retirés.
 *
 * Ces fichiers NOMMENT ce qu'ils n'utilisent pas — `voiceSequenceSeconds`,
 * `<Loop>` — pour dire pourquoi. Chercher le nom dans le texte brut
 * trouverait donc l'explication et croirait à un usage.
 */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

describe('La durée reste celle du design', () => {
  it('le calage à la voix est un effet de l ÉDITEUR', () => {
    // C'est là, et seulement là, que la durée est écrite.
    expect(wizard).toContain('setters[key](voiceSequenceSeconds(dur));');
    // Et une seule fois par nouvelle durée de voix : sans ce garde, toute
    // correction manuelle serait réécrite à la frappe suivante.
    expect(wizard).toContain('if (appliedVoiceDurations.current[key] === dur) continue;');
  });

  it('le rendu serveur ne le rejoue PAS', () => {
    for (const [nom, src] of [['composition', composition], ['entrée', entree], ['audio', audio]] as const) {
      expect(sansCommentaires(src), nom).not.toContain('voiceSequenceSeconds');
    }
  });

  it('la marge du calage reste celle de l éditeur', () => {
    // 0,3 s : sans elle la séquence changerait à l'instant précis où le
    // dernier mot se termine, et la coupure s'entendrait.
    expect(voiceSequenceSeconds(4.2)).toBe(5);
    expect(voiceSequenceSeconds(3.0)).toBe(4);
  });
});

describe('Le mixage est celui du compositeur', () => {
  it('les volumes par défaut sont recopiés à l identique', () => {
    expect(composer).toContain("musicGain.gain.value = options.musicVolume ?? (voiceEl ? 0.5 : 0.8);");
    expect(defaultMusicVolume(true)).toBe(0.5);
    expect(defaultMusicVolume(false)).toBe(0.8);
    expect(composer).toContain("rushGain.gain.value = options.audioKeyframes?.[0]?.rushVolume ?? (hasMixAudio ? 0.5 : 1.0);");
    expect(defaultRushVolume(true)).toBe(0.5);
    expect(defaultRushVolume(false)).toBe(1.0);
  });

  it('la musique baisse quand il y a une voix', () => {
    const sansVoix = mixAt(0, { hasVoice: false, hasMixAudio: true });
    const avecVoix = mixAt(0, { hasVoice: true, hasMixAudio: true });
    expect(avecVoix.music).toBeLessThan(sansVoix.music);
  });

  it('un volume demandé l emporte sur le défaut', () => {
    expect(mixAt(0, { hasVoice: true, hasMixAudio: true, musicVolume: 0.2 }).music).toBe(0.2);
    expect(mixAt(0, { hasVoice: true, hasMixAudio: true, voiceVolume: 0.7 }).voice).toBe(0.7);
  });

  it('les images-clés REMPLACENT le volume de la musique', () => {
    // Le compositeur automatise le MÊME `GainNode` par `setValueAtTime` : la
    // valeur statique est écrasée, pas multipliée.
    expect(composer).toContain('musicGainNode.gain.setValueAtTime(kf.musicVolume, at);');
    const kf: AudioKeyframe[] = [
      { time: 0, musicVolume: 0.9, rushVolume: 0.4 } as AudioKeyframe,
      { time: 5, musicVolume: 0.1, rushVolume: 0.2 } as AudioKeyframe,
    ];
    expect(mixAt(0, { hasVoice: true, hasMixAudio: true, musicVolume: 0.5, keyframes: kf }).music).toBe(0.9);
    expect(mixAt(6, { hasVoice: true, hasMixAudio: true, musicVolume: 0.5, keyframes: kf }).music).toBe(0.1);
  });

  it('la voix, elle, COMBINE les deux', () => {
    // Le canvas garde `voiceVolume` sur chaque source et automatise le BUS
    // commun par-dessus : les deux se multiplient.
    expect(composer).toContain('gain.gain.value = options.voiceVolume ?? 1.0;');
    expect(composer).toContain('voiceGainNode.gain.setValueAtTime(kf.voiceVolume ?? 1, at);');
    const kf: AudioKeyframe[] = [
      { time: 0, musicVolume: 1, rushVolume: 0.5, voiceVolume: 0.5 } as AudioKeyframe,
    ];
    expect(mixAt(0, { hasVoice: true, hasMixAudio: true, voiceVolume: 0.8, keyframes: kf }).voice)
      .toBeCloseTo(0.4, 6);
  });

  it('une image-clé absente de `voiceVolume` vaut plein volume', () => {
    // Rétro-compat : le champ a été ajouté après.
    const kf: AudioKeyframe[] = [{ time: 0, musicVolume: 1, rushVolume: 0.5 } as AudioKeyframe];
    expect(mixAt(0, { hasVoice: true, hasMixAudio: true, keyframes: kf }).voice).toBe(1);
  });

  it('une liste d images-clés VIDE retombe sur les défauts', () => {
    // `sampleKeyframes` rend `{music: 1, rush: 0.5}` sur une liste vide — pas
    // les défauts du compositeur. L'appeler quand même effacerait le 0,8.
    expect(mixAt(0, { hasVoice: false, hasMixAudio: false, keyframes: [] }).music).toBe(0.8);
  });
});

describe('Les voix partent au début NOMINAL de leur séquence', () => {
  it('à la racine, pas dans la série de transitions', () => {
    // Depuis la Phase 6, une séquence autre que la première démarre
    // `tFrames` plus tôt pour porter le raccord. Une voix posée dedans
    // partirait 0,8 s trop tôt, et le décalage s'accumulerait raccord après
    // raccord.
    expect(composition).toContain('from={offsets[i]}');
    const avantSerie = composition.slice(0, composition.indexOf('<TransitionSeries>'));
    expect(avantSerie).toContain('<VoixDeSequence');
    expect(avantSerie).toContain('<MusiqueEnBoucle');
  });

  it('le canvas les déclenche au même endroit', () => {
    expect(composer).toContain('start: seqStarts[idx], end: seqStarts[idx] + sequences[idx].duration');
  });

  it('une voix est bornée à sa séquence, comme le `stopMs` du canvas', () => {
    expect(composition).toContain('durationInFrames={base[i]}');
    expect(audio).toContain('<Sequence from={from} durationInFrames={durationInFrames}');
  });

  it('les repères temporels sont calculés UNE fois pour le son et l image', () => {
    // Deux calculs séparés finiraient par se décaler d'une image, et un
    // décalage son/image ne s'entend qu'à la lecture.
    expect(composition.match(/sequenceFrameOffsets\(sequences, fps\)/g)).toHaveLength(1);
  });
});

describe('Le repli sur la voix unique', () => {
  it('les voix par séquence l emportent', () => {
    expect(composition).toContain('const voixUnique = !voixParSequence && props.voiceUrl ? props.voiceUrl : null;');
  });

  it('le compositeur dit la même chose', () => {
    expect(composer).toContain('sequence voices simply');
  });
});

describe('La musique boucle, comme dans le navigateur', () => {
  it('le canvas la met en boucle', () => {
    expect(composer).toContain('musicEl.loop = true;');
    expect(composer).toContain('musicBufferSource.loop = true;');
  });

  it('le rendu serveur pose les passes A LA MAIN, pas avec `<Loop>`', () => {
    // Dans `<Loop>`, la fonction de volume reçoit la frame de la BOUCLE,
    // remise à zéro à chaque passe : une atténuation posée à la trentième
    // seconde se rejouerait à chaque tour.
    expect(sansCommentaires(audio)).not.toContain('<Loop');
    expect(audio).toContain('volume={(f) => volume(depart + f)}');
  });

  it('un morceau plus long que le montage ne boucle pas', () => {
    expect(audio).toContain('if (boucleFrames === 0 || boucleFrames >= totalFrames)');
  });

  it('un fichier illisible ne fait pas échouer le rendu', () => {
    // Mieux vaut une fin silencieuse qu'aucune vidéo.
    expect(audio).toContain('continueRender(jeton);');
    expect(audio).toContain('.catch(');
  });
});

describe('Le rush garde son propre son', () => {
  it('il n est plus coupé', () => {
    expect(composition).not.toContain('muted\n');
    expect(composition).toContain('mixAt((depart + f) / fps, mixOptions).rush');
  });

  it('le canvas le route aussi', () => {
    expect(composer).toContain('rushSource.connect(rushGain);');
  });
});

describe('L entrée de rendu transmet tout', () => {
  it('les champs audio sont déclarés', () => {
    for (const champ of ['sequenceVoiceUrls', 'voiceUrl', 'musicVolume', 'voiceVolume', 'audioKeyframes']) {
      expect(entree, champ).toContain(`${champ}?:`);
    }
  });
});
