/**
 * M3-H — LE CONTRAT DU RENDU : CE QUI SERA EXÉCUTÉ, ET RIEN QUI SOIT DÉCIDÉ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ M3-G DÉCIDE, M3-H EXÉCUTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tout ce qui relève du montage — quels clips, dans quel ordre, combien de
 * temps chacun, avec quel recadrage, avec quelle transition, vers quel format
 * et quelle cadence — est DÉJÀ décidé et persisté dans `rush_montage_plans`.
 * M3-H lit ce plan et le rend littéralement.
 *
 * Ce module ne porte donc AUCUNE décision éditoriale. Il ne contient ni
 * tolérance de coupe, ni heuristique de recadrage, ni règle de durée : les
 * chercher ici serait le signe qu'une décision de M3-G a été refaite.
 *
 * Ce qu'il fixe, ce sont les paramètres d'EXÉCUTION : comment les octets
 * seront produits, dans quelles bornes de temps et de taille, sous quelle
 * clé, et à quelles conditions le résultat sera reconnu conforme.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE CONTIENDRA JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun crédit, aucun fournisseur, aucun modèle de langage, aucun accès à
 * `render_jobs`, `rendus` ou `videos`, aucune URL persistée, aucun titre,
 * CTA, logo, sous-titre, musique ni effet. Le rendu est du calcul local sur
 * des octets déjà produits par M3-F.
 */
import { createHash } from 'crypto';
import {
  RECETTE_AUDIO_DEFAUT, estRecetteHistorique, recetteCanonique, type RecetteAudio,
} from './recette-audio';
import {
  estProfilHistorique, profilCreatifCanonique,
  type ProfilCreatifAutopilote, type ProfilCreatifPartiel,
} from './profil-creatif';
import {
  AUDIO_BITRATE, AUDIO_FREQUENCE, CLIP_OCTETS_MAX, CONTENT_TYPE,
  CRF, PIXEL_FORMAT, PRESET, TIMEOUT_TELEVERSEMENT_MS as TIMEOUT_TELEVERSEMENT_CLIP_MS,
  arrondirSeconde, nombreFini,
} from './clip-contrat';
import { DUREE_CIBLE_MAX_SECONDES, PLANS_MAX } from './montage-contrat';

// ───────────────────────────────────────────────────────────────────────────
// L'identité de la méthode
// ───────────────────────────────────────────────────────────────────────────

/**
 * Comment les OCTETS FINAUX sont produits.
 *
 * Le pendant de `METHODE_MATERIALISATION` ('x264-crf23-v1') de M3-F, et la
 * quatrième question distincte de la chaîne : « où couper » (`m3e-v1`),
 * « comment encoder les clips » (`x264-crf23-v1`), « comment monter »
 * (`m3g-v1`), et maintenant « comment produire le fichier final ».
 *
 * ⚠️ LES MÊMES PARAMÈTRES QUE M3-F, CRF COMPRIS — ET C'EST UNE MESURE QUI LE
 * DIT, PAS UNE PRÉFÉRENCE.
 *
 * Une première rédaction de ce contrat fixait CRF 20, au motif qu'un second
 * encodage empile la perte du premier. L'argument est courant, mais le dépôt
 * porte déjà la mesure qui le tranche, sur ce rush et à cette résolution :
 * « 23,6 Mo en CRF 23 contre 33,0 Mo en CRF 20 — trente pour cent de moins,
 * pour une différence INVISIBLE à 1080p » (`clip-contrat.ts`). Descendre à 20
 * aurait donc coûté quarante pour cent de poids pour un gain que la mesure
 * dit invisible.
 *
 * Le nom reste DISTINCT de celui de M3-F malgré des paramètres identiques :
 * les deux méthodes vivent dans deux colonnes différentes et décrivent deux
 * opérations différentes — découper un rush, et concaténer des clips en les
 * recadrant. Les confondre rendrait impossible de dire, devant un fichier,
 * laquelle des deux a changé.
 *
 * Si une mesure ultérieure — sur du matériel plus exigeant, ou sur une
 * troisième génération — montrait qu'un autre facteur s'impose, elle donnera
 * `x264-crf<n>-concat-v2`, et les rendus produits sous v1 ne seront pas
 * réutilisés à tort. Cette optimisation appartient à une mesure séparée, pas
 * à ce contrat.
 */
export const METHODE_RENDU = 'x264-crf23-concat-v1' as const;

/**
 * LE PREFIXE DES RENDUS QUI PORTENT UNE RECETTE AUDIO.
 *
 * `methode_rendu` est un `text` borne a 40 caracteres par la migration, et il
 * fait partie de `rush_montage_renders_reussi_unique`. C'est donc LE champ qui
 * distingue deux materialisations du meme plan — et le seul disponible sans
 * migration.
 */
export const PREFIXE_METHODE_MIX = 'x264-mix-v1-' as const;

