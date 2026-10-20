/**
 * ══════════════════════════════════════════════════════════════
 *  AFROBOOST SMART CONTENT GENERATOR v3
 *  Génère un set de cartes d'infographie ÉDUCATIVES (les consommateurs
 *  appliquent un slice(0, N) pour respecter la limite courante de 3).
 *  à partir d'un sujet. Contenu riche, chiffres réels, faits
 *  marquants — pensé pour informer les internautes.
 *  100% local, instantané, aucune API externe requise.
 * ══════════════════════════════════════════════════════════════
 */

// Types for smart content generation
type InfoCardData = {
  icon: string;
  title: string;
  description: string;
  value: string;
};

// ── BIBLIOTHÈQUE D'ICÔNES ────────────────────────────────────
/**
 * Cles d'icone -> NOM D'ICONE LUCIDE (SVG).
 *
 * Cette table contenait des EMOJIS. Regle absolue du projet (CLAUDE.md,
 * section Conventions de code) : aucun emoji dans le contenu genere.
 *
 * Chaque valeur DOIT exister dans CARD_ICON_MAP (src/components/ui/CardIcon.tsx),
 * sinon CardIcon retombe sur un rendu texte du nom. Le repli ci-dessous est
 * "Sparkles", jamais un emoji.
 */
import { carteSansChiffresInventes, chiffresAutorises, texteSansChiffresInventes, titreSansChiffresInventes } from '@/lib/contenu/chiffres-sources';

const ICONS: Record<string, string> = {
  energy: "Zap", heart: "Heart", dance: "PersonStanding", audio: "Headphones", apple: "Apple",
  moon: "Moon", fire: "Flame", droplet: "Droplet", muscle: "Dumbbell", clock: "Timer",
  star: "Star", brain: "Brain", shield: "Shield", target: "Target", trophy: "Trophy",
  people: "Users", sun: "Sun", leaf: "Leaf", chart: "TrendingUp", sparkle: "Sparkles",
  thermometer: "Thermometer", bone: "Bone", eye: "Eye", lungs: "HeartPulse", dna: "Activity",
  // Extended icons for new content themes
  lipstick: "Sparkles", perfume: "Flower", mirror: "Sparkles", nailpolish: "Brush",
  baby: "Baby", family: "Users", bottle: "Baby", school: "GraduationCap",
  plane: "Plane", map: "Map", suitcase: "Briefcase", beach: "Waves", mountain: "Mountain",
  compass: "Compass", camera: "Camera",
  checklist: "ClipboardList", calendar: "Calendar", rocket: "Rocket", hourglass: "Hourglass",
  money: "Wallet", bank: "Landmark", coin: "Coins", piggy: "PiggyBank", bill: "Receipt",
  code: "Code", bug: "Bug", gear: "Settings2", keyboard: "Laptop", cloud: "Cloud",
  crypto: "Coins", chain: "Link", bitcoin: "Coins", trend: "BarChart3",
  game: "Gamepad2", joystick: "Joystick", controller: "Gamepad2", dice: "Puzzle",
  pizza: "Pizza", burger: "Utensils", salad: "Salad", chef: "Utensils", knife: "Scissors",
  dog: "Dog", cat: "Cat", paw: "Dog", fish: "Fish", bird: "Bird",
  car: "Car", fuel: "Plug", wheel: "Car", key: "Key", road: "Route",
  house: "Home", door: "Home", keys: "Key", building: "Building",
  book: "Book", pencil: "Pencil", graduation: "GraduationCap", lightbulb: "Lightbulb", teacher: "GraduationCap",
  zodiac: "Star", stars: "Sparkles", crystal: "Gem", planet: "Globe", tarot: "Diamond",
  flex: "Dumbbell", flame: "Flame", crown: "Crown", thunder: "Zap",
  // Cles employees par la base de connaissances mais absentes de la table
  // d'origine : elles retombaient toutes sur le repli. Mappees explicitement.
  alert: "ShieldAlert", ban: "ShieldAlert", battery: "Battery",
  scale: "Activity", vitamin: "Pill", water: "Droplet",
};

// ── TYPES ────────────────────────────────────────────────────
type CardTemplate = {
  icon: string;
  title: string;
  description: string;
  value: string;
};
type TopicData = {
  subtitle: string;
  tagLine: string;
  cards: CardTemplate[];
};

// ══════════════════════════════════════════════════════════════
// ══  BASE DE CONNAISSANCES — Contenu éducatif réel          ══
// ══════════════════════════════════════════════════════════════

