/**
 * M3-a — interrupteur du mode « passages » du Smart Montage.
 *
 * Vrai SEULEMENT si `STUDIIO_MONTAGE_PASSAGES_ENABLED` vaut exactement
 * `"true"` (serveur, jamais `NEXT_PUBLIC_*`). PR1 : AUCUN appelant ne le lit
 * (garde par test) — le mode reste éteint partout tant que PR2 n'est pas
 * fusionnée ET la variable posée.
 */
export function montagePassagesActif(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDIIO_MONTAGE_PASSAGES_ENABLED === 'true';
}
