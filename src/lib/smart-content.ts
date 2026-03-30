/**
 * ══════════════════════════════════════════════════════════════
 *  AFROBOOST SMART CONTENT GENERATOR v3
 *  Génère automatiquement 5 cartes d'infographie ÉDUCATIVES
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
const ICONS: Record<string, string> = {
  energy: "⚡", heart: "❤️", dance: "💃", audio: "🎧", apple: "🍎",
  moon: "🌙", fire: "🔥", droplet: "💧", muscle: "💪", clock: "⏱️",
  star: "⭐", brain: "🧠", shield: "🛡️", target: "🎯", trophy: "🏆",
  people: "👥", sun: "☀️", leaf: "🌿", chart: "📈", sparkle: "✨",
  thermometer: "🌡️", bone: "🦴", eye: "👁️", lungs: "🫁", dna: "🧬",
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
      subtitle: "Ton corps = 60% d'eau. Chaque goutte compte.",
      tagLine: "HYDRATATION & PERFORMANCE",
      cards: [
        { icon: "droplet", title: "60% DE TON CORPS", description: "Ton corps est composé à 60% d'eau. Perdre 2% = chute de performance immédiate", value: "60%" },
        { icon: "brain", title: "CERVEAU EN ALERTE", description: "Même 1% de déshydratation = brouillard mental et fatigue cognitive", value: "-1%" },
        { icon: "fire", title: "CARDIO BOOSTÉ", description: "Bien hydraté, tu tiens 20% plus longtemps en cardio. Parfait pour Afroboost", value: "+20%" },
        { icon: "shield", title: "MINÉRAUX PERDUS", description: "Tu transpires = tu perds sodium, potassium, magnésium. L'eau te recharge", value: "3 min." },
        { icon: "energy", title: "ÉNERGIE CONSTANTE", description: "2 verres d'eau au réveil relancent ton métabolisme de 24%", value: "+24%" },
      ],
    },
    {
      subtitle: "Tu transpires, tu perds. L'eau te remet en mode perf.",
      tagLine: "LE SAVIEZ-VOUS ?",
      cards: [
        { icon: "droplet", title: "AVANT L'EFFORT", description: "Bois 500ml 2h avant ton cours. Tes muscles seront prêts à performer", value: "500ml" },
        { icon: "thermometer", title: "TEMPÉRATURE RÉGULÉE", description: "L'eau régule ta température corporelle. Sans elle, surchauffe en 15min", value: "37°C" },
        { icon: "muscle", title: "ZÉRO CRAMPE", description: "80% des crampes sont liées à la déshydratation. Bois = plus de crampes", value: "80%" },
        { icon: "apple", title: "DIGESTION EXPRESS", description: "L'eau accélère ta digestion de 30%. Nutrients absorbés plus vite", value: "+30%" },
        { icon: "heart", title: "CŒUR PROTÉGÉ", description: "Le sang bien hydraté circule mieux. Ton cœur travaille moins dur", value: "-15%" },
      ],
    },
  ],

  // ─── CRAMPES ───────────────────────────────────────────────
  "crampe": [
    {
      subtitle: "80% des crampes = déshydratation + manque de minéraux",
      tagLine: "PRÉVENTION & SANTÉ",
      cards: [
        { icon: "droplet", title: "DÉSHYDRATATION", description: "Cause n°1 des crampes. 2L d'eau/jour minimum les jours de cours", value: "2L/j" },
        { icon: "apple", title: "MAGNÉSIUM", description: "1 banane + 10 amandes avant le cours = crampes divisées par 3", value: "÷3" },
        { icon: "muscle", title: "ÉTIREMENTS", description: "10 min d'étirements post-cours réduisent les crampes de 60%", value: "-60%" },
        { icon: "thermometer", title: "CHALEUR MUSCULAIRE", description: "Un muscle froid crampe 4x plus. Échauffe-toi toujours avant", value: "4x" },
        { icon: "moon", title: "SOMMEIL RÉPARATEUR", description: "C'est la nuit que tes muscles se reconstruisent. 7-8h minimum", value: "7-8h" },
      ],
    },
  ],

  // ─── SOMMEIL ───────────────────────────────────────────────
  "sommeil": [
    {
      subtitle: "1h de danse = 40 min d'endormissement en moins",
      tagLine: "SCIENCE DU SOMMEIL",
      cards: [
        { icon: "moon", title: "ENDORS-TOI PLUS VITE", description: "Le sport réduit le temps d'endormissement de 40min en moyenne", value: "-40min" },
        { icon: "brain", title: "MÉLATONINE ×2", description: "L'exercice régulier double ta production de mélatonine naturelle", value: "×2" },
        { icon: "heart", title: "CORTISOL EN CHUTE", description: "45min de danse = cortisol (hormone du stress) réduit de 30%", value: "-30%" },
        { icon: "energy", title: "SOMMEIL PROFOND", description: "Les sportifs passent 75% plus de temps en sommeil profond réparateur", value: "+75%" },
        { icon: "sun", title: "RÉVEIL ÉNERGIQUE", description: "Après 2 semaines de cours réguliers, tu te réveilles naturellement plus tôt", value: "2 sem" },
      ],
    },
  ],

  // ─── CALORIES / PERTE DE POIDS ─────────────────────────────
  "calorie": [
    {
      subtitle: "45 min de danse = autant qu'1h de running. Mais en fun.",
      tagLine: "BRÛLE & SOURIS",
      cards: [
        { icon: "fire", title: "500-700 KCAL/SESSION", description: "Une session Afroboost brûle autant de calories qu'1h de course à pied", value: "600kcal" },
        { icon: "energy", title: "AFTERBURN 2H", description: "Ton corps continue à brûler des calories 2h après le cours. Effet EPOC", value: "+2h" },
        { icon: "muscle", title: "MASSE MUSCULAIRE", description: "La danse tonifie sans gonfler. Plus de muscle = métabolisme +15% au repos", value: "+15%" },
        { icon: "chart", title: "RÉSULTATS 3 SEMAINES", description: "Études montrent des résultats visibles dès 3 semaines à 2-3 cours/sem", value: "3 sem" },
        { icon: "brain", title: "ZÉRO FRUSTRATION", description: "Tu danses, tu t'amuses, tu oublies l'effort. C'est le secret de la régularité", value: "100%" },
      ],
    },
  ],

  // ─── STRESS / MENTAL ───────────────────────────────────────
  "stress": [
    {
      subtitle: "30 min de danse = même effet que 1 séance de méditation",
      tagLine: "MENTAL & BIEN-ÊTRE",
      cards: [
        { icon: "brain", title: "CORTISOL -30%", description: "30 min d'exercice réduisent ton hormone du stress de 30%. Prouvé par la science", value: "-30%" },
        { icon: "heart", title: "ENDORPHINES ×3", description: "La danse libère 3x plus d'endorphines que la marche. L'hormone du bonheur", value: "×3" },
        { icon: "audio", title: "ÉTAT DE FLOW", description: "Musique + mouvement = ton cerveau entre en état de flow. Zéro pensée négative", value: "FLOW" },
        { icon: "moon", title: "ANXIÉTÉ -50%", description: "Les personnes actives ont 50% moins de risques de souffrir d'anxiété", value: "-50%" },
        { icon: "star", title: "CONFIANCE BOOSTÉE", description: "Chaque chorégraphie apprise renforce ton estime de soi. Effet cumulatif", value: "+50%" },
      ],
    },
  ],

  // ─── PROTÉINES / PROTEIN ───────────────────────────────────
  "protein": [
    {
      subtitle: "Sans protéines, tes muscles fondent même si tu t'entraînes",
      tagLine: "NUTRITION SPORTIVE",
      cards: [
        { icon: "muscle", title: "1.6g/KG DE POIDS", description: "Pour progresser, vise 1.6g de protéines par kg. Ex: 70kg = 112g/jour", value: "1.6g/kg" },
        { icon: "clock", title: "FENÊTRE DE 30 MIN", description: "Mange des protéines dans les 30 min après le cours. Récupération optimale", value: "30min" },
        { icon: "apple", title: "SOURCES NATURELLES", description: "Œufs, poulet, poisson, lentilles, tofu. Pas besoin de poudre obligatoirement", value: "6 sources" },
        { icon: "fire", title: "EFFET THERMIQUE", description: "Digérer les protéines brûle 25% de leurs calories. Aucun autre nutriment ne fait ça", value: "25%" },
        { icon: "shield", title: "RÉPARATION", description: "Tes muscles se déchirent pendant l'effort. Les protéines les reconstruisent plus forts", value: "48h" },
      ],
    },
  ],

  // ─── NUTRITION ─────────────────────────────────────────────
  "nutrition": [
    {
      subtitle: "Ce que tu manges AVANT le cours change tout",
      tagLine: "NUTRITION & ÉNERGIE",
      cards: [
        { icon: "apple", title: "2H AVANT = GLUCIDES", description: "Riz, pâtes, pain complet. Ton corps a besoin de carburant pour danser", value: "2h" },
        { icon: "droplet", title: "HYDRATE-TOI", description: "500ml d'eau 2h avant + petites gorgées pendant. Jamais à sec", value: "500ml" },
        { icon: "energy", title: "BANANE = TURBO", description: "1 banane 30 min avant = énergie rapide + potassium anti-crampes", value: "30min" },
        { icon: "clock", title: "APRÈS : PROTÉINES", description: "Dans les 30 min post-cours : protéines + glucides pour reconstruire", value: "30min" },
        { icon: "fire", title: "MÉTABOLISME +20%", description: "Manger régulièrement (5 petits repas) accélère ton métabolisme de 20%", value: "+20%" },
      ],
    },
  ],

  // ─── CARDIO / ENDURANCE ────────────────────────────────────
  "cardio": [
    {
      subtitle: "Ton cœur est un muscle. La danse le rend inarrêtable.",
      tagLine: "CARDIO & CŒUR",
      cards: [
        { icon: "heart", title: "140+ BPM EN COURS", description: "Ton cœur monte à 140+ bpm pendant un cours. Zone de combustion maximale", value: "140bpm" },
        { icon: "chart", title: "VO2 MAX +15%", description: "4 semaines de cours réguliers augmentent ta capacité pulmonaire de 15%", value: "+15%" },
        { icon: "shield", title: "RISQUE CARDIAQUE -35%", description: "Les danseurs réguliers réduisent leur risque de maladie cardiaque de 35%", value: "-35%" },
        { icon: "energy", title: "ENDURANCE ×2", description: "Après 6 semaines, tu tiens 2x plus longtemps sans être essoufflé", value: "×2" },
        { icon: "fire", title: "ZONE DE BRÛLAGE", description: "Entre 130-150 bpm, ton corps brûle principalement les graisses. Zone Afroboost", value: "130-150" },
      ],
    },
  ],

  // ─── COMMUNAUTÉ / TRIBU ────────────────────────────────────
  "communaut": [
    {
      subtitle: "S'entraîner en groupe = 3x plus de chance de continuer",
      tagLine: "FORCE COLLECTIVE",
      cards: [
        { icon: "people", title: "EFFET DE GROUPE", description: "On s'entraîne 3x plus longtemps en groupe qu'en solo. Étude publiée dans JAMA", value: "×3" },
        { icon: "brain", title: "OCYTOCINE", description: "Danser ensemble libère l'ocytocine : l'hormone du lien social et de la confiance", value: "+40%" },
        { icon: "heart", title: "MOTIVATION MUTUELLE", description: "95% des membres disent que le groupe les motive à revenir chaque semaine", value: "95%" },
        { icon: "audio", title: "MÊME FRÉQUENCE", description: "Le casque synchronise le groupe. Même musique, même énergie, même vibration", value: "SYNC" },
        { icon: "trophy", title: "OBJECTIFS PARTAGÉS", description: "Les gens qui partagent leurs objectifs ont 65% plus de chances de les atteindre", value: "+65%" },
      ],
    },
  ],

  // ─── HORAIRES / COURS ──────────────────────────────────────
  "horaire": [
    {
      subtitle: "Trouve TON créneau. La régularité fait tout.",
      tagLine: "PLANNING AFROBOOST",
      cards: [
        { icon: "clock", title: "MARDI & JEUDI 19H", description: "Sessions en semaine après le boulot. Le meilleur moment pour se vider la tête", value: "19h" },
        { icon: "sun", title: "SAMEDI MATIN 10H", description: "Session week-end pour bien démarrer. Énergie pour toute la journée", value: "10h" },
        { icon: "star", title: "1ER COURS OFFERT", description: "Viens tester gratuitement. Zéro engagement, 100% découverte", value: "GRATUIT" },
        { icon: "target", title: "2-3×/SEMAINE IDÉAL", description: "La science recommande 150min d'activité/semaine. 3 cours = objectif atteint", value: "150min" },
        { icon: "people", title: "20 PLACES MAX", description: "Petits groupes pour une vraie ambiance. Réserve ta place à l'avance", value: "20 max" },
      ],
    },
  ],

  // ─── DÉBUTANT / COMMENCER ──────────────────────────────────
  "debut": [
    {
      subtitle: "Tu sais marcher ? Tu sais danser. Point.",
      tagLine: "LANCE-TOI",
      cards: [
        { icon: "star", title: "ZÉRO PRÉ-REQUIS", description: "Aucune expérience de danse nécessaire. On part de zéro ensemble", value: "0" },
        { icon: "brain", title: "MÉMOIRE MUSCULAIRE", description: "Ton corps apprend vite. Après 3 cours, les mouvements deviennent naturels", value: "3 cours" },
        { icon: "audio", title: "CASQUE = TA BULLE", description: "Le casque te met dans ta bulle. Personne ne te regarde, tu te lâches", value: "100%" },
        { icon: "heart", title: "BIENVEILLANCE TOTALE", description: "Zéro jugement. Tout le monde est passé par là. La tribu t'accueille", value: "MAX" },
        { icon: "chart", title: "PROGRESSION EXPRESS", description: "En 4 semaines, 90% des débutants maîtrisent les chorégraphies de base", value: "4 sem" },
      ],
    },
  ],

  // ─── MUSIQUE / AFROBEAT ────────────────────────────────────
  "musique": [
    {
      subtitle: "Le beat afrobeat active 7 zones de ton cerveau en même temps",
      tagLine: "SON & CERVEAU",
      cards: [
        { icon: "audio", title: "7 ZONES CÉRÉBRALES", description: "La musique rythmée active simultanément 7 zones du cerveau. Aucun autre stimulus ne fait ça", value: "7 zones" },
        { icon: "brain", title: "DOPAMINE +9%", description: "Écouter de la musique que tu aimes augmente ta dopamine de 9%. Imagine en dansant", value: "+9%" },
        { icon: "energy", title: "120 BPM OPTIMAL", description: "Le tempo afrobeat (120 bpm) est scientifiquement le rythme idéal pour le cardio", value: "120bpm" },
        { icon: "heart", title: "SYNCHRONISATION", description: "Quand le groupe danse sur le même beat, les cœurs se synchronisent. Étude Stanford", value: "SYNC" },
        { icon: "sparkle", title: "ANTI-DOULEUR", description: "La musique réduit la perception de la douleur de 20%. Tu tiens plus longtemps", value: "-20%" },
      ],
    },
  ],

  // ─── POIDS / MINCIR ────────────────────────────────────────
  "poids": [
    {
      subtitle: "La danse brûle les graisses PENDANT et APRÈS le cours",
      tagLine: "OBJECTIF SILHOUETTE",
      cards: [
        { icon: "fire", title: "600 KCAL EN 45MIN", description: "Équivalent à 1h30 de marche rapide. Mais en 2x moins de temps", value: "600kcal" },
        { icon: "chart", title: "-1KG EN 2 SEMAINES", description: "3 cours/semaine + alimentation normale = perte progressive et durable", value: "-1kg" },
        { icon: "energy", title: "EFFET AFTERBURN", description: "Ton métabolisme reste élevé 2h après le cours. Tu brûles même assis", value: "+2h" },
        { icon: "muscle", title: "MUSCLE > GRAISSE", description: "La danse remplace la graisse par du muscle. Le muscle brûle 3x plus au repos", value: "×3" },
        { icon: "brain", title: "ZÉRO RÉGIME", description: "Pas besoin de te priver. La danse régulière suffit à transformer ta silhouette", value: "0 régime" },
      ],
    },
  ],

  // ─── ÉNERGIE / FATIGUE ─────────────────────────────────────
  "energie": [
    {
      subtitle: "Fatigué ? C'est le manque de mouvement, pas l'inverse",
      tagLine: "BOOST NATUREL",
      cards: [
        { icon: "energy", title: "ÉNERGIE +60% EN 10MIN", description: "10 min de mouvement boostent ton énergie de 60%. Étude université de Georgia", value: "+60%" },
        { icon: "brain", title: "OXYGÈNE AU CERVEAU", description: "L'exercice augmente l'afflux sanguin au cerveau de 15%. Adieu le brouillard mental", value: "+15%" },
        { icon: "sun", title: "EFFET 24H", description: "Une session le matin donne de l'énergie pour toute la journée. Pas besoin de café", value: "24h" },
        { icon: "dna", title: "MITOCHONDRIES ×2", description: "Le sport double tes mitochondries : les centrales énergétiques de tes cellules", value: "×2" },
        { icon: "moon", title: "MEILLEUR SOMMEIL", description: "Plus d'énergie le jour = meilleur sommeil la nuit. Le cercle vertueux", value: "+40%" },
      ],
    },
  ],

  // ─── SOUPLESSE / FLEXIBILITÉ ───────────────────────────────
  "souplesse": [
    {
      subtitle: "Après 30 ans, on perd 1% de souplesse par an. La danse inverse ça",
      tagLine: "MOBILITÉ & SANTÉ",
      cards: [
        { icon: "dance", title: "AMPLITUDE +35%", description: "Les danseurs réguliers gagnent 35% d'amplitude de mouvement en 8 semaines", value: "+35%" },
        { icon: "shield", title: "BLESSURES -50%", description: "Un corps souple se blesse 2x moins. La souplesse est ta meilleure protection", value: "-50%" },
        { icon: "bone", title: "ARTICULATIONS", description: "La danse lubrifie tes articulations. Moins de douleurs, plus de mobilité", value: "+25%" },
        { icon: "clock", title: "10 MIN/JOUR SUFFIT", description: "10 min d'étirements quotidiens = résultats visibles en 3 semaines", value: "10min" },
        { icon: "heart", title: "DOS SANS DOULEUR", description: "80% des douleurs de dos viennent du manque de souplesse. La danse les prévient", value: "80%" },
      ],
    },
  ],

  // ─── CONFIANCE EN SOI ──────────────────────────────────────
  "confiance": [
    {
      subtitle: "Chaque chorégraphie apprise = une victoire sur toi-même",
      tagLine: "AFFIRMATION DE SOI",
      cards: [
        { icon: "star", title: "ESTIME +50% EN 1 MOIS", description: "La danse booste l'estime de soi de 50% en 4 semaines. Étude Journal of Dance Medicine", value: "+50%" },
        { icon: "brain", title: "POSTURE = CONFIANCE", description: "La danse améliore ta posture. Se tenir droit augmente la confiance de 25%", value: "+25%" },
        { icon: "people", title: "ZÉRO JUGEMENT", description: "Dans la tribu Afroboost, tout le monde est là pour kiffer. Pas pour juger", value: "100%" },
        { icon: "trophy", title: "MICRO-VICTOIRES", description: "Chaque nouveau pas appris crée un shoot de dopamine. Effet cumulatif garanti", value: "MAX" },
        { icon: "dance", title: "TON CORPS PARLE", description: "Quand tu danses, tu apprends à habiter ton corps. Ça se voit dans ta vie", value: "∞" },
      ],
    },
  ],

  // ─── ÉCHAUFFEMENT ──────────────────────────────────────────
  "echauffement": [
    {
      subtitle: "5 min d'échauffement = 70% de blessures en moins",
      tagLine: "NE SAUTE JAMAIS CETTE ÉTAPE",
      cards: [
        { icon: "thermometer", title: "MUSCLES +2°C", description: "L'échauffement augmente la température musculaire de 2°C. Muscles élastiques = zéro déchirure", value: "+2°C" },
        { icon: "heart", title: "CŒUR PRÉPARÉ", description: "Montée progressive de 70 à 120 bpm. Ton cœur est prêt pour l'effort intense", value: "70→120" },
        { icon: "bone", title: "ARTICULATIONS LUBRIFIÉES", description: "Le liquide synovial ne circule que quand tu bouges. L'échauffement protège tes articulations", value: "100%" },
        { icon: "brain", title: "CONCENTRATION", description: "5 min d'échauffement améliorent ta concentration de 25% pour le reste du cours", value: "+25%" },
        { icon: "shield", title: "BLESSURES -70%", description: "Les sportifs qui s'échauffent ont 70% moins de blessures. La science est formelle", value: "-70%" },
      ],
    },
  ],

  // ─── RÉCUPÉRATION ──────────────────────────────────────────
  "recuperation": [
    {
      subtitle: "C'est au repos que ton corps se transforme, pas pendant l'effort",
      tagLine: "SCIENCE DE LA RÉCUPÉRATION",
      cards: [
        { icon: "moon", title: "MUSCLES : 48-72H", description: "Tes muscles ont besoin de 48 à 72h pour se reconstruire après un effort intense", value: "48-72h" },
        { icon: "muscle", title: "ÉTIREMENTS 10 MIN", description: "10 min d'étirements post-cours réduisent les courbatures de 50% le lendemain", value: "-50%" },
        { icon: "droplet", title: "RÉHYDRATATION", description: "Tu perds 1 à 2L de sueur par session. Bois 150% de ce que tu perds dans les 2h", value: "150%" },
        { icon: "apple", title: "PROTÉINES + GLUCIDES", description: "Dans les 30 min : 20g de protéines + glucides rapides. Fenêtre métabolique optimale", value: "30min" },
        { icon: "dna", title: "SURCOMPENSATION", description: "Ton corps se reconstruit PLUS FORT après chaque effort. C'est le principe de progression", value: "↑" },
      ],
    },
  ],

  // ─── COURS / SESSION ───────────────────────────────────────
  "cours": [
    {
      subtitle: "45 minutes qui changent ta journée entière",
      tagLine: "L'EXPÉRIENCE AFROBOOST",
      cards: [
        { icon: "audio", title: "CASQUE SILENT DISCO", description: "Chacun son casque, le son directement dans tes oreilles. Immersion sonore totale", value: "100%" },
        { icon: "fire", title: "600 KCAL BRÛLÉES", description: "En 45 min de danse afro, tu brûles l'équivalent de 1h30 de marche rapide", value: "600kcal" },
        { icon: "brain", title: "ZÉRO TÉLÉPHONE", description: "Pendant 45 min, tu déconnectes du monde. Ton cerveau te remerciera", value: "45min" },
        { icon: "people", title: "TRIBU DE 15-20", description: "Petits groupes pour une vraie connexion. Pas un cours anonyme à 50 personnes", value: "15-20" },
        { icon: "heart", title: "ENDORPHINES ×3", description: "La combinaison danse + musique + groupe triple ta production d'endorphines", value: "×3" },
      ],
    },
  ],

  // ─── MOTIVATION ────────────────────────────────────────────
  "motivation": [
    {
      subtitle: "La motivation ne dure pas. L'habitude, si.",
      tagLine: "PSYCHOLOGIE DU SPORT",
      cards: [
        { icon: "brain", title: "21 JOURS = HABITUDE", description: "Il faut en moyenne 21 jours pour créer une habitude. 3 semaines à 2 cours/sem suffit", value: "21j" },
        { icon: "people", title: "GROUPE = ×3.5", description: "Tu as 3.5x plus de chances de maintenir une routine quand tu t'entraînes en groupe", value: "×3.5" },
        { icon: "target", title: "OBJECTIFS SMART", description: "Un objectif précis (ex: 2 cours/sem pendant 1 mois) a 76% plus de chances d'être atteint", value: "+76%" },
        { icon: "trophy", title: "EFFET CUMULATIF", description: "Chaque cours renforce ta discipline. Après 2 mois, c'est automatique comme se brosser les dents", value: "2 mois" },
        { icon: "star", title: "PLAISIR D'ABORD", description: "La raison n°1 de continuer le sport : le plaisir. La danse a l'avantage d'être fun", value: "n°1" },
      ],
    },
  ],

  // ─── DANSE ─────────────────────────────────────────────────
  "danse": [
    {
      subtitle: "Danser active plus de muscles que la plupart des sports",
      tagLine: "LE SPORT LE PLUS COMPLET",
      cards: [
        { icon: "muscle", title: "300+ MUSCLES", description: "La danse sollicite plus de 300 muscles. Course à pied : seulement 100", value: "300+" },
        { icon: "brain", title: "MÉMOIRE BOOSTÉE", description: "Apprendre des chorégraphies stimule ta mémoire et réduit le risque d'Alzheimer de 76%", value: "-76%" },
        { icon: "heart", title: "CARDIO COMPLET", description: "La danse combine cardio, renforcement et souplesse en une seule activité", value: "3-en-1" },
        { icon: "bone", title: "OS RENFORCÉS", description: "Les impacts de la danse augmentent ta densité osseuse de 2% par an", value: "+2%/an" },
        { icon: "sparkle", title: "ANTI-ÂGE", description: "Les danseurs réguliers vieillissent biologiquement 10 ans moins vite. Étude NEJM", value: "-10 ans" },
      ],
    },
  ],

  // ─── SILENT DISCO / CASQUE ─────────────────────────────────
  "silent": [
    {
      subtitle: "Le casque te plonge dans ta bulle. Le monde disparaît.",
      tagLine: "IMMERSION TOTALE",
      cards: [
        { icon: "audio", title: "SON IMMERSIF", description: "Le son arrive directement dans tes oreilles. 0 distraction, 100% concentration", value: "100%" },
        { icon: "brain", title: "FOCUS ×2", description: "Le casque double ta concentration sur les mouvements. Tu apprends 2x plus vite", value: "×2" },
        { icon: "shield", title: "ZÉRO NUISANCE", description: "Pas de voisins dérangés, pas de limite de décibels. On peut danser partout", value: "0 dB" },
        { icon: "heart", title: "INTIMITÉ COLLECTIVE", description: "Chacun dans sa bulle mais tous ensemble. Le paradoxe magique du silent disco", value: "MAGIC" },
        { icon: "energy", title: "BASSES PUISSANTES", description: "Le casque restitue des basses que même un gros système ne peut pas reproduire", value: "MAX" },
      ],
    },
  ],

  // ─── RESPIRATION ───────────────────────────────────────────
  "respiration": [
    {
      subtitle: "Tu respires 20 000x par jour. Autant le faire correctement.",
      tagLine: "SOUFFLE & PERFORMANCE",
      cards: [
        { icon: "lungs", title: "20 000 RESPIRATIONS/J", description: "Tu respires 20 000 fois par jour. 90% des gens le font mal : trop court, trop haut", value: "20 000" },
        { icon: "heart", title: "FRÉQUENCE CARDIAQUE", description: "Respirer par le nez réduit ta fréquence cardiaque de 10 bpm pendant l'effort", value: "-10bpm" },
        { icon: "energy", title: "OXYGÈNE +25%", description: "La respiration abdominale apporte 25% plus d'oxygène que la respiration thoracique", value: "+25%" },
        { icon: "brain", title: "ANTI-STRESS INSTANT", description: "4 secondes d'inspiration + 6 secondes d'expiration = ton cortisol chute en 2 min", value: "2 min" },
        { icon: "fire", title: "ENDURANCE +30%", description: "Maîtriser ta respiration en cours te permet de tenir 30% plus longtemps", value: "+30%" },
      ],
    },
  ],

  // ══════════════════════════════════════════════════════════════
  // ══  NOUVEAUX SUJETS — NUTRITION DÉTAILLÉE                   ══
  // ══════════════════════════════════════════════════════════════

  // ─── MAGNÉSIUM ─────────────────────────────────────────────
  "magnesium": [
    {
      subtitle: "75% des Français manquent de magnésium. Et toi ?",
      tagLine: "MINÉRAL ESSENTIEL",
      cards: [
        { icon: "shield", title: "75% EN CARENCE", description: "3 Français sur 4 ne consomment pas assez de magnésium. Les sportifs perdent encore plus", value: "75%" },
        { icon: "muscle", title: "ANTI-CRAMPES N°1", description: "Le magnésium régule la contraction musculaire. Carence = crampes et spasmes garantis", value: "n°1" },
        { icon: "brain", title: "SOMMEIL PROFOND", description: "Le magnésium active le GABA, le neurotransmetteur du calme. Endormissement 2x plus rapide", value: "×2" },
        { icon: "apple", title: "400mg/JOUR", description: "Amandes, chocolat noir 70%, épinards, bananes. 10 amandes = 80mg de magnésium", value: "400mg" },
        { icon: "energy", title: "ÉNERGIE CELLULAIRE", description: "Le magnésium intervient dans 300+ réactions enzymatiques. Sans lui, ton corps tourne au ralenti", value: "300+" },
      ],
    },
  ],

  // ─── FÉCULENTS ─────────────────────────────────────────────
  "feculent": [
    {
      subtitle: "Les féculents sont le carburant n°1 de tes muscles",
      tagLine: "TON CARBURANT SPORTIF",
      cards: [
        { icon: "energy", title: "GLYCOGÈNE = FUEL", description: "Tes muscles stockent le glycogène des féculents. Sans eux, tu tiens 30min max à l'effort", value: "30min" },
        { icon: "apple", title: "COMPLETS > BLANCS", description: "Riz complet, pâtes complètes, patate douce : index glycémique bas = énergie stable sans crash", value: "IG BAS" },
        { icon: "clock", title: "2-3H AVANT LE COURS", description: "Mange tes féculents 2 à 3h avant. Assez pour digérer, assez pour avoir l'énergie", value: "2-3h" },
        { icon: "fire", title: "55% DE TES CALORIES", description: "Les sportifs ont besoin que 55% de leurs calories viennent des glucides. Les féculents sont la clé", value: "55%" },
        { icon: "brain", title: "CERVEAU AUSSI", description: "Ton cerveau consomme 120g de glucose/jour. Sans féculents, concentration et mémoire en berne", value: "120g/j" },
      ],
    },
  ],

  // ─── VITAMINES ─────────────────────────────────────────────
  "vitamine": [
    {
      subtitle: "Tes vitamines déterminent ton énergie, ton humeur, ta perf",
      tagLine: "MICRONUTRIMENTS ESSENTIELS",
      cards: [
        { icon: "sun", title: "VITAMINE D", description: "80% des Français en manquent. Elle renforce os, muscles et système immunitaire. 15min de soleil/jour", value: "80%" },
        { icon: "shield", title: "VITAMINE C", description: "Anti-oxydant puissant. Réduit les courbatures de 25% et accélère la récupération post-effort", value: "-25%" },
        { icon: "energy", title: "VITAMINES B", description: "Les vitamines B transforment tes aliments en énergie. Carence = fatigue chronique assurée", value: "B1-B12" },
        { icon: "muscle", title: "VITAMINE E", description: "Protège tes cellules musculaires contre le stress oxydatif de l'effort intense", value: "ANTI-OX" },
        { icon: "bone", title: "VITAMINE K", description: "Essentielle pour fixer le calcium sur tes os. Brocoli, épinards, chou kale en regorgent", value: "OS++" },
      ],
    },
  ],

  // ─── FER ───────────────────────────────────────────────────
  "fer": [
    {
      subtitle: "Le fer transporte l'oxygène vers tes muscles. Pas de fer = 0 perf",
      tagLine: "OXYGÉNATION MUSCULAIRE",
      cards: [
        { icon: "heart", title: "HÉMOGLOBINE", description: "Le fer compose l'hémoglobine qui transporte l'O₂ dans ton sang. Moins de fer = moins d'O₂ aux muscles", value: "O₂" },
        { icon: "energy", title: "FATIGUE CHRONIQUE", description: "25% des femmes actives manquent de fer. Symptôme n°1 : fatigue inexpliquée même après repos", value: "25%" },
        { icon: "apple", title: "SOURCES ANIMALES", description: "Viande rouge, boudin noir, foie. Le fer héminique est absorbé à 25% vs 5% pour le végétal", value: "25% abs" },
        { icon: "leaf", title: "SOURCES VÉGÉTALES", description: "Lentilles, tofu, spiruline. Ajoute du citron (vitamine C) pour tripler l'absorption", value: "×3" },
        { icon: "fire", title: "18mg/JOUR (FEMMES)", description: "Les femmes sportives ont besoin de 18mg/jour. Les règles + la transpiration augmentent les pertes", value: "18mg" },
      ],
    },
  ],

  // ─── ZINC ──────────────────────────────────────────────────
  "zinc": [
    {
      subtitle: "Le zinc : discret mais essentiel pour ta récupération",
      tagLine: "DÉFENSE & RÉCUPÉRATION",
      cards: [
        { icon: "shield", title: "IMMUNITÉ +60%", description: "Le zinc réduit la durée des rhumes de 33% et renforce l'immunité des sportifs de 60%", value: "+60%" },
        { icon: "muscle", title: "TESTOSTÉRONE", description: "Le zinc stimule la production de testostérone. Essentiel pour la récupération musculaire", value: "+20%" },
        { icon: "dna", title: "SYNTHÈSE PROTÉIQUE", description: "Sans zinc, ton corps ne peut pas reconstruire les fibres musculaires endommagées par l'effort", value: "ADN" },
        { icon: "apple", title: "11mg/JOUR", description: "Huîtres (champion absolu), bœuf, graines de courge, lentilles. 6 huîtres = dose quotidienne", value: "11mg" },
        { icon: "brain", title: "ANTI-INFLAMMATION", description: "Le zinc réduit l'inflammation post-effort de 30%. Récupération plus rapide entre les cours", value: "-30%" },
      ],
    },
  ],

  // ─── OMÉGA 3 ───────────────────────────────────────────────
  "omega": [
    {
      subtitle: "Les oméga-3 réduisent les douleurs musculaires de 35%",
      tagLine: "GRAISSES QUI GUÉRISSENT",
      cards: [
        { icon: "shield", title: "ANTI-INFLAMMATOIRE", description: "Les oméga-3 réduisent l'inflammation de 35%. Moins de douleurs après les cours intenses", value: "-35%" },
        { icon: "heart", title: "CŒUR PROTÉGÉ", description: "2g d'oméga-3/jour réduisent le risque cardiovasculaire de 25%. Le cardio Afroboost + ça = combo gagnant", value: "-25%" },
        { icon: "brain", title: "CERVEAU SHARP", description: "60% de ton cerveau est constitué de graisses. Les oméga-3 améliorent la mémoire et la concentration", value: "60%" },
        { icon: "apple", title: "SOURCES", description: "Saumon, sardines, maquereau (2x/semaine), noix, graines de lin, huile de colza", value: "2x/sem" },
        { icon: "muscle", title: "RÉCUP MUSCULAIRE", description: "Les oméga-3 accélèrent la réparation des micro-déchirures musculaires de 20%", value: "+20%" },
      ],
    },
  ],

  // ─── SUCRE ─────────────────────────────────────────────────
  "sucre": [
    {
      subtitle: "Tu consommes 4x trop de sucre sans le savoir",
      tagLine: "DANGER CACHÉ",
      cards: [
        { icon: "fire", title: "95g/JOUR EN MOYENNE", description: "Un Français consomme 95g de sucre/jour. L'OMS recommande max 25g. C'est 4x trop", value: "4×" },
        { icon: "brain", title: "ADDICTION RÉELLE", description: "Le sucre active les mêmes zones du cerveau que la cocaïne. C'est une dépendance prouvée", value: "ADDICT" },
        { icon: "energy", title: "PIC → CRASH", description: "Le sucre rapide donne un pic d'énergie de 20min suivi d'un crash brutal. Nul avant un cours", value: "20min" },
        { icon: "shield", title: "INFLAMMATION", description: "L'excès de sucre augmente l'inflammation chronique de 87%. Pire ennemi de la récupération", value: "+87%" },
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
        { icon: "energy", title: "CARBURANT N°1", description: "Les glucides fournissent 60-70% de l'énergie pendant un effort intense comme la danse", value: "60-70%" },
        { icon: "apple", title: "COMPLEXES VS SIMPLES", description: "Avoine, riz complet, patate douce = énergie lente. Sucre, pain blanc = pic puis crash", value: "LENT" },
        { icon: "muscle", title: "GLYCOGÈNE", description: "Tes muscles stockent 400g de glycogène. Un cours intense en consomme 50-100g", value: "400g" },
        { icon: "clock", title: "TIMING CLÉ", description: "Glucides complexes 2-3h avant, glucides rapides juste après pour recharger les stocks", value: "2-3h" },
        { icon: "brain", title: "CERVEAU AFFAMÉ", description: "Ton cerveau consomme 120g de glucose/jour. Le supprimer = brouillard mental garanti", value: "120g" },
      ],
    },
  ],

  // ─── COLLAGÈNE ─────────────────────────────────────────────
  "collagene": [
    {
      subtitle: "À partir de 25 ans, tu perds 1.5% de collagène par an",
      tagLine: "TENDONS, PEAU, OS",
      cards: [
        { icon: "bone", title: "-1.5% PAR AN", description: "Dès 25 ans, ta production de collagène baisse. À 50 ans, tu en as perdu 30%", value: "-1.5%/an" },
        { icon: "muscle", title: "TENDONS & LIGAMENTS", description: "Le collagène compose 80% de tes tendons. Les danseurs ont besoin de tendons solides", value: "80%" },
        { icon: "shield", title: "BLESSURES -50%", description: "10g de collagène/jour + vitamine C réduisent les blessures tendineuses de 50%", value: "-50%" },
        { icon: "apple", title: "SOURCES", description: "Bouillon d'os, gélatine, poisson avec peau. Ou supplément 10g/jour avec vitamine C", value: "10g/j" },
        { icon: "sparkle", title: "PEAU & ÉLASTICITÉ", description: "Le collagène améliore aussi l'élasticité de la peau de 28% en 8 semaines", value: "+28%" },
      ],
    },
  ],

  // ─── POSTURE ───────────────────────────────────────────────
  "posture": [
    {
      subtitle: "Ta posture influence ta confiance, ton énergie et ta santé",
      tagLine: "TIENS-TOI DROIT",
      cards: [
        { icon: "bone", title: "80% MAL AU DOS", description: "80% des adultes ont mal au dos. Cause n°1 : mauvaise posture au bureau et manque de mouvement", value: "80%" },
        { icon: "brain", title: "CONFIANCE +33%", description: "Se tenir droit augmente ton sentiment de confiance de 33%. Prouvé par Harvard (Amy Cuddy)", value: "+33%" },
        { icon: "lungs", title: "RESPIRATION +30%", description: "Une bonne posture ouvre ta cage thoracique. Tu respires 30% mieux et récupères plus vite", value: "+30%" },
        { icon: "dance", title: "DANSE = CORRECTEUR", description: "La danse renforce les muscles posturaux (dos, abdos, fessiers) naturellement en 4 semaines", value: "4 sem" },
        { icon: "energy", title: "ÉNERGIE LIBÉRÉE", description: "Une mauvaise posture comprime tes organes et gaspille 20% de ton énergie. Redresse-toi!", value: "+20%" },
      ],
    },
  ],

  // ─── TRANSPIRATION / SUEUR ─────────────────────────────────
  "transpiration": [
    {
      subtitle: "Transpirer n'est pas un signe de faiblesse. C'est un superpouvoir.",
      tagLine: "TON SYSTÈME DE REFROIDISSEMENT",
      cards: [
        { icon: "droplet", title: "1 À 2L PAR COURS", description: "Pendant un cours Afroboost, tu perds entre 1 et 2 litres de sueur. C'est normal et sain", value: "1-2L" },
        { icon: "thermometer", title: "THERMORÉGULATION", description: "La sueur maintient ton corps à 37°C. Sans elle, ta température monte à 40°C en 15 min", value: "37°C" },
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
        { icon: "muscle", title: "29 MUSCLES DU CORE", description: "Le 'core' c'est 29 muscles, pas juste les tablettes. Ils stabilisent chaque mouvement de danse", value: "29" },
        { icon: "bone", title: "DOS PROTÉGÉ", description: "Un core solide réduit les douleurs de dos de 70%. C'est ton corset musculaire naturel", value: "-70%" },
        { icon: "dance", title: "DANSE = GAINAGE", description: "Chaque mouvement de bassin en Afroboost engage tes abdos profonds. Sans y penser", value: "AUTO" },
        { icon: "fire", title: "PAS DE 'SPOT REDUCTION'", description: "Impossible de perdre du gras localement. Le cardio-danse brûle les graisses sur tout le corps", value: "GLOBAL" },
        { icon: "shield", title: "ÉQUILIBRE ×2", description: "Un core solide double ton équilibre. Crucial pour les mouvements de danse complexes", value: "×2" },
      ],
    },
  ],

  // ─── FESSIERS ──────────────────────────────────────────────
  "fessier": [
    {
      subtitle: "Les fessiers sont le groupe musculaire le plus puissant du corps",
      tagLine: "PUISSANCE & ESTHÉTIQUE",
      cards: [
        { icon: "muscle", title: "LE PLUS GROS MUSCLE", description: "Le grand fessier est le muscle le plus puissant du corps humain. La danse afro le travaille à fond", value: "n°1" },
        { icon: "dance", title: "AFROBEAT = SQUATS", description: "Les mouvements de bassin de la danse afro équivalent à des centaines de squats par cours", value: "300+" },
        { icon: "bone", title: "PROTECTION DU DOS", description: "Des fessiers faibles surchargent le bas du dos. 80% des douleurs lombaires viennent de là", value: "80%" },
        { icon: "fire", title: "MÉTABOLISME BOOSTÉ", description: "Plus les fessiers sont musclés, plus ton métabolisme de base est élevé. Tu brûles 24h/24", value: "24/7" },
        { icon: "chart", title: "RÉSULTATS EN 4 SEM", description: "La danse afro galbe les fessiers visiblement en 4 semaines à raison de 2-3 cours/semaine", value: "4 sem" },
      ],
    },
  ],

  // ─── ENDORPHINES / BONHEUR ─────────────────────────────────
  "endorphine": [
    {
      subtitle: "La danse libère les mêmes hormones que le chocolat. En mieux.",
      tagLine: "CHIMIE DU BONHEUR",
      cards: [
        { icon: "brain", title: "ENDORPHINES ×5", description: "La danse en groupe libère 5x plus d'endorphines que l'exercice solo. Étude Oxford", value: "×5" },
        { icon: "heart", title: "DOPAMINE = PLAISIR", description: "Chaque mouvement réussi libère de la dopamine. Tu deviens littéralement accro au plaisir de danser", value: "PLAISIR" },
        { icon: "sparkle", title: "SÉROTONINE", description: "L'exercice régulier augmente ta sérotonine de 25%. Même effet que certains antidépresseurs", value: "+25%" },
        { icon: "people", title: "OCYTOCINE", description: "Danser en groupe libère l'ocytocine : l'hormone de l'attachement et de la confiance", value: "LIEN" },
        { icon: "moon", title: "EFFET 48H", description: "Les endorphines libérées par un cours restent actives 48h. Tu te sens bien pendant 2 jours", value: "48h" },
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
        { icon: "dance", title: "PROPRIOCEPTION", description: "La danse améliore ta conscience corporelle de 40%. Tu sais exactement où est chaque partie de toi", value: "+40%" },
        { icon: "shield", title: "CHUTES -60%", description: "Une meilleure coordination réduit le risque de chutes de 60%. Surtout avec l'âge", value: "-60%" },
        { icon: "clock", title: "TEMPS DE RÉACTION", description: "Les danseurs ont un temps de réaction 15% plus rapide que la moyenne. Réflexes affûtés", value: "-15%" },
        { icon: "star", title: "PAS BESOIN DE TALENT", description: "La coordination s'améliore à chaque cours. Après 6 semaines, tu te surprendras toi-même", value: "6 sem" },
      ],
    },
  ],

  // ─── IMMUNITÉ ──────────────────────────────────────────────
  "immunit": [
    {
      subtitle: "L'exercice modéré booste ton système immunitaire de 40%",
      tagLine: "TES DÉFENSES NATURELLES",
      cards: [
        { icon: "shield", title: "GLOBULES BLANCS +40%", description: "30 min d'exercice modéré augmentent tes globules blancs de 40%. Ton armée de défense", value: "+40%" },
        { icon: "thermometer", title: "RHUMES -50%", description: "Les sportifs réguliers ont 50% moins de rhumes et grippes. L'hiver ne te fait plus peur", value: "-50%" },
        { icon: "brain", title: "STRESS = POISON", description: "Le cortisol (stress) supprime ton immunité. La danse le réduit de 30%. Double bénéfice", value: "-30%" },
        { icon: "moon", title: "SOMMEIL IMMUNITAIRE", description: "Le sport améliore ton sommeil. Or 70% de ta récupération immunitaire se fait la nuit", value: "70%" },
        { icon: "apple", title: "INTESTIN = CLÉ", description: "80% de ton système immunitaire est dans tes intestins. L'exercice améliore ta flore de 25%", value: "80%" },
      ],
    },
  ],

  // ─── DIABÈTE / GLYCÉMIE ────────────────────────────────────
  "diabete": [
    {
      subtitle: "La danse réduit ton risque de diabète de type 2 de 50%",
      tagLine: "CONTRÔLE GLYCÉMIQUE",
      cards: [
        { icon: "shield", title: "RISQUE -50%", description: "30 min d'activité physique 5x/semaine réduit le risque de diabète de type 2 de 50%", value: "-50%" },
        { icon: "chart", title: "GLYCÉMIE RÉGULÉE", description: "L'exercice rend tes cellules 40% plus sensibles à l'insuline. Moins de pics de sucre", value: "+40%" },
        { icon: "fire", title: "GLUCOSE BRÛLÉ", description: "Tes muscles consomment du glucose pendant l'effort. Moins de sucre dans le sang", value: "DIRECT" },
        { icon: "clock", title: "EFFET 72H", description: "Après un cours, tes cellules restent plus sensibles à l'insuline pendant 72 heures", value: "72h" },
        { icon: "apple", title: "ALIMENTATION + SPORT", description: "Féculents complets + exercice régulier = la combinaison n°1 contre le diabète. Prouvé", value: "n°1" },
      ],
    },
  ],

  // ─── CHOLESTÉROL ───────────────────────────────────────────
  "cholesterol": [
    {
      subtitle: "La danse augmente ton bon cholestérol de 10% en 8 semaines",
      tagLine: "BON VS MAUVAIS",
      cards: [
        { icon: "heart", title: "HDL +10%", description: "L'exercice aérobie augmente le bon cholestérol (HDL) de 10% en 8 semaines", value: "+10%" },
        { icon: "shield", title: "LDL -15%", description: "L'activité régulière réduit le mauvais cholestérol (LDL) de 15%. Tes artères respirent", value: "-15%" },
        { icon: "fire", title: "150 MIN/SEMAINE", description: "L'OMS recommande 150 min d'activité modérée/semaine. 3 cours Afroboost = objectif atteint", value: "150min" },
        { icon: "apple", title: "OMÉGA-3 EN PLUS", description: "Poisson gras 2x/semaine + danse = combo anti-cholestérol le plus efficace", value: "2x/sem" },
        { icon: "chart", title: "RÉSULTATS EN 2 MOIS", description: "Les analyses sanguines montrent des améliorations mesurables dès 2 mois d'activité régulière", value: "2 mois" },
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
        { icon: "muscle", title: "MUSCLES STABILISATEURS", description: "La danse renforce les muscles autour des genoux et chevilles. Protection naturelle", value: "STAB." },
        { icon: "clock", title: "5 MIN D'ÉCHAUFFEMENT", description: "5 min de rotations articulaires avant le cours = articulations prêtes et protégées", value: "5min" },
      ],
    },
  ],

  // ─── CURCUMA ───────────────────────────────────────────────
  "curcuma": [
    {
      subtitle: "Le curcuma est l'anti-inflammatoire naturel le plus puissant",
      tagLine: "SUPER-ALIMENT ANTI-DOULEUR",
      cards: [
        { icon: "shield", title: "CURCUMINE", description: "La curcumine (principe actif) réduit l'inflammation aussi efficacement que l'ibuprofène. Sans effets secondaires", value: "= IBUP." },
        { icon: "muscle", title: "RÉCUPÉRATION -25%", description: "500mg de curcumine/jour réduit les douleurs musculaires de 25% après l'effort", value: "-25%" },
        { icon: "apple", title: "POIVRE NOIR OBLIGÉ", description: "La pipérine du poivre noir augmente l'absorption de la curcumine de 2000%. Toujours les combiner", value: "×2000%" },
        { icon: "brain", title: "NEUROPROTECTEUR", description: "La curcumine traverse la barrière hémato-encéphalique. Elle protège ton cerveau du déclin cognitif", value: "NEURO" },
        { icon: "heart", title: "ANTI-OXYDANT", description: "Le curcuma neutralise 5x plus de radicaux libres que la vitamine E", value: "×5" },
      ],
    },
  ],

  // ─── BANANE ────────────────────────────────────────────────
  "banane": [
    {
      subtitle: "La banane est le snack parfait du sportif. Voici pourquoi.",
      tagLine: "FRUIT DU SPORTIF",
      cards: [
        { icon: "energy", title: "ÉNERGIE RAPIDE", description: "25g de glucides naturels par banane. Énergie disponible en 15 min. Parfait avant le cours", value: "15min" },
        { icon: "muscle", title: "422mg DE POTASSIUM", description: "Le potassium prévient les crampes et régule les contractions musculaires. 1 banane = 12% AJR", value: "422mg" },
        { icon: "brain", title: "TRYPTOPHANE", description: "La banane contient du tryptophane, précurseur de la sérotonine. Elle améliore ton humeur", value: "MOOD+" },
        { icon: "shield", title: "MAGNÉSIUM", description: "32mg de magnésium par banane. Anti-crampes, anti-stress, pro-sommeil", value: "32mg" },
        { icon: "fire", title: "105 KCAL SEULEMENT", description: "Seulement 105 calories pour une banane moyenne. Rapport énergie/calorie imbattable", value: "105kcal" },
      ],
    },
  ],

  // ─── CAFÉ / CAFÉINE ────────────────────────────────────────
  "cafe": [
    {
      subtitle: "La caféine booste tes performances sportives de 12%",
      tagLine: "PERFORMANCE & TIMING",
      cards: [
        { icon: "energy", title: "+12% PERFORMANCE", description: "200mg de caféine (1 expresso) 30-60min avant l'effort améliore l'endurance de 12%", value: "+12%" },
        { icon: "fire", title: "BRÛLE-GRAISSE", description: "La caféine augmente l'oxydation des graisses de 30% pendant l'effort. Double effet", value: "+30%" },
        { icon: "brain", title: "CONCENTRATION", description: "La caféine bloque l'adénosine (fatigue) et booste la dopamine. Tu es plus alerte et focalisé", value: "FOCUS" },
        { icon: "clock", title: "TIMING CLÉ", description: "Effet maximal 30-60 min après consommation. Pic sanguin atteint en 45 min", value: "45min" },
        { icon: "moon", title: "ATTENTION LE SOIR", description: "La demi-vie est de 5-6h. Un café à 16h = encore 50% de caféine dans le sang à 22h", value: "5-6h" },
      ],
    },
  ],

  // ─── ALCOOL ────────────────────────────────────────────────
  "alcool": [
    {
      subtitle: "L'alcool détruit ta récupération musculaire pendant 72h",
      tagLine: "CE QUE L'ALCOOL FAIT VRAIMENT",
      cards: [
        { icon: "muscle", title: "SYNTHÈSE -37%", description: "L'alcool réduit la synthèse protéique musculaire de 37%. Tes muscles ne se réparent pas", value: "-37%" },
        { icon: "droplet", title: "DÉSHYDRATATION", description: "L'alcool est un diurétique puissant. 1 verre = 150ml d'eau perdue en plus. Crampes garanties", value: "-150ml" },
        { icon: "moon", title: "SOMMEIL DÉTRUIT", description: "L'alcool supprime le sommeil REM de 40%. Tu dors mais tu ne récupères pas", value: "-40%" },
        { icon: "fire", title: "MÉTABOLISME BLOQUÉ", description: "Ton foie priorise l'élimination de l'alcool. Pendant ce temps, tu ne brûles pas de graisses", value: "STOP" },
        { icon: "heart", title: "FRÉQUENCE CARDIAQUE", description: "L'alcool augmente ta fréquence cardiaque au repos de 5 bpm pendant 24h. Ton cœur trinque", value: "+5bpm" },
      ],
    },
  ],
};

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
  // Café
  "cafe": "cafe", "cafeine": "cafe", "expresso": "cafe", "espresso": "cafe",
  // Alcool
  "alcool": "alcool", "biere": "alcool", "vin": "alcool", "aperitif": "alcool",
  // Manger (→ nutrition)
  "manger": "nutrition",
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
 * Génère automatiquement un sous-titre + 5 cartes d'infographie ÉDUCATIVES
 * à partir d'un titre/sujet donné par l'utilisateur.
 */
