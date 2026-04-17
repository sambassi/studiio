import React from "react";
import { registerRoot, Composition } from "remotion";
import { AfroboostComposition } from "./AfroboostComposition";
import { InfographicComposition } from "./InfographicComposition";
import { AiMontageComposition } from "./AiMontageComposition";
import type { AfroboostProps, InfographicProps } from "./types";
import type { AiMontageProps } from "./AiMontageComposition";

const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* AI Montage — dynamic duration from props */}
      <Composition
        id="AiMontage"
        component={AiMontageComposition as any}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          clips: [],
          transition: 'crossfade' as const,
          title: { text: 'MONTAGE IA', color: '#FFFFFF' },
          subtitle: '',
          cta: { text: 'DÉCOUVRIR', subText: 'LIEN EN BIO', color: '#FFFFFF' },
          posterUrl: null,
          musicUrl: null,
          totalDurationFrames: 450,
          format: '9:16' as const,
          watermark: false,
        }}
        calculateMetadata={({ props }: { props: any }) => ({
          durationInFrames: props.totalDurationFrames || 450,
        })}
      />

      {/* Reel 9:16 - 30fps - 30s */}
      <Composition
        id="AfroboostReel"
        component={AfroboostComposition}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          titleText: "AFROBOOST",
          subtitleText: "Cardio + Danse",
          videoMode: "cardio",
          objective: "promotion",
          renderSeed: Date.now(),
        } as AfroboostProps}
      />

      {/* TV 16:9 - 30fps - 30s */}
      <Composition
        id="AfroboostTV"
        component={AfroboostComposition}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          titleText: "AFROBOOST",
          subtitleText: "Cardio + Danse",
          videoMode: "cardio",
          objective: "promotion",
          renderSeed: Date.now(),
        } as AfroboostProps}
      />

      {/* Infographic Reel 9:16 - 30fps - 30s */}
      <Composition
        id="InfographicReel"
        component={InfographicComposition}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          themeTitle: "ENERGIE & CARDIO",
          tagLine: "THEMATIQUE DU JOUR",
          cards: [
            { icon: "zap", title: "INTENSITE", description: "Entra\u00eenement haute intensit\u00e9", value: "MAX" },
            { icon: "heart", title: "FREQUENCE", description: "5 s\u00e9ances par semaine", value: "5x" },
            { icon: "flame", title: "CALORIES", description: "Jusqu'\u00e0 800 kcal brul\u00e9es", value: "800" },
          ],
          renderSeed: Date.now(),
        } as InfographicProps}
      />

      {/* Infographic TV 16:9 - 30fps - 30s */}
      <Composition
        id="InfographicTV"
        component={InfographicComposition}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          themeTitle: "ENERGIE & CARDIO",
          tagLine: "THEMATIQUE DU JOUR",
          cards: [
            { icon: "zap", title: "INTENSITE", description: "Entra\u00eenement haute intensit\u00e9", value: "MAX" },
            { icon: "heart", title: "FREQUENCE", description: "5 s\u00e9ances par semaine", value: "5x" },
            { icon: "flame", title: "CALORIES", description: "Jusqu'\u00e0 800 kcal brul\u00e9es", value: "800" },
          ],
          renderSeed: Date.now(),
        } as InfographicProps}
      />
    </>
  );
};

registerRoot(RemotionRoot);
