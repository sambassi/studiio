import { Composition } from "remotion";
import { AfroboostComposition } from "./AfroboostComposition";
import { InfographicComposition } from "./InfographicComposition";
import type { AfroboostProps, InfographicProps } from "./types";

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
