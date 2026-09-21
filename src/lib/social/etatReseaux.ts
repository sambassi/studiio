/**
 * État UNIQUE d'un réseau social, dérivé des DEUX sources qui coexistent :
 *
 * - le chemin direct (`social_accounts`, OAuth détenu par Studiio — historique,
 *   lu par `GET /api/social/status`) ;
 * - Zernio (`zernio_accounts`, les comptes que l'utilisateur connecte lui-même,
 *   lus par `GET /api/social/zernio/accounts`).
 *
 * L'écran « Réseaux sociaux » affichait ces deux sources l'une SOUS l'autre :
 * Instagram apparaissait deux fois, avec deux états et deux boutons. Ici, une
 * seule règle décide de ce que voit l'utilisateur, et elle est PURE : testable
 * sans réseau, réutilisable par le Calendrier IA pour ne pas répéter la logique.
 *
 * Priorité : le compte Zernio de l'utilisateur, s'il existe, l'emporte sur le
 * compte direct — c'est SON compte, et c'est lui que le cron de publication
 * sert en premier (`cron/publish` : Zernio d'abord, repli direct ensuite).
 * Rien n'est masqué : un compte direct connecté reste visible et déconnectable.
 */

export const RESEAUX = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;
export type Reseau = typeof RESEAUX[number];

export type EtatReseau =
  | 'connecte'
  | 'reconnexion'
  | 'non_connecte'
  | 'bientot'
  | 'non_configure';

export type Voie = 'zernio' | 'direct';

export interface StatutDirect {
  available?: boolean;
  connected?: boolean;
  username?: string | null;
  oauthAvailable?: boolean;
}

export interface CompteZernio {
  accountId: string;
  platform: string;
  username: string | null;
  status: string;
}

export interface EntreeZernio {
  /** L'utilisateur a le droit de connecter ses propres comptes. */
  autorise: boolean;
  raison?: string | null;
  comptes: CompteZernio[];
}

export interface EtatDerive {
  reseau: Reseau;
  etat: EtatReseau;
  /** Par quel chemin le réseau est (ou serait) connecté. */
  voie: Voie | null;
  username: string | null;
  /** Actions réellement possibles — jamais un bouton qui n'aboutit pas. */
  actions: {
    connecter: Voie | null;
    reconnecter: Voie | null;
    deconnecter: Voie | null;
  };
  /**
   * La publication automatique est-elle opérationnelle sur ce réseau ?
   * `false` → l'écran propose le téléchargement + publication manuelle.
   */
  autoPublication: boolean;
  /** Motif lisible quand l'auto-publication n'est pas opérationnelle. */
  motifAuto: 'tiktok-prive' | 'non-connecte' | 'bientot' | 'non-configure' | 'reconnexion' | null;
}

/**
 * Dérive l'état d'un réseau.
 *
 * `direct` absent = « sans information » : la plateforme reste connectable
 * (même règle que l'écran : on ne masque jamais par accident).
 */