/**
 * LOT 2B — LE PREFIXE DES RENDUS QUI PORTENT UN PROFIL CREATIF.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN TROISIEME PREFIXE, ET NON UNE EXTENSION DU SECOND
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `x264-mix-v1-<empreinte>` designe une empreinte calculee sur la SEULE
 * recette audio. Y glisser le profil creatif changerait la valeur rendue pour
 * des recettes audio inchangees : tous les rendus deja reussis deviendraient
 * introuvables, seraient recalcules, et seraient refactures. Un prefixe
 * distinct laisse le passe strictement intact.
 *
 * Trois cas, et un seul est nouveau :
 *
 *   1. ni audio ni profil -> `METHODE_RENDU`            (inchange)
 *   2. audio seul         -> `x264-mix-v1-<h(audio)>`   (inchange, au bit pres)
 *   3. profil present     -> `x264-pc-v1-<h(audio+profil)>`
 *
 * ⚠️ ONZE CARACTERES, ET C'EST MESURE. `methode_rendu` est un `text` borne a
 * 40 par la migration, et il fait partie de
 * `rush_montage_renders_reussi_unique`. 11 + 24 = 35 : la marge est de cinq
 * caracteres, et un test la garde. Un prefixe plus bavard ferait echouer
 * l'insertion, pas la validation — c'est-a-dire en production, au moment de
 * televerser un rendu deja calcule.
 */
export const PREFIXE_METHODE_PROFIL = 'x264-pc-v1-' as const;

/** La borne de la colonne, recopiee de la migration. Gardee par un test. */
export const LONGUEUR_METHODE_RENDU_MAX = 40;

/**
 * La longueur de l'empreinte, en caracteres hexadecimaux.
 *
 * 12 caracteres de prefixe + 24 d'empreinte = 36, sous la borne de 40. Vingt-
 * quatre caracteres font 96 bits : une collision n'est pas un risque a
 * l'echelle d'un compte, et une collision signifierait seulement qu'un rendu
 * est reutilise pour une recette voisine.
 */
export const LONGUEUR_EMPREINTE = 24;

export function empreinteRecette(recette: RecetteAudio): string {
  return createHash('sha256')
    .update(recetteCanonique(recette), 'utf8')
    .digest('hex')
    .slice(0, LONGUEUR_EMPREINTE);
}

/**
 * La methode de rendu d'une recette — l'identite qui evite la panne muette.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI CE N'EST PAS UNE CONSTANTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La reutilisation d'un rendu reussi est STRUCTURELLE : l'index unique refuse
 * le second, l'appelant relit le premier. Si la recette ne changeait pas
 * `methode_rendu`, demander la meme video avec une autre musique rendrait
 * L'ANCIEN FICHIER — sans erreur, sans message. C'est la meme panne
 * silencieuse que celle des coupes rejouees, et elle se rejouerait ici.
 *
 * ⚠️ ET POURQUOI LA RECETTE HISTORIQUE GARDE L'ANCIENNE VALEUR. Une recette
 * qui ne demande rien de plus que le comportement d'avant ce lot — le son des
 * rushes, sans attenuation, sans musique — rend `METHODE_RENDU`. Le graphe
 * emis est alors lui aussi l'ancien, au caractere pres : les rendus deja
 * reussis restent donc reutilisables, et ce lot ne transforme pas tout le
 * passe en travail a refaire.
 */
export function methodeRendu(
  recette: RecetteAudio | null | undefined,
  profil?: ProfilCreatifPartiel | ProfilCreatifAutopilote | null,
): string {
  // ⚠️ LE PROFIL D'ABORD. Un profil qui demande quelque chose l'emporte, meme
  // sur une recette audio historique : sinon une video sans musique mais avec
  // un CTA rendrait `METHODE_RENDU`, c'est-a-dire le fichier d'avant.
  if (!estProfilHistorique(profil)) {
    return `${PREFIXE_METHODE_PROFIL}${empreinteRenduComplet(recette, profil)}`;
  }
  if (estRecetteHistorique(recette)) return METHODE_RENDU;
  return `${PREFIXE_METHODE_MIX}${empreinteRecette(recette as RecetteAudio)}`;
}

/**
 * L'empreinte d'un rendu COMPLET — le son ET le style.
 *
 * ⚠️ UNE SEULE EMPREINTE POUR LES DEUX, ET NON DEUX CONCATENEES. La colonne
 * n'a la place que d'une : 11 caracteres de prefixe et 24 d'empreinte. Hacher
 * la concatenation des deux formes canoniques donne une valeur qui change des
 * qu'UN des deux change, ce qui est exactement la garantie recherchee.
 *
 * ⚠️ LE SEPARATEUR EST OBLIGATOIRE. Sans lui, deux decoupages differents des
 * memes caracteres — une cle de musique se terminant par ce que le profil
 * commence — rendraient la meme empreinte pour deux rendus differents.
 */
export function empreinteRenduComplet(
  recette: RecetteAudio | null | undefined,
  profil: ProfilCreatifPartiel | ProfilCreatifAutopilote | null | undefined,
): string {
  const audio = recetteCanonique(recette ?? RECETTE_AUDIO_DEFAUT);
  const style = profilCreatifCanonique(profil);
  return createHash('sha256')
    .update(`${audio}\n--\n${style}`, 'utf8')
    .digest('hex')
    .slice(0, LONGUEUR_EMPREINTE);
}

