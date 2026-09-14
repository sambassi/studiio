/**
 * A_8c — LES CONSTANTES DU CLONE, ECRITES UNE SEULE FOIS.
 *
 * ⚠️ POURQUOI UN MODULE POUR SI PEU. Le texte de consentement et sa version
 * etaient sur le point d'exister a deux endroits : la route historique de
 * creation photo, et la nouvelle route d'inscription video. Deux copies d'une
 * meme phrase juridique divergent au premier ajustement — et la version cesse
 * alors de designer ce qui a reellement ete accepte.
 */

/**
 * QUI LE CLONE REPRESENTE. A_8 est SELF ONLY.
 *
 * ⚠️ CONSTANTE, PAS UN PARAMETRE DE REQUETE. Un `subject_type` venu du client
 * serait exactement la porte que cette regle ferme : personne ne doit pouvoir
 * declarer creer le clone de quelqu'un d'autre.
 */
export const SUJET_AVATAR = 'self';

/**
 * La version du texte accepte.
 *
 * Le texte peut evoluer ; ce qui a ete accepte un jour donne ne doit pas
 * changer retroactivement. Le numero rend cette lecture possible sans avoir a
 * comparer des phrases.
 */
export const VERSION_CONSENTEMENT = 'a8c-2026-09-09';

/** Le texte exact, affiche a l'ecran ET stocke comme preuve datee. */
export const TEXTE_CONSENTEMENT =
  'Je certifie être la personne visible dans cette vidéo et j’autorise Studiio '
  + 'à l’utiliser pour créer mon clone numérique.';

/**
 * L'etat d'une source prete, AVANT tout fournisseur.
 *
 * Il vit dans `user_avatars.status`, aux cotes du vocabulaire du fournisseur —
 * mais il ne se confond pas avec lui : voir `etats.ts`.
 */
export const ETAT_SOURCE_PRETE = 'source_ready';

/* ═════════════════════════════════════════════════════════════════════════
   A_8f (correctif Gap-1) — DEUX INTENTIONS DE GENERATION, ET PAS UNE DE PLUS
   ═════════════════════════════════════════════════════════════════════════

   Valider son clone exige de l'avoir VU — donc une generation doit pouvoir
   exister AVANT la validation. Mais si cette generation-la est une generation
   comme les autres, la validation ne garde plus rien : n'importe quel texte
   passe avant que la personne ait accepte de preter son visage.

   L'apercu est donc une intention A PART : une seule fois par version, sur un
   script court que Studiio fixe et que le navigateur ne choisit pas. */

export const INTENTION_APERCU = 'apercu' as const;
export const INTENTION_NORMALE = 'normale' as const;
export const INTENTIONS_GENERATION = [INTENTION_APERCU, INTENTION_NORMALE] as const;
export type IntentionGeneration = (typeof INTENTIONS_GENERATION)[number];

/**
 * ⚠️ AUCUNE INFERENCE. L'intention vient du corps de la requete, en toutes
 * lettres ; une valeur absente ou inconnue n'est pas « probablement normale »,
 * elle est refusee. Deviner depuis `validated_at` reviendrait a offrir
 * l'apercu gratuit a qui n'a pas encore valide, et la generation libre a qui
 * l'a fait — la porte que ce lot ferme.
 */
export function lireIntention(brut: unknown): IntentionGeneration | null {
  return (INTENTIONS_GENERATION as readonly string[]).includes(brut as string)
    ? (brut as IntentionGeneration) : null;
}

/**
 * CE QUE L'APERCU FAIT DIRE AU CLONE.
 *
 * Le texte sert a juger le visage, la bouche, les yeux et le naturel — pas a
 * produire un contenu. Il est court a dessein : ~15 secondes prononcees, et
 * la borne ci-dessous le tient cote serveur. Le navigateur n'envoie pas de
 * script pour un apercu ; s'il en envoie un, il est ignore.
 */
export const SCRIPT_APERCU =
  'Bonjour, je suis votre clone Studiio. Regardez mon visage, mes expressions '
  + 'et le mouvement de mes lèvres pendant que je parle. Si tout vous semble '
  + 'naturel, vous pourrez valider votre clone.';

/** La borne du script d'apercu, en caracteres (≈ 15 s a ~15 car./s). */
export const APERCU_SCRIPT_MAX_CHARS = 240;
/** La duree cible d'un apercu, en secondes — ce que la borne represente. */
export const APERCU_DUREE_MAX_S = 20;
