/**
 * M3-G — LE MOTEUR : DES CLIPS ET UNE DEMANDE VERS UN PLAN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ PUR, COMME `coupe.ts` — ET POUR LA MÊME RAISON
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun accès à la base, aucun réseau, aucun fichier, aucune horloge. La
 * même entrée rend toujours la même sortie, et la vérification se fait sur
 * des valeurs plutôt que sur des captures d'écran d'un montage.
 *
 * C'est ce qui a permis, en M3-E, de prouver le calage des bornes sans
 * exécuter ffmpeg une seule fois. Le même choix ici permet de prouver le
 * plan sans lancer Remotion.
 */
import {
  ALGORITHME_PLAN, DUREE_PLAN_MIN_SECONDES, PLANS_MAX,
  COUVERTURE_MAX_RUSH, ECART_MOMENTS_MIN_SECONDES,
  dimensionsCible, dureeUtilisable, recadrer,
  RACCORD_DEFAUT,
  type FormatMontage, type GeometrieSource, type MotifPlan, type PlanMontage,
} from './montage-contrat';
import { arrondirSeconde, type ClipMaterialise } from './clip-contrat';
import type { SourceSegment } from './montage-source';
import {
  politiqueDePlan, palierDeQualite, PALIER_QUALITE, VERSION_SCORING,
  type PolitiquePlan,
} from './objectif-score';
import { VERSION_SIGNAUX } from './signaux-contrat';
import type { ObjectifCommunication } from './objectif-communication';

/**
 * CE QUE LE MOTEUR SAIT D'UNE SOURCE — A_7b.
 *
 * ⚠️ TROIS CHOSES ÉTAIENT SCALAIRES DANS `m3g-v2`, ET NE POUVAIENT PAS L'ÊTRE
 * PLUS LONGTEMPS :
 *
 *   • la GÉOMÉTRIE, qui décide du recadrage. Deux rushes n'ont aucune raison
 *     d'avoir le même cadre ; en appliquer un seul recadrerait de travers
 *     tout ce qui ne vient pas du premier ;
 *   • la DURÉE DU RUSH, d'où sort le plafond de couverture. Montrer 60 % de
 *     A et 60 % de B est légitime ; leur appliquer un plafond commun ne veut
 *     rien dire ;
 *   • les PLAGES DÉJÀ PRISES. « 15 s » dans A et « 15 s » dans B sont deux
 *     images sans rapport. Les comparer ferait écarter le second comme un
 *     doublon du premier — un montage silencieusement amputé.
 *
 * Chacune devient donc un attribut DE LA SOURCE. Avec une seule source, il y
 * a une seule entrée, et le moteur se comporte exactement comme avant.
 */
export interface ContexteSourcePlan {
  /** La clé de regroupement : le `clipSetId` de la source. */
  cle: string;
  geometrie: GeometrieSource;
  /** Le plafond de couverture s'applique À CETTE source, et à elle seule. */
  dureeRushSecondes?: number;
  /** La provenance posée sur chaque segment issu de cette source — A_7a. */
  source?: Omit<SourceSegment, 'rangClip' | 'debutSourceSecondes' | 'finSourceSecondes'>;
}

/** Un clip qui sait d'où il vient. La forme du pool multi-rush. */
export interface ClipSource extends ClipMaterialise {
  /** La clé de sa source, à retrouver dans `DemandePlan.contextes`. */
  cleSource: string;
  /** Son rang RÉEL dans son jeu — `rang` porte le rang GLOBAL du pool. */
  rangDansJeu: number;
}

function cleDe(clip: ClipMaterialise): string {
  return (clip as Partial<ClipSource>).cleSource ?? '';
}

