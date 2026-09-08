/**
 * M3-H — L'ORCHESTRATION : DU PLAN AU FICHIER LOCAL VALIDÉ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE LOT S'ARRÊTE AU MP4 LOCAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le téléversement, la clé finale et la bascule en `reussie` appartiennent à
 * la phase suivante. Ici, le fichier est produit, mesuré, validé — et remis à
 * un livreur qui n'existe pas encore. Rien ne peut donc être déclaré réussi :
 * un rendu dont personne n'a le fichier n'a pas réussi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA FORME QUI REND LE NETTOYAGE IMPOSSIBLE À OUBLIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `produireMontage` ne RENVOIE pas un chemin : elle appelle `livrer` avec le
 * fichier encore présent, puis nettoie dans son `finally`. Rendre le chemin
 * aurait obligé chaque appelant à fermer le répertoire lui-même, et le
 * premier qui l'oublie laisse six clips et un montage sur le disque — plus
 * d'un demi-gigaoctet par rendu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE NE FAIT NULLE PART
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucune décision éditoriale : ni ordre, ni durée, ni recadrage, ni
 * transition. Aucun crédit, aucun fournisseur, aucun modèle de langage,
 * aucune écriture dans `render_jobs`, `rendus` ou `videos`.
 */
import {
  prendrePlaceRendu, type PlaceExtraction,
} from './capacite';
import { nombreFini } from './clip-contrat';
import {
  RECETTE_AUDIO_DEFAUT, estRecetteHistorique, recettePourUsage,
  type RecetteAudio,
} from './recette-audio';
import type { MontagePlan, PlanMontage } from './montage-contrat';
import type { ProfilCreatifAutopilote } from './profil-creatif';
import { join, dirname } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { resoudreLut } from './rendu-lut';
import { lireCube, doserCube, ecrireCube } from './lut-cube';
import { preparerCouches } from './rendu-texte';
import { fichierPolice } from './rendu-polices';
import type { TexteAPoser } from './rendu-style';
import {
  construireStyle, recouvrementTransition,
  type LogoLocal, type StyleRendu,
} from './rendu-style';
import {
  projeterMots, VERSION_MOTEUR_CAPTIONS,
  type MotSource, type ClipProjection,
} from './captions-timeline';
import { documentCaptions } from './captions-ass';
import { styleCaptionParId } from '@/lib/creatif/captions';
import {
  PIXEL_FORMAT_RENDU, AUDIO_FREQUENCE_RENDU, TOLERANCE_FPS, MOTIF_RENDU_INTERROMPU,
  dureeConforme, planRendable, resolutionConforme,
  type MotifRendu,
} from './rendu-contrat';
import {
  argumentsRendu, descendreSource, diagnosticRendu, encoder, fermerDossierRendu,
  nomLogoLocale, sonderImage,
  nomMusiqueLocale, rendraDeLAudio, type MusiqueLocale,
  mesurer, ouvrirDossierRendu, rectangleCrop, sonderSource, sonderSourceAudio,
  couperSilenceInitialMusique,
  supprimerObjetRendu,
  televerserRendu,
  type CibleRendu, type MesureRendu, type SourceLocale,
} from './rendu-ffmpeg';

export interface DemandeRendu {
  userId: string;
  plan: MontagePlan;
  /**
   * Fait avancer l'étape en base, et DIT si la ligne existe encore.
   *
   * Rend un motif de persistance quand l'écriture n'a touché aucune ligne :
   * la ligne a été fermée par péremption, ou son plan a disparu. C'est un
   * ORDRE D'ARRÊT, pas une erreur — voir `abandonne` plus bas.
   */
  avancer?: (etape: 'source' | 'encodage' | 'mesure') => Promise<'rendu_absent' | null>;
  /**
   * La recette audio VALIDEE par la route. Absente = comportement historique.
   *
   * ⚠️ ELLE N'EST PAS RELUE ICI. La route a deja verifie le schema ferme, les
   * bornes, et surtout que la musique appartient au compte. Revalider ici
   * ferait croire que ce module protege quelque chose : il ne protege rien,
   * il execute — et `descendreSource` reposera de toute facon ses trois
   * gardes de propriete sur la cle.
   */
  recette?: RecetteAudio | null;
  /**
   * A_3e3 — POURQUOI CE STYLE, quand c'est l'Autopilote qui l'a choisi.
   *
   * ⚠️ UNE TRACE, JAMAIS UNE DECISION. Ce module n'en tire rien : il l'ecrit
   * dans `usage` a cote des choix effectifs, pour que la question « pourquoi
   * ce look ? » ait une reponse le jour ou elle sera posee. Absent quand la
   * personne a choisi elle-meme — et il n'y a alors rien a expliquer.
   */
  variation?: { politiqueVersion: string; raison: string } | null;
  /**
   * A_4 — LA PAROLE DU RUSH ET L'ORIGINE DE CHAQUE CLIP.
   *
   * ⚠️ LA MATIERE, PAS LE RESULTAT. L'appelant fournit les mots dates dans le
   * RUSH et le debut de chaque clip ; c'est ce module qui les projette sur la
   * timeline, parce que lui seul connait le recouvrement reellement applique.
   * Absent = aucun sous-titre, ce qui est le comportement d'avant ce lot.
   */
  captions?: { mots: readonly MotSource[]; clips: readonly ClipProjection[] } | null;
  /**
   * Le profil creatif EFFECTIF, deja fusionne et deja VALIDE par la route.
   *
   * ⚠️ IL N'EST PAS RELU ICI, exactement comme la recette audio. La route a
   * verifie le schema ferme, les bornes, les identifiants du catalogue, et
   * surtout que le logo appartient au compte. Ce module execute — et
   * `descendreSource` reposera de toute facon ses trois gardes de propriete
   * sur la cle du logo.
   *
   * Absent ou historique = graphe d'avant ce lot, au caractere pres.
   */
  profil?: ProfilCreatifAutopilote | null;
  /**
   * Ce que le CTA DIT, et ou il mene — quand le compte l'a ecrit.
   *
   * ⚠️ CELA NE VIENT PAS DU PROFIL, et c'est le depot qui le dit : le
   * MESSAGE d'un appel a l'action appartient a l'objectif, sa FORME au style.
   * Melanger les deux obligerait a rejouer un montage pour changer la couleur
   * d'un bouton, et a rejouer un style pour changer un lien.
   *
   * `null` : aucun texte de CTA n'est dessine. Rien n'est invente ici.
   */
  appelAction?: { texte: string | null; destination: string | null } | null;
}

