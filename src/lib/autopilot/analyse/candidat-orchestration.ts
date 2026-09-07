/**
 * A_0b — LA GÉNÉRATION DE CANDIDATS, HORS DE SA ROUTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MÊME RAISON QUE POUR L'ANALYSE, MÊME MÉTHODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ces 200 lignes vivaient dans le corps de
 * `POST /api/autopilot/analyses/[id]/candidats`. Tant qu'elles y étaient,
 * « Trouver les meilleurs passages » exigeait une session : l'Autopilote
 * automatique ne pouvait pas produire de candidats, et devait donc attendre
 * qu'un humain clique.
 *
 * ⚠️ RIEN N'A ÉTÉ RÉÉCRIT. Quatorze `NextResponse.json(x, { status: n })`
 * sont devenus `reponse(x, n)`. Aucune condition, aucun ordre d'appel, aucun
 * motif, aucun statut n'a changé — et surtout aucun ALGORITHME : la
 * sélection historique, l'enrichissement des signaux et Sonnet restent
 * exactement où ils étaient, appelés exactement comme avant.
 *
 * ⚠️ NI `next/server`, NI `auth`, NI `cookies` ici. C'est ce qui rend ce
 * module appelable depuis un cron ; un test le vérifie sur le source.
 */
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import {
  chargerMoteurCandidats, resultatCandidatsEtapeValide,
  FOURNISSEUR_CANDIDATS, diagnosticCandidatsSur,
} from '@/lib/autopilot/analyse/moteur-candidat';
import {
  creerGeneration, majGeneration, lireDerniereGeneration,
} from '@/lib/autopilot/analyse/candidat-service';
import { CANDIDATS_MAX } from '@/lib/autopilot/analyse/candidat-contrat';
import { lireObjectifCommunicationUtilisateur } from '@/lib/autopilot/analyse/objectif-compte';
import { objectifPeutChangerLeMontage } from '@/lib/autopilot/analyse/objectif-score';
import type { ReponseServeur } from '@/lib/autopilot/analyse/analyse-orchestration';

/** Les textes visibles, tels que M3-B4 les a validés. */
type ContexteTextes = ReadonlyArray<{ texte: string; seconde: number; confiance: number }>;

const reponse = (
  corps: Record<string, unknown>, statut = 200,
): ReponseServeur => ({ corps, statut });

export const SOCLE_CANDIDATS_ABSENT =
  'La table des passages suggérés n’existe pas encore sur ce serveur.';

/** Ce que chaque motif d'étape dit à l'écran, et avec quel statut. */
const REFUS_CANDIDATS: Record<string, { message: string; statut: number }> = {
  aucune_image: {
    message: 'Aucune vignette lisible pour cette analyse.', statut: 422,
  },
  analyse_inexploitable: {
    message: 'Cette analyse ne contient pas de quoi proposer des passages.', statut: 422,
  },
  fournisseur_absent: {
    message: 'La recherche de passages n’est pas activée sur ce serveur.', statut: 503,
  },
  fournisseur_en_erreur: {
    message: 'La recherche de passages a échoué.', statut: 502,
  },
  resultat_candidats_invalide: {
    message: 'La recherche de passages a rendu un résultat inexploitable.', statut: 500,
  },
};

/**
 * Génère les candidats d'une analyse — le geste du bouton « Trouver les
 * meilleurs passages », rendu appelable sans écran.
 */
