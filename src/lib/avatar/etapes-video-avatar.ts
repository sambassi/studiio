/**
 * LES ÉTAPES D'UNE VIDÉO AVEC L'AVATAR — UN SEUL MODÈLE, TROIS ÉCRANS.
 *
 * Mon avatar, Créer et l'Autopilote disaient chacun la même attente avec
 * leurs mots (« Traitement », « Stockage », des pourcentages fabriqués par
 * étape…). Un seul modèle désormais :
 *
 *   Vérification → Génération de l'avatar → Récupération de la vidéo
 *     → Montage → Prête
 *
 *  - « Génération de l'avatar » n'a JAMAIS de pourcentage (aucun fournisseur
 *    n'en donne) : temps écoulé + sous-état réel (en file / en cours / en
 *    pause — service indisponible, reprise automatique) ;
 *  - « Montage » n'affiche un pourcentage que s'il est RÉEL (images rendues) ;
 *  - en échec : l'étape fautive, la raison du serveur, « crédits remboursés »
 *    quand le serveur l'a fait, et UNE action.
 *
 * Module PUR (aucun réseau, aucun écran) : la même entrée serveur redonne la
 * même progression après un rechargement.
 */
import type { EtapeProgression, StatutProgression } from '@/components/ux/ProgressStatus';

export type CleEtapeVideoAvatar = 'verification' | 'generation' | 'recuperation' | 'montage' | 'prete';
export type SousEtatGenerationAvatar = 'en_file' | 'en_cours' | 'en_pause';

export const ETAPES_VIDEO_AVATAR: ReadonlyArray<{ cle: CleEtapeVideoAvatar; libelle: string }> = [
  { cle: 'verification', libelle: 'Vérification' },
  { cle: 'generation', libelle: 'Génération de l’avatar' },
  { cle: 'recuperation', libelle: 'Récupération de la vidéo' },
  { cle: 'montage', libelle: 'Montage' },
  { cle: 'prete', libelle: 'Prête' },
];

/** Ce que dit l'étape courante, en une phrase. */
export const MESSAGE_ETAPE_VIDEO_AVATAR: Record<CleEtapeVideoAvatar, string> = {
  verification: 'Vérification de votre avatar, de votre voix et de votre solde…',
  generation: 'Génération de votre avatar…',
  recuperation: 'Vidéo reçue — enregistrement dans Studiio…',
  montage: 'Montage de la vidéo…',
  prete: 'Vidéo prête.',
};

/** Le sous-état réel de la génération, dit en clair. */
export const DETAIL_SOUS_ETAT_AVATAR: Record<SousEtatGenerationAvatar, string> = {
  en_file: 'En file d’attente chez le service de génération.',
  en_cours: 'En cours. Le service de génération anime votre avatar.',
  en_pause: 'En pause — service indisponible, reprise automatique. Aucun crédit perdu.',
};

export interface EntreeProgressionVideoAvatar {
  etape: CleEtapeVideoAvatar;
  /** Pendant « Génération de l'avatar » seulement. */
  sousEtat?: SousEtatGenerationAvatar | null;
  /** Mon avatar : pas d'étape Montage. Défaut : avec. */
  avecMontage?: boolean;
  /** Pourcentage RÉEL du montage (images rendues, 0–100), sinon absent. */
  pourcentMontage?: number | null;
  /** Échec à l'étape `etape` : la raison du serveur, et s'il a remboursé. */
  echec?: { message: string; rembourse?: boolean } | null;
}

export interface ProgressionVideoAvatar {
  statut: StatutProgression;
  etapes: EtapeProgression[];
  /** Phrase de l'étape courante. */
  message: string;
  /** Sous-état (génération), sinon `null`. */
  detail: string | null;
  /** Défini UNIQUEMENT pendant le montage, et seulement s'il est réel. */
  pourcentage?: number;
  /** En échec : l'étape fautive, le motif complet, l'action unique. */
  echec?: { etape: string; motif: string; action: string };
}

export const ACTION_ECHEC_VIDEO_AVATAR = 'Réessayer';

const REMBOURSE = /rembours/i;

