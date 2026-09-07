/**
 * A_0 — LA CHAÎNE M3, DEPUIS UN CRON.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE JUMEAU SERVEUR DE `chaine-passerelle`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `analyse/chaine-passerelle.ts` enchaîne les trois routes M3 depuis le
 * NAVIGATEUR : `fetch` relatif, `credentials: 'same-origin'`, attente par
 * sondages, phrases françaises destinées à un écran. Rien de cela n'est
 * utilisable depuis un cron — qui n'a ni origine, ni cookie, ni écran.
 *
 * Ce module fait le même parcours en appelant DIRECTEMENT les services, qui
 * prennent tous `userId` en premier paramètre et ne lisent aucune session.
 * Aucune route HTTP n'est appelée, aucun navigateur n'est lancé, aucune
 * authentification n'est contournée : le cron est déjà autorisé par son
 * secret, et les services filtrent la propriété dans leurs requêtes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE CE MODULE NE DÉCIDE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucune règle éditoriale n'est réécrite ici. Les coupes viennent de
 * `calerCoupes`, la politique de `politiqueDePlan`, le plan de
 * `planifierMontage`, le rendu de `rendreEtPublier`, l'objectif de
 * `objectifEffectifUtilisateur`. Ce module ORDONNE ces appels, et rien de
 * plus — c'est précisément ce qui garantit que le mode automatique et le
 * mode manuel montent avec la MÊME intelligence.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ IL ATTEND, LÀ OÙ LES ROUTES RENDENT 202
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les routes détachent le travail long et répondent tout de suite : un
 * navigateur ne peut pas tenir une requête de trois minutes. Un cron, si —
 * il a `maxDuration`. Le travail est donc attendu, ce qui supprime tout le
 * sondage et rend l'issue immédiatement lisible.
 */
import { lireRush } from '@/lib/autopilot/tournage/service';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import {
  lireGenerationParId,
} from '@/lib/autopilot/analyse/candidat-service';
import {
  lireDerniereTranscriptionReussie,
} from '@/lib/autopilot/analyse/transcription-service';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';
import { ALGORITHME_COUPES } from '@/lib/autopilot/analyse/coupe-contrat';
import {
  creerSet, lireSetReussiIdentique, majSet, lireSetParId,
} from '@/lib/autopilot/analyse/clip-service';
import { materialiserSet, coupesRetenues } from '@/lib/autopilot/analyse/clip';
import {
  METHODE_MATERIALISATION, type IdentiteClipSet, type MotifClips,
} from '@/lib/autopilot/analyse/clip-contrat';
import { objectifEffectifUtilisateur } from '@/lib/autopilot/analyse/objectif-compte';
import { politiqueDePlan } from '@/lib/autopilot/analyse/objectif-score';
import { planifierMontage, geometrieDepuisTechnique } from '@/lib/autopilot/analyse/montage';
import {
  ALGORITHME_PLAN, dimensionsCible, type IdentitePlan, type FormatMontage,
} from '@/lib/autopilot/analyse/montage-contrat';
import { creerPlan, lirePlanIdentique } from '@/lib/autopilot/analyse/montage-service';
import { lireProfilCreatifUtilisateur } from '@/lib/autopilot/analyse/profil-compte';
import { methodeRendu, type IdentiteRendu } from '@/lib/autopilot/analyse/rendu-contrat';
import {
  creerRendu, lireRenduReussiIdentique, majRendu,
} from '@/lib/autopilot/analyse/rendu-service';
import { rendreEtPublier } from '@/lib/autopilot/analyse/rendu';
import type { RecetteAudio } from '@/lib/autopilot/analyse/recette-audio';
import type { IssueM3, MotifM3 } from './contrat';

export interface DemandeM3Automatique {
  userId: string;
  rushId: string;
  analysisId: string;
  candidateSetId: string;
  format: FormatMontage;
  dureeCibleSecondes: number;
  /** La recette audio du compte — musique, volumes, son du rush. */
  recette: RecetteAudio | null;
}

const echec = (motif: MotifM3, detail: string | null = null): IssueM3 =>
  ({ sorte: 'echec', motif, detail });

/**
 * Monte une vidéo avec la chaîne M3, de bout en bout, sans écran.
 *
 * Rend TOUJOURS une issue, jamais une exception : un cron qui traite dix
 * comptes ne doit pas s'arrêter au premier rush abîmé.
 */
