/**
 * A_8c — DEUX PHASES DE VIE, ET IL NE FAUT PAS LES CONFONDRE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `user_avatars.status` portait jusqu'ici UN SEUL vocabulaire : celui du
 * fournisseur (`processing`, `completed`, `failed`). C'etait exact tant qu'un
 * avatar naissait chez lui — la route appelait HeyGen, obtenait un
 * identifiant, puis inserait la ligne.
 *
 * Cet ordre s'inverse. La source de reference et le consentement existent
 * AVANT tout entrainement. Une ligne peut donc etre parfaitement valide sans
 * qu'aucun fournisseur ne sache qu'elle existe.
 *
 * ⚠️ ET C'EST LA QUE LE DANGER SE TROUVE. `GET /api/avatar/create` rafraichit
 * le statut des que celui-ci n'est pas « pret » : avec `source_ready` et un
 * `provider_avatar_id` a NULL, il interrogeait le fournisseur avec `null` —
 * une requete qui part, qui echoue, et qui recommence a chaque consultation.
 *
 * Le vocabulaire est donc separe en deux, explicitement.
 */

/**
 * LES ETATS LOCAUX — rien n'a ete envoye nulle part.
 *
 * `source_ready` : la video de reference est televersee, mesuree et acceptee,
 * et son proprietaire a certifie etre la personne filmee. Aucun octet n'a
 * quitte Studiio.
 */
export const ETATS_LOCAUX = ['source_ready'] as const;
export type EtatLocal = (typeof ETATS_LOCAUX)[number];

/**
 * LES ETATS DU FOURNISSEUR — un entrainement a REELLEMENT ete lance.
 *
 * Vocabulaire historique de HeyGen, inchange : c'est lui qui l'ecrit.
 */
export const ETATS_FOURNISSEUR = ['processing', 'completed', 'ready', 'success', 'failed'] as const;

/** Les statuts que le produit considere comme « avatar utilisable ». */
export const ETATS_PRETS = ['completed', 'ready', 'success'] as const;

export function estEtatLocal(statut: unknown): statut is EtatLocal {
  return typeof statut === 'string' && (ETATS_LOCAUX as readonly string[]).includes(statut);
}

export function estEtatPret(statut: unknown): boolean {
  return typeof statut === 'string' && (ETATS_PRETS as readonly string[]).includes(statut);
}

/**
 * FAUT-IL INTERROGER LE FOURNISSEUR POUR CETTE LIGNE ?
 *
 * ⚠️ LA REPONSE TIENT A UN SEUL FAIT : existe-t-il un identifiant chez lui.
 * Sans identifiant, il n'y a rien a demander — et demander quand meme envoie
 * `null` sur le reseau, a chaque consultation de la page.
 *
 * Un etat local n'est pas non plus un etat « en cours » : `source_ready` ne
 * progresse pas tout seul, il attend une action de son proprietaire.
 */
export function interrogerLeFournisseur(avatar: {
  status?: unknown;
  provider_avatar_id?: unknown;
} | null | undefined): boolean {
  if (!avatar) return false;
  const identifiant = avatar.provider_avatar_id;
  if (typeof identifiant !== 'string' || identifiant.length === 0) return false;
  if (estEtatLocal(avatar.status)) return false;
  return !estEtatPret(avatar.status);
}

/**
 * CE CLONE PEUT-IL ETRE VALIDE PAR SON PROPRIETAIRE ?
 *
 * ⚠️ TROIS CONDITIONS, ET IL FAUT LES TROIS. Valider, c'est dire « j'accepte
 * que ceci parle a ma place ». On ne peut l'accepter que si :
 *
 *   1. un avatar existe REELLEMENT chez le fournisseur — sans identifiant, il
 *      n'y a rien a valider ;
 *   2. son entrainement est termine — valider un modele en cours de calcul
 *      n'aurait aucun sens ;
 *   3. un apercu REEL a ete produit — accepter sans avoir vu, c'est signer
 *      pour ce qu'on n'a pas regarde.
 *
 * `source_ready` echoue sur les trois : la video de reference est prete, et
 * rien d'autre. C'est precisement pour cela que cette fonction existe.
 */
export type MotifValidationRefusee =
  | 'aucun_clone'
  | 'entrainement_en_cours'
  | 'apercu_absent'
  | 'deja_valide';

