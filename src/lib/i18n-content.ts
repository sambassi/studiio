/**
 * Multilingual content pools for AI-generated video titles, subtitles, and phrases.
 * Used by Creator, Calendar (Agent IA), and Infographic batch systems.
 */

import type { Locale } from '@/i18n/config';

interface ContentPools {
  titles: Record<string, string[]>;
  subtitles: Record<string, string[]>;
  phrases: Record<string, string[]>;
  objectiveLabels: Record<string, string>;
  salesPhrases: string[];
  captionPools: Record<string, string[]>;
}

const FR: ContentPools = {
  titles: {
    promo: ['OFFRE EXCLUSIVE', 'PROMO FLASH', 'BON PLAN', 'DEAL DU JOUR', 'OFFRE LIMITÉE', 'SOLDES', 'DERNIÈRE CHANCE', 'PRIX CASSÉ', 'VENTE FLASH', 'OFFRE SPÉCIALE'],
    motiv: ['C\'EST TON MOMENT', 'LÈVE-TOI', 'NO EXCUSES', 'DÉPASSE-TOI', 'GO GO GO', 'BELIEVE', 'TU PEUX', 'NEVER GIVE UP', 'PUSH HARDER', 'DISCIPLINE'],
    bienfaits: ['LES BIENFAITS', 'TOP RÉSULTATS', 'LE SECRET', 'PROUVÉ', 'EFFICACE', 'TRANSFORME-TOI', 'SANTÉ TOTALE', 'BIEN-ÊTRE', 'MENTAL D\'ACIER', 'ÉNERGIE PURE'],
    abo: ['ABONNE-TOI', 'REJOINS-NOUS', 'FOLLOW NOW', 'ON T\'ATTEND', 'REJOINS LA TRIBU', 'ACTIVE LA CLOCHE', 'STAY TUNED', 'NE RATE RIEN', 'LINK IN BIO', 'ESSAI OFFERT'],
    nutri: ['MANGE MIEUX', 'RECETTE DU JOUR', 'NUTRITION', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'BOOST NATUREL', 'FUEL TON CORPS', 'ÉNERGIE SAINE'],
    promotion: ['OFFRE EXCLUSIVE', 'PROMO FLASH', 'BON PLAN', 'DEAL DU JOUR', 'OFFRE LIMITÉE', 'SOLDES', 'DERNIÈRE CHANCE', 'PRIX CASSÉ', 'OFFRE SPÉCIALE', 'VENTE FLASH'],
    subscription: ['ABONNE-TOI', 'REJOINS-NOUS', 'FOLLOW NOW', 'ON T\'ATTEND', 'LINK IN BIO', 'ACTIVE LA CLOCHE', 'STAY TUNED', 'REJOINS LA TRIBU', 'NE RATE RIEN', 'FOLLOW MAINTENANT'],
    motivation: ['C\'EST TON MOMENT', 'LÈVE-TOI', 'NO EXCUSES', 'DÉPASSE-TOI', 'GO GO GO', 'BELIEVE', 'TU PEUX', 'NEVER GIVE UP', 'PUSH HARDER', 'NO LIMIT'],
    benefits: ['LES BIENFAITS', 'DÉCOUVRE', 'TOP RÉSULTATS', 'LE SECRET', 'AVANT/APRÈS', 'PROUVÉ', 'EFFICACE', 'TESTÉ', 'RÉSULTATS', 'TRANSFORME-TOI'],
    nutrition: ['MANGE MIEUX', 'RECETTE DU JOUR', 'NUTRITION', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'BOOST NATUREL', 'ÉNERGIE SAINE', 'FUEL YOUR BODY'],
  },
  subtitles: {
    promo: ['Profite avant qu\'il soit trop tard', 'Une opportunité unique', 'Seulement cette semaine', 'Places limitées', 'Ne rate pas cette offre', 'Quantités réduites', 'Offre qui expire bientôt'],
    motiv: ['Ton futur commence ici', 'Chaque jour est une chance', 'Tu es capable de tout', 'Le moment c\'est maintenant', 'Rien n\'est impossible', 'La discipline fait la différence', 'Ton potentiel est illimité'],
    bienfaits: ['Résultats visibles rapidement', 'Ton corps va te remercier', 'Testé et approuvé', 'Transformation garantie', 'La science a parlé', 'Prouvé par des milliers', 'Le changement commence ici'],
    abo: ['Rejoins la communauté', 'Du contenu exclusif chaque jour', 'La team t\'attend', 'Première vidéo gratuite', 'Contenu premium', 'Accès illimité', 'La famille Afroboost t\'attend'],
    nutri: ['La clé d\'une vie saine', 'Recettes simples et efficaces', 'Bon pour toi et délicieux', 'Nutrition optimale', 'Transforme ton alimentation', 'Énergie naturelle garantie', 'Ton corps mérite le meilleur'],
    promotion: ['Ne rate pas cette offre', 'Profite avant qu\'il soit trop tard', 'Une opportunité unique', 'Seulement cette semaine', 'Places limitées'],
    subscription: ['Rejoins la communauté', 'Du contenu exclusif chaque jour', 'Contenu premium gratuit', 'La team t\'attend', 'Première vidéo gratuite'],
    motivation: ['Ton futur commence ici', 'Chaque jour est une chance', 'Tu es capable de tout', 'Rien n\'est impossible', 'Le moment c\'est maintenant'],
    benefits: ['Résultats visibles rapidement', 'Ton corps va te remercier', 'La science a parlé', 'Testé et approuvé', 'Transformation garantie'],
    nutrition: ['La clé d\'une vie saine', 'Recettes simples et efficaces', 'Transforme ton alimentation', 'Bon pour toi et délicieux', 'Nutrition optimale'],
  },
  phrases: {
    promo: ['Offre limitée !', '-30% cette semaine', 'Réserve ta place', 'Profite maintenant', 'Code promo en bio', 'Dernières places', 'Ne rate pas ça'],
    motiv: ['C\'est maintenant ou jamais', 'Chaque jour compte', 'Pas d\'excuses', 'Lève-toi et brille', 'Go hard or go home', 'No pain no gain', 'Crois en toi'],
    bienfaits: ['Découvre les résultats', 'Essaie et compare', 'Les chiffres parlent', 'Testé par +5000', 'Prouvé scientifiquement', 'Résultats dès la 1ère semaine', 'Voir c\'est croire'],
    abo: ['Abonne-toi !', 'Follow pour + de contenu', 'Active les notifs', 'Lien en bio', 'Rejoins-nous maintenant', 'C\'est gratuit !', 'La tribu grandit'],
    nutri: ['Teste cette recette', 'Mange sain, vis mieux', 'Ton corps te remerciera', 'Simple, rapide, efficace', 'La nutrition c\'est la clé', 'Boost ton énergie', 'Zéro compromis'],
    promotion: ['Offre limitée !', '-30% cette semaine', 'Réserve ta place', 'Profite maintenant', 'Code promo en bio'],
    subscription: ['Abonne-toi !', 'Follow pour + de contenu', 'Active les notifs', 'Lien en bio', 'Rejoins-nous maintenant'],
    motivation: ['C\'est maintenant ou jamais', 'Chaque jour compte', 'Pas d\'excuses', 'Lève-toi et brille', 'Go hard or go home'],
    benefits: ['Découvre les résultats', 'Essaie et compare', 'Prouvé cliniquement', 'Les chiffres parlent', 'Testé par + de 5000'],
    nutrition: ['Teste cette recette', 'Mange sain, vis mieux', 'Ton corps te remerciera', 'Simple, rapide, efficace', 'La nutrition c\'est la clé'],
  },
  objectiveLabels: { promo: 'Promotion', motiv: 'Motivation', bienfaits: 'Bienfaits', abo: 'Abonnement', nutri: 'Nutrition' },
  salesPhrases: [
    'Réserve ta place maintenant !', 'Offre limitée cette semaine', 'Premier cours GRATUIT',
    'Rejoins la communauté', '-50% sur ton abonnement', 'Essai gratuit 7 jours',
    'Booste ton énergie !', 'Transforme ton corps', 'Résultats garantis', 'Inscription ouverte',
  ],
  captionPools: {
    promotion: ['🔥 Offre exclusive ! Ne rate pas cette opportunité, places limitées 💥', '💰 Prix cassé cette semaine seulement !', '⚡ Dernière chance de profiter de cette offre !', '🎯 Deal du jour : -30% sur tout !'],
    motivation: ['💪 Tu es plus fort que tu ne le penses !', '🔥 Chaque jour est une nouvelle chance de briller', '⭐ Pas d\'excuses, juste des résultats !', '🚀 Ton potentiel est illimité'],
    bienfaits: ['✨ Les bienfaits que tu ne soupçonnais pas', '❤️ Ton corps te remerciera', '🧠 Prouvé scientifiquement', '💎 Transforme ta vie en 30 jours'],
    abonnement: ['📲 Abonne-toi pour ne rien rater !', '🔔 Active les notifications !', '👥 Rejoins la communauté !', '🎬 Contenu exclusif chaque jour'],
    nutrition: ['🥗 Recette healthy du jour', '🍎 Mange mieux, vis mieux', '⚡ Boost ton énergie naturellement', '🌿 Nutrition optimale, résultats garantis'],
  },
};