export async function monterAvecM3(d: DemandeM3Automatique): Promise<IssueM3> {
  const { userId } = d;

  // ── La matière : génération, analyse, rush, transcription ────────────
  const { generation } = await lireGenerationParId(userId, d.candidateSetId);
  if (!generation || generation.etat !== 'reussie') {
    return { sorte: 'ignore', motif: 'candidats_absents' };
  }
  const { analyse } = await lireAnalyse(userId, d.analysisId);
  if (!analyse || analyse.etat !== 'reussie') {
    return { sorte: 'ignore', motif: 'analyse_absente' };
  }
  const { rush } = await lireRush(userId, generation.rushId);
  if (!rush) return { sorte: 'ignore', motif: 'aucun_rush_analyse' };

  const { transcription } = await lireDerniereTranscriptionReussie(userId, generation.rushId);

  // ── M3-E, calculé comme la route des clips le calcule ────────────────
  const decision = calerCoupes({
    dureeRushSecondes: analyse.dureeSecondes ?? 0,
    candidats: generation.candidats,
    silences: Array.isArray(analyse.audio?.silences)
      ? (analyse.audio.silences as { debutSecondes: number; finSecondes: number }[])
      : [],
    audioEtatMesure: analyse.audio?.etatMesure === 'mesuree' ? 'mesuree'
      : analyse.audio?.etatMesure === 'absente' ? 'absente' : 'indisponible',
    transcriptionRetenue: transcription !== null,
    parolePresente: transcription?.presente === true,
    segments: transcription?.segments ?? [],
    mots: transcription?.mots ?? [],
  });
  if (coupesRetenues(decision.coupes).length === 0) {
    return { sorte: 'ignore', motif: 'coupes_vides' };
  }

  // ── M3-F : les clips ─────────────────────────────────────────────────
  const identiteClips: IdentiteClipSet = {
    candidateSetId: generation.id,
    candidateSetVersion: generation.version,
    rushId: generation.rushId,
    analysisId: generation.analysisId,
    transcriptionId: transcription?.id ?? null,
    transcriptionVersion: transcription?.version ?? null,
    algorithme: ALGORITHME_COUPES,
    methodeMaterialisation: METHODE_MATERIALISATION,
  };

  /* ⚠️ LA RÉUTILISATION D'ABORD, comme la route. M3-F est déterministe :
     refaire les mêmes bornes sur les mêmes octets coûterait des minutes de
     CPU pour un fichier identique. */
  let clipSetId: string | null = null;
  const dejaLa = await lireSetReussiIdentique(userId, identiteClips);
  if (dejaLa.motif === 'socle_absent') return echec('socle_absent');
  if (dejaLa.set) {
    clipSetId = dejaLa.set.id;
  } else {
    const creation = await creerSet(userId, identiteClips);
    if (creation.motif === 'socle_absent') return echec('socle_absent');
    if (!creation.set) return echec('clips_echoues', creation.motif ?? null);
    clipSetId = creation.set.id;

    await majSet(userId, clipSetId, { etat: 'en_cours', etape: 'extraction', demarre: true });
    const materiel = await materialiserSet({
      userId,
      clipSetId,
      source: { bucket: rush.bucket, cleObjet: rush.cleObjet, userId },
      coupes: decision.coupes,
      signaler: async (cles) => {
        await majSet(userId, clipSetId as string, { usage: { objetsEnLigne: cles } });
      },
    });
    if (!materiel.ok) {
      await majSet(userId, clipSetId, {
        etat: 'echouee', motifEchec: materiel.motif as MotifClips,
        usage: materiel.usage, termine: true,
      });
      return echec('clips_echoues', materiel.motif ?? null);
    }
    await majSet(userId, clipSetId, {
      etat: 'reussie', etape: 'televersement',
      clips: materiel.clips, usage: materiel.usage, motifEchec: null, termine: true,
    });
  }

  const { set } = await lireSetParId(userId, clipSetId);
  if (!set || set.etat !== 'reussie' || set.clips.length === 0) {
    return echec('clips_echoues', 'jeu de clips inexploitable');
  }

  // ── M3-G : le plan ───────────────────────────────────────────────────
  //
  // L'objectif du COMPTE, sans surcharge : le cron ne décide pas d'un
  // objectif par vidéo, il applique celui que la personne a enregistré.
  const objectif = await objectifEffectifUtilisateur(userId);
  const politique = politiqueDePlan(
    set.clips.map((c) => ({ rang: c.rang, scoreMontage: c.scoreMontage, signaux: c.signaux })),
    objectif,
    ALGORITHME_PLAN,
  );
  const identitePlan: IdentitePlan = {
    clipSetId: set.id,
    clipSetVersion: set.version,
    candidateSetId: set.candidateSetId,
    analysisId: set.analysisId,
    algorithme: set.algorithme,
    methodeMaterialisation: set.methodeMaterialisation,
    algorithmePlan: politique.algorithmePlan,
    format: d.format,
    dureeCibleSecondes: d.dureeCibleSecondes,
  };

  let planId: string | null = null;
  let planVersion = 0;
  const planDejaLa = await lirePlanIdentique(userId, identitePlan);
  if (planDejaLa.motif === 'socle_absent') return echec('socle_absent');
  if (planDejaLa.plan) {
    planId = planDejaLa.plan.id;
    planVersion = planDejaLa.plan.version;
  } else {
    const geometrie = geometrieDepuisTechnique(analyse.technique);
    if (geometrie === null) return echec('plan_impossible', 'géométrie inconnue');
    const { resultat } = planifierMontage({
      clips: set.clips,
      format: d.format,
      dureeCibleSecondes: d.dureeCibleSecondes,
      geometrie,
      dureeRushSecondes: analyse.dureeSecondes ?? undefined,
      politique,
    });
    if (!resultat) return echec('plan_impossible', 'aucun plan possible');
    const cible = dimensionsCible(d.format);
    const creation = await creerPlan(userId, identitePlan, {
      largeurCible: cible.largeur,
      hauteurCible: cible.hauteur,
      // La cadence MESURÉE du rush, pas une valeur choisie ici.
      fps: geometrie.fps,
      plans: resultat.plans,
      dureeTotaleSecondes: resultat.dureeTotaleSecondes,
      ecartSecondes: resultat.ecartSecondes,
      clipsEcartes: resultat.clipsEcartes,
      usage: resultat.usage,
    });
    if (!creation.plan) return echec('plan_impossible', creation.motif ?? null);
    planId = creation.plan.id;
    planVersion = creation.plan.version;
  }

  // ── M3-H : le rendu ──────────────────────────────────────────────────
  const profil = await lireProfilCreatifUtilisateur(userId);
  const identiteRendu: IdentiteRendu = {
    montagePlanId: planId,
    montagePlanVersion: planVersion,
    methodeRendu: methodeRendu(d.recette, profil),
  };
  const renduDejaLa = await lireRenduReussiIdentique(userId, identiteRendu);
  if (renduDejaLa.motif === 'socle_absent') return echec('socle_absent');
  if (renduDejaLa.rendu?.resultat) {
    return {
      sorte: 'reussi',
      renduId: renduDejaLa.rendu.id,
      planId,
      rushId: generation.rushId,
      videoUrl: renduDejaLa.rendu.resultat.cle,
      vignetteUrl: null,
      dureeSecondes: renduDejaLa.rendu.resultat.dureeMesureeSecondes,
    };
  }

  const creationRendu = await creerRendu(userId, identiteRendu);
  if (!creationRendu.rendu) return echec('rendu_echoue', creationRendu.motif ?? null);
  const renduId = creationRendu.rendu.id;

  const { plan } = await lirePlanIdentique(userId, identitePlan);
  if (!plan) return echec('rendu_echoue', 'plan introuvable après création');

  await majRendu(userId, renduId, { etat: 'en_cours', demarre: true, siEtat: ['en_attente'] });
  const issue = await rendreEtPublier(
    {
      userId,
      plan,
      recette: d.recette,
      profil,
      avancer: async (etape) => {
        const r = await majRendu(userId, renduId, {
          etape, siEtat: ['en_attente', 'en_cours'],
        });
        return r.motif === 'rendu_absent' ? 'rendu_absent' : null;
      },
    },
    renduId,
    {
      consigner: async (bucket, cle, mesure, usage) => {
        const r = await majRendu(userId, renduId, {
          etat: 'reussie', etape: 'televersement', termine: true,
          resultat: { ...mesure, bucket, cle }, usage,
          siEtat: ['en_attente', 'en_cours'],
        });
        if (r.motif === 'rendu_absent') return 'rendu_absent';
        if (r.motif !== null || !r.rendu) return 'non_consigne';
        return 'consigne';
      },
      clore: async (motif, usage) => {
        await majRendu(userId, renduId, {
          etat: 'echouee', motifEchec: motif, termine: true, usage,
          siEtat: ['en_attente', 'en_cours'],
        });
      },
    },
  );

  if (!issue.ok || !issue.mesure) {
    return echec('rendu_echoue', issue.motif ?? null);
  }
  /* La ligne vient d'être consignée : on la relit pour rendre la clé de
     stockage telle qu'elle a été écrite, plutôt que de la reconstruire. */
  const consigne = await lireRenduReussiIdentique(userId, identiteRendu);
  const cle = consigne.rendu?.resultat?.cle ?? null;
  if (cle === null) return echec('rendu_echoue', 'rendu non consigné');
  return {
    sorte: 'reussi',
    renduId,
    planId,
    rushId: generation.rushId,
    videoUrl: cle,
    vignetteUrl: null,
    // ⚠️ LA DURÉE MESURÉE PAR `ffprobe`, jamais celle demandée au plan.
    dureeSecondes: issue.mesure.dureeMesureeSecondes,
  };
}