const KNOWLEDGE_BASE: Record<string, TopicData[]> = {

  // ─── EAU / HYDRATATION ─────────────────────────────────────
  "eau": [
    {
      subtitle: "Ton corps est fait d'eau. Chaque goutte compte.",
      tagLine: "HYDRATATION & PERFORMANCE",
      cards: [
        { icon: "droplet", title: "EAU ESSENTIELLE", description: "Ton corps est fait en grande partie d'eau : garde-le bien rempli.", value: "ESSENTIEL" },
        { icon: "brain", title: "CERVEAU EN ALERTE", description: "Même un léger manque d'eau peut embrumer ton esprit et te fatiguer.", value: "CLARTÉ" },
        { icon: "fire", title: "CARDIO BOOSTÉ", description: "Bien hydraté, tu tiens plus longtemps en cardio pendant ton cours.", value: "ENDURANCE" },
        { icon: "shield", title: "MINÉRAUX PERDUS", description: "Quand tu transpires, tu perds des minéraux : l'eau t'aide à recharger.", value: "RECHARGE" },
        { icon: "energy", title: "ÉNERGIE CONSTANTE", description: "Quelques verres d'eau au réveil t'aident à bien démarrer la journée.", value: "ÉNERGIE" },
      ],
    },
    {
      subtitle: "Tu transpires, tu perds. L'eau te remet en mode perf.",
      tagLine: "LE SAVIEZ-VOUS ?",
      cards: [
        { icon: "droplet", title: "AVANT L'EFFORT", description: "Bois un grand verre d'eau avant ton cours pour arriver prêt.", value: "PRÊT" },
        { icon: "thermometer", title: "TEMPÉRATURE RÉGULÉE", description: "L'eau aide ton corps à réguler sa température pendant l'effort.", value: "ÉQUILIBRE" },
        { icon: "muscle", title: "MOINS DE CRAMPES", description: "Le manque d'eau favorise les crampes : bois régulièrement pendant la journée.", value: "HYDRATÉ" },
        { icon: "apple", title: "DIGESTION FLUIDE", description: "L'eau accompagne ta digestion et aide ton corps à bien assimiler.", value: "FLUIDE" },
        { icon: "heart", title: "CŒUR SOULAGÉ", description: "Bien hydraté, ton sang circule mieux et ton cœur travaille plus sereinement.", value: "SEREIN" },
      ],
    },
  ],

  // ─── CRAMPES ───────────────────────────────────────────────
  "crampe": [
    {
      subtitle: "Les crampes viennent souvent du manque d'eau et de minéraux",
      tagLine: "PRÉVENTION & SANTÉ",
      cards: [
        { icon: "droplet", title: "DÉSHYDRATATION", description: "Le manque d'eau favorise les crampes : bois bien les jours de cours.", value: "HYDRATÉ" },
        { icon: "apple", title: "MAGNÉSIUM", description: "Une banane et quelques amandes avant le cours aident tes muscles.", value: "MALIN" },
        { icon: "muscle", title: "ÉTIREMENTS", description: "Quelques minutes d'étirements après le cours aident à limiter les crampes.", value: "SOUPLE" },
        { icon: "thermometer", title: "CHALEUR MUSCULAIRE", description: "Un muscle froid crampe plus facilement : échauffe-toi toujours avant.", value: "CHAUD" },
        { icon: "moon", title: "SOMMEIL RÉPARATEUR", description: "C'est la nuit que tes muscles se reconstruisent : dors suffisamment.", value: "REPOS" },
      ],
    },
  ],

  // ─── SOMMEIL ───────────────────────────────────────────────
  "sommeil": [
    {
      subtitle: "Une séance de danse t'aide à t'endormir plus vite",
      tagLine: "SCIENCE DU SOMMEIL",
      cards: [
        { icon: "moon", title: "ENDORS-TOI PLUS VITE", description: "Bouger régulièrement t'aide souvent à trouver le sommeil plus facilement.", value: "ZEN" },
        { icon: "brain", title: "MÉLATONINE NATURELLE", description: "L'exercice régulier soutient la production naturelle de ton hormone du sommeil.", value: "NATUREL" },
        { icon: "heart", title: "CORTISOL EN CHUTE", description: "Une bonne séance de danse t'aide à évacuer le stress de la journée.", value: "DÉTENTE" },
        { icon: "energy", title: "SOMMEIL PROFOND", description: "Bouger régulièrement favorise un sommeil plus profond et plus réparateur.", value: "PROFOND" },
        { icon: "sun", title: "RÉVEIL ÉNERGIQUE", description: "Avec des cours réguliers, tu te réveilles souvent plus facilement le matin.", value: "ÉVEIL" },
      ],
    },
  ],

  // ─── CALORIES / PERTE DE POIDS ─────────────────────────────
  "calorie": [
    {
      subtitle: "La danse fait travailler ton cardio autant qu'un footing. En plus fun.",
      tagLine: "BRÛLE & SOURIS",
      cards: [
        { icon: "fire", title: "SESSION INTENSE", description: "Une session Afroboost te fait bouger autant qu'une bonne course à pied.", value: "INTENSE" },
        { icon: "energy", title: "AFTERBURN", description: "Ton corps continue de travailler un moment après la fin du cours.", value: "BONUS" },
        { icon: "muscle", title: "MASSE MUSCULAIRE", description: "La danse tonifie sans gonfler et réveille ton corps même au repos.", value: "TONIQUE" },
        { icon: "chart", title: "RÉSULTATS VISIBLES", description: "Avec quelques cours par semaine, tu sens vite la différence dans ton corps.", value: "PROGRÈS" },
        { icon: "brain", title: "ZÉRO FRUSTRATION", description: "Tu danses, tu t'amuses, tu oublies l'effort : voilà le secret de la régularité.", value: "PLAISIR" },
      ],
    },
  ],

  // ─── STRESS / MENTAL ───────────────────────────────────────
  "stress": [
    {
      subtitle: "Une séance de danse apaise l'esprit comme une méditation",
      tagLine: "MENTAL & BIEN-ÊTRE",
      cards: [
        { icon: "brain", title: "CORTISOL EN BAISSE", description: "Un peu d'exercice t'aide à faire redescendre la pression du quotidien.", value: "DÉTENTE" },
        { icon: "heart", title: "ENDORPHINES BOOSTÉES", description: "La danse libère tes endorphines, ces hormones qui te font du bien.", value: "BONHEUR" },
        { icon: "audio", title: "ÉTAT DE FLOW", description: "Musique et mouvement font entrer ton cerveau dans un état de flow.", value: "FLOW" },
        { icon: "moon", title: "ANXIÉTÉ APAISÉE", description: "Bouger régulièrement t'aide à relâcher les tensions et à souffler.", value: "APAISÉ" },
        { icon: "star", title: "CONFIANCE BOOSTÉE", description: "Chaque chorégraphie apprise renforce ton estime de toi, cours après cours.", value: "CONFIANCE" },
      ],
    },
  ],

  // ─── PROTÉINES / PROTEIN ───────────────────────────────────
  "protein": [
    {
      subtitle: "Sans protéines, tes muscles fondent même si tu t'entraînes",
      tagLine: "NUTRITION SPORTIVE",
      cards: [
        { icon: "muscle", title: "PROTÉINES DOSÉES", description: "Pour progresser, adapte tes protéines à ton poids et à ton activité.", value: "DOSÉ" },
        { icon: "clock", title: "FENÊTRE CLÉ", description: "Mange des protéines peu après le cours pour bien récupérer.", value: "TIMING" },
        { icon: "apple", title: "SOURCES NATURELLES", description: "Œufs, poulet, poisson, lentilles, tofu : pas besoin de poudre obligatoirement.", value: "NATUREL" },
        { icon: "fire", title: "EFFET THERMIQUE", description: "Digérer les protéines demande de l'énergie à ton corps : c'est un vrai atout.", value: "ATOUT" },
        { icon: "shield", title: "RÉPARATION", description: "L'effort sollicite tes muscles et les protéines les aident à se reconstruire.", value: "RÉPARE" },
      ],
    },
  ],

  // ─── NUTRITION ─────────────────────────────────────────────
  "nutrition": [
    {
      subtitle: "Ce que tu manges AVANT le cours change tout",
      tagLine: "NUTRITION & ÉNERGIE",
      cards: [
        { icon: "apple", title: "AVANT : GLUCIDES", description: "Riz, pâtes, pain complet : ton corps a besoin de carburant pour danser.", value: "CARBURANT" },
        { icon: "droplet", title: "HYDRATE-TOI", description: "Bois avant le cours puis par petites gorgées pendant : jamais à sec.", value: "HYDRATÉ" },
        { icon: "energy", title: "BANANE TURBO", description: "Une banane avant le cours te donne une énergie rapide et du potassium.", value: "TURBO" },
        { icon: "clock", title: "APRÈS : PROTÉINES", description: "Après le cours, associe protéines et glucides pour bien reconstruire.", value: "RÉCUP" },
        { icon: "fire", title: "REPAS RÉGULIERS", description: "Manger à heures régulières aide ton corps à garder une énergie stable.", value: "RÉGULIER" },
      ],
    },
  ],

  // ─── CARDIO / ENDURANCE ────────────────────────────────────
  "cardio": [
    {
      subtitle: "Ton cœur est un muscle. La danse le rend inarrêtable.",
      tagLine: "CARDIO & CŒUR",
      cards: [
        { icon: "heart", title: "CŒUR EN ACTION", description: "Ton cœur accélère franchement pendant un cours : c'est là que tout se joue.", value: "ACTION" },
        { icon: "chart", title: "SOUFFLE AMÉLIORÉ", description: "Avec des cours réguliers, ton souffle s'améliore semaine après semaine.", value: "SOUFFLE" },
        { icon: "shield", title: "CŒUR EN FORME", description: "La danse régulière est une super façon de prendre soin de ton cœur.", value: "CŒUR" },
        { icon: "energy", title: "ENDURANCE BOOSTÉE", description: "Au fil des semaines, tu tiens plus longtemps sans être essoufflé.", value: "ENDURANCE" },
        { icon: "fire", title: "ZONE DE BRÛLAGE", description: "À intensité modérée, ton corps puise davantage dans ses réserves.", value: "ZONE" },
      ],
    },
  ],

  // ─── COMMUNAUTÉ / TRIBU ────────────────────────────────────
  "communaut": [
    {
      subtitle: "S'entraîner en groupe aide à tenir sur la durée",
      tagLine: "FORCE COLLECTIVE",
      cards: [
        { icon: "people", title: "EFFET DE GROUPE", description: "En groupe, on a souvent envie de s'entraîner plus longtemps qu'en solo.", value: "GROUPE" },
        { icon: "brain", title: "OCYTOCINE", description: "Danser ensemble libère l'ocytocine, l'hormone du lien et de la confiance.", value: "LIEN" },
        { icon: "heart", title: "MOTIVATION MUTUELLE", description: "Le groupe te motive à revenir chaque semaine avec le sourire.", value: "MOTIVÉ" },
        { icon: "audio", title: "MÊME FRÉQUENCE", description: "Le casque synchronise le groupe. Même musique, même énergie, même vibration", value: "SYNC" },
        { icon: "trophy", title: "OBJECTIFS PARTAGÉS", description: "Partager tes objectifs t'aide à rester motivé pour les atteindre.", value: "PARTAGE" },
      ],
    },
  ],

  // ─── HORAIRES / COURS ──────────────────────────────────────
  "horaire": [
    {
      subtitle: "Trouve TON créneau. La régularité fait tout.",
      tagLine: "PLANNING AFROBOOST",
      cards: [
        { icon: "clock", title: "SOIRS DE SEMAINE", description: "Des sessions en semaine après le boulot pour bien te vider la tête.", value: "SOIRÉE" },
        { icon: "sun", title: "SAMEDI MATIN", description: "Une session le week-end pour bien démarrer et garder l'énergie toute la journée.", value: "MATIN" },
        { icon: "star", title: "COURS DÉCOUVERTE", description: "Viens tester sans engagement et découvre l'ambiance du cours.", value: "DÉCOUVRE" },
        { icon: "target", title: "RYTHME IDÉAL", description: "Quelques cours par semaine t'aident à atteindre un bon niveau d'activité.", value: "RYTHME" },
        { icon: "people", title: "PETITS GROUPES", description: "Des petits groupes pour une vraie ambiance : réserve ta place à l'avance.", value: "INTIME" },
      ],
    },
  ],

  // ─── DÉBUTANT / COMMENCER ──────────────────────────────────
  "debut": [
    {
      subtitle: "Tu sais marcher ? Tu sais danser. Point.",
      tagLine: "LANCE-TOI",
      cards: [
        { icon: "star", title: "ZÉRO PRÉ-REQUIS", description: "Aucune expérience de danse nécessaire : on part de zéro ensemble.", value: "OUVERT" },
        { icon: "brain", title: "MÉMOIRE MUSCULAIRE", description: "Ton corps apprend vite : les mouvements deviennent vite naturels.", value: "INSTINCT" },
        { icon: "audio", title: "CASQUE = TA BULLE", description: "Avec le casque, personne ne te regarde : tu te lâches.", value: "LIBRE" },
        { icon: "heart", title: "BIENVEILLANCE TOTALE", description: "Ici, personne ne te juge : tout le monde est passé par là.", value: "MAX" },
        { icon: "chart", title: "PROGRESSION EXPRESS", description: "En quelques semaines, tu prends vite le pli des chorégraphies de base.", value: "EXPRESS" },
      ],
    },
  ],

  // ─── MUSIQUE / AFROBEAT ────────────────────────────────────
  "musique": [
    {
      subtitle: "Le beat afrobeat réveille ton cerveau en même temps que ton corps",
      tagLine: "SON & CERVEAU",
      cards: [
        { icon: "audio", title: "CERVEAU EN ÉVEIL", description: "La musique rythmée active plein de zones de ton cerveau en même temps.", value: "ÉVEIL" },
        { icon: "brain", title: "DOPAMINE", description: "Écouter la musique que tu aimes fait du bien : imagine en dansant.", value: "PLAISIR" },
        { icon: "energy", title: "TEMPO AFROBEAT", description: "Le tempo afrobeat est un rythme parfait pour faire du cardio en s'amusant.", value: "TEMPO" },
        { icon: "heart", title: "SYNCHRONISATION", description: "Quand le groupe danse sur le même beat, une vraie connexion se crée.", value: "SYNC" },
        { icon: "sparkle", title: "MUSIQUE MOTEUR", description: "La musique t'aide à oublier l'effort et à tenir plus longtemps.", value: "MOTEUR" },
      ],
    },
  ],

  // ─── POIDS / MINCIR ────────────────────────────────────────
  "poids": [
    {
      subtitle: "La danse brûle les graisses PENDANT et APRÈS le cours",
      tagLine: "OBJECTIF SILHOUETTE",
      cards: [
        { icon: "fire", title: "SÉANCE EFFICACE", description: "Une séance de danse vaut une longue marche, en bien moins de temps.", value: "EFFICACE" },
        { icon: "chart", title: "PROGRÈS DURABLES", description: "Des cours réguliers et une assiette équilibrée font des progrès durables.", value: "DURABLE" },
        { icon: "energy", title: "EFFET AFTERBURN", description: "Ton corps reste actif un moment après le cours, même quand tu te reposes.", value: "BONUS" },
        { icon: "muscle", title: "MUSCLE ACTIF", description: "La danse tonifie ton corps et le muscle reste actif même au repos.", value: "ACTIF" },
        { icon: "brain", title: "ZÉRO RÉGIME", description: "Pas besoin de te priver : la danse régulière t'aide à te sentir bien.", value: "LIBRE" },
      ],
    },
  ],

  // ─── ÉNERGIE / FATIGUE ─────────────────────────────────────
  "energie": [
    {
      subtitle: "Fatigué ? C'est le manque de mouvement, pas l'inverse",
      tagLine: "BOOST NATUREL",
      cards: [
        { icon: "energy", title: "ÉNERGIE EXPRESS", description: "Quelques minutes de mouvement suffisent souvent à réveiller ton énergie.", value: "EXPRESS" },
        { icon: "brain", title: "OXYGÈNE AU CERVEAU", description: "Bouger aide ton sang à mieux circuler vers le cerveau : adieu brouillard.", value: "CLARTÉ" },
        { icon: "sun", title: "EFFET JOURNÉE", description: "Une session le matin te donne de l'énergie pour toute la journée.", value: "JOURNÉE" },
        { icon: "dna", title: "MITOCHONDRIES", description: "Le sport stimule les centrales énergétiques de tes cellules.", value: "CELLULES" },
        { icon: "moon", title: "MEILLEUR SOMMEIL", description: "Plus d'énergie le jour, meilleur sommeil la nuit : le cercle vertueux.", value: "VERTUEUX" },
      ],
    },
  ],

  // ─── SOUPLESSE / FLEXIBILITÉ ───────────────────────────────
  "souplesse": [
    {
      subtitle: "Avec l'âge, la souplesse diminue. La danse aide à la garder",
      tagLine: "MOBILITÉ & SANTÉ",
      cards: [
        { icon: "dance", title: "AMPLITUDE GAGNÉE", description: "En dansant souvent, tu gagnes en amplitude au fil des semaines.", value: "AMPLITUDE" },
        { icon: "shield", title: "CORPS PROTÉGÉ", description: "Un corps souple se blesse moins facilement : la souplesse te protège.", value: "PROTÉGÉ" },
        { icon: "bone", title: "ARTICULATIONS", description: "La danse fait travailler tes articulations en douceur et entretient ta mobilité.", value: "MOBILE" },
        { icon: "clock", title: "ÉTIREMENTS QUOTIDIENS", description: "Quelques minutes d'étirements chaque jour suffisent pour sentir la différence.", value: "QUOTIDIEN" },
        { icon: "heart", title: "DOS SOULAGÉ", description: "Gagner en souplesse aide ton dos : la danse le fait travailler en douceur.", value: "SOUPLE" },
      ],
    },
  ],

  // ─── CONFIANCE EN SOI ──────────────────────────────────────
  "confiance": [
    {
      subtitle: "Chaque chorégraphie apprise = une victoire sur toi-même",
      tagLine: "AFFIRMATION DE SOI",
      cards: [
        { icon: "star", title: "ESTIME BOOSTÉE", description: "La danse t'aide à reprendre confiance en toi semaine après semaine.", value: "ESTIME" },
        { icon: "brain", title: "POSTURE = CONFIANCE", description: "La danse améliore ta posture et se tenir droit donne confiance.", value: "POSTURE" },
        { icon: "people", title: "ZÉRO JUGEMENT", description: "Dans la tribu Afroboost, tout le monde est là pour kiffer, pas pour juger.", value: "TRIBU" },
        { icon: "trophy", title: "MICRO-VICTOIRES", description: "Chaque nouveau pas appris procure du plaisir, et ce plaisir s'accumule.", value: "MAX" },
        { icon: "dance", title: "TON CORPS PARLE", description: "Quand tu danses, tu apprends à habiter ton corps. Ça se voit dans ta vie", value: "∞" },
      ],
    },
  ],

  // ─── ÉCHAUFFEMENT ──────────────────────────────────────────
  "echauffement": [
    {
      subtitle: "Un échauffement court réduit le risque de blessure",
      tagLine: "NE SAUTE JAMAIS CETTE ÉTAPE",
      cards: [
        { icon: "thermometer", title: "MUSCLES CHAUDS", description: "L'échauffement réchauffe tes muscles et les rend plus élastiques pour l'effort.", value: "CHAUD" },
        { icon: "heart", title: "CŒUR PRÉPARÉ", description: "Une montée progressive prépare ton cœur à l'effort intense du cours.", value: "PRÉPARÉ" },
        { icon: "bone", title: "ARTICULATIONS PRÊTES", description: "Bouger avant l'effort prépare tes articulations : l'échauffement les protège.", value: "PRÊT" },
        { icon: "brain", title: "CONCENTRATION", description: "Un bon échauffement t'aide à rester concentré pendant tout le cours.", value: "FOCUS" },
        { icon: "shield", title: "BLESSURES ÉVITÉES", description: "S'échauffer avant chaque cours t'aide à limiter les risques de blessure.", value: "PRUDENT" },
      ],
    },
  ],

  // ─── RÉCUPÉRATION ──────────────────────────────────────────
  "recuperation": [
    {
      subtitle: "C'est au repos que ton corps se transforme, pas pendant l'effort",
      tagLine: "SCIENCE DE LA RÉCUPÉRATION",
      cards: [
        { icon: "moon", title: "TEMPS DE RÉCUP", description: "Tes muscles ont besoin de temps pour se reconstruire après un effort intense.", value: "PATIENCE" },
        { icon: "muscle", title: "ÉTIREMENTS APRÈS", description: "Étire-toi après le cours pour limiter les courbatures du lendemain.", value: "SOUPLE" },
        { icon: "droplet", title: "RÉHYDRATATION", description: "Tu perds beaucoup d'eau en transpirant : pense à bien boire après le cours.", value: "HYDRATÉ" },
        { icon: "apple", title: "PROTÉINES + GLUCIDES", description: "Juste après le cours, associe protéines et glucides rapides pour récupérer.", value: "RÉCUP" },
        { icon: "dna", title: "SURCOMPENSATION", description: "Ton corps se reconstruit PLUS FORT après chaque effort. C'est le principe de progression", value: "↑" },
      ],
    },
  ],

  // ─── COURS / SESSION ───────────────────────────────────────
  "cours": [
    {
      subtitle: "Une séance qui change ta journée entière",
      tagLine: "L'EXPÉRIENCE AFROBOOST",
      cards: [
        { icon: "audio", title: "CASQUE SILENT DISCO", description: "Chacun son casque, le son directement dans tes oreilles : immersion totale.", value: "IMMERSION" },
        { icon: "fire", title: "ÉNERGIE DÉPENSÉE", description: "En dansant afro, tu bouges autant qu'en marchant longtemps à bon rythme.", value: "DÉPENSE" },
        { icon: "brain", title: "ZÉRO TÉLÉPHONE", description: "Pendant le cours, tu déconnectes du monde : ton cerveau te remerciera.", value: "LIBRE" },
        { icon: "people", title: "PETITE TRIBU", description: "Des petits groupes pour une vraie connexion, pas un cours anonyme.", value: "TRIBU" },
        { icon: "heart", title: "ENDORPHINES BOOSTÉES", description: "Danse, musique et groupe réunis boostent ta production d'endorphines.", value: "BONHEUR" },
      ],
    },
  ],

  // ─── MOTIVATION ────────────────────────────────────────────
  "motivation": [
    {
      subtitle: "La motivation ne dure pas. L'habitude, si.",
      tagLine: "PSYCHOLOGIE DU SPORT",
      cards: [
        { icon: "brain", title: "HABITUDE ANCRÉE", description: "Quelques semaines de cours réguliers suffisent pour ancrer une vraie habitude.", value: "HABITUDE" },
        { icon: "people", title: "FORCE DU GROUPE", description: "Tu tiens beaucoup mieux ta routine quand tu t'entraînes en groupe.", value: "GROUPE" },
        { icon: "target", title: "OBJECTIFS SMART", description: "Un objectif précis et réaliste a bien plus de chances d'être atteint.", value: "PRÉCIS" },
        { icon: "trophy", title: "EFFET CUMULATIF", description: "Chaque cours renforce ta discipline jusqu'à devenir un vrai réflexe.", value: "RÉFLEXE" },
        { icon: "star", title: "PLAISIR D'ABORD", description: "Le plaisir reste la meilleure raison de continuer : la danse est fun.", value: "PLAISIR" },
      ],
    },
  ],

  // ─── DANSE ─────────────────────────────────────────────────
  "danse": [
    {
      subtitle: "Danser active plus de muscles que la plupart des sports",
      tagLine: "LE SPORT LE PLUS COMPLET",
      cards: [
        { icon: "muscle", title: "CORPS ENTIER", description: "La danse sollicite une foule de muscles, bien plus que la course.", value: "COMPLET" },
        { icon: "brain", title: "MÉMOIRE STIMULÉE", description: "Apprendre des chorégraphies stimule ta mémoire et garde ton esprit vif.", value: "MÉMOIRE" },
        { icon: "heart", title: "CARDIO COMPLET", description: "La danse combine cardio, renforcement et souplesse en une seule activité.", value: "COMPLET" },
        { icon: "bone", title: "OS RENFORCÉS", description: "Les petits impacts de la danse sollicitent tes os et les entretiennent.", value: "SOLIDE" },
        { icon: "sparkle", title: "VITALITÉ", description: "Danser régulièrement t'aide à garder un corps actif et plein de vitalité.", value: "VITALITÉ" },
      ],
    },
  ],

  // ─── SILENT DISCO / CASQUE ─────────────────────────────────
  "silent": [
    {
      subtitle: "Le casque te plonge dans ta bulle. Le monde disparaît.",
      tagLine: "IMMERSION TOTALE",
      cards: [
        { icon: "audio", title: "SON IMMERSIF", description: "Le son arrive direct dans tes oreilles : zéro distraction, focus total.", value: "IMMERSIF" },
        { icon: "brain", title: "FOCUS DOUBLÉ", description: "Le casque t'aide à te concentrer sur les mouvements et à apprendre plus vite.", value: "FOCUS" },
        { icon: "shield", title: "ZÉRO NUISANCE", description: "Pas de voisins dérangés ni de volume à surveiller : on danse partout.", value: "SILENCE" },
        { icon: "heart", title: "INTIMITÉ COLLECTIVE", description: "Chacun dans sa bulle mais tous ensemble. Le paradoxe magique du silent disco", value: "MAGIC" },
        { icon: "energy", title: "BASSES PUISSANTES", description: "Le casque restitue des basses que même un gros système ne peut pas reproduire", value: "MAX" },
      ],
    },
  ],

  // ─── RESPIRATION ───────────────────────────────────────────
  "respiration": [
    {
      subtitle: "Tu respires toute la journée. Autant le faire correctement.",
      tagLine: "SOUFFLE & PERFORMANCE",
      cards: [
        { icon: "lungs", title: "RESPIRATION CLÉ", description: "Tu respires toute la journée, mais souvent trop court et trop haut.", value: "SOUFFLE" },
        { icon: "heart", title: "FRÉQUENCE CARDIAQUE", description: "Respirer par le nez t'aide à garder un rythme cardiaque plus calme.", value: "CALME" },
        { icon: "energy", title: "OXYGÈNE BOOSTÉ", description: "Respirer par le ventre t'apporte plus d'oxygène qu'en haut du torse.", value: "OXYGÈNE" },
        { icon: "brain", title: "ANTI-STRESS INSTANT", description: "Inspire lentement, expire encore plus lentement : tu sens vite le calme revenir.", value: "INSTANT" },
        { icon: "fire", title: "ENDURANCE BOOSTÉE", description: "Maîtriser ta respiration en cours t'aide à tenir plus longtemps.", value: "ENDURANCE" },
      ],
    },
  ],

  // ══════════════════════════════════════════════════════════════
  // ══  NOUVEAUX SUJETS — NUTRITION DÉTAILLÉE                   ══
  // ══════════════════════════════════════════════════════════════

  // ─── MAGNÉSIUM ─────────────────────────────────────────────
  "magnesium": [
    {
      subtitle: "Beaucoup de gens manquent de magnésium. Et toi ?",
      tagLine: "MINÉRAL ESSENTIEL",
      cards: [
        { icon: "shield", title: "MAGNÉSIUM FRÉQUENT", description: "Beaucoup de gens manquent de magnésium et les sportifs en perdent encore plus.", value: "VIGILANCE" },
        { icon: "muscle", title: "ANTI-CRAMPES", description: "Le magnésium aide tes muscles : un manque favorise les crampes.", value: "CLÉ" },
        { icon: "brain", title: "SOMMEIL PROFOND", description: "Le magnésium participe au calme de ton système nerveux et aide à t'endormir.", value: "CALME" },
        { icon: "apple", title: "SOURCES DE MAGNÉSIUM", description: "Amandes, chocolat noir, épinards et bananes : tes alliés magnésium au quotidien.", value: "ALLIÉS" },
        { icon: "energy", title: "ÉNERGIE CELLULAIRE", description: "Le magnésium fait tourner ton corps à plein régime : ne le néglige pas.", value: "ÉNERGIE" },
      ],
    },
  ],

  // ─── FÉCULENTS ─────────────────────────────────────────────
  "feculent": [
    {
      subtitle: "Les féculents sont le carburant principal de tes muscles",
      tagLine: "TON CARBURANT SPORTIF",
      cards: [
        { icon: "energy", title: "GLYCOGÈNE = FUEL", description: "Tes muscles stockent l'énergie des féculents : sans eux, tu t'épuises vite.", value: "FUEL" },
        { icon: "apple", title: "COMPLETS > BLANCS", description: "Riz complet, pâtes complètes, patate douce : index glycémique bas = énergie stable sans crash", value: "IG BAS" },
        { icon: "clock", title: "AVANT LE COURS", description: "Mange tes féculents bien avant le cours : tu digères et gardes l'énergie.", value: "TIMING" },
        { icon: "fire", title: "GLUCIDES ESSENTIELS", description: "Les sportifs ont besoin de beaucoup de glucides : les féculents sont la clé.", value: "CLÉ" },
        { icon: "brain", title: "CERVEAU AUSSI", description: "Ton cerveau carbure au glucose : les féculents soutiennent ta concentration.", value: "CERVEAU" },
      ],
    },
  ],

  // ─── VITAMINES ─────────────────────────────────────────────
  "vitamine": [
    {
      subtitle: "Tes vitamines déterminent ton énergie, ton humeur, ta perf",
      tagLine: "MICRONUTRIMENTS ESSENTIELS",
      cards: [
        { icon: "sun", title: "VITAMINE D", description: "Elle soutient os, muscles et défenses : profite d'un peu de soleil chaque jour.", value: "SOLEIL" },
        { icon: "shield", title: "VITAMINE C", description: "Un antioxydant précieux qui accompagne ta récupération après l'effort.", value: "RÉCUP" },
        { icon: "energy", title: "VITAMINES B", description: "Les vitamines B aident à transformer tes aliments en énergie au quotidien.", value: "ÉNERGIE" },
        { icon: "muscle", title: "VITAMINE E", description: "Protège tes cellules musculaires contre le stress oxydatif de l'effort intense", value: "ANTI-OX" },
        { icon: "bone", title: "VITAMINE K", description: "Essentielle pour fixer le calcium sur tes os. Brocoli, épinards, chou kale en regorgent", value: "OS++" },
      ],
    },
  ],

  // ─── FER ───────────────────────────────────────────────────
  "fer": [
    {
      subtitle: "Le fer transporte l'oxygène vers tes muscles. Sans fer, pas de perf",
      tagLine: "OXYGÉNATION MUSCULAIRE",
      cards: [
        { icon: "heart", title: "HÉMOGLOBINE", description: "Le fer compose l'hémoglobine qui transporte l'O₂ dans ton sang. Moins de fer = moins d'O₂ aux muscles", value: "O₂" },
        { icon: "energy", title: "FATIGUE CHRONIQUE", description: "Beaucoup de femmes actives manquent de fer : une fatigue tenace alerte.", value: "ALERTE" },
        { icon: "apple", title: "SOURCES ANIMALES", description: "Viande rouge, boudin noir, foie : un fer que ton corps absorbe facilement.", value: "ABSORBÉ" },
        { icon: "leaf", title: "SOURCES VÉGÉTALES", description: "Lentilles, tofu, spiruline : ajoute du citron pour mieux absorber le fer.", value: "CITRON" },
        { icon: "fire", title: "FER AU FÉMININ", description: "Les sportives ont des besoins en fer plus élevés : surveille tes apports.", value: "BESOINS" },
      ],
    },
  ],

  // ─── ZINC ──────────────────────────────────────────────────
  "zinc": [
    {
      subtitle: "Le zinc : discret mais essentiel pour ta récupération",
      tagLine: "DÉFENSE & RÉCUPÉRATION",
      cards: [
        { icon: "shield", title: "IMMUNITÉ", description: "Le zinc participe au bon fonctionnement de tes défenses naturelles.", value: "DÉFENSES" },
        { icon: "muscle", title: "ZINC ET MUSCLES", description: "Le zinc soutient l'équilibre hormonal, utile pour ta récupération musculaire.", value: "RÉCUP" },
        { icon: "dna", title: "SYNTHÈSE PROTÉIQUE", description: "Sans zinc, ton corps ne peut pas reconstruire les fibres musculaires endommagées par l'effort", value: "ADN" },
        { icon: "apple", title: "SOURCES DE ZINC", description: "Huîtres, bœuf, graines de courge, lentilles : de bons alliés pour tes apports.", value: "ALLIÉS" },
        { icon: "brain", title: "ANTI-INFLAMMATION", description: "Le zinc accompagne ta récupération entre deux cours intenses.", value: "RÉCUP" },
      ],
    },
  ],

  // ─── OMÉGA 3 ───────────────────────────────────────────────
  "omega": [
    {
      subtitle: "Les oméga-3 accompagnent la récupération de tes muscles",
      tagLine: "GRAISSES QUI GUÉRISSENT",
      cards: [
        { icon: "shield", title: "ANTI-INFLAMMATOIRE", description: "Les oméga-trois t'aident à mieux récupérer après les cours intenses.", value: "RÉCUP" },
        { icon: "heart", title: "CŒUR PROTÉGÉ", description: "Les oméga-trois prennent soin de ton cœur : avec le cardio, combo gagnant.", value: "COMBO" },
        { icon: "brain", title: "CERVEAU SHARP", description: "Ton cerveau aime les bonnes graisses : les oméga-trois soutiennent ton focus.", value: "SHARP" },
        { icon: "apple", title: "SOURCES", description: "Mange souvent saumon, sardines, maquereau, noix et graines de lin.", value: "ALLIÉS" },
        { icon: "muscle", title: "RÉCUP MUSCULAIRE", description: "Les oméga-trois accompagnent la réparation de tes muscles après l'effort.", value: "RÉPARE" },
      ],
    },
  ],

  // ─── SUCRE ─────────────────────────────────────────────────
  "sucre": [
    {
      subtitle: "Tu consommes souvent trop de sucre sans le savoir",
      tagLine: "DANGER CACHÉ",
      cards: [
        { icon: "fire", title: "SUCRE EN EXCÈS", description: "On mange souvent bien plus de sucre que recommandé : surveille tes apports.", value: "EXCÈS" },
        { icon: "brain", title: "ADDICTION RÉELLE", description: "Le sucre active les mêmes zones du cerveau que la cocaïne. C'est une dépendance prouvée", value: "ADDICT" },
        { icon: "energy", title: "PIC → CRASH", description: "Le sucre rapide donne un pic puis un crash : évite-le avant un cours.", value: "CRASH" },
        { icon: "shield", title: "INFLAMMATION", description: "L'excès de sucre entretient l'inflammation et freine ta récupération.", value: "FREIN" },
        { icon: "apple", title: "ALTERNATIVES", description: "Fruits frais, miel en petite quantité, dattes. Le goût sucré sans les dégâts", value: "NATUREL" },
      ],
    },
  ],

  // ─── GLUCIDES ──────────────────────────────────────────────
  "glucide": [
    {
      subtitle: "Les glucides ne sont pas l'ennemi. Ils sont ton carburant.",
      tagLine: "ÉNERGIE BIEN DOSÉE",
      cards: [
        { icon: "energy", title: "CARBURANT CLÉ", description: "Les glucides fournissent l'essentiel de ton énergie pendant un effort intense.", value: "CARBURANT" },
        { icon: "apple", title: "COMPLEXES VS SIMPLES", description: "Avoine, riz complet, patate douce = énergie lente. Sucre, pain blanc = pic puis crash", value: "LENT" },
        { icon: "muscle", title: "GLYCOGÈNE", description: "Tes muscles stockent du glycogène et un cours intense en consomme beaucoup.", value: "RÉSERVE" },
        { icon: "clock", title: "TIMING CLÉ", description: "Prends des glucides complexes avant et des glucides rapides après le cours.", value: "TIMING" },
        { icon: "brain", title: "CERVEAU AFFAMÉ", description: "Ton cerveau carbure aux glucides : les supprimer embrume ton esprit.", value: "CARBURANT" },
      ],
    },
  ],

  // ─── COLLAGÈNE ─────────────────────────────────────────────
  "collagene": [
    {
      subtitle: "Avec les années, ton corps produit moins de collagène",
      tagLine: "TENDONS, PEAU, OS",
      cards: [
        { icon: "bone", title: "COLLAGÈNE EN BAISSE", description: "Avec les années, ta production de collagène ralentit peu à peu.", value: "TEMPS" },
        { icon: "muscle", title: "TENDONS & LIGAMENTS", description: "Le collagène compose tes tendons, essentiels pour danser avec solidité.", value: "SOLIDE" },
        { icon: "shield", title: "TENDONS PROTÉGÉS", description: "Collagène et vitamine C aident tes tendons à mieux encaisser l'effort.", value: "PROTÈGE" },
        { icon: "apple", title: "SOURCES", description: "Bouillon d'os, gélatine, poisson avec peau : tes alliés collagène.", value: "SOURCES" },
        { icon: "sparkle", title: "PEAU & ÉLASTICITÉ", description: "Le collagène aide aussi ta peau à garder sa souplesse.", value: "SOUPLE" },
      ],
    },
  ],

  // ─── POSTURE ───────────────────────────────────────────────
  "posture": [
    {
      subtitle: "Ta posture influence ta confiance, ton énergie et ta santé",
      tagLine: "TIENS-TOI DROIT",
      cards: [
        { icon: "bone", title: "MAL AU DOS", description: "Le mal de dos vient souvent d'une posture figée au bureau.", value: "POSTURE" },
        { icon: "brain", title: "CONFIANCE EN SOI", description: "Se tenir droit t'aide à te sentir plus sûr de toi.", value: "CONFIANCE" },
        { icon: "lungs", title: "RESPIRATION LIBRE", description: "Une bonne posture ouvre ta cage thoracique et facilite ta respiration.", value: "SOUFFLE" },
        { icon: "dance", title: "DANSE = CORRECTEUR", description: "La danse renforce naturellement ton dos, tes abdos et tes fessiers.", value: "MAINTIEN" },
        { icon: "energy", title: "ÉNERGIE LIBÉRÉE", description: "Une posture affaissée te fatigue vite : redresse-toi et respire.", value: "ÉNERGIE" },
      ],
    },
  ],

  // ─── TRANSPIRATION / SUEUR ─────────────────────────────────
  "transpiration": [
    {
      subtitle: "Transpirer n'est pas un signe de faiblesse. C'est un superpouvoir.",
      tagLine: "TON SYSTÈME DE REFROIDISSEMENT",
      cards: [
        { icon: "droplet", title: "SUEUR EN COURS", description: "Pendant un cours Afroboost, tu transpires beaucoup : c'est normal et sain.", value: "SUEUR" },
        { icon: "thermometer", title: "THERMORÉGULATION", description: "La sueur refroidit ton corps et l'empêche de surchauffer pendant l'effort.", value: "FRAÎCHEUR" },
        { icon: "shield", title: "DÉTOX NATURELLE", description: "La sueur évacue métaux lourds, BPA et toxines. C'est un filtre naturel pour ton corps", value: "DÉTOX" },
        { icon: "heart", title: "PEAU PURIFIÉE", description: "Transpirer ouvre les pores et expulse les impuretés. Mieux que n'importe quel nettoyant", value: "PEAU+" },
        { icon: "energy", title: "PLUS TU T'ENTRAÎNES", description: "Plus tu es en forme, plus tu transpires tôt et efficacement. C'est un signe de progrès!", value: "PROGRÈS" },
      ],
    },
  ],

  // ─── ABDOS / CORE ──────────────────────────────────────────
  "abdo": [
    {
      subtitle: "Tes abdos ne sont pas juste esthétiques. Ils tiennent tout.",
      tagLine: "LE CENTRE DE TOUT",
      cards: [
        { icon: "muscle", title: "MUSCLES DU CORE", description: "Le core regroupe bien plus que les abdos : il stabilise chaque pas.", value: "CENTRE" },
        { icon: "bone", title: "DOS PROTÉGÉ", description: "Un core solide soutient ton dos comme un corset musculaire naturel.", value: "SOUTIEN" },
        { icon: "dance", title: "DANSE = GAINAGE", description: "Chaque mouvement de bassin engage tes abdos profonds, sans même y penser.", value: "AUTO" },
        { icon: "fire", title: "PAS DE 'SPOT REDUCTION'", description: "Impossible de perdre du gras localement. Le cardio-danse brûle les graisses sur tout le corps", value: "GLOBAL" },
        { icon: "shield", title: "ÉQUILIBRE RENFORCÉ", description: "Un core solide améliore ton équilibre pour les pas de danse complexes.", value: "ÉQUILIBRE" },
      ],
    },
  ],

  // ─── FESSIERS ──────────────────────────────────────────────
  "fessier": [
    {
      subtitle: "Les fessiers sont le groupe musculaire le plus puissant du corps",
      tagLine: "PUISSANCE & ESTHÉTIQUE",
      cards: [
        { icon: "muscle", title: "LE PLUS GROS MUSCLE", description: "Le grand fessier est très puissant et la danse afro le travaille à fond.", value: "PUISSANT" },
        { icon: "dance", title: "AFROBEAT = SQUATS", description: "Les mouvements de bassin de la danse afro sollicitent tes fessiers sans relâche.", value: "GALBE" },
        { icon: "bone", title: "PROTECTION DU DOS", description: "Des fessiers faibles surchargent le bas du dos : renforce-les.", value: "SOUTIEN" },
        { icon: "fire", title: "MÉTABOLISME BOOSTÉ", description: "Des fessiers musclés soutiennent ton métabolisme, même au repos.", value: "ACTIF" },
        { icon: "chart", title: "RÉSULTATS VISIBLES", description: "Avec des cours réguliers, la danse afro galbe joliment tes fessiers.", value: "RÉGULIER" },
      ],
    },
  ],

  // ─── ENDORPHINES / BONHEUR ─────────────────────────────────
  "endorphine": [
    {
      subtitle: "La danse libère les mêmes hormones que le chocolat. En mieux.",
      tagLine: "CHIMIE DU BONHEUR",
      cards: [
        { icon: "brain", title: "ENDORPHINES BOOSTÉES", description: "Danser en groupe libère des endorphines et rend l'effort plus joyeux.", value: "JOIE" },
        { icon: "heart", title: "DOPAMINE = PLAISIR", description: "Chaque mouvement réussi libère de la dopamine. Tu deviens littéralement accro au plaisir de danser", value: "PLAISIR" },
        { icon: "sparkle", title: "SÉROTONINE", description: "L'exercice régulier soutient ta sérotonine et ton moral au quotidien.", value: "MORAL" },
        { icon: "people", title: "OCYTOCINE", description: "Danser en groupe libère l'ocytocine : l'hormone de l'attachement et de la confiance", value: "LIEN" },
        { icon: "moon", title: "EFFET DURABLE", description: "Après un cours, la bonne humeur t'accompagne encore longtemps.", value: "DURABLE" },
      ],
    },
  ],

  // ─── COORDINATION ──────────────────────────────────────────
  "coordination": [
    {
      subtitle: "La coordination, ça se travaille. Et ça change tout.",
      tagLine: "CERVEAU-CORPS",
      cards: [
        { icon: "brain", title: "CONNEXIONS NEURONALES", description: "Apprendre une chorégraphie crée des millions de nouvelles connexions neuronales", value: "×M" },
        { icon: "dance", title: "PROPRIOCEPTION", description: "La danse affine ta conscience corporelle : tu sens mieux chaque mouvement.", value: "RESSENTI" },
        { icon: "shield", title: "MOINS DE CHUTES", description: "Une meilleure coordination t'aide à rester stable, surtout avec l'âge.", value: "STABLE" },
        { icon: "clock", title: "TEMPS DE RÉACTION", description: "La danse aiguise tes réflexes et rend tes réactions plus vives.", value: "RÉFLEXES" },
        { icon: "star", title: "PAS BESOIN DE TALENT", description: "Ta coordination progresse à chaque cours : tu vas te surprendre toi-même.", value: "PROGRÈS" },
      ],
    },
  ],

  // ─── IMMUNITÉ ──────────────────────────────────────────────
  "immunit": [
    {
      subtitle: "L'exercice modéré soutient ton système immunitaire",
      tagLine: "TES DÉFENSES NATURELLES",
      cards: [
        { icon: "shield", title: "DÉFENSES ACTIVÉES", description: "Un exercice modéré stimule tes globules blancs, ton armée de défense.", value: "DÉFENSE" },
        { icon: "thermometer", title: "MOINS DE RHUMES", description: "Bouger régulièrement aide ton corps à mieux traverser l'hiver.", value: "HIVER" },
        { icon: "brain", title: "STRESS = POISON", description: "Le stress affaiblit ton immunité et la danse t'aide à le relâcher.", value: "DÉTENTE" },
        { icon: "moon", title: "SOMMEIL IMMUNITAIRE", description: "Le sport améliore ton sommeil, moment clé de ta récupération immunitaire.", value: "NUIT" },
        { icon: "apple", title: "INTESTIN = CLÉ", description: "Ton immunité se joue beaucoup dans l'intestin, et bouger aide ta flore.", value: "CLÉ" },
      ],
    },
  ],

  // ─── DIABÈTE / GLYCÉMIE ────────────────────────────────────
  "diabete": [
    {
      subtitle: "Bouger régulièrement aide ton corps à mieux gérer le sucre",
      tagLine: "CONTRÔLE GLYCÉMIQUE",
      cards: [
        { icon: "shield", title: "RISQUE RÉDUIT", description: "Bouger souvent dans la semaine aide à prévenir le diabète de type deux.", value: "PRÉVIENT" },
        { icon: "chart", title: "GLYCÉMIE RÉGULÉE", description: "L'exercice rend tes cellules plus réceptives à l'insuline : moins de pics.", value: "ÉQUILIBRE" },
        { icon: "fire", title: "GLUCOSE BRÛLÉ", description: "Tes muscles consomment du glucose pendant l'effort. Moins de sucre dans le sang", value: "DIRECT" },
        { icon: "clock", title: "EFFET PROLONGÉ", description: "Après un cours, tes cellules gardent une meilleure sensibilité à l'insuline.", value: "PROLONGÉ" },
        { icon: "apple", title: "ALIMENTATION + SPORT", description: "Féculents complets et exercice régulier forment un duo précieux face au diabète.", value: "DUO" },
      ],
    },
  ],

  // ─── CHOLESTÉROL ───────────────────────────────────────────
  "cholesterol": [
    {
      subtitle: "La danse régulière prend soin de ton cœur",
      tagLine: "BON VS MAUVAIS",
      cards: [
        { icon: "heart", title: "BON CHOLESTÉROL", description: "L'exercice aérobie aide à faire grimper ton bon cholestérol.", value: "HDL" },
        { icon: "shield", title: "MAUVAIS CHOLESTÉROL", description: "L'activité régulière aide à faire baisser ton mauvais cholestérol.", value: "ARTÈRES" },
        { icon: "fire", title: "BOUGER CHAQUE SEMAINE", description: "Quelques cours Afroboost par semaine t'aident à rester bien actif.", value: "ACTIF" },
        { icon: "apple", title: "OMÉGA EN PLUS", description: "Poisson gras régulier et danse forment un bon duo pour ton cholestérol.", value: "DUO" },
        { icon: "chart", title: "RÉSULTATS PROGRESSIFS", description: "Avec une activité régulière, ton corps change en profondeur au fil des mois.", value: "PATIENCE" },
      ],
    },
  ],

  // ─── ARTICULATIONS / GENOUX ────────────────────────────────
  "articulation": [
    {
      subtitle: "Bouger protège tes articulations. L'immobilité les détruit.",
      tagLine: "MOBILITÉ ARTICULAIRE",
      cards: [
        { icon: "bone", title: "LIQUIDE SYNOVIAL", description: "Le mouvement produit le liquide synovial qui lubrifie tes articulations. Sans mouvement, elles grippent", value: "LUBE" },
        { icon: "shield", title: "CARTILAGE NOURRI", description: "Le cartilage n'a pas de vaisseaux sanguins. Seul le mouvement le nourrit par compression/décompression", value: "MOV." },
        { icon: "dance", title: "IMPACT MODÉRÉ", description: "La danse est un sport à impact modéré. Plus doux que le running, plus efficace que le vélo", value: "MOYEN" },
        { icon: "muscle", title: "MUSCLES STABILISATEURS", description: "La danse renforce les muscles autour des genoux et des chevilles.", value: "STAB." },
        { icon: "clock", title: "ÉCHAUFFEMENT ACTIF", description: "Quelques rotations avant le cours préparent et protègent tes articulations.", value: "PRÊT" },
      ],
    },
  ],

  // ─── CURCUMA ───────────────────────────────────────────────
  "curcuma": [
    {
      subtitle: "Le curcuma est l'anti-inflammatoire naturel le plus puissant",
      tagLine: "SUPER-ALIMENT ANTI-DOULEUR",
      cards: [
        { icon: "shield", title: "CURCUMINE", description: "La curcumine, son principe actif, accompagne la lutte contre l'inflammation.", value: "= IBUP." },
        { icon: "muscle", title: "RÉCUPÉRATION", description: "La curcumine peut aider tes muscles à mieux récupérer après l'effort.", value: "RÉCUP" },
        { icon: "apple", title: "POIVRE NOIR OBLIGÉ", description: "Le poivre noir aide ton corps à absorber le curcuma : combine-les toujours.", value: "DUO" },
        { icon: "brain", title: "NEUROPROTECTEUR", description: "La curcumine traverse la barrière hémato-encéphalique. Elle protège ton cerveau du déclin cognitif", value: "NEURO" },
        { icon: "heart", title: "ANTI-OXYDANT", description: "Le curcuma est riche en antioxydants qui protègent tes cellules.", value: "PROTÈGE" },
      ],
    },
  ],

  // ─── BANANE ────────────────────────────────────────────────
  "banane": [
    {
      subtitle: "La banane est le snack parfait du sportif. Voici pourquoi.",
      tagLine: "FRUIT DU SPORTIF",
      cards: [
        { icon: "energy", title: "ÉNERGIE RAPIDE", description: "La banane t'apporte vite des glucides naturels, parfaits avant le cours.", value: "RAPIDE" },
        { icon: "muscle", title: "RICHE EN POTASSIUM", description: "Le potassium de la banane aide à prévenir les crampes musculaires.", value: "CRAMPES" },
        { icon: "brain", title: "TRYPTOPHANE", description: "La banane contient du tryptophane, précurseur de la sérotonine. Elle améliore ton humeur", value: "MOOD+" },
        { icon: "shield", title: "MAGNÉSIUM", description: "La banane apporte du magnésium : anti-crampes, anti-stress, pro-sommeil.", value: "DÉTENTE" },
        { icon: "fire", title: "LÉGÈRE EN CALORIES", description: "La banane offre beaucoup d'énergie pour peu de calories.", value: "LÉGER" },
      ],
    },
  ],

  // ─── ANANAS ────────────────────────────────────────────────
  "ananas": [
    {
      subtitle: "L'ananas : enzyme anti-inflammatoire naturelle et ultra peu calorique",
      tagLine: "SCIENCE DE L'ANANAS",
      cards: [
        { icon: "shield", title: "BROMÉLAÏNE", description: "Enzyme anti-inflammatoire naturelle qui accélère la récupération musculaire après l'effort", value: "ANTI-INF" },
        { icon: "droplet", title: "GORGÉ D'EAU", description: "L'ananas est léger et plein d'eau : il hydrate et rassasie sans excès.", value: "LÉGER" },
        { icon: "vitamin", title: "VITAMINE C", description: "L'ananas regorge de vitamine C pour booster ton immunité.", value: "IMMUNITÉ" },
        { icon: "leaf", title: "FIBRES + DIGESTION", description: "Ses fibres et sa bromélaïne aident à digérer après un repas copieux.", value: "DIGESTION" },
        { icon: "fire", title: "QUAND LE MANGER", description: "Mange-le frais, entre les repas : la cuisson détruit la bromélaïne.", value: "FRAIS" },
      ],
    },
  ],

  // ─── MANGUE ────────────────────────────────────────────────
  "mangue": [
    {
      subtitle: "La mangue : concentré de bêta-carotène et d'antioxydants",
      tagLine: "SUPER-FRUIT TROPICAL",
      cards: [
        { icon: "sun", title: "BÊTA-CAROTÈNE", description: "Précurseur de la vitamine A : protège ta peau du soleil et améliore la vision nocturne", value: "A+" },
        { icon: "vitamin", title: "VITAMINE C", description: "Sa vitamine C soutient la production de collagène pour peau et tendons.", value: "ÉCLAT" },
        { icon: "leaf", title: "ENZYMES DIGESTIVES", description: "L'amylase aide à digérer les glucides. Consomme-la bien mûre pour maximiser l'effet", value: "AMYL." },
        { icon: "shield", title: "POLYPHÉNOLS", description: "La mangiférine (dans la peau fine sous la pelure) est un puissant antioxydant anti-vieillissement", value: "ANTI-OX" },
        { icon: "fire", title: "ÉNERGIE LÉGÈRE", description: "Ses sucres naturels rapides te donnent de l'énergie avant un cours cardio.", value: "RAPIDE" },
      ],
    },
  ],

  // ─── AVOCAT ────────────────────────────────────────────────
  "avocat": [
    {
      subtitle: "L'avocat : bonne graisse qui protège ton cœur et tes hormones",
      tagLine: "LIPIDES INTELLIGENTS",
      cards: [
        { icon: "heart", title: "BONNES GRAISSES", description: "L'avocat apporte des graisses insaturées qui prennent soin de ton cœur.", value: "CŒUR" },
        { icon: "muscle", title: "TESTOSTÉRONE", description: "Les lipides de l'avocat sont précurseurs des hormones stéroïdiennes (testo, œstrogène)", value: "HORMONE" },
        { icon: "leaf", title: "RICHE EN FIBRES", description: "L'avocat est riche en fibres et te cale durablement.", value: "SATIÉTÉ" },
        { icon: "brain", title: "POTASSIUM", description: "L'avocat est riche en potassium, un allié anti-crampes après l'effort.", value: "CRAMPES" },
        { icon: "fire", title: "QUAND LE MANGER", description: "Avec des légumes verts, ses lipides aident à mieux absorber leurs nutriments.", value: "DUO" },
      ],
    },
  ],

  // ─── GINGEMBRE ─────────────────────────────────────────────
  "gingembre": [
    {
      subtitle: "Le gingembre : anti-nausée, anti-douleur et brûle-graisse naturel",
      tagLine: "RACINE BRÛLE-GRAISSE",
      cards: [
        { icon: "shield", title: "GINGÉROL", description: "Le gingérol du gingembre peut aider à apaiser tes courbatures après l'effort.", value: "APAISE" },
        { icon: "fire", title: "THERMOGENÈSE", description: "Le gingembre donne un petit coup de chaud à ton métabolisme.", value: "CHALEUR" },
        { icon: "droplet", title: "DIGESTION", description: "Le gingembre stimule ta digestion et aide à calmer les nausées.", value: "DIGESTION" },
        { icon: "brain", title: "MUSCLES APAISÉS", description: "Le gingembre frais ou en poudre aide à soulager les muscles fatigués.", value: "APAISE" },
        { icon: "apple", title: "COMMENT L'UTILISER", description: "Râpe-le frais dans une infusion ou ajoute-le à ton smoothie post-training.", value: "ASTUCE" },
      ],
    },
  ],

  // ─── CITRON ────────────────────────────────────────────────
  "citron": [
    {
      subtitle: "Le citron : alcalinisant malgré son acidité, détoxifiant au réveil",
      tagLine: "RÉVEIL VITAMINÉ",
      cards: [
        { icon: "vitamin", title: "VITAMINE C", description: "Le citron aide ton corps à mieux absorber le fer végétal.", value: "FER" },
        { icon: "droplet", title: "EAU TIÈDE AU RÉVEIL", description: "Un jus de citron dans de l'eau tiède au réveil réveille ta digestion.", value: "RÉVEIL" },
        { icon: "shield", title: "ALCALINISANT", description: "Paradoxe : acide dans le fruit, alcalinisant une fois métabolisé. Réduit l'acidose de l'effort", value: "pH+" },
        { icon: "fire", title: "BRÛLE-GRAISSE DOUX", description: "Les polyphénols du citron activent la lipolyse. Combiné à l'eau : effet coupe-faim naturel", value: "LIPOL." },
        { icon: "heart", title: "ATTENTION ÉMAIL", description: "Toujours bois à la paille ou rince ta bouche après. L'acide citrique attaque l'émail dentaire", value: "PAILLE" },
      ],
    },
  ],

  // ─── CAFÉ / CAFÉINE ────────────────────────────────────────
  "cafe": [
    {
      subtitle: "La caféine peut donner un coup de pouce à tes séances",
      tagLine: "PERFORMANCE & TIMING",
      cards: [
        { icon: "energy", title: "PERFORMANCE", description: "Un expresso avant l'effort peut t'aider à tenir plus longtemps.", value: "ENDURANCE" },
        { icon: "fire", title: "BRÛLE-GRAISSE", description: "La caféine aide ton corps à puiser davantage dans les graisses à l'effort.", value: "ACTIF" },
        { icon: "brain", title: "CONCENTRATION", description: "La caféine bloque l'adénosine (fatigue) et booste la dopamine. Tu es plus alerte et focalisé", value: "FOCUS" },
        { icon: "clock", title: "TIMING CLÉ", description: "Prends ton café un peu avant l'effort pour en sentir tout l'effet.", value: "TIMING" },
        { icon: "moon", title: "ATTENTION LE SOIR", description: "La caféine reste longtemps dans ton sang : évite le café l'après-midi.", value: "PRUDENCE" },
      ],
    },
  ],

  // ─── ALCOOL ────────────────────────────────────────────────
  "alcool": [
    {
      subtitle: "L'alcool freine ta récupération musculaire",
      tagLine: "CE QUE L'ALCOOL FAIT VRAIMENT",
      cards: [
        { icon: "muscle", title: "RÉPARATION FREINÉE", description: "L'alcool freine la réparation de tes muscles après l'entraînement.", value: "FREIN" },
        { icon: "droplet", title: "DÉSHYDRATATION", description: "L'alcool te déshydrate et favorise les crampes : bois de l'eau.", value: "SOIF" },
        { icon: "moon", title: "SOMMEIL PERTURBÉ", description: "L'alcool perturbe ton sommeil profond : tu dors sans vraiment récupérer.", value: "SOMMEIL" },
        { icon: "fire", title: "MÉTABOLISME BLOQUÉ", description: "Ton foie priorise l'élimination de l'alcool. Pendant ce temps, tu ne brûles pas de graisses", value: "STOP" },
        { icon: "heart", title: "FRÉQUENCE CARDIAQUE", description: "L'alcool fait grimper ta fréquence cardiaque au repos : ton cœur trinque.", value: "CŒUR" },
      ],
    },
  ],

  // ─── MANIOC ───────────────────────────────────────────────────
  "manioc": [
    {
      subtitle: "Le manioc : légume racine riche en énergie pour tes entraînements",
      tagLine: "MANIOC & PERFORMANCE",
      cards: [
        { icon: "energy", title: "ÉNERGIE PURE", description: "Le manioc cuit est un carburant idéal avant un cours de danse.", value: "CARBURANT" },
        { icon: "leaf", title: "SANS GLUTEN", description: "Le manioc est naturellement sans gluten, parfait pour les intolérants.", value: "NATUREL" },
        { icon: "muscle", title: "FIBRES DIGESTIVES", description: "Ses fibres améliorent ta digestion et nourrissent ta flore intestinale.", value: "DIGESTION" },
        { icon: "shield", title: "VITAMINE C", description: "Le manioc frais apporte de la vitamine C pour renforcer tes défenses.", value: "DÉFENSE" },
        { icon: "fire", title: "GLUCIDES LENTS", description: "Ses glucides complexes te donnent une énergie durable, sans pic de glycémie.", value: "DURABLE" },
      ],
    },
    {
      subtitle: "Le manioc cuit donne une énergie stable sans le crash du sucre",
      tagLine: "NUTRITION & SPORT",
      cards: [
        { icon: "apple", title: "AMIDON RÉSISTANT", description: "Le manioc refroidi développe de l'amidon résistant qui nourrit tes bonnes bactéries", value: "PRÉBIO" },
        { icon: "droplet", title: "HYDRATANT", description: "Le manioc cuit contient beaucoup d'eau et participe à ton hydratation.", value: "HYDRATE" },
        { icon: "bone", title: "CALCIUM", description: "Le manioc apporte du calcium pour des os solides en danse.", value: "OS" },
        { icon: "target", title: "AVANT L'EFFORT", description: "Mange du manioc avant ton cours : ses glucides lents te porteront.", value: "AVANT" },
        { icon: "star", title: "POLYVALENT", description: "Bouilli, en farine ou en tapioca, le manioc s'adapte à tes repas.", value: "VARIÉ" },
      ],
    },
  ],

  // ─── MORINGA ──────────────────────────────────────────────────
  "moringa": [
    {
      subtitle: "Le moringa : une plante riche en nutriments",
      tagLine: "MORINGA & SUPER NUTRITION",
      cards: [
        { icon: "leaf", title: "PROTÉINES VÉGÉTALES", description: "Les feuilles séchées de moringa sont une belle source de protéines végétales.", value: "PROTÉINES" },
        { icon: "bone", title: "RICHE EN CALCIUM", description: "Le moringa est riche en calcium pour soutenir tes os en danse.", value: "OS" },
        { icon: "energy", title: "FER PUISSANT", description: "La poudre de moringa est riche en fer pour combattre la fatigue.", value: "FER" },
        { icon: "brain", title: "ANTIOXYDANTS", description: "Le moringa regorge d'antioxydants qui protègent tes cellules.", value: "PROTÈGE" },
        { icon: "shield", title: "VITAMINE A", description: "Le moringa est riche en vitamine A pour ta vue et ton immunité.", value: "VISION" },
      ],
    },
    {
      subtitle: "Le moringa booste ton énergie naturellement sans caféine",
      tagLine: "LE SAVIEZ-VOUS ?",
      cards: [
        { icon: "heart", title: "ANTI-INFLAMMATOIRE", description: "Le moringa aide à apaiser l'inflammation après un entraînement intense.", value: "APAISE" },
        { icon: "droplet", title: "DIGESTION", description: "Les fibres du moringa soutiennent ton transit quand tu en prends régulièrement.", value: "TRANSIT" },
        { icon: "fire", title: "MÉTABOLISME", description: "Le moringa accompagne ton métabolisme au quotidien.", value: "ACTIF" },
        { icon: "muscle", title: "RÉCUPÉRATION", description: "Ses acides aminés essentiels aident tes muscles à se reconstruire.", value: "RÉCUP" },
        { icon: "sun", title: "VITAMINE E", description: "Le moringa est riche en vitamine E pour une peau éclatante.", value: "ÉCLAT" },
      ],
    },
  ],

  // ─── BAOBAB ───────────────────────────────────────────────────
  "baobab": [
    {
      subtitle: "Le fruit du baobab : une belle source de vitamine C",
      tagLine: "BAOBAB & ÉNERGIE",
      cards: [
        { icon: "shield", title: "VITAMINE C", description: "Le baobab regorge de vitamine C : ton système immunitaire te remerciera.", value: "IMMUNITÉ" },
        { icon: "muscle", title: "FIBRES RECORD", description: "La pulpe de baobab est très riche en fibres, championne de la digestion.", value: "CHAMPION" },
        { icon: "bone", title: "CALCIUM", description: "Le baobab apporte beaucoup de calcium, comme de nombreux produits laitiers.", value: "OS" },
        { icon: "energy", title: "POTASSIUM", description: "Le baobab est très riche en potassium, un anti-crampes naturel pour danser.", value: "CRAMPES" },
        { icon: "heart", title: "PRÉBIOTIQUE", description: "La pulpe de baobab nourrit tes bonnes bactéries et aide ta digestion.", value: "FLORE" },
      ],
    },
  ],

  // ─── IGNAME ───────────────────────────────────────────────────
  "igname": [
    {
      subtitle: "L'igname : le tubercule africain riche en potassium et vitamines",
      tagLine: "IGNAME & FORCE",
      cards: [
        { icon: "energy", title: "ÉNERGIE DURABLE", description: "Ses glucides complexes t'offrent une énergie stable pendant l'effort.", value: "STABLE" },
        { icon: "shield", title: "VITAMINE B", description: "La vitamine B aide ton corps à utiliser les protéines pour tes muscles.", value: "MUSCLES" },
        { icon: "heart", title: "POTASSIUM", description: "Riche en potassium, il aide à réguler ta tension et prévenir les crampes.", value: "TENSION" },
        { icon: "muscle", title: "MANGANÈSE", description: "Son manganèse participe à la formation des os et du cartilage.", value: "OS" },
        { icon: "leaf", title: "DIOSCORINE", description: "Protéine unique de l'igname avec des propriétés antioxydantes puissantes", value: "UNIQUE" },
      ],
    },
  ],

  // ─── PLANTAIN ─────────────────────────────────────────────────
  "plantain": [
    {
      subtitle: "La banane plantain : source d'énergie lente riche en potassium",
      tagLine: "PLANTAIN & SPORT",
      cards: [
        { icon: "energy", title: "GLUCIDES LENTS", description: "Ses glucides complexes te donnent une énergie stable pour danser longtemps.", value: "DURABLE" },
        { icon: "heart", title: "POTASSIUM", description: "Son potassium aide à combattre les crampes et réguler ta tension.", value: "CRAMPES" },
        { icon: "shield", title: "VITAMINE A", description: "Riche en vitamine A, il protège ta vision et renforce ton immunité.", value: "VISION" },
        { icon: "fire", title: "FIBRES", description: "Ses fibres aident à réguler ta glycémie et ta digestion.", value: "DIGESTION" },
        { icon: "muscle", title: "MAGNÉSIUM", description: "Son magnésium aide à réduire la fatigue musculaire après l'entraînement.", value: "DÉTENTE" },
      ],
    },
  ],

  // ══════════════════════════════════════════════════════════════
  // ══  NOUVEAUX THÈMES — 15 univers de contenu                 ══
  // ══════════════════════════════════════════════════════════════

  // ─── BEAUTÉ ──────────────────────────────────────────────────
  "beauty": [
    {
      subtitle: "La beauté, c'est surtout une routine et de bons produits.",
      tagLine: "BEAUTÉ & ROUTINE",
      cards: [
        { icon: "lipstick", title: "ROUTINE EXPRESS", description: "Un teint unifié en quelques minutes : le secret des pros du maquillage.", value: "EXPRESS" },
        { icon: "droplet", title: "HYDRATATION PEAU", description: "Boire assez d'eau chaque jour aide ta peau à rester souple.", value: "HYDRATE" },
        { icon: "moon", title: "SOMMEIL BEAUTÉ", description: "Une bonne nuit régénère ta peau : c'est la meilleure crème anti-âge.", value: "NUIT" },
        { icon: "perfume", title: "SÉRUM VITAMINE C", description: "Appliqué le matin, il illumine progressivement ton teint.", value: "ÉCLAT" },
        { icon: "nailpolish", title: "BASE + TOP COAT", description: "Ce duo indispensable aide ton vernis à tenir bien plus longtemps.", value: "DUO" },
        { icon: "mirror", title: "DOUBLE NETTOYAGE", description: "Huile puis mousse : tes pores sont plus nets qu'avec un seul produit.", value: "NET" },
      ],
    },
  ],

  // ─── PARENTING ───────────────────────────────────────────────
  "parenting": [
    {
      subtitle: "Élever un enfant, c'est la mission la plus importante. Voici les clés.",
      tagLine: "PARENTALITÉ POSITIVE",
      cards: [
        { icon: "baby", title: "ROUTINE DU SOIR", description: "Un rituel du soir stable aide ton enfant à mieux dormir.", value: "RITUEL" },
        { icon: "family", title: "TEMPS DE QUALITÉ", description: "Un moment de jeu exclusif chaque jour aide ton enfant à s'épanouir.", value: "LIEN" },
        { icon: "book", title: "LECTURE DU SOIR", description: "Lire chaque soir avec ton enfant enrichit son vocabulaire.", value: "MOTS" },
        { icon: "brain", title: "LIMITES CLAIRES", description: "Les enfants ont besoin de règles : un cadre clair les rassure.", value: "CADRE" },
        { icon: "heart", title: "CÂLINS QUOTIDIENS", description: "Des câlins chaque jour renforcent le lien et apaisent le stress.", value: "TENDRESSE" },
        { icon: "bottle", title: "ÉCRANS LIMITÉS", description: "Limiter les écrans chez les petits aide leur concentration à grandir.", value: "FOCUS" },
      ],
    },
  ],

  // ─── VOYAGE ──────────────────────────────────────────────────
  "travel": [
    {
      subtitle: "Voyager change ta vie. Voici comment le faire malin.",
      tagLine: "VOYAGE & DÉCOUVERTE",
      cards: [
        { icon: "plane", title: "VOLS MALINS", description: "Réserve tôt en semaine : les prix sont souvent plus doux.", value: "MALIN" },
        { icon: "suitcase", title: "BAGAGE CABINE", description: "Roule tes vêtements : un petit bagage suffit pour un long voyage.", value: "LÉGER" },
        { icon: "map", title: "APPS HORS LIGNE", description: "Google Maps offline + Maps.me : zéro panique sans data à l'étranger", value: "ZÉRO" },
        { icon: "beach", title: "BASSE SAISON", description: "Pars hors saison : hôtels plus abordables et beaucoup moins de foule.", value: "CALME" },
        { icon: "camera", title: "LUMIÈRE DORÉE", description: "Juste avant le coucher du soleil, tes photos deviennent magiques.", value: "MAGIQUE" },
        { icon: "compass", title: "LOCAL = AUTHENTIQUE", description: "Mange là où mangent les locaux et fie-toi aux avis bien notés.", value: "VRAI" },
      ],
    },
  ],

  // ─── PRODUCTIVITÉ ────────────────────────────────────────────
  "productivity": [
    {
      subtitle: "Fais plus en moins de temps. Les méthodes qui marchent vraiment.",
      tagLine: "PRODUCTIVITÉ & FOCUS",
      cards: [
        { icon: "hourglass", title: "MÉTHODE POMODORO", description: "Alterne courtes sessions de focus et vraies pauses pour rester concentré.", value: "FOCUS" },
        { icon: "checklist", title: "PEU DE TÂCHES", description: "Limite ta to-do à quelques priorités : tu avances vraiment.", value: "PRIORITÉ" },
        { icon: "rocket", title: "RÈGLE EXPRESS", description: "Si une tâche est rapide, fais-la tout de suite et oublie la procrastination.", value: "EXPRESS" },
        { icon: "calendar", title: "TIME BLOCKING", description: "Bloque ton agenda par thèmes pour gagner en productivité.", value: "AGENDA" },
        { icon: "brain", title: "DEEP WORK", description: "Un long bloc sans interruption vaut bien plus que du temps fragmenté.", value: "FOCUS" },
        { icon: "moon", title: "DÉCONNEXION DU SOIR", description: "Coupe les écrans le soir pour mieux dormir et retrouver ton énergie.", value: "REPOS" },
      ],
    },
  ],

  // ─── FINANCE ─────────────────────────────────────────────────
  "finance": [
    {
      subtitle: "L'argent n'est pas tabou. C'est un outil. Apprends à l'utiliser.",
      tagLine: "FINANCES PERSONNELLES",
      cards: [
        { icon: "piggy", title: "BUDGET ÉQUILIBRÉ", description: "Répartis ton argent entre besoins, envies et épargne : un budget qui marche.", value: "ÉQUILIBRE" },
        { icon: "money", title: "ÉPARGNE AUTO", description: "Un virement automatique en début de mois t'aide à épargner sans y penser.", value: "AUTO" },
        { icon: "bank", title: "ÉPARGNE DE SÉCURITÉ", description: "Constitue une épargne de précaution avant tout investissement risqué.", value: "SÉCURITÉ" },
        { icon: "trend", title: "INVESTIR LONG TERME", description: "Investir régulièrement sur un fonds diversifié vise le long terme.", value: "PATIENCE" },
        { icon: "coin", title: "DETTES D'ABORD", description: "Rembourser tes dettes avant d'investir allège sérieusement ton budget.", value: "PRIORITÉ" },
        { icon: "bill", title: "COMPTES SÉPARÉS", description: "Courant, épargne, plaisir : sépare tes comptes pour mieux contrôler.", value: "CONTRÔLE" },
      ],
    },
  ],

  // ─── CODING ──────────────────────────────────────────────────
  "coding": [
    {
      subtitle: "Coder, c'est écrire le futur. Les règles d'or du dev efficace.",
      tagLine: "DÉVELOPPEMENT & CODE",
      cards: [
        { icon: "code", title: "COMMIT SOUVENT", description: "Commite souvent : tes bugs deviennent bien plus faciles à retrouver.", value: "RÉGULIER" },
        { icon: "bug", title: "RUBBER DUCK", description: "Explique ton code à un canard en plastique : les bugs se révèlent.", value: "ASTUCE" },
        { icon: "keyboard", title: "RACCOURCIS", description: "Maîtrise tes raccourcis clavier et ton code avance beaucoup plus vite.", value: "VITESSE" },
        { icon: "cloud", title: "BACKUP MALIN", description: "Multiplie tes copies, tes supports et garde-en une hors site.", value: "SÉCURITÉ" },
        { icon: "gear", title: "REFACTOR RÉGULIER", description: "Garde du temps pour le refactoring : ta dette technique fond.", value: "PROPRE" },
        { icon: "brain", title: "DOCS D'ABORD", description: "Lis la doc avant les forums : tu comprends bien plus en profondeur.", value: "CLÉ" },
      ],
    },
  ],

  // ─── CRYPTO ──────────────────────────────────────────────────
  "crypto": [
    {
      subtitle: "La crypto change la finance. Investis malin, pas à l'aveugle.",
      tagLine: "CRYPTO & BLOCKCHAIN",
      cards: [
        { icon: "bitcoin", title: "ACHAT RÉGULIER", description: "Acheter un peu chaque mois lisse la volatilité sans chercher le timing.", value: "RÉGULIER" },
        { icon: "shield", title: "COLD WALLET", description: "Garde tes clés sur un portefeuille matériel pour limiter les piratages.", value: "SÉCURITÉ" },
        { icon: "crypto", title: "BTC ET ETH D'ABORD", description: "Garde l'essentiel sur BTC et ETH, et limite les altcoins.", value: "SOLIDE" },
        { icon: "trend", title: "HODL LONG TERME", description: "Tiens sur un cycle complet pour éviter de vendre dans la panique.", value: "PATIENCE" },
        { icon: "chain", title: "VÉRIFIE ON-CHAIN", description: "Avant chaque trade, regarde le volume on-chain : les données parlent.", value: "ON-CHAIN" },
        { icon: "brain", title: "JAMAIS TROP", description: "N'investis jamais en crypto une grosse part de ton patrimoine.", value: "PRUDENT" },
      ],
    },
  ],

  // ─── GAMING ──────────────────────────────────────────────────
  "gaming": [
    {
      subtitle: "Le gaming, ce n'est pas que du fun. C'est un art de vivre.",
      tagLine: "GAMING & PERFORMANCE",
      cards: [
        { icon: "game", title: "ÉCRAN RAPIDE", description: "Un écran à haute fréquence rend tes réactions plus fluides en jeu.", value: "FLUIDE" },
        { icon: "controller", title: "MANETTE SANS FIL", description: "Une manette pro réduit nettement la latence par rapport au standard.", value: "RÉACTIF" },
        { icon: "brain", title: "APM ÉLEVÉ", description: "Multiplie tes actions par minute : c'est la base des esports.", value: "VITESSE" },
        { icon: "joystick", title: "WARM-UP RAPIDE", description: "Quelques minutes d'aim trainer avant de jouer affinent ta précision.", value: "PRÉCIS" },
        { icon: "clock", title: "PAUSES RÉGULIÈRES", description: "Coupe régulièrement tes sessions de jeu pour garder la tête froide.", value: "CALME" },
        { icon: "eye", title: "LUMIÈRE TAMISÉE", description: "Place une lampe derrière ton écran pour reposer tes yeux.", value: "CONFORT" },
      ],
    },
  ],

  // ─── FOOD ────────────────────────────────────────────────────
  "food": [
    {
      subtitle: "Bien manger, c'est vivre mieux. Les secrets des grands chefs.",
      tagLine: "CUISINE & SAVEURS",
      cards: [
        { icon: "chef", title: "MISE EN PLACE", description: "Prépare tout avant de cuisiner : tu gagnes un temps précieux.", value: "ORDRE" },
        { icon: "knife", title: "COUTEAU AFFÛTÉ", description: "Un couteau bien aiguisé coupe plus vite et glisse moins sur tes doigts.", value: "PRÉCIS" },
        { icon: "salad", title: "FRUITS ET LÉGUMES", description: "Mets des fruits et légumes variés à chaque repas de ta journée.", value: "VITALITÉ" },
        { icon: "pizza", title: "PÂTE MAISON", description: "Une pâte faite maison coûte peu et bat largement le surgelé.", value: "MAISON" },
        { icon: "burger", title: "BATCH COOKING", description: "Cuisine le dimanche et tes repas de la semaine sont prêts.", value: "ZEN" },
        { icon: "thermometer", title: "SONDE CUISSON", description: "Une sonde de cuisson t'aide à réussir une viande parfaitement saignante.", value: "PRO" },
      ],
    },
  ],

  // ─── PETS ────────────────────────────────────────────────────
  "pets": [
    {
      subtitle: "Nos animaux nous rendent meilleurs. Prends-en soin comme il se doit.",
      tagLine: "ANIMAUX & BIEN-ÊTRE",
      cards: [
        { icon: "dog", title: "BALADES QUOTIDIENNES", description: "Sors ton chien plusieurs fois par jour pour qu'il reste serein.", value: "SEREIN" },
        { icon: "cat", title: "JEUX INTERACTIFS", description: "Quelques minutes de jeu avec ton chat apaisent son stress.", value: "COMPLICE" },
        { icon: "paw", title: "BROSSAGE HEBDO", description: "Brosse ton animal chaque semaine : moins de poils et un lien renforcé.", value: "LIEN" },
        { icon: "fish", title: "EAU CHANGÉE", description: "Renouvelle une partie de l'eau de l'aquarium chaque semaine.", value: "CLAIR" },
        { icon: "bone", title: "VACCINS À JOUR", description: "Fais le rappel annuel de ses vaccins : la prévention avant tout.", value: "PROTÉGÉ" },
        { icon: "bird", title: "CAGE SPACIEUSE", description: "Choisis une cage bien plus large que l'envergure de ses ailes.", value: "ESPACE" },
      ],
    },
  ],

  // ─── CARS ────────────────────────────────────────────────────
  "cars": [
    {
      subtitle: "Une voiture bien entretenue dure longtemps. Voici comment.",
      tagLine: "AUTO & ENTRETIEN",
      cards: [
        { icon: "car", title: "RÉVISION RÉGULIÈRE", description: "Entretiens ta voiture régulièrement pour prolonger la vie du moteur.", value: "DURABLE" },
        { icon: "fuel", title: "PLEIN LE MATIN", description: "Fais ton plein le matin, à la fraîche, en toute tranquillité.", value: "MALIN" },
        { icon: "wheel", title: "PRESSION AJUSTÉE", description: "Vérifie la pression de tes pneus avant l'autoroute pour consommer moins.", value: "ÉCO" },
        { icon: "gear", title: "VITESSE MODÉRÉE", description: "Lève le pied sur la route pour réduire ta consommation de carburant.", value: "SOBRE" },
        { icon: "key", title: "BATTERIE SURVEILLÉE", description: "Remplace ta batterie à temps pour éviter la panne du matin.", value: "FIABLE" },
        { icon: "road", title: "FREINS CONTRÔLÉS", description: "Fais contrôler tes plaquettes souvent : ta sécurité passe avant tout.", value: "SÉCURITÉ" },
      ],
    },
  ],

  // ─── IMMOBILIER ──────────────────────────────────────────────
  "realestate": [
    {
      subtitle: "L'immobilier reste le meilleur investissement à long terme. Fais-le bien.",
      tagLine: "IMMOBILIER & INVESTISSEMENT",
      cards: [
        { icon: "house", title: "APPORT PERSONNEL", description: "Un apport personnel solide t'aide à négocier un meilleur taux.", value: "APPORT" },
        { icon: "money", title: "TAUX D'EFFORT", description: "Garde tes mensualités de crédit raisonnables face à tes revenus.", value: "LIMITE" },
        { icon: "building", title: "LOCATIF RENTABLE", description: "Vérifie le rendement net d'un locatif avant de te lancer.", value: "RENTABLE" },
        { icon: "keys", title: "VISITES MULTIPLES", description: "Visite de nombreux biens avant d'acheter pour éviter les regrets.", value: "COMPARE" },
        { icon: "door", title: "DIAGNOSTIC ÉNERGIE", description: "Évite les passoires thermiques : travaux lourds et revente difficile.", value: "DPE" },
        { icon: "chart", title: "SCPI ACCESSIBLE", description: "Les SCPI te permettent d'investir dans la pierre sans gestion.", value: "PIERRE" },
      ],
    },
  ],

  // ─── ÉDUCATION ───────────────────────────────────────────────
  "education": [
    {
      subtitle: "Apprendre, c'est le super-pouvoir de notre époque. Voici comment.",
      tagLine: "APPRENTISSAGE & MÉMOIRE",
      cards: [
        { icon: "book", title: "LECTURE QUOTIDIENNE", description: "Lis un peu chaque jour et tu enchaînes les livres dans l'année.", value: "CULTURE" },
        { icon: "graduation", title: "RÉPÉTITION ESPACÉE", description: "Révise à intervalles croissants : ta mémoire retient bien mieux.", value: "MÉMOIRE" },
        { icon: "pencil", title: "FEYNMAN METHOD", description: "Explique ce que tu apprends avec des mots simples, comme à un enfant.", value: "FEYNMAN" },
        { icon: "lightbulb", title: "CARTE MENTALE", description: "Fais une carte mentale après chaque cours pour mieux retenir.", value: "VISUEL" },
        { icon: "teacher", title: "ENSEIGNER = APPRENDRE", description: "Tu retiens bien mieux ce que tu enseignes que ce que tu lis.", value: "PARTAGE" },
        { icon: "brain", title: "POMODORO STUDY", description: "Alterne courtes sessions de travail et petites pauses pour rester concentré.", value: "FOCUS" },
      ],
    },
  ],

  // ─── ASTROLOGIE ──────────────────────────────────────────────
  "astrology": [
    {
      subtitle: "Les astres nous guident. Voici ce que ton signe révèle sur toi.",
      tagLine: "ASTROLOGIE & ÉNERGIES",
      cards: [
        { icon: "zodiac", title: "SIGNES DU ZODIAQUE", description: "Ton ascendant compte autant que ton signe solaire dans ton thème.", value: "ZODIAQUE" },
        { icon: "stars", title: "NOUVELLE LUNE", description: "Chaque nouvelle lune ouvre une fenêtre idéale pour poser tes intentions.", value: "DÉPART" },
        { icon: "moon", title: "PLEINE LUNE", description: "La pleine lune est un moment idéal pour lâcher prise.", value: "LIBÈRE" },
        { icon: "crystal", title: "MERCURE RÉTRO", description: "Pendant Mercure rétrograde, évite de signer des contrats ou gros achats.", value: "PRUDENCE" },
        { icon: "planet", title: "VÉNUS AMOUR", description: "Vénus en transit = périodes de relations et créativité boostées", value: "VÉNUS" },
        { icon: "tarot", title: "THÈME NATAL", description: "Ta carte du ciel à la naissance révèle tes forces et tes défis", value: "NATAL" },
      ],
    },
  ],

};