export function validationPossible(avatar: {
  status?: unknown;
  provider_avatar_id?: unknown;
  validated_at?: unknown;
  apercuUrl?: unknown;
} | null | undefined): { ok: true } | { ok: false; motif: MotifValidationRefusee } {
  if (!avatar) return { ok: false, motif: 'aucun_clone' };
  const identifiant = avatar.provider_avatar_id;
  if (typeof identifiant !== 'string' || identifiant.length === 0) {
    return { ok: false, motif: 'aucun_clone' };
  }
  if (typeof avatar.validated_at === 'string' && avatar.validated_at.length > 0) {
    return { ok: false, motif: 'deja_valide' };
  }
  if (!estEtatPret(avatar.status)) return { ok: false, motif: 'entrainement_en_cours' };
  if (typeof avatar.apercuUrl !== 'string' || avatar.apercuUrl.length === 0) {
    return { ok: false, motif: 'apercu_absent' };
  }
  return { ok: true };
}

/** Ce que la personne lit quand la validation est refusee. */
export const MESSAGES_VALIDATION: Record<MotifValidationRefusee, string> = {
  aucun_clone: 'Votre clone n’a pas encore été créé.',
  entrainement_en_cours: 'Votre clone est encore en cours de création.',
  apercu_absent: 'Un aperçu de votre clone doit être généré avant validation.',
  deja_valide: 'Vous avez déjà validé ce clone.',
};

/* ═════════════════════════════════════════════════════════════════════════
   A_8f (correctif Gap-1) — CE CLONE PEUT-IL GENERER, ET DANS QUELLE INTENTION ?
   ═════════════════════════════════════════════════════════════════════════

   ⚠️ LA DECISION EST PURE, ET ELLE VIT ICI. La route de generation appelait le
   fournisseur sans jamais lire `validated_at` : le portail Autopilote exigeait
   la validation, la route directe non. Un appel direct contournait donc tout.

   Deux intentions, deux politiques, UN pipeline :

     apercu   — AVANT validation. Il faut un clone REEL (identifiant chez le
                fournisseur, entrainement termine), une version connue, et
                qu'aucun apercu non echoue n'existe deja pour CETTE version.
                `validated_at` n'est pas exige : c'est l'apercu qui permet de
                valider, il ne peut pas en dependre.

     normale  — APRES validation seulement. Tout ce qui precede, plus
                `validated_at` non nul. La validation appartient a une version
                (Gap-2 la remet a NULL a chaque nouvelle version), donc
                « validee » veut dire « cette version-ci, validee ».

   `source_ready` echoue dans les deux cas : aucun clone n'existe. */

export type MotifGenerationRefusee =
  | 'aucun_clone'
  | 'entrainement_en_cours'
  | 'version_absente'
  | 'apercu_deja_produit'
  | 'clone_non_valide';

export function generationPossible(entree: {
  avatar: {
    status?: unknown;
    provider_avatar_id?: unknown;
    validated_at?: unknown;
    version?: unknown;
  } | null | undefined;
  intention: 'apercu' | 'normale';
  /** Un apercu en cours ou termine existe-t-il deja pour la version courante ? */
  apercuOccupe: boolean;
}): { ok: true; version: number } | { ok: false; motif: MotifGenerationRefusee } {
  const { avatar, intention, apercuOccupe } = entree;
  if (!avatar) return { ok: false, motif: 'aucun_clone' };

  const identifiant = avatar.provider_avatar_id;
  if (typeof identifiant !== 'string' || identifiant.length === 0) {
    return { ok: false, motif: 'aucun_clone' };
  }
  if (!estEtatPret(avatar.status)) return { ok: false, motif: 'entrainement_en_cours' };

  const version = typeof avatar.version === 'number' && Number.isInteger(avatar.version)
    && avatar.version >= 1 ? avatar.version : null;
  if (version === null) return { ok: false, motif: 'version_absente' };

  if (intention === 'apercu') {
    if (apercuOccupe) return { ok: false, motif: 'apercu_deja_produit' };
    return { ok: true, version };
  }

  const valide = typeof avatar.validated_at === 'string' && avatar.validated_at.length > 0;
  if (!valide) return { ok: false, motif: 'clone_non_valide' };
  return { ok: true, version };
}

/** Ce que la personne lit quand la generation est refusee. */
export const MESSAGES_GENERATION: Record<MotifGenerationRefusee, string> = {
  aucun_clone: 'Votre clone n’a pas encore été créé.',
  entrainement_en_cours: 'Votre clone est encore en cours de création.',
  version_absente: 'La version de votre clone est inconnue.',
  apercu_deja_produit: 'Un aperçu existe déjà pour cette version de votre clone. Regardez-le, puis validez votre clone.',
  clone_non_valide: 'Regardez l’aperçu et validez votre clone avant de générer une vidéo.',
};
