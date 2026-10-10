/**
 * Prompt image FIDELE — consigne utilisateur (francais) → prompt fournisseur.
 *
 * Probleme corrige : « femme noire transpirante avec casque audio sans fil
 * danse » donnait un portrait statique, casque filaire, sans danse. Le texte
 * partait brut (francais) a flux-schnell, suivi de « professional background »
 * qui tire le modele vers le portrait ; et la variante photo (Kontext) recevait
 * une traduction par mots isoles qui laissait le sujet et l'action en francais.
 *
 * Ici, une analyse PURE et DETERMINISTE (aucun appel a un LLM, aucun hasard) :
 *
 *   1. le texte est decoupe en jetons (accents et casse neutralises) ;
 *   2. un lexique de locutions (plus longue correspondance d'abord) classe
 *      chaque element : SUJET, ACTION, OBJETS, APPARENCE, DECOR, CONTRAINTES,
 *      STYLE ;
 *   3. l'adjectif francais POSTPOSE se rattache au nom qui le precede
 *      (« parapluie rouge » → « red umbrella ») ;
 *   4. « sans X » devient une contrainte « no X » ; « sans fil » donne
 *      « wireless » ET la contrainte « no cable visible » ;
 *   5. l'enrichissement ne fait qu'AJOUTER des mots de qualite/realisme ; il ne
 *      remplace jamais sujet, action ni objets, et n'ajoute jamais « portrait »,
 *      « looking at camera », « static » ni « professional background » quand
 *      il y a un sujet ou une action ;
 *   6. le texte ORIGINAL est toujours recopie mot pour mot en fin de prompt :
 *      un mot inconnu du lexique n'est jamais perdu.
 *
 * Le lexique est volontairement une simple table : pour l'etendre, ajouter une
 * ligne (variantes francaises SANS accents, traduction, categorie).
 */

export type CategorieLexique = 'sujet' | 'action' | 'objet' | 'apparence' | 'adj' | 'decor' | 'style';

export interface StructurePromptImage {
  /** Qui (anglais), adjectifs rattaches compris : « black woman ». */
  sujet: string[];
  /** Ce que fait le sujet : « dancing ». */
  action: string[];
  /** Ce qu'il porte / tient : « wireless headphones ». */
  objets: string[];
  /** Etat visible du sujet : « sweating ». */
  apparence: string[];
  /** Lieu, meteo, moment : « in the rain ». */
  decor: string[];
  /** Contraintes negatives exprimees positivement : « no cable visible ». */
  contraintes: string[];
  /** Style demande par l'utilisateur, puis enrichissement (ajouts seulement). */
  style: string[];
  /** Le texte de l'utilisateur, tel quel. */
  original: string;
}

export interface PromptImageConstruit {
  structure: StructurePromptImage;
  promptFinal: string;
}