/** La liste des étapes montrées (sans « Montage » pour Mon avatar). */
export function listeEtapesVideoAvatar(avecMontage = true): ReadonlyArray<{ cle: CleEtapeVideoAvatar; libelle: string }> {
  return avecMontage ? ETAPES_VIDEO_AVATAR : ETAPES_VIDEO_AVATAR.filter((e) => e.cle !== 'montage');
}

export function progressionVideoAvatar(e: EntreeProgressionVideoAvatar): ProgressionVideoAvatar {
  const liste = listeEtapesVideoAvatar(e.avecMontage !== false);
  const cle: CleEtapeVideoAvatar = e.etape === 'montage' && e.avecMontage === false ? 'prete' : e.etape;
  const i = Math.max(0, liste.findIndex((x) => x.cle === cle));
  const fin = cle === 'prete';
  const echoue = !!e.echec && !fin;
  const etapes: EtapeProgression[] = liste.map((x, k) => ({
    libelle: x.libelle,
    etat: k < i || (fin && k === i) ? 'terminee' : k === i ? (echoue ? 'echouee' : 'courante') : 'a_venir',
  }));
  if (echoue) {
    const base = e.echec!.message.trim() || 'La génération a échoué.';
    const motif = e.echec!.rembourse && !REMBOURSE.test(base) ? `${base} Crédits remboursés.` : base;
    return {
      statut: 'erreur', etapes, message: motif, detail: null,
      echec: { etape: liste[i].libelle, motif, action: ACTION_ECHEC_VIDEO_AVATAR },
    };
  }
  if (fin) return { statut: 'succes', etapes, message: MESSAGE_ETAPE_VIDEO_AVATAR.prete, detail: null };
  const detail = cle === 'generation' ? DETAIL_SOUS_ETAT_AVATAR[e.sousEtat ?? 'en_cours'] : null;
  const p = e.pourcentMontage;
  const pourcentage = cle === 'montage' && typeof p === 'number' && Number.isFinite(p)
    ? Math.min(100, Math.max(0, Math.round(p)))
    : undefined;
  return {
    statut: 'en_cours', etapes, message: MESSAGE_ETAPE_VIDEO_AVATAR[cle], detail,
    ...(pourcentage !== undefined ? { pourcentage } : {}),
  };
}

/**
 * La réponse de `GET /api/avatar/status` (en cours) → étape + sous-état.
 * Champs additifs lus : `etape` (`en_file` / `en_cours` / `recuperation`),
 * `etatFournisseur` (`pending` / `processing`), `enAttente: 'fournisseur'`.
 * Une réponse d'avant (sans eux) reste « Génération — en cours ».
 */
export function etapeDepuisStatutAvatar(d: {
  status?: unknown; etape?: unknown; etatFournisseur?: unknown; enAttente?: unknown;
} | null | undefined): { etape: CleEtapeVideoAvatar; sousEtat: SousEtatGenerationAvatar | null } {
  if (d?.status === 'completed') return { etape: 'recuperation', sousEtat: null };
  if (d?.enAttente === 'fournisseur') return { etape: 'generation', sousEtat: 'en_pause' };
  if (d?.etape === 'recuperation') return { etape: 'recuperation', sousEtat: null };
  if (d?.etape === 'en_file' || d?.etatFournisseur === 'pending' || d?.status === 'pending') return { etape: 'generation', sousEtat: 'en_file' };
  return { etape: 'generation', sousEtat: 'en_cours' };
}

/**
 * L'état d'une ligne `autopilot_jumeau_attente` → étape.
 *   reserve    : créneau réservé, lancement en cours → Vérification ;
 *   en_attente : la génération de l'avatar avance (rapatriement compris) ;
 *   en_cours   : vidéo prête, le montage est pris par le finaliseur ;
 *   rendu      : prête.
 */
export function etapeDepuisStatutJumeauAutopilote(statut: unknown): CleEtapeVideoAvatar {
  if (statut === 'reserve') return 'verification';
  if (statut === 'en_cours') return 'montage';
  if (statut === 'rendu') return 'prete';
  return 'generation';
}
