/**
 * UX-A1 — LE RENDU D'UNE SESSION DE TOURNAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-H sait relire UN rendu, à condition de connaître son identifiant. Rien
 * ne sait répondre à la question que pose l'écran : « ce tournage a-t-il
 * produit une vidéo ? ». Sans elle, un rechargement de page perd le rendu
 * qu'on venait de suivre — l'identifiant ne vivait que dans la mémoire de
 * l'onglet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LECTURE SEULE, ET STRICTEMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun `insert`, aucun `update`, aucun `delete`. Aucun ffmpeg, aucune place
 * de capacité prise, aucun crédit. Ce module ne DÉCLENCHE rien : il suit une
 * chaîne de clés étrangères déjà écrite et rend ce qu'il trouve.
 *
 * ⚠️ ET IL NE MODIFIE AUCUN FICHIER DE M3-A À M3-H. Il n'en importe que ce
 * qui est déjà exporté — `listerRushes` (M3-A), `COLONNES_RENDU` et
 * `renduDepuisLigne` (M3-H). Le socle reste intact.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CHAÎNE, ET POURQUOI ELLE FAIT QUATRE LECTURES
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   session → rushes → jeux de clips → plans de montage → rendus
 *
 * `rush_montage_plans` ne porte PAS de `rush_id` : il désigne son jeu de
 * clips, qui lui porte le rush. Il n'existe donc aucun raccourci, et en
 * inventer un — un `rush_id` dénormalisé, une vue — demanderait une
 * migration que ce lot n'a pas le droit de faire.
 *
 * Chaque lecture est filtrée sur `user_id` DANS la requête, comme le fait
 * `lireRenduParId`. Un identifiant d'autrui est ainsi indiscernable d'un
 * identifiant inconnu, et aucune décision de propriété n'est laissée à
 * l'appelant.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { listerRushes } from '@/lib/autopilot/tournage/service';
import {
  COLONNES_RENDU, renduDepuisLigne, type RenduMontage,
} from './rendu-service';

/**
 * Ce qui peut empêcher la lecture d'aboutir.
 *
 * `socle_absent` couvre les QUATRE tables de la chaîne : une seule migration
 * manquante suffit, et l'écran n'a pas à savoir laquelle.
 */
export type MotifRenduSession =
  | 'socle_absent'
  | 'session_introuvable';

/** 42P01 / PGRST205 : une migration de la chaîne n'est pas appliquée. */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

/**
 * Le nombre d'identifiants qu'un maillon accepte de transporter.
 *
 * ⚠️ UNE BORNE, PAS UNE PAGINATION. `in.(…)` part dans l'URL de PostgREST :
 * une session de trois cents rushes fabriquerait une requête que le proxy
 * refuse, et le refus ressemblerait à une panne. La borne garde les plus
 * RÉCENTS, qui sont ce qu'un écran de résultats montre.
 */
const MAILLONS_MAX = 200;

/** Les identifiants d'une colonne, dédoublonnés et bornés. */
function identifiants(lignes: unknown, colonne: string): string[] {
  if (!Array.isArray(lignes)) return [];
  const vus = new Set<string>();
  for (const l of lignes) {
    if (typeof l !== 'object' || l === null) continue;
    const v = (l as Record<string, unknown>)[colonne];
    if (typeof v === 'string' && v.length > 0) vus.add(v);
    if (vus.size >= MAILLONS_MAX) break;
  }
  return [...vus];
}

/**
 * Ce que le PLAN de ce rendu avait demande, et ce qui manque.
 *
 * ⚠️ TROIS NOMBRES, ET RIEN D'AUTRE. Pas de liste de clips, pas de rangs, pas
 * de scores : l'ecran doit pouvoir dire « vous aviez demande une minute »
 * sans exposer le moteur a qui ne l'a pas demande.
 */
export interface MontageDemande {
  /** Ce que l'utilisateur a demande, en secondes. */
  demandeeSecondes: number;
  /** Ce qui manque pour l'atteindre. Zero quand la cible est tenue. */
  ecartSecondes: number;
  /** Combien de passages le moteur a ecartes en chemin. */
  clipsEcartes: number;
}