interface EntreeLexique {
  /** Variantes francaises, minuscules, SANS accents, mots separes par un espace. */
  fr: string[];
  en: string;
  cat: CategorieLexique;
  /** Pluriel anglais : pas d'article « A ». */
  pluriel?: boolean;
  /** Contrainte ajoutee en plus (ex. « sans fil » → « no cable visible »). */
  contrainte?: string;
  /**
   * Decor : preposition placee devant quand il y a un sujet ou une action
   * (« on a beach »). Defaut « in a ». Chaine vide : deja incluse (« in the rain »).
   */
  prep?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Lexique
// ═══════════════════════════════════════════════════════════════════════════

const LEXIQUE: EntreeLexique[] = [
  // ── SUJETS ──
  { fr: ['jeune femme'], en: 'young woman', cat: 'sujet' },
  { fr: ['jeune homme'], en: 'young man', cat: 'sujet' },
  { fr: ['personne agee', 'personnes agees'], en: 'elderly person', cat: 'sujet' },
  { fr: ['femme'], en: 'woman', cat: 'sujet' },
  { fr: ['femmes'], en: 'women', cat: 'sujet', pluriel: true },
  { fr: ['homme'], en: 'man', cat: 'sujet' },
  { fr: ['hommes'], en: 'men', cat: 'sujet', pluriel: true },
  { fr: ['fille', 'fillette'], en: 'girl', cat: 'sujet' },
  { fr: ['filles'], en: 'girls', cat: 'sujet', pluriel: true },
  { fr: ['garcon'], en: 'boy', cat: 'sujet' },
  { fr: ['garcons'], en: 'boys', cat: 'sujet', pluriel: true },
  { fr: ['enfant'], en: 'child', cat: 'sujet' },
  { fr: ['enfants'], en: 'children', cat: 'sujet', pluriel: true },
  { fr: ['bebe'], en: 'baby', cat: 'sujet' },
  { fr: ['ado', 'adolescent', 'adolescente'], en: 'teenager', cat: 'sujet' },
  { fr: ['ados', 'adolescents', 'adolescentes'], en: 'teenagers', cat: 'sujet', pluriel: true },
  { fr: ['couple'], en: 'couple', cat: 'sujet' },
  { fr: ['famille'], en: 'family', cat: 'sujet' },
  { fr: ['groupe', 'groupe de personnes', 'groupe d amis'], en: 'group of people', cat: 'sujet' },
  { fr: ['amis', 'amies'], en: 'friends', cat: 'sujet', pluriel: true },
  { fr: ['sportif', 'sportive', 'athlete'], en: 'athlete', cat: 'sujet' },
  { fr: ['sportifs', 'sportives', 'athletes'], en: 'athletes', cat: 'sujet', pluriel: true },
  { fr: ['coach', 'entraineur', 'entraineuse'], en: 'fitness coach', cat: 'sujet' },
  { fr: ['danseur', 'danseuse'], en: 'dancer', cat: 'sujet' },
  { fr: ['danseurs', 'danseuses'], en: 'dancers', cat: 'sujet', pluriel: true },
  { fr: ['coureur', 'coureuse'], en: 'runner', cat: 'sujet' },
  { fr: ['boxeur', 'boxeuse'], en: 'boxer', cat: 'sujet' },
  { fr: ['chanteur', 'chanteuse'], en: 'singer', cat: 'sujet' },
  { fr: ['personne'], en: 'person', cat: 'sujet' },
  { fr: ['gens', 'personnes'], en: 'people', cat: 'sujet', pluriel: true },
  { fr: ['grand mere', 'mamie'], en: 'grandmother', cat: 'sujet' },
  { fr: ['grand pere', 'papi'], en: 'grandfather', cat: 'sujet' },
  { fr: ['chien'], en: 'dog', cat: 'sujet' },
  { fr: ['chiens'], en: 'dogs', cat: 'sujet', pluriel: true },
  { fr: ['chat'], en: 'cat', cat: 'sujet' },
  { fr: ['chats'], en: 'cats', cat: 'sujet', pluriel: true },
  { fr: ['cheval'], en: 'horse', cat: 'sujet' },
  { fr: ['oiseau'], en: 'bird', cat: 'sujet' },

  // ── ACTIONS ── (formes conjuguees courantes ; « court » est traite a part)
  { fr: ['danse', 'danser', 'dansant', 'dansante', 'dansent', 'dansait', 'en train de danser', 'qui danse'], en: 'dancing', cat: 'action' },
  { fr: ['courir', 'courant', 'courent', 'en train de courir', 'qui court', 'fait un footing', 'fait son footing', 'fait du jogging'], en: 'running', cat: 'action' },
  { fr: ['sprinte', 'sprinter', 'sprintant'], en: 'sprinting', cat: 'action' },
  { fr: ['saute', 'sauter', 'sautant', 'sautent'], en: 'jumping', cat: 'action' },
  { fr: ['marcher', 'marchant', 'marchent'], en: 'walking', cat: 'action' },
  { fr: ['chante', 'chanter', 'chantant', 'chantent'], en: 'singing', cat: 'action' },
  { fr: ['rit', 'rire', 'riant', 'rient', 'eclate de rire'], en: 'laughing', cat: 'action' },
  { fr: ['sourit', 'sourire'], en: 'smiling', cat: 'action' },
  { fr: ['nage', 'nager', 'nageant', 'nagent'], en: 'swimming', cat: 'action' },
  { fr: ['mange', 'manger', 'mangeant', 'mangent'], en: 'eating', cat: 'action' },
  { fr: ['boit', 'boire', 'buvant', 'boivent'], en: 'drinking', cat: 'action' },
  { fr: ['lire', 'lisant', 'lisent'], en: 'reading', cat: 'action' },
  { fr: ['ecrit', 'ecrire', 'ecrivant'], en: 'writing', cat: 'action' },
  { fr: ['travaille', 'travailler', 'travaillant'], en: 'working', cat: 'action' },
  { fr: ['medite', 'mediter', 'meditant'], en: 'meditating', cat: 'action' },
  { fr: ['s entraine', 's entrainer', 's entrainant', 's entrainent'], en: 'working out', cat: 'action' },
  { fr: ['souleve des poids', 'soulever des poids', 'soulevant des poids', 'fait de la musculation', 'fait de la muscu'], en: 'lifting weights', cat: 'action' },
  { fr: ['fait du yoga', 'faisant du yoga', 'pratique le yoga'], en: 'doing yoga', cat: 'action' },
  { fr: ['fait du sport', 'faisant du sport'], en: 'exercising', cat: 'action' },
  { fr: ['fait du velo', 'faisant du velo', 'pedale', 'pedaler', 'pedalant'], en: 'cycling', cat: 'action' },
  { fr: ['boxe', 'boxer', 'boxant'], en: 'boxing', cat: 'action' },
  { fr: ['s etire', 's etirer', 's etirant'], en: 'stretching', cat: 'action' },
  { fr: ['cuisiner', 'cuisinant', 'cuisinent'], en: 'cooking', cat: 'action' },
  { fr: ['parle', 'parler', 'parlant', 'parlent'], en: 'talking', cat: 'action' },
  { fr: ['joue', 'jouer', 'jouant', 'jouent'], en: 'playing', cat: 'action' },
  { fr: ['pleure', 'pleurer', 'pleurant'], en: 'crying', cat: 'action' },
  { fr: ['dort', 'dormir', 'dormant'], en: 'sleeping', cat: 'action' },
  { fr: ['grimpe', 'grimper', 'escalade', 'escalader'], en: 'climbing', cat: 'action' },
  { fr: ['surfe', 'surfer', 'surfant'], en: 'surfing', cat: 'action' },
  { fr: ['skie', 'skier', 'skiant'], en: 'skiing', cat: 'action' },
  { fr: ['assis', 'assise', 'assises'], en: 'sitting', cat: 'action' },
  { fr: ['debout'], en: 'standing', cat: 'action' },
  { fr: ['allonge', 'allongee', 'couche', 'couchee'], en: 'lying down', cat: 'action' },
  { fr: ['applaudit', 'applaudir', 'applaudissant'], en: 'clapping', cat: 'action' },
  { fr: ['crie', 'crier', 'criant'], en: 'shouting', cat: 'action' },

  // ── OBJETS ──
  { fr: ['casque audio', 'casque de musique', 'casque'], en: 'headphones', cat: 'objet', pluriel: true },
  { fr: ['ecouteurs', 'oreillettes'], en: 'earbuds', cat: 'objet', pluriel: true },
  { fr: ['casque de velo', 'casque de moto'], en: 'helmet', cat: 'objet' },
  { fr: ['parapluie'], en: 'umbrella', cat: 'objet' },
  { fr: ['haltere'], en: 'dumbbell', cat: 'objet' },
  { fr: ['halteres'], en: 'dumbbells', cat: 'objet', pluriel: true },
  { fr: ['kettlebell'], en: 'kettlebell', cat: 'objet' },
  { fr: ['ballon de foot', 'ballon de football'], en: 'soccer ball', cat: 'objet' },
  { fr: ['ballon de basket', 'basket ball'], en: 'basketball', cat: 'objet' },
  { fr: ['ballon', 'balle'], en: 'ball', cat: 'objet' },
  { fr: ['velo'], en: 'bicycle', cat: 'objet' },
  { fr: ['tapis de yoga'], en: 'yoga mat', cat: 'objet' },
  { fr: ['tapis de course'], en: 'treadmill', cat: 'objet' },
  { fr: ['corde a sauter'], en: 'jump rope', cat: 'objet' },
  { fr: ['sac de frappe'], en: 'punching bag', cat: 'objet' },
  { fr: ['gants de boxe'], en: 'boxing gloves', cat: 'objet', pluriel: true },
  { fr: ['bouteille d eau', 'gourde'], en: 'water bottle', cat: 'objet' },
  { fr: ['bouteille'], en: 'bottle', cat: 'objet' },
  { fr: ['telephone', 'smartphone', 'portable'], en: 'smartphone', cat: 'objet' },
  { fr: ['micro', 'microphone'], en: 'microphone', cat: 'objet' },
  { fr: ['guitare'], en: 'guitar', cat: 'objet' },
  { fr: ['lunettes de soleil'], en: 'sunglasses', cat: 'objet', pluriel: true },
  { fr: ['lunettes'], en: 'glasses', cat: 'objet', pluriel: true },
  { fr: ['chapeau'], en: 'hat', cat: 'objet' },
  { fr: ['casquette'], en: 'cap', cat: 'objet' },
  { fr: ['sac a dos'], en: 'backpack', cat: 'objet' },
  { fr: ['sac'], en: 'bag', cat: 'objet' },
  { fr: ['livre'], en: 'book', cat: 'objet' },
  { fr: ['tasse de cafe'], en: 'cup of coffee', cat: 'objet' },
  { fr: ['tasse'], en: 'cup', cat: 'objet' },
  { fr: ['fleurs'], en: 'flowers', cat: 'objet', pluriel: true },
  { fr: ['fleur'], en: 'flower', cat: 'objet' },
  { fr: ['ordinateur portable', 'ordinateur', 'laptop'], en: 'laptop', cat: 'objet' },
  { fr: ['montre'], en: 'watch', cat: 'objet' },
  { fr: ['serviette'], en: 'towel', cat: 'objet' },
  { fr: ['baskets', 'sneakers'], en: 'sneakers', cat: 'objet', pluriel: true },
  { fr: ['chaussures'], en: 'shoes', cat: 'objet', pluriel: true },
  { fr: ['robe'], en: 'dress', cat: 'objet' },
  { fr: ['legging', 'leggings'], en: 'leggings', cat: 'objet', pluriel: true },
  { fr: ['brassiere', 'brassiere de sport'], en: 'sports bra', cat: 'objet' },
  { fr: ['t shirt', 'tee shirt', 'tshirt'], en: 't-shirt', cat: 'objet' },
  { fr: ['sweat', 'sweat a capuche', 'hoodie'], en: 'hoodie', cat: 'objet' },
  { fr: ['veste'], en: 'jacket', cat: 'objet' },
  { fr: ['voiture'], en: 'car', cat: 'objet' },
  { fr: ['skate', 'skateboard'], en: 'skateboard', cat: 'objet' },
  { fr: ['planche de surf'], en: 'surfboard', cat: 'objet' },
  { fr: ['raquette'], en: 'racket', cat: 'objet' },
  { fr: ['cable', 'cables', 'fil', 'fils'], en: 'cable', cat: 'objet' },
  { fr: ['texte', 'ecriture', 'lettres'], en: 'text', cat: 'objet' },
  { fr: ['logo'], en: 'logo', cat: 'objet' },

  // ── APPARENCE ── (etat visible, pas un adjectif de couleur)
  { fr: ['transpirant', 'transpirante', 'transpirants', 'transpirantes', 'en sueur', 'en nage', 'qui transpire', 'transpire', 'ruisselant de sueur', 'ruisselante de sueur'], en: 'sweating', cat: 'apparence' },
  { fr: ['muscle', 'musclee', 'muscles', 'musclees'], en: 'muscular', cat: 'apparence' },
  { fr: ['souriant', 'souriante', 'souriants', 'souriantes'], en: 'smiling', cat: 'apparence' },
  { fr: ['heureux', 'heureuse', 'joyeux', 'joyeuse'], en: 'happy', cat: 'apparence' },
  { fr: ['fatigue', 'fatiguee', 'epuise', 'epuisee'], en: 'tired', cat: 'apparence' },
  { fr: ['concentre', 'concentree'], en: 'focused', cat: 'apparence' },
  { fr: ['determine', 'determinee'], en: 'determined', cat: 'apparence' },
  { fr: ['energique', 'energiques'], en: 'energetic', cat: 'apparence' },
  { fr: ['mince', 'svelte'], en: 'slim', cat: 'apparence' },
  { fr: ['ronde', 'pulpeuse'], en: 'curvy', cat: 'apparence' },
  { fr: ['barbu'], en: 'bearded', cat: 'apparence' },
  { fr: ['chauve'], en: 'bald', cat: 'apparence' },
  { fr: ['tatoue', 'tatouee'], en: 'tattooed', cat: 'apparence' },
  { fr: ['cheveux longs'], en: 'long hair', cat: 'apparence' },
  { fr: ['cheveux courts'], en: 'short hair', cat: 'apparence' },
  { fr: ['cheveux boucles', 'cheveux frises', 'cheveux crepus'], en: 'curly hair', cat: 'apparence' },
  { fr: ['cheveux afro', 'coupe afro'], en: 'afro hair', cat: 'apparence' },
  { fr: ['tresses', 'nattes'], en: 'braids', cat: 'apparence' },
  { fr: ['dreadlocks', 'locks'], en: 'dreadlocks', cat: 'apparence' },

  // ── ADJECTIFS rattaches au nom qui precede (couleurs, origines, qualites) ──
  { fr: ['sans fil'], en: 'wireless', cat: 'adj', contrainte: 'no cable visible' },
  { fr: ['rouge', 'rouges'], en: 'red', cat: 'adj' },
  { fr: ['bleu', 'bleue', 'bleus', 'bleues'], en: 'blue', cat: 'adj' },
  { fr: ['vert', 'verte', 'verts', 'vertes'], en: 'green', cat: 'adj' },
  { fr: ['jaune', 'jaunes'], en: 'yellow', cat: 'adj' },
  { fr: ['noir', 'noire', 'noirs', 'noires'], en: 'black', cat: 'adj' },
  { fr: ['blanc', 'blanche', 'blancs', 'blanches'], en: 'white', cat: 'adj' },
  { fr: ['rose', 'roses'], en: 'pink', cat: 'adj' },
  { fr: ['violet', 'violette', 'violets', 'violettes'], en: 'purple', cat: 'adj' },
  { fr: ['orange', 'oranges'], en: 'orange', cat: 'adj' },
  { fr: ['gris', 'grise', 'grises'], en: 'grey', cat: 'adj' },
  { fr: ['marron', 'brun', 'brune', 'bruns', 'brunes'], en: 'brown', cat: 'adj' },
  { fr: ['dore', 'doree', 'dores', 'dorees'], en: 'golden', cat: 'adj' },
  { fr: ['argente', 'argentee'], en: 'silver', cat: 'adj' },
  { fr: ['turquoise'], en: 'turquoise', cat: 'adj' },
  { fr: ['asiatique', 'asiatiques'], en: 'asian', cat: 'adj' },
  { fr: ['africain', 'africaine', 'africains', 'africaines'], en: 'african', cat: 'adj' },
  { fr: ['europeen', 'europeenne'], en: 'european', cat: 'adj' },
  { fr: ['metisse', 'metis'], en: 'mixed-race', cat: 'adj' },
  { fr: ['indien', 'indienne'], en: 'indian', cat: 'adj' },
  { fr: ['arabe', 'maghrebin', 'maghrebine'], en: 'arab', cat: 'adj' },
  { fr: ['latino', 'latine'], en: 'latino', cat: 'adj' },
  { fr: ['jeune', 'jeunes'], en: 'young', cat: 'adj' },
  { fr: ['age', 'agee'], en: 'elderly', cat: 'adj' },
  { fr: ['petit', 'petite'], en: 'small', cat: 'adj' },
  { fr: ['moderne'], en: 'modern', cat: 'adj' },
  { fr: ['sombre'], en: 'dark', cat: 'adj' },
  { fr: ['lumineux', 'lumineuse'], en: 'bright', cat: 'adj' },
  { fr: ['neon', 'neons'], en: 'neon-lit', cat: 'adj' },

  // ── DECOR (lieux, meteo, moment) ──
  { fr: ['sous la pluie', 'sous une pluie battante'], en: 'in the rain', cat: 'decor', prep: '' },
  { fr: ['pluie', 'pluvieux'], en: 'rainy weather', cat: 'decor', prep: 'in' },
  { fr: ['sous la neige', 'neige'], en: 'in the snow', cat: 'decor', prep: '' },
  { fr: ['au soleil', 'en plein soleil', 'soleil'], en: 'in the sunshine', cat: 'decor', prep: '' },
  { fr: ['coucher de soleil', 'au coucher du soleil', 'coucher du soleil'], en: 'at sunset', cat: 'decor', prep: '' },
  { fr: ['lever de soleil', 'au lever du soleil', 'lever du soleil'], en: 'at sunrise', cat: 'decor', prep: '' },
  { fr: ['la nuit', 'de nuit', 'nuit'], en: 'at night', cat: 'decor', prep: '' },
  { fr: ['brouillard', 'brume'], en: 'in the fog', cat: 'decor', prep: '' },
  { fr: ['orage'], en: 'stormy weather', cat: 'decor', prep: 'in' },
  { fr: ['salle de sport', 'salle de musculation', 'salle de fitness', 'gym', 'gymnase'], en: 'gym', cat: 'decor' },
  { fr: ['plage'], en: 'beach', cat: 'decor', prep: 'on a' },
  { fr: ['foret'], en: 'forest', cat: 'decor' },
  { fr: ['parc'], en: 'park', cat: 'decor' },
  { fr: ['rue', 'rues'], en: 'street', cat: 'decor', prep: 'in the' },
  { fr: ['ville', 'en ville'], en: 'city', cat: 'decor', prep: 'in the' },
  { fr: ['montagne', 'montagnes'], en: 'mountains', cat: 'decor', prep: 'in the' },
  { fr: ['studio'], en: 'studio', cat: 'decor' },
  { fr: ['cuisine'], en: 'kitchen', cat: 'decor' },
  { fr: ['bureau'], en: 'office', cat: 'decor' },
  { fr: ['maison', 'a la maison'], en: 'home', cat: 'decor', prep: 'at' },
  { fr: ['salon'], en: 'living room', cat: 'decor' },
  { fr: ['piscine'], en: 'swimming pool', cat: 'decor' },
  { fr: ['stade'], en: 'stadium', cat: 'decor' },
  { fr: ['desert'], en: 'desert', cat: 'decor', prep: 'in the' },
  { fr: ['lac'], en: 'lake', cat: 'decor', prep: 'by a' },
  { fr: ['mer', 'ocean'], en: 'sea', cat: 'decor', prep: 'by the' },
  { fr: ['jardin'], en: 'garden', cat: 'decor' },
  { fr: ['toit', 'rooftop'], en: 'rooftop', cat: 'decor', prep: 'on a' },
  { fr: ['scene'], en: 'stage', cat: 'decor', prep: 'on a' },
  { fr: ['boite de nuit', 'discotheque', 'club'], en: 'nightclub', cat: 'decor' },
  { fr: ['piste de danse'], en: 'dance floor', cat: 'decor', prep: 'on a' },

  // ── STYLE demande par l'utilisateur ──
  { fr: ['noir et blanc', 'en noir et blanc'], en: 'black and white photography', cat: 'style' },
  { fr: ['cinematique', 'style cinema'], en: 'cinematic', cat: 'style' },
  { fr: ['realiste', 'photo realiste', 'photorealiste', 'hyperrealiste'], en: 'photorealistic', cat: 'style' },
  { fr: ['dessin anime', 'cartoon'], en: 'cartoon style', cat: 'style' },
  { fr: ['illustration', 'dessin'], en: 'illustration', cat: 'style' },
  { fr: ['aquarelle'], en: 'watercolor painting', cat: 'style' },
  { fr: ['manga', 'anime'], en: 'anime style', cat: 'style' },
  { fr: ['3d', 'rendu 3d'], en: '3D render', cat: 'style' },
  { fr: ['vintage', 'retro'], en: 'vintage look', cat: 'style' },
  { fr: ['minimaliste'], en: 'minimalist', cat: 'style' },
  { fr: ['ralenti', 'au ralenti'], en: 'slow-motion feel', cat: 'style' },
];

/** Styles non photographiques : on n'y ajoute pas « photorealistic ». */
const STYLES_NON_PHOTO = new Set(['cartoon style', 'illustration', 'watercolor painting', 'anime style', '3D render']);

/** Mots-outils ignores (sans casser le rattachement d'un adjectif). */
const MOTS_OUTILS = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'a',
  'avec', 'et', 'en', 'dans', 'sur', 'sous', 'son', 'sa', 'ses', 'qui', 'tres',
  'il', 'elle', 'ils', 'elles', 'portant', 'porte', 'tenant', 'tient', 'ou', 'pendant',
]);