// Extend existing "motivation" topic with an additional mindset variant
KNOWLEDGE_BASE["motivation"].push({
  subtitle: "La motivation t'ouvre la porte. La discipline te fait passer le seuil.",
  tagLine: "MINDSET & DISCIPLINE",
  cards: [
    { icon: "flame", title: "PROGRÈS QUOTIDIEN", description: "Progresse un peu chaque jour : les petits gains s'additionnent vite.", value: "CUMUL" },
    { icon: "rocket", title: "LÈVE-TOI TÔT", description: "Profite du calme du matin pour te concentrer avant tout le monde.", value: "AUBE" },
    { icon: "flex", title: "TRANSPIRE CHAQUE JOUR", description: "Bouge un peu chaque jour pour ton humeur et ta discipline.", value: "MENTAL" },
    { icon: "crown", title: "PAS D'EXCUSES", description: "Les excuses sont des limites que tu t'imposes : apprends à les lâcher.", value: "ZÉRO" },
    { icon: "thunder", title: "ACTION > PLAN", description: "Un plan imparfait exécuté bat un plan parfait jamais lancé", value: "ACT" },
    { icon: "target", title: "OBJECTIF ÉCRIT", description: "Écris tes objectifs noir sur blanc pour mieux t'y tenir.", value: "CLARTÉ" },
  ],
});