export interface ResultatRendu {
  ok: boolean;
  motif: MotifRendu | null;
  /** Vrai quand la ligne a disparu en cours de route : on s'est arrêté. */
  abandonne: boolean;
  mesure: MesureRendu | null;
  usage: Record<string, unknown>;
}

/** Ce que l'appelant reçoit pendant que le fichier existe encore. */
export type Livreur = (fichier: string, mesure: MesureRendu) => Promise<MotifRendu | null>;

/**
 * Relit un plan et RE-DÉRIVE ses nombres.
 *
 * ⚠️ `planValide` DE M3-G NE SUFFIT PAS ICI. Il vérifie que chaque champ est
 * un nombre fini, mais ne les RÉÉCRIT pas : une durée restée chaîne dans le
 * `jsonb` traverse intacte, et se retrouverait interpolée telle quelle dans
 * le graphe de filtres. Un graphe est une seule chaîne d'arguments, mais la
 * virgule y sépare des filtres : une valeur brute est une injection possible
 * sans le moindre shell.
 *
 * Il ne refuse pas non plus le négatif ni le zéro. Une durée à `-5`
 * produirait une sortie vide, diagnostiquée `resultat_invalide` — un motif
 * FAUX pour un plan qui n'aurait jamais dû être exécuté.
 */
function planExecutable(plans: readonly PlanMontage[]): SourceLocale[] | null {
  const sources: SourceLocale[] = [];
  for (const p of plans) {
    const ordre = nombreFini(p.ordre);
    const entree = nombreFini(p.entreeSecondes);
    const duree = nombreFini(p.dureeRetenueSecondes);
    if (ordre === null || ordre < 1) return null;
    if (entree === null || entree < 0) return null;
    if (duree === null || duree <= 0) return null;

    const crop = rectangleCrop(p.largeurSource, p.hauteurSource, p.recadrage);
    if (crop === null) return null;

    sources.push({
      ordre, chemin: '', entreeSecondes: entree, dureeRetenueSecondes: duree,
      crop, aAudio: false,
    });
  }
  // ⚠️ L'ORDRE DU PLAN, ET AUCUN AUTRE. Deux plans de même ordre rendraient
  // le montage dépendant de l'ordre de lecture du `jsonb`.
  const ordres = sources.map((s) => s.ordre);
  if (new Set(ordres).size !== ordres.length) return null;
  return sources;
}

/**
 * Les invariants du fichier produit.
 *
 * ⚠️ UN CODE 0 DE FFMPEG NE VAUT PAS UN FICHIER VALIDE. Les tolérances sont
 * celles de H1, et il n'en est créé aucune ici : la résolution n'en a aucune,
 * la durée a celle du support, la cadence celle de la conversion de fraction.
 */
function resultatConforme(
  mesure: MesureRendu, plan: MontagePlan, avecAudio: boolean,
  recoupementSecondes = 0,
): boolean {
  if (!resolutionConforme(
    mesure.largeur, mesure.hauteur, plan.largeurCible, plan.hauteurCible,
  )) return false;
  if (mesure.codecVideo !== 'h264') return false;
  if (mesure.pixelFormat !== PIXEL_FORMAT_RENDU) return false;
  /* ⚠️ LA DUREE ATTENDUE EST CELLE DU PLAN MOINS LE RECOUVREMENT. Un montage
     dont les plans se chevauchent est PLUS COURT que son plan, et c'est
     exactement ce qui avait fait ecarter `xfade` : le fichier etait refuse.
     Retirer le recouvrement ne relache pas la verification, elle la RENFORCE
     — elle controle desormais que le recouvrement a bien eu lieu. */
  if (!dureeConforme(
    mesure.dureeMesureeSecondes,
    plan.dureeTotaleSecondes - recoupementSecondes,
    plan.fps, plan.plans.length,
  )) return false;
  if (mesure.fpsMesure === null) return false;
  if (Math.abs(mesure.fpsMesure - plan.fps) > TOLERANCE_FPS) return false;

  // ⚠️ LA PISTE ATTENDUE EST CROISÉE AVEC LA PISTE MESURÉE.
  //
  // L'audio n'est pas une condition en soi — M3-F autorise le rush muet, et
  // `argumentsRendu` part alors en `-an`. Mais il est une PROMESSE : dès
  // qu'une source porte du son, le graphe entrelace les pistes et comble les
  // silences, donc le montage DOIT sortir sonore. Ne regarder que
  // `mesure.aAudio` laissait passer l'inverse exact du défaut que la sonde
  // avait été écrite pour empêcher : six sources sonores, une bande son
  // perdue en route, et un fichier déclaré conforme sans un mot. Le silence
  // total, lui, reste légitime — et reste tracé dans `usage.montageMuet`.
  if (mesure.aAudio !== avecAudio) return false;
  if (mesure.aAudio) {
    if (mesure.codecAudio !== 'aac') return false;
    if (mesure.frequenceAudio !== AUDIO_FREQUENCE_RENDU) return false;
  }
  return true;
}

const echec = (motif: MotifRendu, usage: Record<string, unknown>): ResultatRendu => ({
  ok: false, motif, abandonne: false, mesure: null, usage,
});

