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
  analysisId: string;
  candidateSetId: string;
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
 * Elle ne LANCE ni analyse ni génération de candidats. Ces deux étapes
 * coûtent un fournisseur externe, plusieurs minutes, et leur orchestration
 * vit aujourd'hui à l'intérieur de deux routes HTTP — l'automatiser demande
 * de l'en extraire, ce qui est un lot à part entière.
 *
 * Conséquence assumée et à dire clairement : la passerelle monte la matière
 * DÉJÀ analysée. Un compte qui n'a jamais ouvert un rush dans l'application
 * n'a rien à monter, et le cycle est ignoré — pas échoué.
 *
 * `evites` porte les rushes déjà montés dans ce cycle : sans lui, deux
 * montages du même cycle repartiraient du même rush et se ressembleraient.
 */
export async function choisirRushMontable(
  userId: string, evites: ReadonlySet<string> = new Set(),
): Promise<RushMontable | null> {
  for (const rush of await rushesVerifies(userId)) {
    if (evites.has(rush.id)) continue;

    const { analyse } = await lireDerniereAnalyse(userId, rush.id);
    if (!analyse || analyse.etat !== 'reussie') continue;

    const { generation } = await lireDerniereGeneration(userId, analyse.id);
    if (!generation || generation.etat !== 'reussie') continue;

    return {
      rushId: rush.id,
      analysisId: analyse.id,
      candidateSetId: generation.id,
      derniereUtilisation: null,
    };
  }
  return null;
}
