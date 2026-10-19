/**
 * M3-a PR3 — interrupteur de l'APERÇU RAPIDE du plan de montage (Créer).
 *
 * Vrai SEULEMENT si `STUDIIO_APERCU_PLAN_ENABLED` vaut exactement `"true"`
 * (serveur, jamais `NEXT_PUBLIC_*`). Éteint : l'aperçu « Tout » d'avant
 * (rush 1 en boucle) et l'export recalculant le plan, à l'identique.
 */
export function apercuPlanActif(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDIIO_APERCU_PLAN_ENABLED === 'true';
}