// ══════════════════════════════════════════════════════════════
// ══  EXTRA VARIANTS — seed-driven batch variation             ══
// ══════════════════════════════════════════════════════════════
// When a batch export calls generateSmartContent with a distinct seed
// per iteration, the topic's variant array is indexed by `seed %
// variants.length`. If a topic only has 1 variant, every batch post
// collapses to the same title + subtitle + cards — the root cause
// surfaced by the user's batch-x10 on "energie".
//
// Each .push() below adds a fresh angle (title + subtitle + 5 cards)
// so popular topics ship 4 distinct variants that cycle across a
// batch instead of repeating.

KNOWLEDGE_BASE["energie"].push(
  {
    subtitle: "L'énergie vraie ne vient pas du café, mais du mouvement",
    tagLine: "ÉNERGIE RÉELLE",
    cards: [
      { icon: "fire", title: "CORTISOL RÉGULÉ", description: "Le sport aide à réguler ton stress et stabilise ton énergie.", value: "ÉQUILIBRE" },
      { icon: "dna", title: "ÉNERGIE CELLULAIRE", description: "L'exercice régulier stimule l'énergie produite par tes cellules.", value: "ÉNERGIE" },
      { icon: "moon", title: "SOMMEIL PROFOND", description: "L'activité physique favorise un sommeil profond et plus réparateur.", value: "REPOS" },
      { icon: "sun", title: "HORLOGE BIOLOGIQUE", description: "Bouger le matin synchronise ton cycle circadien pour une journée alerte", value: "SYNC" },
      { icon: "brain", title: "NEUROTRANSMETTEURS", description: "Chaque séance libère dopamine, endorphines et sérotonine dans ton corps.", value: "BIEN-ÊTRE" },
    ],
  },
  {
    subtitle: "Quelques minutes suffisent pour relancer ton énergie",
    tagLine: "RESET EXPRESS",
    cards: [
      { icon: "clock", title: "MINI SESSION", description: "Quelques minutes de mouvement dynamique rechargent vite ton énergie.", value: "RECHARGE" },
      { icon: "fire", title: "JUMPING JACKS", description: "Quelques séries de jumping jacks réveillent tout ton système nerveux.", value: "RÉVEIL" },
      { icon: "energy", title: "ENTRE LES TÂCHES", description: "Les micro-pauses actives t'évitent le coup de barre après le repas.", value: "PAUSE" },
      { icon: "heart", title: "CARDIO EN HAUSSE", description: "Fais grimper ton cardio quelques minutes pour libérer des endorphines.", value: "CARDIO" },
      { icon: "brain", title: "FOCUS BOOSTÉ", description: "Après une courte session, ta concentration reste vive pendant des heures.", value: "FOCUS" },
    ],
  },
  {
    subtitle: "L'énergie est une ressource qu'on recharge, pas qu'on consomme",
    tagLine: "GESTION D'ÉNERGIE",
    cards: [
      { icon: "battery", title: "PAUSES STRATÉGIQUES", description: "Une courte pause régulière préserve ton énergie sur toute la journée.", value: "PAUSE" },
      { icon: "apple", title: "NUTRITION CLEAN", description: "Évite les sucres raffinés : fibres et protéines gardent ton énergie stable.", value: "CLEAN" },
      { icon: "sun", title: "LUMIÈRE DU JOUR", description: "Prends la lumière naturelle le matin pour rester vigilant toute la journée.", value: "ÉVEIL" },
      { icon: "moon", title: "SOMMEIL SUFFISANT", description: "Dors assez, mais pas trop : l'excès aussi fait baisser ton énergie.", value: "DOSÉ" },
      { icon: "water", title: "HYDRATATION", description: "Même une légère déshydratation fait baisser ta performance mentale.", value: "EAU" },
    ],
  },
);