/** Repris de M3-F : la mesure du dépôt écarte explicitement CRF 20. */
export const CRF_RENDU = CRF;

/** Repris de M3-F sans changement : les clips en sortent. */
export const PRESET_RENDU = PRESET;
export const PIXEL_FORMAT_RENDU = PIXEL_FORMAT;
export const AUDIO_BITRATE_RENDU = AUDIO_BITRATE;
export const AUDIO_FREQUENCE_RENDU = AUDIO_FREQUENCE;
export const CONTENT_TYPE_RENDU = CONTENT_TYPE;

/** Le compartiment du montage final. Jamais choisi par le client. */
export const BUCKET_RENDUS_MONTAGE = 'videos';

// ───────────────────────────────────────────────────────────────────────────
// Les bornes — toutes DÉRIVÉES, aucune choisie
// ───────────────────────────────────────────────────────────────────────────

/**
 * La durée finale qu'un plan peut demander.
 *
 * Reprise de M3-G, et non redéclarée : un plan ne peut pas viser plus long
 * que ce que son propre contrat autorise. En écrire une autre valeur ici
 * créerait deux plafonds qui divergeraient au premier ajustement.
 */
export const DUREE_RENDU_MAX_SECONDES = DUREE_CIBLE_MAX_SECONDES;

/** Autant de sources que M3-G peut retenir de plans. */
export const SOURCES_MAX = PLANS_MAX;

/**
 * Le poids du fichier final, plafonné.
 *
 * ⚠️ EXTRAPOLÉ D'UNE MESURE, PAS CHOISI. M3-F a produit 23 504 275 octets
 * pour 26,934 s de vidéo 1080p à CRF 23, soit environ 0,87 Mo par seconde.
 * M3-H encode aux mêmes paramètres : le débit attendu est le même. Au pire
 * cas de `DUREE_RENDU_MAX_SECONDES` (120 s), cela donne ~105 Mo.
 *
 * Le plafond retenu est le double de cette extrapolation : une scène très
 * détaillée ou très mouvementée peut dépasser la moyenne d'un rush de
 * démonstration, et un plafond trop serré transformerait une vidéo
 * parfaitement valide en `resultat_invalide`.
 */
export const OCTETS_PAR_SECONDE_ESTIMES = Math.ceil(23_504_275 / 26.934);
export const RENDU_OCTETS_MAX =
  2 * OCTETS_PAR_SECONDE_ESTIMES * DUREE_RENDU_MAX_SECONDES;

/**
 * Le disque temporaire d'un rendu entier.
 *
 * Les sources téléchargées plus la sortie. Rien d'autre ne descend sur le
 * disque, et le répertoire est supprimé dans un `finally` dont l'échec sera
 * RENDU, jamais avalé — la leçon de M3-D2, reprise en M3-F.
 */
export const ESPACE_TEMPORAIRE_MAX_OCTETS =
  SOURCES_MAX * CLIP_OCTETS_MAX + RENDU_OCTETS_MAX;

/**
 * Le temps accordé au téléchargement d'UN clip.
 *
 * Repris de la borne de téléversement de M3-F : même stockage, même réseau,
 * même plafond de 64 Mio par objet. Ce n'est pas une recopie de confort —
 * c'est la même opération, dans l'autre sens, sur le même service.
 */
export const TIMEOUT_TRANSFERT_SOURCE_MS = TIMEOUT_TELEVERSEMENT_CLIP_MS;

/**
 * Le temps accordé au téléversement du fichier FINAL.
 *
 * Dérivé de la borne de M3-F par le rapport des tailles : elle accorde 60 s
 * pour 64 Mio, soit un débit plancher garanti d'environ 1,07 Mio/s. Le même
 * plancher appliqué à `RENDU_OCTETS_MAX` donne la valeur ci-dessous. Garder
 * 60 s pour un fichier quatre fois plus gros aurait coupé un téléversement
 * parfaitement sain.
 */
export const TIMEOUT_TELEVERSEMENT_RENDU_MS = Math.ceil(
  TIMEOUT_TELEVERSEMENT_CLIP_MS * (RENDU_OCTETS_MAX / CLIP_OCTETS_MAX),
);

/**
 * La taille de partie du client de stockage, et le nombre de parties.
 *
 * ⚠️ LE DÉLAI DE TÉLÉVERSEMENT EST PAR REQUÊTE, PAS PAR ENVOI. Le SDK découpe
 * tout objet plus gros que sa taille de partie en un envoi multiple : une
 * initialisation, N parties, un assemblage. La borne du transport s'applique à
 * CHACUNE. Ne compter qu'un délai dans le budget rendait de nouveau fausse
 * l'affirmation « aucun travail ne peut le dépasser » — un téléversement
 * parfaitement sain pouvait être déclaré abandonné en cours de route.
 */
