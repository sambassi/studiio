/**
 * #547 — la sonde de présence d'un rush AU NOM d'un compte.
 *
 * La sonde HEAD (`rushEncorePresent`) n'a pas de cookie : sans jeton, le
 * relais répond 404 (neutre) — et le cron RETIRERAIT de la banque un rush
 * parfaitement valide. Une URL de NOTRE stockage qui appartient à `lecteur`
 * est donc sondée avec un jeton du relais ; toute autre part nue. Les
 * appelants ont déjà passé la garde de propriété (`mediaLisiblePar`).
 *
 * Module à part (et non dans `poster.ts`) : il enveloppe la sonde telle
 * qu'elle est exportée, doublures de test comprises.
 */
import { rushEncorePresent } from '@/lib/autopilot/poster';
import { signerSiNotreStockage } from '@/lib/storage/jeton-relais';

export function sondeRushPour(lecteur: string): typeof rushEncorePresent {
  return (url, timeoutMs, reseau, onEtat) =>
    rushEncorePresent(signerSiNotreStockage(url, { lecteur }) as string, timeoutMs, reseau, onEtat);
}
