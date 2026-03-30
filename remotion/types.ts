export type VideoMode = "cardio" | "temoignage";

export type VideoObjective =
  | "promotion"
  | "abonnement"
  | "motivation"
  | "bienfaits"
  | "nutrition";

/** Ancre de positionnement rapide (grille 3x3) */
export type PositionAnchor =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

/** Position personnalisée pour un élément (texte ou vidéo) */
export type ElementPosition = {
  /** Ancre prédéfinie — utilisée si x/y ne sont pas définis */
  anchor: PositionAnchor;
  /** Position X en pourcentage du cadre (0=gauche, 50=centre, 100=droite) */
  x: number;
  /** Position Y en pourcentage du cadre (0=haut, 50=centre, 100=bas) */
  y: number;
};

export type AfroboostProps = {
  /** Main text displayed in the video */
  titleText: string;
  /** Optional subtitle below main text */
  subtitleText?: string;
  /** Optional path to a background video file (mp4) — legacy single video */
  backgroundVideo?: string;
  /** Optional array of up to 3 background video URLs for multi-cut mode */
  backgroundVideos?: string[];
  /** Optional path to a background music file (mp3/wav/aac) */
  backgroundAudio?: string;
  /** Video style mode: "cardio" (flashy) or "temoignage" (clean testimonial) */
  videoMode?: VideoMode;
  /** Marketing objective — drives the overlay texts and vibe */
  objective?: VideoObjective;
  /** Unique seed per render — Date.now() at render time for true randomness */
  renderSeed?: number;
  /** Position du texte néon dans le cadre */
  textPosition?: ElementPosition;
  /** Position / cadrage de la vidéo dans le cadre */
  videoPosition?: ElementPosition;
  /** Durée de chaque clip en secondes (par index de vidéo source) */
  clipDurations?: number[];
  /** Point de départ en secondes de chaque clip vidéo source */
  startTimes?: number[];
  /** Indique quels index sont des images (true) plutôt que des vidéos */
  isImageFlags?: boolean[];
  /** URL du logo Afroboost pour l'écran CTA (via media server) */
  logoUrl?: string;
  /** Voix off (via media server) — narration automatique TTS */
  voiceOverAudio?: string;
  /** Image de personnage/affiche (via media server) */
  characterImage?: string;
  /** Textes personnalisés des cartes interlude (depuis la timeline) */
  textItems?: { text: string; duration: number }[];
};

/** Keep backward compat alias */
export type HelloWorldProps = AfroboostProps;

// ══════════════════════════════════════════════════════════════
// ══  MODULE INFOGRAPHIE 30s                                   ══
// ══════════════════════════════════════════════════════════════

/** Thème prédéfini d'infographie */
export type InfographicTheme =
  | "sommeil-sport"
  | "nutrition-danse"
  | "energie-cardio"
  | "stress-mental"
  | "communaute"
  | "custom";

/** Une carte d'information dans l'infographie */
export type InfoCard = {
  icon: string;       // emoji ou chemin vers icône
  title: string;      // ex: "SILENT TRAINING"
  description: string; // ex: "Danse au casque, zéro bruit"
  value: string;       // ex: "500", "+40%", "200+"
};

/** Props pour la composition Infographie */
export type InfographicProps = {
  /** Titre principal du thème */
  themeTitle: string;
  /** Sous-titre optionnel */
  themeSubtitle?: string;
  /** Étiquette en haut (ex: "THÉMATIQUE DU JOUR") */
  tagLine?: string;
  /** Les 5 cartes d'information à animer */
  cards: InfoCard[];
  /** Texte CTA final */
  ctaText?: string;
  /** Sous-texte CTA */
  ctaSubText?: string;
  /** Durée de la partie infographie en secondes (défaut: 20) */
  infoDurationSec?: number;
  /** Durée de la partie mix en secondes (défaut: 10) */
  mixDurationSec?: number;
  /** URLs des vidéos de cours pour la partie mix (via media server) */
  mixVideos?: string[];
  /** Durée de chaque coupe mix en secondes (défaut: 2.5) */
  mixClipDuration?: number;
  /** Point de départ en secondes de chaque clip mix */
  mixStartTimes?: number[];
  /** Durée réelle en secondes de chaque vidéo mix (détectée par ffprobe) */
  mixVideoDurations?: number[];
  /** Musique de fond (via media server) */
  backgroundAudio?: string;
  /** Voix off (via media server) — enregistrement vocal */
  voiceOverAudio?: string;
  /** Logo URL (via media server) */
  logoUrl?: string;
  /** Seed pour le rendu */
  renderSeed?: number;
  /** Image de personnage (via media server) */
  characterImage?: string;
};