/**
 * Produit le montage décrit par le plan, et le remet à `livrer`.
 *
 * La place de capacité est prise AVANT le moindre travail et rendue dans le
 * `finally` — après une réussite, après un échec, après un délai dépassé,
 * après une exception. `liberer()` est idempotente : une seconde libération
 * ne rend pas une seconde place.
 */
export async function produireMontage(
  demande: DemandeRendu, livrer?: Livreur, placeTenue?: PlaceExtraction,
): Promise<ResultatRendu> {
  const { userId, plan } = demande;
  const usage: Record<string, unknown> = {};
  // Absente = le comportement d'avant ce lot, a la lettre.
  const recette = demande.recette ?? RECETTE_AUDIO_DEFAUT;
  const profil = demande.profil ?? null;
  // ⚠️ TRACEE SEULEMENT QUAND ELLE DIT QUELQUE CHOSE. Ecrire la recette par
  // defaut dans `usage` de tous les rendus historiques n'apprendrait rien et
  // ferait croire, a la relecture, que ces rendus ont ete demandes avec un
  // reglage audio.
  if (!estRecetteHistorique(recette)) usage.audio = recettePourUsage(recette);

  // ── Ce qui se refuse AVANT de prendre quoi que ce soit ────────────────
  if (!planRendable(plan)) return echec('plan_non_conforme', usage);
  const sources = planExecutable(plan.plans);
  if (sources === null) return echec('plan_non_conforme', usage);
  // ⚠️ UN PLAN AMPUTÉ N'EST PAS LE PLAN PERSISTÉ. `planDepuisLigne` de M3-G
  // FILTRE en silence les entrées qu'il juge invalides : un montage de six
  // plans dont une entrée serait corrompue reviendrait comme un plan de cinq,
  // parfaitement cohérent en apparence. Le relevé de M3-G dit combien il en
  // avait retenus ; les deux doivent coïncider.
  const attendus = nombreFini((plan.usage as { plansRetenus?: unknown })?.plansRetenus);
  if (attendus !== null && attendus !== sources.length) {
    return echec('plan_non_conforme', usage);
  }

  // ── La capacité, prise avant TOUT travail ─────────────────────────────
  //
  // Elle ne fait pas double emploi avec l'index unique de la base : celui-ci
  // empêche deux rendus du MÊME plan, celle-ci empêche deux rendus de plans
  // DIFFÉRENTS de se partager quatre cœurs.
  // ⚠️ LA PLACE PEUT DÉJÀ ÊTRE TENUE PAR L'APPELANT, ET C'EST LE CAS NORMAL.
  //
  // La route la prend AVANT de créer la ligne — sans quoi une saturation
  // laisserait une ligne derrière elle, qui occuperait l'index actif et
  // interdirait toute relance pendant la péremption. En redemander une ici
  // ferait échouer TOUT rendu déclenché par la route : il n'y en a qu'une, et
  // elle serait déjà prise par le même travail.
  //
  // Sans appelant qui la tienne — un test, un futur script — on la prend.
  const place: PlaceExtraction | null = placeTenue ?? prendrePlaceRendu();
  if (!place) return echec('capacite_saturee', usage);

  let dossier: string | null = null;
  try {
    dossier = await ouvrirDossierRendu();
    // Un disque qui ne se laisse pas écrire est une saturation, pas un
    // résultat invalide — rien n'a encore été produit.
    if (dossier === null) return echec('capacite_saturee', usage);

    // ── Les sources ────────────────────────────────────────────────────
    if (await abandonne(demande, 'source')) {
      return { ok: false, motif: null, abandonne: true, mesure: null, usage };
    }
    let octetsSources = 0;
    for (const [i, s] of sources.entries()) {
      // ⚠️ PAR INDICE, ET NON PAR RECHERCHE. `planExecutable` construit
      // `sources` dans l'ordre de `plan.plans` : l'indice EST l'appariement.
      // Un `find` sur `ordre` serait juste lui aussi, mais il dépendrait d'un
      // invariant prouvé ailleurs — et cesserait de l'être le jour où la
      // construction changerait.
      const p = plan.plans[i];
      const descente = await descendreSource(
        userId, { ordre: s.ordre, bucket: p.bucket, cle: p.cle }, dossier, i,
      );
      if (!descente.ok) return echec(descente.motif, usage);
      s.chemin = descente.chemin;
      octetsSources += descente.octets;

      // Constaté par une sonde, jamais supposé.
      const sonde = await sonderSource(s.chemin);
      // ⚠️ UNE SONDE QUI ÉCHOUE N'EST PAS UNE SOURCE MUETTE. Traiter l'échec
      // comme « pas d'audio » ferait partir le graphe en `-an`, et le montage
      // serait déclaré RÉUSSI avec sa bande son perdue — sans un mot, puisque
      // l'audio n'est pas une condition de conformité. Le motif dit lequel des
      // deux s'est produit.
      if (sonde.motif) return echec(sonde.motif, usage);
      // `concat` exige le même nombre de flux par segment : un rush muet
      // ferait échouer le graphe si on le supposait sonore.
      s.aAudio = sonde.aAudio;

      // ⚠️ LES DIMENSIONS DÉCODÉES DOIVENT ÊTRE CELLES DU PLAN.
      //
      // Un rush filmé au téléphone porte souvent `rotate=90` : il se sonde en
      // 1920×1080 et se décode en 1080×1920. M3-G a calculé son rectangle sur
      // les dimensions que M3-B avait mesurées ; si le décodeur en produit
      // d'autres, le recadrage tombe à côté et le montage sort de travers,
      // sans le moindre message. Mieux vaut refuser que rendre un cadrage
      // faux.
      if (sonde.largeur !== nombreFini(p.largeurSource)
        || sonde.hauteur !== nombreFini(p.hauteurSource)) {
        return echec('plan_non_conforme', usage);
      }
    }
    usage.sourcesDescendues = sources.length;
    usage.octetsSources = octetsSources;
    // Le silence est déclaré plutôt qu'invisible — y compris quand il est
    // total, cas qu'une première rédaction ne traçait nulle part.
    const muets = sources.filter((s) => !s.aAudio).length;
    if (muets === sources.length) usage.montageMuet = true;
    else if (muets > 0) usage.plansSilencieux = muets;

    // ── La musique, s'il y en a une ────────────────────────────────────
    //
    // ⚠️ DESCENDUE PAR LE MEME CHEMIN QUE LES CLIPS. `descendreSource` pose
    // ses trois gardes — compartiment autorise, cle sous le prefixe du
    // compte, aucun `..` ni `://` — et ecrit au fil de l'eau. Aucune URL
    // n'est signee, aucune requete ne sort du reseau interne : la musique est
    // un objet de la mediatheque de l'utilisateur, pas une adresse.
    let musique: MusiqueLocale | null = null;
    if (recette.musique !== null) {
      const cheminMusique = nomMusiqueLocale(dossier);
      const descente = await descendreSource(
        userId,
        { ordre: 0, bucket: recette.musique.bucket, cle: recette.musique.cle },
        dossier, 0, cheminMusique,
      );
      if (!descente.ok) return echec(descente.motif, usage);
      // ⚠️ ON SONDE AVANT DE BOUCLER. `-stream_loop -1` sur un fichier sans
      // piste audio ne donnerait rien a `atrim`, et le graphe echouerait avec
      // un diagnostic obscur.
      //
      // ⚠️ ET ON SONDE AVEC LA SONDE AUDIO, PAS CELLE DES CLIPS. La premiere
      // redaction appelait `sonderSource`, qui exige une piste VIDEO : tout
      // MP3 sans pochette repartait en `clip_illisible` — un rush sain se
      // faisait accuser, et le mixage n'etait jamais atteint. Constate en
      // production le 2026-09-03 sur deux rendus.
      const sondeMusique = await sonderSourceAudio(cheminMusique);
      if (sondeMusique.motif !== null) return echec(sondeMusique.motif, usage);
      if (!sondeMusique.aAudio) return echec('musique_illisible', usage);
      /* ⚠️ LE BLANC DU DÉBUT EST COUPÉ ICI, ET SEULEMENT POUR LE RENDU.
         Le fichier de l'utilisateur n'est pas touché : la coupe vit dans le
         dossier temporaire et meurt avec lui. Et elle est faite AVANT que
         `-stream_loop` n'entre en jeu — mesuré le 2026-09-07, un `-ss` à
         l'entrée laisse le silence revenir à CHAQUE tour de boucle. */
      const coupee = await couperSilenceInitialMusique(
        cheminMusique, `${cheminMusique}-sans-blanc.wav`,
      );
      musique = { chemin: coupee.chemin };
      usage.silenceMusiqueCoupeSecondes = coupee.coupeSecondes;
      usage.octetsMusique = descente.octets;
    }

    // ── Le logo, s'il y en a un ────────────────────────────────────────
    //
    // ⚠️ DESCENDU PAR LE MEME CHEMIN QUE LA MUSIQUE ET LES CLIPS. Aucune URL
    // n'est signee, aucune requete ne sort : un logo est un objet de la
    // mediatheque du compte, designe par un couple compartiment/cle, jamais
    // par une adresse.
    //
    // ⚠️ UN LOGO REFUSE FAIT ECHOUER LE RENDU, IL N'EST PAS IGNORE. Rendre
    // le montage sans l'image de marque que l'utilisateur a demandee
    // produirait un fichier « reussi » qui n'est pas celui qu'il a commande —
    // et il ne s'en apercevrait qu'apres publication.
    let logo: LogoLocal | null = null;
    const objetLogo = profil?.marque.logoActif ? profil.marque.logo : null;
    if (objetLogo !== null && objetLogo !== undefined) {
      const cheminLogo = nomLogoLocale(dossier);
      const descente = await descendreSource(
        userId,
        { ordre: 0, bucket: objetLogo.bucket, cle: objetLogo.cle },
        dossier, 0, cheminLogo,
      );
      if (!descente.ok) return echec(descente.motif, usage);
      // ⚠️ ON SONDE AVANT D'INCRUSTER, et avec la sonde des IMAGES. Elle
      // rend les dimensions dont `rectangleLogo` a besoin pour calculer la
      // hauteur a l'echelle en TypeScript, et elle refuse ce qui n'est pas
      // une image d'une seule trame.
      const sondeLogo = await sonderImage(cheminLogo);
      if (sondeLogo.motif !== null) return echec(sondeLogo.motif, usage);
      logo = {
        chemin: cheminLogo,
        largeur: sondeLogo.largeur ?? 1,
        hauteur: sondeLogo.hauteur ?? 1,
      };
      usage.octetsLogo = descente.octets;
    }

    // ── L'unique passage ───────────────────────────────────────────────
    if (await abandonne(demande, 'encodage')) {
      return { ok: false, motif: null, abandonne: true, mesure: null, usage };
    }
    // ⚠️ RE-DÉRIVÉES, COMME TOUT CE QUI ATTEINT LA CHAÎNE DE FILTRES. Ce sont
    // les trois dernières valeurs du plan à y entrer (`scale`, `fps`), et
    // elles y entraient telles quelles : `planRendable` les TESTE mais ne les
    // RÉÉCRIT pas. La coercion se fait aujourd'hui à la lecture de la ligne,
    // donc en amont — et supposer une garde d'amont est précisément ce que le
    // reste de la chaîne s'interdit.
    const largeur = nombreFini(plan.largeurCible);
    const hauteur = nombreFini(plan.hauteurCible);
    const fps = nombreFini(plan.fps);
    if (largeur === null || hauteur === null || fps === null
      || largeur < 2 || hauteur < 2 || fps < 1) {
      return echec('plan_non_conforme', usage);
    }
    const cible: CibleRendu = { largeur, hauteur, fps };
    const sortie = `${dossier}/montage.mp4`;
    const debut = Date.now();
    // ⚠️ `indicePremiereEntree` EST CALCULE ICI, PAS DEDUIT PAR LE STYLE.
    // Les entrees ffmpeg sont, dans l'ordre : les clips, puis la musique si
    // elle existe, puis celles du style. Le style ne peut pas connaitre la
    // presence de la musique ; la lui faire deviner ferait pointer son
    // incrustation sur l'entree du voisin — un logo qui affiche le mauvais
    // flux ne leve aucune erreur.
    /* ── LA LUT : RESOLUE, DOSEE, ECRITE ──────────────────────────────
       ⚠️ LE DOSAGE SE FAIT SUR LA TABLE, PAS SUR L'IMAGE. `lut3d` n'a pas
       d'opacite, et le look est insere dans une chaine LINEAIRE de filtres :
       un `split`+`blend` demanderait de reecrire tout l'assemblage. Ramener
       chaque entree vers l'identite donne exactement le meme resultat —
       l'interpolation de `lut3d` est lineaire, donc l'interpolation d'un
       melange EST le melange des interpolations.

       Et si quoi que ce soit manque, on ne fait pas echouer le montage : on
       retombe sur le preset historique et on TRACE le motif, comme le depot
       le fait deja pour les transitions non rendues. */
    let lutFichier: string | null = null;
    const issueLut = resoudreLut(profil?.lut ?? null);
    if (issueLut.sorte === 'appliquee') {
      try {
        const brut = await readFile(issueLut.lut.chemin, 'utf8');
        const lu = lireCube(brut);
        if (!lu.ok) {
          usage.lutNonRendue = lu.motif;
        } else {
          const intensite = profil?.lut.intensite ?? 1;
          const dose = doserCube(lu.cube, intensite);
          lutFichier = join(dossier, 'look.cube');
          await writeFile(
            lutFichier,
            ecrireCube(dose, `${issueLut.lut.id} a ${Math.round(intensite * 100)} %`),
            'utf8',
          );
          usage.lut = { id: issueLut.lut.id, intensite };
        }
      } catch {
        // Le message n'est PAS repris : il porterait un chemin.
        usage.lutNonRendue = 'lecture_impossible';
        lutFichier = null;
      }
    } else if (issueLut.motif !== 'inactive') {
      usage.lutNonRendue = issueLut.motif;
    }

    /* ── LE TEXTE : PREPARE, PUIS ECRIT SUR LE DISQUE ──────────────────
       ⚠️ AUCUNE VALEUR SAISIE N'ENTRE DANS LE GRAPHE DE FILTRES. Chaque
       texte part dans son propre fichier, et `drawtext` le lit par
       `textfile=`. Un CTA qui contient « 50% : c'est aujourd'hui ! » ne peut
       donc ni casser le graphe ni en changer le sens — il n'y est jamais.

       Et si la machine ne porte pas les polices (un poste de developpement
       sans `fonts-liberation`), la couche est SAUTEE et tracee dans `usage`
       plutot que de faire echouer un montage par ailleurs valide. */
    const couches = preparerCouches({
      profil,
      appelAction: demande.appelAction ?? null,
      dureeTotaleSecondes: plan.dureeTotaleSecondes,
    });
    const textesAPoser: TexteAPoser[] = [];
    /* Le dossier des polices, deduit du fichier resolu : libass passe par
       fontconfig et veut un DOSSIER la ou `drawtext` veut un fichier. */
    let dossierPolices: string | null = null;
    const textesNonRendus: string[] = [];
    for (const [i, c] of couches.entries()) {
      const fichierPol = fichierPolice(c.police, c.graisse);
      if (fichierPol === null) { textesNonRendus.push(c.nature); continue; }
      if (dossierPolices === null) dossierPolices = dirname(fichierPol);
      const fichierTexte = join(dossier, `texte-${i}.txt`);
      await writeFile(fichierTexte, c.texte, 'utf8');
      textesAPoser.push({
        fichierTexte,
        fichierPolice: fichierPol,
        taillePx: (hauteur * c.taillePct) / 100,
        couleur: c.couleur,
        ancre: c.ancre,
        debutSecondes: c.debutSecondes,
        finSecondes: c.finSecondes,
        habillage: c.habillage,
        animationId: c.animationId,
        animationContenuId: c.animationContenuId,
        texte: c.texte,
        police: c.police,
        graisse: c.graisse,
      });
    }
    if (textesNonRendus.length > 0) usage.textesNonRendus = textesNonRendus;
    if (textesAPoser.length > 0) usage.textesRendus = textesAPoser.length;

    /* ── LES SOUS-TITRES ──────────────────────────────────────────────
       ⚠️ PROJETES ICI, PARCE QUE LE RECOUVREMENT SE DECIDE ICI. Les mots
       arrivent dates dans le RUSH ; le montage, lui, a coupe, reordonne, et
       fait se chevaucher les plans. Projeter ailleurs obligerait a deviner de
       combien chaque plan s'est decale. */
    let captions: { fichier: string; document: string } | null = null;
    if (profil?.captions.active && demande.captions) {
      const styleCaption = styleCaptionParId(profil.captions.styleId);
      const recouvrement = recouvrementTransition(
        profil, plan.plans.map((p) => p.dureeRetenueSecondes),
      );
      const mots = projeterMots(
        demande.captions.mots,
        plan.plans.map((p) => ({
          ordre: p.ordre,
          rangClip: p.rangClip,
          entreeSecondes: p.entreeSecondes,
          dureeRetenueSecondes: p.dureeRetenueSecondes,
        })),
        demande.captions.clips,
        recouvrement.dureeSecondes,
      );
      const doc = styleCaption === null ? null : documentCaptions(
        mots,
        { ...styleCaption, position: profil.captions.position as never },
        {
          largeur, hauteur,
          margeHautPct: profil.margesSures.hautPct,
          margeBasPct: profil.margesSures.basPct,
        },
        {
          texte: profil.couleurs.texte ?? '#FFFFFF',
          accent: profil.couleurs.accent ?? profil.couleurs.primaire ?? '#EC4899',
        },
      );
      if (doc === null) {
        /* ⚠️ AUCUN SOUS-TITRE VIDE. Un rush sans parole utile n'a rien a
           afficher, et un fichier vide ferait echouer `subtitles`. */
        usage.captionsNonRendues = 'aucune_parole';
      } else {
        captions = { fichier: join(dossier, 'captions.ass'), document: doc.contenu };
        usage.captions = {
          active: true, rendu: true, styleId: profil.captions.styleId,
          blocs: doc.blocs, minutage: 'mot', moteur: VERSION_MOTEUR_CAPTIONS,
        };
      }
    } else if (profil?.captions.active) {
      // Actives, mais aucune transcription ne nous est parvenue.
      usage.captionsNonRendues = 'transcription_absente';
    }

    const style: StyleRendu = construireStyle(profil, {
      cible: { largeur, hauteur },
      // Les durees RETENUES, celles que le graphe met dans `trim` : un fondu
      // doit se borner a la moitie du plan REELLEMENT montre.
      clips: sources
        .slice()
        .sort((a, b) => a.ordre - b.ordre)
        .map((s) => ({ dureeSecondes: s.dureeRetenueSecondes })),
      dureeTotaleSecondes: plan.dureeTotaleSecondes,
      logo,
      lutFichier,
      textes: textesAPoser,
      fichierAss: join(dossier, 'textes.ass'),
      dossierPolices: dossierPolices,
      captions,
      indicePremiereEntree: sources.length + (musique !== null ? 1 : 0),
    });
    /* ⚠️ LE DOCUMENT S'ECRIT AVANT ffmpeg, pas apres : le filtre le nomme
       deja. Sans ce fichier, `subtitles` echoue et le montage entier est
       perdu — alors que la couche de texte n'en est qu'une partie. */
    if (style.documentCaptions !== null && captions) {
      await writeFile(captions.fichier, style.documentCaptions, 'utf8');
    }
    if (style.documentAss !== null) {
      await writeFile(join(dossier, 'textes.ass'), style.documentAss, 'utf8');
      usage.textesAnimes = style.documentAss.split('\nDialogue:').length - 1;
    }
    /* ⚠️ L'ECART DE DUREE EST TRACE, JAMAIS CACHE. Le plan dit une duree, le
       recouvrement en retire une part : c'est `usage` qui porte la difference,
       pour que personne n'ait a la deviner en comparant deux nombres. */
    if (style.transition !== null) {
      usage.transitionRendue = style.transition.xfadeId;
      usage.transitionDureeSecondes = style.transition.dureeSecondes;
      usage.recoupementTotalSecondes = style.transition.recoupementTotalSecondes;
      usage.dureeAttendueSecondes =
        plan.dureeTotaleSecondes - style.transition.recoupementTotalSecondes;
    }
    /* ── LES CHOIX CRÉATIFS DE CE MONTAGE ─────────────────────────────
       ⚠️ ÉCRITS ICI, PAS DÉDUITS PLUS TARD. Ce sont eux qui alimenteront les
       « Récents » des grilles et la mémoire anti-répétition de l'Autopilote :
       un rendu réussi est la seule preuve qu'un choix a servi. Ils tiennent
       dans `usage`, qui est déjà du `jsonb` — aucune migration. */
    if (profil) {
      usage.creatif = {
        lutId: profil.lut.active ? profil.lut.lutId : null,
        styleTexteId: profil.typographie.styleTexteId,
        animationBlocId: profil.animations.texteId,
        animationContenuId: profil.animations.texteContenuId,
        transitionId: profil.transitions.active ? profil.transitions.transitionId : 'cut',
        captionStyleId: profil.captions.active ? profil.captions.styleId : null,
        // ⚠️ LA CLE, JAMAIS UNE URL — `usage` refuse d'ailleurs `://`.
        musicTrackId: musique !== null ? (recette.musique?.cle ?? null) : null,
        ...(demande.variation ? {
          politiqueVersion: demande.variation.politiqueVersion,
          raison: demande.variation.raison,
        } : {}),
      };
    }
    if (style.transitionsNonRendues.length > 0) {
      // Trace, jamais silence : la transition demandee est acceptee par le
      // contrat mais rendue comme `cut` tant que ce lot ne sait pas la faire
      // a duree constante.
      usage.transitionsNonRendues = style.transitionsNonRendues.join(',');
    }
    const proc = await encoder(
      argumentsRendu(sources, cible, sortie, {
        recette, musique, dureeSecondes: plan.dureeTotaleSecondes,
      }, style),
      plan.dureeTotaleSecondes, dossier,
    );
    usage.encodageMs = Date.now() - debut;
    if (!proc.ok) {
      // Le détail va au journal, masqué ; la base ne portera qu'un motif.
      console.warn(`[autopilote][rendu] ${proc.motif} : ${proc.diagnostic}`);
      return echec(proc.motif ?? 'encodage_echoue', usage);
    }

    // ── La mesure, qui VALIDE ──────────────────────────────────────────
    if (await abandonne(demande, 'mesure')) {
      return { ok: false, motif: null, abandonne: true, mesure: null, usage };
    }
    const { mesure, motif } = await mesurer(sortie);
    if (mesure === null) return echec(motif ?? 'resultat_invalide', usage);
    // ⚠️ LA PROMESSE EST CALCULEE PAR LE MOTEUR, PAS RECOPIEE ICI.
    // `rendraDeLAudio` applique exactement la regle du graphe — le son des
    // rushes seulement s'il est garde ET qu'une source en porte, plus la
    // musique s'il y en a une. Reecrire cette regle a la main ici, c'est la
    // faire diverger au premier lot suivant.
    if (!resultatConforme(
      mesure, plan, rendraDeLAudio(sources, recette, musique !== null),
      style.transition?.recoupementTotalSecondes ?? 0,
    )) {
      return echec('resultat_invalide', usage);
    }
    usage.octetsProduits = mesure.octets;
    usage.dureeMesureeSecondes = mesure.dureeMesureeSecondes;

    // ── La livraison, pendant que le fichier existe ────────────────────
    if (livrer) {
      const refus = await livrer(sortie, mesure);
      if (refus) return echec(refus, usage);
    }
    return { ok: true, motif: null, abandonne: false, mesure, usage };
  } finally {
    // ⚠️ DANS TOUS LES CAS, ET DANS CET ORDRE. Le répertoire d'abord — il
    // pèse plus d'un demi-gigaoctet — puis la place, dont la fuite bloquerait
    // tout rendu ultérieur jusqu'au redémarrage du conteneur.
    try {
      if (dossier !== null && !(await fermerDossierRendu(dossier))) {
        // L'échec est DIT, jamais avalé : un disque qui ne se vide plus est
        // un incident. Il ne transforme pas pour autant un montage produit en
        // échec — le fichier, lui, est bon.
        usage.nettoyageTemporaire = 'echoue';
      }
    } catch (e: unknown) {
      // ⚠️ LE NETTOYAGE EST SECONDAIRE, ET NE DÉCIDE DE RIEN.
      //
      // Un jet ici REMPLACE la valeur de retour du `try` : un montage produit,
      // mesuré, téléversé, ressortait en exception — et l'orchestration, qui
      // ne peut plus rien conclure, retirait l'objet et rendait un motif qui
      // accusait ffmpeg. Un répertoire temporaire qu'on ne sait pas vider est
      // un incident de disque, pas un défaut du fichier produit : il se
      // constate au relevé et au journal, et laisse le résultat intact.
      usage.nettoyageTemporaire = 'echoue';
      console.error(
        `[autopilote][rendu] nettoyage impossible : ${diagnosticRendu(
          e instanceof Error ? e.message : String(e), dossier ?? undefined,
        )}`,
      );
    } finally {
      // ⚠️ IMBRIQUÉ, ET CE N'EST PAS DE LA PRUDENCE DÉCORATIVE. Un jet dans
      // le nettoyage sauterait la libération, et la place fuirait pour de
      // bon : le compteur ne s'aère qu'au redémarrage du conteneur, donc
      // TOUT rendu ultérieur serait refusé. Le nettoyage ne jette pas
      // aujourd'hui — il rend `false` — mais rien ne l'y oblige demain.
      place.liberer();
    }
  }
}