KNOWLEDGE_BASE["cardio"].push(
  {
    subtitle: "Le cardio ne se mesure pas qu'en kilomètres — l'intensité compte plus",
    tagLine: "INTENSITÉ > DURÉE",
    cards: [
      { icon: "fire", title: "HIIT EXPRESS", description: "Une courte séance de HIIT brûle autant qu'un long cardio modéré.", value: "INTENSE" },
      { icon: "heart", title: "ZONE INTENSE", description: "Pousse ton cardio dans la zone haute pour activer le brûlage post-effort.", value: "BRÛLE" },
      { icon: "energy", title: "EFFET EPOC", description: "Ton corps brûle encore longtemps après une séance intense.", value: "AFTERBURN" },
      { icon: "clock", title: "TABATA", description: "Une courte séance Tabata travaille ton cœur comme un long cardio.", value: "EXPRESS" },
      { icon: "brain", title: "CONCENTRATION", description: "Le cardio intense aiguise ta concentration bien après l'effort.", value: "FOCUS" },
    ],
  },
  {
    subtitle: "Cardio débutant : commencer sans se dégoûter",
    tagLine: "DÉBUTANT",
    cards: [
      { icon: "clock", title: "PREMIÈRE SEMAINE", description: "Marche vite sur de courtes sessions pour habituer ton cœur en douceur.", value: "DÉBUT" },
      { icon: "heart", title: "DEUXIÈME SEMAINE", description: "Alterne course lente et marche pour monter en douceur.", value: "ALTERNE" },
      { icon: "fire", title: "TROISIÈME SEMAINE", description: "Cours en continu à une allure où tu peux encore parler.", value: "CONTINU" },
      { icon: "trophy", title: "QUATRIÈME SEMAINE", description: "Ajoute un passage à rythme soutenu au milieu : premier vrai gain.", value: "PALIER" },
      { icon: "shield", title: "APRÈS UN MOIS", description: "Ton cœur gagne en efficacité : tu peux allonger tes séances.", value: "PROGRÈS" },
    ],
  },
  {
    subtitle: "Matin ou soir : quand faire du cardio selon ton objectif",
    tagLine: "MATIN VS SOIR",
    cards: [
      { icon: "sun", title: "MATIN À JEUN", description: "Une séance à jeun le matin mobilise davantage tes graisses.", value: "MATIN" },
      { icon: "moon", title: "SOIR PERFORMANCE", description: "Ta force et ton endurance sont souvent au top en fin de journée.", value: "PUISSANCE" },
      { icon: "brain", title: "MIDI ANTI-STRESS", description: "Une courte séance à midi allège ton stress pour l'après-midi.", value: "DÉTENTE" },
      { icon: "heart", title: "PAS TROP TARD", description: "Évite le cardio intense juste avant le coucher pour bien dormir.", value: "SOMMEIL" },
      { icon: "target", title: "RÉGULARITÉ CLÉ", description: "Le meilleur horaire est celui où tu restes régulier dans la durée.", value: "RÉG" },
    ],
  },
);

KNOWLEDGE_BASE["nutrition"].push(
  {
    subtitle: "Manger pour la performance : les règles du sportif",
    tagLine: "NUTRITION PERFORMANCE",
    cards: [
      { icon: "apple", title: "PROTÉINES SPORTIVES", description: "Un sportif a besoin de plus de protéines au quotidien qu'un sédentaire.", value: "MUSCLE" },
      { icon: "energy", title: "GLUCIDES AVANT", description: "Mange des glucides avant l'effort pour remplir tes réserves d'énergie.", value: "CARBURANT" },
      { icon: "water", title: "HYDRATATION AVANT", description: "Bois un grand verre d'eau avant l'effort pour tenir la performance.", value: "EAU" },
      { icon: "moon", title: "CASÉINE AVANT DODO", description: "Une caséine lente avant de dormir soutient ta récupération musculaire.", value: "NUIT" },
      { icon: "shield", title: "RÉCUPÉRATION", description: "Associe glucides et protéines juste après l'effort pour mieux récupérer.", value: "RÉCUP" },
    ],
  },
  {
    subtitle: "La nutrition qui bat le régime : habitudes durables",
    tagLine: "HABITUDES DURABLES",
    cards: [
      { icon: "scale", title: "ASSIETTE ÉQUILIBRÉE", description: "Remplis ton assiette de légumes, puis ajoute protéines et féculents.", value: "ÉQUILIBRE" },
      { icon: "clock", title: "HARA HACHI BU", description: "Arrête de manger avant d'être totalement rassasié, à la japonaise.", value: "MESURE" },
      { icon: "brain", title: "MASTIQUER LONGTEMPS", description: "Mâche longuement chaque bouchée : la satiété arrive plus vite.", value: "LENT" },
      { icon: "sun", title: "PETIT-DÉJ ROI", description: "Protéines et bons gras au petit-déjeuner évitent les fringales du matin.", value: "STABLE" },
      { icon: "heart", title: "PAS DE DIABOLISATION", description: "Aucun aliment n'est interdit : l'équilibre global tient toute la vie.", value: "ÉQUILIBRE" },
    ],
  },
  {
    subtitle: "Nutrition et microbiote : ton second cerveau influence tout",
    tagLine: "MICROBIOTE & SANTÉ",
    cards: [
      { icon: "dna", title: "MICROBIOTE PUISSANT", description: "Tes bactéries intestinales influencent ton humeur au quotidien.", value: "INTESTIN" },
      { icon: "apple", title: "FIBRES VARIÉES", description: "Varie un maximum les plantes chaque semaine pour un microbiote riche.", value: "DIVERSITÉ" },
      { icon: "shield", title: "FERMENTS", description: "Mets kéfir, choucroute ou kimchi souvent au menu pour ton microbiote.", value: "FERMENTÉ" },
      { icon: "brain", title: "AXE INTESTIN-CERVEAU", description: "Une grande partie de ta sérotonine est produite dans l'intestin.", value: "LIEN" },
      { icon: "fire", title: "INFLAMMATION", description: "Limite les ultra-transformés, qui entretiennent l'inflammation dans ton corps.", value: "ALERTE" },
    ],
  },
);

KNOWLEDGE_BASE["sommeil"].push(
  {
    subtitle: "Sommeil réparateur : le vrai secret des performeurs",
    tagLine: "RÉCUPÉRATION NUIT",
    cards: [
      { icon: "moon", title: "SOMMEIL PROFOND", description: "Le sommeil profond concentre l'essentiel de ta récupération nocturne.", value: "PROFOND" },
      { icon: "dna", title: "HORMONE CROISSANCE", description: "L'hormone de croissance est surtout sécrétée pendant ton sommeil profond.", value: "NUIT" },
      { icon: "brain", title: "MÉMOIRE CONSOLIDÉE", description: "Le sommeil REM fixe les apprentissages de la journée dans la mémoire", value: "REM" },
      { icon: "heart", title: "CORTISOL BAS", description: "Un sommeil de qualité ramène ton cortisol à un bon niveau au réveil.", value: "APAISÉ" },
      { icon: "shield", title: "IMMUNITÉ PROTÉGÉE", description: "Les nuits trop courtes fragilisent tes défenses face aux virus.", value: "DÉFENSES" },
    ],
  },
  {
    subtitle: "Rituel du soir : préparer un sommeil réparateur",
    tagLine: "RITUEL DU SOIR",
    cards: [
      { icon: "sun", title: "LUMIÈRE DU SOIR", description: "Baisse la lumière bien avant le coucher pour lancer ta mélatonine.", value: "DOUCEUR" },
      { icon: "moon", title: "CHAMBRE FRAÎCHE", description: "Une chambre fraîche favorise ton sommeil profond, la chaleur le perturbe.", value: "FRAIS" },
      { icon: "brain", title: "ZÉRO ÉCRAN", description: "Coupe les écrans bien avant de dormir pour laisser venir la mélatonine.", value: "OFF" },
      { icon: "heart", title: "RESPIRATION GUIDÉE", description: "Inspire, retiens, puis expire longuement pour t'endormir plus facilement.", value: "CALME" },
      { icon: "water", title: "DERNIÈRE GORGÉE", description: "Arrête de boire un peu avant de dormir pour limiter les réveils.", value: "NUIT" },
    ],
  },
  {
    subtitle: "Sommeil court : comment gérer quand la vie l'impose",
    tagLine: "GÉRER LES COURTS",
    cards: [
      { icon: "clock", title: "CYCLES COMPLETS", description: "Cale ton réveil sur la fin d'un cycle pour te lever plus frais.", value: "CYCLES" },
      { icon: "sun", title: "SIESTE COURTE", description: "Une courte sieste en début d'après-midi compense une nuit trop courte.", value: "RECHARGE" },
      { icon: "moon", title: "CAFFEINE NAP", description: "Bois un café avant une courte sieste : la caféine agit au réveil.", value: "BOOST" },
      { icon: "brain", title: "DETTE DE SOMMEIL", description: "La dette se rattrape sur la semaine, le week-end aide en partie.", value: "RATTRAPE" },
      { icon: "fire", title: "LUMIÈRE MATIN", description: "Quelques minutes de soleil au réveil recalent ton rythme circadien.", value: "SOLEIL" },
    ],
  },
);

KNOWLEDGE_BASE["stress"].push(
  {
    subtitle: "Stress chronique : ce que la science révèle vraiment",
    tagLine: "SCIENCE DU STRESS",
    cards: [
      { icon: "brain", title: "CORTISOL TOXIQUE", description: "Un stress prolongé finit par peser sur ta mémoire au quotidien.", value: "MÉMOIRE" },
      { icon: "heart", title: "RISQUE CARDIAQUE", description: "Le stress chronique met ton cœur sous pression, prends-le au sérieux.", value: "CŒUR" },
      { icon: "shield", title: "IMMUNITÉ EN BAISSE", description: "Le stress chronique affaiblit tes défenses immunitaires au fil du temps.", value: "DÉFENSES" },
      { icon: "moon", title: "SOMMEIL SABOTÉ", description: "Le stress provoque insomnies et réveils nocturnes : un cercle à casser.", value: "CERCLE" },
      { icon: "fire", title: "INFLAMMATION", description: "Le stress chronique entretient l'inflammation dans ton corps au quotidien.", value: "TERRAIN" },
    ],
  },
  {
    subtitle: "Désactiver le stress : outils express validés",
    tagLine: "OUTILS EXPRESS",
    cards: [
      { icon: "clock", title: "COHÉRENCE CARDIAQUE", description: "Respire lentement plusieurs fois par jour pour faire baisser ton stress.", value: "SOUFFLE" },
      { icon: "water", title: "DOUCHE FROIDE", description: "Quelques secondes d'eau froide activent ton nerf vague et chassent le stress.", value: "FROID" },
      { icon: "dance", title: "BOUGER SOUVENT", description: "Quelques minutes de mouvement aident à évacuer les hormones du stress.", value: "BOUGE" },
      { icon: "brain", title: "ANCRAGE SENSORIEL", description: "Nomme ce que tu entends, touches, sens et vois pour t'ancrer.", value: "ANCRAGE" },
      { icon: "heart", title: "LONGUE EXPIRATION", description: "Expire plus longtemps que tu n'inspires pour activer ton calme intérieur.", value: "CALME" },
    ],
  },
  {
    subtitle: "Le stress utile : transformer la panique en performance",
    tagLine: "STRESS UTILE",
    cards: [
      { icon: "energy", title: "EUSTRESS", description: "Bon stress : cortisol spike court = focus et motivation doublés", value: "EU+" },
      { icon: "brain", title: "RECADRER", description: "Voir le stress comme une ressource plutôt qu'un ennemi réduit ses effets", value: "MINDSET" },
      { icon: "target", title: "DEADLINES", description: "Une échéance claire crée un bon stress qui booste ta performance.", value: "MOTEUR" },
      { icon: "shield", title: "ZONE OPTIMALE", description: "Loi de Yerkes-Dodson : stress modéré = performance maximale", value: "OPT" },
      { icon: "trophy", title: "PRÉPARATION", description: "Préparer physiquement le corps à gérer le stress : sport + respiration = anti-fragile", value: "+FRAG" },
    ],
  },
);

KNOWLEDGE_BASE["protein"].push(
  {
    subtitle: "Protéines : la plupart des gens en mangent mal",
    tagLine: "VÉRITÉS PROTÉINES",
    cards: [
      { icon: "scale", title: "PROTÉINES MINIMUM", description: "Sportif ou sédentaire, adapte ta dose de protéines à ton activité.", value: "DOSE" },
      { icon: "clock", title: "PROTÉINES RÉPARTIES", description: "Répartis tes protéines sur la journée pour mieux nourrir tes muscles.", value: "RYTHME" },
      { icon: "apple", title: "DOSE PAR REPAS", description: "Répartis tes protéines plutôt que de tout manger en un seul repas.", value: "RÉPARTI" },
      { icon: "brain", title: "LEUCINE CLÉ", description: "La leucine lance la synthèse musculaire : viande, œufs et whey en regorgent.", value: "CLÉ" },
      { icon: "moon", title: "AVANT DORMIR", description: "Une caséine lente avant le coucher soutient ta récupération nocturne.", value: "NUIT" },
    ],
  },
  {
    subtitle: "Protéines végétales vs animales : le match",
    tagLine: "VÉGÉ VS ANIMAL",
    cards: [
      { icon: "apple", title: "PROFIL COMPLET", description: "Les protéines animales sont complètes, combine tes sources végétales.", value: "COMPLET" },
      { icon: "dna", title: "BIODISPONIBILITÉ", description: "Viande et œufs s'absorbent très bien, le végétal varie suivant la source.", value: "ABSORBÉ" },
      { icon: "leaf", title: "LÉGUMINEUSES", description: "Associe lentilles et riz pour obtenir un profil protéique complet.", value: "DUO" },
      { icon: "shield", title: "IMPACT ENVIRO", description: "Les protéines végétales pèsent bien moins sur la planète que le bœuf.", value: "PLANÈTE" },
      { icon: "fire", title: "ÉQUIVALENCE", description: "Une portion de lentilles cuites peut remplacer le poulet en protéines.", value: "ÉGAL" },
    ],
  },
  {
    subtitle: "Protéines et perte de poids : le duo gagnant",
    tagLine: "PERTE DE POIDS",
    cards: [
      { icon: "fire", title: "SATIÉTÉ DURABLE", description: "Les protéines te calent plus longtemps que les glucides à calories égales.", value: "CALÉ" },
      { icon: "energy", title: "THERMOGENÈSE", description: "Digérer des protéines demande plus d'énergie que digérer des glucides.", value: "BRÛLE" },
      { icon: "shield", title: "PRÉSERVE MUSCLE", description: "En déficit calorique, les protéines hautes préservent la masse musculaire", value: "+MASSE" },
      { icon: "brain", title: "STABILITÉ GLYCÉMIE", description: "Ajouter protéines aux repas stabilise la glycémie, zéro fringale", value: "STAB" },
      { icon: "trophy", title: "RÉSULTAT DURABLE", description: "Mise sur les protéines pour mieux stabiliser ton poids dans la durée.", value: "DURABLE" },
    ],
  },
);