/** Un nombre fini, ou `0`. Une ligne ancienne peut ne rien porter. */
function nombreSur(row: Record<string, unknown>, cle: string): number {
  const v = row[cle];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * ⚠️ `null` PLUTOT QU'UN ZERO INVENTE. Un plan ancien peut n'avoir aucune
 * duree cible : afficher « 0 s demandee » serait un mensonge lisible, alors
 * qu'une absence se tait proprement.
 */
export function montageDemandeDepuisLigne(
  row: Record<string, unknown>,
): MontageDemande | null {
  const demandee = row.duree_cible_secondes;
  if (typeof demandee !== 'number' || !Number.isFinite(demandee) || demandee <= 0) {
    return null;
  }
  return {
    demandeeSecondes: demandee,
    ecartSecondes: nombreSur(row, 'ecart_secondes'),
    clipsEcartes: nombreSur(row, 'clips_ecartes'),
  };
}

export interface ResultatRenduSession {
  /** Le rendu le plus récent de la session, ou `null` s'il n'y en a aucun. */
  rendu: RenduMontage | null;
  /** Ce que le plan de CE rendu avait demande. `null` si on ne le sait pas. */
  plan?: MontageDemande | null;
  motif: MotifRenduSession | null;
}

const AUCUN: ResultatRenduSession = { rendu: null, plan: null, motif: null };

/**
 * Le rendu le plus récent produit à partir d'une session de tournage.
 *
 * ⚠️ UN SEUL, ET C'EST LE CONTRAT DE CE LOT. La base sait porter plusieurs
 * rendus par session — un plan par format et par durée cible en produit un
 * chacun — mais rien dans le produit ne sait aujourd'hui les NOMMER
 * autrement que par leurs dimensions. Rendre une liste que l'écran
 * afficherait comme « version courte / version longue » inventerait une
 * donnée que le serveur n'a pas.
 *
 * « Le plus récent » et non « le dernier réussi » : c'est la dernière
 * TENTATIVE qui répond à la question posée par quelqu'un qui vient de
 * demander une vidéo. Un échec masqué par une réussite plus ancienne
 * laisserait croire que rien ne s'est passé.
 */
export async function lireRenduDeSession(
  userId: string, sessionId: string,
): Promise<ResultatRenduSession> {
  // ── 1. Les rushes — et, par la même occasion, la propriété de la session ──
  //
  // `listerRushes` relit la session avant les rushes : une session d'autrui
  // rend `session_introuvable`, pas une liste vide. C'est exactement le
  // triage dont cette route a besoin, et il est déjà écrit.
  const { rushes, motif: motifRushes } = await listerRushes(userId, sessionId);
  if (motifRushes === 'socle_absent') return { rendu: null, motif: 'socle_absent' };
  if (motifRushes) return { rendu: null, motif: 'session_introuvable' };
  if (rushes.length === 0) return AUCUN;

  const rushIds = rushes.map((r) => r.id).slice(0, MAILLONS_MAX);

  // ── 2. Les jeux de clips de ces rushes ──────────────────────────────────
  const jeux = await supabaseAdmin
    .from('rush_clip_sets')
    .select('id, created_at')
    .eq('user_id', userId)
    .in('rush_id', rushIds)
    .order('created_at', { ascending: false });

  if (jeux.error) {
    if (socleAbsent(jeux.error)) return { rendu: null, motif: 'socle_absent' };
    throw new Error(jeux.error.message || 'lecture des jeux de clips impossible');
  }
  const jeuIds = identifiants(jeux.data, 'id');
  if (jeuIds.length === 0) return AUCUN;

  /* ── 2 bis. LES PLANS MULTI-RUSH, QUI NE PASSENT PAS PAR LE SCALAIRE ──────
   *
   * ⚠️ SANS CETTE LECTURE, AUCUN MONTAGE MULTI-RUSH N'ETAIT JAMAIS RENDU A
   * L'UTILISATEUR. L'etape 3 retrouve les plans par `clip_set_id`, la colonne
   * scalaire d'origine. A_7M l'a rendue NULLABLE, et les plans multi-source
   * l'ecrivent NULL : leurs sources vivent dans `rush_montage_plan_sources`,
   * une ligne par rush. Un `in('clip_set_id', …)` ne peut donc structurellement
   * pas les voir — et l'ecran continuait d'afficher le dernier montage MONO,
   * en silence, apres chaque creation multi-rush reussie.
   *
   * Constate le 2026-09-09 : quatre plans `m3g-v2+ms1` en base, tous avec
   * `clip_set_id = NULL`, et le panneau montrait un rendu de la veille.
   *
   * ⚠️ LE SCALAIRE N'EST PAS REMPLI POUR AUTANT. Y ecrire un « rush principal »
   * ferait mentir la donnee : un montage a deux sources n'en a pas une seule.
   * La decision d'A_7M tient — c'est la LECTURE qui apprend les deux formes.
   *
   * Une requete de plus, et une seule, quel que soit le nombre de rushes.
   */
  const sources = await supabaseAdmin
    .from('rush_montage_plan_sources')
    .select('plan_id')
    .eq('user_id', userId)
    .in('clip_set_id', jeuIds);

  if (sources.error && !socleAbsent(sources.error)) {
    throw new Error(sources.error.message || 'lecture des sources de plan impossible');
  }
  /* ⚠️ UN SOCLE ABSENT N'EST PAS UNE PANNE ICI. La table est arrivee avec
     A_7M ; sur un serveur qui ne l'a pas encore, les montages mono doivent
     continuer de s'afficher exactement comme avant ce lot. */
  const planIdsMulti = sources.error ? [] : identifiants(sources.data, 'plan_id');

  /* ── 3. Les plans de montage — LES DEUX FORMES ───────────────────────────
   *
   * ⚠️ COLONNES ELARGIES, ET AUCUNE REQUETE PAR RUSH. Le plan sait ce qui a
   * ete DEMANDE (`duree_cible_secondes`) et ce qui manque (`ecart_secondes`,
   * `clips_ecartes`) ; l'ecran, lui, ne voyait que la duree obtenue. Demander
   * 60 s et recevoir 13 s sans un mot fait croire a une panne la ou le moteur
   * a simplement refuse de meubler.
   *
   * ⚠️ DEUX LECTURES PLUTOT QU'UN `or(…)`. La forme MONO se retrouve par
   * `clip_set_id`, la MULTI par les identifiants deja collectes. Un `or`
   * PostgREST aurait demande d'assembler a la main une chaine de filtre avec
   * des listes d'UUID — une syntaxe fragile, qui produit `in.()` sur une liste
   * vide et que tous les clients ne savent pas rejouer. Deux lectures simples
   * disent la meme chose sans piege, et le nombre de requetes reste borne :
   * il ne depend pas du nombre de rushes.
   */
  const COLONNES_PLAN = 'id, created_at, duree_cible_secondes, ecart_secondes, clips_ecartes';

  const plans = await supabaseAdmin
    .from('rush_montage_plans')
    .select(COLONNES_PLAN)
    .eq('user_id', userId)
    .in('clip_set_id', jeuIds)
    .order('created_at', { ascending: false });

  if (plans.error) {
    if (socleAbsent(plans.error)) return { rendu: null, motif: 'socle_absent' };
    throw new Error(plans.error.message || 'lecture des plans impossible');
  }

  /* Les plans MULTI, s'il y en a. Aucune lecture quand la liste est vide : un
     `in` sur rien ne rendrait rien, autant ne pas la poser. */
  let lignesPlans: unknown[] = Array.isArray(plans.data) ? [...plans.data] : [];
  if (planIdsMulti.length > 0) {
    const multi = await supabaseAdmin
      .from('rush_montage_plans')
      .select(COLONNES_PLAN)
      .eq('user_id', userId)
      .in('id', planIdsMulti)
      .order('created_at', { ascending: false });
    if (multi.error) {
      if (socleAbsent(multi.error)) return { rendu: null, motif: 'socle_absent' };
      throw new Error(multi.error.message || 'lecture des plans impossible');
    }
    if (Array.isArray(multi.data)) lignesPlans = [...lignesPlans, ...multi.data];
  }

  const planIds = identifiants(lignesPlans, 'id');
  if (planIds.length === 0) return AUCUN;

  // ── 4. Le rendu le plus récent de ces plans ─────────────────────────────
  const { data: ligne, error: erreurRendus } = await supabaseAdmin
    .from('rush_montage_renders')
    .select(COLONNES_RENDU)
    .eq('user_id', userId)
    .in('montage_plan_id', planIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurRendus) {
    if (socleAbsent(erreurRendus)) return { rendu: null, motif: 'socle_absent' };
    throw new Error(erreurRendus.message || 'lecture des rendus impossible');
  }
  if (!ligne) return AUCUN;

  // ⚠️ `renduDepuisLigne` REVALIDE le résultat : une réussite dont la clé
  // sort du préfixe utilisateur, ou dont les octets valent zéro, est
  // rétrogradée. C'est le même geste qu'à la lecture par identifiant, et
  // c'est ce qui garantit qu'un `video` non nul désigne un fichier servable.
  const rendu = renduDepuisLigne(ligne as Record<string, unknown>);
  // Le plan de CE rendu, retrouve dans la liste deja lue. Absent pour un
  // rendu ancien dont le plan aurait disparu : l'ecran s'en passe alors.
  /* ⚠️ CHERCHE DANS LES DEUX LISTES REUNIES. Ne regarder que la lecture MONO
     laisserait un montage multi-rush sans sa duree demandee : l'ecran dirait
     alors « 0:08 » sans jamais expliquer qu'on en avait demande 30. */
  const ligneP = lignesPlans.find(
    (x) => (x as Record<string, unknown>).id === rendu?.montagePlanId,
  ) as Record<string, unknown> | undefined;
  return { rendu, plan: ligneP ? montageDemandeDepuisLigne(ligneP) : null, motif: null };
}