export interface DemandePlan {
  /**
   * Les clips matérialisés par M3-F.
   *
   * ─────────────────────────────────────────────────────────────────────
   * ⚠️ ILS PORTENT DES SIGNAUX SÉMANTIQUES, ET `m3g-v2` N'EN LIT AUCUN
   * ─────────────────────────────────────────────────────────────────────
   *
   * Depuis le lot 2B étape 4A, `ClipMaterialise.signaux` transporte ce qui
   * a été observé sur chaque fenêtre — personnes, échelle de plan, marque
   * visible, densité de parole. Le chemin est ouvert JUSQU'ICI, et s'arrête
   * ici : aucune ligne de ce fichier ne les consulte, l'ordre reste celui
   * de `rang`, et le plan produit est le même, signaux présents ou absents.
   *
   * C'est délibéré. Incrémenter `ALGORITHME_PLAN` avant qu'un comportement
   * ne change invaliderait tous les plans existants pour rien ; lire un
   * signal sans incrémenter ferait rendre par `lirePlanIdentique` un plan
   * calculé autrement pour une demande identique. Les deux se font ensemble,
   * dans le commit `m3g-v3`, ou pas du tout.
   */
  clips: readonly ClipMaterialise[];
  format: FormatMontage;
  dureeCibleSecondes: number;
  /** La géométrie mesurée du rush, appliquée à tous ses clips. */
  geometrie: GeometrieSource;
  /**
   * La durée du rush source, en secondes.
   *
   * ⚠️ ELLE SERT AU PLAFOND DE COUVERTURE, et à rien d'autre. Absente, le
   * plafond ne s'applique pas : un appelant qui ne sait pas combien dure le
   * rush ne peut pas dire quelle part il en montre, et refuser au hasard
   * serait pire que ne pas refuser.
   */
  dureeRushSecondes?: number;
  /**
   * L'OBJECTIF DE COMMUNICATION — Lot 2B, étape 4B.
   *
   * ⚠️ ABSENT OU GÉNÉRIQUE = `m3g-v2`, À LA SECONDE PRÈS. C'est le chemin de
   * tous les comptes qui n'ont rien déclaré, et il ne bouge pas.
   *
   * Quand il est présent ET exploitable, il ne fait qu'UNE chose : changer
   * l'ORDRE DANS LEQUEL les clips sont proposés au remplissage. Tous les
   * garde-fous ci-dessous s'appliquent ensuite sans exception — recouvrement,
   * écart minimal entre moments, plafond de couverture, durée minimale de
   * plan, plafond de plans. Un objectif ne peut en contourner aucun.
   */
  objectif?: ObjectifCommunication | null;
  /**
   * La politique DÉJÀ DÉCIDÉE par l'appelant.
   *
   * ⚠️ ELLE EXISTE PARCE QUE L'IDENTITÉ DU PLAN SE FIGE AVANT LE CALCUL. La
   * route doit connaître `algorithme_plan` pour interroger `lirePlanIdentique`
   * — donc avant de planifier. La décider deux fois, ici et là-bas, ouvrirait
   * la porte à deux réponses différentes : un plan calculé sous une politique
   * et rangé sous l'identité d'une autre.
   *
   * Absente, elle est décidée ici — même fonction, mêmes entrées, même
   * résultat.
   */
  politique?: PolitiquePlan;
  /**
   * LES SOURCES DU POOL — A_7b.
   *
   * ⚠️ ABSENT = LE CHEMIN HISTORIQUE, À LA SECONDE PRÈS. Sans ce champ, tous
   * les clips relèvent d'une source implicite unique, `geometrie` et
   * `dureeRushSecondes` la décrivent, et le moteur suit exactement le code de
   * `m3g-v2` — plafond commun, plages comparées entre elles, montage remis en
   * ordre chronologique. Un test le vérifie sur une batterie de cas.
   *
   * ⚠️ PRÉSENT, IL NE REMPLACE PAS `geometrie` : il la RÉPARTIT. Chaque clip
   * porte alors `cleSource`, et retrouve ici son cadre, sa durée de rush et
   * sa provenance.
   */
  contextes?: readonly ContexteSourcePlan[];
}

export interface ResultatPlan {
  plans: PlanMontage[];
  dureeTotaleSecondes: number;
  ecartSecondes: number;
  clipsEcartes: number;
  /** Ce qui a servi à décider, relevé pour la lecture après coup. */
  usage: Record<string, unknown>;
  /** La politique réellement appliquée — `m3g-v2` ou `m3g-v3.<empreinte>`. */
  politique: PolitiquePlan;
}

/**
 * L'ORDRE : celui de M3-F, et rien d'autre.
 *
 * `rang` porte déjà la hiérarchie décidée en amont — M3-C a classé les
 * passages par intérêt de montage, M3-E a calé leurs bornes sans toucher au
 * classement, M3-F a découpé dans cet ordre. Réordonner ici sur un critère
 * inventé (la durée, le poids du fichier) écraserait ce travail sans rien
 * apporter.
 *
 * Le champ `ordre` reste néanmoins DISTINCT de `rangClip` : le jour où un
 * utilisateur réordonnera ses plans, c'est `ordre` qui bougera, et `rangClip`
 * continuera de dire de quel clip chaque plan provient.
 */
function parRang(clips: readonly ClipMaterialise[]): ClipMaterialise[] {
  return [...clips].sort((a, b) => a.rang - b.rang);
}

/**
 * Range les clips dans l'ordre décidé par la politique.
 *
 * ⚠️ CE N'EST PAS L'ORDRE DU MONTAGE. C'est l'ordre dans lequel les clips
 * sont PROPOSÉS au remplissage, donc celui qui décide lesquels sont retenus
 * quand la durée cible est atteinte. Le montage, lui, est remis en ordre
 * chronologique tout en bas de cette fonction — un objectif ne réordonne
 * jamais ce que le spectateur voit.
 *
 * Un rang que la politique ne nomme pas passe en dernier, par `rang` : elle
 * les nomme tous, mais une liste tronquée ne doit pas faire disparaître un
 * clip du montage.
 */