/** Enrichissement — AJOUTS seulement, jamais de substitution. */
const ENRICHISSEMENT_ACTION = ['full body', 'dynamic pose', 'motion visible', 'cinematic lighting', 'high detail'];
const ENRICHISSEMENT_SUJET = ['natural candid pose', 'cinematic lighting', 'high detail'];
const ENRICHISSEMENT_FOND = ['high quality', 'professional background', 'high detail'];

// ═══════════════════════════════════════════════════════════════════════════
// Analyse
// ═══════════════════════════════════════════════════════════════════════════

/** Minuscules, accents retires, apostrophes/tirets/ponctuation → espaces. */
export function normaliserFr(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`\-]/g, ' ')
    .replace(/[^a-z0-9\s,.;:!?]/g, ' ')
    .replace(/([,.;:!?])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface LocutionIndexee { mots: string[]; entree: EntreeLexique }

/** Index des locutions par premier mot, trie de la plus longue a la plus courte. */
const INDEX: Map<string, LocutionIndexee[]> = (() => {
  const m = new Map<string, LocutionIndexee[]>();
  for (const entree of LEXIQUE) {
    for (const fr of entree.fr) {
      const mots = fr.split(' ');
      const liste = m.get(mots[0]) ?? [];
      liste.push({ mots, entree });
      m.set(mots[0], liste);
    }
  }
  for (const liste of Array.from(m.values())) liste.sort((a, b) => b.mots.length - a.mots.length);
  return m;
})();

const PONCTUATION = new Set([',', '.', ';', ':', '!', '?']);

interface Nom { cat: 'sujet' | 'objet' | 'decor'; en: string; adjs: string[]; pluriel: boolean; prep?: string }

const ajouterUnique = (liste: string[], valeur: string) => {
  if (!liste.includes(valeur)) liste.push(valeur);
};

/**
 * Analyse la consigne et rend sa structure. PURE et DETERMINISTE : meme
 * texte → meme structure (Regenerer ne change que la composition, via la
 * graine aleatoire du fournisseur).
 */
export function analyserPromptImage(texte: string): StructurePromptImage {
  return analyser(texte).structure;
}

interface Analyse {
  structure: StructurePromptImage;
  /** Par sujet / objet : pluriel anglais (pas d'article « a »). */
  sujetsPluriels: boolean[];
  objetsPluriels: boolean[];
}

/** Mots-sujets qui, juste apres un sujet, le qualifient (« coach sportive »). */
const SUJET_EN_ADJECTIF: Record<string, string> = {
  sportif: 'athletic', sportive: 'athletic', sportifs: 'athletic', sportives: 'athletic',
};

function analyser(texte: string): Analyse {
  const original = (texte ?? '').trim();
  const mots = normaliserFr(original).split(' ').filter(Boolean);

  const sujets: Nom[] = [];
  const objets: Nom[] = [];
  const decors: Nom[] = [];
  const action: string[] = [];
  const apparence: string[] = [];
  const contraintes: string[] = [];
  const styleUtilisateur: string[] = [];

  /** Dernier nom auquel un adjectif postpose peut se rattacher. */
  let nomCourant: Nom | null = null;
  /** « sans » vient d'etre lu : le prochain objet devient une contrainte. */
  let negation = false;

  let i = 0;
  while (i < mots.length) {
    const mot = mots[i];

    if (PONCTUATION.has(mot)) { nomCourant = null; negation = false; i++; continue; }

    // Locution la plus longue commencant ici.
    let trouve: LocutionIndexee | null = null;
    for (const cand of INDEX.get(mot) ?? []) {
      if (cand.mots.every((m, k) => mots[i + k] === m)) { trouve = cand; break; }
    }

    // « court » : verbe (« il court ») juste apres un sujet, adjectif sinon.
    if (!trouve && (mot === 'court' || mot === 'courte' || mot === 'courts' || mot === 'courtes')) {
      if (mot === 'court' && nomCourant?.cat === 'sujet') {
        ajouterUnique(action, 'running');
        nomCourant = null;
      } else if (nomCourant) {
        nomCourant.adjs.push('short');
      } else {
        ajouterUnique(apparence, 'short');
      }
      i++;
      continue;
    }
    // « marche » : verbe apres un sujet (« elle marche »), sinon le lieu.
    if (!trouve && mot === 'marche') {
      if (nomCourant?.cat === 'sujet') ajouterUnique(action, 'walking');
      else decors.push({ cat: 'decor', en: 'market', adjs: [], pluriel: false, prep: 'in a' });
      nomCourant = null;
      i++;
      continue;
    }

    if (!trouve) {
      if (mot === 'sans') { negation = true; i++; continue; }
      if (MOTS_OUTILS.has(mot)) { i++; continue; }
      // Mot inconnu : il reste dans le texte original recopie, rien n'est perdu.
      nomCourant = null;
      i++;
      continue;
    }

    const { entree } = trouve;
    i += trouve.mots.length;

    if (entree.cat === 'sujet' && nomCourant?.cat === 'sujet' && trouve.mots.length === 1 && SUJET_EN_ADJECTIF[mot]) {
      const adj = SUJET_EN_ADJECTIF[mot];
      if (!nomCourant.adjs.includes(adj)) nomCourant.adjs.push(adj);
      continue;
    }

    switch (entree.cat) {
      case 'sujet':
      case 'objet':
      case 'decor': {
        const nom: Nom = { cat: entree.cat, en: entree.en, adjs: [], pluriel: !!entree.pluriel, prep: entree.prep };
        if (negation && entree.cat === 'objet') {
          ajouterUnique(contraintes, `no ${entree.en}`);
          negation = false;
          nomCourant = null;
          break;
        }
        negation = false;
        const cible = entree.cat === 'sujet' ? sujets : entree.cat === 'objet' ? objets : decors;
        const existant = cible.find((n) => n.en === nom.en);
        if (existant) { nomCourant = existant; break; }
        cible.push(nom);
        nomCourant = nom;
        break;
      }
      case 'adj': {
        if (entree.contrainte) ajouterUnique(contraintes, entree.contrainte);
        if (nomCourant) {
          if (!nomCourant.adjs.includes(entree.en)) nomCourant.adjs.push(entree.en);
        } else {
          ajouterUnique(apparence, entree.en);
        }
        negation = false;
        break;
      }
      case 'apparence':
        ajouterUnique(apparence, entree.en);
        negation = false;
        // Le nom courant reste ouvert : « femme transpirante noire ».
        break;
      case 'action':
        ajouterUnique(action, entree.en);
        negation = false;
        nomCourant = null;
        break;
      case 'style':
        ajouterUnique(styleUtilisateur, entree.en);
        negation = false;
        nomCourant = null;
        break;
    }
  }

  const nomEn = (n: Nom) => [...n.adjs, n.en].join(' ');
  const sujet = sujets.map(nomEn);
  // Un etat deja dit comme action (« sourit ») n'est pas repete en apparence.
  const apparenceFiltree = apparence.filter((a) => !action.includes(a));

  // Enrichissement : ajouts seulement.
  const style = [...styleUtilisateur];
  const nonPhoto = styleUtilisateur.some((s) => STYLES_NON_PHOTO.has(s));
  const enrichissement = action.length > 0
    ? ENRICHISSEMENT_ACTION
    : sujet.length > 0 ? ENRICHISSEMENT_SUJET : ENRICHISSEMENT_FOND;
  if (!nonPhoto && (action.length > 0 || sujet.length > 0)) ajouterUnique(style, 'photorealistic');
  for (const e of enrichissement) ajouterUnique(style, e);

  const structure: StructurePromptImage = {
    sujet,
    action,
    objets: objets.map(nomEn),
    apparence: apparenceFiltree,
    // Avec un sujet ou une action, le decor est un complement de lieu
    // (« on a beach ») ; seul, c'est le fond lui-meme (« neon-lit gym »).
    decor: decors.map((d) => {
      const base = nomEn(d);
      const prep = d.prep ?? 'in a';
      return prep && (sujet.length > 0 || action.length > 0) ? `${prep} ${base}` : base;
    }),
    contraintes,
    style,
    original,
  };
  return {
    structure,
    sujetsPluriels: sujets.map((n) => n.pluriel),
    objetsPluriels: objets.map((n) => n.pluriel),
  };
}

const article = (x: string) => `${/^[aeiou]/i.test(x) ? 'an' : 'a'} ${x}`;

/** Assemble la description anglaise (sans style ni texte original). */
function phraseAnglaise({ structure: s, sujetsPluriels, objetsPluriels }: Analyse): string {
  const morceaux: string[] = [];
  const sujetTexte = s.sujet.map((x, k) => (sujetsPluriels[k] ? x : article(x))).join(' and ');
  const tete = [sujetTexte, s.action.join(' and ')].filter(Boolean).join(' ');
  if (tete) morceaux.push(tete);
  morceaux.push(...s.apparence);
  if (s.objets.length) {
    morceaux.push(`with ${s.objets.map((x, k) => (objetsPluriels[k] ? x : article(x))).join(' and ')}`);
  }
  morceaux.push(...s.decor);
  morceaux.push(...s.contraintes);
  return morceaux.join(', ');
}

/**
 * Construit le prompt envoye au fournisseur : description anglaise
 * structuree d'abord (les premiers mots pesent le plus), enrichissement
 * ensuite, texte original recopie a la fin.
 *
 * `mode: 'reference'` (« Partir de ma photo », flux-kontext-pro) ajoute la
 * consigne de garder le visage et l'identite de la photo, tout en appliquant
 * la pose, l'action, les objets et le decor demandes.
 */
export function construirePromptImage(
  texte: string,
  options: { mode?: 'texte' | 'reference' } = {},
): PromptImageConstruit {
  const analyse = analyser(texte);
  const { structure } = analyse;
  const description = phraseAnglaise(analyse);
  const parties: string[] = [];
  if (description) parties.push(description);
  parties.push(structure.style.join(', '));
  let corps = parties.join(', ');
  if (options.mode === 'reference') {
    corps = `Using the person from the input image (keep the same face and identity): ${corps}. Apply the described pose, action, objects and setting`;
  } else {
    corps = corps.charAt(0).toUpperCase() + corps.slice(1);
  }
  const promptFinal = `${corps}. Original request (French): « ${structure.original} »`;
  return { structure, promptFinal };
}