/**
 * La ligne existe-t-elle encore ?
 *
 * ⚠️ `rendu_absent` EST UN ORDRE D'ARRÊT, PAS UNE ERREUR. La ligne a été
 * fermée par péremption, ou son plan a disparu. Continuer produirait un
 * fichier que plus personne n'attend ; écrire une clôture ressusciterait un
 * cadavre — ce que la garde d'état de la persistance existe précisément pour
 * empêcher. On s'arrête, on nettoie, on rend la place, et on n'écrit RIEN.
 */
async function abandonne(
  demande: DemandeRendu, etape: 'source' | 'encodage' | 'mesure',
): Promise<boolean> {
  if (!demande.avancer) return false;
  return (await demande.avancer(etape)) === 'rendu_absent';
}

// ═══════════════════════════════════════════════════════════════════════════
// H4 — LA FINALISATION : DU FICHIER LOCAL AU RENDU DURABLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce que la finalisation doit savoir faire, sans connaître la base.
 *
 * L'orchestration ne parle pas à PostgreSQL directement : elle reçoit deux
 * gestes. C'est ce qui la rend vérifiable sans base, et ce qui interdit
 * qu'une écriture se glisse entre deux étapes sans passer par la compensation.
 */
export type IssueConsignation =
  /** La ligne porte désormais la réussite. */
  | 'consigne'
  /** La ligne a disparu : ordre d'arrêt, plus rien à écrire. */
  | 'rendu_absent'
  /**
   * Rien n'a été écrit, et la ligne existe peut-être encore.
   *
   * ⚠️ CE TROISIÈME CAS EXISTE PARCE QUE SON ABSENCE ÉTAIT UN FAUX SUCCÈS.
   * La persistance peut refuser autrement qu'en disant « la ligne a fui » —
   * socle absent, violation d'unicité, panne. Ne reconnaître que
   * `rendu_absent` traduisait ces refus en réussite : le montage restait dans
   * le stockage, la ligne restait `en_cours`, et personne n'était prévenu.
   */
  | 'non_consigne';