export const OCTETS_PAR_PARTIE = 64 * 1024 * 1024;
export const PARTIES_TELEVERSEMENT = Math.max(
  1, Math.ceil(RENDU_OCTETS_MAX / OCTETS_PAR_PARTIE),
);

/** Une sonde `ffprobe` sur un fichier local. Elle lit l'en-tête, rien de plus. */
export const TIMEOUT_MESURE_MS = 30_000;

/** Signature des sources, ouverture du répertoire, lecture du plan. */
export const AMORCE_RENDU_MS = 10_000;

/**
 * Le facteur de temps réel accordé à l'encodage.
 *
 * ⚠️ ÉTALONNÉ SUR UNE MESURE RÉELLE. M3-F a produit 26,934 s de vidéo en
 * 38 201 ms sur les quatre cœurs du serveur — téléchargement, cinq
 * encodages et cinq téléversements COMPRIS — soit environ 1,42 fois le temps
 * réel pour la boucle entière.
 *
 * Six fois le temps réel laisse donc plus de quatre fois la marge observée.
 * C'est délibéré : la mesure vient d'un serveur au repos, et l'encodage de
 * M3-H monte vers 1080×1920 depuis un recadrage, ce qui est plus coûteux par
 * seconde qu'une simple recompression.
 */
export const FACTEUR_ENCODAGE = 6;

/** Le plancher : un rendu d'une seconde a quand même besoin de démarrer x264. */
export const TIMEOUT_ENCODAGE_MIN_MS = 60_000;

/**
 * Le temps accordé à l'unique passage ffmpeg, pour une durée finale donnée.
 *
 * Fonction de la durée, et non constante : accorder à un montage de cinq
 * secondes le délai d'un montage de deux minutes retarderait de plusieurs
 * minutes le diagnostic d'un encodage bloqué.
 */
export function timeoutEncodage(dureeSecondes: number): number {
  const duree = nombreFini(dureeSecondes);
  if (duree === null || duree <= 0) return TIMEOUT_ENCODAGE_MIN_MS;
  return Math.max(
    TIMEOUT_ENCODAGE_MIN_MS,
    Math.ceil(duree * FACTEUR_ENCODAGE) * 1000,
  );
}

/**
 * Le pire cas d'un rendu complet, en millisecondes. Calculé, jamais choisi.
 *
 * Amorce, puis le téléchargement de chaque source, puis l'unique encodage,
 * puis la mesure, puis le téléversement. C'est cette somme que la péremption
 * doit franchement dépasser.
 */
export function budgetRendu(dureeSecondes: number): number {
  return AMORCE_RENDU_MS
    + SOURCES_MAX * TIMEOUT_TRANSFERT_SOURCE_MS
    // ⚠️ UNE SONDE PAR SOURCE, ET NON UNE SEULE MESURE.
    //
    // Une première rédaction ne comptait que la mesure du fichier final.
    // L'exécution sonde AUSSI chaque source — pour savoir si elle porte de
    // l'audio, et pour vérifier que ses dimensions décodées sont bien celles
    // du plan. Six sondes de plus font trois minutes que le budget ignorait,
    // et l'affirmation « aucun travail ne peut dépasser ce budget » devenait
    // fausse : la marge de péremption les absorbait en silence.
    + (SOURCES_MAX + 1) * TIMEOUT_MESURE_MS
    + timeoutEncodage(dureeSecondes)
    + PARTIES_TELEVERSEMENT * TIMEOUT_TELEVERSEMENT_RENDU_MS;
}

/** Le pire cas absolu : la durée la plus longue qu'un plan puisse demander. */
export const BUDGET_RENDU_MAX_MS = budgetRendu(DUREE_RENDU_MAX_SECONDES);

/**
 * La marge accordée au-delà du pire cas mesurable.
 *
 * Cinq minutes : de quoi absorber une machine chargée par un autre travail,
 * la contention disque d'un téléchargement concurrent, et l'écart entre
 * l'horloge du serveur et celle de la base. Elle n'a pas à couvrir un
 * travail plus long — aucun ne peut dépasser `BUDGET_RENDU_MAX_MS`, chaque
 * étape étant bornée.
 */
export const MARGE_PEREMPTION_MS = 300_000;

/**
 * Au bout de combien de temps un rendu actif est réputé abandonné.
 *
 * ⚠️ CALCULÉE DEPUIS LE BUDGET, ET NON RECOPIÉE DE M3-F. La péremption de
 * M3-F vaut trente minutes parce que SON pire cas vaut dix-huit ; celui de
 * M3-H est différent, et lui emprunter sa valeur aurait été un nombre sans
 * rapport avec le travail qu'il protège.
 *
 * En dessous du seuil, un rendu actif est PROTÉGÉ : le fermer ferait repartir
 * un second ffmpeg pendant le premier. Au-delà, la ligne est fermée, sans
 * quoi un processus tué au mauvais moment rendrait le plan définitivement
 * impossible à rendre — le piège s'est présenté sur `rush_analyses`, puis sur
 * `rush_candidate_sets`, puis sur `rush_transcriptions`, puis sur
 * `rush_clip_sets`.
 */