function selonPolitique(
  clips: readonly ClipMaterialise[], ordreRangs: readonly number[],
): ClipMaterialise[] {
  const position = new Map(ordreRangs.map((rang, i) => [rang, i]));
  return [...clips].sort((a, b) => {
    const pa = position.get(a.rang) ?? Number.MAX_SAFE_INTEGER;
    const pb = position.get(b.rang) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || a.rang - b.rang;
  });
}

/**
 * L'ORDRE D'UN MONTAGE MULTI-SOURCE — A_7b.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE PERD QUAND ON MÊLE DEUX RUSHES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `m3g-v2` remet les segments en ordre chronologique, et son commentaire dit
 * pourquoi : sur UN rush, la source a une chronologie, et un montage qui
 * saute en arrière surprend. Le même commentaire prévoyait ceci :
 *
 *   « Le jour où un montage mêlera plusieurs rushes, "avant" et "après"
 *     cesseront d'avoir un sens entre deux fichiers, et cette règle devra
 *     être reprise par le lot qui les mêlera. »
 *
 * C'est ce lot. Trier tous les segments sur `plage.debut` mêlerait deux
 * horloges sans rapport : la 3ᵉ seconde de B passerait avant la 40ᵉ de A pour
 * une raison qui n'existe pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI RESTE VRAI, ET LA RÈGLE QUI EN DÉCOULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux choses survivent au mélange :
 *
 *   1. la chronologie DANS chaque source. Un rush montré à rebours de
 *      lui-même se remarque, même entrecoupé d'autre chose ;
 *   2. l'intérêt d'ALTERNER. Montrer tout A puis tout B, c'est coller deux
 *      plans-séquences, pas monter — et c'est exactement ce qu'un ordre par
 *      blocs produirait.
 *
 * La règle tient donc les deux : chaque source garde son ordre interne, et on
 * sert à chaque tour la source qui a le PLUS de segments restants, en évitant
 * de reprendre celle qu'on vient de servir tant qu'une autre est disponible.
 * Une source majoritaire revient donc souvent sans jamais monopoliser deux
 * places de suite s'il existe une alternative.
 *
 * ⚠️ AUCUN TIRAGE AU SORT. À égalité de restant, c'est l'ordre de PREMIÈRE
 * APPARITION qui tranche — celui-là même qui ordonne les sources du plan et
 * nourrit `empreinteJeuxSources`. Deux appels identiques rendent le même
 * montage, sans quoi l'identité du plan ne voudrait rien dire.
 *
 * Rend les INDICES d'entrée, dans l'ordre de montage.
 */
export function entrelacerSources(
  segments: readonly { cle: string; debut: number }[],
): number[] {
  /* Chaque source, dans son ordre chronologique interne. L'ordre des groupes
     est celui de première apparition dans la liste reçue. */
  const groupes = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i += 1) {
    const g = groupes.get(segments[i].cle);
    if (g) g.push(i); else groupes.set(segments[i].cle, [i]);
  }
  for (const g of groupes.values()) {
    g.sort((a, b) => segments[a].debut - segments[b].debut || a - b);
  }

  const cles = [...groupes.keys()];
  const rangDeCle = new Map(cles.map((c, i) => [c, i]));
  const restants = new Map(cles.map((c) => [c, 0]));

  const sortie: number[] = [];
  let precedente: string | null = null;

  while (sortie.length < segments.length) {
    const disponibles = cles.filter(
      (c) => (restants.get(c) as number) < (groupes.get(c) as number[]).length,
    );
    if (disponibles.length === 0) break;

    /* ⚠️ « AUTRE QUE LA PRÉCÉDENTE » N'EST PAS UNE INTERDICTION. Quand A est
       seul à avoir encore de la matière, il reprend la main : refuser
       reviendrait à jeter des segments retenus pour une règle de forme. */
    const autres = disponibles.filter((c) => c !== precedente);
    const choix = (autres.length > 0 ? autres : disponibles)
      .sort((a, b) => {
        const ra = (groupes.get(a) as number[]).length - (restants.get(a) as number);
        const rb = (groupes.get(b) as number[]).length - (restants.get(b) as number);
        return rb - ra || (rangDeCle.get(a) as number) - (rangDeCle.get(b) as number);
      })[0];

    const i = restants.get(choix) as number;
    sortie.push((groupes.get(choix) as number[])[i]);
    restants.set(choix, i + 1);
    precedente = choix;
  }
  return sortie;
}