export interface Finalisation {
  /** Consigne la réussite, et DIT ce qui s'est réellement passé. */
  consigner: (
    bucket: string, cle: string, mesure: MesureRendu, usage: Record<string, unknown>,
  ) => Promise<IssueConsignation>;
  /** Consigne l'échec, avec son motif fermé. */
  clore: (motif: MotifRendu, usage: Record<string, unknown>) => Promise<void>;
}

/**
 * Produit le montage, le publie, et consigne — ou compense.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ IL N'Y A AUCUNE TRANSACTION ENTRE LE STOCKAGE ET LA BASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois issues, et chacune a sa compensation écrite :
 *
 *   A. Le téléversement échoue → `echouee`, aucun objet, aucune réussite.
 *   B. Téléversement puis consignation réussissent → `reussie`. C'est le SEUL
 *      chemin qui écrit `reussie` : un `putObject` accepté ne suffit pas, un
 *      code 0 de ffmpeg encore moins.
 *   C. L'objet est monté mais la ligne ne peut plus être écrite — fermée par
 *      péremption, ou emportée par la cascade d'un plan supprimé. C'est le
 *      cas critique : on RETIRE l'objet. Si le retrait échoue à son tour,
 *      l'objet est TRACÉ comme orphelin — bucket et clé, jamais d'URL — pour
 *      qu'une purge ultérieure sache quoi chercher.
 *
 * Rien ici ne rejuge une décision vidéo : le fichier publié est exactement
 * celui que la mesure a validé.
 */
