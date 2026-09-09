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
import { lireDerniereAnalyse } from '@/lib/autopilot/analyse/service';
import { analyseActive } from '@/lib/autopilot/analyse/contrat';
import { executerAnalyseRush } from '@/lib/autopilot/analyse/analyse-orchestration';
import {
  genererCandidatsPourAnalyse,
} from '@/lib/autopilot/analyse/candidat-orchestration';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import {
  lireGenerationParId, lireDerniereGeneration,
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
import {
  lireProfilCreatifUtilisateur, lireBibliothequeUtilisateur, lireJumeauUtilisateur,
} from '@/lib/autopilot/analyse/profil-compte';
import { jumeauHistorique } from '@/lib/avatar/jumeau';
import { resoudreJumeauDuCompte } from '@/lib/avatar/jumeau-serveur';
import { listerCreatifsRecents } from '@/lib/autopilot/analyse/rendu-service';
import { preparerCaptionsMultiSource } from '@/lib/autopilot/analyse/captions-service';
import { PROFIL_CREATIF_DEFAUT } from '@/lib/autopilot/analyse/profil-creatif';
import { BUCKET_MUSIQUE } from '@/lib/autopilot/analyse/recette-audio';
import {
  resoudreStyleEffectif, graineCreative, historiqueDepuisUsages,
  type ChoixCreatifs,
} from '@/lib/autopilot/analyse/politique-creative';
import {
  resoudreMusiqueEffective, historiqueAudioDepuisUsages, type IssueAudio,
} from '@/lib/autopilot/analyse/politique-audio';
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
  /** `null` : la chaîne lancera l'analyse elle-même. */
  analysisId: string | null;
  /** `null` : la chaîne demandera les candidats elle-même. */
  candidateSetId: string | null;
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

/**
 * Prépare un rush brut : analyse, puis candidats — mais seulement si besoin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ NE JAMAIS RAPPELER UN FOURNISSEUR DONT LE RÉSULTAT EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'analyse fait tourner ffmpeg et un moteur visuel ; les candidats font
 * tourner Sonnet. Les deux coûtent du temps et de l'argent, et leurs
 * résultats sont persistés. Chaque étape commence donc par une LECTURE, et ne
 * travaille que si cette lecture ne rend rien d'exploitable.
 *
 * ⚠️ ET NE JAMAIS DOUBLER UN TRAVAIL EN VOL. Une analyse `en_attente` ou
 * `en_cours` — lancée par un humain il y a deux minutes, ou par le cycle
 * précédent — n'est ni une réussite ni un échec. La base l'interdirait de
 * toute façon (`rush_analyses_active_unique`, qui rend 409), mais s'y
 * heurter ferait remonter un échec là où il n'y a qu'une attente. On rend
 * « ignoré », et le cycle suivant reprendra.
 */
/**
 * ⚠️ EXPORTEE PAR A_7d, ET NON RECOPIEE. Le montage multi-rush doit preparer
 * plusieurs rushes ; en ecrire une seconde version donnerait deux facons
 * d'analyser, et le jour ou l'une serait corrigee, l'autre continuerait.
 */
export async function preparerRush(
  userId: string, rushId: string,
  analysisId: string | null, candidateSetId: string | null,
): Promise<{ analysisId: string; candidateSetId: string } | IssueM3> {
  let idAnalyse = analysisId;

  if (idAnalyse === null) {
    const { analyse } = await lireDerniereAnalyse(userId, rushId);
    if (analyse && analyseActive(analyse.etat)) {
      return { sorte: 'ignore', motif: 'analyse_en_cours' };
    }
    if (analyse?.etat === 'reussie') {
      idAnalyse = analyse.id;
    } else {
      const { rush } = await lireRush(userId, rushId);
      if (!rush) return { sorte: 'ignore', motif: 'aucun_rush_analyse' };
      /* LA MEME fonction que le bouton « Analyser » de l'écran : ni copie, ni
         variante. C'est ce qui garantit que l'automatique et le manuel
         analysent exactement pareil. */
      const r = await executerAnalyseRush(userId, rushId, rush);
      if (r.statut !== 201) {
        return r.statut === 409 || r.statut === 429
          ? { sorte: 'ignore', motif: 'analyse_en_cours' }
          : { sorte: 'echec', motif: 'analyse_echouee', detail: String(r.corps.motif ?? r.statut) };
      }
      const apres = await lireDerniereAnalyse(userId, rushId);
      if (apres.analyse?.etat !== 'reussie') {
        return { sorte: 'echec', motif: 'analyse_echouee', detail: null };
      }
      idAnalyse = apres.analyse.id;
    }
  }

  let idCandidats = candidateSetId;
  if (idCandidats === null) {
    const { generation } = await lireDerniereGeneration(userId, idAnalyse);
    if (generation && (generation.etat === 'en_attente' || generation.etat === 'en_cours')) {
      return { sorte: 'ignore', motif: 'candidats_en_cours' };
    }
    if (generation?.etat === 'reussie') {
      idCandidats = generation.id;
    } else {
      // LA MEME fonction que « Trouver les meilleurs passages ».
      const r = await genererCandidatsPourAnalyse(userId, idAnalyse);
      if (r.statut !== 201) {
        return r.statut === 409 || r.statut === 429
          ? { sorte: 'ignore', motif: 'candidats_en_cours' }
          : { sorte: 'echec', motif: 'candidats_echoues', detail: String(r.corps.motif ?? r.statut) };
      }
      const apres = await lireDerniereGeneration(userId, idAnalyse);
      if (apres.generation?.etat !== 'reussie') {
        return { sorte: 'echec', motif: 'candidats_echoues', detail: null };
      }
      idCandidats = apres.generation.id;
    }
  }
  return { analysisId: idAnalyse, candidateSetId: idCandidats };
}

/**
 * D'UN RUSH PRET A UN JEU DE CLIPS MONTABLE — extraite par A_7d.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ EXTRAITE, PAS RECOPIEE, ET C'EST TOUT L'INTERET
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Ce bloc — lire la matiere, caler les coupes avec M3-E, materialiser les
 * clips avec M3-F, ou reutiliser un jeu identique — vivait au milieu de
 * `monterAvecM3`. Le montage multi-rush doit le faire pour CHAQUE source ; en
 * ecrire une seconde version aurait donne deux facons de decouper, et le jour
 * ou l'une aurait ete corrigee, l'autre aurait continue de produire des clips
 * calcules autrement.
 *
 * `monterAvecM3` l'appelle desormais pour son unique rush : le chemin
 * mono-rush parcourt donc exactement le meme code qu'avant, et les tests
 * d'A_0 le verifient.
 *
 * ⚠️ LA REUTILISATION D'ABORD. M3-F est deterministe : refaire les memes
 * bornes sur les memes octets couterait des minutes de CPU pour un fichier
 * identique.
 */
export async function preparerJeuClips(
  userId: string, analysisId: string, candidateSetId: string,
): Promise<{
  ok: true;
  set: NonNullable<Awaited<ReturnType<typeof lireSetParId>>['set']>;
  analyse: NonNullable<Awaited<ReturnType<typeof lireAnalyse>>['analyse']>;
  rushId: string;
} | IssueM3> {
  const pret = { analysisId, candidateSetId };
  // ── La matière : génération, analyse, rush, transcription ────────────
  const { generation } = await lireGenerationParId(userId, pret.candidateSetId);
  if (!generation || generation.etat !== 'reussie') {
    return { sorte: 'ignore', motif: 'candidats_absents' };
  }
  const { analyse } = await lireAnalyse(userId, pret.analysisId);
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

  return { ok: true, set, analyse, rushId: generation.rushId };
}

export async function monterAvecM3(
  d: DemandeM3Automatique & {
    /**
     * A_7d — LES AUTRES RUSHES a assembler avec `rushId`.
     *
     * ⚠️ ABSENT OU VIDE = LE CHEMIN MONO-RUSH, A LA LIGNE PRES. C'est celui de
     * tous les comptes qui n'ont rien demande, et de tous les cycles deja
     * produits — il ne bouge pas.
     */
    rushIdsSupplementaires?: readonly string[];
  },
): Promise<IssueM3> {
  const { userId } = d;

  /* ── La préparation, si le rush est brut ──────────────────────────────
     ⚠️ C'EST CE QUI FAIT D'A_0b UN AUTOPILOTE. Avant ce lot, un rush sans
     analyse faisait simplement ignorer le cycle : la production automatique
     s'arrêtait à ce qu'un humain avait bien voulu préparer. */
  const pret = await preparerRush(userId, d.rushId, d.analysisId, d.candidateSetId);
  if ('sorte' in pret) return pret;

  const prepare = await preparerJeuClips(userId, pret.analysisId, pret.candidateSetId);
  if (!('ok' in prepare)) return prepare;
  const { set, analyse, rushId: rushMonte } = prepare;

  /* ══ A_7d — LE PLAN MULTI-RUSH, QUAND PLUSIEURS RUSHES SONT DEMANDES ══
     ⚠️ SEULE LA SOURCE DU PLAN CHANGE. Tout ce qui suit — le profil, le
     style, la graine, la recette audio, les sous-titres, le rendu, la
     consignation — est le code d'avant, intouche. Un plan multi-rush est un
     plan : il porte un identifiant, une version, des segments, et M3-H sait
     deja le rendre depuis A_7c.

     ⚠️ ET IL RETOMBE SUR LE MONO PLUTOT QUE D'ECHOUER. Si une seule source
     survit a la preparation ou au palier de qualite d'A_7b, ce n'est PAS un
     montage multi-rush : lui donner une empreinte le ferait basculer sous
     l'index d'A_7M et rendrait introuvables des MP4 deja produits. Le code
     poursuit alors sur le chemin historique, avec le rush deja prepare. */
  const autres = (d.rushIdsSupplementaires ?? []).filter((id) => id !== d.rushId);
  let planMulti: { id: string; version: number } | null = null;
  if (autres.length > 0) {
    const { monterMultiRush } = await import('./multi-rush');
    const multi = await monterMultiRush({
      userId,
      rushIds: [d.rushId, ...autres],
      format: d.format,
      dureeCibleSecondes: d.dureeCibleSecondes,
      objectif: await objectifEffectifUtilisateur(userId),
    });
    if (multi.plan) {
      planMulti = { id: multi.plan.id, version: multi.plan.version };
    } else if (multi.motif !== null && multi.motif !== 'source_unique') {
      /* Une panne de persistance ou un plan impossible ne se contourne pas en
         montant un seul rush : la demande portait sur plusieurs. */
      return echec('plan_impossible', multi.motif);
    }
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

  let planId: string | null = planMulti?.id ?? null;
  let planVersion = planMulti?.version ?? 0;
  const planDejaLa = planMulti ? { plan: null, motif: null }
    : await lirePlanIdentique(userId, identitePlan);
  if (planDejaLa.motif === 'socle_absent') return echec('socle_absent');
  if (planMulti) {
    // Le plan est deja ecrit — atomiquement, par la RPC d'A_7B0.
  } else if (planDejaLa.plan) {
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

  /* ⚠️ SANS PLAN, PAS DE RENDU — et la garde est explicite plutot que deduite.
     Les trois chemins ci-dessus (multi-rush, plan deja la, plan cree) posent
     tous `planId` ; celui qui ne le poserait pas laisserait la suite rendre
     sous un identifiant nul, et la consignation ecrirait un post pointant
     vers rien. */
  if (planId === null) return echec('plan_impossible', 'plan introuvable');

  // ── M3-H : le rendu ──────────────────────────────────────────────────
  const profil = await lireProfilCreatifUtilisateur(userId);

  /* ── LE STYLE DE CETTE VIDEO-CI ───────────────────────────────────────
     ⚠️ LE PROFIL PORTE CE QUI EST PERMIS ; ICI ON EN TIRE CE QUI EST FAIT.
     En « Marque stricte » — le defaut — RIEN ne se passe : le profil part au
     rendu tel quel, et le graphe emis est celui d'avant ce lot, au caractere
     pres. La variation n'existe que si la personne l'a demandee.

     ⚠️ AUCUN TIRAGE AU SORT. La graine tient au compte, au plan et a la
     version de la politique : un cron qui reessaie le meme plan refait
     EXACTEMENT la meme video, et `lireRenduReussiIdentique` la retrouve au
     lieu de la recalculer. */
  const biblio = await lireBibliothequeUtilisateur(userId);

  /* ── LA PERSONNE NUMERIQUE, SI ELLE A ETE DEMANDEE — A_8f ────────────
     ⚠️ ETEINTE, ELLE NE COUTE RIEN ET NE CHANGE RIEN. `jumeauHistorique`
     sort immediatement pour l'immense majorite des comptes : le chemin
     d'avant ce lot est strictement inchange, sans une requete de plus.

     ⚠️ ALLUMEE, ELLE NE PEUT PAS ETRE IGNOREE. Le portail revalide TOUT sur
     les lignes de la base — un clone valide il y a un mois a pu etre
     supprime depuis, une voix a pu disparaitre. Et meme « pret » ne produit
     rien aujourd'hui : l'integration du fournisseur appartient a A_8_FINAL,
     et pretendre le contraire fabriquerait une video ordinaire que la
     personne croirait etre la sienne. */
  const configJumeau = await lireJumeauUtilisateur(userId);
  if (!jumeauHistorique(configJumeau) && configJumeau.active) {
    const { issue } = await resoudreJumeauDuCompte(userId, configJumeau);
    if (issue.etat === 'bloque') {
      return { sorte: 'ignore', motif: 'jumeau_non_pret' };
    }
    if (issue.etat === 'pret') {
      return { sorte: 'ignore', motif: 'jumeau_indisponible' };
    }
  }
  let profilEffectif = profil;
  let variation: { politiqueVersion: string; raison: string } | null = null;
  /* ⚠️ LU UNE SEULE FOIS POUR LES DEUX POLITIQUES. Deux lectures du meme
     historique coûteraient deux requetes pour la meme verite. */
  let historiqueUsages: Record<string, unknown>[] = [];
  if (biblio.automatisation.mode !== 'marque-stricte'
    || biblio.automatisation.audioMode !== 'fixe') {
    try {
      historiqueUsages = await listerCreatifsRecents(userId);
    } catch {
      // Sans historique, on choisit quand meme — sans eviter les repetitions.
    }
  }
  if (biblio.automatisation.mode !== 'marque-stricte') {
    const historique: ChoixCreatifs[] = historiqueDepuisUsages(historiqueUsages);
    const issue = resoudreStyleEffectif(
      profil ?? PROFIL_CREATIF_DEFAUT,
      biblio.automatisation,
      biblio.presets,
      {
        graine: graineCreative(
          userId, planId, planVersion, biblio.automatisation.version,
        ),
        historique,
      },
    );
    profilEffectif = issue.profil;
    variation = {
      politiqueVersion: biblio.automatisation.version,
      raison: issue.raison,
    };
  }
  /* ⚠️ LE MEME OBJECTIF QUE LE PLAN, RELU UNE SEULE FOIS. C'est lui qui porte
     le message du CTA — ce que le bandeau DIT, par opposition a la maniere de
     l'afficher. Le reprendre ici garantit que la video automatique affiche
     exactement l'appel a l'action que la personne a ecrit. */
  const appelAction = objectif.appelAction ?? null;
  /* ── LA MUSIQUE DE CETTE VIDEO-CI ─────────────────────────────────────
     ⚠️ EN MODE FIXE — LE DEFAUT — LA RECETTE PART TELLE QUELLE, et le graphe
     emis est celui d'avant ce lot. La variation n'existe que si la personne
     l'a demandee, et elle est DETERMINISTE : meme compte, meme plan, meme
     politique, meme musique — sans quoi un cron qui reessaie changerait de
     bande-son a chaque tentative, et l'identite du rendu avec elle. */
  let recetteEffective = d.recette;
  let variationAudio: IssueAudio | null = null;
  if (biblio.automatisation.audioMode !== 'fixe' && d.recette) {
    const issue = resoudreMusiqueEffective(
      d.recette.musique,
      biblio.automatisation.audioMode,
      biblio.automatisation.autorises.audio,
      biblio.audio.pistes,
      {
        graine: graineCreative(
          userId, planId, planVersion, biblio.automatisation.version,
        ),
        historique: historiqueAudioDepuisUsages(historiqueUsages),
      },
    );
    recetteEffective = { ...d.recette, musique: issue.musique };
    variationAudio = issue;
  }

  /* ── LA VOIX-OFF DU COMPTE ────────────────────────────────────────────
     ⚠️ ELLE EST REUTILISEE, ELLE N'EST PAS REECRITE. L'Autopilote fait dire a
     la voix de la personne les mots QU'ELLE a ecrits une fois — jamais une
     phrase qu'une machine aurait composee a sa place. Studiio ne genere aucun
     script, et il n'y a rien a desactiver pour cela : ce chemin n'en contient
     pas.

     ⚠️ ET UN PROFIL D'HIER N'EN A PAS. `voixOff` vaut `null` tant que personne
     n'a enregistre de voix : la video rendue est exactement celle d'avant. */
  if (biblio.voixOff && recetteEffective) {
    recetteEffective = {
      ...recetteEffective,
      voix: {
        bucket: BUCKET_MUSIQUE,
        cle: biblio.voixOff.cle,
        version: biblio.voixOff.empreinte,
      },
    };
  }

  const identiteRendu: IdentiteRendu = {
    montagePlanId: planId,
    montagePlanVersion: planVersion,
    // ⚠️ LES CHOIX EFFECTIFS, PAS LA LISTE AUTORISEE : deux videos aux
    // looks differents doivent etre deux fichiers differents.
    methodeRendu: methodeRendu(recetteEffective, profilEffectif, appelAction),
  };
  const renduDejaLa = await lireRenduReussiIdentique(userId, identiteRendu);
  if (renduDejaLa.motif === 'socle_absent') return echec('socle_absent');
  if (renduDejaLa.rendu?.resultat) {
    return {
      sorte: 'reussi',
      renduId: renduDejaLa.rendu.id,
      planId,
      rushId: rushMonte,
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
      recette: recetteEffective,
      profil: profilEffectif,
      /* ⚠️ LES DEUX RAISONS VOYAGENT ENSEMBLE. Le jour ou « pourquoi cette
         musique ? » sera pose, la reponse est a cote de « pourquoi ce look ? ». */
      variation: variationAudio === null ? variation : {
        politiqueVersion: biblio.automatisation.version,
        raison: [variation?.raison, variationAudio.raison].filter(Boolean).join(' '),
      },
      /* ⚠️ PRÉPARÉE MÊME QUAND LES SOUS-TITRES SONT ÉTEINTS ? NON. La lecture
         coûte deux requêtes ; elle n'a lieu que si le profil les demande. */
      captions: profilEffectif?.captions.active
        ? await preparerCaptionsMultiSource(userId, plan) : null,
      // Les mots de la voix-off sont deja dates sur le montage : ils passent
      // devant la parole du rush, et sans projection.
      captionsVoixOff: biblio.voixOff?.mots ?? null,
      appelAction,
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
    rushId: rushMonte,
    videoUrl: cle,
    vignetteUrl: null,
    // ⚠️ LA DURÉE MESURÉE PAR `ffprobe`, jamais celle demandée au plan.
    dureeSecondes: issue.mesure.dureeMesureeSecondes,
  };
}
