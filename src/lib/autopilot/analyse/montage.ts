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

export interface DemandePlan {
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
}

export interface ResultatPlan {
  plans: PlanMontage[];
  dureeTotaleSecondes: number;
  ecartSecondes: number;
  clipsEcartes: number;
  /** Ce qui a servi à décider, relevé pour la lecture après coup. */
  usage: Record<string, unknown>;
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

  const ordonnes = parRang(demande.clips);
  if (ordonnes.length === 0) return { resultat: null, motif: 'jeu_sans_clip' };

  const cadrage = recadrer(geometrie.largeur, geometrie.hauteur, format);
  if (cadrage === null) return { resultat: null, motif: 'geometrie_inconnue' };

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
  const dureeRush = nombreFiniPositif(demande.dureeRushSecondes);
  const couvertureMax = dureeRush === null
    ? Infinity
    : arrondirSeconde(COUVERTURE_MAX_RUSH * dureeRush);

  /** Ce qui est déjà pris dans la SOURCE, pour n'en rien montrer deux fois. */
  const prises: Plage[] = [];
  let couverture = 0;
  const retenus: Array<{ clip: ClipMaterialise; plage: Plage; entree: number; duree: number; raccourci: boolean }> = [];

  for (const clip of ordonnes) {
    // Le plafond de M3-F vaut aussi ici : au plus autant de plans que de
    // clips matérialisables. Tout ce qui suit est écarté, et compté.
    if (retenus.length >= PLANS_MAX) { ecartes += 1; continue; }

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
    if (retenus.some((r) => ecart(brute, r.plage) < ECART_MOMENTS_MIN_SECONDES)) {
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
    couverture = arrondirSeconde(couverture + retenue);
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
  retenus.sort((a, b) => a.plage.debut - b.plage.debut);

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
      recadrage: cadrage.recadrage,
      strategieRecadrage: cadrage.strategie,
      largeurSource: geometrie.largeur,
      hauteurSource: geometrie.hauteur,
      // Coupe franche, toujours. Le fondu appartient à un lot ultérieur.
      raccordEntrant: RACCORD_DEFAUT,
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
        algorithmePlan: ALGORITHME_PLAN,
        clipsRecus: demande.clips.length,
        plansRetenus: plans.length,
        clipsEcartes: ecartes,
        plansRaccourcis: raccourcis,
        secondesDisponibles: arrondirSeconde(
          ordonnes.reduce((t, c) => t + (dureeUtilisable(c) ?? 0), 0),
        ),
        largeurCible: cible.largeur,
        hauteurCible: cible.hauteur,
        strategieRecadrage: cadrage.strategie,
        // Ce que la politique editoriale a decide, releve pour la relecture.
        couvertureSecondes: couverture,
        couvertureMaxSecondes: Number.isFinite(couvertureMax) ? couvertureMax : null,
        couverturePart: dureeRush === null
          ? null
          : Math.round((couverture / dureeRush) * 1000) / 1000,
        ordreFinal: 'chronologique',
        ecartMomentsMin: ECART_MOMENTS_MIN_SECONDES,
        // Le plus petit trou entre deux moments montés : la mesure qui dit
        // si les coupes se voient. `null` quand il n'y a qu'un moment.
        plusPetitTrouSecondes: retenus.length < 2 ? null : arrondirSeconde(
          Math.min(...retenus.slice(1).map(
            (r, i) => r.plage.debut - retenus[i].plage.fin,
          )),
        ),
      },
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