export async function rendreEtPublier(
  demande: DemandeRendu, renduId: string, finalisation: Finalisation,
  placeTenue?: PlaceExtraction,
): Promise<ResultatRendu> {
  // ⚠️ UN PORTEUR EXPLICITE, ET NON UNE VARIABLE DE FERMETURE. TypeScript
  // réduisait `publie` à `null` après l'`await`, l'affectation se faisant dans
  // la closure : la garde de compensation était morte pour le compilateur, et
  // un remaniement qui cesserait d'appeler le livreur n'aurait rien signalé.
  const monte: { objet: { bucket: string; cle: string } | null } = { objet: null };

  let resultat: ResultatRendu;
  try {
    resultat = await produireMontage(demande, async (fichier, mesure) => {
      // ⚠️ ON NE TÉLÉVERSE QU'APRÈS LA VALIDATION. Le livreur n'est appelé que
      // si ffmpeg a rendu 0 ET que la mesure est conforme : un fichier
      // invalide ne peut pas devenir un résultat publié.
      const envoi = await televerserRendu(
        demande.userId, renduId, fichier, mesure.octets,
      );
      if (!envoi.ok) return envoi.motif;
      monte.objet = { bucket: envoi.bucket, cle: envoi.cle };
      return null;
    }, placeTenue);
  } catch (e: unknown) {
    // ⚠️ UN JET APRÈS UN TÉLÉVERSEMENT RÉUSSI LAISSERAIT L'OBJET DERRIÈRE.
    // La production ne jette pas aujourd'hui, mais rien ne l'y oblige demain.
    if (monte.objet) await compenser(monte.objet, {});
    throw e;
  }

  // ── Cas A : le travail a échoué, avec ou sans objet monté ─────────────
  if (!resultat.ok) {
    if (monte.objet) await compenser(monte.objet, resultat.usage);
    if (!resultat.abandonne && resultat.motif) {
      await sansJeter(() => finalisation.clore(resultat.motif!, resultat.usage));
    }
    return resultat;
  }

  const objet = monte.objet;
  if (!objet) {
    // Impossible en pratique — `ok` implique un livreur réussi — mais
    // déclarer une réussite sans savoir OÙ est le fichier serait le pire des
    // faux succès.
    await sansJeter(() => finalisation.clore('televersement_echoue', resultat.usage));
    return { ...resultat, ok: false, motif: 'televersement_echoue', mesure: null };
  }

  // ── Cas B et C : l'objet est monté, reste à le consigner ──────────────
  let issue: IssueConsignation;
  try {
    issue = await finalisation.consigner(
      objet.bucket, objet.cle, resultat.mesure!, resultat.usage,
    );
  } catch {
    // ⚠️ UN JET N'EST PAS UN MOTIF. La persistance refuse par une exception —
    // contrainte de base, socle injoignable — et cela ne passe pas par une
    // valeur de retour. Sans ce `catch`, le montage restait dans le stockage
    // sans aucune ligne ni aucune trace pour le retrouver.
    issue = 'non_consigne';
  }

  if (issue === 'consigne') return resultat;

  // ── Cas C : rien n'a été écrit. L'objet ne doit pas rester ────────────
  await compenser(objet, resultat.usage);
  if (issue === 'rendu_absent') {
    return { ...resultat, ok: false, motif: null, abandonne: true };
  }
  // ⚠️ LE MOTIF DIT CE QUI S'EST PASSÉ, PAS CE QUI ARRANGE.
  //
  // `televersement_echoue` était FAUX ici : l'envoi a réussi, sa taille a même
  // été relue. Ce qui a refusé, c'est la base — socle injoignable, contrainte,
  // panne. Accuser le stockage envoyait chercher la panne du mauvais côté, et
  // aurait fait conclure à un incident MinIO là où PostgREST était muet.
  // `rendu_interrompu` est le motif du vocabulaire H1 qui décrit exactement
  // cet état : le travail a produit son fichier, rien n'a pu être consigné, et
  // une relance est la suite normale.
  await sansJeter(() => finalisation.clore(MOTIF_RENDU_INTERROMPU, resultat.usage));
  return { ...resultat, ok: false, motif: MOTIF_RENDU_INTERROMPU, mesure: null };
}