KNOWLEDGE_BASE["recuperation"].push(
  {
    subtitle: "La récup est où se construit la performance, pas à l'entraînement",
    tagLine: "OÙ ON CONSTRUIT",
    cards: [
      { icon: "moon", title: "REPOS MUSCULAIRE", description: "Laisse chaque groupe musculaire se reconstruire avant de le retravailler.", value: "REPOS" },
      { icon: "dna", title: "ADAPTATION NUIT", description: "Le corps s'adapte à l'effort la nuit : GH libérée pendant le sommeil profond", value: "NUIT" },
      { icon: "fire", title: "SURENTRAÎNEMENT", description: "Sans récup, cortisol chronique = catabolisme musculaire + fatigue", value: "CATA" },
      { icon: "heart", title: "FRÉQUENCE CARDIAQUE", description: "HRV (variabilité cardiaque) haute = bien récupéré, basse = repos nécessaire", value: "HRV" },
      { icon: "shield", title: "JOURS OFF", description: "Planifier des jours off n'est pas un luxe : c'est ta progression.", value: "RECHARGE" },
    ],
  },
  {
    subtitle: "Techniques de récup express : quelques minutes qui changent tout",
    tagLine: "RÉCUP EXPRESS",
    cards: [
      { icon: "water", title: "DOUCHE CONTRASTÉE", description: "Alterne eau chaude et eau froide pour relancer ta récupération.", value: "CONTRASTE" },
      { icon: "brain", title: "RESPIRATION BOX", description: "Inspire, retiens, expire et retiens à rythme égal pour te calmer vite.", value: "CARRÉ" },
      { icon: "dance", title: "MOBILITÉ EXPRESS", description: "Un peu de mobilité relance ta circulation et réduit tes courbatures.", value: "MOBILE" },
      { icon: "moon", title: "YOGA NIDRA", description: "Une courte séance de Yoga Nidra offre une récupération très profonde.", value: "PROFOND" },
      { icon: "apple", title: "COLLATION POST-EFFORT", description: "Après l'effort, mise surtout sur les glucides avec un peu de protéines.", value: "RÉCUP" },
    ],
  },
  {
    subtitle: "Récup active : continuer à bouger pour récupérer plus vite",
    tagLine: "ACTIVE > PASSIVE",
    cards: [
      { icon: "fire", title: "RÉCUP ACTIVE", description: "La récupération active est souvent plus efficace qu'un repos passif.", value: "ACTIF" },
      { icon: "heart", title: "EFFORT LÉGER", description: "Marche ou pédale tranquillement pour évacuer plus vite le lactate.", value: "DOUX" },
      { icon: "bone", title: "ÉTIREMENTS DYNAMIQUES", description: "Étirements dynamiques post-effort > statiques : circulation maintenue", value: "DYN" },
      { icon: "dance", title: "NATATION DOUCE", description: "Nager soulage tes articulations et accélère ta récupération.", value: "FLUIDE" },
      { icon: "brain", title: "FOAM ROLLER", description: "Quelques minutes de rouleau détendent tes fascias et calment les courbatures.", value: "DÉTENTE" },
    ],
  },
);

KNOWLEDGE_BASE["motivation"].push(
  {
    subtitle: "Motivation scientifique : les leviers qui marchent vraiment",
    tagLine: "LEVIERS EFFICACES",
    cards: [
      { icon: "brain", title: "DOPAMINE ANTICIP.", description: "La dopamine vient de l'anticipation : planifie tes séances pour te motiver.", value: "DOPA" },
      { icon: "target", title: "OBJECTIFS SMART", description: "Rends tes objectifs précis, mesurables et datés pour mieux réussir.", value: "SMART" },
      { icon: "flex", title: "HABIT STACKING", description: "Accroche une nouvelle habitude à une ancienne pour la rendre durable.", value: "ANCRÉ" },
      { icon: "shield", title: "BOUCLE HABITUDE", description: "Définis l'indice, la routine et la récompense pour ancrer l'habitude.", value: "BOUCLE" },
      { icon: "heart", title: "PROCESS > GOAL", description: "Concentre-toi sur le processus : la régularité compte plus que l'intensité.", value: "PROC" },
    ],
  },
  {
    subtitle: "Motivation en panne : des tactiques pour relancer la machine",
    tagLine: "RELANCE",
    cards: [
      { icon: "rocket", title: "MINI DÉMARRAGE", description: "Nouvelle habitude : commence par une version très courte, facile à lancer.", value: "FACILE" },
      { icon: "fire", title: "START STUPIDE", description: "Une pompe, une page : commence minuscule pour vaincre la résistance.", value: "MINI" },
      { icon: "clock", title: "SI-ALORS", description: "Planifie « si ceci, alors cela » : passer à l'action devient plus simple.", value: "PLAN" },
      { icon: "target", title: "ENVIRONNEMENT", description: "Rends la bonne action facile et le mauvais comportement difficile.", value: "ENV" },
      { icon: "trophy", title: "PUBLIC COMMITMENT", description: "Annonce ton objectif à tes proches : tu tiendras mieux ton engagement.", value: "PARTAGE" },
    ],
  },
);

KNOWLEDGE_BASE["respiration"].push(
  {
    subtitle: "La respiration est le contrôle caché du système nerveux",
    tagLine: "CONTRÔLE NERVEUX",
    cards: [
      { icon: "brain", title: "NERF VAGUE", description: "Respirer lent active le nerf vague = parasympathique = calme immédiat", value: "VAGUE" },
      { icon: "heart", title: "COHÉRENCE CARDIAQUE", description: "Respire lentement et régulièrement : ton cœur et ton esprit s'apaisent.", value: "CALME" },
      { icon: "moon", title: "SOMMEIL APAISÉ", description: "Inspire, retiens, puis expire longuement : tu t'endors plus en douceur.", value: "SOMMEIL" },
      { icon: "fire", title: "WIM HOF", description: "Enchaîne des respirations rapides puis une pause : un vrai coup d'énergie.", value: "WH" },
      { icon: "energy", title: "KAPALABHATI", description: "Respiration du feu : des expirations rapides réveillent ton corps et ton focus.", value: "FEU" },
    ],
  },
  {
    subtitle: "Respirer juste : beaucoup de gens ne savent plus le faire",
    tagLine: "RÉAPPRENDRE",
    cards: [
      { icon: "heart", title: "DIAPHRAGME", description: "Respire par le ventre : ta main sur le ventre doit monter, pas tes épaules.", value: "VENTRE" },
      { icon: "water", title: "NEZ OBLIGATOIRE", description: "Respirer par le nez filtre et humidifie l'air que tu inspires.", value: "NEZ" },
      { icon: "shield", title: "EXPIRE LONGUE", description: "Expire plus longtemps que tu n'inspires : ton système nerveux se calme.", value: "DÉTENTE" },
      { icon: "brain", title: "HYPERVENTILATION", description: "Respirer vite en stress aggrave le stress. Vicious loop à casser", value: "LOOP" },
      { icon: "sun", title: "APNÉE POSITIVE", description: "Retiens ton souffle après l'expire : tu apprends à mieux gérer le stress.", value: "CONTRÔLE" },
    ],
  },
  {
    subtitle: "Box breathing : la technique des forces spéciales",
    tagLine: "BOX BREATHING",
    cards: [
      { icon: "shield", title: "TECHNIQUE NAVY", description: "Utilisée par les Navy SEALs avant opérations : calme sous pression", value: "SEAL" },
      { icon: "clock", title: "RESPIRATION CARRÉE", description: "Inspire, retiens, expire, retiens, à temps égal, puis recommence plusieurs fois.", value: "CARRÉ" },
      { icon: "brain", title: "AVANT EXAMEN", description: "Quelques cycles avant un examen ou un oral t'aident à rester serein.", value: "SEREIN" },
      { icon: "heart", title: "RÉGULATION", description: "Ce rituel aide à apaiser tension, pulsations et anxiété en quelques minutes.", value: "APAISÉ" },
      { icon: "fire", title: "PLURIQUOTIDIEN", description: "Pratique plusieurs fois par jour : le calme devient ton état normal.", value: "RÉGULIER" },
    ],
  },
);

KNOWLEDGE_BASE["souplesse"].push(
  {
    subtitle: "Souplesse dynamique : la vraie mesure, pas juste toucher ses pieds",
    tagLine: "DYNAMIQUE > STATIQUE",
    cards: [
      { icon: "dance", title: "MOBILITÉ FONCTIONNELLE", description: "La mobilité active est plus utile au quotidien que la souplesse passive.", value: "FONC" },
      { icon: "bone", title: "SQUAT PROFOND", description: "Le squat profond révèle ta mobilité : s'il est difficile, travaille-la.", value: "TEST" },
      { icon: "fire", title: "YOGA FLOW", description: "Quelques séances de flow par semaine : ta mobilité progresse au fil du temps.", value: "MOBILITÉ" },
      { icon: "heart", title: "HIPS = VIE", description: "Hanches raides = dos, genoux, posture. Libérer les hanches change tout", value: "HIPS" },
      { icon: "shield", title: "NERFS GLISSANT", description: "Mobilisation neurale : faire glisser les nerfs réduit douleurs sciatique", value: "NERFS" },
    ],
  },
  {
    subtitle: "Assouplissement express : des mouvements contre le corps rigide",
    tagLine: "MOUVEMENTS CLÉS",
    cards: [
      { icon: "dance", title: "CAT-COW", description: "Enchaîne dos rond et dos creux : toute ta colonne se mobilise en douceur.", value: "COLONNE" },
      { icon: "bone", title: "WORLD'S GREATEST", description: "Fente et rotation de chaque côté : hanches, thorax et épaules se libèrent.", value: "COMPLET" },
      { icon: "fire", title: "POSTURE HANCHES", description: "Assieds-toi jambes pliées en équerre : tes hanches se débloquent vite.", value: "HANCHES" },
      { icon: "heart", title: "BRIDGE + MARCH", description: "Pont fessier + marche : active glutes + stretch fléchisseurs hanches", value: "POST" },
      { icon: "shield", title: "DOWN DOG", description: "Chien tête en bas : ischios, mollets et épaules s'étirent ensemble.", value: "POSE" },
    ],
  },
  {
    subtitle: "Souplesse vs mobilité : les confondre te bloque",
    tagLine: "DIFFÉRENCE CLÉ",
    cards: [
      { icon: "brain", title: "SOUPLESSE PASSIVE", description: "Amplitude maximum atteinte sans effort. Yoga classique, stretch post-sport", value: "PASSIVE" },
      { icon: "fire", title: "MOBILITÉ ACTIVE", description: "Amplitude contrôlée par tes muscles. Ce qui compte vraiment au sport", value: "ACTIVE" },
      { icon: "target", title: "ANIMAL FLOW", description: "Les mouvements animaux combinent force et mobilité active dans un seul exercice.", value: "FLOW" },
      { icon: "shield", title: "PRÉVENTION", description: "Mobilité > souplesse pour prévenir blessures en sport dynamique", value: "PRÉV" },
      { icon: "dance", title: "BOUGER CHAQUE JOUR", description: "Un peu de mobilité chaque jour vaut mieux qu'une longue séance hebdo.", value: "QUOTIDIEN" },
    ],
  },
);

KNOWLEDGE_BASE["confiance"].push(
  {
    subtitle: "La confiance en soi se construit dans l'action, pas la réflexion",
    tagLine: "PAR L'ACTION",
    cards: [
      { icon: "rocket", title: "AGIR D'ABORD", description: "La confiance suit l'action, pas l'inverse. Commence, la confiance suivra", value: "ACT" },
      { icon: "fire", title: "PREUVES PERSO", description: "Collectionner les petites victoires construit une banque de preuves à soi", value: "PROOFS" },
      { icon: "trophy", title: "POSTURE POWER", description: "Adopte une posture ouverte quelques instants : tu te sens plus sûr de toi.", value: "PUISSANCE" },
      { icon: "brain", title: "VOIX INTÉRIEURE", description: "Parle-toi à la troisième personne : tu prends du recul face au stress.", value: "RECUL" },
      { icon: "heart", title: "ÉCHEC = DATA", description: "Reframe : chaque échec est un point de données, pas un jugement sur toi", value: "DATA" },
    ],
  },
  {
    subtitle: "Syndrome de l'imposteur : un piège très répandu",
    tagLine: "IMPOSTEUR",
    cards: [
      { icon: "brain", title: "TU N'ES PAS SEUL", description: "Beaucoup de gens ont déjà ressenti le syndrome de l'imposteur.", value: "COMMUN" },
      { icon: "shield", title: "SIGNE D'INTELLIGENCE", description: "Douter de soi est fréquent chez ceux qui en savent le plus.", value: "+IQ" },
      { icon: "target", title: "NORMALISER", description: "Tout le monde improvise. Personne n'a la notice. Action malgré le doute", value: "NORM" },
      { icon: "trophy", title: "MENTOR PARLE", description: "Parler du doute à un pair/mentor : dédramatise instantanément", value: "TALK" },
      { icon: "fire", title: "CÉLÉBRER PETIT", description: "Célébrer les micro-victoires reprogramme le cerveau à se reconnaître", value: "CÉLÉB" },
    ],
  },
  {
    subtitle: "Confiance physique : ton corps parle avant tes mots",
    tagLine: "CORPS QUI PARLE",
    cards: [
      { icon: "energy", title: "REGARD DROIT", description: "Regarde ton interlocuteur dans les yeux : tu dégages plus d'assurance.", value: "ASSURÉ" },
      { icon: "heart", title: "VOIX GRAVE", description: "Pose ta voix un peu plus bas : ton autorité naturelle ressort davantage.", value: "AUTORITÉ" },
      { icon: "shield", title: "OCCUPER ESPACE", description: "Poitrine ouverte, épaules en arrière : projette la puissance naturelle", value: "POWER" },
      { icon: "dance", title: "DANSE CONFIANCE", description: "Danser régulièrement renforce une confiance corporelle qui te suit partout.", value: "CONFIANCE" },
      { icon: "trophy", title: "SPORT RÉGULIER", description: "Bouger régulièrement nourrit durablement ta confiance en toi.", value: "CONFIANCE" },
    ],
  },
);

KNOWLEDGE_BASE["echauffement"].push(
  {
    subtitle: "L'échauffement qu'il te faut dépend de ta séance",
    tagLine: "ADAPTÉ À LA SÉANCE",
    cards: [
      { icon: "fire", title: "CARDIO EXPRESS", description: "Fais monter ton cœur avec des mouvements globaux : il sera prêt à l'effort.", value: "CHAUFFE" },
      { icon: "dance", title: "MOBILITÉ DYNAMIQUE", description: "Fais des cercles avec hanches, épaules, chevilles et colonne avant de commencer.", value: "CERCLES" },
      { icon: "target", title: "SPÉCIFIQUE", description: "Reproduis quelques gestes de ta séance pour activer tes muscles en douceur.", value: "CIBLÉ" },
      { icon: "energy", title: "ACTIVATION", description: "Bandes élastiques : activer glutes et dos avant compound lifts", value: "ACT" },
      { icon: "shield", title: "NO STATIC", description: "Évite les étirements statiques à froid : garde-les pour la fin de séance.", value: "ÉVITE" },
    ],
  },
  {
    subtitle: "Échauffement court : le minimum qui change tout",
    tagLine: "LE MINIMUM",
    cards: [
      { icon: "clock", title: "RAMP UP", description: "Monte l'intensité progressivement : ton corps se prépare en douceur.", value: "PROGRÈS" },
      { icon: "heart", title: "CŒUR EN ÉVEIL", description: "Vise un cœur un peu plus rapide qu'au repos pour bien t'oxygéner.", value: "RYTHME" },
      { icon: "dance", title: "MOBILITÉ GÉNÉRALE", description: "Balancements, rotations de hanches, cercles de bras : tout le corps", value: "TOUT" },
      { icon: "shield", title: "MOINS DE BLESSURES", description: "Un bon échauffement aide à limiter le risque de blessure.", value: "PROTÈGE" },
      { icon: "fire", title: "AMORCER MUSCLES", description: "Exercice léger active les fibres, prépare les ligaments à la charge", value: "PREP" },
    ],
  },
  {
    subtitle: "Échauffement mental : le sportif ne prépare pas que le corps",
    tagLine: "MENTAL AUSSI",
    cards: [
      { icon: "brain", title: "VISUALISATION", description: "Visualise ta séance parfaite quelques instants : tes gestes se préparent.", value: "MENTAL" },
      { icon: "target", title: "INTENTION", description: "Poser une intention claire : 'aujourd'hui je travaille la force'", value: "FOCUS" },
      { icon: "heart", title: "RESPIRATION CALME", description: "Quelques respirations profondes avant de démarrer recentrent ton système.", value: "RECENTRE" },
      { icon: "fire", title: "MUSIQUE MOTIVANTE", description: "Une musique rythmée avant la séance te met dans l'élan pour performer.", value: "BOOST" },
      { icon: "trophy", title: "ANCRE POSITIVE", description: "Rituel reproduit = entrée en mode performance automatique", value: "ANCHOR" },
    ],
  },
);

KNOWLEDGE_BASE["musique"].push(
  {
    subtitle: "La musique transforme l'effort : preuve scientifique",
    tagLine: "SCIENCE DU BEAT",
    cards: [
      { icon: "energy", title: "ENDURANCE BOOSTÉE", description: "Une musique adaptée t'aide à tenir plus longtemps pendant la séance.", value: "ENDURANCE" },
      { icon: "heart", title: "BPM = EFFORT", description: "Cale le tempo de ta musique sur l'intensité : modéré ou intense.", value: "TEMPO" },
      { icon: "brain", title: "DOPAMINE SPIKE", description: "Ta musique préférée libère de la dopamine : l'effort paraît moins dur.", value: "DOPAMINE" },
      { icon: "fire", title: "SYNCHRONISATION", description: "Bouger en rythme avec musique rend l'effort perçu plus facile", value: "SYNC" },
      { icon: "dance", title: "AFROBEATS BOOSTE", description: "Rythmes afro syncopés activent davantage les muscles que beats linéaires", value: "AFRO" },
    ],
  },
  {
    subtitle: "Playlists idéales : construire pour ta séance",
    tagLine: "PLAYLIST GUIDE",
    cards: [
      { icon: "clock", title: "DURÉE EXACTE", description: "Prépare une playlist de la durée de ta séance pour rester dans la zone.", value: "=SÉANCE" },
      { icon: "energy", title: "PROGRESSION BPM", description: "Monter BPM progressif échauffement → pic intensité → récup", value: "↑↓" },
      { icon: "fire", title: "TRACK HYPE", description: "Place un morceau énergique vers la fin pour relancer ton énergie.", value: "RELANCE" },
      { icon: "brain", title: "FAMILIER > NEW", description: "Musique connue demande moins d'attention, focus sur l'effort", value: "KNOWN" },
      { icon: "heart", title: "VOCALS ATTENTION", description: "Vocaux fort = attention détournée. Préférer instrumental si besoin focus", value: "INSTR" },
    ],
  },
  {
    subtitle: "Musique afro et entraînement : le combo sous-estimé",
    tagLine: "AFRO + ENTRAÎN.",
    cards: [
      { icon: "dance", title: "POLYRYTHMIE", description: "Afrobeats polyrythmiques sollicitent plus de muscles simultanément", value: "POLY" },
      { icon: "heart", title: "CORPS EN MOUV.", description: "Impossible de rester statique sur un afrobeat : le corps bouge naturellement", value: "MOUV" },
      { icon: "fire", title: "GROOVE > COMPTE", description: "Groove continu > rythme linéaire : meilleur pour endurance longue", value: "GROOVE" },
      { icon: "brain", title: "MENTAL UPLIFTING", description: "Lyrics positifs et énergie afro boostent mentalement l'effort", value: "+ÉNERGIE" },
      { icon: "trophy", title: "IDENTITÉ CULTURELLE", description: "Se mouvoir sur sa culture = performance et fierté en même temps", value: "IDENT" },
    ],
  },
);

KNOWLEDGE_BASE["communaut"].push(
  {
    subtitle: "Pratiquer en communauté : le facteur qui triple ton assiduité",
    tagLine: "POUVOIR DU GROUPE",
    cards: [
      { icon: "heart", title: "ADHÉSION RENFORCÉE", description: "Le sport en groupe t'aide à rester bien plus assidu que seul.", value: "ASSIDU" },
      { icon: "fire", title: "ACCOUNTABILITY", description: "Savoir qu'on t'attend = excuse impossible. Le groupe fait lever", value: "ACCOUNT" },
      { icon: "brain", title: "MOTIVATION CONTAG.", description: "L'énergie collective déclenche des neurones miroirs = envie naturelle", value: "MIRROR" },
      { icon: "shield", title: "MOINS DE DOUTES", description: "Avancer ensemble aide à apaiser le syndrome de l'imposteur.", value: "ENSEMBLE" },
      { icon: "trophy", title: "OBJECTIFS PARTAGÉS", description: "Partager tes objectifs t'aide à aller plus loin qu'en solo.", value: "ÉQUIPE" },
    ],
  },
  {
    subtitle: "Communauté Afroboost : la famille qui pousse vers le haut",
    tagLine: "AFROBOOST FAMILY",
    cards: [
      { icon: "dance", title: "CULTURE PARTAGÉE", description: "Danser sur sa musique avec sa communauté = transcender l'effort", value: "CULTURE" },
      { icon: "heart", title: "ZÉRO JUGEMENT", description: "Un espace bienveillant et sans jugement te permet de vraiment progresser.", value: "SAFE" },
      { icon: "fire", title: "FEMININE POWER", description: "Communauté de femmes noires : force, joie, transformation au quotidien", value: "SŒURS" },
      { icon: "brain", title: "INSPIRATION MUTUELLE", description: "Voir les autres progresser te donne confiance en tes propres capacités", value: "INSPIRE" },
      { icon: "trophy", title: "LIENS DURABLES", description: "Au-delà du sport : amitiés, soutien, network professionnel naissent", value: "BEYOND" },
    ],
  },
  {
    subtitle: "Isolement = ennemi silencieux de la santé",
    tagLine: "ANTIDOTE ISOL.",
    cards: [
      { icon: "shield", title: "LIEN SOCIAL", description: "L'isolement pèse sur la santé : garde le contact avec tes proches.", value: "LIEN" },
      { icon: "brain", title: "CERVEAU ACTIF", description: "Des échanges sociaux réguliers aident à garder ton esprit vif.", value: "VIF" },
      { icon: "heart", title: "CORTISOL BAISSE", description: "Un moment positif partagé t'apaise souvent mieux que de rester seul.", value: "APAISÉ" },
      { icon: "dance", title: "SPORT SOCIAL", description: "Un cours en groupe cumule les bienfaits physiques et relationnels.", value: "DOUBLE" },
      { icon: "trophy", title: "APPARTENANCE", description: "Besoin humain fondamental : faire partie d'un groupe = bien-être profond", value: "HUMAN" },
    ],
  },
);