/**
 * Bâtit le plan, ou dit pourquoi il ne peut pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE DE REMPLISSAGE, ET CE QU'ELLE REFUSE DE FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On avance dans l'ordre et on cumule les durées MESURÉES. Trois issues
 * possibles pour chaque clip :
 *
 *   • il tient entièrement sous la cible → retenu tel quel ;
 *   • il dépasse → RACCOURCI pour tomber exactement sur la cible, jamais
 *     rallongé ;
 *   • le raccourcissement le ramènerait sous `DUREE_PLAN_MIN_SECONDES` →
 *     écarté, parce qu'un plan de deux dixièmes de seconde est un
 *     clignotement, pas un plan.
 *
 * ⚠️ CE QUI N'EST JAMAIS FAIT POUR ATTEINDRE LA CIBLE : rallonger un plan
 * au-delà de son clip (il n'y a pas d'image après la dernière), répéter un
 * clip, insérer du noir. Si la matière manque, `ecartSecondes` le dit et le
 * plan sort plus court. C'est un déficit VISIBLE plutôt qu'un montage
 * silencieusement rallongé — et c'est l'utilisateur qui décide s'il tourne
 * davantage ou vise plus court.
 */
interface Plage { debut: number; fin: number }

function nombreFiniPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ce qu'il reste d'une plage une fois retirées celles déjà retenues.
 *
 * ⚠️ AUCUNE IMAGE SOURCE DEUX FOIS. Les candidats ont le droit de se
 * recouvrir — M3-C tolère jusqu'à une seconde entre voisins — mais un
 * montage qui rejoue les mêmes images n'est pas un montage : le rendu du
 * 2026-09-04 répétait 1,85 s sur 23. Ce qui est déjà pris est donc soustrait
 * ici, avant toute décision.
 */
function reste(plage: Plage, prises: readonly Plage[]): Plage[] {
  let morceaux: Plage[] = [plage];
  for (const p of prises) {
    const suite: Plage[] = [];
    for (const m of morceaux) {
      if (p.fin <= m.debut || p.debut >= m.fin) { suite.push(m); continue; }
      if (m.debut < p.debut) suite.push({ debut: m.debut, fin: Math.min(m.fin, p.debut) });
      if (m.fin > p.fin) suite.push({ debut: Math.max(m.debut, p.fin), fin: m.fin });
    }
    morceaux = suite;
  }
  return morceaux.filter((m) => m.fin > m.debut);
}

/**
 * Ce qui SÉPARE deux plages source, en secondes. Zéro si elles se touchent
 * ou se recouvrent.
 */
function ecart(a: Plage, b: Plage): number {
  return Math.max(0, Math.max(a.debut, b.debut) - Math.min(a.fin, b.fin));
}

/** Le plus long morceau restant. Déterministe : à égalité, le premier. */
function plusLong(morceaux: readonly Plage[]): Plage | null {
  let meilleur: Plage | null = null;
  for (const m of morceaux) {
    if (meilleur === null || (m.fin - m.debut) > (meilleur.fin - meilleur.debut)) meilleur = m;
  }
  return meilleur;
}