/** Une clôture qui échoue ne doit pas masquer ce qu'elle venait consigner. */
async function sansJeter(geste: () => Promise<void>): Promise<void> {
  try { await geste(); } catch { /* la ligne se fermera par péremption */ }
}

/**
 * Retire l'objet, ou le TRACE comme orphelin.
 *
 * ⚠️ NE JAMAIS MENTIR SUR CE QUI RESTE. Un objet qu'on n'a pas su retirer
 * occupe le stockage pour toujours ; l'écrire dans le relevé — compartiment
 * et clé, jamais d'URL, jamais la sortie du SDK — transforme une fuite
 * invisible en une fuite recensée, que la purge d'un lot ultérieur saura
 * reprendre. C'est le geste que M3-F avait adopté pour ses clips.
 */
async function compenser(
  objet: { bucket: string; cle: string }, usage: Record<string, unknown>,
): Promise<void> {
  if (await supprimerObjetRendu(objet.bucket, objet.cle)) return;
  const deja = Array.isArray(usage.orphelins) ? usage.orphelins : [];
  usage.orphelins = [...deja, { bucket: objet.bucket, cle: objet.cle }];
  // ⚠️ ET AU JOURNAL, PARCE QUE LE RELEVÉ PEUT NE JAMAIS ÊTRE ÉCRIT. Quand la
  // ligne a disparu — c'est le cas qui déclenche le plus souvent une
  // compensation — il n'y a plus rien à mettre à jour : la trace en mémoire
  // s'évanouirait avec le processus. Un compartiment et une clé ne sont pas
  // un secret ; un objet qu'on ne sait plus nommer, si.
  console.error(
    `[autopilote][rendu] orphelin non supprimé : ${objet.bucket}/${objet.cle}`,
  );
}