export const PEREMPTION_RENDU_MS = BUDGET_RENDU_MAX_MS + MARGE_PEREMPTION_MS;

/**
 * La durée de vie des URL signées des SOURCES.
 *
 * ⚠️ ELLE NE SUIT PAS LA PÉREMPTION, ET C'EST VOULU. Les signatures ne
 * servent qu'à la phase de téléchargement : les clips descendent tous
 * d'abord, puis ffmpeg travaille sur des fichiers locaux. Les faire vivre
 * aussi longtemps que le rendu entier prolongerait un accès au stockage
 * pendant vingt minutes où plus rien ne l'utilise.
 *
 * Elle couvre donc exactement `BUDGET_PHASE_SOURCE_MS` — l'amorce et les six
 * téléchargements — plus la même marge que la péremption. Dérivée, comme tout
 * le reste.
 *
 * ⚠️ CETTE VALEUR SUPPOSE UNE CONCEPTION, ET H3 DOIT LA TENIR : les sources
 * descendent TOUTES d'abord, puis ffmpeg travaille sur des fichiers locaux.
 * Le jour où l'on donnerait les URL signées directement à ffmpeg
 * (`-i <url>`), les signatures devraient survivre à tout l'encodage — jusqu'à
 * douze minutes de plus — et cette TTL deviendrait trop courte : les
 * dernières lectures échoueraient en `clip_illisible`, un diagnostic FAUX
 * pour une signature périmée. C'est exactement le piège que la revue de M3-F
 * avait attrapé sur `TTL_URL_SECONDES`. Le nom `BUDGET_PHASE_SOURCE_MS` rend
 * l'hypothèse visible plutôt que tacite.
 */
export const BUDGET_PHASE_SOURCE_MS =
  AMORCE_RENDU_MS + SOURCES_MAX * TIMEOUT_TRANSFERT_SOURCE_MS;

export const TTL_SOURCE_RENDU_SECONDES = Math.ceil(
  (BUDGET_PHASE_SOURCE_MS + MARGE_PEREMPTION_MS) / 1000,
);

// ───────────────────────────────────────────────────────────────────────────
// Les tolérances de validation
// ───────────────────────────────────────────────────────────────────────────

/**
 * La durée d'une trame AAC, en secondes : 1024 échantillons.
 *
 * À 48 kHz, 21,33 ms. C'est le quantum en dessous duquel une piste audio ne
 * peut pas être découpée — un plan ne tombe jamais pile sur une frontière de
 * trame, et la différence se reporte sur la durée du conteneur.
 */
export const ECHANTILLONS_TRAME_AAC = 1024;
export const TRAME_AAC_SECONDES = ECHANTILLONS_TRAME_AAC / AUDIO_FREQUENCE_RENDU;

/**
 * De combien la durée mesurée peut s'écarter de la durée du plan.
 *
 * ⚠️ ELLE VIENT DU SUPPORT, PAS D'UNE PRÉFÉRENCE. Deux quanta s'imposent :
 * l'image (1/fps, soit 33,3 ms à 30 i/s) et la trame AAC (21,3 ms à 48 kHz).
 * Le plus grossier des deux gouverne.
 *
 * Et il s'accumule : chaque frontière entre deux plans arrondit une fois, si
 * bien que le pire cas croît avec le NOMBRE DE PLANS. Une tolérance fixe
 * aurait été trop lâche pour un montage de deux plans et trop serrée pour un
 * montage de six.
 *
 * Pour le plan de référence — 5 plans à 30 i/s visant 25,000 s — cela donne
 * 166,7 ms, soit une conformité entre 24,833 s et 25,167 s.
 */
export function toleranceDuree(fps: number, nombrePlans: number): number {
  const f = nombreFini(fps);
  const n = nombreFini(nombrePlans);
  const cadence = f !== null && f > 0 ? f : 30;
  const plans = n !== null && n >= 1 ? Math.floor(n) : 1;
  const quantum = Math.max(1 / cadence, TRAME_AAC_SECONDES);
  return arrondirSeconde(quantum * plans);
}

/**
 * La cadence mesurée peut-elle différer de la cadence demandée ?
 *
 * À peine : ffmpeg écrit une cadence constante, mais `ffprobe` la rend sous
 * forme de fraction (`30000/1001` pour du 29,97). Un millième absorbe la
 * conversion sans laisser passer une cadence réellement fausse.
 */
export const TOLERANCE_FPS = 0.001;

/**
 * La résolution, elle, n'a AUCUNE tolérance.
 *
 * `scale` produit exactement les dimensions demandées. Un pixel d'écart
 * signifierait que le recadrage de M3-G n'a pas été appliqué tel quel, et
 * c'est précisément ce qu'il ne faut pas laisser passer.
 */
export function resolutionConforme(
  largeur: unknown, hauteur: unknown, attenduL: number, attenduH: number,
): boolean {
  return nombreFini(largeur) === attenduL && nombreFini(hauteur) === attenduH;
}