// ══════════════════════════════════════════════════════════════
// ══  KEYWORD MAP — Mots-clés → Topic                        ══
// ══════════════════════════════════════════════════════════════

const KEYWORD_MAP: Record<string, string> = {
  // Eau
  "eau": "eau", "hydratation": "eau", "boire": "eau", "soif": "eau", "water": "eau", "deshydratation": "eau",
  // Crampes
  "crampe": "crampe", "crampes": "crampe", "courbature": "crampe", "courbatures": "crampe",
  // Sommeil
  "sommeil": "sommeil", "dormir": "sommeil", "nuit": "sommeil", "repos": "sommeil", "insomnie": "sommeil", "sieste": "sommeil",
  // Calories
  "calorie": "calorie", "calories": "calorie", "bruler": "calorie", "kcal": "calorie",
  // Stress
  "stress": "stress", "anxiete": "stress", "mental": "stress", "zen": "stress", "detente": "stress", "angoisse": "stress",
  // Protéines
  "proteine": "protein", "proteines": "protein", "protein": "protein", "whey": "protein",
  // Nutrition
  "nutrition": "nutrition", "alimentation": "nutrition", "repas": "nutrition", "diete": "nutrition",
  // Cardio
  "cardio": "cardio", "endurance": "cardio", "coeur": "cardio", "vo2": "cardio",
  // Communauté
  "communaute": "communaut", "tribu": "communaut", "groupe": "communaut", "ensemble": "communaut",
  // Horaires
  "horaire": "horaire", "horaires": "horaire", "planning": "horaire", "programme": "horaire", "quand": "horaire", "creneau": "horaire",
  // Débutant
  "debutant": "debut", "commencer": "debut", "premier": "debut", "debuter": "debut", "nouveau": "debut", "novice": "debut",
  // Musique
  "musique": "musique", "afrobeat": "musique", "beat": "musique", "playlist": "musique", "rythme": "musique",
  // Poids
  "poids": "poids", "kilos": "poids", "silhouette": "poids", "mince": "poids", "maigrir": "poids", "mincir": "poids", "graisse": "poids",
  // Énergie
  "energie": "energie", "fatigue": "energie", "boost": "energie", "vitalite": "energie", "dynamique": "energie",
  // Souplesse
  "souplesse": "souplesse", "flexible": "souplesse", "flexibilite": "souplesse", "etirement": "souplesse", "mobilite": "souplesse",
  // Confiance
  "confiance": "confiance", "estime": "confiance", "assurance": "confiance",
  // Échauffement
  "echauffement": "echauffement", "warmup": "echauffement",
  // Récupération
  "recuperation": "recuperation", "recup": "recuperation",
  // Cours
  "cours": "cours", "session": "cours", "seance": "cours", "entrainement": "cours", "training": "cours",
  "fitness": "cours", "sport": "cours", "sports": "cours", "sportif": "cours", "sportive": "cours", "workout": "cours", "exercice": "cours", "exercices": "cours",
  // Motivation
  "motivation": "motivation", "motive": "motivation", "regularite": "motivation", "habitude": "motivation", "discipline": "motivation",
  // Danse
  "danse": "danse", "danser": "danse", "choregraphie": "danse", "mouvement": "danse",
  // Silent
  "silent": "silent", "casque": "silent", "disco": "silent", "silencieux": "silent",
  // Respiration
  "respiration": "respiration", "respirer": "respiration", "souffle": "respiration", "poumon": "respiration", "oxygene": "respiration",
  // ── NOUVEAUX ──
  // Magnésium
  "magnesium": "magnesium", "mg": "magnesium",
  // Féculents
  "feculent": "feculent", "feculents": "feculent", "pates": "feculent", "riz": "feculent", "patate": "feculent", "pomme de terre": "feculent", "pain": "feculent", "cereale": "feculent", "cereales": "feculent", "amidon": "feculent", "avoine": "feculent",
  // Vitamines
  "vitamine": "vitamine", "vitamines": "vitamine", "vitamin": "vitamine",
  // Fer
  "fer": "fer", "anemie": "fer", "hemoglobine": "fer",
  // Zinc
  "zinc": "zinc",
  // Oméga 3
  "omega": "omega", "omega3": "omega", "poisson": "omega", "sardine": "omega", "saumon": "omega",
  // Sucre
  "sucre": "sucre", "glucose": "sucre", "fructose": "sucre", "bonbon": "sucre", "soda": "sucre", "sucrerie": "sucre",
  // Glucides
  "glucide": "glucide", "glucides": "glucide", "carbs": "glucide", "hydrate de carbone": "glucide",
  // Collagène
  "collagene": "collagene", "tendon": "collagene", "tendons": "collagene", "ligament": "collagene",
  // Posture
  "posture": "posture", "dos": "posture", "colonne": "posture", "vertebre": "posture",
  // Transpiration
  "transpiration": "transpiration", "transpirer": "transpiration", "sueur": "transpiration", "suer": "transpiration",
  // Abdos
  "abdo": "abdo", "abdos": "abdo", "abdominaux": "abdo", "core": "abdo", "gainage": "abdo", "ventre": "abdo",
  // Fessiers
  "fessier": "fessier", "fessiers": "fessier", "fesses": "fessier", "booty": "fessier", "squat": "fessier", "squats": "fessier",
  // Endorphines
  "endorphine": "endorphine", "endorphines": "endorphine", "bonheur": "endorphine", "dopamine": "endorphine", "serotonine": "endorphine", "hormone": "endorphine",
  // Coordination
  "coordination": "coordination", "equilibre": "coordination", "proprioception": "coordination",
  // Immunité
  "immunite": "immunit", "immunitaire": "immunit", "defense": "immunit", "defenses": "immunit", "rhume": "immunit", "grippe": "immunit",
  // Diabète
  "diabete": "diabete", "glycemie": "diabete", "insuline": "diabete",
  // Cholestérol
  "cholesterol": "cholesterol", "hdl": "cholesterol", "ldl": "cholesterol", "triglyceride": "cholesterol",
  // Articulations
  "articulation": "articulation", "articulations": "articulation", "genou": "articulation", "genoux": "articulation", "cheville": "articulation", "hanche": "articulation",
  // Curcuma
  "curcuma": "curcuma", "curcumine": "curcuma", "anti-inflammatoire": "curcuma",
  // Banane
  "banane": "banane", "potassium": "banane",
  // Ananas
  "ananas": "ananas", "pineapple": "ananas", "bromelaine": "ananas",
  // Mangue
  "mangue": "mangue", "mango": "mangue", "mangues": "mangue",
  // Avocat
  "avocat": "avocat", "avocado": "avocat", "avocats": "avocat",
  // Gingembre
  "gingembre": "gingembre", "ginger": "gingembre", "gingerol": "gingembre",
  // Citron
  "citron": "citron", "citrons": "citron", "lemon": "citron", "lime": "citron",
  // Café
  "cafe": "cafe", "cafeine": "cafe", "expresso": "cafe", "espresso": "cafe",
  // Alcool
  "alcool": "alcool", "biere": "alcool", "vin": "alcool", "aperitif": "alcool",
  // Manioc
  "manioc": "manioc", "cassava": "manioc", "tapioca": "manioc", "foufou": "manioc", "fufu": "manioc", "attiéké": "manioc", "attieke": "manioc", "gari": "manioc",
  // Moringa
  "moringa": "moringa", "moringue": "moringa", "nebeday": "moringa",
  // Baobab
  "baobab": "baobab", "bouye": "baobab", "pain de singe": "baobab",
  // Igname
  "igname": "igname", "yam": "igname",
  // Plantain
  "plantain": "plantain", "alloco": "plantain", "banane plantain": "plantain",
  // Manger (→ nutrition)
  "manger": "nutrition",
  // ── 15 NOUVEAUX THÈMES ──
  "beauty": "beauty", "beaute": "beauty", "maquillage": "beauty", "makeup": "beauty", "peau": "beauty", "skincare": "beauty", "cosmetique": "beauty",
  "parenting": "parenting", "parentalite": "parenting", "enfant": "parenting", "bebe": "parenting", "maman": "parenting", "papa": "parenting", "famille": "parenting", "parent": "parenting",
  "travel": "travel", "voyage": "travel", "voyager": "travel", "vacances": "travel", "tourisme": "travel", "destination": "travel",
  "productivity": "productivity", "productivite": "productivity", "efficacite": "productivity", "focus": "productivity", "concentration": "productivity", "organisation": "productivity",
  "finance": "finance", "argent": "finance", "budget": "finance", "epargne": "finance", "investir": "finance", "bourse": "finance", "patrimoine": "finance",
  "coding": "coding", "code": "coding", "developpement": "coding", "developpeur": "coding", "programmation": "coding", "dev": "coding",
  "crypto": "crypto", "bitcoin": "crypto", "ethereum": "crypto", "blockchain": "crypto", "nft": "crypto", "defi": "crypto",
  "gaming": "gaming", "jeu": "gaming", "jeux": "gaming", "gamer": "gaming", "esport": "gaming", "console": "gaming", "pc gaming": "gaming",
  "food": "food", "cuisine": "food", "cuisiner": "food", "recette": "food", "plat": "food", "gastronomie": "food",
  "pets": "pets", "animal": "pets", "animaux": "pets", "chien": "pets", "chat": "pets", "compagnon": "pets",
  "cars": "cars", "voiture": "cars", "auto": "cars", "automobile": "cars", "vehicule": "cars",
  "realestate": "realestate", "immobilier": "realestate", "immobiliere": "realestate", "appartement": "realestate", "maison": "realestate", "locatif": "realestate",
  "education": "education", "apprendre": "education", "etude": "education", "etudier": "education", "memoire": "education", "cerveau": "education",
  "astrology": "astrology", "astrologie": "astrology", "horoscope": "astrology", "zodiaque": "astrology", "astres": "astrology", "signe": "astrology",
  "mindset": "motivation", "objectif": "motivation", "objectifs": "motivation", "reussir": "motivation", "reussite": "motivation",
};

// ══════════════════════════════════════════════════════════════
// ══  FONCTION PRINCIPALE                                      ══
// ══════════════════════════════════════════════════════════════

export type SmartContentResult = {
  subtitle: string;
  tagLine: string;
  cards: InfoCardData[];
};

/**
 * Trim a description to a complete sentence/phrase that fits a card slot.
 * The preview and composer both truncate at 40-80 chars — so we normalize
 * everything to ≤ maxChars at a word boundary and add a terminal period
 * when the input had none. Pre-existing periods / punctuation are
 * preserved. Returns the original string unchanged when it already fits.
 */
export function shortenForCard(text: string | undefined, maxChars: number = 80): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  }
  // Prefer cutting at a sentence boundary within the budget.
  const sentenceMatches = Array.from(trimmed.matchAll(/[.!?]+(?:\s|$)/g));
  let bestEnd = -1;
  for (const match of sentenceMatches) {
    const idx = (match.index ?? 0) + match[0].trimEnd().length;
    if (idx <= maxChars) bestEnd = idx;
    else break;
  }
  if (bestEnd > 0) return trimmed.slice(0, bestEnd).trim();
  // No sentence fits — cut at the last word boundary before maxChars.
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const core = (lastSpace > 20 ? slice.slice(0, lastSpace) : slice)
    .replace(/[\s,;:–—-]+$/, '');
  return /[.!?…]$/.test(core) ? core : `${core}.`;
}

/**
 * Génère automatiquement un sous-titre + 5 cartes d'infographie ÉDUCATIVES
 * à partir d'un titre/sujet donné par l'utilisateur.
 *
 * Pool mode: passing `seed` (batchIndex or any integer) makes the generator
 * deterministic — batch iteration N gets a different slice of the pool than
 * iteration N+1, so calling the same topic 10 times in a row yields 10
 * distinct results (variant rotation × card window rotation).
 */