const EN: ContentPools = {
  titles: {
    promo: ['EXCLUSIVE OFFER', 'FLASH SALE', 'GREAT DEAL', 'DEAL OF THE DAY', 'LIMITED OFFER', 'SALE', 'LAST CHANCE', 'PRICE DROP', 'FLASH SALE', 'SPECIAL OFFER'],
    motiv: ['THIS IS YOUR MOMENT', 'RISE UP', 'NO EXCUSES', 'PUSH YOURSELF', 'GO GO GO', 'BELIEVE', 'YOU CAN', 'NEVER GIVE UP', 'PUSH HARDER', 'DISCIPLINE'],
    bienfaits: ['THE BENEFITS', 'TOP RESULTS', 'THE SECRET', 'PROVEN', 'EFFECTIVE', 'TRANSFORM YOURSELF', 'TOTAL HEALTH', 'WELL-BEING', 'STEEL MIND', 'PURE ENERGY'],
    abo: ['SUBSCRIBE', 'JOIN US', 'FOLLOW NOW', 'WE\'RE WAITING', 'JOIN THE TRIBE', 'HIT THE BELL', 'STAY TUNED', 'DON\'T MISS OUT', 'LINK IN BIO', 'FREE TRIAL'],
    nutri: ['EAT BETTER', 'RECIPE OF THE DAY', 'NUTRITION', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'NATURAL BOOST', 'FUEL YOUR BODY', 'CLEAN ENERGY'],
    promotion: ['EXCLUSIVE OFFER', 'FLASH SALE', 'GREAT DEAL', 'DEAL OF THE DAY', 'LIMITED OFFER', 'SALE', 'LAST CHANCE', 'PRICE DROP', 'SPECIAL OFFER', 'FLASH DEAL'],
    subscription: ['SUBSCRIBE', 'JOIN US', 'FOLLOW NOW', 'WE\'RE WAITING', 'LINK IN BIO', 'HIT THE BELL', 'STAY TUNED', 'JOIN THE TRIBE', 'DON\'T MISS OUT', 'FOLLOW NOW'],
    motivation: ['THIS IS YOUR MOMENT', 'RISE UP', 'NO EXCUSES', 'PUSH YOURSELF', 'GO GO GO', 'BELIEVE', 'YOU CAN', 'NEVER GIVE UP', 'PUSH HARDER', 'NO LIMIT'],
    benefits: ['THE BENEFITS', 'DISCOVER', 'TOP RESULTS', 'THE SECRET', 'BEFORE/AFTER', 'PROVEN', 'EFFECTIVE', 'TESTED', 'RESULTS', 'TRANSFORM YOURSELF'],
    nutrition: ['EAT BETTER', 'RECIPE OF THE DAY', 'NUTRITION', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'NATURAL BOOST', 'CLEAN ENERGY', 'FUEL YOUR BODY'],
  },
  subtitles: {
    promo: ['Don\'t miss out', 'A unique opportunity', 'This week only', 'Limited spots', 'Don\'t miss this offer', 'Limited stock', 'Offer ending soon'],
    motiv: ['Your future starts here', 'Every day is a chance', 'You are capable of anything', 'The moment is now', 'Nothing is impossible', 'Discipline makes the difference', 'Your potential is unlimited'],
    bienfaits: ['Visible results fast', 'Your body will thank you', 'Tested and approved', 'Transformation guaranteed', 'Science has spoken', 'Proven by thousands', 'Change starts here'],
    abo: ['Join the community', 'Exclusive content every day', 'The team is waiting', 'First video free', 'Premium content', 'Unlimited access', 'The Afroboost family awaits'],
    nutri: ['The key to a healthy life', 'Simple and effective recipes', 'Good for you and delicious', 'Optimal nutrition', 'Transform your diet', 'Natural energy guaranteed', 'Your body deserves the best'],
    promotion: ['Don\'t miss this offer', 'Don\'t miss out', 'A unique opportunity', 'This week only', 'Limited spots'],
    subscription: ['Join the community', 'Exclusive content every day', 'Free premium content', 'The team is waiting', 'First video free'],
    motivation: ['Your future starts here', 'Every day is a chance', 'You are capable of anything', 'Nothing is impossible', 'The moment is now'],
    benefits: ['Visible results fast', 'Your body will thank you', 'Science has spoken', 'Tested and approved', 'Transformation guaranteed'],
    nutrition: ['The key to a healthy life', 'Simple and effective recipes', 'Transform your diet', 'Good for you and delicious', 'Optimal nutrition'],
  },
  phrases: {
    promo: ['Limited offer!', '-30% this week', 'Reserve your spot', 'Get it now', 'Promo code in bio', 'Last spots', 'Don\'t miss this'],
    motiv: ['It\'s now or never', 'Every day counts', 'No excuses', 'Rise and shine', 'Go hard or go home', 'No pain no gain', 'Believe in yourself'],
    bienfaits: ['Discover the results', 'Try and compare', 'The numbers speak', 'Tested by 5000+', 'Scientifically proven', 'Results from week 1', 'Seeing is believing'],
    abo: ['Subscribe!', 'Follow for more content', 'Turn on notifications', 'Link in bio', 'Join us now', 'It\'s free!', 'The tribe is growing'],
    nutri: ['Try this recipe', 'Eat clean, live better', 'Your body will thank you', 'Simple, fast, effective', 'Nutrition is key', 'Boost your energy', 'Zero compromise'],
    promotion: ['Limited offer!', '-30% this week', 'Reserve your spot', 'Get it now', 'Promo code in bio'],
    subscription: ['Subscribe!', 'Follow for more content', 'Turn on notifications', 'Link in bio', 'Join us now'],
    motivation: ['It\'s now or never', 'Every day counts', 'No excuses', 'Rise and shine', 'Go hard or go home'],
    benefits: ['Discover the results', 'Try and compare', 'Clinically proven', 'The numbers speak', 'Tested by 5000+'],
    nutrition: ['Try this recipe', 'Eat clean, live better', 'Your body will thank you', 'Simple, fast, effective', 'Nutrition is key'],
  },
  objectiveLabels: { promo: 'Promotion', motiv: 'Motivation', bienfaits: 'Benefits', abo: 'Subscription', nutri: 'Nutrition' },
  salesPhrases: [
    'Reserve your spot now!', 'Limited offer this week', 'First class FREE',
    'Join the community', '-50% on your subscription', '7-day free trial',
    'Boost your energy!', 'Transform your body', 'Guaranteed results', 'Registration open',
  ],
  captionPools: {
    promotion: ['🔥 Exclusive offer! Don\'t miss this, limited spots 💥', '💰 Prices slashed this week only!', '⚡ Last chance to grab this deal!', '🎯 Deal of the day: -30% on everything!'],
    motivation: ['💪 You are stronger than you think!', '🔥 Every day is a new chance to shine', '⭐ No excuses, just results!', '🚀 Your potential is unlimited'],
    bienfaits: ['✨ Benefits you didn\'t know about', '❤️ Your body will thank you', '🧠 Scientifically proven', '💎 Transform your life in 30 days'],
    abonnement: ['📲 Subscribe to not miss anything!', '🔔 Turn on notifications!', '👥 Join the community!', '🎬 Exclusive content every day'],
    nutrition: ['🥗 Healthy recipe of the day', '🍎 Eat better, live better', '⚡ Boost your energy naturally', '🌿 Optimal nutrition, guaranteed results'],
  },
};