export async function genererCandidatsPourAnalyse(
  userId: string, analysisId: string,
): Promise<ReponseServeur> {
    // ── L'analyse source ──────────────────────────────────────────────────
    const { analyse, motif } = await lireAnalyse(userId, analysisId);
    if (motif === 'socle_absent') {
      return reponse({ ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, 503);
    }
    if (!analyse) {
      return reponse({ ok: false, error: 'Analyse introuvable' }, 404);
    }

    // ⚠️ `reussie`, ET PAS SEULEMENT « terminée ».
    //
    // Une analyse `echouee` porte parfois une extraction valide et un visuel
    // manquant. Y chercher des passages reviendrait à demander au modèle de
    // choisir des moments dans une description qui n'existe pas.
    if (analyse.etat !== 'reussie') {
      return reponse({
          ok: false,
          error: 'L’analyse doit être terminée avec succès.',
          motif: 'analyse_non_reussie',
        },
        409);
    }

    const duree = analyse.dureeSecondes;
    if (typeof duree !== 'number' || !Number.isFinite(duree) || duree <= 0) {
      return reponse({ ok: false, error: REFUS_CANDIDATS.analyse_inexploitable.message, motif: 'analyse_inexploitable' },
        422);
    }
    if (!Array.isArray(analyse.vignettes) || analyse.vignettes.length === 0) {
      return reponse({ ok: false, error: REFUS_CANDIDATS.aucune_image.message, motif: 'aucune_image' },
        422);
    }

    // ── La ligne, AVANT tout travail ──────────────────────────────────────
    const creation = await creerGeneration(userId, analyse.id, analyse.rushId);
    if (creation.motif === 'socle_absent') {
      return reponse({ ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, 503);
    }
    if (creation.motif === 'generation_active_existante') {
      // 409 : la contrainte de la base a tranché, pas un `if` de cette route.
      return reponse({
          ok: false,
          error: 'Une recherche de passages est déjà en cours pour cette analyse.',
          motif: 'generation_active_existante',
        },
        409);
    }
    const generation = creation.generation!;

    // ── Le moteur ─────────────────────────────────────────────────────────
    //
    // Chargé APRÈS la création : si le serveur n'a pas d'adaptateur, la ligne
    // existe déjà et se clôt `echouee` avec un motif nommé, plutôt que de
    // laisser l'utilisateur devant un bouton qui ne fait rien.
    let moteur;
    try {
      moteur = await chargerMoteurCandidats();
    } catch {
      // `ConfigurationCandidatsInvalide` : le drapeau est posé mais la clé ou
      // le modèle manque. Ce n'est pas « aucun fournisseur », c'est une
      // configuration incomplète — et ça se dit.
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'fournisseur_absent',
      });
      return reponse({ ok: false, error: REFUS_CANDIDATS.fournisseur_absent.message, motif: 'fournisseur_absent' },
        503);
    }

    if (!moteur) {
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'fournisseur_absent',
      });
      return reponse({ ok: false, error: REFUS_CANDIDATS.fournisseur_absent.message, motif: 'fournisseur_absent' },
        503);
    }

    await majGeneration(userId, generation.id, { etat: 'en_cours', etape: 'candidats' });

    // ── L'ENRICHISSEMENT SEMANTIQUE VAUT-IL SON APPEL ? ──────────────────
    //
    // ⚠️ L'OBJECTIF EST LU ICI, ET IL NE TOUCHE PAS A LA SELECTION. Il ne
    // part pas au fournisseur qui CHOISIT les moments — l'etape 4A.1 a
    // separe les deux pour de bon. Il ne sert qu'a decider si le SECOND
    // appel, celui qui releve ce que montre chaque fenetre, a une chance de
    // servir a quelque chose.
    //
    // Sans objectif, ou avec un objectif que rien ne distingue a l'image
    // (`inscriptions`, `reservations`, `leads`…), on ne paie pas un releve
    // que `politiqueDePlan` refusera ensuite de lire. Le montage reste
    // `m3g-v2`, exactement comme avant ce lot.
    const objectifCompte = await lireObjectifCommunicationUtilisateur(userId);
    const enrichissementUtile = objectifPeutChangerLeMontage(objectifCompte);

    // ⚠️ UN SEUL APPEL. Aucune reprise, quoi qu'il arrive.
    let brut: unknown;
    try {
      brut = await moteur({
        userId,
        analysisId: analyse.id,
        vignettes: analyse.vignettes,
        dureeSecondes: duree,
        contexte: {
          resume: analyse.resume ?? '',
          textesVisibles: (analyse.textesVisibles ?? []) as ContexteTextes,
          qualite: (analyse.qualite ?? {}) as Record<string, unknown>,
        },
        enrichissementUtile,
      });
    } catch {
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'fournisseur_en_erreur',
      });
      return reponse({ ok: false, error: REFUS_CANDIDATS.fournisseur_en_erreur.message, motif: 'fournisseur_en_erreur' },
        502);
    }

    const resultat = resultatCandidatsEtapeValide(brut);
    if (!resultat) {
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'resultat_candidats_invalide',
      });
      return reponse({
          ok: false,
          error: REFUS_CANDIDATS.resultat_candidats_invalide.message,
          motif: 'resultat_candidats_invalide',
        },
        500);
    }

    if (!resultat.ok) {
      // ⚠️ LA CAUSE FINE VA AU JOURNAL, ET NULLE PART AILLEURS.
      //
      // Le motif public ne change pas, et le nom d'un champ interne n'a rien
      // à faire devant l'utilisateur. Une seule ligne, et seulement pour ce
      // motif : les autres n'ont pas de détail à donner, et
      // `fournisseur_en_erreur` porte un message de fournisseur qu'on ne
      // recopie surtout pas.
      if (resultat.motif === 'resultat_candidats_invalide' && resultat.detail !== undefined) {
        console.warn(
          `[autopilote][candidats] resultat_candidats_invalide generation=${generation.id} `
          + `diagnostic=${diagnosticCandidatsSur(resultat.detail)}`,
        );
      }
      const refus = REFUS_CANDIDATS[resultat.motif] ?? REFUS_CANDIDATS.resultat_candidats_invalide;
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: resultat.motif,
      });
      return reponse({ ok: false, error: refus.message, motif: resultat.motif }, refus.statut);
    }

    // ── LA SEULE ÉCRITURE DE `reussie` DE TOUT LE CHEMIN ──────────────────
    //
    // Ceinture de dernier moment : le contrat borne déjà la liste, mais ce
    // qui entre en base ne doit jamais dépendre d'un seul contrôle.
    const candidats = resultat.candidats.slice(0, CANDIDATS_MAX);

    const clot = await majGeneration(userId, generation.id, {
      etat: 'reussie',
      etape: 'candidats',
      // ⚠️ LE MODÈLE RÉELLEMENT EMPLOYÉ, pas l'étiquette générique posée
      // avant l'appel. La valeur vient d'une CONSTANTE de l'adaptateur,
      // jamais d'un champ de la réponse.
      fournisseurs: {
        candidats: { ...FOURNISSEUR_CANDIDATS, modele: resultat.modele },
      },
      candidats,
      usage: resultat.usage,
      motifEchec: null,
    });
    if (!clot.ok) {
      return reponse({ ok: false, error: 'Résultat non consigné.', motif: clot.motif }, 409);
    }

    const { generation: finale } = await lireDerniereGeneration(userId, analyse.id);
    return reponse({ ok: true, generation: finale }, 201);
}
