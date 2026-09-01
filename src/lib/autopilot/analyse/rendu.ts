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
import type { MontagePlan, PlanMontage } from './montage-contrat';
import {
  PIXEL_FORMAT_RENDU, AUDIO_FREQUENCE_RENDU, TOLERANCE_FPS,
  dureeConforme, planRendable, resolutionConforme,
  type MotifRendu,
} from './rendu-contrat';
import {
  argumentsRendu, descendreSource, encoder, fermerDossierRendu, mesurer,
  ouvrirDossierRendu, rectangleCrop, sonderSource,
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
function resultatConforme(mesure: MesureRendu, plan: MontagePlan): boolean {
  if (!resolutionConforme(
    mesure.largeur, mesure.hauteur, plan.largeurCible, plan.hauteurCible,
  )) return false;
  if (mesure.codecVideo !== 'h264') return false;
  if (mesure.pixelFormat !== PIXEL_FORMAT_RENDU) return false;
  if (!dureeConforme(
    mesure.dureeMesureeSecondes, plan.dureeTotaleSecondes, plan.fps, plan.plans.length,
  )) return false;
  if (mesure.fpsMesure === null) return false;
  if (Math.abs(mesure.fpsMesure - plan.fps) > TOLERANCE_FPS) return false;
  // L'audio n'est PAS une condition : M3-F autorise le rush muet. Mais s'il y
  // en a, il doit être celui du contrat — sinon on aurait produit autre chose
  // que ce qu'on annonce.
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
  demande: DemandeRendu, livrer?: Livreur,
): Promise<ResultatRendu> {
  const { userId, plan } = demande;
  const usage: Record<string, unknown> = {};

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
  const place: PlaceExtraction | null = prendrePlaceRendu();
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
    const proc = await encoder(
      argumentsRendu(sources, cible, sortie), plan.dureeTotaleSecondes, dossier,
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
    if (!resultatConforme(mesure, plan)) return echec('resultat_invalide', usage);
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