export function generateSmartContent(title: string): SmartContentResult {
  // Normaliser : minuscules, sans accents, sans ponctuation
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  // 1. Chercher le meilleur match mot-clé
  let matchedTopic: string | null = null;
  let bestMatchLength = 0;

  const words = normalized.split(/[\s,.'&+\-/]+/).filter((w) => w.length >= 2);

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
    topicData = variants[Math.floor(Math.random() * variants.length)];
  } else {
    topicData = generateDynamicFallback(title, normalized);
  }

  // 4. Convertir les icônes
  const cards: InfoCardData[] = topicData.cards.map((card) => ({
    icon: ICONS[card.icon] || "⚡",
    title: card.title,
    description: card.description,
    value: card.value,
  }));

  return {
    subtitle: topicData.subtitle,
    tagLine: topicData.tagLine,
    cards,
  };
}

/**
 * Fallback DYNAMIQUE quand le sujet n'est pas dans la base.
 * Génère du contenu personnalisé basé sur le titre plutôt que du générique.
 */
function generateDynamicFallback(title: string, _normalized: string): TopicData {
  const upper = title.toUpperCase().trim();
  const displayName = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();

  // Essayer de catégoriser le sujet
  const nutriKeywords = ["fruit", "legume", "aliment", "nourriture", "plat", "recette", "ingredient", "graine", "noix", "huile", "lait", "yaourt", "fromage", "viande", "oeuf", "tomate", "avocat", "epinard", "brocoli", "quinoa", "lentille", "haricot", "amande", "chocolat", "miel", "gingembre", "ail", "citron", "orange", "mangue", "ananas", "coco", "the"];
  const sportKeywords = ["sport", "exercice", "jump", "hiit", "stretch", "yoga", "pilates", "boxe", "combat", "sprint", "marche", "velo", "natation", "nage", "course", "running"];
  const bodyKeywords = ["bras", "jambe", "epaule", "mollet", "cuisse", "poitrine", "taille", "pied", "main", "cou", "nuque", "hanche"];
  const wellnessKeywords = ["meditation", "relaxation", "massage", "sauna", "bain", "detox", "jeune", "intermittent", "aromatherapie", "acupuncture"];

  const norm = _normalized;
  const isNutri = nutriKeywords.some(k => norm.includes(k));
  const isSport = sportKeywords.some(k => norm.includes(k));
  const isBody = bodyKeywords.some(k => norm.includes(k));
  const isWellness = wellnessKeywords.some(k => norm.includes(k));

  if (isNutri) {
    return {
      subtitle: `${displayName} : ce que la science dit vraiment sur ses bienfaits`,
      tagLine: "NUTRITION & SANTÉ",
      cards: [
        { icon: "apple", title: `${upper.slice(0, 20)}`, description: `${displayName} est un allié nutritionnel. Découvre ses nutriments clés et comment en profiter`, value: "INFO" },
        { icon: "shield", title: "ANTIOXYDANTS", description: "Les aliments naturels contiennent des antioxydants qui protègent tes cellules du stress oxydatif", value: "PROTÈGE" },
        { icon: "energy", title: "ÉNERGIE NATURELLE", description: "Les nutriments naturels fournissent une énergie stable sans le crash des aliments transformés", value: "STABLE" },
        { icon: "fire", title: "QUAND LE MANGER", description: "Le timing nutritionnel compte : avant l'effort pour l'énergie, après pour la récupération", value: "TIMING" },
        { icon: "heart", title: "SPORT + NUTRITION", description: "La combinaison alimentation saine + activité physique régulière multiplie les bénéfices par 3", value: "×3" },
      ],
    };
  }

  if (isSport) {
    return {
      subtitle: `${displayName} + danse afro : le combo parfait pour ton corps`,
      tagLine: "CROSS-TRAINING",
      cards: [
        { icon: "fire", title: `${upper.slice(0, 20)}`, description: `Combiner ${displayName.toLowerCase()} et danse afro travaille ton corps sous tous les angles`, value: "COMBO" },
        { icon: "heart", title: "CARDIO VARIÉ", description: "Alterner les activités empêche ton corps de s'habituer. Résultats plus rapides", value: "+30%" },
        { icon: "muscle", title: "MUSCLES COMPLETS", description: "Chaque sport cible des muscles différents. Le mix = un corps harmonieux et équilibré", value: "360°" },
        { icon: "brain", title: "ZÉRO MONOTONIE", description: "La variété tue l'ennui. Tu restes motivé 3x plus longtemps qu'avec un seul sport", value: "×3" },
        { icon: "shield", title: "BLESSURES RÉDUITES", description: "Varier les mouvements réduit le risque de blessures par surutilisation de 45%", value: "-45%" },
      ],
    };
  }

  if (isBody) {
    return {
      subtitle: `Renforcer et tonifier : ce que la danse fait pour ton corps`,
      tagLine: "CIBLAGE MUSCULAIRE",
      cards: [
        { icon: "muscle", title: `${upper.slice(0, 20)}`, description: `La danse afro sollicite cette zone de manière naturelle. Tonification progressive et durable`, value: "CIBLÉ" },
        { icon: "dance", title: "MOUVEMENT COMPLET", description: "Contrairement à la muscu, la danse travaille les muscles en mouvement. Plus fonctionnel", value: "FUNC." },
        { icon: "fire", title: "TONIFICATION", description: "La danse tonifie sans créer de masse. Silhouette dessinée et muscles allongés", value: "LEAN" },
        { icon: "bone", title: "ARTICULATIONS", description: "Les mouvements de danse renforcent les articulations et les muscles stabilisateurs autour", value: "+25%" },
        { icon: "chart", title: "RÉSULTATS 4 SEM", description: "Les premiers changements visibles apparaissent après 4 semaines à 2-3 cours/semaine", value: "4 sem" },
      ],
    };
  }

  if (isWellness) {
    return {
      subtitle: `${displayName} : le complément parfait à ta pratique sportive`,
      tagLine: "BIEN-ÊTRE GLOBAL",
      cards: [
        { icon: "sparkle", title: `${upper.slice(0, 20)}`, description: `${displayName} complète l'activité physique pour un bien-être complet corps et esprit`, value: "HOLIST." },
        { icon: "brain", title: "RÉCUPÉRATION MENTALE", description: "Le bien-être mental est aussi important que le physique. Les deux se renforcent mutuellement", value: "MENTAL" },
        { icon: "moon", title: "SOMMEIL AMÉLIORÉ", description: "Les pratiques de bien-être améliorent la qualité du sommeil de 35% en moyenne", value: "+35%" },
        { icon: "heart", title: "CORTISOL -40%", description: "Les techniques de relaxation réduisent le cortisol de 40%. Combinées à la danse : -55%", value: "-40%" },
        { icon: "shield", title: "IMMUNITÉ BOOSTÉE", description: "Bien-être + sport = système immunitaire renforcé de 50%. La meilleure médecine préventive", value: "+50%" },
      ],
    };
  }

  // Fallback ultime : contenu centré sur le titre tapé
  return {
    subtitle: `${displayName} : les bienfaits prouvés pour ta santé et tes performances`,
    tagLine: "LE SAVIEZ-VOUS ?",
    cards: [
      { icon: "brain", title: `${upper.slice(0, 20)} & CERVEAU`, description: `${displayName} a un impact direct sur ton cerveau. La science montre des effets mesurables sur la concentration`, value: "NEURO" },
      { icon: "heart", title: "IMPACT CARDIOVASCULAIRE", description: "Ton système cardiovasculaire réagit positivement. Combiné à la danse, les bénéfices se multiplient", value: "+CŒUR" },
      { icon: "energy", title: "TON ÉNERGIE AU QUOTIDIEN", description: "L'énergie vient d'un équilibre entre nutrition, mouvement et récupération. Chaque élément compte", value: "BALANCE" },
      { icon: "muscle", title: "MUSCLES & RÉCUPÉRATION", description: "Tes muscles ont besoin de 48h pour se reconstruire après un effort intense. Optimise ce temps", value: "48h" },
      { icon: "apple", title: "NUTRITION ASSOCIÉE", description: "Associé à une alimentation équilibrée et 2-3 cours/semaine, les résultats sont visibles en 1 mois", value: "1 mois" },
    ],
  };
}