/** La durée mesurée tombe-t-elle dans la tolérance du plan ? */
export function dureeConforme(
  mesuree: unknown, attendue: number, fps: number, nombrePlans: number,
): boolean {
  const m = nombreFini(mesuree);
  const a = nombreFini(attendue);
  if (m === null || a === null || m <= 0 || a <= 0) return false;
  return Math.abs(m - a) <= toleranceDuree(fps, nombrePlans);
}

// ───────────────────────────────────────────────────────────────────────────
// La clé de stockage
// ───────────────────────────────────────────────────────────────────────────

/**
 * La clé du montage final : FABRIQUÉE, jamais reçue.
 *
 * ⚠️ LE PRÉFIXE UTILISATEUR EST LA PREUVE DE PROPRIÉTÉ, comme en M3-F. Que
 * l'objet EXISTE ne prouve rien ; qu'il vive sous `<userId>/` prouve à qui
 * il appartient, et c'est ce que la lecture vérifiera.
 *
 * Déterministe pour un rendu donné : le même identifiant rend la même clé, ce
 * qui permet de retrouver — et donc de supprimer — l'objet d'un rendu
 * interrompu sans avoir à le relire en base.
 *
 * Les deux composants viennent de la session et de la base ; aucune partie
 * n'est arbitraire, et un identifiant malformé ne peut pas fabriquer un
 * chemin qui sorte de l'espace de son propriétaire.
 */
export const COMPOSANT_CLE = /^[\w-]{1,64}$/;

export function cleRendu(userId: string, renduId: string): string {
  // ⚠️ ON VALIDE AVANT DE CONCATÉNER, PAS APRÈS.
  //
  // Les deux composants viennent de la session et de la base, donc jamais du
  // client — mais une fabrication de chemin qui fait CONFIANCE à ses entrées
  // n'est sûre que tant que cette provenance ne change pas. Un `renduId`
  // valant `../autre` produirait une clé parfaitement formée désignant
  // l'espace d'un tiers, et `cleValide` ne la relirait qu'APRÈS que l'objet
  // ait été écrit. Le même motif que `signerSource` de M3-F.
  if (!COMPOSANT_CLE.test(userId) || !COMPOSANT_CLE.test(renduId)) {
    throw new Error('composant de cle invalide');
  }
  return `${userId}/autopilote/montages/${renduId}/montage.mp4`;
}

/**
 * Une clé relue est-elle une clé, et rien d'autre ?
 *
 * `A/../B/x` satisfait un préfixe tout en désignant l'espace de B, et une
 * URL n'a rien à faire dans un champ de clé — c'est le signe qu'une
 * signature a été persistée quelque part.
 */