export function planifierMontage(
  demande: DemandePlan,
): { resultat: ResultatPlan | null; motif: MotifPlan | null } {
  const { format, dureeCibleSecondes, geometrie } = demande;

  if (demande.clips.length === 0) return { resultat: null, motif: 'jeu_sans_clip' };

  // ⚠️ LA POLITIQUE D'ABORD, LE REMPLISSAGE ENSUITE. Elle ne touche qu'à
  // l'ordre de proposition ; tout ce qui suit est le moteur de `m3g-v2`,
  // inchangé.
  const politique = demande.politique ?? politiqueDePlan(
    demande.clips.map((c) => ({
      rang: c.rang, scoreMontage: c.scoreMontage, signaux: c.signaux,
    })),
    demande.objectif,
    ALGORITHME_PLAN,
  );
  const ordonnes = politique.objectiveAware
    ? selonPolitique(demande.clips, politique.ordreRangs)
    : parRang(demande.clips);

  /* ── LE CADRE, PAR SOURCE ────────────────────────────────────────────
     Une seule source : une seule entrée, calculée sur `geometrie` comme
     avant. Plusieurs : chacune apporte la sienne, et une seule géométrie
     illisible suffit à refuser le plan — recadrer de travers un rush pour
     sauver les autres produirait un montage qui a l'air valide. */
  const contextes: readonly ContexteSourcePlan[] = demande.contextes
    ?? [{ cle: '', geometrie, dureeRushSecondes: demande.dureeRushSecondes }];
  const parCle = new Map(contextes.map((c) => [c.cle, c]));

  const cadrages = new Map<string, NonNullable<ReturnType<typeof recadrer>>>();
  for (const c of contextes) {
    const r = recadrer(c.geometrie.largeur, c.geometrie.hauteur, format);
    if (r === null) return { resultat: null, motif: 'geometrie_inconnue' };
    cadrages.set(c.cle, r);
  }

  const contexteDe = (clip: ClipMaterialise) => parCle.get(cleDe(clip)) ?? contextes[0];
  const geometrieDe = (clip: ClipMaterialise) => contexteDe(clip).geometrie;
  const cadrageDe = (clip: ClipMaterialise) =>
    cadrages.get(cleDe(clip)) ?? cadrages.get(contextes[0].cle)!;

  /**
   * La provenance d'un segment, quand sa source la déclare.
   *
   * ⚠️ RIEN SUR LE CHEMIN HISTORIQUE. Une source implicite ne déclare aucun
   * `source` : le `jsonb` d'un plan mono-rush reste donc identique à celui
   * d'avant ce lot, et son empreinte avec lui. C'est A_7a qui résout la
   * provenance de ces plans-là, à la lecture.
   */
  const provenanceDe = (clip: ClipMaterialise, debutSource: number, duree: number) => {
    const base = contexteDe(clip).source;
    if (!base) return null;
    const rang = (clip as Partial<ClipSource>).rangDansJeu ?? clip.rang;
    return {
      source: {
        ...base,
        rangClip: rang,
        debutSourceSecondes: arrondirSeconde(debutSource),
        finSourceSecondes: arrondirSeconde(debutSource + duree),
      } as SourceSegment,
    };
  };

  const cible = dimensionsCible(format);
  let cumul = 0;
  let ecartes = 0;
  let raccourcis = 0;

  /**
   * Le plafond de couverture, en secondes de rush.
   *
   * ⚠️ SANS DUREE DE RUSH, PAS DE PLAFOND. On ne peut pas dire quelle part
   * d'une source on montre si on ignore combien elle dure ; refuser au
   * hasard serait pire que ne pas refuser.
   */
  const dureeRushParCle = new Map<string, number | null>();
  const couvertureMaxParCle = new Map<string, number>();
  for (const c of contextes) {
    const d = nombreFiniPositif(c.dureeRushSecondes);
    dureeRushParCle.set(c.cle, d);
    couvertureMaxParCle.set(
      c.cle, d === null ? Infinity : arrondirSeconde(COUVERTURE_MAX_RUSH * d),
    );
  }

  /** Ce qui est déjà pris DANS CHAQUE SOURCE, pour n'en rien montrer deux fois. */
  const prisesParCle = new Map<string, Plage[]>(contextes.map((c) => [c.cle, []]));
  const couvertureParCle = new Map<string, number>(contextes.map((c) => [c.cle, 0]));
  const retenus: Array<{ clip: ClipMaterialise; plage: Plage; entree: number; duree: number; raccourci: boolean }> = [];

  for (const clip of ordonnes) {
    // Le plafond de M3-F vaut aussi ici : au plus autant de plans que de
    // clips matérialisables. Tout ce qui suit est écarté, et compté.
    if (retenus.length >= PLANS_MAX) { ecartes += 1; continue; }

    /* ⚠️ L'ÉTAT SUIVI EST CELUI DE LA SOURCE DU CLIP. Un clip dont la source
       n'est pas déclarée est écarté plutôt que rattaché à une autre : le
       rattacher lui donnerait le cadre et le plafond d'un rush qui n'est pas
       le sien, et le montage aurait l'air valide. */
    const cle = cleDe(clip);
    const prises = prisesParCle.get(cle);
    const contexte = parCle.get(cle);
    if (!prises || !contexte) { ecartes += 1; continue; }
    const couvertureMax = couvertureMaxParCle.get(cle) ?? Infinity;
    const couverture = couvertureParCle.get(cle) ?? 0;

    const disponible = dureeUtilisable(clip);
    if (disponible === null) { ecartes += 1; continue; }

    /**
     * ── UN MOMENT DISTINCT, PAS LA SUITE DU PRÉCÉDENT ─────────────────
     *
     * ⚠️ ÉVALUÉ SUR LA PLAGE BRUTE, AVANT TOUT ROGNAGE. Rogner d'abord
     * transformerait deux candidats qui se recouvrent en deux plans
     * exactement adjacents — c'est ce qui s'est produit sur le cas de
     * production : `8,972 → 16,972` suivi de `16,972 → 21,237`, soit une
     * seule plage continue de 12,3 s. Techniquement deux plans,
     * éditorialement le rush.
     *
     * Un candidat qui touche un passage déjà retenu, ou qui n'en est séparé
     * que par moins d'une seconde, est donc écarté AU PROFIT DU SUIVANT — on
     * ne le rogne pas pour prolonger la même scène.
     */
    const brute: Plage = { debut: clip.debutSecondes, fin: clip.finSecondes };
    /* ⚠️ COMPARÉ AUX SEULS MOMENTS DE LA MÊME SOURCE. « 15 s » dans A et
       « 15 s » dans B sont deux images sans rapport ; les confronter ferait
       écarter le second comme la suite du premier, et le montage perdrait en
       silence tout ce qui vient des rushes suivants. */
    if (retenus.some((r) => cleDe(r.clip) === cle
        && ecart(brute, r.plage) < ECART_MOMENTS_MIN_SECONDES)) {
      ecartes += 1;
      continue;
    }

    // ── Ce que ce clip apporte de NEUF dans la source ──────────────────
    const morceau = plusLong(reste(
      { debut: clip.debutSecondes, fin: clip.finSecondes }, prises,
    ));
    if (morceau === null) { ecartes += 1; continue; }
    // Le fichier découpé commence au début du passage : l'entrée est le
    // décalage du morceau retenu par rapport à ce début.
    const entree = arrondirSeconde(Math.max(0, morceau.debut - clip.debutSecondes));
    /**
     * ⚠️ LA DUREE VIENT DU FICHIER, PAS DES BORNES DEMANDEES.
     *
     * `dureeUtilisable` rend la duree MESUREE du clip decoupe — 2,934 s la ou
     * les bornes disaient 2,92 : ffmpeg cale sur une frame. Tant que le
     * morceau va jusqu'au bout du passage, c'est cette mesure qui fait foi ;
     * seul un morceau tronque par un chevauchement se calcule sur les bornes.
     */
    const jusquAuBout = morceau.fin >= clip.finSecondes;
    const finDansLeFichier = jusquAuBout
      ? disponible
      : arrondirSeconde(morceau.fin - clip.debutSecondes);
    const neuf = arrondirSeconde(Math.min(finDansLeFichier, disponible) - entree);
    if (neuf < DUREE_PLAN_MIN_SECONDES) { ecartes += 1; continue; }

    // ── Les deux plafonds. AUCUN N'EST UNE CIBLE ───────────────────────
    //
    // La durée demandée est une commande explicite : on peut y tomber pile,
    // donc on raccourcit. La couverture est une garde éditoriale interne :
    // la remplir n'aurait aucun sens, on écarte plutôt que de rogner.
    if (arrondirSeconde(couverture + neuf) > couvertureMax) { ecartes += 1; continue; }

    const place = arrondirSeconde(dureeCibleSecondes - cumul);
    if (place <= 0) { ecartes += 1; continue; }
    const retenue = arrondirSeconde(Math.min(neuf, place));
    // Un plan trop court n'est pas un plan : on l'écarte plutôt que de le
    // laisser clignoter. Le déficit restant sera dit par `ecartSecondes`.
    if (retenue < DUREE_PLAN_MIN_SECONDES) { ecartes += 1; continue; }

    const raccourci = retenue < neuf;
    if (raccourci) raccourcis += 1;

    retenus.push({
      clip,
      plage: { debut: morceau.debut, fin: arrondirSeconde(morceau.debut + retenue) },
      entree,
      duree: retenue,
      raccourci,
    });
    prises.push({ debut: morceau.debut, fin: arrondirSeconde(morceau.debut + retenue) });
    couvertureParCle.set(cle, arrondirSeconde(couverture + retenue));
    cumul = arrondirSeconde(cumul + retenue);
  }

  if (retenus.length === 0) return { resultat: null, motif: 'plan_vide' };

  /**
   * ⚠️ LE SCORE CHOISIT, LA CHRONOLOGIE MONTE.
   *
   * Le classement de M3-C dit QUELS passages valent la peine ; il ne dit pas
   * dans quel ordre les regarder. Les garder dans l'ordre du score donnait,
   * sur un seul rush, un montage qui saute en arrière — 8,9 s, puis 16,2 s,
   * puis 0 s. Sur un rush unique, la source A une chronologie, et la suivre
   * est la seule lecture qui ne surprenne pas.
   *
   * ⚠️ SINGLE-RUSH SEULEMENT. Le jour où un montage mêlera plusieurs rushes,
   * « avant » et « après » cesseront d'avoir un sens entre deux fichiers, et
   * cette règle devra être reprise par le lot qui les mêlera.
   */
  const multiSource = contextes.length > 1;
  if (!multiSource) {
    retenus.sort((a, b) => a.plage.debut - b.plage.debut);
  } else {
    /* ⚠️ LA RÈGLE CI-DESSUS EST REPRISE ICI, COMME SON COMMENTAIRE L'AVAIT
       PRÉVU. « Avant » et « après » n'ont plus de sens entre deux fichiers :
       trier tous les segments par `plage.debut` mêlerait les horloges de deux
       rushes sans rapport et produirait un ordre qui n'a aucune raison d'être.

       Ce qui reste vrai, c'est la chronologie DANS chaque source : un rush
       montré à rebours de lui-même se remarque. `entrelacerSources` la tient
       source par source, et alterne entre elles plutôt que de les servir en
       blocs — un montage qui montre tout A puis tout B est deux plans-séquences
       collés, pas un montage. */
    const ordre = entrelacerSources(retenus.map((r) => ({ cle: cleDe(r.clip), debut: r.plage.debut })));
    const reordonnes = ordre.map((i) => retenus[i]);
    retenus.length = 0;
    retenus.push(...reordonnes);
  }

  const plans: PlanMontage[] = [];
  let timeline = 0;
  for (const r of retenus) {
    plans.push({
      ordre: plans.length + 1,
      rangClip: r.clip.rang,
      bucket: r.clip.bucket,
      cle: r.clip.cle,
      entreeSecondes: r.entree,
      dureeRetenueSecondes: r.duree,
      debutTimelineSecondes: arrondirSeconde(timeline),
      raccourci: r.raccourci,
      recadrage: cadrageDe(r.clip).recadrage,
      strategieRecadrage: cadrageDe(r.clip).strategie,
      largeurSource: geometrieDe(r.clip).largeur,
      hauteurSource: geometrieDe(r.clip).hauteur,
      // Coupe franche, toujours. Le fondu appartient à un lot ultérieur.
      raccordEntrant: RACCORD_DEFAUT,
      /* ⚠️ LA PROVENANCE, QUAND LA SOURCE LA DÉCLARE — A_7a. Elle porte la
         plage DANS LE RUSH : `morceau.debut` est déjà une seconde du rush, et
         `r.duree` la part réellement montrée. La plage MONTAGE reste
         `debutTimelineSecondes` / `dureeRetenueSecondes`, deux lignes plus
         haut ; les confondre est le bug qui ne se voit qu'à l'image. */
      ...(provenanceDe(r.clip, r.plage.debut, r.duree) ?? {}),
    });
    timeline = arrondirSeconde(timeline + r.duree);
  }
  cumul = arrondirSeconde(timeline);

  return {
    resultat: {
      plans,
      dureeTotaleSecondes: cumul,
      // Positif quand la matière a manqué ; zéro quand la cible est atteinte.
      // Jamais négatif : le remplissage ne dépasse pas la cible.
      ecartSecondes: arrondirSeconde(Math.max(0, dureeCibleSecondes - cumul)),
      clipsEcartes: ecartes,
      usage: {
        // ⚠️ LA POLITIQUE RÉELLEMENT APPLIQUÉE, pas la constante. Sur le
        // chemin générique elle VAUT `ALGORITHME_PLAN`, et le relevé est
        // donc identique au caractère près à celui d'avant l'étape 4B.
        algorithmePlan: politique.algorithmePlan,
        clipsRecus: demande.clips.length,
        plansRetenus: plans.length,
        clipsEcartes: ecartes,
        plansRaccourcis: raccourcis,
        secondesDisponibles: arrondirSeconde(
          ordonnes.reduce((t, c) => t + (dureeUtilisable(c) ?? 0), 0),
        ),
        largeurCible: cible.largeur,
        hauteurCible: cible.hauteur,
        strategieRecadrage: cadrages.get(contextes[0].cle)!.strategie,
        // Ce que la politique editoriale a decide, releve pour la relecture.
        /* ⚠️ CELLES DE LA PREMIÈRE SOURCE — c'est-à-dire LES SIENNES quand il
           n'y en a qu'une, donc le relevé historique au caractère près. Le
           détail par source, lui, est ajouté plus bas et seulement en
           multi-rush : ajouter une clé sur le chemin mono rendrait
           invérifiable la promesse « rien n'a changé ». */
        couvertureSecondes: couvertureParCle.get(contextes[0].cle) ?? 0,
        couvertureMaxSecondes: Number.isFinite(couvertureMaxParCle.get(contextes[0].cle))
          ? couvertureMaxParCle.get(contextes[0].cle) : null,
        couverturePart: dureeRushParCle.get(contextes[0].cle) == null
          ? null
          : Math.round(((couvertureParCle.get(contextes[0].cle) ?? 0)
              / (dureeRushParCle.get(contextes[0].cle) as number)) * 1000) / 1000,
        ordreFinal: 'chronologique',
        ecartMomentsMin: ECART_MOMENTS_MIN_SECONDES,
        // Le plus petit trou entre deux moments montés : la mesure qui dit
        // si les coupes se voient. `null` quand il n'y a qu'un moment.
        /* ⚠️ `null` EN MULTI-RUSH, ET CE N'EST PAS UNE OMISSION. Cette mesure
           dit si deux moments montés viennent d'assez loin l'un de l'autre
           pour que la coupe se voie. Entre deux rushes, la distance n'existe
           pas : la calculer sur des horloges sans rapport rendrait un nombre
           qui a l'air d'une mesure. Le détail par source, ci-dessous, dit ce
           qui est réellement mesurable. */
        plusPetitTrouSecondes: multiSource || retenus.length < 2 ? null : arrondirSeconde(
          Math.min(...retenus.slice(1).map(
            (r, i) => r.plage.debut - retenus[i].plage.fin,
          )),
        ),
        ...(multiSource ? {
          sources: contextes.map((c) => ({
            cle: c.cle,
            rushId: c.source?.rushId ?? null,
            clipSetVersion: c.source?.clipSetVersion ?? null,
            segments: retenus.filter((r) => cleDe(r.clip) === c.cle).length,
            couvertureSecondes: couvertureParCle.get(c.cle) ?? 0,
            couvertureMaxSecondes: Number.isFinite(couvertureMaxParCle.get(c.cle))
              ? couvertureMaxParCle.get(c.cle) : null,
            largeurSource: c.geometrie.largeur,
            hauteurSource: c.geometrie.hauteur,
          })),
          ordreFinalMultiSource: 'alternance-chronologique-par-source',
        } : {}),
        // ─────────────────────────────────────────────────────────────
        // L'EXPLICABILITÉ — AJOUTÉE SEULEMENT QUAND L'OBJECTIF A SERVI
        // ─────────────────────────────────────────────────────────────
        //
        // ⚠️ RIEN SUR LE CHEMIN GÉNÉRIQUE. Ces clés ne doivent pas apparaître
        // dans le relevé d'un plan qui n'a lu aucun objectif : le plan
        // historique doit rester identique jusque dans son `usage`, sans
        // quoi « rien n'a changé » deviendrait invérifiable.
        //
        // ⚠️ DES IDENTIFIANTS, JAMAIS UNE PHRASE. C'est ce qui permettra de
        // répondre « pourquoi ce passage ? » sans qu'un texte produit par un
        // modèle n'ait jamais pesé sur la décision.
        ...(politique.objectiveAware ? {
          objectif: {
            versionScoring: VERSION_SCORING,
            versionSignaux: VERSION_SIGNAUX,
            ordreRangs: politique.ordreRangs,
            palierQualite: PALIER_QUALITE,
            fenetres: [...demande.clips]
              .sort((a, b) => a.rang - b.rang)
              .map((c) => ({
                rang: c.rang,
                retenu: retenus.some((r) => r.clip.rang === c.rang),
                scoreMontage: c.scoreMontage,
                palier: c.scoreMontage === null ? null : palierDeQualite(c.scoreMontage),
                objectiveScore: politique.notes[c.rang]?.score ?? null,
                objectiveReasons: politique.notes[c.rang]?.raisons ?? [],
                criteresApplicables: politique.notes[c.rang]?.criteresApplicables ?? 0,
                criteresDemandes: politique.notes[c.rang]?.criteresDemandes ?? 0,
                paroleEtat: c.signaux?.parole.etat ?? null,
              })),
          },
        } : {}),
      },
      politique,
    },
    motif: null,
  };
}

