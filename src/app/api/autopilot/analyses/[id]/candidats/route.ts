/**
 * M3-C — LA ROUTE DES CANDIDATS DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE GARANTIT, ET DANS QUEL ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. La session, et rien d'autre, décide de `user_id`.
 *   2. L'analyse est lue AVEC le filtre de propriété : une analyse d'autrui
 *      ne revient pas, donc il n'y a rien à décider ici.
 *   3. Elle doit être `reussie` : générer des candidats depuis une analyse
 *      échouée reviendrait à travailler sur un résultat qu'on sait faux.
 *   4. La ligne de génération est créée AVANT tout travail — elle existe
 *      donc même si le processus meurt.
 *   5. L'idempotence est portée par `rush_candidate_sets_active_unique`, EN
 *      BASE. Cette route ne fait aucun `select` qui autoriserait l'insertion.
 *   6. Le moteur est appelé UNE fois. Aucune reprise.
 *
 * ⚠️ AUCUN DÉBIT DE CRÉDITS. `usage` est une mesure. Ce fichier n'importe pas
 * `@/lib/credits`, et un test le vérifie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import {
  chargerMoteurCandidats, resultatCandidatsEtapeValide,
  FOURNISSEUR_CANDIDATS, diagnosticCandidatsSur,
} from '@/lib/autopilot/analyse/moteur-candidat';
import {
  creerGeneration, majGeneration, lireDerniereGeneration,
} from '@/lib/autopilot/analyse/candidat-service';
import { CANDIDATS_MAX } from '@/lib/autopilot/analyse/candidat-contrat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Le budget de la plateforme.
 *
 * Une requête au fournisseur bornée à quarante secondes, plus la lecture de
 * huit images. Cent vingt secondes laissent une marge large sans jamais
 * laisser une génération courir indéfiniment.
 */
export const maxDuration = 120;

/** Le message d'un socle non appliqué — le même esprit qu'en M3-B1. */
const SOCLE_CANDIDATS_ABSENT =
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // L'analyse d'abord : une génération ne se lit pas sans son analyse, et
    // le filtre de propriété vit dans cette lecture.
    const { analyse, motif } = await lireAnalyse(userId, params.id);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnue ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence de l'analyse d'un tiers.
    if (!analyse) {
      return NextResponse.json({ ok: false, error: 'Analyse introuvable' }, { status: 404 });
    }

    const { generation, motif: motifGen } = await lireDerniereGeneration(userId, params.id);
    if (motifGen === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, generation });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // ── L'analyse source ──────────────────────────────────────────────────
    const { analyse, motif } = await lireAnalyse(userId, params.id);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (!analyse) {
      return NextResponse.json({ ok: false, error: 'Analyse introuvable' }, { status: 404 });
    }

    // ⚠️ `reussie`, ET PAS SEULEMENT « terminée ».
    //
    // Une analyse `echouee` porte parfois une extraction valide et un visuel
    // manquant. Y chercher des passages reviendrait à demander au modèle de
    // choisir des moments dans une description qui n'existe pas.
    if (analyse.etat !== 'reussie') {
      return NextResponse.json(
        {
          ok: false,
          error: 'L’analyse doit être terminée avec succès.',
          motif: 'analyse_non_reussie',
        },
        { status: 409 },
      );
    }

    const duree = analyse.dureeSecondes;
    if (typeof duree !== 'number' || !Number.isFinite(duree) || duree <= 0) {
      return NextResponse.json(
        { ok: false, error: REFUS_CANDIDATS.analyse_inexploitable.message, motif: 'analyse_inexploitable' },
        { status: 422 },
      );
    }
    if (!Array.isArray(analyse.vignettes) || analyse.vignettes.length === 0) {
      return NextResponse.json(
        { ok: false, error: REFUS_CANDIDATS.aucune_image.message, motif: 'aucune_image' },
        { status: 422 },
      );
    }

    // ── La ligne, AVANT tout travail ──────────────────────────────────────
    const creation = await creerGeneration(userId, analyse.id, analyse.rushId);
    if (creation.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (creation.motif === 'generation_active_existante') {
      // 409 : la contrainte de la base a tranché, pas un `if` de cette route.
      return NextResponse.json(
        {
          ok: false,
          error: 'Une recherche de passages est déjà en cours pour cette analyse.',
          motif: 'generation_active_existante',
        },
        { status: 409 },
      );
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
      return NextResponse.json(
        { ok: false, error: REFUS_CANDIDATS.fournisseur_absent.message, motif: 'fournisseur_absent' },
        { status: 503 },
      );
    }

    if (!moteur) {
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'fournisseur_absent',
      });
      return NextResponse.json(
        { ok: false, error: REFUS_CANDIDATS.fournisseur_absent.message, motif: 'fournisseur_absent' },
        { status: 503 },
      );
    }

    await majGeneration(userId, generation.id, { etat: 'en_cours', etape: 'candidats' });

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
      });
    } catch {
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'fournisseur_en_erreur',
      });
      return NextResponse.json(
        { ok: false, error: REFUS_CANDIDATS.fournisseur_en_erreur.message, motif: 'fournisseur_en_erreur' },
        { status: 502 },
      );
    }

    const resultat = resultatCandidatsEtapeValide(brut);
    if (!resultat) {
      await majGeneration(userId, generation.id, {
        etat: 'echouee', etape: 'candidats', motifEchec: 'resultat_candidats_invalide',
      });
      return NextResponse.json(
        {
          ok: false,
          error: REFUS_CANDIDATS.resultat_candidats_invalide.message,
          motif: 'resultat_candidats_invalide',
        },
        { status: 500 },
      );
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
      return NextResponse.json(
        { ok: false, error: refus.message, motif: resultat.motif }, { status: refus.statut },
      );
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
      return NextResponse.json(
        { ok: false, error: 'Résultat non consigné.', motif: clot.motif }, { status: 409 },
      );
    }

    const { generation: finale } = await lireDerniereGeneration(userId, analyse.id);
    return NextResponse.json({ ok: true, generation: finale }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  }
}

/** Les textes visibles, tels que M3-B4 les a validés. */
type ContexteTextes = ReadonlyArray<{ texte: string; seconde: number; confiance: number }>;
