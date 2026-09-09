/**
 * A_0 — LE VOCABULAIRE DE LA PASSERELLE AUTOMATIQUE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE FAIT QUI JUSTIFIE CE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Studiio a DEUX chaînes de création qui ne se parlent pas :
 *
 *   • la chaîne « template » — `/api/cron/autopilot` → `engine.ts` →
 *     Remotion. Elle tourne toute seule, et produit un gabarit à quatre
 *     séquences à partir d'UN rush pris en rotation ;
 *   • la chaîne M3 — analyse → candidats → coupes → clips → plan → FFmpeg.
 *     Elle porte toute l'intelligence éditoriale (objectif, signaux, m3g),
 *     et n'est déclenchée qu'à la main, depuis un écran.
 *
 * Deux moteurs, deux qualités. Ce module ouvre la porte entre les deux.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE DÉFAUT PAR DÉFAUT EST L'ANCIEN COMPORTEMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `MOTEUR_DEFAUT` vaut `legacy_template`. Un compte qui n'a rien demandé
 * continue de recevoir exactement ce qu'il recevait hier, au champ près.
 * C'est ce qui permet de livrer la passerelle sans livrer un changement de
 * comportement — et de la juger sur pièces avant de la généraliser.
 */

/** Les deux moteurs, et pas un de plus. */
export const MOTEURS_AUTOPILOTE = ['legacy_template', 'm3'] as const;
export type MoteurAutopilote = (typeof MOTEURS_AUTOPILOTE)[number];

/** Ce que reçoit un compte qui n'a rien choisi : l'existant. */
export const MOTEUR_DEFAUT: MoteurAutopilote = 'legacy_template';

/**
 * Le moteur d'un compte, lu sans jamais faire confiance à la valeur stockée.
 *
 * ⚠️ AUCUNE COLONNE, AUCUNE MIGRATION. Le choix vit dans le `designStyle`
 * jsonb déjà présent — la même place que les autres réglages non
 * structurants. Poser une colonne aurait demandé une migration pour un
 * drapeau de transition, destiné à disparaître quand M3 deviendra le seul
 * moteur.
 */
export function moteurDepuisConfig(brut: unknown): MoteurAutopilote {
  if (brut === null || typeof brut !== 'object') return MOTEUR_DEFAUT;
  const valeur = (brut as { moteur?: unknown }).moteur;
  return (MOTEURS_AUTOPILOTE as readonly string[]).includes(valeur as string)
    ? valeur as MoteurAutopilote
    : MOTEUR_DEFAUT;
}

/**
 * Pourquoi la chaîne M3 n'a rien produit.
 *
 * ⚠️ UNE LISTE FERMÉE, ET DES MOTS D'INFRASTRUCTURE. Ces motifs vont dans
 * un rapport de cron, pas sous les yeux d'un utilisateur : ils doivent dire
 * à un ingénieur QUOI regarder, pas rassurer.
 */
export const MOTIFS_M3 = [
  'aucun_rush_analyse',
  'analyse_absente',
  /* ⚠️ « EN COURS » N'EST NI UNE REUSSITE NI UN ECHEC. Une analyse deja en
     vol — lancee par un humain il y a deux minutes, ou par le cycle
     precedent — ne doit pas en declencher une seconde : la base l'interdit
     de toute facon (`rush_analyses_active_unique`), et insister ferait
     tourner un fournisseur pour rien. On attend le cycle suivant. */
  'analyse_en_cours',
  'analyse_echouee',
  'candidats_absents',
  'candidats_en_cours',
  'candidats_echoues',
  'coupes_vides',
  'clips_echoues',
  'plan_impossible',
  'rendu_echoue',
  'socle_absent',
  /* ⚠️ A_8f — « LE CLONE ETAIT DEMANDE, ET IL N'A PAS PU SERVIR ».
     Deux motifs, et non un repli silencieux vers une video ordinaire.
     Quelqu'un qui a explicitement demande que son clone parle ne doit pas
     recevoir autre chose sans l'apprendre : mieux vaut un creneau non
     produit et nomme qu'une video qu'il croira etre la sienne. */
  'jumeau_non_pret',
  /* Configuration valide, mais l'integration du fournisseur n'est pas encore
     livree. Ce n'est ni une panne ni une erreur de l'utilisateur. */
  'jumeau_indisponible',
] as const;
export type MotifM3 = (typeof MOTIFS_M3)[number];

/**
 * L'issue d'une tentative, en trois sortes — et JAMAIS un booléen.
 *
 * ⚠️ « IGNORÉ » N'EST PAS « ÉCHOUÉ », et les confondre coûterait cher. Un
 * compte sans rush analysé n'a rien cassé : il n'a rien à monter. Le
 * signaler comme un échec ferait sonner une alarme à chaque cycle, et
 * l'alarme finirait par être ignorée le jour où quelque chose casse
 * vraiment.
 */
export type IssueM3 =
  | { sorte: 'reussi'; renduId: string; planId: string; rushId: string; videoUrl: string;
      vignetteUrl: string | null; dureeSecondes: number }
  | { sorte: 'ignore'; motif: MotifM3 }
  | { sorte: 'echec'; motif: MotifM3; detail: string | null };

/**
 * Le repli, s'il y en a un.
 *
 * ⚠️ « SILENCIEUX » EST LA SEULE VALEUR INTERDITE. Retomber sur le gabarit
 * sans le dire produirait des vidéos d'un moteur en croyant les avoir d'un
 * autre — et la comparaison entre les deux, qui est TOUT l'intérêt de cette
 * passerelle, deviendrait impossible à faire.
 */
export const REPLIS = ['aucun', 'template_si_ignore'] as const;
export type Repli = (typeof REPLIS)[number];

/** Sans choix explicite, aucun repli : un cycle sans matière ne produit rien. */
export const REPLI_DEFAUT: Repli = 'aucun';

export function repliDepuisConfig(brut: unknown): Repli {
  if (brut === null || typeof brut !== 'object') return REPLI_DEFAUT;
  const valeur = (brut as { repli?: unknown }).repli;
  return (REPLIS as readonly string[]).includes(valeur as string)
    ? valeur as Repli
    : REPLI_DEFAUT;
}