/**
 * La géométrie du rush, lue dans `rush_analyses.technique`.
 *
 * ⚠️ LUE, JAMAIS DEVINÉE. Sans dimensions mesurées, il n'y a aucun moyen de
 * décider d'un recadrage : supposer du 1920×1080 aurait recadré de travers un
 * rush vertical, et le plan aurait eu l'air valide. Une géométrie absente est
 * un refus (`geometrie_inconnue`), pas un défaut.
 *
 * Les images par seconde sont facultatives : elles servent au rendu de M3-H,
 * pas à la décision d'ici. À défaut, la cadence des compositions du site.
 */
export const FPS_DEFAUT = 30;

/**
 * Les bornes de la colonne `fps`, recopiees du `check` de la migration
 * `2026-09-05-rush-montage-plans.sql`. Les tenir ICI evite que la base soit
 * le seul endroit qui sache dire non — et elle le dit par une exception que
 * personne n'attrape.
 */
export const FPS_MIN = 1;
export const FPS_MAX = 240;

export function geometrieDepuisTechnique(
  technique: Record<string, unknown> | null | undefined,
): GeometrieSource | null {
  if (typeof technique !== 'object' || technique === null) return null;
  const largeur = Number(technique.largeur);
  const hauteur = Number(technique.hauteur);
  if (!Number.isFinite(largeur) || !Number.isFinite(hauteur)) return null;
  if (largeur <= 0 || hauteur <= 0) return null;
  /**
   * ⚠️ LE FPS S'ARRONDIT, COMME LA LARGEUR ET LA HAUTEUR JUSTE AU-DESSUS.
   *
   * `rush_montage_plans.fps` est un `integer not null check (fps between 1 and
   * 240)`. Une camera de telephone se sonde volontiers a 30,046 images par
   * seconde — cadence variable — et cette valeur partait telle quelle vers la
   * colonne : la base refusait l'insertion, l'exception n'etait prevue nulle
   * part, et la route rendait « Une erreur interne est survenue ». Le rush
   * etait pourtant sain, ses clips aussi, et rien a l'ecran ne pouvait le
   * laisser deviner.
   *
   * Constate en production le 2026-09-04 sur `20260903_073142_195_1.mp4`
   * (fps sonde : 30,046) ; les rushes a 25 et 30 passaient, d'ou une panne
   * qui semblait aleatoire.
   *
   * Les bornes du `check` sont respectees ici plutot qu'esperees : une
   * cadence aberrante — un sondage a 0,5 ou a 1000 — produirait exactement la
   * meme panne muette.
   */
  const fps = Math.round(Number(technique.fps));
  return {
    largeur: Math.round(largeur),
    hauteur: Math.round(hauteur),
    fps: Number.isFinite(fps) && fps >= FPS_MIN && fps <= FPS_MAX ? fps : FPS_DEFAUT,
  };
}