export function cleValide(valeur: unknown, userId: string): boolean {
  if (typeof valeur !== 'string' || valeur.length === 0) return false;
  if (!valeur.startsWith(`${userId}/`)) return false;
  if (valeur.includes('..') || valeur.includes('://')) return false;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Les vocabulaires fermés
// ───────────────────────────────────────────────────────────────────────────

export const ETATS_RENDU = [
  'en_attente', 'en_cours', 'reussie', 'echouee', 'annulee',
] as const;
export type EtatRendu = (typeof ETATS_RENDU)[number];

export function etatRenduValide(v: unknown): v is EtatRendu {
  return typeof v === 'string' && (ETATS_RENDU as readonly string[]).includes(v);
}

/**
 * Les étapes : QUATRE, et chacune est une vraie frontière technique.
 *
 * Elles ne décorent pas une barre de progression — elles disent où le travail
 * s'est arrêté, et chacune a ses propres modes d'échec :
 *
 *   • `source`       : signer, télécharger. Échoue en réseau ou en propriété.
 *   • `encodage`     : l'unique passage ffmpeg. Échoue en média ou en délai.
 *   • `mesure`       : ffprobe sur le fichier local. Échoue en conformité.
 *   • `televersement`: l'envoi vers le stockage. Échoue en réseau.
 *
 * Un cinquième palier « préparation » ou « finalisation » n'apporterait
 * aucun diagnostic que les quatre ne donnent déjà.
 */
export const ETAPES_RENDU = ['source', 'encodage', 'mesure', 'televersement'] as const;
export type EtapeRendu = (typeof ETAPES_RENDU)[number];

export function etapeRenduValide(v: unknown): v is EtapeRendu {
  return typeof v === 'string' && (ETAPES_RENDU as readonly string[]).includes(v);
}

/**
 * Les motifs d'échec : un vocabulaire fermé, traduisible et testable.
 *
 * ⚠️ AUCUNE SORTIE BRUTE DE FFMPEG N'ENTRE ICI. `stderr` porte le chemin
 * local et l'URL signée de la source ; il part au journal, masqué, et
 * jamais en base ni dans une réponse.
 *
 * `plan_introuvable` n'y figure PAS : un plan inconnu — ou appartenant à
 * autrui — est un 404 de la route, jamais une ligne persistée. Un motif ne
 * décrit que l'échec d'un travail qui a commencé.
 */
export const MOTIFS_RENDU = [
  'plan_non_conforme',
  'source_inaccessible',
  'clip_illisible',
  // ⚠️ LA MUSIQUE A SON PROPRE MOTIF, ET CE N'EST PAS UN LUXE. Lot 2A la
  // faisait passer par la sonde des CLIPS, qui exige une piste video : un MP3
  // sans pochette y devenait `clip_illisible`, et l'ecran accusait un rush
  // parfaitement sain. Un diagnostic qui designe le mauvais fichier envoie
  // l'utilisateur reparer ce qui n'est pas casse.
  'musique_illisible',
  // ⚠️ ET LE LOGO AUSSI A LE SIEN, POUR LA MEME RAISON EXACTEMENT. Le faire
  // passer par la sonde des clips le rendrait `clip_illisible` : l'ecran
  // accuserait un rush sain quand c'est l'image de marque qui est en cause.
  // La lecon de Lot 2A n'a de valeur que si on l'applique au cas suivant.
  'logo_illisible',
  'outil_absent',
  'encodage_echoue',
  'delai_depasse',
  'resultat_invalide',
  'televersement_echoue',
  'capacite_saturee',
  'rendu_interrompu',
] as const;
export type MotifRendu = (typeof MOTIFS_RENDU)[number];

export function motifRenduValide(v: unknown): v is MotifRendu {
  return typeof v === 'string' && (MOTIFS_RENDU as readonly string[]).includes(v);
}

/**
 * Le motif d'un rendu FERMÉ SANS AVOIR PU ABOUTIR, pour une raison qui n'est
 * pas la sienne.
 *
 * Trois situations l'écrivent, et elles ont la même conséquence pour qui
 * regarde l'écran — le travail n'a pas abouti, une relance est la suite
 * normale :
 *
 *   • la péremption, qui ferme la ligne d'un processus disparu ;
 *   • une consignation refusée alors que le fichier était monté — la base a
 *     dit non, pas le stockage ;
 *   • une panne inattendue du travail détaché, dont on ne sait pas dire
 *     quelle étape a cédé.
 *
 * ⚠️ ET C'EST BIEN CE MOTIF-LÀ, PAS UN AUTRE. Les deux derniers cas
 * écrivaient auparavant `televersement_echoue` et `encodage_echoue` : deux
 * affirmations FAUSSES sur des étapes qui avaient réussi, qui envoyaient
 * chercher la panne du mauvais côté.
 */
export const MOTIF_RENDU_INTERROMPU: MotifRendu = 'rendu_interrompu';

// ───────────────────────────────────────────────────────────────────────────
// L'identité et les formes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ce qui fait qu'un rendu EST le même rendu.
 *
 * ⚠️ TROIS CHAMPS, ET PAS UN DE PLUS.
 *
 * Le plan porte DÉJÀ, dans sa propre identité persistée, le jeu de clips et
 * sa version, l'analyse, `m3e-v1`, `x264-crf23-v1`, `m3g-v1`, le format et la
 * durée cible. Les recopier ici les ferait exister à deux endroits, avec la
 * certitude qu'ils divergeraient un jour ; `montagePlanId` et sa version les
 * résument sans ambiguïté.
 *
 * `methodeRendu` en fait partie pour la raison que la revue de M3-F a mise au
 * jour : `algorithme` disait comment les bornes avaient été décidées, mais
 * rien ne disait comment les OCTETS avaient été produits. Sans elle, changer
 * de CRF rendrait le fichier de l'encodage précédent en croyant réencoder.
 *
 * Elle est fixée par le SERVEUR à `METHODE_RENDU`, jamais reçue.
 */
export interface IdentiteRendu {
  montagePlanId: string;
  montagePlanVersion: number;
  methodeRendu: string;
}

/** Le fichier final, tel que la mesure l'a constaté. */
export interface RenduMaterialise {
  bucket: string;
  cle: string;
  octets: number;
  /** Ce que `ffprobe` a lu, et non ce que le plan demandait. */
  dureeMesureeSecondes: number;
  largeur: number;
  hauteur: number;
  fpsMesure: number | null;
  codecVideo: string;
  aAudio: boolean;
  codecAudio: string | null;
}

/**
 * Un résultat relu porte-t-il ce qu'il prétend porter ?
 *
 * Même garde qu'en M3-F et M3-G : ce qu'une version antérieure du code, ou
 * une main, a écrit ne doit pas être servi comme s'il était complet. Une URL
 * dans une clé est le signe qu'une signature a été persistée.
 */
export function renduMaterialiseValide(v: unknown, userId: string): v is RenduMaterialise {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!cleValide(r.cle, userId)) return false;
  if (typeof r.bucket !== 'string' || r.bucket.length === 0) return false;
  for (const c of ['octets', 'dureeMesureeSecondes', 'largeur', 'hauteur']) {
    const n = nombreFini(r[c]);
    if (n === null || n <= 0) return false;
  }
  if (typeof r.codecVideo !== 'string' || r.codecVideo.length === 0) return false;
  if (typeof r.aAudio !== 'boolean') return false;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Ce que le navigateur a le droit d'envoyer
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ RIEN. Le corps de la requête est VIDE, et c'est le contrat.
 *
 * `montagePlanId` vient du chemin ; tout le reste — les clips, les bornes,
 * les recadrages, le format, la cadence, la durée — est lu dans le plan
 * persisté. Il n'existe donc aucun paramètre de rendu légitime que le client
 * pourrait fournir, contrairement à M3-G où le format et la durée cible
 * étaient de vraies demandes de l'utilisateur.
 *
 * La liste ci-dessous n'est pas une liste de champs optionnels : c'est ce que
 * la route REFUSERA explicitement, en 422. Un champ ignoré laisse croire
 * qu'il a été pris en compte, et c'est exactement ce qu'espère celui qui
 * l'envoie.
 */
/**
 * Le SEUL champ qu'un client a le droit d'envoyer.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ UNE RECETTE METIER, JAMAIS UNE COMMANDE TECHNIQUE
 * ---------------------------------------------------------------------------
 *
 * `audio` a quitte `CHAMPS_INTERDITS_RENDU`, et c'est le seul a l'avoir fait.
 * Ce qu'il porte est ferme, nomme et borne par `lireRecetteAudio` : un choix
 * de musique dans SA propre mediatheque, deux volumes entre 0 et 1, un
 * interrupteur. Toute autre propriete est refusee, a la racine comme dans
 * `musique`.
 *
 * Ce qui reste interdit ne change pas d'un pouce : `musicUrl` en tete, mais
 * aussi tout parametre d'encodage, toute dimension, toute duree, tout chemin.
 * Le client dit CE QU'IL VEUT ENTENDRE ; il ne dit jamais comment le produire.
 */
export const CHAMP_AUDIO_RENDU = 'audio' as const;

/**
 * Le second champ accepte : le style de CETTE video.
 *
 * ⚠️ IL SUIT LA MEME REGLE QUE `audio`, SANS UN POUCE D'ECART. Ce qu'il porte
 * est ferme, nomme et borne par `lireProfilCreatif` : des IDENTIFIANTS pris
 * dans les catalogues de Studiio, des couleurs `#RRGGBB`, des nombres bornes,
 * et un logo designe par un couple compartiment/cle de SA propre mediatheque.
 * Aucun chemin, aucune URL, aucun nom de filtre, aucun argument.
 *
 * ⚠️ ET C'EST UN OVERRIDE DE VIDEO, PAS UN REGLAGE DE COMPTE. L'envoyer ici
 * n'ecrit rien dans le profil par defaut : il faut une action explicite,
 * ailleurs, pour cela. Un style essaye sur une video ne doit pas redefinir
 * l'identite visuelle du compte a l'insu de son proprietaire.
 */
export const CHAMP_STYLE_RENDU = 'style' as const;
export const CHAMPS_RENDU_ACCEPTES = [CHAMP_AUDIO_RENDU, CHAMP_STYLE_RENDU] as const;

export const CORPS_RENDU_ATTENDU_VIDE = true as const;

export const CHAMPS_INTERDITS_RENDU = [
  'clips', 'plans', 'ordre', 'debutSecondes', 'finSecondes', 'entreeSecondes',
  'dureeRetenueSecondes', 'debutTimelineSecondes', 'coupes', 'recadrage', 'crop',
  'largeur', 'hauteur', 'largeurCible', 'hauteurCible', 'width', 'height',
  'fps', 'cadence', 'codec', 'crf', 'preset', 'musicUrl',
  'bucket', 'cle', 'cleObjet', 'url', 'args', 'ffmpeg', 'composition',
  'duree', 'dureeCibleSecondes', 'methode', 'methodeRendu',
  'force', 'regenerate', 'userId', 'user_id',
] as const;

/**
 * Le plan est-il rendable ?
 *
 * ⚠️ ON NE JUGE PAS SA DÉCISION, ON VÉRIFIE QU'ELLE EST EXÉCUTABLE. Le
 * nombre de plans, leur ordre et leurs durées viennent de M3-G et ne sont pas
 * rediscutés ; ce qui est contrôlé ici, c'est qu'il y a quelque chose à
 * rendre et que cela tient dans les bornes d'exécution.
 */
export function planRendable(plan: {
  plans?: unknown; dureeTotaleSecondes?: unknown;
  largeurCible?: unknown; hauteurCible?: unknown; fps?: unknown;
}): boolean {
  if (!Array.isArray(plan.plans) || plan.plans.length === 0) return false;
  if (plan.plans.length > SOURCES_MAX) return false;
  const duree = nombreFini(plan.dureeTotaleSecondes);
  if (duree === null || duree <= 0 || duree > DUREE_RENDU_MAX_SECONDES) return false;
  for (const c of ['largeurCible', 'hauteurCible', 'fps'] as const) {
    const n = nombreFini(plan[c]);
    if (n === null || n <= 0) return false;
  }
  return true;
}