export function deriverEtatReseau(
  reseau: Reseau,
  direct: StatutDirect | undefined,
  zernio: EntreeZernio | undefined,
): EtatDerive {
  const compteZ = zernio?.comptes.find((c) => c.platform === reseau);
  const zConnecte = !!compteZ && compteZ.status === 'connected';
  const zDeconnecte = !!compteZ && compteZ.status === 'disconnected';
  const zAutorise = !!zernio?.autorise;

  const dConnecte = !!direct?.connected;
  const dOAuth = !!direct?.oauthAvailable;
  const dDisponible = direct?.available ?? true;

  const vide = { connecter: null, reconnecter: null, deconnecter: null } as EtatDerive['actions'];

  // 1. Compte Zernio vivant : c'est le compte de l'utilisateur, il gagne.
  if (zConnecte) {
    return {
      reseau, etat: 'connecte', voie: 'zernio', username: compteZ!.username,
      actions: { ...vide, deconnecter: 'zernio' },
      autoPublication: true, motifAuto: null,
    };
  }

  // 2. Compte direct connecté (chemin historique).
  if (dConnecte) {
    const tiktokPrive = reseau === 'tiktok';
    return {
      reseau, etat: 'connecte', voie: 'direct', username: direct?.username ?? null,
      actions: { ...vide, reconnecter: 'direct', deconnecter: 'direct' },
      autoPublication: !tiktokPrive, motifAuto: tiktokPrive ? 'tiktok-prive' : null,
    };
  }

  // 3. Compte Zernio dont l'autorisation a expiré : le mot dit quoi faire.
  if (zDeconnecte && zAutorise) {
    return {
      reseau, etat: 'reconnexion', voie: 'zernio', username: compteZ!.username,
      actions: { ...vide, reconnecter: 'zernio' },
      autoPublication: false, motifAuto: 'reconnexion',
    };
  }

  // 4. Rien de connecté : par quel chemin PEUT-on connecter ?
  if (zAutorise) {
    return {
      reseau, etat: 'non_connecte', voie: 'zernio', username: null,
      actions: { ...vide, connecter: 'zernio' },
      autoPublication: false, motifAuto: 'non-connecte',
    };
  }
  if (!dDisponible) {
    return {
      reseau, etat: 'bientot', voie: null, username: null, actions: vide,
      autoPublication: false, motifAuto: 'bientot',
    };
  }
  if (dOAuth) {
    return {
      reseau, etat: 'non_connecte', voie: 'direct', username: null,
      actions: { ...vide, connecter: 'direct' },
      autoPublication: false, motifAuto: 'non-connecte',
    };
  }
  return {
    reseau, etat: 'non_configure', voie: null, username: null, actions: vide,
    autoPublication: false, motifAuto: 'non-configure',
  };
}

export function deriverTousLesReseaux(
  direct: Record<string, StatutDirect> | undefined,
  zernio: EntreeZernio | undefined,
): Record<Reseau, EtatDerive> {
  const out = {} as Record<Reseau, EtatDerive>;
  for (const r of RESEAUX) out[r] = deriverEtatReseau(r, direct?.[r], zernio);
  return out;
}

/**
 * Identifiant de réseau → nom d'affichage du Calendrier.
 *
 * ⚠️ DEUX CONVENTIONS COEXISTENT dans `scheduled_posts.platforms` : le
 * Calendrier écrit ses libellés (« Instagram »), l'Autopilote ses
 * identifiants (« instagram »). Le cron accepte les deux (il abaisse la
 * casse), mais le Calendrier compare ses libellés tels quels : un post
 * programmé avec « instagram » n'y apparaissait ni sélectionné ni coloré.
 * Tout ce qui ÉCRIT depuis un écran passe donc par ce libellé, et le
 * Calendrier normalise ce qu'il LIT.
 */
export const LIBELLES_CALENDRIER: Record<Reseau, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export function libelleCalendrier(reseau: Reseau): string {
  return LIBELLES_CALENDRIER[reseau];
}

/**
 * Plateformes d'un post telles que le Calendrier les affiche : les
 * identifiants de réseau deviennent des libellés, les autres canaux
 * (Email, WhatsApp, Afroboost.com…) restent tels quels, sans doublon.
 */
export function normaliserPlateformesCalendrier(platforms: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const p of platforms ?? []) {
    if (typeof p !== 'string') continue;
    const r = reseauDepuisLibelle(p);
    const v = r ? libelleCalendrier(r) : p;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Nom d'affichage (Calendrier) → identifiant de réseau, ou `null` hors réseaux. */
export function reseauDepuisLibelle(libelle: string): Reseau | null {
  const l = libelle.trim().toLowerCase();
  if (l.startsWith('youtube')) return 'youtube';
  return (RESEAUX as readonly string[]).includes(l) ? (l as Reseau) : null;
}