export function generateSmartContent(title: string, seed?: number): SmartContentResult {
  const s = typeof seed === 'number' && Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : undefined;
  // Normaliser : minuscules, sans accents, sans ponctuation
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  // 1. Chercher le meilleur match mot-clé
  let matchedTopic: string | null = null;
  let bestMatchLength = 0;

  const tousLesMots = normalized.split(/[\s,.'&+\-/]+/).filter((w) => w.length >= 2);
  // Mots de CONTEXTE (« à la maison », « chez soi ») : ils ne choisissent le
  // thème que si rien d'autre n'est reconnu. Sans cela, « Fitness et sport à
  // la maison » tombait sur l'immobilier (« maison » → realestate, le mot
  // reconnu le plus long).
  const MOTS_CONTEXTE = new Set(['maison', 'home', 'domicile', 'chez']);
  const reconnu = (w: string) => !!KEYWORD_MAP[w] || Object.keys(KEYWORD_MAP).some((k) => k.length >= 3 && w.length >= 3 && (w.startsWith(k) || k.startsWith(w)));
  const forts = tousLesMots.filter((w) => !MOTS_CONTEXTE.has(w));
  const words = forts.some(reconnu) ? forts : tousLesMots;

  for (const word of words) {
    // Match exact
    if (KEYWORD_MAP[word] && word.length > bestMatchLength) {
      matchedTopic = KEYWORD_MAP[word];
      bestMatchLength = word.length;
    }
    // Match partiel (le mot commence par le keyword ou inversement)
    for (const [keyword, topic] of Object.entries(KEYWORD_MAP)) {
      if (
        (word.startsWith(keyword) || keyword.startsWith(word)) &&
        keyword.length >= 3 &&
        word.length >= 3 &&
        keyword.length > bestMatchLength
      ) {
        matchedTopic = topic;
        bestMatchLength = keyword.length;
      }
    }
  }

  // 2. Fallback : chercher dans le titre complet
  if (!matchedTopic) {
    for (const [keyword, topic] of Object.entries(KEYWORD_MAP)) {
      if (normalized.includes(keyword) && keyword.length > bestMatchLength) {
        matchedTopic = topic;
        bestMatchLength = keyword.length;
      }
    }
  }

  // 3. Récupérer les données
  let topicData: TopicData;
  if (matchedTopic && KNOWLEDGE_BASE[matchedTopic]) {
    const variants = KNOWLEDGE_BASE[matchedTopic];
    const pickIdx = s !== undefined
      ? s % variants.length
      : Math.floor(Math.random() * variants.length);
    topicData = variants[pickIdx];
  } else {
    topicData = generateDynamicFallback(title, normalized, s);
  }

  // 4. Convertir les icônes et éventuellement tourner les cartes pour varier
  // d'un appel à l'autre. Le route /api/content/generate cappe à 3 cartes
  // alors que chaque entry en fournit 5 ; en décalant la fenêtre (seed),
  // deux appels successifs avec le même topic renvoient des cartes
  // différentes au lieu des 3 premières à chaque fois.
  const sourceCards = topicData.cards;
  const offset = s !== undefined && sourceCards.length > 0
    ? s % sourceCards.length
    : 0;
  const rotated = offset > 0
    ? [...sourceCards.slice(offset), ...sourceCards.slice(0, offset)]
    : sourceCards;
  // AUCUN CHIFFRE INVENTÉ (`chiffres-sources.ts`) : la base locale porte des
  // statistiques sans source (« VOLS -40% », « 7 kg = 10 jours »). Seuls les
  // nombres écrits par l'utilisateur (son sujet) restent ; le reste devient
  // qualitatif, et la valeur n'est jamais répétée dans le titre.
  const autorises = chiffresAutorises(title);
  const cards: InfoCardData[] = rotated.map((card) => {
    const propre = carteSansChiffresInventes({ title: card.title, description: card.description, value: card.value }, autorises);
    return {
      icon: ICONS[card.icon] || "Sparkles",  // repli SVG neutre, jamais un emoji
      title: propre.title ?? card.title,
      description: shortenForCard(propre.description, 80),
      value: propre.value ?? '',
    };
  });

  return {
    // Sous-titre vidé (il n'était qu'un chiffre) : la phrase d'accroche du thème.
    subtitle: texteSansChiffresInventes(topicData.subtitle, autorises)
      || texteSansChiffresInventes(topicData.tagLine.charAt(0) + topicData.tagLine.slice(1).toLowerCase(), autorises),
    tagLine: titreSansChiffresInventes(topicData.tagLine, autorises),
    cards,
  };
}

/**
 * Fallback DYNAMIQUE quand le sujet n'est pas dans la base.
 * Génère du contenu personnalisé basé sur le titre plutôt que du générique.
 */
/**
 * Dynamic fallback for topics that don't match the curated KNOWLEDGE_BASE.
 * Each category (nutri / sport / body / wellness / default) carries 5
 * distinct pools — each pool is a full TopicData with its own angle
 * (science, routine, pitfalls, transformation, energy, etc.). A seed
 * (batchIndex from the caller) picks the whole pool, not an offset
 * within one pool, so every batch iteration gets a materially different
 * subtitle + tagLine + cards[] rather than the same 5 cards rotated.
 */
function generateDynamicFallback(title: string, _normalized: string, seed?: number): TopicData {
  const upper = title.toUpperCase().trim();
  const displayName = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();

  const nutriKeywords = ["fruit", "legume", "aliment", "nourriture", "plat", "recette", "ingredient", "graine", "noix", "huile", "lait", "yaourt", "fromage", "viande", "oeuf", "tomate", "avocat", "epinard", "brocoli", "quinoa", "lentille", "haricot", "amande", "chocolat", "miel", "gingembre", "ail", "citron", "orange", "mangue", "ananas", "coco", "the", "manioc", "moringa", "baobab", "igname", "plantain", "patate", "riz", "mais", "mil", "sorgho", "fonio", "taro", "gombo", "hibiscus", "bissap", "tamarin", "karite", "arachide", "sesame", "curcuma", "collagene", "spiruline", "acerola", "guarana", "matcha", "ashwagandha", "maca", "goji", "acai", "chia", "lin", "chanvre"];
  const sportKeywords = ["sport", "exercice", "jump", "hiit", "stretch", "yoga", "pilates", "boxe", "combat", "sprint", "marche", "velo", "natation", "nage", "course", "running"];
  const bodyKeywords = ["bras", "jambe", "epaule", "mollet", "cuisse", "poitrine", "taille", "pied", "main", "cou", "nuque", "hanche"];
  const wellnessKeywords = ["meditation", "relaxation", "massage", "sauna", "bain", "detox", "jeune", "intermittent", "aromatherapie", "acupuncture"];

  const norm = _normalized;
  const isNutri = nutriKeywords.some(k => norm.includes(k));
  const isSport = sportKeywords.some(k => norm.includes(k));
  const isBody = bodyKeywords.some(k => norm.includes(k));
  const isWellness = wellnessKeywords.some(k => norm.includes(k));

  const nutriPools: TopicData[] = [
    { subtitle: `${displayName} : la science derrière ses pouvoirs`, tagLine: "BIENFAITS NATURELS", cards: [
      { icon: "apple", title: "RICHESSE NUTRITIVE", description: `${displayName} regorge de vitamines, minéraux et antioxydants clés`, value: "TOP" },
      { icon: "shield", title: "ANTI-INFLAMMATOIRE", description: "Ses composés naturels soutiennent l'équilibre de ton corps au quotidien.", value: "ÉQUILIBRE" },
      { icon: "energy", title: "ÉNERGIE DURABLE", description: "Les sucres naturels libèrent l'énergie progressivement, sans pic brutal.", value: "DURABLE" },
      { icon: "fire", title: "MÉTABOLISME ACTIF", description: "Ses enzymes naturelles accompagnent ton métabolisme au quotidien.", value: "ACTIF" },
      { icon: "heart", title: "CŒUR CHOUCHOUTÉ", description: "Intégré à une alimentation variée, il prend soin de ton cœur.", value: "CŒUR" },
    ]},
    { subtitle: `${displayName} : routine, dosage et résultats`, tagLine: "GUIDE PRATIQUE", cards: [
      { icon: "sun", title: "MATIN À JEUN", description: `Consomme ${displayName} le matin pour activer ton métabolisme dès le réveil.`, value: "MATIN" },
      { icon: "scale", title: "DOSE JUSTE", description: `Consomme ${displayName} chaque jour en portion raisonnable pour en profiter.`, value: "MESURÉ" },
      { icon: "clock", title: "PATIENCE", description: "Les effets se ressentent après quelques semaines de consommation régulière.", value: "PATIENCE" },
      { icon: "target", title: "ASSOCIATIONS", description: `Combine ${displayName} avec une autre source naturelle pour synergie maximale`, value: "MIX" },
      { icon: "trophy", title: "RETOURS POSITIFS", description: "Beaucoup de personnes ressentent des effets positifs avec la régularité.", value: "POSITIF" },
    ]},
    { subtitle: `${displayName} vs industriel : le match`, tagLine: "NATUREL VS TRANSFORMÉ", cards: [
      { icon: "leaf", title: "VERSION BRUTE", description: `${displayName} brut garde bien plus de nutriments que sa version transformée.`, value: "BRUT" },
      { icon: "shield", title: "SANS ADDITIFS", description: "Aucun conservateur, colorant ou sucre ajouté : juste ce que la nature offre.", value: "NATUREL" },
      { icon: "heart", title: "MOINS DE SODIUM", description: "Les produits industriels contiennent bien plus de sodium que l'original.", value: "LÉGER" },
      { icon: "energy", title: "INDEX GLYCÉMIQUE BAS", description: "Pas de pic brutal : ton énergie reste stable et tes fringales diminuent.", value: "STABLE" },
      { icon: "brain", title: "MICROBIOTE NOURRI", description: "Les fibres naturelles nourrissent les bonnes bactéries de ton intestin.", value: "FIBRES" },
    ]},
    { subtitle: `${displayName} : les erreurs que tout le monde fait`, tagLine: "PIÈGES À ÉVITER", cards: [
      { icon: "alert", title: "TROP CUIT = PERDU", description: "Une cuisson trop forte détruit une partie des vitamines fragiles.", value: "CUISSON" },
      { icon: "clock", title: "MAUVAIS TIMING", description: "À jeun vs après repas change totalement l'assimilation des nutriments", value: "TIMING" },
      { icon: "scale", title: "DOSE INADÉQUATE", description: "Trop peu = aucun effet, trop = digestion perturbée. Vise le juste milieu", value: "DOSAGE" },
      { icon: "ban", title: "FAUX AMIS", description: "Certains compléments promettent pareil mais sans les synergies naturelles", value: "≠" },
      { icon: "shield", title: "CONSERVATION", description: "Un stockage à la lumière ou à la chaleur abîme ses bienfaits.", value: "À L'ABRI" },
    ]},
    { subtitle: `${displayName} au quotidien : ton corps se transforme`, tagLine: "TRANSFORMATION", cards: [
      { icon: "calendar", title: "PHASE ADAPTATION", description: `Ton corps commence à assimiler ${displayName}. Laisse-lui le temps de s'habituer.`, value: "DÉBUT" },
      { icon: "energy", title: "PHASE ÉNERGIE", description: "Ton énergie du matin grimpe et le coup de fatigue de l'après-midi recule.", value: "ÉNERGIE" },
      { icon: "brain", title: "PHASE CLARTÉ", description: "Ta concentration et ton humeur s'améliorent, le brouillard se dissipe.", value: "CLARTÉ" },
      { icon: "heart", title: "PHASE RÉSULTAT", description: "Digestion, sommeil, peau : tu peux ressentir les bienfaits sur plusieurs plans.", value: "BILAN" },
      { icon: "trophy", title: "SUR LA DURÉE", description: "Garde le rythme : les effets positifs s'installent dans la durée.", value: "DURABLE" },
    ]},
  ];

  const sportPools: TopicData[] = [
    { subtitle: `${displayName} + danse afro : le combo qui transforme`, tagLine: "CROSS-TRAINING", cards: [
      { icon: "fire", title: "CORPS COMPLET", description: `Combiner ${displayName.toLowerCase()} et danse afro travaille ton corps sous tous les angles.`, value: "COMPLET" },
      { icon: "heart", title: "CARDIO VARIÉ", description: "Alterne les activités pour éviter que ton corps s'habitue : tu progresses.", value: "VARIÉ" },
      { icon: "muscle", title: "MUSCLES COMPLETS", description: "Chaque sport cible des muscles différents. Le mix = silhouette équilibrée", value: "FULL" },
      { icon: "brain", title: "ZÉRO ROUTINE", description: "La variété tue l'ennui : tu restes motivé bien plus longtemps.", value: "MOTIVÉ" },
      { icon: "shield", title: "MOINS DE BLESSURES", description: "Varier les mouvements aide à limiter les blessures de surutilisation.", value: "VARIÉTÉ" },
    ]},
    { subtitle: `${displayName} débutant vs avancé : le même geste, deux niveaux`, tagLine: "PROGRESSION ADAPTÉE", cards: [
      { icon: "star", title: "PREMIÈRES SEMAINES", description: `Apprends les bases de ${displayName.toLowerCase()} : vitesse lente, forme parfaite.`, value: "BASE" },
      { icon: "energy", title: "PHASE MONTÉE", description: "Augmente intensité et durée : ton corps s'adapte et en redemande.", value: "BUILD" },
      { icon: "fire", title: "PHASE INTENSE", description: "Ajoute charge, vitesse ou complexité : tes progrès s'accélèrent.", value: "PUSH" },
      { icon: "trophy", title: "NIVEAU AVANCÉ", description: "Tu enchaînes les séances avancées avec une confiance toute neuve.", value: "LVL UP" },
      { icon: "heart", title: "ÉCOUTE TON CORPS", description: "Progresser = respecter les signaux. Repos = partie du programme, pas échec", value: "⇌" },
    ]},
    { subtitle: `${displayName} : la routine express`, tagLine: "ÉNERGIE RAPIDE", cards: [
      { icon: "clock", title: "ÉCHAUFFEMENT", description: "Mobilise tes articulations et fais un cardio léger pour préparer ton corps.", value: "CHAUFFE" },
      { icon: "fire", title: "BLOC PRINCIPAL", description: `Enchaîne ${displayName.toLowerCase()} en intensité, en alternant effort et récupération.`, value: "INTENSE" },
      { icon: "moon", title: "RETOUR AU CALME", description: "Termine par des étirements doux pour limiter les courbatures du lendemain.", value: "DOUCEUR" },
      { icon: "energy", title: "AVANT LE BOULOT", description: "Une courte séance le matin booste ton énergie et ta concentration.", value: "ÉNERGIE" },
      { icon: "heart", title: "RÉGULARITÉ", description: "La régularité compte plus que la durée : privilégie des séances courtes.", value: "RÉGULIER" },
    ]},
    { subtitle: `${displayName} : les erreurs qui bloquent tes progrès`, tagLine: "PIÈGES À ÉVITER", cards: [
      { icon: "alert", title: "TROP TÔT TROP FORT", description: "Monter l'intensité sans base technique t'expose vite aux blessures.", value: "⚠" },
      { icon: "moon", title: "PAS DE RÉCUP", description: "Sans jour de repos, ta progression stagne et la fatigue s'installe.", value: "REPOS" },
      { icon: "ban", title: "FORME NÉGLIGÉE", description: "Un geste mal exécuté et répété crée des compensations musculaires durables.", value: "FORM" },
      { icon: "scale", title: "NUTRITION OUBLIÉE", description: "S'entraîner sans nutrition adaptée te fait perdre une bonne part des résultats.", value: "ASSIETTE" },
      { icon: "brain", title: "PAS DE PROGRESSION", description: "Même charge pendant des mois = plateau. Le corps a besoin de surcharge", value: "↑" },
    ]},
    { subtitle: `${displayName} matin vs soir : quand s'entraîner ?`, tagLine: "ROUTINE MATIN/SOIR", cards: [
      { icon: "sun", title: "MATIN : MÉTABOLISME", description: `Pratiquer ${displayName.toLowerCase()} à jeun booste l'oxydation des graisses`, value: "AM" },
      { icon: "fire", title: "SOIR : PERFORMANCE", description: "Ta force est souvent plus élevée en fin de journée : profites-en.", value: "PM" },
      { icon: "moon", title: "SOMMEIL AFFECTÉ", description: "Un sport intense juste avant le coucher peut perturber ton endormissement.", value: "TIMING" },
      { icon: "brain", title: "DÉCISION PERSO", description: "Le bon moment est celui où tu seras régulier sur la durée.", value: "RÉG." },
      { icon: "heart", title: "ÉCOUTE TON CORPS", description: "Ton chronotype compte : lève-tôt ou couche-tard, adapte l'horaire", value: "⇌" },
    ]},
  ];

  const bodyPools: TopicData[] = [
    { subtitle: `${displayName} : tonifier sans volume par la danse`, tagLine: "CIBLAGE MUSCULAIRE", cards: [
      { icon: "muscle", title: "ZONE CIBLÉE", description: `La danse afro sollicite ${displayName.toLowerCase()} de façon naturelle et progressive`, value: "CIBLÉ" },
      { icon: "dance", title: "MOUVEMENT COMPLET", description: "Contrairement à la muscu, la danse travaille tes muscles en mouvement.", value: "FUNC." },
      { icon: "fire", title: "TONIFICATION", description: "Silhouette dessinée et muscles allongés, sans effet body-builder", value: "LEAN" },
      { icon: "bone", title: "ARTICULATIONS", description: "Les mouvements dansés renforcent les stabilisateurs de tes articulations.", value: "STABLE" },
      { icon: "chart", title: "PREMIERS RÉSULTATS", description: "Les premiers changements arrivent après quelques semaines de cours réguliers.", value: "PATIENCE" },
    ]},
    { subtitle: `${displayName} : des exercices ciblés à la maison`, tagLine: "ROUTINE HOME", cards: [
      { icon: "dance", title: "ÉCHAUFFEMENT DANSE", description: "Quelques mouvements afro activent la zone ciblée sans brusquer ton corps.", value: "ÉVEIL" },
      { icon: "muscle", title: "ISOMÉTRIQUE", description: `Contracte ${displayName.toLowerCase()} sans bouger, en plusieurs séries, pour activer les fibres profondes.`, value: "GAINAGE" },
      { icon: "fire", title: "DYNAMIQUE", description: "Enchaîne des mouvements contrôlés en séries : force et endurance combinées.", value: "CONTRÔLE" },
      { icon: "energy", title: "SUPERSÉRIE", description: "Enchaîne deux exercices sans repos : stimulation maximale en peu de temps.", value: "INTENSE" },
      { icon: "heart", title: "ÉTIREMENT FINAL", description: "Quelques minutes d'étirements soutiennent ta récupération et ta mobilité.", value: "SOUPLE" },
    ]},
    { subtitle: `${displayName} : avant / après, pas à pas`, tagLine: "TRANSFORMATION", cards: [
      { icon: "calendar", title: "PHASE BASE", description: "Ton corps apprend le geste et gagne une tonicité de fond.", value: "BASE" },
      { icon: "energy", title: "PHASE FORME", description: "Ta silhouette se dessine et tes vêtements tombent différemment.", value: "FORME" },
      { icon: "fire", title: "PHASE RÉSULTAT", description: "Le changement devient visible dans le miroir et sur tes photos.", value: "VISIBLE" },
      { icon: "muscle", title: "ENTRETIEN", description: "Une séance régulière suffit ensuite pour garder une tonicité durable.", value: "DURABLE" },
      { icon: "trophy", title: "CORPS DURABLE", description: "Contrairement aux régimes, la danse construit un corps qui tient", value: "STABLE" },
    ]},
    { subtitle: `${displayName} : le muscle qui change tout`, tagLine: "ANATOMIE", cards: [
      { icon: "brain", title: "NEUROMUSCULAIRE", description: `Activer ${displayName.toLowerCase()} améliore aussi ta coordination et ton équilibre général.`, value: "ÉQUILIBRE" },
      { icon: "bone", title: "POSTURE", description: "Un muscle fort = moins de compensation = moins de mal de dos chronique", value: "RIGHT" },
      { icon: "energy", title: "MÉTABOLISME", description: "Plus de masse musculaire signifie plus de calories brûlées au repos.", value: "ACTIF" },
      { icon: "shield", title: "PROTECTION", description: "Des muscles solides autour des articulations aident à limiter les blessures.", value: "SOLIDE" },
      { icon: "fire", title: "CONFIANCE", description: "Un corps tonique change ta façon de bouger, de parler, de te présenter", value: "♡" },
    ]},
    { subtitle: `${displayName} : les erreurs qui sabotent les résultats`, tagLine: "ERREURS COURANTES", cards: [
      { icon: "alert", title: "SURENTRAÎNEMENT", description: "Cibler la même zone tous les jours = récupération insuffisante, stagnation", value: "⚠" },
      { icon: "ban", title: "MAUVAISE POSTURE", description: "Un geste incorrect répété renforce la compensation, pas le muscle visé", value: "FORM" },
      { icon: "scale", title: "NUTRITION PAUVRE", description: "Sans assez de protéines, ta tonification finit vite par plafonner.", value: "PROTÉINES" },
      { icon: "moon", title: "SOMMEIL COURT", description: "Des nuits trop courtes freinent ta récupération musculaire : dors mieux.", value: "NUITS" },
      { icon: "clock", title: "PAS DE RÉGULARITÉ", description: "Quelques séances par mois entretiennent, mais ne font pas vraiment progresser.", value: "RÉGULIER" },
    ]},
  ];

  const wellnessPools: TopicData[] = [
    { subtitle: `${displayName} : l'allié bien-être de ton entraînement`, tagLine: "BIEN-ÊTRE GLOBAL", cards: [
      { icon: "sparkle", title: "CORPS + ESPRIT", description: `${displayName} complète l'activité physique pour un bien-être total`, value: "HOLIST." },
      { icon: "brain", title: "RÉCUPÉRATION MENTALE", description: "Le bien-être mental se travaille comme le physique. Les deux se renforcent", value: "MENTAL" },
      { icon: "moon", title: "SOMMEIL AMÉLIORÉ", description: "Les pratiques de bien-être t'aident à mieux dormir au quotidien.", value: "SOMMEIL" },
      { icon: "heart", title: "MOINS DE STRESS", description: "La relaxation apaise ton stress, encore plus associée à la danse.", value: "DÉTENTE" },
      { icon: "shield", title: "DÉFENSES SOUTENUES", description: "Bien-être et sport soutiennent tes défenses naturelles au quotidien.", value: "DÉFENSES" },
    ]},
    { subtitle: `${displayName} : quelques minutes qui changent ta journée`, tagLine: "ROUTINE EXPRESS", cards: [
      { icon: "sun", title: "RÉVEIL CONSCIENT", description: "Respire profondément au lever pour démarrer la journée dans le calme.", value: "MATIN" },
      { icon: "energy", title: "ANCRAGE CORPOREL", description: "Scanne ton corps un instant pour repérer les tensions avant qu'elles durcissent.", value: "ANCRAGE" },
      { icon: "brain", title: "INTENTION", description: "Pose l'intention du jour : pas une liste de tâches, un état d'esprit.", value: "CAP" },
      { icon: "heart", title: "GRATITUDE", description: "Nomme quelques choses positives chaque jour : ton regard change peu à peu.", value: "MERCI" },
      { icon: "moon", title: "VISUALISATION", description: "Visualise ta journée idéale quelques instants pour l'aborder sereinement.", value: "FOCUS" },
    ]},
    { subtitle: `${displayName} : ce que disent les études`, tagLine: "SCIENCE DU BIEN-ÊTRE", cards: [
      { icon: "chart", title: "PEU SUFFIT", description: "Un court moment de pratique quotidienne aide déjà à apaiser l'anxiété.", value: "COURT" },
      { icon: "brain", title: "CERVEAU PLASTIQUE", description: "Pratique régulière augmente la matière grise préfrontale mesurable à l'IRM", value: "IRM+" },
      { icon: "heart", title: "TENSION ARTÉRIELLE", description: "Une pratique régulière accompagne une tension plus apaisée au quotidien.", value: "APAISÉ" },
      { icon: "energy", title: "INFLAMMATION", description: "Une pratique régulière aide ton corps à retrouver un meilleur équilibre.", value: "ÉQUILIBRE" },
      { icon: "shield", title: "LONGÉVITÉ", description: "Une pratique régulière prend soin de ton corps sur le long terme.", value: "VITALITÉ" },
    ]},
    { subtitle: `${displayName} : matin, midi ou soir ?`, tagLine: "ROUTINE OPTIMISÉE", cards: [
      { icon: "sun", title: "MATIN : ACTIVATION", description: "Pratiquer au réveil réduit le cortisol de départ et cadre la journée", value: "AM" },
      { icon: "clock", title: "MIDI : RECHARGE", description: "Une courte pause consciente t'évite le coup de barre de l'après-midi.", value: "PAUSE" },
      { icon: "moon", title: "SOIR : DÉCROCHAGE", description: "Avant dormir : prépare le système nerveux au sommeil profond", value: "PM" },
      { icon: "brain", title: "RÉGULARITÉ > TIMING", description: "Un moment fixe quotidien bat un moment optimal aléatoire", value: "RÉG." },
      { icon: "heart", title: "MINI-DOSES", description: "Mieux vaut de courtes séances régulières qu'une longue de temps en temps.", value: "CUMUL" },
    ]},
    { subtitle: `${displayName} + danse : synergie ultime`, tagLine: "COMBO PUISSANT", cards: [
      { icon: "sparkle", title: "CORPS MÉMOIRE", description: `La danse + ${displayName.toLowerCase()} ancre le bien-être dans le corps, pas juste la tête`, value: "BODY" },
      { icon: "fire", title: "STRESS ÉVACUÉ", description: "Bouger + respirer = libération de tensions physiques ET émotionnelles", value: "FLUSH" },
      { icon: "heart", title: "ENDORPHINES", description: "Tu libères des endorphines par l'effort dansé et par le calme.", value: "DOUBLE" },
      { icon: "brain", title: "CONCENTRATION", description: "La danse demande de la présence, et la pratique régulière l'ancre en toi.", value: "FLOW" },
      { icon: "trophy", title: "RÉSULTATS DURABLES", description: "Associer les deux pratiques aide à garder tes changements dans le temps.", value: "DURABLE" },
    ]},
  ];

  const defaultPools: TopicData[] = [
    { subtitle: `${displayName} : les bienfaits prouvés`, tagLine: "SAVIEZ-VOUS ?", cards: [
      { icon: "brain", title: `${upper.slice(0, 20)} & CERVEAU`, description: `${displayName} agit sur ton cerveau et soutient ta concentration au quotidien.`, value: "NEURO" },
      { icon: "heart", title: "IMPACT CARDIO", description: "Système cardiovasculaire réagit positivement. Multiplié avec la danse", value: "+CŒUR" },
      { icon: "energy", title: "ÉNERGIE QUOTIDIENNE", description: "Équilibre nutrition, mouvement et récupération : chaque élément compte.", value: "BALANCE" },
      { icon: "muscle", title: "MUSCLES & RÉCUP", description: "Ton corps a besoin de temps pour se reconstruire : soigne ta récupération.", value: "RÉCUP" },
      { icon: "apple", title: "NUTRITION CLÉ", description: "Alimentation équilibrée et cours réguliers forment un duo gagnant.", value: "DUO" },
    ]},
    { subtitle: `${displayName} : guide pas à pas`, tagLine: "GUIDE PAS À PAS", cards: [
      { icon: "calendar", title: "D'ABORD L'OBJECTIF", description: `Définis ce que tu veux tirer de ${displayName}. Sans cible, pas de progression.`, value: "CIBLE" },
      { icon: "clock", title: "PUIS LA ROUTINE", description: "Pose un créneau fixe dans ta semaine : la régularité prime sur l'intensité.", value: "ROUTINE" },
      { icon: "fire", title: "PASSE À L'ACTION", description: "Commence petit : un peu chaque jour vaut mieux qu'un gros bloc hebdo.", value: "ACTION" },
      { icon: "chart", title: "MESURE TES PROGRÈS", description: "Suis un indicateur simple, comme ton énergie ou ton humeur.", value: "MESURE" },
      { icon: "trophy", title: "AJUSTE", description: "Après un mois, ajuste ce qui ne marche pas : itérer rend durable.", value: "AJUSTE" },
    ]},
    { subtitle: `${displayName} : les erreurs courantes à éviter`, tagLine: "ERREURS COURANTES", cards: [
      { icon: "alert", title: "ATTENTES IRRÉALISTES", description: "Viser un changement en quelques jours mène à l'abandon : vois plus long.", value: "PATIENCE" },
      { icon: "ban", title: "ZÉRO MESURE", description: "Sans baseline ni suivi, impossible de savoir si tu progresses", value: "TRACK" },
      { icon: "scale", title: "TROP / PAS ASSEZ", description: "Un dosage inadapté casse la motivation : commence de façon modérée.", value: "DOSE" },
      { icon: "moon", title: "MANQUE DE REPOS", description: "La récupération est partie intégrante du protocole, pas une option", value: "REST" },
      { icon: "brain", title: "ISOLATION", description: "Seul, on abandonne vite : un partenaire ou un groupe change tout.", value: "ENSEMBLE" },
    ]},
    { subtitle: `${displayName} : transformation pas à pas`, tagLine: "TRANSFORMATION", cards: [
      { icon: "sun", title: "PHASE ADOPTION", description: `Ton cerveau intègre le rituel ${displayName}. Sois patient, c'est une phase.`, value: "ADOPTION" },
      { icon: "energy", title: "PHASE TRACTION", description: "Les premiers effets concrets arrivent et l'envie remplace la contrainte.", value: "ÉLAN" },
      { icon: "brain", title: "PHASE CLARTÉ", description: "Tu vois ce qui fonctionne pour toi : affine ton protocole.", value: "CLARTÉ" },
      { icon: "fire", title: "PHASE ANCRAGE", description: "L'habitude devient automatique : ton cerveau a intégré le rituel.", value: "ANCRAGE" },
      { icon: "trophy", title: "PALIER FRANCHI", description: "Ce cap passé, tu as toutes les chances de garder ta pratique.", value: "PALIER" },
    ]},
    { subtitle: `${displayName} : combinaison gagnante`, tagLine: "SYNERGIE EFFICACE", cards: [
      { icon: "dance", title: "AVEC LA DANSE", description: `${displayName} et danse afro se combinent pour un bien-être global.`, value: "DUO" },
      { icon: "apple", title: "AVEC LA NUTRITION", description: "Associe une alimentation ciblée pour renforcer l'impact de ta pratique.", value: "BOOST" },
      { icon: "moon", title: "AVEC LE SOMMEIL", description: "Un sommeil suffisant consolide les bienfaits de ta pratique.", value: "REPOS" },
      { icon: "brain", title: "AVEC LA RESPIRATION", description: "Respire quelques minutes avant et après : tous les effets s'amplifient.", value: "AMPLIFIE" },
      { icon: "heart", title: "AVEC LA COMMUNAUTÉ", description: "Pratiquer en groupe t'aide à tenir sur le long terme.", value: "GROUPE" },
    ]},
  ];

  const pickPool = <T,>(pools: T[]): T => {
    if (pools.length === 0) throw new Error('pools empty');
    const idx = typeof seed === 'number' && Number.isFinite(seed)
      ? Math.abs(Math.floor(seed)) % pools.length
      : Math.floor(Math.random() * pools.length);
    return pools[idx];
  };

  if (isNutri) return pickPool(nutriPools);
  if (isSport) return pickPool(sportPools);
  if (isBody) return pickPool(bodyPools);
  if (isWellness) return pickPool(wellnessPools);
  return pickPool(defaultPools);
}
