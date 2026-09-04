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
export function planifierMontage(
  demande: DemandePlan,
): { resultat: ResultatPlan | null; motif: MotifPlan | null } {
  const { format, dureeCibleSecondes, geometrie } = demande;

  const ordonnes = parRang(demande.clips);
  if (ordonnes.length === 0) return { resultat: null, motif: 'jeu_sans_clip' };

  const cadrage = recadrer(geometrie.largeur, geometrie.hauteur, format);
  if (cadrage === null) return { resultat: null, motif: 'geometrie_inconnue' };

  const cible = dimensionsCible(format);
  const plans: PlanMontage[] = [];
  let cumul = 0;
  let ecartes = 0;
  let raccourcis = 0;

  for (const clip of ordonnes) {
    // Le plafond de M3-F vaut aussi ici : au plus autant de plans que de
    // clips matérialisables. Tout ce qui suit est écarté, et compté.
    if (plans.length >= PLANS_MAX) { ecartes += 1; continue; }

    const disponible = dureeUtilisable(clip);
    if (disponible === null) { ecartes += 1; continue; }

    const reste = arrondirSeconde(dureeCibleSecondes - cumul);
    if (reste <= 0) { ecartes += 1; continue; }

    const retenue = arrondirSeconde(Math.min(disponible, reste));
    // Un plan trop court n'est pas un plan : on l'écarte plutôt que de le
    // laisser clignoter. Le déficit restant sera dit par `ecartSecondes`.
    if (retenue < DUREE_PLAN_MIN_SECONDES) { ecartes += 1; continue; }

    const raccourci = retenue < disponible;
    if (raccourci) raccourcis += 1;

    plans.push({
      ordre: plans.length + 1,
      rangClip: clip.rang,
      bucket: clip.bucket,
      cle: clip.cle,
      // Le clip découpé commence à zéro : M3-F l'a mesuré sur les cinq clips
      // de production (`debutMesureSecondes` valait 0 partout). Entrer
      // ailleurs que zéro serait une décision de montage que M3-G ne prend
      // pas — il garde le début du passage que M3-E avait choisi.
      entreeSecondes: 0,
      dureeRetenueSecondes: retenue,
      debutTimelineSecondes: arrondirSeconde(cumul),
      raccourci,
      recadrage: cadrage.recadrage,
      strategieRecadrage: cadrage.strategie,
      largeurSource: geometrie.largeur,
      hauteurSource: geometrie.hauteur,
      // Coupe franche, toujours. Le fondu appartient à un lot ultérieur.
      raccordEntrant: RACCORD_DEFAUT,
    });

    cumul = arrondirSeconde(cumul + retenue);
  }

  if (plans.length === 0) return { resultat: null, motif: 'plan_vide' };

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
