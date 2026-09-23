/**
 * Autorisation des crons appelés par le planificateur (Coolify Scheduled
 * Tasks) : seul `Authorization: Bearer <CRON_SECRET>` exact passe.
 *
 * ⚠️ Secret absent, vide ou blanc → TOUT est refusé. L'ancienne comparaison
 * `authHeader === \`Bearer ${process.env.CRON_SECRET}\`` attendait, sans
 * secret, la chaîne littérale « Bearer undefined » : n'importe qui l'envoyant
 * déclenchait la publication ou les purges.
 *
 * Fonction pure : ne lit que ses deux arguments.
 */
export function isCronAuthorized(
  authHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (typeof secret !== 'string' || secret.trim() === '') return false;
  if (!authHeader) return false;
  return authHeader === `Bearer ${secret}`;
}