const DE: ContentPools = {
  titles: {
    promo: ['EXKLUSIVES ANGEBOT', 'BLITZVERKAUF', 'TOP DEAL', 'DEAL DES TAGES', 'BEGRENZTES ANGEBOT', 'SALE', 'LETZTE CHANCE', 'PREISSTURZ', 'FLASH SALE', 'SONDERANGEBOT'],
    motiv: ['DEIN MOMENT', 'STEH AUF', 'KEINE AUSREDEN', 'ÜBERTREFFE DICH', 'LOS GEHT\'S', 'GLAUB AN DICH', 'DU KANNST DAS', 'GIB NICHT AUF', 'STÄRKER WERDEN', 'DISZIPLIN'],
    bienfaits: ['DIE VORTEILE', 'TOP ERGEBNISSE', 'DAS GEHEIMNIS', 'BEWIESEN', 'EFFEKTIV', 'VERWANDLE DICH', 'GANZHEITLICH', 'WOHLBEFINDEN', 'STÄHLERNER GEIST', 'PURE ENERGIE'],
    abo: ['ABONNIERE', 'MACH MIT', 'FOLGE JETZT', 'WIR WARTEN', 'WERDE TEIL', 'AKTIVIERE DIE GLOCKE', 'BLEIB DRAN', 'VERPASSE NICHTS', 'LINK IN BIO', 'GRATIS TESTEN'],
    nutri: ['ISS BESSER', 'REZEPT DES TAGES', 'ERNÄHRUNG', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'NATÜRLICHER BOOST', 'POWER FÜR DEN KÖRPER', 'SAUBERE ENERGIE'],
    promotion: ['EXKLUSIVES ANGEBOT', 'BLITZVERKAUF', 'TOP DEAL', 'DEAL DES TAGES', 'BEGRENZTES ANGEBOT', 'SALE', 'LETZTE CHANCE', 'PREISSTURZ', 'SONDERANGEBOT', 'FLASH DEAL'],
    subscription: ['ABONNIERE', 'MACH MIT', 'FOLGE JETZT', 'WIR WARTEN', 'LINK IN BIO', 'AKTIVIERE DIE GLOCKE', 'BLEIB DRAN', 'WERDE TEIL', 'VERPASSE NICHTS', 'JETZT FOLGEN'],
    motivation: ['DEIN MOMENT', 'STEH AUF', 'KEINE AUSREDEN', 'ÜBERTREFFE DICH', 'LOS GEHT\'S', 'GLAUB AN DICH', 'DU KANNST DAS', 'GIB NICHT AUF', 'STÄRKER WERDEN', 'KEIN LIMIT'],
    benefits: ['DIE VORTEILE', 'ENTDECKE', 'TOP ERGEBNISSE', 'DAS GEHEIMNIS', 'VORHER/NACHHER', 'BEWIESEN', 'EFFEKTIV', 'GETESTET', 'ERGEBNISSE', 'VERWANDLE DICH'],
    nutrition: ['ISS BESSER', 'REZEPT DES TAGES', 'ERNÄHRUNG', 'HEALTHY LIFE', 'CLEAN EATING', 'MEAL PREP', 'SUPER FOOD', 'NATÜRLICHER BOOST', 'SAUBERE ENERGIE', 'POWER FÜR DEN KÖRPER'],
  },
  subtitles: {
    promo: ['Greif zu, bevor es zu spät ist', 'Eine einmalige Gelegenheit', 'Nur diese Woche', 'Begrenzte Plätze', 'Lass dir dieses Angebot nicht entgehen', 'Begrenzte Stückzahl', 'Angebot endet bald'],
    motiv: ['Deine Zukunft beginnt hier', 'Jeder Tag ist eine Chance', 'Du kannst alles schaffen', 'Der Moment ist jetzt', 'Nichts ist unmöglich', 'Disziplin macht den Unterschied', 'Dein Potenzial ist grenzenlos'],
    bienfaits: ['Schnell sichtbare Ergebnisse', 'Dein Körper wird es dir danken', 'Getestet und bewährt', 'Transformation garantiert', 'Die Wissenschaft hat gesprochen', 'Von Tausenden bestätigt', 'Veränderung beginnt hier'],
    abo: ['Werde Teil der Community', 'Exklusiver Content jeden Tag', 'Das Team wartet auf dich', 'Erstes Video gratis', 'Premium Content', 'Unbegrenzter Zugang', 'Die Afroboost-Familie wartet'],
    nutri: ['Der Schlüssel zu einem gesunden Leben', 'Einfache und effektive Rezepte', 'Gut für dich und lecker', 'Optimale Ernährung', 'Verwandle deine Ernährung', 'Natürliche Energie garantiert', 'Dein Körper verdient das Beste'],
    promotion: ['Lass dir dieses Angebot nicht entgehen', 'Greif zu, bevor es zu spät ist', 'Eine einmalige Gelegenheit', 'Nur diese Woche', 'Begrenzte Plätze'],
    subscription: ['Werde Teil der Community', 'Exklusiver Content jeden Tag', 'Gratis Premium Content', 'Das Team wartet auf dich', 'Erstes Video gratis'],
    motivation: ['Deine Zukunft beginnt hier', 'Jeder Tag ist eine Chance', 'Du kannst alles schaffen', 'Nichts ist unmöglich', 'Der Moment ist jetzt'],
    benefits: ['Schnell sichtbare Ergebnisse', 'Dein Körper wird es dir danken', 'Die Wissenschaft hat gesprochen', 'Getestet und bewährt', 'Transformation garantiert'],
    nutrition: ['Der Schlüssel zu einem gesunden Leben', 'Einfache und effektive Rezepte', 'Verwandle deine Ernährung', 'Gut für dich und lecker', 'Optimale Ernährung'],
  },
  phrases: {
    promo: ['Begrenztes Angebot!', '-30% diese Woche', 'Reserviere deinen Platz', 'Jetzt zugreifen', 'Promo-Code in Bio', 'Letzte Plätze', 'Nicht verpassen'],
    motiv: ['Jetzt oder nie', 'Jeder Tag zählt', 'Keine Ausreden', 'Steh auf und strahle', 'Go hard or go home', 'No pain no gain', 'Glaub an dich'],
    bienfaits: ['Entdecke die Ergebnisse', 'Probier es aus und vergleiche', 'Die Zahlen sprechen', 'Von 5000+ getestet', 'Wissenschaftlich bewiesen', 'Ergebnisse ab Woche 1', 'Sehen ist glauben'],
    abo: ['Abonniere!', 'Folge für mehr Content', 'Benachrichtigungen aktivieren', 'Link in Bio', 'Mach jetzt mit', 'Es ist kostenlos!', 'Die Tribe wächst'],
    nutri: ['Probier dieses Rezept', 'Iss sauber, leb besser', 'Dein Körper wird es dir danken', 'Einfach, schnell, effektiv', 'Ernährung ist der Schlüssel', 'Boost deine Energie', 'Null Kompromisse'],
    promotion: ['Begrenztes Angebot!', '-30% diese Woche', 'Reserviere deinen Platz', 'Jetzt zugreifen', 'Promo-Code in Bio'],
    subscription: ['Abonniere!', 'Folge für mehr Content', 'Benachrichtigungen aktivieren', 'Link in Bio', 'Mach jetzt mit'],
    motivation: ['Jetzt oder nie', 'Jeder Tag zählt', 'Keine Ausreden', 'Steh auf und strahle', 'Go hard or go home'],
    benefits: ['Entdecke die Ergebnisse', 'Probier es aus und vergleiche', 'Klinisch bewiesen', 'Die Zahlen sprechen', 'Von 5000+ getestet'],
    nutrition: ['Probier dieses Rezept', 'Iss sauber, leb besser', 'Dein Körper wird es dir danken', 'Einfach, schnell, effektiv', 'Ernährung ist der Schlüssel'],
  },
  objectiveLabels: { promo: 'Promotion', motiv: 'Motivation', bienfaits: 'Vorteile', abo: 'Abonnement', nutri: 'Ernährung' },
  salesPhrases: [
    'Reserviere jetzt deinen Platz!', 'Begrenztes Angebot diese Woche', 'Erster Kurs GRATIS',
    'Werde Teil der Community', '-50% auf dein Abo', '7 Tage gratis testen',
    'Boost deine Energie!', 'Verwandle deinen Körper', 'Ergebnisse garantiert', 'Anmeldung offen',
  ],
  captionPools: {
    promotion: ['🔥 Exklusives Angebot! Nicht verpassen, begrenzte Plätze 💥', '💰 Diese Woche Preise im Keller!', '⚡ Letzte Chance dieses Angebot zu nutzen!', '🎯 Deal des Tages: -30% auf alles!'],
    motivation: ['💪 Du bist stärker als du denkst!', '🔥 Jeder Tag ist eine neue Chance zu glänzen', '⭐ Keine Ausreden, nur Ergebnisse!', '🚀 Dein Potenzial ist grenzenlos'],
    bienfaits: ['✨ Vorteile, die du nicht kanntest', '❤️ Dein Körper wird es dir danken', '🧠 Wissenschaftlich bewiesen', '💎 Verwandle dein Leben in 30 Tagen'],
    abonnement: ['📲 Abonniere, um nichts zu verpassen!', '🔔 Benachrichtigungen aktivieren!', '👥 Werde Teil der Community!', '🎬 Exklusiver Content jeden Tag'],
    nutrition: ['🥗 Gesundes Rezept des Tages', '🍎 Iss besser, leb besser', '⚡ Boost deine Energie natürlich', '🌿 Optimale Ernährung, garantierte Ergebnisse'],
  },
};

const CONTENT_POOLS: Record<Locale, ContentPools> = { fr: FR, en: EN, de: DE };

export function getContentPools(locale: Locale): ContentPools {
  return CONTENT_POOLS[locale] || FR;
}

export function pickRandom(arr: string[], exclude: string[] = []): string {
  const filtered = arr.filter((x) => !exclude.includes(x));
  const pool = filtered.length > 0 ? filtered : arr;
  return pool[Math.floor(Math.random() * pool.length)] || '';
}
