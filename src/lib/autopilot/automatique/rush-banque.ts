/**
 * A_0 — QUEL RUSH LE MOTEUR M3 MONTE-T-IL, TOUT SEUL ?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX BANQUES EXISTENT, ET C'EST LE PROBLÈME
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • `autopilot_config.rush_urls` — un tableau d'URL. C'est la SEULE que le
 *     cron historique lit. Une URL ne dit rien : ni durée, ni parole, ni
 *     analyse. Le gabarit s'en contente parce qu'il ne fait que l'incruster.
 *   • `shoot_sessions` / `rushes` — le socle M3. Un rush y a un propriétaire,
 *     un état, une durée mesurée, et surtout des ANALYSES rattachées.
 *
 * La migration du socle dit elle-même que les deux coexistent sans
 * passerelle. M3 ne peut travailler qu'avec la seconde : on ne monte pas une
 * URL, on monte des passages choisis dans un rush analysé.
 *
 * ⚠️ AUCUNE DONNÉE N'EST MIGRÉE ICI, ET AUCUNE COLONNE N'EST AJOUTÉE. Ce
 * module ne fait que LIRE la banque canonique. `rush_urls` reste intacte et
 * continue de servir le moteur historique — les deux banques cohabitent le
 * temps de la transition, et c'est un choix, pas un oubli.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { lireDerniereAnalyse } from '@/lib/autopilot/analyse/service';
import { lireDerniereGeneration } from '@/lib/autopilot/analyse/candidat-service';

/** Un rush prêt à être monté, avec la matière que M3 exige. */
export interface RushMontable {
  rushId: string;
  /** `null` quand le rush n'a encore aucune analyse réussie. */
  analysisId: string | null;
  /** `null` quand aucun jeu de candidats réussi n'existe. */
  candidateSetId: string | null;
  /** Le rang du rush dans sa session — il sert la rotation, rien d'autre. */
  derniereUtilisation: string | null;
}

/**
 * Les rushes d'un compte, du plus récemment indexé au plus ancien.
 *
 * `etat = 'verifie'` seulement : un rush `indexe` n'a pas encore été
 * confirmé présent dans le stockage, et un rush `absent` a disparu. Monter
 * l'un ou l'autre échouerait plus loin, plus lentement, et plus cher.
 */
async function rushesVerifies(userId: string): Promise<{ id: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('rushes')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('etat', 'verifie')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return Array.isArray(data) ? data as { id: string }[] : [];
}

/**
 * Le premier rush qui a TOUT ce qu'il faut pour être monté sans rien relancer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE CETTE FONCTION NE FAIT PAS, DÉLIBÉRÉMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle ne LANCE rien : elle CHOISIT. La préparation — analyse, candidats —
 * appartient à la chaîne, qui sait la conduire et l'interrompre proprement.
 * Ce module reste une lecture, et c'est ce qui le rend simple à tenir.
 *
 * ⚠️ DEPUIS A_0b, UN RUSH BRUT EST UN CHOIX VALIDE. Il est rendu avec
 * `analysisId: null` : c'est la chaîne qui décidera de l'analyser. Mais un
 * rush DÉJÀ prêt passe toujours devant — sinon un compte disposant de dix
 * rushes analysés paierait quand même un fournisseur à chaque cycle.
 *
 * `evites` porte les rushes déjà montés dans ce cycle : sans lui, deux
 * montages du même cycle repartiraient du même rush et se ressembleraient.
 */
export async function choisirRushMontable(
  userId: string, evites: ReadonlySet<string> = new Set(),
): Promise<RushMontable | null> {
  /* ⚠️ DEUX PASSES, ET L'ORDRE COMPTE. On cherche D'ABORD un rush entierement
     pret : le monter ne coute rien de plus qu'un encodage. Ce n'est que si
     aucun ne l'est qu'on rend un rush brut, dont la preparation appellera des
     fournisseurs. Sans cet ordre, un compte disposant de dix rushes prets
     paierait quand meme une analyse a chaque cycle. */
  const verifies = (await rushesVerifies(userId)).filter((r) => !evites.has(r.id));

  const bruts: RushMontable[] = [];
  for (const rush of verifies) {
    const { analyse } = await lireDerniereAnalyse(userId, rush.id);
    if (!analyse || analyse.etat !== 'reussie') {
      bruts.push({ rushId: rush.id, analysisId: null, candidateSetId: null,
        derniereUtilisation: null });
      continue;
    }
    const { generation } = await lireDerniereGeneration(userId, analyse.id);
    if (!generation || generation.etat !== 'reussie') {
      bruts.push({ rushId: rush.id, analysisId: analyse.id, candidateSetId: null,
        derniereUtilisation: null });
      continue;
    }
    return {
      rushId: rush.id,
      analysisId: analyse.id,
      candidateSetId: generation.id,
      derniereUtilisation: null,
    };
  }
  return bruts[0] ?? null;
}
